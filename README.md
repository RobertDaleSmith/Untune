<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Untune icon">
</p>

<h1 align="center">Untune</h1>

<p align="center">
  A native music player for macOS, iOS, and Apple TV.<br>
  Imports your Apple Music library into a fast local SQLite database,<br>
  with AI-powered tagging, a voice assistant, and cross-device streaming.
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/screenshot_light.png">
    <img src="assets/screenshot_light.png" alt="Untune screenshot" width="800">
  </picture>
</p>

## Overview

Untune is a three-platform music player built around your local Apple Music library:

- **macOS Desktop** — Full-featured player with 62k+ track support, AI tagging, visualizer, smart playlists, and a Claude-powered voice assistant
- **iOS Companion** — Offline playback with synced playlists, CarPlay, and Siri integration
- **tvOS Streaming** — Stream your library to Apple TV over your local network

All three apps share a common sync protocol: the desktop runs an HTTP server that mobile and TV clients discover via Bonjour and connect to with a 4-digit pairing code.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop backend | **Tauri v2** + **Rust** (rodio, rusqlite, lofty, axum, symphonia) |
| Desktop frontend | **React 19** + **TypeScript** + **Vite 6** + **Tailwind CSS v4** |
| Table rendering | **TanStack Table + Virtual** (62k rows, virtualized) |
| State management | **Zustand** (7 stores) |
| Database | **SQLite** with WAL mode + FTS5 full-text search |
| iOS / tvOS | **SwiftUI** + **GRDB.swift 7** + **AVQueuePlayer** |
| AI | **Claude API** (Haiku for tagging, assistant for chat) |
| Sync | **axum** HTTP server + **Bonjour/mDNS** discovery |

## Features

### Library Management
- Full Apple Music import via JXA scripts (62k+ tracks, 47 metadata fields)
- Filesystem scanning with parallel audio file parsing (lofty + rayon)
- FTS5 full-text search across all metadata
- iTunes-style column browser (genre / artist / album filtering)
- Smart playlists with rule-based editors (field/operator/value)
- Playlist folder hierarchy with drag-and-drop
- Star ratings, play counts, last played tracking
- MusicBrainz artwork search and replacement
- M3U/M3U8 playlist import and export

### Playback
- Gapless playback with pre-buffering
- Crossfade (0–12s configurable overlap with fade curves)
- Shuffle with back-navigation history
- Repeat modes: off, all, one
- Sleep timer with gradual fade-out
- Radio mode (auto-queue similar tracks)
- AirPlay device switching
- Real-time FFT visualizer (5 modes: bars, waveform, particles, geometry, digital)
- Mini player mode (always-on-top, 350×48px)

### AI Features
- **AI Tagging** — Batch-tag tracks with mood, energy, BPM, danceability, acousticness, and vibe tags via Claude Haiku
- **Voice Assistant** — Claude-powered chat with 13 music tools (search, play, queue, create playlists, get stats)
- **Speech Input** — Native macOS speech recognition for voice commands
- **Artist Bios** — AI-generated biographies in artist detail views
- **Smart Radio** — Auto-queue tracks similar to what's playing

### macOS Integration
- Now Playing widget with artwork
- Media key support (play/pause, next, previous)
- Dock menu (play/pause, next, previous)
- Keyboard shortcuts (volume, seek, navigation, search)
- Background artwork as app backdrop
- Synced lyrics display (LRCLIB integration)
- Deep link support (`untune://add?url=...`)

### Sync & Streaming
- Built-in HTTP sync server (port 8485)
- Bonjour/mDNS service discovery on LAN
- 4-digit pairing code authentication
- Per-device playlist selection
- Metadata, artwork, and audio file transfer
- Bidirectional play stat syncing

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   macOS Desktop                      │
│  ┌──────────────┐    IPC     ┌───────────────────┐  │
│  │ React 19 +   │◄─────────►│ Rust Backend      │  │
│  │ TanStack     │  invoke() │ ├─ playback.rs     │  │
│  │ Virtual      │  events   │ ├─ db/             │  │
│  │ Zustand      │           │ ├─ import/         │  │
│  └──────────────┘           │ ├─ assistant/      │  │
│                             │ ├─ sync/ ──────┐   │  │
│                             │ └─ commands/   │   │  │
│                             └────────────────┼───┘  │
└──────────────────────────────────────────────┼──────┘
                                               │ HTTP :8485
                              ┌────────────────┼────────────────┐
                              │                │                │
                    ┌─────────▼──────┐  ┌──────▼─────────┐     │
                    │   iOS App      │  │  tvOS App       │     │
                    │ Download+Play  │  │  Stream Only    │     │
                    │ Offline Cache  │  │  Metadata Cache │     │
                    │ CarPlay, Siri  │  │  10-foot UI     │     │
                    └────────────────┘  └─────────────────┘     │
                                                                │
                                        Bonjour (_untune._tcp) ─┘
