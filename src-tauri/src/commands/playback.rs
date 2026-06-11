use std::time::Duration;

use serde::{Deserialize, Serialize};
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use tauri::{AppHandle, State, Url};

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
    pub transitioned_to: Option<i64>,
    pub crossfade_into: Option<i64>,
    pub play_recorded_track_id: Option<i64>,
}

fn lookup_and_play(
    track_id: i64,
    db: &Database,
    playback: &PlaybackState,
    crossfade: bool,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let info = db::get_track_file_info(&conn, track_id)
        .map_err(|e| format!("Track not found: {}", e))?;
    drop(conn);
    match info {
        Some((path, duration)) => {
            if crossfade && playback.crossfade_duration() > 0.0 && playback.is_playing() {
                playback.play_with_crossfade(&path, track_id, duration)
            } else {
                playback.play(&path, track_id, duration)
            }
        }
        None => Err(format!("Track {} has no file path", track_id)),
    }
}

#[tauri::command]
pub fn play_track(
    track_id: i64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    lookup_and_play(track_id, &db, &playback, false)
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

    // Try playing forward from start_index one track at a time until we hit
    // one with a valid file_path. The previous implementation pre-filtered
    // the queue with a SQL `id IN (...)` clause that, for a 62k-row library,
    // built a 500KB SQL string and held the DB lock for 2-3s while SQLite
    // parsed and ran it. That lock blocked every parallel DB read — most
    // visibly the now-playing artwork fetch — and stalled the UI crossfade
    // for the full duration even though audio had already started.
    //
    // Per-track lookup is O(1) DB work per attempt; unplayable IDs deeper in
    // the queue get skipped at advance time, the same as any other track
    // whose file goes missing later.
    let queue_len = track_ids.len();
    let start = start_index.min(queue_len - 1);
    let max_tries = queue_len.min(50);
    for offset in 0..max_tries {
        let idx = (start + offset) % queue_len;
        let track_id = track_ids[idx];
        if lookup_and_play(track_id, &db, &playback, false).is_ok() {
            return playback.set_queue(track_ids, idx);
        }
    }
    Err("No playable tracks found".to_string())
}

