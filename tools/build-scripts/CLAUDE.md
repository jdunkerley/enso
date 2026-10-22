# tools/build-scripts

The build logic that leaves `./run` (build simplification, Phase 3; the spec is
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`). TypeScript
that Node runs as it is (type stripping): each command is
`node src/commands/<name>.ts`, started from anywhere with
`corepack pnpm --filter build-scripts run <name>`.

## Commands

- `version` — the Enso version (`ENSO_VERSION`, `ENSO_EDITION`,
  `ENSO_RELEASE_MODE`), as `./run` computed it before every command. In GitHub
  Actions it writes them to `GITHUB_OUTPUT` and `GITHUB_ENV`; locally,
  `eval "$(corepack pnpm --silent --filter build-scripts run version)"`.

## Layout

- `src/commands/` — one entry point per command: reads the environment and the
  repository, calls the logic, sets the exit code. Nothing worth testing.
- `src/<command>/` — the logic, as functions with vitest tests beside them
  (`*.test.ts`).
- `src/lib/` — shared helpers: the repository root and running programs
  (`repo.ts`), publishing to GitHub Actions (`github.ts`).

## Conventions

- **Erasable TypeScript only** (`erasableSyntaxOnly`): no enums, namespaces or
  parameter properties, and relative imports end in `.ts`. Node runs the sources
  directly; there is no build step and no `compile` script.
- **Never resolve paths against `process.cwd()`**: pnpm runs a command in this
  package's directory. Use `REPO_ROOT` (`src/lib/repo.ts`).
- **Port, do not improve.** A command reproduces what `./run` did, quirks
  included; a deliberate difference is named in the command's file comment and
  in its pull request.
- **Start programs with `capture` or `runInherited`** (`src/lib/repo.ts`). They
  go through the shell only for the Windows `.cmd`/`.bat` shims (`corepack`,
  `sbt`, …), which only the shell finds.
- **Checks:** `corepack pnpm --filter build-scripts run typecheck`, `lint` and
  `test:unit`. CI runs them in `.github/workflows/build-scripts.yml`; the GUI
  checks run them too when GUI files change.
