use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex as TokioMutex;

use crate::db::{self, Database};
use crate::import::artwork;
use crate::import::musicbrainz;
use crate::import::url_download;
use crate::models::{MergedTrack, Track};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;

/// Managed state: serial queue for URL downloads so they don't interleave.
pub struct UrlDownloadQueue {
    lock: Arc<TokioMutex<()>>,
}

impl UrlDownloadQueue {
    pub fn new() -> Self {
        Self {
            lock: Arc::new(TokioMutex::new(())),
        }
    }
}

/// Queue a URL for background download. Returns immediately.
/// Downloads are serialized — only one runs at a time.
#[tauri::command]
pub async fn queue_url_download(
    app: AppHandle,
    queue: State<'_, UrlDownloadQueue>,
    url: String,
) -> Result<(), String> {
    // Validate yt-dlp is available before queuing (fail fast with user-visible error)
    url_download::find_ytdlp(&app)?;

    let app_clone = app.clone();
    let lock = queue.lock.clone();

    tokio::spawn(async move {
        let _guard = lock.lock().await;
        if url_download::is_playlist_url(&url) {
            if let Err(e) = process_playlist_download(app_clone.clone(), &url).await {
                log::error!("Playlist download failed for {}: {}", url, e);
                url_download::emit_url_progress(&app_clone, "error", &format!("Failed: {}", e));
            }
        } else {
            if let Err(e) = process_single_download(app_clone.clone(), &url).await {
                log::error!("URL download failed for {}: {}", url, e);
                url_download::emit_url_progress(&app_clone, "error", &format!("Failed: {}", e));
            }
        }
    });

    Ok(())
}

/// Single URL download with its own progress events (not called from playlist pipeline).
async fn process_single_download(
    app: AppHandle,
    url: &str,
) -> Result<(), String> {
    url_download::emit_url_progress(&app, "downloading", "Downloading...");
    let result = process_url_download(app.clone(), url).await;
    match &result {
        Ok(()) => url_download::emit_url_progress(&app, "complete", "Download complete"),
        Err(e) => url_download::emit_url_progress(&app, "error", &format!("Failed: {}", e)),
    }
    result
}

/// The actual download + metadata + DB insert pipeline.
/// Does NOT emit "complete"/"error" progress — callers handle that.
async fn process_url_download(
    app: AppHandle,
    url: &str,
) -> Result<(), String> {
    let db: tauri::State<'_, Database> = app.state();

    // Check for duplicates by source_url
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tracks WHERE source_url = ?1)",
                rusqlite::params![url],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if exists {
            log::info!("URL already in library, skipping: {}", url);
            return Ok(());
        }
    }

    let app_clone = app.clone();
    let url_owned = url.to_string();
    let mut result = tokio::task::spawn_blocking(move || {
        download_and_read(&app_clone, &url_owned)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // MusicBrainz lookup (async) to enrich metadata
    if let Some(mb) = lookup_metadata(&result).await {
        log::info!(
            "MusicBrainz match: \"{}\" by {} on \"{}\" ({:?})",
            mb.title.as_deref().unwrap_or("?"),
            mb.artist.as_deref().unwrap_or("?"),
            mb.album.as_deref().unwrap_or("?"),
            mb.year,
        );
        apply_musicbrainz(&mut result, &mb);
    }

    // Insert into DB
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;

        db::batch_insert_tracks(&mut conn, &[result.merged_track])
            .map_err(|e| format!("DB insert failed: {}", e))?;

        if let Some(ref hash) = result.artwork_hash {
            conn.execute(
                "UPDATE tracks SET artwork_hash = ?1 WHERE file_path = ?2 AND artwork_hash IS NULL",
                rusqlite::params![hash, result.file_path_str],
            )
            .map_err(|e| format!("Artwork hash update failed: {}", e))?;
        }

        conn.execute(
            "UPDATE tracks SET source_url = ?1 WHERE file_path = ?2",
            rusqlite::params![result.source_url, result.file_path_str],
        )
        .map_err(|e| format!("Source URL update failed: {}", e))?;

        db::rebuild_fts(&conn).map_err(|e| format!("FTS rebuild failed: {}", e))?;
    };

    let _ = app.emit("library-changed", ());
    Ok(())
}

