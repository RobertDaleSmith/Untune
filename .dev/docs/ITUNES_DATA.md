# iTunes / Apple Music Data Extraction - Technical Findings

## The Problem

Apple's `Library.musicdb` is a proprietary binary format — not SQLite, not readable. The old "Share Library XML" checkbox was removed from the Music app in recent macOS versions. We need another way to extract all library metadata including listening habits.

## The Solution: JXA (JavaScript for Automation)

JXA provides a scripting bridge to the Music app that supports **bulk property access** — meaning we can pull a single property across ALL 62,575 tracks in one call, rather than iterating track-by-track.

### Performance Benchmarks (measured on this machine)

| Operation | Time |
|---|---|
| 4 properties x 62,575 tracks (bulk) | **1.3s** |
| 32 properties x 62,575 tracks (bulk) | **7.4s** |
| 100 tracks x all properties (loop) | 5.3s |
| 62,575 tracks x all properties (loop, estimated) | ~55 minutes |

**Bulk access is ~450x faster than looping.** This is the approach.

### JXA Extraction Script

```javascript
// Run with: osascript -l JavaScript extract_library.js
const Music = Application("Music");
const tracks = Music.libraryPlaylists[0].tracks;

// Bulk-pull all properties (each call returns an array of 62,575 values)
const data = {
    names:         tracks.name(),
    artists:       tracks.artist(),
    albumArtists:  tracks.albumArtist(),
    albums:        tracks.album(),
    genres:        tracks.genre(),
    years:         tracks.year(),
    trackNumbers:  tracks.trackNumber(),
    trackCounts:   tracks.trackCount(),
    discNumbers:   tracks.discNumber(),
    discCounts:    tracks.discCount(),
    durations:     tracks.duration(),
    bitRates:      tracks.bitRate(),
    sampleRates:   tracks.sampleRate(),
    sizes:         tracks.size(),
    playedCounts:  tracks.playedCount(),
    playedDates:   tracks.playedDate(),
    skippedCounts: tracks.skippedCount(),
    skippedDates:  tracks.skippedDate(),
    dateAddeds:    tracks.dateAdded(),
    ratings:       tracks.rating(),
    composers:     tracks.composer(),
    comments:      tracks.comment(),
    compilations:  tracks.compilation(),
    bpms:          tracks.bpm(),
    sortNames:     tracks.sortName(),
    sortArtists:   tracks.sortArtist(),
    sortAlbums:    tracks.sortAlbum(),
    persistentIDs: tracks.persistentID(),
    databaseIDs:   tracks.databaseID(),
    kinds:         tracks.kind(),
    mediaKinds:    tracks.mediaKind(),
    enableds:      tracks.enabled(),
};

// Output as JSON (pipe to file)
JSON.stringify(data);
```

### Known Limitation: File Paths

`tracks.location()` fails in bulk mode because JXA can't serialize Path/alias objects in bulk. Individual access works:

```javascript
tracks[0].location()  // works — returns Path object
tracks.location()     // FAILS — "Can't get object"
```

**Workaround**: Match JXA metadata to filesystem files using composite key:
- `artist + album + title + duration` provides a reliable match
- The filesystem scan from Rust gives us all file paths directly

### Playlist Extraction

```javascript
const playlists = Music.userPlaylists();
// For each playlist:
//   .name()          → playlist name
//   .smart()         → true if smart playlist
//   .specialKind()   → "Music", "none", etc.
//   .tracks.persistentID()  → array of track persistent IDs (bulk!)
```

**Findings:**
- 30 user playlists detected
- Smart playlists are identified (smart: true)
- Track membership via persistent IDs works in bulk per-playlist
- Smart playlists: Favorite Songs, Before iTunes <= 10/2003, Favorites - 4 Stars,
  Favorites Before iTunes, Recent Faves, Recent Loves, Recent Played, Winamp Days, All Favorites

## Other Data Sources

### Extras.itdb (SQLite)

Location: `~/Music/Music/Music Library.musiclibrary/Extras.itdb`

