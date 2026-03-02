# Untune Server & Multi-Client Architecture

> Planning doc for evolving Untune from a standalone desktop app into a self-hosted server + multi-client ecosystem for digital music collectors.

---

## Vision

A free, cloudless, self-hosted music system where collectors own their infrastructure. Each user runs their own server on a NAS, dedicated box, Pi, or even their desktop. Clients (desktop, mobile, web) connect to stream, browse, and manage the library. Users can invite others to stream from their server — a decentralized model where the music stays on hardware you control.

**Core principles:**
- No cloud dependency, no subscription
- Your files, your server, your rules
- Metadata edits write back to files (the files *are* the source of truth)
- Desktop app works fully offline with a local library (server is optional)
- Server and desktop mirror each other when connected

---

## System Overview

```
                          ┌─────────────────────┐
                          │   untune-server       │
                          │   (NAS / dedicated)  │
                          │                      │
                          │  ┌────────────────┐  │
                          │  │ Audio files     │  │
                          │  │ SQLite DB       │  │
                          │  │ Artwork cache   │  │
                          │  │ File backups    │  │
                          │  └────────────────┘  │
                          │                      │
                          │  HTTP/REST API        │
                          │  WebSocket (events)   │
                          └──────┬───────┬───────┘
                                 │       │
                    ┌────────────┘       └────────────┐
                    │                                  │
          ┌─────────▼──────────┐            ┌──────────▼─────────┐
          │  untune-desktop     │            │  untune-mobile      │
          │  (Tauri app)       │            │  (iOS/Android)     │
          │                    │            │                    │
          │  Modes:            │            │  Always connects   │
          │  - Local only      │            │  to server         │
          │  - Connected       │            │  Offline cache     │
          │  - Hybrid (sync)   │            │                    │
          └────────────────────┘            └────────────────────┘
```

---

## Apps & Repos

### `untune-core` (shared Rust crate)

Library crate used by both server and desktop. Contains everything that isn't I/O-specific:

- **Database** — schema, migrations, queries, models
- **Metadata** — lofty tag reading/writing, embedded artwork extraction
- **Smart playlists** — rule evaluation engine
- **Sync protocol** — diff/merge logic, conflict resolution
- **API types** — shared request/response structs (serde)
- **File hashing** — SHA256 for dedup and artwork identity
- **Search** — FTS5 query building

This is extracted from the current `src-tauri/src/` codebase. Most of `db/`, `models/`, `smart_playlists.rs`, and the metadata parts of `import/` move here.

### `untune-server` (headless Rust binary)

Runs on a NAS, dedicated machine, or alongside the desktop app. No GUI.

- **HTTP API** (axum) — REST endpoints for library, streaming, artwork, auth
- **WebSocket** — real-time events (library changes, playback sync)
- **Library scanner** — watches directories, imports new files, detects changes
- **Audio streaming** — serves files with HTTP range requests
- **Artwork serving** — HTTP image endpoints with cache headers
- **User management** — owner/admin + invited users
- **Metadata writeback** — edits embedded tags in files, with backup
- **File backup** — temp copies of files before metadata changes (configurable)
- **Transcoding** (future) — on-the-fly transcode for bandwidth-constrained clients

### `untune-desktop` (Tauri app — current repo, evolved)

The current Untune app with three operating modes:

| Mode | Audio Files | Database | Use Case |
|------|-------------|----------|----------|
| **Local** | Local disk | Local SQLite | No server, works as today |
| **Connected** | Stream from server | Server DB via API | No local files, thin client |
| **Hybrid** | Local disk + server backup | Local SQLite, syncs to server | Full local library, backed up and accessible remotely |

In hybrid mode, the desktop is the initial source of truth. On first sync, the entire library (metadata + files) mirrors to the server. After that, edits on either side sync bidirectionally.

### `untune-mobile` (future)

- Always connects to a server (no standalone mode)
- Stream audio, browse library, manage playlists
- Offline cache: pin playlists/albums for local playback
- Lighter metadata — no bulk editing, no import pipeline

---

## Server API Design

### Authentication

Token-based auth. The server owner creates the instance and is the admin. They can invite users.

```
POST   /api/auth/login          { username, password } → { token, role }
POST   /api/auth/refresh        { refreshToken }       → { token }
POST   /api/auth/invite         (admin) { username, role } → { inviteCode }
POST   /api/auth/register       { inviteCode, username, password }
```

