# Untune tvOS App — Streaming from Desktop Library

> Native tvOS app that streams music from your desktop Untune library over LAN. Discovers the desktop via Bonjour, pairs with a 4-digit code, syncs metadata, and streams audio on demand. Play stats sync back to the desktop.

*Last updated: 2026-03-05*

---

## Architecture

```
Desktop (Tauri app)                    tvOS (SwiftUI app)
┌─────────────────────┐                ┌─────────────────────┐
│ Existing Rust backend│                │ Local SQLite (GRDB)  │
│ + sync/ module       │                │   metadata cache     │
│                      │                │   artwork cache      │
│  mDNS advertise    ──┼───── Bonjour ─→│  NWBrowser discover  │
│                      │                │                      │
│  axum HTTP server   ←┼── HTTP/JSON ──→│  URLSession sync     │
│  (port 8485)         │                │                      │
│  /api/tracks/:id/   ←┼── HTTP GET ───→│  AVPlayer streams    │
│    file (Range)      │                │  audio over network  │
│                      │                │                      │
│  /api/artwork/:hash ←┼── HTTP GET ───→│  Async artwork load  │
│                      │                │                      │
│  Sync state tables   │                │  Apple TV remote     │
│  (paired devices,    │                │  + Siri voice input  │
│   track state)       │                │  + Now Playing       │
└─────────────────────┘                └─────────────────────┘
```

**Key design decisions:**
- **Streaming-first** — tvOS has limited storage (~500MB-1GB usable); audio streams directly from the desktop server via HTTP, no file downloads
- **Metadata sync** — playlists and track metadata are synced to a local GRDB database for fast browsing; only audio is streamed
- **Artwork caching** — artwork images cached locally to `Caches/` for responsive UI; evicted by tvOS when storage pressure is high
- **Same sync server** — reuses the existing axum HTTP server on port 8485, same auth tokens, same API endpoints
- **AVPlayer with HTTP URLs** — AVPlayer handles HTTP streaming natively, including buffering and network interruption recovery
- **Focus engine UI** — all views designed for Siri Remote navigation (d-pad, swipe, click), no touch targets

### Differences from iOS App

| Aspect | iOS | tvOS |
|--------|-----|------|
| Audio | Download files, play locally | Stream from desktop over HTTP |
| Storage | Downloads to Documents/Music/ | Metadata + artwork cache only |
| Input | Touch, gestures | Siri Remote (focus engine) |
| Screen | 4-7" portrait/landscape | 40-75" landscape only |
| Background | BGProcessingTask for sync | No background tasks; audio continues automatically |
| Offline | Full offline playback | Requires network connection to desktop |
| CarPlay | CarPlaySceneDelegate | N/A |
| Layout | List-based, mini player bar | Grid-based, full-screen now playing |

---

## Phase 1: tvOS App Skeleton — IN PROGRESS

Build the tvOS app with mock data, streaming-capable playback engine, and full 10-foot UI. Pairs and streams from the desktop sync server.

### What to build

**Project:** `untune-tvos/` at repo root
- **Target:** tvOS 18+ (enables `@Observable` macro)
- **Dependency:** GRDB.swift 7.x via SPM
- **Build:** xcodegen (`project.yml`) → `Untune.xcodeproj`
- **Bundle ID:** `com.untune.tvos`

**File structure:**

