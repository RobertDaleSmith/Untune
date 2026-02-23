pub mod jxa;
pub mod scanner;
pub mod matcher;
pub mod artwork;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, Database};
use crate::models::{ImportProgress, ImportStats};

pub fn run_import(app: &AppHandle) -> Result<ImportStats, String> {
    let scripts_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("scripts");

    // Phase 1: JXA track extraction
    emit_progress(app, "jxa_tracks", "Extracting tracks from Music app...", 0, 1);
    let jxa_tracks = jxa::extract_tracks(&scripts_dir).map_err(|e| format!("JXA track extraction failed: {}", e))?;
    let jxa_count = jxa_tracks.len() as u64;
    emit_progress(app, "jxa_tracks", &format!("Extracted {} tracks", jxa_count), 1, 1);
    log::info!("JXA extracted {} tracks", jxa_count);

    // Phase 2: Filesystem scan
    let music_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join("Music/Music/Media");
    emit_progress(app, "file_scan", "Scanning music files...", 0, 1);
    let scanned = scanner::scan_directory(&music_dir, |current, total| {
        emit_progress(app, "file_scan", &format!("Scanning files... {}/{}", current, total), current, total);
    }).map_err(|e| format!("File scan failed: {}", e))?;
    let scanned_count = scanned.len() as u64;
    emit_progress(app, "file_scan", &format!("Scanned {} files", scanned_count), scanned_count, scanned_count);
    log::info!("Scanned {} files", scanned_count);

    // Phase 3: Match & merge
    emit_progress(app, "matching", "Matching tracks to files...", 0, 1);
    let match_result = matcher::match_tracks(jxa_tracks, scanned);
    let merged = match_result.merged;
    let stats = ImportStats {
        total_tracks: merged.len() as u64,
        jxa_tracks: jxa_count,
        scanned_files: scanned_count,
        matched: match_result.matched,
        unmatched_jxa: match_result.unmatched_jxa,
        unmatched_files: match_result.unmatched_files,
        playlists: 0,
    };
    emit_progress(app, "matching", &format!("Matched {} tracks", stats.matched), 1, 1);
    log::info!(
        "Match stats: {} matched, {} unmatched JXA, {} unmatched files",
        stats.matched, stats.unmatched_jxa, stats.unmatched_files
    );

    // Phase 4: Database insert
    emit_progress(app, "db_insert", "Inserting into database...", 0, 1);
    {
        let db_state = app.state::<Database>();
        let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        db::clear_tracks(&conn).map_err(|e| format!("Clear failed: {}", e))?;
        db::batch_insert_tracks(&mut conn, &merged).map_err(|e| format!("Insert failed: {}", e))?;
        db::rebuild_fts(&conn).map_err(|e| format!("FTS rebuild failed: {}", e))?;
    }
    emit_progress(app, "db_insert", "Database import complete", 1, 1);

    // Phase 5: Playlist extraction
    emit_progress(app, "playlists", "Extracting playlists...", 0, 1);
    match jxa::extract_playlists(&scripts_dir) {
        Ok(playlists) => {
            let playlist_count = playlists.len() as u64;
            let db_state = app.state::<Database>();
            let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;

            for playlist in &playlists {
                let track_count = playlist.track_persistent_ids.len() as i32;
                let pl_id = db::insert_playlist(
                    &conn,
                    &playlist.persistent_id,
                    &playlist.name,
                    playlist.is_smart,
                    track_count,
                )
                .map_err(|e| format!("Playlist insert failed: {}", e))?;

                // Resolve persistent IDs to track IDs
                let track_entries: Vec<(i64, i32)> = playlist
                    .track_persistent_ids
                    .iter()
                    .enumerate()
                    .filter_map(|(pos, pid)| {
                        let track_id: Option<i64> = conn
                            .query_row(
                                "SELECT id FROM tracks WHERE persistent_id = ?1",
                                rusqlite::params![pid],
                                |row| row.get(0),
                            )
                            .ok();
                        track_id.map(|tid| (tid, pos as i32))
                    })
                    .collect();

                let _ = db::insert_playlist_tracks(&mut conn, pl_id, &track_entries);
            }
            emit_progress(app, "playlists", &format!("Imported {} playlists", playlist_count), 1, 1);
            log::info!("Imported {} playlists", playlist_count);
        }
        Err(e) => {
            log::warn!("Playlist extraction failed (non-fatal): {}", e);
            emit_progress(app, "playlists", "Playlist extraction skipped", 1, 1);
        }
    }

    // Phase 6: Spawn background artwork extraction
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = artwork::extract_artwork_background(&app_handle) {
            log::warn!("Background artwork extraction failed: {}", e);
        }
    });

    emit_progress(app, "complete", "Import complete!", 1, 1);
    Ok(stats)
}

fn emit_progress(app: &AppHandle, phase: &str, message: &str, current: u64, total: u64) {
    let _ = app.emit(
        "import-progress",
        ImportProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            current,
            total,
        },
    );
}
