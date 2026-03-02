use serde::Deserialize;

const HAIKU_MODEL: &str = "claude-haiku-4-5-20251001";
const API_URL: &str = "https://api.anthropic.com/v1/messages";

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

pub async fn generate_bio(
    api_key: &str,
    entity_type: &str,
    entity_name: &str,
    entity_detail: &str,
) -> Result<String, String> {
    let prompt = match entity_type {
        "artist" => format!(
            "Write a concise 2-3 paragraph biography of the music artist \"{}\".\n\
             Include their genre, notable works, and significance. Keep it factual and engaging.\n\
             If you don't know much about them, say so briefly rather than making things up.",
            entity_name
        ),
        "album" => format!(
            "Write a concise 1-2 paragraph description of the album \"{}\" by {}.\n\
             Include the year, genre, themes, and significance if known.\n\
             If you don't know much about it, say so briefly rather than making things up.",
            entity_name, entity_detail
        ),
        _ => return Err(format!("Unknown entity type: {}", entity_type)),
    };

    let body = serde_json::json!({
        "model": HAIKU_MODEL,
        "max_tokens": 512,
        "messages": [{ "role": "user", "content": prompt }],
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(API_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let api_resp: ApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    api_resp
        .content
        .iter()
        .find_map(|b| match b {
            ContentBlock::Text { text } => Some(text.clone()),
            _ => None,
        })
        .ok_or("No text in API response".to_string())
}
