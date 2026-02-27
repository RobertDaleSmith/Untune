use serde::Deserialize;
use std::io::{BufRead, Write};
use std::path::Path;
use tauri::State;

use crate::db::{self, Database};
use crate::models::{Playlist, Track};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistOrderUpdate {
    pub id: i64,
    pub sort_order: i32,
    pub parent_id: Option<i64>,
}

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
pub fn rename_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    new_name: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::rename_playlist(&conn, playlist_id, &new_name).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn add_tracks_to_playlist(
    db: State<'_, Database>,
    playlist_id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::add_tracks_to_playlist(&conn, playlist_id, &track_ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_playlists(
    db: State<'_, Database>,
    updates: Vec<PlaylistOrderUpdate>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tuples: Vec<(i64, i32, Option<i64>)> = updates
        .iter()
        .map(|u| (u.id, u.sort_order, u.parent_id))
        .collect();
    db::reorder_playlists(&conn, &tuples).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_playlist_m3u(
    playlist_id: i64,
    output_path: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tracks = db::get_playlist_tracks(&conn, playlist_id).map_err(|e| e.to_string())?;

    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);

    writeln!(writer, "#EXTM3U").map_err(|e| e.to_string())?;
    for track in &tracks {
        let duration = track.duration.unwrap_or(0.0) as i64;
        let artist = track.artist.as_deref().unwrap_or("Unknown Artist");
        let title = &track.title;
        writeln!(writer, "#EXTINF:{},{} - {}", duration, artist, title).map_err(|e| e.to_string())?;
        if let Some(ref path) = track.file_path {
            writeln!(writer, "{}", path).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn import_playlist_m3u(
    file_path: String,
    db: State<'_, Database>,
) -> Result<i64, String> {
    let path = Path::new(&file_path);
    let m3u_dir = path.parent();

    // Derive playlist name from file stem
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported Playlist")
        .to_string();

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);

    let mut file_paths: Vec<String> = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // Resolve relative paths against M3U directory
        let resolved = if Path::new(trimmed).is_absolute() {
            trimmed.to_string()
        } else if let Some(dir) = m3u_dir {
            dir.join(trimmed).to_string_lossy().to_string()
        } else {
            trimmed.to_string()
        };
        file_paths.push(resolved);
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Match file paths to tracks in the DB
    let mut matched_track_ids: Vec<i64> = Vec::new();
    for fp in &file_paths {
        let result: Result<i64, _> = conn.query_row(
            "SELECT id FROM tracks WHERE file_path = ?1",
            rusqlite::params![fp],
            |row| row.get(0),
        );
        if let Ok(id) = result {
            matched_track_ids.push(id);
        }
    }

    // Create the playlist
    let playlist_id = db::insert_regular_playlist(&conn, &name, None)
        .map_err(|e| e.to_string())?;
    if !matched_track_ids.is_empty() {
        db::add_tracks_to_playlist(&conn, playlist_id, &matched_track_ids)
            .map_err(|e| e.to_string())?;
    }

    Ok(playlist_id)
}
