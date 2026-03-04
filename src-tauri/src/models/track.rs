use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub persistent_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub track_count: Option<i32>,
    pub disc_number: Option<i32>,
    pub disc_count: Option<i32>,
    pub duration: Option<f64>,
    pub size: Option<i64>,
    pub bit_rate: Option<i32>,
    pub sample_rate: Option<i32>,
    pub play_count: Option<i32>,
    pub skip_count: Option<i32>,
    pub rating: Option<i32>,
    pub loved: Option<bool>,
    pub date_added: Option<String>,
    pub last_played_at: Option<String>,
    pub last_skipped_at: Option<String>,
    pub comments: Option<String>,
    pub grouping: Option<String>,
    pub sort_title: Option<String>,
    pub sort_artist: Option<String>,
    pub sort_album: Option<String>,
    pub sort_album_artist: Option<String>,
    pub sort_composer: Option<String>,
    pub file_path: Option<String>,
    pub artwork_hash: Option<String>,
    pub has_artwork: bool,
    pub mood: Option<String>,
    pub energy: Option<i32>,
    pub vibe_tags: Option<String>,
    pub bpm: Option<i32>,
    pub danceability: Option<i32>,
    pub acousticness: Option<i32>,
    pub ai_tagged_at: Option<String>,
    pub updated_at: Option<String>,
}

/// JXA bulk output: struct-of-arrays format (each field is a Vec)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JxaTrackData {
    pub persistent_id: Vec<String>,
    pub name: Vec<String>,
    pub artist: Vec<Option<String>>,
    pub album_artist: Vec<Option<String>>,
    pub album: Vec<Option<String>>,
    pub genre: Vec<Option<String>>,
    pub composer: Vec<Option<String>>,
    pub year: Vec<Option<i32>>,
    pub track_number: Vec<Option<i32>>,
    pub track_count: Vec<Option<i32>>,
    pub disc_number: Vec<Option<i32>>,
    pub disc_count: Vec<Option<i32>>,
    pub duration: Vec<Option<f64>>,
    pub size: Vec<Option<i64>>,
    pub bit_rate: Vec<Option<i32>>,
    pub sample_rate: Vec<Option<i32>>,
    pub play_count: Vec<Option<i32>>,
    pub skip_count: Vec<Option<i32>>,
    pub rating: Vec<Option<i32>>,
    pub loved: Vec<Option<bool>>,
    pub date_added: Vec<Option<String>>,
    pub last_played_at: Vec<Option<String>>,
    pub last_skipped_at: Vec<Option<String>>,
    pub comments: Vec<Option<String>>,
    pub grouping: Vec<Option<String>>,
    pub sort_name: Vec<Option<String>>,
    pub sort_artist: Vec<Option<String>>,
    pub sort_album: Vec<Option<String>>,
    pub sort_album_artist: Vec<Option<String>>,
    pub sort_composer: Vec<Option<String>>,
}

/// Single transposed JXA record
#[derive(Debug, Clone)]
pub struct JxaTrack {
    pub persistent_id: String,
    pub name: String,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub track_count: Option<i32>,
    pub disc_number: Option<i32>,
    pub disc_count: Option<i32>,
    pub duration: Option<f64>,
    pub size: Option<i64>,
    pub bit_rate: Option<i32>,
    pub sample_rate: Option<i32>,
    pub play_count: Option<i32>,
    pub skip_count: Option<i32>,
    pub rating: Option<i32>,
    pub loved: Option<bool>,
    pub date_added: Option<String>,
    pub last_played_at: Option<String>,
    pub last_skipped_at: Option<String>,
    pub comments: Option<String>,
    pub grouping: Option<String>,
    pub sort_name: Option<String>,
    pub sort_artist: Option<String>,
    pub sort_album: Option<String>,
    pub sort_album_artist: Option<String>,
    pub sort_composer: Option<String>,
}

