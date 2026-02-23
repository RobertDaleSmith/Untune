use tauri::AppHandle;

use crate::models::ImportStats;

#[tauri::command]
pub fn import_library(app: AppHandle) -> Result<ImportStats, String> {
    // Synchronous command — Tauri runs this on its managed threadpool
    crate::import::run_import(&app)
}
