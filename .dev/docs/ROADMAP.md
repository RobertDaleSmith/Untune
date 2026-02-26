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

## Future Platform Targets

- [ ] **Web mode** — Axum HTTP server serving the same UI in a browser
- [ ] **Mobile** — Tauri v2 mobile targets (iOS/Android) with touch-optimized layout
- [ ] **Streaming** — stream from desktop to mobile over local network

---

*Last updated: 2026-02-25*