/// Download all videos in a YouTube playlist, create a library playlist, and add tracks.
async fn process_playlist_download(
    app: AppHandle,
    url: &str,
) -> Result<(), String> {
    let db: State<'_, Database> = app.state();

    // Fetch playlist metadata (blocking yt-dlp call)
    let app_clone = app.clone();
    let url_owned = url.to_string();
    let playlist_info = tokio::task::spawn_blocking(move || {
        url_download::get_ytdlp_playlist_info(&url_owned, &app_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let playlist_name = playlist_info.title.clone();
    let total = playlist_info.entries.len();

    url_download::emit_playlist_progress(
        &app,
        "downloading",
        &format!("Playlist: {} ({} videos)", playlist_name, total),
        0,
        total,
        &playlist_name,
    );

    // Create the playlist in the DB
    let playlist_id = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        db::insert_regular_playlist(&conn, &playlist_name, None)
            .map_err(|e| format!("Failed to create playlist: {}", e))?
    };

    let mut track_ids: Vec<i64> = Vec::new();
    let mut succeeded = 0usize;
    let mut failed = 0usize;

    for (i, entry) in playlist_info.entries.iter().enumerate() {
        let label = entry
            .title
            .as_deref()
            .unwrap_or(&entry.url);

        url_download::emit_playlist_progress(
            &app,
            "downloading",
            &format!("{} of {}: {}", i + 1, total, label),
            i + 1,
            total,
            &playlist_name,
        );

        // Try to download and process this video
        match process_url_download(app.clone(), &entry.url).await {
            Ok(()) => {
                succeeded += 1;
            }
            Err(e) => {
                log::warn!("Playlist entry {} failed ({}): {}", i + 1, entry.url, e);
                failed += 1;
            }
        }

        // Look up the track ID by source_url (works for both new and already-existing)
        let track_id = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT id FROM tracks WHERE source_url = ?1 ORDER BY id DESC LIMIT 1",
                rusqlite::params![entry.url],
                |row| row.get::<_, i64>(0),
            )
            .ok()
        };

        if let Some(id) = track_id {
            track_ids.push(id);
        }
    }

    // Add all collected tracks to the playlist
    if !track_ids.is_empty() {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        db::add_tracks_to_playlist(&conn, playlist_id, &track_ids)
            .map_err(|e| format!("Failed to add tracks to playlist: {}", e))?;
    }

    let summary = if failed > 0 {
        format!(
            "Playlist \"{}\": {} of {} tracks added ({} failed)",
            playlist_name, succeeded, total, failed,
        )
    } else {
        format!(
            "Playlist \"{}\": {} tracks added",
            playlist_name, succeeded,
        )
    };

    url_download::emit_playlist_progress(&app, "complete", &summary, total, total, &playlist_name);
    let _ = app.emit("library-changed", ());
    Ok(())
}

struct DownloadedTrack {
    merged_track: MergedTrack,
    file_path_str: String,
    artwork_hash: Option<String>,
    /// Artist as determined from yt-dlp / title parsing (for MB lookup)
    lookup_artist: Option<String>,
    /// Clean title for MB lookup
    lookup_title: String,
    /// Original source URL (e.g. YouTube)
    source_url: String,
}

