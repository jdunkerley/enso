# Build Simplification, Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workflows call sbt directly wherever `./run` was only a thin
wrapper around one sbt command, and give those jobs the toolchain `./run` used
to provision through a new `setup-jvm` composite action that reads its versions
from `build-config.yaml`.

**Architecture:** Three pull requests.

- **2a** adds the `toolchain:` pins to `build-config.yaml`, the `setup-jvm`
  composite action, and two workflow-policy rules: the pins equal the build's
  own copies, and no job runs `sbt` before `setup-jvm`. It moves the two
  workflows that already called sbt by hand (`formatting.yml`, `enso4igv.yml`)
  onto `setup-jvm`, so their hard-coded versions go. It also documents which CI
  steps still go through `./run`.
- **2b** moves the two benchmark workflows from `./run backend benchmark …` to
  sbt.
- **2c** moves the engine checks' Enso lint from `./run libraries lint` to sbt.
  The lint step takes the distribution's version from the build job's outputs.

Every other `./run` call stays until Phase 3 or 4. The analysis in "What `./run`
does around each command" shows why each one stays.

**Tech Stack:** GitHub Actions YAML (composite actions, reusable workflows, job
outputs); `graalvm/setup-graalvm@v1`, `actions/cache@v4`; sbt 1.10.6 launcher;
Node 24 ESM with `yaml` and `node:test` (`tools/ci/check-workflows.mjs`);
actionlint 1.7.12 with shellcheck 0.11.0; `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md`
(design PR #289). Phase 2 is "Workflows call pnpm and sbt directly where `./run`
was a thin wrapper", gated on merge on green. Phase 3 moves the real logic out
of `./run`, and Phase 4 moves release, promote and nightly; both are out of
scope here. Read the spec, and the Phase 0–1 plan
(`docs/superpowers/plans/2026-10-20-build-simplification-phase-0-1.md`) for
house style and for what Phase 1 built. The rulings this plan makes are at the
end.

## Global Constraints

- **Runs unattended.** Never publish anything: no run of `release.yml`,
  `promote.yml` or `nightly.yml`, no tag, no release. The only `gh workflow run`
  calls allowed are those Tasks 4 and 5 name: `engine-benchmark.yml`,
  `std-libs-benchmark.yml`, `engine-checks.yml`.
- **Merge on green, and only on green.** Every PR takes the label
  `CI: No changelog needed`: these are CI changes, invisible to users. Merge
  with `gh pr merge <N> --squash` once every check has passed. Handle a red
  check with "When a check fails" below, never by merging anyway.
- **When a check fails:**
  1. Look up the same job in the develop baseline that Task 0 records in
     `$SCRATCH/baseline.md`.
  2. Re-run the failed jobs once: `gh run rerun <run-id> --failed`.
  3. If it fails again, and develop fails the same job at the same step, the
     failure is not this PR's. Do not merge. Comment the evidence on the PR
     (both run links and the failing step), leave the PR open, and go on.
  4. If develop passes that job, the failure is this PR's. Fix it.
- **Never** `git stash`, `--no-verify`, `--force` pushes, or edits to your own
  permissions or settings files.
- **Use `corepack pnpm`**, never bare `pnpm` or `npm`, locally.
- **Linux as well as Windows:**
  - Run actionlint and the policy tests in WSL as well as on Windows (Task 0 has
    the commands).
  - Prove `setup-jvm` on a Windows runner (Task 3).
  - Compare the Windows engine legs in Task 5.
  - Never run pnpm in WSL against `/mnt/c`.
- **Keep these unchanged**, and check them with the comparison script (Task 0):
  - every job display name, except the "Build Script" jobs that 2b deletes
    (intended difference E4);
  - the aggregator names "Engine Required Checks", "GUI Required Checks", "IDE
    Required Checks" and "WASM Required Checks" (no aggregator file is touched);
  - artifact names;
  - triggers (including `paths-ignore: ["docs/superpowers/**"]`), except the
    path lists that E1 and E2 extend;
  - secrets and variables;
  - `permissions:`, `concurrency:`, `timeout-minutes`, `continue-on-error`;
  - label handling (`CI: Clean build required`, `CI: Build IDE`).

  The PR lists every difference the comparison reports, with its reason. Each
  one must appear in "Reference: intended differences".

- **Out of scope** (do not edit):
  - `release.yml`, `promote.yml`, `nightly.yml` — Phase 4;
  - `engine-checks-nightly.yml`, `extra-nightly-tests.yml`, `macos-checks.yml` —
    Phase 4, Ruling 14;
  - `bench-upload.yml`;
  - `build_tools/` code.
- **Actions are pinned by major tag**, as everywhere here. This plan adds no new
  third-party action: `graalvm/setup-graalvm@v1` is already in `formatting.yml`
  and `enso4igv.yml`, and `actions/cache@v4` is already in `ide-packaging.yml`.
- **Docs are formatted with Prettier**: run
  `corepack pnpm exec prettier --write <file>` on every Markdown, YAML or JSON
  file you touch. `tools/` is in `.prettierignore`; the scripts below are
  already formatted with the repository's options, so copy them exactly.
- **Commits** end with the executing session's attribution trailers. **PR
  bodies** end with its attribution lines.
- **Watching CI:**
  - Use `gh` with `--jq` only (there is no `jq` binary).
  - Put a time cap on every wait.
  - Run waits with `run_in_background`, never in the foreground, and work on the
    next task meanwhile (memory: work while CI runs).
  - The watcher is `$SCRATCH/wait-pr.sh` (Task 0, Step 3).

`$SCRATCH` is the executing session's scratchpad directory.

---

## Branches, worktrees and PRs

All worktrees are created from `origin/develop` under `C:\Repos\Enso\`, with
`git -C /c/Repos/Enso/ide worktree add <dir> -b <branch> origin/develop`.

| PR  | Branch                      | Worktree    | Tasks | Validated by                                                                                                                        |
| --- | --------------------------- | ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 2a  | `ci/setup-jvm`              | `ide-bs-2a` | 0–3   | its own CI (Formatting, enso4igv, Workflow Lint, ✨ Engine, ✨ IDE) and a temporary Linux + Windows smoke workflow                  |
| 2b  | `ci/benchmarks-direct-sbt`  | `ide-bs-2b` | 4     | `gh workflow run` of both benchmarks with `just-check`, on the branch and on develop, compared                                      |
| 2c  | `ci/engine-lint-direct-sbt` | `ide-bs-2c` | 5     | its own ✨ Engine run, a `workflow_dispatch` with a clean build, and the engine distribution compared file by file (Linux, Windows) |

- PR #303 (removing `build_tools/ci-gen` and `compare-workflows.mjs`) merges
  before 2a starts. Task 0 checks this.
- 2b and 2c start from `develop` after 2a has merged. They change different
  workflow files, so both can be open at once. Each changes its own row of the
  `./run` table in `.github/CLAUDE.md`. Whichever merges second rebases on
  `develop` first; that is a one-line conflict at most.

The design branch `design/build-simplification` (worktree
`C:\Repos\Enso\ide-build`, draft PR #289) carries only the spec and the plans.

## What `./run` does around each command

`./run` is not just a wrapper. Two layers of work surround every subcommand. The
code is `build_tools/cli/src/lib.rs` (`main_internal`, `Processor::new`) and
`build_tools/build/src/engine/context.rs` (`prepare_build_env`, `build`).

### Before any subcommand

| #   | Step                                                                                                                                                                                                                               | In CI today                                                                                                                                                                                                                                                                     | Who replaces it in a direct call                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| G1  | Tool version check against `required-versions` in `build-config.yaml`, plus Node from `.node-version`                                                                                                                              | Skipped. Every workflow sets `ENSO_BUILD_SKIP_VERSION_CHECK: "true"`, and `required-versions` is empty apart from the injected Node entry.                                                                                                                                      | Nothing. `setup-jvm` checks the versions it installs (its "Check the toolchain" step).                        |
| G2  | Deletes `enso/` and `ci-build/` at the repository root (a "TRANSITION" from upstream's two-checkout layout)                                                                                                                        | No-op: neither directory exists in a checkout.                                                                                                                                                                                                                                  | Nothing.                                                                                                      |
| G3  | GitHub client (`octocrab`) from `GITHUB_TOKEN`                                                                                                                                                                                     | Used by commands that read releases or upload. None of the moved commands does.                                                                                                                                                                                                 | Nothing.                                                                                                      |
| G4  | **Version.** `ENSO_VERSION` if set; otherwise `<next stable after latest-release>-dev`. Published as process env `ENSO_VERSION`, `ENSO_EDITION`, `ENSO_RELEASE_MODE` and as **step outputs** of the same names (not `GITHUB_ENV`). | Every `./run` step computes it. sbt reads it (`project/Dependencies.scala` `ensoVersion`, `currentEdition`; `project/BuildInfo.scala` release mode). The engine distribution's directory is named by it: `built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`. | sbt's own default, `0.0.0-dev`, where the version stays inside the job (2b), or the build job's outputs (2c). |
| G5  | Download cache under `~/.local/share/.enso-ci/cache`                                                                                                                                                                               | Rebuilt on every hosted run.                                                                                                                                                                                                                                                    | `setup-jvm`'s sbt dependency cache, keyed per job.                                                            |

`ENSO_IDE_VERSION` and `ENSO_IDE_COMMIT_HASH` are **not** published globally.
`./run ide build` and `./run gui build` set them only on their own pnpm child
processes (`build_tools/build/src/ide/web.rs`, `project/gui.rs`). The PR GUI
build already derives its own (`ide-packaging.yml`, "Derive GUI version").

### Around an engine command (`RunContext::prepare_build_env`, then `build`)

| #   | Step                                                                                                                                          | Needed by a direct sbt call?                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Windows: applies the MSVC dev environment when `cl` is not on the PATH                                                                        | Only for native images on Windows. No moved command runs on Windows, so `setup-msvc` waits for Phase 3 (Ruling 5).                                                                                                                                            |
| E2  | sbt launcher 1.5.5 into the cache, unless `sbt` is already on the PATH; sets `SBT_HOME`                                                       | Yes: `ubuntu-latest` has no sbt (the develop logs show `./run` downloading it). `setup-jvm` installs the launcher at the project's sbt version and sets `SBT_HOME` (Ruling 7).                                                                                |
| E3  | Requires git, cargo, node and pnpm on the PATH                                                                                                | The hosted images have git, cargo (rustup reads `rust-toolchain.toml`) and Node. Corepack comes from `setup-node`, which the benchmark jobs now call themselves; the build runs `corepack pnpm` for the ydoc bundle (`project/Ydoc.scala`).                   |
| E4  | JVM tests only: `pnpm install` in `tools/simple-library-server`                                                                               | Not by a moved command.                                                                                                                                                                                                                                       |
| E5  | `flatc` at `flatbuffersVersion` from `project/Dependencies.scala`                                                                             | Yes for anything that compiles the language server: both benchmarks (`std-benchmarks/bench` depends on `buildEngineDistribution`). Not for `lintEnso` on CI, which compiles nothing. `setup-jvm` installs it with `flatc: "true"`.                            |
| E6  | `ENSO_TEST_JUNIT_DIR` → `GITHUB_ENV` (the test reporters read it)                                                                             | Only by test jobs, which stay on `./run`.                                                                                                                                                                                                                     |
| E7  | Windows: `CI_TEST_TIMEFACTOR=2`, `CI_TEST_FLAKY_ENABLE=true`                                                                                  | Only by tests on Windows; they stay.                                                                                                                                                                                                                          |
| E8  | GraalVM CE at `graalVersion` (sets `JAVA_HOME`, `GRAALVM_HOME`, `PATH`); GraalPy standalone at `graalMavenPackagesVersion`                    | GraalVM yes: the build refuses any other JDK (`project/GraalVM.scala`). GraalPy no: nothing in sbt calls the `graalpy` executable (`git grep -n graalpy -- build.sbt project/` finds only resource paths). Only the stdlib tests, which stay, may (Ruling 6). |
| E9  | JVM tests only: `sbt syntax-rust-definition/Runtime/managedClasspath`                                                                         | Not by a moved command.                                                                                                                                                                                                                                       |
| E10 | Native runner builds: `ENSO_LAUNCHER=test-native` (or `native-without-ls` for benchmarks)                                                     | Not by a moved command: neither benchmark nor lint builds the native runner.                                                                                                                                                                                  |
| E11 | CI only: deletes the global IR cache directory and every `**/bench-report.xml`                                                                | No-op on a fresh hosted runner whose working tree `git-clean` has cleaned. Revisit for self-hosted runners (#258, Ruling 16).                                                                                                                                 |
| E12 | Deletes `engine/runtime/target` (an incremental-compilation workaround), and `built-distribution/` when building the engine package           | No-op on a fresh checkout.                                                                                                                                                                                                                                    |
| E13 | The sbt call itself: `LC_ALL=C.UTF-8 SBT_SERVER_FORCESTART=true sbt -Dbench.compileOnly=<once> -Dsbt.server.autostart=false "<tasks>"`        | Copied exactly. The develop logs print the command line (for example run 39544143953).                                                                                                                                                                        |
| E14 | After `buildEngineDistribution`: `checkIRCacheSizes`; Windows: copies the MSVC runtime DLLs next to every `.exe`/`.dll` in the engine package | Real logic. It stays with `ci-build-engine-distribution` until Phase 3.                                                                                                                                                                                       |
| E15 | Then, as the flags say: JVM tests, standard-library tests, API check, benchmarks, `verifyGeneratedPackage` (not on Windows), bundles          | Per command, below.                                                                                                                                                                                                                                           |

### Each `./run` call site in the in-scope workflows

"Version?" asks whether a direct call would need the version `./run` computes,
or whether sbt's default `0.0.0-dev` would do.

| Workflow › job                                            | `./run` command                        | What `./run` adds beyond one tool call                                                                                                                                                                                                                                                              | Version?                                                                                                                                    | Phase 2 decision                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `engine-benchmark.yml` › Benchmark Engine                 | `backend benchmark runtime`            | E2, E3, E5, E8 (GraalVM), E13 with `runtime-benchmarks/bench` or `runtime-benchmarks/benchOnly <name>`. It only warns when no report exists.                                                                                                                                                        | No. The distribution never leaves the job, and the report does not record the version.                                                      | **Moves (2b).**                                                                                                                                                    |
| `std-libs-benchmark.yml` › Benchmark Std Libs             | `backend benchmark enso-jmh`           | As above, with `std-benchmarks/bench` or `std-benchmarks/benchOnly <name>`. The bench processor finds the distribution by the glob `built-distribution*`.                                                                                                                                           | No, for the same reasons.                                                                                                                   | **Moves (2b).**                                                                                                                                                    |
| `engine-checks-platform.yml` › Enso Code Lint             | `libraries lint`                       | E2, E8, E13 with `lintEnso`. `lintEnso` runs the downloaded distribution from `engineDistributionRoot`.                                                                                                                                                                                             | **Yes.** `engineDistributionRoot` is named by `ensoVersion`. The download is named by `./run`'s version, so `0.0.0-dev` would find nothing. | **Moves (2c)**, with `ENSO_VERSION`/`ENSO_EDITION`/`ENSO_RELEASE_MODE` taken from the build job's outputs (G4). Nothing reimplements the version logic (Ruling 2). |
| same job                                                  | `libraries check-syntax`               | The Rust parser over `.enso` files: real logic.                                                                                                                                                                                                                                                     | —                                                                                                                                           | Stays: Phase 3 `checkEnsoSyntax`.                                                                                                                                  |
| `engine-checks-platform.yml` › Build Engine Distribution  | `backend ci-build-engine-distribution` | `clean; buildEngineDistribution`, then `checkIRCacheSizes`, then E14 (MSVC DLLs into the engine package on Windows), then `verifyGeneratedPackage` for the engine and for Base, Table, Image and Database at the versioned path (not on Windows).                                                   | **Yes.** The downstream `./run` jobs (tests, API check, check-syntax) find the distribution by the version they compute.                    | Stays: Phase 3 (`version`; the CI flag on `buildEngineDistribution`; the DLL copy, Ruling 12).                                                                     |
| `engine-checks-platform.yml` › JVM Tests                  | `backend test jvm`                     | `sbt test` with `parallelExecution := false`, the parser's Java self-tests, the ydoc native image (Linux), benchmark compilation plus a compile-only runtime benchmark run and an Enso benchmark dry run through the built distribution (Linux), E4, E6, E7, E9, and heap-dump `JAVA_TOOL_OPTIONS`. | Yes: the Enso benchmark dry run uses the versioned distribution path.                                                                       | Stays. It is composite logic, and the spec's Phase 3 list does not name it yet (Ruling 12).                                                                        |
| `engine-checks-platform.yml` › Standard Library API check | `backend stdlib-api-check`             | `enso --docs api` per library, then a directory diff: real logic.                                                                                                                                                                                                                                   | Yes.                                                                                                                                        | Stays: Phase 3 `stdlib-api-check`.                                                                                                                                 |
| `engine-checks-platform.yml` › Standard Library … Tests   | `backend test <suite>`                 | Test selection, small JDK, Docker services, JUnit directory, time factors: real logic.                                                                                                                                                                                                              | Yes.                                                                                                                                        | Stays: Phase 3 `stdlib-test`.                                                                                                                                      |
| `changelog.yml` › Changelog                               | `changelog-check`                      | Real logic.                                                                                                                                                                                                                                                                                         | —                                                                                                                                           | Stays: Phase 3 `changelog-check`.                                                                                                                                  |
| `ide-packaging.yml` › Build Backend                       | `backend get`                          | The engine bundle: engine, small JDK, marker file, and the MSVC DLLs on Windows. Mirrored into `dist/backend`.                                                                                                                                                                                      | Yes: the bundle's directories and the bundled engine version.                                                                               | Stays: Phase 3 `buildEngineBundle` + `version`.                                                                                                                    |
| `ide-packaging.yml` › Package New IDE                     | `ide build --backend-source local …`   | `pnpm install`; `build:ide` then `dist:ide -- --linux/--win` with `ENSO_IDE_VERSION`, `ENSO_IDE_COMMIT_HASH`, `ENSO_IDE_UPDATES` (`manual` for dev), `ENSO_BUILD_GUI/IDE/SIGN/BACKEND` and the bundled engine version; empty `CSC_*` variables removed; a `.sha256` written.                        | **Yes**: the electron-builder version, the installer's file name, and the update mode.                                                      | Stays until Phase 3's `version` lands (Ruling 12).                                                                                                                 |
| `formatting.yml` › Test Formatting                        | none: it already calls `sbt`           | Hard-codes GraalVM and sbt versions (CLAUDE.md lists them as duplicates).                                                                                                                                                                                                                           | —                                                                                                                                           | **Moves onto `setup-jvm` (2a)**, Ruling 9.                                                                                                                         |
| `enso4igv.yml` › build_java                               | none: it already calls `sbt publishM2` | Hard-codes the GraalVM version; uses the image's sbt.                                                                                                                                                                                                                                               | —                                                                                                                                           | **Moves onto `setup-jvm` (2a)**, Ruling 9.                                                                                                                         |

Call sites in `release.yml`, `promote.yml`, `nightly.yml`,
`engine-checks-nightly.yml`, `extra-nightly-tests.yml` and `macos-checks.yml`
are out of scope (Ruling 14). The spec's other "thin wrappers" (`gui build`,
`gui check`, `java-gen build`, `fmt`) have no call site in any workflow.

### The version question, answered

- **PR and CI checks may run at `0.0.0-dev`** only where the version stays
  inside the job: the benchmarks. sbt names the distribution it builds and uses
  in that job consistently, `bench-processor` globs `built-distribution*`, and
  local developer builds run at `0.0.0-dev` every day.
- **Lint must use the build job's version**, because it runs a distribution that
  another job built and named. It takes the version from that job's outputs,
  which `./run` already writes (G4). No version logic moves early.
- **Everything else that touches the version stays on `./run`:**
  - the engine distribution build, whose name the downstream `./run` jobs
    compute themselves, and whose `verifyGeneratedPackage` paths are versioned;
  - `backend get` (bundle naming);
  - `ide build` (the electron-builder version, the artifact file name, the
    update mode);
  - the tests and the API check.

  IR caches live inside the distribution's versioned library directories, so
  they follow the same rule and need no separate handling.

## File map

| Path                                                               | PR  | Change                                                                                                       |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------ |
| `build-config.yaml`                                                | 2a  | Add the `toolchain:` pins (graalvm, sbt, flatc)                                                              |
| `tools/ci/check-workflows.mjs` + `.test.mjs`                       | 2a  | `ROOT_FILES` in `loadRepo`; rules `checkToolchainPins`, `checkSbtRunsAfterSetupJvm`; their fixtures          |
| `.github/actions/setup-jvm/action.yml`                             | 2a  | Create                                                                                                       |
| `.github/workflows/formatting.yml`, `enso4igv.yml`                 | 2a  | Use `setup-jvm`; drop the hard-coded versions (`enso4igv.yml` also lists the action and the pins in `paths`) |
| `.github/workflows/workflow-lint.yml`                              | 2a  | Also run on `build-config.yaml`, `project/Dependencies.scala`, `project/build.properties`                    |
| `.github/workflows/engine-changed-files.yml`                       | 2a  | List `build-config.yaml`                                                                                     |
| `.github/workflows/setup-jvm-smoke.yml`                            | 2a  | Create, prove, then **delete before merging** (never reaches `develop`)                                      |
| `.github/CLAUDE.md`, `CLAUDE.md`, `build_tools/CLAUDE.md`          | 2a  | `setup-jvm`; the "What still goes through `./run`" table; the pins; correct "until Phase 2"                  |
| `.github/workflows/engine-benchmark.yml`, `std-libs-benchmark.yml` | 2b  | Direct sbt; no Build Script job                                                                              |
| `.github/CLAUDE.md`                                                | 2b  | Flip the two benchmark rows                                                                                  |
| `.github/workflows/engine-checks-platform.yml`                     | 2c  | Build job outputs the version; lint runs sbt                                                                 |
| `.github/CLAUDE.md`                                                | 2c  | Flip the lint row                                                                                            |

## Reference: intended differences

The comparison script (Task 0, Step 4) prints these differences for a correct
change. A PR lists each one it shows, with the reason given here. Anything not
listed is a mistake.

| #   | PR  | Difference                                                                                                                                                                                                                                                                                                                                        | Reason                                                                                                                                                                                          |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | 2a  | `formatting.yml`: the workflow `env` (`javaVersion`, `sbtVersion`) is gone. "Setup GraalVM Environment" and "Set Up SBT" become `setup-jvm`'s steps: read pins, the same `graalvm/setup-graalvm@v1` with the same version, the sbt 1.10.6 tarball unpacked under `RUNNER_TEMP`, the toolchain check, and a cache restore.                         | One source for the versions (spec, "Pinned versions"). The tarball moves out of the working tree. `github-token` is `github.token` rather than `secrets.GITHUB_TOKEN`; they are the same token. |
| E2  | 2a  | `enso4igv.yml`: `graalvm/setup-graalvm` (hard-coded `25.0.1`) becomes `setup-jvm`; sbt is the 1.10.6 launcher instead of the image's own; `paths` gains `.github/actions/setup-jvm/**` and `build-config.yaml`.                                                                                                                                   | As E1. The new paths make a change to its toolchain run the workflow that uses it.                                                                                                              |
| E3  | 2a  | `workflow-lint.yml` runs on three more paths; `engine-changed-files.yml` lists `build-config.yaml`.                                                                                                                                                                                                                                               | The pin rule reads those files. `build-config.yaml` now feeds `setup-jvm` in the engine checks (2c).                                                                                            |
| E4  | 2b  | Both benchmarks: the "Build Script (linux, amd64)" job and the benchmark job's `needs` on it are gone. So are the env vars `ENSO_BUILD_BENCH_NAME`, `ENSO_BUILD_MINIMAL_RUN`, `ENSO_BUILD_SKIP_VERSION_CHECK` and `GRAAL_EDITION`. `setup-build-script` becomes `setup-node` + `setup-jvm`, and `./run backend benchmark …` becomes the sbt step. | Only `./run` read those variables or needed that job. The inputs now reach the sbt step as `BENCH_NAME` and `JUST_CHECK`. No other workflow, ruleset or protection reads the Build Script job.  |
| E5  | 2c  | `engine-checks-platform.yml`: the Build Engine Distribution job gains `outputs` (`ENSO_VERSION`, `ENSO_EDITION`, `ENSO_RELEASE_MODE`) and its `./run` step gains `id: build`. Both platforms show it.                                                                                                                                             | The lint job reads the version `./run` gave the distribution (Note [Lint Reads The Distribution's Version]).                                                                                    |
| E6  | 2c  | Enso Code Lint: `./run libraries lint` becomes `setup-jvm`, "Check the distribution's version", and "Lint" (`sbt … lintEnso` with the version env).                                                                                                                                                                                               | The move itself.                                                                                                                                                                                |

`setup-jvm-smoke.yml` exists only on 2a's branch and never reaches `develop`, so
no comparison against `develop` shows it.

---

### Task 0: Preconditions, tools and the develop baseline

**Files:** none in the repository. Creates `$SCRATCH/wait-pr.sh`,
`$SCRATCH/job-times.sh`, `$SCRATCH/bench-names.sh`, `$SCRATCH/compare.sh` and
`$SCRATCH/baseline.md`.

**Interfaces:**

- Produces:
  - `wait-pr.sh <pr> [max-minutes]` — exits 0 when all checks passed, 1 when
    some failed, 2 on timeout;
  - `job-times.sh <run-id>` — prints `conclusion<TAB>minutes<TAB>job name` per
    job;
  - `bench-names.sh <run-id>` — prints the sorted benchmark names a run
    executed;
  - `compare.sh <worktree> <workflow file>…` — the job-by-job comparison against
    `origin/develop`, as Markdown;
  - `baseline.md` — develop's run IDs and job times.

- [ ] **Step 1: Check that #303 has merged, and create 2a's worktree**

```bash
gh pr view 303 --json state --jq .state
```

Expected: `MERGED`. If it is still `OPEN`, wait for it with the watcher from
Step 3 (`$SCRATCH/wait-pr.sh 303 240`, in the background), then merge it if it
is green and nobody has asked to hold it; otherwise stop and report. Then:

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-2a -b ci/setup-jvm origin/develop
cd /c/Repos/Enso/ide-bs-2a && corepack pnpm install --frozen-lockfile --ignore-scripts
test ! -e tools/ci/compare-workflows.mjs && test ! -d build_tools/ci-gen && echo "303 is in"
```

Expected: `303 is in`.

- [ ] **Step 2: Check the tools**

```bash
wsl -e bash -lc 'ls ~/tools/actionlint-1.7.12/actionlint ~/tools/shellcheck-v0.11.0/shellcheck && . ~/.enso-toolchain.sh && node --version'
cd /c/Repos/Enso/ide-bs-2a && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
```

Expected: both binaries are listed, a Node version prints,
`Workflow policy: OK`, and `ℹ fail 0`. If the actionlint or shellcheck binary is
missing, install it as Phase 0–1's Task 0 did. Download
`actionlint_1.7.12_linux_amd64.tar.gz` and
`shellcheck-v0.11.0.linux.x86_64.tar.xz` from their GitHub releases into
`~/tools` in WSL.

- [ ] **Step 3: Save the helper scripts**

`$SCRATCH/wait-pr.sh`:

```bash
#!/usr/bin/env bash
# Usage: wait-pr.sh <pr-number> [max-minutes]
# Waits until no check on the PR is pending (or the time cap), then prints every
# check that did not pass. Exit 0 = all passed, 1 = some failed, 2 = timed out.
pr=$1
deadline=$(( $(date +%s) + ${2:-240} * 60 ))
while :; do
  pending=$(gh pr checks "$pr" --json bucket --jq '[.[] | select(.bucket == "pending")] | length' 2>/dev/null || echo 1)
  [ "$pending" = "0" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "timed out"; exit 2; }
  sleep 120
done
gh pr checks "$pr" --json name,bucket,link \
  --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.bucket)\t\(.name)\t\(.link)"' | tee /dev/stderr | grep -q . && exit 1
exit 0
```

`$SCRATCH/job-times.sh`:

```bash
#!/usr/bin/env bash
# Usage: job-times.sh <run-id>
# One line per job: conclusion, wall-clock minutes, display name.
gh run view "$1" --json jobs \
  --jq '.jobs[] | "\(.conclusion)\t\((((.completedAt | fromdateiso8601) - (.startedAt | fromdateiso8601)) / 60) | floor)m\t\(.name)"'
```

`$SCRATCH/bench-names.sh`:

```bash
#!/usr/bin/env bash
# Usage: bench-names.sh <run-id>
# The benchmarks a run executed, sorted: the runtime benchmarks' result table
# (`o.e.interpreter.bench…`) and the generated Standard Library benchmarks
# (`org.enso.benchmarks.generated…`). Colour codes are stripped first.
gh run view "$1" --log 2>/dev/null \
  | sed 's/\\x1b\[[0-9;]*m//g; s/\x1b\[[0-9;]*m//g' \
  | grep -oE '(o\.e\.interpreter\.bench|org\.enso\.benchmarks\.generated)\.[A-Za-z0-9_.$]+' \
  | sort -u
```

`$SCRATCH/compare.sh` restores the comparison script that #303 deleted, runs it
from the worktree, and deletes it again. It is never committed (Ruling 11):

```bash
#!/usr/bin/env bash
# Usage: compare.sh <worktree> <workflow file>...
# Job-by-job comparison of the worktree's workflows against origin/develop.
set -euo pipefail
cd "$1"; shift
script=tools/ci/compare-workflows.mjs
gone=$(git log origin/develop --diff-filter=D -1 --format=%H -- "$script")
git show "$gone^:$script" > "$script"
trap 'rm -f "$script"' EXIT
node "$script" --base origin/develop "$@"
```

Make them executable with `chmod +x "$SCRATCH"/*.sh`, and check `compare.sh`:

```bash
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-2a .github/workflows/formatting.yml
git -C /c/Repos/Enso/ide-bs-2a status --short
```

Expected: a Markdown report with no differences under "Test Formatting", and an
empty `git status` (the script removed its copy).

- [ ] **Step 4: Record the develop baseline**

```bash
for wf in engine-pull-request.yml ide-pull-request.yml formatting.yml enso4igv.yml workflow-lint.yml engine-benchmark.yml std-libs-benchmark.yml; do
  id=$(gh run list --workflow "$wf" --branch develop -L 1 --json databaseId --jq '.[0].databaseId')
  echo "## $wf — run $id"; "$SCRATCH/job-times.sh" "$id"; echo
done > "$SCRATCH/baseline.md"
"$SCRATCH/bench-names.sh" "$(gh run list --workflow engine-benchmark.yml --branch develop -L 1 --json databaseId --jq '.[0].databaseId')" > "$SCRATCH/bench-runtime-develop.txt"
"$SCRATCH/bench-names.sh" "$(gh run list --workflow std-libs-benchmark.yml --branch develop -L 1 --json databaseId --jq '.[0].databaseId')" > "$SCRATCH/bench-stdlib-develop.txt"
wc -l "$SCRATCH"/bench-*-develop.txt
```

Expected, from the runs of 2026-10-21:

- Benchmark Engine: `success`, about 20 minutes; 98 runtime benchmark names.
- Benchmark Standard Libraries: **`failure`**, about 34 minutes. The just-check
  run dies with `java.lang.OutOfMemoryError: Java heap space` in
  `std-benchmarks / Compile / run`, after 19 generated benchmark names, the last
  being `org.enso.benchmarks.generated.Column_Arithmetic_1000000.Plus_Fitting`.
  This failure is already on develop; Task 4 compares against it (Ruling 13).
- If a benchmark baseline is older than a week, or failed for a different
  reason, dispatch a fresh one with
  `gh workflow run <file> --ref develop -f just-check=true`.

Nothing is committed in this task.

---

### Task 1: The toolchain pins and their policy rule (PR 2a)

**Files:**

- Modify: `build-config.yaml` (append the `toolchain:` block)
- Modify: `tools/ci/check-workflows.mjs` (`loadRepo`, new `checkToolchainPins`,
  `CHECKS`)
- Test: `tools/ci/check-workflows.test.mjs` (`fixture` gains root files; new
  `describe('checkToolchainPins')`)

**Interfaces:**

- Produces:
  - `ROOT_FILES: string[]`, and `loadRepo(root)` returns
    `{ workflows, actions, files }`, where `files[path]` is the text or `null`;
  - `checkToolchainPins({ files }): string[]`;
  - test helper `fixture(files, rootFiles = {})`;
  - `build-config.yaml` keys `toolchain.graalvm`, `toolchain.sbt` and
    `toolchain.flatc`, one flat `key: value` line each, which Task 2's
    `setup-jvm` reads with awk.

- [ ] **Step 1: Write the failing tests**

In `tools/ci/check-workflows.test.mjs`, add `checkToolchainPins` to the import
list (alphabetical, before `checkWindowsInstallerSmokeTest`). Replace the
`fixture` helper's doc comment, signature and `return` with:

<!-- prettier-ignore -->
```js
/**
 * A repository holding only the given `.github` files (paths relative to `.github`), and the given
 * files outside it (paths relative to the repository root).
 */
function fixture(files, rootFiles = {}) {
  const root = path.join(scratch, `repo-${fixtureCount++}`)
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, '.github', file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  for (const [file, text] of Object.entries(rootFiles)) {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return loadRepo(root)
}
```

Insert before `test('the repository follows the policy', …)`:

<!-- prettier-ignore -->
```js
describe('checkToolchainPins', () => {
  const build = {
    'project/Dependencies.scala':
      'object Dependencies {\n  val graalVersion = "25.0.1"\n  val flatbuffersVersion      = "24.3.25"\n}\n',
    'project/build.properties': '# HELD at 1.10.6.\r\nsbt.version=1.10.6\r\n',
  }
  const config = (pins) => `latest-release: 2025.3.4\ntoolchain:\n${pins}`
  const allPins = '  graalvm: 25.0.1\n  sbt: 1.10.6 # held\n  flatc: 24.3.25\n'
  test("accepts pins equal to the build's own copies", () => {
    const repo = fixture({}, { 'build-config.yaml': config(allPins), ...build })
    assert.deepEqual(checkToolchainPins(repo), [])
  })
  test('rejects a pin that drifted, and a missing pin', () => {
    const pins = '  graalvm: 25.0.2\n  sbt: 1.10.6\n'
    const problems = checkToolchainPins(fixture({}, { 'build-config.yaml': config(pins), ...build }))
    assert.deepEqual(problems.sort(), [
      'build-config.yaml: `toolchain.graalvm` is 25.0.2, but project/Dependencies.scala has 25.0.1',
      'build-config.yaml: no `toolchain.flatc` pin',
    ])
  })
  test('rejects a build file without the version, and a missing build-config.yaml', () => {
    const repo = fixture(
      {},
      {
        'build-config.yaml': config(allPins),
        'project/Dependencies.scala': build['project/Dependencies.scala'],
      },
    )
    assert.deepEqual(checkToolchainPins(repo), ['project/build.properties: no sbt version found'])
    assert.deepEqual(checkToolchainPins(fixture({})), ['build-config.yaml: missing'])
  })
})

```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`node --test tools/ci/check-workflows.test.mjs 2>&1 | grep -E "ℹ (pass|fail)|SyntaxError"`

Expected: FAIL. The import of `checkToolchainPins` does not resolve
(`SyntaxError: The requested module './check-workflows.mjs' does not provide an export named 'checkToolchainPins'`).

- [ ] **Step 3: Implement the rule**

In `tools/ci/check-workflows.mjs`, replace the comment line above `loadRepo`
(`/** Loads every workflow and every local composite action under `root/.github`. */`)
with:

<!-- prettier-ignore -->
```js
/** Files outside `.github` that a rule reads: the toolchain pins, and the build's own copies. */
export const ROOT_FILES = [
  'build-config.yaml',
  'project/Dependencies.scala',
  'project/build.properties',
]

/**
 * Loads every workflow and every local composite action under `root/.github`, and the
 * `ROOT_FILES` (`null` when absent).
 */
```

Replace the end of `loadRepo` (`  return { workflows, actions }\n}`) with:

<!-- prettier-ignore -->
```js
  const files = {}
  for (const file of ROOT_FILES) {
    const target = path.join(root, file)
    files[file] = existsSync(target) ? readFileSync(target, 'utf8') : null
  }
  return { workflows, actions, files }
}
```

Insert before `export const CHECKS = [`:

<!-- prettier-ignore -->
```js
/** Where the build keeps its own copy of each `toolchain:` pin in `build-config.yaml`. */
const TOOLCHAIN_PINS = [
  {
    pin: 'graalvm',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val graalVersion\s*=\s*"([^"]+)"/m,
  },
  {
    pin: 'flatc',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val flatbuffersVersion\s*=\s*"([^"]+)"/m,
  },
  { pin: 'sbt', file: 'project/build.properties', pattern: /^sbt\.version\s*=\s*(\S+)/m },
]

