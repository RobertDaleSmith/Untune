use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::Database;
use crate::import::bio_generator;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BioResult {
    pub bio: String,
    pub generated_at: String,
    pub cached: bool,
}

#[tauri::command]
pub async fn get_bio(
    app: AppHandle,
    entity_type: String,
    entity_name: String,
    entity_detail: Option<String>,
) -> Result<BioResult, String> {
    let detail = entity_detail.unwrap_or_default();

    // Check cache first
    {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let cached: Option<(String, String)> = conn
            .query_row(
                "SELECT bio, generated_at FROM bios WHERE entity_type = ? AND entity_name = ? AND entity_detail = ?",
                params![entity_type, entity_name, detail],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        if let Some((bio, generated_at)) = cached {
            return Ok(BioResult {
                bio,
                generated_at,
                cached: true,
            });
        }
    }

    // Get API key
    let api_key = {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        crate::db::get_preference(&conn, "anthropic_api_key")
            .ok()
            .flatten()
            .filter(|k| !k.is_empty())
            .or_else(|| {
                app.state::<crate::assistant::state::AssistantState>().get_api_key()
            })
    };

    let api_key = api_key.ok_or("No API key configured for bio generation")?;

    // Generate bio
    let bio = bio_generator::generate_bio(&api_key, &entity_type, &entity_name, &detail).await?;

    // Cache it
    {
        let db = app.state::<Database>();
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO bios (entity_type, entity_name, entity_detail, bio, generated_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))
             ON CONFLICT(entity_type, entity_name, entity_detail)
             DO UPDATE SET bio = ?4, generated_at = datetime('now')",
            params![entity_type, entity_name, detail, bio],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(BioResult {
        bio,
        generated_at: chrono_now(),
        cached: false,
    })
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono dependency
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}
