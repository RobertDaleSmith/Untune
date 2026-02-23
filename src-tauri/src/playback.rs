use rodio::{OutputStream, OutputStreamHandle, Sink};
use std::sync::Mutex;
use std::time::Instant;

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
}

// SAFETY: PlaybackInner is only accessed behind a Mutex, so all access is serialized.
unsafe impl Send for PlaybackInner {}
unsafe impl Sync for PlaybackInner {}

pub struct PlaybackState {
    pub inner: Mutex<Option<PlaybackInner>>,
}

impl PlaybackState {
    pub fn new() -> Self {
        PlaybackState {
            inner: Mutex::new(None),
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
        inner.sink.append(source);
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
        }
        Ok(())
    }

    pub fn next_index(&self) -> Option<(i64, usize)> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().and_then(|inner| {
            if inner.queue.is_empty() {
                return None;
            }
            if inner.repeat_mode == RepeatMode::One {
                return Some((inner.queue[inner.queue_index], inner.queue_index));
            }
            if inner.shuffle {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};
                let mut hasher = DefaultHasher::new();
                Instant::now().hash(&mut hasher);
                inner.queue_index.hash(&mut hasher);
                let rand_idx = hasher.finish() as usize % inner.queue.len();
                Some((inner.queue[rand_idx], rand_idx))
            } else {
                let next = inner.queue_index + 1;
                if next < inner.queue.len() {
                    Some((inner.queue[next], next))
                } else if inner.repeat_mode == RepeatMode::All {
                    Some((inner.queue[0], 0))
                } else {
                    None
                }
            }
        })
    }

    pub fn prev_index(&self) -> Option<(i64, usize)> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().and_then(|inner| {
            if inner.queue_index > 0 {
                let prev = inner.queue_index - 1;
                Some((inner.queue[prev], prev))
            } else {
                None
            }
        })
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

    pub fn update_queue_index(&self, index: usize) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.queue_index = index;
        }
        Ok(())
    }

    /// Push current queue_index onto shuffle history before moving to a new track.
    pub fn push_shuffle_history(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.shuffle_history.push(inner.queue_index);
        }
        Ok(())
    }

    /// Pop the last index from shuffle history. Returns the track_id and index.
    pub fn pop_shuffle_history(&self) -> Option<(i64, usize)> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_mut().and_then(|inner| {
            let prev_idx = inner.shuffle_history.pop()?;
            if prev_idx < inner.queue.len() {
                Some((inner.queue[prev_idx], prev_idx))
            } else {
                None
            }
        })
    }
}
