use lofty::file::TaggedFileExt;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::db::Database;

pub fn extract_artwork_background(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let artwork_dir = Database::artwork_dir(app)?;

    // Get all tracks with has_artwork = true and no artwork_hash yet
    let db_state = app.state::<Database>();
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, file_path FROM tracks WHERE has_artwork = 1 AND artwork_hash IS NULL AND file_path IS NOT NULL",
    )?;

    let tracks: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    drop(stmt);
    drop(conn);

    log::info!("Background artwork extraction: {} tracks to process", tracks.len());

    for (track_id, file_path) in &tracks {
        if let Some(hash) = extract_and_save_artwork(file_path, &artwork_dir) {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "UPDATE tracks SET artwork_hash = ?1 WHERE id = ?2",
                rusqlite::params![hash, track_id],
            );
        }
    }

    log::info!("Background artwork extraction complete");
    Ok(())
}

pub fn extract_and_save_artwork(file_path: &str, artwork_dir: &Path) -> Option<String> {
    let tagged_file = lofty::read_from_path(file_path).ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    let picture = tag.pictures().first()?;

    let data = picture.data();
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = format!("{:x}", hasher.finalize());

    let ext = match picture.mime_type() {
        Some(lofty::picture::MimeType::Png) => "png",
        _ => "jpg",
    };

    let artwork_path = artwork_dir.join(format!("{}.{}", hash, ext));
    if !artwork_path.exists() {
        let _ = std::fs::write(&artwork_path, data);
    }

    Some(hash)
}
