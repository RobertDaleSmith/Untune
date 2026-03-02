use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::db;
use crate::models::Track;
use crate::playback::PlaybackState;
use crate::smart_playlists;

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "search_library",
            "description": "Full-text search across track titles, artists, albums, genres, and composers. Use this to find specific songs, artists, or albums.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query (e.g. artist name, song title, album name)" },
                    "limit": { "type": "integer", "description": "Max results (default 20)", "default": 20 }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "query_tracks",
            "description": "Query tracks using structured filters. Supports text fields (title, artist, album, genre, composer, mood, vibe_tags), numeric fields (year, play_count, rating 1-5, duration in seconds, energy 1-10, bpm, danceability 1-10, acousticness 1-10), date fields (date_added, last_played_at), and boolean (loved). Operators: text: is, contains, starts_with; numeric: eq, gt, gte, lt, lte, between; date: in_last (days), before, after. Mood values: happy, sad, melancholy, aggressive, peaceful, romantic, mysterious, triumphant, nostalgic, playful, dark, uplifting, tense, dreamy, energetic, relaxed.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "match_mode": { "type": "string", "enum": ["all", "any"], "default": "all" },
                    "rules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": { "type": "string" },
                                "op": { "type": "string" },
                                "value": {}
                            },
                            "required": ["field", "op"]
                        }
                    },
                    "limit": { "type": "integer", "description": "Max results (default 50)" },
                    "sort_by": { "type": "string", "description": "Sort field (random, title, artist, album, play_count, rating, date_added, last_played_at, duration)" },
                    "sort_dir": { "type": "string", "enum": ["asc", "desc"], "default": "desc" }
                },
                "required": ["rules"]
            }
        }),
        json!({
            "name": "get_playback_state",
            "description": "Get the current playback state including playing track, position, volume, shuffle, and repeat mode.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "play_tracks",
            "description": "Play a list of tracks by their IDs. Start from the first track by default.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "track_ids": { "type": "array", "items": { "type": "integer" }, "description": "Track IDs to play" },
                    "start_index": { "type": "integer", "description": "Index to start from (default 0)", "default": 0 }
                },
                "required": ["track_ids"]
            }
        }),
        json!({
            "name": "play_album",
            "description": "Play all tracks from a specific album.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "album": { "type": "string", "description": "Album name" },
                    "artist": { "type": "string", "description": "Album artist name" }
                },
                "required": ["album", "artist"]
            }
        }),
        json!({
            "name": "play_artist",
            "description": "Play all tracks by a specific artist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "artist": { "type": "string", "description": "Artist name" }
                },
                "required": ["artist"]
            }
        }),
        json!({
            "name": "play_playlist",
            "description": "Play all tracks from a playlist by its ID.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "playlist_id": { "type": "integer", "description": "Playlist ID" }
                },
                "required": ["playlist_id"]
            }
        }),
        json!({
            "name": "control_playback",
            "description": "Control playback: pause, resume, next, previous, stop, or adjust volume/shuffle/repeat.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["pause", "resume", "next", "previous", "stop", "toggle_shuffle", "set_volume", "set_repeat"],
                        "description": "Playback action"
                    },
                    "value": { "description": "For set_volume: 0.0-1.0. For set_repeat: off/all/one." }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "get_library_stats",
            "description": "Get library statistics: total tracks, albums, artists, genres, total duration, most played, recently added, etc.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_playlists",
            "description": "List all playlists in the library.",
            "input_schema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "create_playlist",
            "description": "Create a new playlist with optional track IDs.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Playlist name" },
                    "track_ids": { "type": "array", "items": { "type": "integer" }, "description": "Optional track IDs to add" }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "get_listening_history",
            "description": "Get listening history: most played tracks, recently played, top artists, etc.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["most_played", "recently_played", "top_artists", "top_albums", "top_genres"], "description": "History query mode" },
                    "limit": { "type": "integer", "description": "Max results (default 20)", "default": 20 }
                },
                "required": ["mode"]
            }
        }),
        json!({
            "name": "find_similar",
            "description": "Find tracks similar to a given track based on genre, mood, energy, BPM, danceability, acousticness, and artist. Returns a mix of similar tracks for 'play something like this' requests.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "track_id": { "type": "integer", "description": "The seed track ID to find similar tracks for" },
                    "limit": { "type": "integer", "description": "Max results (default 25)", "default": 25 }
                },
                "required": ["track_id"]
            }
        }),
        json!({
            "name": "create_smart_playlist",
            "description": "Create a smart playlist with filter rules. Rules use the same format as query_tracks. Good for mood playlists, genre mixes, etc.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Playlist name" },
                    "match_mode": { "type": "string", "enum": ["all", "any"], "default": "all" },
                    "rules": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": { "type": "string" },
                                "op": { "type": "string" },
                                "value": {}
                            },
                            "required": ["field", "op"]
                        }
                    },
                    "limit": { "type": "integer", "description": "Optional track limit" },
                    "sort_by": { "type": "string", "description": "Sort field" },
                    "sort_dir": { "type": "string", "enum": ["asc", "desc"] }
                },
                "required": ["name", "rules"]
            }
        }),
    ]
}

