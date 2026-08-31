# internal/

Small Node.js helper scripts that wire the JS-side build together. Not
published; ignored from linting.

## What each thing does

- `postinstall.mjs` — Runs after `pnpm install`. Invokes the WASM build
  (`rust-ffi build-wasm`) then codegen scripts for AST types (`ydoc-shared
  generate-ast`), icon metadata (`enso-gui generate-icons`), and the Lezer
  table-expression parser (`lezer-enso-table-expr generate-parser`). tsconfig
  files are committed as static files. It re-invokes pnpm via
  `process.env.npm_execpath` so it does not depend on `pnpm` being on `PATH`.
- `stampFiles.bzl`, `workspaceStatus.mjs`, `stableStatus.mjs` — Legacy Bazel
  `--stamp` support. Produces version/commit metadata embedded into GUI bundles.
  Being replaced by Vite `define` (Phase 7 of the Bazel removal plan).
- `generateVersionInfo.mjs`, `runWithVersionInfo.mjs` — Compute and inject
  version info (commit hash, release channel) at build time.
- `envReplacer.mjs` — Vite plugin-ish env-variable substitutor.
- `prettierJson.mjs` — Custom Prettier config entry for JSON.
- `dependenciesVersions.cjs` — Central catalog of deps versions to keep in sync
  between pnpm and other consumers.

## Conventions

- ESM (`.mjs`) unless a CJS consumer forces `.cjs`.
- Keep each script single-purpose and independent of others — these run in a mix
  of install and CI contexts.
- No TypeScript here — these must work before pnpm install completes.