/// Download the file and read initial metadata (blocking).
fn download_and_read(app: &AppHandle, url: &str) -> Result<DownloadedTrack, String> {
    let download_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads");

    // Fetch yt-dlp metadata (lightweight, no download)
    let meta = url_download::get_ytdlp_metadata(url, app)?;

    // Download the audio file
    let download = url_download::download_audio(url, &download_dir, app)?;

    // Read metadata from the downloaded file via lofty
    let file_path_str = download.file_path.to_string_lossy().to_string();

    let (lofty_title, lofty_artist, lofty_album, track_number, duration, bit_rate, sample_rate, has_artwork) =
        match lofty::read_from_path(&download.file_path) {
            Ok(tagged_file) => {
                let props = tagged_file.properties();
                let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
                let (title, artist, album, track_num) = if let Some(t) = tag {
                    (
                        t.title().map(|s| s.to_string()),
                        t.artist().map(|s| s.to_string()),
                        t.album().map(|s| s.to_string()),
                        t.track().map(|n| n as i32),
                    )
                } else {
                    (None, None, None, None)
                };
                let embedded = tagged_file.tags().iter().any(|t| !t.pictures().is_empty());
                let dur = props.duration().as_secs_f64();
                (
                    title,
                    artist,
                    album,
                    track_num,
                    if dur > 0.0 { Some(dur) } else { None },
                    props.audio_bitrate().map(|b| b as i32),
                    props.sample_rate().map(|s| s as i32),
                    embedded,
                )
            }
            Err(_) => (None, None, None, None, None, None, None, false),
        };

    // Try to parse "Artist - Title" from video title if yt-dlp doesn't have clean metadata
    let parsed = meta.title.as_deref().and_then(musicbrainz::parse_artist_title);

    // Determine the best artist and title for the track and for MB lookup
    let yt_artist = meta.best_artist();
    let yt_title = meta.best_title();

    // For the track itself: lofty > yt-dlp track > parsed > yt-dlp title
    let title = lofty_title
        .clone()
        .or_else(|| yt_title.clone())
        .or_else(|| parsed.as_ref().map(|(_, t)| t.clone()))
        .unwrap_or_else(|| "Unknown Title".to_string());

    let artist = lofty_artist
        .clone()
        .or_else(|| meta.artist.clone())
        .or_else(|| parsed.as_ref().map(|(a, _)| a.clone()))
        .or_else(|| yt_artist.clone());

    let album = lofty_album.or(meta.album.clone());
    let duration = duration.or(meta.duration);
    let genre = meta.genre.clone();
    let year = meta.release_year;

    // For MB lookup: prefer parsed artist+title, fall back to whatever we have
    let lookup_artist = parsed
        .as_ref()
        .map(|(a, _)| a.clone())
        .or_else(|| meta.artist.clone())
        .or_else(|| lofty_artist)
        .or(yt_artist);
    let lookup_title = parsed
        .as_ref()
        .map(|(_, t)| t.clone())
        .or(yt_title)
        .or_else(|| lofty_title)
        .unwrap_or_else(|| title.clone());

    // Handle artwork
    let artwork_dir = Database::artwork_dir(app).map_err(|e| e.to_string())?;
    let artwork_hash = if has_artwork {
        artwork::extract_and_save_artwork(&file_path_str, &artwork_dir)
    } else {
        None
    };
    let artwork_hash = artwork_hash.or_else(|| {
        match download.thumbnail_path.as_ref() {
            Some(thumb) => {
                match std::fs::read(thumb) {
                    Ok(data) => {
                        log::info!("Using thumbnail for artwork: {} ({} bytes)", thumb.display(), data.len());
                        artwork::hash_and_save(&data, &artwork_dir)
                    }
                    Err(e) => {
                        log::warn!("Failed to read thumbnail {}: {}", thumb.display(), e);
                        None
                    }
                }
            }
            None => {
                log::info!("No thumbnail found for {}", file_path_str);
                None
            }
        }
    });

    let size = std::fs::metadata(&download.file_path)
        .ok()
        .map(|m| m.len() as i64);

    let now = sqlite_datetime_now();

    let merged_track = MergedTrack {
        persistent_id: None,
        title,
        artist,
        album_artist: None,
        album,
        genre,
        composer: None,
        year,
        track_number,
        track_count: None,
        disc_number: None,
        disc_count: None,
        duration,
        size,
        bit_rate,
        sample_rate,
        play_count: None,
        skip_count: None,
        rating: None,
        loved: None,
        date_added: Some(now),
        last_played_at: None,
        last_skipped_at: None,
        comments: None,
        grouping: None,
        sort_title: None,
        sort_artist: None,
        sort_album: None,
        sort_album_artist: None,
        sort_composer: None,
        file_path: Some(file_path_str.clone()),
        has_artwork: artwork_hash.is_some() || has_artwork,
    };

    Ok(DownloadedTrack {
        merged_track,
        file_path_str,
        artwork_hash,
        lookup_artist,
        lookup_title,
        source_url: url.to_string(),
    })
}

/// Try MusicBrainz lookup. Returns None on any failure (non-fatal).
async fn lookup_metadata(result: &DownloadedTrack) -> Option<musicbrainz::MbResult> {
    let artist = result.lookup_artist.as_deref()?;
    musicbrainz::lookup_track(artist, &result.lookup_title).await
}

