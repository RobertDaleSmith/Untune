use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, Database};
use crate::playback::PlaybackState;

use super::state::{AssistantState, ConversationMessage};
use super::tools;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MODEL: &str = "claude-sonnet-4-5-20250929";
const MAX_TOKENS: u32 = 1024;

fn build_system_prompt(conn: &rusqlite::Connection, playback: &PlaybackState) -> String {
    let track_count = db::get_track_count(conn).unwrap_or(0);
    let album_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT COALESCE(album, '')) FROM tracks", [], |r| r.get(0),
    ).unwrap_or(0);
    let artist_count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT COALESCE(artist, '')) FROM tracks", [], |r| r.get(0),
    ).unwrap_or(0);

    let playback_state = if playback.is_playing() {
        let track_id = playback.current_track_id();
        if let Some(id) = track_id {
            let title: String = conn.query_row(
                "SELECT COALESCE(title, 'Unknown') FROM tracks WHERE id = ?",
                rusqlite::params![id], |r| r.get(0),
            ).unwrap_or_else(|_| "Unknown".to_string());
            let artist: String = conn.query_row(
                "SELECT COALESCE(artist, 'Unknown') FROM tracks WHERE id = ?",
                rusqlite::params![id], |r| r.get(0),
            ).unwrap_or_else(|_| "Unknown".to_string());
            format!("Now playing: \"{}\" by {}", title, artist)
        } else {
            "Playing (unknown track)".to_string()
        }
    } else if playback.is_paused() {
        "Paused".to_string()
    } else {
        "Stopped".to_string()
    };

    format!(
        "You are the voice assistant for Untune, a desktop music player.\n\
         Library: {} tracks, {} albums, {} artists.\n\
         Current playback: {}.\n\
         Be concise — 1-2 sentences. Users are listening to music.\n\
         Search first, then play. Never expose internal IDs to the user.\n\
         Rating: 1-5 stars (stored 0-100 in DB, tools handle conversion). Duration in seconds. Dates ISO format.",
        track_count, album_count, artist_count, playback_state
    )
}

pub async fn send_message(
    user_message: &str,
    app: &AppHandle,
    assistant_state: &AssistantState,
) -> Result<String, String> {
    let api_key = assistant_state.get_api_key()
        .ok_or("No API key configured")?;

    // Push user message to conversation
    assistant_state.push_message(ConversationMessage {
        role: "user".to_string(),
        content: json!(user_message),
    });

    // Get DB and playback state
    let db = app.state::<Database>();
    let playback = app.state::<PlaybackState>();

    let system_prompt = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        build_system_prompt(&conn, &playback)
    };

    let tool_defs = tools::tool_definitions();
    let mut full_response = String::new();

    // Tool-use loop: keep calling until we get a final text response
    // Extra iterations allow for prompt-too-long retries after trimming
    for _iteration in 0..8 {
        let conversation = assistant_state.get_conversation();

        let body = json!({
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "system": system_prompt,
            "tools": tool_defs,
            "messages": conversation,
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(API_URL)
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("API request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();

            // If prompt is too long, trim older messages and retry this iteration
            if (status.as_u16() == 400 || status.as_u16() == 413)
                && text.contains("prompt is too long")
            {
                if assistant_state.trim_oldest() {
                    continue;
                }
            }

            return Err(format!("API error {}: {}", status, text));
        }

        let response_json: Value = resp.json().await
            .map_err(|e| format!("Failed to parse API response: {}", e))?;

        let content = response_json["content"]
            .as_array()
            .ok_or("No content in response")?;

        let stop_reason = response_json["stop_reason"].as_str().unwrap_or("");

        // Collect text blocks and tool_use blocks
        let mut text_parts = Vec::new();
        let mut tool_uses = Vec::new();

        for block in content {
            match block["type"].as_str() {
                Some("text") => {
                    if let Some(text) = block["text"].as_str() {
                        text_parts.push(text.to_string());
                        let _ = app.emit("assistant-text-delta", text);
                    }
                }
                Some("tool_use") => {
                    tool_uses.push(block.clone());
                }
                _ => {}
            }
        }

        // Push assistant message to conversation
        assistant_state.push_message(ConversationMessage {
            role: "assistant".to_string(),
            content: json!(content),
        });

        if !text_parts.is_empty() {
            full_response = text_parts.join("");
        }

        // If there are tool calls, execute them and continue the loop
        if stop_reason == "tool_use" && !tool_uses.is_empty() {
            let mut tool_results = Vec::new();

            for tool_use in &tool_uses {
                let tool_name = tool_use["name"].as_str().unwrap_or("");
                let tool_id = tool_use["id"].as_str().unwrap_or("");
                let tool_input = &tool_use["input"];

                let _ = app.emit("assistant-tool-called", json!({
                    "tool": tool_name,
                    "input": tool_input,
                }));

                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                let result = tools::execute(tool_name, tool_input, &conn, &playback, app);
                drop(conn);

                match result {
                    Ok(output) => {
                        tool_results.push(json!({
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": output.to_string(),
                        }));
                    }
                    Err(err) => {
                        tool_results.push(json!({
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "is_error": true,
                            "content": err,
                        }));
                    }
                }
            }

            // Push tool results as user message
            assistant_state.push_message(ConversationMessage {
                role: "user".to_string(),
                content: json!(tool_results),
            });

            // Continue loop for follow-up
            continue;
        }

        // No more tool calls — done
        break;
    }

    let _ = app.emit("assistant-response-complete", &full_response);

    Ok(full_response)
}
