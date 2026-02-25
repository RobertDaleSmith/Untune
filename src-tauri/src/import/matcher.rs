use std::collections::HashMap;

use crate::models::{JxaTrack, MergedTrack, ScannedFile};

pub struct MatchResult {
    pub merged: Vec<MergedTrack>,
    pub matched: u64,
    pub unmatched_jxa: u64,
    pub unmatched_files: u64,
}

fn normalize(s: &str) -> String {
    s.to_lowercase().trim().to_string()
}

fn duration_bucket(d: f64) -> i64 {
    d.round() as i64
}

/// Pass 1: artist + album + title + duration (rounded to nearest second)
fn key_full(artist: &str, album: &str, title: &str, duration: f64) -> String {
    format!(
        "{}|{}|{}|{}",
        normalize(artist),
        normalize(album),
        normalize(title),
        duration_bucket(duration)
    )
}

/// Pass 2: artist + album + title (no duration — catches duration mismatches)
fn key_no_duration(artist: &str, album: &str, title: &str) -> String {
    format!(
        "{}|{}|{}",
        normalize(artist),
        normalize(album),
        normalize(title),
    )
}

/// Pass 3: artist + album + track_number (catches title variations like "feat." differences)
fn key_album_track(artist: &str, album: &str, track_number: Option<i32>) -> Option<String> {
    let tn = track_number?;
    if tn <= 0 { return None; }
    Some(format!(
        "{}|{}|{}",
        normalize(artist),
        normalize(album),
        tn,
    ))
}

/// Pass 4: artist + title + duration (no album — catches album name mismatches)
fn key_artist_title_dur(artist: &str, title: &str, duration: f64) -> String {
    format!(
        "{}|{}|{}",
        normalize(artist),
        normalize(title),
        duration_bucket(duration)
    )
}

/// Pass 5: artist + title (no album, no duration)
fn key_artist_title(artist: &str, title: &str) -> String {
    format!("{}|{}", normalize(artist), normalize(title))
}

/// Pass 6: title + duration (no artist — catches missing artist tags in files)
fn key_title_dur(title: &str, duration: f64) -> String {
    format!("{}|{}", normalize(title), duration_bucket(duration))
}

