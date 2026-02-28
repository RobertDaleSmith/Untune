use serde::Serialize;
use tauri::State;

use crate::db::{self, Database};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResult {
    pub synced_lyrics: Option<String>,
    pub plain_lyrics: Option<String>,
    pub instrumental: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibResponse {
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
    instrumental: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibSearchResult {
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
    instrumental: Option<bool>,
}

#[tauri::command]
pub async fn fetch_lyrics(
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: Option<f64>,
    db: State<'_, Database>,
) -> Result<LyricsResult, String> {
    // Check cache first
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some((synced, plain, instrumental)) =
            db::get_cached_lyrics(&conn, &track_name, &artist_name, &album_name)
                .map_err(|e| e.to_string())?
        {
            return Ok(LyricsResult {
                synced_lyrics: synced,
                plain_lyrics: plain,
                instrumental,
            });
        }
    }

    // Try exact match via GET /api/get
    let mut url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}",
        urlencoded(&track_name),
        urlencoded(&artist_name),
    );
    if !album_name.is_empty() {
        url.push_str(&format!("&album_name={}", urlencoded(&album_name)));
    }
    if let Some(dur) = duration {
        url.push_str(&format!("&duration={}", dur.round() as i64));
    }

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "Untune Music Player v1.0")
        .send()
        .await
        .map_err(|e| format!("LRCLIB request failed: {}", e))?;

    let mut result = LyricsResult {
        synced_lyrics: None,
        plain_lyrics: None,
        instrumental: false,
    };

    if resp.status().is_success() {
        if let Ok(body) = resp.json::<LrcLibResponse>().await {
            result.synced_lyrics = body.synced_lyrics.filter(|s| !s.is_empty());
            result.plain_lyrics = body.plain_lyrics.filter(|s| !s.is_empty());
            result.instrumental = body.instrumental.unwrap_or(false);
        }
    }

    // Fallback: if no synced lyrics, try search endpoint
    if result.synced_lyrics.is_none() && !result.instrumental {
        let search_url = format!(
            "https://lrclib.net/api/search?track_name={}&artist_name={}",
            urlencoded(&track_name),
            urlencoded(&artist_name),
        );

        if let Ok(resp) = client
            .get(&search_url)
            .header("User-Agent", "Untune Music Player v1.0")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(results) = resp.json::<Vec<LrcLibSearchResult>>().await {
                    // Pick the first result with synced lyrics, or first result with any lyrics
                    let synced_match = results.iter().find(|r| {
                        r.synced_lyrics
                            .as_ref()
                            .map(|s| !s.is_empty())
                            .unwrap_or(false)
                    });
                    let any_match = results.first();

                    if let Some(m) = synced_match.or(any_match) {
                        if result.synced_lyrics.is_none() {
                            result.synced_lyrics =
                                m.synced_lyrics.as_ref().filter(|s| !s.is_empty()).cloned();
                        }
                        if result.plain_lyrics.is_none() {
                            result.plain_lyrics =
                                m.plain_lyrics.as_ref().filter(|s| !s.is_empty()).cloned();
                        }
                        result.instrumental = m.instrumental.unwrap_or(false);
                    }
                }
            }
        }
    }

    // Cache the result (even if empty)
    {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let _ = db::save_cached_lyrics(
            &conn,
            &track_name,
            &artist_name,
            &album_name,
            result.synced_lyrics.as_deref(),
            result.plain_lyrics.as_deref(),
            result.instrumental,
        );
    }

    Ok(result)
}

fn urlencoded(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
        }
    }
    out
}
