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
- `toolchain-check` — compares the installed GraalVM, sbt launcher, flatc, Node,
  pnpm, Rust and GraalPy with the pins (`build-config.yaml` `toolchain:`,
  `.node-version`, `packageManager`, `rust-toolchain.toml`), with an install
  hint for each that differs. A wrong sbt launcher or a missing GraalPy only
  warns.
- `stdlib-api-check` — what `./run backend stdlib-api-check` did: for each
  standard library with a `docs/api` directory, regenerate the API docs with the
  built engine (`enso --docs api --in-project`) and `git diff --no-index` them
  against the committed ones; the first that differs fails, with `./run`'s
  message. CI passes the build job's `ENSO_VERSION`; locally the only package in
  `built-distribution/` is used.
- `ide-build` — what `./run ide build --backend-source local --gui-source local`
  did: from `dist/gui` and `dist/backend`, `pnpm install`, then `build:ide` and
  `dist:ide` with the variables electron-builder reads (and without the empty
  code-signing ones), into `dist/ide`. `--sign` signs (release only). Locally:
  build the GUI into `dist/gui`, the bundle with `sbt buildEngineBundle` and
  copy `built-distribution/engine-bundle-*/enso` to `dist/backend` first.
- `stdlib-test <suite>` — what `./run backend test <suite>` did: each selected
  `test/*_Tests` project in turn, `enso --no-ir-caches --run`, with `./run`'s
  arguments and environment (`src/stdlib-test/invocation.ts`), then one
  `::error` naming the failures. It starts the HTTP test helper itself (sbt);
  the caller provides the engine package, the small JDK for the JVM suite, and
  the databases (`ENSO_POSTGRES_*`, `ENSO_SQLSERVER_*`; empty ones are dropped).
  `--dry-run` prints the commands. Do not run it for real on a machine whose
  environment holds real credentials.
- `junit-compare <old> <new>` — compares two JUnit directories project by
  project (pass, fail, skip); the gate for moving the tests off `./run`.

## Layout

- `src/commands/` — one entry point per command: reads the environment and the
  repository, calls the logic, sets the exit code. Nothing worth testing.
- `src/<command>/` — the logic, as functions with vitest tests beside them
  (`*.test.ts`).
- `src/lib/` — shared helpers: the repository root and running programs
  (`repo.ts`), publishing to GitHub Actions (`github.ts`), finding the engine
  package (`engine.ts`), starting sbt (`sbt.ts`, the only module that may).

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
- **Only `src/lib/sbt.ts` runs sbt tasks** (`stdlib-test` is the first command
  that needs one). The workflow policy (`tools/ci/check-workflows.mjs`) fails
  any other module that starts sbt by name, and treats every command whose entry
  point imports that module as an sbt call, which must come after `setup-jvm`.
  The one exception is `toolchain-check`'s `sbt --script-version`, which asks
  the launcher its version and loads no build (Ruling R-plan-10).
- **Checks:** `corepack pnpm --filter build-scripts run typecheck`, `lint` and
  `test:unit`. CI runs them in `.github/workflows/build-scripts.yml`; the GUI
  checks run them too when GUI files change.
