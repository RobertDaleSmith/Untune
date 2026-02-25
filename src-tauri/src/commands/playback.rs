use std::time::Duration;

use serde::{Deserialize, Serialize};
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use tauri::{AppHandle, State};

use crate::analyzer::FrequencyData;
use crate::db::{self, Database};
use crate::media::MediaControlsState;
use crate::playback::{PlaybackState, RepeatMode};
use crate::PlaybackMenuItems;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackInfo {
    pub is_playing: bool,
    pub is_paused: bool,
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
    loop {
        match playback.advance_next() {
            Some((track_id, _idx)) => {
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
    loop {
        match playback.advance_prev() {
            Some((track_id, _idx)) => {
                match lookup_and_play(track_id, &db, &playback) {
                    Ok(()) => return Ok(Some(track_id)),
                    Err(_) => continue,
                }
            }
            None => return Ok(None),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingTracks {
    pub prev_track_ids: Vec<i64>,
    pub next_track_ids: Vec<i64>,
}

#[tauri::command]
pub fn get_upcoming_tracks(
    count: usize,
    playback: State<'_, PlaybackState>,
) -> UpcomingTracks {
    let (prev, next) = playback.peek_upcoming(count.min(20));
    UpcomingTracks {
        prev_track_ids: prev,
        next_track_ids: next,
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
        is_paused: playback.is_paused(),
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
pub fn set_shuffle(
    enabled: bool,
    playback: State<'_, PlaybackState>,
    menu_items: State<'_, PlaybackMenuItems>,
) -> Result<(), String> {
    playback.set_shuffle(enabled)?;
    let _ = menu_items.shuffle.set_checked(enabled);
    Ok(())
}

#[tauri::command]
pub fn set_repeat_mode(
    mode: String,
    playback: State<'_, PlaybackState>,
    menu_items: State<'_, PlaybackMenuItems>,
) -> Result<(), String> {
    let repeat = match mode.as_str() {
        "all" => RepeatMode::All,
        "one" => RepeatMode::One,
        _ => RepeatMode::Off,
    };
    playback.set_repeat_mode(repeat)?;
    let _ = menu_items.repeat_off.set_checked(repeat == RepeatMode::Off);
    let _ = menu_items.repeat_all.set_checked(repeat == RepeatMode::All);
    let _ = menu_items.repeat_one.set_checked(repeat == RepeatMode::One);
    Ok(())
}

#[tauri::command]
pub fn toggle_shuffle(
    playback: State<'_, PlaybackState>,
    menu_items: State<'_, PlaybackMenuItems>,
) -> Result<bool, String> {
    let current = playback.shuffle();
    let new_val = !current;
    playback.set_shuffle(new_val)?;
    let _ = menu_items.shuffle.set_checked(new_val);
    Ok(new_val)
}

#[tauri::command]
pub fn cycle_repeat(
    playback: State<'_, PlaybackState>,
    menu_items: State<'_, PlaybackMenuItems>,
) -> Result<String, String> {
    let current = playback.repeat_mode();
    let next = match current {
        RepeatMode::Off => RepeatMode::All,
        RepeatMode::All => RepeatMode::One,
        RepeatMode::One => RepeatMode::Off,
    };
    playback.set_repeat_mode(next)?;
    let _ = menu_items.repeat_off.set_checked(next == RepeatMode::Off);
    let _ = menu_items.repeat_all.set_checked(next == RepeatMode::All);
    let _ = menu_items.repeat_one.set_checked(next == RepeatMode::One);
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

#[tauri::command]
pub fn update_now_playing(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    position: Option<f64>,
    is_playing: bool,
    artwork_hash: Option<String>,
    app: AppHandle,
    media_controls: State<'_, MediaControlsState>,
) -> Result<(), String> {
    let mut guard = media_controls.0.lock().map_err(|e| e.to_string())?;
    if let Some(controls) = guard.as_mut() {
        let dur = duration.map(|d| Duration::from_secs_f64(d));

        // Resolve artwork hash to a file:// URL for the system Now Playing widget.
        // The path must be percent-encoded (spaces → %20) because souvlaki uses
        // NSURL URLWithString: which requires a valid URL (unlike fileURLWithPath:).
        let cover_url = artwork_hash.and_then(|hash| {
            let artwork_dir = Database::artwork_dir(&app).ok()?;
            for ext in &["jpg", "png"] {
                let path = artwork_dir.join(format!("{}.{}", hash, ext));
                if path.exists() {
                    let encoded = path.to_string_lossy()
                        .replace('%', "%25")
                        .replace(' ', "%20")
                        .replace('#', "%23");
                    return Some(format!("file://{}", encoded));
                }
            }
            None
        });

        // souvlaki's ns_image_from_url crashes with a non-unwinding panic if
        // NSImage initWithContentsOfURL: returns nil (e.g. bad URL encoding,
        // missing file). Validate the artwork URL is loadable before passing it.
        let safe_cover_url = cover_url.filter(|url| {
            // Quick sanity: must be a file:// URL pointing to an existing file
            if let Some(path) = url.strip_prefix("file://") {
                let decoded = path
                    .replace("%20", " ")
                    .replace("%23", "#")
                    .replace("%25", "%");
                std::path::Path::new(&decoded).exists()
            } else {
                false
            }
        });

        controls
            .set_metadata(MediaMetadata {
                title: Some(&title),
                artist: artist.as_deref(),
                album: album.as_deref(),
                duration: dur,
                cover_url: safe_cover_url.as_deref(),
            })
            .map_err(|e| format!("{:?}", e))?;

        let playback = if is_playing {
            MediaPlayback::Playing {
                progress: position.map(|p| MediaPosition(Duration::from_secs_f64(p))),
            }
        } else {
            MediaPlayback::Paused {
                progress: position.map(|p| MediaPosition(Duration::from_secs_f64(p))),
            }
        };
        controls
            .set_playback(playback)
            .map_err(|e| format!("{:?}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_now_playing(
    media_controls: State<'_, MediaControlsState>,
) -> Result<(), String> {
    let mut guard = media_controls.0.lock().map_err(|e| e.to_string())?;
    if let Some(controls) = guard.as_mut() {
        controls
            .set_playback(MediaPlayback::Stopped)
            .map_err(|e| format!("{:?}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_frequency_data(playback: State<'_, PlaybackState>) -> FrequencyData {
    match playback.frequency_data() {
        Some(shared) => {
            shared.lock().unwrap_or_else(|e| e.into_inner()).clone()
        }
        None => FrequencyData::default(),
    }
}
