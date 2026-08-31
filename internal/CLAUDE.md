# internal/

Small Node.js helper scripts that wire the JS-side build together. Not
published; ignored from linting.

## What each thing does

- `postinstall.mjs` — Runs after `pnpm install`. Invokes the WASM build
  (`rust-ffi build-wasm`) then codegen scripts for AST types
  (`ydoc-shared generate-ast`), icon metadata (`enso-gui generate-icons`), and
  the Lezer table-expression parser (`lezer-enso-table-expr generate-parser`).
  tsconfig files are committed as static files. It re-invokes pnpm via
  `process.env.npm_execpath` so it does not depend on `pnpm` being on `PATH`.
- Version/commit info is **not** handled here. The `./run` (Cargo) build sets
  `ENSO_IDE_VERSION` / `ENSO_IDE_COMMIT_HASH` as env vars before the Vite build
  (`build_tools/build/src/ide/web.rs`); Vite exposes them via
  `envPrefix: 'ENSO_IDE_'`; `app/electron-client/buildInfo.ts` reads them at
  bundle time; the engine gets its version from `project/BuildInfo.scala`.
- `dependenciesVersions.cjs` — Central catalog of deps versions to keep in sync
  between pnpm and other consumers.

## Conventions

- ESM (`.mjs`) unless a CJS consumer forces `.cjs`.
- Keep each script single-purpose and independent of others — these run in a mix
  of install and CI contexts.
- No TypeScript here — these must work before pnpm install completes.
