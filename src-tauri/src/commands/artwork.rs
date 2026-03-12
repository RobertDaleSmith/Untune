use base64::Engine;
use lofty::file::TaggedFileExt;
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::db::{self, Database};
use crate::import::artwork::hash_and_save;

/// Returns artwork as a data URL (data:image/...;base64,...) for the given hash.
#[tauri::command]
pub fn get_artwork_data_url(
    artwork_hash: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Option<String>, String> {
    let _ = db;
    let artwork_dir = Database::artwork_dir(&app).map_err(|e| e.to_string())?;

    for (ext, mime) in &[("jpg", "image/jpeg"), ("png", "image/png")] {
        let path = artwork_dir.join(format!("{}.{}", artwork_hash, ext));
        if path.exists() {
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            return Ok(Some(format!("data:{};base64,{}", mime, b64)));
        }
    }
    Ok(None)
}

/// Returns all embedded artwork from a track's audio file as data URLs.
#[tauri::command]
pub fn get_track_all_artworks(
    track_id: i64,
    db: State<'_, Database>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let file_path = db::get_track_file_info(&conn, track_id)
        .map_err(|e| e.to_string())?
        .map(|(p, _)| p);
    drop(conn);

    let Some(path) = file_path else {
        return Ok(vec![]);
    };

    let tagged_file = lofty::read_from_path(&path).map_err(|e| e.to_string())?;
    let mut urls = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for tag in tagged_file.tags() {
        for picture in tag.pictures() {
            let data = picture.data();
            if data.is_empty() {
                continue;
            }
            // Deduplicate by content
            let hash = {
                use sha2::{Digest, Sha256};
                let mut h = Sha256::new();
                h.update(data);
                format!("{:x}", h.finalize())
            };
            if !seen.insert(hash) {
                continue;
            }
            let mime = if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                "image/png"
            } else {
                "image/jpeg"
            };
            let b64 = base64::engine::general_purpose::STANDARD.encode(data);
            urls.push(format!("data:{};base64,{}", mime, b64));
        }
    }

    Ok(urls)
}

// --- iTunes artwork search ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkSearchResult {
    pub thumbnail_url: String,
    pub full_url: String,
    pub album_name: String,
    pub artist_name: String,
    pub source: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ITunesSearchResponse {
    results: Vec<ITunesAlbumResult>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ITunesAlbumResult {
    artwork_url100: Option<String>,
    collection_name: Option<String>,
    artist_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyArtworkResult {
    pub artwork_hash: String,
    pub updated_track_ids: Vec<i64>,
}

#[tauri::command]
pub async fn search_artwork(
    artist: String,
    album: String,
) -> Result<Vec<ArtworkSearchResult>, String> {
    let query = if !artist.is_empty() && !album.is_empty() {
        format!("{} {}", artist, album)
    } else if !album.is_empty() {
        album.clone()
    } else {
        artist.clone()
    };

    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=album&limit=20",
        urlencoded(&query)
    );

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("iTunes search request failed: {}", e))?;

    let body: ITunesSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse iTunes response: {}", e))?;

    let results: Vec<ArtworkSearchResult> = body
        .results
        .into_iter()
        .filter_map(|r| {
            let thumb = r.artwork_url100.as_ref()?;
            let full = thumb.replace("100x100bb", "600x600bb");
            Some(ArtworkSearchResult {
                thumbnail_url: thumb.clone(),
                full_url: full,
                album_name: r.collection_name.unwrap_or_default(),
                artist_name: r.artist_name.unwrap_or_default(),
                source: "iTunes".to_string(),
            })
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn apply_artwork_from_url(
    image_url: String,
    album: String,
    artist: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<ApplyArtworkResult, String> {
    let bytes = reqwest::get(&image_url)
        .await
        .map_err(|e| format!("Failed to download artwork: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Failed to read artwork bytes: {}", e))?;

    let artwork_dir = Database::artwork_dir(&app).map_err(|e| e.to_string())?;
    let artwork_hash =
        hash_and_save(&bytes, &artwork_dir).ok_or_else(|| "Failed to save artwork".to_string())?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let updated_track_ids = db::update_artwork_for_album(&conn, &artwork_hash, &album, &artist)
        .map_err(|e| format!("Failed to update tracks: {}", e))?;

    Ok(ApplyArtworkResult {
        artwork_hash,
        updated_track_ids,
    })
}

/// Apply artwork from raw bytes (base64 data URL) to all tracks of an album.
#[tauri::command]
pub fn apply_artwork_from_data(
    data_url: String,
    album: String,
    artist: String,
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<ApplyArtworkResult, String> {
    // Parse data URL: "data:image/jpeg;base64,..."
    let b64_start = data_url.find(",").ok_or("Invalid data URL")? + 1;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_url[b64_start..])
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let artwork_dir = Database::artwork_dir(&app).map_err(|e| e.to_string())?;
    let artwork_hash =
        hash_and_save(&bytes, &artwork_dir).ok_or_else(|| "Failed to save artwork".to_string())?;

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let updated_track_ids = db::update_artwork_for_album(&conn, &artwork_hash, &album, &artist)
        .map_err(|e| format!("Failed to update tracks: {}", e))?;

    Ok(ApplyArtworkResult {
        artwork_hash,
        updated_track_ids,
    })
}

/// Find all image files in the album directory for a given album+artist.
/// Returns data URLs for each image found.
#[tauri::command]
pub fn get_album_folder_images(
    album: String,
    artist: String,
    db: State<'_, Database>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Find a track with a file_path for this album+artist
    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM tracks
             WHERE file_path IS NOT NULL
               AND COALESCE(album, '(Unknown Album)') = ?1
               AND COALESCE(album_artist, artist, '(Unknown Artist)') = ?2
             LIMIT 1",
            rusqlite::params![album, artist],
            |row| row.get(0),
        )
        .ok();

    let Some(fp) = file_path else {
        return Ok(vec![]);
    };

    let parent = std::path::Path::new(&fp).parent().ok_or("No parent dir")?;
    if !parent.exists() {
        return Ok(vec![]);
    }

    let image_exts = ["jpg", "jpeg", "png", "webp", "bmp", "gif"];
    let mut urls = Vec::new();

    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !image_exts.contains(&ext.as_str()) {
                continue;
            }
            if let Ok(data) = std::fs::read(&path) {
                if data.is_empty() {
                    continue;
                }
                let mime = match ext.as_str() {
                    "png" => "image/png",
                    "webp" => "image/webp",
                    "bmp" => "image/bmp",
                    "gif" => "image/gif",
                    _ => "image/jpeg",
                };
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                urls.push(format!("data:{};base64,{}", mime, b64));
            }
        }
    }

    Ok(urls)
}

fn urlencoded(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}
