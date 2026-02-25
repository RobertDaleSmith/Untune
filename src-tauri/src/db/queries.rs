use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{Playlist, Track};
use crate::models::browse::{AlbumSummary, ArtistSummary, GenreSummary};

pub const TRACK_COLUMNS: &str =
    "id, persistent_id, title, artist, album_artist, album, genre, composer,
     year, track_number, track_count, disc_number, disc_count, duration,
     size, bit_rate, sample_rate, play_count, skip_count, rating, loved,
     date_added, last_played_at, last_skipped_at, comments, grouping_,
     sort_title, sort_artist, sort_album, sort_album_artist, sort_composer,
     file_path, artwork_hash, has_artwork";

const TRACK_COLUMNS_PREFIXED: &str =
    "t.id, t.persistent_id, t.title, t.artist, t.album_artist, t.album, t.genre, t.composer,
     t.year, t.track_number, t.track_count, t.disc_number, t.disc_count, t.duration,
     t.size, t.bit_rate, t.sample_rate, t.play_count, t.skip_count, t.rating, t.loved,
     t.date_added, t.last_played_at, t.last_skipped_at, t.comments, t.grouping_,
     t.sort_title, t.sort_artist, t.sort_album, t.sort_album_artist, t.sort_composer,
     t.file_path, t.artwork_hash, t.has_artwork";

pub fn map_track_row(row: &Row) -> Result<Track, rusqlite::Error> {
    Ok(Track {
        id: row.get(0)?,
        persistent_id: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album_artist: row.get(4)?,
        album: row.get(5)?,
        genre: row.get(6)?,
        composer: row.get(7)?,
        year: row.get(8)?,
        track_number: row.get(9)?,
        track_count: row.get(10)?,
        disc_number: row.get(11)?,
        disc_count: row.get(12)?,
        duration: row.get(13)?,
        size: row.get(14)?,
        bit_rate: row.get(15)?,
        sample_rate: row.get(16)?,
        play_count: row.get(17)?,
        skip_count: row.get(18)?,
        rating: row.get(19)?,
        loved: row.get(20)?,
        date_added: row.get(21)?,
        last_played_at: row.get(22)?,
        last_skipped_at: row.get(23)?,
        comments: row.get(24)?,
        grouping: row.get(25)?,
        sort_title: row.get(26)?,
        sort_artist: row.get(27)?,
        sort_album: row.get(28)?,
        sort_album_artist: row.get(29)?,
        sort_composer: row.get(30)?,
        file_path: row.get(31)?,
        artwork_hash: row.get(32)?,
        has_artwork: row.get::<_, i32>(33)? != 0,
    })
}

pub fn get_tracks(
    conn: &Connection,
    offset: i64,
    limit: i64,
    sort_column: &str,
    sort_dir: &str,
) -> Result<Vec<Track>, rusqlite::Error> {
    let allowed_columns = [
        "id",
        "title",
        "artist",
        "album",
        "album_artist",
        "genre",
        "duration",
        "play_count",
        "date_added",
        "last_played_at",
        "rating",
        "year",
        "track_number",
        "skip_count",
        "bit_rate",
    ];
    let col = if allowed_columns.contains(&sort_column) {
        sort_column
    } else {
        "id"
    };
    let dir = if sort_dir.eq_ignore_ascii_case("desc") {
        "DESC"
    } else {
        "ASC"
    };

    let sql = format!(
        "SELECT {} FROM tracks ORDER BY {} {} LIMIT ? OFFSET ?",
        TRACK_COLUMNS, col, dir
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit, offset], |row| map_track_row(row))?;
    rows.collect()
}

