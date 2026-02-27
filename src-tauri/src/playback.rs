use rodio::{OutputStream, OutputStreamHandle, Sink};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::analyzer::{self, SharedFrequencyData};
use crate::audio::AudioSource;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RepeatMode {
    Off,
    All,
    One,
}

pub struct PlaybackInner {
    sink: Sink,
    current_track_id: Option<i64>,
    queue: Vec<i64>,
    queue_index: usize,
    volume: f32,
    duration: Option<f64>,
    play_started_at: Option<Instant>,
    accumulated_position: f64,
    shuffle: bool,
    repeat_mode: RepeatMode,
    shuffle_history: Vec<usize>,
    shuffle_forward: Vec<usize>,
    shuffle_upcoming: Vec<usize>,
    frequency_data: SharedFrequencyData,
    play_recorded: bool,
    crossfade_triggered: bool,
    next_track_appended: bool,
    appended_track_id: Option<i64>,
    appended_track_duration: Option<f64>,
    appended_queue_index: Option<usize>,
}

// SAFETY: PlaybackInner is only accessed behind a Mutex, so all access is serialized.
unsafe impl Send for PlaybackInner {}
unsafe impl Sync for PlaybackInner {}

/// Holds raw pointers to PlaybackState's Mutex fields for the sleep timer thread.
/// SAFETY: PlaybackState is Tauri managed state and lives for the entire app lifetime.
/// All fields are accessed only via Mutex locks, so access is serialized.
struct SleepThreadState {
    inner: *const Mutex<Option<PlaybackInner>>,
    sleep_end_time: *const Mutex<Option<Instant>>,
    sleep_cancel: *const Mutex<Option<Arc<AtomicBool>>>,
    pre_sleep_volume: *const Mutex<Option<f32>>,
}

unsafe impl Send for SleepThreadState {}
unsafe impl Sync for SleepThreadState {}

impl SleepThreadState {
    fn is_playing(&self) -> bool {
        unsafe {
            let guard = (*self.inner).lock().unwrap_or_else(|e| e.into_inner());
            match guard.as_ref() {
                Some(inner) => !inner.sink.is_paused() && !inner.sink.empty(),
                None => false,
            }
        }
    }

    fn volume(&self) -> f32 {
        unsafe {
            let guard = (*self.inner).lock().unwrap_or_else(|e| e.into_inner());
            guard.as_ref().map(|i| i.volume).unwrap_or(1.0)
        }
    }

    fn set_volume(&self, vol: f32) {
        unsafe {
            let mut guard = (*self.inner).lock().unwrap_or_else(|e| e.into_inner());
            if let Some(inner) = guard.as_mut() {
                let v = vol.clamp(0.0, 1.0);
                inner.volume = v;
                inner.sink.set_volume(v);
            }
        }
    }

    fn stop(&self) {
        unsafe {
            let mut guard = (*self.inner).lock().unwrap_or_else(|e| e.into_inner());
            if let Some(inner) = guard.as_mut() {
                inner.sink.stop();
                inner.current_track_id = None;
                inner.play_started_at = None;
                inner.accumulated_position = 0.0;
                inner.duration = None;
            }
        }
    }
}

/// Wrapper to hold old sink during crossfade.
/// SAFETY: Only accessed behind a Mutex, and only from the crossfade thread.
struct CrossfadeOldSink {
    sink: Sink,
}
unsafe impl Send for CrossfadeOldSink {}
unsafe impl Sync for CrossfadeOldSink {}

/// Holds raw pointers to PlaybackState's Mutex fields for the crossfade thread.
/// SAFETY: PlaybackState is Tauri managed state and lives for the entire app lifetime.
/// All fields are accessed only via Mutex locks, so access is serialized.
struct CrossfadeThread {
    inner_ptr: *const Mutex<Option<PlaybackInner>>,
    old_sink_ptr: *const Mutex<Option<CrossfadeOldSink>>,
}
unsafe impl Send for CrossfadeThread {}
unsafe impl Sync for CrossfadeThread {}

