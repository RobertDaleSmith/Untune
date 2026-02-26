# Waves — Feature Roadmap

> Tracking future features and improvements. Roughly ordered by impact within each category.

---

## Playback Engine

- [ ] **Crossfade** — configurable overlap (0–12s) between tracks with fade curves
- [ ] **Gapless playback** — seamless album transitions with no silence gap
- [ ] **Equalizer** — 10-band parametric EQ with presets (flat, bass boost, vocal, etc.)
- [ ] **Sleep timer** — fade out and stop after N minutes
- [ ] **Crossfade preview** — audition crossfade settings from preferences

## Queue & Playback UX

- [ ] **Play queue sidebar** — visible "up next" list, reorderable via drag
- [ ] **Queue history** — see recently played tracks, click to go back
- [ ] **Drag tracks to playlists** — drag from track table onto sidebar playlists
- [ ] **Global hotkeys** — control playback when the app isn't focused (beyond media keys)

## Library & Metadata

- [ ] **Edit metadata** — inline or modal tag editing (title, artist, album, year, genre) with write-back to files via lofty
- [ ] **Batch tag editing** — select multiple tracks, edit shared fields at once
- [ ] **Auto-tagging** — MusicBrainz lookup to fill in missing/incorrect metadata
- [ ] **Duplicate detection** — find and manage duplicate tracks (by fingerprint, metadata, or file hash)
- [ ] **Star rating from table** — click-to-rate directly in the track row (not just via context menu)
- [ ] **Watch folders** — detect new/changed/removed files and auto-update library

## Smart Views

- [ ] **Recently added** — built-in smart view for tracks added in the last N days
- [ ] **Recently played** — built-in smart view for recently played tracks
- [ ] **Top played** — most played tracks over configurable time periods
- [ ] **Stats dashboard** — listening stats, top artists/albums/genres over time, listening hours per week/month

## Scrobbling & Social

- [ ] **Last.fm scrobbling** — submit plays, love/unlove tracks
- [ ] **ListenBrainz integration** — open-source scrobbling alternative
- [ ] **Scrobble history** — view past scrobbles within the app

## Import & Export

- [ ] **Export playlists** — M3U / M3U8 export
- [ ] **Import playlists** — M3U / M3U8 / PLS import
- [ ] **Library re-sync** — detect changes in Apple Music and pull deltas
- [ ] **Backup & restore** — export/import full library database

## Discoverability & Polish

- [ ] **Keyboard shortcuts overlay** — press `?` to see all available shortcuts in a modal
- [ ] **Onboarding** — first-launch walkthrough highlighting key features
- [ ] **Settings/preferences panel** — dedicated UI for all configurable options (currently spread across localStorage + DB prefs)
- [ ] **Tooltip system** — consistent hover tooltips across all controls

## AI — Discovery & Recommendations

- [ ] **"Play something like this"** — given the current track, generate a queue of similar tracks from your library using embedding similarity (tempo, genre, mood, energy)
- [ ] **Smart radio** — endless auto-queue that learns from listening patterns, skips, and ratings
- [ ] **Mood-based playlists** — auto-generate "energetic", "chill", "focus", "melancholy" playlists from audio analysis or metadata
- [ ] **Natural language search** — "that jazz album from the 60s" or "songs I listened to a lot last summer"
- [ ] **Chat with your library** — ask questions like "what's my most played genre this month?" or "recommend something I haven't listened to in a while"

## AI — Library Intelligence

- [ ] **Auto-genre/mood tagging** — classify untagged tracks using audio embeddings or LLM analyzing artist+title+album
- [ ] **Smart duplicate detection** — fuzzy matching beyond exact hashes (same song, different masters/remixes)
- [ ] **Auto-fill missing metadata** — LLM-assisted lookup for incomplete tags
- [ ] **Album/artist bios** — fetch or generate contextual info shown in detail views
- [ ] **Audio fingerprinting** — identify unknown tracks, match duplicates across formats
- [ ] **Key detection** — detect musical key for harmonic mixing
- [ ] **Mood/energy scoring** — per-track scores stored in DB, usable as smart playlist rules

## AI — Playback & Mix

- [ ] **Smart crossfade** — analyze track endings/beginnings to pick optimal crossfade duration per transition
- [ ] **BPM-matched transitions** — DJ-style smooth transitions between tracks with similar tempos
- [ ] **Auto-normalize** — AI-informed loudness matching across tracks

## Future Platform Targets

- [ ] **Web mode** — Axum HTTP server serving the same UI in a browser
- [ ] **Mobile** — Tauri v2 mobile targets (iOS/Android) with touch-optimized layout
- [ ] **Streaming** — stream from desktop to mobile over local network

---

*Last updated: 2026-02-25*
