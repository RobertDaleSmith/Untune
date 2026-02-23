use std::path::Path;
use std::process::Command;

use crate::models::{JxaPlaylist, JxaTrack, JxaTrackData};

pub fn extract_tracks(scripts_dir: &Path) -> Result<Vec<JxaTrack>, Box<dyn std::error::Error>> {
    let script_path = scripts_dir.join("extract_tracks.js");
    let output = Command::new("osascript")
        .arg("-l")
        .arg("JavaScript")
        .arg(&script_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript failed: {}", stderr).into());
    }

    let tmp_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if tmp_path.is_empty() {
        return Err("osascript returned empty output".into());
    }

    let json_bytes = std::fs::read(&tmp_path)?;
    let _ = std::fs::remove_file(&tmp_path);

    // Parse as UTF-8 lossy in case track metadata has invalid sequences
    let json_str = String::from_utf8_lossy(&json_bytes);
    let data: JxaTrackData = serde_json::from_str(&json_str)?;
    Ok(data.transpose())
}

pub fn extract_playlists(
    scripts_dir: &Path,
) -> Result<Vec<JxaPlaylist>, Box<dyn std::error::Error>> {
    let script_path = scripts_dir.join("extract_playlists.js");
    let output = Command::new("osascript")
        .arg("-l")
        .arg("JavaScript")
        .arg(&script_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript failed: {}", stderr).into());
    }

    let tmp_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if tmp_path.is_empty() {
        return Err("osascript returned empty output".into());
    }

    let json_bytes = std::fs::read(&tmp_path)?;
    let _ = std::fs::remove_file(&tmp_path);

    let json_str = String::from_utf8_lossy(&json_bytes);
    let playlists: Vec<JxaPlaylist> = serde_json::from_str(&json_str)?;
    Ok(playlists)
}