pub struct PlaybackState {
    pub inner: Mutex<Option<PlaybackInner>>,
    /// Shared audio output stream — created lazily on first play, lives for app lifetime.
    stream: Mutex<Option<OutputStream>>,
    stream_handle: Mutex<Option<OutputStreamHandle>>,
    sleep_cancel: Mutex<Option<Arc<AtomicBool>>>,
    sleep_end_time: Mutex<Option<Instant>>,
    pre_sleep_volume: Mutex<Option<f32>>,
    crossfade_duration: Mutex<f32>,
    /// Old sink that's fading out during a crossfade. Kept alive until fade completes.
    crossfade_old_sink: Mutex<Option<CrossfadeOldSink>>,
    crossfade_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

// SAFETY: All fields are behind Mutex locks, so access is serialized.
// OutputStream contains non-Send raw pointers (cpal), but we only access it under a Mutex.
unsafe impl Send for PlaybackState {}
unsafe impl Sync for PlaybackState {}

impl PlaybackState {
    pub fn new() -> Self {
        PlaybackState {
            inner: Mutex::new(None),
            stream: Mutex::new(None),
            stream_handle: Mutex::new(None),
            sleep_cancel: Mutex::new(None),
            sleep_end_time: Mutex::new(None),
            pre_sleep_volume: Mutex::new(None),
            crossfade_duration: Mutex::new(0.0),
            crossfade_old_sink: Mutex::new(None),
            crossfade_cancel: Mutex::new(None),
        }
    }

    /// Ensure the shared audio output stream exists, creating it if needed.
    fn ensure_stream(&self) -> Result<(), String> {
        let mut stream_guard = self.stream.lock().map_err(|e| e.to_string())?;
        if stream_guard.is_none() {
            let (stream, handle) =
                OutputStream::try_default().map_err(|e| format!("Audio output error: {}", e))?;
            *stream_guard = Some(stream);
            *self.stream_handle.lock().map_err(|e| e.to_string())? = Some(handle);
        }
        Ok(())
    }

    fn create_sink(&self) -> Result<Sink, String> {
        self.ensure_stream()?;
        let handle_guard = self.stream_handle.lock().map_err(|e| e.to_string())?;
        let handle = handle_guard.as_ref().ok_or("No audio stream handle")?;
        let sink = Sink::try_new(handle).map_err(|e| format!("Sink creation error: {}", e))?;
        sink.pause();
        Ok(sink)
    }

    fn init_inner(&self) -> Result<PlaybackInner, String> {
        let sink = self.create_sink()?;

        Ok(PlaybackInner {
            sink,
            current_track_id: None,
            queue: Vec::new(),
            queue_index: 0,
            volume: 1.0,
            duration: None,
            play_started_at: None,
            accumulated_position: 0.0,
            shuffle: false,
            repeat_mode: RepeatMode::Off,
            shuffle_history: Vec::new(),
            shuffle_forward: Vec::new(),
            shuffle_upcoming: Vec::new(),
            frequency_data: analyzer::new_shared_frequency_data(),
            play_recorded: false,
            crossfade_triggered: false,
            next_track_appended: false,
            appended_track_id: None,
            appended_track_duration: None,
            appended_queue_index: None,
        })
    }

    pub fn play(&self, path: &str, track_id: i64, duration: Option<f64>) -> Result<(), String> {
        // Cancel any in-progress crossfade and stop old sink immediately
        if let Some(flag) = self.crossfade_cancel.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        {
            let mut old_sink = self.crossfade_old_sink.lock().unwrap();
            if let Some(ref s) = *old_sink {
                s.sink.stop();
            }
            *old_sink = None;
        }

        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;

        let volume = guard.as_ref().map(|i| i.volume).unwrap_or(1.0);
        let queue = guard.as_ref().map(|i| i.queue.clone()).unwrap_or_default();
        let queue_index = guard.as_ref().map(|i| i.queue_index).unwrap_or(0);
        let shuffle = guard.as_ref().map(|i| i.shuffle).unwrap_or(false);
        let repeat_mode = guard.as_ref().map(|i| i.repeat_mode).unwrap_or(RepeatMode::Off);
        let shuffle_history = guard.as_ref().map(|i| i.shuffle_history.clone()).unwrap_or_default();

        let source = AudioSource::open(path)?;

        let mut inner = self.init_inner()?;
        inner.volume = volume;
        inner.queue = queue;
        inner.queue_index = queue_index;
        inner.shuffle = shuffle;
        inner.repeat_mode = repeat_mode;
        inner.shuffle_history = shuffle_history;
        inner.sink.set_volume(volume);
        let analyzed = analyzer::AnalyzedSource::new(source, inner.frequency_data.clone());
        inner.sink.append(analyzed);
        inner.sink.play();
        inner.current_track_id = Some(track_id);
        inner.duration = duration;
        inner.play_started_at = Some(Instant::now());
        inner.accumulated_position = 0.0;
        inner.play_recorded = false;
        inner.crossfade_triggered = false;
        inner.next_track_appended = false;
        inner.appended_track_id = None;
        inner.appended_track_duration = None;
        inner.appended_queue_index = None;

        *guard = Some(inner);
        Ok(())
    }

