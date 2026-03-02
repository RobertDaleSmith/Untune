use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTagRecord {
    pub persistent_id: String,
    pub mood: Option<String>,
    pub energy: Option<i32>,
    pub vibe_tags: Option<String>,
    pub bpm: Option<i32>,
    pub danceability: Option<i32>,
    pub acousticness: Option<i32>,
    pub ai_tagged_at: Option<String>,
}

/// Query all AI-tagged tracks from the database and return as serializable records.
pub fn export_ai_tags_to_file(conn: &Connection) -> Result<Vec<AiTagRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT persistent_id, mood, energy, vibe_tags, bpm, danceability, acousticness, ai_tagged_at \
         FROM tracks WHERE ai_tagged_at IS NOT NULL AND persistent_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AiTagRecord {
            persistent_id: row.get(0)?,
            mood: row.get(1)?,
            energy: row.get(2)?,
            vibe_tags: row.get(3)?,
            bpm: row.get(4)?,
            danceability: row.get(5)?,
            acousticness: row.get(6)?,
            ai_tagged_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

/// Restore AI tags from records, only updating tracks that don't already have tags.
pub fn import_ai_tags_from_file(
    conn: &Connection,
    tags: &[AiTagRecord],
) -> Result<u64, rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    let mut count = 0u64;
    {
        let mut stmt = tx.prepare(
            "UPDATE tracks SET mood=?1, energy=?2, vibe_tags=?3, bpm=?4, \
             danceability=?5, acousticness=?6, ai_tagged_at=?7 \
             WHERE persistent_id=?8 AND ai_tagged_at IS NULL",
        )?;
        for tag in tags {
            count += stmt
                .execute(rusqlite::params![
                    tag.mood,
                    tag.energy,
                    tag.vibe_tags,
                    tag.bpm,
                    tag.danceability,
                    tag.acousticness,
                    tag.ai_tagged_at,
                    tag.persistent_id,
                ])
                .unwrap_or(0) as u64;
        }
    }
    tx.commit()?;
    Ok(count)
}