**Roles:**
- `admin` / `owner` — full access: edit metadata, manage files, manage users, configure server
- `user` (invited) — stream, browse, create playlists (private or shared), rate/love tracks (per-user)

### Library Endpoints

```
GET    /api/tracks              ?offset=0&limit=100&sort=artist&dir=asc
GET    /api/tracks/:id
GET    /api/tracks/search       ?q=miles+davis&limit=20
PUT    /api/tracks/:id          (admin) { title, artist, album, ... }  → updates DB + file tags
PUT    /api/tracks/batch        (admin) { ids: [...], fields: {...} }   → batch tag edit

GET    /api/albums              ?offset=0&limit=50
GET    /api/albums/:key/tracks
GET    /api/artists
GET    /api/artists/:name/tracks
GET    /api/genres
```

### Streaming Endpoints

```
GET    /api/stream/:trackId     Audio file with Range header support
                                Headers: Accept-Ranges: bytes
                                         Content-Range: bytes 0-999/10000
                                         Content-Type: audio/flac (or mp3, m4a, etc.)

GET    /api/artwork/:hash       Image file (JPEG/PNG)
                                Headers: Cache-Control: public, max-age=31536000
                                         ETag: "{hash}"
```

Audio streaming uses HTTP range requests so clients can seek without downloading the full file. This is the same protocol that every browser and native audio player already understands.

### Playlists

```
GET    /api/playlists                     All playlists visible to current user
POST   /api/playlists                     { name, trackIds?, visibility: "private"|"shared" }
PUT    /api/playlists/:id                 { name?, trackIds? }
DELETE /api/playlists/:id
GET    /api/playlists/:id/tracks

GET    /api/smart-playlists/:id/tracks    Evaluate smart playlist rules server-side
```

**Playlist ownership:**
- Admin playlists: visible to all users
- User playlists: `private` (only creator sees them) or `shared` (visible to all)
- Each user has their own ratings, love flags, and play counts (stored per-user)

### Sync Endpoints

```
POST   /api/sync/push           Desktop → Server: send local changes
POST   /api/sync/pull           Server → Desktop: get remote changes since timestamp
GET    /api/sync/status         Current sync state, last sync time, pending changes
POST   /api/sync/files/upload   Upload audio file to server
GET    /api/sync/files/download/:trackId  Download audio file from server
```

### Server Config

```
GET    /api/server/info         { version, name, trackCount, userCount }
GET    /api/server/config       (admin) full server config
PUT    /api/server/config       (admin) update settings
```

### WebSocket Events

```
ws://server/api/ws

Server → Client events:
  library-updated      { trackIds: [...], type: "added"|"modified"|"deleted" }
  playlist-updated     { playlistId, type: "created"|"modified"|"deleted" }
  user-joined          { username }
  sync-complete        { summary }

Client → Server events:
  playback-update      { trackId, position, action }  (for scrobbling/activity)
```

---

## Sync & Mirroring Model

### Initial Sync (Desktop → Server)

When a desktop first connects to a server:

1. Desktop sends full track metadata manifest (id, file hash, metadata hash, timestamps)
2. Server compares against its own library (empty on first setup)
3. Server requests missing audio files from desktop
4. Desktop uploads files (background, resumable, chunked)
5. Server scans uploaded files, extracts artwork, builds its own DB
6. Both sides record sync checkpoint (timestamp + sequence number)

### Ongoing Bidirectional Sync

After initial mirror, changes flow both directions:

```
Desktop edit (e.g. change genre tag)
  → Record change: { trackId, field, oldValue, newValue, timestamp }
  → On next sync: push change to server
  → Server applies change to DB + writes tag to file
  → Server creates backup of original file (if backup enabled)
  → Server broadcasts library-updated to other connected clients

Server-side edit (e.g. admin edits via mobile)
  → Same flow in reverse
  → Desktop pulls change on next sync
  → Desktop applies to local DB + writes tag to local file
  → Desktop creates local backup (if backup enabled)
```

### Conflict Resolution

**Last-write-wins with field-level granularity.** If desktop changes `genre` and server changes `artist` on the same track, both changes apply (no conflict). If both change `genre`, the later timestamp wins.

For the rare case of a true conflict, the server keeps both versions in a `sync_conflicts` table for the admin to review.

