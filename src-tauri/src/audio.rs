use std::fs::File;
use std::time::Duration;

use rodio::Source;
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    errors::Error as SymphError,
    formats::{FormatOptions, FormatReader},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};
use symphonia::default::get_codecs;
use symphonia::default::get_probe;

const MAX_DECODE_RETRIES: usize = 3;

pub struct AudioSource {
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    format: Box<dyn FormatReader>,
    track_id: u32,
    buffer: Vec<i16>,
    buffer_offset: usize,
    channels: u16,
    sample_rate: u32,
    total_duration: Option<Duration>,
}

// SAFETY: AudioSource is only used behind a Mutex or passed to a single rodio Sink thread.
unsafe impl Send for AudioSource {}

impl AudioSource {
    pub fn open(path: &str) -> Result<Self, String> {
        let file = File::open(path)
            .map_err(|e| format!("Cannot open '{}': {}", path, e))?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(path).extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let format_opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let metadata_opts = MetadataOptions::default();

        let probed = get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| format!("Probe failed for '{}': {}", path, e))?;

        let mut format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| format!("No audio track in '{}'", path))?;

        let track_id = track.id;
        let codec_params = track.codec_params.clone();

        let total_duration = codec_params.time_base.and_then(|tb| {
            codec_params.n_frames.map(|frames| {
                let time: Time = tb.calc_time(frames);
                Duration::from_secs_f64(time.seconds as f64 + time.frac)
            })
        });

        let mut decoder = get_codecs()
            .make(&codec_params, &DecoderOptions::default())
            .map_err(|e| format!("Codec init failed for '{}': {}", path, e))?;

        // Read first packet to get spec
        let mut decode_errors = 0;
        let (channels, sample_rate, initial_buffer) = loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(SymphError::IoError(_)) => {
                    return Err(format!("No audio data in '{}'", path));
                }
                Err(SymphError::SeekError(_)) => {
                    // This is the error rodio panics on — we handle it gracefully
                    return Err(format!("Seek error during init for '{}' (unsupported file)", path));
                }
                Err(e) => {
                    return Err(format!("Read error for '{}': {}", path, e));
                }
            };

            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let ch = spec.channels.count() as u16;
                    let sr = spec.rate;
                    let duration = symphonia::core::units::Duration::from(decoded.capacity() as u64);
                    let mut sample_buf = SampleBuffer::<i16>::new(duration, spec);
                    sample_buf.copy_interleaved_ref(decoded);
                    break (ch, sr, sample_buf.samples().to_vec());
                }
                Err(SymphError::DecodeError(_)) => {
                    decode_errors += 1;
                    if decode_errors > MAX_DECODE_RETRIES {
                        return Err(format!("Too many decode errors for '{}'", path));
                    }
                    continue;
                }
                Err(e) => {
                    return Err(format!("Decode failed for '{}': {}", path, e));
                }
            }
        };

        Ok(AudioSource {
            decoder,
            format,
            track_id,
            buffer: initial_buffer,
            buffer_offset: 0,
            channels,
            sample_rate,
            total_duration,
        })
    }

    fn read_next_packet(&mut self) -> bool {
        loop {
            let packet = match self.format.next_packet() {
                Ok(p) => p,
                Err(_) => return false,
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    self.channels = spec.channels.count() as u16;
                    self.sample_rate = spec.rate;
                    let duration =
                        symphonia::core::units::Duration::from(decoded.capacity() as u64);
                    let mut sample_buf = SampleBuffer::<i16>::new(duration, spec);
                    sample_buf.copy_interleaved_ref(decoded);
                    self.buffer = sample_buf.samples().to_vec();
                    self.buffer_offset = 0;
                    if self.buffer.is_empty() {
                        continue; // skip empty decoded packets
                    }
                    return true;
                }
                Err(SymphError::DecodeError(_)) => continue,
                Err(_) => return false,
            }
        }
    }
}

impl Iterator for AudioSource {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        if self.buffer_offset >= self.buffer.len() {
            if !self.read_next_packet() {
                return None;
            }
        }
        let sample = self.buffer[self.buffer_offset];
        self.buffer_offset += 1;
        Some(sample)
    }
}

impl Source for AudioSource {
    fn current_frame_len(&self) -> Option<usize> {
        Some(self.buffer.len().saturating_sub(self.buffer_offset))
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        use symphonia::core::formats::{SeekMode, SeekTo};

        let time = Time {
            seconds: pos.as_secs(),
            frac: pos.subsec_nanos() as f64 / 1_000_000_000.0,
        };

        self.format
            .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: None })
            .map_err(|_| rodio::source::SeekError::NotSupported {
                underlying_source: "seek not supported for this format",
            })?;

        // Read next packet after seek to refill buffer
        if !self.read_next_packet() {
            self.buffer.clear();
            self.buffer_offset = 0;
        }

        Ok(())
    }
}