```
untune-tvos/
  project.yml                          — xcodegen spec
  Untune.xcodeproj/                    — generated
  Untune/
    Info.plist
    Untune.entitlements
    App/
      UntuneApp.swift                  — @main, audio session, environment setup
      ContentView.swift                — TabView (Library, Now Playing, Settings)
    Models/
      Track.swift                      — mirrors iOS Track (no localFilePath/fileDownloaded)
      Playlist.swift                   — identical to iOS
    Database/
      Schema.swift                     — 5 tables (tracks, playlists, playlistTracks, pendingPlayStats, preferences)
      DatabaseManager.swift            — GRDB DatabasePool, CRUD, play/skip recording
      TrackRecord.swift                — GRDB FetchableRecord + PersistableRecord
      PlaylistRecord.swift             — GRDB record
      PlaylistTrackRecord.swift        — junction table + PendingPlayStatRecord
    Playback/
      AudioPlayer.swift                — @Observable, streams via AVPlayer from HTTP URLs
      NowPlayingManager.swift          — MPNowPlayingInfoCenter + MPRemoteCommandCenter (Siri Remote)
    Networking/
      DesktopDiscovery.swift           — NWBrowser for _untune._tcp (identical to iOS)
      PairingManager.swift             — pairing flow + Keychain (tvOS keys: com.untune.tvos.*)
      SyncClient.swift                 — URLSession sync client (identical to iOS)
      ArtworkLoader.swift              — Async image loader from desktop /api/artwork/:hash
    Sync/
      SyncEngine.swift                 — metadata-only sync (no file downloads)
    Views/
      Library/
        LibraryView.swift              — top-level library browser (Albums, Artists, Playlists, Songs)
        AlbumsGridView.swift           — album artwork grid with focus states
        AlbumDetailView.swift          — album tracks list with play/shuffle
        ArtistsGridView.swift          — artist grid
        ArtistDetailView.swift         — artist albums + tracks
        PlaylistsView.swift            — playlist list
        PlaylistDetailView.swift       — playlist tracks
        SongsListView.swift            — all songs list (scrollable, focusable)
        TrackRow.swift                 — track row for lists (artwork + title + artist + duration)
      Playback/
        NowPlayingView.swift           — full-screen: large artwork, transport, scrubber, up next
      Settings/
        SettingsView.swift             — pairing status, sync, about
        PairingView.swift              — Bonjour discovery + code entry (remote-friendly)
      Common/
        ArtworkView.swift              — async artwork loading from cache or network
        FocusableButton.swift          — styled button with focus states for tvOS
    Utilities/
      TimeFormatting.swift             — duration formatting (identical to iOS)
      MockData.swift                   — sample tracks/playlists for development
      ArtworkCache.swift               — disk + memory cache for artwork images
    Resources/
      Assets.xcassets/                 — App icon (layered for tvOS parallax)
```

### Streaming playback engine

The tvOS AudioPlayer differs from iOS in how it loads audio:

```swift
// iOS: loads from local file
let url = URL(fileURLWithPath: track.localFilePath!)
let item = AVPlayerItem(url: url)

// tvOS: streams from desktop server
let streamURL = URL(string: "\(baseURL)/api/tracks/\(track.id)/file")!
var headers = ["Authorization": "Bearer \(token)"]
let asset = AVURLAsset(url: streamURL, options: ["AVURLAssetHTTPHeaderFieldsKey": headers])
let item = AVPlayerItem(asset: asset)
```

AVPlayer handles buffering, network interruption recovery, and Range requests automatically.

### tvOS UI patterns

- **10-foot UI** — minimum 30pt body text, 42pt+ headers, generous spacing
- **Focus engine** — all interactive elements get focus states with scale + shadow
- **Grid browsing** — albums/artists shown as artwork grids (LazyVGrid), not lists
- **Full-screen now playing** — large artwork with blurred background, transport below
- **Tab navigation** — top-level TabView with Library, Now Playing, Settings
- **No mini player** — tvOS is always full-screen; now playing is a dedicated tab
- **Remote gestures** — play/pause button, swipe for seek, menu button for back

### Pairing flow (tvOS-specific UX)

1. Open Settings tab → "Connect to Desktop"
2. tvOS discovers desktops via Bonjour, lists them
3. Select a desktop → tvOS shows text field for 4-digit code
4. User reads code from desktop app, enters via Siri Remote on-screen keyboard
5. Pairing token saved to tvOS Keychain
6. Automatic metadata sync begins

### Verification checklist
- [ ] Xcode project builds for tvOS simulator
- [ ] Zero warnings in app code
- [ ] GRDB database creates with correct schema
- [ ] Mock data loads into library views
- [ ] Tab navigation works with Siri Remote
- [ ] Focus engine works correctly on all interactive elements
- [ ] Artwork grid displays with parallax-like focus effects
- [ ] Now Playing view displays with transport controls

---

## Phase 2: Desktop Streaming + Pairing — NOT STARTED

Connect to the desktop sync server, pair, sync metadata, and stream audio.

### Desktop-side changes

None required — the existing sync server in `src-tauri/src/sync/` already supports everything tvOS needs:
- `/api/pair` — pairing with code exchange
- `/api/sync/manifest` — full metadata manifest
- `/api/tracks/:id/file` — audio file streaming with Range headers
- `/api/artwork/:hash` — artwork files
- `/api/sync/play-stats` — play stat upload
- Bonjour advertisement via `_untune._tcp`

