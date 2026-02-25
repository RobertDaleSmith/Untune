use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub persistent_id: String,
    pub name: String,
    pub is_smart: bool,
    pub is_folder: bool,
    pub parent_id: Option<i64>,
    pub sort_order: i32,
    pub track_count: i32,
    pub rules_json: Option<String>,
}

/// JXA playlist extraction output
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JxaPlaylist {
    pub persistent_id: String,
    pub name: String,
    pub is_smart: bool,
    pub is_folder: bool,
    pub parent_persistent_id: Option<String>,
    pub track_persistent_ids: Vec<String>,
}