/**
 * `.github/actions/setup-jvm` installs the versions pinned under `toolchain:` in
 * `build-config.yaml`. sbt enforces its own copies (`Running on GraalVM version X. Expected GraalVM
 * version Y.`, the `flatc` version check, `sbt.version`), so each pin must equal the build's.
 */
export function checkToolchainPins({ files }) {
  const config = files?.['build-config.yaml']
  if (config == null) return ['build-config.yaml: missing']
  const toolchain = parse(config)?.toolchain ?? {}
  const problems = []
  for (const { pin, file, pattern } of TOOLCHAIN_PINS) {
    const pinned = toolchain[pin]
    if (pinned == null) {
      problems.push(`build-config.yaml: no \`toolchain.${pin}\` pin`)
      continue
    }
    const found = files[file]?.match(pattern)?.[1]
    if (found == null) {
      problems.push(`${file}: no ${pin} version found`)
    } else if (String(pinned) !== found) {
      problems.push(
        `build-config.yaml: \`toolchain.${pin}\` is ${pinned}, but ${file} has ${found}`,
      )
    }
  }
  return problems
}

```

Add `checkToolchainPins,` as the last entry of `CHECKS`.

- [ ] **Step 4: Run the tests: the new ones pass, the repository check fails**

Run:
`node --test tools/ci/check-workflows.test.mjs 2>&1 | grep -E "ℹ (pass|fail)|no .toolchain"`

Expected: `ℹ fail 1`. Only "the repository follows the policy" fails, with the
three messages `build-config.yaml: no `toolchain.graalvm` pin`, `… flatc …` and
`… sbt …`.

- [ ] **Step 5: Add the pins**

Append to `build-config.yaml`:

<!-- prettier-ignore -->
```yaml

