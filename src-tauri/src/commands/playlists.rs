use tauri::State;

use crate::db::{self, Database};
use crate::models::{Playlist, Track};

#[tauri::command]
pub fn get_playlists(db: State<'_, Database>) -> Result<Vec<Playlist>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_playlist_tracks(
    db: State<'_, Database>,
    playlist_id: i64,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_playlist_tracks(&conn, playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_smart_playlist(
    db: State<'_, Database>,
    name: String,
    rules_json: String,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::insert_smart_playlist(&conn, &name, &rules_json, parent_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_smart_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    name: Option<String>,
    rules_json: Option<String>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::update_smart_playlist(
        &conn,
        playlist_id,
        name.as_deref(),
        rules_json.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_playlist(db: State<'_, Database>, playlist_id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::delete_playlist(&conn, playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_playlist(
    db: State<'_, Database>,
    name: String,
    parent_id: Option<i64>,
    track_ids: Option<Vec<i64>>,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let id = db::insert_regular_playlist(&conn, &name, parent_id).map_err(|e| e.to_string())?;
    if let Some(ids) = track_ids {
        if !ids.is_empty() {
            db::add_tracks_to_playlist(&conn, id, &ids).map_err(|e| e.to_string())?;
        }
    }
    Ok(id)
}

#[tauri::command]
pub fn create_playlist_folder(
    db: State<'_, Database>,
    name: String,
    parent_id: Option<i64>,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::insert_playlist_folder(&conn, &name, parent_id).map_err(|e| e.to_string())
}
