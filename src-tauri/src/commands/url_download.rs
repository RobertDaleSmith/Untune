use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{self, Database};
use crate::import::artwork;
use crate::import::musicbrainz;
use crate::import::url_download;
use crate::models::{MergedTrack, Track};

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;

/// Queue a URL for background download. Returns immediately.
#[tauri::command]
pub async fn queue_url_download(
    app: AppHandle,
    url: String,
) -> Result<(), String> {
    let app_clone = app.clone();

    // Spawn the entire download pipeline as a background task
    tokio::spawn(async move {
        if let Err(e) = process_url_download(app_clone.clone(), &url).await {
            log::error!("URL download failed for {}: {}", url, e);
            url_download::emit_url_progress(&app_clone, "error", &format!("Failed: {}", e));
        }
    });

    Ok(())
}

/// The actual download + metadata + DB insert pipeline (runs in background).
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
            url_download::emit_url_progress(&app, "complete", "Already in library — skipped");
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
    url_download::emit_url_progress(&app, "tagging", "Looking up track details...");
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
    let track = {
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

        let sql = format!(
            "SELECT {} FROM tracks WHERE file_path = ?1 ORDER BY id DESC LIMIT 1",
            db::TRACK_COLUMNS
        );
        conn.query_row(&sql, rusqlite::params![result.file_path_str], |row| {
            db::map_track_row(row)
        })
        .map_err(|e| format!("Failed to query inserted track: {}", e))?
    };

    url_download::emit_url_progress(
        &app,
        "complete",
        &format!("Added: {} - {}", track.artist.as_deref().unwrap_or(""), track.title),
    );
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
    url_download::emit_url_progress(app, "processing", "Reading metadata...");
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
    url_download::emit_url_progress(app, "artwork", "Processing artwork...");
    let artwork_dir = Database::artwork_dir(app).map_err(|e| e.to_string())?;
    let artwork_hash = if has_artwork {
        artwork::extract_and_save_artwork(&file_path_str, &artwork_dir)
    } else {
        None
    };
    let artwork_hash = artwork_hash.or_else(|| {
        download.thumbnail_path.as_ref().and_then(|thumb| {
            let data = std::fs::read(thumb).ok()?;
            artwork::hash_and_save(&data, &artwork_dir)
        })
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