#[tauri::command]
pub fn play_queue_at_position(
    track_ids: Vec<i64>,
    start_index: usize,
    position_secs: f64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    if track_ids.is_empty() {
        return Err("Empty queue".to_string());
    }
    let idx = start_index.min(track_ids.len() - 1);
    let track_id = track_ids[idx];

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let info = db::get_track_file_info(&conn, track_id)
        .map_err(|e| format!("Track not found: {}", e))?;
    drop(conn);
    match info {
        Some((path, duration)) => {
            playback.play_at(&path, track_id, duration, position_secs)?;
        }
        None => return Err(format!("Track {} has no file path", track_id)),
    }
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
    // Record skip if the current track hasn't been "played" yet
    if let Some((track_id, _pos, _dur, play_recorded)) = playback.current_play_state() {
        if !play_recorded {
            if let Ok(conn) = db.conn.lock() {
                let _ = db::record_track_skipped(&conn, track_id);
            }
        }
    }
    match playback.advance_next() {
        Some((track_id, _idx)) => {
            lookup_and_play(track_id, &db, &playback, false)?;
            Ok(Some(track_id))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn previous_track(
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<Option<i64>, String> {
    // Record skip if the current track hasn't been "played" yet
    if let Some((track_id, _pos, _dur, play_recorded)) = playback.current_play_state() {
        if !play_recorded {
            if let Ok(conn) = db.conn.lock() {
                let _ = db::record_track_skipped(&conn, track_id);
            }
        }
    }
    loop {
        match playback.advance_prev() {
            Some((track_id, _idx)) => {
                match lookup_and_play(track_id, &db, &playback, false) {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub track_id: i64,
    pub queue_index: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub prev: Vec<QueueEntry>,
    pub current: Option<QueueEntry>,
    pub next: Vec<QueueEntry>,
}

#[tauri::command]
pub fn get_queue_snapshot(
    count: usize,
    playback: State<'_, PlaybackState>,
) -> QueueSnapshot {
    let (prev, current, next) = playback.queue_snapshot(count.min(50));
    QueueSnapshot {
        prev: prev.into_iter().map(|(track_id, queue_index)| QueueEntry { track_id, queue_index }).collect(),
        current: current.map(|(track_id, queue_index)| QueueEntry { track_id, queue_index }),
        next: next.into_iter().map(|(track_id, queue_index)| QueueEntry { track_id, queue_index }).collect(),
    }
}

#[tauri::command]
pub fn remove_from_queue(
    index: usize,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.remove_from_queue(index)
}

#[tauri::command]
pub fn jump_to_queue_index(
    index: usize,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<i64, String> {
    let track_id = playback.jump_to_queue_index(index)?;
    lookup_and_play(track_id, &db, &playback, false)?;
    Ok(track_id)
}

#[tauri::command]
pub fn move_queue_item(
    from_index: usize,
    to_index: usize,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.move_queue_item(from_index, to_index)
}

#[tauri::command]
pub fn get_playback_info(
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> PlaybackInfo {
    // Check for gapless transition before reading state
    let transitioned_to = playback.check_gapless_transition();

    // Check if current track crossed the play threshold (50% or 240s)
    let play_recorded_track_id = playback.check_play_threshold();
    if let Some(track_id) = play_recorded_track_id {
        if let Ok(conn) = db.conn.lock() {
            let _ = db::record_track_played(&conn, track_id);
        }
    }

    // Auto-crossfade: start next track early when near end of current
    let crossfade_into = if let Some(next_id) = playback.should_crossfade_next() {
        match lookup_and_play(next_id, &db, &playback, true) {
            Ok(()) => Some(next_id),
            Err(_) => None,
        }
    } else {
        None
    };

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
        transitioned_to,
        crossfade_into,
        play_recorded_track_id,
    }
}

#[tauri::command]
pub fn pre_buffer_next(
    track_id: i64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<bool, String> {
    // Look up the next track's file info
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let info = db::get_track_file_info(&conn, track_id)
        .map_err(|e| format!("Track not found: {}", e))?;
    drop(conn);

    match info {
        Some((path, duration)) => {
            // peek_next_queue_index computes where this track is in the queue
            let queue_index = playback.find_queue_index(track_id);
            playback.pre_buffer_next(&path, track_id, duration, queue_index)
        }
        None => Ok(false),
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

        // Build a file:// URL for artwork for the system Now Playing widget.
        // CRITICAL: souvlaki calls NSImage initWithContentsOfURL: and then
        // msg_send!(image, size) — if NSImage returns nil (corrupt/unsupported
        // image), this is a non-unwinding panic that aborts the entire process.
        // We MUST validate the image is loadable before passing it.
        let safe_cover_url = artwork_hash.and_then(|hash| {
            let artwork_dir = Database::artwork_dir(&app).ok()?;
            for ext in &["jpg", "png"] {
                let path = artwork_dir.join(format!("{}.{}", hash, ext));
                if !path.exists() {
                    continue;
                }
                // Read first bytes to verify it's a valid image
                let data = std::fs::read(&path).ok()?;
                if data.len() < 8 {
                    continue;
                }
                let valid = (data[0..2] == [0xFF, 0xD8]) // JPEG
                    || (data[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG
                if !valid {
                    log::warn!("Skipping artwork {}.{}: invalid image header", hash, ext);
                    continue;
                }
                if let Ok(url) = Url::from_file_path(&path) {
                    return Some(url.to_string());
                }
            }
            None
        });

        // Try with artwork first; if it fails, retry without artwork.
        // souvlaki can abort on bad artwork URLs, so we're extra cautious.
        if let Err(e) = controls.set_metadata(MediaMetadata {
            title: Some(&title),
            artist: artist.as_deref(),
            album: album.as_deref(),
            duration: dur,
            cover_url: safe_cover_url.as_deref(),
        }) {
            log::warn!("set_metadata failed with artwork, retrying without: {:?}", e);
            let _ = controls.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: artist.as_deref(),
                album: album.as_deref(),
                duration: dur,
                cover_url: None,
            });
        }

        let playback = if is_playing {
            MediaPlayback::Playing {
                progress: position.map(|p| MediaPosition(Duration::from_secs_f64(p))),
            }
        } else {
            MediaPlayback::Paused {
                progress: position.map(|p| MediaPosition(Duration::from_secs_f64(p))),
            }
        };
        let _ = controls.set_playback(playback);
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
pub fn set_crossfade_duration(
    seconds: f32,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.set_crossfade_duration(seconds)
}

#[tauri::command]
pub fn get_crossfade_duration(
    playback: State<'_, PlaybackState>,
) -> f32 {
    playback.crossfade_duration()
}

#[tauri::command]
pub fn set_sleep_timer(
    minutes: u32,
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.set_sleep_timer(minutes)
}

#[tauri::command]
pub fn cancel_sleep_timer(
    playback: State<'_, PlaybackState>,
) -> Result<(), String> {
    playback.cancel_sleep_timer()
}

#[tauri::command]
pub fn get_sleep_timer_remaining(
    playback: State<'_, PlaybackState>,
) -> Option<f64> {
    playback.sleep_timer_remaining()
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

#[tauri::command]
pub fn play_similar(
    track_id: i64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tracks = db::similarity::find_similar_tracks(&conn, track_id, 50, &[])
        .map_err(|e| e.to_string())?;
    if tracks.is_empty() {
        return Err("No similar tracks found".to_string());
    }
    let ids: Vec<i64> = tracks.iter().map(|t| t.id).collect();
    let first_id = ids[0];
    let count = ids.len();

    let info = db::get_track_file_info(&conn, first_id).map_err(|e| e.to_string())?;
    drop(conn);

    match info {
        Some((path, duration)) => {
            playback.play(&path, first_id, duration)?;
            playback.set_queue(ids, 0)?;
            Ok(count)
        }
        None => Err("Track has no file path".to_string()),
    }
}

// --- Radio Mode ---

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioState {
    pub enabled: bool,
    pub seed_track_id: Option<i64>,
}

#[tauri::command]
pub fn toggle_radio_mode(playback: State<'_, PlaybackState>) -> Result<RadioState, String> {
    let enabled = playback.toggle_radio();
    let seed = playback.radio_seed();
    Ok(RadioState { enabled, seed_track_id: seed })
}

#[tauri::command]
pub fn start_radio(
    track_id: i64,
    db: State<'_, Database>,
    playback: State<'_, PlaybackState>,
) -> Result<RadioState, String> {
    playback.start_radio(track_id);

    // Play the seed track and queue similar ones
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let similar = db::similarity::find_similar_tracks(&conn, track_id, 25, &[])
        .map_err(|e| e.to_string())?;

    let mut ids = vec![track_id];
    ids.extend(similar.iter().map(|t| t.id));

    let info = db::get_track_file_info(&conn, track_id).map_err(|e| e.to_string())?;
    drop(conn);

    if let Some((path, duration)) = info {
        playback.play(&path, track_id, duration)?;
        playback.set_queue(ids, 0)?;
    }

    Ok(RadioState { enabled: true, seed_track_id: Some(track_id) })
}

#[tauri::command]
pub fn get_radio_state(playback: State<'_, PlaybackState>) -> RadioState {
    RadioState {
        enabled: playback.radio_enabled(),
        seed_track_id: playback.radio_seed(),
    }
}
