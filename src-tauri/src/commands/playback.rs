use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::{self, Database};
use crate::playback::{PlaybackState, RepeatMode};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    pub is_playing: bool,
    pub track_id: Option<i64>,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat_mode: String,
}

fn lookup_and_play(
    track_id: i64,
    db: &Database,
    playback: &PlaybackState,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let info = db::get_track_file_info(&conn, track_id)
        .map_err(|e| format!("Track not found: {}", e))?;
    drop(conn);
    match info {
        Some((path, duration)) => playback.play(&path, track_id, duration),
        None => Err(format!("Track {} has no file path", track_id)),
    }
}

#[tauri::command]
pub fn play_track(
    track_id: i64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    lookup_and_play(track_id, &db, &playback)
}

#[tauri::command]
pub fn play_queue(
    track_ids: Vec<i64>,
    start_index: usize,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    if track_ids.is_empty() {
        return Err("Empty queue".to_string());
    }
    let idx = start_index.min(track_ids.len() - 1);
    let track_id = track_ids[idx];

    lookup_and_play(track_id, &db, &playback)?;
    playback.set_queue(track_ids, idx)
}

#[tauri::command]
pub fn pause_playback(playback: State<'_, PlaybackState>) -> Result<(), String> {
    playback.pause()
}

#[tauri::command]
pub fn resume_playback(playback: State<'_, PlaybackState>) -> Result<(), String> {
    playback.resume()
}

#[tauri::command]
pub fn stop_playback(playback: State<'_, PlaybackState>) -> Result<(), String> {
    playback.stop()
}

#[tauri::command]
pub fn seek_playback(
    position_secs: f64,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.seek(position_secs)
}

#[tauri::command]
pub fn next_track(
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<Option<i64>, String> {
    let is_shuffle = playback.shuffle();
    loop {
        match playback.next_index() {
            Some((track_id, idx)) => {
                if is_shuffle {
                    playback.push_shuffle_history()?;
                }
                playback.update_queue_index(idx)?;
                match lookup_and_play(track_id, &db, &playback) {
                    Ok(()) => return Ok(Some(track_id)),
                    Err(_) => continue,
                }
            }
            None => return Ok(None),
        }
    }
}

#[tauri::command]
pub fn previous_track(
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<Option<i64>, String> {
    let is_shuffle = playback.shuffle();
    if is_shuffle {
        // In shuffle mode, go back through play history
        loop {
            match playback.pop_shuffle_history() {
                Some((track_id, idx)) => {
                    playback.update_queue_index(idx)?;
                    match lookup_and_play(track_id, &db, &playback) {
                        Ok(()) => return Ok(Some(track_id)),
                        Err(_) => continue,
                    }
                }
                None => return Ok(None),
            }
        }
    } else {
        loop {
            match playback.prev_index() {
                Some((track_id, idx)) => {
                    playback.update_queue_index(idx)?;
                    match lookup_and_play(track_id, &db, &playback) {
                        Ok(()) => return Ok(Some(track_id)),
                        Err(_) => continue,
                    }
                }
                None => return Ok(None),
            }
        }
    }
}

#[tauri::command]
pub fn get_playback_info(playback: State<'_, PlaybackState>) -> PlaybackInfo {
    let repeat_str = match playback.repeat_mode() {
        RepeatMode::Off => "off",
        RepeatMode::All => "all",
        RepeatMode::One => "one",
    };
    PlaybackInfo {
        is_playing: playback.is_playing(),
        track_id: playback.current_track_id(),
        position: playback.position(),
        duration: playback.duration(),
        volume: playback.volume(),
        shuffle: playback.shuffle(),
        repeat_mode: repeat_str.to_string(),
    }
}

#[tauri::command]
pub fn set_volume(level: f32, playback: State<'_, PlaybackState>) -> Result<(), String> {
    playback.set_volume(level)
}

#[tauri::command]
pub fn set_shuffle(enabled: bool, playback: State<'_, PlaybackState>) -> Result<(), String> {
    playback.set_shuffle(enabled)
}

#[tauri::command]
pub fn set_repeat_mode(mode: String, playback: State<'_, PlaybackState>) -> Result<(), String> {
    let repeat = match mode.as_str() {
        "all" => RepeatMode::All,
        "one" => RepeatMode::One,
        _ => RepeatMode::Off,
    };
    playback.set_repeat_mode(repeat)
}

#[tauri::command]
pub fn toggle_shuffle(playback: State<'_, PlaybackState>) -> Result<bool, String> {
    let current = playback.shuffle();
    let new_val = !current;
    playback.set_shuffle(new_val)?;
    Ok(new_val)
}

#[tauri::command]
pub fn cycle_repeat(playback: State<'_, PlaybackState>) -> Result<String, String> {
    let current = playback.repeat_mode();
    let next = match current {
        RepeatMode::Off => RepeatMode::All,
        RepeatMode::All => RepeatMode::One,
        RepeatMode::One => RepeatMode::Off,
    };
    playback.set_repeat_mode(next)?;
    let s = match next {
        RepeatMode::Off => "off",
        RepeatMode::All => "all",
        RepeatMode::One => "one",
    };
    Ok(s.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewSettings {
    pub shuffle: bool,
    pub repeat_mode: String,
}

#[tauri::command]
pub fn get_view_settings(
    view_key: String,
    db: State<'_, Database>,
) -> Result<Option<ViewSettings>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let result = db::get_view_settings(&conn, &view_key).map_err(|e| e.to_string())?;
    Ok(result.map(|(shuffle, repeat_mode)| ViewSettings {
        shuffle,
        repeat_mode,
    }))
}

#[tauri::command]
pub fn save_view_settings(
    view_key: String,
    shuffle: bool,
    repeat_mode: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    db::save_view_settings(&conn, &view_key, shuffle, &repeat_mode).map_err(|e| e.to_string())
}