### What Syncs

| Data | Syncs | Direction |
|------|-------|-----------|
| Track metadata | Yes | Bidirectional (admin only) |
| Audio files | Yes | Bidirectional |
| Artwork | Yes | Bidirectional |
| Admin playlists | Yes | Bidirectional |
| User playlists | No | Server only (per-user) |
| Play counts (admin) | Yes | Bidirectional |
| Play counts (user) | No | Server only (per-user) |
| Ratings (admin) | Yes | Bidirectional |
| Ratings (user) | No | Server only (per-user) |
| Smart playlist rules | Yes | Bidirectional |
| Server config | No | Server only |

---

## Metadata Writeback & File Backup

### Writeback Strategy

When metadata is edited (title, artist, album, genre, year, etc.), the change should be written to the embedded tags in the actual audio file — not just the database. The file is the canonical source of truth.

**Implementation:**
- Use `lofty` crate (already a dependency) for reading/writing tags
- Support ID3v2 (MP3), Vorbis Comments (FLAC/OGG), MP4 atoms (AAC/ALAC)
- Write to the primary tag format for each file type
- After writing, update the DB record + file hash

### File Backup Before Writeback

Because tag writing modifies the file, we need a safety net until the feature is battle-tested.

**Backup behavior (server-configurable):**

```yaml
# untune-server config
metadata_writeback:
  enabled: true
  backup:
    enabled: true                    # Keep backup copies of modified files
    location: "/path/to/backups"     # Default: {data_dir}/backups/
    retention_days: 30               # Auto-delete backups older than N days (0 = keep forever)
    max_size_gb: 50                  # Cap total backup storage
```

**Backup flow:**
1. Before modifying a file, copy it to `{backup_dir}/{YYYY-MM-DD}/{original_filename}.{timestamp}.bak`
2. Write the new tags to the original file
3. Verify the file is still valid audio (open with Symphonia, check duration matches)
4. If verification fails, restore from backup automatically
5. Log all writeback operations for audit trail

**Desktop app** follows the same pattern when editing locally. The backup dir lives in the app's data directory.

---

## Database Evolution

### New Tables (Server)

```sql
-- User accounts
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',  -- 'admin' or 'user'
    created_at TEXT NOT NULL,
    last_login_at TEXT
);

-- Per-user track data (ratings, play counts, loved)
CREATE TABLE user_track_data (
    user_id INTEGER NOT NULL,
    track_id INTEGER NOT NULL,
    play_count INTEGER DEFAULT 0,
    skip_count INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 0,
    loved INTEGER DEFAULT 0,
    last_played_at TEXT,
    PRIMARY KEY (user_id, track_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- Playlist ownership
-- (add columns to existing playlists table)
ALTER TABLE playlists ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE playlists ADD COLUMN visibility TEXT DEFAULT 'private';
  -- 'private' = only owner sees it
  -- 'shared'  = visible to all users

-- Sync log (tracks changes for bidirectional sync)
CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    field TEXT NOT NULL,           -- which field changed
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT NOT NULL,      -- 'desktop' or 'server' or username
    changed_at TEXT NOT NULL,
    synced INTEGER DEFAULT 0       -- 0 = pending, 1 = synced
);

-- Sync state (per client)
CREATE TABLE sync_clients (
    client_id TEXT PRIMARY KEY,    -- UUID assigned to each desktop instance
    client_name TEXT,
    last_sync_at TEXT,
    last_sync_sequence INTEGER DEFAULT 0
);

-- File backups log
CREATE TABLE file_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    original_path TEXT NOT NULL,
    backup_path TEXT NOT NULL,
    reason TEXT NOT NULL,           -- 'metadata_edit', 'artwork_change', etc.
    created_at TEXT NOT NULL,
    fields_changed TEXT,            -- JSON: {"artist": ["old", "new"]}
    FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- Auth tokens
CREATE TABLE auth_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Invites
CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    used_by INTEGER,
    created_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (used_by) REFERENCES users(id)
);
```

### Tracks Table Additions

```sql
-- Add to existing tracks table
ALTER TABLE tracks ADD COLUMN file_hash TEXT;         -- SHA256 of audio file (for sync/dedup)
ALTER TABLE tracks ADD COLUMN metadata_hash TEXT;     -- Hash of tag fields (for change detection)
ALTER TABLE tracks ADD COLUMN last_modified_at TEXT;   -- When metadata was last changed
ALTER TABLE tracks ADD COLUMN added_by TEXT;           -- Which client/user added it
```