impl JxaTrackData {
    pub fn transpose(self) -> Vec<JxaTrack> {
        let len = self.persistent_id.len();
        let mut tracks = Vec::with_capacity(len);
        let mut persistent_id = self.persistent_id.into_iter();
        let mut name = self.name.into_iter();
        let mut artist = self.artist.into_iter();
        let mut album_artist = self.album_artist.into_iter();
        let mut album = self.album.into_iter();
        let mut genre = self.genre.into_iter();
        let mut composer = self.composer.into_iter();
        let mut year = self.year.into_iter();
        let mut track_number = self.track_number.into_iter();
        let mut track_count = self.track_count.into_iter();
        let mut disc_number = self.disc_number.into_iter();
        let mut disc_count = self.disc_count.into_iter();
        let mut duration = self.duration.into_iter();
        let mut size = self.size.into_iter();
        let mut bit_rate = self.bit_rate.into_iter();
        let mut sample_rate = self.sample_rate.into_iter();
        let mut play_count = self.play_count.into_iter();
        let mut skip_count = self.skip_count.into_iter();
        let mut rating = self.rating.into_iter();
        let mut loved = self.loved.into_iter();
        let mut date_added = self.date_added.into_iter();
        let mut last_played_at = self.last_played_at.into_iter();
        let mut last_skipped_at = self.last_skipped_at.into_iter();
        let mut comments = self.comments.into_iter();
        let mut grouping = self.grouping.into_iter();
        let mut sort_name = self.sort_name.into_iter();
        let mut sort_artist = self.sort_artist.into_iter();
        let mut sort_album = self.sort_album.into_iter();
        let mut sort_album_artist = self.sort_album_artist.into_iter();
        let mut sort_composer = self.sort_composer.into_iter();

        for _ in 0..len {
            tracks.push(JxaTrack {
                persistent_id: persistent_id.next().unwrap(),
                name: name.next().unwrap(),
                artist: artist.next().unwrap(),
                album_artist: album_artist.next().unwrap(),
                album: album.next().unwrap(),
                genre: genre.next().unwrap(),
                composer: composer.next().unwrap(),
                year: year.next().unwrap(),
                track_number: track_number.next().unwrap(),
                track_count: track_count.next().unwrap(),
                disc_number: disc_number.next().unwrap(),
                disc_count: disc_count.next().unwrap(),
                duration: duration.next().unwrap(),
                size: size.next().unwrap(),
                bit_rate: bit_rate.next().unwrap(),
                sample_rate: sample_rate.next().unwrap(),
                play_count: play_count.next().unwrap(),
                skip_count: skip_count.next().unwrap(),
                rating: rating.next().unwrap(),
                loved: loved.next().unwrap(),
                date_added: date_added.next().unwrap(),
                last_played_at: last_played_at.next().unwrap(),
                last_skipped_at: last_skipped_at.next().unwrap(),
                comments: comments.next().unwrap(),
                grouping: grouping.next().unwrap(),
                sort_name: sort_name.next().unwrap(),
                sort_artist: sort_artist.next().unwrap(),
                sort_album: sort_album.next().unwrap(),
                sort_album_artist: sort_album_artist.next().unwrap(),
                sort_composer: sort_composer.next().unwrap(),
            });
        }
        tracks
    }
}

/// Filesystem scan result
#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub track_number: Option<i32>,
    pub has_artwork: bool,
    pub bit_rate: Option<i32>,
    pub sample_rate: Option<i32>,
}

/// Combined record ready for DB insert
#[derive(Debug, Clone)]
pub struct MergedTrack {
    pub persistent_id: Option<String>,
    pub title: String,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub track_count: Option<i32>,
    pub disc_number: Option<i32>,
    pub disc_count: Option<i32>,
    pub duration: Option<f64>,
    pub size: Option<i64>,
    pub bit_rate: Option<i32>,
    pub sample_rate: Option<i32>,
    pub play_count: Option<i32>,
    pub skip_count: Option<i32>,
    pub rating: Option<i32>,
    pub loved: Option<bool>,
    pub date_added: Option<String>,
    pub last_played_at: Option<String>,
    pub last_skipped_at: Option<String>,
    pub comments: Option<String>,
    pub grouping: Option<String>,
    pub sort_title: Option<String>,
    pub sort_artist: Option<String>,
    pub sort_album: Option<String>,
    pub sort_album_artist: Option<String>,
    pub sort_composer: Option<String>,
    pub file_path: Option<String>,
    pub has_artwork: bool,
}