    pub fn pause(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            if let Some(started) = inner.play_started_at.take() {
                inner.accumulated_position += started.elapsed().as_secs_f64();
            }
            inner.sink.pause();
        }
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.play_started_at = Some(Instant::now());
            inner.sink.play();
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.sink.stop();
            inner.current_track_id = None;
            inner.play_started_at = None;
            inner.accumulated_position = 0.0;
            inner.duration = None;
        }
        Ok(())
    }

    pub fn seek(&self, position_secs: f64) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            let dur = std::time::Duration::from_secs_f64(position_secs.max(0.0));
            inner
                .sink
                .try_seek(dur)
                .map_err(|e| format!("Seek error: {}", e))?;
            inner.accumulated_position = position_secs;
            if !inner.sink.is_paused() {
                inner.play_started_at = Some(Instant::now());
            } else {
                inner.play_started_at = None;
            }
        }
        Ok(())
    }

    pub fn position(&self) -> f64 {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(inner) => {
                let elapsed = inner
                    .play_started_at
                    .map(|s| s.elapsed().as_secs_f64())
                    .unwrap_or(0.0);
                inner.accumulated_position + elapsed
            }
            None => 0.0,
        }
    }

    pub fn is_playing(&self) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(inner) => !inner.sink.is_paused() && !inner.sink.empty(),
            None => false,
        }
    }

    pub fn is_paused(&self) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_ref() {
            Some(inner) => inner.sink.is_paused(),
            None => false,
        }
    }

    pub fn current_track_id(&self) -> Option<i64> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().and_then(|i| i.current_track_id)
    }

    pub fn duration(&self) -> Option<f64> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().and_then(|i| i.duration)
    }

    /// Check if we should record a play (crossed 50% or 240s threshold).
    /// Returns Some(track_id) if a play should be recorded, and marks it as recorded.
    pub fn check_play_threshold(&self) -> Option<i64> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = guard.as_mut()?;
        if inner.play_recorded || inner.current_track_id.is_none() {
            return None;
        }
        let pos = inner.accumulated_position
            + inner.play_started_at.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
        let threshold = match inner.duration {
            Some(dur) => (dur * 0.5).min(240.0),
            None => 240.0,
        };
        if pos >= threshold {
            inner.play_recorded = true;
            inner.current_track_id
        } else {
            None
        }
    }

    /// Get current track info for skip detection: (track_id, position, duration, play_recorded)
    pub fn current_play_state(&self) -> Option<(i64, f64, Option<f64>, bool)> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = guard.as_ref()?;
        let track_id = inner.current_track_id?;
        let pos = inner.accumulated_position
            + inner.play_started_at.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
        Some((track_id, pos, inner.duration, inner.play_recorded))
    }

    pub fn volume(&self) -> f32 {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|i| i.volume).unwrap_or(1.0)
    }

    pub fn set_volume(&self, vol: f32) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            let v = vol.clamp(0.0, 1.0);
            inner.volume = v;
            inner.sink.set_volume(v);
        }
        Ok(())
    }

    pub fn set_queue(&self, ids: Vec<i64>, start_index: usize) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.queue = ids;
            inner.queue_index = start_index;
            inner.shuffle_upcoming.clear();
            if inner.shuffle && !inner.queue.is_empty() {
                Self::fill_shuffle_upcoming(inner);
            }
        }
        Ok(())
    }

    pub fn shuffle(&self) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|i| i.shuffle).unwrap_or(false)
    }

    pub fn set_shuffle(&self, enabled: bool) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.shuffle = enabled;
            inner.shuffle_upcoming.clear();
            if enabled && !inner.queue.is_empty() {
                Self::fill_shuffle_upcoming(inner);
            }
        }
        Ok(())
    }

    const SHUFFLE_UPCOMING_TARGET: usize = 50;

    fn pick_random(queue_len: usize, avoid_index: usize) -> usize {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        Instant::now().hash(&mut hasher);
        avoid_index.hash(&mut hasher);
        let idx = hasher.finish() as usize % queue_len;
        if idx == avoid_index && queue_len > 1 {
            (idx + 1) % queue_len
        } else {
            idx
        }
    }

    /// Fill shuffle_upcoming to the target size, avoiding the current index.
    fn fill_shuffle_upcoming(inner: &mut PlaybackInner) {
        if inner.queue.len() <= 1 {
            return;
        }
        let last = inner.shuffle_upcoming.last().copied().unwrap_or(inner.queue_index);
        while inner.shuffle_upcoming.len() < Self::SHUFFLE_UPCOMING_TARGET {
            let prev = inner.shuffle_upcoming.last().copied().unwrap_or(last);
            let next = Self::pick_random(inner.queue.len(), prev);
            inner.shuffle_upcoming.push(next);
        }
    }

    /// Compute the next track to play, handling shuffle forward stack, history, and pre-pick.
    /// All state mutations happen under a single lock to avoid races.
    /// Returns (track_id, queue_index).
    pub fn advance_next(&self) -> Option<(i64, usize)> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_mut().and_then(|inner| {
            if inner.queue.is_empty() {
                return None;
            }
            if inner.repeat_mode == RepeatMode::One {
                return Some((inner.queue[inner.queue_index], inner.queue_index));
            }
            if inner.shuffle {
                // 1. Try forward stack first (replaying tracks we backed away from)
                if let Some(fwd_idx) = inner.shuffle_forward.pop() {
                    if fwd_idx < inner.queue.len() {
                        inner.shuffle_history.push(inner.queue_index);
                        inner.queue_index = fwd_idx;
                        Self::fill_shuffle_upcoming(inner);
                        return Some((inner.queue[fwd_idx], fwd_idx));
                    }
                }
                // 2. Consume from pre-generated upcoming list
                let rand_idx = if !inner.shuffle_upcoming.is_empty() {
                    inner.shuffle_upcoming.remove(0)
                } else {
                    Self::pick_random(inner.queue.len(), inner.queue_index)
                };
                inner.shuffle_history.push(inner.queue_index);
                inner.shuffle_forward.clear();
                inner.queue_index = rand_idx;
                Self::fill_shuffle_upcoming(inner);
                Some((inner.queue[rand_idx], rand_idx))
            } else {
                let next = inner.queue_index + 1;
                if next < inner.queue.len() {
                    inner.queue_index = next;
                    Some((inner.queue[next], next))
                } else if inner.repeat_mode == RepeatMode::All {
                    inner.queue_index = 0;
                    Some((inner.queue[0], 0))
                } else {
                    None
                }
            }
        })
    }

    /// Compute the previous track to play, handling shuffle history and forward stack.
    /// All state mutations happen under a single lock.
    pub fn advance_prev(&self) -> Option<(i64, usize)> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_mut().and_then(|inner| {
            if inner.shuffle {
                let prev_idx = inner.shuffle_history.pop()?;
                inner.shuffle_forward.push(inner.queue_index);
                inner.queue_index = prev_idx;
                if prev_idx < inner.queue.len() {
                    Some((inner.queue[prev_idx], prev_idx))
                } else {
                    None
                }
            } else {
                if inner.queue_index > 0 {
                    let prev = inner.queue_index - 1;
                    inner.queue_index = prev;
                    Some((inner.queue[prev], prev))
                } else {
                    None
                }
            }
        })
    }

    /// Peek at upcoming track IDs without consuming them.
    /// Returns (prev_ids, next_ids) — previous from history/sequential, next from forward stack/pre-pick/sequential.
    pub fn peek_upcoming(&self, count: usize) -> (Vec<i64>, Vec<i64>) {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(inner) = guard.as_ref() else {
            return (vec![], vec![]);
        };
        if inner.queue.is_empty() {
            return (vec![], vec![]);
        }

        // Previous tracks
        let mut prev_ids = Vec::new();
        if inner.shuffle {
            // From shuffle history (most recent first)
            for &idx in inner.shuffle_history.iter().rev().take(count) {
                if idx < inner.queue.len() {
                    prev_ids.push(inner.queue[idx]);
                }
            }
        } else {
            let start = inner.queue_index.saturating_sub(count);
            for i in (start..inner.queue_index).rev() {
                prev_ids.push(inner.queue[i]);
            }
        }

        // Next tracks
        let mut next_ids = Vec::new();
        if inner.shuffle {
            // From forward stack first (most recent = next to play)
            for &idx in inner.shuffle_forward.iter().rev().take(count) {
                if idx < inner.queue.len() {
                    next_ids.push(inner.queue[idx]);
                }
            }
            // Then from pre-generated upcoming list
            let remaining = count - next_ids.len();
            for &idx in inner.shuffle_upcoming.iter().take(remaining) {
                if idx < inner.queue.len() {
                    next_ids.push(inner.queue[idx]);
                }
            }
        } else {
            let start = inner.queue_index + 1;
            let end = (start + count).min(inner.queue.len());
            for i in start..end {
                next_ids.push(inner.queue[i]);
            }
        }

        (prev_ids, next_ids)
    }

    /// Returns a queue snapshot with absolute indices: (prev, current, next)
    pub fn queue_snapshot(&self, count: usize) -> (Vec<(i64, usize)>, Option<(i64, usize)>, Vec<(i64, usize)>) {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(inner) = guard.as_ref() else {
            return (vec![], None, vec![]);
        };
        if inner.queue.is_empty() {
            return (vec![], None, vec![]);
        }

        let current = Some((inner.queue[inner.queue_index], inner.queue_index));

        // Previous
        let mut prev = Vec::new();
        if inner.shuffle {
            for &idx in inner.shuffle_history.iter().rev().take(count) {
                if idx < inner.queue.len() {
                    prev.push((inner.queue[idx], idx));
                }
            }
        } else {
            let start = inner.queue_index.saturating_sub(count);
            for i in (start..inner.queue_index).rev() {
                prev.push((inner.queue[i], i));
            }
        }

        // Next
        let mut next = Vec::new();
        if inner.shuffle {
            for &idx in inner.shuffle_forward.iter().rev().take(count) {
                if idx < inner.queue.len() {
                    next.push((inner.queue[idx], idx));
                }
            }
            let remaining = count - next.len();
            for &idx in inner.shuffle_upcoming.iter().take(remaining) {
                if idx < inner.queue.len() {
                    next.push((inner.queue[idx], idx));
                }
            }
        } else {
            let start = inner.queue_index + 1;
            let end = (start + count).min(inner.queue.len());
            for i in start..end {
                next.push((inner.queue[i], i));
            }
        }

        (prev, current, next)
    }

    pub fn repeat_mode(&self) -> RepeatMode {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|i| i.repeat_mode).unwrap_or(RepeatMode::Off)
    }

    pub fn set_repeat_mode(&self, mode: RepeatMode) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.repeat_mode = mode;
        }
        Ok(())
    }

    /// Pre-buffer the next track by appending it to the sink.
    /// Returns the track ID of the appended track, or None if nothing to append.
    pub fn pre_buffer_next(&self, file_path: &str, track_id: i64, duration: Option<f64>, queue_index: usize) -> Result<bool, String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            if inner.next_track_appended {
                return Ok(false); // Already appended
            }
            let source = AudioSource::open(file_path)?;
            let analyzed = analyzer::AnalyzedSource::new(source, inner.frequency_data.clone());
            inner.sink.append(analyzed);
            inner.next_track_appended = true;
            inner.appended_track_id = Some(track_id);
            inner.appended_track_duration = duration;
            inner.appended_queue_index = Some(queue_index);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Check if a gapless transition occurred (sink queue drained from 2 to 1).
    /// If so, advance internal state and return the new track ID.
    pub fn check_gapless_transition(&self) -> Option<i64> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = guard.as_mut()?;

        if !inner.next_track_appended {
            return None;
        }

        // sink.len() returns number of queued sources
        if inner.sink.len() <= 1 {
            // The appended track is now playing (or sink is empty = track ended)
            let new_id = inner.appended_track_id.take()?;
            let new_duration = inner.appended_track_duration.take();
            let new_queue_index = inner.appended_queue_index.take();

            inner.next_track_appended = false;
            inner.current_track_id = Some(new_id);
            inner.duration = new_duration;
            inner.play_started_at = Some(Instant::now());
            inner.accumulated_position = 0.0;
            inner.play_recorded = false;
            inner.crossfade_triggered = false;

            if let Some(idx) = new_queue_index {
                if inner.shuffle {
                    inner.shuffle_history.push(inner.queue_index);
                }
                inner.queue_index = idx;
            }

            Some(new_id)
        } else {
            None
        }
    }

    /// Returns true if a next track has already been appended for gapless playback.
    #[allow(dead_code)]
    pub fn has_next_appended(&self) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|i| i.next_track_appended).unwrap_or(false)
    }

    /// Check if we should auto-start crossfade into the next track.
    /// Returns Some(next_track_id) if position is within crossfade_duration of the end
    /// and crossfade hasn't already been triggered for this track.
    pub fn should_crossfade_next(&self) -> Option<i64> {
        let cf_dur = *self.crossfade_duration.lock().unwrap();
        if cf_dur <= 0.0 {
            return None;
        }
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = guard.as_mut()?;
        if inner.crossfade_triggered || !inner.current_track_id.is_some() {
            return None;
        }
        let dur = inner.duration?;
        if dur <= cf_dur as f64 {
            // Track is shorter than crossfade duration, skip auto-crossfade
            return None;
        }
        let pos = inner.accumulated_position
            + inner.play_started_at.map(|s| s.elapsed().as_secs_f64()).unwrap_or(0.0);
        if pos >= dur - cf_dur as f64 {
            inner.crossfade_triggered = true;
            // Advance queue to get the next track
            if inner.queue.is_empty() {
                return None;
            }
            if inner.repeat_mode == RepeatMode::One {
                // Repeat One doesn't crossfade — let it loop via gapless or natural end
                return None;
            }
            let next_idx = if inner.shuffle {
                if let Some(fwd_idx) = inner.shuffle_forward.pop() {
                    inner.shuffle_history.push(inner.queue_index);
                    inner.queue_index = fwd_idx;
                    Self::fill_shuffle_upcoming(inner);
                    fwd_idx
                } else {
                    let rand_idx = if !inner.shuffle_upcoming.is_empty() {
                        inner.shuffle_upcoming.remove(0)
                    } else {
                        Self::pick_random(inner.queue.len(), inner.queue_index)
                    };
                    inner.shuffle_history.push(inner.queue_index);
                    inner.shuffle_forward.clear();
                    inner.queue_index = rand_idx;
                    Self::fill_shuffle_upcoming(inner);
                    rand_idx
                }
            } else {
                let next = inner.queue_index + 1;
                if next < inner.queue.len() {
                    inner.queue_index = next;
                    next
                } else if inner.repeat_mode == RepeatMode::All {
                    inner.queue_index = 0;
                    0
                } else {
                    return None;
                }
            };
            Some(inner.queue[next_idx])
        } else {
            None
        }
    }

    pub fn crossfade_duration(&self) -> f32 {
        *self.crossfade_duration.lock().unwrap()
    }

    pub fn set_crossfade_duration(&self, secs: f32) -> Result<(), String> {
        *self.crossfade_duration.lock().map_err(|e| e.to_string())? = secs.clamp(0.0, 12.0);
        Ok(())
    }

    /// Play a track with crossfade from the currently playing track.
    /// The old sink is moved to `crossfade_old_sink` and faded out in a background thread.
    pub fn play_with_crossfade(&self, path: &str, track_id: i64, duration: Option<f64>) -> Result<(), String> {
        let cf_dur = *self.crossfade_duration.lock().unwrap();
        if cf_dur <= 0.0 {
            return self.play(path, track_id, duration);
        }

        // Cancel any existing crossfade
        if let Some(flag) = self.crossfade_cancel.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }

        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;

        let volume = guard.as_ref().map(|i| i.volume).unwrap_or(1.0);
        let queue = guard.as_ref().map(|i| i.queue.clone()).unwrap_or_default();
        let queue_index = guard.as_ref().map(|i| i.queue_index).unwrap_or(0);
        let shuffle = guard.as_ref().map(|i| i.shuffle).unwrap_or(false);
        let repeat_mode = guard.as_ref().map(|i| i.repeat_mode).unwrap_or(RepeatMode::Off);
        let shuffle_history = guard.as_ref().map(|i| i.shuffle_history.clone()).unwrap_or_default();

        // Take the old inner (sink + stream) for fade-out
        let old_inner = guard.take();

        let source = AudioSource::open(path)?;

        // Create new playback
        let mut inner = self.init_inner()?;
        inner.volume = volume;
        inner.queue = queue;
        inner.queue_index = queue_index;
        inner.shuffle = shuffle;
        inner.repeat_mode = repeat_mode;
        inner.shuffle_history = shuffle_history;
        inner.sink.set_volume(0.0); // Start at 0 for fade-in
        let analyzed = analyzer::AnalyzedSource::new(source, inner.frequency_data.clone());
        inner.sink.append(analyzed);
        inner.sink.play();
        inner.current_track_id = Some(track_id);
        inner.duration = duration;
        inner.play_started_at = Some(Instant::now());
        inner.accumulated_position = 0.0;

        *guard = Some(inner);
        drop(guard);

        // Move old sink to fade-out storage and spawn crossfade thread
        if let Some(old) = old_inner {
            let cancel_flag = Arc::new(AtomicBool::new(false));
            *self.crossfade_cancel.lock().unwrap() = Some(cancel_flag.clone());

            // Store old sink to keep it alive during fade-out
            *self.crossfade_old_sink.lock().unwrap() = Some(CrossfadeOldSink {
                sink: old.sink,
            });

            let thread_state = Arc::new(CrossfadeThread {
                inner_ptr: &self.inner as *const Mutex<Option<PlaybackInner>>,
                old_sink_ptr: &self.crossfade_old_sink as *const Mutex<Option<CrossfadeOldSink>>,
            });
            let fade_volume = volume;

            std::thread::spawn(move || {
                let steps = (cf_dur * 20.0) as usize; // 50ms steps
                for step in 1..=steps {
                    if cancel_flag.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));

                    let t = step as f32 / steps as f32;
                    // Equal-power curves
                    let fade_in = t.sqrt() * fade_volume;
                    let fade_out = (1.0 - t).sqrt() * fade_volume;

                    // Update new sink volume
                    unsafe {
                        if let Ok(mut guard) = (*thread_state.inner_ptr).lock() {
                            if let Some(inner) = guard.as_mut() {
                                inner.sink.set_volume(fade_in);
                            }
                        }
                    }
                    // Update old sink volume
                    unsafe {
                        if let Ok(guard) = (*thread_state.old_sink_ptr).lock() {
                            if let Some(ref old) = *guard {
                                old.sink.set_volume(fade_out);
                            }
                        }
                    }
                }

                // Fade complete — stop and drop old sink
                unsafe {
                    let mut guard = (*thread_state.old_sink_ptr).lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref old) = *guard {
                        old.sink.stop();
                    }
                    *guard = None;

                    // Ensure new sink is at full volume
                    if let Ok(mut g) = (*thread_state.inner_ptr).lock() {
                        if let Some(inner) = g.as_mut() {
                            inner.sink.set_volume(inner.volume);
                        }
                    }
                }
            });
        }

        Ok(())
    }

    pub fn find_queue_index(&self, track_id: i64) -> usize {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|inner| {
            inner.queue.iter().position(|&id| id == track_id)
                .unwrap_or(inner.queue_index + 1)
        }).unwrap_or(0)
    }

    pub fn remove_from_queue(&self, index: usize) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            if index >= inner.queue.len() || index == inner.queue_index {
                return Err("Cannot remove current or invalid index".to_string());
            }
            inner.queue.remove(index);
            // Adjust queue_index if removed item was before current
            if index < inner.queue_index {
                inner.queue_index -= 1;
            }
        }
        Ok(())
    }

    pub fn jump_to_queue_index(&self, index: usize) -> Result<i64, String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            if index >= inner.queue.len() {
                return Err("Invalid queue index".to_string());
            }
            inner.queue_index = index;
            let track_id = inner.queue[index];
            Ok(track_id)
        } else {
            Err("No playback active".to_string())
        }
    }

    pub fn move_queue_item(&self, from_index: usize, to_index: usize) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            if from_index >= inner.queue.len() || to_index >= inner.queue.len() {
                return Err("Invalid index".to_string());
            }
            let item = inner.queue.remove(from_index);
            inner.queue.insert(to_index, item);
            // Adjust queue_index to follow the current track
            if inner.queue_index == from_index {
                inner.queue_index = to_index;
            } else if from_index < inner.queue_index && to_index >= inner.queue_index {
                inner.queue_index -= 1;
            } else if from_index > inner.queue_index && to_index <= inner.queue_index {
                inner.queue_index += 1;
            }
        }
        Ok(())
    }

    pub fn frequency_data(&self) -> Option<SharedFrequencyData> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|i| i.frequency_data.clone())
    }

    pub fn set_sleep_timer(&self, minutes: u32) -> Result<(), String> {
        // Cancel any existing timer
        self.cancel_sleep_timer_inner();

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel_flag.clone();

        let end_time = Instant::now() + std::time::Duration::from_secs(minutes as u64 * 60);
        *self.sleep_end_time.lock().unwrap() = Some(end_time);
        *self.sleep_cancel.lock().unwrap() = Some(cancel_flag);

        // Save current volume
        let vol = self.volume();
        *self.pre_sleep_volume.lock().unwrap() = Some(vol);

        // Clone the Mutex-wrapped state references for the sleep thread.
        // We clone the Arc<Mutex> handles so the thread can access them safely.
        let inner_ref = Arc::new(SleepThreadState {
            inner: &self.inner as *const Mutex<Option<PlaybackInner>>,
            sleep_end_time: &self.sleep_end_time as *const Mutex<Option<Instant>>,
            sleep_cancel: &self.sleep_cancel as *const Mutex<Option<Arc<AtomicBool>>>,
            pre_sleep_volume: &self.pre_sleep_volume as *const Mutex<Option<f32>>,
        });

        std::thread::spawn(move || {
            let fade_duration_secs: u64 = 30;
            let total_secs = minutes as u64 * 60;
            let wait_secs = total_secs.saturating_sub(fade_duration_secs);

            // Wait until fade should start, checking cancel every second
            for _ in 0..wait_secs {
                if cancel_clone.load(Ordering::Relaxed) {
                    return;
                }
                if !inner_ref.is_playing() {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if cancel_clone.load(Ordering::Relaxed) {
                            return;
                        }
                        if inner_ref.is_playing() {
                            break;
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }

            // Fade out over 30 seconds
            let start_vol = inner_ref.volume();
            let steps = (fade_duration_secs * 2) as usize; // 500ms steps
            for step in 0..steps {
                if cancel_clone.load(Ordering::Relaxed) {
                    return;
                }
                if !inner_ref.is_playing() {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if cancel_clone.load(Ordering::Relaxed) {
                            return;
                        }
                        if inner_ref.is_playing() {
                            break;
                        }
                    }
                }
                let t = (step + 1) as f32 / steps as f32;
                let vol = start_vol * (1.0 - t);
                inner_ref.set_volume(vol);
                std::thread::sleep(std::time::Duration::from_millis(500));
            }

            if !cancel_clone.load(Ordering::Relaxed) {
                inner_ref.stop();
                // Restore volume for next play
                // SAFETY: PlaybackState is Tauri managed state, outlives this thread
                unsafe {
                    if let Some(original_vol) = *(*inner_ref.pre_sleep_volume).lock().unwrap() {
                        inner_ref.set_volume(original_vol);
                    }
                    *(*inner_ref.sleep_end_time).lock().unwrap() = None;
                    *(*inner_ref.sleep_cancel).lock().unwrap() = None;
                    *(*inner_ref.pre_sleep_volume).lock().unwrap() = None;
                }
            }
        });

        Ok(())
    }

    fn cancel_sleep_timer_inner(&self) {
        if let Some(flag) = self.sleep_cancel.lock().unwrap().take() {
            flag.store(true, Ordering::Relaxed);
        }
        // Restore volume
        if let Some(vol) = self.pre_sleep_volume.lock().unwrap().take() {
            let _ = self.set_volume(vol);
        }
        *self.sleep_end_time.lock().unwrap() = None;
    }

    pub fn cancel_sleep_timer(&self) -> Result<(), String> {
        self.cancel_sleep_timer_inner();
        Ok(())
    }

    pub fn sleep_timer_remaining(&self) -> Option<f64> {
        let guard = self.sleep_end_time.lock().unwrap();
        guard.map(|end| {
            let now = Instant::now();
            if now >= end {
                0.0
            } else {
                (end - now).as_secs_f64()
            }
        })
    }

    /// Reinitialize the audio output stream to pick up a new default device.
    /// Saves current playback state and returns info needed to resume on the new stream.
    /// Returns (track_id, position, was_playing) if a track was active.
    pub fn reinit_stream(&self) -> Result<Option<(i64, f64, bool)>, String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let Some(old) = guard.as_ref() else {
            return Ok(None);
        };

        // Save state from old stream
        let track_id = old.current_track_id;
        let was_playing = !old.sink.is_paused() && !old.sink.empty();
        let position = {
            let elapsed = old
                .play_started_at
                .map(|s| s.elapsed().as_secs_f64())
                .unwrap_or(0.0);
            old.accumulated_position + elapsed
        };
        let volume = old.volume;
        let queue = old.queue.clone();
        let queue_index = old.queue_index;
        let shuffle = old.shuffle;
        let repeat_mode = old.repeat_mode;
        let shuffle_history = old.shuffle_history.clone();
        let shuffle_forward = old.shuffle_forward.clone();
        let shuffle_upcoming = old.shuffle_upcoming.clone();
        let duration = old.duration;

        // Drop the old stream and recreate for the new audio device
        {
            let mut stream_guard = self.stream.lock().map_err(|e| e.to_string())?;
            *stream_guard = None;
            drop(stream_guard);
            let mut handle_guard = self.stream_handle.lock().map_err(|e| e.to_string())?;
            *handle_guard = None;
            drop(handle_guard);
        }
        let mut inner = self.init_inner()?;
        inner.volume = volume;
        inner.sink.set_volume(volume);
        inner.queue = queue;
        inner.queue_index = queue_index;
        inner.shuffle = shuffle;
        inner.repeat_mode = repeat_mode;
        inner.shuffle_history = shuffle_history;
        inner.shuffle_forward = shuffle_forward;
        inner.shuffle_upcoming = shuffle_upcoming;
        inner.current_track_id = track_id;
        inner.duration = duration;

        *guard = Some(inner);

        match track_id {
            Some(id) => Ok(Some((id, position, was_playing))),
            None => Ok(None),
        }
    }
}
