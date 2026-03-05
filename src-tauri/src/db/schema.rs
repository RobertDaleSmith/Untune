use rusqlite::Connection;

fn migrate_ai_tags(conn: &Connection) {
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN mood TEXT");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN energy INTEGER");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN vibe_tags TEXT");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN bpm INTEGER");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN danceability INTEGER");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN acousticness INTEGER");
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN ai_tagged_at TEXT");
    let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_tracks_mood ON tracks(mood)");
    let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_tracks_energy ON tracks(energy)");
    let _ = conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_tracks_bpm ON tracks(bpm)");
}

fn migrate_bios(conn: &Connection) {
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            entity_name TEXT NOT NULL,
            entity_detail TEXT NOT NULL DEFAULT '',
            bio TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            UNIQUE(entity_type, entity_name, entity_detail)
        )"
    );
}

fn migrate_playlists(conn: &Connection) {
    // Add columns for playlist folders — ignore errors if they already exist
    let _ = conn.execute_batch("ALTER TABLE playlists ADD COLUMN is_folder INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE playlists ADD COLUMN parent_id INTEGER REFERENCES playlists(id)");
    let _ = conn.execute_batch("ALTER TABLE playlists ADD COLUMN sort_order INTEGER DEFAULT 0");
    let _ = conn.execute_batch("ALTER TABLE playlists ADD COLUMN rules_json TEXT");
}

fn migrate_sync(conn: &Connection) {
    // Add updated_at to tracks and playlists
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN updated_at TEXT");
    let _ = conn.execute_batch("ALTER TABLE playlists ADD COLUMN updated_at TEXT");

    // Sync device management
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pairing_token TEXT NOT NULL,
            paired_at TEXT NOT NULL,
            last_sync_at TEXT
        )"
    );

    // Which playlists are selected for sync per device
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_playlist_selections (
            device_id TEXT NOT NULL REFERENCES sync_devices(id) ON DELETE CASCADE,
            playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            PRIMARY KEY (device_id, playlist_id)
        )"
    );

    // Track-level sync state per device
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_track_state (
            device_id TEXT NOT NULL REFERENCES sync_devices(id) ON DELETE CASCADE,
            track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
            metadata_synced_at TEXT,
            file_synced_at TEXT,
            artwork_synced_at TEXT,
            PRIMARY KEY (device_id, track_id)
        )"
    );
}

fn migrate_source_url(conn: &Connection) {
    let _ = conn.execute_batch("ALTER TABLE tracks ADD COLUMN source_url TEXT");
}

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
            is_folder INTEGER DEFAULT 0,
            parent_id INTEGER,
            sort_order INTEGER DEFAULT 0,
            track_count INTEGER DEFAULT 0,
            FOREIGN KEY (parent_id) REFERENCES playlists(id)
        );

        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER NOT NULL,
            track_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (playlist_id, track_id),
            FOREIGN KEY (playlist_id) REFERENCES playlists(id),
            FOREIGN KEY (track_id) REFERENCES tracks(id)
        );

        CREATE TABLE IF NOT EXISTS view_settings (
            view_key TEXT PRIMARY KEY,
            shuffle INTEGER NOT NULL DEFAULT 0,
            repeat_mode TEXT NOT NULL DEFAULT 'off'
        );

        CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lyrics_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_name TEXT NOT NULL,
            artist_name TEXT NOT NULL,
            album_name TEXT NOT NULL DEFAULT '',
            synced_lyrics TEXT,
            plain_lyrics TEXT,
            instrumental INTEGER DEFAULT 0,
            fetched_at TEXT NOT NULL,
            UNIQUE(track_name, artist_name, album_name)
        );
        ",
    )?;
    migrate_playlists(conn);
    migrate_ai_tags(conn);
    migrate_bios(conn);
    migrate_sync(conn);
    migrate_source_url(conn);
    Ok(())
}