pub fn search_tracks(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> Result<Vec<Track>, rusqlite::Error> {
    let fts_query = query
        .split_whitespace()
        .map(|w| format!("{}*", w))
        .collect::<Vec<_>>()
        .join(" ");

    let sql = format!(
        "SELECT {} FROM tracks_fts fts
         JOIN tracks t ON t.id = fts.rowid
         WHERE tracks_fts MATCH ?
         LIMIT ?",
        TRACK_COLUMNS_PREFIXED
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![fts_query, limit], |row| map_track_row(row))?;
    rows.collect()
}

pub fn get_track_file_info(
    conn: &Connection,
    track_id: i64,
) -> Result<Option<(String, Option<f64>)>, rusqlite::Error> {
    conn.query_row(
        "SELECT file_path, duration FROM tracks WHERE id = ?",
        params![track_id],
        |row| {
            let path: Option<String> = row.get(0)?;
            let duration: Option<f64> = row.get(1)?;
            Ok(path.map(|p| (p, duration)))
        },
    )
}

pub fn get_track_count(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<Playlist>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count, rules_json
         FROM playlists ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            persistent_id: row.get(1)?,
            name: row.get(2)?,
            is_smart: row.get::<_, i32>(3)? != 0,
            is_folder: row.get::<_, i32>(4)? != 0,
            parent_id: row.get(5)?,
            sort_order: row.get(6)?,
            track_count: row.get(7)?,
            rules_json: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn get_playlist_tracks(
    conn: &Connection,
    playlist_id: i64,
) -> Result<Vec<Track>, rusqlite::Error> {
    // Check if this is a native smart playlist (has rules_json)
    let rules: Option<String> = conn.query_row(
        "SELECT rules_json FROM playlists WHERE id = ? AND is_smart = 1",
        params![playlist_id],
        |row| row.get(0),
    ).unwrap_or(None);

    if let Some(ref rules_json) = rules {
        return crate::smart_playlists::evaluate(conn, rules_json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()));
    }

    let sql = format!(
        "SELECT {} FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = ?
         ORDER BY pt.position",
        TRACK_COLUMNS_PREFIXED
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![playlist_id], |row| map_track_row(row))?;
    rows.collect()
}

pub fn get_view_settings(
    conn: &Connection,
    view_key: &str,
) -> Result<Option<(bool, String)>, rusqlite::Error> {
    conn.query_row(
        "SELECT shuffle, repeat_mode FROM view_settings WHERE view_key = ?",
        params![view_key],
        |row| {
            let shuffle: i32 = row.get(0)?;
            let repeat_mode: String = row.get(1)?;
            Ok((shuffle != 0, repeat_mode))
        },
    )
    .optional()
}

pub fn save_view_settings(
    conn: &Connection,
    view_key: &str,
    shuffle: bool,
    repeat_mode: &str,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO view_settings (view_key, shuffle, repeat_mode) VALUES (?1, ?2, ?3)
         ON CONFLICT(view_key) DO UPDATE SET shuffle = ?2, repeat_mode = ?3",
        params![view_key, shuffle as i32, repeat_mode],
    )?;
    Ok(())
}

pub fn get_tracks_missing_artwork(
    conn: &Connection,
) -> Result<Vec<(i64, Option<String>, Option<String>, bool)>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, persistent_id, file_path, has_artwork FROM tracks WHERE artwork_hash IS NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, i32>(3)? != 0,
        ))
    })?;
    rows.collect()
}

// --- Preferences ---

pub fn get_preference(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM preferences WHERE key = ?",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_preference(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO preferences (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

// --- Browse queries ---

pub fn get_albums(conn: &Connection) -> Result<Vec<AlbumSummary>, rusqlite::Error> {
    let sql = "SELECT
                 COALESCE(album, '(Unknown Album)') as album_name,
                 COALESCE(album_artist, artist, '(Unknown Artist)') as artist_name,
                 COUNT(*) as track_count,
                 COALESCE(SUM(duration), 0) as total_duration,
                 MAX(year) as year,
                 MAX(artwork_hash) as artwork_hash
               FROM tracks
               GROUP BY COALESCE(album, '(Unknown Album)'), COALESCE(album_artist, artist, '(Unknown Artist)')
               ORDER BY COALESCE(album, '(Unknown Album)') COLLATE NOCASE";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(AlbumSummary {
            album: row.get(0)?,
            artist: row.get(1)?,
            track_count: row.get(2)?,
            total_duration: row.get(3)?,
            year: row.get(4)?,
            artwork_hash: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn get_artists(conn: &Connection) -> Result<Vec<ArtistSummary>, rusqlite::Error> {
    let sql = "SELECT
                 COALESCE(artist, '(Unknown Artist)') as artist_name,
                 COUNT(DISTINCT COALESCE(album, '')) as album_count,
                 COUNT(*) as track_count
               FROM tracks
               GROUP BY COALESCE(artist, '(Unknown Artist)')
               ORDER BY COALESCE(artist, '(Unknown Artist)') COLLATE NOCASE";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ArtistSummary {
            name: row.get(0)?,
            album_count: row.get(1)?,
            track_count: row.get(2)?,
        })
    })?;
    rows.collect()
}

