use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub album: String,
    pub artist: String,
    pub track_count: i64,
    pub total_duration: f64,
    pub year: Option<i32>,
    pub artwork_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSummary {
    pub name: String,
    pub album_count: i64,
    pub track_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreSummary {
    pub name: String,
    pub track_count: i64,
}
