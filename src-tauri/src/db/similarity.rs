use rusqlite::{params, Connection};

use crate::db::{map_track_row, TRACK_COLUMNS_PREFIXED};
use crate::models::Track;

/// Find tracks similar to a seed track using weighted SQL scoring.
/// Weights: genre(30) + mood(20) + artist(15) + energy proximity(10) +
///          BPM ±15%(10) + danceability(5) + acousticness(5)
pub fn find_similar_tracks(
    conn: &Connection,
    seed_id: i64,
    limit: i64,
    exclude_ids: &[i64],
) -> Result<Vec<Track>, rusqlite::Error> {
    // First get the seed track's attributes
    let seed = conn.query_row(
        "SELECT genre, mood, artist, energy, bpm, danceability, acousticness FROM tracks WHERE id = ?",
        params![seed_id],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i32>>(3)?,
                row.get::<_, Option<i32>>(4)?,
                row.get::<_, Option<i32>>(5)?,
                row.get::<_, Option<i32>>(6)?,
            ))
        },
    )?;

    let (genre, mood, artist, energy, bpm, danceability, acousticness) = seed;

    // Build exclude list for the WHERE clause
    let mut exclude_placeholders = Vec::new();
    exclude_placeholders.push("t.id != ?1".to_string());
    for (i, _) in exclude_ids.iter().enumerate() {
        exclude_placeholders.push(format!("t.id != ?{}", i + 9));
    }
    let exclude_clause = exclude_placeholders.join(" AND ");

    let sql = format!(
        "SELECT {},
         (CASE WHEN t.genre IS NOT NULL AND t.genre = ?2 THEN 30 ELSE 0 END) +
         (CASE WHEN t.mood IS NOT NULL AND t.mood = ?3 THEN 20 ELSE 0 END) +
         (CASE WHEN t.artist IS NOT NULL AND t.artist = ?4 THEN 15 ELSE 0 END) +
         (CASE WHEN t.energy IS NOT NULL AND ?5 IS NOT NULL
               THEN MAX(0, 10 - ABS(t.energy - ?5)) ELSE 0 END) +
         (CASE WHEN t.bpm IS NOT NULL AND ?6 IS NOT NULL AND ?6 > 0
               THEN CASE WHEN ABS(t.bpm - ?6) <= ?6 * 15 / 100 THEN 10 ELSE 0 END
               ELSE 0 END) +
         (CASE WHEN t.danceability IS NOT NULL AND ?7 IS NOT NULL
               THEN MAX(0, 5 - ABS(t.danceability - ?7)) ELSE 0 END) +
         (CASE WHEN t.acousticness IS NOT NULL AND ?8 IS NOT NULL
               THEN MAX(0, 5 - ABS(t.acousticness - ?8)) ELSE 0 END)
         AS similarity_score
         FROM tracks t
         WHERE {} AND t.file_path IS NOT NULL
         ORDER BY similarity_score DESC, RANDOM()
         LIMIT ?{}",
        TRACK_COLUMNS_PREFIXED,
        exclude_clause,
        exclude_ids.len() + 9,
    );

    let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(seed_id),
        Box::new(genre),
        Box::new(mood),
        Box::new(artist),
        Box::new(energy),
        Box::new(bpm),
        Box::new(danceability),
        Box::new(acousticness),
    ];
    for id in exclude_ids {
        all_params.push(Box::new(*id));
    }
    all_params.push(Box::new(limit));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        all_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| map_track_row(row))?;
    rows.collect()
}