pub fn execute(
    tool_name: &str,
    input: &Value,
    conn: &Connection,
    playback: &PlaybackState,
    app: &AppHandle,
) -> Result<Value, String> {
    let result = match tool_name {
        "search_library" => exec_search_library(input, conn),
        "query_tracks" => exec_query_tracks(input, conn),
        "get_playback_state" => exec_get_playback_state(playback, conn),
        "get_library_stats" => exec_get_library_stats(conn),
        "get_playlists" => exec_get_playlists(conn),
        "get_listening_history" => exec_get_listening_history(input, conn),
        "play_tracks" => exec_play_tracks(input, conn, playback),
        "play_album" => exec_play_album(input, conn, playback),
        "play_artist" => exec_play_artist(input, conn, playback),
        "play_playlist" => exec_play_playlist(input, conn, playback),
        "control_playback" => exec_control_playback(input, conn, playback),
        "create_playlist" => exec_create_playlist(input, conn),
        "find_similar" => exec_find_similar(input, conn),
        "create_smart_playlist" => exec_create_smart_playlist(input, conn),
        _ => Err(format!("Unknown tool: {}", tool_name)),
    };

    // Notify frontend of playback state changes
    let playback_tools = ["play_tracks", "play_album", "play_artist", "play_playlist", "control_playback"];
    if playback_tools.contains(&tool_name) && result.is_ok() {
        let _ = app.emit("assistant-playback-changed", ());
    }

    // Notify frontend of playlist mutations
    if (tool_name == "create_playlist" || tool_name == "create_smart_playlist") && result.is_ok() {
        let _ = app.emit("assistant-playlist-changed", ());
    }

    result
}

fn track_to_summary(t: &Track) -> Value {
    json!({
        "id": t.id,
        "title": t.title,
        "artist": t.artist,
        "album": t.album,
        "genre": t.genre,
        "year": t.year,
        "duration": t.duration,
        "playCount": t.play_count,
        "rating": t.rating.map(|r| r / 20), // 0-100 -> 0-5 stars
        "loved": t.loved,
        "mood": t.mood,
        "energy": t.energy,
    })
}

fn exec_search_library(input: &Value, conn: &Connection) -> Result<Value, String> {
    let query = input["query"].as_str().ok_or("Missing query")?;
    let limit = input["limit"].as_i64().unwrap_or(20);
    let tracks = db::search_tracks(conn, query, limit).map_err(|e| e.to_string())?;
    let results: Vec<Value> = tracks.iter().map(track_to_summary).collect();
    Ok(json!({ "count": results.len(), "tracks": results }))
}

fn exec_query_tracks(input: &Value, conn: &Connection) -> Result<Value, String> {
    let match_mode = input["match_mode"].as_str().unwrap_or("all");
    let rules = input["rules"].as_array().ok_or("Missing rules array")?;
    let limit = input["limit"].as_i64().unwrap_or(50);
    let sort_by = input["sort_by"].as_str().unwrap_or("play_count");
    let sort_dir = input["sort_dir"].as_str().unwrap_or("desc");

    let rules_json = json!({
        "match": match_mode,
        "rules": rules,
        "limit": { "count": limit, "sortBy": sort_by, "sortDir": sort_dir }
    });

    let tracks = smart_playlists::evaluate(conn, &rules_json.to_string())?;
    let results: Vec<Value> = tracks.iter().map(track_to_summary).collect();
    Ok(json!({ "count": results.len(), "tracks": results }))
}