# The JVM toolchain that CI's `.github/actions/setup-jvm` installs. The build keeps its own copies,
# and `tools/ci/check-workflows.mjs` fails if these drift from them:
# - graalvm: `graalVersion` in `project/Dependencies.scala` (sbt refuses any other JDK);
# - sbt: `sbt.version` in `project/build.properties` (HELD there, see its note);
# - flatc: `flatbuffersVersion` in `project/Dependencies.scala` (checked when the language server
#   compiles).
# One flat `key: value` per line: `setup-jvm` reads them with awk.
toolchain:
  graalvm: 25.0.1
  sbt: 1.10.6
  flatc: 24.3.25
```

`./run` ignores the new key: `ConfigRaw` in `build_tools/build/src/config.rs`
takes only `required-versions` and `latest-release`, and `wasm-size-limit` is
already an ignored key.

- [ ] **Step 6: Run everything to verify it passes, on both hosts**

```bash
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-2a && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"'
cargo test -p enso-build --lib config 2>&1 | tail -3
corepack pnpm exec prettier --check build-config.yaml
```

Expected: `Workflow policy: OK` and `ℹ fail 0` on both hosts. The `enso-build`
config tests pass, including `repo_build_config_is_updatable`, which reads the
real `build-config.yaml`. Prettier reports no issues.

- [ ] **Step 7: Commit**

```bash
git add build-config.yaml tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs
git commit -m "Pin the JVM toolchain in build-config.yaml, checked against the build's own copies"
```

---

### Task 2: The `setup-jvm` composite action, and its first users (PR 2a)

**Files:**

- Create: `.github/actions/setup-jvm/action.yml`
- Create (temporary): `.github/workflows/setup-jvm-smoke.yml`
- Modify: `.github/workflows/formatting.yml` (workflow `env` and the two set-up
  steps)
- Modify: `.github/workflows/enso4igv.yml` (`paths`; the `graalvm/setup-graalvm`
  step)
- Modify: `.github/workflows/workflow-lint.yml` (both `paths` lists)
- Modify: `.github/workflows/engine-changed-files.yml` (`files`)
- Modify: `tools/ci/check-workflows.mjs` (new `checkSbtRunsAfterSetupJvm`,
  `CHECKS`)
- Test: `tools/ci/check-workflows.test.mjs`

**Interfaces:**

- Consumes: Task 1's `toolchain.graalvm`, `toolchain.sbt` and `toolchain.flatc`.
- Produces: the composite action `./.github/actions/setup-jvm` with
  - inputs `cache-key` (required: names `sbt-deps-<cache-key>-<OS>-<hash>`) and
    `flatc` (`"true"`/`"false"`, default `"false"`);
  - effects: `JAVA_HOME` and `GRAALVM_HOME` point at GraalVM CE at the pin;
    `SBT_HOME` is set, and the sbt launcher (plus `flatc` when asked) is on the
    `PATH` for later steps; sbt/Coursier downloads are restored (and saved on
    `develop`).

  It also produces `checkSbtRunsAfterSetupJvm({ workflows }): string[]`. Tasks 4
  and 5 use the action as `uses: ./.github/actions/setup-jvm` +
  `with: { cache-key: …, flatc: … }`.

- [ ] **Step 1: Write the failing tests**

Add `checkSbtRunsAfterSetupJvm` to the import list in
`tools/ci/check-workflows.test.mjs` (alphabetical, before `checkToolchainPins`),
and insert before `test('the repository follows the policy', …)`:

<!-- prettier-ignore -->
```js
describe('checkSbtRunsAfterSetupJvm', () => {
  test('accepts sbt after setup-jvm, and `./run backend sbt` without it', () => {
    const repo = fixture({
      'workflows/a.yml': `
on: push
jobs:
  direct:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-jvm
        with: { cache-key: a }
      - run: |
          task=lintEnso
          sbt "$task"
  wrapped:
    runs-on: ubuntu-latest
    steps:
      - run: ./run backend sbt '--' verifyLicensePackages
`,
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [])
  })
  test('rejects sbt with no setup-jvm before it', () => {
    const repo = fixture({
      'workflows/a.yml': `
on: push
jobs:
  late:
    runs-on: ubuntu-latest
    steps:
      - name: Lint
        run: sbt lintEnso
      - uses: ./.github/actions/setup-jvm
        with: { cache-key: a }
`,
    })
    assert.deepEqual(checkSbtRunsAfterSetupJvm(repo), [
      'a.yml › late: `Lint` runs sbt before `./.github/actions/setup-jvm`',
    ])
  })
})

```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`node --test tools/ci/check-workflows.test.mjs 2>&1 | grep -E "ℹ (pass|fail)|SyntaxError"`

Expected: FAIL with
`does not provide an export named 'checkSbtRunsAfterSetupJvm'`.

- [ ] **Step 3: Implement the rule**

Insert in `tools/ci/check-workflows.mjs`, before `export const CHECKS = [`:

<!-- prettier-ignore -->
```js
/** A step whose script calls `sbt` itself. `./run backend sbt` does not: `./run` provisions sbt. */
const runsSbt = (step) => /^\s*sbt(\s|$)/m.test(String(step?.run ?? ''))

/**
 * A job that calls `sbt` directly sets up GraalVM and sbt with `.github/actions/setup-jvm` in an
 * earlier step: the hosted images have no sbt, and their default JDK fails the build's GraalVM
 * check.
 */
export function checkSbtRunsAfterSetupJvm({ workflows }) {
  const problems = []
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      let ready = false
      for (const step of job?.steps ?? []) {
        if (String(step?.uses ?? '') === './.github/actions/setup-jvm') ready = true
        if (runsSbt(step) && !ready) {
          problems.push(
            `${file} › ${id}: \`${step.name ?? step.run}\` runs sbt before \`./.github/actions/setup-jvm\``,
          )
        }
      }
    }
  }
  return problems
}

