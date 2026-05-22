# Contributing to Untune

Thanks for your interest in improving Untune! This guide covers how to get the
project building and the conventions we follow.

## Prerequisites

- **Node.js 20.11.1** and **pnpm** (`corepack enable` will use the pinned version)
- **Rust** (stable toolchain) and the Tauri prerequisites for your platform —
  see https://tauri.app/start/prerequisites/
- **Xcode** (only for the `untune-ios` / `untune-tvos` companion apps), plus
  `xcodegen` to regenerate the Xcode projects from `project.yml`

## Getting started

```bash
pnpm install
pnpm tauri dev      # run the full desktop app (Rust + Vite dev server)
```

Other useful commands:

```bash
pnpm dev                       # frontend only (Vite on port 1420)
npx tsc --noEmit               # type-check the frontend
cd src-tauri && cargo check    # check the Rust backend compiles
pnpm tauri build               # production app bundle
```

There is no automated test suite — verify changes with `cargo check` and
`npx tsc --noEmit`, and exercise the affected UI manually.

## Before opening a pull request

- Make sure `npx tsc --noEmit` and `cargo check` both pass with **no new
  warnings**.
- Keep changes focused; unrelated refactors belong in separate PRs.
- Match the surrounding code style (naming, comment density, idioms).
- Describe what changed and how you verified it. Include screenshots or short
  clips for UI changes.

## Project layout

The architecture, build details, and key patterns are documented in
[`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md). In short:

- `src-tauri/src/` — Rust backend (Tauri commands, audio engine, import, db)
- `src/` — React + TypeScript frontend (Zustand stores, components)
- `untune-ios/`, `untune-tvos/` — Swift companion apps
- `untune-sync/` — sync server

## Reporting bugs and requesting features

Please use the GitHub issue templates. For security issues, **do not** open a
public issue — see [`SECURITY.md`](SECURITY.md).

By contributing, you agree that your contributions are licensed under the
project's MIT license.
