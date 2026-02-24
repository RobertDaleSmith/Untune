<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Waves icon">
</p>

<h1 align="center">Waves</h1>

<p align="center">
  A native macOS desktop music player built with Tauri, React, and Rust.<br>
  Imports your full Apple Music library into a fast local SQLite database.
</p>

## Tech Stack

- **Tauri v2** + **Rust** backend (rodio, rusqlite, lofty, walkdir, rayon)
- **React 19** + **TypeScript** + **Vite 6** frontend
- **TanStack Table + Virtual** for 62k-row virtualized rendering
- **Tailwind CSS v4**, **Zustand** state management
- **SQLite** with WAL mode, FTS5 full-text search

## Features

- Full Apple Music library import via JXA scripts (62k+ tracks, 32 metadata fields)
- Filesystem scanning with parallel audio file parsing
- Audio playback with queue, shuffle (with back-navigation history), and repeat modes
- Browse views: Albums (virtualized grid), Artists, Genres with detail pages
- Playlist folder hierarchy (iTunes-style collapsible tree)
- Artwork pipeline: embedded metadata, Apple Music cache, folder artwork
- macOS integration: Now Playing widget with artwork, dock menu, media keys
- Keyboard shortcuts for playback, volume, navigation
- Debounced search with FTS5, type-ahead scroll
- Per-view shuffle/repeat persistence across restarts

## Development

```bash
# Install dependencies
pnpm install

# Run in development
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Changelog

### Phase 1: Foundation, data import, and verification UI (`2318683`)
- JXA scripts bulk-extract all 32 metadata fields from Music app
- Filesystem scanner (walkdir + lofty + rayon) parses audio files
- Matcher merges JXA metadata with filesystem records
- SQLite with WAL mode, FTS5 full-text search, indexed columns
- Background artwork extraction with SHA256 dedup
- TanStack Table + Virtual for smooth 62k-row rendering
- Zustand store, debounced search, import progress overlay

### Phase 2: Playback, browse views, artwork fallbacks, and app rebrand (`3cf992e`)
- Audio playback engine (rodio) with queue, shuffle, and repeat modes
- PlaybackBar with draggable progress scrubbing, volume control, mute toggle
- Browse views: Albums, Artists, Genres grid views with detail pages
- Sidebar navigation with logo and playlist listing
- Artwork fallback pipeline: embedded metadata → Apple Music cache → folder artwork
- Per-view shuffle/repeat persistence across app restarts
- Right-click context menu, auto-scroll to now playing, keyboard navigation
- Renamed from Wavvy to Waves with new icons

### Playlist folder hierarchy (`4b4c512`)
- Extract folder structure from Music app via JXA
- Store parent_id relationships in database
- Render collapsible folder tree in sidebar with persistent state

### UI polish (`10016c7`)
- Inline progress banner during re-import instead of blocking overlay
- macOS dock right-click menu with Play/Pause, Next, Previous
- Keyboard shortcuts: Cmd+Up/Down for volume, Cmd+. for stop, Cmd+L to go to current song, arrows for prev/next
- Search bar: icon-only at narrow widths, contextual placeholder, search icon inside input
- Status bar: "songs" label, comma separators, total file size
- Album artwork in macOS Now Playing widget

### Performance fixes (`f3edb13`)
- Instant startup: UI shell renders immediately while tracks load in background
- Virtualized album grid: only ~30 visible tiles mount instead of 500+
- Artwork concurrency queue: max 6 simultaneous IPC calls to prevent backend flooding

## License

MIT
