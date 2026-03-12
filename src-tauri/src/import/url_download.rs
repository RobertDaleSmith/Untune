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
        "yt-dlp is required for URL downloads. Install it by running: brew install yt-dlp ffmpeg".to_string()
    })
}

/// Locate ffmpeg. Checks bundled resources first, then PATH. Returns None if not found.
pub fn find_ffmpeg(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("bin").join("ffmpeg");
        if bundled.exists() {
            return Some(bundled);
        }
    }
    which::which("ffmpeg").ok()
}

/// Download audio from a URL using yt-dlp.
/// If ffmpeg is available, extracts and converts to m4a.
/// Otherwise, downloads the best native audio stream directly.
pub fn download_audio(
    url: &str,
    output_dir: &Path,
    app: &AppHandle,
) -> Result<DownloadResult, String> {
    let ytdlp = find_ytdlp(app)?;
    let ffmpeg = find_ffmpeg(app);
    std::fs::create_dir_all(output_dir).map_err(|e| format!("Failed to create download dir: {}", e))?;

    let mut args: Vec<&str> = Vec::new();

    if ffmpeg.is_some() {
        // ffmpeg available: extract audio and convert to m4a
        args.extend_from_slice(&["-x", "--audio-format", "m4a", "--audio-quality", "0"]);
    } else {
        // No ffmpeg: download best native audio stream (m4a preferred, then any)
        log::info!("ffmpeg not found — downloading native audio stream");
        args.extend_from_slice(&["--format", "bestaudio[ext=m4a]/bestaudio"]);
    }

    args.extend_from_slice(&[
        "-o", "%(title)s.%(ext)s",
        "--print", "after_move:filepath",
        "--no-playlist",
        "--write-thumbnail",
    ]);

    // Only convert thumbnails if ffmpeg is available
    if ffmpeg.is_some() {
        args.extend_from_slice(&["--convert-thumbnails", "jpg"]);
    }

    args.push(url);

    let mut cmd = Command::new(&ytdlp);
    cmd.args(&args).current_dir(output_dir);

    // Point yt-dlp to bundled ffmpeg if it's not on PATH
    if let Some(ref ffmpeg_path) = ffmpeg {
        if let Some(ffmpeg_dir) = ffmpeg_path.parent() {
            cmd.arg("--ffmpeg-location").arg(ffmpeg_dir);
        }
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let hint = if ffmpeg.is_none() && (stderr.contains("ffmpeg") || stderr.contains("Postprocessing")) {
            " (ffmpeg is not installed — run: brew install ffmpeg)"
        } else {
            ""
        };
        return Err(format!("yt-dlp failed{}: {}", hint, stderr.lines().last().unwrap_or(&stderr)));
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

    // Look for thumbnail: same stem + various extensions
    // yt-dlp may create .jpg, .webp, .png, or leave original format
    let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let thumbnail_path = ["jpg", "webp", "png"]
        .iter()
        .map(|ext| file_path.with_extension(ext))
        .find(|p| p.exists())
        .or_else(|| {
            // Fallback: scan the directory for any image file whose name starts with the stem
            // (yt-dlp sometimes appends suffixes like ".jpg.jpg" or uses different sanitization)
            if let Some(dir) = file_path.parent() {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if matches!(ext, "jpg" | "jpeg" | "webp" | "png") {
                                if let Some(name) = path.file_stem().and_then(|s| s.to_str()) {
                                    if name == stem {
                                        return Some(path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            None
        });

    log::info!(
        "Download complete: audio={}, thumbnail={}",
        file_path.display(),
        thumbnail_path.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "none".to_string()),
    );

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
            .or_else(|| entry.id.clone());

        if let Some(raw_url) = video_url {
            // Normalize: if it's just a video ID (no scheme), construct a full YouTube URL
            let full_url = if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
                raw_url
            } else {
                format!("https://www.youtube.com/watch?v={}", raw_url)
            };
            entries.push(PlaylistEntry {
                url: full_url,
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
