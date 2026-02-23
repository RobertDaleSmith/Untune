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
