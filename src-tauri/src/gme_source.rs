use std::time::Duration;

use game_music_emu::GameMusicEmu;
use rodio::Source;

/// Seek by restarting the track and fast-forwarding by rendering and discarding samples.
/// GME emulation is fast enough that this is near-instant even for multi-minute seeks.
fn gme_seek_by_render(emu: &GameMusicEmu, target_samples: u64) -> Result<(), String> {
    // Restart from beginning
    emu.start_track(0)
        .map_err(|e| format!("GME start_track failed during seek: {}", e))?;

    // Fast-forward by rendering and discarding chunks
    let chunk_size = 8192usize; // larger chunks for faster seeking
    let mut buf = vec![0i16; chunk_size];
    let mut rendered = 0u64;
    while rendered < target_samples {
        let remaining = (target_samples - rendered) as usize;
        let count = chunk_size.min(remaining);
        emu.play(count, &mut buf[..count])
            .map_err(|e| format!("GME play failed during seek: {}", e))?;
        rendered += count as u64;
    }
    Ok(())
}

/// Extensions handled by Game Music Emu (SNES SPC, NES NSF, Game Boy GBS, Sega VGM, etc.)
pub const GME_EXTENSIONS: &[&str] = &[
    "spc", "nsf", "nsfe", "gbs", "vgm", "vgz", "gym", "ay", "hes", "kss", "sap",
];

const SAMPLE_RATE: u32 = 44100;
const RENDER_CHUNK: usize = 2048; // stereo samples per render call (4096 i16 values)
const DEFAULT_DURATION_SECS: f64 = 180.0; // 3 minutes for looping tracks
const FADE_SECS: f64 = 8.0;

pub struct GmeSource {
    emu: GameMusicEmu,
    buffer: Vec<i16>,
    buffer_offset: usize,
    total_duration: Duration,
    samples_rendered: u64,
    fade_start_sample: u64,
    total_samples: u64,
}

// SAFETY: GmeSource is only used behind a Mutex or passed to a single rodio Sink thread.
unsafe impl Send for GmeSource {}

impl GmeSource {
    pub fn open(path: &str) -> Result<Self, String> {
        let emu = GameMusicEmu::from_file(path, SAMPLE_RATE)
            .map_err(|e| format!("GME load failed for '{}': {}", path, e))?;

        emu.start_track(0)
            .map_err(|e| format!("GME start_track failed: {}", e))?;

        let duration_secs = DEFAULT_DURATION_SECS;
        let total_duration = Duration::from_secs_f64(duration_secs);
        let total_samples = (duration_secs * SAMPLE_RATE as f64) as u64 * 2; // stereo
        let fade_start = ((duration_secs - FADE_SECS).max(0.0) * SAMPLE_RATE as f64) as u64 * 2;

        Ok(GmeSource {
            emu,
            buffer: Vec::new(),
            buffer_offset: 0,
            total_duration,
            samples_rendered: 0,
            fade_start_sample: fade_start,
            total_samples: total_samples,
        })
    }

    fn render_chunk(&mut self) -> bool {
        if self.emu.track_ended() || self.samples_rendered >= self.total_samples {
            return false;
        }

        let remaining = (self.total_samples - self.samples_rendered) as usize;
        let count = (RENDER_CHUNK * 2).min(remaining); // count is number of i16 values (stereo pairs)
        if count == 0 {
            return false;
        }

        self.buffer.resize(count, 0);
        match self.emu.play(count, &mut self.buffer) {
            Ok(()) => {
                // Apply fade-out if we're in the fade region
                if self.samples_rendered + count as u64 > self.fade_start_sample {
                    let fade_total = self.total_samples - self.fade_start_sample;
                    for (i, sample) in self.buffer.iter_mut().enumerate() {
                        let abs_pos = self.samples_rendered + i as u64;
                        if abs_pos >= self.fade_start_sample {
                            let fade_pos = abs_pos - self.fade_start_sample;
                            let gain = 1.0 - (fade_pos as f64 / fade_total as f64);
                            *sample = (*sample as f64 * gain.max(0.0)) as i16;
                        }
                    }
                }
                self.samples_rendered += count as u64;
                self.buffer_offset = 0;
                true
            }
            Err(_) => false,
        }
    }
}

impl Iterator for GmeSource {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        if self.buffer_offset >= self.buffer.len() {
            if !self.render_chunk() {
                return None;
            }
        }
        let sample = self.buffer[self.buffer_offset];
        self.buffer_offset += 1;
        Some(sample)
    }
}

impl Source for GmeSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.buffer_offset))
    }

    fn channels(&self) -> u16 {
        2 // GME always renders stereo
    }

    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(self.total_duration)
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let target_secs = pos.as_secs_f64().min(self.total_duration.as_secs_f64());
        let target_samples = (target_secs * SAMPLE_RATE as f64) as u64 * 2; // stereo

        gme_seek_by_render(&self.emu, target_samples).map_err(|_| {
            rodio::source::SeekError::NotSupported {
                underlying_source: "GME seek failed",
            }
        })?;

        self.samples_rendered = target_samples;
        self.buffer.clear();
        self.buffer_offset = 0;
        Ok(())
    }
}

/// Metadata extracted from a GME file (SPC ID666 tags, etc.)
pub struct GmeMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub game: Option<String>,
    pub duration: Option<f64>,
}

/// Read metadata from an SPC file's ID666 header tag.
/// For other GME formats, returns basic info from the filename.
pub fn read_gme_metadata(path: &str) -> GmeMetadata {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext == "spc" {
        if let Ok(data) = std::fs::read(path) {
            return parse_spc_id666(&data);
        }
    }

    // For non-SPC formats, use filename as title
    let title = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());

    GmeMetadata {
        title,
        artist: None,
        game: None,
        duration: Some(DEFAULT_DURATION_SECS),
    }
}

/// Parse SPC ID666 tag from raw file data.
/// The ID666 tag starts at offset 0x2E in an SPC file.
fn parse_spc_id666(data: &[u8]) -> GmeMetadata {
    if data.len() < 0xD3 {
        return GmeMetadata {
            title: None,
            artist: None,
            game: None,
            duration: Some(DEFAULT_DURATION_SECS),
        };
    }

    // Check "SNES-SPC700" header
    if &data[0..11] != b"SNES-SPC700" {
        return GmeMetadata {
            title: None,
            artist: None,
            game: None,
            duration: Some(DEFAULT_DURATION_SECS),
        };
    }

    let title = read_spc_string(data, 0x2E, 32);
    let game = read_spc_string(data, 0x4E, 32);
    let artist = read_spc_string(data, 0xB1, 32);

    // Duration field at 0xA9 (3 bytes, text, seconds)
    let duration_str = read_spc_string(data, 0xA9, 3);
    let duration = duration_str
        .as_deref()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|&d| d > 0.0);

    GmeMetadata {
        title,
        artist,
        game,
        duration: duration.or(Some(DEFAULT_DURATION_SECS)),
    }
}

fn read_spc_string(data: &[u8], offset: usize, max_len: usize) -> Option<String> {
    if offset + max_len > data.len() {
        return None;
    }
    let slice = &data[offset..offset + max_len];
    // Find null terminator or end
    let end = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    let s = String::from_utf8_lossy(&slice[..end]).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}
