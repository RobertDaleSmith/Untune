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
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO playlists (persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![persistent_id, name, is_smart as i32, is_folder as i32, parent_id, sort_order, track_count],
    )?;
    Ok(conn.last_insert_rowid())
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
    conn.execute_batch(
        "DELETE FROM playlist_tracks;
         DELETE FROM playlists;
         DELETE FROM tracks;
         DELETE FROM tracks_fts;",
    )?;
    Ok(())
}
