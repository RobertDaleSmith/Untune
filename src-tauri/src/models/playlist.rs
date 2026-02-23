use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub persistent_id: String,
    pub name: String,
    pub is_smart: bool,
    pub track_count: i32,
}

/// JXA playlist extraction output
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JxaPlaylist {
    pub persistent_id: String,
    pub name: String,
    pub is_smart: bool,
    pub track_persistent_ids: Vec<String>,
}
