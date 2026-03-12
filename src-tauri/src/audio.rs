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

use crate::gme_source::{self, GmeSource};
use crate::psf_source::{self, PsfSource};

const MAX_DECODE_RETRIES: usize = 3;

enum AudioInner {
    Symphonia {
        decoder: Box<dyn symphonia::core::codecs::Decoder>,
        format: Box<dyn FormatReader>,
        track_id: u32,
        buffer: Vec<i16>,
        buffer_offset: usize,
        channels: u16,
        sample_rate: u32,
        total_duration: Option<Duration>,
    },
    Gme(GmeSource),
    Psf(PsfSource),
}

pub struct AudioSource {
    inner: AudioInner,
}

// SAFETY: AudioSource is only used behind a Mutex or passed to a single rodio Sink thread.
unsafe impl Send for AudioSource {}

impl AudioSource {
    pub fn open(path: &str) -> Result<Self, String> {
        // Check if this is a GME-supported format
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        if gme_source::GME_EXTENSIONS.contains(&ext.as_str()) {
            let gme = GmeSource::open(path)?;
            return Ok(AudioSource {
                inner: AudioInner::Gme(gme),
            });
        }

        if psf_source::PSF_EXTENSIONS.contains(&ext.as_str()) {
            let psf = PsfSource::open(path)?;
            return Ok(AudioSource {
                inner: AudioInner::Psf(psf),
            });
        }

        // Standard Symphonia path
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
            inner: AudioInner::Symphonia {
                decoder,
                format,
                track_id,
                buffer: initial_buffer,
                buffer_offset: 0,
                channels,
                sample_rate,
                total_duration,
            },
        })
    }
}

fn symphonia_read_next_packet(
    format: &mut Box<dyn FormatReader>,
    decoder: &mut Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    buffer: &mut Vec<i16>,
    buffer_offset: &mut usize,
    channels: &mut u16,
    sample_rate: &mut u32,
) -> bool {
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => return false,
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                *channels = spec.channels.count() as u16;
                *sample_rate = spec.rate;
                let duration =
                    symphonia::core::units::Duration::from(decoded.capacity() as u64);
                let mut sample_buf = SampleBuffer::<i16>::new(duration, spec);
                sample_buf.copy_interleaved_ref(decoded);
                *buffer = sample_buf.samples().to_vec();
                *buffer_offset = 0;
                if buffer.is_empty() {
                    continue;
                }
                return true;
            }
            Err(SymphError::DecodeError(_)) => continue,
            Err(_) => return false,
        }
    }
}

impl Iterator for AudioSource {
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        match &mut self.inner {
            AudioInner::Gme(gme) => gme.next(),
            AudioInner::Psf(psf) => psf.next(),
            AudioInner::Symphonia {
                ref mut decoder,
                ref mut format,
                track_id,
                ref mut buffer,
                ref mut buffer_offset,
                ref mut channels,
                ref mut sample_rate,
                ..
            } => {
                if *buffer_offset >= buffer.len() {
                    if !symphonia_read_next_packet(
                        format,
                        decoder,
                        *track_id,
                        buffer,
                        buffer_offset,
                        channels,
                        sample_rate,
                    ) {
                        return None;
                    }
                }
                let sample = buffer[*buffer_offset];
                *buffer_offset += 1;
                Some(sample)
            }
        }
    }
}

impl Source for AudioSource {
    fn current_frame_len(&self) -> Option<usize> {
        match &self.inner {
            AudioInner::Gme(gme) => gme.current_frame_len(),
            AudioInner::Psf(psf) => psf.current_frame_len(),
            AudioInner::Symphonia { buffer, buffer_offset, .. } => {
                Some(buffer.len().saturating_sub(*buffer_offset))
            }
        }
    }

    fn channels(&self) -> u16 {
        match &self.inner {
            AudioInner::Gme(gme) => gme.channels(),
            AudioInner::Psf(psf) => psf.channels(),
            AudioInner::Symphonia { channels, .. } => *channels,
        }
    }

    fn sample_rate(&self) -> u32 {
        match &self.inner {
            AudioInner::Gme(gme) => gme.sample_rate(),
            AudioInner::Psf(psf) => psf.sample_rate(),
            AudioInner::Symphonia { sample_rate, .. } => *sample_rate,
        }
    }

    fn total_duration(&self) -> Option<Duration> {
        match &self.inner {
            AudioInner::Gme(gme) => gme.total_duration(),
            AudioInner::Psf(psf) => psf.total_duration(),
            AudioInner::Symphonia { total_duration, .. } => *total_duration,
        }
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        match &mut self.inner {
            AudioInner::Gme(gme) => gme.try_seek(pos),
            AudioInner::Psf(psf) => psf.try_seek(pos),
            AudioInner::Symphonia {
                ref mut format,
                ref mut buffer,
                ref mut buffer_offset,
                ref mut decoder,
                track_id,
                ref mut channels,
                ref mut sample_rate,
                ..
            } => {
                use symphonia::core::formats::{SeekMode, SeekTo};

                let time = Time {
                    seconds: pos.as_secs(),
                    frac: pos.subsec_nanos() as f64 / 1_000_000_000.0,
                };

                format
                    .seek(SeekMode::Accurate, SeekTo::Time { time, track_id: None })
                    .map_err(|_| rodio::source::SeekError::NotSupported {
                        underlying_source: "seek not supported for this format",
                    })?;

                if !symphonia_read_next_packet(
                    format, decoder, *track_id, buffer, buffer_offset, channels, sample_rate,
                ) {
                    buffer.clear();
                    *buffer_offset = 0;
                }

                Ok(())
            }
        }
    }
}
