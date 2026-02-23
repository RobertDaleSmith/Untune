use serde::Deserialize;
use tauri::State;

use crate::db::{self, Database};
use crate::models::Track;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackQuery {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub sort_column: Option<String>,
    pub sort_dir: Option<String>,
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
