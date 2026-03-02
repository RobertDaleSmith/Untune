use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

use crate::commands::ai_tags::AiTaggingState;
use crate::db::Database;
use crate::models::ImportStats;

#[tauri::command]
pub fn import_library(app: AppHandle) -> Result<ImportStats, String> {
    // Synchronous command — Tauri runs this on its managed threadpool
    crate::import::run_import(&app)
}

#[tauri::command]
pub fn reset_library(
    app: AppHandle,
    ai_state: State<'_, AiTaggingState>,
) -> Result<(), String> {
    // Cancel any in-progress AI tagging
    ai_state.progress.cancel.store(true, Ordering::Relaxed);

    // Clear all data tables (preserves preferences)
    let db = app.state::<Database>();
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
