# Third-Party Notices

Untune is distributed under the MIT license (see `LICENSE`). It also includes
or links the following third-party components, each governed by its own
license. This file summarizes the notable obligations; run a full license scan
(e.g. `cargo-deny check licenses`) before any binary distribution.

## ⚠️ Unresolved: Highly Experimental (PSF / PSF2 core)

`src-tauri/vendor/Highly_Experimental` (Neill Corlett / Christopher Snowhill)
ships **no license** — under copyright law that means all rights reserved. It
is currently compiled into the binary via `src-tauri/build.rs` and used through
`src-tauri/src/psf_source.rs`. **This must be removed (or separately licensed
in writing) before Untune can be lawfully released under MIT.** The related
`hebios.bin` is a Sony PS2 BIOS image and must never be bundled; it is kept as
an empty placeholder today.

## game-music-emu (libgme) — LGPL-2.1-or-later

The `game-music-emu` crate statically links Blargg's Game_Music_Emu C++
library, which is licensed under the GNU LGPL v2.1 or later. Distributing a
binary that statically links it requires that recipients be able to relink
against a modified libgme (e.g. by providing object files or using dynamic
linking) and that the LGPL text and source/notice be made available.
Upstream: https://bitbucket.org/mpyne/game-music-emu

## psflib — MIT

`src-tauri/vendor/psflib` — Copyright (c) 2012-2015 Christopher Snowhill.
Licensed under the MIT license. Include its notice when redistributing.
Upstream: https://github.com/kode54/psflib

## zlib

`src-tauri/build.rs` links the system zlib library, distributed under the
permissive zlib license.

## Rust crates and npm packages

The remaining dependencies are under permissive licenses (Tauri — MIT/Apache-2.0,
rusqlite/SQLite — public domain, lofty — MIT/Apache-2.0, rodio/symphonia —
MIT/MPL-2.0, etc.). MPL-2.0 components (e.g. symphonia) are file-level
weak-copyleft: modified MPL files must be shared, but they do not affect the
MIT licensing of the rest of the project. See each crate/package for details.
