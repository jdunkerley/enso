# Build simplification: pnpm + sbt, cargo only for the parser — design

Status: approved 2026-10-20; corrected after Phases 1–2 on 2026-10-21. The
corrections are factual (what the code does); the design's intent is unchanged.

## Goal

Reduce the build system to two entry points, `corepack pnpm` and `sbt`, with
`cargo` used only to build the parser. Replace the Rust-generated GitHub
workflows with hand-written YAML built from GitHub's own mechanisms. Retire the
Rust build tooling (`build_tools/`, `./run`), leaving Rust only for the parser.

## Current state

_A snapshot from 2026-10-20, before Phase 1: for example "there are no composite
actions" and "11 generated files" describe that day, not today._

### Rust

| Area                                                                                                              | Lines (`.rs`) | Role                                               |
| ----------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| Parser: `enso-parser`, macros, visitor, metamodel, reflect, prelude, zst, macro-utils, jni, generate-java, schema | ~27k          | Product: JNI cdylib, WASM, Java/TS codegen         |
| Parser dev tools: `parser/debug`, fuzz, `metamodel/lexpr`                                                         | ~2.9k         | Developers                                         |
| `app/rust-ffi`                                                                                                    | 117           | GUI WASM; all five exports are parser functions    |
| Build tooling: `build_tools/` (ide-ci 14.3k, enso-build 9.3k, cli 1.4k, base, enso-formatter, macros, ci-gen)     | ~27k          | `./run` CLI and the workflow generator             |
| `lib/rust/launcher-shims`                                                                                         | 148           | Dummy launcher binaries for launcher-upgrade tests |

No other Rust ships: Electron, the installer and the project manager are
TypeScript. Every crate under `lib/rust` serves the parser except
`launcher-shims`.

### Parser build — already off `./run`

- sbt project `syntax-rust-definition` runs `cargo build -p enso-parser-jni` and
  `cargo run -p enso-parser-generate-java` itself (`build.sbt` ~674–830,
  `project/Cargo.scala`).
- The pnpm `postinstall` builds the WASM (`app/rust-ffi/build-wasm.mjs`) and the
  TS AST types (`ydoc-shared generate-ast`, which runs `enso-parser-schema`).

### `./run` (enso-build-cli)

`run`, `run.cmd` and `run.ps1` run `cargo run -p enso-build-cli`, or a prebuilt
binary from `ENSO_BUILD_CLI_BIN`. Before any command it checks tool versions
against `build-config.yaml`, computes and publishes the version, and cleans CI
directories. Its commands fall into:

- **Thin wrappers:**
  - `gui build/check` (pnpm)
  - `backend sbt`
  - `java-gen build` (cargo)
  - `fmt` (prettier plus the Rust `enso-formatter`)
- **Not thin, despite first appearances:**
  - `backend ci-build-engine-distribution` runs `clean`, then
    `buildEngineDistribution`, `checkIRCacheSizes`, the Windows MSVC DLL copy
    into the engine package, and versioned `verifyGeneratedPackage`.
  - `ide build` needs the computed version and writes `.sha256`.
  - `libraries lint` (sbt `lintEnso`) needs the build job's version (or a
    rebuild of the engine) and `flatc`, because `lintEnso`'s `if (CI)` does not
    stop sbt evaluating `buildEngineDistributionNoIndex.value`.
  - `backend test jvm` is composite logic: parser self-tests, the ydoc native
    image, benchmark compile and dry run, heap-dump options, `pnpm install` in
    `simple-library-server`, and
    `syntax-rust-definition/Runtime/managedClasspath`.
  - `ENSO_LAUNCHER` is derived by `./run`, not only set in workflows: EnsoJMH
    implies `native,-ls`, native test runs imply `native,test`.
- **Real logic:**
  - Version computation from git tags: dev, nightly, rc, stable
    (`build_tools/build/src/version*.rs`). The result is published as
    `ENSO_VERSION`, `ENSO_EDITION` and `ENSO_RELEASE_MODE` (environment and step
    outputs). The IDE variables are set only on the child processes of
    `ide build` / `gui build`.
  - Toolchain provisioning: sbt, GraalVM, GraalPy and flatc, plus the MSVC dev
    environment on Windows.
  - Engine bundle assembly: engine plus small JDK plus marker file, and the MSVC
    runtime DLLs on Windows.
  - Standard-library tests:
    - Postgres and SQL Server in Docker, httpbin, `simple-library-server`.
    - `ENSO_META_TEST_ARGS`, the JUnit directory and the time factors.
    - `enso --run` over `test/*`.
  - `stdlib-api-check`: `enso --docs api` per library, then a diff.
  - `changelog-check`.
  - `libraries check-syntax`: the Rust parser over `.enso` files.
  - Release:
    - create-draft (handlebars body, notes from `CHANGELOG.md`)
    - publish (asset manifest, missing-platform notes, asset validation)
    - promote (next version from tags)
    - update-latest-version
  - `ide upload` (installers, checksums, update feeds).