fn exec_get_playback_state(playback: &PlaybackState, conn: &Connection) -> Result<Value, String> {
    let track_id = playback.current_track_id();
    let track_info = if let Some(id) = track_id {
        conn.query_row(
            &format!("SELECT {} FROM tracks WHERE id = ?", db::TRACK_COLUMNS),
            rusqlite::params![id],
            |row| db::map_track_row(row),
        ).ok().map(|t| track_to_summary(&t))
    } else {
        None
    };

    let repeat = match playback.repeat_mode() {
        crate::playback::RepeatMode::Off => "off",
        crate::playback::RepeatMode::All => "all",
        crate::playback::RepeatMode::One => "one",
    };

    Ok(json!({
        "isPlaying": playback.is_playing(),
        "isPaused": playback.is_paused(),
        "position": playback.position(),
        "duration": playback.duration(),
        "volume": playback.volume(),
        "shuffle": playback.shuffle(),
        "repeatMode": repeat,
        "currentTrack": track_info,
    }))
}

fn exec_get_library_stats(conn: &Connection) -> Result<Value, String> {
    let track_count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let album_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT COALESCE(album, '')) FROM tracks", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let artist_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT COALESCE(artist, '')) FROM tracks", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let genre_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT COALESCE(genre, '')) FROM tracks", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let total_duration: f64 = conn.query_row(
        "SELECT COALESCE(SUM(duration), 0) FROM tracks", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    let total_plays: i64 = conn.query_row(
        "SELECT COALESCE(SUM(play_count), 0) FROM tracks", [], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(json!({
        "trackCount": track_count,
        "albumCount": album_count,
        "artistCount": artist_count,
        "genreCount": genre_count,
        "totalDurationSeconds": total_duration,
        "totalDurationDays": total_duration / 86400.0,
        "totalPlayCount": total_plays,
    }))
}

fn exec_get_playlists(conn: &Connection) -> Result<Value, String> {
    let playlists = db::get_playlists(conn).map_err(|e| e.to_string())?;
    let results: Vec<Value> = playlists.iter().map(|p| {
        json!({
            "id": p.id,
            "name": p.name,
            "isSmart": p.is_smart,
            "isFolder": p.is_folder,
            "trackCount": p.track_count,
        })
    }).collect();
    Ok(json!({ "count": results.len(), "playlists": results }))
}

