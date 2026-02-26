use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::assistant::state::AssistantState;
use crate::db::Database;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResponse {
    pub text: String,
}

#[tauri::command]
pub fn assistant_available(assistant: State<'_, AssistantState>) -> bool {
    assistant.has_api_key()
}

#[tauri::command]
pub fn has_assistant_api_key(assistant: State<'_, AssistantState>) -> bool {
    assistant.has_api_key()
}

#[tauri::command]
pub fn set_assistant_api_key(
    key: String,
    db: State<'_, Database>,
    assistant: State<'_, AssistantState>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    assistant.set_api_key(&key, &conn)
}

#[tauri::command]
pub async fn assistant_send_message(
    message: String,
    app: AppHandle,
    assistant: State<'_, AssistantState>,
) -> Result<AssistantResponse, String> {
    let text = crate::assistant::api::send_message(&message, &app, &assistant).await?;
    Ok(AssistantResponse { text })
}

#[tauri::command]
pub fn assistant_clear_history(
    assistant: State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.clear_conversation();
    Ok(())
}
