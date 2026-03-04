use crate::db::{self, Database};
use crate::sync::SyncServer;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDeviceInfo {
    pub id: String,
    pub name: String,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub running: bool,
    pub pairing_code: Option<String>,
    pub devices: Vec<SyncDeviceInfo>,
    pub selected_playlists: Vec<i64>,
}

#[tauri::command]
pub fn start_sync_server(
    sync: State<Mutex<SyncServer>>,
    db: State<Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let db_path = conn.path().unwrap_or_default().to_string();
    drop(conn);

    // Get artwork directory
    let artwork_dir = if let Some(app_support) = dirs::data_dir() {
        app_support
            .join("com.untune.app")
            .join("artwork")
            .to_string_lossy()
            .to_string()
    } else {
        String::new()
    };

    let desktop_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Untune Desktop".to_string());

    let mut server = sync.lock().map_err(|e| e.to_string())?;
    server.start(db_path, artwork_dir, desktop_name);

    // Persist enabled state
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let _ = db::set_preference(&conn, "sync_server_enabled", "true");

    Ok(())
}

#[tauri::command]
pub fn stop_sync_server(
    sync: State<Mutex<SyncServer>>,
    db: State<Database>,
) -> Result<(), String> {
    let mut server = sync.lock().map_err(|e| e.to_string())?;
    server.stop();

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let _ = db::set_preference(&conn, "sync_server_enabled", "false");

    Ok(())
}

#[tauri::command]
pub fn generate_pairing_code(sync: State<Mutex<SyncServer>>) -> Result<String, String> {
    let server = sync.lock().map_err(|e| e.to_string())?;
    Ok(server.generate_pairing_code())
}

#[tauri::command]
pub fn get_sync_status(
    sync: State<Mutex<SyncServer>>,
    db: State<Database>,
) -> Result<SyncStatus, String> {
    let server = sync.lock().map_err(|e| e.to_string())?;
    let running = server
        .is_running
        .load(std::sync::atomic::Ordering::Relaxed);
    let pairing_code = server.pairing_code.lock().unwrap().clone();
    drop(server);

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get paired devices
    let mut stmt = conn
        .prepare("SELECT id, name, paired_at, last_sync_at FROM sync_devices ORDER BY paired_at DESC")
        .map_err(|e| e.to_string())?;
    let devices: Vec<SyncDeviceInfo> = stmt
        .query_map([], |row| {
            Ok(SyncDeviceInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                paired_at: row.get(2)?,
                last_sync_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Get selected playlists (for first device, simplified)
    let selected_playlists: Vec<i64> = if let Some(device) = devices.first() {
        let mut stmt = conn
            .prepare("SELECT playlist_id FROM sync_playlist_selections WHERE device_id = ?")
            .map_err(|e| e.to_string())?;
        let ids: Vec<i64> = stmt
            .query_map(rusqlite::params![device.id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        ids
    } else {
        vec![]
    };

    Ok(SyncStatus {
        running,
        pairing_code,
        devices,
        selected_playlists,
    })
}

#[tauri::command]
pub fn unpair_device(db: State<Database>, device_id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_track_state WHERE device_id = ?",
        rusqlite::params![&device_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_playlist_selections WHERE device_id = ?",
        rusqlite::params![&device_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_devices WHERE id = ?",
        rusqlite::params![&device_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_sync_playlists(
    db: State<Database>,
    device_id: String,
    playlist_ids: Vec<i64>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_playlist_selections WHERE device_id = ?",
        rusqlite::params![&device_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("INSERT INTO sync_playlist_selections (device_id, playlist_id) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;
    for pid in &playlist_ids {
        stmt.execute(rusqlite::params![&device_id, pid])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