```

Add `checkSbtRunsAfterSetupJvm,` as the last entry of `CHECKS`.

- [ ] **Step 4: Run the tests: the new ones pass, and the repository check finds
      the two old users**

Run: `node tools/ci/check-workflows.mjs`

Expected: exit 1, with exactly:

```
enso4igv.yml › build_java: `Publish Enso Libraries to Local Maven Repository` runs sbt before `./.github/actions/setup-jvm`
formatting.yml › test_formatting: `Check Code Formatting` runs sbt before `./.github/actions/setup-jvm`
```

- [ ] **Step 5: Write the composite action**

Create `.github/actions/setup-jvm/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up the JVM toolchain
description: >-
  GraalVM CE and the sbt launcher at the versions pinned under `toolchain:` in `build-config.yaml`,
  `flatc` too when asked, and the sbt / Coursier download cache (saved only on `develop`). What
  `./run` provisioned before an sbt call, minus GraalPy and the MSVC environment, which no job
  that calls sbt directly needs yet. Expects the repository to be checked out.
inputs:
  cache-key:
    description: >-
      Names this job's dependency cache, `sbt-deps-<cache-key>-<OS>-<hash>`. Jobs that resolve
      different dependency sets need different keys: a cache entry is never overwritten, so the
      first job to save one decides its contents.
    required: true
  flatc:
    description: Also install `flatc`, which compiling the language server needs.
    required: false
    default: "false"
runs:
  using: composite
  steps:
    - name: Read the pinned versions
      id: pins
      shell: bash
      run: |-
        pin() {
          local value
          value=$(awk -v key="$1" '{ sub(/\r$/, "") } /^toolchain:/ { t = 1; next } /^[^ #]/ { t = 0 } t && $1 == key ":" { print $2; exit }' build-config.yaml)
          if [ -z "$value" ]; then
            echo "::error file=build-config.yaml::No \`toolchain.$1\` pin."
            exit 1
          fi
          echo "$1=$value" >> "$GITHUB_OUTPUT"
        }
        pin graalvm
        pin sbt
        pin flatc
    - name: Set up GraalVM
      uses: graalvm/setup-graalvm@v1
      with:
        java-version: ${{ steps.pins.outputs.graalvm }}
        distribution: graalvm-community
        github-token: ${{ github.token }}
    # The launcher from the release tarball, as `formatting.yml` always used, unpacked outside the
    # working tree. Git Bash's `tar` reads `D:\...` as a remote host, hence the POSIX path.
    - name: Set up sbt
      shell: bash
      env:
        SBT_VERSION: ${{ steps.pins.outputs.sbt }}
      run: |-
        dir=$RUNNER_TEMP
        if [ "$RUNNER_OS" = "Windows" ]; then dir=$(cygpath -u "$RUNNER_TEMP"); fi
        curl --retry 4 --retry-connrefused -fsSL -o "$dir/sbt.tgz" \
          "https://github.com/sbt/sbt/releases/download/v$SBT_VERSION/sbt-$SBT_VERSION.tgz"
        tar -xzf "$dir/sbt.tgz" -C "$dir"
        rm "$dir/sbt.tgz"
        echo "SBT_HOME=$RUNNER_TEMP/sbt" >> "$GITHUB_ENV"
        echo "$RUNNER_TEMP/sbt/bin" >> "$GITHUB_PATH"
    # The release assets `ide_ci::cache::goodie::flatc` downloaded; a flatc bump may rename them.
    - if: inputs.flatc == 'true'
      name: Set up flatc
      shell: bash
      env:
        FLATC_VERSION: ${{ steps.pins.outputs.flatc }}
      run: |-
        case "$RUNNER_OS" in
          Linux) asset=Linux.flatc.binary.clang++-15.zip ;;
          Windows) asset=Windows.flatc.binary.zip ;;
          macOS) asset=Mac.flatc.binary.zip ;;
        esac
        dir=$RUNNER_TEMP
        if [ "$RUNNER_OS" = "Windows" ]; then dir=$(cygpath -u "$RUNNER_TEMP"); fi
        curl --retry 4 --retry-connrefused -fsSL -o "$dir/flatc.zip" \
          "https://github.com/google/flatbuffers/releases/download/v$FLATC_VERSION/$asset"
        if command -v unzip > /dev/null; then
          unzip -o -q "$dir/flatc.zip" -d "$dir/flatc"
        else
          # A native program: it takes the Windows path.
          7z x -y -o"$RUNNER_TEMP/flatc" "$RUNNER_TEMP/flatc.zip"
        fi
        rm "$dir/flatc.zip"
        chmod +x "$dir/flatc/flatc" 2>/dev/null || true
        echo "$RUNNER_TEMP/flatc" >> "$GITHUB_PATH"
    - name: Check the toolchain
      shell: bash
      env:
        GRAALVM_VERSION: ${{ steps.pins.outputs.graalvm }}
        FLATC_VERSION: ${{ steps.pins.outputs.flatc }}
        WITH_FLATC: ${{ inputs.flatc }}
      run: |-
        # Captured first: `grep -q` stops reading early, which `pipefail` would report.
        java=$(java -version 2>&1)
        echo "$java"
        grep -qF "GraalVM CE $GRAALVM_VERSION" <<< "$java"
        command -v sbt
        if [ "$WITH_FLATC" = "true" ]; then
          flatc=$(flatc --version)
          echo "$flatc"
          grep -qF "flatc version $FLATC_VERSION" <<< "$flatc"
        fi
    - if: github.ref == 'refs/heads/develop'
      name: Cache sbt / Coursier downloads
      uses: actions/cache@v4
      with:
        key: sbt-deps-${{ inputs.cache-key }}-${{ runner.os }}-${{ hashFiles('**/*.sbt', 'project/build.properties', 'project/plugins.sbt', 'project/Dependencies.scala', 'build-config.yaml') }}
        restore-keys: sbt-deps-${{ inputs.cache-key }}-${{ runner.os }}-
        path: |-
          ~/.sbt
          ~/.ivy2/cache
          ~/.cache/coursier
          ~/AppData/Local/Coursier/Cache
          ~/Library/Caches/Coursier
    - if: github.ref != 'refs/heads/develop'
      name: Restore sbt / Coursier downloads
      uses: actions/cache/restore@v4
      with:
        key: sbt-deps-${{ inputs.cache-key }}-${{ runner.os }}-${{ hashFiles('**/*.sbt', 'project/build.properties', 'project/plugins.sbt', 'project/Dependencies.scala', 'build-config.yaml') }}
        restore-keys: sbt-deps-${{ inputs.cache-key }}-${{ runner.os }}-
        path: |-
          ~/.sbt
          ~/.ivy2/cache
          ~/.cache/coursier
          ~/AppData/Local/Coursier/Cache
          ~/Library/Caches/Coursier
```

- [ ] **Step 6: Move `formatting.yml` and `enso4igv.yml` onto it**

In `.github/workflows/formatting.yml`, delete the whole workflow-level `env:`
block (the `env:` line, the two "Please ensure…" comments, `javaVersion: 25.0.1`
and `sbtVersion: 1.10.6`, and the blank line after them). Then replace the two
steps "Setup GraalVM Environment" and "Set Up SBT" (from
`      - name: Setup GraalVM Environment` up to, not including,
`      - name: Check Code Formatting`) with:

<!-- prettier-ignore -->
```yaml
      # GraalVM and sbt at the versions pinned in `build-config.yaml` (`toolchain:`).
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: formatting
```

The "Check Code Formatting" step keeps its command unchanged:
`sbt "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck"`.

In `.github/workflows/enso4igv.yml`, replace

<!-- prettier-ignore -->
```yaml
      - uses: graalvm/setup-graalvm@v1
        with:
          java-version: "25.0.1"
          distribution: "graalvm-community"
