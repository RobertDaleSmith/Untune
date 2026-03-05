# Untune — Feature Roadmap

> Tracking future features and improvements. Roughly ordered by impact within each category.

---

## Playback Engine

- [x] **Crossfade** — configurable overlap (0–12s) between tracks with fade curves
- [x] **Gapless playback** — seamless album transitions with no silence gap
- [ ] **Equalizer** — 10-band parametric EQ with presets (flat, bass boost, vocal, etc.)
- [x] **Sleep timer** — fade out and stop after N minutes
- [ ] **Crossfade preview** — audition crossfade settings from preferences
- [x] **Visualizer** — real-time FFT with 5 modes (bars, waveform, particles, geometry, digital)
- [x] **AirPlay** — audio output device picker for AirPlay speakers

## Queue & Playback UX

- [x] **Play queue sidebar** — visible "up next" list, reorderable via drag
- [x] **Queue history** — see recently played tracks, click to go back
- [x] **Drag tracks to playlists** — drag from track table onto sidebar playlists
- [x] **Mini player** — always-on-top compact mode (350×48px) with crossfading artwork
- [ ] **Global hotkeys** — control playback when the app isn't focused (beyond media keys)

## Library & Metadata

- [ ] **Edit metadata** — inline or modal tag editing (title, artist, album, year, genre) with write-back to files via lofty
- [ ] **Batch tag editing** — select multiple tracks, edit shared fields at once
- [x] **Artwork search** — MusicBrainz lookup to find and replace album artwork
- [ ] **Duplicate detection** — find and manage duplicate tracks (by fingerprint, metadata, or file hash)
- [x] **Star rating from table** — click-to-rate directly in the track row (not just via context menu)
- [ ] **Watch folders** — detect new/changed/removed files and auto-update library
- [x] **Synced lyrics** — time-synced lyrics display via LRCLIB API
- [x] **URL download** — download audio from URLs (YouTube via yt-dlp) with deep-link support

## Smart Views

- [x] **Recently added** — built-in smart view for tracks added in the last N days
- [x] **Recently played** — built-in smart view for recently played tracks
- [x] **Top played** — most played tracks over configurable time periods
- [x] **Smart playlists** — rule-based playlist editor with field/operator/value triplets
- [x] **Column browser** — iTunes-style hierarchical filtering (genre → artist → album)
- [ ] **Stats dashboard** — listening stats, top artists/albums/genres over time, listening hours per week/month

## Scrobbling & Social

- [ ] **Last.fm scrobbling** — submit plays, love/unlove tracks
- [ ] **ListenBrainz integration** — open-source scrobbling alternative
- [ ] **Scrobble history** — view past scrobbles within the app

## Import & Export

- [x] **Export playlists** — M3U / M3U8 export
- [x] **Import playlists** — M3U / M3U8 / PLS import
- [x] **AI tag backup** — export/import AI tags as JSON, auto-backup before library reset
- [ ] **Library re-sync** — detect changes in Apple Music and pull deltas
- [ ] **Backup & restore** — export/import full library database

## Discoverability & Polish

- [x] **Keyboard shortcuts overlay** — press `?` to see all available shortcuts in a modal
- [ ] **Onboarding** — first-launch walkthrough highlighting key features
- [x] **Settings/preferences panel** — dedicated UI for all configurable options
- [x] **Theme switching** — light, dark, and system-follow modes
- [ ] **Tooltip system** — consistent hover tooltips across all controls

## AI — Discovery & Recommendations

- [x] **"Play something like this"** — generate a queue of similar tracks from your library based on AI tags
- [x] **Smart radio** — auto-queue similar tracks when queue runs low
- [ ] **Mood-based playlists** — auto-generate "energetic", "chill", "focus", "melancholy" playlists from AI tags
- [x] **Natural language search** — ask the assistant to find tracks by description
- [x] **Chat with your library** — ask questions like "what's my most played genre?" via the AI assistant

## AI — Library Intelligence

- [x] **Auto-genre/mood tagging** — batch AI tagging via Claude Haiku (mood, energy, BPM, danceability, acousticness, vibe tags)
- [ ] **Smart duplicate detection** — fuzzy matching beyond exact hashes (same song, different masters/remixes)
- [ ] **Auto-fill missing metadata** — LLM-assisted lookup for incomplete tags
- [x] **Album/artist bios** — AI-generated contextual info shown in detail views
- [ ] **Audio fingerprinting** — identify unknown tracks, match duplicates across formats
- [ ] **Key detection** — detect musical key for harmonic mixing
- [x] **Mood/energy scoring** — per-track scores stored in DB, usable as smart playlist rules
- [x] **Tag search** — browse and filter library by AI-generated tags

## AI — Playback & Mix

- [ ] **Smart crossfade** — analyze track endings/beginnings to pick optimal crossfade duration per transition
- [ ] **BPM-matched transitions** — DJ-style smooth transitions between tracks with similar tempos
- [ ] **Auto-normalize** — AI-informed loudness matching across tracks

## AI — Voice Assistant ("Hey Untune")

- [x] **Voice input** — speech-to-text via native macOS dictation
- [ ] **Wake word detection** — "Hey Untune" always-listening trigger, or push-to-talk hotkey
- [x] **Conversational LLM brain** — Claude API with 13 music tools (search, play, queue, create playlists, stats, control)
- [ ] **Voice output** — text-to-speech via ElevenLabs / OpenAI TTS / Cartesia, streamed for low latency
- [x] **Music ducking** — auto-lower music volume while assistant speaks, restore after
- [x] **Conversational context** — remember recent exchanges within a session ("play more like that", "skip this one")
- [ ] **Latency target** — voice-in to voice-out in <2s (STT ~300ms → LLM streaming ~1s → TTS first chunk ~300ms)

## Multi-Platform

- [x] **iOS companion app** — native SwiftUI app with offline playback, CarPlay, Siri, playlist sync
- [x] **tvOS streaming app** — native SwiftUI app streaming from desktop over LAN
- [x] **Sync server** — axum HTTP server with Bonjour discovery, pairing, metadata/file/artwork transfer
- [ ] **Web mode** — Axum HTTP server serving the same UI in a browser
- [ ] **Android** — native or cross-platform companion app

## CI/CD & Infrastructure

- [x] **GitHub Actions CI** — TypeScript + Rust checks, full Tauri build on push/PR
- [x] **GitHub Actions Release** — signed build, Apple notarization, GitHub Release with DMG
- [ ] **Auto-update** — Tauri updater for seamless app updates

---

*Last updated: 2026-03-05*
