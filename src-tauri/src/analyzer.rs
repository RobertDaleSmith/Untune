use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::Source;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::Serialize;

const FFT_SIZE: usize = 2048;
const NUM_BANDS: usize = 64;
const WAVEFORM_SIZE: usize = 128;

#[derive(Clone, Serialize)]
pub struct FrequencyData {
    pub bands: Vec<f32>,
    pub waveform: Vec<f32>,
    pub energy: f32,
}

impl Default for FrequencyData {
    fn default() -> Self {
        FrequencyData {
            bands: vec![0.0; NUM_BANDS],
            waveform: vec![0.0; WAVEFORM_SIZE],
            energy: 0.0,
        }
    }
}

pub type SharedFrequencyData = Arc<Mutex<FrequencyData>>;

pub fn new_shared_frequency_data() -> SharedFrequencyData {
    Arc::new(Mutex::new(FrequencyData::default()))
}

/// Wraps an audio source to tap samples for FFT analysis without modifying audio output.
pub struct AnalyzedSource<S>
where
    S: Source<Item = i16>,
{
    inner: S,
    shared: SharedFrequencyData,
    ring_buffer: Vec<f32>,
    ring_pos: usize,
    mono_count: usize,
    channel_index: u16,
    channels: u16,
    fft: Arc<dyn Fft<f32>>,
    hann_window: Vec<f32>,
}

// SAFETY: AnalyzedSource is only passed to a single rodio Sink thread.
unsafe impl<S: Source<Item = i16>> Send for AnalyzedSource<S> {}

impl<S> AnalyzedSource<S>
where
    S: Source<Item = i16>,
{
    pub fn new(inner: S, shared: SharedFrequencyData) -> Self {
        let channels = inner.channels();
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);

        let hann_window: Vec<f32> = (0..FFT_SIZE)
            .map(|i| {
                0.5 * (1.0
                    - (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos())
            })
            .collect();

        AnalyzedSource {
            inner,
            shared,
            ring_buffer: vec![0.0; FFT_SIZE],
            ring_pos: 0,
            mono_count: 0,
            channel_index: 0,
            channels,
            fft,
            hann_window,
        }
    }

    fn run_fft(&self) {
        let mut fft_input: Vec<Complex<f32>> = Vec::with_capacity(FFT_SIZE);
        for i in 0..FFT_SIZE {
            let idx = (self.ring_pos + i) % FFT_SIZE;
            let windowed = self.ring_buffer[idx] * self.hann_window[i];
            fft_input.push(Complex::new(windowed, 0.0));
        }

        self.fft.process(&mut fft_input);

        let half = FFT_SIZE / 2;

        let magnitudes: Vec<f32> = fft_input[..half]
            .iter()
            .map(|c| (c.re * c.re + c.im * c.im).sqrt() / (FFT_SIZE as f32))
            .collect();

        // Aggregate into log-scaled bands
        let mut bands = vec![0.0f32; NUM_BANDS];
        for band in 0..NUM_BANDS {
            let lo = ((band as f32 / NUM_BANDS as f32).powf(2.0) * half as f32) as usize;
            let hi = (((band + 1) as f32 / NUM_BANDS as f32).powf(2.0) * half as f32) as usize;
            let lo = lo.min(half - 1);
            let hi = hi.max(lo + 1).min(half);

            let mut sum = 0.0f32;
            for bin in lo..hi {
                sum += magnitudes[bin];
            }
            let avg = sum / (hi - lo) as f32;
            bands[band] = (avg * 20.0).min(1.0);
        }

        // Downsample ring buffer for waveform snapshot
        let mut waveform = vec![0.0f32; WAVEFORM_SIZE];
        let step = FFT_SIZE / WAVEFORM_SIZE;
        for i in 0..WAVEFORM_SIZE {
            let idx = (self.ring_pos + i * step) % FFT_SIZE;
            waveform[i] = self.ring_buffer[idx];
        }

        let energy = bands.iter().sum::<f32>() / NUM_BANDS as f32;

        if let Ok(mut data) = self.shared.lock() {
            data.bands = bands;
            data.waveform = waveform;
            data.energy = energy;
        }
    }
}

impl<S> Iterator for AnalyzedSource<S>
where
    S: Source<Item = i16>,
{
    type Item = i16;

    fn next(&mut self) -> Option<i16> {
        let sample = self.inner.next()?;

        // Write only channel 0 to the ring buffer for mono analysis
        if self.channel_index == 0 {
            let mono = sample as f32 / 32768.0;
            self.ring_buffer[self.ring_pos] = mono;
            self.ring_pos = (self.ring_pos + 1) % FFT_SIZE;
            self.mono_count += 1;

            if self.mono_count >= FFT_SIZE {
                self.run_fft();
                self.mono_count = 0;
            }
        }

        self.channel_index += 1;
        if self.channel_index >= self.channels {
            self.channel_index = 0;
        }

        Some(sample)
    }
}

impl<S> Source for AnalyzedSource<S>
where
    S: Source<Item = i16>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), rodio::source::SeekError> {
        let result = self.inner.try_seek(pos);
        self.ring_buffer.fill(0.0);
        self.ring_pos = 0;
        self.mono_count = 0;
        self.channel_index = 0;
        result
    }
}
