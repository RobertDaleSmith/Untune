# Untune iOS Companion App + Sync Infrastructure

> Native iOS app that syncs selected playlists and audio files from the desktop over LAN. Once synced, everything plays offline. Play stats sync back on the next connection.

*Last updated: 2026-03-02*

---

## Architecture

```
Desktop (Tauri app)                    iOS (SwiftUI app)
┌─────────────────────┐                ┌─────────────────────┐
│ Existing Rust backend│                │ Local SQLite (GRDB)  │
│ + new sync/ module   │                │ Local audio files    │
│                      │                │ Local artwork cache  │
│  mDNS advertise    ──┼───── Bonjour ─→│  NWBrowser discover  │
│                      │                │                      │
│  axum HTTP server   ←┼── HTTP/JSON ──→│  URLSession sync     │
│  (port 8485)         │                │  client              │
│                      │                │                      │
│  Sync state tables   │                │  AVQueuePlayer       │
│  (paired devices,    │                │  + lock screen       │
│   track state)       │                │  + background audio  │
└─────────────────────┘                └─────────────────────┘
```

**Key design decisions:**
- **HTTP (axum) for sync** — range requests for resumable large file transfers, simple JSON API, debuggable
- **Timestamps + delta sync** — `updated_at` columns on tracks/playlists, iOS sends "what changed since X?"
- **Additive play stat merge** — iOS sends deltas (`+3 plays`) not absolutes, avoiding conflicts
- **GRDB.swift for iOS DB** — gold-standard Swift SQLite wrapper, mirrors desktop schema subset
- **AVQueuePlayer for playback** — native iOS audio with background playback, lock screen controls

---

## Phase 1: iOS App Skeleton — COMPLETE

Built the iOS app with mock data, playback engine, and full UI. No sync yet — database seeded with sample tracks for testing.

### What was built

**Project:** `untune-ios/` at repo root
- **Target:** iOS 17+ (enables `@Observable` macro, modern SwiftUI)
- **Dependency:** GRDB.swift 7.x via SPM
- **Build:** xcodegen (`project.yml`) → `Untune.xcodeproj`
- **Bundle ID:** `com.untune.ios`

**Files (25 Swift files):**

```
untune-ios/
  project.yml                          — xcodegen spec
  Untune.xcodeproj/                    — generated
  Untune/
    Info.plist
    App/
      UntuneApp.swift                  — @main, audio session setup
      ContentView.swift                — TabView + MiniPlayerBar overlay
    Models/
      Track.swift                      — 39 fields, mirrors desktop Track
      Playlist.swift                   — mirrors desktop Playlist
    Database/
      Schema.swift                     — 5 tables: tracks, playlists, playlistTracks, pendingPlayStats, preferences
      DatabaseManager.swift            — GRDB DatabasePool, CRUD, play/skip recording, mock seeding
      TrackRecord.swift                — GRDB FetchableRecord + PersistableRecord
      PlaylistRecord.swift             — GRDB record
      PlaylistTrackRecord.swift        — junction table + PendingPlayStatRecord
    Playback/
      AudioPlayer.swift                — @Observable AVQueuePlayer wrapper, shuffle/repeat, play threshold
      NowPlayingManager.swift          — MPNowPlayingInfoCenter + MPRemoteCommandCenter
    Views/
      Library/
        LibraryView.swift              — segmented picker: Playlists / Songs / Albums / Artists
        PlaylistDetailView.swift       — track list with play/shuffle buttons
        TrackRow.swift                 — artwork + title + artist + duration
        AlbumsView.swift               — album list + detail
        ArtistsView.swift              — artist list + detail
      Playback/
        NowPlayingView.swift           — full-screen artwork, scrubber, transport, queue sheet
        MiniPlayerBar.swift            — persistent bottom bar with progress
        QueueView.swift                — up next list, drag to reorder
      Settings/
        SettingsView.swift             — storage info, sync placeholder
      Common/
        ArtworkView.swift              — loads artwork by hash from local file
        MarqueeText.swift              — scrolling text for long titles
    Utilities/
      TimeFormatting.swift             — duration formatting
      MockData.swift                   — 20 tracks, 3 playlists
    Resources/
      Assets.xcassets/                 — App icon (from desktop icon, margins trimmed)
      SampleAudio/                     — placeholder for test audio clips
```

**Playback engine features:**
- AVQueuePlayer with background audio session (`.playback` category)
- Shuffle with history (go-back works), 3 repeat modes (off/all/one)
- Play threshold: record play at min(50% duration, 240s) — matches desktop logic
- Accumulates play/skip deltas in `pendingPlayStats` for future sync
- Lock screen: play/pause/next/prev/seek via MPRemoteCommandCenter

**UI:**
- 3-tab layout: Library, Now Playing, Settings
- Library tab has segmented picker switching between Playlists, Songs, Albums, Artists
- Mini player bar persistent above tab bar when a track is active
- Full Now Playing view with scrubber, transport controls, queue sheet

### Verification checklist
- [x] Xcode project builds for simulator (iOS 18.5, iPhone 16)
- [x] Zero warnings in app code
- [x] GRDB database creates with correct schema
- [x] Mock data loads into playlist/track views
- [x] App icon displays correctly (trimmed margins)
- [ ] Audio playback with bundled sample files (needs test clips)
- [ ] Lock screen controls work on device
- [ ] Background audio continues when backgrounded

---

## Phase 2: Desktop Sync Server + Pairing — NOT STARTED

Build the Rust sync module in the desktop app and connect it to the iOS app.

### Desktop-side changes

#### New module: `src-tauri/src/sync/`

