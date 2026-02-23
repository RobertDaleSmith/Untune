use rusqlite::Connection;

pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persistent_id TEXT UNIQUE,
            title TEXT NOT NULL,
            artist TEXT,
            album_artist TEXT,
            album TEXT,
            genre TEXT,
            composer TEXT,
            year INTEGER,
            track_number INTEGER,
            track_count INTEGER,
            disc_number INTEGER,
            disc_count INTEGER,
            duration REAL,
            size INTEGER,
            bit_rate INTEGER,
            sample_rate INTEGER,
            play_count INTEGER DEFAULT 0,
            skip_count INTEGER DEFAULT 0,
            rating INTEGER DEFAULT 0,
            loved INTEGER DEFAULT 0,
            date_added TEXT,
            last_played_at TEXT,
            last_skipped_at TEXT,
            comments TEXT,
            grouping_ TEXT,
            sort_title TEXT,
            sort_artist TEXT,
            sort_album TEXT,
            sort_album_artist TEXT,
            sort_composer TEXT,
            file_path TEXT,
            artwork_hash TEXT,
            has_artwork INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
        CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
        CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre);
        CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count);
        CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added);
        CREATE INDEX IF NOT EXISTS idx_tracks_last_played ON tracks(last_played_at);
        CREATE INDEX IF NOT EXISTS idx_tracks_rating ON tracks(rating);
        CREATE INDEX IF NOT EXISTS idx_tracks_persistent_id ON tracks(persistent_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
            title, artist, album, genre, composer,
            content='tracks',
            content_rowid='id'
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persistent_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            is_smart INTEGER DEFAULT 0,
            track_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id),
            FOREIGN KEY (track_id) REFERENCES tracks(id)
        );
        ",
    )?;
    Ok(())
}
