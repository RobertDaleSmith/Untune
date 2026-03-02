# Changelog

## Phase 1: Foundation, data import, and verification UI (`2318683`)
- JXA scripts bulk-extract all 32 metadata fields from Music app
- Filesystem scanner (walkdir + lofty + rayon) parses audio files
- Matcher merges JXA metadata with filesystem records
- SQLite with WAL mode, FTS5 full-text search, indexed columns
- Background artwork extraction with SHA256 dedup
- TanStack Table + Virtual for smooth 62k-row rendering
- Zustand store, debounced search, import progress overlay

## Phase 2: Playback, browse views, artwork fallbacks, and app rebrand (`3cf992e`)
- Audio playback engine (rodio) with queue, shuffle, and repeat modes
- PlaybackBar with draggable progress scrubbing, volume control, mute toggle
- Browse views: Albums, Artists, Genres grid views with detail pages
- Sidebar navigation with logo and playlist listing
- Artwork fallback pipeline: embedded metadata → Apple Music cache → folder artwork
- Per-view shuffle/repeat persistence across app restarts
- Right-click context menu, auto-scroll to now playing, keyboard navigation
- Renamed from Untune to Untune with new icons

## Playlist folder hierarchy (`4b4c512`)
- Extract folder structure from Music app via JXA
- Store parent_id relationships in database
- Render collapsible folder tree in sidebar with persistent state

## UI polish (`10016c7`)
- Inline progress banner during re-import instead of blocking overlay
- macOS dock right-click menu with Play/Pause, Next, Previous
- Keyboard shortcuts: Cmd+Up/Down for volume, Cmd+. for stop, Cmd+L to go to current song, arrows for prev/next
- Search bar: icon-only at narrow widths, contextual placeholder, search icon inside input
- Status bar: "songs" label, comma separators, total file size
- Album artwork in macOS Now Playing widget

## Performance fixes (`f3edb13`)
- Instant startup: UI shell renders immediately while tracks load in background
- Virtualized album grid: only ~30 visible tiles mount instead of 500+
- Artwork concurrency queue: max 6 simultaneous IPC calls to prevent backend flooding
