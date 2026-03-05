# Changelog

All notable development milestones, in reverse chronological order.

---

## tvOS Streaming App (`628acff`)
- Native tvOS 18+ app for streaming music from desktop over LAN
- Streaming-first architecture: audio plays via HTTP (no file downloads)
- Metadata-only sync: track/playlist data + artwork cached locally
- 10-foot UI with focus engine, grid layouts, Siri Remote navigation
- Actor-based ArtworkLoader with memory + disk cache and request coalescing
- Parallax layered app icon for tvOS home screen
- Bonjour discovery + 4-digit pairing (shared protocol with iOS)
- xcodegen project generation

## URL Download & Tag Search (`9b0ad79`)
- Download audio from URLs via yt-dlp with background queue
- Deep-link Share extension (`untune://add?url=...`)
- Embedded YouTube player synced to local audio position
- Tag search modal for browsing by AI-generated tags

## iOS Companion App (`e3cc392`, `2894d82`, `6c0bb85`)
- Native iOS 17+ companion app with SwiftUI and GRDB.swift
- Offline playback: sync selected playlists + audio files from desktop
- AVQueuePlayer with background audio and lock screen controls
- CarPlay support with tabbed browsing (playlists, artists, albums)
- Siri media intents ("Play [artist] in Untune")
- Bonjour desktop discovery + 4-digit pairing flow
- Playlist sync picker (choose which playlists to download)
- Artist/album navigation from Now Playing screen
- Accent color extraction from album artwork
- Frosted glass backgrounds, session persistence across launches
- xcodegen project generation

## Sync Infrastructure (`e3cc392`)
- axum HTTP server on port 8485 with token auth
- Bonjour/mDNS service advertisement (`_untune._tcp`)
- Device pairing with 4-digit codes + persistent tokens
- Per-device playlist selection and sync state tracking
- Audio file serving with HTTP Range request support
- Artwork serving by hash
- Play stat upload and merge
- Desktop UI: sync settings, paired device management

## CI/CD (`aba1671`)
- GitHub Actions CI workflow: TypeScript check, Rust check, full Tauri build
- GitHub Actions release workflow: signed build, Apple notarization, GitHub Release with DMG
- Makefile with `install`, `dev`, `build`, `check`, `clean` targets

## AI Tag Backup & Restore (`b5485d0`)
- Export all AI tags to JSON file
- Import AI tags from JSON, match by persistent_id
- Auto-backup before library reset, auto-restore on next import
- Single-track AI tagging from context menu

## AI Voice Assistant (`a690278`)
- Claude API chat with streaming responses
- 13 music-specific tools: search, play, queue, create playlists, get stats, control playback
- Native macOS speech recognition (SFSpeechRecognizer) for voice input
- Music ducking during assistant responses
- Conversational context within sessions
- Slide-out assistant panel with message history

## Smart Playlists, Mini Player & Column Browser (`daff489`)
- Smart playlists with rule-based editor (field/operator/value triplets)
- Mini player mode: always-on-top 350×48px window with crossfading artwork background
- iTunes-style column browser (genre → artist → album hierarchical filtering)
- Light/dark/system theme switching
- Session restore (last track + position on startup)

## Lyrics, Artwork Search & Drag-and-Drop (`20e2c38`)
- Synced lyrics display via LRCLIB API (LRC format with timestamps)
- MusicBrainz artwork search and replacement
- Drag-and-drop playlist reordering with mouse events
- View in Finder from context menu

## Dynamic Accents & Visualizer (`404ccb8`, `73493f6`)
- Dynamic accent colors extracted from album artwork
- Audio visualizer with 5 modes: bars, waveform, particles, geometry, digital
- Real-time FFT analysis (64 frequency bands + 128 waveform samples)
- Audio output device picker (AirPlay support)
- Smooth accent color transitions

## Crossfade & Playback Enhancements (`26c7f45`, `1299cee`, `24441d5`)
- Crossfade: configurable 0–12s overlap with equal-power fade curves
- Gapless playback via rodio sink pre-buffering
- Auto-start crossfade before track ends
- Only crossfade on automatic transitions, not manual skips
- Shared single audio output stream for reliable crossfading

## Queue, Sleep Timer & Smart Views (`def33bf`, `6b05c25`, `f6d35e8`)
- Play queue sidebar with history, now playing, and up next sections
- Sleep timer with gradual volume fade-out
- Built-in smart views: Recently Added, Recently Played, Top Played
- Keyboard shortcuts overlay (press `?`)
- Interactive star rating in track table
- Pre-generated shuffle queue for visibility in queue panel

## Play Stats & Settings (`bccb9c6`, `6496787`)
- Play/skip count tracking with last-played timestamps
- Settings panel with appearance, playback, and about sections (Cmd+,)
- M3U/M3U8 playlist export and import

## Drag-and-Drop & Playlist Management (`7d8a0f2`, `e73bd11`, `eafd7ae`)
- Drag tracks from table to sidebar playlists
- Playlist and folder renaming
- Double-click to play from playlist
- Smooth drag-and-drop playlist reordering

## Performance Fixes (`f3edb13`)
- Instant startup: UI shell renders immediately while tracks load in background
- Virtualized album grid: only ~30 visible tiles mount instead of 500+
- Artwork concurrency queue: max 6 simultaneous IPC calls to prevent backend flooding

## UI Polish (`10016c7`)
- Inline progress banner during re-import instead of blocking overlay
- macOS dock right-click menu with Play/Pause, Next, Previous
- Keyboard shortcuts: Cmd+Up/Down for volume, Cmd+. for stop, Cmd+L to go to current song, arrows for prev/next
- Search bar: icon-only at narrow widths, contextual placeholder, search icon inside input
- Status bar: "songs" label, comma separators, total file size
- Album artwork in macOS Now Playing widget

## Playlist Folder Hierarchy (`4b4c512`)
- Extract folder structure from Music app via JXA
- Store parent_id relationships in database
- Render collapsible folder tree in sidebar with persistent state

## Phase 2: Playback, Browse Views & Artwork (`3cf992e`)
- Audio playback engine (rodio) with queue, shuffle, and repeat modes
- PlaybackBar with draggable progress scrubbing, volume control, mute toggle
- Browse views: Albums, Artists, Genres grid views with detail pages
- Sidebar navigation with logo and playlist listing
- Artwork fallback pipeline: embedded metadata → Apple Music cache → folder artwork
- Per-view shuffle/repeat persistence across app restarts
- Right-click context menu, auto-scroll to now playing, keyboard navigation

## Phase 1: Foundation & Data Import (`2318683`)
- JXA scripts bulk-extract all metadata fields from Music app
- Filesystem scanner (walkdir + lofty + rayon) parses audio files in parallel
- Matcher merges JXA metadata with filesystem records
- SQLite with WAL mode, FTS5 full-text search, indexed columns
- Background artwork extraction with SHA256 dedup
- TanStack Table + Virtual for smooth 62k-row rendering
- Zustand store, debounced search, import progress overlay