### Workflows

- 24 files, 7,165 lines.
- 11 files (~6k lines) are generated by `build_tools/ci-gen`, which serialises a
  Rust workflow model.
  - It emits one job per OS/arch rather than a `matrix:`;
    `engine-checks-nightly` alone is 2,158 lines.
  - It adds a "Build Script" job to every workflow that compiles
    `enso-build-cli`.
  - It has no drift check, despite the generator's documentation.
- 13 files are hand-written and already use `workflow_call` reusable workflows
  and `step-security/changed-files` path gating.
- There are no composite actions.

### Remnants

- `maven_install.json` (a dormant Bazel pin).
- `app/electron-client/macos/stage-bazel-app.sh`.
- Unreferenced `tools/ci/nightly/*.js` and `tools/ci/check-changelog.js`.
- Stale docs: `docs/CONTRIBUTING.md` (nightly Rust, `package-lock.json`) and
  `build_tools/CLAUDE.md` (the removed `install/`).

## Decisions

| Question                                   | Decision                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language for the logic that leaves `./run` | TypeScript in a pnpm workspace package, run with tsx and tested with vitest. Engine-side assembly goes to sbt.                                           |
| Toolchain provisioning                     | Documented prerequisites: one pinned-versions file, a `toolchain-check` script with clear errors, and the standard `setup-*` actions in CI. No new tool. |
| CI generation                              | Hand-written YAML: composite actions, `strategy.matrix`, reusable workflows, `actionlint`. No generator.                                                 |
| Delivery                                   | This spec plus phased PRs; an implementation plan per phase, written when the phase starts.                                                              |

## End state

- **Rust workspace:**
  - The parser crates.
  - `parser/debug` and fuzz.
  - `app/rust-ffi`.
  - `launcher-shims`, unless it is ported to a script (decided in Phase 5).
- **Entry points:**
  - `sbt` for the engine, its distribution, bundles, native images and tests; it
    builds the parser through cargo, as today.
  - `corepack pnpm` for the GUI, the IDE, packaging and `tools/build-scripts`.
  - `cargo` only for the parser, invoked by sbt and the pnpm `postinstall`.
- **Removed:** `build_tools/`, `run`, `run.cmd`, `run.ps1`, and `./run`'s
  provisioning code. `build-config.yaml` survives Phase 5, reduced to the
  `toolchain:` block (added in Phase 2) that `setup-jvm` and `toolchain-check`
  read; it is the checked copy, not a provisioning tool.
- **Workflows:** hand-written, linted with `actionlint` in CI.

## Components

### `tools/build-scripts` (new pnpm package)

TypeScript, run as `corepack pnpm --filter build-scripts run <command>` and
exposed through root scripts. Each command is a small module with vitest tests.

- **`version`:** computes the dev, nightly, rc or stable version.
  - It reads git tags and `ENSO_VERSION` with the same priority and rules as
    `version*.rs`.
  - It publishes the existing contract: `ENSO_VERSION`, `ENSO_EDITION` and
    `ENSO_RELEASE_MODE`. `ENSO_IDE_VERSION` and `ENSO_IDE_COMMIT_HASH` stay on
    the `ide build` / `gui build` child processes only.
  - In CI it emits them to `GITHUB_ENV` and `GITHUB_OUTPUT`; locally it prints
    `export` lines.
  - The consumers stay as they are: `project/Dependencies.scala`,
    `project/BuildInfo.scala`, `electron-client/buildInfo.ts` and
    `electron-builder-config.ts`.
- **`changelog-check`:** a `CHANGELOG.md` change, or the
  `CI: No changelog needed` label.
- **`stdlib-api-check`:** runs `enso --docs api --in-project` per library and
  diffs `docs/api`. Same failure message as today.
- **`stdlib-test`:** runs `enso --run` over the selected `test/*` projects.
  - It handles `ENSO_META_TEST_ARGS`, the JUnit output directory, time factors,
    test selection, and the clean-up of IR caches and bench reports.
  - The caller supplies `ENSO_LAUNCHER`.
  - It installs GraalPy at `graalMavenPackagesVersion` (or `setup-jvm` gains an
    input for it): `test/Examples_Tests` `Python_Examples_Spec` probes for
    `graalpy` on `PATH` and silently skips without it.
  - Services (Postgres, SQL Server, httpbin, library server) are supplied by the
    caller: service containers in CI, `docker compose` locally. The runner only
    reads their connection variables.
