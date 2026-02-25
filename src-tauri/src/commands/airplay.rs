#[cfg(target_os = "macos")]
use crate::airplay;

#[tauri::command]
pub fn get_audio_route() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let route = airplay::get_current_route()?;
        serde_json::to_value(&route).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({ "name": "Default", "isAirplay": false }))
    }
}

#[tauri::command]
pub fn get_audio_devices() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let devices = airplay::get_output_devices()?;
        serde_json::to_value(&devices).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!([{ "id": 0, "name": "Default", "isAirplay": false, "isDefault": true }]))
    }
}

#[tauri::command]
pub fn set_audio_device(device_id: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        airplay::set_output_device(device_id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Audio device selection is only available on macOS".into())
    }
}
