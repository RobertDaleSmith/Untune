use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrlDownloadProgress {
    pub phase: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_name: Option<String>,
}

#[derive(Debug)]
pub struct DownloadResult {
    pub file_path: PathBuf,
    pub thumbnail_path: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct YtDlpMeta {
    pub title: Option<String>,
    pub track: Option<String>,
    pub uploader: Option<String>,
    pub channel: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub creator: Option<String>,
    pub genre: Option<String>,
    pub release_year: Option<i32>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

impl YtDlpMeta {
    /// Best guess at the artist name from yt-dlp metadata.
    pub fn best_artist(&self) -> Option<String> {
        self.artist
            .clone()
            .or_else(|| self.creator.clone())
            .or_else(|| self.channel.clone())
            .or_else(|| self.uploader.clone())
    }

    /// Best guess at the track title (prefer `track` over `title`).
    pub fn best_title(&self) -> Option<String> {
        self.track.clone().or_else(|| self.title.clone())
    }
}

pub fn emit_url_progress(app: &AppHandle, phase: &str, message: &str) {
    let _ = app.emit(
        "url-download-progress",
        UrlDownloadProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            current: None,
            total: None,
            playlist_name: None,
        },
    );
}

pub fn emit_playlist_progress(
    app: &AppHandle,
    phase: &str,
    message: &str,
    current: usize,
    total: usize,
    playlist_name: &str,
) {
    let _ = app.emit(
        "url-download-progress",
        UrlDownloadProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            current: Some(current),
            total: Some(total),
            playlist_name: Some(playlist_name.to_string()),
        },
    );
}

/// Locate the yt-dlp binary. Checks bundled resources first, then PATH.
pub fn find_ytdlp(app: &AppHandle) -> Result<PathBuf, String> {
    // Check bundled resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("bin").join("yt-dlp");
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    // Fall back to PATH lookup
    which::which("yt-dlp").map_err(|_| {
        "yt-dlp not found. Install it with `brew install yt-dlp` or place the binary in the app's resources/bin/ directory.".to_string()
    })
}

/// Download audio from a URL using yt-dlp.
pub fn download_audio(
    url: &str,
    output_dir: &Path,
    app: &AppHandle,
) -> Result<DownloadResult, String> {
    let ytdlp = find_ytdlp(app)?;
    std::fs::create_dir_all(output_dir).map_err(|e| format!("Failed to create download dir: {}", e))?;

    emit_url_progress(app, "downloading", "Downloading audio...");

    let output = Command::new(&ytdlp)
        .args([
            "-x",
            "--audio-format", "m4a",
            "--audio-quality", "0",
            "-o", "%(title)s.%(ext)s",
            "--print", "after_move:filepath",
            "--no-playlist",
            "--write-thumbnail",
            "--convert-thumbnails", "jpg",
            url,
        ])
        .current_dir(output_dir)
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let file_path = stdout
        .lines()
        .last()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "yt-dlp did not output a file path".to_string())?;

    let file_path = PathBuf::from(file_path);
    if !file_path.exists() {
        return Err(format!("Downloaded file not found: {}", file_path.display()));
    }

    // Look for thumbnail: same stem + .jpg
    let thumbnail_path = file_path.with_extension("jpg");
    let thumbnail_path = if thumbnail_path.exists() {
        Some(thumbnail_path)
    } else {
        None
    };

    Ok(DownloadResult {
        file_path,
        thumbnail_path,
    })
}

// ---------------------------------------------------------------------------
// Playlist helpers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct YtDlpPlaylistEntry {
    pub url: Option<String>,
    pub title: Option<String>,
    pub id: Option<String>,
    pub playlist_title: Option<String>,
}

pub struct PlaylistInfo {
    pub title: String,
    pub entries: Vec<PlaylistEntry>,
}

pub struct PlaylistEntry {
    pub url: String,
    pub title: Option<String>,
}

/// Returns true if the URL looks like a YouTube playlist URL (contains `list=`).
pub fn is_playlist_url(url: &str) -> bool {
    url.contains("list=")
}

/// Enumerate all videos in a playlist using yt-dlp --flat-playlist.
/// Returns the playlist title and a list of individual video URLs.
pub fn get_ytdlp_playlist_info(url: &str, app: &AppHandle) -> Result<PlaylistInfo, String> {
    let ytdlp = find_ytdlp(app)?;

    emit_url_progress(app, "metadata", "Fetching playlist info...");

    let output = Command::new(&ytdlp)
        .args(["--dump-json", "--flat-playlist", "--no-download", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp playlist fetch failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut playlist_title: Option<String> = None;
    let mut entries = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: YtDlpPlaylistEntry = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse playlist entry JSON: {}", e))?;

        // Grab playlist title from first entry
        if playlist_title.is_none() {
            playlist_title = entry.playlist_title.clone();
        }

        // Build the video URL from the entry
        let video_url = entry
            .url
            .clone()
            .or_else(|| entry.id.as_ref().map(|id| format!("https://www.youtube.com/watch?v={}", id)));

        if let Some(video_url) = video_url {
            entries.push(PlaylistEntry {
                url: video_url,
                title: entry.title.clone(),
            });
        }
    }

    if entries.is_empty() {
        return Err("No videos found in playlist".to_string());
    }

    let title = playlist_title.unwrap_or_else(|| "YouTube Playlist".to_string());

    Ok(PlaylistInfo { title, entries })
}

/// Fetch metadata from a URL without downloading using yt-dlp --dump-json.
pub fn get_ytdlp_metadata(url: &str, app: &AppHandle) -> Result<YtDlpMeta, String> {
    let ytdlp = find_ytdlp(app)?;

    emit_url_progress(app, "metadata", "Fetching metadata...");

    let output = Command::new(&ytdlp)
        .args(["--dump-json", "--no-download", "--no-playlist", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp metadata failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse yt-dlp JSON: {}", e))
}
