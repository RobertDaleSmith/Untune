use rusqlite::{params, Connection};

use crate::models::{Playlist, Track};

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
        "SELECT id, persistent_id, title, artist, album_artist, album, genre, composer,
                year, track_number, track_count, disc_number, disc_count, duration,
                size, bit_rate, sample_rate, play_count, skip_count, rating, loved,
                date_added, last_played_at, last_skipped_at, comments, grouping_,
                sort_title, sort_artist, sort_album, sort_album_artist, sort_composer,
                file_path, artwork_hash, has_artwork
         FROM tracks ORDER BY {} {} LIMIT ? OFFSET ?",
        col, dir
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![limit, offset], |row| {
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
    })?;

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

    let sql = "SELECT t.id, t.persistent_id, t.title, t.artist, t.album_artist, t.album,
                      t.genre, t.composer, t.year, t.track_number, t.track_count,
                      t.disc_number, t.disc_count, t.duration, t.size, t.bit_rate,
                      t.sample_rate, t.play_count, t.skip_count, t.rating, t.loved,
                      t.date_added, t.last_played_at, t.last_skipped_at, t.comments,
                      t.grouping_, t.sort_title, t.sort_artist, t.sort_album,
                      t.sort_album_artist, t.sort_composer, t.file_path,
                      t.artwork_hash, t.has_artwork
               FROM tracks_fts fts
               JOIN tracks t ON t.id = fts.rowid
               WHERE tracks_fts MATCH ?
               LIMIT ?";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![fts_query, limit], |row| {
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
    })?;

    rows.collect()
}

pub fn get_track_count(conn: &Connection) -> Result<i64, rusqlite::Error> {
    conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<Playlist>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, persistent_id, name, is_smart, track_count FROM playlists ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            persistent_id: row.get(1)?,
            name: row.get(2)?,
            is_smart: row.get::<_, i32>(3)? != 0,
            track_count: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn get_playlist_tracks(
    conn: &Connection,
    playlist_id: i64,
) -> Result<Vec<Track>, rusqlite::Error> {
    let sql = "SELECT t.id, t.persistent_id, t.title, t.artist, t.album_artist, t.album,
                      t.genre, t.composer, t.year, t.track_number, t.track_count,
                      t.disc_number, t.disc_count, t.duration, t.size, t.bit_rate,
                      t.sample_rate, t.play_count, t.skip_count, t.rating, t.loved,
                      t.date_added, t.last_played_at, t.last_skipped_at, t.comments,
                      t.grouping_, t.sort_title, t.sort_artist, t.sort_album,
                      t.sort_album_artist, t.sort_composer, t.file_path,
                      t.artwork_hash, t.has_artwork
               FROM playlist_tracks pt
               JOIN tracks t ON t.id = pt.track_id
               WHERE pt.playlist_id = ?
               ORDER BY pt.position";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![playlist_id], |row| {
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
    })?;
    rows.collect()
}