---

## Desktop App Changes

### Mode Selection

On first launch (or in settings), user picks their mode:

- **Local** — no server, current behavior, nothing changes
- **Connect to Server** — enter server URL, authenticate, stream everything remotely
- **Hybrid** — local library + server connection for sync/backup

Mode can be changed anytime. Switching from Local → Hybrid triggers initial sync.

### Data Layer Abstraction

The desktop app currently calls `db::` functions directly from commands. To support connected mode, introduce a trait:

```rust
trait LibraryProvider {
    fn get_tracks(&self, query: &TrackQuery) -> Result<Vec<Track>>;
    fn search_tracks(&self, query: &str, limit: i64) -> Result<Vec<Track>>;
    fn get_playlists(&self) -> Result<Vec<Playlist>>;
    fn get_track_file_url(&self, track_id: i64) -> Result<String>;
    fn get_artwork_url(&self, hash: &str) -> Result<String>;
    // ... etc
}

struct LocalProvider { db: Database }           // Current behavior
struct RemoteProvider { client: HttpClient }     // API calls to server
struct HybridProvider { local: LocalProvider, remote: RemoteProvider }
```

### Playback in Connected Mode

When streaming from server, the audio source changes:

```rust
// Current: local file
let source = AudioSource::open("/path/to/file.flac")?;

// Connected mode: HTTP stream
let source = AudioSource::open_url("https://server/api/stream/12345", auth_token)?;
```

This requires extending `AudioSource` to accept an HTTP response body as a `Read + Seek` source. Seeking over HTTP uses range requests.

---

## Mobile App

### Tech Choice (TBD)

Options:
1. **Tauri v2 mobile** — share Rust backend + React frontend, but WKWebView has limitations (no `webkitSpeechRecognition`, audio playback quirks)
2. **React Native** — reuse TypeScript/React knowledge, native audio via `expo-av` or `react-native-track-player`, best ecosystem
3. **Native (Swift + Kotlin)** — best UX, most work, two codebases

Recommendation: **React Native** with `react-native-track-player` for audio. It handles background playback, lock screen controls, and HTTP streaming natively on both platforms. The REST API means the mobile app is a thin client.

### Mobile Feature Scope

| Feature | Mobile | Desktop |
|---------|--------|---------|
| Browse library | Yes | Yes |
| Stream audio | Yes | Yes |
| Search | Yes (server-side) | Yes (local FTS or server) |
| Create playlists | Yes | Yes |
| Edit metadata | No (admin only, desktop/web) | Yes |
| Import library | No | Yes |
| Smart playlists | View + play | Create + edit |
| Offline cache | Pin albums/playlists | Full local library |
| Visualizer | No | Yes |
| Assistant | Simplified | Full |

---

## Network & Discovery

### Local Network

- **mDNS / Bonjour** — server advertises `_untune._tcp` on LAN
- Desktop/mobile auto-discover servers on the same network
- Zero configuration for home use

### Remote Access

