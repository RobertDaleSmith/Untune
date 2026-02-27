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
    _stream: OutputStream,
    _stream_handle: OutputStreamHandle,
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
    shuffle_next: Option<usize>,
    frequency_data: SharedFrequencyData,
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

pub struct PlaybackState {
    pub inner: Mutex<Option<PlaybackInner>>,
    sleep_cancel: Mutex<Option<Arc<AtomicBool>>>,
    sleep_end_time: Mutex<Option<Instant>>,
    pre_sleep_volume: Mutex<Option<f32>>,
}

impl PlaybackState {
    pub fn new() -> Self {
        PlaybackState {
            inner: Mutex::new(None),
            sleep_cancel: Mutex::new(None),
            sleep_end_time: Mutex::new(None),
            pre_sleep_volume: Mutex::new(None),
        }
    }

    fn init_inner() -> Result<PlaybackInner, String> {
        let (stream, stream_handle) =
            OutputStream::try_default().map_err(|e| format!("Audio output error: {}", e))?;
        let sink =
            Sink::try_new(&stream_handle).map_err(|e| format!("Sink creation error: {}", e))?;
        sink.pause();

        Ok(PlaybackInner {
            sink,
            _stream: stream,
            _stream_handle: stream_handle,
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
            shuffle_next: None,
            frequency_data: analyzer::new_shared_frequency_data(),
        })
    }

    pub fn play(&self, path: &str, track_id: i64, duration: Option<f64>) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;

        let volume = guard.as_ref().map(|i| i.volume).unwrap_or(1.0);
        let queue = guard.as_ref().map(|i| i.queue.clone()).unwrap_or_default();
        let queue_index = guard.as_ref().map(|i| i.queue_index).unwrap_or(0);
        let shuffle = guard.as_ref().map(|i| i.shuffle).unwrap_or(false);
        let repeat_mode = guard.as_ref().map(|i| i.repeat_mode).unwrap_or(RepeatMode::Off);
        let shuffle_history = guard.as_ref().map(|i| i.shuffle_history.clone()).unwrap_or_default();

        let source = AudioSource::open(path)?;

        let mut inner = Self::init_inner()?;
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
            if inner.shuffle && !inner.queue.is_empty() {
                inner.shuffle_next = Some(Self::pick_random(inner.queue.len(), start_index));
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
            if enabled && !inner.queue.is_empty() {
                inner.shuffle_next = Some(Self::pick_random(inner.queue.len(), inner.queue_index));
            } else {
                inner.shuffle_next = None;
            }
        }
        Ok(())
    }

    fn pick_random(queue_len: usize, current_index: usize) -> usize {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        Instant::now().hash(&mut hasher);
        current_index.hash(&mut hasher);
        hasher.finish() as usize % queue_len
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
                        // Ensure we have a pre-pick ready
                        if inner.shuffle_next.is_none() {
                            inner.shuffle_next = Some(Self::pick_random(inner.queue.len(), fwd_idx));
                        }
                        return Some((inner.queue[fwd_idx], fwd_idx));
                    }
                }
                // 2. Use pre-picked next or pick fresh
                let rand_idx = inner.shuffle_next.take()
                    .unwrap_or_else(|| Self::pick_random(inner.queue.len(), inner.queue_index));
                inner.shuffle_history.push(inner.queue_index);
                inner.shuffle_forward.clear();
                inner.queue_index = rand_idx;
                // Pre-pick the one after that
                inner.shuffle_next = Some(Self::pick_random(inner.queue.len(), rand_idx));
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
            // Then the pre-picked next
            if next_ids.len() < count {
                if let Some(idx) = inner.shuffle_next {
                    if idx < inner.queue.len() {
                        next_ids.push(inner.queue[idx]);
                    }
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
        let shuffle_next = old.shuffle_next;
        let duration = old.duration;

        // Drop the old stream by replacing with a new one
        let mut inner = Self::init_inner()?;
        inner.volume = volume;
        inner.sink.set_volume(volume);
        inner.queue = queue;
        inner.queue_index = queue_index;
        inner.shuffle = shuffle;
        inner.repeat_mode = repeat_mode;
        inner.shuffle_history = shuffle_history;
        inner.shuffle_forward = shuffle_forward;
        inner.shuffle_next = shuffle_next;
        inner.current_track_id = track_id;
        inner.duration = duration;

        *guard = Some(inner);

        match track_id {
            Some(id) => Ok(Some((id, position, was_playing))),
            None => Ok(None),
        }
    }
}
