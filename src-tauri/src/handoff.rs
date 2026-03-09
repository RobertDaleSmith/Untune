use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffState {
    #[serde(rename = "trackPersistentId")]
    pub track_persistent_id: String,
    pub position: f64,
    #[serde(rename = "queueSource")]
    pub queue_source: Option<String>,
    pub shuffle: bool,
    #[serde(rename = "repeatMode")]
    pub repeat_mode: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "deviceName")]
    pub device_name: String,
}

pub fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

pub async fn push_state(url: &str, token: &str, state: &HandoffState) -> Result<(), String> {
    let client = reqwest::Client::new();
    let endpoint = format!("{}/api/state/{}", url.trim_end_matches('/'), token);
    let resp = client
        .put(&endpoint)
        .json(state)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Handoff push failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Handoff push returned {}", resp.status()));
    }
    Ok(())
}

pub async fn pull_state(url: &str, token: &str) -> Result<Option<HandoffState>, String> {
    let client = reqwest::Client::new();
    let endpoint = format!("{}/api/state/{}", url.trim_end_matches('/'), token);
    let resp = client
        .get(&endpoint)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Handoff pull failed: {}", e))?;

    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(format!("Handoff pull returned {}", resp.status()));
    }

    let state = resp
        .json::<HandoffState>()
        .await
        .map_err(|e| format!("Handoff parse failed: {}", e))?;
    Ok(Some(state))
}
