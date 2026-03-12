use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::commands::ai_tags::AiTaggingState;
use crate::db::Database;
use crate::gme_source;
use crate::psf_source;
use crate::import::artwork;
use crate::models::{ImportStats, MergedTrack};

#[tauri::command]
pub async fn import_library(app: AppHandle) -> Result<ImportStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::import::run_import(&app)
    })
    .await
    .map_err(|e| format!("Import failed: {}", e))?
}

#[tauri::command]
pub fn reset_library(
    app: AppHandle,
    ai_state: State<'_, AiTaggingState>,
) -> Result<(), String> {
    // Cancel any in-progress AI tagging
    ai_state.progress.cancel.store(true, Ordering::Relaxed);

    // Auto-backup AI tags before wiping
    let db = app.state::<Database>();
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        match crate::import::ai_tag_backup::export_ai_tags_to_file(&conn) {
            Ok(tags) if !tags.is_empty() => {
                if let Ok(app_dir) = app.path().app_data_dir() {
                    let backup_path = app_dir.join("ai_tags_backup.json");
                    match serde_json::to_string(&tags) {
                        Ok(json) => {
                            if let Err(e) = std::fs::write(&backup_path, json) {
                                log::warn!("Failed to write AI tags backup: {}", e);
                            } else {
                                log::info!("Auto-backed up {} AI tags before reset", tags.len());
                            }
                        }
                        Err(e) => log::warn!("Failed to serialize AI tags backup: {}", e),
                    }
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("Failed to query AI tags for backup: {}", e),
        }
    }

    // Clear all data tables (preserves preferences)
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    crate::db::reset_library(&conn).map_err(|e| e.to_string())?;

    // Delete all artwork files
    if let Ok(artwork_dir) = Database::artwork_dir(&app) {
        if artwork_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&artwork_dir) {
                for entry in entries.flatten() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    Ok(())
}

const IMPORT_AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "aif", "aiff", "wav", "ogg", "alac", "opus",
    "spc", "nsf", "nsfe", "gbs", "vgm", "vgz", "gym", "ay", "hes", "kss", "sap",
    "psf", "minipsf", "psf2", "minipsf2",
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFilesResult {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[tauri::command]
pub async fn import_files(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<ImportFilesResult, String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_files_blocking(&app2, &paths)
    })
    .await
    .map_err(|e| format!("Import failed: {}", e))?
}

fn import_files_blocking(app: &AppHandle, paths: &[String]) -> Result<ImportFilesResult, String> {
    // Collect all audio files (expand directories)
    let mut file_paths: Vec<std::path::PathBuf> = Vec::new();
    for path in paths {
        let p = std::path::Path::new(path);
        if p.is_dir() {
            for entry in WalkDir::new(p).into_iter().flatten() {
                if entry.file_type().is_file() {
                    if let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) {
                        if IMPORT_AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            file_paths.push(entry.into_path());
                        }
                    }
                }
            }
        } else if p.is_file() {
            file_paths.push(p.to_path_buf());
        }
    }

    if file_paths.is_empty() {
        return Ok(ImportFilesResult { imported: 0, skipped: 0, failed: 0 });
    }

    let db = app.state::<Database>();
    let artwork_dir = Database::artwork_dir(app).map_err(|e| e.to_string())?;
    let total = file_paths.len();
    let mut tracks: Vec<MergedTrack> = Vec::new();
    let mut artwork_hashes: Vec<(String, Option<String>)> = Vec::new(); // (file_path, hash)
    let mut skipped = 0;
    let mut failed = 0;

    // Check existing file paths to avoid duplicates
    let existing: std::collections::HashSet<String> = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT file_path FROM tracks WHERE file_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        paths.into_iter().collect()
    };

    for (i, path) in file_paths.iter().enumerate() {
        let file_path_str = path.to_string_lossy().to_string();

        // Emit progress
        let _ = app.emit("import-files-progress", serde_json::json!({
            "current": i + 1,
            "total": total,
            "file": path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        }));

        // Skip duplicates
        if existing.contains(&file_path_str) {
            skipped += 1;
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        let is_gme = gme_source::GME_EXTENSIONS.contains(&ext.as_str());
        let is_psf = psf_source::PSF_EXTENSIONS.contains(&ext.as_str());

        if is_gme || is_psf {
            let (title, artist, game, duration, sr) = if is_psf {
                let meta = psf_source::read_psf_metadata(&file_path_str);
                let sr = if ext == "psf2" || ext == "minipsf2" { 48000 } else { 44100 };
                (meta.title, meta.artist, meta.game, meta.duration, sr)
            } else {
                let meta = gme_source::read_gme_metadata(&file_path_str);
                (meta.title, meta.artist, meta.game, meta.duration, 44100)
            };

            let title = title.unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string()
            });

            let now = sqlite_datetime_now();
            let size = std::fs::metadata(path).ok().map(|m| m.len() as i64);

            tracks.push(MergedTrack {
                persistent_id: None,
                title,
                artist,
                album_artist: None,
                album: game,
                genre: Some("Video Game Music".to_string()),
                composer: None,
                year: None,
                track_number: None,
                track_count: None,
                disc_number: None,
                disc_count: None,
                duration,
                size,
                bit_rate: None,
                sample_rate: Some(sr),
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
                file_path: Some(file_path_str),
                has_artwork: false,
            });
        } else {
            // Standard audio file — read with lofty
            match read_audio_metadata(path) {
                Some(merged) => {
                    let fp = merged.file_path.clone().unwrap_or_default();
                    // Extract artwork
                    let hash = artwork::extract_and_save_artwork(&fp, &artwork_dir);
                    artwork_hashes.push((fp, hash));
                    tracks.push(merged);
                }
                None => {
                    failed += 1;
                }
            }
        }
    }

    let imported = tracks.len();

    // Insert into DB
    {
        let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::batch_insert_tracks(&mut conn, &tracks).map_err(|e| e.to_string())?;

        // Set artwork hashes
        for (file_path, hash) in &artwork_hashes {
            if let Some(h) = hash {
                let _ = conn.execute(
                    "UPDATE tracks SET artwork_hash = ?1 WHERE file_path = ?2 AND artwork_hash IS NULL",
                    rusqlite::params![h, file_path],
                );
            }
        }

        crate::db::rebuild_fts(&conn).map_err(|e| e.to_string())?;
    }

    let _ = app.emit("library-changed", ());

    Ok(ImportFilesResult { imported, skipped, failed })
}

