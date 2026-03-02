use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

use crate::commands::ai_tags::AiTaggingState;
use crate::db::Database;
use crate::models::ImportStats;

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