- **`release`:**
  - `create-draft`: tag-collision check, release body template, notes from
    `CHANGELOG.md`.
  - `publish`: asset manifest, missing-platform note, asset validation.
  - `promote <designator>`: next version from tags.
  - `update-latest-version`.
  - `upload-ide`: installers, `.sha256`, `.blockmap`, `latest*.yml`.
  - All of these use the `gh` CLI or Octokit.
- **`toolchain-check`:** compares installed GraalVM, sbt, Node, pnpm, Rust and
  flatc against the pinned versions, with install hints.

### Pinned versions

`build-config.yaml`, reduced to versions (its `toolchain:` block), is a
policy-checked copy rather than the single source: sbt keeps `graalVersion`,
`graalMavenPackagesVersion`, `flatbuffersVersion` and `sbt.version`, and a
Workflow Lint rule fails when the copy differs. It feeds:

- `toolchain-check`;
- the CI composite actions (`setup-jvm`).

The copies replaced were those in `formatting.yml` and `enso4igv.yml`.
`tools/ci/docker` no longer exists, and the `native_libs.json` fixtures and
NOTICE are derived from the build, so they are not replaceable copies.

### sbt additions

- **`buildEngineBundle`:** engine plus small JDK (`buildSmallJdkForRelease`)
  plus marker file, plus the MSVC runtime DLLs next to native images on Windows.
  This replaces `engine/bundle.rs`. The caller supplies `ENSO_LAUNCHER`.
- **`checkEnsoSyntax`:** parses `.enso` files through the JNI parser. This
  replaces `libraries check-syntax`.
- `buildEngineDistribution` gains the `checkIRCacheSizes` and
  `verifyGeneratedPackage` steps behind a CI flag, so CI calls one task.

### CI structure

- **Composite actions** in `.github/actions/`:
  - `setup-node`: `.node-version`, corepack, pnpm store cache.
  - `setup-jvm`: GraalVM at the pinned version, the sbt launcher at
    `sbt.version` (`./run` installed launcher 1.5.5; the project version is
    decided by `build.properties` either way), `flatc` (any job that compiles
    the language server needs it, the lint included), and the sbt / Coursier
    cache. GraalPy is provisioned in the `stdlib-test` job or by a new input.
  - `setup-rust`: the toolchain from `rust-toolchain.toml`, plus
    `Swatinem/rust-cache`; parser jobs only.
  - `setup-msvc`: `ilammy/msvc-dev-cmd`, for Windows native-image jobs.
- **Reusable workflows:** engine checks, GUI checks (already), IDE packaging,
  release and promote. Each OS/arch set becomes `strategy.matrix`.
