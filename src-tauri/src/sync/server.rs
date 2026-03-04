use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Json, Response},
    routing::{get, post},
    Router,
    body::Body,
};
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tower_http::cors::CorsLayer;

use super::models::*;

/// Shared state for the axum server
#[derive(Clone)]
pub struct SyncServerState {
    pub db_path: String,
    pub artwork_dir: String,
    pub pairing_code: Arc<Mutex<Option<String>>>,
    pub desktop_name: String,
}

impl SyncServerState {
    fn connect_db(&self) -> Result<Connection, StatusCode> {
        Connection::open(&self.db_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
}

/// Device ID extracted from auth token, stored in request extensions
#[derive(Clone)]
pub struct AuthenticatedDevice(pub String);

/// Auth middleware — checks Bearer token against sync_devices table
async fn auth_middleware(
    State(state): State<SyncServerState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !auth_header.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_header[7..];
    let conn = state.connect_db()?;
    let device_id: String = conn
        .query_row(
            "SELECT id FROM sync_devices WHERE pairing_token = ?",
            rusqlite::params![token],
            |row| row.get(0),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    req.extensions_mut().insert(AuthenticatedDevice(device_id));

    Ok(next.run(req).await)
}

/// Build the axum router
pub fn build_router(state: SyncServerState) -> Router {
    let public_routes = Router::new().route("/api/pair", post(pair_handler));

    let protected_routes = Router::new()
        .route("/api/sync/manifest", get(manifest_handler))
        .route("/api/sync/delta", post(delta_handler))
        .route("/api/tracks/{id}/file", get(file_handler))
        .route("/api/artwork/{hash}", get(artwork_handler))
        .route("/api/sync/play-stats", post(play_stats_handler))
        .route("/api/sync/complete", post(sync_complete_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// --- Handlers ---

async fn pair_handler(
    State(state): State<SyncServerState>,
    Json(req): Json<PairRequest>,
) -> Result<Json<PairResponse>, StatusCode> {
    // Validate pairing code
    let expected_code = state
        .pairing_code
        .lock()
        .unwrap()
        .clone()
        .ok_or(StatusCode::FORBIDDEN)?;

    if req.code != expected_code {
        return Err(StatusCode::FORBIDDEN);
    }

    // Generate device credentials
    let device_id = uuid::Uuid::new_v4().to_string();
    let token_bytes: [u8; 32] = rand::random();
    let pairing_token = hex::encode(token_bytes);

    // Store in database
    let conn = state.connect_db()?;
    conn.execute(
        "INSERT INTO sync_devices (id, name, pairing_token, paired_at) VALUES (?1, ?2, ?3, datetime('now'))",
        rusqlite::params![device_id, req.device_name, pairing_token],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Clear the pairing code (one-time use)
    *state.pairing_code.lock().unwrap() = None;

    Ok(Json(PairResponse {
        device_id,
        pairing_token,
        desktop_name: state.desktop_name.clone(),
    }))
}

async fn manifest_handler(
    State(state): State<SyncServerState>,
    req: Request,
) -> Result<Json<SyncManifest>, StatusCode> {
    let conn = state.connect_db()?;
    let device_id = req.extensions().get::<AuthenticatedDevice>()
        .ok_or(StatusCode::UNAUTHORIZED)?.0.clone();

    // Get selected playlist IDs for this device (or all if none selected)
    let playlist_ids = get_sync_playlist_ids(&conn, &device_id)?;

    let playlists = fetch_sync_playlists(&conn, &playlist_ids)?;
    let track_ids: Vec<i64> = playlists.iter().flat_map(|p| p.track_ids.clone()).collect();
    let tracks = fetch_sync_tracks(&conn, &track_ids)?;

    Ok(Json(SyncManifest { playlists, tracks }))
}

async fn delta_handler(
    State(state): State<SyncServerState>,
    req: Request,
) -> Result<Json<SyncDelta>, StatusCode> {
    let conn = state.connect_db()?;
    let device_id = req.extensions().get::<AuthenticatedDevice>()
        .ok_or(StatusCode::UNAUTHORIZED)?.0.clone();

    // Parse body
    let body_bytes = axum::body::to_bytes(req.into_body(), 1024 * 1024)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let req: DeltaRequest = serde_json::from_slice(&body_bytes)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let playlist_ids = get_sync_playlist_ids(&conn, &device_id)?;

    let (playlists, tracks) = if let Some(ref since) = req.since {
        let playlists = fetch_updated_playlists(&conn, &playlist_ids, since)?;
        let track_ids: Vec<i64> = playlists.iter().flat_map(|p| p.track_ids.clone()).collect();
        let tracks = fetch_updated_tracks(&conn, &track_ids, since)?;
        (playlists, tracks)
    } else {
        let playlists = fetch_sync_playlists(&conn, &playlist_ids)?;
        let track_ids: Vec<i64> = playlists.iter().flat_map(|p| p.track_ids.clone()).collect();
        let tracks = fetch_sync_tracks(&conn, &track_ids)?;
        (playlists, tracks)
    };

    Ok(Json(SyncDelta {
        playlists,
        tracks,
        removed_track_ids: vec![],
        removed_playlist_ids: vec![],
        sync_timestamp: chrono_now(),
    }))
}

async fn file_handler(
    State(state): State<SyncServerState>,
    Path(track_id): Path<i64>,
    req: Request,
) -> Result<Response, StatusCode> {
    let conn = state.connect_db()?;
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM tracks WHERE id = ?",
            rusqlite::params![track_id],
            |row| row.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let metadata = std::fs::metadata(&file_path).map_err(|_| StatusCode::NOT_FOUND)?;
    let file_size = metadata.len();

    // Check for Range header
    let range_header = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(range) = range_header {
        serve_range_request(&file_path, file_size, &range)
    } else {
        // Full file
        let bytes = std::fs::read(&file_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let content_type = guess_content_type(&file_path);

        Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, file_size.to_string())
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::from(bytes))
            .unwrap())
    }
}

async fn artwork_handler(
    State(state): State<SyncServerState>,
    Path(hash): Path<String>,
) -> Result<Response, StatusCode> {
    // Try both jpg and png — hash_and_save uses magic bytes to pick extension
    for (ext, mime) in &[("jpg", "image/jpeg"), ("png", "image/png")] {
        let path = format!("{}/{}.{}", state.artwork_dir, hash, ext);
        if let Ok(bytes) = std::fs::read(&path) {
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, *mime)
                .header(header::CONTENT_LENGTH, bytes.len().to_string())
                .body(Body::from(bytes))
                .unwrap());
        }
    }
    Err(StatusCode::NOT_FOUND)
}

async fn play_stats_handler(
    State(state): State<SyncServerState>,
    Json(upload): Json<PlayStatsUpload>,
) -> Result<StatusCode, StatusCode> {
    let conn = state.connect_db()?;

    for stat in &upload.stats {
        if stat.play_count_delta > 0 {
            conn.execute(
                "UPDATE tracks SET
                    play_count = COALESCE(play_count, 0) + ?1,
                    last_played_at = CASE WHEN ?2 > COALESCE(last_played_at, '') THEN ?2 ELSE last_played_at END,
                    updated_at = datetime('now')
                 WHERE id = ?3",
                rusqlite::params![stat.play_count_delta, stat.last_played_at, stat.track_id],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        if stat.skip_count_delta > 0 {
            conn.execute(
                "UPDATE tracks SET
                    skip_count = COALESCE(skip_count, 0) + ?1,
                    last_skipped_at = CASE WHEN ?2 > COALESCE(last_skipped_at, '') THEN ?2 ELSE last_skipped_at END,
                    updated_at = datetime('now')
                 WHERE id = ?3",
                rusqlite::params![stat.skip_count_delta, stat.last_skipped_at, stat.track_id],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    Ok(StatusCode::OK)
}

async fn sync_complete_handler(
    State(state): State<SyncServerState>,
    req: Request,
) -> Result<StatusCode, StatusCode> {
    let conn = state.connect_db()?;
    let device_id = req.extensions().get::<AuthenticatedDevice>()
        .ok_or(StatusCode::UNAUTHORIZED)?.0.clone();

    // Parse body
    let body_bytes = axum::body::to_bytes(req.into_body(), 1024 * 1024)
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let req: SyncCompleteRequest = serde_json::from_slice(&body_bytes)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let now = chrono_now();

    // Update sync timestamps for tracks
    for track_id in &req.synced_track_ids {
        conn.execute(
            "INSERT INTO sync_track_state (device_id, track_id, metadata_synced_at, file_synced_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(device_id, track_id) DO UPDATE SET
               metadata_synced_at = ?3, file_synced_at = ?3",
            rusqlite::params![device_id, track_id, now],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    // Update device last_sync_at
    conn.execute(
        "UPDATE sync_devices SET last_sync_at = ? WHERE id = ?",
        rusqlite::params![now, device_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

// --- Helpers ---

fn get_sync_playlist_ids(conn: &Connection, device_id: &str) -> Result<Vec<i64>, StatusCode> {
    let mut stmt = conn
        .prepare("SELECT playlist_id FROM sync_playlist_selections WHERE device_id = ?")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let ids: Vec<i64> = stmt
        .query_map(rusqlite::params![device_id], |row| row.get(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();

    if ids.is_empty() {
        // If no playlists selected, return all playlist IDs
        let mut stmt = conn
            .prepare("SELECT id FROM playlists WHERE is_folder = 0")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let all: Vec<i64> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(all)
    } else {
        Ok(ids)
    }
}

fn fetch_sync_playlists(
    conn: &Connection,
    playlist_ids: &[i64],
) -> Result<Vec<SyncPlaylistMeta>, StatusCode> {
    let mut result = Vec::new();
    for &pid in playlist_ids {
        let playlist = conn
            .query_row(
                "SELECT id, persistent_id, name, is_smart, is_folder, parent_id, sort_order, track_count
                 FROM playlists WHERE id = ?",
                rusqlite::params![pid],
                |row| {
                    Ok(SyncPlaylistMeta {
                        id: row.get(0)?,
                        persistent_id: row.get(1)?,
                        name: row.get(2)?,
                        is_smart: row.get::<_, i32>(3)? != 0,
                        is_folder: row.get::<_, i32>(4)? != 0,
                        parent_id: row.get(5)?,
                        sort_order: row.get(6)?,
                        track_count: row.get(7)?,
                        track_ids: vec![],
                    })
                },
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Get track IDs for this playlist
        let mut stmt = conn
            .prepare(
                "SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let track_ids: Vec<i64> = stmt
            .query_map(rusqlite::params![pid], |row| row.get(0))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .filter_map(|r| r.ok())
            .collect();

        result.push(SyncPlaylistMeta {
            track_ids,
            ..playlist
        });
    }
    Ok(result)
}

fn fetch_sync_tracks(
    conn: &Connection,
    track_ids: &[i64],
) -> Result<Vec<SyncTrackMeta>, StatusCode> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for &tid in track_ids {
        if !seen.insert(tid) {
            continue;
        }
        if let Ok(track) = fetch_one_sync_track(conn, tid) {
            result.push(track);
        }
    }
    Ok(result)
}

fn fetch_one_sync_track(conn: &Connection, track_id: i64) -> Result<SyncTrackMeta, StatusCode> {
    conn.query_row(
        "SELECT id, persistent_id, title, artist, album_artist, album, genre, composer,
                year, track_number, track_count, disc_number, disc_count, duration,
                size, bit_rate, sample_rate, play_count, skip_count, rating, loved,
                date_added, last_played_at, last_skipped_at,
                artwork_hash, has_artwork,
                mood, energy, vibe_tags, bpm, danceability, acousticness, ai_tagged_at,
                updated_at, file_path
         FROM tracks WHERE id = ?",
        rusqlite::params![track_id],
        |row| {
            let file_path: Option<String> = row.get(34)?;
            let file_extension = file_path.as_ref().and_then(|p| {
                std::path::Path::new(p)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_lowercase())
            });

            Ok(SyncTrackMeta {
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
                artwork_hash: row.get(24)?,
                has_artwork: row.get::<_, i32>(25)? != 0,
                mood: row.get(26)?,
                energy: row.get(27)?,
                vibe_tags: row.get(28)?,
                bpm: row.get(29)?,
                danceability: row.get(30)?,
                acousticness: row.get(31)?,
                ai_tagged_at: row.get(32)?,
                updated_at: row.get(33)?,
                file_extension,
            })
        },
    )
    .map_err(|_| StatusCode::NOT_FOUND)
}

fn fetch_updated_playlists(
    conn: &Connection,
    playlist_ids: &[i64],
    since: &str,
) -> Result<Vec<SyncPlaylistMeta>, StatusCode> {
    // For simplicity, return all playlists that were updated since the timestamp
    // (or all if updated_at is NULL, meaning they haven't been tagged with timestamps yet)
    let mut result = Vec::new();
    for &pid in playlist_ids {
        let updated: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM playlists WHERE id = ? AND (updated_at > ? OR updated_at IS NULL)",
                rusqlite::params![pid, since],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if updated {
            if let Ok(playlists) = fetch_sync_playlists(conn, &[pid]) {
                result.extend(playlists);
            }
        }
    }
    Ok(result)
}

fn fetch_updated_tracks(
    conn: &Connection,
    track_ids: &[i64],
    since: &str,
) -> Result<Vec<SyncTrackMeta>, StatusCode> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    for &tid in track_ids {
        if !seen.insert(tid) {
            continue;
        }
        let updated: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM tracks WHERE id = ? AND (updated_at > ? OR updated_at IS NULL)",
                rusqlite::params![tid, since],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if updated {
            if let Ok(track) = fetch_one_sync_track(conn, tid) {
                result.push(track);
            }
        }
    }
    Ok(result)
}

fn serve_range_request(
    file_path: &str,
    file_size: u64,
    range: &str,
) -> Result<Response, StatusCode> {
    use std::io::{Read, Seek, SeekFrom};

    // Parse "bytes=start-end"
    let range = range.strip_prefix("bytes=").ok_or(StatusCode::RANGE_NOT_SATISFIABLE)?;
    let parts: Vec<&str> = range.split('-').collect();
    let start: u64 = parts[0].parse().unwrap_or(0);
    let end: u64 = if parts.len() > 1 && !parts[1].is_empty() {
        parts[1].parse().unwrap_or(file_size - 1)
    } else {
        file_size - 1
    };

    if start >= file_size || end >= file_size || start > end {
        return Err(StatusCode::RANGE_NOT_SATISFIABLE);
    }

    let length = end - start + 1;
    let mut file = std::fs::File::open(file_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.seek(SeekFrom::Start(start))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut buf = vec![0u8; length as usize];
    file.read_exact(&mut buf)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let content_type = guess_content_type(file_path);
    Ok(Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_size),
        )
        .header(header::ACCEPT_RANGES, "bytes")
        .body(Body::from(buf))
        .unwrap())
}

fn guess_content_type(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
    {
        Some("mp3") => "audio/mpeg",
        Some("m4a") | Some("aac") => "audio/mp4",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("opus") => "audio/opus",
        _ => "application/octet-stream",
    }
}

fn chrono_now() -> String {
    // Simple ISO 8601 timestamp without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    // Format as "2024-01-15T10:30:00Z" — good enough for sync timestamps
    let days = secs / 86400;
    let time = secs % 86400;
    let hours = time / 3600;
    let mins = (time % 3600) / 60;
    let s = time % 60;

    // Approximate date calculation
    let mut y = 1970i64;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let months = [31, if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0;
    for &dm in &months {
        if remaining < dm {
            break;
        }
        remaining -= dm;
        m += 1;
    }

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        m + 1,
        remaining + 1,
        hours,
        mins,
        s
    )
}