/// Apply MusicBrainz data to the merged track. MB values override only when
/// the track doesn't already have a value (except title/artist from MB which
/// are considered more authoritative than yt-dlp channel names).
fn apply_musicbrainz(result: &mut DownloadedTrack, mb: &musicbrainz::MbResult) {
    let track = &mut result.merged_track;

    // Title and artist from MB are generally more accurate
    if let Some(ref t) = mb.title {
        track.title = t.clone();
    }
    if let Some(ref a) = mb.artist {
        track.artist = Some(a.clone());
    }

    // These only fill in if not already set
    if track.album.is_none() {
        track.album = mb.album.clone();
    }
    if track.album_artist.is_none() {
        track.album_artist = mb.album_artist.clone();
    }
    if track.year.is_none() {
        track.year = mb.year;
    }
    if track.track_number.is_none() {
        track.track_number = mb.track_number;
    }
    if track.track_count.is_none() {
        track.track_count = mb.track_count;
    }
    if track.disc_number.is_none() {
        track.disc_number = mb.disc_number;
    }
    if track.genre.is_none() {
        track.genre = mb.genre.clone();
    }
}

// ---------------------------------------------------------------------------
// Find Missing Tags — MusicBrainz lookup for existing library tracks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindTagsProgress {
    pub current: usize,
    pub total: usize,
    pub updated: usize,
    pub current_track: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindTagsResult {
    pub updated: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn find_missing_tags(
    app: AppHandle,
    db: State<'_, Database>,
    track_ids: Vec<i64>,
) -> Result<FindTagsResult, String> {
    if track_ids.is_empty() {
        return Ok(FindTagsResult { updated: 0, total: 0 });
    }

    // Fetch the tracks we need to look up
    let tracks: Vec<Track> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut result = Vec::with_capacity(track_ids.len());
        let sql = format!("SELECT {} FROM tracks WHERE id = ?1", db::TRACK_COLUMNS);
        for &id in &track_ids {
            if let Ok(track) = conn.query_row(&sql, rusqlite::params![id], |row| {
                db::map_track_row(row)
            }) {
                result.push(track);
            }
        }
        result
    };

    let total = tracks.len();
    let mut updated = 0usize;

    for (i, track) in tracks.iter().enumerate() {
        let label = format!(
            "{} - {}",
            track.artist.as_deref().unwrap_or("Unknown"),
            &track.title,
        );
        let _ = app.emit("find-tags-progress", FindTagsProgress {
            current: i + 1,
            total,
            updated,
            current_track: label.clone(),
        });

        // Need at least a title and artist for a meaningful lookup
        let artist = match track.artist.as_deref() {
            Some(a) if !a.is_empty() => a.to_string(),
            _ => continue,
        };

        // Look up on MusicBrainz
        let mb = match musicbrainz::lookup_track(&artist, &track.title).await {
            Some(mb) => mb,
            None => {
                // MusicBrainz rate limit: 1 request per second
                tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
                continue;
            }
        };

        // Apply updates for missing fields only (scoped so MutexGuard drops before await)
        let did_update = {
            let conn = db.conn.lock().map_err(|e| e.to_string())?;
            update_track_missing_fields(&conn, &track, &mb)
        };

        if did_update {
            updated += 1;
            log::info!("Updated tags for: {}", label);
        }

        // MusicBrainz rate limit: 1 request per second
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }

    // Rebuild FTS if anything changed
    if updated > 0 {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        db::rebuild_fts(&conn).map_err(|e| format!("FTS rebuild failed: {}", e))?;
        let _ = app.emit("library-changed", ());
    }

    let _ = app.emit("find-tags-progress", FindTagsProgress {
        current: total,
        total,
        updated,
        current_track: "Done".to_string(),
    });

    Ok(FindTagsResult { updated, total })
}

// ---------------------------------------------------------------------------
// Interactive Tag Search — search MusicBrainz and let user pick a release
// ---------------------------------------------------------------------------

use crate::import::musicbrainz::MbResult;

#[tauri::command]
pub async fn search_track_tags(
    artist: String,
    title: String,
) -> Result<Vec<MbResult>, String> {
    let results = musicbrainz::search_releases(&artist, &title).await;
    Ok(results)
}