fn exec_get_listening_history(input: &Value, conn: &Connection) -> Result<Value, String> {
    let mode = input["mode"].as_str().ok_or("Missing mode")?;
    let limit = input["limit"].as_i64().unwrap_or(20);

    match mode {
        "most_played" => {
            let sql = format!(
                "SELECT {} FROM tracks WHERE play_count > 0 ORDER BY play_count DESC LIMIT ?",
                db::TRACK_COLUMNS
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let tracks: Vec<Track> = stmt
                .query_map(rusqlite::params![limit], |row| db::map_track_row(row))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            let results: Vec<Value> = tracks.iter().map(track_to_summary).collect();
            Ok(json!({ "mode": mode, "count": results.len(), "tracks": results }))
        }
        "recently_played" => {
            let sql = format!(
                "SELECT {} FROM tracks WHERE last_played_at IS NOT NULL ORDER BY last_played_at DESC LIMIT ?",
                db::TRACK_COLUMNS
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let tracks: Vec<Track> = stmt
                .query_map(rusqlite::params![limit], |row| db::map_track_row(row))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            let results: Vec<Value> = tracks.iter().map(track_to_summary).collect();
            Ok(json!({ "mode": mode, "count": results.len(), "tracks": results }))
        }
        "top_artists" => {
            let mut stmt = conn.prepare(
                "SELECT COALESCE(artist, '(Unknown)'), SUM(play_count), COUNT(*)
                 FROM tracks WHERE play_count > 0
                 GROUP BY COALESCE(artist, '(Unknown)')
                 ORDER BY SUM(play_count) DESC LIMIT ?",
            ).map_err(|e| e.to_string())?;
            let results: Vec<Value> = stmt
                .query_map(rusqlite::params![limit], |row| {
                    Ok(json!({
                        "artist": row.get::<_, String>(0)?,
                        "totalPlays": row.get::<_, i64>(1)?,
                        "trackCount": row.get::<_, i64>(2)?,
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({ "mode": mode, "count": results.len(), "artists": results }))
        }
        "top_albums" => {
            let mut stmt = conn.prepare(
                "SELECT COALESCE(album, '(Unknown)'), COALESCE(artist, '(Unknown)'), SUM(play_count), COUNT(*)
                 FROM tracks WHERE play_count > 0
                 GROUP BY COALESCE(album, '(Unknown)'), COALESCE(artist, '(Unknown)')
                 ORDER BY SUM(play_count) DESC LIMIT ?",
            ).map_err(|e| e.to_string())?;
            let results: Vec<Value> = stmt
                .query_map(rusqlite::params![limit], |row| {
                    Ok(json!({
                        "album": row.get::<_, String>(0)?,
                        "artist": row.get::<_, String>(1)?,
                        "totalPlays": row.get::<_, i64>(2)?,
                        "trackCount": row.get::<_, i64>(3)?,
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({ "mode": mode, "count": results.len(), "albums": results }))
        }
        "top_genres" => {
            let mut stmt = conn.prepare(
                "SELECT COALESCE(genre, '(Unknown)'), SUM(play_count), COUNT(*)
                 FROM tracks WHERE play_count > 0
                 GROUP BY COALESCE(genre, '(Unknown)')
                 ORDER BY SUM(play_count) DESC LIMIT ?",
            ).map_err(|e| e.to_string())?;
            let results: Vec<Value> = stmt
                .query_map(rusqlite::params![limit], |row| {
                    Ok(json!({
                        "genre": row.get::<_, String>(0)?,
                        "totalPlays": row.get::<_, i64>(1)?,
                        "trackCount": row.get::<_, i64>(2)?,
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            Ok(json!({ "mode": mode, "count": results.len(), "genres": results }))
        }
        _ => Err(format!("Unknown history mode: {}", mode)),
    }
}

fn play_track_list(tracks: &[Track], conn: &Connection, playback: &PlaybackState, start_index: usize) -> Result<Value, String> {
    if tracks.is_empty() {
        return Ok(json!({ "status": "no_tracks", "message": "No tracks found to play" }));
    }

    let ids: Vec<i64> = tracks.iter().map(|t| t.id).collect();
    let idx = start_index.min(ids.len() - 1);
    let track_id = ids[idx];

    let info = db::get_track_file_info(conn, track_id)
        .map_err(|e| format!("Track lookup failed: {}", e))?;
    match info {
        Some((path, duration)) => {
            playback.play(&path, track_id, duration)?;
            playback.set_queue(ids.clone(), idx)?;
            Ok(json!({
                "status": "playing",
                "trackCount": ids.len(),
                "nowPlaying": track_to_summary(&tracks[idx]),
            }))
        }
        None => Err(format!("Track {} has no file path", track_id)),
    }
}

fn exec_play_tracks(input: &Value, conn: &Connection, playback: &PlaybackState) -> Result<Value, String> {
    let track_ids: Vec<i64> = input["track_ids"]
        .as_array()
        .ok_or("Missing track_ids")?
        .iter()
        .filter_map(|v| v.as_i64())
        .collect();
    let start_index = input["start_index"].as_u64().unwrap_or(0) as usize;

    if track_ids.is_empty() {
        return Ok(json!({ "status": "error", "message": "No track IDs provided" }));
    }

    // Load full track info for the first track
    let first_id = track_ids[start_index.min(track_ids.len() - 1)];
    let info = db::get_track_file_info(conn, first_id)
        .map_err(|e| format!("Track lookup failed: {}", e))?;

    match info {
        Some((path, duration)) => {
            playback.play(&path, first_id, duration)?;
            playback.set_queue(track_ids.clone(), start_index.min(track_ids.len() - 1))?;
            Ok(json!({
                "status": "playing",
                "trackCount": track_ids.len(),
                "startedTrackId": first_id,
            }))
        }
        None => Err(format!("Track {} has no file path", first_id)),
    }
}

fn exec_play_album(input: &Value, conn: &Connection, playback: &PlaybackState) -> Result<Value, String> {
    let album = input["album"].as_str().ok_or("Missing album")?;
    let artist = input["artist"].as_str().ok_or("Missing artist")?;
    let tracks = db::get_album_tracks(conn, album, artist).map_err(|e| e.to_string())?;
    play_track_list(&tracks, conn, playback, 0)
}

fn exec_play_artist(input: &Value, conn: &Connection, playback: &PlaybackState) -> Result<Value, String> {
    let artist = input["artist"].as_str().ok_or("Missing artist")?;
    let tracks = db::get_artist_tracks(conn, artist).map_err(|e| e.to_string())?;
    play_track_list(&tracks, conn, playback, 0)
}

fn exec_play_playlist(input: &Value, conn: &Connection, playback: &PlaybackState) -> Result<Value, String> {
    let playlist_id = input["playlist_id"].as_i64().ok_or("Missing playlist_id")?;
    let tracks = db::get_playlist_tracks(conn, playlist_id).map_err(|e| e.to_string())?;
    play_track_list(&tracks, conn, playback, 0)
}

fn exec_control_playback(input: &Value, _conn: &Connection, playback: &PlaybackState) -> Result<Value, String> {
    let action = input["action"].as_str().ok_or("Missing action")?;
    match action {
        "pause" => {
            playback.pause()?;
            Ok(json!({ "status": "paused" }))
        }
        "resume" => {
            playback.resume()?;
            Ok(json!({ "status": "resumed" }))
        }
        "next" => {
            match playback.advance_next() {
                Some((track_id, _)) => {
                    let info = db::get_track_file_info(_conn, track_id)
                        .map_err(|e| e.to_string())?;
                    if let Some((path, duration)) = info {
                        playback.play(&path, track_id, duration)?;
                        Ok(json!({ "status": "next", "trackId": track_id }))
                    } else {
                        Err("Next track has no file path".to_string())
                    }
                }
                None => Ok(json!({ "status": "end_of_queue" })),
            }
        }
        "previous" => {
            match playback.advance_prev() {
                Some((track_id, _)) => {
                    let info = db::get_track_file_info(_conn, track_id)
                        .map_err(|e| e.to_string())?;
                    if let Some((path, duration)) = info {
                        playback.play(&path, track_id, duration)?;
                        Ok(json!({ "status": "previous", "trackId": track_id }))
                    } else {
                        Err("Previous track has no file path".to_string())
                    }
                }
                None => Ok(json!({ "status": "beginning_of_queue" })),
            }
        }
        "stop" => {
            playback.stop()?;
            Ok(json!({ "status": "stopped" }))
        }
        "toggle_shuffle" => {
            let current = playback.shuffle();
            playback.set_shuffle(!current)?;
            Ok(json!({ "status": "shuffle_toggled", "shuffle": !current }))
        }
        "set_volume" => {
            let vol = input["value"].as_f64().ok_or("Missing volume value")? as f32;
            playback.set_volume(vol)?;
            Ok(json!({ "status": "volume_set", "volume": vol }))
        }
        "set_repeat" => {
            let mode_str = input["value"].as_str().ok_or("Missing repeat mode")?;
            let mode = match mode_str {
                "all" => crate::playback::RepeatMode::All,
                "one" => crate::playback::RepeatMode::One,
                _ => crate::playback::RepeatMode::Off,
            };
            playback.set_repeat_mode(mode)?;
            Ok(json!({ "status": "repeat_set", "repeatMode": mode_str }))
        }
        _ => Err(format!("Unknown action: {}", action)),
    }
}

fn exec_create_playlist(input: &Value, conn: &Connection) -> Result<Value, String> {
    let name = input["name"].as_str().ok_or("Missing playlist name")?;
    let playlist_id = db::insert_regular_playlist(conn, name, None)
        .map_err(|e| e.to_string())?;

    // Add tracks if provided
    if let Some(track_ids) = input["track_ids"].as_array() {
        let ids: Vec<i64> = track_ids.iter().filter_map(|v| v.as_i64()).collect();
        if !ids.is_empty() {
            db::add_tracks_to_playlist(conn, playlist_id, &ids)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(json!({
        "status": "created",
        "playlistId": playlist_id,
        "name": name,
    }))
}

fn exec_find_similar(input: &Value, conn: &Connection) -> Result<Value, String> {
    let track_id = input["track_id"].as_i64().ok_or("Missing track_id")?;
    let limit = input["limit"].as_i64().unwrap_or(25);
    let tracks = crate::db::similarity::find_similar_tracks(conn, track_id, limit, &[])
        .map_err(|e| e.to_string())?;
    let results: Vec<Value> = tracks.iter().map(track_to_summary).collect();
    Ok(json!({ "count": results.len(), "tracks": results }))
}

fn exec_create_smart_playlist(input: &Value, conn: &Connection) -> Result<Value, String> {
    let name = input["name"].as_str().ok_or("Missing playlist name")?;
    let match_mode = input["match_mode"].as_str().unwrap_or("all");
    let rules = input["rules"].as_array().ok_or("Missing rules")?;

    let mut rules_obj = json!({
        "match": match_mode,
        "rules": rules,
    });

    // Add limit/sort if provided
    let limit = input["limit"].as_i64();
    let sort_by = input["sort_by"].as_str();
    let sort_dir = input["sort_dir"].as_str().unwrap_or("desc");
    if let Some(count) = limit {
        rules_obj["limit"] = json!({
            "count": count,
            "sortBy": sort_by.unwrap_or("play_count"),
            "sortDir": sort_dir,
        });
    }

    let rules_json = rules_obj.to_string();
    let playlist_id = db::insert_smart_playlist(conn, name, &rules_json, None)
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "status": "created",
        "playlistId": playlist_id,
        "name": name,
    }))
}
