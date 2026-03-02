mod analyzer;
mod assistant;
#[cfg(target_os = "macos")]
mod airplay;
mod audio;
mod commands;
mod db;
#[cfg(target_os = "macos")]
mod dock_menu;
mod import;
pub mod media;
mod models;
mod playback;
mod smart_playlists;
#[cfg(target_os = "macos")]
mod speech;

use assistant::state::AssistantState;
use commands::ai_tags::AiTaggingState;
use db::Database;
use media::MediaControlsState;
use playback::{PlaybackState, RepeatMode};
use souvlaki::{MediaControlEvent, MediaControls, PlatformConfig};
use std::sync::Mutex;
use tauri::{image::Image, Emitter, Listener, Manager};
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
#[tauri::command]
fn set_traffic_lights_visible(window: tauri::Window, visible: bool) {
    use cocoa::appkit::NSWindowButton;
    use objc::{msg_send, sel, sel_impl};

    let ns_window = window.ns_window().unwrap() as cocoa::base::id;
    unsafe {
        let buttons = [
            NSWindowButton::NSWindowCloseButton,
            NSWindowButton::NSWindowMiniaturizeButton,
            NSWindowButton::NSWindowZoomButton,
        ];
        for btn_type in &buttons {
            let btn: cocoa::base::id = msg_send![ns_window, standardWindowButton:*btn_type];
            if btn != cocoa::base::nil {
                let _: () = msg_send![btn, setHidden:!visible];
            }
        }
    }
}

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
    col_browser_visible: CheckMenuItem<tauri::Wry>,
    col_browser_genres: CheckMenuItem<tauri::Wry>,
    col_browser_artists: CheckMenuItem<tauri::Wry>,
    col_browser_albums: CheckMenuItem<tauri::Wry>,
    col_browser_album_artist: CheckMenuItem<tauri::Wry>,
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
        .plugin(tauri_plugin_dialog::init())
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
            let saved_col_browser = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "columnBrowserVisible").ok().flatten()
            };
            let saved_col_columns = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "columnBrowserColumns").ok().flatten()
            };
            let saved_col_album_artist = {
                let conn = db.conn.lock().unwrap();
                db::get_preference(&conn, "columnBrowserAlbumArtist").ok().flatten()
            };

            let assistant = AssistantState::new();
            {
                let conn = db.conn.lock().unwrap();
                assistant.init_from_db(&conn);
            }

            app.manage(db);
            app.manage(PlaybackState::new());
            app.manage(assistant);
            app.manage(AiTaggingState::new());

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

            // Column browser menu items
            let col_browser_default = saved_col_browser.as_deref() == Some("true");
            let col_cols: Vec<String> = saved_col_columns
                .as_deref()
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .unwrap_or_else(|| vec!["genres".into(), "artists".into(), "albums".into()]);
            let col_aa_default = saved_col_album_artist.as_deref() == Some("true");

            let col_browser_visible = CheckMenuItemBuilder::with_id("col-browser-visible", "Show Column Browser")
                .accelerator("CmdOrCtrl+B")
                .checked(col_browser_default)
                .build(handle)?;
            let col_browser_genres = CheckMenuItemBuilder::with_id("col-browser-genres", "Genres")
                .checked(col_cols.contains(&"genres".to_string()))
                .build(handle)?;
            let col_browser_artists = CheckMenuItemBuilder::with_id("col-browser-artists", "Artists")
                .checked(col_cols.contains(&"artists".to_string()))
                .build(handle)?;
            let col_browser_albums = CheckMenuItemBuilder::with_id("col-browser-albums", "Albums")
                .checked(col_cols.contains(&"albums".to_string()))
                .build(handle)?;
            let col_browser_album_artist = CheckMenuItemBuilder::with_id("col-browser-album-artist", "Use Album Artist")
                .checked(col_aa_default)
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
                    &SubmenuBuilder::new(handle, "Untune")
                        .about(None)
                        .separator()
                        .item(&MenuItemBuilder::with_id("settings", "Settings...")
                            .accelerator("CmdOrCtrl+,")
                            .build(handle)?)
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
                        .item(&SubmenuBuilder::new(handle, "New")
                            .item(&MenuItemBuilder::with_id("new-playlist", "Playlist")
                                .accelerator("CmdOrCtrl+N")
                                .build(handle)?)
                            .item(&MenuItemBuilder::with_id("new-playlist-from-selection", "Playlist from Selection")
                                .accelerator("CmdOrCtrl+Shift+N")
                                .build(handle)?)
                            .item(&MenuItemBuilder::with_id("new-smart-playlist", "Smart Playlist")
                                .accelerator("CmdOrCtrl+Alt+N")
                                .build(handle)?)
                            .item(&MenuItemBuilder::with_id("new-playlist-folder", "Playlist Folder")
                                .build(handle)?)
                            .build()?)
                        .separator()
                        .item(&MenuItemBuilder::with_id("reimport", "Re-import Library")
                            .accelerator("CmdOrCtrl+Shift+I")
                            .build(handle)?)
                        .separator()
                        .item(&SubmenuBuilder::new(handle, "Export / Import")
                            .item(&MenuItemBuilder::with_id("export-library", "Export Library...")
                                .build(handle)?)
                            .item(&MenuItemBuilder::with_id("import-library-file", "Import Library...")
                                .build(handle)?)
                            .separator()
                            .item(&MenuItemBuilder::with_id("export-ai-tags", "Export AI Tags...")
                                .build(handle)?)
                            .item(&MenuItemBuilder::with_id("import-ai-tags", "Import AI Tags...")
                                .build(handle)?)
                            .separator()
                            .item(&MenuItemBuilder::with_id("export-playlist-m3u", "Export Playlist as M3U...")
                                .build(handle)?)
                            .build()?)
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
                        .separator()
                        .item(&SubmenuBuilder::new(handle, "Column Browser")
                            .item(&col_browser_visible)
                            .separator()
                            .item(&col_browser_genres)
                            .item(&col_browser_artists)
                            .item(&col_browser_albums)
                            .separator()
                            .item(&col_browser_album_artist)
                            .build()?)
                        .separator()
                        .item(&MenuItemBuilder::with_id("toggle-mini-player", "Mini Player")
                            .accelerator("CmdOrCtrl+Shift+M")
                            .build(handle)?)
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
                            .accelerator("CmdOrCtrl+Shift+Up")
                            .build(handle)?)
                        .item(&MenuItemBuilder::with_id("pb-vol-down", "Volume Down")
                            .accelerator("CmdOrCtrl+Shift+Down")
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
                col_browser_visible,
                col_browser_genres,
                col_browser_artists,
                col_browser_albums,
                col_browser_album_artist,
            });

            app.manage(PlaybackMenuItems {
                shuffle: pb_shuffle,
                repeat_off: pb_repeat_off,
                repeat_all: pb_repeat_all,
                repeat_one: pb_repeat_one,
            });

            // Set up system media key handling (play/pause, next, previous)
            let config = PlatformConfig {
                display_name: "Untune",
                dbus_name: "untune",
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

            // Initialize native speech recognition
            #[cfg(target_os = "macos")]
            speech::init_speech(app.handle());

            // Start monitoring for audio output device changes (AirPlay, etc.)
            // Deferred to a background thread to avoid interfering with souvlaki/media
            // controls initialization that also happens during setup on the main thread.
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(2));

                    #[cfg(target_os = "macos")]
                    airplay::start_device_monitor(&app_handle);

                    let listener_handle = app_handle.clone();
                    app_handle.listen("audio-route-changed", move |_event| {
                        let playback = listener_handle.state::<PlaybackState>();
                        let db = listener_handle.state::<Database>();
                        match playback.reinit_stream() {
                            Ok(Some((track_id, position, was_playing))) if was_playing => {
                                let conn = db.conn.lock().ok();
                                let path = conn.and_then(|c| {
                                    db::get_track_file_info(&c, track_id).ok().flatten()
                                });
                                if let Some((file_path, duration)) = path {
                                    if playback.play(&file_path, track_id, duration).is_ok() {
                                        if position > 0.5 {
                                            let _ = playback.seek(position);
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    });
                });
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
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "reimport" => {
                    let _ = app.emit("menu-reimport", ());
                }
                "settings" => { let _ = app.emit("menu-settings", ()); }
                "new-playlist" => { let _ = app.emit("menu-new-playlist", ()); }
                "new-playlist-from-selection" => { let _ = app.emit("menu-new-playlist-from-selection", ()); }
                "new-smart-playlist" => { let _ = app.emit("menu-new-smart-playlist", ()); }
                "new-playlist-folder" => { let _ = app.emit("menu-new-playlist-folder", ()); }
                "export-library" => { let _ = app.emit("menu-export-library", ()); }
                "import-library-file" => { let _ = app.emit("menu-import-library-file", ()); }
                "export-ai-tags" => { let _ = app.emit("menu-export-ai-tags", ()); }
                "import-ai-tags" => { let _ = app.emit("menu-import-ai-tags", ()); }
                "export-playlist-m3u" => { let _ = app.emit("menu-export-playlist-m3u", ()); }
                "toggle-mini-player" => { let _ = app.emit("toggle-mini-player", ()); }
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
                "col-browser-visible" => {
                    let items = app.state::<ViewMenuItems>();
                    let checked = items.col_browser_visible.is_checked().unwrap_or(false);
                    let _ = app.emit("col-browser-toggle", checked);
                }
                "col-browser-genres" => {
                    let items = app.state::<ViewMenuItems>();
                    let checked = items.col_browser_genres.is_checked().unwrap_or(false);
                    let _ = app.emit("col-browser-column", serde_json::json!({"column": "genres", "enabled": checked}).to_string());
                }
                "col-browser-artists" => {
                    let items = app.state::<ViewMenuItems>();
                    let checked = items.col_browser_artists.is_checked().unwrap_or(false);
                    let _ = app.emit("col-browser-column", serde_json::json!({"column": "artists", "enabled": checked}).to_string());
                }
                "col-browser-albums" => {
                    let items = app.state::<ViewMenuItems>();
                    let checked = items.col_browser_albums.is_checked().unwrap_or(false);
                    let _ = app.emit("col-browser-column", serde_json::json!({"column": "albums", "enabled": checked}).to_string());
                }
                "col-browser-album-artist" => {
                    let items = app.state::<ViewMenuItems>();
                    let checked = items.col_browser_album_artist.is_checked().unwrap_or(false);
                    let _ = app.emit("col-browser-album-artist", checked);
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
            commands::import::reset_library,
            commands::tracks::export_library,
            commands::tracks::get_track_by_id,
            commands::tracks::get_tracks,
            commands::tracks::get_track_count,
            commands::tracks::search_tracks,
            commands::tracks::reveal_in_finder,
            commands::tracks::set_track_rating,
            commands::tracks::get_smart_view_tracks,
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
            commands::playback::get_upcoming_tracks,
            commands::playback::get_queue_snapshot,
            commands::playback::remove_from_queue,
            commands::playback::jump_to_queue_index,
            commands::playback::move_queue_item,
            commands::playback::set_volume,
            commands::playback::set_shuffle,
            commands::playback::set_repeat_mode,
            commands::playback::toggle_shuffle,
            commands::playback::cycle_repeat,
            commands::playback::get_view_settings,
            commands::playback::save_view_settings,
            commands::playback::update_now_playing,
            commands::playback::clear_now_playing,
            commands::playback::set_crossfade_duration,
            commands::playback::get_crossfade_duration,
            commands::playback::set_sleep_timer,
            commands::playback::cancel_sleep_timer,
            commands::playback::get_sleep_timer_remaining,
            commands::playback::pre_buffer_next,
            commands::playback::get_frequency_data,
            commands::browse::get_albums,
            commands::browse::get_artists,
            commands::browse::get_genres,
            commands::browse::get_album_tracks,
            commands::browse::get_artist_tracks,
            commands::browse::get_genre_tracks,
            commands::artwork::get_artwork_data_url,
            commands::artwork::get_track_all_artworks,
            commands::artwork::search_artwork,
            commands::artwork::apply_artwork_from_url,
            commands::preferences::get_preference,
            commands::preferences::set_preference,
            commands::lyrics::fetch_lyrics,
            commands::playlists::create_smart_playlist,
            commands::playlists::update_smart_playlist,
            commands::playlists::rename_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::create_playlist,
            commands::playlists::create_playlist_folder,
            commands::playlists::reorder_playlists,
            commands::playlists::add_tracks_to_playlist,
            commands::playlists::export_playlist_m3u,
            commands::playlists::import_playlist_m3u,
            commands::airplay::get_audio_route,
            commands::airplay::get_audio_devices,
            commands::airplay::set_audio_device,
            commands::assistant::assistant_available,
            commands::assistant::has_assistant_api_key,
            commands::assistant::set_assistant_api_key,
            commands::assistant::assistant_send_message,
            commands::assistant::assistant_clear_history,
            commands::speech::check_speech_permission,
            commands::speech::request_speech_permission,
            commands::speech::start_speech_recognition,
            commands::speech::stop_speech_recognition,
            commands::ai_tags::start_ai_tagging,
            commands::ai_tags::cancel_ai_tagging,
            commands::ai_tags::get_ai_tag_progress,
            commands::ai_tags::retag_tracks,
            commands::ai_tags::export_ai_tags,
            commands::ai_tags::import_ai_tags,
            commands::bios::get_bio,
            commands::playback::play_similar,
            commands::playback::toggle_radio_mode,
            commands::playback::start_radio,
            commands::playback::get_radio_state,
            commands::speech::speak_text,
            commands::speech::stop_speaking,
            commands::speech::is_speaking,
            set_traffic_lights_visible,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
