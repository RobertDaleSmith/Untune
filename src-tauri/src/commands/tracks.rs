use serde::Deserialize;
use std::path::Path;
use tauri::State;

use crate::db::{self, Database};
use crate::models::Track;

#[tauri::command]
pub fn export_library(db: State<'_, Database>, output_path: String) -> Result<u64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tracks = db::get_tracks(&conn, 0, 1_000_000, "id", "asc").map_err(|e| e.to_string())?;
    let count = tracks.len() as u64;
    let json = serde_json::to_string_pretty(&tracks).map_err(|e| e.to_string())?;
    std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
    log::info!("Exported {} tracks to {}", count, output_path);
    Ok(count)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub sort_column: Option<String>,
    pub sort_dir: Option<String>,
}

#[tauri::command]
pub fn get_track_by_id(db: State<'_, Database>, track_id: i64) -> Result<Option<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_track_by_id(&conn, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tracks(db: State<'_, Database>, query: TrackQuery) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_tracks(
        &conn,
        query.offset.unwrap_or(0),
        query.limit.unwrap_or(100000),
        &query.sort_column.unwrap_or_else(|| "id".to_string()),
        &query.sort_dir.unwrap_or_else(|| "asc".to_string()),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_track_count(db: State<'_, Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_track_count(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_tracks(
    db: State<'_, Database>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::search_tracks(&conn, &query, limit.unwrap_or(200)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_smart_view_tracks(
    db: State<'_, Database>,
    view_name: String,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    match view_name.as_str() {
        "recently-added" => db::get_recently_added(&conn, 200).map_err(|e| e.to_string()),
        "recently-played" => db::get_recently_played(&conn, 200).map_err(|e| e.to_string()),
        "top-played" => db::get_top_played(&conn, 200).map_err(|e| e.to_string()),
        _ => Err(format!("Unknown smart view: {}", view_name)),
    }
}

#[tauri::command]
pub fn set_track_rating(
    db: State<'_, Database>,
    track_id: i64,
    rating: Option<i32>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::update_track_rating(&conn, track_id, rating).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_track_source_url(
    db: State<'_, Database>,
    track_id: i64,
    source_url: Option<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::update_track_source_url(&conn, track_id, source_url.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
