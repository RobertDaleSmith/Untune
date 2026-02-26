use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::db;

const MAX_CONVERSATION_MESSAGES: usize = 20;
const MAX_TOOL_RESULT_CHARS: usize = 2000;
const XOR_KEY: u8 = 0x5A;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: serde_json::Value,
}

pub struct AssistantState {
    pub api_key: Mutex<Option<String>>,
    pub conversation: Mutex<Vec<ConversationMessage>>,
    #[allow(dead_code)]
    pub pre_duck_volume: Mutex<Option<f32>>,
}

impl AssistantState {
    pub fn new() -> Self {
        let key = std::env::var("ANTHROPIC_API_KEY").ok();
        AssistantState {
            api_key: Mutex::new(key),
            conversation: Mutex::new(Vec::new()),
            pre_duck_volume: Mutex::new(None),
        }
    }

    pub fn init_from_db(&self, conn: &rusqlite::Connection) {
        if self.api_key.lock().unwrap().is_some() {
            return;
        }
        if let Ok(Some(encoded)) = db::get_preference(conn, "assistant_api_key") {
            if let Some(decoded) = xor_decode(&encoded) {
                *self.api_key.lock().unwrap() = Some(decoded);
            }
        }
    }

    pub fn has_api_key(&self) -> bool {
        self.api_key.lock().unwrap().is_some()
    }

    pub fn set_api_key(&self, key: &str, conn: &rusqlite::Connection) -> Result<(), String> {
        let encoded = xor_encode(key);
        db::set_preference(conn, "assistant_api_key", &encoded)
            .map_err(|e| e.to_string())?;
        *self.api_key.lock().unwrap() = Some(key.to_string());
        Ok(())
    }

    pub fn get_api_key(&self) -> Option<String> {
        self.api_key.lock().unwrap().clone()
    }

    pub fn push_message(&self, msg: ConversationMessage) {
        let msg = truncate_tool_results(msg);
        let mut conv = self.conversation.lock().unwrap();
        conv.push(msg);
        // Keep only the last N messages
        if conv.len() > MAX_CONVERSATION_MESSAGES {
            let drain = conv.len() - MAX_CONVERSATION_MESSAGES;
            conv.drain(..drain);
        }
    }

    pub fn get_conversation(&self) -> Vec<ConversationMessage> {
        self.conversation.lock().unwrap().clone()
    }

    /// Drop the oldest pair of messages (to reduce prompt size on retry).
    /// Returns true if messages were dropped.
    pub fn trim_oldest(&self) -> bool {
        let mut conv = self.conversation.lock().unwrap();
        if conv.len() > 2 {
            // Drop from front, keeping at least the latest user message
            conv.drain(..2);
            true
        } else {
            false
        }
    }

    pub fn clear_conversation(&self) {
        self.conversation.lock().unwrap().clear();
    }
}

/// Truncate tool_result content strings that exceed the limit.
/// This prevents huge track listings from bloating conversation history.
fn truncate_tool_results(mut msg: ConversationMessage) -> ConversationMessage {
    if msg.role != "user" {
        return msg;
    }
    // Tool results are an array of objects with "content" fields
    if let Some(arr) = msg.content.as_array_mut() {
        for item in arr.iter_mut() {
            if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                if let Some(content) = item.get("content").and_then(|c| c.as_str()) {
                    if content.len() > MAX_TOOL_RESULT_CHARS {
                        let truncated = format!(
                            "{}... [truncated, {} total chars]",
                            &content[..MAX_TOOL_RESULT_CHARS],
                            content.len()
                        );
                        item["content"] = serde_json::Value::String(truncated);
                    }
                }
            }
        }
    }
    msg
}

fn xor_encode(input: &str) -> String {
    use base64::Engine;
    let bytes: Vec<u8> = input.bytes().map(|b| b ^ XOR_KEY).collect();
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

fn xor_decode(encoded: &str) -> Option<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let decoded: Vec<u8> = bytes.iter().map(|b| b ^ XOR_KEY).collect();
    String::from_utf8(decoded).ok()
}