- **Services:** Postgres and SQL Server as job `services:` on Linux.
- **Required checks:**
  - The aggregator jobs keep their exact names ("Engine Required Checks", "GUI
    Required Checks", "IDE Required Checks", "WASM Required Checks"), so branch
    protection keeps working.
  - They use `re-actors/alls-green`.
- **Unchanged:** path gating, the unrelated-label handling, secrets and labels
  (`CI: Clean build required`, `CI: Build IDE`).
- **`actionlint`** runs on changes to `.github/**`.

## Phases

| Phase | Content                                                                                                                                                                                                                             | Gate                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 0     | Tidy-up. Delete `maven_install.json`, `stage-bazel-app.sh`, the unreferenced `tools/ci` JS and the Bazel mentions. Fix `CONTRIBUTING.md` and `build_tools/CLAUDE.md`. Correct CLAUDE.md's Bazel note.                               | Merge on green                                              |
| 1     | Hand-written workflows replace the 11 generated ones. They still call `./run`, built by `setup-rust`. Add composite actions, matrices and actionlint; delete `build_tools/ci-gen` and `enso_build::ci_gen`.                         | Merge on green, after a job-by-job comparison               |
| 2     | Workflows call sbt directly where `./run` was a thin wrapper. No pnpm call site was thin (`gui build/check`, `fmt` and `java-gen build` have no workflow call site), so Phase 2 moved only sbt.                                     | Merge on green                                              |
| 3     | Move the real logic, one PR each: `version`, `changelog-check`, `stdlib-api-check`, `buildEngineBundle`, `checkEnsoSyntax`, `backend test jvm`, `ci-build-engine-distribution`, `ide build`, `stdlib-test` with service containers. | Merge on green; `stdlib-test` after a side-by-side run      |
| 4     | Release, promote, nightly and `ide upload` on `tools/build-scripts`.                                                                                                                                                                | Proven by an rc prerelease. Ask the user before publishing. |
| 5     | Delete `build_tools/`, `run*` and the provisioning code. Decide `launcher-shims`. Update the docs and every CLAUDE.md that mentions `./run`.                                                                                        | Merge on green                                              |

### Phase 3 must carry

From the Phase 2 final review:

1. **GraalPy** for `Python_Examples_Spec`; diff the side-by-side test counts for
   `Examples_Tests` specifically.
2. **`setup-msvc`** for the first Windows native-image job that leaves `./run`,
   plus the MSVC CRT DLL copy into the engine package (not only the bundle).
3. **`ci-build-engine-distribution`** (`clean`, `buildEngineDistribution`,
   `checkIRCacheSizes`, the DLL copy, versioned `verifyGeneratedPackage`), the
   **`backend test jvm`** composite, and **`ide build`** after `version`.
4. **The version hand-off:** the lint reads `steps.build.outputs.ENSO_VERSION`,
   `ENSO_EDITION` and `ENSO_RELEASE_MODE` from the Build Engine Distribution
   job; the replacement step keeps `id: build` and publishes the same three.
5. **Per-command environment `./run` derived:** `ENSO_LAUNCHER` (`native,test`;
   `native,-ls` for EnsoJMH), Windows `CI_TEST_TIMEFACTOR=2` and
   `CI_TEST_FLAKY_ENABLE=true`, `ENSO_TEST_JUNIT_DIR` and its reset, the
   `all`/`;` batching on big-memory runners, and quoted `-D` arguments under
   PowerShell.
6. **The `SBT_CALL` blind spot** in `tools/ci/check-workflows.mjs`: wrapper
   prefixes (`timeout`, `time`, `env`, `nice`, `xvfb-run`, `bash -c`, `sbt.bat`)
   and sbt spawned from `tools/build-scripts`.
7. **Cleanups** (IR cache, `bench-report.xml`, `engine/runtime/target`) if
   self-hosted runners (#258) arrive first.
8. **`toolchain-check`** compares against the same text the awk reader and the
   policy rule use: one parser contract.
9. **`check-syntax` becomes `checkEnsoSyntax`**; then the lint job can drop
   `setup-build-script`.

Phases 1 and 2 may land together where a workflow is rewritten anyway. Each PR
is reversible on its own.

## Verification

- **Phase 1:** a script lists, for the old and new workflows, the job names,
  triggers, `needs`, the commands run and the secrets used. Any difference is
  intended and listed in the PR. Every workflow is exercised once, by a PR or
  `workflow_dispatch`, before its generated predecessor is deleted.
- **`version`:** a table of real tag sets and expected versions for every kind,
  ported from the Rust tests where they exist.
- **`stdlib-test`:** the new runner and `./run backend test standard-library`
  run on the same commit. The test counts and failures must match before the
  switch.
- **`buildEngineBundle`:** a byte-level listing of the bundle tree, compared
  with `./run backend get` output on Linux and Windows.
- **Release:** an rc prerelease end to end (draft, upload, publish, manifest,
  update feed), and the installed rc updates from the previous rc. Same as the
  #252 programme.
- **Throughout:** the standing rules hold. Linux as well as Windows, no
  `git stash`, no `--no-verify`, Prettier on docs before merging.

## Risks

- **Release:** it touches published artifacts. Phase 4 goes last, is proven on
  an rc, and every publish waits for the user's go-ahead.
- **Windows native image:** it needs the MSVC environment, which
  `vs::apply_dev_environment` provides today. `setup-msvc` replaces it in CI;
  locally, documentation names the Developer prompt.
- **Standard-library test wiring:** the environment variables and service set-up
  are subtle. Phase 3 uses the side-by-side comparison.
- **Required-check names:** branch protection keys on them. Phase 1 keeps them
  verbatim.
- **Local developers lose auto-provisioning.** `toolchain-check` and the updated
  docs cover it, along with the WSL toolchain script.
- **Two ways to build during Phases 2–4.** `./run` keeps working until Phase 5,
  and CLAUDE.md says which path is current.

## Out of scope

- Changing the parser or its build. sbt and pnpm already drive cargo directly.
- Replacing sbt or pnpm, or adding a new build orchestrator (Nx, Turborepo,
  Bazel, mise).
- Self-hosted runners (#258) and the macOS release path beyond keeping it
  working.