```
src-tauri/src/sync/
  mod.rs          — SyncServer state struct, start/stop
  server.rs       — axum router, auth middleware
  discovery.rs    — Bonjour/mDNS via libmdns
  pairing.rs      — pairing endpoint, token generation
  endpoints.rs    — HTTP handlers (metadata, files, artwork, stats)
  models.rs       — SyncManifest, SyncDelta, PlayStatsDelta types
```

#### New command module: `src-tauri/src/commands/sync.rs`

Commands: `start_sync_server`, `stop_sync_server`, `get_paired_devices`, `unpair_device`, `get_sync_status`, `set_sync_playlists`

#### Database migrations (`schema.rs`)

```sql
CREATE TABLE sync_devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pairing_token TEXT NOT NULL,
    paired_at TEXT NOT NULL,
    last_sync_at TEXT
);

CREATE TABLE sync_playlist_selections (
    device_id TEXT NOT NULL REFERENCES sync_devices(id),
    playlist_id INTEGER NOT NULL REFERENCES playlists(id),
    PRIMARY KEY (device_id, playlist_id)
);

CREATE TABLE sync_track_state (
    device_id TEXT NOT NULL REFERENCES sync_devices(id),
    track_id INTEGER NOT NULL REFERENCES tracks(id),
    metadata_synced_at TEXT,
    file_synced_at TEXT,
    artwork_synced_at TEXT,
    PRIMARY KEY (device_id, track_id)
);

ALTER TABLE tracks ADD COLUMN updated_at TEXT;
ALTER TABLE playlists ADD COLUMN updated_at TEXT;
```

#### Add `updated_at` to mutation points

- `db/insert.rs` — batch_insert_tracks, insert_playlist, add_tracks_to_playlist, rename_playlist, reorder_playlists
- `db/queries.rs` — record_track_played, record_track_skipped, update_track_rating, update_artwork_for_album
- `import/ai_tagger.rs` — AI tag updates
- `models/track.rs` — add `updated_at: Option<String>` field

#### New Cargo deps

```toml
axum = { version = "0.8", features = ["tokio"] }
tower-http = { version = "0.6", features = ["cors", "trace"] }
libmdns = "0.9"
uuid = { version = "1", features = ["v4"] }
rand = "0.8"
hex = "0.4"
```

#### Sync HTTP API

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/pair` | POST | No | Exchange pairing code for token |
| `/api/sync/manifest` | GET | Yes | Synced playlists + track info |
| `/api/sync/delta` | POST | Yes | Changes since last_sync_at |
| `/api/tracks/:id/file` | GET | Yes | Audio file (range requests) |
| `/api/artwork/:hash` | GET | Yes | Artwork file |
| `/api/sync/play-stats` | POST | Yes | Upload play/skip deltas |
| `/api/sync/complete` | POST | Yes | Finalize sync |

#### Pairing flow

1. iOS discovers desktop via Bonjour (`_untune._tcp`)
2. Desktop shows 4-digit code in UI
3. iOS POSTs code + device name to `/api/pair`
4. Desktop validates, generates UUID + 64-byte token, stores in `sync_devices`
5. Returns `{ deviceId, pairingToken, desktopName }`
6. iOS stores in Keychain, uses Bearer token for all future requests

#### Desktop UI changes

New `SyncSettings.tsx`: toggle server on/off, paired devices list, playlist selection checkboxes, pairing code modal

### iOS-side additions

#### New networking layer

```
Networking/
  DesktopDiscovery.swift       — NWBrowser for _untune._tcp
  PairingManager.swift         — pairing flow + Keychain storage
  SyncClient.swift             — URLSession sync orchestrator
  FileDownloader.swift         — background URLSession for audio files
Sync/
  SyncEngine.swift             — state machine
  PlayStatsAccumulator.swift   — batch upload
```

#### Sync state machine

```
Idle → Discovering → Connecting → SyncingMetadata → SyncingArtwork → SyncingFiles → UploadingPlayStats → Done
```

File downloads use `Range` headers for resume-on-disconnect.

#### File storage layout

```
Documents/
  Music/{trackId}.{ext}       — audio files
  Artwork/{hash}.jpg           — artwork by hash
  library.db                   — GRDB database
```

#### Settings updates

New views: PairingView, SyncStatusView with progress UI

### Verification checklist
- [ ] `cargo check` compiles with new sync module
- [ ] `npx tsc --noEmit` passes with SyncSettings component
- [ ] Bonjour advertisement visible: `dns-sd -B _untune._tcp`
- [ ] Pair iOS app with desktop via 4-digit code
- [ ] Sync a small playlist, verify tracks + artwork download
- [ ] Play synced tracks offline (airplane mode)
- [ ] Re-sync after playlist changes on desktop

---

## Phase 3: Auto-Sync + Bidirectional Play Stats — NOT STARTED

- Auto-sync when devices are on same LAN (periodic discovery check every 5 min)
- Background app refresh for sync
- Play stat upload with device name tracking (`last_played_on` field)
- Desktop adds `last_played_on TEXT` column to tracks table
- Auto-sync when synced playlists are modified on desktop
- File cleanup: delete audio files when tracks removed from synced playlists
- Storage management UI on iOS (per-playlist size, total, clear cache)

---

## Phase 4: Advanced Features — NOT STARTED

- Local FTS search across synced tracks
- Crossfade (AVAudioEngine for mixing control)
- Sleep timer with fade-out
- Album/artist/genre browse view enhancements
- Track info detail view (metadata, AI tags)
- AI assistant integration
- Radio mode
- Visualizer