```

### Desktop Backend (Rust)

| Directory | Purpose |
|-----------|---------|
| `src-tauri/src/lib.rs` | Tauri setup, native menu, menu event dispatch |
| `src-tauri/src/commands/` | 16 IPC command modules (import, tracks, playback, playlists, artwork, ai_tags, assistant, sync, lyrics, speech, airplay, preferences, browse, bios, url_download) |
| `src-tauri/src/db/` | SQLite: schema + migrations, queries, inserts |
| `src-tauri/src/import/` | Multi-phase import pipeline (JXA → scan → match → merge → artwork → AI tags) |
| `src-tauri/src/playback.rs` | Audio engine: rodio + symphonia, crossfade, FFT, sleep timer |
| `src-tauri/src/assistant/` | Claude API client with streaming + 13 music tools |
| `src-tauri/src/sync/` | axum HTTP server, Bonjour advertisement, pairing, file serving |
| `src-tauri/src/models/` | Track (47 fields), Playlist, MergedTrack, JxaTrack |

### Desktop Frontend (React + TypeScript)

| Directory | Purpose |
|-----------|---------|
| `src/components/` | 31 React components (TrackTable, PlaybackBar, Sidebar, Visualizer, AssistantPanel, etc.) |
| `src/stores/` | 7 Zustand stores (library, playback, navigation, theme, columnBrowser, activity, assistant) |
| `src/lib/commands.ts` | Typed wrappers for all `invoke()` calls |
| `src/lib/types.ts` | TypeScript interfaces matching Rust models |

### Database

SQLite with WAL mode at `~/Library/Application Support/com.untune.app/library.db`.

- **tracks** — ~50 columns including AI tag fields (mood, energy, vibe_tags, bpm, danceability, acousticness)
- **tracks_fts** — FTS5 virtual table for full-text search
- **playlists** — Hierarchical with parent_id for folder trees
- **playlist_tracks** — Junction table with sort order
- **preferences** — Key-value store for app settings
- **smart_playlists** — Rule-based playlist definitions (JSON rules)
- **sync_devices** — Paired mobile devices with tokens
- **sync_playlist_selections** — Per-device playlist sync choices
- **sync_track_state** — Per-device per-track sync progress

## iOS Companion App

Native SwiftUI app (`untune-ios/`) for iOS 17+ with offline playback.

**Bundle ID:** `com.untune.ios`
**Build:** xcodegen (`project.yml`) → Xcode project
**Database:** GRDB.swift 7 (mirrors desktop schema)

### Features
- Syncs selected playlists + tracks from desktop over LAN
- Offline playback via AVQueuePlayer
- Background audio with lock screen controls
- CarPlay support (tabbed browsing)
- Siri media intents ("Play [artist] in Untune")
- Bonjour discovery + 4-digit pairing
- Play stat upload back to desktop

### Structure
```
untune-ios/Untune/
├── App/            # UntuneApp, ContentView, SplashView
├── Models/         # Track (39 fields), Playlist
├── Database/       # GRDB schema, manager, records
├── Playback/       # AVQueuePlayer, NowPlayingManager
├── Networking/     # DesktopDiscovery, PairingManager, SyncClient
├── Sync/           # SyncEngine (state machine)
├── Siri/           # PlayMediaIntentHandler
├── CarPlay/        # CarPlaySceneDelegate, CarPlayBrowser
├── Views/          # Library, Playback, Settings, Common
└── Utilities/      # TimeFormatting, MockData, AccentColor
```

## tvOS Streaming App

Native SwiftUI app (`untune-tvos/`) for tvOS 18+ with streaming playback.

**Bundle ID:** `com.untune.tvos`
**Build:** xcodegen (`project.yml`) → Xcode project
**Database:** GRDB.swift 7 (metadata cache only)

### Key Differences from iOS
- **Streaming-first** — Audio streams via HTTP from desktop (no file downloads)
- **Metadata cache** — Only syncs track/playlist metadata and artwork thumbnails
- **10-foot UI** — Grid layouts, large text, focus engine for Siri Remote
- **Minimal storage** — Artwork in Caches directory, no audio files stored

### Structure
```
untune-tvos/Untune/
├── App/            # UntuneApp, ContentView
├── Models/         # Track (fileExtension instead of localFilePath)
├── Database/       # GRDB (cachesDirectory for tvOS sandbox)
├── Playback/       # AVURLAsset + HTTP auth headers for streaming
├── Networking/     # Discovery, Pairing, SyncClient, ArtworkLoader (actor)
├── Sync/           # SyncEngine (metadata-only, no file downloads)
├── Views/          # Library grids, NowPlaying, Pairing
└── Utilities/      # TimeFormatting, MockData, ArtworkCache
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://rustup.rs/) 1.77+
- macOS (required for Tauri, Apple Music integration, and building iOS/tvOS)
- [xcodegen](https://github.com/yonaskolb/XcodeGen) (for iOS/tvOS project generation)
- Xcode 16+ (for iOS/tvOS builds)

## Development

### Desktop (macOS)

```bash
make install   # Install frontend dependencies
make dev       # Run app in development (Tauri + Vite HMR)
make build     # Build production app bundle
make check     # Type-check frontend (tsc) and backend (cargo check)
make clean     # Remove build artifacts
```

Or without Make:

```bash
pnpm install
pnpm tauri dev
```

### Optional: PSF / PSF2 playback (custom builds only)

PlayStation Sound Format playback uses the [Highly Experimental](https://github.com/kode54/Highly_Experimental)
emulator core, which has no upstream license. **Official releases ship
without it** — Untune is MIT-licensed and can't redistribute unlicensed code.
You can opt in for a personal local build at your own discretion:

```bash
git submodule update --init src-tauri/vendor
pnpm tauri build --features psf       # or: cargo check --features psf
```

PS2 PSF additionally needs a Sony PS2 BIOS image at
`src-tauri/vendor/Highly_Experimental/Core/hebios.bin` (generated by `mkhebios`
from your own PS2 BIOS dump). Sony BIOS files cannot be distributed.

### iOS

```bash
cd untune-ios
xcodegen generate
open Untune.xcodeproj
# Build and run from Xcode (iOS 17+ device or simulator)
```

### tvOS

```bash
cd untune-tvos
xcodegen generate
open Untune.xcodeproj
# Build and run from Xcode (tvOS 18+ device or simulator)
```

### Sync Setup

1. Start the sync server from the desktop app (Settings → Sync → Start Server)
2. On iOS/tvOS, go to Settings → Pair with Desktop
3. Select your desktop from the Bonjour discovery list
4. Enter the 4-digit pairing code shown on the desktop
5. Select playlists to sync (iOS) or start streaming (tvOS)

## CI/CD

GitHub Actions workflow in `.github/workflows/`:

- **build.yml** — One workflow handles everything:
  - **Push to main / PRs**: type-check, `cargo check`, full Tauri build for `aarch64-apple-darwin` + `x86_64-apple-darwin`, uploads DMG artifacts
  - **Manual dispatch** (Actions → Build & Release → Run workflow) with `bump_version = patch/minor/major`: bumps version across `package.json`, `Cargo.toml`, `tauri.conf.json`, publishes a tagged GitHub Release with both architectures and a `checksums.txt`
  - Signs with the Developer ID cert when `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` secrets are present; otherwise produces an unsigned DMG that still works via right-click → Open

## Project Documentation

| Document | Description |
|----------|-------------|
| [docs/ROADMAP.md](docs/ROADMAP.md) | Feature roadmap with completion status |
| [docs/IOS-SYNC-PLAN.md](docs/IOS-SYNC-PLAN.md) | iOS companion app design and sync protocol |
| [docs/TVOS-PLAN.md](docs/TVOS-PLAN.md) | tvOS streaming app design |
| [docs/SERVER-ARCHITECTURE.md](docs/SERVER-ARCHITECTURE.md) | Long-term vision for self-hosted server mode |
| [docs/ITUNES_DATA.md](docs/ITUNES_DATA.md) | Apple Music/iTunes metadata schema reference |
| [CHANGELOG.md](CHANGELOG.md) | Development history by phase |

## License

MIT
