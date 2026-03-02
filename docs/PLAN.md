# Untune - Project Plan

> A fast, dense, cross-platform music player that liberates your iTunes library.

## Vision

Replace iTunes/Apple Music as the primary music player with an app that:
- Respects screen real estate (compact, data-dense list views)
- Runs everywhere: desktop (native), web (browser), mobile (future)
- Handles massive libraries (62k+ tracks) with zero scroll lag
- Preserves all iTunes listening data (play counts, last played, ratings, skip counts, playlists, etc.)
- Reads the existing iTunes/Music library in-place without modifying or moving files

---

## Library Stats (Robert's Machine)

| Metric | Value |
|---|---|
| Total tracks (Music app) | 62,575 |
| Audio files on disk | 61,806 |
| Artist folders | 2,218 |
| Playlists (user) | 30 |
| Cached album artwork | 6,068 images |
| Media path | `~/Music/Music/Media/` |
| Library DB | `~/Music/Music/Music Library.musiclibrary/Library.musicdb` (proprietary binary) |
| Artwork cache | `~/Library/Containers/com.apple.AMPArtworkAgent/Data/Documents/artwork/` |

---

## Tech Stack

### Backend: Rust
- **Tauri v2** — desktop shell (macOS/Windows/Linux) + future mobile (iOS/Android)
- **Axum** — HTTP server for web mode (serve the same UI in a browser)
- **rusqlite** — local SQLite database (Untune's own indexed copy of library metadata)
- **lofty-rs** — parse audio file metadata (ID3v2, MP4/M4A tags, FLAC, etc.)
- **serde** — serialization for all data transfer

### Frontend: React + TypeScript
- **Vite** — build tooling
- **TanStack Virtual** (or react-window) — virtualized lists for 62k+ rows with zero lag
- **TanStack Table** — column-sortable, resizable, hideable table views
- **Tailwind CSS** — styling
- **Zustand** or **Jotai** — lightweight state management

### Data Extraction: JXA (JavaScript for Automation)
- macOS scripting bridge to Apple Music app
- Bulk property access: **all 32 metadata fields for 62,575 tracks in ~7 seconds**
- Playlist membership via persistent IDs
- No XML export needed — JXA is faster and more reliable

---

## Data Extraction Strategy

### Source 1: JXA → Apple Music App (iTunes metadata + listening habits)

**Available fields (all bulk-accessible, ~7s for full library):**

| Field | Description |
|---|---|
| `name` | Track title |
| `artist` | Artist name |
| `albumArtist` | Album artist |
| `album` | Album name |
| `genre` | Genre |
| `year` | Year |
| `trackNumber` / `trackCount` | Track position |
| `discNumber` / `discCount` | Disc position |
| `duration` | Duration in seconds |
| `bitRate` | Bit rate (kbps) |
| `sampleRate` | Sample rate (Hz) |
| `size` | File size (bytes) |
| `playedCount` | **Play count** |
| `playedDate` | **Last played date** |
| `skippedCount` | **Skip count** |
| `skippedDate` | **Last skipped date** |
| `dateAdded` | **Date added to library** |
| `rating` | Rating (0-100, maps to 0-5 stars) |
| `composer` | Composer |
| `comment` | Comment field |
| `compilation` | Is compilation album |
| `bpm` | BPM |
| `sortName` / `sortArtist` / `sortAlbum` | Sort-override fields |
| `persistentID` | Stable unique ID (for playlist membership) |
| `databaseID` | Database ID |
| `kind` | File type description |
| `mediaKind` | Media kind (song, podcast, etc.) |
| `enabled` | Whether track is enabled |

**Playlist data:**
- 30 user playlists with track persistent IDs
- Smart playlist detection (smart: true/false)
- Playlist special kind detection

**Note on `location` (file path):**
- Cannot be bulk-accessed (Path objects don't serialize in bulk)
- Must be fetched per-track or reconstructed from the file system
- Can be matched via artist/album/track folder structure in `~/Music/Music/Media/`

### Source 2: Audio File Metadata (lofty-rs)

Parse directly from the 62k audio files on disk:
- Embedded album artwork (ID3 APIC frames, MP4 covr atoms)
- Lyrics (if embedded)
- Additional tags not exposed by JXA
- File path (direct from filesystem scan)
- Codec details, channel count, etc.

### Source 3: Album Artwork Pipeline

Three sources, merged in priority order:
1. **Embedded in audio files** — highest fidelity, per-track, most reliable
2. **Apple's AMP Artwork Cache** — `~/Library/Containers/com.apple.AMPArtworkAgent/Data/Documents/artwork/` (6,068 cached images, named by hash) — hash mapping TBD
3. **Folder artwork** — `cover.jpg`, `folder.jpg`, etc. in album directories — **last resort**, inconsistent naming, not always present, can be wrong/outdated

Challenge: AMP cache files are named by hash with no obvious mapping to albums. We may need to:
- Match by extracting artwork from audio files and comparing hashes
- Or reverse-engineer the hash scheme from the Music app internals

### Data Merge Strategy

1. **Filesystem scan** (Rust, lofty-rs): Walk `~/Music/Music/Media/`, parse each file → get file path, embedded metadata, embedded artwork
2. **JXA extraction**: Bulk-pull all 32 fields + playlist data → get play counts, ratings, dates, persistent IDs
3. **Match & merge**: Join on artist+album+track name (or duration as tiebreaker) since file paths aren't bulk-accessible from JXA
4. **Store in SQLite**: Unified `tracks` table with all fields, `playlists` + `playlist_tracks` tables, `artwork` table/folder

---

## Database Schema (SQLite)

```sql
CREATE TABLE tracks (
    id INTEGER PRIMARY KEY,
    persistent_id TEXT UNIQUE,        -- iTunes persistent ID
    file_path TEXT,                    -- absolute path to audio file
    title TEXT NOT NULL,
    artist TEXT,
    album_artist TEXT,
    album TEXT,
    genre TEXT,
    year INTEGER,
    track_number INTEGER,
    track_count INTEGER,
    disc_number INTEGER,
    disc_count INTEGER,
    duration REAL,                     -- seconds
    bit_rate INTEGER,                  -- kbps
    sample_rate INTEGER,               -- Hz
    file_size INTEGER,                 -- bytes
    play_count INTEGER DEFAULT 0,
    last_played_at TEXT,               -- ISO 8601
    skip_count INTEGER DEFAULT 0,
    last_skipped_at TEXT,              -- ISO 8601
    date_added TEXT,                   -- ISO 8601
    rating INTEGER DEFAULT 0,          -- 0-100 (0-5 stars * 20)
    composer TEXT,
    comment TEXT,
    is_compilation BOOLEAN DEFAULT 0,
    bpm INTEGER,
    sort_title TEXT,
    sort_artist TEXT,
    sort_album TEXT,
    kind TEXT,                         -- "MPEG audio file", "AAC audio file", etc.
    media_kind TEXT,                   -- "song", "podcast", etc.
    enabled BOOLEAN DEFAULT 1,
    has_artwork BOOLEAN DEFAULT 0,
    artwork_path TEXT,                 -- path to extracted/cached artwork
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE playlists (
    id INTEGER PRIMARY KEY,
    persistent_id TEXT UNIQUE,
    name TEXT NOT NULL,
    is_smart BOOLEAN DEFAULT 0,
    special_kind TEXT,
    track_count INTEGER DEFAULT 0,
    sort_order INTEGER
);

CREATE TABLE playlist_tracks (
    playlist_id INTEGER REFERENCES playlists(id),
    track_id INTEGER REFERENCES tracks(id),
    position INTEGER,                  -- order within playlist
    PRIMARY KEY (playlist_id, track_id)
);

-- Full-text search index for instant filtering
CREATE VIRTUAL TABLE tracks_fts USING fts5(
    title, artist, album_artist, album, genre, composer,
    content='tracks',
    content_rowid='id'
);

-- Indexes for common queries
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_album ON tracks(album);
CREATE INDEX idx_tracks_genre ON tracks(genre);
CREATE INDEX idx_tracks_play_count ON tracks(play_count DESC);
CREATE INDEX idx_tracks_date_added ON tracks(date_added DESC);
CREATE INDEX idx_tracks_last_played ON tracks(last_played_at DESC);
CREATE INDEX idx_tracks_rating ON tracks(rating DESC);
```

---

## UI Design Principles

1. **Density over decoration** — compact rows (~24-28px height), every pixel earns its place
2. **Column-sortable table views** — click any column header to sort (like classic iTunes list view)
3. **Resizable & hideable columns** — user chooses what's visible
4. **Minimal playlist headers** — small inline bar, NOT half-screen hero banners
5. **Instant search** — full-text search across all fields, results as you type
6. **Sidebar navigation** — Library (Songs, Albums, Artists, Genres) + Playlists
7. **Album art** — small thumbnail in row + larger view on hover/selection, not dominant
8. **Now Playing bar** — fixed bottom bar with transport controls, progress, track info
9. **Keyboard-driven** — arrow keys to navigate, Enter to play, spacebar to pause

---

## Project Phases

### Phase 1: Foundation + Data Import ← START HERE
- [ ] Initialize Tauri v2 + React + Vite project
- [ ] Set up Rust backend with SQLite database
- [ ] Write JXA extraction script (run via `osascript` from Rust)
- [ ] Build file system scanner (walk Media folder, parse metadata with lofty-rs)
- [ ] Merge JXA data + file metadata into SQLite
- [ ] Extract/index album artwork
- [ ] Import playlists + playlist track membership

### Phase 2: Core UI - Song List View
- [ ] Sidebar layout (Library sections + Playlists)
- [ ] Virtualized song table (TanStack Virtual + TanStack Table)
- [ ] Column sorting (click to sort by any column)
- [ ] Column resizing and show/hide
- [ ] Full-text search bar with instant results
- [ ] Status bar (track count, total duration)

### Phase 3: Audio Playback
- [ ] Audio playback engine (HTML5 Audio or Web Audio API via Tauri)
- [ ] Now Playing bar (transport controls, progress scrubber, volume)
- [ ] Play queue management
- [ ] Gapless playback (stretch goal)
- [ ] Keyboard shortcuts (space=pause, arrows=navigate, enter=play)

### Phase 4: Browse Views
- [ ] Albums view (grid with cover art)
- [ ] Artists view (list with album grouping)
- [ ] Genres view
- [ ] Playlist detail view (compact header + song list)
- [ ] Album detail view

### Phase 5: Web + Polish
- [ ] Axum HTTP server mode (serve same UI in browser)
- [ ] Responsive layout adjustments for browser
- [ ] Preferences/settings panel
- [ ] Library re-sync (detect changes in iTunes)
- [ ] Theme support (light/dark)

### Phase 6: Mobile (Future)
- [ ] Tauri v2 mobile targets (iOS/Android)
- [ ] Touch-optimized layout
- [ ] Streaming from desktop to mobile over local network

---

## Open Questions

1. **File path matching**: JXA can't bulk-export file paths. Best approach:
   - Option A: Fetch locations individually per-track via JXA (slow but accurate — ~62k individual calls)
   - Option B: Match filesystem files to JXA data by artist+album+title+duration
   - **Recommendation: Option B** — filesystem scan gives us paths, JXA gives us metadata, match on multiple fields

2. **AMP artwork cache mapping**: Hash-named files with no obvious album mapping. May need to:
   - Skip this source initially and rely on embedded + folder artwork
   - Reverse-engineer the hash scheme later

3. **Real-time sync with Music app**: Should Untune watch for changes?
   - Could periodically re-run JXA extraction for delta updates
   - Or treat the initial import as a one-time fork

4. **Audio playback approach**:
   - Tauri can use web audio APIs directly
   - Or invoke a native audio backend via Rust (rodio, symphonia)
   - Web Audio API is simpler and works in browser mode too