The only change: tvOS devices will appear in the `sync_devices` table alongside iOS devices. The server doesn't distinguish between client types.

### tvOS-side additions

#### Streaming AudioPlayer
- Replace mock/local playback with HTTP streaming
- `AVURLAsset` with Bearer token auth header
- Buffer status monitoring (show loading indicator when buffering)
- Network error handling with retry logic
- Prefetch next track in queue for gapless-ish transitions

#### Metadata-only SyncEngine
- Fetch manifest on pair/reconnect
- Sync track metadata + playlist structure to local GRDB
- Download artwork to Caches/ directory
- Do NOT download audio files (stream on demand)
- Upload pending play stats

#### Artwork loading pipeline
```
ArtworkView requested
  → Check memory cache (NSCache)
    → Check disk cache (Caches/Artwork/{hash}.jpg)
      → Fetch from desktop: GET /api/artwork/{hash}
        → Save to disk cache + memory cache
          → Display
```

### Verification checklist
- [ ] Bonjour discovers desktop on same LAN
- [ ] Pair with desktop via 4-digit code
- [ ] Metadata syncs (playlists + tracks appear in library)
- [ ] Artwork loads from desktop and caches locally
- [ ] Audio streams from desktop (tap track → plays)
- [ ] Transport controls work (play/pause/next/prev/seek)
- [ ] Play stats upload to desktop
- [ ] Handles desktop being offline gracefully (error state, retry)
- [ ] Handles mid-playback network interruption (buffering indicator, auto-retry)

---

## Phase 3: Polish + Advanced Features — NOT STARTED

- **Search** — full-text search across synced track metadata (local FTS or in-memory filter)
- **Up Next queue** — view and manage the play queue from Now Playing
- **Siri voice commands** — "Play [artist/album/playlist]" via SiriKit
- **Top Shelf extension** — show recently played or suggested albums on Apple TV home screen
- **Screensaver integration** — display now playing info during Apple TV screensaver
- **Auto-reconnect** — detect when desktop comes online, auto-sync metadata updates
- **Play history** — recently played section in library
- **Genre browsing** — browse by genre with grid UI
- **Queue from browse** — "Play Next" / "Play Later" context actions on tracks

---

## Phase 4: Multi-Device + UX Enhancements — NOT STARTED

- **Handoff** — start playing on desktop, continue on Apple TV (and vice versa)
- **Multiple desktops** — support pairing with more than one desktop
- **Crossfade** — AVAudioEngine for mixing between tracks during transitions
- **Visualizer** — audio visualization on the big screen during playback
- **AI tag browsing** — browse by mood, energy, vibe tags from AI tagger
- **Sleep timer** — with fade-out
- **Appearance themes** — dark/light/system with accent color from artwork

---

## Code Reuse from iOS

### Identical (copy as-is)
- `Playlist.swift` — model struct
- `PlaylistRecord.swift` — GRDB record
- `PlaylistTrackRecord.swift` — GRDB junction + PendingPlayStatRecord
- `Schema.swift` — database migration (same 5 tables)
- `TimeFormatting.swift` — duration formatting
- `SyncClient.swift` — HTTP sync client
- `DesktopDiscovery.swift` — Bonjour NWBrowser

### Adapted (minor changes)
- `Track.swift` — remove `localFilePath`/`fileDownloaded` fields (not needed for streaming)
- `TrackRecord.swift` — match Track changes
- `DatabaseManager.swift` — remove file path methods, add streaming-specific queries
- `PairingManager.swift` — change keychain keys from `com.untune.ios.*` to `com.untune.tvos.*`, use `ProcessInfo.processInfo.hostName` instead of `UIDevice.current.name`
- `AudioPlayer.swift` — streaming from HTTP URLs instead of local files
- `NowPlayingManager.swift` — identical API but different remote command behavior on tvOS
- `SyncEngine.swift` — metadata-only sync (skip file download phases)

### New for tvOS
- All Views (10-foot UI, focus engine)
- `ArtworkLoader.swift` — async network image loading
- `ArtworkCache.swift` — disk + memory cache
- `UntuneApp.swift` — tvOS entry point (no CarPlay, no Siri intents initially)
- App icon assets (layered for tvOS parallax effect)
