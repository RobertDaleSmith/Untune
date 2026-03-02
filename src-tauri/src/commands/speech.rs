#[cfg(target_os = "macos")]
#[tauri::command]
pub fn check_speech_permission() -> String {
    crate::speech::check_speech_permission()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn check_speech_permission() -> String {
    "unavailable".into()
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn request_speech_permission() {
    crate::speech::request_speech_permission();
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn request_speech_permission() {}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn start_speech_recognition() -> Result<(), String> {
    crate::speech::start_recognition()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn start_speech_recognition() -> Result<(), String> {
    Err("Speech recognition not available on this platform".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn stop_speech_recognition() -> Result<(), String> {
    crate::speech::stop_recognition()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn stop_speech_recognition() -> Result<(), String> {
    Ok(())
}

// --- TTS ---

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn speak_text(text: String) -> Result<(), String> {
    crate::speech::speak(&text);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn speak_text(_text: String) -> Result<(), String> {
    Err("TTS not available on this platform".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn stop_speaking() -> Result<(), String> {
    crate::speech::stop_speak()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn stop_speaking() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn is_speaking() -> bool {
    crate::speech::speaking()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn is_speaking() -> bool {
    false
}
