use rusqlite::params;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Database;

const HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
const BATCH_SIZE: usize = 100;
const MAX_RETRIES: u32 = 5;
const INTER_BATCH_DELAY_MS: u64 = 500;

#[derive(Debug, Clone)]
pub struct AiTagProgress {
    pub tagged: Arc<AtomicU64>,
    pub total: Arc<AtomicU64>,
    pub cancel: Arc<AtomicBool>,
}

impl AiTagProgress {
    pub fn new() -> Self {
        Self {
            tagged: Arc::new(AtomicU64::new(0)),
            total: Arc::new(AtomicU64::new(0)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TagResult {
    #[serde(alias = "i")]
    id: i64,
    #[serde(alias = "m")]
    mood: Option<String>,
    #[serde(alias = "e")]
    energy: Option<i32>,
    #[serde(alias = "b")]
    bpm: Option<i32>,
    #[serde(alias = "d")]
    danceability: Option<i32>,
    #[serde(alias = "a")]
    acousticness: Option<i32>,
    #[serde(alias = "v")]
    vibe_tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(other)]
    Other,
}

struct TrackInfo {
    id: i64,
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: Option<i32>,
    duration: Option<f64>,
}

pub async fn run_tagging(app: AppHandle, progress: AiTagProgress) {
    let api_key = {
        let db = app.state::<Database>();
        let conn = db.conn.lock().unwrap();
        crate::db::get_preference(&conn, "anthropic_api_key")
            .ok()
            .flatten()
            .filter(|k| !k.is_empty())
            .or_else(|| {
                app.state::<crate::assistant::state::AssistantState>().get_api_key()
            })
    };

    let api_key = match api_key {
        Some(k) if !k.is_empty() => k,
        _ => {
            log::warn!("AI tagging: no API key configured");
            return;
        }
    };

    // Get untagged tracks
    let tracks = {
        let db = app.state::<Database>();
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, COALESCE(artist,''), COALESCE(album,''), \
                 COALESCE(genre,''), year, duration \
                 FROM tracks WHERE ai_tagged_at IS NULL",
            )
            .unwrap();
        let rows = stmt
            .query_map([], |row| {
                Ok(TrackInfo {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    genre: row.get(4)?,
                    year: row.get(5)?,
                    duration: row.get(6)?,
                })
            })
            .unwrap();
        rows.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };

    let total = tracks.len() as u64;
    progress.total.store(total, Ordering::Relaxed);
    progress.tagged.store(0, Ordering::Relaxed);

    if total == 0 {
        log::info!("AI tagging: all tracks already tagged");
        return;
    }

    log::info!("AI tagging: {} tracks to tag", total);

    let client = reqwest::Client::new();

    for chunk in tracks.chunks(BATCH_SIZE) {
        if progress.cancel.load(Ordering::Relaxed) {
            log::info!("AI tagging: cancelled");
            break;
        }

        let mut retries = 0u32;
        let mut succeeded = false;

        while retries <= MAX_RETRIES {
            if progress.cancel.load(Ordering::Relaxed) {
                break;
            }

            match tag_batch(&client, &api_key, chunk).await {
                Ok(results) => {
                    let db = app.state::<Database>();
                    let conn = db.conn.lock().unwrap();
                    let tx = conn.unchecked_transaction().unwrap();
                    {
                        let mut stmt = tx
                            .prepare(
                                "UPDATE tracks SET mood=?1, energy=?2, vibe_tags=?3, bpm=?4, \
                                 danceability=?5, acousticness=?6, ai_tagged_at=datetime('now') \
                                 WHERE id=?7",
                            )
                            .unwrap();
                        for r in &results {
                            let vibe_json = r
                                .vibe_tags
                                .as_ref()
                                .map(|v| serde_json::to_string(v).unwrap_or_default());
                            let _ = stmt.execute(params![
                                r.mood,
                                r.energy,
                                vibe_json,
                                r.bpm,
                                r.danceability,
                                r.acousticness,
                                r.id,
                            ]);
                        }
                    }
                    let _ = tx.commit();

                    let prev = progress.tagged.load(Ordering::Relaxed);
                    let new_tagged = prev + results.len() as u64;
                    progress.tagged.store(new_tagged, Ordering::Relaxed);

                    let _ = app.emit(
                        "ai-tag-progress",
                        serde_json::json!({ "tagged": new_tagged, "total": total }),
                    );
                    succeeded = true;
                    break;
                }
                Err(TagBatchError::RateLimit { retry_after_secs }) => {
                    retries += 1;
                    let wait = retry_after_secs.unwrap_or_else(|| {
                        // Exponential backoff: 10s, 20s, 40s, 80s, 160s
                        10u64.saturating_mul(1u64 << (retries - 1))
                    });
                    log::warn!(
                        "AI tagging: rate limited, waiting {}s (retry {}/{})",
                        wait, retries, MAX_RETRIES
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                }
                Err(TagBatchError::Other(msg)) => {
                    retries += 1;
                    log::warn!(
                        "AI tagging batch failed: {} (retry {}/{})",
                        msg, retries, MAX_RETRIES
                    );
                    // Brief pause before retry on non-rate-limit errors
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }

        if !succeeded {
            log::warn!("AI tagging: batch skipped after {} retries", MAX_RETRIES);
            // Don't count skipped tracks as tagged — they'll be retried next run
        }

        // Small delay between batches to avoid hitting rate limits
        if !progress.cancel.load(Ordering::Relaxed) {
            tokio::time::sleep(std::time::Duration::from_millis(INTER_BATCH_DELAY_MS)).await;
        }
    }

    let tagged = progress.tagged.load(Ordering::Relaxed);
    log::info!("AI tagging complete: {}/{} tagged", tagged, total);
    let _ = app.emit(
        "ai-tag-progress",
        serde_json::json!({ "tagged": tagged, "total": total, "done": true }),
    );
}

enum TagBatchError {
    RateLimit { retry_after_secs: Option<u64> },
    Other(String),
}

const SYSTEM_PROMPT: &str = "\
Tag music tracks. For each input row (id|title|artist|album|genre|year|dur), \
return a JSON array with compact keys: \
i=id, m=mood, e=energy(1-10), b=bpm, d=danceability(1-10), a=acousticness(1-10), v=vibe_tags(2-3 tags).\n\
Moods: happy,sad,melancholy,aggressive,peaceful,romantic,mysterious,triumphant,nostalgic,playful,dark,uplifting,tense,dreamy,energetic,relaxed.\n\
Output ONLY the JSON array, no markdown fences, no other text. Keep output compact (single line, no extra whitespace).";

async fn tag_batch(
    client: &reqwest::Client,
    api_key: &str,
    tracks: &[TrackInfo],
) -> Result<Vec<TagResult>, TagBatchError> {
    // Compact tab-delimited input instead of pretty JSON
    let mut track_lines = String::with_capacity(tracks.len() * 80);
    for t in tracks {
        use std::fmt::Write;
        let _ = write!(
            track_lines,
            "{}|{}|{}|{}|{}|{}|{}\n",
            t.id,
            t.title,
            t.artist,
            t.album,
            t.genre,
            t.year.map(|y| y.to_string()).unwrap_or_default(),
            t.duration.map(|d| format!("{:.0}", d)).unwrap_or_default(),
        );
    }

    let body = serde_json::json!({
        "model": HAIKU_MODEL,
        "max_tokens": tracks.len() * 60,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "messages": [{ "role": "user", "content": track_lines.trim() }],
    });

    let resp = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| TagBatchError::Other(format!("API request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            return Err(TagBatchError::RateLimit { retry_after_secs: retry_after });
        }
        let text = resp.text().await.unwrap_or_default();
        return Err(TagBatchError::Other(format!("API error {}: {}", status, text)));
    }

    let api_resp: ApiResponse = resp
        .json()
        .await
        .map_err(|e| TagBatchError::Other(format!("Parse API response failed: {}", e)))?;

    let text = api_resp
        .content
        .iter()
        .find_map(|b| match b {
            ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .ok_or_else(|| TagBatchError::Other("No text in API response".into()))?;

    // Extract JSON array from response (may have markdown fences)
    let json_str = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let results: Vec<TagResult> =
        serde_json::from_str(json_str).map_err(|e| TagBatchError::Other(format!("Parse tags failed: {}", e)))?;

    Ok(results)
}
