use std::sync::Mutex;
use souvlaki::MediaControls;

/// Wrapper so MediaControls can be stored in Tauri managed state.
/// MediaControls on macOS uses Objective-C objects that aren't Send,
/// but all access is serialized via Mutex.
pub struct MediaControlsState(pub Mutex<Option<MediaControls>>);
unsafe impl Send for MediaControlsState {}
unsafe impl Sync for MediaControlsState {}
