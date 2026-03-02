# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Run the full app (Tauri + Vite dev server)
pnpm tauri dev

# Frontend only (Vite dev server on port 1420)
pnpm dev

# Type-check frontend
npx tsc --noEmit

# Check Rust backend compiles
cd src-tauri && cargo check

# Build production app bundle
pnpm tauri build
```

No test suite exists — verify changes with `cargo check` and `npx tsc --noEmit`.

## Architecture

Tauri v2 desktop app: Rust backend + React 19 frontend communicating via IPC.

**Frontend → Backend:** `invoke("command_name", { args })` calls `#[tauri::command]` Rust functions. Wrappers live in `src/lib/commands.ts`.

**Backend → Frontend:** `app.emit("event-name", payload)` events, listened to with `listen()` from `@tauri-apps/api/event`. Used for progress updates, menu events, media keys.

### Backend (Rust, `src-tauri/src/`)

- **`lib.rs`** — Tauri setup, native menu construction, menu event dispatch
- **`commands/`** — IPC command handlers (import, tracks, playback, playlists, ai_tags, artwork, assistant, etc.)
- **`db/`** — SQLite via rusqlite: `schema.rs` (table creation/migrations), `queries.rs` (reads), `insert.rs` (writes + reset)
- **`import/`** — Multi-phase Apple Music import pipeline:
  1. `jxa.rs` — AppleScript extraction from Music.app (persistent IDs, metadata)
  2. `scanner.rs` — Filesystem walk of `~/Music/Music/Media/` with lofty for metadata
  3. `matcher.rs` — Join JXA + filesystem on artist+album+title+duration
  4. `mod.rs` — Orchestrator: preserves artwork hashes and AI tags across reimports, handles playlists
  5. `ai_tagger.rs` — Batch AI tagging via Claude API (mood, energy, BPM, etc.)
  6. `ai_tag_backup.rs` — Export/import AI tags as JSON for backup/restore
- **`playback.rs`** — Audio engine using rodio: queue, crossfade, gapless, shuffle history, sleep timer, FFT analyzer
- **`assistant/`** — Claude API chat with tool use (play music, search, queue management)
- **`models/`** — `Track` (47 fields), `Playlist`, `MergedTrack`, `JxaTrack`, etc.

### Frontend (React + TypeScript, `src/`)

- **`stores/`** — Zustand stores: `libraryStore` (all tracks in memory), `playbackStore`, `navigationStore`, `themeStore`, `columnBrowserStore`, `activityStore`, `assistantStore`
- **`lib/commands.ts`** — Typed wrappers around every `invoke()` call
- **`lib/types.ts`** — TypeScript interfaces matching Rust models (camelCase)
- **`components/`** — UI components. Key ones:
  - `App.tsx` — Root layout, menu event listeners, global keyboard shortcuts
  - `TrackTable.tsx` — Virtualized table (TanStack Table + Virtual) for 62k+ rows
  - `PlaybackBar.tsx` — Transport controls, now playing, volume
  - `Sidebar.tsx` — Navigation, playlist tree with drag-and-drop
  - `ContentRouter.tsx` — View switching (songs, albums, artists, genres, playlists)

### Database

SQLite with WAL mode at `~/Library/Application Support/com.untune.app/library.db`. The `tracks` table has ~50 columns including AI tag fields (mood, energy, vibe_tags, bpm, danceability, acousticness, ai_tagged_at). FTS5 virtual table `tracks_fts` for full-text search. Preferences stored in key-value `preferences` table.

## Key Patterns

- **All tracks loaded into memory** on startup (~31MB for 62k tracks). Frontend filtering/sorting happens in-memory via TanStack Table.
- **Reimport preserves data**: artwork hashes and AI tags are saved before clearing the tracks table and restored after reinsertion, matched by `persistent_id`.
- **AI tags auto-backup**: `reset_library` saves tags to `ai_tags_backup.json` before wiping; the next import auto-restores them.
- **Background tasks** (artwork extraction, AI tagging) run in spawned threads and report progress via events. The `activityStore` tracks their lifecycle.
- **Menu events** flow: native menu item → `on_menu_event` in `lib.rs` → `app.emit("menu-*")` → `listen()` in `App.tsx`.

## Gotchas

- lofty 0.22: Must import `lofty::file::TaggedFileExt` and `lofty::tag::Accessor` traits explicitly.
- Tauri v2: Need `use tauri::Manager;` for `app.manage()`, `app.state()`, `app.path()`.
- React 19: `useRef<T>()` requires an initial value argument (not optional).
- Rust crate name is `untune_lib` (not `untune` — that conflicts with the binary name).
- JXA scripts are in `src-tauri/scripts/`, bundled via `bundle.resources` in `tauri.conf.json`.