This IS SQLite and contains two tables:
- `cddb` — CDDB (freedb) lookup data: `item_id`, `media_id`, `mui_id`, `ufid`
- `uits` — Purchase/DRM data: `item_pid`, `data`

Not critical for our purposes — the JXA data is far more complete.

### Spotlight Metadata (mdls)

macOS indexes audio files with Spotlight. Available via `mdls` command per file:
- `kMDItemAlbum`, `kMDItemAuthors`, `kMDItemAudioBitRate`
- `kMDItemDurationSeconds`, `kMDItemAudioSampleRate`
- `kMDItemDateAdded`, `kMDItemContentCreationDate`
- etc.

Slower than lofty-rs for bulk parsing — useful as fallback verification only.

### Audio File Metadata (lofty-rs)

Parse embedded tags directly from files:
- **MP3**: ID3v1, ID3v2 (including embedded artwork as APIC frames)
- **M4A/AAC**: MP4/iTunes atoms (including covr artwork atoms)
- **FLAC**: Vorbis comments + embedded pictures
- Also: WAV, AIFF, OGG, etc.

Key data from file tags that JXA may not expose:
- Embedded artwork (binary image data)
- Embedded lyrics
- ReplayGain values
- MusicBrainz IDs
- Custom tags

## Album Artwork Sources

### 1. Embedded in Audio Files (via lofty-rs)
- Highest priority — per-track artwork
- Most reliable — travels with the file
- Formats: JPEG, PNG (occasionally BMP)
- Must extract binary data and save to cache

### 2. Apple AMP Artwork Agent Cache
- Location: `~/Library/Containers/com.apple.AMPArtworkAgent/Data/Documents/artwork/`
- 6,068 files (JPEG and PNG)
- Named by hash: `{SHA256}_sk_{number}_cid_{number}.{jpeg|png}`
- `sk_` values seen: 6, 12, 17, 45, 101 — likely represent size variants
- **No direct mapping to albums** — hash-named with no metadata sidecar
- Second priority — use if embedded art missing, hash mapping TBD

### 3. Folder Artwork (last resort)
- Files like `cover.jpg`, `folder.jpg`, `Folder.jpg`, `AlbumArt*.jpg` in album directories
- Least reliable — inconsistent naming, not always present, can be wrong/outdated
- Only used as final fallback when sources 1 and 2 have no match

### Artwork Strategy
1. Extract embedded art from audio files via lofty-rs (most reliable, comprehensive)
2. AMP artwork cache as second source (investigate hash mapping)
3. Folder artwork (`cover.jpg`, etc.) as last resort only
4. Cache all resolved artwork as `{persistent_id}.jpg` in Wavvy's own artwork directory

## Data Flow Summary

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   JXA Script    │     │  Filesystem Scan  │     │   Artwork Scan  │
│  (osascript)    │     │   (Rust/lofty)    │     │  (Rust/lofty)   │
│                 │     │                   │     │                 │
│ • 32 metadata   │     │ • file paths      │     │ • embedded art  │
│   fields        │     │ • embedded tags   │     │ • folder art    │
│ • play counts   │     │ • codec details   │     │ • AMP cache     │
│ • dates         │     │ • duration        │     │                 │
│ • ratings       │     │                   │     │                 │
│ • playlists     │     │                   │     │                 │
└────────┬────────┘     └────────┬──────────┘     └────────┬────────┘
         │                       │                          │
         └───────────┬───────────┘                          │
                     │                                      │
              ┌──────▼──────┐                               │
              │   Matcher   │                               │
              │ (artist +   │                               │
              │  album +    │                               │
              │  title +    │                               │
              │  duration)  │                               │
              └──────┬──────┘                               │
                     │                                      │
              ┌──────▼──────────────────────────────────────▼──┐
              │              SQLite Database                    │
              │  tracks | playlists | playlist_tracks | artwork │
              └────────────────────┬───────────────────────────┘
                                   │
                            ┌──────▼──────┐
                            │  Tauri/Axum │
                            │   Backend   │
                            └──────┬──────┘
                                   │
                            ┌──────▼──────┐
                            │  React UI   │
                            │ (virtualized│
                            │  table)     │
                            └─────────────┘
```
