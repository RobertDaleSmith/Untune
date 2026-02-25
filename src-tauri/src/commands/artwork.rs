use base64::Engine;
use lofty::file::TaggedFileExt;
use tauri::{AppHandle, State};

use crate::db::{self, Database};

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
