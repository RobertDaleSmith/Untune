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
    (d * 10.0).round() as i64
}

fn composite_key(artist: &str, album: &str, title: &str, duration: f64) -> String {
    format!(
        "{}|{}|{}|{}",
        normalize(artist),
        normalize(album),
        normalize(title),
        duration_bucket(duration)
    )
}

pub fn match_tracks(jxa_tracks: Vec<JxaTrack>, scanned_files: Vec<ScannedFile>) -> MatchResult {
    // Build hashmap from scanned files
    let mut file_map: HashMap<String, ScannedFile> = HashMap::new();
    let mut used_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    for file in &scanned_files {
        let artist = file.artist.as_deref().unwrap_or("");
        let album = file.album.as_deref().unwrap_or("");
        let title = file.title.as_deref().unwrap_or("");
        let duration = file.duration.unwrap_or(0.0);
        let key = composite_key(artist, album, title, duration);
        file_map.entry(key).or_insert_with(|| file.clone());
    }

    let mut merged = Vec::with_capacity(jxa_tracks.len() + 1000);
    let mut matched_count: u64 = 0;
    let mut unmatched_jxa: u64 = 0;

    // Match JXA tracks to files
    for jxa in &jxa_tracks {
        let artist = jxa.artist.as_deref().unwrap_or("");
        let album = jxa.album.as_deref().unwrap_or("");
        let title = &jxa.name;
        let duration = jxa.duration.unwrap_or(0.0);
        let key = composite_key(artist, album, title, duration);

        let (file_path, has_artwork) = if let Some(file) = file_map.get(&key) {
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
