use lofty::file::TaggedFileExt;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::db::{self, Database};

const FOLDER_ART_NAMES: &[&str] = &[
    "cover.jpg",
    "cover.png",
    "folder.jpg",
    "folder.png",
    "artwork.jpg",
    "artwork.png",
    "front.jpg",
    "front.png",
];

pub fn extract_artwork_background(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let artwork_dir = Database::artwork_dir(app)?;

    let db_state = app.state::<Database>();
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let tracks = db::get_tracks_missing_artwork(&conn)?;
    drop(conn);

    log::info!(
        "Background artwork extraction: {} tracks to process",
        tracks.len()
    );

    // Open Apple Music artwork DB once (may not exist)
    let amp_db = open_apple_music_artwork_db();
    if amp_db.is_some() {
        log::info!("Apple Music artwork cache found");
    }

    let mut embedded_count = 0u32;
    let mut cache_count = 0u32;
    let mut folder_count = 0u32;

    for (track_id, persistent_id, file_path, _has_artwork) in &tracks {
        // 1. Try embedded artwork (if file exists)
        let hash = file_path
            .as_deref()
            .and_then(|fp| extract_and_save_artwork(fp, &artwork_dir));

        // 2. Try Apple Music artwork cache (works even without file_path)
        let hash = hash.or_else(|| {
            persistent_id
                .as_deref()
                .and_then(|pid| try_apple_music_cache(pid, &artwork_dir, amp_db.as_ref()))
        });

        // 3. Try folder artwork (if file exists)
        let hash = hash.or_else(|| {
            file_path
                .as_deref()
                .and_then(|fp| try_folder_artwork(fp, &artwork_dir))
        });

        if let Some(ref h) = hash {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "UPDATE tracks SET artwork_hash = ?1 WHERE id = ?2",
                rusqlite::params![h, track_id],
            );
            if file_path.is_some() {
                embedded_count += 1;
            } else if persistent_id.is_some() {
                cache_count += 1;
            } else {
                folder_count += 1;
            }
        }
    }

    log::info!(
        "Artwork extraction complete: {} embedded, {} from Apple Music cache, {} from folder art",
        embedded_count,
        cache_count,
        folder_count
    );
    Ok(())
}

pub fn extract_and_save_artwork(file_path: &str, artwork_dir: &Path) -> Option<String> {
    let tagged_file = lofty::read_from_path(file_path).ok()?;

    // Try all tags, not just primary — some files have pictures in secondary tags
    for tag in tagged_file.tags() {
        if let Some(picture) = tag.pictures().first() {
            let data = picture.data();
            if let Some(hash) = hash_and_save(data, artwork_dir) {
                return Some(hash);
            }
        }
    }
    None
}

fn hash_and_save(data: &[u8], artwork_dir: &Path) -> Option<String> {
    if data.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = format!("{:x}", hasher.finalize());

    // Detect format from magic bytes
    let ext = if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "png"
    } else {
        "jpg"
    };

    let artwork_path = artwork_dir.join(format!("{}.{}", hash, ext));
    if !artwork_path.exists() {
        let _ = std::fs::write(&artwork_path, data);
    }

    Some(hash)
}

/// Open the Apple Music AMP artwork agent SQLite database (read-only).
fn open_apple_music_artwork_db() -> Option<Connection> {
    let home = dirs::home_dir()?;
    let db_path = home
        .join("Library/Containers/com.apple.AMPArtworkAgent/Data/Documents/artworkd.sqlite");
    if !db_path.exists() {
        return None;
    }
    Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

/// Look up artwork via Apple Music's artwork cache DB.
/// persistent_id is a hex string from JXA. Convert hex → u64 → reinterpret as i64.
fn try_apple_music_cache(
    persistent_id: &str,
    artwork_dir: &Path,
    amp_conn: Option<&Connection>,
) -> Option<String> {
    let conn = amp_conn?;
    let pid_u64 = u64::from_str_radix(persistent_id, 16).ok()?;
    let pid_i64 = pid_u64 as i64;

    // Query the artwork DB: ZDATABASEITEMINFO → ZSOURCEINFO → ZIMAGEINFO
    let result: Option<(String, i64)> = conn
        .query_row(
            "SELECT img.ZHASHSTRING, img.ZKIND
             FROM ZDATABASEITEMINFO di
             JOIN ZSOURCEINFO si ON si.ZDATABASEITEMINFO = di.Z_PK
             JOIN ZIMAGEINFO img ON img.ZSOURCEINFO = si.Z_PK
             WHERE di.ZPERSISTENTID = ?1
             LIMIT 1",
            rusqlite::params![pid_i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();

    let (hash_string, kind) = result?;

    // Construct the filename and look for the image
    let home = dirs::home_dir()?;
    let artwork_base = home.join(
        "Library/Containers/com.apple.AMPArtworkAgent/Data/Documents/artwork",
    );

    // Try jpeg first, then png
    let filename_jpeg = format!("{}_sk_{}_cid_1.jpeg", hash_string, kind);
    let filename_png = format!("{}_sk_{}_cid_1.png", hash_string, kind);

    let src_path = {
        let jpeg_path = artwork_base.join(&filename_jpeg);
        if jpeg_path.exists() {
            jpeg_path
        } else {
            let png_path = artwork_base.join(&filename_png);
            if png_path.exists() {
                png_path
            } else {
                return None;
            }
        }
    };

    let data = std::fs::read(&src_path).ok()?;
    hash_and_save(&data, artwork_dir)
}

/// Check the directory containing the audio file for common artwork filenames.
fn try_folder_artwork(file_path: &str, artwork_dir: &Path) -> Option<String> {
    let audio_path = Path::new(file_path);
    let parent = audio_path.parent()?;

    for name in FOLDER_ART_NAMES {
        let candidate = parent.join(name);
        if candidate.exists() {
            let data = std::fs::read(&candidate).ok()?;
            return hash_and_save(&data, artwork_dir);
        }
    }

    None
}
