use std::path::Path;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use rayon::prelude::*;
use walkdir::WalkDir;

use crate::models::ScannedFile;

const AUDIO_EXTENSIONS: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "aif", "aiff", "wav", "ogg", "alac",
    "spc", "nsf", "nsfe", "gbs", "vgm", "vgz", "gym", "ay", "hes", "kss", "sap",
];

pub fn scan_directory<F>(
    dir: &Path,
    progress_callback: F,
) -> Result<Vec<ScannedFile>, Box<dyn std::error::Error>>
where
    F: Fn(u64, u64) + Send + Sync,
{
    // First, collect all audio file paths
    let paths: Vec<_> = WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                    .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect();

    let total = paths.len() as u64;
    let counter = std::sync::atomic::AtomicU64::new(0);

    let results: Vec<ScannedFile> = paths
        .par_iter()
        .filter_map(|path| {
            let current = counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if current % 500 == 0 {
                progress_callback(current, total);
            }
            parse_audio_file(path)
        })
        .collect();

    progress_callback(total, total);
    Ok(results)
}

fn parse_audio_file(path: &Path) -> Option<ScannedFile> {
    let tagged_file = lofty::read_from_path(path).ok()?;
    let properties = tagged_file.properties();
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let (title, artist, album, track_number) = if let Some(t) = tag {
        (
            t.title().map(|s| s.to_string()),
            t.artist().map(|s| s.to_string()),
            t.album().map(|s| s.to_string()),
            t.track().map(|n| n as i32),
        )
    } else {
        (None, None, None, None)
    };

    let has_artwork = tagged_file.tags().iter().any(|t| !t.pictures().is_empty());

    let duration_secs = properties.duration().as_secs_f64();
    let bit_rate = properties.audio_bitrate().map(|b| b as i32);
    let sample_rate = properties.sample_rate().map(|s| s as i32);

    Some(ScannedFile {
        path: path.to_string_lossy().to_string(),
        title,
        artist,
        album,
        duration: if duration_secs > 0.0 {
            Some(duration_secs)
        } else {
            None
        },
        track_number,
        has_artwork,
        bit_rate,
        sample_rate,
    })
}
