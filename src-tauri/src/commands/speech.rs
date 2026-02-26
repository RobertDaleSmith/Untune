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
