# ydoc-server-polyglot

The `ydoc-server` bundled with esbuild into a single CommonJS file so it can be
loaded by GraalJS inside the GraalVM engine process. Uses `commonjs` package
type (the rest of the pnpm workspace uses `module`).

## Why this exists

The Enso engine ships as a GraalVM process that already has a JS runtime
(GraalJS). Rather than requiring a separate Node.js to run the ydoc server next
to it, we bundled the server into a polyglot script the engine can embed. It is
now **the rollback host until PR M** of the JVM-by-default plan: the IDE runs
the server in Node (`NodeYdocHost` in an Electron utility process), and the
engine starts this bundle only when the shim passes `LANGUAGE_SERVER_YDOC_PORT`,
which it does under `ENSO_YDOC_HOST=engine`. Keep it building and working until
it is deleted.

## Build

- `pnpm run compile` → `node ./build.mjs build` (esbuild-driven, writes
  `dist/main.cjs`).
- `pnpm run dev:watch` → esbuild watch mode.

## Constraints

GraalJS is **not** Node.js:

- Only the subset of Node APIs that `graaljs` polyfills is usable.
  Filesystem/process/net work, but some newer APIs or native bindings do not.
- No dynamic `import()` of ESM — everything must end up CJS after bundling.
- WebSocket support comes from the engine host, not `ws`; the bundle stubs this.

When adding a dep to `ydoc-server`, verify the bundled output still loads under
GraalJS before merging (see
[Infrastructure-Ydoc](https://github.com/jdunkerley/enso/wiki/Infrastructure-Ydoc)).

## Source

All logic lives in `ydoc-server`. This package is pure packaging — `src/` should
stay minimal.
