mod audio;
mod commands;
mod db;
#[cfg(target_os = "macos")]
mod dock_menu;
mod import;
pub mod media;
mod models;
mod playback;

use db::Database;
use media::MediaControlsState;
use playback::{PlaybackState, RepeatMode};
use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};
use std::sync::Mutex;
use tauri::{image::Image, Emitter, Manager};
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};

struct ThemeMenuItems {
    light: CheckMenuItem<tauri::Wry>,
    dark: CheckMenuItem<tauri::Wry>,
    system: CheckMenuItem<tauri::Wry>,
}

struct ViewMenuItems {
    show_status_bar: CheckMenuItem<tauri::Wry>,
    show_album_accent: CheckMenuItem<tauri::Wry>,
    status_bar_on: std::sync::atomic::AtomicBool,
    album_accent_on: std::sync::atomic::AtomicBool,
}

pub struct PlaybackMenuItems {
    pub shuffle: CheckMenuItem<tauri::Wry>,
    pub repeat_off: CheckMenuItem<tauri::Wry>,
    pub repeat_all: CheckMenuItem<tauri::Wry>,
    pub repeat_one: CheckMenuItem<tauri::Wry>,
}

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

            // Read saved preferences before handing db to Tauri state
            let saved_theme = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "theme").ok().flatten()
            };
            let saved_status_bar = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "showStatusBar").ok().flatten()
            };
            let saved_album_accent = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "showAlbumAccent").ok().flatten()
            };

            app.manage(db);
            app.manage(PlaybackState::new());

            // Set window/dock icon
            if let Some(window) = app.get_webview_window("main") {
                let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                    .expect("failed to load icon");
                let _ = window.set_icon(icon);
            }

            // Build theme menu items (stored for radio-toggle behavior)
            let handle = app.handle();
            let default_theme = saved_theme.as_deref().unwrap_or("system");
            let theme_light = CheckMenuItemBuilder::with_id("theme-light", "Light")
                .checked(default_theme == "light")
                .build(handle)?;
            let theme_dark = CheckMenuItemBuilder::with_id("theme-dark", "Dark")
                .checked(default_theme == "dark")
                .build(handle)?;
            let theme_system = CheckMenuItemBuilder::with_id("theme-system", "System")
                .checked(default_theme == "system")
                .build(handle)?;

            let status_bar_default = saved_status_bar.as_deref() != Some("false");
            let show_status_bar = CheckMenuItemBuilder::with_id("show-status-bar", "Show Status Bar")
                .checked(status_bar_default)
                .build(handle)?;

            let album_accent_default = saved_album_accent.as_deref() != Some("false");
            let show_album_accent = CheckMenuItemBuilder::with_id("show-album-accent", "Show Album Accent")
                .checked(album_accent_default)
                .build(handle)?;

            // Playback menu items
            let pb_shuffle = CheckMenuItemBuilder::with_id("pb-shuffle", "Shuffle")
                .build(handle)?;
            let pb_repeat_off = CheckMenuItemBuilder::with_id("pb-repeat-off", "Off")
                .checked(true)
                .build(handle)?;
            let pb_repeat_all = CheckMenuItemBuilder::with_id("pb-repeat-all", "All")
                .build(handle)?;
            let pb_repeat_one = CheckMenuItemBuilder::with_id("pb-repeat-one", "One")
                .build(handle)?;

            let menu = MenuBuilder::new(handle)
                .items(&[
                    &SubmenuBuilder::new(handle, "Waves")
                        .about(None)
                        .separator()
                        .services()
                        .separator()
                        .hide()
                        .hide_others()
                        .show_all()
                        .separator()
                        .quit()
                        .build()?,
                    &SubmenuBuilder::new(handle, "File")
                        .item(&MenuItemBuilder::with_id("reimport", "Re-import Library")
                            .accelerator("CmdOrCtrl+Shift+I")
                            .build(handle)?)
                        .separator()
                        .item(&PredefinedMenuItem::close_window(handle, None)?)
                        .build()?,
                    &SubmenuBuilder::new(handle, "Edit")
                        .undo()
                        .redo()
                        .separator()
                        .cut()
                        .copy()
                        .paste()
                        .select_all()
                        .build()?,
                    &SubmenuBuilder::new(handle, "View")
                        .item(&SubmenuBuilder::new(handle, "Appearance")
                            .item(&theme_light)
                            .item(&theme_dark)
                            .item(&theme_system)
                            .build()?)
                        .separator()
                        .item(&show_status_bar)
                        .item(&show_album_accent)
                        .build()?,
                    &SubmenuBuilder::new(handle, "Controls")
                        .item(&MenuItemBuilder::with_id("pb-toggle", "Play/Pause")
                            .accelerator("Space")
                            .build(handle)?)
                        .item(&MenuItemBuilder::with_id("pb-goto", "Go to Current Song")
                            .accelerator("CmdOrCtrl+L")
                            .build(handle)?)
                        .item(&MenuItemBuilder::with_id("pb-stop", "Stop")
                            .accelerator("CmdOrCtrl+.")
                            .build(handle)?)
                        .separator()
                        .item(&MenuItemBuilder::with_id("pb-next", "Next")
                            .accelerator("CmdOrCtrl+Right")
                            .build(handle)?)
                        .item(&MenuItemBuilder::with_id("pb-prev", "Previous")
                            .accelerator("CmdOrCtrl+Left")
                            .build(handle)?)
                        .separator()
                        .item(&MenuItemBuilder::with_id("pb-vol-up", "Volume Up")
                            .accelerator("CmdOrCtrl+Up")
                            .build(handle)?)
                        .item(&MenuItemBuilder::with_id("pb-vol-down", "Volume Down")
                            .accelerator("CmdOrCtrl+Down")
                            .build(handle)?)
                        .separator()
                        .item(&pb_shuffle)
                        .item(&SubmenuBuilder::new(handle, "Repeat")
                            .item(&pb_repeat_off)
                            .item(&pb_repeat_all)
                            .item(&pb_repeat_one)
                            .build()?)
                        .build()?,
                    &SubmenuBuilder::new(handle, "Window")
                        .minimize()
                        .separator()
                        .close_window()
                        .build()?,
                ])
                .build()?;
            app.set_menu(menu)?;

            app.manage(ThemeMenuItems {
                light: theme_light,
                dark: theme_dark,
                system: theme_system,
            });

            app.manage(ViewMenuItems {
                show_status_bar,
                show_album_accent,
                status_bar_on: std::sync::atomic::AtomicBool::new(status_bar_default),
                album_accent_on: std::sync::atomic::AtomicBool::new(album_accent_default),
            });

            app.manage(PlaybackMenuItems {
                shuffle: pb_shuffle,
                repeat_off: pb_repeat_off,
                repeat_all: pb_repeat_all,
                repeat_one: pb_repeat_one,
            });

            // Set up system media key handling (play/pause, next, previous)
            let config = PlatformConfig {
                display_name: "Waves",
                dbus_name: "waves",
                hwnd: None,
            };
            match MediaControls::new(config) {
                Ok(mut controls) => {
                    let app_handle = app.handle().clone();
                    if let Err(e) = controls.attach(move |event| {
                        match event {
                            MediaControlEvent::Play => { let _ = app_handle.emit("media-play", ()); }
                            MediaControlEvent::Pause => { let _ = app_handle.emit("media-pause", ()); }
                            MediaControlEvent::Toggle => { let _ = app_handle.emit("media-toggle", ()); }
                            MediaControlEvent::Next => { let _ = app_handle.emit("media-next", ()); }
                            MediaControlEvent::Previous => { let _ = app_handle.emit("media-prev", ()); }
                            _ => {}
                        }
                    }) {
                        log::warn!("Failed to attach media controls: {:?}", e);
                    }
                    app.manage(MediaControlsState(Mutex::new(Some(controls))));
                }
                Err(e) => {
                    log::warn!("Failed to create media controls: {:?}", e);
                    app.manage(MediaControlsState(Mutex::new(None)));
                }
            }

            // Set up macOS dock right-click menu with playback controls
            #[cfg(target_os = "macos")]
            dock_menu::setup_dock_menu(app.handle());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "reimport" => {
                    let _ = app.emit("menu-reimport", ());
                }
                "pb-toggle" => { let _ = app.emit("media-toggle", ()); }
                "pb-goto" => { let _ = app.emit("media-goto-current", ()); }
                "pb-stop" => { let _ = app.emit("media-stop", ()); }
                "pb-next" => { let _ = app.emit("media-next", ()); }
                "pb-prev" => { let _ = app.emit("media-prev", ()); }
                "pb-vol-up" => { let _ = app.emit("media-vol-up", ()); }
                "pb-vol-down" => { let _ = app.emit("media-vol-down", ()); }
                "theme-light" | "theme-dark" | "theme-system" => {
                    let theme = id.strip_prefix("theme-").unwrap();
                    let items = app.state::<ThemeMenuItems>();
                    let _ = items.light.set_checked(id == "theme-light");
                    let _ = items.dark.set_checked(id == "theme-dark");
                    let _ = items.system.set_checked(id == "theme-system");
                    let _ = app.emit("theme-change", theme);
                }
                "show-status-bar" => {
                    let items = app.state::<ViewMenuItems>();
                    let was_checked = items.status_bar_on.load(std::sync::atomic::Ordering::Relaxed);
                    let now = !was_checked;
                    items.status_bar_on.store(now, std::sync::atomic::Ordering::Relaxed);
                    let _ = items.show_status_bar.set_checked(now);
                    let _ = app.emit("toggle-status-bar", now);
                }
                "show-album-accent" => {
                    let items = app.state::<ViewMenuItems>();
                    let was_checked = items.album_accent_on.load(std::sync::atomic::Ordering::Relaxed);
                    let now = !was_checked;
                    items.album_accent_on.store(now, std::sync::atomic::Ordering::Relaxed);
                    let _ = items.show_album_accent.set_checked(now);
                    let _ = app.emit("toggle-album-accent", now);
                }
                "pb-shuffle" => {
                    let items = app.state::<PlaybackMenuItems>();
                    let checked = items.shuffle.is_checked().unwrap_or(false);
                    let playback = app.state::<PlaybackState>();
                    let _ = playback.set_shuffle(checked);
                    let _ = app.emit("media-shuffle", checked);
                }
                "pb-repeat-off" | "pb-repeat-all" | "pb-repeat-one" => {
                    let mode = match id {
                        "pb-repeat-all" => RepeatMode::All,
                        "pb-repeat-one" => RepeatMode::One,
                        _ => RepeatMode::Off,
                    };
                    let playback = app.state::<PlaybackState>();
                    let _ = playback.set_repeat_mode(mode);
                    let items = app.state::<PlaybackMenuItems>();
                    let _ = items.repeat_off.set_checked(id == "pb-repeat-off");
                    let _ = items.repeat_all.set_checked(id == "pb-repeat-all");
                    let _ = items.repeat_one.set_checked(id == "pb-repeat-one");
                    let mode_str = match mode {
                        RepeatMode::Off => "off",
                        RepeatMode::All => "all",
                        RepeatMode::One => "one",
                    };
                    let _ = app.emit("media-repeat", mode_str);
                }
                _ => {}
            }
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
            commands::playback::update_now_playing,
            commands::playback::clear_now_playing,
            commands::browse::get_albums,
            commands::browse::get_artists,
            commands::browse::get_genres,
            commands::browse::get_album_tracks,
            commands::browse::get_artist_tracks,
            commands::browse::get_genre_tracks,
            commands::artwork::get_artwork_data_url,
            commands::artwork::get_track_all_artworks,
            commands::preferences::get_preference,
            commands::preferences::set_preference,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
