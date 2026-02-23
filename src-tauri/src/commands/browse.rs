use tauri::State;

use crate::db::{self, Database};
use crate::models::browse::{AlbumSummary, ArtistSummary, GenreSummary};
use crate::models::Track;

#[tauri::command]
pub fn get_albums(db: State<'_, Database>) -> Result<Vec<AlbumSummary>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_albums(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_artists(db: State<'_, Database>) -> Result<Vec<ArtistSummary>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_artists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_genres(db: State<'_, Database>) -> Result<Vec<GenreSummary>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_genres(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_album_tracks(
    album: String,
    artist: String,
    db: State<'_, Database>,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_album_tracks(&conn, &album, &artist).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_artist_tracks(
    artist: String,
    db: State<'_, Database>,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_artist_tracks(&conn, &artist).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_genre_tracks(
    genre: String,
    db: State<'_, Database>,
) -> Result<Vec<Track>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::get_genre_tracks(&conn, &genre).map_err(|e| e.to_string())
}