#[tauri::command]
pub async fn apply_track_tags(
    db: State<'_, Database>,
    track_id: i64,
    tags: MbResult,
) -> Result<Track, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Apply all provided fields (overwrite, since the user explicitly chose this result)
    if let Some(ref v) = tags.album {
        let _ = conn.execute("UPDATE tracks SET album = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(ref v) = tags.album_artist {
        let _ = conn.execute("UPDATE tracks SET album_artist = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(ref v) = tags.genre {
        let _ = conn.execute("UPDATE tracks SET genre = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(v) = tags.year {
        let _ = conn.execute("UPDATE tracks SET year = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(v) = tags.track_number {
        let _ = conn.execute("UPDATE tracks SET track_number = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(v) = tags.track_count {
        let _ = conn.execute("UPDATE tracks SET track_count = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(v) = tags.disc_number {
        let _ = conn.execute("UPDATE tracks SET disc_number = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    // Also update title/artist if provided (user chose this match)
    if let Some(ref v) = tags.title {
        let _ = conn.execute("UPDATE tracks SET title = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }
    if let Some(ref v) = tags.artist {
        let _ = conn.execute("UPDATE tracks SET artist = ?1 WHERE id = ?2", rusqlite::params![v, track_id]);
    }

    let _ = conn.execute("UPDATE tracks SET updated_at = datetime('now') WHERE id = ?1", rusqlite::params![track_id]);

    db::rebuild_fts(&conn).map_err(|e| format!("FTS rebuild failed: {}", e))?;

    // Return updated track
    let sql = format!("SELECT {} FROM tracks WHERE id = ?1", db::TRACK_COLUMNS);
    conn.query_row(&sql, rusqlite::params![track_id], |row| {
        db::map_track_row(row)
    })
    .map_err(|e| format!("Failed to query updated track: {}", e))
}

/// Update only the missing fields on a track from MusicBrainz data.
/// Returns true if any field was updated.
fn update_track_missing_fields(
    conn: &rusqlite::Connection,
    track: &Track,
    mb: &musicbrainz::MbResult,
) -> bool {
    // Use individual UPDATE statements per field to avoid dynamic param issues
    let mut changed = false;

    if track.album.is_none() {
        if let Some(ref v) = mb.album {
            if conn.execute("UPDATE tracks SET album = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.album_artist.is_none() {
        if let Some(ref v) = mb.album_artist {
            if conn.execute("UPDATE tracks SET album_artist = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.genre.is_none() {
        if let Some(ref v) = mb.genre {
            if conn.execute("UPDATE tracks SET genre = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.year.is_none() {
        if let Some(v) = mb.year {
            if conn.execute("UPDATE tracks SET year = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.track_number.is_none() {
        if let Some(v) = mb.track_number {
            if conn.execute("UPDATE tracks SET track_number = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.track_count.is_none() {
        if let Some(v) = mb.track_count {
            if conn.execute("UPDATE tracks SET track_count = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }
    if track.disc_number.is_none() {
        if let Some(v) = mb.disc_number {
            if conn.execute("UPDATE tracks SET disc_number = ?1 WHERE id = ?2", rusqlite::params![v, track.id]).unwrap_or(0) > 0 {
                changed = true;
            }
        }
    }

    if changed {
        let _ = conn.execute("UPDATE tracks SET updated_at = datetime('now') WHERE id = ?1", rusqlite::params![track.id]);
    }

    changed
}

/// Generate a SQLite-compatible datetime string for the current time.
fn sqlite_datetime_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs_per_day = 86400u64;
    let days_since_epoch = now / secs_per_day;
    let time_of_day = now % secs_per_day;

    let mut y = 1970i64;
    let mut remaining_days = days_since_epoch as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }

    let months_days: &[i64] = if is_leap(y) {
        &[31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        &[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 0usize;
    for &md in months_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        m += 1;
    }

    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        y,
        m + 1,
        remaining_days + 1,
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60,
    )
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

// ---------------------------------------------------------------------------
// Dependency check
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub install_hint: String,
}

#[tauri::command]
pub async fn check_dependencies(app: AppHandle) -> Vec<DependencyStatus> {
    let mut deps = Vec::new();

    // yt-dlp
    let ytdlp = url_download::find_ytdlp(&app).ok();
    let ytdlp_version = ytdlp.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    });
    deps.push(DependencyStatus {
        name: "yt-dlp".to_string(),
        installed: ytdlp.is_some(),
        version: ytdlp_version,
        path: ytdlp.map(|p| p.display().to_string()),
        install_hint: "brew install yt-dlp".to_string(),
    });

    // ffmpeg
    let ffmpeg = url_download::find_ffmpeg(&app);
    let ffmpeg_version = ffmpeg.as_ref().and_then(|p| {
        std::process::Command::new(p)
            .arg("-version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.lines().next().map(|l| l.to_string()))
    });
    deps.push(DependencyStatus {
        name: "ffmpeg".to_string(),
        installed: ffmpeg.is_some(),
        version: ffmpeg_version,
        path: ffmpeg.map(|p| p.display().to_string()),
        install_hint: "brew install ffmpeg".to_string(),
    });

    deps
}
