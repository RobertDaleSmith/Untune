use rusqlite::Connection;

use crate::models::MergedTrack;

pub fn batch_insert_tracks(
    conn: &mut Connection,
    tracks: &[MergedTrack],
) -> Result<(), rusqlite::Error> {
    let tx = conn.transaction()?;

    {
        let mut stmt = tx.prepare(
            "INSERT INTO tracks (
                persistent_id, title, artist, album_artist, album, genre, composer,
                year, track_number, track_count, disc_number, disc_count, duration,
                size, bit_rate, sample_rate, play_count, skip_count, rating, loved,
                date_added, last_played_at, last_skipped_at, comments, grouping_,
                sort_title, sort_artist, sort_album, sort_album_artist, sort_composer,
                file_path, has_artwork
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
                ?26, ?27, ?28, ?29, ?30, ?31, ?32
            )",
        )?;

        for track in tracks {
            stmt.execute(rusqlite::params![
                track.persistent_id,
                track.title,
                track.artist,
                track.album_artist,
                track.album,
                track.genre,
                track.composer,
                track.year,
                track.track_number,
                track.track_count,
                track.disc_number,
                track.disc_count,
                track.duration,
                track.size,
                track.bit_rate,
                track.sample_rate,
                track.play_count,
                track.skip_count,
                track.rating,
                track.loved.map(|b| b as i32),
                track.date_added,
                track.last_played_at,
                track.last_skipped_at,
                track.comments,
                track.grouping,
                track.sort_title,
                track.sort_artist,
                track.sort_album,
                track.sort_album_artist,
                track.sort_composer,
                track.file_path,
                track.has_artwork as i32,
            ])?;
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn rebuild_fts(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "INSERT INTO tracks_fts(tracks_fts) VALUES('rebuild');",
    )?;
    Ok(())
}

pub fn insert_playlist(
    conn: &Connection,
    persistent_id: &str,
    name: &str,
    is_smart: bool,
    is_folder: bool,
    parent_id: Option<i64>,
    sort_order: i32,
    track_count: i32,
    rules_json: Option<&str>,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO playlists (persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count, rules_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(persistent_id) DO UPDATE SET
           name = excluded.name,
           is_smart = excluded.is_smart,
           is_folder = excluded.is_folder,
           parent_id = excluded.parent_id,
           sort_order = excluded.sort_order,
           track_count = excluded.track_count,
           rules_json = excluded.rules_json",
        rusqlite::params![persistent_id, name, is_smart as i32, is_folder as i32, parent_id, sort_order, track_count, rules_json],
    )?;
    // ON CONFLICT DO UPDATE doesn't reliably set last_insert_rowid for updates,
    // so query the actual id.
    let id: i64 = conn.query_row(
        "SELECT id FROM playlists WHERE persistent_id = ?1",
        rusqlite::params![persistent_id],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn insert_playlist_tracks(
    conn: &mut Connection,
    playlist_id: i64,
    track_ids: &[(i64, i32)], // (track_id, position)
) -> Result<(), rusqlite::Error> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
             VALUES (?1, ?2, ?3)",
        )?;
        for (track_id, position) in track_ids {
            stmt.execute(rusqlite::params![playlist_id, track_id, position])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn clear_tracks(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Preserve user-created smart playlists (persistent_id starts with 'waves-')
    conn.execute_batch(
        "DELETE FROM playlist_tracks WHERE playlist_id IN (SELECT id FROM playlists WHERE persistent_id NOT LIKE 'waves-%');
         DELETE FROM playlists WHERE persistent_id NOT LIKE 'waves-%';
         DELETE FROM tracks;
         DELETE FROM tracks_fts;",
    )?;
    Ok(())
}

pub fn insert_smart_playlist(
    conn: &Connection,
    name: &str,
    rules_json: &str,
    parent_id: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    let persistent_id = format!(
        "waves-sp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    conn.execute(
        "INSERT INTO playlists (persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count, rules_json)
         VALUES (?1, ?2, 1, 0, ?3, 0, 0, ?4)",
        rusqlite::params![persistent_id, name, parent_id, rules_json],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_smart_playlist(
    conn: &Connection,
    id: i64,
    name: Option<&str>,
    rules_json: Option<&str>,
) -> Result<(), rusqlite::Error> {
    if let Some(n) = name {
        conn.execute("UPDATE playlists SET name = ? WHERE id = ?", rusqlite::params![n, id])?;
    }
    if let Some(rj) = rules_json {
        conn.execute("UPDATE playlists SET rules_json = ? WHERE id = ?", rusqlite::params![rj, id])?;
    }
    Ok(())
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE playlists SET name = ? WHERE id = ?",
        rusqlite::params![name, id],
    )?;
    Ok(())
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", rusqlite::params![id])?;
    conn.execute("DELETE FROM playlists WHERE id = ?", rusqlite::params![id])?;
    Ok(())
}

pub fn insert_regular_playlist(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    let persistent_id = format!(
        "waves-pl-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    conn.execute(
        "INSERT INTO playlists (persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count, rules_json)
         VALUES (?1, ?2, 0, 0, ?3, 0, 0, NULL)",
        rusqlite::params![persistent_id, name, parent_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn insert_playlist_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
) -> Result<i64, rusqlite::Error> {
    let persistent_id = format!(
        "waves-folder-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    conn.execute(
        "INSERT INTO playlists (persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count, rules_json)
         VALUES (?1, ?2, 0, 1, ?3, 0, 0, NULL)",
        rusqlite::params![persistent_id, name, parent_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn add_tracks_to_playlist(
    conn: &Connection,
    playlist_id: i64,
    track_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    // Get the max existing position
    let max_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?",
        rusqlite::params![playlist_id],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
    )?;
    for (i, track_id) in track_ids.iter().enumerate() {
        stmt.execute(rusqlite::params![playlist_id, track_id, max_pos + 1 + i as i64])?;
    }

    // Update track count
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?",
        rusqlite::params![playlist_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE playlists SET track_count = ? WHERE id = ?",
        rusqlite::params![count, playlist_id],
    )?;

    Ok(())
}
