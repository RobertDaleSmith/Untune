use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

use crate::db::Database;
use crate::import::ai_tagger::{self, AiTagProgress};

pub use crate::import::ai_tag_backup::{export_ai_tags_to_file, import_ai_tags_from_file};

pub struct AiTaggingState {
    pub progress: AiTagProgress,
}

impl AiTaggingState {
    pub fn new() -> Self {
        Self {
            progress: AiTagProgress::new(),
        }
    }
}

#[tauri::command]
pub async fn start_ai_tagging(app: AppHandle, state: State<'_, AiTaggingState>) -> Result<(), String> {
    // Reset state
    state.progress.cancel.store(false, Ordering::Relaxed);
    state.progress.tagged.store(0, Ordering::Relaxed);
    state.progress.total.store(0, Ordering::Relaxed);

    let progress = state.progress.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        ai_tagger::run_tagging(app_clone, progress).await;
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_ai_tagging(state: State<'_, AiTaggingState>) -> Result<(), String> {
    state.progress.cancel.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn get_ai_tag_progress(state: State<'_, AiTaggingState>) -> Result<serde_json::Value, String> {
    let tagged = state.progress.tagged.load(Ordering::Relaxed);
    let total = state.progress.total.load(Ordering::Relaxed);
    Ok(serde_json::json!({ "tagged": tagged, "total": total }))
}

#[tauri::command]
pub async fn retag_tracks(app: AppHandle, track_ids: Vec<i64>) -> Result<(), String> {
    // Clear ai_tagged_at for specified tracks so they'll be re-tagged
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    for id in &track_ids {
        conn.execute(
            "UPDATE tracks SET ai_tagged_at = NULL WHERE id = ?",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    drop(conn);

    // Start tagging
    let state = app.state::<AiTaggingState>();
    state.progress.cancel.store(false, Ordering::Relaxed);
    state.progress.tagged.store(0, Ordering::Relaxed);
    state.progress.total.store(0, Ordering::Relaxed);

    let progress = state.progress.clone();
    let app_clone = app.clone();

    tauri::async_runtime::spawn(async move {
        ai_tagger::run_tagging(app_clone, progress).await;
    });

    Ok(())
}

#[tauri::command]
pub fn export_ai_tags(app: AppHandle, output_path: String) -> Result<u64, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tags = export_ai_tags_to_file(&conn).map_err(|e| e.to_string())?;
    let count = tags.len() as u64;
    let json = serde_json::to_string_pretty(&tags).map_err(|e| e.to_string())?;
    std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
    log::info!("Exported {} AI tags to {}", count, output_path);
    Ok(count)
}

#[tauri::command]
pub fn import_ai_tags(app: AppHandle, file_path: String) -> Result<u64, String> {
    let data = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let tags: Vec<crate::import::ai_tag_backup::AiTagRecord> =
        serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let count = import_ai_tags_from_file(&conn, &tags).map_err(|e| e.to_string())?;
    log::info!("Restored {} AI tags from {}", count, file_path);
    Ok(count)
}