pub fn match_tracks(jxa_tracks: Vec<JxaTrack>, scanned_files: Vec<ScannedFile>) -> MatchResult {
    let mut used_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Build lookup maps for scanned files (multiple passes)
    let mut map_full: HashMap<String, Vec<usize>> = HashMap::new();
    let mut map_no_dur: HashMap<String, Vec<usize>> = HashMap::new();
    let mut map_album_track: HashMap<String, Vec<usize>> = HashMap::new();
    let mut map_artist_title_dur: HashMap<String, Vec<usize>> = HashMap::new();
    let mut map_artist_title: HashMap<String, Vec<usize>> = HashMap::new();
    let mut map_title_dur: HashMap<String, Vec<usize>> = HashMap::new();

    for (idx, file) in scanned_files.iter().enumerate() {
        let artist = file.artist.as_deref().unwrap_or("");
        let album = file.album.as_deref().unwrap_or("");
        let title = file.title.as_deref().unwrap_or("");
        let duration = file.duration.unwrap_or(0.0);

        let k1 = key_full(artist, album, title, duration);
        map_full.entry(k1).or_default().push(idx);

        let k2 = key_no_duration(artist, album, title);
        map_no_dur.entry(k2).or_default().push(idx);

        if let Some(k3) = key_album_track(artist, album, file.track_number) {
            map_album_track.entry(k3).or_default().push(idx);
        }

        let k4 = key_artist_title_dur(artist, title, duration);
        map_artist_title_dur.entry(k4).or_default().push(idx);

        let k5 = key_artist_title(artist, title);
        map_artist_title.entry(k5).or_default().push(idx);

        if !title.is_empty() && duration > 0.0 {
            let k6 = key_title_dur(title, duration);
            map_title_dur.entry(k6).or_default().push(idx);
        }
    }

    // Helper: find first unused file index from a list of candidates
    let find_unused = |candidates: &[usize], used: &std::collections::HashSet<String>| -> Option<usize> {
        candidates.iter().copied().find(|&idx| !used.contains(&scanned_files[idx].path))
    };

    let mut merged = Vec::with_capacity(jxa_tracks.len() + 1000);
    let mut matched_count: u64 = 0;
    let mut unmatched_jxa: u64 = 0;

    for jxa in &jxa_tracks {
        let artist = jxa.artist.as_deref().unwrap_or("");
        let album = jxa.album.as_deref().unwrap_or("");
        let title = &jxa.name;
        let duration = jxa.duration.unwrap_or(0.0);

        // Try passes in order (most specific to least specific)
        let matched_idx = {
            // Pass 1: artist + album + title + duration
            let k1 = key_full(artist, album, title, duration);
            map_full.get(&k1).and_then(|c| find_unused(c, &used_files))
        }
        .or_else(|| {
            // Pass 2: artist + album + title (no duration)
            let k2 = key_no_duration(artist, album, title);
            map_no_dur.get(&k2).and_then(|c| find_unused(c, &used_files))
        })
        .or_else(|| {
            // Pass 3: artist + album + track_number
            key_album_track(artist, album, jxa.track_number)
                .and_then(|k3| map_album_track.get(&k3).and_then(|c| find_unused(c, &used_files)))
        })
        .or_else(|| {
            // Pass 4: artist + title + duration (no album — catches album name mismatches)
            let k4 = key_artist_title_dur(artist, title, duration);
            map_artist_title_dur.get(&k4).and_then(|c| find_unused(c, &used_files))
        })
        .or_else(|| {
            // Pass 5: artist + title (no album, no duration)
            let k5 = key_artist_title(artist, title);
            map_artist_title.get(&k5).and_then(|c| find_unused(c, &used_files))
        })
        .or_else(|| {
            // Pass 6: title + duration (catches files with missing/wrong artist tags)
            if !title.is_empty() && duration > 0.0 {
                let k6 = key_title_dur(title, duration);
                map_title_dur.get(&k6).and_then(|c| find_unused(c, &used_files))
            } else {
                None
            }
        });

        let (file_path, has_artwork) = if let Some(idx) = matched_idx {
            let file = &scanned_files[idx];
            used_files.insert(file.path.clone());
            matched_count += 1;
            (Some(file.path.clone()), file.has_artwork)
        } else {
            unmatched_jxa += 1;
            (None, false)
        };

        merged.push(MergedTrack {
            persistent_id: Some(jxa.persistent_id.clone()),
            title: jxa.name.clone(),
            artist: jxa.artist.clone(),
            album_artist: jxa.album_artist.clone(),
            album: jxa.album.clone(),
            genre: jxa.genre.clone(),
            composer: jxa.composer.clone(),
            year: jxa.year,
            track_number: jxa.track_number,
            track_count: jxa.track_count,
            disc_number: jxa.disc_number,
            disc_count: jxa.disc_count,
            duration: jxa.duration,
            size: jxa.size,
            bit_rate: jxa.bit_rate,
            sample_rate: jxa.sample_rate,
            play_count: jxa.play_count,
            skip_count: jxa.skip_count,
            rating: jxa.rating,
            loved: jxa.loved,
            date_added: jxa.date_added.clone(),
            last_played_at: jxa.last_played_at.clone(),
            last_skipped_at: jxa.last_skipped_at.clone(),
            comments: jxa.comments.clone(),
            grouping: jxa.grouping.clone(),
            sort_title: jxa.sort_name.clone(),
            sort_artist: jxa.sort_artist.clone(),
            sort_album: jxa.sort_album.clone(),
            sort_album_artist: jxa.sort_album_artist.clone(),
            sort_composer: jxa.sort_composer.clone(),
            file_path,
            has_artwork,
        });
    }

    // Add unmatched filesystem files
    let mut unmatched_files: u64 = 0;
    for file in scanned_files {
        if !used_files.contains(&file.path) {
            unmatched_files += 1;
            merged.push(MergedTrack {
                persistent_id: None,
                title: file
                    .title
                    .unwrap_or_else(|| {
                        std::path::Path::new(&file.path)
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string()
                    }),
                artist: file.artist,
                album_artist: None,
                album: file.album,
                genre: None,
                composer: None,
                year: None,
                track_number: file.track_number,
                track_count: None,
                disc_number: None,
                disc_count: None,
                duration: file.duration,
                size: None,
                bit_rate: file.bit_rate,
                sample_rate: file.sample_rate,
                play_count: None,
                skip_count: None,
                rating: None,
                loved: None,
                date_added: None,
                last_played_at: None,
                last_skipped_at: None,
                comments: None,
                grouping: None,
                sort_title: None,
                sort_artist: None,
                sort_album: None,
                sort_album_artist: None,
                sort_composer: None,
                file_path: Some(file.path),
                has_artwork: file.has_artwork,
            });
        }
    }

    MatchResult {
        merged,
        matched: matched_count,
        unmatched_jxa,
        unmatched_files,
    }
}