```

with

<!-- prettier-ignore -->
```yaml
      # GraalVM and sbt at the versions pinned in `build-config.yaml` (`toolchain:`).
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: enso4igv
```

and in its `pull_request.paths`, after
`      - ".github/workflows/enso4igv.yml"`, add:

<!-- prettier-ignore -->
```yaml
      - ".github/actions/setup-jvm/**"
      - "build-config.yaml"
```

- [ ] **Step 7: Run the pin rule's files through Workflow Lint, and start the
      engine checks on pin changes**

In `.github/workflows/workflow-lint.yml`, both `paths:` lists (under `push` and
under `pull_request`) become:

<!-- prettier-ignore -->
```yaml
    paths:
      - ".github/**"
      - "tools/ci/**"
      # `tools/ci/check-workflows.mjs` checks the toolchain pins against these.
      - "build-config.yaml"
      - "project/Dependencies.scala"
      - "project/build.properties"
```

In `.github/workflows/engine-changed-files.yml`, after the line
`            build.sbt`, add:

<!-- prettier-ignore -->
```yaml
            build-config.yaml
```

- [ ] **Step 8: Add the temporary smoke workflow**

No job in PR 2a runs `setup-jvm` on Windows, so this throwaway workflow proves
it there (Ruling 10). Task 3 deletes it before the merge. Create
`.github/workflows/setup-jvm-smoke.yml`:

<!-- prettier-ignore -->
```yaml
# TEMPORARY: PR 2a only, deleted before it merges (build simplification, Phase 2). Proves
# `.github/actions/setup-jvm` on Windows as well as Linux: no job that uses it in PR 2a runs on
# Windows.

name: setup-jvm smoke
on:
  pull_request:
    # A whitelist: specs and plans (`docs/superpowers/**`) never match it.
    paths:
      - ".github/actions/setup-jvm/**"
      - ".github/workflows/setup-jvm-smoke.yml"

permissions:
  contents: read

jobs:
  smoke:
    name: setup-jvm (${{ matrix.os }})
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
          - os: windows
            runner: windows-latest
    steps:
      - uses: actions/checkout@v5
      - uses: ./.github/actions/setup-jvm
        with:
          cache-key: setup-jvm-smoke
          flatc: "true"
      # Loading the build runs its GraalVM version check; the setting names the distribution
      # directory that the engine checks' lint job will look for.
      - name: Load the build
        run: sbt "-Dsbt.server.autostart=false" "show engineDistributionRoot"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
```

The `-D` arguments are quoted because PowerShell (the Windows default shell)
splits an unquoted `-Dname.with.dots=value` at the first dot.

- [ ] **Step 9: Run every check, on both hosts**

```bash
cd /c/Repos/Enso/ide-bs-2a
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-2a && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)" && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
corepack pnpm exec prettier --check .github
```

Expected: `Workflow policy: OK` and `ℹ fail 0` on both hosts, `actionlint-ok`,
and Prettier clean. actionlint does not shellcheck composite actions, so also
check `setup-jvm`'s scripts, and run its pin reader against the real file:

```bash
cat > "$SCRATCH/sc-setup-jvm.mjs" <<'EOF'
// Writes each `run:` of setup-jvm to sc<N>.sh in the current directory, with
// `${{ … }}` replaced, for shellcheck.
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
const action = parse(readFileSync(process.argv[2], 'utf8'))
action.runs.steps.forEach((step, i) => {
  if (step.run) {
    writeFileSync(`sc${i}.sh`, `#!/bin/bash\nset -eo pipefail\n${step.run.replace(/\$\{\{[^}]*\}\}/g, 'X')}\n`)
  }
})
EOF
cp "$SCRATCH/sc-setup-jvm.mjs" tools/ci/sc-setup-jvm.tmp.mjs
node tools/ci/sc-setup-jvm.tmp.mjs .github/actions/setup-jvm/action.yml && rm tools/ci/sc-setup-jvm.tmp.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-2a && for f in sc*.sh; do ~/tools/shellcheck-v0.11.0/shellcheck "$f" && echo "$f ok"; done; : > out.txt; GITHUB_OUTPUT=out.txt bash sc0.sh && cat out.txt; rm -f sc*.sh out.txt'
git status --short
```

Expected: `sc0.sh ok`, `sc2.sh ok`, `sc3.sh ok`, `sc4.sh ok`, then
`graalvm=25.0.1`, `sbt=1.10.6`, `flatc=24.3.25`. `git status` lists only this
task's files. The `.tmp.mjs` copy sits in `tools/ci` only so that `yaml`
resolves from the repository's `node_modules`.

- [ ] **Step 10: Commit**

```bash
git add .github/actions/setup-jvm/action.yml .github/workflows/setup-jvm-smoke.yml \
  .github/workflows/formatting.yml .github/workflows/enso4igv.yml \
  .github/workflows/workflow-lint.yml .github/workflows/engine-changed-files.yml \
  tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs
git commit -m "Add the setup-jvm composite action; formatting and enso4igv use it"
```

---

### Task 3: Docs, then open, prove and merge PR 2a

**Files:**

- Modify: `.github/CLAUDE.md` (Layout: the release paragraph and `actions/`;
  Conventions; new section "What still goes through `./run`")
- Modify: `CLAUDE.md` (Build systems; "Toolchain versions are duplicated…")
- Modify: `build_tools/CLAUDE.md` ("Running")
- Delete (before merging): `.github/workflows/setup-jvm-smoke.yml`

**Interfaces:**

- Produces: the table "What still goes through `./run`" in `.github/CLAUDE.md`,
  one row per call site. Tasks 4 and 5 each replace exactly their own rows, with
  the text given there.

- [ ] **Step 1: Update `.github/CLAUDE.md`**

Replace

<!-- prettier-ignore -->
```markdown
  them only together with an rc release test. `engine-checks-nightly.yml`,
  `extra-nightly-tests.yml` and `macos-checks.yml` are likewise kept as
  generated until Phase 2.
```

with

<!-- prettier-ignore -->
```markdown
  them only together with an rc release test. `engine-checks-nightly.yml`,
  `extra-nightly-tests.yml` and `macos-checks.yml` are likewise kept as
  generated until Phase 4: they need the self-hosted Mac, Oracle GraalVM, or
  secrets this fork lacks, so no pull request can prove a rewrite.
```

Replace

<!-- prettier-ignore -->
```markdown
- `actions/` — composite actions: `build-script` (compile `./run`'s CLI once per
  platform), `setup-build-script` (use it in a job), `setup-node`, `setup-rust`,
  `git-clean`, `download-engine-distribution`.
```

with

<!-- prettier-ignore -->
```markdown
- `actions/` — composite actions: `build-script` (compile `./run`'s CLI once per
  platform), `setup-build-script` (use it in a job), `setup-node`, `setup-rust`,
  `setup-jvm` (GraalVM, sbt and optionally `flatc` at the `toolchain:` pins in
  `build-config.yaml`, plus the sbt dependency cache), `git-clean`,
  `download-engine-distribution`.
```

After the Conventions bullet that begins
`- **Actions are pinned by major tag**`, add:

<!-- prettier-ignore -->
```markdown
- **A job that runs `sbt` itself uses `setup-jvm` first**, with a `cache-key` of
  its own. Quote `-D` arguments (`sbt "-Dsbt.server.autostart=false" …`): on
  Windows, PowerShell splits an unquoted one at its first dot.
  `tools/ci/check-workflows.mjs` fails a job that runs `sbt` before `setup-jvm`,
  and fails `build-config.yaml`'s pins if they drift from `graalVersion`,
  `flatbuffersVersion` (`project/Dependencies.scala`) or `sbt.version`
  (`project/build.properties`).
```

Before `## Checking a change`, add this section:

<!-- prettier-ignore -->
```markdown
## What still goes through `./run`

Build simplification Phase 2 moved the steps where `./run` only wrapped one sbt
call. The rest need logic that is still in `./run`, and move in Phase 3 or 4.
`./run` computes the version on every call. A job that runs a distribution built
by another job must therefore use that job's version, not sbt's default
`0.0.0-dev`: see Note [Lint Reads The Distribution's Version] in
`engine-checks-platform.yml`.

| Workflow › job                                           | Step                                                     | Goes through `./run`?                               |
| -------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `formatting.yml`, `enso4igv.yml`                         | `sbt …`                                                  | No: `setup-jvm`                                     |
| `engine-benchmark.yml`                                   | `./run backend benchmark runtime`                        | Yes, until PR 2b                                    |
| `std-libs-benchmark.yml`                                 | `./run backend benchmark enso-jmh`                       | Yes, until PR 2b                                    |
| `engine-checks-platform.yml` › Enso Code Lint            | `./run libraries lint`                                   | Yes, until PR 2c                                    |
| `engine-checks-platform.yml` › Enso Code Lint            | `./run libraries check-syntax`                           | Yes: Phase 3 (`checkEnsoSyntax`)                    |
| `engine-checks-platform.yml` › Build Engine Distribution | `./run backend ci-build-engine-distribution`             | Yes: Phase 3 (version, MSVC DLLs, CI checks in sbt) |
| `engine-checks-platform.yml` › JVM Tests                 | `./run backend test jvm`                                 | Yes: Phase 3                                        |
| `engine-checks-platform.yml` › API check, stdlib tests   | `./run backend stdlib-api-check`, `./run backend test …` | Yes: Phase 3 (`stdlib-api-check`, `stdlib-test`)    |
| `changelog.yml`                                          | `./run changelog-check`                                  | Yes: Phase 3                                        |
| `ide-packaging.yml` › Build Backend                      | `./run backend get`                                      | Yes: Phase 3 (`buildEngineBundle`, version)         |
| `ide-packaging.yml` › Package New IDE                    | `./run ide build`                                        | Yes: Phase 3 (version)                              |
| release, promote, nightly, nightly checks, macOS         | various                                                  | Yes: Phase 4                                        |
```

- [ ] **Step 2: Update `CLAUDE.md` and `build_tools/CLAUDE.md`**

In `CLAUDE.md`, after the paragraph that ends `It runs the CLI via `cargo run -p
enso-build-cli`.`, add:

<!-- prettier-ignore -->
```markdown
CI is moving off `./run` (the build-simplification spec,
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`). Where
`./run` only wrapped one sbt call, the workflows now call sbt directly, with
`.github/actions/setup-jvm` providing GraalVM and sbt. `.github/CLAUDE.md`
("What still goes through `./run`") lists each CI step and when it moves.
Locally, `./run` keeps working until Phase 5.
```

In `CLAUDE.md`'s "Toolchain versions are duplicated all over, and nothing
enforces it." bullet, replace the sub-bullet

<!-- prettier-ignore -->
```markdown
  - `.github/workflows/formatting.yml` — `javaVersion` and `sbtVersion` (with
    "please ensure this is in sync" comments); `enso4igv.yml` — its own
    `java-version`. sbt fails hard on a mismatch
    (`Running on GraalVM version X. Expected GraalVM version Y.`), so this
    surfaces as the _formatting_ job failing, not a build.
```

with

<!-- prettier-ignore -->
```markdown
  - `build-config.yaml` `toolchain:` — the GraalVM, sbt and flatc versions CI
    installs (`.github/actions/setup-jvm`, used by the formatting, enso4igv, lint
    and benchmark jobs). This one _is_ enforced: Workflow Lint
    (`tools/ci/check-workflows.mjs`) fails when it differs from `graalVersion`,
    `flatbuffersVersion` or `sbt.version`, so bump it in the same commit.
