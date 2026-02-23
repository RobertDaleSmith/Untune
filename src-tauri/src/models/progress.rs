use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: String,
    pub message: String,
    pub current: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    pub total_tracks: u64,
    pub jxa_tracks: u64,
    pub scanned_files: u64,
    pub matched: u64,
    pub unmatched_jxa: u64,
    pub unmatched_files: u64,
    pub playlists: u64,
}
