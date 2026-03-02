pub mod ai_tag_backup;
pub mod ai_tagger;
pub mod bio_generator;
pub mod jxa;
pub mod scanner;
pub mod matcher;
pub mod artwork;
pub mod smart_criteria;

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
    emit_progress(app, "jxa_tracks", "Reading your Music library — this may take a few minutes...", 0, 1);
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

        // Preserve artwork_hash from previous import so we don't lose it
        let mut artwork_by_pid: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut artwork_by_path: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT persistent_id, file_path, artwork_hash FROM tracks WHERE artwork_hash IS NOT NULL")
                .map_err(|e| format!("Artwork preserve query failed: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    let pid: Option<String> = row.get(0)?;
                    let fp: Option<String> = row.get(1)?;
                    let hash: String = row.get(2)?;
                    Ok((pid, fp, hash))
                })
                .map_err(|e| format!("Artwork preserve failed: {}", e))?;
            for row in rows {
                if let Ok((pid, fp, hash)) = row {
                    if let Some(pid) = pid {
                        artwork_by_pid.insert(pid, hash.clone());
                    }
                    if let Some(fp) = fp {
                        artwork_by_path.insert(fp, hash);
                    }
                }
            }
        }
        log::info!("Preserved {} artwork hashes ({} by pid, {} by path)",
            artwork_by_pid.len() + artwork_by_path.len(),
            artwork_by_pid.len(),
            artwork_by_path.len(),
        );

        // Preserve AI tags from previous import
        #[derive(Clone)]
        struct AiTags {
            mood: Option<String>,
            energy: Option<i32>,
            vibe_tags: Option<String>,
            bpm: Option<i32>,
            danceability: Option<i32>,
            acousticness: Option<i32>,
            ai_tagged_at: Option<String>,
        }
        let mut ai_tags_by_pid: std::collections::HashMap<String, AiTags> =
            std::collections::HashMap::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT persistent_id, mood, energy, vibe_tags, bpm, danceability, acousticness, ai_tagged_at \
                     FROM tracks WHERE ai_tagged_at IS NOT NULL AND persistent_id IS NOT NULL"
                )
                .map_err(|e| format!("AI tags preserve query failed: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        AiTags {
                            mood: row.get(1)?,
                            energy: row.get(2)?,
                            vibe_tags: row.get(3)?,
                            bpm: row.get(4)?,
                            danceability: row.get(5)?,
                            acousticness: row.get(6)?,
                            ai_tagged_at: row.get(7)?,
                        },
                    ))
                })
                .map_err(|e| format!("AI tags preserve failed: {}", e))?;
            for row in rows {
                if let Ok((pid, tags)) = row {
                    ai_tags_by_pid.insert(pid, tags);
                }
            }
        }
        log::info!("Preserved {} AI tag records", ai_tags_by_pid.len());

        db::clear_tracks(&conn).map_err(|e| format!("Clear failed: {}", e))?;
        db::batch_insert_tracks(&mut conn, &merged).map_err(|e| format!("Insert failed: {}", e))?;

        // Restore artwork_hash for tracks that match previous data
        let restored = {
            let tx = conn.transaction().map_err(|e| format!("Tx failed: {}", e))?;
            let mut count = 0u64;
            {
                let mut stmt = tx
                    .prepare("UPDATE tracks SET artwork_hash = ?1 WHERE persistent_id = ?2 AND artwork_hash IS NULL")
                    .map_err(|e| e.to_string())?;
                for (pid, hash) in &artwork_by_pid {
                    count += stmt.execute(rusqlite::params![hash, pid]).unwrap_or(0) as u64;
                }
            }
            {
                let mut stmt = tx
                    .prepare("UPDATE tracks SET artwork_hash = ?1 WHERE file_path = ?2 AND artwork_hash IS NULL")
                    .map_err(|e| e.to_string())?;
                for (fp, hash) in &artwork_by_path {
                    count += stmt.execute(rusqlite::params![hash, fp]).unwrap_or(0) as u64;
                }
            }
            tx.commit().map_err(|e| format!("Commit failed: {}", e))?;
            count
        };
        log::info!("Restored {} artwork hashes from previous import", restored);

        // Restore AI tags
        let ai_restored = {
            let tx = conn.transaction().map_err(|e| format!("Tx failed: {}", e))?;
            let mut count = 0u64;
            {
                let mut stmt = tx
                    .prepare(
                        "UPDATE tracks SET mood=?1, energy=?2, vibe_tags=?3, bpm=?4, \
                         danceability=?5, acousticness=?6, ai_tagged_at=?7 \
                         WHERE persistent_id=?8 AND ai_tagged_at IS NULL"
                    )
                    .map_err(|e| e.to_string())?;
                for (pid, tags) in &ai_tags_by_pid {
                    count += stmt.execute(rusqlite::params![
                        tags.mood, tags.energy, tags.vibe_tags, tags.bpm,
                        tags.danceability, tags.acousticness, tags.ai_tagged_at, pid
                    ]).unwrap_or(0) as u64;
                }
            }
            tx.commit().map_err(|e| format!("Commit failed: {}", e))?;
            count
        };
        log::info!("Restored {} AI tag records from previous import", ai_restored);

        // Auto-restore AI tags from backup file (created during reset_library)
        if let Ok(app_dir) = app.path().app_data_dir() {
            let backup_path = app_dir.join("ai_tags_backup.json");
            if backup_path.exists() {
                match std::fs::read_to_string(&backup_path) {
                    Ok(data) => {
                        match serde_json::from_str::<Vec<ai_tag_backup::AiTagRecord>>(&data) {
                            Ok(tags) => {
                                match ai_tag_backup::import_ai_tags_from_file(&conn, &tags) {
                                    Ok(count) => {
                                        log::info!("Restored {} AI tags from backup file", count);
                                    }
                                    Err(e) => log::warn!("Failed to restore AI tags from backup: {}", e),
                                }
                            }
                            Err(e) => log::warn!("Failed to parse AI tags backup: {}", e),
                        }
                        let _ = std::fs::remove_file(&backup_path);
                    }
                    Err(e) => log::warn!("Failed to read AI tags backup file: {}", e),
                }
            }
        }

        db::rebuild_fts(&conn).map_err(|e| format!("FTS rebuild failed: {}", e))?;
    }
    emit_progress(app, "db_insert", "Database import complete", 1, 1);

    // Phase 5: Playlist extraction
    emit_progress(app, "playlists", "Extracting playlists...", 0, 1);

    // Extract smart playlist rules from Library.xml (best-effort)
    let smart_rules = smart_criteria::extract_smart_rules().unwrap_or_default();
    if !smart_rules.is_empty() {
        log::info!("Loaded smart rules for {} playlists from Library.xml", smart_rules.len());
    }

    match jxa::extract_playlists(&scripts_dir) {
        Ok(playlists) => {
            let playlist_count = playlists.len() as u64;
            let db_state = app.state::<Database>();
            let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;

            // Two-pass insertion: folders first, then regular playlists
            // This ensures parent_id references are valid when inserting children
            let mut pid_to_db_id: std::collections::HashMap<String, i64> =
                std::collections::HashMap::new();

            // Pass 1: Insert all folders (may be nested, so iterate until all resolved)
            let folders: Vec<_> = playlists.iter()
                .enumerate()
                .filter(|(_, p)| p.is_folder)
                .collect();

            let mut remaining_folders: Vec<(usize, &crate::models::JxaPlaylist)> = folders;
            let mut last_remaining = remaining_folders.len() + 1;

            while !remaining_folders.is_empty() && remaining_folders.len() < last_remaining {
                last_remaining = remaining_folders.len();
                let mut still_remaining = Vec::new();

                for (orig_idx, folder) in &remaining_folders {
                    let parent_db_id = match &folder.parent_persistent_id {
                        Some(ppid) => {
                            if let Some(&db_id) = pid_to_db_id.get(ppid) {
                                Some(db_id)
                            } else {
                                // Parent folder not yet inserted, defer
                                still_remaining.push((*orig_idx, *folder));
                                continue;
                            }
                        }
                        None => None,
                    };

                    let db_id = db::insert_playlist(
                        &conn,
                        &folder.persistent_id,
                        &folder.name,
                        false,
                        true,
                        parent_db_id,
                        *orig_idx as i32,
                        0,
                        None,
                    )
                    .map_err(|e| format!("Folder insert failed: {}", e))?;

                    pid_to_db_id.insert(folder.persistent_id.clone(), db_id);
                }

                remaining_folders = still_remaining;
            }

            // Pass 2: Insert regular playlists
            let mut smart_imported = 0u64;
            for (idx, playlist) in playlists.iter().enumerate() {
                if playlist.is_folder {
                    continue;
                }

                let parent_db_id = playlist.parent_persistent_id.as_ref()
                    .and_then(|ppid| pid_to_db_id.get(ppid).copied());

                // Look up smart playlist rules from Library.xml
                let rules_json = if playlist.is_smart {
                    smart_rules.get(&playlist.persistent_id).map(|s| s.as_str())
                } else {
                    None
                };
                if rules_json.is_some() {
                    smart_imported += 1;
                }

                let track_count = playlist.track_persistent_ids.len() as i32;
                let pl_id = db::insert_playlist(
                    &conn,
                    &playlist.persistent_id,
                    &playlist.name,
                    playlist.is_smart,
                    false,
                    parent_db_id,
                    idx as i32,
                    track_count,
                    rules_json,
                )
                .map_err(|e| format!("Playlist insert failed: {}", e))?;

                pid_to_db_id.insert(playlist.persistent_id.clone(), pl_id);

                // For smart playlists with rules, skip static track insertion
                // (tracks will be dynamically evaluated from rules)
                if rules_json.is_some() {
                    continue;
                }

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
            log::info!("Imported {} playlists ({} folders, {} with smart rules)", playlist_count,
                playlists.iter().filter(|p| p.is_folder).count(), smart_imported);
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

    // Phase 7: Auto-tag with AI if preference is enabled
    {
        let db_state = app.state::<Database>();
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let auto_tag = crate::db::get_preference(&conn, "ai_auto_tag")
            .ok()
            .flatten()
            .as_deref() == Some("true");
        drop(conn);

        if auto_tag {
            log::info!("Auto-tagging enabled, spawning AI tagger");
            let app_handle = app.clone();
            let progress = ai_tagger::AiTagProgress::new();
            let progress_clone = progress.clone();
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(async {
                    ai_tagger::run_tagging(app_handle, progress_clone).await;
                });
            });
        }
    }

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