```

In `build_tools/CLAUDE.md`, after the paragraph that ends
`target/subcommand catalog.`, add:

<!-- prettier-ignore -->
```markdown
CI no longer calls `./run` for every step: where it only wrapped one sbt call,
the workflows call sbt directly (`.github/CLAUDE.md`, "What still goes through
`./run`"). The build-simplification spec retires this CLI in Phase 5. Until
then, keep `./run`'s behaviour for the call sites that still use it, and when a
call site moves, mirror exactly what `./run` did around the command.
```

Run
`corepack pnpm exec prettier --write .github/CLAUDE.md CLAUDE.md build_tools/CLAUDE.md`,
then `--check` on the same files. Expected: no issues.

- [ ] **Step 3: Commit, push and open the PR**

```bash
git add .github/CLAUDE.md CLAUDE.md build_tools/CLAUDE.md
git commit -m "Document setup-jvm and what still goes through ./run"
git push -u origin ci/setup-jvm
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-2a .github/workflows/formatting.yml .github/workflows/enso4igv.yml .github/workflows/workflow-lint.yml .github/workflows/engine-changed-files.yml > "$SCRATCH/compare-2a.md"
gh pr create --base develop --head ci/setup-jvm --label "CI: No changelog needed" \
  --title "Build simplification, PR 2a: setup-jvm and the toolchain pins" \
  --body-file "$SCRATCH/pr-2a.md"
```

Write `$SCRATCH/pr-2a.md` before running `gh pr create`. It holds:

- what the PR does (Task 1 and Task 2 in a sentence each);
- the intended differences E1–E3, each with its reason;
- the comparison output (`$SCRATCH/compare-2a.md`) in a `<details>` block;
- a note that `setup-jvm-smoke.yml` is temporary and is removed before merge;
- `Part of #289's Phase 2.`;
- the attribution lines.

Expected for `compare-2a.md`: only E1–E3. `workflow-lint.yml` and
`engine-changed-files.yml` differ only in their trigger paths.

- [ ] **Step 4: Wait for CI, and compare with develop**

Run `"$SCRATCH/wait-pr.sh" <N> 240` in the background. When it exits:

```bash
for wf in formatting.yml enso4igv.yml workflow-lint.yml setup-jvm-smoke.yml engine-pull-request.yml ide-pull-request.yml; do
  id=$(gh run list --workflow "$wf" --branch ci/setup-jvm -L 1 --json databaseId --jq '.[0].databaseId')
  echo "## $wf — run $id"; "$SCRATCH/job-times.sh" "$id"; echo
done > "$SCRATCH/pr-2a-times.md"
gh run view "$(gh run list --workflow setup-jvm-smoke.yml --branch ci/setup-jvm -L 1 --json databaseId --jq '.[0].databaseId')" --log | grep -E "GraalVM CE 25\.0\.1|flatc version 24\.3\.25|enso-engine-0\.0\.0-dev"
```

Expected:

- every check green;
- "Test Formatting" and "build_java" (enso4igv) within a few minutes of
  develop's times in `baseline.md` (a cold cache can add a minute or two);
- ✨ Engine and ✨ IDE unchanged, since 2a changes none of their jobs;
- the smoke log shows, for **both** `setup-jvm (linux)` and
  `setup-jvm (windows)`: `GraalVM CE 25.0.1`, `flatc version 24.3.25`, and an
  `engineDistributionRoot` ending in
  `built-distribution/enso-engine-0.0.0-dev-<os>-amd64/enso-0.0.0-dev` (with
  backslashes on Windows).

If the Windows leg fails, the likely causes and their fixes:

- at "Set up sbt": a `cygpath` or `tar` path problem. Print `$dir` and
  `ls "$dir"` in the step.
- at "Set up flatc": `unzip` missing. The `7z` fallback should take over; check
  which branch ran.
- at "Load the build": a `-D` argument split by PowerShell, or `SBT_HOME`.

Fix the action, push, and let the smoke run again. Record the run links and
times in the PR as a comment.

- [ ] **Step 5: Delete the smoke workflow, re-run, merge**

```bash
git rm .github/workflows/setup-jvm-smoke.yml
git commit -m "Remove the temporary setup-jvm smoke workflow"
git push
```

Run `"$SCRATCH/wait-pr.sh" <N> 240` in the background. When it exits 0:

```bash
gh pr merge <N> --squash
```

Expected: merged. Then confirm the cache is saved on `develop`: the push run of
Code Formatting Check shows "Cache sbt / Coursier downloads" with a post-job
"Cache saved" for key `sbt-deps-formatting-Linux-…`.

```bash
gh run list --workflow formatting.yml --branch develop -L 1 --json databaseId --jq '.[0].databaseId'
```

Then `gh run view <id> --log | grep -m1 "Cache saved"`.

---

### Task 4: Benchmarks call sbt directly (PR 2b)

**Files:**

- Modify: `.github/workflows/engine-benchmark.yml` (whole file)
- Modify: `.github/workflows/std-libs-benchmark.yml` (whole file)
- Modify: `.github/CLAUDE.md` (two rows of "What still goes through `./run`")

**Interfaces:**

- Consumes: `./.github/actions/setup-jvm` (`cache-key`, `flatc: "true"`) and
  `./.github/actions/setup-node`, `./.github/actions/git-clean`.
- Keeps:
  - the workflow names "Benchmark Engine" and "Benchmark Standard Libraries"
    (`bench-upload.yml`'s `workflow_run` keys on them);
  - the inputs `bench-name` and `just-check`;
  - the job names and `timeout-minutes: 240`;
  - the artifact `benchmark-results.xml` and its paths.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-2b -b ci/benchmarks-direct-sbt origin/develop
cd /c/Repos/Enso/ide-bs-2b && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f .github/actions/setup-jvm/action.yml && echo "2a is in"
```

Expected: `2a is in`.

- [ ] **Step 2: Write `engine-benchmark.yml`**

<!-- prettier-ignore -->
```yaml
# Hand-written. Runs the engine's runtime benchmarks when started by hand; `bench-upload.yml`
# publishes the results when a run completes (it keys on this workflow's name). Calls sbt directly:
# see Note [Benchmarks Call sbt Directly].

name: Benchmark Engine
on:
  workflow_dispatch:
    inputs:
      bench-name:
        description: Name (regex) of the benchmark to run.
        required: false
        type: string
      just-check:
        description: If set, benchmarks will be only checked to run correctly, not to measure actual performance.
        required: true
        type: boolean
        default: false

env:
  # Benchmarks always start and end with a clean working tree. Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "true"

# Note [Benchmarks Call sbt Directly]
# ===================================
# `./run backend benchmark runtime` ran `sbt -Dbench.compileOnly=<just-check>
# -Dsbt.server.autostart=false <task>` (with `LC_ALL=C.UTF-8` and `SBT_SERVER_FORCESTART=true`),
# where <task> is `runtime-benchmarks/benchOnly <bench-name>`, or `runtime-benchmarks/bench` when
# no name is given, after provisioning GraalVM, sbt and flatc (now `setup-jvm`). Its other work was
# either for its own later steps (GraalPy, which nothing in sbt calls) or a no-op on a fresh hosted
# runner after `git-clean` (deleting the IR cache directory, `**/bench-report.xml` and
# `engine/runtime/target`). The engine builds at sbt's default version, 0.0.0-dev, instead of
# `./run`'s `<next>-dev`: nothing outside this job sees that distribution, and the report does not
# record the version.

jobs:
  benchmark-engine-graal-vm-ce:
    name: Benchmark Engine (GraalVM CE)
    runs-on: ubuntu-latest
    timeout-minutes: 240
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      # Corepack, for `git-clean` and for the build's own `corepack pnpm` calls.
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: benchmark-engine
          flatc: "true"
      - name: Run the benchmarks
        run: |-
          task="runtime-benchmarks/bench"
          if [ -n "$BENCH_NAME" ]; then task="runtime-benchmarks/benchOnly $BENCH_NAME"; fi
          sbt "-Dbench.compileOnly=$JUST_CHECK" "-Dsbt.server.autostart=false" "$task"
        env:
          BENCH_NAME: ${{ inputs.bench-name }}
          JUST_CHECK: ${{ inputs.just-check }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload benchmark results
        uses: actions/upload-artifact@v5
        with:
          name: benchmark-results.xml
          path: engine/runtime-benchmarks/bench-report.xml
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

- [ ] **Step 3: Write `std-libs-benchmark.yml`**

<!-- prettier-ignore -->
```yaml
# Hand-written. Runs the Standard Library benchmarks when started by hand; `bench-upload.yml`
# publishes the results when a run completes (it keys on this workflow's name). Calls sbt directly:
# see Note [Benchmarks Call sbt Directly] in `engine-benchmark.yml`.

name: Benchmark Standard Libraries
on:
  workflow_dispatch:
    inputs:
      bench-name:
        description: Name (regex) of the benchmark to run.
        required: false
        type: string
      just-check:
        description: If set, benchmarks will be only checked to run correctly, not to measure actual performance.
        required: true
        type: boolean
        default: false

env:
  # Benchmarks always start and end with a clean working tree. Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "true"

jobs:
  benchmark-standard-libraries-graal-vm-ce:
    name: Benchmark Standard Libraries (GraalVM CE)
    runs-on: ubuntu-latest
    timeout-minutes: 240
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      # Corepack, for `git-clean` and for the build's own `corepack pnpm` calls.
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: benchmark-standard-libraries
          flatc: "true"
      # `std-benchmarks/bench` builds the engine distribution first (its annotation processor
      # needs one).
      - name: Run the benchmarks
        run: |-
          task="std-benchmarks/bench"
          if [ -n "$BENCH_NAME" ]; then task="std-benchmarks/benchOnly $BENCH_NAME"; fi
          sbt "-Dbench.compileOnly=$JUST_CHECK" "-Dsbt.server.autostart=false" "$task"
        env:
          BENCH_NAME: ${{ inputs.bench-name }}
          JUST_CHECK: ${{ inputs.just-check }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload benchmark results
        uses: actions/upload-artifact@v5
        with:
          name: benchmark-results.xml
          path: std-bits/benchmarks/bench-report.xml
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

- [ ] **Step 4: Flip the two rows in `.github/CLAUDE.md`**

Prettier pads the table, so find the rows by their cells, not by their spacing.
In "What still goes through `./run`":

- the row whose first cell is `` `engine-benchmark.yml` `` gets the cells
  `` `sbt runtime-benchmarks/bench` (`benchOnly <name>`) `` and
  `` No: `setup-jvm` ``;
- the row whose first cell is `` `std-libs-benchmark.yml` `` gets the cells
  `` `sbt std-benchmarks/bench` (`benchOnly <name>`) `` and
  `` No: `setup-jvm` ``.

Then run `corepack pnpm exec prettier --write .github/CLAUDE.md`, and check:

```bash
grep -c "until PR 2b" .github/CLAUDE.md
```

Expected: `0`.

- [ ] **Step 5: Check, compare, commit**

```bash
cd /c/Repos/Enso/ide-bs-2b
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-2b && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
corepack pnpm exec prettier --check .github
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-2b .github/workflows/engine-benchmark.yml .github/workflows/std-libs-benchmark.yml > "$SCRATCH/compare-2b.md"
grep -c "only in base" "$SCRATCH/compare-2b.md"
```

Expected: `Workflow policy: OK`, `ℹ fail 0`, `actionlint-ok`, Prettier clean.
The comparison shows exactly E4 for each file: two "Build Script (linux, amd64)
(only in base)" sections. Then:

```bash
git add .github/workflows/engine-benchmark.yml .github/workflows/std-libs-benchmark.yml .github/CLAUDE.md
git commit -m "Benchmarks call sbt directly instead of ./run"
git push -u origin ci/benchmarks-direct-sbt
```

- [ ] **Step 6: Run both benchmarks on the branch and on develop**

The PR's own checks never run these workflows, so dispatch them. A same-day
develop run is the baseline. Dispatch all four, then wait in the background:

```bash
for wf in engine-benchmark.yml std-libs-benchmark.yml; do
  gh workflow run "$wf" --ref ci/benchmarks-direct-sbt -f just-check=true
  gh workflow run "$wf" --ref develop -f just-check=true
done
```

`bench-upload.yml` fires when each run completes, as it does for every benchmark
run. On this fork it fails at checkout without `ENSO_BENCHMARK_RESULTS_TOKEN`.
That is unchanged and publishes nothing.

When the four runs finish (`gh run list --workflow <wf> -L 2` shows them
completed; cap the wait at 4 hours):

```bash
for wf in engine-benchmark.yml std-libs-benchmark.yml; do
  for ref in ci/benchmarks-direct-sbt develop; do
    id=$(gh run list --workflow "$wf" --branch "$ref" --event workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
    echo "## $wf @ $ref — run $id"; "$SCRATCH/job-times.sh" "$id"
    "$SCRATCH/bench-names.sh" "$id" > "$SCRATCH/bench-$wf-${ref//\//_}.txt"; wc -l < "$SCRATCH/bench-$wf-${ref//\//_}.txt"
  done
done | tee "$SCRATCH/pr-2b-runs.md"
diff "$SCRATCH/bench-engine-benchmark.yml-ci_benchmarks-direct-sbt.txt" "$SCRATCH/bench-engine-benchmark.yml-develop.txt" && echo runtime-same
diff "$SCRATCH/bench-std-libs-benchmark.yml-ci_benchmarks-direct-sbt.txt" "$SCRATCH/bench-std-libs-benchmark.yml-develop.txt" && echo stdlib-same
```

Expected:

- **Benchmark Engine:** both runs `success`, within about 20% of each other (the
  branch has no Build Script job, so it should start sooner). Both logs end with
  `benchmarks run successfully in compileOnly mode`. The benchmark name lists
  are identical (`runtime-same`).
- **Benchmark Standard Libraries:** both runs fail the same way, as develop
  already does (Ruling 13). The branch fails in "Run the benchmarks" with
  `Java heap space` and `(std-benchmarks / Compile / run) Nonzero exit code`,
  after the same generated benchmark names (`stdlib-same`; 19 names in the
  baseline of 2026-10-21). If develop now **passes** and the branch fails, the
  move broke something: compare the two sbt command lines and environments. If
  both pass, better still: require identical name lists.
- In the branch logs, "Check the toolchain" prints `GraalVM CE 25.0.1` and
  `flatc version 24.3.25`.

- [ ] **Step 7: Open the PR, wait, merge**

Write `$SCRATCH/pr-2b.md`. It holds:

- the change in two sentences;
- E4 with its reason;
- the comparison (`compare-2b.md`) in `<details>`;
- the four run links with their times and conclusions;
- the benchmark name comparison;
- the std-libs baseline failure and why it does not block (Ruling 13);
- `Part of #289's Phase 2.`;
- the attribution lines.

```bash
gh pr create --base develop --head ci/benchmarks-direct-sbt --label "CI: No changelog needed" \
  --title "Build simplification, PR 2b: benchmarks call sbt directly" --body-file "$SCRATCH/pr-2b.md"
```

Run `"$SCRATCH/wait-pr.sh" <N> 120` in the background. The PR's own checks are
Workflow Lint, Code Formatting and Changelog: the benchmark files are on no
other gate's list. If 2c has merged in the meantime, bring the branch up to date
without rewriting it (force pushes are not allowed):
`git fetch origin && git merge --no-edit origin/develop`, resolve the
`.github/CLAUDE.md` table by keeping both PRs' rows, push, and wait again. When
the checks are green:

```bash
gh pr merge <N> --squash
```

---

### Task 5: The engine checks' Enso lint calls sbt directly (PR 2c)

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml`
  (`build-engine-distribution`: `outputs`, step `id`; `enso-code-lint`: the
  Note, the lint steps)
- Modify: `.github/CLAUDE.md` (one row of "What still goes through `./run`")

**Interfaces:**

- Consumes: `./.github/actions/setup-jvm` (`cache-key: enso-code-lint`, no
  flatc). It also consumes the step outputs `ENSO_VERSION`, `ENSO_EDITION` and
  `ENSO_RELEASE_MODE`, which `./run`'s `Versions::publish`
  (`build_tools/build/src/version.rs`) writes on every call.
- Produces: job outputs `needs.build-engine-distribution.outputs.ENSO_VERSION`,
  `…ENSO_EDITION` and `…ENSO_RELEASE_MODE`, for any later job of the same
  platform pipeline.

- [ ] **Step 1: Create the worktree, and check the directory naming locally
      (Linux)**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-2c -b ci/engine-lint-direct-sbt origin/develop
cd /c/Repos/Enso/ide-bs-2c && corepack pnpm install --frozen-lockfile --ignore-scripts
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-2c && ENSO_VERSION=2026.1.1-dev ENSO_EDITION=2026.1.1-dev sbt -Dsbt.server.autostart=false "show engineDistributionRoot" 2>&1 | tail -3'
```

Expected: the last lines show
`…/built-distribution/enso-engine-2026.1.1-dev-linux-amd64/enso-2026.1.1-dev`.
This is the path that the lint's guard step globs as
`built-distribution/enso-engine-"$ENSO_VERSION"-*/enso-"$ENSO_VERSION"`.

- [ ] **Step 2: Make the build job publish the version**

In `.github/workflows/engine-checks-platform.yml`, job
`build-engine-distribution`, replace

<!-- prettier-ignore -->
```yaml
    env:
      ENSO_LAUNCHER: native,test
      GRAAL_EDITION: GraalVM CE
    steps:
```

with

<!-- prettier-ignore -->
```yaml
    env:
      ENSO_LAUNCHER: native,test
      GRAAL_EDITION: GraalVM CE
    # The version `./run` gave the distribution. See Note [Lint Reads The Distribution's Version].
    outputs:
      ENSO_VERSION: ${{ steps.build.outputs.ENSO_VERSION }}
      ENSO_EDITION: ${{ steps.build.outputs.ENSO_EDITION }}
      ENSO_RELEASE_MODE: ${{ steps.build.outputs.ENSO_RELEASE_MODE }}
    steps:
```

and replace

<!-- prettier-ignore -->
```yaml
      - run: ./run backend ci-build-engine-distribution
        env:
```

with

<!-- prettier-ignore -->
```yaml
      - id: build
        run: ./run backend ci-build-engine-distribution
        env:
```

- [ ] **Step 3: Move the lint**

Replace the line `  enso-code-lint:` with:

<!-- prettier-ignore -->
```yaml
  # Note [Lint Reads The Distribution's Version]
  # =============================================
  # `lintEnso` runs the downloaded distribution from `engineDistributionRoot`, which sbt names from
  # `ENSO_VERSION` (`built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`), and
  # sbt's default is 0.0.0-dev. `./run` computed the distribution's version (`<next stable>-dev`)
  # and published it as step outputs, so the lint step takes it from there rather than computing
  # its own (that logic moves out of `./run` in Phase 3). Otherwise the step runs what
  # `./run libraries lint` ran once it had provisioned GraalVM and sbt: `sbt
  # -Dbench.compileOnly=false -Dsbt.server.autostart=false lintEnso`, with `LC_ALL=C.UTF-8` and
  # `SBT_SERVER_FORCESTART=true`. `lintEnso` compiles nothing on CI (`CI` is set), so it needs no
  # flatc.
  enso-code-lint:
```

In the same job, replace

<!-- prettier-ignore -->
```yaml
      - run: ./run libraries lint
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

with

<!-- prettier-ignore -->
```yaml
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: enso-code-lint
      - name: Check the distribution's version
        run: |-
          if [ -z "$ENSO_VERSION" ]; then
            echo "::error::build-engine-distribution published no ENSO_VERSION."
            exit 1
          fi
          ls -d built-distribution/enso-engine-"$ENSO_VERSION"-*/enso-"$ENSO_VERSION"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
      - name: Lint
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" lintEnso
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The version is set on the Lint step only. The job's
`./run libraries check-syntax` step keeps computing its own, as before, and an
empty output can never reach it.

- [ ] **Step 4: Flip the lint row in `.github/CLAUDE.md`**

Find the row by its cells, not its spacing. In "What still goes through
`./run`", the row whose cells are
`` `engine-checks-platform.yml` › Enso Code Lint `` and
`` `./run libraries lint` `` gets the cells
`` `sbt lintEnso` (version from the build job) `` and `` No: `setup-jvm` ``.
Leave the `check-syntax` row of the same job alone.

Then run `corepack pnpm exec prettier --write .github/CLAUDE.md`, and check:

```bash
grep -c "until PR 2c" .github/CLAUDE.md
```

Expected: `0`.

- [ ] **Step 5: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-2c
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-2c && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
corepack pnpm exec prettier --check .github
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-2c .github/workflows/engine-checks.yml > "$SCRATCH/compare-2c.md"
git add .github/workflows/engine-checks-platform.yml .github/CLAUDE.md
git commit -m "Engine checks: Enso lint calls sbt directly, at the distribution's version"
git push -u origin ci/engine-lint-direct-sbt
```

Expected: `Workflow policy: OK`, `ℹ fail 0`, `actionlint-ok`, Prettier clean.
`compare-2c.md` shows only:

- E5 under both "Build Engine Distribution … (linux, amd64)" and "… (windows,
  amd64)";
- E6 under "Enso Code Lint (linux, amd64)".

Write `$SCRATCH/pr-2c.md`. It holds:

- the change in two sentences;
- E5–E6 with their reasons;
- `compare-2c.md` in `<details>`;
- a placeholder section "Verification" that Step 6 fills in;
- `Part of #289's Phase 2.`;
- the attribution lines.

```bash
gh pr create --base develop --head ci/engine-lint-direct-sbt --label "CI: No changelog needed" \
  --title "Build simplification, PR 2c: Enso lint calls sbt directly" --body-file "$SCRATCH/pr-2c.md"
```

- [ ] **Step 6: Prove it: the PR's run, a clean dispatch, and the distribution
      file by file**

The PR changes `engine-checks-platform.yml`, so ✨ Engine runs. Also dispatch a
clean build on the branch:

```bash
gh workflow run engine-checks.yml --ref ci/engine-lint-direct-sbt -f clean_build_required=true
```

Run `"$SCRATCH/wait-pr.sh" <N> 300` in the background. When it exits, and the
dispatched run has completed:

```bash
pr=$(gh run list --workflow engine-pull-request.yml --branch ci/engine-lint-direct-sbt -L 1 --json databaseId --jq '.[0].databaseId')
disp=$(gh run list --workflow engine-checks.yml --branch ci/engine-lint-direct-sbt --event workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
dev=$(gh run list --workflow engine-pull-request.yml --branch develop --event push -L 1 --json databaseId --jq '.[0].databaseId')
for id in $pr $disp $dev; do echo "## run $id"; "$SCRATCH/job-times.sh" "$id"; done | tee "$SCRATCH/pr-2c-times.md"
for id in $pr $disp $dev; do
  echo "## run $id"
  gh run view "$id" --log | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "Linting \[[^]]*\]" | sort
done | tee "$SCRATCH/pr-2c-lint.md"
```

Expected:

- Every job green in the PR run and in the dispatch. Each job's time is within
  about 20% of develop's. Enso Code Lint should be no slower: it now skips
  `./run`'s GraalPy download.
- Each run shows the same three `Linting [...]` lines: Standard Libraries,
  regular tests, and tests with private access. The project lists are identical
  to develop's.
- The PR run's "Check the distribution's version" step prints one
  `built-distribution/enso-engine-<version>-linux-amd64/enso-<version>`
  directory, where `<version>` equals the `ENSO_VERSION` that the build job's
  `./run` logged.

Then compare the engine distribution artifact with develop's, for both
platforms. Do it in WSL on the Linux filesystem; the archives are large:

```bash
for os in linux windows; do
  name="Engine Distribution (GraalVM CE) (native,test) ($os, amd64)"
  gh run download "$pr" -n "$name" -D "$SCRATCH/dist-pr-$os"
  gh run download "$dev" -n "$name" -D "$SCRATCH/dist-dev-$os"
done
wsl -e bash -lc '
  set -e; S=$(wslpath "'"$SCRATCH"'"); rm -rf ~/p2cmp; mkdir -p ~/p2cmp
  for os in linux windows; do for side in pr dev; do
    mkdir -p ~/p2cmp/$side-$os && tar -xf "$S/dist-$side-$os/built-distribution.tar" -C ~/p2cmp/$side-$os
    (cd ~/p2cmp/$side-$os && find . -type f -printf "%s %P\n" | sort -k2) > ~/p2cmp/$side-$os.txt
  done
  echo "== $os: names"; diff <(cut -d" " -f2- ~/p2cmp/pr-$os.txt) <(cut -d" " -f2- ~/p2cmp/dev-$os.txt) && echo same-files
  echo "== $os: sizes that differ"; join -1 2 -2 2 <(sort -k2 ~/p2cmp/pr-$os.txt) <(sort -k2 ~/p2cmp/dev-$os.txt) | awk "\$2 != \$3" | head -20
  done'
```

Expected, for each platform: `same-files`. The sizes that differ, if any, are
build-nondeterministic files only: native images (`bin/enso`, `*.so`, `*.dll`,
`*.exe`), IR cache blobs, `*.jar` timestamps and generated indexes. Each differs
by under 1%. A missing or extra file, or a difference in a source or `.enso`
file, means the build step changed. It must not have: E5 adds only an `id` and
outputs. Investigate before merging. Delete `~/p2cmp` and `$SCRATCH/dist-*`
afterwards.

Put the verification results in the PR body:

- the run links and the times table;
- the lint comparison;
- the distribution comparison (file counts, any size differences).

Use `gh pr edit <N> --body-file "$SCRATCH/pr-2c.md"`.

- [ ] **Step 7: Merge, and close out Phase 2**

If 2b merged in the meantime, bring the branch up to date without rewriting it:
`git fetch origin && git merge --no-edit origin/develop`, keeping both PRs' rows
in the `.github/CLAUDE.md` table; push and wait again. When every check is
green:

```bash
gh pr merge <N> --squash
```

After both 2b and 2c have merged:

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide grep -n "until Phase 2" origin/develop -- .github CLAUDE.md build_tools/CLAUDE.md
git -C /c/Repos/Enso/ide grep -n "javaVersion\|java-version: \"25" origin/develop -- .github
```

Expected: both greps print nothing. Comment on #289 with the three PR links and
"Phase 2 complete". Remove the worktrees with
`git -C /c/Repos/Enso/ide worktree remove /c/Repos/Enso/ide-bs-2a` (and `2b`,
`2c`) once their branches have merged.

---

## Self-review against the spec

| Spec section / requirement                                                                                                    | Where                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 2: workflows call pnpm and sbt directly where `./run` was a thin wrapper                                                | Tasks 4 (benchmarks) and 5 (lint). The call-site table shows each other site is not thin, and why.                                                                                      |
| Phase 2 gate: merge on green                                                                                                  | Global Constraints; Tasks 3, 4 and 5 each end with a merge on green                                                                                                                     |
| Pinned versions: one file, `build-config.yaml`, the single source for the CI composite actions and the copies CLAUDE.md lists | Task 1 (pins + drift rule); Task 2 (`setup-jvm` reads them; `formatting.yml` and `enso4igv.yml` lose their copies); Task 3 (CLAUDE.md). Ruling 4 explains why sbt keeps its own copies. |
| CI structure: `setup-jvm` (GraalVM via `graalvm/setup-graalvm`, sbt, ivy/coursier cache)                                      | Task 2                                                                                                                                                                                  |
| CI structure: `setup-msvc` (`ilammy/msvc-dev-cmd`) for Windows native-image jobs                                              | Deferred to Phase 3: no Windows job moves in Phase 2 (Ruling 5)                                                                                                                         |
| Unchanged: path gating, unrelated-label handling, secrets, labels; required-check names                                       | Global Constraints; the comparison in every PR; E1–E6 are the only differences                                                                                                          |
| `actionlint` on `.github/**` changes                                                                                          | Unchanged; Workflow Lint also runs on the pin files now (E3)                                                                                                                            |
| Risk: Windows native image needs MSVC                                                                                         | Untouched: the Windows engine build stays on `./run` (call-site table; Ruling 12)                                                                                                       |
| Risk: two ways to build during Phases 2–4; CLAUDE.md says which path is current                                               | Task 3 (the `.github/CLAUDE.md` table, the CLAUDE.md and `build_tools/CLAUDE.md` notes); Tasks 4 and 5 keep it current                                                                  |
| Throughout: Linux as well as Windows; no `git stash`, no `--no-verify`; Prettier on docs                                      | Global Constraints; WSL runs in Tasks 1, 2, 4, 5; the Windows smoke (Task 3) and the Windows distribution comparison (Task 5)                                                           |
| Verification: compared job by job with develop (pass/fail, duration, artifacts)                                               | Task 0 (baseline, scripts); Task 3 Step 4; Task 4 Step 6 (benchmark names); Task 5 Step 6 (lint lines, the distribution file by file)                                                   |
| Phases 3 and 4 out of scope                                                                                                   | The call-site table and Ruling 14; no `build_tools/` change; no release workflow touched                                                                                                |

**Spec references corrected against the code:**

- The spec lists `backend ci-build-engine-distribution` and `ide build` among
  the thin wrappers. They are not:
  - The first copies the MSVC runtime DLLs into the engine package on Windows,
    runs `checkIRCacheSizes`, and verifies the generated packages at versioned
    paths.
  - The second depends on the computed version (installer name, electron-builder
    version, update mode), and writes the checksum.

  Both stay on `./run` (Ruling 12).

- `backend test jvm` appears in no Phase 3 item, but it is composite logic:
  - the parser's Java self-tests;
  - the ydoc native image;
  - benchmark compilation and a dry run through the versioned distribution;
  - heap-dump options and Windows test factors.

  Phase 3's plan needs an item for it (Ruling 12).

- The spec says the version step publishes `ENSO_IDE_VERSION` and
  `ENSO_IDE_COMMIT_HASH`. `./run` publishes only `ENSO_VERSION`, `ENSO_EDITION`
  and `ENSO_RELEASE_MODE` (env and step outputs). The IDE variables are set on
  the pnpm child processes of `ide build` and `gui build` only.
- The spec's single pinned-versions file does not yet hold the GraalVM, sbt or
  flatc versions: they live in `project/Dependencies.scala` and
  `project/build.properties`, which sbt reads. Task 1 adds them to
  `build-config.yaml` with a drift check (Ruling 4).
- `./run` installs the sbt 1.5.5 launcher (`ide_ci::cache::goodie::sbt`), not
  the project's 1.10.6. `.jvmopts` and `project/build.properties` decide the JVM
  options and the sbt version either way (Ruling 7).
- `std-libs-benchmark.yml` fails on `develop` today (out of heap in the
  just-check run). Task 4 compares against that failure (Ruling 13).

**Placeholder scan:**

- `<N>` is a PR number, known only once `gh pr create` prints it.
- `<id>` and `<run-id>` are printed by `gh run list`.
- `$SCRATCH` is the executing session's scratchpad.
- `<version>`, `<os>` and `<task>` inside Notes and expected output name values
  the runs print.

There is no TBD and no "similar to". Each task repeats the commands it needs.

**Consistency:** the names match across tasks:

- `setup-jvm` and its inputs `cache-key` and `flatc`;
- the cache keys `formatting`, `enso4igv`, `benchmark-engine`,
  `benchmark-standard-libraries`, `enso-code-lint` and `setup-jvm-smoke`;
- the pins `toolchain.graalvm`, `toolchain.sbt` and `toolchain.flatc`;
- `checkToolchainPins`, `checkSbtRunsAfterSetupJvm` and `ROOT_FILES`;
- the outputs `ENSO_VERSION`, `ENSO_EDITION` and `ENSO_RELEASE_MODE`, and the
  step id `build`;
- the Notes [Benchmarks Call sbt Directly] and [Lint Reads The Distribution's
  Version];
- the table rows in `.github/CLAUDE.md`, which Tasks 4 and 5 find by their
  cells.

**Tested before writing** (2026-10-21, on a copy of the repository at
`ff68f1152f`, develop with #300 and #301 merged):

- The policy changes and tests pass: 34 tests, `Workflow policy: OK`. Before the
  two workflows moved, the sbt rule reported exactly `formatting.yml` and
  `enso4igv.yml`.
- actionlint 1.7.12 with shellcheck 0.11.0 is clean on every workflow here, and
  shellcheck is clean on `setup-jvm`'s four scripts.
- The awk pin reader prints `graalvm=25.0.1`, `sbt=1.10.6` and `flatc=24.3.25`.
- Prettier passes on every YAML file.
- `sbt-1.10.6.tgz` and both flatc assets download (HTTP 200). The tarball holds
  `sbt/bin/sbt` and `sbt/bin/sbt.bat`.
- The comparison script against `develop` shows exactly E1–E6.
- The `./run` command lines in Note [Benchmarks Call sbt Directly] are copied
  from develop's run 39544143953 log.

## Rulings

1. **Ruling:** Phase 2 moves exactly three `./run` call sites: the two
   benchmarks (`backend benchmark runtime`, `backend benchmark enso-jmh`) and
   the engine checks' `libraries lint`. It also moves the two workflows that
   already called sbt by hand onto `setup-jvm`. Every other in-scope call site
   stays.
   - **Why:** these are the only sites where `./run` adds nothing beyond
     toolchain set-up around one sbt call. Each other site needs version logic,
     bundle assembly, test wiring, or a check written in Rust (the call-site
     table).
   - **Cost if wrong:** a site that could have moved waits for Phase 3. That
     costs nothing in behaviour, only a later PR.
2. **Ruling:** the lint takes `ENSO_VERSION`, `ENSO_EDITION` and
   `ENSO_RELEASE_MODE` from the build job's outputs, which `./run` already
   publishes. It neither defaults to `0.0.0-dev` nor computes a version itself.
   - **Why:** `lintEnso` runs a distribution named by the version that another
     job's `./run` computed. Reusing that value keeps them equal by
     construction, and moves no version logic before Phase 3. A guard step fails
     loudly if the output is empty or the directory is missing.
   - **Cost if wrong:** if `./run` ever stops writing step outputs, the guard
     fails the lint with a clear message. Phase 3's `version` will publish the
     same outputs (spec).
3. **Ruling:** the benchmarks run at sbt's default `0.0.0-dev`.
   - **Why:** the distribution they build is used only inside the job;
     `bench-processor` finds it by glob; the reports carry no version.
   - **Cost if wrong:** a benchmark that read the version would see `0.0.0-dev`
     instead of `<next>-dev`. Task 4 compares the benchmark name lists with
     develop, which would expose a behaviour change.
4. **Ruling:** `build-config.yaml` gains a `toolchain:` block (graalvm, sbt,
   flatc), which `setup-jvm` reads. A new policy rule fails when it differs from
   `graalVersion`/`flatbuffersVersion` in `project/Dependencies.scala` or
   `sbt.version` in `project/build.properties`.
   - **Why:** the spec makes `build-config.yaml` the single source for CI. But
     sbt cannot read YAML to load itself (`build.properties`), and its GraalVM
     check lives in the build. A checked copy is the only way to have both, and
     the check turns the silent drift CLAUDE.md warns about into a Workflow Lint
     failure.
   - **Cost if wrong:** one more place to bump. The rule's message names it.
5. **Ruling:** no `setup-msvc` in Phase 2.
   - **Why:** no moved call site runs on Windows. The Windows engine build, the
     only job that needs the MSVC environment, stays on `./run`, which applies
     it. YAGNI, as Phase 1's Ruling 4 did for `setup-jvm`.
   - **Cost if wrong:** Phase 3 adds it with the first Windows native-image job
     that leaves `./run`.
6. **Ruling:** `setup-jvm` installs no GraalPy.
   - **Why:** nothing in sbt calls the standalone `graalpy` (the engine embeds
     GraalPy from Maven). Only test jobs, which stay on `./run`, may need it.
   - **Cost if wrong:** a moved job fails at a Python step. The dispatch runs in
     Task 4 would show it before merge.
7. **Ruling:** the sbt launcher is the project's own version (1.10.6, the
   tarball `formatting.yml` always used), not `./run`'s 1.5.5.
   - **Why:** the launcher only boots the sbt that `project/build.properties`
     names, and `.jvmopts` sets the JVM options either way. One pin, already
     proven in `formatting.yml`.
   - **Cost if wrong:** a launcher-script difference (default JVM flags) shows
     up as a time or memory change in Task 4 and 5's comparisons.
8. **Ruling:** the sbt dependency cache is keyed per job (the `cache-key`
   input), restored everywhere, and saved only on `develop`.
   - **Why:** a cache entry is immutable, so the first job to save a shared key
     would decide its contents for all. Saving only on `develop` matches
     `setup-rust` and `ide-packaging.yml`.
   - **Cost if wrong:** some cache storage. Each key holds what one job
     downloads.
9. **Ruling:** `formatting.yml` and `enso4igv.yml` move onto `setup-jvm` in PR
   2a, although neither called `./run`.
   - **Why:** they are the version copies CLAUDE.md lists. The spec says the
     composite actions replace them where they can. They are also `setup-jvm`'s
     cheapest real users: Code Formatting runs on every PR.
   - **Cost if wrong:** `enso4igv` now uses the 1.10.6 launcher instead of the
     image's. Its own run on PR 2a (its path filter includes the workflow file)
     proves it.
10. **Ruling:** `setup-jvm` is proven on Windows by a temporary `pull_request`
    workflow on PR 2a's branch, deleted before the merge.
    - **Why:** no Phase 2 job runs it on Windows, and a new workflow file cannot
      be dispatched until it is on the default branch.
    - **Cost if wrong:** a later Windows user (Phase 3) meets a Windows-only bug
      the smoke run missed. The smoke covers the parts that differ (paths,
      `tar`, `unzip`, PowerShell argument splitting, the build's GraalVM check).
11. **Ruling:** the job-by-job comparison uses `compare-workflows.mjs`, restored
    from git history at the commit before #303 deleted it. The script runs it in
    place and deletes it again; it is never committed.
    - **Why:** it already expands reusable workflows, matrices and composite
      actions, and its output format is what the Phase 1 PRs used. Re-adding it
      would undo #303.
    - **Cost if wrong:** if history is rewritten, the restore fails loudly, and
      a diff of the YAML is the fallback.
12. **Ruling:** these stay on `./run` until Phase 3:
    - `backend ci-build-engine-distribution`, `backend get` and `ide build`,
      which the spec called thin;
    - `backend test jvm`, which the spec does not mention.

    Phase 3's plan must cover:
    - the DLL copy into the engine package (not only the bundle);
    - `checkIRCacheSizes`;
    - `verifyGeneratedPackage`;
    - the JVM-test composite;
    - `ide build` once `version` exists.
    - **Why:** each needs the computed version, Windows packaging logic, or
      several coordinated steps (the call-site table). The rule from the
      controller: keep version-dependent calls on `./run` rather than
      reimplement version logic early.
    - **Cost if wrong:** none in behaviour. Phase 3 is larger by these items.

13. **Ruling:** `std-libs-benchmark.yml` is red on develop today: the just-check
    run runs out of heap. For 2b, equivalence means failing the same way, at the
    same sbt task, after the same benchmark names. A failure the baseline lacks
    is not equivalence.
    - **Why:** the move cannot fix an existing failure, and must not be held to
      a stricter bar than develop. Comparing the names run before the failure
      catches a change in what runs.
    - **Cost if wrong:** a regression hidden behind the existing failure, in a
      benchmark after the point where both runs die. It surfaces when the heap
      issue is fixed. Follow-up: open an issue for the OOM if none exists.
14. **Ruling:** `engine-checks-nightly.yml`, `extra-nightly-tests.yml` and
    `macos-checks.yml` stay as generated until Phase 4, and `.github/CLAUDE.md`
    says so (it said "until Phase 2").
    - **Why:** they need the self-hosted Mac, Oracle GraalVM, or Snowflake and
      Cloud secrets, so no unattended run can prove a change. They share Phase
      4's need for a supervised run.
    - **Cost if wrong:** about 3.5k generated lines live longer.
15. **Ruling:** the benchmark workflows lose their "Build Script" job (E4).
    - **Why:** it existed only to compile `./run`. No workflow, ruleset or
      protection reads its name.
    - **Cost if wrong:** none known. `bench-upload.yml` keys on workflow names,
      which stay.
16. **Ruling:** the moved jobs do not repeat `./run`'s CI clean-ups: deleting
    the global IR cache directory, `**/bench-report.xml` and
    `engine/runtime/target`.
    - **Why:** on a fresh GitHub-hosted runner, after `git-clean`, each is a
      no-op.
    - **Cost if wrong:** on self-hosted runners (#258) a stale IR cache could
      leak between runs. #258 must add an explicit clean step if it lands before
      Phase 5.
