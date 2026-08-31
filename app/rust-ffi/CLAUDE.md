# rust-ffi

`wasm-bindgen` wrapper exposing `enso-parser` (from `lib/rust/parser/`) to
JavaScript. Built as a `cdylib` + `rlib`. Output is consumed by
`ydoc-shared/src/ast/` on the client.

## Gotcha: wasm-bindgen version pinning

`wasm-bindgen = "=0.2.100"` is an **exact** pin. It must match
`WASM_BINDGEN_VERSION` in `build-wasm.mjs` — the `wasm-bindgen` CLI that
generates the JS bindings. Patch-release bumps can change an internal format and
break the GUI build, so keep the two in lockstep and **never bump this with `~`
or `^`**.

## Build

`build-wasm.mjs` builds the crate for `wasm32-unknown-unknown` (release) and
runs `wasm-bindgen --target bundler` into `dist/`, which is git-ignored and
consumed by `ydoc-shared` as the `rust-ffi` package (`main` →
`dist/rust_ffi.js`). Vite loads the prebuilt `dist/` via `vite-plugin-wasm`; it
does **not** compile the Rust itself.

- `corepack pnpm --filter rust-ffi run build-wasm` — explicit rebuild.
- `internal/postinstall.mjs` runs it after `pnpm install` (before
  `generate-ast`).
- It is also this package's `compile` script, so `pnpm -r compile` rebuilds it
  in dependency order ahead of `ydoc-shared`.

The script installs the pinned `wasm-bindgen-cli` via `cargo install` on first
run if it is missing or the wrong version.

## Adding a new API

1. Add a `#[wasm_bindgen]` function here.
2. Extend TypeScript bindings in `ydoc-shared/src/ast/`.
3. Rebuild WASM (`corepack pnpm run -r compile` from repo root is the simplest).

Keep the surface tiny — the WASM binary ends up in the GUI bundle and every
exported symbol costs kilobytes.