Options (user's choice, not our problem to solve completely):

- **Tailscale** (recommended) — zero-config VPN, encrypted, no port forwarding
- **WireGuard** — manual but lightweight VPN
- **Reverse proxy** (nginx/Caddy) — expose server on a domain with HTTPS + Let's Encrypt
- **SSH tunnel** — `ssh -L 8080:localhost:8080 nas` for quick access

The server binds to `0.0.0.0:8484` (or configured port) and serves HTTPS if certs are provided, HTTP otherwise. We don't handle NAT traversal — that's the user's infrastructure choice.

---

## Server Configuration

The server runs as a single binary with a config file:

```yaml
# ~/.config/untune-server/config.yaml  (or /etc/untune-server/config.yaml)

server:
  host: "0.0.0.0"
  port: 8484
  name: "Robert's Music Server"

library:
  paths:
    - "/mnt/music"
    - "/mnt/music-2"
  watch: true                      # Auto-detect file changes
  scan_interval_minutes: 60        # Full rescan interval (0 = only watch)

metadata_writeback:
  enabled: true
  backup:
    enabled: true
    location: "/mnt/music-backups"
    retention_days: 30
    max_size_gb: 50

storage:
  database: "/var/lib/untune-server/library.db"
  artwork_cache: "/var/lib/untune-server/artwork"

# transcoding:                     # Future
#   enabled: false
#   remote_format: "opus"
#   remote_bitrate: 128

tls:
  enabled: false
  cert: "/path/to/cert.pem"
  key: "/path/to/key.pem"
```

---

## Implementation Phases

### Phase 0: Prepare the Monorepo (workspace)

- Convert repo to Cargo workspace: `untune-core`, `untune-desktop`, `untune-server`
- Extract shared code from `src-tauri/src/` into `untune-core`
- Desktop app depends on `untune-core` — everything still works as before
- No user-facing changes

### Phase 1: untune-server MVP

- Axum HTTP server binary
- Library scanning (directory walk + lofty metadata extraction — no JXA)
- REST API: tracks (paginated), search, playlists, artwork, streaming
- Single-user auth (owner/admin only, token-based)
- HTTP range-request audio streaming
- Artwork serving with cache headers
- Server config file
- Can run headless on any machine

**Milestone:** Browse and stream your full library from a browser or curl.

### Phase 2: Desktop Connected Mode

- Add `LibraryProvider` trait abstraction to desktop app
- Implement `RemoteProvider` that calls server API
- HTTP audio source for playback (range requests for seeking)
- Server URL + auth configuration in desktop settings
- Desktop can stream from server without local files

**Milestone:** Desktop app streams from server on another machine.

### Phase 3: Sync & Hybrid Mode

- Sync protocol: manifest comparison, change log, conflict resolution
- File upload/download for initial mirror
- Background sync daemon in desktop app
- Hybrid mode: local library + server backup
- Sync status UI in desktop app

**Milestone:** Desktop library mirrors to server, edits sync both ways.

### Phase 4: Metadata Writeback

- Tag writing via lofty (ID3v2, Vorbis, MP4)
- File backup before modification
- Verification after write (reopen, check duration)
- Audit log of all changes
- Backup management (retention, cleanup)
- Desktop metadata editor UI

**Milestone:** Edit a track's artist in the app, tag updates in the file, backup exists.

### Phase 5: Multi-User

- User management (invite codes, roles)
- Per-user playlists (private/shared)
- Per-user play counts, ratings, loved flags
- Concurrent stream handling
- Admin panel (web UI or desktop section)

**Milestone:** Invite a friend, they stream from your server with their own playlists.

### Phase 6: Mobile App

- React Native app (or revisit tech choice)
- Server discovery (mDNS on LAN, manual URL for remote)
- Browse, search, stream
- Background playback + lock screen controls
- Offline pinning (download tracks/playlists for offline)
- User playlists

**Milestone:** Stream your library from your phone anywhere.

### Future

- On-the-fly transcoding (FLAC → Opus for mobile bandwidth)
- Web client (server serves a React SPA — similar to Navidrome's web UI)
- Scrobbling (Last.fm, ListenBrainz) from server side
- Multiple library paths with priority/merge rules
- Album art search + apply from server
- Assistant integration on server (shared across clients)

---

## Open Questions

1. **Mono-repo or multi-repo?** — Single repo with Cargo workspace is simpler to start. Could split later if the mobile app is a separate tech stack.

2. **File storage on server** — Does the server store files in their original directory structure, or reorganize into `Artist/Album/Track.flac`? Recommend: keep originals as-is, don't move files.

3. **Transcoding priority** — Is on-the-fly transcoding important for mobile, or do most users have enough bandwidth to stream FLAC? Could defer this significantly.

4. **Desktop app: keep Tauri or move to a web client?** — Tauri keeps the native feel and local-only mode. But a web client means any browser works. Could support both (server serves web UI, desktop stays Tauri).

5. **Database: SQLite everywhere or PostgreSQL for server?** — SQLite is simpler, works great for single-server use, and keeps `untune-core` consistent. PostgreSQL only needed at serious scale (100k+ tracks, many concurrent users). Recommend: SQLite.

6. **How to handle very large libraries for initial sync?** — 62k tracks, some FLAC, could be 500GB+. Need resumable uploads, progress tracking, and the ability to sync metadata first (fast) then files in the background over days.

7. **Mobile tech stack** — Final decision can wait until Phase 6. The API is the same regardless.

---

*Last updated: 2026-02-26*
