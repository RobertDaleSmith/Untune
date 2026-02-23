mod audio;
mod commands;
mod db;
mod import;
mod models;
mod playback;

use db::Database;
use playback::PlaybackState;
use tauri::{image::Image, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Suppress noisy panic output from caught panics (e.g. rodio decoder on bad files).
    // Background thread panics (rodio decode thread) are logged instead of crashing.
    std::panic::set_hook(Box::new(|info| {
        log::error!("Caught panic: {}", info);
    }));
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let db = Database::init(app.handle())?;
            app.manage(db);
            app.manage(PlaybackState::new());

            // Set window/dock icon
            if let Some(window) = app.get_webview_window("main") {
                let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                    .expect("failed to load icon");
                let _ = window.set_icon(icon);
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import::import_library,
            commands::tracks::get_tracks,
            commands::tracks::get_track_count,
            commands::tracks::search_tracks,
            commands::playlists::get_playlists,
            commands::playlists::get_playlist_tracks,
            commands::playback::play_track,
            commands::playback::play_queue,
            commands::playback::pause_playback,
            commands::playback::resume_playback,
            commands::playback::stop_playback,
            commands::playback::seek_playback,
            commands::playback::next_track,
            commands::playback::previous_track,
            commands::playback::get_playback_info,
            commands::playback::set_volume,
            commands::playback::set_shuffle,
            commands::playback::set_repeat_mode,
            commands::playback::toggle_shuffle,
            commands::playback::cycle_repeat,
            commands::playback::get_view_settings,
            commands::playback::save_view_settings,
            commands::browse::get_albums,
            commands::browse::get_artists,
            commands::browse::get_genres,
            commands::browse::get_album_tracks,
            commands::browse::get_artist_tracks,
            commands::browse::get_genre_tracks,
            commands::artwork::get_artwork_data_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