fn read_audio_metadata(path: &std::path::Path) -> Option<MergedTrack> {
    use lofty::file::{AudioFile, TaggedFileExt};
    use lofty::tag::Accessor;

    let file_path_str = path.to_string_lossy().to_string();

    let (title, artist, album_artist, album, genre, composer, year, track_number, track_count,
         disc_number, disc_count, duration, bit_rate, sample_rate, has_artwork) =
        match lofty::read_from_path(path) {
            Ok(tagged_file) => {
                let props = tagged_file.properties();
                let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());
                let (title, artist, album_artist, album, genre, composer, year, track_num, track_count, disc_num, disc_count) =
                    if let Some(t) = tag {
                        (
                            t.title().map(|s| s.to_string()),
                            t.artist().map(|s| s.to_string()),
                            t.get_string(&lofty::tag::ItemKey::AlbumArtist).map(|s| s.to_string()),
                            t.album().map(|s| s.to_string()),
                            t.genre().map(|s| s.to_string()),
                            t.get_string(&lofty::tag::ItemKey::Composer).map(|s| s.to_string()),
                            t.year().map(|y| y as i32),
                            t.track().map(|n| n as i32),
                            t.track_total().map(|n| n as i32),
                            t.disk().map(|n| n as i32),
                            t.disk_total().map(|n| n as i32),
                        )
                    } else {
                        (None, None, None, None, None, None, None, None, None, None, None)
                    };
                let embedded = tagged_file.tags().iter().any(|t| !t.pictures().is_empty());
                let dur = props.duration().as_secs_f64();
                (
                    title, artist, album_artist, album, genre, composer, year,
                    track_num, track_count, disc_num, disc_count,
                    if dur > 0.0 { Some(dur) } else { None },
                    props.audio_bitrate().map(|b| b as i32),
                    props.sample_rate().map(|s| s as i32),
                    embedded,
                )
            }
            Err(_) => return None,
        };

    let title = title.unwrap_or_else(|| {
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string()
    });

    let now = sqlite_datetime_now();
    let size = std::fs::metadata(path).ok().map(|m| m.len() as i64);

    Some(MergedTrack {
        persistent_id: None,
        title,
        artist,
        album_artist,
        album,
        genre,
        composer,
        year,
        track_number,
        track_count,
        disc_number,
        disc_count,
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
        file_path: Some(file_path_str),
        has_artwork,
    })
}

fn sqlite_datetime_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let rem = now % secs_per_day;
    let hours = rem / 3600;
    let minutes = (rem % 3600) / 60;
    let seconds = rem % 60;
    // Approximate date from Unix epoch (good enough for date_added)
    let (y, m, d) = unix_days_to_ymd(days);
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, hours, minutes, seconds)
}

fn unix_days_to_ymd(days: u64) -> (u64, u64, u64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