pub fn get_genres(conn: &Connection) -> Result<Vec<GenreSummary>, rusqlite::Error> {
    let sql = "SELECT
                 COALESCE(genre, '(Unknown Genre)') as genre_name,
                 COUNT(*) as track_count
               FROM tracks
               GROUP BY COALESCE(genre, '(Unknown Genre)')
               ORDER BY COALESCE(genre, '(Unknown Genre)') COLLATE NOCASE";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(GenreSummary {
            name: row.get(0)?,
            track_count: row.get(1)?,
        })
    })?;
    rows.collect()
}

// --- Lyrics cache ---

pub fn get_cached_lyrics(
    conn: &Connection,
    track_name: &str,
    artist_name: &str,
    album_name: &str,
) -> Result<Option<(Option<String>, Option<String>, bool)>, rusqlite::Error> {
    conn.query_row(
        "SELECT synced_lyrics, plain_lyrics, instrumental FROM lyrics_cache
         WHERE track_name = ? AND artist_name = ? AND album_name = ?",
        params![track_name, artist_name, album_name],
        |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, i32>(2)? != 0,
            ))
        },
    )
    .optional()
}

pub fn save_cached_lyrics(
    conn: &Connection,
    track_name: &str,
    artist_name: &str,
    album_name: &str,
    synced_lyrics: Option<&str>,
    plain_lyrics: Option<&str>,
    instrumental: bool,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO lyrics_cache (track_name, artist_name, album_name, synced_lyrics, plain_lyrics, instrumental, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
         ON CONFLICT(track_name, artist_name, album_name)
         DO UPDATE SET synced_lyrics = ?4, plain_lyrics = ?5, instrumental = ?6, fetched_at = datetime('now')",
        params![track_name, artist_name, album_name, synced_lyrics, plain_lyrics, instrumental as i32],
    )?;
    Ok(())
}

pub fn update_artwork_for_album(
    conn: &Connection,
    artwork_hash: &str,
    album: &str,
    artist: &str,
) -> Result<Vec<i64>, rusqlite::Error> {
    conn.execute(
        "UPDATE tracks SET artwork_hash = ?1
         WHERE COALESCE(album, '(Unknown Album)') = ?2
           AND COALESCE(album_artist, artist, '(Unknown Artist)') = ?3",
        params![artwork_hash, album, artist],
    )?;

    let mut stmt = conn.prepare(
        "SELECT id FROM tracks
         WHERE COALESCE(album, '(Unknown Album)') = ?1
           AND COALESCE(album_artist, artist, '(Unknown Artist)') = ?2",
    )?;
    let rows = stmt.query_map(params![album, artist], |row| row.get::<_, i64>(0))?;
    rows.collect()
}

pub fn get_album_tracks(
    conn: &Connection,
    album: &str,
    artist: &str,
) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = format!(
        "SELECT {} FROM tracks
         WHERE COALESCE(album, '(Unknown Album)') = ?
           AND COALESCE(album_artist, artist, '(Unknown Artist)') = ?
         ORDER BY disc_number, track_number, title",
        TRACK_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![album, artist], |row| map_track_row(row))?;
    rows.collect()
}

pub fn get_artist_tracks(
    conn: &Connection,
    artist: &str,
) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = format!(
        "SELECT {} FROM tracks
         WHERE COALESCE(artist, '(Unknown Artist)') = ?
         ORDER BY album, disc_number, track_number, title",
        TRACK_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![artist], |row| map_track_row(row))?;
    rows.collect()
}

pub fn reorder_playlists(
    conn: &Connection,
    updates: &[(i64, i32, Option<i64>)],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE playlists SET sort_order = ?1, parent_id = ?2 WHERE id = ?3",
        )?;
        for &(id, sort_order, parent_id) in updates {
            stmt.execute(params![sort_order, parent_id, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn get_genre_tracks(
    conn: &Connection,
    genre: &str,
) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = format!(
        "SELECT {} FROM tracks
         WHERE COALESCE(genre, '(Unknown Genre)') = ?
         ORDER BY artist, album, disc_number, track_number, title",
        TRACK_COLUMNS
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![genre], |row| map_track_row(row))?;
    rows.collect()
}
