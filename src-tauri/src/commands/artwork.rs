use base64::Engine;
use tauri::{AppHandle, State};

use crate::db::Database;

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
