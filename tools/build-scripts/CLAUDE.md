# tools/build-scripts

The build logic that needs more than one tool (build simplification; the spec is
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`). TypeScript
that Node runs as it is (type stripping): each command is
`node src/commands/<name>.ts`, started from anywhere with
`corepack pnpm --filter build-scripts run <name>`.

Several commands and sbt tasks reproduce what the retired Rust build CLI did,
quirks included; their comments say so where it matters. That CLI's sources are
in Git at `59e525041e80cc775eab3167b20718c16a58c911`:
`git ls-tree -r --name-only 59e525041e80cc775eab3167b20718c16a58c911 | grep '\.rs$'`
lists them, and `git show 59e525041e80cc775eab3167b20718c16a58c911:<path>`
prints one.

## Commands

- `version` — the Enso version (`ENSO_VERSION`, `ENSO_EDITION`,
  `ENSO_RELEASE_MODE`), as the retired build CLI computed it before every
  command. In GitHub Actions it writes them to `GITHUB_OUTPUT` and `GITHUB_ENV`;
  locally,
  `eval "$(corepack pnpm --silent --filter build-scripts run version)"`.
- `toolchain-check` — compares the installed GraalVM, sbt launcher, flatc, Node,
  pnpm, Rust and GraalPy with the pins (`build-config.yaml` `toolchain:`,
  `.node-version`, `packageManager`, `rust-toolchain.toml`), with an install
  hint for each that differs. A wrong sbt launcher or a missing GraalPy only
  warns.
- `stdlib-api-check` — what the retired build CLI's `backend stdlib-api-check`
  did: for each standard library with a `docs/api` directory, regenerate the API
  docs with the built engine (`enso --docs api --in-project`) and
  `git diff --no-index` them against the committed ones; the first that differs
  fails, with the retired build CLI's message. CI passes the build job's
  `ENSO_VERSION`; locally the only package in `built-distribution/` is used.
- `ide-build` — what the retired build CLI's
  `ide build --backend-source local --gui-source local` did: from `dist/gui` and
  `dist/backend`, `pnpm install`, then `build:ide` and `dist:ide` with the
  variables electron-builder reads (and without the empty code-signing ones),
  into `dist/ide`. `--sign` signs (release only). Locally, use `ide-local`.
- `ide-local [--mode <vite mode>]` — the whole IDE from this checkout: sbt
  `buildEngineBundle` (`ENSO_LAUNCHER=native` unless set; on Windows, from a
  Visual Studio developer prompt, which it checks), the bundle copied to
  `dist/backend`, `pnpm install`, `build:gui` into `dist/gui`, then
  `ide-build`'s packaging into `dist/ide`. It deletes `dist/backend`, `dist/gui`
  and `dist/ide` when it starts, so it never reuses an old engine bundle and a
  failed run leaves no earlier installer behind; the engine itself builds
  incrementally (`sbt clean` first for a clean one). It starts sbt, so it never
  runs in CI.
- `stdlib-test <suite>` — what the retired build CLI's `backend test <suite>`
  did: each selected `test/*_Tests` project in turn,
  `enso --no-ir-caches --run`, with the retired build CLI's arguments and
  environment (`src/stdlib-test/invocation.ts`), then one `::error` naming the
  failures. It starts the HTTP test helper itself (sbt); the caller provides the
  engine package, the small JDK for the JVM suite, and the databases
  (`ENSO_POSTGRES_*`, `ENSO_SQLSERVER_*`; empty ones are dropped).
  `--only A_Tests,B_Tests` narrows the suite (a name it does not run is a usage
  error); `--dry-run` prints the commands. `ENSO_TEST_GROUP_FILTER` (one project
  only) runs the test groups whose names match; a run in which it ran no test
  fails. Do not run it for real on a machine whose environment holds real
  credentials.
- `stdlib-test-plan` — CI's standard-library test jobs for one platform: which
  projects a pull request's changed files can affect
  (`tools/ci/stdlib-test-map.yaml`), split into the map's shards, as a `matrix`
  output; every project outside a pull request. It must not start sbt (its job
  has no `setup-jvm`).
- `junit-compare <old> <new> [--by-group-prefix]` — compares two JUnit
  directories project by project (pass, fail, skip), or with `--by-group-prefix`
  backend by backend across projects (for groups that moved between projects);
  the gate for moving tests.
- `release <action>` — the release workflow's steps (`release.yml`,
  `promote.yml`), as the retired build CLI's `release …` and the retired build
  CLI's `ide upload` ran them: `create-draft` drafts release `ENSO_VERSION` at
  `GITHUB_SHA` with the top section of `CHANGELOG.md`; `upload-ide` uploads this
  platform's installer, its `.sha256` and the update feeds from `dist/ide` to
  the draft `ENSO_RELEASE_ID`; `publish` publishes it, noting missing
  installers, and checks that the installers download;
  `promote <stable|patch|rc|nightly>` computes the next version from `origin`'s
  tags; `update-latest-version` records a stable version as `latest-release` in
  `build-config.yaml`. They need `GITHUB_TOKEN` and `GITHUB_REPOSITORY` (except
  `promote` and `update-latest-version`). Run only `promote` locally: the others
  change the real repository's releases.

## Layout

- `src/commands/` — one entry point per command: reads the environment and the
  repository, calls the logic, sets the exit code. Nothing worth testing.
- `src/<command>/` — the logic, as functions with vitest tests beside them
  (`*.test.ts`).
- `src/lib/` — shared helpers: the repository root and running programs
  (`repo.ts`), publishing to GitHub Actions (`github.ts`), GitHub's REST API
  (`githubApi.ts`), finding the engine package (`engine.ts`), starting sbt
  (`sbt.ts`, the only module that may).

## Conventions

- **Erasable TypeScript only** (`erasableSyntaxOnly`): no enums, namespaces or
  parameter properties, and relative imports end in `.ts`. Node runs the sources
  directly; there is no build step and no `compile` script.
- **Never resolve paths against `process.cwd()`**: pnpm runs a command in this
  package's directory. Use `REPO_ROOT` (`src/lib/repo.ts`).
- **Keep the behaviour CI relies on.** A command that reproduces the retired
  build CLI keeps its quirks unless a PR names the difference.
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
