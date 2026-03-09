use crate::db::{self, Database};
use crate::handoff::{self, HandoffState};
use crate::playback::{PlaybackState, RepeatMode};
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct HandoffConfig {
    pub url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HandoffTrackInfo {
    pub state: HandoffState,
    #[serde(rename = "trackId")]
    pub track_id: Option<i64>,
    pub title: Option<String>,
    pub artist: Option<String>,
    #[serde(rename = "artworkHash")]
    pub artwork_hash: Option<String>,
    /// The deviceName from the remote handoff state
    #[serde(rename = "deviceName")]
    pub device_name: Option<String>,
    /// This device's hostname, so frontend can compare
    #[serde(rename = "localDeviceName")]
    pub local_device_name: Option<String>,
}

#[tauri::command]
pub fn generate_handoff_token() -> String {
    handoff::generate_token()
}

#[tauri::command]
pub fn configure_handoff(
    db_state: State<'_, Database>,
    url: String,
    token: String,
) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::set_preference(&conn, "handoff.url", &url).map_err(|e| e.to_string())?;
    db::set_preference(&conn, "handoff.token", &token).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_handoff_config(db_state: State<'_, Database>) -> Result<Option<HandoffConfig>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let url = db::get_preference(&conn, "handoff.url")
        .map_err(|e| e.to_string())?;
    let token = db::get_preference(&conn, "handoff.token")
        .map_err(|e| e.to_string())?;
    match (url, token) {
        (Some(u), Some(t)) if !u.is_empty() && !t.is_empty() => {
            Ok(Some(HandoffConfig { url: u, token: t }))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn push_handoff_state(
    db_state: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    // Read config and current track from DB
    let (url, token, persistent_id, position, queue_source, shuffle, repeat_mode) = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

        let url = db::get_preference(&conn, "handoff.url")
            .map_err(|e| e.to_string())?
            .ok_or("Handoff not configured")?;
        let token = db::get_preference(&conn, "handoff.token")
            .map_err(|e| e.to_string())?
            .ok_or("Handoff not configured")?;

        let track_id = playback.current_track_id().ok_or("No track playing")?;
        let position = playback.position();
        let shuffle = playback.shuffle();
        let repeat_mode = match playback.repeat_mode() {
            RepeatMode::Off => "off".to_string(),
            RepeatMode::All => "all".to_string(),
            RepeatMode::One => "one".to_string(),
        };

        let persistent_id = db::get_track_persistent_id(&conn, track_id)
            .map_err(|e| e.to_string())?
            .ok_or("Track has no persistent_id")?;

        // Read queue source from preferences (frontend saves it)
        let queue_source = db::get_preference(&conn, "session.queueSource")
            .map_err(|e| e.to_string())?;

        // Translate local playlist IDs to persistent IDs in queue source
        let resolved_source = if let Some(ref qs) = queue_source {
            resolve_queue_source_to_persistent(&conn, qs)
        } else {
            None
        };

        (
            url,
            token,
            persistent_id,
            position,
            resolved_source.or(queue_source),
            shuffle,
            repeat_mode,
        )
    };

    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Untune Desktop".to_string());

    let state = HandoffState {
        track_persistent_id: persistent_id,
        position,
        queue_source,
        shuffle,
        repeat_mode,
        updated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64,
        device_name,
    };

    handoff::push_state(&url, &token, &state).await
}

#[tauri::command]
pub async fn pull_handoff_state(
    db_state: State<'_, Database>,
) -> Result<Option<HandoffTrackInfo>, String> {
    let (url, token) = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        let url = db::get_preference(&conn, "handoff.url")
            .map_err(|e| e.to_string())?;
        let token = db::get_preference(&conn, "handoff.token")
            .map_err(|e| e.to_string())?;
        match (url, token) {
            (Some(u), Some(t)) if !u.is_empty() && !t.is_empty() => (u, t),
            _ => return Ok(None),
        }
    };

    let state = match handoff::pull_state(&url, &token).await? {
        Some(s) => s,
        None => return Ok(None),
    };

    // Resolve persistent_id to local track info
    let (track_id, title, artist, artwork_hash) = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        match db::get_track_by_persistent_id(&conn, &state.track_persistent_id)
            .map_err(|e| e.to_string())?
        {
            Some(track) => (
                Some(track.id),
                Some(track.title),
                track.artist,
                track.artwork_hash,
            ),
            None => (None, None, None, None),
        }
    };

    let local_device_name = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .ok();

    let device_name = Some(state.device_name.clone());

    Ok(Some(HandoffTrackInfo {
        state,
        track_id,
        title,
        artist,
        artwork_hash,
        device_name,
        local_device_name,
    }))
}

#[tauri::command]
pub fn dismiss_handoff(db_state: State<'_, Database>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    // Store the timestamp of the dismissed handoff so we don't show it again
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    db::set_preference(&conn, "handoff.dismissedAt", &now.to_string())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Translate "playlist:123" (local ID) → "playlist:PERSISTENT_ID"
fn resolve_queue_source_to_persistent(
    conn: &rusqlite::Connection,
    source: &str,
) -> Option<String> {
    if let Some(id_str) = source.strip_prefix("playlist:") {
        // May have ":name" suffix — split on first ":"
        let parts: Vec<&str> = id_str.splitn(2, ':').collect();
        if let Ok(id) = parts[0].parse::<i64>() {
            if let Ok(Some(pid)) = db::get_playlist_persistent_id(conn, id) {
                return Some(format!("playlist:{}", pid));
            }
        }
    }
    None
}
