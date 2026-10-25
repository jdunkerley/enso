# Desktop app

This folder holds the Enso IDE: the Electron shell, the Vue GUI, the ydoc server
and the supporting packages. It is a pnpm monorepo.

- `gui/`: the Vue GUI (graph editor and local project dashboard).
- `electron-client/`: the Electron main process.
- `project-manager-shim/`: the project manager, replacing the Scala one.
- `common/`: TypeScript utilities shared by the GUI and the Electron client.
- `ydoc-server/`, `ydoc-server-polyglot/`, `ydoc-shared/`, `ydoc-channel/`,
  `ydoc-inspect/`: the ydoc (collaborative editing) stack.
- `rust-ffi/`: the Rust parser compiled to WASM.
- `lezer-markdown/`, `lang-markdown/`, `table-expression/`: editor grammars.
- `licenses/`: license data.

See [`CLAUDE.md`](./CLAUDE.md) for details, and the wiki pages
[IDE Architecture](https://github.com/jdunkerley/enso/wiki/IDE-Architecture) and
[Building and Running](https://github.com/jdunkerley/enso/wiki/Building-and-Running).
