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

## License

MIT
