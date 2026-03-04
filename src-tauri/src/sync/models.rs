use serde::{Deserialize, Serialize};

/// Pairing request from iOS
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub code: String,
    pub device_name: String,
}

/// Pairing response to iOS
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairResponse {
    pub device_id: String,
    pub pairing_token: String,
    pub desktop_name: String,
}

/// Track metadata for sync (subset of Track, camelCase for JSON)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTrackMeta {
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
    pub file_extension: Option<String>,
}

/// Playlist metadata for sync
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlaylistMeta {
    pub id: i64,
    pub persistent_id: String,
    pub name: String,
    pub is_smart: bool,
    pub is_folder: bool,
    pub parent_id: Option<i64>,
    pub sort_order: i32,
    pub track_count: i32,
    pub track_ids: Vec<i64>,
}

/// Full sync manifest — everything a device needs
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    pub playlists: Vec<SyncPlaylistMeta>,
    pub tracks: Vec<SyncTrackMeta>,
}

/// Delta sync request from iOS
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeltaRequest {
    pub since: Option<String>,
}

/// Delta sync response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncDelta {
    pub playlists: Vec<SyncPlaylistMeta>,
    pub tracks: Vec<SyncTrackMeta>,
    pub removed_track_ids: Vec<i64>,
    pub removed_playlist_ids: Vec<i64>,
    pub sync_timestamp: String,
}

/// Play stats from iOS
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayStatsDelta {
    pub track_id: i64,
    pub play_count_delta: i32,
    pub skip_count_delta: i32,
    pub last_played_at: Option<String>,
    pub last_skipped_at: Option<String>,
}

/// Batch play stats upload
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayStatsUpload {
    pub stats: Vec<PlayStatsDelta>,
}

/// Sync complete notification
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SyncCompleteRequest {
    pub synced_track_ids: Vec<i64>,
    pub synced_playlist_ids: Vec<i64>,
}
