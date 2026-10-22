# Build Simplification, Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the real logic out of `./run` for every pull-request check: the
version, the changelog check, the API check, the syntax check, the engine
distribution and bundle builds, the JVM tests, the IDE packaging and the
standard-library tests, so that no default pull-request check calls `./run` any
more (the label-gated macOS checks keep it until Phase 4).

**Architecture:** Ten pull requests, one per item, in dependency order.

- **3a** creates `tools/build-scripts`, a pnpm workspace package of TypeScript
  that Node 24 runs directly (type stripping), with its first command,
  `version`, and a `Build Scripts` workflow that type-checks, lints and tests
  it.
- **3b** adds `toolchain-check`, one toolchain-pin parser shared by
  `setup-jvm`'s awk, the workflow policy and `toolchain-check` (held equal by a
  test), the `toolchain.graalpy` pin, and closes the policy's `SBT_CALL` blind
  spot.
- **3c** replaces `./run changelog-check` with an inline `actions/github-script`
  step.
- **3d** moves the Standard Library API check to `tools/build-scripts`.
- **3e** adds the sbt task `checkEnsoSyntax`; the lint job drops
  `setup-build-script`.
- **3f** adds the sbt task `ciBuildEngineDistribution`, the shared MSVC runtime
  DLL copy and the `setup-msvc` action; the engine build job computes the
  version with `tools/build-scripts`.
- **3g** adds the sbt task `buildEngineBundle`; the IDE's backend job uses it.
- **3h** turns `./run backend test jvm` into workflow steps.
- **3i** adds the `ide-build` command; IDE packaging no longer needs `./run`.
- **3j** adds the `stdlib-test` runner, GraalPy in `setup-jvm`, and Linux
  service containers, proven by a side-by-side run against `./run`.

The analysis in "What moves, and where" says what `./run` did at each call site
and where each part goes.

**Tech Stack:** Node 24.21 (type stripping, `node:util` `parseArgs`), TypeScript
6.0.3 (`erasableSyntaxOnly`), vitest 3.2, `semver` 7.8.5, `yaml` 2.9.1; sbt
1.10.6 with Scala 2.12 build code (`project/*.scala`, `build.sbt`); GitHub
Actions (composite actions, reusable workflows, job outputs, service
containers), `actions/github-script@v8`, `ilammy/msvc-dev-cmd@v1`; actionlint
1.7.12 with shellcheck 0.11.0; `node:test` for `tools/ci`; `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md`
(design PR #289), "Phase 3" and "Phase 3 must carry". The Phase 2 plan
(`docs/superpowers/plans/2026-10-21-build-simplification-phase-2.md`) has the
house style, `setup-jvm`, the policy rules and the `.github/CLAUDE.md` table
this plan continues; the Phase 0–1 plan has the comparison script. Read both.
The rulings this plan makes are at the end; R-user-1 and R-user-2 are the user's
own decisions.

## Global Constraints

- **Runs unattended.** Never publish anything: no run of `release.yml`,
  `promote.yml` or `nightly.yml`, no tag, no release. The only `gh workflow run`
  calls allowed are those Tasks 10 and 15 name: `engine-checks.yml`, on this
  plan's branches.
- **Merge on green, and only on green**, with `gh pr merge <N> --squash`, except
  3j, which merges only after its side-by-side comparison passes (Task 15).
  Every PR takes the label `CI: No changelog needed`: these are CI changes,
  invisible to users. Handle a red check with "When a check fails" below, never
  by merging anyway.
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
  - Run the policy tests, actionlint and the sbt checks in WSL as well as on
    Windows (Task 0 has the commands). Source `~/.enso-toolchain.sh` first.
  - Never run pnpm in WSL against `/mnt/c`: the package's Linux run is its CI
    job (`Build Scripts`, ubuntu).
  - Never run sbt on Windows and in WSL in the same worktree at the same time:
    they share `project/target`, and the second load fails with a
    `ClassNotFoundException` for a compiled `build.sbt` fragment.
  - Every PR that changes a Windows job proves it on the PR's own Windows run.
- **Never touch** the user's running Enso, `%APPDATA%\Enso`,
  `%LOCALAPPDATA%\enso`, or `~/.enso`. Do not run `stdlib-test` locally outside
  `--dry-run`: this machine has real AWS credentials in its environment, and the
  runner deletes the IR cache when `GITHUB_ACTIONS=true`.
- **Keep these unchanged**, and check them with the comparison script (Task 0):
  - every job display name, except the "Build Script" jobs that 3c, 3i and 3j
    delete;
  - the aggregator names "Engine Required Checks", "GUI Required Checks", "IDE
    Required Checks" and "WASM Required Checks" (no aggregator file is touched);
  - artifact names;
  - triggers (including `paths-ignore: ["docs/superpowers/**"]`), except the
    path lists the intended differences extend;
  - secrets and variables, except the `GITHUB_TOKEN`s that only `./run` read;
  - `concurrency:`, `timeout-minutes`, `continue-on-error`;
  - label handling (`CI: Clean build required`, `CI: Build IDE`).

  The PR lists every difference the comparison reports, with its reason. Each
  one must appear in "Reference: intended differences".

- **Out of scope** (do not edit): `release.yml`, `promote.yml`, `nightly.yml`,
  `engine-checks-nightly.yml`, `extra-nightly-tests.yml`, `macos-checks.yml`,
  `bench-upload.yml` (Phase 4), and the Rust in `build_tools/` (Phase 5). Those
  workflows still call `./run`, so every Rust command stays working.
- **Actions are pinned by major tag**, and a new third-party action or image
  must be at least two weeks old. New here: `ilammy/msvc-dev-cmd@v1` (v1.13.0,
  2024-01-01) and the image `postgres:18`. `actions/github-script@v8` is already
  used (`setup-build-script`).
- **Docs and workflows are formatted with Prettier**: run
  `corepack pnpm exec prettier --write <file>` on every Markdown, YAML, JSON or
  TypeScript file you touch, then `--check`. `tools/` is in `.prettierignore`
  except `tools/build-scripts` (3a un-ignores it), so Prettier skips `tools/ci`:
  copy those scripts exactly as given. The TypeScript and YAML below are
  Prettier-clean already, and the Scala passes `scalafmtSbtCheck`.
- **Commits** end with the executing session's attribution trailers:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx
  ```

  **PR bodies** end with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx
  ```

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
`git -C /c/Repos/Enso/ide worktree add <dir> -b <branch> origin/develop`, then
`corepack pnpm install --frozen-lockfile --ignore-scripts` inside it.

| PR  | Branch                       | Worktree    | Tasks | Needs merged first | Validated by                                                                                                       |
| --- | ---------------------------- | ----------- | ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 3a  | `ci/build-scripts-version`   | `ide-bs-3a` | 1–2   | —                  | `Build Scripts` CI; the version equals the one develop's build job published                                       |
| 3b  | `ci/toolchain-check`         | `ide-bs-3b` | 3–5   | 3a                 | `Build Scripts`, Workflow Lint; the awk-equivalence test on both hosts; `toolchain-check` run locally              |
| 3c  | `ci/changelog-github-script` | `ide-bs-3c` | 6     | —                  | the Changelog check with and without the label, and with a `CHANGELOG.md` change                                   |
| 3d  | `ci/stdlib-api-check`        | `ide-bs-3d` | 7     | 3a                 | ✨ Engine; a throwaway API change fails the check with `./run`'s message                                           |
| 3e  | `ci/check-enso-syntax`       | `ide-bs-3e` | 8     | —                  | ✨ Engine; the file count; a throwaway syntax error fails `checkEnsoSyntax` (WSL)                                  |
| 3f  | `ci/engine-distribution-sbt` | `ide-bs-3f` | 9–10  | 3a, 3d             | ✨ Engine on both platforms and a clean dispatch; the distribution file by file; the 7 DLLs on Windows             |
| 3g  | `ci/engine-bundle-sbt`       | `ide-bs-3g` | 11    | 3f                 | ✨ IDE; the bundle tree byte by byte against develop's, Linux and Windows                                          |
| 3h  | `ci/jvm-tests-direct`        | `ide-bs-3h` | 12    | 3f                 | ✨ Engine; the JVM test report counts against develop's, both platforms                                            |
| 3i  | `ci/ide-build`               | `ide-bs-3i` | 13    | 3g                 | ✨ IDE; installer names, package tests and the Windows smoke test as on develop                                    |
| 3j  | `ci/stdlib-test`             | `ide-bs-3j` | 14–15 | 3b, 3d, 3e, 3h     | the side-by-side: pass, fail **and skip** counts per project, `./run` against the runner, twice, Linux and Windows |

- 3c and 3e need nothing and can start at once. Work on the next PR while one is
  in CI (memory: work while CI runs); several may be open together.
- 3d, 3e, 3f, 3h and 3j all edit `engine-checks-platform.yml`; 3g and 3i both
  edit `ide-packaging.yml`; every PR edits a row of the `.github/CLAUDE.md`
  table "What still goes through `./run`". Whichever merges later brings its
  branch up to date without rewriting it,
  `git fetch origin && git merge --no-edit origin/develop`, keeps both sides,
  pushes and waits again.
- Each PR updates the row(s) of that table that it moves, with the cells its
  task gives. Find a row by its cells, not by its spacing, and run Prettier on
  the file afterwards.

The design branch `design/build-simplification` (worktree
`C:\Repos\Enso\ide-build`, draft PR #289) carries only the spec and the plans.

## What moves, and where

The code is `build_tools/cli/src/lib.rs` (dispatch),
`build_tools/build/src/ engine/context.rs` (`prepare_build_env`, `build`) and
the modules each row names. The CI evidence is develop's run 39666057183
(engine) and 39666057112 (IDE).

### `./run`'s work around every engine command, and who takes it over

| #   | What `./run` did                                                                                                                                                                                    | Phase 3 home                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Version: `ENSO_VERSION` if valid, else `<next stable>-dev` from `latest-release`; step outputs and process env                                                                                      | `tools/build-scripts` `version` (3a). The engine build job's version step keeps `id: build` (3f); every job that runs the download reads its outputs  |
| P2  | MSVC developer environment on Windows when `cl` is missing                                                                                                                                          | `setup-msvc` (3f): build, IDE backend, JVM tests                                                                                                      |
| P3  | sbt launcher; GraalVM at `graalVersion`; flatc                                                                                                                                                      | `setup-jvm` (Phase 2)                                                                                                                                 |
| P4  | GraalPy at `graalMavenPackagesVersion`, on every engine command                                                                                                                                     | `setup-jvm` `graalpy: "true"`, pinned by `toolchain.graalpy` (3b pin, 3j input), in the standard-library test jobs only: nothing else runs it         |
| P5  | `ENSO_TEST_JUNIT_DIR=<repo>/target/test-results` into `GITHUB_ENV` (every engine command)                                                                                                           | Set where read: the `sbt test` step (3h) and the standard-library jobs' `env` (3j)                                                                    |
| P6  | Windows: `CI_TEST_TIMEFACTOR=2`, `CI_TEST_FLAKY_ENABLE=true` (process env)                                                                                                                          | JVM tests: a Windows-only `GITHUB_ENV` step (3h). Standard-library tests: the runner, on Windows (3j)                                                 |
| P7  | `ENSO_LAUNCHER`: `native,test` forced for the distribution, `native,-ls` for EnsoJMH                                                                                                                | The build job's `env` keeps `native,test` (3f); the IDE backend keeps `native` (3g); the benchmark keeps `native,-ls` (Phase 2). Nothing else sets it |
| P8  | CI clean-ups: the global IR cache, `**/bench-report.xml`, `engine/runtime/target`, `built-distribution/`                                                                                            | No-ops on fresh hosted runners, as Phase 2's Ruling 16 found. The `stdlib-test` runner keeps the first two under `GITHUB_ACTIONS` (3j)                |
| P9  | Every sbt call: `LC_ALL=C.UTF-8 SBT_SERVER_FORCESTART=true sbt -Dbench.compileOnly=<…> -Dsbt.server.autostart=false "<tasks>"`; `all`/`clean;` batching on big-memory machines (hosted runners are) | Copied verbatim into each step, with each `-D` quoted for PowerShell                                                                                  |
| P10 | `pnpm install` in `tools/simple-library-server` (JVM tests only)                                                                                                                                    | A JVM-tests step (3h)                                                                                                                                 |

### Each `./run` call site in the pull-request workflows

| Workflow › job                                           | `./run` command                        | Becomes                                                                         | PR  |
| -------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- | --- |
| `changelog.yml` › Changelog                              | `changelog-check`                      | `actions/github-script`, `pulls.listFiles` (R-user-1)                           | 3c  |
| `engine-checks-platform.yml` › API check                 | `backend stdlib-api-check`             | `corepack pnpm --filter build-scripts run stdlib-api-check`                     | 3d  |
| `engine-checks-platform.yml` › Enso Code Lint            | `libraries check-syntax`               | `sbt checkEnsoSyntax` (R-user-2)                                                | 3e  |
| `engine-checks-platform.yml` › Build Engine Distribution | `backend ci-build-engine-distribution` | `version` (`id: build`), then `sbt "clean; all ciBuildEngineDistribution"` (R6) | 3f  |
| `ide-packaging.yml` › Build Backend                      | `backend get`                          | `version`, then `sbt "clean; all buildEngineBundle"`                            | 3g  |
| `engine-checks-platform.yml` › JVM Tests                 | `backend test jvm`                     | Workflow steps (R8)                                                             | 3h  |
| `ide-packaging.yml` › Package New IDE                    | `ide build --backend-source local …`   | `corepack pnpm --filter build-scripts run ide-build` (R11)                      | 3i  |
| `engine-checks-platform.yml` › Standard Library … Tests  | `backend test <suite>`                 | `corepack pnpm --filter build-scripts run stdlib-test <suite>` (R9)             | 3j  |
| the `setup-build-script` composite, every job above      | `./run --help`                         | Gone with the last `./run` step of each workflow (3c, 3i, 3j)                   | —   |

Generator-era files (`engine-checks-nightly.yml`, `extra-nightly-tests.yml`,
`macos-checks.yml`, `release.yml`, `promote.yml`) keep their `./run` calls until
Phase 4.

### The version hand-off

- The engine build job computes the version once (3f), in a step with
  `id: build` that writes `ENSO_VERSION`, `ENSO_EDITION` and `ENSO_RELEASE_MODE`
  to `GITHUB_OUTPUT` (the job's outputs read them) and to `GITHUB_ENV` (so the
  sbt step names the package by it).
- Every job that runs the downloaded distribution takes those outputs: the lint
  (already), the API check (3d), the JVM tests (3h, on every sbt step) and the
  standard-library tests (3j). Until 3h and 3j land, the `./run` jobs compute
  the same value themselves; a mismatch would make them miss the package, so a
  green run after 3f proves `version` agrees with `./run`.
- The IDE backend job computes its own (3g), as `./run backend get` did, and
  archives the bundle by it. `ide-build` computes its own too (3i), as
  `./run ide build` did.

## File map

| Path                                                                                                               | PR                 | Change                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| `tools/build-scripts/{package.json,tsconfig.json,vitest.config.ts,CLAUDE.md}`                                      | 3a                 | Create                                                                                  |
| `tools/build-scripts/src/lib/{repo,github}.ts` (+ tests)                                                           | 3a                 | Create: repository root, running programs, publishing                                   |
| `tools/build-scripts/src/version/{version,repository}.ts`, `version.test.ts`                                       | 3a                 | Create: the port of `version*.rs`                                                       |
| `tools/build-scripts/src/commands/version.ts`                                                                      | 3a                 | Create                                                                                  |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.prettierignore`                                                         | 3a                 | Register the package; un-ignore it                                                      |
| `.github/workflows/build-scripts.yml`                                                                              | 3a                 | Create                                                                                  |
| `tools/CLAUDE.md`, `.github/CLAUDE.md`                                                                             | 3a                 | The package; the workflow                                                               |
| `tools/ci/toolchain-pins.mjs`, `toolchain-pins.test.mjs`                                                           | 3b                 | Create: the one pin parser, and its awk-equivalence test                                |
| `tools/ci/check-workflows.mjs`, `.test.mjs`, `README.md`                                                           | 3b                 | Use it; `callsSbt`; `buildScriptsSbtCommands`; `checkBuildScriptsSpawnSbtThroughHelper` |
| `build-config.yaml`                                                                                                | 3b                 | `toolchain.graalpy`                                                                     |
| `tools/build-scripts/src/toolchain/check.ts` (+ test), `src/commands/toolchain-check.ts`                           | 3b                 | Create                                                                                  |
| `.github/workflows/workflow-lint.yml`                                                                              | 3b                 | Run on `tools/build-scripts/**` too                                                     |
| `.github/workflows/changelog.yml`                                                                                  | 3c                 | Rewrite                                                                                 |
| `tools/build-scripts/src/lib/engine.ts`, `src/stdlib-api-check/apiCheck.ts` (+ tests)                              | 3d                 | Create                                                                                  |
| `.github/actions/setup-build-scripts/action.yml`                                                                   | 3d                 | Create                                                                                  |
| `.github/workflows/engine-checks-platform.yml`                                                                     | 3d, 3e, 3f, 3h, 3j | One job each                                                                            |
| `.github/workflows/engine-changed-files.yml`                                                                       | 3d                 | `tools/build-scripts/**`                                                                |
| `project/EnsoSyntaxCheck.scala`, `build.sbt` (`checkEnsoSyntax`)                                                   | 3e                 | Create; register                                                                        |
| `project/MsvcRuntime.scala`, `project/GatherLicenses.scala`, `build.sbt` (`ciBuildEngineDistribution`)             | 3f                 | Create; `verifyPackageAt`; the task                                                     |
| `.github/actions/setup-msvc/action.yml`                                                                            | 3f                 | Create                                                                                  |
| `project/EngineBundle.scala`, `project/DistributionPackage.scala`, `build.sbt` (`buildEngineBundle`)               | 3g                 | Create; `localPlatform`; the task                                                       |
| `.github/workflows/ide-packaging.yml`                                                                              | 3g, 3i             | Build Backend; Package New IDE                                                          |
| `tools/build-scripts/src/ide-build/ideBuild.ts` (+ test), `src/commands/ide-build.ts`                              | 3i                 | Create                                                                                  |
| `tools/build-scripts/src/lib/sbt.ts`, `src/stdlib-test/*` (+ tests), `src/commands/{stdlib-test,junit-compare}.ts` | 3j                 | Create                                                                                  |
| `.github/actions/setup-jvm/action.yml`                                                                             | 3j                 | `graalpy` input                                                                         |
| `.github/workflows/engine-checks.yml`                                                                              | 3j                 | Matrix fields `small-jdk`, `postgres`, `mssql`                                          |
| `.github/CLAUDE.md`                                                                                                | all                | Each PR its rows of "What still goes through `./run`"                                   |
| `CLAUDE.md`, `build_tools/CLAUDE.md`                                                                               | 3b, Task 16        | The pins bullet; the CI paragraph                                                       |

## Reference: intended differences

`compare.sh` (Task 0) prints these for a correct change. A PR lists each one it
shows, with the reason given here. Anything not listed is a mistake.

| #   | PR  | Difference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Reason                                                                                                   |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| D11 | 3a  | Every job that uses `setup-node`: "Setup nodejs version" and "Install corepack" now on every OS, and a new "Check the Node version" step.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | I1 of the plan review: the images carry Node 22; `tools/build-scripts` runs on the pinned 24 everywhere. |
| D1  | 3a  | New workflow `build-scripts.yml`, job "Build Scripts".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | R3: CI must run the package's typecheck, lint and tests; the GUI gate does not cover `tools/`.           |
| D2  | 3b  | `workflow-lint.yml`: both path lists gain `tools/build-scripts/**`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The policy now reads the package (`buildScriptsSbtCommands`).                                            |
| D3  | 3c  | `changelog.yml`: the "Build Script (linux, amd64)" job, the workflow `env` and the Changelog job's checkout, `setup-build-script`, `git-clean` and `./run` steps are gone; one `actions/github-script` step; `permissions: contents: read, pull-requests: read`.                                                                                                                                                                                                                                                                                                                                                   | R-user-1.                                                                                                |
| D4  | 3d  | API check: `needs` loses `build-script`; `setup-build-script` becomes `setup-node` (before Clean) and `setup-build-scripts` (after); `./run backend stdlib-api-check` becomes "Check the Standard Library API" with `ENSO_VERSION` from the build job; no `GITHUB_TOKEN`. `engine-changed-files.yml` lists `tools/build-scripts/**`.                                                                                                                                                                                                                                                                               | The move; the API check now runs code from that package.                                                 |
| D5  | 3e  | Enso Code Lint: `needs` loses `build-script`; `setup-build-script` becomes `setup-node`; `setup-jvm` moves before "Check syntax", which runs `sbt "-Dsbt.server.autostart=false" checkEnsoSyntax`.                                                                                                                                                                                                                                                                                                                                                                                                                 | R-user-2; must-carry 9.                                                                                  |
| D6  | 3f  | Build Engine Distribution: `needs` and `GRAAL_EDITION` gone; steps `setup-node`, `setup-build-scripts`, `setup-jvm` (`build-engine-distribution`, flatc), `setup-msvc`, "Compute the version" (`id: build`), "Build the engine distribution"; no `GITHUB_TOKEN`. Outputs unchanged.                                                                                                                                                                                                                                                                                                                                | R5, R6, R7.                                                                                              |
| D7  | 3g  | Build Backend: `needs: [build-script]` and its `if` gone; the hand-written sbt cache steps become `setup-jvm`'s (`build-backend`); `setup-build-script` becomes `setup-node` + `setup-build-scripts`; `setup-msvc`; "Compute the version" (`id: version`); "Build the engine bundle"; the archive is taken from the bundle directory.                                                                                                                                                                                                                                                                              | The move. `setup-jvm`'s cache is per job (Phase 2 Ruling 8).                                             |
| D8  | 3h  | JVM Tests: `needs` and `GRAAL_EDITION` gone; `./run backend test jvm` becomes the steps of Note [JVM Tests Without ./run]; the reporter's path is `target/test-results/*.xml`.                                                                                                                                                                                                                                                                                                                                                                                                                                     | R8.                                                                                                      |
| D9  | 3i  | `ide-packaging.yml`: "Build Script (linux/windows, amd64)" jobs and `ENSO_BUILD_SKIP_VERSION_CHECK` gone; Package New IDE `needs`/`if` lose `build-script`; `setup-build-script` becomes `setup-node` + `setup-build-scripts`; the two `./run ide build` steps become "Package the IDE" (`ide-build`) with the same `env`.                                                                                                                                                                                                                                                                                         | R11.                                                                                                     |
| D10 | 3j  | Standard Library tests: one Linux job (`stdlib-tests`, with `services:` postgres and sqlserver) and one Windows job (`stdlib-tests-windows`), same display names; new steps (setup-build-scripts, setup-jvm with GraalPy, small JDK, SQL Server wait, `stdlib-test`); job `env` gains `ENSO_TEST_JUNIT_DIR`. "Build Script (…)" jobs and `ENSO_BUILD_SKIP_VERSION_CHECK` gone. `engine-checks.yml`: matrix entries gain `small-jdk`, `postgres`, `mssql`. `setup-jvm`: `graalpy` input. Each platform's call also shows the other OS's job as one skipped check (its `if:` is false, so its matrix never expands). | R9, R10.                                                                                                 |

---

### Task 0: Preconditions, tools and the develop baseline

**Files:** none in the repository. Creates `$SCRATCH/wait-pr.sh`,
`$SCRATCH/job-times.sh`, `$SCRATCH/compare.sh`, `$SCRATCH/report-titles.sh`,
`$SCRATCH/list-tree.sh`, `$SCRATCH/compare-trees.sh` and `$SCRATCH/baseline.md`.

**Interfaces:**

- Produces:
  - `wait-pr.sh <pr> [max-minutes]` — exits 0 when all checks passed, 1 when
    some failed, 2 on timeout;
  - `job-times.sh <run-id>` — `conclusion<TAB>minutes<TAB>job name` per job;
  - `compare.sh <worktree> <workflow file>…` — the job-by-job comparison against
    `origin/develop`, as Markdown;
  - `report-titles.sh <sha>` — the test reporters' check runs on a commit, name
    and title (`N passed, M failed, K skipped`);
  - `list-tree.sh <dir>` and `compare-trees.sh <old> <new>` — the byte-level
    bundle listing and its comparison (3g);
  - `baseline.md` — develop's run IDs, job times and report titles.

- [ ] **Step 1: Check the starting point**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide log --oneline -1 origin/develop
for wf in changelog engine-checks-platform ide-packaging; do
  echo "$wf: $(git -C /c/Repos/Enso/ide grep -nE '^\s*(- )?run: .*\./run( |$)' origin/develop -- .github/workflows/$wf.yml | wc -l)"
done
gh pr list --state open --search "build simplification" --json number,title --jq '.[] | "\(.number)\t\(.title)"'
```

Expected: develop at or after `2e89229ef6` ("Phase 2 review tidy-up"). The
counts are `changelog: 1`, `engine-checks-platform: 5`, `ide-packaging: 3`: the
`run:` lines of "Each `./run` call site" (the pattern counts only steps that
execute `./run`, not the Notes and descriptions that mention it). No Phase 3 PR
is open yet. If the grep differs, stop and report: develop moved under this
plan.

- [ ] **Step 2: Check the tools**

```bash
wsl -e bash -lc 'ls ~/tools/actionlint-1.7.12/actionlint ~/tools/shellcheck-v0.11.0/shellcheck && . ~/.enso-toolchain.sh && node --version && java -version 2>&1 | head -2 && command -v sbt cargo awk'
node --version && command -v awk
```

Expected: both binaries; Node 24.21.0 on both hosts; GraalVM CE 25.0.1, sbt and
cargo in WSL; `awk` on the Windows (Git Bash) PATH. If actionlint or shellcheck
is missing, install it as the Phase 0–1 plan's Task 0 did.

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

`$SCRATCH/compare.sh` restores the comparison script that #303 deleted, runs it
from the worktree, and deletes it again (Phase 2 Ruling 11):

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

`$SCRATCH/report-titles.sh`:

```bash
#!/usr/bin/env bash
# Usage: report-titles.sh <commit-sha>
# The test reporters' check runs on a commit (dorny/test-reporter): name and title, which holds
# the passed, failed and skipped counts.
gh api "repos/{owner}/{repo}/commits/$1/check-runs?per_page=100" --paginate \
  --jq '.check_runs[] | select(.name | test("Tests Report")) | "\(.name)\t\(.output.title)"' | sort
```

`$SCRATCH/list-tree.sh` and `$SCRATCH/compare-trees.sh` (both tested on Git Bash
and WSL, and shellcheck-clean):

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: list-tree.sh <dir> > listing.tsv
# One tab-separated line per entry under <dir>, sorted by path: a directory is `d<TAB>path`, a
# symlink `l<TAB>path<TAB>target`, a file `f<TAB>path<TAB>size<TAB>sha256<TAB>x|-` (x when
# executable). Modification times are left out. On Windows (Git Bash) the executable bit follows
# the extension, the same on both sides of a comparison.
set -euo pipefail
cd "$1"
export LC_ALL=C
find . -mindepth 1 -print0 | sort -z | while IFS= read -r -d '' p; do
  rel=${p#./}
  if [ -L "$p" ]; then
    printf 'l\t%s\t%s\n' "$rel" "$(readlink "$p")"
  elif [ -d "$p" ]; then
    printf 'd\t%s\n' "$rel"
  else
    x=-
    [ -x "$p" ] && x=x
    printf 'f\t%s\t%s\t%s\t%s\n' "$rel" "$(stat -c %s "$p")" "$(sha256sum "$p" | cut -d' ' -f1)" "$x"
  fi
done
```

`$SCRATCH/compare-trees.sh`:

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: compare-trees.sh <old listing> <new listing>   (listings from list-tree.sh)
# The two trees must have the same entries, types, symlink targets and executable bits. A file's
# content may differ only where the build is not byte-reproducible: native images and libraries,
# jars, IR caches and indexes (NONDETERMINISTIC, matched against the path). Prints every other
# difference; exits 1 if there is any.
set -euo pipefail
export LC_ALL=C
NONDETERMINISTIC='([.](exe|dll|so|dylib|jar|ir|bindings)$)|(^dist/[^/]+/bin/enso$)|(/[.]enso/)|([.]enso-index)'
shape() { awk -F'\t' '$1 == "f" { print $1 "\t" $2 "\t" $5; next } { print }' "$1"; }
status=0
if ! diff <(shape "$1") <(shape "$2") > /dev/null; then
  echo "== entries, types or executable bits differ:"
  diff <(shape "$1") <(shape "$2") | head -50 || true
  status=1
fi
content() { awk -F'\t' '$1 == "f" { print $2 "\t" $3 "\t" $4 }' "$1" | sort; }
changed=$(join -t $'\t' <(content "$1") <(content "$2") | awk -F'\t' '$3 != $5 { print $1 "\t" $2 "\t" $4 }')
expected=$(awk -F'\t' -v re="$NONDETERMINISTIC" '$1 ~ re' <<< "$changed")
unexpected=$(awk -F'\t' -v re="$NONDETERMINISTIC" '$1 != "" && $1 !~ re' <<< "$changed")
echo "== $(grep -c . <<< "$expected" || true) files differ where the build is not reproducible (path, old size, new size):"
head -20 <<< "$expected"
if [ -n "$unexpected" ]; then
  echo "== files that should be identical but differ (path, old size, new size):"
  echo "$unexpected"
  status=1
fi
exit $status
```

Make them executable with `chmod +x "$SCRATCH"/*.sh`, and check `compare.sh`:

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-p3base --detach origin/develop
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-p3base .github/workflows/changelog.yml | head -20
git -C /c/Repos/Enso/ide-bs-p3base status --short
```

Expected: a Markdown report with no differences, and an empty `git status`. Keep
`ide-bs-p3base` (detached at develop) for the baseline listings of Tasks 11 and
12; remove it in Task 16.

- [ ] **Step 4: Record the develop baseline**

```bash
for wf in engine-pull-request.yml ide-pull-request.yml changelog.yml workflow-lint.yml formatting.yml; do
  id=$(gh run list --workflow "$wf" --branch develop -L 1 --json databaseId --jq '.[0].databaseId')
  echo "## $wf — run $id"; "$SCRATCH/job-times.sh" "$id"; echo
done > "$SCRATCH/baseline.md"
sha=$(gh run list --workflow engine-pull-request.yml --branch develop -L 1 --json headSha --jq '.[0].headSha')
{ echo "## report titles at $sha"; "$SCRATCH/report-titles.sh" "$sha"; } >> "$SCRATCH/baseline.md"
cat "$SCRATCH/baseline.md"
```

Expected (develop, 2026-10-21): every engine and IDE job green. Approximate
times: Build Engine Distribution 30 min (Linux), 45 (Windows); JVM Tests 35 and
50; Standard Library Native 46 / 51, JVM 37 / 45, Microsoft 9, AWS 6 / 10; Build
Backend 30 / 45. The report titles hold one "Engine Tests Report" per platform
and one "Standard Library Tests Report" per platform (the matrix legs share the
name, so the API returns one run per leg). If a baseline run is red for a reason
unrelated to this plan, record it; "When a check fails" uses it.

Nothing is committed in this task.

---

### Task 1: The `tools/build-scripts` package and its `version` command (PR 3a)

**Files:**

- Create: `tools/build-scripts/package.json`, `tsconfig.json`,
  `vitest.config.ts`, `CLAUDE.md`
- Create: `tools/build-scripts/src/lib/repo.ts`, `src/lib/repo.test.ts`,
  `src/lib/github.ts`, `src/lib/github.test.ts`
- Create: `tools/build-scripts/src/version/version.ts`, `version.test.ts`,
  `repository.ts`
- Create: `tools/build-scripts/src/commands/version.ts`
- Modify: `pnpm-workspace.yaml` (`packages:`), `.prettierignore` (`tools`),
  `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**

- Produces (later tasks import these exact names):
  - `src/lib/repo.ts`: `REPO_ROOT: string`;
    `capture(program, args, options?): { status: number; stdout: string; stderr: string }`
    (status -1 when the program cannot start);
    `runInherited(program, args, options?): number`;
    `invocation(program, args, platform?)`; `windowsCommandLine(program, args)`;
    `commandArguments(argv?): string[]` (drops the `--` pnpm passes on).
    `options` is `{ cwd?: string; env?: NodeJS.ProcessEnv }`; the default cwd is
    `REPO_ROOT`.
  - `src/lib/github.ts`:
    `publish(values: Record<string, string>, env?, print?)`, `envFileEntry`,
    `exportLine`.
  - `src/version/version.ts`: `Version` (`text`, `major`, `minor`, `patch`,
    `pre`, `build`), `Day`, `Versions` (`version`, `releaseMode`),
    `parseVersion`, `version`, `makeVersion`, `compareVersions`, `maxVersion`,
    `sameCore`, `kindMatches`, `deduceKind`, `isReleaseMode`, `parseNightly`,
    `formatNightly`, `nextNightlyIndex`, `incrementRc`,
    `generateVersion( designation: 'stable' | 'patch' | 'rc' | 'nightly', versions, today)`,
    `deduceOrGenerate({ env, releases, today })`, `latestReleaseFromConfig`,
    `parseLsRemoteTags`, `todayUtc`.
  - `src/version/repository.ts`: `repositoryVersions(env?, now?): Versions`.
  - The script `version`: `corepack pnpm --filter build-scripts run version`.

- [ ] **Step 1: Create the worktree, and register the package**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3a -b ci/build-scripts-version origin/develop
cd /c/Repos/Enso/ide-bs-3a
```

In `pnpm-workspace.yaml`, in `packages:`, insert `  - tools/build-scripts`
before `  - tools/simple-library-server`.

In `.prettierignore`, replace the line `tools` with these two lines (Prettier
follows `.gitignore` rules: a file under an ignored directory cannot be
re-included, but a child of an ignored `tools/*` can):

```
tools/*
!tools/build-scripts
```

- [ ] **Step 2: Write the package files**

`tools/build-scripts/package.json` (3a's scripts; later PRs add theirs between
`version` and `test:unit`):

<!-- prettier-ignore -->
```json
{
  "name": "build-scripts",
  "version": "0.0.0",
  "private": true,
  "description": "The build logic that leaves ./run: version, toolchain-check and the CI commands.",
  "type": "module",
  "scripts": {
    "version": "node src/commands/version.ts",
    "test:unit": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --cache --max-warnings=0"
  },
  "dependencies": {
    "semver": "^7.8.5",
    "yaml": "2.9.1"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/semver": "^7.5.8",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Every version is already in the lockfile (`semver` 7.8.5 and `@types/semver`
7.5.8 from `app/electron-client`, `yaml` 2.9.1 from the root), so nothing new is
downloaded and the two-week rule is met. There is no `tsx` (R3).

`tools/build-scripts/tsconfig.json` (3a's; 3b adds `"allowJs": true`):

<!-- prettier-ignore -->
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"],
    "noEmit": true,
    "composite": false,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true
  },
  "include": ["./src", "./vitest.config.ts"]
}
```

`tools/build-scripts/vitest.config.ts`:

<!-- prettier-ignore -->
```ts
/** @file Vitest configuration for the build scripts: plain Node, no DOM. */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

`tools/build-scripts/CLAUDE.md`:

<!-- prettier-ignore -->
````markdown
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
  parameter properties, and relative imports end in `.ts`. Node runs the
  sources directly; there is no build step and no `compile` script.
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
````

- [ ] **Step 3: Install, and write the failing tests**

```bash
cd /c/Repos/Enso/ide-bs-3a && corepack pnpm install --ignore-scripts
git diff --stat pnpm-lock.yaml
```

Expected: `pnpm-lock.yaml` gains one importer, `tools/build-scripts`, with the
six dependencies above at `semver 7.8.5`, `yaml 2.9.1`, `@types/node 24.12.2`,
`@types/semver 7.5.8`, `typescript 6.0.3` and `vitest 3.2.4`; nothing else
changes.

Write the tests:

<!-- prettier-ignore -->
```ts
/** @file The version rules, ported from the Rust tests and pinned to today's behaviour. */
import { describe, expect, test } from 'vitest'
import {
  type Day,
  type Designation,
  deduceKind,
  deduceOrGenerate,
  generateVersion,
  incrementRc,
  isReleaseMode,
  kindMatches,
  latestReleaseFromConfig,
  nextNightlyIndex,
  parseLsRemoteTags,
  parseNightly,
  parseVersion,
  sameCore,
  version,
} from './version.ts'

const day = (text: string): Day => {
  const [year, month, d] = text.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 0, day: d ?? 0 }
}

describe('generateVersion (promote.rs test_version_generation)', () => {
  const cases: [string, string[], Designation, string][] = [
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'stable', '2021.2.1'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'patch', '2021.1.3'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'rc', '2021.2.1-rc.1'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'nightly', '2021.2.1-nightly.2021.2.22'],
    [
      '2021-02-22',
      ['2021.1.1', '2021.1.2', '2021.2.1-nightly.2021.2.22'],
      'nightly',
      '2021.2.1-nightly.2021.2.22.1',
    ],
    [
      '2021-02-23',
      ['2021.1.1', '2021.1.2', '2021.2.1-nightly.2021.2.22'],
      'nightly',
      '2021.2.1-nightly.2021.2.23',
    ],
    // Origin's real tags on 2026-10-22: rc.1-rc.4 and no stable release.
    [
      '2026-10-22',
      ['2026.1.1-rc.1', '2026.1.1-rc.2', '2026.1.1-rc.3', '2026.1.1-rc.4'],
      'rc',
      '2026.1.1-rc.5',
    ],
    ['2026-10-22', ['2026.1.1-rc.4'], 'stable', '2026.1.1'],
    ['2026-10-22', ['2026.1.1-rc.4'], 'nightly', '2026.1.1-nightly.2026.10.22'],
    // Upstream's old dashed nightlies never parse as nightlies.
    ['2022-02-21', ['2022.1.1-nightly.2022-02-21'], 'nightly', '2022.1.1-nightly.2022.2.21'],
    // A new year resets the minor.
    ['2026-01-05', ['2025.3.4'], 'stable', '2026.1.1'],
  ]
  for (const [today, existing, designation, expected] of cases) {
    test(`${designation} on ${today} after [${existing.join(', ')}] is ${expected}`, () => {
      expect(generateVersion(designation, existing.map(version), day(today)).text).toBe(expected)
    })
  }
  test('patch without a stable release fails', () => {
    expect(() => generateVersion('patch', [version('2026.1.1-rc.4')], day('2026-10-22'))).toThrow(
      'No stable releases found.',
    )
  })
  test('an upstream-style rc1 (which sorts above rc.4) fails the rc designation', () => {
    const tags = ['2026.1.1-rc.4', '2026.1.1-rc1'].map(version)
    expect(() => generateVersion('rc', tags, day('2026-10-22'))).toThrow(
      'RC version has an unexpected prerelease: 2026.1.1-rc1.',
    )
  })
  test('a version from the future fails', () => {
    expect(() => generateVersion('stable', [version('2027.1.1')], day('2026-01-01'))).toThrow(
      'Found version from the future: 2027.1.1.',
    )
  })
})

describe('parseNightly (nightly.rs parsing_nightly_prerelease)', () => {
  test('a date', () => {
    expect(parseNightly(version('2020.1.1-nightly.2020.12.31'))).toEqual({
      date: { year: 2020, month: 12, day: 31 },
      index: null,
    })
  })
  test('a date and an index', () => {
    expect(parseNightly(version('2020.1.1-nightly.2020.12.31.1'))).toEqual({
      date: { year: 2020, month: 12, day: 31 },
      index: 1,
    })
  })
  for (const bad of [
    '2020.1.1-nightly.2020.12.31.1.1',
    '2020.1.1-nightly.12.31',
    '2020.1.1',
    '2020.1.1-rc.1',
    '2020.1.1-nightly.2020.2.30',
  ]) {
    test(`rejects ${bad}`, () => expect(() => parseNightly(version(bad))).toThrow())
  }
  test('next index (nightly.rs doc test)', () => {
    expect(nextNightlyIndex(null)).toBe(1)
    expect(nextNightlyIndex(1)).toBe(2)
  })
})

describe('kinds (version.rs doc tests and is_nightly_test)', () => {
  test('matches', () => {
    expect(kindMatches('nightly', version('2022.1.1-nightly.2022.1.1'))).toBe(true)
    expect(kindMatches('nightly', version('2022.1.1-nightly'))).toBe(true)
    expect(kindMatches('rc', version('2022.1.1-rc.1'))).toBe(true)
    expect(kindMatches('nightly', version('2022.1.1-rc.1'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1-rc.1'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1-nightly'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1'))).toBe(true)
  })
  test('deduce', () => {
    expect(deduceKind(version('2022.1.1-dev'))).toBe('dev')
    expect(deduceKind(version('2022.1.1-nightly.2022.1.1'))).toBe('nightly')
    expect(deduceKind(version('2022.1.1-nightly.2022-06-06.3'))).toBe('nightly')
    expect(deduceKind(version('2022.1.1-rc.1'))).toBe('rc')
    expect(deduceKind(version('2022.1.1'))).toBe('stable')
    expect(() => deduceKind(version('1.0.0-beta'))).toThrow('Failed to deduce build kind')
  })
  test('incrementRc and sameCore', () => {
    expect(incrementRc(version('0.2.3-rc.1')).text).toBe('0.2.3-rc.2')
    expect(sameCore(version('1.2.3'), version('1.2.3'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.3-beta'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.3+build'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.4'))).toBe(false)
  })
  test('release mode', () => {
    expect(isReleaseMode(version('2026.1.1-dev'))).toBe(false)
    expect(isReleaseMode(version('2026.1.1-SNAPSHOT'))).toBe(false)
    expect(isReleaseMode(version('2026.1.1-nightly.2026.1.1'))).toBe(true)
    expect(isReleaseMode(version('2026.1.1-rc.1'))).toBe(true)
    expect(isReleaseMode(version('2026.1.1'))).toBe(true)
  })
})

describe('parseVersion: strict, as the Rust semver crate', () => {
  for (const bad of ['', 'foo', 'v2026.1.1', ' 2026.1.1', '2026.01.1', '2026.1', '=2026.1.1']) {
    test(`rejects ${JSON.stringify(bad)}`, () => expect(parseVersion(bad)).toBeNull())
  }
  test('keeps build metadata in the text', () => {
    expect(parseVersion('1.2.3+b.1')).toMatchObject({ text: '1.2.3+b.1', build: 'b.1', pre: '' })
  })
})

describe('deduceOrGenerate', () => {
  const releases = () => [version('2025.3.4')]
  const today = day('2026-10-22')
  test('a dev build follows latest-release: 2026.1.1-dev today', () => {
    const result = deduceOrGenerate({ env: {}, releases, today })
    expect(result.version.text).toBe('2026.1.1-dev')
    expect(result.releaseMode).toBe(false)
  })
  test('the same configuration in 2025 gives 2025.4.1-dev', () => {
    expect(deduceOrGenerate({ env: {}, releases, today: day('2025-06-01') }).version.text).toBe(
      '2025.4.1-dev',
    )
  })
  test('ENSO_VERSION wins, and its release mode follows from it', () => {
    const result = deduceOrGenerate({ env: { ENSO_VERSION: '2026.2.0' }, releases, today })
    expect(result).toMatchObject({ version: { text: '2026.2.0' }, releaseMode: true })
  })
  test('ENSO_EDITION equal to ENSO_VERSION is accepted', () => {
    const env = { ENSO_VERSION: '2026.2.0', ENSO_EDITION: '2026.2.0' }
    expect(deduceOrGenerate({ env, releases, today }).version.text).toBe('2026.2.0')
  })
  for (const edition of ['x', '']) {
    test(`ENSO_EDITION=${JSON.stringify(edition)} beside ENSO_VERSION fails`, () => {
      const env = { ENSO_VERSION: '2026.2.0', ENSO_EDITION: edition }
      expect(() => deduceOrGenerate({ env, releases, today })).toThrow(
        'Inconsistent ENSO_VERSION and ENSO_EDITION variable values.',
      )
    })
  }
  for (const ignored of ['', 'foo', 'v2026.1.1']) {
    test(`ENSO_VERSION=${JSON.stringify(ignored)} is ignored, silently`, () => {
      const env = { ENSO_VERSION: ignored, ENSO_EDITION: 'anything' }
      expect(deduceOrGenerate({ env, releases, today }).version.text).toBe('2026.1.1-dev')
    })
  }
  test('releases are not read when ENSO_VERSION applies', () => {
    const fail = () => {
      throw new Error('read')
    }
    const env = { ENSO_VERSION: '2026.2.0' }
    expect(deduceOrGenerate({ env, releases: fail, today }).version.text).toBe('2026.2.0')
  })
})

describe('latestReleaseFromConfig', () => {
  test('reads the key', () => {
    expect(
      latestReleaseFromConfig('wasm-size-limit: 16.20 MiB\nlatest-release: 2025.3.4\n')?.text,
    ).toBe('2025.3.4')
  })
  test('is null without the key, and fails on a value that is not a version', () => {
    expect(latestReleaseFromConfig('toolchain:\n  sbt: 1.10.6\n')).toBeNull()
    expect(() => latestReleaseFromConfig('latest-release: 2025.3\n')).toThrow('is not a version')
  })
})

describe('parseLsRemoteTags', () => {
  test('keeps strict SemVer tags, once each, and skips the rest', () => {
    const stdout = [
      'a1\trefs/tags/2026.1.1-rc.1',
      'a2\trefs/tags/2026.1.1-rc.1^{}',
      'a3\trefs/tags/enso-0.2.0',
      'a4\trefs/tags/2022.1.1-nightly.2022-02-21',
      'a5\tHEAD',
      '',
    ].join('\n')
    expect(parseLsRemoteTags(stdout).map((v) => v.text)).toEqual([
      '2026.1.1-rc.1',
      '2022.1.1-nightly.2022-02-21',
    ])
  })
  test('fails on a malformed line, and on an unknown ref', () => {
    expect(() => parseLsRemoteTags('a1 refs/tags/x extra\n')).toThrow('Unexpected')
    expect(() => parseLsRemoteTags('a1\trefs/notes/x\n')).toThrow('Unknown ref name')
  })
})
```

`tools/build-scripts/src/lib/github.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Publishing to GitHub Actions' files, and locally as `export` lines. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { envFileEntry, exportLine, publish } from './github.ts'

test('an env-file entry uses the delimiter form', () => {
  expect(envFileEntry('ENSO_VERSION', '2026.1.1-dev', 'D')).toBe(
    'ENSO_VERSION<<D\n2026.1.1-dev\nD\n',
  )
})

test('an export line quotes the value', () => {
  expect(exportLine('A', "it's")).toBe("export A='it'\\''s'")
})

test('in GitHub Actions, every value goes to GITHUB_OUTPUT and GITHUB_ENV', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-'))
  const output = path.join(dir, 'output')
  const env = path.join(dir, 'env')
  writeFileSync(output, '')
  writeFileSync(env, '')
  const printed: string[] = []
  publish(
    { ENSO_VERSION: '2026.1.1-dev', ENSO_RELEASE_MODE: 'false' },
    { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output, GITHUB_ENV: env },
    (line) => printed.push(line),
  )
  expect(printed).toEqual(['ENSO_VERSION=2026.1.1-dev', 'ENSO_RELEASE_MODE=false'])
  for (const file of [output, env]) {
    expect(readFileSync(file, 'utf8')).toMatch(
      /^ENSO_VERSION<<(ghadelimiter_[0-9a-f-]+)\n2026\.1\.1-dev\n\1\nENSO_RELEASE_MODE<<(ghadelimiter_[0-9a-f-]+)\nfalse\n\2\n$/,
    )
  }
})

test('outside GitHub Actions, it prints export lines and writes nothing', () => {
  const printed: string[] = []
  publish({ ENSO_VERSION: '2026.1.1-dev' }, {}, (line) => printed.push(line))
  expect(printed).toEqual(["export ENSO_VERSION='2026.1.1-dev'"])
})
```

`tools/build-scripts/src/lib/repo.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Locating the repository, and starting programs on Windows. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { commandArguments, invocation, REPO_ROOT, windowsCommandLine } from './repo.ts'

test('REPO_ROOT is the repository root', () => {
  expect(existsSync(path.join(REPO_ROOT, 'build-config.yaml'))).toBe(true)
  expect(existsSync(path.join(REPO_ROOT, 'tools', 'build-scripts', 'package.json'))).toBe(true)
})

test('Windows shims go through the shell, as one command line', () => {
  expect(invocation('corepack', ['pnpm', 'run', 'build:ide'], 'win32')).toEqual({
    file: 'corepack pnpm run build:ide',
    args: [],
    shell: true,
  })
  expect(invocation('sbt', ['-Dsbt.server.autostart=false', 'a b'], 'win32').file).toBe(
    'sbt -Dsbt.server.autostart=false "a b"',
  )
})

test('everything else starts directly', () => {
  expect(invocation('git', ['diff'], 'win32')).toEqual({
    file: 'git',
    args: ['diff'],
    shell: false,
  })
  expect(invocation('corepack', ['pnpm'], 'linux')).toEqual({
    file: 'corepack',
    args: ['pnpm'],
    shell: false,
  })
})

test('an argument with a double quote is refused', () => {
  expect(() => windowsCommandLine('sbt', ['say "hi"'])).toThrow('double quote')
})

test("a command's arguments, without the `--` pnpm passes on", () => {
  expect(commandArguments(['node', 'x.ts', '--', 'std-aws', '--dry-run'])).toEqual([
    'std-aws',
    '--dry-run',
  ])
  expect(commandArguments(['node', 'x.ts', 'std-aws'])).toEqual(['std-aws'])
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | tail -15`

Expected: FAIL. Every file reports `Failed to resolve import "./version.ts"` (or
`./github.ts`, `./repo.ts`).

- [ ] **Step 5: Write the implementation**

`tools/build-scripts/src/lib/repo.ts`:

<!-- prettier-ignore -->
```ts
/** @file The repository root, and running other programs from the build scripts. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * The repository root. `corepack pnpm --filter build-scripts run …` runs a command in this
 * package's directory, so nothing here may resolve paths against `process.cwd()`.
 */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** What a finished program returned. */
export interface Captured {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** Options for {@link capture} and {@link runInherited}. */
export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Programs that are `.cmd`/`.bat` shims on Windows. Only the shell resolves those; Node finds a
 * `.exe` (`java`, `git`, `enso.exe`) by itself.
 */
const WINDOWS_SHIMS = new Set(['corepack', 'npm', 'npx', 'pnpm', 'sbt'])

/**
 * A command line for `cmd.exe`. An argument with blanks or `cmd` syntax is double-quoted; one with
 * a double quote is refused rather than escaped, since no caller needs it.
 */
export function windowsCommandLine(program: string, args: readonly string[]): string {
  const quote = (arg: string) => {
    if (arg.includes('"')) throw new Error(`Cannot pass an argument with a double quote: ${arg}`)
    return arg === '' || /[\s&|<>^()%!]/.test(arg) ? `"${arg}"` : arg
  }
  return [program, ...args].map(quote).join(' ')
}

/** How to start `program`: through the shell for a Windows shim, directly otherwise. */
export function invocation(
  program: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { readonly file: string; readonly args: string[]; readonly shell: boolean } {
  if (platform === 'win32' && WINDOWS_SHIMS.has(program)) {
    return { file: windowsCommandLine(program, args), args: [], shell: true }
  }
  return { file: program, args: [...args], shell: false }
}

/** Runs a program to completion and returns its output. A program that cannot start has status -1. */
export function capture(
  program: string,
  args: readonly string[],
  options: RunOptions = {},
): Captured {
  const how = invocation(program, args)
  const result = spawnSync(how.file, how.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: how.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.error != null ? -1 : (result.status ?? -1),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** Runs a program with this process's stdout and stderr, and returns its exit status. */
export function runInherited(
  program: string,
  args: readonly string[],
  options: RunOptions = {},
): number {
  const how = invocation(program, args)
  const result = spawnSync(how.file, how.args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    shell: how.shell,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  return result.error != null ? -1 : (result.status ?? -1)
}

/**
 * This command's arguments. `corepack pnpm run <script> -- <args>` passes the `--` on, which
 * would end option parsing, so a leading one is dropped.
 */
export function commandArguments(argv: readonly string[] = process.argv): string[] {
  const args = argv.slice(2)
  return args[0] === '--' ? args.slice(1) : args
}
```

`tools/build-scripts/src/lib/github.ts`:

<!-- prettier-ignore -->
```ts
/** @file Publishing values the way `./run` did: GitHub Actions files in CI, `export` lines locally. */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

/**
 * One `NAME<<delimiter … delimiter` entry, the multi-line form GitHub reads from `GITHUB_OUTPUT` and
 * `GITHUB_ENV` (the form `ide_ci::actions::env_file` wrote).
 */
export function envFileEntry(name: string, value: string, delimiter: string): string {
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`
}

/** A POSIX shell `export` line; the value is single-quoted. */
export function exportLine(name: string, value: string): string {
  return `export ${name}='${value.replaceAll("'", "'\\''")}'`
}

/**
 * Publishes `values`. In GitHub Actions (`GITHUB_ACTIONS=true`) each one is appended to
 * `GITHUB_OUTPUT` (the step's outputs) and to `GITHUB_ENV` (the job's later steps), and logged.
 * Elsewhere it prints `export` lines, for `eval "$(…)"`.
 */
export function publish(
  values: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
  print: (line: string) => void = console.log,
): void {
  const inActions = env.GITHUB_ACTIONS === 'true'
  for (const [name, value] of Object.entries(values)) {
    if (!inActions) {
      print(exportLine(name, value))
      continue
    }
    print(`${name}=${value}`)
    for (const file of [env.GITHUB_OUTPUT, env.GITHUB_ENV]) {
      if (file) appendFileSync(file, envFileEntry(name, value, `ghadelimiter_${randomUUID()}`))
    }
  }
}
```

`tools/build-scripts/src/version/version.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The Enso version: a port of `build_tools/build/src/version.rs`, `version/promote.rs` and
 * `version/nightly.rs`. `ENSO_VERSION` wins when it is a valid version; otherwise a build is
 * `<next stable>-dev`, where the next stable follows `latest-release` in `build-config.yaml` (or,
 * without that key, the repository's remote tags). `generateVersion` also covers the nightly, rc,
 * stable and patch designations, which Phase 4's `promote` uses.
 */
import semver from 'semver'
import { parse as parseYaml } from 'yaml'

/**
 * Strict SemVer 2.0.0, as Rust's `semver` crate parses it: no leading `v` or `=`, no surrounding
 * whitespace, no leading zeros in numeric identifiers. npm's `semver.parse` accepts `v1.2.3` and
 * padded input, so every input is checked against this first.
 */
export const STRICT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** A parsed version. `text` is the input, verbatim: npm's `SemVer.version` would drop the build. */
export interface Version {
  readonly text: string
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** The prerelease identifiers joined by `.`, or `''`. */
  readonly pre: string
  /** The build metadata identifiers joined by `.`, or `''`. */
  readonly build: string
}

/** A calendar day in UTC. */
export interface Day {
  readonly year: number
  readonly month: number
  readonly day: number
}

/** `text` as a version, or `null` when it is not strict SemVer. */
export function parseVersion(text: string): Version | null {
  const match = STRICT_SEMVER.exec(text)
  if (match == null) return null
  return {
    text,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? '',
    build: match[5] ?? '',
  }
}

/** `text` as a version; throws when it is not strict SemVer. */
export function version(text: string): Version {
  const parsed = parseVersion(text)
  if (parsed == null) throw new Error(`Not a valid version: ${text}`)
  return parsed
}

/** A version from its parts. */
export function makeVersion(
  major: number,
  minor: number,
  patch: number,
  pre = '',
  build = '',
): Version {
  return version(`${major}.${minor}.${patch}${pre ? `-${pre}` : ''}${build ? `+${build}` : ''}`)
}

/**
 * SemVer precedence, with build metadata as the final tie-break, as Rust's `Ord for Version`
 * (npm's `compareBuild`; plain `compare` ignores the build).
 */
export function compareVersions(a: Version, b: Version): number {
  return semver.compareBuild(a.text, b.text)
}

/** The greatest of `versions`, or `null` when there is none. */
export function maxVersion(versions: readonly Version[]): Version | null {
  let best: Version | null = null
  for (const candidate of versions) {
    if (best == null || compareVersions(candidate, best) > 0) best = candidate
  }
  return best
}

/** Equal major, minor and patch, ignoring the prerelease and the build. */
export function sameCore(a: Version, b: Version): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch
}

/** A build kind (`version.rs` `Kind`). */
export type Kind = 'dev' | 'nightly' | 'rc' | 'stable'

/** Whether `v` is of `kind`: a plain prefix test on the prerelease, so `rc1` is an rc too. */
export function kindMatches(kind: Kind, v: Version): boolean {
  switch (kind) {
    case 'dev':
      return v.pre.startsWith('dev')
    case 'nightly':
      return v.pre.startsWith('nightly')
    case 'rc':
      return v.pre.startsWith('rc')
    case 'stable':
      return v.pre === ''
  }
}

/** The first kind, in the order dev, nightly, rc, stable, that `v` matches. */
export function deduceKind(v: Version): Kind {
  const kinds: readonly Kind[] = ['dev', 'nightly', 'rc', 'stable']
  const kind = kinds.find((candidate) => kindMatches(candidate, v))
  if (kind == null) throw new Error(`Failed to deduce build kind for version ${v.text}`)
  return kind
}

/** `ENSO_RELEASE_MODE`: false when the prerelease contains `dev` or `SNAPSHOT`. */
export function isReleaseMode(v: Version): boolean {
  return !v.pre.includes('dev') && !v.pre.includes('SNAPSHOT')
}

/** A nightly prerelease, `nightly.<year>.<month>.<day>[.<index>]` (`version/nightly.rs`). */
export interface Nightly {
  readonly date: Day
  readonly index: number | null
}

const INTEGER = /^\d+$/
const SIGNED_INTEGER = /^-?\d+$/

/** The nightly prerelease of `v`; throws when it is not one. */
export function parseNightly(v: Version): Nightly {
  const ids = v.pre.split('.')
  if (ids[0] !== 'nightly') throw new Error('Not a nightly build.')
  if (ids.length !== 4 && ids.length !== 5) throw new Error('Wrong number of identifiers.')
  const [, year = '', month = '', day = '', index] = ids
  if (!SIGNED_INTEGER.test(year) || !INTEGER.test(month) || !INTEGER.test(day)) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`)
  }
  if (index != null && !INTEGER.test(index)) throw new Error(`Invalid nightly index: ${index}`)
  const date = { year: Number(year), month: Number(month), day: Number(day) }
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day))
  if (
    check.getUTCFullYear() !== date.year ||
    check.getUTCMonth() + 1 !== date.month ||
    check.getUTCDate() !== date.day
  ) {
    throw new Error(`Invalid date: ${year}-${month}-${day}`)
  }
  return { date, index: index == null ? null : Number(index) }
}

/** A nightly prerelease string. The date is not zero-padded: `nightly.2021.2.3`. */
export function formatNightly(date: Day, index: number | null): string {
  const base = `nightly.${date.year}.${date.month}.${date.day}`
  return index == null ? base : `${base}.${index}`
}

/** The next nightly index on the same day: none becomes 1, 1 becomes 2. */
export function nextNightlyIndex(index: number | null): number {
  return (index ?? 0) + 1
}

/** Today in UTC. */
export function todayUtc(now: Date): Day {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() }
}

const sameDay = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day

/** The next rc after `v`, `rc.<n>` becoming `rc.<n+1>` (the core and build kept). */
export function incrementRc(v: Version): Version {
  if (!kindMatches('rc', v)) throw new Error(`Version is not an RC version: ${v.text}.`)
  const parts = v.pre.split('.')
  if (parts.length !== 2 || parts[0] !== 'rc') {
    throw new Error(`RC version has an unexpected prerelease: ${v.text}.`)
  }
  const index = parts[1] ?? ''
  if (!INTEGER.test(index) || Number(index) > 0xffffffff) throw new Error('Parsing RC index.')
  return makeVersion(v.major, v.minor, v.patch, `rc.${Number(index) + 1}`, v.build)
}

/** What `promote` (Phase 4) asks for; a dev build uses `stable` and appends `-dev`. */
export type Designation = 'stable' | 'patch' | 'rc' | 'nightly'

/**
 * The next version of `designation`, given the existing `versions` and `today` (`Releases` in
 * `version/promote.rs`). A new stable is `<year>.<minor + 1>.1`, or `<year>.1.1` in a new year.
 */
export function generateVersion(
  designation: Designation,
  versions: readonly Version[],
  today: Day,
): Version {
  for (const v of versions) {
    if (v.major > today.year) throw new Error(`Found version from the future: ${v.text}.`)
  }
  const latestStable = maxVersion(versions.filter((v) => kindMatches('stable', v)))
  const nextStable =
    latestStable != null && latestStable.major === today.year ?
      makeVersion(today.year, latestStable.minor + 1, 1)
    : makeVersion(today.year, 1, 1)
  switch (designation) {
    case 'stable':
      return nextStable
    case 'patch': {
      if (latestStable == null) {
        throw new Error(
          'No stable releases found. There must be some stable release before creating a patch release.',
        )
      }
      return makeVersion(latestStable.major, latestStable.minor, latestStable.patch + 1)
    }
    case 'rc': {
      const lastRc = maxVersion(
        versions.filter((v) => kindMatches('rc', v) && sameCore(v, nextStable)),
      )
      return lastRc != null ?
          incrementRc(lastRc)
        : makeVersion(nextStable.major, nextStable.minor, nextStable.patch, 'rc.1')
    }
    case 'nightly': {
      const todays = versions.filter((v) => {
        if (!kindMatches('nightly', v) || !sameCore(v, nextStable)) return false
        try {
          return sameDay(parseNightly(v).date, today)
        } catch {
          return false
        }
      })
      const last = maxVersion(todays)
      if (last == null) {
        return makeVersion(
          nextStable.major,
          nextStable.minor,
          nextStable.patch,
          formatNightly(today, null),
        )
      }
      const index = nextNightlyIndex(parseNightly(last).index)
      return makeVersion(
        last.major,
        last.minor,
        last.patch,
        formatNightly(today, index),
        last.build,
      )
    }
  }
}

/** The published triple. `ENSO_EDITION` always equals the version. */
export interface Versions {
  readonly version: Version
  readonly releaseMode: boolean
}

/** What `deduceOrGenerate` reads. `releases` is called only when no `ENSO_VERSION` applies. */
export interface VersionInputs {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly releases: () => readonly Version[]
  readonly today: Day
}

/**
 * `version::deduce_or_generate`. A valid `ENSO_VERSION` wins; an empty or invalid one is ignored,
 * silently, as `./run` did. When it wins, a set `ENSO_EDITION` (even an empty one) must equal it.
 * `ENSO_RELEASE_MODE` is never read: it follows from the version.
 */
export function deduceOrGenerate(inputs: VersionInputs): Versions {
  const fromEnv = parseVersion(inputs.env.ENSO_VERSION ?? '')
  if (fromEnv != null) {
    const edition = inputs.env.ENSO_EDITION
    if (edition !== undefined && edition !== fromEnv.text) {
      throw new Error('Inconsistent ENSO_VERSION and ENSO_EDITION variable values.')
    }
    return { version: fromEnv, releaseMode: isReleaseMode(fromEnv) }
  }
  const next = generateVersion('stable', inputs.releases(), inputs.today)
  return { version: makeVersion(next.major, next.minor, next.patch, 'dev'), releaseMode: false }
}

/**
 * `latest-release` from `build-config.yaml`, or `null` when the key is absent. An invalid value is
 * an error, as it failed `./run`'s whole configuration load.
 */
export function latestReleaseFromConfig(configText: string): Version | null {
  const config: unknown = parseYaml(configText)
  const value =
    config != null && typeof config === 'object' ?
      (config as Record<string, unknown>)['latest-release']
    : undefined
  if (value == null) return null
  const parsed = parseVersion(String(value))
  if (parsed == null) {
    throw new Error(`build-config.yaml: \`latest-release\` is not a version: ${String(value)}`)
  }
  return parsed
}

/**
 * The versions among the tags that `git ls-remote --tags origin` printed. A tag that is not strict
 * SemVer is skipped; a line that is not `<hash> <ref>` fails, as in `./run`.
 */
export function parseLsRemoteTags(stdout: string): Version[] {
  const found = new Map<string, Version>()
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.trim().split(/\s+/)
    const ref = parts[1]
    if (parts.length !== 2 || ref == null)
      throw new Error(`Unexpected \`git ls-remote\` line: ${line}`)
    if (ref.startsWith('refs/tags/')) {
      const name = ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '')
      const parsed = parseVersion(name)
      if (parsed != null) found.set(parsed.text, parsed)
    } else if (!(
      ref === 'HEAD' ||
      ref.startsWith('refs/heads/') ||
      ref.startsWith('refs/remotes/')
    )) {
      throw new Error(`Unknown ref name: ${ref}`)
    }
  }
  return [...found.values()]
}
```

`tools/build-scripts/src/version/repository.ts`:

<!-- prettier-ignore -->
```ts
/** @file This repository's version: `deduceOrGenerate` over `build-config.yaml` and `origin`'s tags. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { capture, REPO_ROOT } from '../lib/repo.ts'
import {
  deduceOrGenerate,
  latestReleaseFromConfig,
  parseLsRemoteTags,
  todayUtc,
  type Version,
  type Versions,
} from './version.ts'

/** The versions among `origin`'s tags: `./run`'s fallback when `latest-release` is absent. */
function remoteReleases(): Version[] {
  const result = capture('git', ['ls-remote', '--tags', 'origin'])
  if (result.status !== 0) {
    throw new Error(`\`git ls-remote --tags origin\` failed: ${result.stderr.trim()}`)
  }
  return parseLsRemoteTags(result.stdout)
}

/**
 * The version a build of this checkout gets: `ENSO_VERSION` when valid, else `<next stable>-dev`
 * after `latest-release` in `build-config.yaml` (read on every call; `./run` compiled it in), or
 * after `origin`'s tags when that key is absent.
 */
export function repositoryVersions(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Versions {
  const config = readFileSync(path.join(REPO_ROOT, 'build-config.yaml'), 'utf8')
  const latest = latestReleaseFromConfig(config)
  return deduceOrGenerate({
    env,
    releases: () => (latest != null ? [latest] : remoteReleases()),
    today: todayUtc(now),
  })
}
```

`tools/build-scripts/src/commands/version.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `version`: computes the Enso version and publishes `ENSO_VERSION`, `ENSO_EDITION` and
 * `ENSO_RELEASE_MODE`, as `./run` did before every command. In GitHub Actions it writes them to
 * `GITHUB_OUTPUT` and `GITHUB_ENV`; locally it prints `export` lines:
 *
 *     eval "$(corepack pnpm --silent --filter build-scripts run version)"
 */
import { publish } from '../lib/github.ts'
import { repositoryVersions } from '../version/repository.ts'

try {
  const { version, releaseMode } = repositoryVersions()
  publish({
    ENSO_VERSION: version.text,
    ENSO_EDITION: version.text,
    ENSO_RELEASE_MODE: String(releaseMode),
  })
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

- [ ] **Step 6: Run every check**

```bash
cd /c/Repos/Enso/ide-bs-3a/tools/build-scripts
corepack pnpm run test:unit 2>&1 | grep -E "Tests |FAIL"
corepack pnpm run typecheck && corepack pnpm run lint && echo checks-ok
corepack pnpm --silent run version
ENSO_VERSION=2026.2.0 ENSO_EDITION= corepack pnpm --silent run version; echo "exit $?"
cd ../.. && corepack pnpm exec prettier --check tools/build-scripts .prettierignore pnpm-workspace.yaml
```

Expected:

- `Tests  57 passed (57)` (version 48, github 4, repo 5);
- `checks-ok` (ESLint with `--max-warnings=0` finds nothing);
- `export ENSO_VERSION='2026.1.1-dev'`, `export ENSO_EDITION='2026.1.1-dev'`,
  `export ENSO_RELEASE_MODE='false'` (in 2026; `<year>.1.1-dev` in a later year
  while `latest-release` is 2025.3.4);
- `Error: Inconsistent ENSO_VERSION and ENSO_EDITION variable values.` and
  `exit 1`;
- Prettier clean.

The package's Linux run is its CI job (Task 2): do not run pnpm in WSL against
`/mnt/c`.

- [ ] **Step 7: Commit**

```bash
cd /c/Repos/Enso/ide-bs-3a
git add tools/build-scripts pnpm-workspace.yaml pnpm-lock.yaml .prettierignore
git commit -m "Add tools/build-scripts with the version command, ported from ./run"
```

---

### Task 2: The `Build Scripts` workflow, docs, and PR 3a

**Files:**

- Create: `.github/workflows/build-scripts.yml`
- Modify: `.github/actions/setup-node/action.yml` (Node from `.node-version` on
  every OS)
- Modify: `tools/CLAUDE.md` (Subdirs), `.github/CLAUDE.md` (Layout)

**Interfaces:**

- Produces: the check "Build Scripts", which later PRs that touch the package
  run.

- [ ] **Step 1: Write the workflow**

`.github/workflows/build-scripts.yml` (the paths list already names files that
3b creates; a path that does not exist yet matches nothing):

<!-- prettier-ignore -->
```yaml
# Hand-written. Type-checks, lints and unit-tests `tools/build-scripts`, the TypeScript package that
# takes over `./run`'s logic (build simplification, Phase 3). The GUI checks also run these scripts
# (`ci:typecheck`, `ci:lint`, `ci:unit-test` cover every workspace package), but only when GUI files
# change; this workflow runs them when the package or what it reads changes.

name: Build Scripts
on:
  push:
    branches:
      - develop
    paths:
      - "tools/build-scripts/**"
      - "tools/ci/toolchain-pins.mjs"
      - "build-config.yaml"
      - ".node-version"
      - "rust-toolchain.toml"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.json"
      - "eslint.config.mjs"
      - ".github/workflows/build-scripts.yml"
  pull_request:
    # A whitelist: specs and plans (`docs/superpowers/**`) never match it.
    paths:
      - "tools/build-scripts/**"
      - "tools/ci/toolchain-pins.mjs"
      - "build-config.yaml"
      - ".node-version"
      - "rust-toolchain.toml"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "tsconfig.json"
      - "eslint.config.mjs"
      - ".github/workflows/build-scripts.yml"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}-build-scripts
  cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}

permissions:
  contents: read

jobs:
  build-scripts:
    name: Build Scripts
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        name: ⎔ Setup Node
        with:
          node-version-file: .node-version
          cache: "pnpm"
      # The root's lint configuration needs the root's dependencies; nothing here needs the
      # lifecycle scripts (the Rust parser build).
      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts
      - name: Typecheck
        run: pnpm --filter build-scripts run typecheck
      - name: Lint
        run: pnpm --filter build-scripts run lint
      - name: Unit tests
        run: pnpm --filter build-scripts run test:unit
```

- [ ] **Step 2: Node 24 in every job that runs the package**

The runner images carry Node 22 (develop's logs: `Found node: v22.23.3` on Linux
and Windows), and `setup-node` installed Node only on macOS. Every later PR runs
`tools/build-scripts` in jobs that use `setup-node`, so it must give them the
pinned Node, or CI would run the TypeScript under a different Node than
`Build Scripts` and every local check. Replace
`.github/actions/setup-node/action.yml` with:

<!-- prettier-ignore -->
```yaml
name: Set up Node and corepack
description: >-
  Node from `.node-version` and corepack 0.36.0, on every OS, and a check that `node` is that
  version. The runner images carry an older Node (22 on Linux and Windows); `tools/build-scripts`
  runs its TypeScript with the pinned one. The GUI checks set up pnpm their own way
  (`pnpm/action-setup`).
runs:
  using: composite
  steps:
    - name: Setup nodejs version
      uses: actions/setup-node@v5
      with:
        node-version-file: .node-version
        # The store cache needs pnpm on the PATH, which the next step provides.
        package-manager-cache: false
    - if: runner.os == 'Windows'
      name: Install corepack
      shell: pwsh
      run: npm install -g --force corepack@0.36.0 && corepack --version
    - if: runner.os != 'Windows'
      name: Install corepack
      shell: bash
      run: npm install -g --force corepack@0.36.0 && corepack --version
    - name: Check the Node version
      shell: bash
      run: |-
        expected=$(tr -d ' \r\n' < .node-version)
        actual=$(node --version)
        echo "node $actual, .node-version $expected"
        [ "$actual" = "v$expected" ]
```

The check step fails a job whose Node is not the pin, so every job that uses the
action proves it. (The `./run` jobs now run on Node 24 too; they only use
`corepack pnpm`.)

- [ ] **Step 3: Update the docs**

In `tools/CLAUDE.md`, under `## Subdirs`, after the bullet that starts
``- `ci/` —``, add:

<!-- prettier-ignore -->
```markdown
- `build-scripts/` — TypeScript package with the build logic that leaves `./run`
  (build simplification, Phase 3): `version` and the CI commands. Node runs it
  directly; see its CLAUDE.md.
```

In `.github/CLAUDE.md`, replace

<!-- prettier-ignore -->
```markdown
- `workflows/changelog.yml`, `std-libs-labels.yml`, `formatting.yml`,
  `enso4igv.yml`, `workflow-lint.yml` — single-purpose pull-request workflows.
```

with

<!-- prettier-ignore -->
```markdown
- `workflows/changelog.yml`, `std-libs-labels.yml`, `formatting.yml`,
  `enso4igv.yml`, `workflow-lint.yml`, `build-scripts.yml` — single-purpose
  pull-request workflows. `build-scripts.yml` type-checks, lints and tests
  `tools/build-scripts`.
```

Run
`corepack pnpm exec prettier --write .github/workflows/build-scripts.yml tools/CLAUDE.md .github/CLAUDE.md`,
then `--check` on the same files.

- [ ] **Step 4: Check the workflows, on both hosts**

```bash
cd /c/Repos/Enso/ide-bs-3a
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3a && node tools/ci/check-workflows.mjs && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3a .github/workflows/build-scripts.yml .github/workflows/ide-packaging.yml .github/workflows/engine-checks.yml > "$SCRATCH/compare-3a.md"
```

Expected: `Workflow policy: OK` on both hosts (`checkSetupNodeCache` still finds
`package-manager-cache: false`), `ℹ fail 0`, `actionlint-ok`; `compare-3a.md`
shows only D1 and D11.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add .github/workflows/build-scripts.yml .github/actions/setup-node/action.yml tools/CLAUDE.md .github/CLAUDE.md
git commit -m "Run tools/build-scripts' typecheck, lint and tests in a Build Scripts workflow"
git push -u origin ci/build-scripts-version
```

Write `$SCRATCH/pr-3a.md`: what the PR adds (the package, Node's type stripping
rather than `tsx` (R3), `version`, the workflow, Node 24 in `setup-node`); that
no workflow uses `version` yet (3f is the first); the intended differences D1
and D11; `compare-3a.md` in `<details>`; "Part of #289's Phase 3."; the
attribution lines. Then:

```bash
gh pr create --base develop --head ci/build-scripts-version --label "CI: No changelog needed" \
  --title "Build simplification, PR 3a: tools/build-scripts and the version command" \
  --body-file "$SCRATCH/pr-3a.md"
```

- [ ] **Step 6: Wait, prove the version against `./run`'s and the Node version,
      merge**

Run `"$SCRATCH/wait-pr.sh" <N> 120` in the background. Meanwhile, read the
version develop's `./run` gave its distribution, from the lint job's "Check the
distribution's version" step:

```bash
id=$(gh run list --workflow engine-pull-request.yml --branch develop -L 1 --json databaseId --jq '.[0].databaseId')
gh run view "$id" --log | grep -oE "built-distribution/enso-engine-[^ /]+-linux-amd64/enso-[^ ]+" | sort -u
```

Expected:
`built-distribution/enso-engine-2026.1.1-dev-linux-amd64/enso-2026.1.1-dev`, the
same version `corepack pnpm --silent --filter build-scripts run version` printed
in Task 1 Step 6. When the watcher exits:

- the checks are "Build Scripts" (green, about 2 minutes: typecheck, lint, 57
  tests on Linux), Workflow Lint, Changelog, the GUI checks (the root manifests
  changed), and ✨ IDE packaging (about 45 minutes: `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` and `.github/**` are in its change list); because
  `setup-node` changed, ✨ Engine runs as well;
- every job that uses `setup-node` (Build Backend, GUI build, Package New IDE,
  and the engine jobs, Linux and Windows) logs
  `node v24.21.0, .node-version 24.21.0` in "Check the Node version":
  `gh run view <id> --log | grep -c "node v24.21.0, .node-version 24.21.0"` is
  non-zero for each of the IDE and Engine runs, and no job failed there;
- "Build Scripts" ran the tests on Linux: its log shows `Tests  57 passed`.

When every check is green: `gh pr merge <N> --squash`.

---

### Task 3: One toolchain-pin parser, and the GraalPy pin (PR 3b)

**Files:**

- Create: `tools/ci/toolchain-pins.mjs`, `tools/ci/toolchain-pins.test.mjs`
- Modify: `tools/ci/check-workflows.mjs` (imports, `ROOT_FILES`, the local
  `TOOLCHAIN_PINS` and `toolchainPins` removed, `checkToolchainPins`)
- Modify: `tools/ci/check-workflows.test.mjs` (`checkToolchainPins` fixtures)
- Modify: `build-config.yaml` (the comment, `graalpy:`)

**Interfaces:**

- Produces:
  - `tools/ci/toolchain-pins.mjs`:
    `readToolchainPins(text): Record<string, string>` (the awk contract),
    `TOOLCHAIN_PINS: { pin, name, file, pattern }[]` (now with `graalpy` against
    `graalMavenPackagesVersion`), `TOOLCHAIN_PIN_FILES: string[]`;
  - `build-config.yaml` key `toolchain.graalpy` (Task 14's `setup-jvm` input
    reads it).

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3b -b ci/toolchain-check origin/develop
cd /c/Repos/Enso/ide-bs-3b && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f tools/build-scripts/src/lib/repo.ts && echo "3a is in"
```

Expected: `3a is in`.

- [ ] **Step 2: Write the failing test**

`tools/ci/toolchain-pins.test.mjs` runs the awk program it finds in
`setup-jvm/action.yml` over the fixtures from the research (a glued value, a
glued comment, a trailing word, a duplicate, a tab-indented line, blank lines,
column-0 comments and CRLF, an empty value, a later top-level key), and requires
`readToolchainPins` to give the same answer for every key. It also requires the
real file to pin `graalpy`:

<!-- prettier-ignore -->
```js
// Run with `node --test tools/ci/toolchain-pins.test.mjs`.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readToolchainPins } from './toolchain-pins.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'toolchain-pins-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** Each fixture is a `build-config.yaml`, and the keys to read from it. */
const FIXTURES = {
  'the real file': {
    text: readFileSync(path.join(repoRoot, 'build-config.yaml'), 'utf8'),
    keys: ['graalvm', 'graalpy', 'sbt', 'flatc', 'missing'],
  },
  'a value glued to its key is no pin': {
    text: 'toolchain:\n  graalvm:25.0.1\n',
    keys: ['graalvm'],
  },
  'a glued comment is kept, a later word dropped': {
    text: 'toolchain:\n  sbt: 1.10.6#x\n  flatc: 24.3.25 x\n',
    keys: ['sbt', 'flatc'],
  },
  'the first of two lines wins': {
    text: 'toolchain:\n  sbt: 1\n  sbt: 2\n',
    keys: ['sbt'],
  },
  'a tab-indented line closes the block': {
    text: 'toolchain:\n\tgraalvm: 1\n  sbt: 2\n',
    keys: ['graalvm', 'sbt'],
  },
  'blank lines and column-0 comments keep it open, CRLF is dropped': {
    text: 'toolchain:\r\n\r\n# a note\r\n  sbt: 1.10.6\r\n  # flatc: 9\r\n  flatc: 24.3.25 # pinned\r\n',
    keys: ['sbt', 'flatc'],
  },
  'a key with no value is empty': {
    text: 'toolchain:\n  sbt:\n',
    keys: ['sbt'],
  },
  'a later top-level key closes the block': {
    text: 'toolchain:\n  sbt: 1\nother:\n  flatc: 2\n',
    keys: ['sbt', 'flatc'],
  },
}

/** The awk program in `setup-jvm`'s "Read the pinned versions" step. */
function setupJvmAwkProgram() {
  const action = readFileSync(
    path.join(repoRoot, '.github', 'actions', 'setup-jvm', 'action.yml'),
    'utf8',
  )
  const program = action.match(/awk -v key="\$1" '([^']+)' build-config\.yaml/)?.[1]
  assert.ok(program, 'setup-jvm reads the pins with `awk -v key="$1" \'…\' build-config.yaml`')
  return program
}

const awkAvailable = spawnSync('awk', ['--version']).error == null

describe('readToolchainPins agrees with the awk reader in setup-jvm', () => {
  // CI (Linux) always has awk; a Windows shell without Git Bash on the PATH may not.
  const run = awkAvailable || process.env.CI ? test : test.skip
  let count = 0
  for (const [name, { text, keys }] of Object.entries(FIXTURES)) {
    run(name, () => {
      const file = path.join(scratch, `build-config-${count++}.yaml`)
      writeFileSync(file, text)
      const program = setupJvmAwkProgram()
      const pins = readToolchainPins(text)
      for (const key of keys) {
        const awk = spawnSync('awk', ['-v', `key=${key}`, program, file], { encoding: 'utf8' })
        assert.equal(awk.status, 0, awk.stderr)
        assert.equal(pins[key] ?? '', awk.stdout.replace(/\n$/, ''), `key ${key}`)
      }
    })
  }
})

test('readToolchainPins reads the real pins', () => {
  const pins = readToolchainPins(readFileSync(path.join(repoRoot, 'build-config.yaml'), 'utf8'))
  for (const key of ['graalvm', 'graalpy', 'sbt', 'flatc']) {
    assert.match(pins[key] ?? '', /^\d+\.\d+\.\d+$/, key)
  }
})
```

Run:
`node --test tools/ci/toolchain-pins.test.mjs 2>&1 | grep -E "ℹ (pass|fail)|ERR_MODULE_NOT_FOUND"`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./toolchain-pins.mjs`.

- [ ] **Step 3: Write the parser**

`tools/ci/toolchain-pins.mjs`:

<!-- prettier-ignore -->
```js
// The `toolchain:` pins in `build-config.yaml`, read exactly as `.github/actions/setup-jvm` reads
// them with awk. One parser for the three readers: setup-jvm (the awk program itself), the
// workflow policy (`check-workflows.mjs`) and `toolchain-check` (`tools/build-scripts`).
// `toolchain-pins.test.mjs` runs the awk program from `setup-jvm/action.yml` over the same
// fixtures and requires the same answers.

/**
 * The pins, as `{ key: value }`. The awk contract, line by line:
 * - a trailing carriage return is dropped;
 * - a line starting `toolchain:` opens the block;
 * - a line whose first character is neither a space nor `#` closes it (so a tab-indented line
 *   closes it; blank lines and column-0 comments do not);
 * - inside the block, a line whose first blank-separated field is `<key>:` pins `<key>` to its
 *   second field, verbatim (quotes and a glued `#comment` kept, later fields dropped), or to `''`;
 * - the first line for a key wins.
 *
 * @param {string} text the contents of `build-config.yaml`
 * @returns {Record<string, string>} the pins
 */
export function readToolchainPins(text) {
  /** @type {Record<string, string>} */
  const pins = {}
  let inBlock = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (/^toolchain:/.test(line)) {
      inBlock = true
      continue
    }
    if (/^[^ #]/.test(line)) inBlock = false
    if (!inBlock) continue
    const fields = line.replace(/^[ \t]+|[ \t]+$/g, '').split(/[ \t]+/)
    const first = fields[0] ?? ''
    if (!first.endsWith(':') || first.length === 1) continue
    const key = first.slice(0, -1)
    if (!(key in pins)) pins[key] = fields[1] ?? ''
  }
  return pins
}

/**
 * Where the build keeps its own copy of each pin. A pin may have several copies; each must equal
 * it. `optional` pins are not needed by every developer (`toolchain-check` only warns about them).
 *
 * Not covered, on purpose: `test/*_Tests/data/native_libs.json` (test fixtures that name
 * `truffle-api-<version>.jar`) and `distribution/**\/THIRD-PARTY/NOTICE` (generated by
 * `gatherLicenses`). Neither is a `setup-jvm` input, and both are derived from the build rather
 * than copies of a pin; CLAUDE.md lists them among the copies a GraalVM bump must move.
 *
 * @type {ReadonlyArray<{ pin: string, name: string, file: string, pattern: RegExp }>}
 */
export const TOOLCHAIN_PINS = [
  {
    pin: 'graalvm',
    name: 'graalVersion',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val graalVersion\s*=\s*"([^"]+)"/m,
  },
  {
    // The GraalVM / Truffle Maven packages; "Keep in sync with GraalVM.version" (its comment).
    pin: 'graalvm',
    name: 'graalMavenPackagesVersion',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val graalMavenPackagesVersion\s*=\s*"([^"]+)"/m,
  },
  {
    // The standalone GraalPy that `test/Examples_Tests` probes for; `./run` installed it at the
    // Maven packages' version.
    pin: 'graalpy',
    name: 'graalMavenPackagesVersion',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val graalMavenPackagesVersion\s*=\s*"([^"]+)"/m,
  },
  {
    pin: 'flatc',
    name: 'flatbuffersVersion',
    file: 'project/Dependencies.scala',
    pattern: /^\s*val flatbuffersVersion\s*=\s*"([^"]+)"/m,
  },
  {
    pin: 'sbt',
    name: 'sbt.version',
    file: 'project/build.properties',
    pattern: /^sbt\.version\s*=\s*(\S+)/m,
  },
]

/** The files `TOOLCHAIN_PINS` reads, besides `build-config.yaml`. */
export const TOOLCHAIN_PIN_FILES = [...new Set(TOOLCHAIN_PINS.map(({ file }) => file))]
```

Run the test again. Expected: `ℹ fail 1`: "readToolchainPins reads the real
pins" (no `graalpy` pin yet). Every awk-equivalence case passes, including "the
real file".

- [ ] **Step 4: Add the GraalPy pin**

In `build-config.yaml`, replace

<!-- prettier-ignore -->
```yaml
# - flatc: `flatbuffersVersion` in `project/Dependencies.scala` (checked when the language server
#   compiles).
# One flat `key: value` per line, the value a bare (unquoted) version: `setup-jvm` reads them
# with awk.
toolchain:
  graalvm: 25.0.1
  sbt: 1.10.6
  flatc: 24.3.25
```

with

<!-- prettier-ignore -->
```yaml
# - flatc: `flatbuffersVersion` in `project/Dependencies.scala` (checked when the language server
#   compiles);
# - graalpy: `graalMavenPackagesVersion` in `project/Dependencies.scala` (the standalone GraalPy
#   that `test/Examples_Tests` runs; `setup-jvm` installs it when asked).
# `tools/build-scripts`' `toolchain-check` compares an installed toolchain against them.
# One flat `key: value` per line, the value a bare (unquoted) version: `setup-jvm` reads them
# with awk, and `tools/ci/toolchain-pins.mjs` reads them the same way.
toolchain:
  graalvm: 25.0.1
  sbt: 1.10.6
  flatc: 24.3.25
  graalpy: 25.0.1
```

`./run` ignores the new key (`ConfigRaw` reads only `required-versions` and
`latest-release`).

- [ ] **Step 5: Make the policy use the shared parser**

In `tools/ci/check-workflows.mjs`:

1. After `import { parse } from 'yaml'`, add
   `import { readToolchainPins, TOOLCHAIN_PIN_FILES, TOOLCHAIN_PINS } from './toolchain-pins.mjs'`.
2. Replace the `ROOT_FILES` array
   (`'build-config.yaml', 'project/Dependencies.scala', 'project/build.properties'`)
   with
   `export const ROOT_FILES = ['build-config.yaml', ...TOOLCHAIN_PIN_FILES]`.
3. Delete the local `TOOLCHAIN_PINS` and the function `toolchainPins` (develop's
   lines 347–404): from the line holding `/**` that opens the comment "Where the
   build keeps its own copy of each `toolchain:` pin", down to, not including,
   the `/**` that opens the comment of `checkToolchainPins`, whose next line is
   ``* `.github/actions/setup-jvm` installs the versions pinned under `toolchain:` in``.
4. In `checkToolchainPins`, replace `const toolchain = toolchainPins(config)`
   with `const toolchain = readToolchainPins(config)`, and replace its doc
   comment's second to fourth lines with:

<!-- prettier-ignore -->
```js
 * `build-config.yaml`, read by `readToolchainPins` (`toolchain-pins.mjs`) exactly as its awk does.
 * sbt enforces its own copies (`Running on GraalVM version X. Expected GraalVM version Y.`, the
 * `flatc` version check, `sbt.version`), so each pin must equal the build's. A pin is a bare
 * version: `setup-jvm` reads it with awk, which does not unquote.
```

In `tools/ci/check-workflows.test.mjs`, in `describe('checkToolchainPins')`:

- `allPins` becomes
  `'  graalvm: 25.0.1\n  sbt: 1.10.6 # held\n  flatc: 24.3.25\n  graalpy: 25.0.1\n'`;
- in "rejects a pin that drifted, and a missing pin", `pins` becomes
  `'  graalvm: 25.0.2\n  sbt: 1.10.6\n  graalpy: 25.0.1\n'`;
- in "rejects a half-bumped GraalVM", the expected list gains a second line,
  ``'build-config.yaml: `toolchain.graalpy` is 25.0.1, but `graalMavenPackagesVersion` in project/Dependencies.scala is 25.0.0',``;
- in "compares versions as text", `allPins.replace('25.0.1', '25.0')` becomes
  `allPins.replaceAll('25.0.1', '25.0')`.

- [ ] **Step 6: Run everything, on both hosts**

```bash
cd /c/Repos/Enso/ide-bs-3b
corepack pnpm exec prettier --write tools/ci/toolchain-pins.mjs tools/ci/toolchain-pins.test.mjs build-config.yaml
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail|skipped)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3b && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail|skipped)"'
cargo test -p enso-build --lib config 2>&1 | tail -3
```

Expected: `Workflow policy: OK`, `ℹ fail 0` and `ℹ skipped 0` on both hosts (Git
Bash and WSL both have `awk`); the `enso-build` config tests pass
(`repo_build_config_is_updatable` reads the real file). (Prettier's `--write` on
`tools/ci` is a no-op: `tools/*` is ignored. The files are already formatted.)

- [ ] **Step 7: Commit**

```bash
git add tools/ci/toolchain-pins.mjs tools/ci/toolchain-pins.test.mjs tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs build-config.yaml
git commit -m "One toolchain-pin parser for setup-jvm, the workflow policy and toolchain-check; pin GraalPy"
```

---

### Task 4: The policy sees every sbt call (PR 3b)

**Files:**

- Modify: `tools/ci/check-workflows.mjs` (`BUILD_SCRIPTS`, `loadRepo`, the
  `SBT_CALL` block, `sbtBeforeSetupJvm`, `checkSbtRunsAfterSetupJvm`, `CHECKS`)
- Modify: `tools/ci/check-workflows.test.mjs`, `tools/ci/README.md`
- Modify: `.github/workflows/workflow-lint.yml` (both `paths:`)

**Interfaces:**

- Produces (all exported from `check-workflows.mjs`): `SBT_CALL: RegExp`,
  `callsSbt(script: string, sbtCommands?: Set<string>): boolean`,
  `buildScriptsSbtCommands(buildScripts): Set<string>`,
  `BUILD_SCRIPTS_SBT_HELPER = 'src/lib/sbt.ts'`,
  `checkBuildScriptsSpawnSbtThroughHelper({ buildScripts }): string[]`;
  `loadRepo(root)` also returns `buildScripts: { scripts, sources } | null`.
- Consumed by Task 14: a `tools/build-scripts` command that starts sbt must do
  so through `src/lib/sbt.ts`, and is then an sbt call to the policy.

- [ ] **Step 1: Write the failing tests**

In `tools/ci/check-workflows.test.mjs`, add `buildScriptsSbtCommands`,
`callsSbt` and `checkBuildScriptsSpawnSbtThroughHelper` to the import list
(alphabetical, at its start). In `describe('checkSbtRunsAfterSetupJvm')`, extend
`SHAPES` (after the `'a command substitution'` entry) with:

<!-- prettier-ignore -->
```js
    'behind `timeout`': 'timeout -k 5 90m sbt compile',
    'behind `time` and `timeout`': 'time timeout 90m sbt compile',
    'behind `nice`': 'nice -n 10 sbt compile',
    'behind `env`': 'env -i PATH="$PATH" JAVA_OPTS=-Xmx4g sbt compile',
    'behind `xvfb-run`': 'xvfb-run -a -s "-screen 0 1280x1024x24" sbt test',
    'inside `bash -c`': "bash -lc 'cd engine && sbt compile'",
    'inside `pwsh -Command`': 'pwsh -Command "sbt compile"',
    '`sbt.bat` from PowerShell': '& sbt.bat "-Dsbt.server.autostart=false" compile',
    'behind `cmd /c`': 'cmd /c sbt compile',
    'by path': '"$SBT_HOME/bin/sbt" compile',
    'in backquotes': 'x=`sbt -batch about`',
    'in a group': '{ sbt compile; }',
    'as a condition': 'if sbt compile; then :; fi',
```

and in "accepts sbt as an argument rather than a command", replace the `script`
with:

<!-- prettier-ignore -->
```js
    const script = [
      "./run backend sbt '--' verifyLicensePackages",
      'command -v sbt',
      'echo sbt',
      'env | grep sbt',
      'echo "use sbt.bat"',
      'curl -fsSL -o "$dir/sbt.tgz" "https://github.com/sbt/sbt/releases/download/v1/sbt-1.tgz"',
      'echo "$RUNNER_TEMP/sbt/bin" >> "$GITHUB_PATH"',
      'time ./run backend get',
    ].join('\n')
```

Insert before `test('the repository follows the policy', …)`:

<!-- prettier-ignore -->
```js
describe('tools/build-scripts commands that start sbt', () => {
  /** A `tools/build-scripts` with one command that reaches `src/lib/sbt.ts` and one that does not. */
  const PACKAGE = {
    'tools/build-scripts/package.json': JSON.stringify({
      scripts: {
        'stdlib-test': 'node src/commands/stdlib-test.ts',
        version: 'node src/commands/version.ts',
        'test:unit': 'vitest run',
      },
    }),
    'tools/build-scripts/src/commands/stdlib-test.ts': "import { run } from '../stdlib-test/run.ts'\nrun()\n",
    'tools/build-scripts/src/stdlib-test/run.ts':
      "export { startHttpbin as run } from './services.ts'\n",
    'tools/build-scripts/src/stdlib-test/services.ts':
      "import { spawnSbt } from '../lib/sbt.ts'\nexport const startHttpbin = () => spawnSbt([])\n",
    'tools/build-scripts/src/lib/sbt.ts':
      "import { spawn } from 'node:child_process'\nexport const spawnSbt = (a) => spawn('sbt', a)\n",
    'tools/build-scripts/src/commands/version.ts': "import { x } from '../version/version.ts'\n",
    'tools/build-scripts/src/version/version.ts': 'export const x = 1\n',
  }
  const workflow = (before) => `
on: push
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
${before}      - name: Tests
        run: corepack pnpm --filter build-scripts run stdlib-test -- standard-library
      - name: Version
        run: corepack pnpm --silent --filter build-scripts run version
`
  test('a command that imports src/lib/sbt.ts, however indirectly, starts sbt', () => {
    const repo = fixture({}, PACKAGE)
    assert.deepEqual([...buildScriptsSbtCommands(repo.buildScripts)], ['stdlib-test'])
    assert.equal(callsSbt('corepack pnpm --filter=build-scripts run stdlib-test', new Set(['stdlib-test'])), true)
    assert.equal(callsSbt('corepack pnpm -F build-scripts run version', new Set(['stdlib-test'])), false)
  })
  test('rejects such a command with no setup-jvm before it, accepts it after', () => {
    const late = fixture({ 'workflows/a.yml': workflow('') }, PACKAGE)
    assert.deepEqual(checkSbtRunsAfterSetupJvm(late), [
      'a.yml › j: `Tests` runs sbt before `./.github/actions/setup-jvm`',
    ])
    const setup = '      - uses: ./.github/actions/setup-jvm\n        with: { cache-key: a }\n'
    assert.deepEqual(checkSbtRunsAfterSetupJvm(fixture({ 'workflows/a.yml': workflow(setup) }, PACKAGE)), [])
  })
  test('only src/lib/sbt.ts may start sbt', () => {
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, PACKAGE)), [])
    const rogue = {
      ...PACKAGE,
      'tools/build-scripts/src/version/version.ts':
        "import { spawnSync } from 'node:child_process'\nspawnSync('sbt.bat', ['about'])\n",
    }
    assert.deepEqual(checkBuildScriptsSpawnSbtThroughHelper(fixture({}, rogue)), [
      'tools/build-scripts/src/version/version.ts: starts sbt itself; use `src/lib/sbt.ts`, so the workflow policy sees it',
    ])
  })
  test('a repository without the package has no such commands', () => {
    assert.deepEqual([...buildScriptsSbtCommands(fixture({}).buildScripts)], [])
  })
})
```

Run:
`node --test tools/ci/check-workflows.test.mjs 2>&1 | grep -E "ℹ (pass|fail)|SyntaxError"`

Expected: FAIL: `does not provide an export named 'buildScriptsSbtCommands'`.

- [ ] **Step 2: Implement**

In `tools/ci/check-workflows.mjs`, after `export const ROOT_FILES = …`, add:

<!-- prettier-ignore -->
```js
/** The TypeScript package whose commands workflows run with `corepack pnpm --filter build-scripts`. */
export const BUILD_SCRIPTS = 'tools/build-scripts'

/** Every `.ts` file under `dir`, as paths relative to `base` with `/` separators. */
function typeScriptFiles(dir, base) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return typeScriptFiles(full, base)
    return entry.name.endsWith('.ts') ? [path.relative(base, full).split(path.sep).join('/')] : []
  })
}

/**
 * `tools/build-scripts`: its `package.json` scripts and its `src/**\/*.ts` sources (paths relative
 * to the package), or `null` when the package does not exist.
 */
function loadBuildScripts(root) {
  const dir = path.join(root, BUILD_SCRIPTS)
  const manifest = path.join(dir, 'package.json')
  if (!existsSync(manifest)) return null
  const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts ?? {}
  const sources = {}
  for (const file of typeScriptFiles(path.join(dir, 'src'), dir)) {
    sources[file] = readFileSync(path.join(dir, file), 'utf8')
  }
  return { scripts, sources }
}
```

Replace the doc comment above `loadRepo` with:

<!-- prettier-ignore -->
```js
/**
 * Loads every workflow and every local composite action under `root/.github`, the `ROOT_FILES`
 * (`null` when absent), and `tools/build-scripts` (`null` when absent).
 */
```

and its last line, `  return { workflows, actions, files }`, with
`  return { workflows, actions, files, buildScripts: loadBuildScripts(root) }`.

Replace the old doc comment and `const SBT_CALL = …` (develop's lines 443–451):
from the `/**` whose next line begins
``* A script that calls `sbt` itself, as a command:``, down to, not including,
the line
``/** The local composite action a step uses (`./.github/actions/<name>`), or `null`. */``.
Put in its place:

<!-- prettier-ignore -->
```js
// An inline `VAR=value ` assignment before a command.
const ASSIGN = String.raw`[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+`
// A wrapper's option or argument: `-x`, `--x=y`, a number or duration (`10`, `90m`), a quoted
// string, or an assignment (`env A=1`).
const WRAPPER_ARG = String.raw`(?:-\S+|\d+[smhd]?|"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))`
// A command that runs the rest of the line as a command. Not `command`: `command -v sbt` only asks.
const WRAPPER = String.raw`(?:time|timeout|nice|nohup|env|xvfb-run|stdbuf|exec|sudo)(?:\s+${WRAPPER_ARG})*\s+`
// Where a command starts: a line, after `;`, `&`, `|`, `(`, `{`, a backquote, `!`, `$(`, or a
// shell keyword.
const START = String.raw`(?:^|[;&|({\x60!]|\$\(|\b(?:then|do|else|if|elif|while|until)\s)`
// `sbt`, `sbt.bat` or `sbt.cmd`, perhaps behind a path (`./sbt`, `"$SBT_HOME/bin/sbt"`), perhaps
// quoted, and followed by the end of the command word.
const SBT_WORD = String.raw`"?(?:[^\s;&|()'"\x60]*[\\/])?sbt(?:\.bat|\.cmd)?"?(?=\s|$|[;&|)\x60])`

/**
 * A script line that calls `sbt` itself, as a command: at a command's start, optionally after
 * PowerShell's `&`, inline `VAR=value` assignments (`LC_ALL=C.UTF-8 sbt …`, the shape of `./run`'s
 * own call), wrappers (`timeout 90m`, `time`, `nice -n 10`, `env A=1`, `xvfb-run -a`, …) and
 * `cmd /c`. An argument named `sbt` is not a call: neither `./run backend sbt` (`./run` provisions
 * sbt) nor `command -v sbt`.
 */
export const SBT_CALL = new RegExp(
  String.raw`${START}\s*(?:&\s*)?(?:${ASSIGN})*(?:${WRAPPER})*(?:cmd(?:\.exe)?\s+\/c\s+)?${SBT_WORD}`,
  'im',
)

/** A script handed to a shell: `bash -c "…"`, `sh -lc '…'`, `pwsh -Command "…"`. */
const SHELL_C =
  /\b(?:ba|z)?sh(?:\.exe)?\s+(?:-\w+\s+)*-\w*c\w*\s+(?:"([^"]*)"|'([^']*)')|\b(?:pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-(?:c|Command)\s+(?:"([^"]*)"|'([^']*)')/gi

/** A `tools/build-scripts` command run from a workflow: `corepack pnpm --filter build-scripts run <command>`. */
const BUILD_SCRIPTS_RUN =
  /\bpnpm\b[^\n;&|]*?(?:--filter[= ]|-F\s*)build-scripts\b[^\n;&|]*?\brun\s+([\w:-]+)/g

/** The one module in `tools/build-scripts` that may start sbt. */
export const BUILD_SCRIPTS_SBT_HELPER = 'src/lib/sbt.ts'

/** A relative import or re-export in a TypeScript source: `from './x.ts'`, `import('./x.ts')`. */
const RELATIVE_IMPORT = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g

/** A direct spawn of sbt: `spawn('sbt', …)`, `execFileSync("sbt.bat", …)` and the like. */
const SPAWNS_SBT =
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|capture|runInherited)\s*\(\s*['"`]sbt(?:\.bat|\.cmd)?['"`]/

/**
 * The `tools/build-scripts` commands that start sbt: those whose script (`node src/….ts`) reaches
 * `src/lib/sbt.ts` through relative imports. `checkBuildScriptsSpawnSbtThroughHelper` makes that
 * module the only way to start sbt, so this cannot miss one.
 */
export function buildScriptsSbtCommands(buildScripts) {
  const commands = new Set()
  if (buildScripts == null) return commands
  const { scripts, sources } = buildScripts
  const reachesSbt = (file, seen) => {
    if (file === BUILD_SCRIPTS_SBT_HELPER) return true
    if (seen.has(file) || sources[file] == null) return false
    seen.add(file)
    for (const match of sources[file].matchAll(RELATIVE_IMPORT)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1] ?? match[2]))
      if (reachesSbt(target, seen)) return true
    }
    return false
  }
  for (const [name, command] of Object.entries(scripts)) {
    const entry = String(command).match(/\bnode\s+(src\/\S+\.ts)\b/)?.[1]
    if (entry != null && reachesSbt(entry, new Set())) commands.add(name)
  }
  return commands
}

/**
 * Whether a `run:` script calls sbt: directly (`SBT_CALL`), inside a `bash -c`/`pwsh -Command`
 * script, or through a `tools/build-scripts` command in `sbtCommands`.
 */
export function callsSbt(script, sbtCommands = new Set()) {
  if (SBT_CALL.test(script)) return true
  for (const match of script.matchAll(SHELL_C)) {
    const inner = match[1] ?? match[2] ?? match[3] ?? match[4]
    if (inner != null && callsSbt(inner, sbtCommands)) return true
  }
  for (const match of script.matchAll(BUILD_SCRIPTS_RUN)) {
    if (sbtCommands.has(match[1])) return true
  }
  return false
}

/**
 * In `tools/build-scripts`, only `src/lib/sbt.ts` starts sbt. That is what lets the workflow
 * policy see which commands need `setup-jvm` (`buildScriptsSbtCommands`).
 */
export function checkBuildScriptsSpawnSbtThroughHelper({ buildScripts = null }) {
  if (buildScripts == null) return []
  return Object.entries(buildScripts.sources)
    .filter(([file, text]) => file !== BUILD_SCRIPTS_SBT_HELPER && SPAWNS_SBT.test(text))
    .map(
      ([file]) =>
        `${BUILD_SCRIPTS}/${file}: starts sbt itself; use \`${BUILD_SCRIPTS_SBT_HELPER}\`, so the workflow policy sees it`,
    )
}
```

Then thread the commands through:

- `function sbtBeforeSetupJvm(steps, actions, seen = new Set())` becomes
  `function sbtBeforeSetupJvm(steps, actions, sbtCommands, seen = new Set())`;
  inside it, `let runs = SBT_CALL.test(String(step?.run ?? ''))` becomes
  `let runs = callsSbt(String(step?.run ?? ''), sbtCommands)`, and the recursive
  call passes `sbtCommands` before `new Set([...seen, action])`.
- In `checkSbtRunsAfterSetupJvm`, add a doc-comment line before ` */`:
  ``* A `tools/build-scripts` command that starts sbt (`buildScriptsSbtCommands`) counts as calling it.``;
  the signature becomes
  `export function checkSbtRunsAfterSetupJvm({ workflows, actions = {}, buildScripts = null })`;
  after `const problems = []` add
  `const sbtCommands = buildScriptsSbtCommands(buildScripts)`; and both calls
  pass it: `sbtBeforeSetupJvm(job?.steps, actions, sbtCommands)` and
  `sbtBeforeSetupJvm(doc?.runs?.steps, actions, sbtCommands, new Set([name]))`.
- Add `checkBuildScriptsSpawnSbtThroughHelper,` as the last entry of `CHECKS`.

- [ ] **Step 3: Run the policy on the real repository, and the tests, on both
      hosts**

```bash
cd /c/Repos/Enso/ide-bs-3b
corepack pnpm exec prettier --check tools/ci 2>&1 | tail -1
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3b && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"'
```

Expected: `Workflow policy: OK` (no workflow on develop calls sbt in a way the
old rule missed: the new shapes find nothing new), and `ℹ pass 94`, `ℹ fail 0`
on both hosts.

- [ ] **Step 4: Run Workflow Lint on the package, and document the rules**

In `.github/workflows/workflow-lint.yml`, in both `paths:` lists, after
`      - "tools/ci/**"`, add:

<!-- prettier-ignore -->
```yaml
      # `tools/ci/check-workflows.mjs` reads it: which commands start sbt.
      - "tools/build-scripts/**"
```

In `tools/ci/README.md`, replace

<!-- prettier-ignore -->
```markdown
packaging needs no cloud account, and Windows packaging smoke-tests the
installer. It prints one line per violation and exits 1 if there is any:
```

with

<!-- prettier-ignore -->
```markdown
packaging needs no cloud account, Windows packaging smoke-tests the installer,
the toolchain pins in `build-config.yaml` equal the build's own copies, no job
runs sbt before `setup-jvm`, and in `tools/build-scripts` only `src/lib/sbt.ts`
starts sbt. "Runs sbt" covers wrappers (`timeout`, `env`, `xvfb-run`, `cmd /c`,
…), `bash -c`/`pwsh -Command` scripts, local composite actions, and any
`tools/build-scripts` command whose entry point imports `src/lib/sbt.ts`. It
prints one line per violation and exits 1 if there is any:
```

and add at the end of the file:

<!-- prettier-ignore -->
```markdown
# Toolchain pins

`toolchain-pins.mjs` reads the `toolchain:` block of `build-config.yaml` exactly
as `setup-jvm`'s awk does; the policy and `tools/build-scripts`'
`toolchain-check` use it. `toolchain-pins.test.mjs` runs that awk program over
the same fixtures and requires the same answers, so the readers cannot drift.
```

Run `corepack pnpm exec prettier --write .github/workflows/workflow-lint.yml`
(the README is under the ignored `tools/*`).

- [ ] **Step 5: Commit**

```bash
git add tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs tools/ci/README.md .github/workflows/workflow-lint.yml
git commit -m "Workflow policy: see sbt behind wrappers, in shell scripts and in tools/build-scripts commands"
```

---

### Task 5: `toolchain-check`, and PR 3b

**Files:**

- Create: `tools/build-scripts/src/toolchain/check.ts`, `check.test.ts`,
  `src/commands/toolchain-check.ts`
- Modify: `tools/build-scripts/package.json` (script), `tsconfig.json`
  (`allowJs`), `CLAUDE.md`
- Modify: `CLAUDE.md` (the `toolchain:` bullet), `.github/CLAUDE.md` (the sbt
  convention)

**Interfaces:**

- Consumes: `readToolchainPins` (Task 3), `capture` and `REPO_ROOT` (Task 1).
- Produces: the script `toolchain-check`; `readPins`, `toolsToCheck`,
  `evaluate`, `report` in `src/toolchain/check.ts`.

- [ ] **Step 1: Write the failing test**

In `tools/build-scripts/tsconfig.json`, add `"allowJs": true` to
`compilerOptions` (the check imports the `.mjs` parser; its JSDoc types it).

`tools/build-scripts/src/toolchain/check.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The toolchain check's pins, version parsing and verdicts. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { evaluate, type Pins, readPins, report, toolsToCheck } from './check.ts'

const PINS: Pins = {
  graalvm: '25.0.1',
  sbt: '1.10.6',
  flatc: '24.3.25',
  graalpy: '25.0.1',
  node: '24.21.0',
  pnpm: '12.5.1',
  rust: '1.98.1',
}
const tool = (name: string) => {
  const found = toolsToCheck(PINS).find((candidate) => candidate.name === name)
  if (found == null) throw new Error(name)
  return found
}

describe('readPins', () => {
  test("reads the repository's own pins", () => {
    const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')
    const pins = readPins({
      buildConfig: read('build-config.yaml'),
      nodeVersion: read('.node-version'),
      packageJson: read('package.json'),
      rustToolchain: read('rust-toolchain.toml'),
    })
    for (const value of Object.values(pins)) expect(value).toMatch(/^\d+\.\d+\.\d+$/)
  })
  test('names the file of a missing pin', () => {
    const files = {
      buildConfig: 'toolchain:\n  graalvm: 25.0.1\n  sbt: 1.10.6\n  flatc: 24.3.25\n',
      nodeVersion: '24.21.0\n',
      packageJson: '{"packageManager": "pnpm@12.5.1+sha512.abc"}',
      rustToolchain: '[toolchain]\nchannel = "1.98.1"\n',
    }
    expect(() => readPins(files)).toThrow('build-config.yaml (`toolchain.graalpy`)')
    const pins = readPins({ ...files, buildConfig: files.buildConfig + '  graalpy: 25.0.1\n' })
    expect(pins).toEqual(PINS)
  })
})

describe('evaluate', () => {
  test('GraalVM from `java -version`', () => {
    const output =
      'openjdk version "25.0.1" 2025-10-21\nOpenJDK Runtime Environment GraalVM CE 25.0.1+8.1 (build 25.0.1+8-jvmci-b01)\n'
    expect(evaluate(tool('GraalVM'), 0, output)).toMatchObject({ status: 'ok', fails: false })
    const temurin = 'openjdk version "21.0.4"\nOpenJDK Runtime Environment Temurin-21.0.4+7\n'
    expect(evaluate(tool('GraalVM'), 0, temurin)).toMatchObject({
      status: 'missing',
      found: 'openjdk version "21.0.4"',
      fails: true,
    })
  })
  test('a different sbt launcher only warns', () => {
    expect(evaluate(tool('sbt launcher'), 0, '2.0.8\n')).toMatchObject({
      status: 'mismatch',
      found: '2.0.8',
      fails: false,
    })
  })
  test('a different flatc, Node, pnpm or Rust fails', () => {
    expect(evaluate(tool('flatc'), 0, 'flatc version 23.5.26\n').fails).toBe(true)
    expect(evaluate(tool('Node'), 0, 'v22.1.0\n').fails).toBe(true)
    expect(evaluate(tool('pnpm'), 0, '10.0.0\n').fails).toBe(true)
    expect(evaluate(tool('Rust'), 0, 'rustc 1.90.0 (abc 2025-01-01)\n').fails).toBe(true)
    expect(evaluate(tool('Rust'), 0, 'rustc 1.98.1 (48a229cea 2026-09-01)\n').status).toBe('ok')
  })
  test('a missing GraalPy only warns', () => {
    expect(evaluate(tool('GraalPy'), -1, '')).toMatchObject({ status: 'missing', fails: false })
    expect(evaluate(tool('GraalPy'), 0, 'GraalPy 3.12.8 (GraalVM CE Native 25.0.1)\n').status).toBe(
      'ok',
    )
  })
  test('a missing required tool fails', () => {
    expect(evaluate(tool('flatc'), 1, "'flatc' is not recognized\n")).toMatchObject({
      status: 'missing',
      found: null,
      fails: true,
    })
  })
})

test('report: one line per tool, and the hint under a problem', () => {
  const lines = report([
    evaluate(tool('Node'), 0, 'v24.21.0\n'),
    evaluate(tool('flatc'), 0, 'flatc version 23.5.26\n'),
  ])
  expect(lines).toEqual([
    'ok    Node   24.21.0',
    'FAIL  flatc  23.5.26 installed, 24.3.25 pinned',
    `             ${tool('flatc').hint}`,
  ])
})
```

Run:
`cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | grep -E "FAIL|Tests "`

Expected: FAIL: `Failed to resolve import "./check.ts"`.

- [ ] **Step 2: Write the check and its command**

`tools/build-scripts/src/toolchain/check.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `toolchain-check`: compares the installed toolchain with the pinned versions. The JVM
 * toolchain comes from `build-config.yaml`'s `toolchain:` block, read by the same parser as
 * `setup-jvm`'s awk and the workflow policy (`tools/ci/toolchain-pins.mjs`); Node, pnpm and Rust
 * come from `.node-version`, `package.json`'s `packageManager` and `rust-toolchain.toml`.
 */
import { readToolchainPins } from '../../../ci/toolchain-pins.mjs'

/** The pinned versions `toolchain-check` compares against. */
export interface Pins {
  readonly graalvm: string
  readonly sbt: string
  readonly flatc: string
  readonly graalpy: string
  readonly node: string
  readonly pnpm: string
  readonly rust: string
}

/** The files the pins come from, as text. */
export interface PinFiles {
  readonly buildConfig: string
  readonly nodeVersion: string
  readonly packageJson: string
  readonly rustToolchain: string
}

/** The pins in `files`; throws, naming the file, when one is missing. */
export function readPins(files: PinFiles): Pins {
  const toolchain = readToolchainPins(files.buildConfig)
  const required = (value: string | undefined, where: string): string => {
    if (value == null || value === '') throw new Error(`No pinned version in ${where}.`)
    return value
  }
  const manifest = JSON.parse(files.packageJson) as { packageManager?: string }
  return {
    graalvm: required(toolchain.graalvm, 'build-config.yaml (`toolchain.graalvm`)'),
    sbt: required(toolchain.sbt, 'build-config.yaml (`toolchain.sbt`)'),
    flatc: required(toolchain.flatc, 'build-config.yaml (`toolchain.flatc`)'),
    graalpy: required(toolchain.graalpy, 'build-config.yaml (`toolchain.graalpy`)'),
    node: required(files.nodeVersion.trim().replace(/^v/, ''), '.node-version'),
    pnpm: required(
      manifest.packageManager?.match(/^pnpm@([^+]+)/)?.[1],
      'package.json (`packageManager`)',
    ),
    rust: required(
      files.rustToolchain.match(/^\s*channel\s*=\s*"([^"]+)"/m)?.[1],
      'rust-toolchain.toml (`channel`)',
    ),
  }
}

/** One tool to check. */
export interface Tool {
  readonly name: string
  readonly program: string
  readonly args: readonly string[]
  readonly expected: string
  /** The version in the program's output (stdout and stderr together), or `null`. */
  readonly parse: (output: string) => string | null
  /** A missing tool fails the check. */
  readonly required: boolean
  /** A different version fails the check; otherwise it is a warning. */
  readonly strict: boolean
  readonly hint: string
}

/** The tools to check, in the order they are reported. */
export function toolsToCheck(pins: Pins): Tool[] {
  return [
    {
      name: 'GraalVM',
      program: 'java',
      args: ['-version'],
      expected: pins.graalvm,
      parse: (output) => output.match(/GraalVM CE (\d+(?:\.\d+)*)/)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Install GraalVM Community ${pins.graalvm}, first on the PATH, with JAVA_HOME pointing at it (SDKMAN: \`sdk install java ${pins.graalvm}-graalce\`). sbt refuses any other JDK.`,
    },
    {
      name: 'sbt launcher',
      program: 'sbt',
      args: ['--script-version'],
      expected: pins.sbt,
      parse: (output) => output.match(/^(\d+\.\d+\.\d+\S*)\s*$/m)?.[1] ?? null,
      required: true,
      strict: false,
      hint: `Install the sbt launcher (https://www.scala-sbt.org/download). CI uses ${pins.sbt}; \`project/build.properties\` decides the sbt version either way.`,
    },
    {
      name: 'flatc',
      program: 'flatc',
      args: ['--version'],
      expected: pins.flatc,
      parse: (output) => output.match(/flatc version (\S+)/)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Download flatc ${pins.flatc} from https://github.com/google/flatbuffers/releases/tag/v${pins.flatc} and put it on the PATH.`,
    },
    {
      name: 'Node',
      program: 'node',
      args: ['--version'],
      expected: pins.node,
      parse: (output) => output.match(/^v(\S+)/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Install Node ${pins.node} (\`.node-version\`), e.g. with fnm or nvm.`,
    },
    {
      name: 'pnpm',
      program: 'corepack',
      args: ['pnpm', '--version'],
      expected: pins.pnpm,
      parse: (output) => output.match(/^(\d+\.\d+\.\d+\S*)\s*$/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Run \`corepack enable\`: corepack then provides pnpm ${pins.pnpm} (\`packageManager\` in package.json).`,
    },
    {
      name: 'Rust',
      program: 'rustc',
      args: ['--version'],
      expected: pins.rust,
      parse: (output) => output.match(/^rustc (\S+)/m)?.[1] ?? null,
      required: true,
      strict: true,
      hint: `Install rustup (https://rustup.rs); in this repository it installs ${pins.rust} from rust-toolchain.toml on first use.`,
    },
    {
      name: 'GraalPy',
      program: 'graalpy',
      args: ['--version'],
      expected: pins.graalpy,
      parse: (output) => output.match(/GraalVM CE Native (\d+(?:\.\d+)*)/)?.[1] ?? null,
      required: false,
      strict: false,
      hint: `Optional: only test/Examples_Tests' Python spec runs it, and is skipped without it. Download graalpy-community-${pins.graalpy} from https://github.com/oracle/graalpython/releases/tag/graal-${pins.graalpy} and put its bin on the PATH.`,
    },
  ]
}

/** What one check found. */
export interface Result {
  readonly tool: Tool
  readonly found: string | null
  readonly status: 'ok' | 'mismatch' | 'missing'
  /** Whether this result fails the check. */
  readonly fails: boolean
}

/** The result for `tool`, given how its program exited and what it printed. */
export function evaluate(tool: Tool, exitStatus: number, output: string): Result {
  const found = tool.parse(output)
  if (found == null) {
    return {
      tool,
      found: exitStatus === 0 ? (output.trim().split('\n')[0] ?? '') : null,
      status: 'missing',
      fails: tool.required,
    }
  }
  if (found === tool.expected) return { tool, found, status: 'ok', fails: false }
  return { tool, found, status: 'mismatch', fails: tool.strict }
}

/** The report, one line per tool plus a hint under each problem. */
export function report(results: readonly Result[]): string[] {
  const width = Math.max(...results.map((result) => result.tool.name.length))
  const lines: string[] = []
  for (const result of results) {
    const label =
      result.status === 'ok' ? 'ok'
      : result.fails ? 'FAIL'
      : 'warn'
    const name = result.tool.name.padEnd(width)
    const detail =
      result.status === 'ok' ? result.tool.expected
      : result.status === 'mismatch' ? `${result.found} installed, ${result.tool.expected} pinned`
      : result.found != null ? `unrecognised output: ${result.found}`
      : `not found (${result.tool.program})`
    lines.push(`${label.padEnd(4)}  ${name}  ${detail}`)
    if (result.status !== 'ok') lines.push(`      ${' '.repeat(width)}  ${result.tool.hint}`)
  }
  return lines
}
```

`tools/build-scripts/src/commands/toolchain-check.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `toolchain-check`: reports whether the installed GraalVM, sbt, flatc, Node, pnpm, Rust and
 * GraalPy match the pinned versions, with an install hint for each that does not. Exits 1 when a
 * required tool is missing or at the wrong version.
 *
 *     corepack pnpm --silent --filter build-scripts run toolchain-check
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { capture, REPO_ROOT } from '../lib/repo.ts'
import { evaluate, readPins, report, toolsToCheck } from '../toolchain/check.ts'

try {
  const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8')
  const pins = readPins({
    buildConfig: read('build-config.yaml'),
    nodeVersion: read('.node-version'),
    packageJson: read('package.json'),
    rustToolchain: read('rust-toolchain.toml'),
  })
  const results = toolsToCheck(pins).map((tool) => {
    const ran = capture(tool.program, tool.args)
    return evaluate(tool, ran.status, `${ran.stdout}\n${ran.stderr}`)
  })
  for (const line of report(results)) console.log(line)
  if (results.some((result) => result.fails)) process.exitCode = 1
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

In `tools/build-scripts/package.json`, after the `"version"` script, add
`"toolchain-check": "node src/commands/toolchain-check.ts",`.

- [ ] **Step 3: Run every check, and the command**

```bash
cd /c/Repos/Enso/ide-bs-3b/tools/build-scripts
corepack pnpm exec prettier --write . > /dev/null
corepack pnpm run test:unit 2>&1 | grep -E "Tests |FAIL"
corepack pnpm run typecheck && corepack pnpm run lint && echo checks-ok
corepack pnpm --silent run toolchain-check; echo "exit $?"
```

Expected: no failing test; `checks-ok`; a report like (this machine,
2026-10-22):

```
ok    GraalVM       25.0.1
warn  sbt launcher  2.0.8 installed, 1.10.6 pinned
                    Install the sbt launcher (https://www.scala-sbt.org/download). CI uses 1.10.6; `project/build.properties` decides the sbt version either way.
ok    flatc         24.3.25
ok    Node          24.21.0
ok    pnpm          12.5.1
ok    Rust          1.98.1
warn  GraalPy       not found (graalpy)
                    Optional: only test/Examples_Tests' Python spec runs it, …
exit 0
```

No `DEP0190` deprecation warning (only shims go through the shell, as one
command line). If a required tool reports `FAIL` here, that is this machine's
state, not a bug: check it by hand (`java -version`, `flatc --version`) before
changing the code.

- [ ] **Step 4: Update the docs**

In `tools/build-scripts/CLAUDE.md`, under `## Commands`, after the `version`
bullet, add:

<!-- prettier-ignore -->
```markdown
- `toolchain-check` — compares the installed GraalVM, sbt launcher, flatc, Node,
  pnpm, Rust and GraalPy with the pins (`build-config.yaml` `toolchain:`,
  `.node-version`, `packageManager`, `rust-toolchain.toml`), with an install
  hint for each that differs. A wrong sbt launcher or a missing GraalPy only
  warns.
```

and under `## Conventions`, add:

<!-- prettier-ignore -->
```markdown
- **Only `src/lib/sbt.ts` runs sbt tasks** (it arrives with the first command
  that needs one). The workflow policy (`tools/ci/check-workflows.mjs`) fails
  any other module that starts sbt by name, and treats every command whose entry
  point imports that module as an sbt call, which must come after `setup-jvm`.
  The one exception is `toolchain-check`'s `sbt --script-version`, which asks
  the launcher its version and loads no build (Ruling R-plan-10).
```

In `CLAUDE.md`, in the bullet that begins
``  - `build-config.yaml` `toolchain:` — the GraalVM, sbt and flatc versions CI``,
replace that bullet with:

<!-- prettier-ignore -->
```markdown
  - `build-config.yaml` `toolchain:` — the GraalVM, sbt, flatc and GraalPy
    versions CI installs (`.github/actions/setup-jvm`) and
    `corepack pnpm --filter build-scripts run toolchain-check` compares a local
    toolchain against. Enforced (`checkToolchainPins`): Workflow Lint
    (`tools/ci/check-workflows.mjs`) fails when it differs from `graalVersion`,
    `graalMavenPackagesVersion`, `flatbuffersVersion` or `sbt.version`, so bump
    it in the same commit.
```

In `.github/CLAUDE.md`, replace the sentence
``It counts `sbt` after inline `VAR=value` assignments, `&&` or `;`, and inside local composite actions.``
with:

<!-- prettier-ignore -->
```markdown
It counts `sbt` (and `sbt.bat`) as a command after inline `VAR=value`
assignments and wrappers (`timeout`, `time`, `env`, `nice`, `xvfb-run`,
`cmd /c`), inside `bash -c` and `pwsh -Command` scripts and local composite
actions, and behind any `tools/build-scripts` command that starts sbt (one whose
entry point imports `src/lib/sbt.ts`).
```

Run
`corepack pnpm exec prettier --write CLAUDE.md .github/CLAUDE.md tools/build-scripts`,
then `--check` on the same paths.

- [ ] **Step 5: Commit, push, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3b
git add tools/build-scripts CLAUDE.md .github/CLAUDE.md
git commit -m "Add toolchain-check to tools/build-scripts"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3b && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3b .github/workflows/workflow-lint.yml > "$SCRATCH/compare-3b.md"
git push -u origin ci/toolchain-check
```

Expected: `actionlint-ok`; `compare-3b.md` shows only D2.

`$SCRATCH/pr-3b.md` holds: the shared parser and why (the awk and JS readers
disagreed on a glued comment and on duplicates — the table in Task 3's test);
the GraalPy pin; the `SBT_CALL` fix (spec must-carry 6) with the new shapes; the
build-scripts rule; `toolchain-check` and its local output; D2; `compare-3b.md`
in `<details>`; "Part of #289's Phase 3. Part of #313 (its first bullet; the
conditional `setup-jvm` and the unique cache keys remain)."; the attribution
lines.

```bash
gh pr create --base develop --head ci/toolchain-check --label "CI: No changelog needed" \
  --title "Build simplification, PR 3b: toolchain-check, one pin parser, and the sbt-call policy" \
  --body-file "$SCRATCH/pr-3b.md"
```

Run `"$SCRATCH/wait-pr.sh" <N> 120` in the background. Expected checks: Build
Scripts (65 tests on Linux), Workflow Lint (the awk-equivalence test runs there
on Linux: its log shows `ℹ skipped 0`), Changelog, and, because
`build-config.yaml` changed, ✨ Engine and ✨ IDE (unchanged jobs; they only
prove nothing broke). When every check is green: `gh pr merge <N> --squash`.

---

### Task 6: The changelog check as a GitHub script (PR 3c)

**Files:**

- Modify: `.github/workflows/changelog.yml` (whole file)
- Modify: `.github/CLAUDE.md` (one row), `CLAUDE.md` (the changelog convention)

**Interfaces:** none. The check keeps its workflow name and job name,
"Changelog", the label `CI: No changelog needed`, and `./run`'s messages
(`build_tools/build/src/changelog/check.rs`).

- [ ] **Step 1: Create the worktree, and write the workflow**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3c -b ci/changelog-github-script origin/develop
cd /c/Repos/Enso/ide-bs-3c
```

Replace `.github/workflows/changelog.yml` with:

<!-- prettier-ignore -->
```yaml
# Hand-written. Fails a pull request that has neither a `CHANGELOG.md` entry nor the
# `CI: No changelog needed` label (CLAUDE.md, "A `CHANGELOG.md` entry is for features ...").

name: Changelog
on:
  pull_request:
    # `labeled`/`unlabeled` so that adding or removing `CI: No changelog needed` re-runs the check.
    types: [labeled, unlabeled, synchronize, opened, reopened]
    # Specs and plans alone start no checks; every `pull_request` workflow ignores them
    # (`tools/ci/check-workflows.mjs` checks it).
    paths-ignore:
      - "docs/superpowers/**"

permissions:
  contents: read
  pull-requests: read

# Note [The Changelog Check Reads The Pull Request's Own Files]
# =============================================================
# `./run changelog-check` diffed the merge commit against `origin/<default branch>`, so a pull request
# stacked on another one saw its parent's changes too, and passed on the parent's `CHANGELOG.md`
# entry. `pulls.listFiles` lists the files of this pull request against its own base. Otherwise
# the rule and the messages are `./run`'s (`build_tools/build/src/changelog/check.rs`): no pull
# request, pass; the label, pass; `CHANGELOG.md` among the files, pass; else fail with the same
# text. The labels are the event's, as before: adding or removing one re-runs the check.
jobs:
  changelog:
    name: Changelog
    runs-on: ubuntu-latest
    steps:
      - name: Check the changelog
        uses: actions/github-script@v8
        with:
          script: |
            const label = 'CI: No changelog needed'
            const pr = context.payload.pull_request
            if (!pr) {
              core.info('Not a pull request, skipping the check.')
              return
            }
            core.info(`Checking if changelog is up to date for PR #${pr.number}.`)
            if (pr.labels.some((l) => l.name === label)) {
              core.info(`Skipping changelog check because the PR has the label ${label}.`)
              return
            }
            const files = await github.paginate(github.rest.pulls.listFiles, {
              ...context.repo,
              pull_number: pr.number,
              per_page: 100,
            })
            if (!files.some((f) => f.filename === 'CHANGELOG.md')) {
              core.setFailed(
                `CHANGELOG.md was not updated. Either update it or add the '${label}' label to the PR.`,
              )
            }
```

- [ ] **Step 2: Flip the row, and correct CLAUDE.md**

In `.github/CLAUDE.md`, "What still goes through `./run`", the row whose cells
are `` `changelog.yml` `` and `` `./run changelog-check` `` gets the cells
`` `actions/github-script` (`pulls.listFiles`) `` and `No`.

In `CLAUDE.md` ("A `CHANGELOG.md` entry is for features …"), the sentence says
labelling re-runs only the `Changelog` workflow "(a two-minute build-script job,
then the check)" — the parenthesis is wrapped over two lines there. Replace that
parenthesis with `(a GitHub script of a few seconds)`.
`docs/distribution/nightly.md`, which CLAUDE.md keeps in step, does not describe
the job, so it needs no change.

- [ ] **Step 3: Check, compare, commit, open the PR**

```bash
corepack pnpm exec prettier --write .github/workflows/changelog.yml .github/CLAUDE.md CLAUDE.md
node tools/ci/check-workflows.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3c && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3c .github/workflows/changelog.yml > "$SCRATCH/compare-3c.md"
git add .github/workflows/changelog.yml .github/CLAUDE.md CLAUDE.md
git commit -m "Changelog check: an inline GitHub script over the pull request's own files"
git push -u origin ci/changelog-github-script
```

Expected: `Workflow policy: OK`, `actionlint-ok`; `compare-3c.md` shows only D3.

Write `$SCRATCH/pr-3c.md`: the change; that it now reads the PR's own files, so
a stacked PR no longer passes on its parent's `CHANGELOG.md` entry (memory:
stacked PR merge order); D3; `compare-3c.md` in `<details>`; a "Verification"
section Step 4 fills in; "Part of #289's Phase 3."; the attribution lines. Open
it **without** the label, so that the first run shows the failure:

```bash
gh pr create --base develop --head ci/changelog-github-script \
  --title "Build simplification, PR 3c: the changelog check without ./run" --body-file "$SCRATCH/pr-3c.md"
```

- [ ] **Step 4: Prove the three outcomes**

Each run takes about ten seconds. After each action, wait for the Changelog run
of the branch's head
(`gh run list --workflow changelog.yml --branch ci/changelog-github-script -L 1`),
then read its log with
`gh run view <id> --log | grep -E "Checking if|Skipping|CHANGELOG.md was not"`.

1. As opened (no label, no `CHANGELOG.md` change). Expected: **failure**, with
   `Checking if changelog is up to date for PR #<N>.` and the annotation
   `CHANGELOG.md was not updated. Either update it or add the 'CI: No changelog needed' label to the PR.`
2. `gh pr edit <N> --add-label "CI: No changelog needed"`. Expected: a new run,
   **success**, with
   `Skipping changelog check because the PR has the label CI: No changelog needed.`
3. `gh pr edit <N> --remove-label "CI: No changelog needed"`, then a throwaway
   commit that touches `CHANGELOG.md` (add a blank line at its end), push.
   Expected: **success**, no "Skipping" line. Then `git revert --no-edit HEAD`,
   push, and add the label back:
   `gh pr edit <N> --add-label "CI: No changelog needed"`. Expected: success.

Record the four run links in the PR body's "Verification" section
(`gh pr edit <N> --body-file "$SCRATCH/pr-3c.md"`).

- [ ] **Step 5: Merge**

Run `"$SCRATCH/wait-pr.sh" <N> 60` in the background. The PR runs only
Changelog, Workflow Lint and the IDE gate's packaging (`.github/**` is in the
IDE change list): wait for all. When every check is green:
`gh pr merge <N> --squash`.

---

### Task 7: The Standard Library API check in `tools/build-scripts` (PR 3d)

**Files:**

- Create: `tools/build-scripts/src/lib/engine.ts`, `engine.test.ts`
- Create: `tools/build-scripts/src/stdlib-api-check/apiCheck.ts`,
  `apiCheck.test.ts`, `src/commands/stdlib-api-check.ts`
- Create: `.github/actions/setup-build-scripts/action.yml`
- Modify: `tools/build-scripts/package.json` (script), `CLAUDE.md`
- Modify: `.github/workflows/engine-checks-platform.yml`
  (`standard-library-api-check`)
- Modify: `.github/workflows/engine-changed-files.yml` (`files`)
- Modify: `.github/CLAUDE.md` (Layout `actions/`; one row split in two)

**Interfaces:**

- Consumes: `capture`, `runInherited`, `REPO_ROOT` (Task 1).
- Produces:
  - `src/lib/engine.ts`: `osName(platform)`, `archName(arch)`,
    `enginePackageDir(repoRoot, version, platform, arch)`,
    `findEnginePackage(repoRoot, version: string | undefined, platform?, arch?): { dir: string; version: string }`,
    `ensoBinary(packageDir, platform)` — Task 14 uses the last two;
  - the composite action `./.github/actions/setup-build-scripts` (no inputs):
    installs the package's dependencies only; use it after `setup-node` and
    after "Clean before";
  - the script `stdlib-api-check`.

- [ ] **Step 1: Create the worktree, and write the failing tests**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3d -b ci/stdlib-api-check origin/develop
cd /c/Repos/Enso/ide-bs-3d && corepack pnpm install --frozen-lockfile --ignore-scripts
```

`tools/build-scripts/src/lib/engine.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Finding the engine package. */
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { enginePackageDir, ensoBinary, findEnginePackage } from './engine.ts'

const repo = () => mkdtempSync(path.join(tmpdir(), 'engine-'))
const makePackage = (root: string, version: string, triple: string) => {
  const dir = path.join(
    root,
    'built-distribution',
    `enso-engine-${version}-${triple}`,
    `enso-${version}`,
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

test('the path sbt names', () => {
  expect(enginePackageDir('/r', '2026.1.1-dev', 'linux', 'x64')).toBe(
    path.join(
      '/r',
      'built-distribution',
      'enso-engine-2026.1.1-dev-linux-amd64',
      'enso-2026.1.1-dev',
    ),
  )
  expect(enginePackageDir('/r', '1.0.0', 'win32', 'x64')).toContain(
    'enso-engine-1.0.0-windows-amd64',
  )
  expect(enginePackageDir('/r', '1.0.0', 'darwin', 'arm64')).toContain(
    'enso-engine-1.0.0-macos-aarch64',
  )
})

describe('findEnginePackage', () => {
  test('with a version, that version, which must exist', () => {
    const root = repo()
    const dir = makePackage(root, '2026.1.1-dev', 'linux-amd64')
    expect(findEnginePackage(root, '2026.1.1-dev', 'linux', 'x64')).toEqual({
      dir,
      version: '2026.1.1-dev',
    })
    expect(() => findEnginePackage(root, '0.0.0-dev', 'linux', 'x64')).toThrow(
      'No engine package at',
    )
  })
  test('without a version, the only package', () => {
    const root = repo()
    const dir = makePackage(root, '0.0.0-dev', 'linux-amd64')
    expect(findEnginePackage(root, undefined, 'linux', 'x64')).toEqual({
      dir,
      version: '0.0.0-dev',
    })
    expect(findEnginePackage(root, '', 'linux', 'x64').dir).toBe(dir)
  })
  test('without a version, none or two packages is an error', () => {
    const root = repo()
    expect(() => findEnginePackage(root, undefined, 'linux', 'x64')).toThrow('found none')
    makePackage(root, '0.0.0-dev', 'linux-amd64')
    makePackage(root, '2026.1.1-dev', 'linux-amd64')
    expect(() => findEnginePackage(root, undefined, 'linux', 'x64')).toThrow('Expected exactly one')
  })
})

test('the launcher name', () => {
  expect(ensoBinary('/p', 'linux')).toBe(path.join('/p', 'bin', 'enso'))
  expect(ensoBinary('/p', 'win32')).toBe(path.join('/p', 'bin', 'enso.exe'))
})
```

`tools/build-scripts/src/stdlib-api-check/apiCheck.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The standard-library API check, with the engine and git faked. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { type ApiCheckContext, failureLines, librariesWithApi, runApiCheck } from './apiCheck.ts'

/** A repository with the given libraries; those in `withApi` have a committed `docs/api`. */
function repository(libraries: string[], withApi: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'api-check-'))
  const stdlib = path.join(root, 'distribution', 'lib', 'Standard')
  for (const library of libraries) {
    mkdirSync(path.join(stdlib, library, '0.0.0-dev', 'src'), { recursive: true })
    if (withApi.includes(library)) {
      mkdirSync(path.join(stdlib, library, '0.0.0-dev', 'docs', 'api'), { recursive: true })
    }
  }
  writeFileSync(path.join(stdlib, 'CLAUDE.md'), 'notes')
  return { root, stdlib }
}

describe('librariesWithApi', () => {
  test('sorted, only those with docs/api, files skipped', () => {
    const { stdlib } = repository(['Table', 'Base', 'Searcher', 'Test'], ['Table', 'Base', 'Test'])
    expect(librariesWithApi(stdlib)).toEqual(['Base', 'Table', 'Test'])
  })
  test('a library without 0.0.0-dev is an error', () => {
    const { stdlib } = repository(['Base'], ['Base'])
    mkdirSync(path.join(stdlib, 'Broken'))
    expect(() => librariesWithApi(stdlib)).toThrow(/Directory .*Broken.0\.0\.0-dev does not exist/)
  })
})

test("the failure message is ./run's", () => {
  expect(
    failureLines(
      'Base',
      'DIFF',
      'distribution/lib/Standard/Base/0.0.0-dev/docs/api',
      'distribution/lib/Standard/Base/0.0.0-dev',
    ),
  ).toEqual([
    'API check failed for library Standard.Base',
    'Current API vs Old API: DIFF',
    'If you wish to overwrite the current API in the directory distribution/lib/Standard/Base/0.0.0-dev/docs/api, run the following command\n' +
      '                       sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Base/0.0.0-dev"\n' +
      '                       and commit the modified files',
  ])
})

describe('runApiCheck', () => {
  const setup = (diffs: Record<string, number>) => {
    const { root } = repository(['Base', 'Table', 'Image'], ['Base', 'Table', 'Image'])
    const calls: string[] = []
    const errors: string[] = []
    const context: ApiCheckContext = {
      repoRoot: root,
      enginePackage: { dir: path.join(root, 'pkg'), version: '2026.1.1-dev' },
      enso: 'enso',
      runEnso: (args) => {
        calls.push(`enso ${args.join(' ')}`)
        return 0
      },
      diff: (oldDir) => {
        const library = path.basename(path.dirname(path.dirname(path.dirname(oldDir))))
        calls.push(`diff ${library}`)
        return { status: diffs[library] ?? 0, stdout: `diff of ${library}` }
      },
      log: () => {},
      error: (line) => errors.push(line),
    }
    return { root, calls, errors, context }
  }
  test('every library in order, generated into the engine package at its version', () => {
    const { root, calls, context } = setup({})
    expect(runApiCheck(context)).toBe(true)
    const built = (library: string) =>
      path.join(root, 'pkg', 'lib', 'Standard', library, '2026.1.1-dev')
    expect(calls).toEqual([
      `enso --docs api --in-project ${built('Base')}`,
      'diff Base',
      `enso --docs api --in-project ${built('Image')}`,
      'diff Image',
      `enso --docs api --in-project ${built('Table')}`,
      'diff Table',
    ])
  })
  test('stops at the first library whose API changed', () => {
    const { calls, errors, context } = setup({ Image: 1, Table: 1 })
    expect(runApiCheck(context)).toBe(false)
    expect(calls.at(-1)).toBe('diff Image')
    expect(errors[0]).toBe('API check failed for library Standard.Image')
    expect(errors[1]).toBe('Current API vs Old API: diff of Image')
    expect(errors.at(-1)).toBe('Error: API check failed for library Standard.Image')
  })
  test('a failing enso is an error', () => {
    const { context } = setup({})
    expect(() => runApiCheck({ ...context, runEnso: () => 3 })).toThrow('exited with 3')
  })
})
```

Run:
`cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | grep -E "FAIL|Tests "`

Expected: FAIL: `Failed to resolve import "./engine.ts"` and `"./apiCheck.ts"`.

- [ ] **Step 2: Write the implementation**

`tools/build-scripts/src/lib/engine.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file Finding the engine package that `sbt buildEngineDistribution` built (or that a CI job
 * downloaded): `built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`, the path
 * sbt's `engineDistributionRoot` and `./run`'s `paths.yaml` both name.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** The OS part of the artifact name, as `DistributionPackage.OS` spells it. */
export function osName(platform: NodeJS.Platform): 'linux' | 'windows' | 'macos' {
  switch (platform) {
    case 'linux':
      return 'linux'
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'macos'
    default:
      throw new Error(`No engine package is built for ${platform}.`)
  }
}

/** The architecture part of the artifact name, as `DistributionPackage.Architecture` spells it. */
export function archName(arch: string): 'amd64' | 'aarch64' {
  if (arch === 'x64') return 'amd64'
  if (arch === 'arm64') return 'aarch64'
  throw new Error(`No engine package is built for ${arch}.`)
}

/** The engine package directory for `version` on this platform. */
export function enginePackageDir(
  repoRoot: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const triple = `${version}-${osName(platform)}-${archName(arch)}`
  return path.join(repoRoot, 'built-distribution', `enso-engine-${triple}`, `enso-${version}`)
}

/** An engine package: its directory and the version it was built at. */
export interface EnginePackage {
  readonly dir: string
  readonly version: string
}

/**
 * The engine package to use. With `version` (a job takes it from the build job's outputs, as the
 * Enso lint does) it is that version's directory, which must exist. Without, the only package
 * under `built-distribution/`; none or several is an error.
 */
export function findEnginePackage(
  repoRoot: string,
  version: string | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): EnginePackage {
  if (version != null && version !== '') {
    const dir = enginePackageDir(repoRoot, version, platform, arch)
    if (!existsSync(dir)) throw new Error(`No engine package at ${dir}.`)
    return { dir, version }
  }
  const root = path.join(repoRoot, 'built-distribution')
  const found: EnginePackage[] = []
  if (existsSync(root)) {
    for (const artifact of readdirSync(root)) {
      if (!artifact.startsWith('enso-engine-')) continue
      const artifactDir = path.join(root, artifact)
      for (const child of readdirSync(artifactDir)) {
        const childVersion = child.match(/^enso-(.+)$/)?.[1]
        if (childVersion != null && artifact.startsWith(`enso-engine-${childVersion}-`)) {
          found.push({ dir: path.join(artifactDir, child), version: childVersion })
        }
      }
    }
  }
  if (found.length !== 1) {
    const list = found.map((entry) => entry.dir).join(', ') || 'none'
    throw new Error(
      `Expected exactly one engine package under ${root}, found ${list}. Set ENSO_VERSION to choose.`,
    )
  }
  return found[0] as EnginePackage
}

/** The `enso` launcher of an engine package. */
export function ensoBinary(packageDir: string, platform: NodeJS.Platform): string {
  return path.join(packageDir, 'bin', platform === 'win32' ? 'enso.exe' : 'enso')
}
```

`tools/build-scripts/src/stdlib-api-check/apiCheck.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `stdlib-api-check`: a port of `RunContext::stdlib_api_check` (`build_tools/build/src/engine/
 * context.rs`). For each standard library with a `docs/api` directory, the built engine regenerates
 * the API docs in the engine package (`enso --docs api --in-project <lib>`), and `git diff
 * --no-index` compares them with the committed ones. The first library that differs fails the
 * check, with `./run`'s messages.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** The version directory of every library in the source tree. */
export const SOURCE_VERSION = '0.0.0-dev'

/**
 * The libraries under `stdlibRoot` (`distribution/lib/Standard`) that have a committed API, sorted.
 * A library without a `0.0.0-dev` directory is an error, as in `./run`.
 */
export function librariesWithApi(stdlibRoot: string): string[] {
  const libraries: string[] = []
  for (const name of readdirSync(stdlibRoot).sort()) {
    const dir = path.join(stdlibRoot, name)
    if (!statSync(dir).isDirectory()) continue
    const versionDir = path.join(dir, SOURCE_VERSION)
    if (!existsSync(versionDir)) throw new Error(`Directory ${versionDir} does not exist`)
    if (existsSync(path.join(versionDir, 'docs', 'api'))) libraries.push(name)
  }
  return libraries
}

/** `./run`'s report for a library whose API changed. Paths are relative to the repository. */
export function failureLines(
  library: string,
  diff: string,
  oldApiDir: string,
  librarySourceDir: string,
): string[] {
  return [
    `API check failed for library Standard.${library}`,
    `Current API vs Old API: ${diff}`,
    `If you wish to overwrite the current API in the directory ${oldApiDir}, run the following command
                       sbt "runEngineDistribution --no-ir-caches --docs=api --in-project ${librarySourceDir}"
                       and commit the modified files`,
  ]
}

/** What the check needs from the outside world. */
export interface ApiCheckContext {
  readonly repoRoot: string
  /** The engine package directory and the version its libraries are installed at. */
  readonly enginePackage: { readonly dir: string; readonly version: string }
  readonly enso: string
  /** Runs `enso` with the given arguments, output inherited; returns the exit status. */
  readonly runEnso: (args: readonly string[]) => number
  /** `git diff --no-index <old> <new> --exit-code --no-ext-diff`: its status and stdout. */
  readonly diff: (
    oldDir: string,
    newDir: string,
  ) => { readonly status: number; readonly stdout: string }
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

/** Runs the check; returns whether every library's API is unchanged. */
export function runApiCheck(context: ApiCheckContext): boolean {
  const stdlibRoot = path.join(context.repoRoot, 'distribution', 'lib', 'Standard')
  const relative = (target: string) => path.relative(context.repoRoot, target)
  const libraries = librariesWithApi(stdlibRoot)
  context.log(`Checking API for standard libraries: ${libraries.join(', ')}`)
  for (const library of libraries) {
    const sourceDir = path.join(stdlibRoot, library, SOURCE_VERSION)
    const oldApiDir = path.join(sourceDir, 'docs', 'api')
    const builtDir = path.join(
      context.enginePackage.dir,
      'lib',
      'Standard',
      library,
      context.enginePackage.version,
    )
    const status = context.runEnso(['--docs', 'api', '--in-project', builtDir])
    if (status !== 0) {
      throw new Error(
        `\`${context.enso} --docs api --in-project ${builtDir}\` exited with ${status}.`,
      )
    }
    const diff = context.diff(oldApiDir, path.join(builtDir, 'docs', 'api'))
    if (diff.status !== 0) {
      for (const line of failureLines(
        library,
        diff.stdout,
        relative(oldApiDir),
        relative(sourceDir),
      )) {
        context.error(line)
      }
      context.error(`Error: API check failed for library Standard.${library}`)
      return false
    }
  }
  return true
}
```

`tools/build-scripts/src/commands/stdlib-api-check.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `stdlib-api-check`: regenerates each standard library's API docs with the built engine and
 * fails when they differ from the committed ones. CI sets `ENSO_VERSION` to the build job's version
 * (as the Enso lint does); locally, without it, the only package in `built-distribution/` is used.
 *
 *     corepack pnpm --filter build-scripts run stdlib-api-check
 */
import { ensoBinary, findEnginePackage } from '../lib/engine.ts'
import { capture, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { runApiCheck } from '../stdlib-api-check/apiCheck.ts'

try {
  const enginePackage = findEnginePackage(REPO_ROOT, process.env.ENSO_VERSION)
  const enso = ensoBinary(enginePackage.dir, process.platform)
  const ok = runApiCheck({
    repoRoot: REPO_ROOT,
    enginePackage,
    enso,
    runEnso: (args) => runInherited(enso, args),
    diff: (oldDir, newDir) =>
      capture('git', ['diff', '--no-index', oldDir, newDir, '--exit-code', '--no-ext-diff']),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
  if (!ok) process.exitCode = 1
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

In `tools/build-scripts/package.json`, after the `"toolchain-check"` script, add
`"stdlib-api-check": "node src/commands/stdlib-api-check.ts",`.

In `tools/build-scripts/CLAUDE.md`, under `## Commands`, after the
`toolchain-check` bullet, add:

<!-- prettier-ignore -->
```markdown
- `stdlib-api-check` — what `./run backend stdlib-api-check` did: for each
  standard library with a `docs/api` directory, regenerate the API docs with
  the built engine (`enso --docs api --in-project`) and `git diff --no-index`
  them against the committed ones; the first that differs fails, with `./run`'s
  message. CI passes the build job's `ENSO_VERSION`; locally the only package in
  `built-distribution/` is used.
```

and in `## Layout`, extend the `src/lib/` bullet's list with
``finding the engine package (`engine.ts`),``.

Run:

```bash
corepack pnpm exec prettier --write . > /dev/null
corepack pnpm run test:unit 2>&1 | grep -E "Tests |FAIL"
corepack pnpm run typecheck && corepack pnpm run lint && echo checks-ok
corepack pnpm --silent run stdlib-api-check; echo "exit $?"
```

Expected: `Tests  76 passed (76)`; `checks-ok`; and, with no
`built-distribution/` in this worktree,
`Error: Expected exactly one engine package under …built-distribution, found none. Set ENSO_VERSION to choose.`
and `exit 1`. Do not run it against the main checkout's distribution: it writes
the regenerated docs into that package.

- [ ] **Step 3: The `setup-build-scripts` action, and the job**

`.github/actions/setup-build-scripts/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up the build scripts
description: >-
  Installs `tools/build-scripts`' dependencies, and only those (no lifecycle scripts, so no Rust
  parser build), so that a later step can run `corepack pnpm --filter build-scripts run <command>`.
  Node runs the TypeScript directly (type stripping), so there is nothing to compile. Use it after
  `setup-node` and after "Clean before": `git-clean` deletes `node_modules`.
runs:
  using: composite
  steps:
    - if: runner.os == 'Windows'
      name: Install the build scripts' dependencies
      shell: pwsh
      run: corepack pnpm install --frozen-lockfile --ignore-scripts --filter build-scripts
    - if: runner.os != 'Windows'
      name: Install the build scripts' dependencies
      shell: bash
      run: corepack pnpm install --frozen-lockfile --ignore-scripts --filter build-scripts
```

In `.github/workflows/engine-checks-platform.yml`, replace the whole
`standard-library-api-check:` job (from `  standard-library-api-check:` up to,
not including, `  stdlib-tests:`) with:

<!-- prettier-ignore -->
```yaml
  # `tools/build-scripts`' `stdlib-api-check` runs what `./run backend stdlib-api-check` ran, against
  # the downloaded distribution at the build job's version.
  standard-library-api-check:
    name: Standard Library API check (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Check the Standard Library API
        run: corepack pnpm --filter build-scripts run stdlib-api-check
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

In `.github/workflows/engine-changed-files.yml`, after the line
`            build-config.yaml`, add:

<!-- prettier-ignore -->
```yaml
            tools/build-scripts/**
```

(the engine checks now run code from that package; IDE packaging follows, since
`ide-pull-request.yml` packages whenever the engine list fires).

- [ ] **Step 4: Update `.github/CLAUDE.md`**

In the Layout bullet that begins ``- `actions/` — composite actions:``, after
`` `git-clean`, `` insert
`` `setup-build-scripts` (install `tools/build-scripts`' dependencies only), ``.

In "What still goes through `./run`", replace the row whose cells are
`` `engine-checks-platform.yml` › API check, stdlib tests `` with two rows:

<!-- prettier-ignore -->
```markdown
| `engine-checks-platform.yml` › API check                 | `corepack pnpm --filter build-scripts run stdlib-api-check` | No: `setup-build-scripts`                           |
| `engine-checks-platform.yml` › stdlib tests              | `./run backend test …`                                   | Yes: Phase 3 (`stdlib-test`)                        |
```

Run `corepack pnpm exec prettier --write .github` and `--check .github`.

- [ ] **Step 5: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3d
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3d && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3d .github/workflows/engine-checks.yml .github/workflows/engine-changed-files.yml > "$SCRATCH/compare-3d.md"
git add tools/build-scripts .github
git commit -m "Standard Library API check: tools/build-scripts instead of ./run"
git push -u origin ci/stdlib-api-check
```

Expected: `Workflow policy: OK`, `ℹ fail 0`, `actionlint-ok`; `compare-3d.md`
shows D4 under "Standard Library API check (linux, amd64)" and the changed-files
list, nothing else.

`$SCRATCH/pr-3d.md`: the move; the ruling that the check keeps `./run`'s
behaviour, including stopping at the first failing library and not seeing a
removed module's stale `.md` (Tickets to raise); no `setup-jvm` (R-plan-5); D4;
`compare-3d.md`; a "Verification" section; "Part of #289's Phase 3."; the
attribution lines.

```bash
gh pr create --base develop --head ci/stdlib-api-check --label "CI: No changelog needed" \
  --title "Build simplification, PR 3d: the Standard Library API check without ./run" \
  --body-file "$SCRATCH/pr-3d.md"
```

- [ ] **Step 6: Prove it passes, and that it fails the way `./run` failed**

Run `"$SCRATCH/wait-pr.sh" <N> 300` in the background. When ✨ Engine has
finished:

```bash
id=$(gh run list --workflow engine-pull-request.yml --branch ci/stdlib-api-check -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/job-times.sh" "$id"
gh run view "$id" --log | grep -E "Checking API for standard libraries" | head -1
```

Expected: every job green; "Standard Library API check (linux, amd64)" within a
few minutes of develop's time (it no longer downloads `./run` or GraalPy); the
log lists the 18 libraries, sorted:
`AWS, Base, Database, DuckDB, Examples, Generic_JDBC, Geo, Google, Google_Api, Image, Microsoft, Saas, Searcher, Snowflake, Table, Tableau, Test, Visualization`.

Then the negative test. Change one committed API file, push, and let only the
engine checks run:

```bash
f=$(git ls-files 'distribution/lib/Standard/Base/0.0.0-dev/docs/api/*.md' | head -1)
printf '\n- probe\n' >> "$f"
git commit -am "TEMPORARY: prove the API check fails"
git push
```

Expected, in the new run's API check job: **failure**, with
`API check failed for library Standard.Base`, `Current API vs Old API: ` and a
diff showing `- probe`, the `If you wish to overwrite …` hint naming
`distribution/lib/Standard/Base/0.0.0-dev/docs/api` and
`sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Base/0.0.0-dev"`,
and `Error: API check failed for library Standard.Base`. Cancel the rest of that
run (`gh run cancel <id>`), then:

```bash
git revert --no-edit HEAD && git push
```

Put both run links and the failure lines in the PR body.

- [ ] **Step 7: Merge**

Wait for the run after the revert. When every check is green:
`gh pr merge <N> --squash`.

---

### Task 8: `checkEnsoSyntax` in sbt (PR 3e)

**Files:**

- Create: `project/EnsoSyntaxCheck.scala`
- Modify: `build.sbt` (after `lintEnso`)
- Modify: `.github/workflows/engine-checks-platform.yml` (`enso-code-lint`)
- Modify: `.github/CLAUDE.md` (one row)

**Interfaces:**

- Produces: the sbt task `checkEnsoSyntax` (root project);
  `EnsoSyntaxCheck. files(repoRoot)`, `batches(paths, limit)`,
  `run(repoRoot, log)`.
- Note: `./run libraries check-syntax` stays in Rust:
  `engine-checks-nightly.yml` calls it until Phase 4.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3e -b ci/check-enso-syntax origin/develop
cd /c/Repos/Enso/ide-bs-3e && corepack pnpm install --frozen-lockfile --ignore-scripts
git ls-files 'distribution/lib/**/*.enso' 'test/**/*.enso' | wc -l
```

Expected: `986` (the files `./run` checked; it globbed the same two trees). Note
the number; Step 5 compares it with the task's log.

- [ ] **Step 2: Write the task**

`project/EnsoSyntaxCheck.scala`:

<!-- prettier-ignore -->
```scala
import sbt._
import sbt.internal.util.{ManagedLogger, MessageOnlyException}

import java.nio.file.Files
import scala.collection.JavaConverters._
import scala.sys.process._

/** Parses every `.enso` file under `distribution/lib` and `test` with the Rust parser's
  * `check_syntax` tool, and fails on any syntax error or warning.
  *
  * This is what `./run libraries check-syntax` ran
  * (`build_tools/build/src/rust/enso_linter.rs`): `cargo run -p enso-parser-debug --bin
  * check_syntax --release -- <files>`, which prints `E <path> <line>:<col>-<line>:<col>: <message>`
  * (or `W …` for a warning) to stderr and exits 1 when any file has a message. The same files, the
  * same tool and the same rules, so errors and warnings both fail.
  *
  * Two differences, both for Windows developers: the file list goes in batches of at most
  * [[MaxArgumentChars]] characters, since ~1,000 absolute paths are far over Windows' 32,767
  * character command line (`./run` only ever ran it on Linux); and the exit code is checked here
  * rather than through [[Cargo.run]], which only logs a failure.
  */
object EnsoSyntaxCheck {

  /** The most characters of file arguments per `check_syntax` call. */
  val MaxArgumentChars = 20000

  private val Summary =
    """Errors or warnings found in (\d+) files""".r.unanchored

  /** The `.enso` files `./run` checked: everything under `distribution/lib` and `test`, sorted. */
  def files(repoRoot: File): Seq[File] =
    Seq(repoRoot / "distribution" / "lib", repoRoot / "test").flatMap { dir =>
      if (!dir.exists()) Seq()
      else {
        val stream = Files.walk(dir.toPath)
        try {
          stream
            .iterator()
            .asScala
            .filter(path =>
              Files.isRegularFile(path) && path.getFileName.toString
                .endsWith(".enso")
            )
            .map(_.toFile)
            .toList
        } finally stream.close()
      }
    }.sorted

  /** Splits `paths` into batches whose joined length (one space between) stays under `limit`. */
  def batches(paths: Seq[String], limit: Int): Seq[Seq[String]] =
    paths.foldLeft(Vector(Vector.empty[String])) { (acc, path) =>
      val current = acc.last
      val length  = current.map(_.length + 1).sum + path.length
      if (current.nonEmpty && length > limit) acc :+ Vector(path)
      else acc.init :+ (current :+ path)
    }

  /** Runs the check; throws when any file has a syntax error or warning. */
  def run(repoRoot: File, log: ManagedLogger): Unit = {
    if (!Cargo.cargoOk(log))
      throw new MessageOnlyException(
        "checkEnsoSyntax needs `cargo` on the PATH."
      )
    val all = files(repoRoot).map(_.getAbsolutePath)
    log.info(s"Checking the syntax of ${all.size} Enso files.")
    var failedFiles = 0
    for (batch <- batches(all, MaxArgumentChars)) {
      val command = Seq(
        "cargo",
        "run",
        "-p",
        "enso-parser-debug",
        "--bin",
        "check_syntax",
        "--release",
        "--"
      ) ++ batch
      var summary: Option[Int] = None
      val logger = ProcessLogger(
        line => log.info(line),
        line => {
          line match {
            case Summary(count) => summary = Some(count.toInt)
            case _              =>
          }
          log.info(line)
        }
      )
      val exitCode = Process(command, repoRoot).!(logger)
      if (exitCode != 0) {
        summary match {
          case Some(count) => failedFiles += count
          case None =>
            throw new MessageOnlyException(
              s"`cargo run -p enso-parser-debug --bin check_syntax` exited with $exitCode."
            )
        }
      }
    }
    if (failedFiles > 0)
      throw new MessageOnlyException(
        s"Enso syntax check failed: errors or warnings found in $failedFiles files."
      )
    log.info("Enso syntax check passed.")
  }
}
```

In `build.sbt`, after the `lintEnso := { … }` block (its last line is
`  linter.check(whatToLint)` and then `}`), add:

<!-- prettier-ignore -->
```scala

lazy val checkEnsoSyntax = taskKey[Unit](
  "Parses every .enso file under distribution/lib and test with the Rust parser's check_syntax " +
  "tool (through cargo) and fails on any syntax error or warning. Replaces " +
  "`./run libraries check-syntax`; see project/EnsoSyntaxCheck.scala."
)
checkEnsoSyntax := EnsoSyntaxCheck.run(baseDirectory.value, streams.value.log)
```

- [ ] **Step 3: Run it in WSL: it passes, and a syntax error fails it**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3e && export CARGO_TARGET_DIR=$HOME/enso-target && LC_ALL=C.UTF-8 sbt -Dsbt.server.autostart=false checkEnsoSyntax scalafmtSbtCheck' 2>&1 < /dev/null | cut -c1-200 | grep -E "Checking the syntax|Running|syntax check|success|error"
```

Expected: `Checking the syntax of 986 Enso files.`, five `Running …check_syntax`
lines (five batches of at most 20,000 characters of paths),
`Enso syntax check passed.`, and two `[success]` lines (the task, then
`scalafmtSbtCheck`). The first run compiles `enso-parser-debug` (a few minutes).

Then the negative case:

```bash
mkdir -p test/Zz_Syntax_Probe && printf 'main =\n    x = (1 +\n    x\n' > test/Zz_Syntax_Probe/Probe.enso
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3e && export CARGO_TARGET_DIR=$HOME/enso-target && LC_ALL=C.UTF-8 sbt -Dsbt.server.autostart=false checkEnsoSyntax' 2>&1 < /dev/null | cut -c1-200 | grep -E "^\[info\] E |Errors or warnings|syntax check failed"; echo "exit ${PIPESTATUS[0]}"
rm -r test/Zz_Syntax_Probe
```

Expected (tested while writing this plan):

```
[info] E /mnt/c/Repos/Enso/ide-bs-3e/test/Zz_Syntax_Probe/Probe.enso 2:8-2:12: Unclosed parenthesis in expression:  (1 +
[info] Error: "Errors or warnings found in 1 files."
[error] Enso syntax check failed: errors or warnings found in 1 files.
[error] (checkEnsoSyntax) Enso syntax check failed: errors or warnings found in 1 files.
exit 1
```

- [ ] **Step 4: Move the lint job's syntax check**

In `.github/workflows/engine-checks-platform.yml`, in the Note [Lint Reads The
Distribution's Version], replace its last line, `# the step does not pass it.`,
with:

<!-- prettier-ignore -->
```yaml
  # the step does not pass it. The syntax check (`checkEnsoSyntax`, which replaced
  # `./run libraries check-syntax`) runs the Rust parser's `check_syntax` through cargo.
```

Replace the job's head and its first four steps — from `  enso-code-lint:` down
to, not including, `      - name: Download the engine distribution` — with:

<!-- prettier-ignore -->
```yaml
  enso-code-lint:
    name: Enso Code Lint (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LINT_ENABLE_GITHUB_ANNOTATIONS: "true"
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: enso-code-lint
          flatc: "true"
      - name: Check syntax
        run: sbt "-Dsbt.server.autostart=false" checkEnsoSyntax
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
```

Then delete the job's old "Set up the JVM toolchain" step, which follows
"Download the engine distribution": the five lines from
`      - name: Set up the JVM toolchain` to `          flatc: "true"`. It is now
the step before "Check syntax". The rest of the job ("Download the engine
distribution", "Check the distribution's version", "Lint", "Clean after") is
unchanged.

In `.github/CLAUDE.md`, the row whose cells are
`` `engine-checks-platform.yml` › Enso Code Lint `` and
`` `./run libraries check-syntax` `` gets the cells `` `sbt checkEnsoSyntax` ``
and `` No: `setup-jvm` ``.

- [ ] **Step 5: Check, compare, commit, open the PR, prove it**

```bash
cd /c/Repos/Enso/ide-bs-3e
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3e && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3e .github/workflows/engine-checks.yml > "$SCRATCH/compare-3e.md"
git add project/EnsoSyntaxCheck.scala build.sbt .github
git commit -m "checkEnsoSyntax: the Rust parser's syntax check as an sbt task; the lint job drops ./run"
git push -u origin ci/check-enso-syntax
```

Expected: `Workflow policy: OK` (the policy sees `sbt … checkEnsoSyntax` after
`setup-jvm`), `actionlint-ok`; `compare-3e.md` shows D5 only.

`$SCRATCH/pr-3e.md`: R-user-2 (the Rust tool, not JNI; errors and warnings fail;
batching; the exit code checked, unlike `Cargo.run`); must-carry 9
(`setup-build-script` dropped); the local proofs of Step 3; D5; `compare-3e.md`;
"Part of #289's Phase 3."; the attribution lines.

```bash
gh pr create --base develop --head ci/check-enso-syntax --label "CI: No changelog needed" \
  --title "Build simplification, PR 3e: checkEnsoSyntax replaces ./run libraries check-syntax" \
  --body-file "$SCRATCH/pr-3e.md"
```

Run `"$SCRATCH/wait-pr.sh" <N> 300` in the background. When it exits:

```bash
id=$(gh run list --workflow engine-pull-request.yml --branch ci/check-enso-syntax -L 1 --json databaseId --jq '.[0].databaseId')
gh run view "$id" --log | grep -E "Checking the syntax of|Enso syntax check passed" | sed 's/.*\[info\] //' | sort -u
"$SCRATCH/job-times.sh" "$id" | grep -E "Lint|Distribution"
```

Expected: `Checking the syntax of 986 Enso files.` (Step 1's count) and
`Enso syntax check passed.`; Enso Code Lint green and no slower than develop's
by more than a few minutes (it no longer downloads `./run` or GraalPy, and gains
one sbt start); "Test Formatting" green (it runs on every PR, and checks the new
Scala). When every check is green: `gh pr merge <N> --squash`.

---

### Task 9: `ciBuildEngineDistribution` and the shared MSVC runtime copy, in sbt (PR 3f)

**Files:**

- Create: `project/MsvcRuntime.scala`
- Modify: `project/GatherLicenses.scala` (a public `verifyPackageAt`)
- Modify: `build.sbt` (after `checkIRCacheSizes`)

**Interfaces:**

- Produces:
  - `MsvcRuntime.copyCrtDlls(packageRoot: File, log: ManagedLogger): Seq[File]`
    (Task 11 calls it too), `MsvcRuntime.importedDlls(dumpbinOutput)`,
    `MsvcRuntime.crtDlls(redistDir)`;
  - `GatherLicenses.verifyPackageAt(log, distributionConfig, packageDestination)`;
  - the sbt task `ciBuildEngineDistribution` (root project).

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3f -b ci/engine-distribution-sbt origin/develop
cd /c/Repos/Enso/ide-bs-3f && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f tools/build-scripts/src/commands/version.ts && echo "3a is in"
```

Expected: `3a is in`.

- [ ] **Step 2: Write the DLL copy**

`./run` copied, for each `.exe` and `.dll` in the engine package (listed before
copying), the CRT DLLs it imports (`%VCToolsRedistDir%\x64\*.CRT\*.dll`) into
that binary's own directory. On the 2026-10 runner that is 7 files; a
`dumpbin /dependents` survey of the package showed the set is exactly "direct
CRT imports, per directory". `project/MsvcRuntime.scala`:

<!-- prettier-ignore -->
```scala
import sbt._
import sbt.internal.util.{ManagedLogger, MessageOnlyException}

import scala.sys.process._

/** Copies the MSVC C runtime DLLs that the engine package's Windows binaries import next to those
  * binaries, so that the package runs on a machine without the Visual C++ redistributable.
  *
  * This is what `./run` did after `buildEngineDistribution` on Windows
  * (`build_tools/build/src/engine/context.rs`, `ci_utils/src/packaging.rs`,
  * `programs/vs/redist.rs`): the CRT set is every DLL under
  * `%VCToolsRedistDir%\x64\*.CRT\`, the binaries are every `.exe` and `.dll` in the package
  * (listed before anything is copied), and each binary gets the CRT DLLs it imports copied into
  * its own directory. Imports are read with `dumpbin /dependents`, which `setup-msvc` (CI) or a
  * Developer Prompt (locally) puts on the PATH together with `VCToolsRedistDir`. The CRT DLLs
  * that a copied DLL imports in turn are copied too (`msvcp140.dll` imports `vcruntime140.dll`),
  * which adds nothing today but keeps the closure complete.
  *
  * On the 2026-10 runner image this copies 7 files: `bin/` msvcp140, vcruntime140,
  * vcruntime140_1; `component/` vcruntime140, vcruntime140_1;
  * `lib/Standard/Snowflake/<version>/polyglot/lib/amd64/windows/` vcruntime140;
  * `python-home/lib-graalpython/` vcruntime140.
  */
object MsvcRuntime {

  private val DllName = """(?i)^\s+(\S+\.dll)\s*$""".r

  /** The DLL names in `dumpbin /dependents` output (including delay-load dependencies). */
  def importedDlls(dumpbinOutput: String): Seq[String] =
    dumpbinOutput.linesIterator.collect { case DllName(name) => name }.toSeq

  /** The CRT DLLs under `<redist>\x64\*.CRT\`, by lower-case file name. */
  def crtDlls(redistDir: File): Map[String, File] = {
    val x64 = redistDir / "x64"
    val crtDirs = Option(x64.listFiles()).toSeq.flatten
      .filter(dir =>
        dir.isDirectory && dir.getName.toLowerCase.endsWith(".crt")
      )
    crtDirs
      .flatMap(dir => (dir ** "*.dll").get)
      .map(dll => dll.getName.toLowerCase -> dll)
      .toMap
  }

  /** Copies the CRT DLLs into `packageRoot`; returns the files written. */
  def copyCrtDlls(packageRoot: File, log: ManagedLogger): Seq[File] = {
    val redist = sys.env.getOrElse(
      "VCToolsRedistDir",
      throw new MessageOnlyException(
        "VCToolsRedistDir is not set: run this from a Visual Studio Developer Prompt " +
        "(CI: the `setup-msvc` action) so that the MSVC runtime DLLs can be copied."
      )
    )
    val crt = crtDlls(file(redist))
    if (crt.isEmpty)
      throw new MessageOnlyException(s"No CRT DLLs under $redist\\x64\\*.CRT.")
    val binaries = (packageRoot ** ("*.exe" || "*.dll")).get
    val imports  = scala.collection.mutable.Map[File, Seq[String]]()
    def importsOf(binary: File): Seq[String] =
      imports.getOrElseUpdate(
        binary, {
          val output =
            Seq("dumpbin", "/nologo", "/dependents", binary.getAbsolutePath).!!
          importedDlls(output).map(_.toLowerCase)
        }
      )
    val copied = for {
      binary <- binaries
      dir = binary.getParentFile
      name <- closure(importsOf(binary), crt, dll => importsOf(crt(dll)))
    } yield {
      val target = dir / crt(name).getName
      IO.copyFile(crt(name), target, preserveLastModified = true)
      log.info(
        s"Copied ${crt(name).getName} next to ${binary.getName} in $dir."
      )
      target
    }
    copied.distinct
  }

  /** The CRT DLLs among `direct`, and those they import, transitively. */
  private def closure(
    direct: Seq[String],
    crt: Map[String, File],
    importsOfCrt: String => Seq[String]
  ): Seq[String] = {
    val found   = scala.collection.mutable.LinkedHashSet[String]()
    var pending = direct.filter(crt.contains)
    while (pending.nonEmpty) {
      val next = pending.filterNot(found.contains)
      found ++= next
      pending = next.flatMap(importsOfCrt).filter(crt.contains)
    }
    found.toSeq
  }
}
```

- [ ] **Step 3: Make the package check callable from another task**

In `project/GatherLicenses.scala`, before
`  case class LegalReviewException(string: String)`, add:

<!-- prettier-ignore -->
```scala
  /** `verifyGeneratedPackage` for one package, for tasks that verify several
    * (`ciBuildEngineDistribution` in build.sbt).
    */
  def verifyPackageAt(
    log: Logger,
    distributionConfig: File,
    packageDestination: File
  ): Unit = verifyPackage(log, distributionConfig, packageDestination)

```

- [ ] **Step 4: Add the task**

In `build.sbt`, after the `checkIRCacheSizes := Def … .value` block (it ends
`  .dependsOn(buildEngineDistribution)` and `  .value`), add:

<!-- prettier-ignore -->
```scala
/* Note [CI Engine Distribution Build]
 * ===================================
 * What `./run backend ci-build-engine-distribution` ran after `clean`, in one sbt session:
 * `buildEngineDistribution`; then `checkIRCacheSizes`; then, on Windows, the MSVC runtime DLL
 * copy into the engine package (`MsvcRuntime`, which needs `setup-msvc` or a Developer Prompt);
 * then, not on Windows, `verifyGeneratedPackage` for the engine and for Base, Table, Image and
 * Database at the package's versioned paths (`./run` skipped it on Windows: "FIXME ... CRLF
 * issues?"). CI calls `sbt "clean; all ciBuildEngineDistribution"`. It is a task of its own, not a
 * CI flag on `buildEngineDistribution`: `checkIRCacheSizes` depends on that task, and `CI` is
 * set in every job that reaches it (lint, benchmarks, JVM tests, the IDE bundle).
 */
lazy val ciBuildEngineDistribution = taskKey[Unit](
  "CI's engine distribution build: buildEngineDistribution, checkIRCacheSizes, the MSVC runtime " +
  "DLL copy (Windows) and verifyGeneratedPackage (not Windows). See Note [CI Engine Distribution Build]."
)
ciBuildEngineDistribution := Def
  .sequential(
    buildEngineDistribution,
    Def.task {
      val log  = streams.value.log
      val root = engineDistributionRoot.value
      IRCaches.checkCacheSizes(
        stdLibRoot  = root / "lib" / "Standard",
        ensoVersion = ensoVersion,
        log         = log
      )
      if (Platform.isWindows) {
        MsvcRuntime.copyCrtDlls(root, log)
      } else {
        val configRoot = GatherLicenses.configurationRoot.value
        GatherLicenses.verifyPackageAt(
          log,
          configRoot / "engine",
          root / "THIRD-PARTY"
        )
        for (lib <- Seq("Base", "Table", "Image", "Database")) {
          GatherLicenses.verifyPackageAt(
            log,
            configRoot / lib,
            root / "lib" / "Standard" / lib / ensoVersion / "THIRD-PARTY"
          )
        }
      }
    }
  )
  .value
```

- [ ] **Step 5: Load the build and check the formatting, in WSL**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3f && LC_ALL=C.UTF-8 sbt -Dsbt.server.autostart=false "inspect ciBuildEngineDistribution" scalafmtSbtCheck' 2>&1 < /dev/null | grep -E "^\[info\] (Task|Description)|Note \[CI|success|error" | head
```

Expected: `compiling … Scala sources` for `project/` without errors,
`[info] Task: Unit`, the description, and two `[success]`. (The whole build is
proven by the PR's CI, Task 10: a full native-image build through `/mnt/c` is
too slow to be worth it here.)

- [ ] **Step 6: Commit**

```bash
git add project/MsvcRuntime.scala project/GatherLicenses.scala build.sbt
git commit -m "ciBuildEngineDistribution: CI's engine build, IR cache check, MSVC runtime copy and package checks in sbt"
```

---

### Task 10: `setup-msvc`, the build job without `./run`, and PR 3f

**Files:**

- Create: `.github/actions/setup-msvc/action.yml`
- Modify: `.github/workflows/engine-checks-platform.yml`
  (`build-engine-distribution`; Note [Lint Reads The Distribution's Version])
- Modify: `.github/CLAUDE.md` (Layout `actions/`; one row)

**Interfaces:**

- Consumes: `ciBuildEngineDistribution` (Task 9); `version` (Task 1);
  `setup-build-scripts` (Task 7). 3d must have merged first: if it has not,
  finish Task 9, wait for 3d, then
  `git fetch origin && git merge --no-edit origin/develop` and check
  `test -f .github/actions/setup-build-scripts/action.yml && echo "3d is in"`.
- Produces: the composite action `./.github/actions/setup-msvc` (no inputs; a
  no-op off Windows); the job outputs `ENSO_VERSION`, `ENSO_EDITION`,
  `ENSO_RELEASE_MODE`, unchanged in name, now from `tools/build-scripts`.

- [ ] **Step 1: Write `setup-msvc`**

`.github/actions/setup-msvc/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up MSVC
description: >-
  The MSVC developer environment (`vcvarsall.bat x64`) for the rest of the job, on Windows; a no-op
  elsewhere. Native images on Windows link with MSVC, and the engine package gets the MSVC runtime
  DLLs from `VCToolsRedistDir` (`project/MsvcRuntime.scala`, which also needs `dumpbin`). What
  `./run` applied when `cl` was not on the PATH (`build_tools/ci_utils/src/programs/vs.rs`).
runs:
  using: composite
  steps:
    # `ilammy/msvc-dev-cmd` runs on node20. If GitHub retires node20 before it moves, replace it with
    # a pwsh step: `vswhere -latest -products * -requires
    # Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`, then run
    # `cmd /c "<path>\VC\Auxiliary\Build\vcvarsall.bat x64 && set"` and append every variable that
    # changed to `$env:GITHUB_ENV` (PATH included), as `./run` did.
    - if: runner.os == 'Windows'
      name: Apply the MSVC developer environment
      uses: ilammy/msvc-dev-cmd@v1
      with:
        arch: x64
    - if: runner.os == 'Windows'
      name: Check the MSVC environment
      shell: pwsh
      run: |-
        (Get-Command cl).Source
        (Get-Command dumpbin).Source
        if (-not $env:VCToolsRedistDir) { Write-Error "VCToolsRedistDir is not set."; exit 1 }
        Get-ChildItem "$env:VCToolsRedistDir\x64" -Directory -Filter *.CRT |
          Get-ChildItem -Filter *.dll | Select-Object -ExpandProperty Name
```

- [ ] **Step 2: Move the build job**

In `.github/workflows/engine-checks-platform.yml`, replace the whole
`build-engine-distribution:` job — from `  build-engine-distribution:` up to,
not including, `  # Note [Lint Reads The Distribution's Version]` — with:

<!-- prettier-ignore -->
```yaml
  # Note [Engine Distribution Without ./run]
  # ========================================
  # `./run backend ci-build-engine-distribution` is the sbt task `ciBuildEngineDistribution` (Note
  # [CI Engine Distribution Build] in build.sbt), called as `./run` called sbt: `LC_ALL=C.UTF-8
  # SBT_SERVER_FORCESTART=true sbt -Dbench.compileOnly=false -Dsbt.server.autostart=false "clean;
  # all ciBuildEngineDistribution"` (`all` because a hosted runner has more memory than `./run`'s
  # single-batch threshold). The version comes from `tools/build-scripts` (`version`); its step
  # keeps `id: build`, so the job's outputs are what they were, and it exports the version to the
  # later steps, which is how sbt names the package. `ENSO_LAUNCHER` stays `native,test`, the value
  # `./run` forced. `setup-msvc` replaces `./run`'s MSVC environment on Windows: the native images
  # link with it, and the runtime DLL copy reads `VCToolsRedistDir`. Gone, because only `./run`
  # read them or nothing did: GraalPy, `GRAAL_EDITION`, `GITHUB_TOKEN` and the `GITHUB_ENV` copy
  # of `ENSO_TEST_JUNIT_DIR`.
  build-engine-distribution:
    name: Build Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LAUNCHER: native,test
    # The distribution's version, for the jobs that use it. See Note [Lint Reads The Distribution's
    # Version].
    outputs:
      ENSO_VERSION: ${{ steps.build.outputs.ENSO_VERSION }}
      ENSO_EDITION: ${{ steps.build.outputs.ENSO_EDITION }}
      ENSO_RELEASE_MODE: ${{ steps.build.outputs.ENSO_RELEASE_MODE }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: build-engine-distribution
          flatc: "true"
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - id: build
        name: Compute the version
        run: corepack pnpm --filter build-scripts run version
      - name: Build the engine distribution
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "clean; all ciBuildEngineDistribution"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Archive Engine Distribution
        run: tar -cvf built-distribution.tar built-distribution test
      - name: Upload Engine Distribution
        uses: actions/upload-artifact@v5
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
          path: built-distribution.tar
      - name: Cleanup Archive
        run: rm built-distribution.tar
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

In the Note [Lint Reads The Distribution's Version], replace

<!-- prettier-ignore -->
```yaml
  # the downloaded distribution is not what it lints today. `./run` computed the version
  # (`<next stable>-dev`) and published it as step outputs from the build job, so the lint step
  # takes it from there rather than computing its own (that logic moves out of `./run` in Phase 3),
  # which keeps the path identical to `./run`'s and stays correct once the lint really uses the
  # download. Otherwise the step runs what
```

with

<!-- prettier-ignore -->
```yaml
  # the downloaded distribution is not what it lints today. The build job computed the version
  # (`<next stable>-dev`) and published it as its outputs, so the lint step takes it from there
  # rather than computing its own, which keeps the path identical to the build job's and stays
  # correct once the lint really uses the download. Otherwise the step runs what
```

`build-script` stays, for the jobs still on `./run` (JVM tests, standard-library
tests); 3j removes it.

- [ ] **Step 3: Update `.github/CLAUDE.md`**

In the Layout bullet ``- `actions/` — composite actions:``, after
`` `setup-jvm` (…), `` insert
`` `setup-msvc` (the MSVC developer environment on Windows, for native images and the runtime DLL copy), ``.

In "What still goes through `./run`", the row whose cells are
`` `engine-checks-platform.yml` › Build Engine Distribution `` and
`` `./run backend ci-build-engine-distribution` `` gets the cells
`` `version`, then `sbt "clean; all ciBuildEngineDistribution"` `` and
`` No: `setup-jvm`, `setup-msvc` ``.

- [ ] **Step 4: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3f
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3f && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3f .github/workflows/engine-checks.yml > "$SCRATCH/compare-3f.md"
git add .github
git commit -m "Engine distribution job: version from tools/build-scripts, sbt ciBuildEngineDistribution, setup-msvc"
git push -u origin ci/engine-distribution-sbt
```

Expected: `Workflow policy: OK`, `actionlint-ok`; `compare-3f.md` shows D6 under
both "Build Engine Distribution … (linux, amd64)" and "… (windows, amd64)" and
nothing else.

`$SCRATCH/pr-3f.md`: R6 and R7; must-carry 2, 3 (this part), 4 and 5 (which
variables the job still sets and why); the risks (ilammy on node20; the Windows
sbt launcher now `setup-jvm`'s 1.10.6 rather than the image's 1.12.12); D6;
`compare-3f.md`; a "Verification" section; "Part of #289's Phase 3."; the
attribution lines.

```bash
gh pr create --base develop --head ci/engine-distribution-sbt --label "CI: No changelog needed" \
  --title "Build simplification, PR 3f: the engine distribution build without ./run" \
  --body-file "$SCRATCH/pr-3f.md"
gh workflow run engine-checks.yml --ref ci/engine-distribution-sbt -f clean_build_required=true
```

- [ ] **Step 5: Prove it: the runs, the logs, and the distribution file by
      file**

Run `"$SCRATCH/wait-pr.sh" <N> 360` in the background. When it exits and the
dispatched run has completed:

```bash
pr=$(gh run list --workflow engine-pull-request.yml --branch ci/engine-distribution-sbt -L 1 --json databaseId --jq '.[0].databaseId')
disp=$(gh run list --workflow engine-checks.yml --branch ci/engine-distribution-sbt --event workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
dev=$(gh run list --workflow engine-pull-request.yml --branch develop --event push -L 1 --json databaseId --jq '.[0].databaseId')
for id in $pr $disp $dev; do echo "## run $id"; "$SCRATCH/job-times.sh" "$id"; done | tee "$SCRATCH/pr-3f-times.md"
gh run view "$pr" --log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "ENSO_VERSION=|Libs cache size check successful|is up-to-date|Copied .* next to" | sed 's/^.*\t//' | sort | uniq -c
```

Expected:

- every job green in both runs, including the JVM tests and standard-library
  jobs that still run `./run` and compute the version themselves: they found the
  package, so `version` and `./run` agree;
- each job within about 20% of develop's time; the build jobs should be a little
  faster (one sbt session instead of seven);
- in the log: `ENSO_VERSION=2026.1.1-dev` twice (one per platform, from the
  version step); `Libs cache size check successful` twice; five
  `Package … is up-to-date.` (Linux only: the engine, Base, Table, Image,
  Database); and on Windows seven `Copied … next to …` lines whose targets are
  `bin\msvcp140.dll`, `bin\vcruntime140.dll`, `bin\vcruntime140_1.dll`,
  `component\vcruntime140.dll`, `component\vcruntime140_1.dll`,
  `…\polyglot\lib\amd64\windows\vcruntime140.dll` and
  `python-home\lib-graalpython\vcruntime140.dll`. (A copy may be logged more
  than once when several binaries in one directory import it; the distinct
  targets must be those seven.)

Then compare the distribution artifacts with develop's, on the Linux filesystem
in WSL (Phase 2's method):

```bash
for os in linux windows; do
  name="Engine Distribution (GraalVM CE) (native,test) ($os, amd64)"
  gh run download "$pr" -n "$name" -D "$SCRATCH/dist-pr-$os"
  gh run download "$dev" -n "$name" -D "$SCRATCH/dist-dev-$os"
done
wsl -e bash -lc '
  set -e; S=$(wslpath "'"$SCRATCH"'"); rm -rf ~/p3cmp; mkdir -p ~/p3cmp
  for os in linux windows; do for side in pr dev; do
    mkdir -p ~/p3cmp/$side-$os && tar -xf "$S/dist-$side-$os/built-distribution.tar" -C ~/p3cmp/$side-$os
    (cd ~/p3cmp/$side-$os && find . -type f -printf "%s %P\n" | sort -k2) > ~/p3cmp/$side-$os.txt
  done
  echo "== $os: names"; diff <(cut -d" " -f2- ~/p3cmp/pr-$os.txt) <(cut -d" " -f2- ~/p3cmp/dev-$os.txt) && echo same-files
  echo "== $os: sizes that differ"; join -1 2 -2 2 <(sort -k2 ~/p3cmp/pr-$os.txt) <(sort -k2 ~/p3cmp/dev-$os.txt) | awk "\$2 != \$3" | head -20
  done
  find ~/p3cmp/pr-windows -iname "vcruntime140*.dll" -o -iname "msvcp140.dll" | grep -v "/runtime/" | sed "s|.*/built-distribution/[^/]*/[^/]*/||" | sort'
```

Expected, for each platform: `same-files`; sizes differ only for files the build
does not reproduce (native images `bin/enso[.exe]`, `*.so`, `*.dll` built by
native-image, `*.exe`, IR caches under `.enso/`, `*.jar` timestamps, indexes),
each by under 1%. The `find` lists the seven DLL paths above. A missing or extra
file, a source or `.enso` file that differs, or a different DLL set is a
regression: investigate before merging. Delete `~/p3cmp` and `$SCRATCH/dist-*`
afterwards. Put the times, the log lines and the comparison in the PR body.

- [ ] **Step 6: Merge**

If another engine PR merged meanwhile, bring the branch up to date
(`git fetch origin && git merge --no-edit origin/develop`), push and wait again.
When every check is green: `gh pr merge <N> --squash`.

---

### Task 11: `buildEngineBundle` in sbt, and the IDE's backend job (PR 3g)

**Files:**

- Create: `project/EngineBundle.scala`
- Modify: `project/DistributionPackage.scala` (`Builder.localPlatform`)
- Modify: `build.sbt` (after `ciBuildEngineDistribution`)
- Modify: `.github/workflows/ide-packaging.yml` (`build-backend`)

- Modify: `.github/CLAUDE.md` (one row)

**Interfaces:**

- Consumes: `MsvcRuntime.copyCrtDlls` (Task 9), `setup-msvc` (Task 10),
  `setup-build-scripts` (Task 7), `version` (Task 1).
- Produces: the sbt task `buildEngineBundle: File` (the bundle root
  `built-distribution/engine-bundle-<version>-<os>-<arch>/enso`);
  `EngineBundle.root`, `EngineBundle.runtimeDirName`, `EngineBundle.create`;
  `DistributionPackage.Builder.localPlatform: (OS, Architecture)`. The artifact
  `backend-<os>` keeps its name and its layout (`.enso.bundle`,
  `dist/<version>/`,
  `runtime/graalvm-ce-java<graalVersion>-<graalMavenPackagesVersion>/`).

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3g -b ci/engine-bundle-sbt origin/develop
cd /c/Repos/Enso/ide-bs-3g && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f project/MsvcRuntime.scala && test -f .github/actions/setup-msvc/action.yml && echo "3f is in"
```

Expected: `3f is in`.

- [ ] **Step 2: Write the bundle and the task**

`project/EngineBundle.scala`:

<!-- prettier-ignore -->
```scala
import sbt._
import sbt.internal.util.ManagedLogger

/** The engine bundle that the IDE ships: the engine package, a small JDK to run it with, and an
  * empty `.enso.bundle` marker, laid out as `./run backend get` laid it out
  * (`build_tools/build/src/engine/bundle.rs`, `paths.yaml`):
  *
  * {{{
  * built-distribution/engine-bundle-<version>-<os>-<arch>/enso/
  *   .enso.bundle
  *   dist/<version>/                                     the engine package
  *   runtime/graalvm-ce-java<graalVersion>-<graalMavenPackagesVersion>/   the small JDK
  * }}}
  */
object EngineBundle {

  /** The bundle's root directory for this platform. */
  def root(
    artifactRoot: File,
    ensoVersion: String,
    os: DistributionPackage.OS,
    arch: DistributionPackage.Architecture
  ): File =
    artifactRoot / s"engine-bundle-$ensoVersion-${os.name}-${arch.name}" / "enso"

  /** The runtime directory's name, as `./run` named it. */
  def runtimeDirName(
    graalVersion: String,
    graalMavenPackagesVersion: String
  ): String =
    s"graalvm-ce-java$graalVersion-$graalMavenPackagesVersion"

  /** Recreates the bundle at `bundleRoot` from `enginePackage` and `smallJdk`; returns its root. */
  def create(
    bundleRoot: File,
    enginePackage: File,
    smallJdk: File,
    ensoVersion: String,
    runtimeDir: String,
    log: ManagedLogger
  ): File = {
    IO.delete(bundleRoot)
    IO.createDirectory(bundleRoot)
    IO.copyDirectory(
      enginePackage,
      bundleRoot / "dist" / ensoVersion,
      overwrite            = true,
      preserveLastModified = true,
      preserveExecutable   = true
    )
    IO.copyDirectory(
      smallJdk,
      bundleRoot / "runtime" / runtimeDir,
      overwrite            = true,
      preserveLastModified = true,
      preserveExecutable   = true
    )
    IO.touch(bundleRoot / ".enso.bundle")
    log.info(s"Engine bundle created at $bundleRoot.")
    bundleRoot
  }
}
```

In `project/DistributionPackage.scala`, class `Builder`, replace

<!-- prettier-ignore -->
```scala
    /** Path to the artifact that is built on this local machine. */
    def localArtifact(component: String): File = {
      val os =
```

with

<!-- prettier-ignore -->
```scala
    /** The OS and architecture of this machine, as the artifact names spell them. */
    def localPlatform: (OS, Architecture) = {
      val os =
```

and, at the end of that method, replace

<!-- prettier-ignore -->
```scala
          throw new IllegalStateException("Unknown OS: " + sys.props("os.name"))
      artifactRoot / artifactName(component, os, os.archs.head)
    }
```

with

<!-- prettier-ignore -->
```scala
          throw new IllegalStateException("Unknown OS: " + sys.props("os.name"))
      (os, os.archs.head)
    }

    /** Path to the artifact that is built on this local machine. */
    def localArtifact(component: String): File = {
      val (os, architecture) = localPlatform
      artifactRoot / artifactName(component, os, architecture)
    }
```

In `build.sbt`, after the `ciBuildEngineDistribution := Def … .value` block,
add:

<!-- prettier-ignore -->
```scala
lazy val buildEngineBundle = taskKey[File](
  "Builds the engine bundle the IDE ships (the engine package, a small JDK and `.enso.bundle`) " +
  "in built-distribution/engine-bundle-<version>-<os>-<arch>/enso, as `./run backend get` did. " +
  "ENSO_LAUNCHER is the caller's: the IDE's CI passes `native`. See project/EngineBundle.scala."
)
buildEngineBundle := Def
  .sequential(
    buildEngineDistribution,
    Def.task {
      val log  = streams.value.log
      val root = engineDistributionRoot.value
      IRCaches.checkCacheSizes(
        stdLibRoot  = root / "lib" / "Standard",
        ensoVersion = ensoVersion,
        log         = log
      )
      if (Platform.isWindows) MsvcRuntime.copyCrtDlls(root, log)
      val smallJdk = baseDirectory.value / "target" / "small-jdk"
      SmallJDK.buildSmallJDKForRelease(smallJdk)
      val (os, arch) = packageBuilder.value.localPlatform
      EngineBundle.create(
        bundleRoot = EngineBundle
          .root(distributionArtifactRoot.value, ensoVersion, os, arch),
        enginePackage = root,
        smallJdk      = smallJdk,
        ensoVersion   = ensoVersion,
        runtimeDir =
          EngineBundle.runtimeDirName(graalVersion, graalMavenPackagesVersion),
        log = log
      )
    }
  )
  .value
```

Load the build and check the formatting in WSL:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-3g && LC_ALL=C.UTF-8 sbt -Dsbt.server.autostart=false "inspect buildEngineBundle" "show engineDistributionRoot" scalafmtSbtCheck' 2>&1 < /dev/null | grep -E "^\[info\] (Task|Description)|built-distribution|success|error" | head
```

Expected: `[info] Task: java.io.File`, the description, an
`engineDistributionRoot` ending
`enso-engine-0.0.0-dev-linux-amd64/enso-0.0.0-dev` (unchanged: `localArtifact`
still names it), and three `[success]`.

- [ ] **Step 3: Move the backend job**

In `.github/workflows/ide-packaging.yml`, replace the whole `build-backend:` job
— from `  build-backend:` up to, not including, `  gui-build:` — with:

<!-- prettier-ignore -->
```yaml
  # Note [Engine Bundle Without ./run]
  # ==================================
  # `./run backend get` is the sbt task `buildEngineBundle` (project/EngineBundle.scala): the engine
  # distribution, the IR cache check, the MSVC runtime DLLs on Windows (`setup-msvc` provides the
  # environment), the small JDK, and the bundle in
  # `built-distribution/engine-bundle-<version>-<os>-amd64/enso`, which is archived as it is
  # (`./run` mirrored it to `dist/backend` first). sbt is called as `./run` called it; the version
  # comes from `tools/build-scripts` (`version`), and `ENSO_LAUNCHER` stays `native`.
  build-backend:
    name: Build Backend (${{ matrix.os }}, amd64)
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
          - os: windows
            runner: windows-latest
    env:
      ENSO_LAUNCHER: native
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: build-backend
          flatc: "true"
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - id: version
        name: Compute the version
        run: corepack pnpm --filter build-scripts run version
      - name: Build the engine bundle
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "clean; all buildEngineBundle"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - if: matrix.os == 'linux'
        name: Upload Edition File
        uses: actions/upload-artifact@v5
        with:
          name: Edition File
          path: distribution/editions/*.yaml
      - if: matrix.os == 'linux'
        name: Upload fbs-schema
        uses: actions/upload-artifact@v5
        with:
          name: fbs-schema
          path: engine/language-server/src/main/schema/
      - name: Archive backend
        run: tar -cvf backend.tar -C built-distribution/engine-bundle-${{ steps.version.outputs.ENSO_VERSION }}-${{ matrix.os }}-amd64/enso .
      - name: Upload backend
        uses: actions/upload-artifact@v5
        with:
          name: backend-${{ matrix.os }}
          path: backend.tar
      - name: Cleanup
        run: rm backend.tar
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

The `build-script` job, the workflow `env` and `package-ide` stay as they are
until 3i: `package-ide` still runs `./run ide build`.

`ide-changed-files.yml` needs nothing: `ide-pull-request.yml` packages whenever
`engine-changed-files` fires, and that list covers `project/**` and (since 3d)
`tools/build-scripts/**`.

In `.github/CLAUDE.md`, the row whose cells are
`` `ide-packaging.yml` › Build Backend `` and `` `./run backend get` `` gets the
cells `` `version`, then `sbt "clean; all buildEngineBundle"` `` and
`` No: `setup-jvm`, `setup-msvc` ``.

- [ ] **Step 4: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3g
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3g && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3g .github/workflows/ide-packaging.yml > "$SCRATCH/compare-3g.md"
git add project/EngineBundle.scala project/DistributionPackage.scala build.sbt .github
git commit -m "buildEngineBundle: the IDE's engine bundle in sbt; Build Backend without ./run"
git push -u origin ci/engine-bundle-sbt
```

Expected: `Workflow policy: OK`, `actionlint-ok`; `compare-3g.md` shows D7 under
"Build Backend (linux, amd64)" and "(windows, amd64)", nothing else.

`$SCRATCH/pr-3g.md`: the move; the layout (`EngineBundle.scala`'s comment); that
CI archives the bundle directly instead of `./run`'s `dist/backend` mirror; D7;
`compare-3g.md`; a "Verification" section; "Part of #289's Phase 3."; the
attribution lines.

```bash
gh pr create --base develop --head ci/engine-bundle-sbt --label "CI: No changelog needed" \
  --title "Build simplification, PR 3g: buildEngineBundle replaces ./run backend get" \
  --body-file "$SCRATCH/pr-3g.md"
```

- [ ] **Step 5: Prove the bundle byte by byte against `./run`'s (spec
      verification)**

Run `"$SCRATCH/wait-pr.sh" <N> 300` in the background. When it exits:

```bash
pr=$(gh run list --workflow ide-pull-request.yml --branch ci/engine-bundle-sbt -L 1 --json databaseId --jq '.[0].databaseId')
dev=$(gh run list --workflow ide-pull-request.yml --branch develop --event push -L 1 --json databaseId --jq '.[0].databaseId')
dev2=$(gh run list --workflow ide-pull-request.yml --branch develop --event push -L 2 --json databaseId --jq '.[1].databaseId')
for id in $pr $dev; do echo "## run $id"; "$SCRATCH/job-times.sh" "$id"; done | tee "$SCRATCH/pr-3g-times.md"
for os in linux windows; do
  for side in pr dev dev2; do
    run=$pr; [ "$side" = dev ] && run=$dev; [ "$side" = dev2 ] && run=$dev2
    gh run download "$run" -n "backend-$os" -D "$SCRATCH/bundle-$side-$os"
  done
done
```

Linux, in WSL on the Linux filesystem (executable bits are real there):

```bash
wsl -e bash -lc '
  set -e; S=$(wslpath "'"$SCRATCH"'"); rm -rf ~/p3b; mkdir -p ~/p3b
  for side in pr dev dev2; do mkdir -p ~/p3b/$side && tar -xf "$S/bundle-$side-linux/backend.tar" -C ~/p3b/$side; bash "$S/list-tree.sh" ~/p3b/$side > ~/p3b/$side.tsv; done
  wc -l ~/p3b/*.tsv
  echo "### develop against develop"; bash "$S/compare-trees.sh" ~/p3b/dev2.tsv ~/p3b/dev.tsv || true
  echo "### develop against the PR"; bash "$S/compare-trees.sh" ~/p3b/dev.tsv ~/p3b/pr.tsv'
```

Windows, in Git Bash (`tar` there must read a POSIX path):

```bash
for side in pr dev dev2; do
  d=$(cygpath -u "$SCRATCH")/bundle-$side-windows
  mkdir -p "$d/x" && tar -xf "$d/backend.tar" -C "$d/x"
  "$SCRATCH/list-tree.sh" "$d/x" > "$SCRATCH/win-$side.tsv"
done
wc -l "$SCRATCH"/win-*.tsv
"$SCRATCH/compare-trees.sh" "$SCRATCH/win-dev2.tsv" "$SCRATCH/win-dev.tsv" || true
"$SCRATCH/compare-trees.sh" "$SCRATCH/win-dev.tsv" "$SCRATCH/win-pr.tsv"
```

Expected, on each platform:

- the same number of entries on all three sides (about 5,060 paths on Linux and
  5,070 on Windows, as `./run`'s `backend.tar` held);
- "develop against the PR": no "entries, types or executable bits differ"
  section; under "files that should be identical but differ", only files that
  also appear in "develop against develop" (the build's own nondeterminism, for
  example a jlink `release` file or a timestamped index). Any other file is a
  real difference: investigate before merging. A path or executable-bit
  difference is always a regression.
- the runtime directory is `runtime/graalvm-ce-java25.0.1-25.0.1` on all sides,
  and `.enso.bundle` is empty.

Also check the IDE: Package New IDE (both), the package tests and the Windows
installer smoke test are green, since they install and start this bundle. Delete
`~/p3b` and `$SCRATCH/bundle-*`, `$SCRATCH/win-*.tsv` afterwards. Put the counts
and both comparisons (as `<details>`) in the PR body.

- [ ] **Step 6: Merge**

Bring the branch up to date if needed, wait for green, and
`gh pr merge <N> --squash`.

---

### Task 12: The JVM tests as workflow steps (PR 3h)

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml` (`jvm-tests`)
- Modify: `.github/CLAUDE.md` (one row)

**Interfaces:**

- Consumes: `setup-jvm` (`jvm-tests`, flatc), `setup-msvc` (Task 10), the build
  job's outputs.
- Keeps: the job name, `permissions: checks: write`, the artifact
  `Heap dumps (JVM Tests, <os>, amd64)`, the reporter name
  `Engine Tests Report (GraalVM CE, <os>, amd64)`.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3h -b ci/jvm-tests-direct origin/develop
cd /c/Repos/Enso/ide-bs-3h && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f .github/actions/setup-msvc/action.yml && echo "3f is in"
```

Expected: `3f is in`.

- [ ] **Step 2: Replace the job**

In `.github/workflows/engine-checks-platform.yml`, replace the whole
`jvm-tests:` job — from `  jvm-tests:` up to, not including,
`  standard-library-api-check:` (or the comment line above it, if 3d has merged)
— with the Note and job below. Every value in it comes from develop's logs of
run 39666057183 (the `./run` command lines) and the research notes:

<!-- prettier-ignore -->
```yaml
  # Note [JVM Tests Without ./run]
  # ==============================
  # The steps are what `./run backend test jvm` ran (`build_tools/build/src/engine/context.rs`), in
  # its order, each sbt call as `./run` made it (`LC_ALL=C.UTF-8 SBT_SERVER_FORCESTART=true sbt
  # -Dbench.compileOnly=<…> -Dsbt.server.autostart=false "<tasks>"`), at the build job's version,
  # from which sbt names the downloaded distribution. Its traps, kept on purpose:
  # - `ENSO_TEST_JUNIT_DIR` is set on the `sbt test` step only. `./run` removed it for the
  #   benchmark step, and an empty value is not "unset": ScalaTest would get `-u ""`.
  # - `CI_TEST_TIMEFACTOR=2` and `CI_TEST_FLAKY_ENABLE=true` are written to `GITHUB_ENV` on Windows
  #   only, so that on Linux they are absent rather than empty: an empty time factor breaks the
  #   language server's test configuration, and `FlakySpec` only asks whether the variable exists.
  # - A failing `sbt test` does not stop the parser self-tests or the benchmark step: `./run`
  #   deferred that failure. A failure of any other step stops the job, as it stopped `./run`.
  # - Two things `./run` appeared to do never took effect, and are not added: the Enso benchmark
  #   dry run (it only runs with Enso benchmarks; `test jvm` asked for the runtime ones) and the
  #   heap-dump `JAVA_TOOL_OPTIONS` (`./run` passed them to the standard-library tests only).
  jvm-tests:
    name: JVM Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: jvm-tests
          flatc: "true"
      # `sbt test` builds native images on Windows too (the launcher's and os-environment's tests).
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - if: runner.os == 'Windows'
        name: Windows test settings
        shell: pwsh
        run: |-
          "CI_TEST_TIMEFACTOR=2" >> $env:GITHUB_ENV
          "CI_TEST_FLAKY_ENABLE=true" >> $env:GITHUB_ENV
      - name: Install the library server's dependencies
        working-directory: tools/simple-library-server
        run: corepack pnpm install
      - name: Resolve the parser's Java class path
        run: sbt "-Dsbt.server.autostart=false" "syntax-rust-definition/Runtime/managedClasspath"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Generate the parser's Java sources
        shell: bash
        run: |-
          # `./run` reset the JUnit directory before the tests; stale reports would be published.
          rm -rf target/test-results
          rm -rf target/generated-java/org/enso/syntax2
          mkdir -p target/generated-java/org/enso/syntax2
          cargo run --package enso-parser-generate-java --bin enso-parser-generate-java -- target/generated-java/org/enso/syntax2
      - if: runner.os == 'Linux'
        name: Build the ydoc native image
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "all ydoc-server/buildNativeImage"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - id: tests
        name: JVM tests
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "set Global / parallelExecution := false; test"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          ENSO_TEST_JUNIT_DIR: ${{ github.workspace }}/target/test-results
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - id: parser-self-tests
        if: ${{ !cancelled() && steps.tests.outcome != 'skipped' }}
        name: Parser self-tests
        shell: bash
        env:
          # Git Bash would otherwise rewrite the `;`-separated class path on Windows.
          MSYS_NO_PATHCONV: "1"
        run: |-
          gen=target/generated-java
          pkg=$gen/org/enso/syntax2
          cargo run --package enso-parser-generate-java --bin java-tests > "$pkg/GeneratedFormatTests.java"
          sep=:
          if [ "$RUNNER_OS" = "Windows" ]; then sep=';'; fi
          deps=$(tr -d '\r\n' < lib/rust/parser/target/streams/runtime/managedClasspath/_global/streams/export)
          javac --class-path "lib/rust/parser/generate-java/java$sep$gen$sep$deps" -d "$gen" "$pkg/GeneratedFormatTests.java"
          java --class-path "$gen" org.enso.syntax2.GeneratedFormatTests
      - if: ${{ runner.os == 'Linux' && !cancelled() && steps.parser-self-tests.outcome == 'success' }}
        name: Compile the benchmarks, and run the runtime ones once
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "all runtime-benchmarks/compile language-server/Benchmark/compile searcher/Benchmark/compile std-benchmarks/compile; runtime-benchmarks/bench"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Upload Heap Dumps
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: Heap dumps (JVM Tests, ${{ inputs.os }}, amd64)
          path: |-
            test/**/*.hprof
            engine/**/*.hprof
          retention-days: 3
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Engine Test Reporter
        uses: dorny/test-reporter@v1
        with:
          max-annotations: 50
          name: Engine Tests Report (GraalVM CE, ${{ inputs.os }}, amd64)
          path: target/test-results/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

The steps keep `./run`'s order: library-server install and class-path
resolution, the JUnit directory reset and the Java sources generated, the ydoc
native image (Linux), `sbt test`, the parser self-tests, then the benchmarks
(Linux). The `if:` conditions keep its failure semantics: a failed `sbt test`
lets the self-tests and benchmarks run (deferred, as `./run` deferred it), and
the job still fails; a failure of any other step skips the rest. The benchmarks
run only after the self-tests succeeded, since `./run` stopped at their failure.

In `.github/CLAUDE.md`, the row whose cells are
`` `engine-checks-platform.yml` › JVM Tests `` and
`` `./run backend test jvm` `` gets the cells
`` `sbt …` steps (Note [JVM Tests Without ./run]) `` and
`` No: `setup-jvm`, `setup-msvc` ``.

- [ ] **Step 3: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3h
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3h && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3h .github/workflows/engine-checks.yml > "$SCRATCH/compare-3h.md"
git add .github
git commit -m "JVM tests: the steps ./run backend test jvm ran, as workflow steps"
git push -u origin ci/jvm-tests-direct
```

Expected: `Workflow policy: OK` (every sbt step follows `setup-jvm`),
`actionlint-ok` (shellcheck clean on the two bash steps); `compare-3h.md` shows
D8 under both "JVM Tests …" jobs.

`$SCRATCH/pr-3h.md`: R8, with the traps (the JUnit variable, the Windows
factors, the deferred failure); the two things not carried over because they
never took effect, with the tickets to raise; D8; `compare-3h.md`; a
"Verification" section; "Part of #289's Phase 3."; the attribution lines.

```bash
gh pr create --base develop --head ci/jvm-tests-direct --label "CI: No changelog needed" \
  --title "Build simplification, PR 3h: the JVM tests without ./run" --body-file "$SCRATCH/pr-3h.md"
```

- [ ] **Step 4: Prove it: the report counts and the steps**

Run `"$SCRATCH/wait-pr.sh" <N> 360` in the background. When it exits:

```bash
pr=$(gh run list --workflow engine-pull-request.yml --branch ci/jvm-tests-direct -L 1 --json databaseId,headSha --jq '.[0] | "\(.databaseId) \(.headSha)"')
"$SCRATCH/job-times.sh" "${pr% *}" | grep -E "JVM Tests"
"$SCRATCH/report-titles.sh" "${pr#* }" | grep "Engine Tests Report"
grep "Engine Tests Report" "$SCRATCH/baseline.md"
gh run view "${pr% *}" --log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "GeneratedFormatTests|runtime-benchmarks/bench|test-results" | sed 's/^.*\t//' | head -8
```

Expected:

- both JVM Tests jobs green, within about 20% of develop's time;
- each "Engine Tests Report" title shows the same passed and failed counts as
  develop's (skipped may differ by a flaky test or two; a difference of more
  than five in any count, or any new failure, is this PR's: compare the reports'
  test lists);
- the log shows the parser self-tests compiling and running
  `GeneratedFormatTests` on both platforms, and `runtime-benchmarks/bench` on
  Linux only.

When every check is green: `gh pr merge <N> --squash`.

---

### Task 13: `ide-build`, and IDE packaging without `./run` (PR 3i)

**Files:**

- Create: `tools/build-scripts/src/ide-build/ideBuild.ts`, `ideBuild.test.ts`,
  `src/commands/ide-build.ts`
- Modify: `tools/build-scripts/package.json` (script), `CLAUDE.md`
- Modify: `.github/workflows/ide-packaging.yml` (whole file)
- Modify: `.github/CLAUDE.md` (one row)

**Interfaces:**

- Consumes: `repositoryVersions` (Task 1), `capture`, `runInherited`,
  `commandArguments`, `REPO_ROOT`; `maxVersion`, `parseVersion` (Task 1).
- Produces: the script `ide-build` (`--sign` for Phase 4); `updateMode`,
  `CSC_VARIABLES`, `withoutEmptyCscVariables`, `latestBundledEngine`,
  `ideBuildVariables`, `packagingSteps`, `retryDelays`, `targetOs`.
- What it replicates of `./run ide build` (R11), and what it drops:

  | `./run ide build` did                                                                   | `ide-build`                                                                               |
  | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
  | the version (`ENSO_IDE_VERSION`), `GITHUB_SHA` or `HEAD` (`ENSO_IDE_COMMIT_HASH`)       | the same                                                                                  |
  | `ENSO_IDE_UPDATES` = `update_mode` (`manual` for dev, unsigned macOS)                   | the same, with `web.rs`'s tests                                                           |
  | `corepack pnpm i`, 1 try + 5 retries (0.5 s × 1.5, at most 10 s)                        | the same                                                                                  |
  | the only backend check: a version-named directory under `dist/backend/dist`             | the same, same message                                                                    |
  | `build:ide` with `ENSO_IDE_*`, `ENSO_BUILD_GUI/IDE/BACKEND/SIGN` (absolute paths)       | the same                                                                                  |
  | `dist:ide` with the same, minus the seven empty signing variables                       | the same (YAML cannot unset a variable, so this needs the script)                         |
  | `ENSO_BUILD_IDE_BUNDLED_ENGINE_VERSION` on `build:ide`                                  | **dropped**: nothing in `app/` reads it (only the `watch:*` scripts set it)               |
  | `-- --linux` / `--win` after `dist:ide`                                                 | **dropped**: not a declared option; electron-builder always builds for the host           |
  | mirroring `dist/gui` and `dist/backend` onto themselves                                 | **dropped**: same path, a no-op                                                           |
  | the GitHub client from `GITHUB_TOKEN`; deleting `enso/` and `ci-build/`; the tool check | **dropped**: unused for local sources; directories that never exist; skipped in CI anyway |
  | Rust's `store_sha256_checksum`                                                          | **dropped**: dead code; electron-builder's `computeHashes` hook writes the `.sha256`      |
  | macOS: install GraalVM before a signed build                                            | **dropped**: no macOS leg in `ide-packaging.yml`; Phase 4 (release)                       |

- [ ] **Step 1: Create the worktree, and write the failing test**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3i -b ci/ide-build origin/develop
cd /c/Repos/Enso/ide-bs-3i && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f project/EngineBundle.scala && echo "3g is in"
```

Expected: `3g is in`.

`tools/build-scripts/src/ide-build/ideBuild.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The IDE packaging step's inputs: update mode, signing variables, backend check. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { version } from '../version/version.ts'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
  updateMode,
  withoutEmptyCscVariables,
} from './ideBuild.ts'

describe('updateMode (web.rs tests)', () => {
  test('a stable or rc version updates automatically, a dev version does not', () => {
    expect(updateMode(version('2026.2.0'), 'windows', false)).toBe('auto')
    expect(updateMode(version('2026.2.0-rc.1'), 'linux', false)).toBe('auto')
    expect(updateMode(version('2026.10.18-dev'), 'windows', false)).toBe('manual')
  })
  test('macOS updates automatically only when signed', () => {
    expect(updateMode(version('2026.2.0'), 'macos', false)).toBe('manual')
    expect(updateMode(version('2026.2.0'), 'macos', true)).toBe('auto')
  })
})

test('empty signing variables are removed, set ones kept, others untouched', () => {
  const env = { WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: 'x', APPLEID: '', PATH: '/bin', OTHER: '' }
  expect(withoutEmptyCscVariables(env)).toEqual({
    WIN_CSC_KEY_PASSWORD: 'x',
    PATH: '/bin',
    OTHER: '',
  })
})

describe('latestBundledEngine', () => {
  const backend = (names: string[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'backend-'))
    mkdirSync(path.join(dir, 'dist'))
    for (const name of names) mkdirSync(path.join(dir, 'dist', name))
    writeFileSync(path.join(dir, '.enso.bundle'), '')
    return dir
  }
  test('the greatest version-named directory', () => {
    expect(latestBundledEngine(backend(['2026.1.1-dev', '2025.3.4', 'notes']))).toBe('2026.1.1-dev')
  })
  test('none is an error', () => {
    const dir = backend(['notes'])
    expect(() => latestBundledEngine(dir)).toThrow(
      `Backend at ${dir} does not contain any Enso Engine packages.`,
    )
  })
})

test("the children's variables, as ./run set them for a PR build", () => {
  const variables = ideBuildVariables(
    {
      version: version('2026.1.1-dev'),
      commitHash: 'abc',
      os: targetOs('linux'),
      sign: false,
      guiDir: '/r/dist/gui',
      ideDir: '/r/dist/ide',
      backendDir: '/r/dist/backend',
    },
    {},
  )
  expect(variables).toEqual({
    ENSO_IDE_VERSION: '2026.1.1-dev',
    ENSO_IDE_COMMIT_HASH: 'abc',
    ENSO_IDE_UPDATES: 'manual',
    ENSO_BUILD_GUI: '/r/dist/gui',
    ENSO_BUILD_IDE: '/r/dist/ide',
    ENSO_BUILD_BACKEND: '/r/dist/backend',
    ENSO_BUILD_SIGN: 'false',
  })
})

test('build:ide keeps empty signing variables, dist:ide drops them', () => {
  const [build, dist] = packagingSteps(
    { ENSO_BUILD_SIGN: 'false' },
    { WIN_CSC_LINK: '', PATH: 'p' },
  )
  expect(build).toEqual({
    args: ['run', 'build:ide'],
    env: { WIN_CSC_LINK: '', PATH: 'p', ENSO_BUILD_SIGN: 'false' },
  })
  expect(dist).toEqual({ args: ['run', 'dist:ide'], env: { PATH: 'p', ENSO_BUILD_SIGN: 'false' } })
})

test('install retries back off from half a second to at most ten', () => {
  expect(retryDelays(5)).toEqual([500, 750, 1125, 1687.5, 2531.25])
  expect(retryDelays(12).at(-1)).toBe(10_000)
})
```

Run:
`cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | grep -E "FAIL|Tests "`

Expected: FAIL: `Failed to resolve import "./ideBuild.ts"`.

- [ ] **Step 2: Write the implementation**

`tools/build-scripts/src/ide-build/ideBuild.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `ide-build`: what `./run ide build --backend-source local --gui-source local` did in CI
 * (`build_tools/build/src/ide/web.rs` `IdeDesktop::dist`), minus what nothing used. With the GUI in
 * `dist/gui` and the engine bundle in `dist/backend`, it installs the workspace, then runs
 * `build:ide` and `dist:ide` with the variables electron-builder reads, and leaves the installer
 * (and its `.sha256`, which electron-builder's `computeHashes` hook writes) in `dist/ide`.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { maxVersion, parseVersion, type Version } from '../version/version.ts'

/** The installer's platform. */
export type TargetOs = 'linux' | 'windows' | 'macos'

/** The installer's platform for a Node platform. */
export function targetOs(platform: NodeJS.Platform): TargetOs {
  if (platform === 'linux') return 'linux'
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  throw new Error(`The IDE is not packaged for ${platform}.`)
}

/**
 * `ENSO_IDE_UPDATES` (`web.rs` `update_mode`): `manual` for a dev version (its prerelease contains
 * `dev`) and for an unsigned macOS build, `auto` otherwise.
 */
export function updateMode(version: Version, os: TargetOs, macSigned: boolean): 'auto' | 'manual' {
  return version.pre.includes('dev') || (os === 'macos' && !macSigned) ? 'manual' : 'auto'
}

/**
 * The code-signing variables electron-builder reads. An empty one (a fork, or a missing secret)
 * would make it try to sign with nothing, so `dist:ide` runs without those that are empty
 * (`RemoveEmptyCscEnvVars`).
 */
export const CSC_VARIABLES = [
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLEID',
  'APPLEIDPASS',
  'APPLETEAMID',
] as const

/** `env` without the code-signing variables that are set to the empty string. */
export function withoutEmptyCscVariables(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env }
  for (const name of CSC_VARIABLES) {
    if (result[name] === '') delete result[name]
  }
  return result
}

/**
 * The newest engine in a backend bundle: the greatest version-named directory under
 * `<backend>/dist`. A bundle without one is an error, the only check `./run` made of it.
 */
export function latestBundledEngine(backendDir: string): string {
  const distDir = path.join(backendDir, 'dist')
  const versions: Version[] = []
  if (existsSync(distDir)) {
    for (const name of readdirSync(distDir)) {
      const parsed = parseVersion(name)
      if (parsed != null && statSync(path.join(distDir, name)).isDirectory()) versions.push(parsed)
    }
  }
  const latest = maxVersion(versions)
  if (latest == null) {
    throw new Error(`Backend at ${backendDir} does not contain any Enso Engine packages.`)
  }
  return latest.text
}

/** What the two pnpm children are given. */
export interface IdeBuildInputs {
  readonly version: Version
  readonly commitHash: string
  readonly os: TargetOs
  readonly sign: boolean
  readonly guiDir: string
  readonly ideDir: string
  readonly backendDir: string
}

/**
 * The variables `build:ide` and `dist:ide` get on top of the inherited environment. `ENSO_BUILD_SIGN`
 * is always set: electron-builder's configuration defaults it to `true`.
 */
export function ideBuildVariables(
  inputs: IdeBuildInputs,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const macSigned = inputs.sign && (env.CSC_LINK ?? '') !== ''
  return {
    ENSO_IDE_VERSION: inputs.version.text,
    ENSO_IDE_COMMIT_HASH: inputs.commitHash,
    ENSO_IDE_UPDATES: updateMode(inputs.version, inputs.os, macSigned),
    ENSO_BUILD_GUI: inputs.guiDir,
    ENSO_BUILD_IDE: inputs.ideDir,
    ENSO_BUILD_BACKEND: inputs.backendDir,
    ENSO_BUILD_SIGN: String(inputs.sign),
  }
}

/** One `corepack pnpm …` call of the build. */
export interface PnpmStep {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/** The two packaging calls, in order: `build:ide`, then `dist:ide` without empty signing variables. */
export function packagingSteps(
  variables: Record<string, string>,
  env: NodeJS.ProcessEnv,
): PnpmStep[] {
  const childEnv = { ...env, ...variables }
  return [
    { args: ['run', 'build:ide'], env: childEnv },
    { args: ['run', 'dist:ide'], env: withoutEmptyCscVariables(childEnv) },
  ]
}

/** The delays before each retry of `pnpm install`: 0.5 s, growing by half, at most 10 s (`ide_ci::io::retry`). */
export function retryDelays(retries: number): number[] {
  return Array.from({ length: retries }, (_, attempt) => Math.min(500 * 1.5 ** attempt, 10_000))
}
```

`tools/build-scripts/src/commands/ide-build.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `ide-build`: packages the IDE from `dist/gui` and `dist/backend` into `dist/ide`, as
 * `./run ide build --backend-source local --gui-source local` did. The version is the `version`
 * command's (so `ENSO_VERSION` overrides it). Pass `--sign` to sign (release only).
 *
 *     corepack pnpm --filter build-scripts run ide-build
 */
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
} from '../ide-build/ideBuild.ts'
import { capture, commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { repositoryVersions } from '../version/repository.ts'

/** Blocks for `ms` milliseconds. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** `corepack pnpm install`, retried five times, as `./run` retried it. */
function installWorkspace(): void {
  const delays = retryDelays(5)
  for (let attempt = 0; ; attempt++) {
    const status = runInherited('corepack', ['pnpm', 'install'])
    if (status === 0) return
    const delay = delays[attempt]
    if (delay == null) throw new Error(`\`corepack pnpm install\` failed (exit ${status}).`)
    console.log(`\`corepack pnpm install\` failed (exit ${status}); retrying in ${delay} ms.`)
    sleep(delay)
  }
}

/** `GITHUB_SHA` in CI, else `HEAD`. */
function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA ?? ''
  if (fromCi !== '') return fromCi
  const head = capture('git', ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) throw new Error(`\`git rev-parse --verify HEAD\` failed: ${head.stderr}`)
  return head.stdout.trim()
}

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { sign: { type: 'boolean', default: false } },
  })
  const { version } = repositoryVersions()
  const dist = (name: string) => path.join(REPO_ROOT, 'dist', name)
  const backendDir = dist('backend')
  console.log(`Packaging IDE ${version.text} with engine ${latestBundledEngine(backendDir)}.`)
  installWorkspace()
  const variables = ideBuildVariables(
    {
      version,
      commitHash: commitHash(),
      os: targetOs(process.platform),
      sign: values.sign,
      guiDir: dist('gui'),
      ideDir: dist('ide'),
      backendDir,
    },
    process.env,
  )
  for (const step of packagingSteps(variables, process.env)) {
    const status = runInherited('corepack', ['pnpm', ...step.args], { env: step.env })
    if (status !== 0) {
      throw new Error(`\`corepack pnpm ${step.args.join(' ')}\` failed (exit ${status}).`)
    }
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

In `tools/build-scripts/package.json`, after the `"stdlib-api-check"` script,
add `"ide-build": "node src/commands/ide-build.ts",`. In
`tools/build-scripts/CLAUDE.md`, under `## Commands`, after the
`stdlib-api-check` bullet, add:

<!-- prettier-ignore -->
```markdown
- `ide-build` — what `./run ide build --backend-source local --gui-source local`
  did: from `dist/gui` and `dist/backend`, `pnpm install`, then `build:ide` and
  `dist:ide` with the variables electron-builder reads (and without the empty
  code-signing ones), into `dist/ide`. `--sign` signs (release only). Locally:
  build the GUI into `dist/gui`, the bundle with `sbt buildEngineBundle` and copy
  `built-distribution/engine-bundle-*/enso` to `dist/backend` first.
```

Run:

```bash
corepack pnpm exec prettier --write . > /dev/null
corepack pnpm run test:unit 2>&1 | grep -E "Tests |FAIL"
corepack pnpm run typecheck && corepack pnpm run lint && echo checks-ok
corepack pnpm --silent run ide-build; echo "exit $?"
```

Expected: `Tests  84 passed (84)`; `checks-ok`; and, with no `dist/backend`
here,
`Error: Backend at …dist\backend does not contain any Enso Engine packages.` and
`exit 1` (it fails before installing anything).

- [ ] **Step 3: Replace `ide-packaging.yml`**

With 3g merged, the `build-backend` job is already in its final form; this
replaces the `build-script` job, the workflow `env`'s skip flag, the Note
[Platform Legs …] and `package-ide`. Replace the whole file with:

<!-- prettier-ignore -->
```yaml
# Hand-written. Builds the backend on each platform and the GUI once, packages the IDE for Linux
# and Windows, and runs the package tests: called by `ide-pull-request.yml`, and can be started by
# hand.

name: IDE Packaging
on:
  workflow_dispatch:
    inputs:
      clean_build_required:
        description: Clean before and after the run.
        required: false
        type: boolean
        default: false
  workflow_call: {}

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}-ide-packaging
  cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}

env:
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ contains(github.event.pull_request.labels.*.name, 'CI: Clean build required') || github.ref == 'refs/heads/develop' || inputs.clean_build_required == true }}"

# Note [Platform Legs Run Despite The Other Platform's Failure]
# ============================================================
# A job that needs a matrix job needs every leg of it, and sees one result for all of them. By
# default a Windows backend that fails would therefore skip the Linux packaging too. So:
# - `package-ide` runs unless the run is cancelled or `gui-build` failed. A failed backend leaves
#   the other platform's packaging running; the failed platform's own packaging leg then fails at
#   "Download backend".
# - A failed `gui-build` skips its dependents (both platforms), rather than letting them run and
#   fail at their download steps, which would show one root failure as several red jobs.
# The Linux legs wait for the slower Windows ones, which does not lengthen the run: the Windows legs
# are its longest path.

jobs:
  # Note [Engine Bundle Without ./run]
  # ==================================
  # `./run backend get` is the sbt task `buildEngineBundle` (project/EngineBundle.scala): the engine
  # distribution, the IR cache check, the MSVC runtime DLLs on Windows (`setup-msvc` provides the
  # environment), the small JDK, and the bundle in
  # `built-distribution/engine-bundle-<version>-<os>-amd64/enso`, which is archived as it is
  # (`./run` mirrored it to `dist/backend` first). sbt is called as `./run` called it; the version
  # comes from `tools/build-scripts` (`version`), and `ENSO_LAUNCHER` stays `native`.
  build-backend:
    name: Build Backend (${{ matrix.os }}, amd64)
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
          - os: windows
            runner: windows-latest
    env:
      ENSO_LAUNCHER: native
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: build-backend
          flatc: "true"
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - id: version
        name: Compute the version
        run: corepack pnpm --filter build-scripts run version
      - name: Build the engine bundle
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "clean; all buildEngineBundle"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - if: matrix.os == 'linux'
        name: Upload Edition File
        uses: actions/upload-artifact@v5
        with:
          name: Edition File
          path: distribution/editions/*.yaml
      - if: matrix.os == 'linux'
        name: Upload fbs-schema
        uses: actions/upload-artifact@v5
        with:
          name: fbs-schema
          path: engine/language-server/src/main/schema/
      - name: Archive backend
        run: tar -cvf backend.tar -C built-distribution/engine-bundle-${{ steps.version.outputs.ENSO_VERSION }}-${{ matrix.os }}-amd64/enso .
      - name: Upload backend
        uses: actions/upload-artifact@v5
        with:
          name: backend-${{ matrix.os }}
          path: backend.tar
      - name: Cleanup
        run: rm backend.tar
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  gui-build:
    name: GUI build (linux, amd64)
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - uses: ./.github/actions/setup-rust
        with:
          shared-key: wasm-parser
      - name: Add wasm target
        run: rustup target add wasm32-unknown-unknown
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # Keep the version in step with `wasm-bindgen` in `Cargo.lock` and with `gui-checks.yml`.
      - name: Install wasm-bindgen-cli
        uses: taiki-e/install-action@v2
        with:
          tool: wasm-bindgen-cli@0.2.128
      - name: Derive GUI version
        run: echo "ENSO_IDE_VERSION=$(date -u '+%Y.%-m.%-d')-dev" >> "$GITHUB_ENV"
        shell: bash
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Install dependencies
        run: corepack pnpm install
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Build GUI
        run: corepack pnpm run build:gui --mode=production
        env:
          ENSO_IDE_AG_GRID_LICENSE_KEY: ${{ vars.ENSO_AG_GRID_LICENSE_KEY }}
          ENSO_IDE_COMMIT_HASH: ${{ github.sha }}
          ENSO_IDE_GOOGLE_ANALYTICS_TAG: ${{ vars.ENSO_CLOUD_GOOGLE_ANALYTICS_TAG }}
          ENSO_IDE_HOST: ${{ vars.ENSO_HOST }}
          ENSO_IDE_SENTRY_DSN: ${{ vars.ENSO_CLOUD_SENTRY_DSN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MODE: production
      - name: Collect GUI artifacts
        run: mkdir -p dist/gui/assets && cp -R app/gui/dist/. dist/gui/assets/
        shell: bash
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload gui
        uses: actions/upload-artifact@v5
        with:
          name: gui
          path: dist/gui/
      - name: Upload WASM parser artifacts
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: error
          name: wasm-artifacts
          path: |-
            app/rust-ffi/dist
            app/ydoc-shared/src/ast/generated
          retention-days: 1

  # `tools/build-scripts`' `ide-build` packages the IDE as `./run ide build --backend-source local
  # --gui-source local` did: the version, `pnpm install`, then `build:ide` and `dist:ide` with the
  # variables electron-builder reads, and without the empty code-signing variables (a fork has no
  # certificate). electron-builder writes the installer's `.sha256` itself.
  package-ide:
    name: Package New IDE (${{ matrix.os }}, amd64)
    needs: [build-backend, gui-build]
    # See Note [Platform Legs Run Despite The Other Platform's Failure].
    if: ${{ !cancelled() && needs.gui-build.result == 'success' }}
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
            installer: dist/ide/enso-*.AppImage
          - os: windows
            runner: windows-latest
            installer: dist/ide/enso-*.exe
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
          fetch-depth: 2
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Download backend
        uses: actions/download-artifact@v5
        with:
          name: backend-${{ matrix.os }}
          path: dist/backend
      - run: |-
          tar -xvf dist/backend/backend.tar -C dist/backend
          rm dist/backend/backend.tar
      - name: Download GUI
        uses: actions/download-artifact@v5
        with:
          name: gui
          path: dist/gui
      - name: Download WASM parser artifacts
        uses: actions/download-artifact@v5
        with:
          name: wasm-artifacts
          path: app
      - if: matrix.os == 'linux'
        name: Package the IDE
        run: corepack pnpm --filter build-scripts run ide-build
        env:
          ENSO_IDE_AG_GRID_LICENSE_KEY: ${{ vars.ENSO_AG_GRID_LICENSE_KEY }}
          ENSO_IDE_GOOGLE_ANALYTICS_TAG: ${{ vars.ENSO_CLOUD_GOOGLE_ANALYTICS_TAG }}
          ENSO_IDE_HOST: ${{ vars.ENSO_HOST }}
          ENSO_IDE_SENTRY_DSN: ${{ vars.ENSO_CLOUD_SENTRY_DSN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: matrix.os == 'windows'
        name: Package the IDE
        run: corepack pnpm --filter build-scripts run ide-build
        env:
          ENSO_IDE_AG_GRID_LICENSE_KEY: ${{ vars.ENSO_AG_GRID_LICENSE_KEY }}
          ENSO_IDE_GOOGLE_ANALYTICS_TAG: ${{ vars.ENSO_CLOUD_GOOGLE_ANALYTICS_TAG }}
          ENSO_IDE_HOST: ${{ vars.ENSO_HOST }}
          ENSO_IDE_SENTRY_DSN: ${{ vars.ENSO_CLOUD_SENTRY_DSN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.MICROSOFT_CODE_SIGNING_CERT_PASSWORD }}
          WIN_CSC_LINK: ${{ secrets.MICROSOFT_CODE_SIGNING_CERT }}
      - name: Upload ide
        uses: actions/upload-artifact@v5
        with:
          name: ide-${{ matrix.os }}
          path: ${{ matrix.installer }}
      - if: matrix.os == 'windows'
        name: Smoke-test the installer
        run: ./tools/ci/windows-installer-smoke.ps1 -Installer (Get-Item dist/ide/enso-win-x64-*.exe).FullName
        shell: pwsh
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: matrix.os == 'linux'
        name: Run Package Tests
        run: xvfb-run corepack pnpm -r --filter enso ide-integration-test
        env:
          DEBUG: "pw:browser log:"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: matrix.os == 'windows'
        name: Run Package Tests
        run: corepack pnpm -r --filter enso ide-integration-test
        env:
          DEBUG: "pw:browser log:"
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: failure()
        name: Upload Test Traces
        uses: actions/upload-artifact@v5
        with:
          compression-level: 0
          name: test-traces-${{ matrix.os }}-amd64
          path: app/electron-client/test-traces
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

Before saving, diff your result against develop's file: the `build-backend` and
`gui-build` jobs must be byte-identical to develop's
(`git diff origin/develop -- .github/workflows/ide-packaging.yml` shows only the
header env, the Note, the deleted `build-script` job and `package-ide`).

In `.github/CLAUDE.md`, the row whose cells are
`` `ide-packaging.yml` › Package New IDE `` and `` `./run ide build` `` gets the
cells `` `corepack pnpm --filter build-scripts run ide-build` `` and
`` No: `setup-build-scripts` ``.

- [ ] **Step 4: Check, compare, commit, open the PR**

```bash
cd /c/Repos/Enso/ide-bs-3i
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3i && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3i .github/workflows/ide-packaging.yml > "$SCRATCH/compare-3i.md"
git add tools/build-scripts .github
git commit -m "IDE packaging: ide-build in tools/build-scripts instead of ./run ide build"
git push -u origin ci/ide-build
```

Expected: `Workflow policy: OK` (including `checkWindowsInstallerSmokeTest` and
`checkIdePackagingNeedsNoCloudAccount`), `actionlint-ok`; `compare-3i.md` shows
D9 only.

`$SCRATCH/pr-3i.md`: R11 and the table above; the GUI/installer version mismatch
found in research, left as it is (Tickets to raise); D9; `compare-3i.md`; a
"Verification" section; "Part of #289's Phase 3."; the attribution lines.

```bash
gh pr create --base develop --head ci/ide-build --label "CI: No changelog needed" \
  --title "Build simplification, PR 3i: IDE packaging without ./run" --body-file "$SCRATCH/pr-3i.md"
```

- [ ] **Step 5: Prove it, and merge**

Run `"$SCRATCH/wait-pr.sh" <N> 300` in the background. When it exits:

```bash
pr=$(gh run list --workflow ide-pull-request.yml --branch ci/ide-build -L 1 --json databaseId --jq '.[0].databaseId')
dev=$(gh run list --workflow ide-pull-request.yml --branch develop --event push -L 1 --json databaseId --jq '.[0].databaseId')
for id in $pr $dev; do echo "## run $id"; "$SCRATCH/job-times.sh" "$id"; done
for id in $pr $dev; do gh api "repos/{owner}/{repo}/actions/runs/$id/artifacts" --jq '.artifacts[] | select(.name | startswith("ide-")) | "\(.name)\t\(.size_in_bytes)"'; done
gh run view "$pr" --log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Packaging IDE|enso-(linux|win)-[^ ]*\.(AppImage|exe|sha256)" | sed 's/^.*\t//' | sort -u | head
```

Expected:

- every job green, including both "Package New IDE" legs, the Linux and Windows
  package tests and the installer smoke test; times within about 20% of
  develop's;
- `ide-linux` and `ide-windows` artifacts within a few percent of develop's
  sizes;
- `Packaging IDE 2026.1.1-dev with engine 2026.1.1-dev.` on both legs, and the
  file names `enso-linux-x86_64-2026.1.1-dev.AppImage` and
  `enso-win-x64-2026.1.1-dev.exe`, plus their `.sha256` (electron-builder logs
  each artifact it writes).

When every check is green: `gh pr merge <N> --squash`.

---

### Task 14: The `stdlib-test` runner, `junit-compare`, and GraalPy in `setup-jvm` (PR 3j)

**Files:**

- Create: `tools/build-scripts/src/lib/sbt.ts`
- Create:
  `tools/build-scripts/src/stdlib-test/{suites,invocation,junit,httpbin,run}.ts`
  and their `*.test.ts`
- Create: `tools/build-scripts/src/commands/stdlib-test.ts`,
  `src/commands/junit-compare.ts`
- Modify: `tools/build-scripts/package.json` (two scripts), `CLAUDE.md`
- Modify: `.github/actions/setup-jvm/action.yml` (`graalpy` input)

**Interfaces:**

- Consumes: `REPO_ROOT`, `runInherited`, `invocation`, `commandArguments` (Task
  1); `findEnginePackage`, `ensoBinary` (Task 7); the `toolchain.graalpy` pin
  (Task 3).
- Produces:
  - `src/lib/sbt.ts`: `SBT_ENV`, `sbtArguments(command)`,
    `spawnSbt(command, cwd, env): ChildProcess`, `killTree(child)` — the only
    module that starts sbt, so the policy counts `stdlib-test` as an sbt call;
  - the scripts `stdlib-test <suite> [--only A,B] [--no-clean] [--dry-run]`
    (exit 0, 1 on a failed project, 2 on a usage or set-up error) and
    `junit-compare <old dir> <new dir> [--allow Project]` (exit 1 when a project
    is missing on one side or its pass, fail or skip count differs);
  - `setup-jvm` input `graalpy: "true"|"false"` (default `"false"`): the
    standalone GraalPy at `toolchain.graalpy`, its `bin` on the `PATH`.

- [ ] **Step 1: Create the worktree, and write the failing tests**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-3j -b ci/stdlib-test origin/develop
cd /c/Repos/Enso/ide-bs-3j && corepack pnpm install --frozen-lockfile --ignore-scripts
test -f tools/build-scripts/src/lib/engine.ts && grep -q "graalpy:" build-config.yaml && grep -q "checkEnsoSyntax" build.sbt && ! grep -q "\./run backend test jvm" .github/workflows/engine-checks-platform.yml && echo "3b, 3d, 3e and 3h are in"
```

Expected: `3b, 3d, 3e and 3h are in`.

`tools/build-scripts/src/stdlib-test/suites.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Suite selection, against today's test projects. */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import {
  discoverProjects,
  selectProjects,
  skipsForMissingAwsCredentials,
  suiteNamed,
  SUITES,
} from './suites.ts'

/** The projects on 2026-10-22; `Google_Test` and `Benchmarks` are not `*_Tests`. */
const PROJECTS = [
  'AWS_Tests',
  'Base_Internal_Tests',
  'Base_Tests',
  'Cloud_Tests',
  'DuckDB_Tests',
  'Examples_Tests',
  'Generic_JDBC_Tests',
  'Geo_Tests',
  'Image_Tests',
  'Microsoft_Tests',
  'Saas_Tests',
  'Snowflake_Tests',
  'Table_Internal_Tests',
  'Table_Tests',
  'Tableau_Tests',
  'Test_Tests',
  'Visualization_Tests',
]

test('discovery finds every *_Tests project with a package.yaml', () => {
  const found = discoverProjects(path.join(REPO_ROOT, 'test'))
  expect(found).toContain('Examples_Tests')
  expect(found).not.toContain('Google_Test')
  expect(found).not.toContain('Benchmarks')
  expect(found).toEqual([...found].sort())
})

describe('selection, as ./run selected', () => {
  test('both standard-library suites run 15 projects: all but Microsoft and AWS', () => {
    for (const name of ['standard-library', 'standard-library-in-native']) {
      const selected = selectProjects(PROJECTS, suiteNamed(name).suite)
      expect(selected).toHaveLength(15)
      expect(selected).not.toContain('Microsoft_Tests')
      expect(selected).not.toContain('AWS_Tests')
    }
  })
  test('the dedicated suites run one project each', () => {
    expect(selectProjects(PROJECTS, suiteNamed('std-aws').suite)).toEqual(['AWS_Tests'])
    expect(selectProjects(PROJECTS, suiteNamed('std-microsoft').suite)).toEqual(['Microsoft_Tests'])
    expect(selectProjects(PROJECTS, suiteNamed('std-snowflake-jvm').suite)).toEqual([
      'Snowflake_Tests',
    ])
  })
  test('std-cloud-related, and --only', () => {
    expect(selectProjects(PROJECTS, suiteNamed('std-cloud-related').suite)).toEqual([
      'AWS_Tests',
      'Base_Internal_Tests',
      'Base_Tests',
      'Image_Tests',
      'Microsoft_Tests',
      'Table_Tests',
    ])
    expect(
      selectProjects(PROJECTS, suiteNamed('stdlib').suite, ['Examples_Tests', 'AWS_Tests']),
    ).toEqual(['Examples_Tests'])
  })
  test('aliases, and an unknown suite', () => {
    expect(suiteNamed('stdlib-native').name).toBe('standard-library-in-native')
    expect(() => suiteNamed('std-everything')).toThrow('Unknown suite std-everything')
    expect(Object.keys(SUITES)).toHaveLength(8)
  })
})

describe('the AWS suite without credentials (enso.rs test)', () => {
  const aws = suiteNamed('std-aws').suite
  test('is skipped without both keys', () => {
    expect(skipsForMissingAwsCredentials(aws, {})).toBe(true)
    expect(skipsForMissingAwsCredentials(aws, { ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a' })).toBe(true)
    expect(
      skipsForMissingAwsCredentials(aws, {
        ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a',
        ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: '',
      }),
    ).toBe(true)
  })
  test('runs with both keys', () => {
    const env = { ENSO_LIB_S3_AWS_ACCESS_KEY_ID: 'a', ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: 'b' }
    expect(skipsForMissingAwsCredentials(aws, env)).toBe(false)
  })
  test('only the dedicated suite is skipped', () => {
    expect(skipsForMissingAwsCredentials(suiteNamed('std-cloud-related').suite, {})).toBe(false)
    expect(skipsForMissingAwsCredentials(suiteNamed('standard-library').suite, {})).toBe(false)
  })
})
```

`tools/build-scripts/src/stdlib-test/invocation.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The command lines and environment, against the ones `./run` logged in CI (run 39666057183). */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  irCacheDirectory,
  missingServiceWarnings,
  projectArguments,
  runnerArguments,
  testEnvironment,
} from './invocation.ts'
import { suiteNamed } from './suites.ts'

const jdk = '/home/runner/work/enso/enso/target/small-jdk'
const project = (name: string) => `/home/runner/work/enso/enso/test/${name}`

describe('the command line', () => {
  test('Linux JVM, as logged', () => {
    const runner = runnerArguments(suiteNamed('standard-library').suite, 'linux', jdk, 'GraalVM CE')
    expect(projectArguments(runner, project('Base_Internal_Tests'))).toEqual([
      '-XX:+HeapDumpOnOutOfMemoryError',
      '--jvm',
      jdk,
      '--no-ir-caches',
      '--run',
      project('Base_Internal_Tests'),
      '--disable-private-check',
    ])
  })
  test('Windows JVM: no heap-dump argument', () => {
    const windowsJdk = 'D:\\a\\enso\\enso\\target\\small-jdk'
    const runner = runnerArguments(
      suiteNamed('standard-library').suite,
      'win32',
      windowsJdk,
      'GraalVM CE',
    )
    expect(runner).toEqual(['--jvm', windowsJdk])
  })
  test('native: the heap-dump argument on Linux, nothing on Windows', () => {
    const native = suiteNamed('standard-library-in-native').suite
    expect(
      projectArguments(runnerArguments(native, 'linux', jdk, 'GraalVM CE'), project('Base_Tests')),
    ).toEqual(['-XX:+HeapDumpOnOutOfMemoryError', '--no-ir-caches', '--run', project('Base_Tests')])
    expect(runnerArguments(native, 'win32', jdk, 'GraalVM CE')).toEqual([])
  })
  test('Oracle GraalVM runs the JVM suite without the small JDK', () => {
    const runner = runnerArguments(
      suiteNamed('standard-library').suite,
      'linux',
      jdk,
      'Oracle GraalVM',
    )
    expect(runner).toEqual(['-XX:+HeapDumpOnOutOfMemoryError'])
  })
  test('suites with their own runner arguments replace the heap-dump argument', () => {
    expect(runnerArguments(suiteNamed('std-snowflake-jvm').suite, 'linux', jdk, undefined)).toEqual(
      ['--jvm'],
    )
  })
})

describe('the environment', () => {
  const base = {
    PATH: '/bin',
    JAVA_TOOL_OPTIONS: '-Xmx1g',
    ENSO_POSTGRES_DATABASE: '',
    ENSO_POSTGRES_HOST: 'localhost:5432',
    ENSO_SQLSERVER_DATABASE: '',
  }
  test('Linux JVM', () => {
    const runner = runnerArguments(suiteNamed('standard-library').suite, 'linux', jdk, undefined)
    const env = testEnvironment({
      base,
      platform: 'linux',
      enginePackage: '/e',
      nativeRunner: true,
      runnerArgs: runner,
      junitDir: '/r/target/test-results',
      httpbinUrl: 'http://localhost:19649/',
    })
    expect(env).toEqual({
      PATH: '/bin',
      ENSO_POSTGRES_HOST: 'localhost:5432',
      JAVA_TOOL_OPTIONS: '-enableassertions -XX:+HeapDumpOnOutOfMemoryError',
      ENSO_META_TEST_COMMAND: path.join('/e', 'bin', 'enso'),
      ENSO_META_TEST_ARGS: `--no-ir-caches -XX:+HeapDumpOnOutOfMemoryError --jvm ${jdk} --run`,
      ENSO_ENABLE_ASSERTIONS: 'true',
      ENSO_TEST_ANSI_COLORS: 'true',
      ENSO_TEST_JUNIT_DIR: '/r/target/test-results',
      ENSO_HTTP_TEST_HTTPBIN_URL: 'http://localhost:19649/',
    })
  })
  test('Windows native: the time factors, and the native launcher', () => {
    const env = testEnvironment({
      base: {},
      platform: 'win32',
      enginePackage: 'D:\\e',
      nativeRunner: true,
      runnerArgs: [],
      junitDir: 'D:\\r',
      httpbinUrl: null,
    })
    expect(env.ENSO_META_TEST_ARGS).toBe('--no-ir-caches --run')
    expect(env.ENSO_META_TEST_COMMAND).toBe(path.join('D:\\e', 'bin', 'enso.exe'))
    expect(env.CI_TEST_TIMEFACTOR).toBe('2')
    expect(env.CI_TEST_FLAKY_ENABLE).toBe('true')
    expect(env.ENSO_HTTP_TEST_HTTPBIN_URL).toBeUndefined()
  })
  test('the time factors are absent on Linux, not empty', () => {
    const env = testEnvironment({
      base: {},
      platform: 'linux',
      enginePackage: '/e',
      nativeRunner: true,
      runnerArgs: [],
      junitDir: '/j',
      httpbinUrl: null,
    })
    expect('CI_TEST_TIMEFACTOR' in env).toBe(false)
    expect('CI_TEST_FLAKY_ENABLE' in env).toBe(false)
  })
})

test('a Linux run warns when a database the suite expects is missing', () => {
  expect(missingServiceWarnings(['Table_Tests', 'Microsoft_Tests'], 'linux', {})).toHaveLength(2)
  expect(
    missingServiceWarnings(['Table_Tests'], 'linux', { ENSO_POSTGRES_DATABASE: 'enso_test_db' }),
  ).toEqual([])
  expect(missingServiceWarnings(['Table_Tests'], 'win32', {})).toEqual([])
})

test('the IR cache directory', () => {
  expect(irCacheDirectory('linux', {}, '/home/u')).toBe(
    path.join('/home/u', '.local', 'share', 'enso', 'cache'),
  )
  expect(irCacheDirectory('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe(
    path.join('/x', 'enso', 'cache'),
  )
  expect(irCacheDirectory('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\U')).toBe(
    path.join('C:\\L', 'enso', 'cache'),
  )
  expect(irCacheDirectory('linux', { ENSO_DATA_DIRECTORY: '/d' }, '/home/u')).toBe(
    path.join('/d', 'cache'),
  )
})
```

`tools/build-scripts/src/stdlib-test/junit.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Reading the Enso test reporter's JUnit XML, and comparing two runs. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { compareRuns, comparisonMarkdown, count, parseJUnit, readJUnitDir } from './junit.ts'

/** The shape `Test_Reporter.enso` writes: a passing, a failing and a pending case, and a pending group. */
const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
    <testsuite name="Text &amp; Strings" timestamp="2026-10-21T20:00:00" tests="3" disabled="1" errors="1" time="0.5">
        <testcase name="should &lt;split&gt;" time="0.1">        </testcase>
        <testcase name="should fail" time="0.2">
            <failure message="Expected 1, got 2">
Expected 1, got 2
            </failure>
        </testcase>
        <testcase name="should wait" time="0.0">
            <skipped message="Reason: not yet"/>
                </testcase>
    </testsuite>
    <testsuite name="Postgres" timestamp="2026-10-21T20:00:00" tests="0" disabled="1" errors="0" time="0.0">
        <testcase name="PENDING" time="0.0">
            <skipped message="Reason: PostgreSQL test database is not configured."/>
        </testcase>
    </testsuite>
</testsuites>
`

test('parses suites and cases, unescaped, with their status', () => {
  expect(parseJUnit(REPORT)).toEqual([
    { suite: 'Text & Strings', name: 'should <split>', status: 'pass' },
    { suite: 'Text & Strings', name: 'should fail', status: 'fail' },
    { suite: 'Text & Strings', name: 'should wait', status: 'skip' },
    { suite: 'Postgres', name: 'PENDING', status: 'skip' },
  ])
  expect(count(parseJUnit(REPORT))).toEqual({ pass: 1, fail: 1, skip: 2 })
})

describe('compareRuns', () => {
  const run = (...projects: [project: string, xml: string][]) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'junit-'))
    for (const [project, xml] of projects) {
      mkdirSync(path.join(dir, project))
      writeFileSync(path.join(dir, project, 'JUnit.xml'), xml)
    }
    return readJUnitDir(dir)
  }
  test('identical runs are the same', () => {
    const rows = compareRuns(run(['Base_Tests', REPORT]), run(['Base_Tests', REPORT]))
    expect(rows).toEqual([
      {
        project: 'Base_Tests',
        old: { pass: 1, fail: 1, skip: 2 },
        new: { pass: 1, fail: 1, skip: 2 },
        same: true,
        changed: [],
      },
    ])
  })
  test('a skip that became a pass differs, and names the case', () => {
    const fixed = REPORT.replace(
      '<testcase name="PENDING" time="0.0">\n            <skipped message="Reason: PostgreSQL test database is not configured."/>\n        </testcase>',
      '<testcase name="PENDING" time="0.0"></testcase>',
    )
    const [row] = compareRuns(run(['Table_Tests', REPORT]), run(['Table_Tests', fixed]))
    expect(row?.same).toBe(false)
    expect(row?.changed).toEqual(['Postgres › PENDING: skip → pass'])
  })
  test('a project missing on one side differs', () => {
    const rows = compareRuns(run(['A_Tests', REPORT]), run(['B_Tests', REPORT]))
    expect(rows.map((row) => [row.project, row.same])).toEqual([
      ['A_Tests', false],
      ['B_Tests', false],
    ])
    expect(comparisonMarkdown(rows)[2]).toBe('| A_Tests | 1 / 1 / 2 | missing | **DIFFERS** |')
  })
})
```

`tools/build-scripts/src/stdlib-test/httpbin.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file Waiting for the HTTP test helper. */
import { createServer } from 'node:net'
import { expect, test } from 'vitest'
import { accepts, freePort, waitUntilReady } from './httpbin.ts'

const instant = async () => {}

test('ready on the third poll', async () => {
  let polls = 0
  await waitUntilReady(
    async () => ++polls === 3,
    () => false,
    180_000,
    instant,
  )
  expect(polls).toBe(3)
})

test('a helper that exits early fails at once', async () => {
  await expect(
    waitUntilReady(
      async () => false,
      () => true,
      180_000,
      instant,
    ),
  ).rejects.toThrow('exited before it accepted connections')
})

test('a helper that never listens times out', async () => {
  await expect(
    waitUntilReady(
      async () => false,
      () => false,
      3000,
      instant,
    ),
  ).rejects.toThrow('within 3 s')
})

test('accepts sees a listening port, and a free port is free', async () => {
  const port = await freePort()
  expect(await accepts(port)).toBe(false)
  const server = createServer().listen(port, 'localhost')
  await new Promise((resolve) => server.once('listening', resolve))
  expect(await accepts(port)).toBe(true)
  server.close()
})
```

`tools/build-scripts/src/stdlib-test/run.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The runner's orchestration, with the engine, the helper server and the file system faked. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runStdlibTests, type StdlibTestContext } from './run.ts'

/** A repository whose `test/` holds the given projects. */
function repository(projects: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'stdlib-test-'))
  for (const project of projects) {
    mkdirSync(path.join(root, 'test', project), { recursive: true })
    writeFileSync(path.join(root, 'test', project, 'package.yaml'), 'name: x\n')
  }
  return root
}

function context(root: string, overrides: Partial<StdlibTestContext> = {}) {
  const calls: string[] = []
  const logged: string[] = []
  const base: StdlibTestContext = {
    repoRoot: root,
    platform: 'linux',
    env: { GITHUB_ACTIONS: 'true' },
    home: '/home/u',
    enginePackage: { dir: '/e', version: '2026.1.1-dev' },
    exists: () => true,
    startHttpbin: async () => {
      calls.push('httpbin start')
      return { url: 'http://localhost:1/', stop: () => calls.push('httpbin stop') }
    },
    runProject: (file, args, env) => {
      calls.push(`${file} ${args.at(-1)} junit=${env.ENSO_TEST_JUNIT_DIR}`)
      return args.at(-1)?.endsWith('Failing_Tests') ? 1 : 0
    },
    remove: (target) => calls.push(`remove ${target}`),
    benchReports: () => ['/r/bench-report.xml'],
    resetDir: (dir) => calls.push(`reset ${dir}`),
    appendSummary: () => {},
    log: (line) => logged.push(line),
  }
  return { calls, logged, context: { ...base, ...overrides } }
}

describe('runStdlibTests', () => {
  test('cleans, starts the helper, runs every project in order, stops the helper', async () => {
    const root = repository(['Base_Tests', 'AWS_Tests', 'Examples_Tests'])
    const { calls, context: c } = context(root)
    const junit = path.join(root, 'target', 'test-results')
    expect(
      await runStdlibTests({ suite: 'standard-library-in-native', clean: true, dryRun: false }, c),
    ).toBe(0)
    expect(calls).toEqual([
      `remove ${path.join('/home/u', '.local', 'share', 'enso', 'cache')}`,
      'remove /r/bench-report.xml',
      `reset ${junit}`,
      'httpbin start',
      `${path.join('/e', 'bin', 'enso')} ${path.join(root, 'test', 'Base_Tests')} junit=${junit}`,
      `${path.join('/e', 'bin', 'enso')} ${path.join(root, 'test', 'Examples_Tests')} junit=${junit}`,
      'httpbin stop',
    ])
  })
  test('a failing project fails the run after the others have run', async () => {
    const root = repository(['Failing_Tests', 'Test_Tests'])
    const { calls, logged, context: c } = context(root)
    expect(await runStdlibTests({ suite: 'stdlib', clean: false, dryRun: false }, c)).toBe(1)
    expect(calls.filter((call) => call.includes('Test_Tests'))).toHaveLength(1)
    expect(logged.at(-1)).toBe(
      '::error title=Failed Standard Library Tests::1 test suite(s) failed: Failing_Tests: the test run exited with status 1',
    )
    expect(calls.at(-1)).toBe('httpbin stop')
  })
  test('the AWS suite without credentials succeeds and starts nothing', async () => {
    const { calls, context: c } = context(repository(['AWS_Tests']))
    expect(await runStdlibTests({ suite: 'std-aws', clean: true, dryRun: false }, c)).toBe(0)
    expect(calls).toEqual([])
  })
  test('no cleaning outside GitHub Actions, and a given helper URL is used', async () => {
    const root = repository(['Base_Tests'])
    const { calls, context: c } = context(root, {
      env: { CI: 'true', ENSO_HTTP_TEST_HTTPBIN_URL: 'http://localhost:9/' },
    })
    await runStdlibTests({ suite: 'stdlib', clean: true, dryRun: false }, c)
    expect(calls.some((call) => call.startsWith('remove') || call.startsWith('httpbin'))).toBe(
      false,
    )
  })
  test('the JVM suite needs the small JDK', async () => {
    const { context: c } = context(repository(['Base_Tests']), { exists: () => false })
    await expect(
      runStdlibTests({ suite: 'standard-library', clean: false, dryRun: false }, c),
    ).rejects.toThrow('buildSmallJdkForRelease')
  })
  test('the cloud suites refuse cloud credentials, which still need ./run', async () => {
    const env = Object.fromEntries(
      [
        'ENSO_CLOUD_TEST_ACCOUNT_USERNAME',
        'ENSO_CLOUD_TEST_ACCOUNT_PASSWORD',
        'ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID',
        'ENSO_CLOUD_COGNITO_USER_POOL_ID',
        'ENSO_CLOUD_COGNITO_REGION',
      ].map((name) => [name, 'x']),
    )
    const { context: c } = context(repository(['Base_Tests']), { env })
    await expect(
      runStdlibTests({ suite: 'std-cloud-related', clean: false, dryRun: false }, c),
    ).rejects.toThrow('Phase 4')
  })
  test('a dry run lists the commands and runs nothing', async () => {
    const { calls, logged, context: c } = context(repository(['Base_Tests']))
    expect(await runStdlibTests({ suite: 'stdlib-native', clean: true, dryRun: true }, c)).toBe(0)
    expect(calls).toEqual([])
    expect(logged.at(-1)).toContain('--no-ir-caches --run')
  })
})
```

Run:
`cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | grep -E "FAIL|Tests "`

Expected: FAIL: the five files cannot resolve `./suites.ts`, `./invocation.ts`,
`./junit.ts`, `./httpbin.ts` and `./run.ts`.

- [ ] **Step 2: Write the sbt helper and the runner**

`tools/build-scripts/src/lib/sbt.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The one place in the build scripts that starts sbt. `tools/ci/check-workflows.mjs` fails
 * any other module that does, and counts every command that imports this one as an sbt call, so a
 * workflow must run `setup-jvm` before it.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { invocation } from './repo.ts'

/** What `./run` set on every sbt process. */
export const SBT_ENV = { LC_ALL: 'C.UTF-8', SBT_SERVER_FORCESTART: 'true' } as const

/** `./run`'s sbt arguments around one command string. */
export function sbtArguments(command: string): string[] {
  return ['-Dbench.compileOnly=false', '-Dsbt.server.autostart=false', command]
}

/**
 * Starts `sbt <command>` in `cwd` without waiting for it. On POSIX it leads a process group of its
 * own, so that {@link killTree} stops the forked JVMs too.
 */
export function spawnSbt(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const how = invocation('sbt', sbtArguments(command))
  return spawn(how.file, how.args, {
    cwd,
    env: { ...env, ...SBT_ENV },
    shell: how.shell,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
  })
}

/** Stops a process started by {@link spawnSbt} and everything it started. */
export function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}
```

`tools/build-scripts/src/stdlib-test/suites.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The standard-library test suites: `./run backend test <suite>` (`build_tools/cli/src/lib.rs`,
 * `engine.rs` `StandardLibraryTestsSelection`), with the same names, so the workflows' matrices do
 * not change.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** One suite. */
export interface Suite {
  /** Run only these projects (by directory name)... */
  readonly allow?: readonly string[]
  /** ...or every project but these. */
  readonly deny?: readonly string[]
  /** Run on the small JDK (`--jvm <repo>/target/small-jdk`), unless the edition is Oracle GraalVM. */
  readonly smallJdk: boolean
  /** Runner arguments that replace the heap-dump flag (`extra_engine_runner_args`). */
  readonly runnerArgs?: readonly string[]
  /** Whether `ENSO_META_TEST_COMMAND` names the native launcher (`enso.exe`, not `enso.bat`). */
  readonly nativeRunner: boolean
}

const NOT_SEPARATE = ['Microsoft_Tests', 'AWS_Tests']

/** The suites `./run backend test` knew. */
export const SUITES: Readonly<Record<string, Suite>> = {
  'standard-library': { deny: NOT_SEPARATE, smallJdk: true, nativeRunner: true },
  'standard-library-in-native': { deny: NOT_SEPARATE, smallJdk: false, nativeRunner: true },
  'std-aws': { allow: ['AWS_Tests'], smallJdk: false, nativeRunner: true },
  'std-microsoft': { allow: ['Microsoft_Tests'], smallJdk: false, nativeRunner: true },
  'std-snowflake': { allow: ['Snowflake_Tests'], smallJdk: false, nativeRunner: false },
  'std-snowflake-jvm': {
    allow: ['Snowflake_Tests'],
    smallJdk: false,
    runnerArgs: ['--jvm'],
    nativeRunner: false,
  },
  'std-cloud-related': {
    allow: [
      'Base_Tests',
      'Base_Internal_Tests',
      'Table_Tests',
      'AWS_Tests',
      'Image_Tests',
      'Microsoft_Tests',
    ],
    smallJdk: false,
    nativeRunner: true,
  },
  'std-mock-dual-microsoft': {
    allow: ['Microsoft_Tests'],
    smallJdk: false,
    runnerArgs: ['--jvm', '--vm.D=polyglot.enso.classLoading=Standard.Microsoft:guest,hosted'],
    nativeRunner: false,
  },
}

/** `./run`'s aliases. */
const ALIASES: Readonly<Record<string, string>> = {
  stdlib: 'standard-library',
  'stdlib-native': 'standard-library-in-native',
}

/** The suite called `name` (or an alias of it), with its canonical name. */
export function suiteNamed(name: string): { readonly name: string; readonly suite: Suite } {
  const canonical = ALIASES[name] ?? name
  const suite = SUITES[canonical]
  if (suite == null) {
    throw new Error(`Unknown suite ${name}; expected one of ${Object.keys(SUITES).join(', ')}.`)
  }
  return { name: canonical, suite }
}

/** The test projects under `testDir`: directories `*_Tests` with a `package.yaml`, sorted. */
export function discoverProjects(testDir: string): string[] {
  return readdirSync(testDir)
    .filter(
      (name) => name.endsWith('_Tests') && existsSync(path.join(testDir, name, 'package.yaml')),
    )
    .sort()
}

/** Whether `suite` runs `project`. */
export function selects(suite: Suite, project: string): boolean {
  if (suite.allow != null) return suite.allow.includes(project)
  return !(suite.deny ?? []).includes(project)
}

/** The projects `suite` runs, optionally narrowed to `only`. */
export function selectProjects(
  projects: readonly string[],
  suite: Suite,
  only?: readonly string[],
): string[] {
  return projects.filter(
    (project) => selects(suite, project) && (only == null || only.includes(project)),
  )
}

/**
 * The AWS suite without credentials: `./run` warned and succeeded, before starting any service. Only
 * the dedicated suite (exactly `AWS_Tests`) is skipped this way.
 */
export function skipsForMissingAwsCredentials(
  suite: Suite,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const awsOnly = suite.allow?.length === 1 && suite.allow[0] === 'AWS_Tests'
  const has = (name: string) => (env[name] ?? '') !== ''
  return (
    awsOnly && !(has('ENSO_LIB_S3_AWS_ACCESS_KEY_ID') && has('ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY'))
  )
}
```

`tools/build-scripts/src/stdlib-test/invocation.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file How each test project runs (`build_tools/build/src/enso.rs` `run_tests`): the launcher's
 * arguments and the environment, exactly as `./run` built them (the CI logs show the command lines).
 */
import path from 'node:path'
import type { Suite } from './suites.ts'

/** The heap-dump flag: in `JAVA_TOOL_OPTIONS` always, and a launcher argument except on Windows. */
export const HEAP_DUMP = '-XX:+HeapDumpOnOutOfMemoryError'

/** The launcher arguments before `--no-ir-caches --run` (`extra_engine_runner_args`). */
export function runnerArguments(
  suite: Suite,
  platform: NodeJS.Platform,
  smallJdk: string,
  graalEdition: string | undefined,
): string[] {
  const args =
    suite.runnerArgs != null ? [...suite.runnerArgs]
    : platform === 'win32' ? []
    : [HEAP_DUMP]
  if (suite.smallJdk && graalEdition !== 'Oracle GraalVM') args.push('--jvm', smallJdk)
  return args
}

/** The launcher's arguments for one project. `_Internal_` projects may use private methods. */
export function projectArguments(runnerArgs: readonly string[], projectDir: string): string[] {
  const args = [...runnerArgs, '--no-ir-caches', '--run', projectDir]
  if (projectDir.includes('_Internal_')) args.push('--disable-private-check')
  return args
}

/** What {@link testEnvironment} needs. */
export interface TestEnvironmentInputs {
  readonly base: Readonly<Record<string, string | undefined>>
  readonly platform: NodeJS.Platform
  readonly enginePackage: string
  readonly nativeRunner: boolean
  readonly runnerArgs: readonly string[]
  readonly junitDir: string
  readonly httpbinUrl: string | null
}

/** The database variables a CI job sets per matrix entry; an empty one means "no such database". */
export const SERVICE_VARIABLES = [
  'ENSO_POSTGRES_DATABASE',
  'ENSO_POSTGRES_HOST',
  'ENSO_POSTGRES_USER',
  'ENSO_POSTGRES_PASSWORD',
  'ENSO_SQLSERVER_DATABASE',
  'ENSO_SQLSERVER_HOST',
  'ENSO_SQLSERVER_PORT',
  'ENSO_SQLSERVER_USER',
  'ENSO_SQLSERVER_PASSWORD',
] as const

/**
 * The tests' environment. On top of `base`: `./run`'s variables (`JAVA_TOOL_OPTIONS` is set, not
 * appended to), and without the service variables that are empty. Enso's `Environment.get` reads
 * an empty variable as `""`, not `Nothing`, which would turn a skipped database group into a
 * failing one.
 */
export function testEnvironment(inputs: TestEnvironmentInputs): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(inputs.base)) {
    if (value != null) env[name] = value
  }
  for (const name of SERVICE_VARIABLES) {
    if (env[name] === '') delete env[name]
  }
  const launcher =
    inputs.platform === 'win32' ?
      inputs.nativeRunner ?
        'enso.exe'
      : 'enso.bat'
    : 'enso'
  Object.assign(env, {
    JAVA_TOOL_OPTIONS: `-enableassertions ${HEAP_DUMP}`,
    ENSO_META_TEST_COMMAND: path.join(inputs.enginePackage, 'bin', launcher),
    ENSO_META_TEST_ARGS: ['--no-ir-caches', ...inputs.runnerArgs, '--run'].join(' '),
    ENSO_ENABLE_ASSERTIONS: 'true',
    ENSO_TEST_ANSI_COLORS: 'true',
    ENSO_TEST_JUNIT_DIR: inputs.junitDir,
  })
  if (inputs.httpbinUrl != null) env.ENSO_HTTP_TEST_HTTPBIN_URL = inputs.httpbinUrl
  if (inputs.platform === 'win32') {
    env.CI_TEST_TIMEFACTOR = '2'
    env.CI_TEST_FLAKY_ENABLE = 'true'
  }
  return env
}

/**
 * Warnings for a Linux run that `./run` would have given a database and that has none: the
 * database groups would be skipped silently, and the job would stay green.
 */
export function missingServiceWarnings(
  projects: readonly string[],
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  if (platform !== 'linux') return []
  const warnings: string[] = []
  if (projects.includes('Table_Tests') && (env.ENSO_POSTGRES_DATABASE ?? '') === '') {
    warnings.push('Table_Tests runs without a Postgres database (ENSO_POSTGRES_* is not set).')
  }
  if (projects.includes('Microsoft_Tests') && (env.ENSO_SQLSERVER_DATABASE ?? '') === '') {
    warnings.push(
      'Microsoft_Tests runs without a SQL Server database (ENSO_SQLSERVER_* is not set).',
    )
  }
  return warnings
}

/** Where the global IR cache lives (`paths.rs` `cache_directory`). */
export function irCacheDirectory(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  const custom = env.ENSO_DATA_DIRECTORY ?? ''
  if (custom !== '') return path.join(custom, 'cache')
  if (platform === 'win32')
    return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'enso', 'cache')
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'org.enso', 'cache')
  const data = env.XDG_DATA_HOME ?? ''
  return path.join(data !== '' ? data : path.join(home, '.local', 'share'), 'enso', 'cache')
}
```

`tools/build-scripts/src/stdlib-test/junit.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The JUnit reports the standard-library tests write (`Standard/Test` `Test_Reporter.enso`,
 * one `<junit dir>/<project>/JUnit.xml` per project), and the side-by-side comparison of two runs.
 * A pending group is one `PENDING` test case with `<skipped>`; it counts as a skip.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** A test case's outcome. */
export type Status = 'pass' | 'fail' | 'skip'

/** One test case. */
export interface TestCase {
  readonly suite: string
  readonly name: string
  readonly status: Status
}

/** Pass, fail and skip counts. */
export interface Counts {
  readonly pass: number
  readonly fail: number
  readonly skip: number
}

const unescape = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

/** The test cases in one `JUnit.xml`. */
export function parseJUnit(xml: string): TestCase[] {
  const cases: TestCase[] = []
  const suites = /<testsuite\s[^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/testsuite>/g
  const testCases = /<testcase\s[^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g
  for (const suite of xml.matchAll(suites)) {
    for (const testCase of (suite[2] ?? '').matchAll(testCases)) {
      const body = testCase[2] ?? ''
      cases.push({
        suite: unescape(suite[1] ?? ''),
        name: unescape(testCase[1] ?? ''),
        status:
          body.includes('<failure') ? 'fail'
          : body.includes('<skipped') ? 'skip'
          : 'pass',
      })
    }
  }
  return cases
}

/** The counts of `cases`. */
export function count(cases: readonly TestCase[]): Counts {
  return {
    pass: cases.filter((c) => c.status === 'pass').length,
    fail: cases.filter((c) => c.status === 'fail').length,
    skip: cases.filter((c) => c.status === 'skip').length,
  }
}

/** Every project's test cases in a JUnit directory (`<dir>/<project>/JUnit.xml`). */
export function readJUnitDir(dir: string): Map<string, TestCase[]> {
  const projects = new Map<string, TestCase[]>()
  if (!existsSync(dir)) return projects
  for (const project of readdirSync(dir).sort()) {
    const file = path.join(dir, project, 'JUnit.xml')
    if (existsSync(file)) projects.set(project, parseJUnit(readFileSync(file, 'utf8')))
  }
  return projects
}

/** One project's row in the comparison. */
export interface ProjectComparison {
  readonly project: string
  readonly old: Counts | null
  readonly new: Counts | null
  readonly same: boolean
  /** Up to 20 test cases whose status differs, or that exist on one side only. */
  readonly changed: readonly string[]
}

const sameCounts = (a: Counts | null, b: Counts | null) =>
  a != null && b != null && a.pass === b.pass && a.fail === b.fail && a.skip === b.skip

/** Compares two runs project by project: pass, fail and skip counts must all match. */
export function compareRuns(
  oldRun: ReadonlyMap<string, readonly TestCase[]>,
  newRun: ReadonlyMap<string, readonly TestCase[]>,
): ProjectComparison[] {
  const projects = [...new Set([...oldRun.keys(), ...newRun.keys()])].sort()
  return projects.map((project) => {
    const before = oldRun.get(project)
    const after = newRun.get(project)
    const tally = (cases: readonly TestCase[] | undefined) => {
      const statuses = new Map<string, Status[]>()
      for (const c of cases ?? []) {
        const key = `${c.suite} › ${c.name}`
        statuses.set(key, [...(statuses.get(key) ?? []), c.status].sort())
      }
      return statuses
    }
    const oldStatuses = tally(before)
    const newStatuses = tally(after)
    const changed: string[] = []
    for (const key of [...new Set([...oldStatuses.keys(), ...newStatuses.keys()])].sort()) {
      const a = (oldStatuses.get(key) ?? []).join(',') || 'absent'
      const b = (newStatuses.get(key) ?? []).join(',') || 'absent'
      if (a !== b && changed.length < 20) changed.push(`${key}: ${a} → ${b}`)
    }
    const oldCounts = before == null ? null : count(before)
    const newCounts = after == null ? null : count(after)
    return {
      project,
      old: oldCounts,
      new: newCounts,
      same: sameCounts(oldCounts, newCounts),
      changed,
    }
  })
}

/** The comparison as a Markdown table, with the changed cases of each differing project below it. */
export function comparisonMarkdown(rows: readonly ProjectComparison[]): string[] {
  const show = (c: Counts | null) => (c == null ? 'missing' : `${c.pass} / ${c.fail} / ${c.skip}`)
  const lines = [
    '| Project | old pass / fail / skip | new pass / fail / skip | |',
    '| --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.project} | ${show(r.old)} | ${show(r.new)} | ${r.same ? 'same' : '**DIFFERS**'} |`,
    ),
  ]
  for (const row of rows.filter((r) => !r.same && r.changed.length > 0)) {
    lines.push('', `${row.project}:`, ...row.changed.map((change) => `- ${change}`))
  }
  return lines
}

/** A summary of one run, for the job's step summary. */
export function summaryMarkdown(run: ReadonlyMap<string, readonly TestCase[]>): string[] {
  return [
    '| Project | pass | fail | skip |',
    '| --- | --- | --- | --- |',
    ...[...run.entries()].map(([project, cases]) => {
      const c = count(cases)
      return `| ${project} | ${c.pass} | ${c.fail} | ${c.skip} |`
    }),
  ]
}
```

`tools/build-scripts/src/stdlib-test/httpbin.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The HTTP test helper (`tools/http-test-helper`, our own server with the Enso Cloud mocks;
 * no public httpbin image will do), started as `./run` started it (`build_tools/build/src/
 * httpbin.rs`): `sbt "http-test-helper/run localhost <free port>"`, ready once the port accepts a
 * connection (at most 180 s), and stopped with everything it started afterwards.
 */
import type { ChildProcess } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { killTree, spawnSbt } from '../lib/sbt.ts'

/** A free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, 'localhost', () => {
      const address = server.address()
      server.close(() => {
        if (address != null && typeof address === 'object') resolve(address.port)
        else reject(new Error('No port was assigned.'))
      })
    })
  })
}

/** Whether something accepts a connection on `localhost:<port>`. */
export function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: 'localhost', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Polls `ready` once a second until it is true, `gone` reports the server died, or `timeoutMs`
 * passes.
 */
export async function waitUntilReady(
  ready: () => Promise<boolean>,
  gone: () => boolean,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let waited = 0; ; waited += 1000) {
    if (gone()) throw new Error('The HTTP test helper exited before it accepted connections.')
    if (await ready()) return
    if (waited >= timeoutMs) {
      throw new Error(
        `The HTTP test helper did not accept connections within ${timeoutMs / 1000} s.`,
      )
    }
    await sleep(1000)
  }
}

/** A running HTTP test helper. */
export interface Httpbin {
  /** `ENSO_HTTP_TEST_HTTPBIN_URL`, with the trailing slash `./run`'s URL had. */
  readonly url: string
  readonly stop: () => void
}

/** Starts the HTTP test helper from the repository at `repoRoot` and waits until it is up. */
export async function startHttpbin(repoRoot: string, env: NodeJS.ProcessEnv): Promise<Httpbin> {
  const port = await freePort()
  const child: ChildProcess = spawnSbt(`http-test-helper/run localhost ${port}`, repoRoot, env)
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  const stop = () => killTree(child)
  try {
    await waitUntilReady(
      () => accepts(port),
      () => exited,
      180_000,
    )
  } catch (error) {
    stop()
    throw error
  }
  return { url: `http://localhost:${port}/`, stop }
}
```

`tools/build-scripts/src/stdlib-test/run.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `stdlib-test`: runs a standard-library test suite against a built engine package, as
 * `./run backend test <suite>` did (`build_tools/build/src/enso.rs` `run_tests`): each selected
 * `test/*_Tests` project in turn with `enso --no-ir-caches --run`, every one even after a failure,
 * then one `::error` naming the failures. The caller provides the engine package (the build job's
 * download), the small JDK for the JVM suite, and the databases (service containers in CI); the
 * runner starts the HTTP test helper itself.
 */
import path from 'node:path'
import { ensoBinary } from '../lib/engine.ts'
import type { Httpbin } from './httpbin.ts'
import {
  irCacheDirectory,
  missingServiceWarnings,
  projectArguments,
  runnerArguments,
  testEnvironment,
} from './invocation.ts'
import { readJUnitDir, summaryMarkdown } from './junit.ts'
import {
  discoverProjects,
  selectProjects,
  skipsForMissingAwsCredentials,
  suiteNamed,
} from './suites.ts'

/** The cloud credentials with which `./run` logged in to Enso Cloud (`cloud_tests/env.rs`). */
export const CLOUD_VARIABLES = [
  'ENSO_CLOUD_TEST_ACCOUNT_USERNAME',
  'ENSO_CLOUD_TEST_ACCOUNT_PASSWORD',
  'ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID',
  'ENSO_CLOUD_COGNITO_USER_POOL_ID',
  'ENSO_CLOUD_COGNITO_REGION',
] as const

/** What the caller asks for. */
export interface StdlibTestOptions {
  readonly suite: string
  /** Run only these of the suite's projects (a local convenience). */
  readonly only?: readonly string[]
  /** In GitHub Actions, delete the global IR cache and `bench-report.xml` files first. */
  readonly clean: boolean
  /** Print what would run, and run nothing. */
  readonly dryRun: boolean
}

/** What the runner needs from the outside world; tests fake all of it. */
export interface StdlibTestContext {
  readonly repoRoot: string
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
  readonly enginePackage: { readonly dir: string; readonly version: string }
  readonly exists: (file: string) => boolean
  readonly startHttpbin: () => Promise<Httpbin>
  /** Runs one project; returns its exit status. */
  readonly runProject: (
    file: string,
    args: readonly string[],
    env: Record<string, string>,
  ) => number
  readonly remove: (target: string) => void
  readonly benchReports: () => string[]
  readonly resetDir: (dir: string) => void
  readonly appendSummary: (lines: readonly string[]) => void
  readonly log: (line: string) => void
}

/** Runs the suite; returns the exit status for the process. */
export async function runStdlibTests(
  options: StdlibTestOptions,
  context: StdlibTestContext,
): Promise<number> {
  const { name, suite } = suiteNamed(options.suite)
  const env = context.env
  if (CLOUD_VARIABLES.every((variable) => (env[variable] ?? '') !== '')) {
    throw new Error(
      'Enso Cloud test credentials are set, but signing in to the cloud has not moved off `./run` ' +
        'yet (Phase 4): use `./run backend test` for the cloud suites.',
    )
  }
  if (skipsForMissingAwsCredentials(suite, env)) {
    context.log(
      'Skipping the AWS standard library tests: no AWS credentials found in the environment ' +
        '(ENSO_LIB_S3_AWS_ACCESS_KEY_ID / ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY).',
    )
    return 0
  }
  const testDir = path.join(context.repoRoot, 'test')
  const projects = selectProjects(discoverProjects(testDir), suite, options.only)
  if (projects.length === 0) throw new Error(`Suite ${name} selects no test project.`)
  const smallJdk = path.join(context.repoRoot, 'target', 'small-jdk')
  const runnerArgs = runnerArguments(suite, context.platform, smallJdk, env.GRAAL_EDITION)
  if (runnerArgs.includes(smallJdk) && !context.exists(smallJdk)) {
    throw new Error(
      `Suite ${name} runs on the small JDK, and ${smallJdk} does not exist. Build it with ` +
        `sbt "buildSmallJdkForRelease ${smallJdk}".`,
    )
  }
  const junitDir = path.resolve(
    (env.ENSO_TEST_JUNIT_DIR ?? '') !== '' ?
      (env.ENSO_TEST_JUNIT_DIR as string)
    : path.join(context.repoRoot, 'target', 'test-results'),
  )
  const enso = ensoBinary(context.enginePackage.dir, context.platform)
  context.log(`Suite ${name}: ${projects.join(', ')}`)
  for (const warning of missingServiceWarnings(projects, context.platform, env)) {
    context.log(`::warning::${warning}`)
  }
  if (options.dryRun) {
    for (const project of projects) {
      context.log(`${enso} ${projectArguments(runnerArgs, path.join(testDir, project)).join(' ')}`)
    }
    return 0
  }
  if (options.clean && env.GITHUB_ACTIONS === 'true') {
    context.remove(irCacheDirectory(context.platform, env, context.home))
    for (const report of context.benchReports()) context.remove(report)
  }
  context.resetDir(junitDir)
  const given = env.ENSO_HTTP_TEST_HTTPBIN_URL ?? ''
  const httpbin: Httpbin =
    given !== '' ? { url: given, stop: () => {} } : await context.startHttpbin()
  const failures: string[] = []
  try {
    const testEnv = testEnvironment({
      base: env,
      platform: context.platform,
      enginePackage: context.enginePackage.dir,
      nativeRunner: suite.nativeRunner,
      runnerArgs,
      junitDir,
      httpbinUrl: httpbin.url,
    })
    for (const project of projects) {
      const status = context.runProject(
        enso,
        projectArguments(runnerArgs, path.join(testDir, project)),
        testEnv,
      )
      if (status !== 0) failures.push(`${project}: the test run exited with status ${status}`)
    }
  } finally {
    httpbin.stop()
  }
  context.appendSummary(summaryMarkdown(readJUnitDir(junitDir)))
  if (failures.length > 0) {
    context.log(
      `::error title=Failed Standard Library Tests::${failures.length} test suite(s) failed: ${failures.join(';%0A')}`,
    )
    return 1
  }
  return 0
}
```

`tools/build-scripts/src/commands/stdlib-test.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `stdlib-test <suite> [--only A_Tests,B_Tests] [--no-clean] [--dry-run]`: runs a
 * standard-library test suite against the engine package in `built-distribution/` (with
 * `ENSO_VERSION`, that version's). For the databases, export `ENSO_POSTGRES_*` and
 * `ENSO_SQLSERVER_*` (CI's service containers do); without them those groups are skipped.
 *
 *     corepack pnpm --filter build-scripts run stdlib-test -- standard-library-in-native
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { findEnginePackage } from '../lib/engine.ts'
import { commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { startHttpbin } from '../stdlib-test/httpbin.ts'
import { runStdlibTests } from '../stdlib-test/run.ts'

/** Every `bench-report.xml` under `dir`, skipping dependencies and VCS data. */
function benchReports(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') found.push(...benchReports(full))
    } else if (entry.name === 'bench-report.xml') {
      found.push(full)
    }
  }
  return found
}

try {
  const { values, positionals } = parseArgs({
    args: commandArguments(),
    allowPositionals: true,
    options: {
      only: { type: 'string' },
      'no-clean': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const [suite] = positionals
  if (suite == null || positionals.length !== 1) {
    throw new Error('Usage: stdlib-test <suite> [--only A_Tests,B_Tests] [--no-clean] [--dry-run]')
  }
  const summaryFile = process.env.GITHUB_STEP_SUMMARY ?? ''
  process.exitCode = await runStdlibTests(
    {
      suite,
      ...(values.only != null ? { only: values.only.split(',') } : {}),
      clean: !values['no-clean'],
      dryRun: values['dry-run'],
    },
    {
      repoRoot: REPO_ROOT,
      platform: process.platform,
      env: process.env,
      home: homedir(),
      enginePackage: findEnginePackage(REPO_ROOT, process.env.ENSO_VERSION),
      exists: existsSync,
      startHttpbin: () => startHttpbin(REPO_ROOT, process.env),
      runProject: (file, args, env) => runInherited(file, args, { env }),
      remove: (target) => rmSync(target, { recursive: true, force: true }),
      benchReports: () => benchReports(REPO_ROOT),
      resetDir: (dir) => {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
      },
      appendSummary: (lines) => {
        if (summaryFile !== '') appendFileSync(summaryFile, `${lines.join('\n')}\n`)
      },
      log: (line) => console.log(line),
    },
  )
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
```

`tools/build-scripts/src/commands/junit-compare.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `junit-compare <old dir> <new dir> [--allow Project]...`: the side-by-side check for moving
 * the standard-library tests off `./run`. Both directories hold `<project>/JUnit.xml`. It prints a
 * Markdown table, and exits 1 when a project is missing on one side or its pass, fail or skip
 * count differs, unless the project is `--allow`ed (a documented flake).
 *
 *     corepack pnpm --silent --filter build-scripts run junit-compare -- old/ new/
 */
import { parseArgs } from 'node:util'
import { commandArguments } from '../lib/repo.ts'
import { compareRuns, comparisonMarkdown, readJUnitDir } from '../stdlib-test/junit.ts'

try {
  const { values, positionals } = parseArgs({
    args: commandArguments(),
    allowPositionals: true,
    options: { allow: { type: 'string', multiple: true, default: [] } },
  })
  const [oldDir, newDir] = positionals
  if (oldDir == null || newDir == null || positionals.length !== 2) {
    throw new Error('Usage: junit-compare <old dir> <new dir> [--allow Project]...')
  }
  const rows = compareRuns(readJUnitDir(oldDir), readJUnitDir(newDir))
  if (rows.length === 0) throw new Error(`No JUnit.xml under ${oldDir} or ${newDir}.`)
  for (const line of comparisonMarkdown(rows)) console.log(line)
  const failing = rows.filter((row) => !row.same && !values.allow.includes(row.project))
  if (failing.length > 0) {
    console.log(
      `\n${failing.length} project(s) differ: ${failing.map((r) => r.project).join(', ')}`,
    )
    process.exitCode = 1
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
```

In `tools/build-scripts/package.json`, after the `"ide-build"` script, add:

<!-- prettier-ignore -->
```json
    "stdlib-test": "node src/commands/stdlib-test.ts",
    "junit-compare": "node src/commands/junit-compare.ts",
```

In `tools/build-scripts/CLAUDE.md`, under `## Commands`, after the `ide-build`
bullet, add:

<!-- prettier-ignore -->
```markdown
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
```

- [ ] **Step 3: Run every check, the policy, and the CLI**

```bash
cd /c/Repos/Enso/ide-bs-3j/tools/build-scripts
corepack pnpm exec prettier --write . > /dev/null
corepack pnpm run test:unit 2>&1 | grep -E "Tests |FAIL"
corepack pnpm run typecheck && corepack pnpm run lint && echo checks-ok
cd ../.. && node tools/ci/check-workflows.mjs
node -e 'import("./tools/ci/check-workflows.mjs").then((m) => console.log([...m.buildScriptsSbtCommands(m.loadRepo(".").buildScripts)]))'
mkdir -p built-distribution/enso-engine-0.0.0-dev-windows-amd64/enso-0.0.0-dev target/small-jdk
corepack pnpm --silent --filter build-scripts run stdlib-test -- standard-library --dry-run | head -3
rm -r built-distribution target/small-jdk
```

Expected:

- `Tests  117 passed (117)`; `checks-ok`;
- `Workflow policy: OK`, and `[ 'stdlib-test' ]`: the policy now treats the
  runner as an sbt call (it imports `src/lib/sbt.ts` through `httpbin.ts`);
- the dry run lists `Suite standard-library:` with 15 projects (all but
  `AWS_Tests` and `Microsoft_Tests`), then
  `…\enso-0.0.0-dev\bin\enso.exe --jvm …\target\small-jdk --no-ir-caches --run …\test\Base_Internal_Tests --disable-private-check`.

The HTTP test helper was proven on Windows while writing this plan: the runner
started `sbt "http-test-helper/run localhost <port>"` through `cmd`, saw
`Server started.`, and left no `java` process behind after `killTree`.

- [ ] **Step 4: GraalPy in `setup-jvm`**

Replace `.github/actions/setup-jvm/action.yml` with (the changes: the
description, the `graalpy` input, `pin graalpy`, the "Set up GraalPy" step, and
the GraalPy lines of "Check the toolchain"):

<!-- prettier-ignore -->
```yaml
name: Set up the JVM toolchain
description: >-
  GraalVM CE and the sbt launcher at the versions pinned under `toolchain:` in `build-config.yaml`,
  `flatc` and the standalone GraalPy too when asked, and the sbt / Coursier download cache (saved
  only on `develop`). What `./run` provisioned before an sbt call, minus the MSVC environment
  (`setup-msvc`). Expects the repository to be checked out.
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
  graalpy:
    description: >-
      Also put the standalone GraalPy on the PATH: `test/Examples_Tests`' Python spec runs it, and
      is skipped without it.
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
        pin graalpy
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
    # The release asset `ide_ci::cache::goodie::graalpy` downloaded; it unpacks to one directory
    # of the same name.
    - if: inputs.graalpy == 'true'
      name: Set up GraalPy
      shell: bash
      env:
        GRAALPY_VERSION: ${{ steps.pins.outputs.graalpy }}
      run: |-
        case "$RUNNER_OS" in
          Linux) os=linux; ext=tar.gz ;;
          Windows) os=windows; ext=zip ;;
          macOS) os=macos; ext=tar.gz ;;
        esac
        case "$RUNNER_ARCH" in
          X64) arch=amd64 ;;
          ARM64) arch=aarch64 ;;
        esac
        name="graalpy-community-$GRAALPY_VERSION-$os-$arch"
        dir=$RUNNER_TEMP
        if [ "$RUNNER_OS" = "Windows" ]; then dir=$(cygpath -u "$RUNNER_TEMP"); fi
        curl --retry 4 --retry-connrefused -fsSL -o "$dir/graalpy.$ext" \
          "https://github.com/oracle/graalpython/releases/download/graal-$GRAALPY_VERSION/$name.$ext"
        if [ "$ext" = "tar.gz" ]; then
          tar -xzf "$dir/graalpy.$ext" -C "$dir"
        elif command -v unzip > /dev/null; then
          unzip -o -q "$dir/graalpy.zip" -d "$dir"
        else
          # A native program: it takes the Windows path.
          7z x -y -o"$RUNNER_TEMP" "$RUNNER_TEMP/graalpy.zip" > /dev/null
        fi
        rm "$dir/graalpy.$ext"
        echo "$RUNNER_TEMP/$name/bin" >> "$GITHUB_PATH"
    - name: Check the toolchain
      shell: bash
      env:
        GRAALVM_VERSION: ${{ steps.pins.outputs.graalvm }}
        FLATC_VERSION: ${{ steps.pins.outputs.flatc }}
        GRAALPY_VERSION: ${{ steps.pins.outputs.graalpy }}
        WITH_FLATC: ${{ inputs.flatc }}
        WITH_GRAALPY: ${{ inputs.graalpy }}
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
        if [ "$WITH_GRAALPY" = "true" ]; then
          graalpy=$(graalpy --version)
          echo "$graalpy"
          grep -qF "$GRAALPY_VERSION" <<< "$graalpy"
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

The archives exist for 25.0.1 (`graalpy-community-25.0.1-linux-amd64.tar.gz`,
124 MB; `…-windows-amd64.zip`, 122 MB) and unpack to one directory of that name
with `bin/graalpy` inside (checked while writing this plan). Check the scripts
with shellcheck, as Phase 2 did (actionlint does not look inside composite
actions):

```bash
cd /c/Repos/Enso/ide-bs-3j
cat > tools/ci/sc-extract.tmp.mjs <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
const action = parse(readFileSync(process.argv[2], 'utf8'))
action.runs.steps.forEach((step, i) => {
  if (step.run && step.shell === 'bash') {
    writeFileSync(`sc${i}.sh`, `#!/bin/bash\nset -eo pipefail\n${step.run.replace(/\$\{\{[^}]*\}\}/g, 'X')}\n`)
  }
})
EOF
node tools/ci/sc-extract.tmp.mjs .github/actions/setup-jvm/action.yml && rm tools/ci/sc-extract.tmp.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3j && for f in sc*.sh; do ~/tools/shellcheck-v0.11.0/shellcheck "$f" && echo "$f ok"; done; rm -f sc*.sh'
node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)"
```

Expected: `sc0.sh ok` … `sc5.sh ok` (six bash steps), and `ℹ fail 0` (the
awk-equivalence test still finds the awk program).

- [ ] **Step 5: Commit**

```bash
git add tools/build-scripts .github/actions/setup-jvm/action.yml
git commit -m "stdlib-test and junit-compare in tools/build-scripts; setup-jvm can install GraalPy"
```

---

### Task 15: The standard-library tests without `./run`, the side-by-side, and PR 3j

**Files:**

- Modify: `.github/workflows/engine-checks.yml` (the matrix)
- Modify: `.github/workflows/engine-checks-platform.yml` (whole file)
- Modify: `.github/CLAUDE.md` (the section's introduction and one row),
  `CLAUDE.md` (the CI paragraph), `build_tools/CLAUDE.md` (the CI paragraph)

**Interfaces:**

- Consumes: `stdlib-test`, `junit-compare`, `setup-jvm`'s `graalpy` (Task 14),
  `setup-build-scripts` (Task 7).
- Keeps: every job display name ("Standard Library <title> Tests (GraalVM CE)
  (<os>, amd64)"), the reporter name and `fail-on-empty` rule, the heap-dump
  artifacts.

- [ ] **Step 1: The matrix**

In `.github/workflows/engine-checks.yml`, replace the Linux entry's
`stdlib-suites` value with:

<!-- prettier-ignore -->
```yaml
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false, "postgres": true, "mssql": false},
              {"suite": "standard-library", "title": "JVM", "small-jdk": true, "postgres": true, "mssql": false},
              {"suite": "std-aws", "title": "AWS", "small-jdk": false, "postgres": false, "mssql": false},
              {"suite": "std-microsoft", "title": "Microsoft", "small-jdk": false, "postgres": false, "mssql": true}]
```

and the Windows entry's with:

<!-- prettier-ignore -->
```yaml
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false},
              {"suite": "standard-library", "title": "JVM", "small-jdk": true},
              {"suite": "std-aws", "title": "AWS", "small-jdk": false}]
```

The databases follow `./run`'s rule: Postgres on Linux when the suite runs
`Table_Tests`, SQL Server on Linux when it runs `Microsoft_Tests`.

- [ ] **Step 2: The final `engine-checks-platform.yml`**

Check that only the standard-library jobs still use `./run`:

```bash
grep -nE '^\s*(- )?run: .*\./run( |$)' .github/workflows/engine-checks-platform.yml
grep -nE 'uses: \./\.github/actions/(setup-)?build-script$|ENSO_BUILD_SKIP|needs: \[build-script' .github/workflows/engine-checks-platform.yml
```

Expected: the first grep prints one line,
`run: ./run backend test ${{ matrix.suite }}`; the second prints four: the
workflow `env`'s `ENSO_BUILD_SKIP_VERSION_CHECK`, the `build-script` job's
`uses: ./.github/actions/build-script`, and the `stdlib-tests` job's
`needs: [build-script, …]` and `uses: ./.github/actions/setup-build-script`.
(`setup-build-scripts`, with an `s`, does not match: the pattern ends at `$`.)
Then replace the whole file with:

<!-- prettier-ignore -->
```yaml
# Hand-written. One platform's engine checks: the engine distribution, then the tests and checks
# that use it. `engine-checks.yml` calls it once per platform. It has no `concurrency:` of its own:
# the platforms' calls would share the group and cancel each other.

name: Engine Checks (platform)
on:
  workflow_call:
    inputs:
      os:
        description: "`linux` or `windows`: names the jobs and artifacts; `linux` adds the Linux-only checks."
        required: true
        type: string
      runner:
        description: The runner label for every job.
        required: true
        type: string
      stdlib-suites:
        description: >-
          JSON list of the Standard Library test suites to run, each `{"suite": "<stdlib-test
          suite>", "title": "<job title>", "small-jdk": <bool>, "postgres": <bool>, "mssql":
          <bool>}`: the JVM suite needs the small JDK; `postgres` and `mssql` (Linux only) start that
          database for the suite.
        required: true
        type: string
      clean_build_required:
        description: Clean before and after each job.
        required: false
        type: boolean
        default: false

env:
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ contains(github.event.pull_request.labels.*.name, 'CI: Clean build required') || github.ref == 'refs/heads/develop' || inputs.clean_build_required }}"

jobs:
  # Note [Engine Distribution Without ./run]
  # ========================================
  # `./run backend ci-build-engine-distribution` is the sbt task `ciBuildEngineDistribution` (Note
  # [CI Engine Distribution Build] in build.sbt), called as `./run` called sbt: `LC_ALL=C.UTF-8
  # SBT_SERVER_FORCESTART=true sbt -Dbench.compileOnly=false -Dsbt.server.autostart=false "clean;
  # all ciBuildEngineDistribution"` (`all` because a hosted runner has more memory than `./run`'s
  # single-batch threshold). The version comes from `tools/build-scripts` (`version`); its step
  # keeps `id: build`, so the job's outputs are what they were, and it exports the version to the
  # later steps, which is how sbt names the package. `ENSO_LAUNCHER` stays `native,test`, the value
  # `./run` forced. `setup-msvc` replaces `./run`'s MSVC environment on Windows: the native images
  # link with it, and the runtime DLL copy reads `VCToolsRedistDir`. Gone, because only `./run`
  # read them or nothing did: GraalPy, `GRAAL_EDITION`, `GITHUB_TOKEN` and the `GITHUB_ENV` copy
  # of `ENSO_TEST_JUNIT_DIR`.
  build-engine-distribution:
    name: Build Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LAUNCHER: native,test
    # The distribution's version, for the jobs that use it. See Note [Lint Reads The Distribution's
    # Version].
    outputs:
      ENSO_VERSION: ${{ steps.build.outputs.ENSO_VERSION }}
      ENSO_EDITION: ${{ steps.build.outputs.ENSO_EDITION }}
      ENSO_RELEASE_MODE: ${{ steps.build.outputs.ENSO_RELEASE_MODE }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: build-engine-distribution
          flatc: "true"
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - id: build
        name: Compute the version
        run: corepack pnpm --filter build-scripts run version
      - name: Build the engine distribution
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "clean; all ciBuildEngineDistribution"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Archive Engine Distribution
        run: tar -cvf built-distribution.tar built-distribution test
      - name: Upload Engine Distribution
        uses: actions/upload-artifact@v5
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
          path: built-distribution.tar
      - name: Cleanup Archive
        run: rm built-distribution.tar
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # Note [Lint Reads The Distribution's Version]
  # =============================================
  # `lintEnso` lints the distribution at `engineDistributionRoot`, which sbt names from
  # `ENSO_VERSION` (`built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`), and
  # sbt's default is 0.0.0-dev. On CI `lintEnso` still evaluates `buildEngineDistributionNoIndex.value`
  # (build.sbt), so the lint job rebuilds the package at that same versioned path and lints that;
  # the downloaded distribution is not what it lints today. The build job computed the version
  # (`<next stable>-dev`) and published it as its outputs, so the lint step takes it from there
  # rather than computing its own, which keeps the path identical to the build job's and stays
  # correct once the lint really uses the download. Otherwise the step runs what
  # `./run libraries lint` ran once it had provisioned GraalVM and sbt: `sbt
  # -Dbench.compileOnly=false -Dsbt.server.autostart=false "all lintEnso"`, with `LC_ALL=C.UTF-8`
  # and `SBT_SERVER_FORCESTART=true` (`all` because a hosted runner has more memory than
  # `./run`'s single-batch threshold; for one task it changes nothing). The rebuild compiles the
  # language server, so the job needs flatc. Nothing in sbt or the engine reads `GITHUB_TOKEN`, so
  # the step does not pass it. The syntax check (`checkEnsoSyntax`, which replaced
  # `./run libraries check-syntax`) runs the Rust parser's `check_syntax` through cargo.
  enso-code-lint:
    name: Enso Code Lint (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LINT_ENABLE_GITHUB_ANNOTATIONS: "true"
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: enso-code-lint
          flatc: "true"
      - name: Check syntax
        run: sbt "-Dsbt.server.autostart=false" checkEnsoSyntax
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
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
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "all lintEnso"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # Note [JVM Tests Without ./run]
  # ==============================
  # The steps are what `./run backend test jvm` ran (`build_tools/build/src/engine/context.rs`), in
  # its order, each sbt call as `./run` made it (`LC_ALL=C.UTF-8 SBT_SERVER_FORCESTART=true sbt
  # -Dbench.compileOnly=<…> -Dsbt.server.autostart=false "<tasks>"`), at the build job's version,
  # from which sbt names the downloaded distribution. Its traps, kept on purpose:
  # - `ENSO_TEST_JUNIT_DIR` is set on the `sbt test` step only. `./run` removed it for the
  #   benchmark step, and an empty value is not "unset": ScalaTest would get `-u ""`.
  # - `CI_TEST_TIMEFACTOR=2` and `CI_TEST_FLAKY_ENABLE=true` are written to `GITHUB_ENV` on Windows
  #   only, so that on Linux they are absent rather than empty: an empty time factor breaks the
  #   language server's test configuration, and `FlakySpec` only asks whether the variable exists.
  # - A failing `sbt test` does not stop the parser self-tests or the benchmark step: `./run`
  #   deferred that failure. A failure of any other step stops the job, as it stopped `./run`.
  # - Two things `./run` appeared to do never took effect, and are not added: the Enso benchmark
  #   dry run (it only runs with Enso benchmarks; `test jvm` asked for the runtime ones) and the
  #   heap-dump `JAVA_TOOL_OPTIONS` (`./run` passed them to the standard-library tests only).
  jvm-tests:
    name: JVM Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: jvm-tests
          flatc: "true"
      # `sbt test` builds native images on Windows too (the launcher's and os-environment's tests).
      - name: Set up MSVC
        uses: ./.github/actions/setup-msvc
      - if: runner.os == 'Windows'
        name: Windows test settings
        shell: pwsh
        run: |-
          "CI_TEST_TIMEFACTOR=2" >> $env:GITHUB_ENV
          "CI_TEST_FLAKY_ENABLE=true" >> $env:GITHUB_ENV
      - name: Install the library server's dependencies
        working-directory: tools/simple-library-server
        run: corepack pnpm install
      - name: Resolve the parser's Java class path
        run: sbt "-Dsbt.server.autostart=false" "syntax-rust-definition/Runtime/managedClasspath"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Generate the parser's Java sources
        shell: bash
        run: |-
          # `./run` reset the JUnit directory before the tests; stale reports would be published.
          rm -rf target/test-results
          rm -rf target/generated-java/org/enso/syntax2
          mkdir -p target/generated-java/org/enso/syntax2
          cargo run --package enso-parser-generate-java --bin enso-parser-generate-java -- target/generated-java/org/enso/syntax2
      - if: runner.os == 'Linux'
        name: Build the ydoc native image
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "all ydoc-server/buildNativeImage"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - id: tests
        name: JVM tests
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "set Global / parallelExecution := false; test"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          ENSO_TEST_JUNIT_DIR: ${{ github.workspace }}/target/test-results
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - id: parser-self-tests
        if: ${{ !cancelled() && steps.tests.outcome != 'skipped' }}
        name: Parser self-tests
        shell: bash
        env:
          # Git Bash would otherwise rewrite the `;`-separated class path on Windows.
          MSYS_NO_PATHCONV: "1"
        run: |-
          gen=target/generated-java
          pkg=$gen/org/enso/syntax2
          cargo run --package enso-parser-generate-java --bin java-tests > "$pkg/GeneratedFormatTests.java"
          sep=:
          if [ "$RUNNER_OS" = "Windows" ]; then sep=';'; fi
          deps=$(tr -d '\r\n' < lib/rust/parser/target/streams/runtime/managedClasspath/_global/streams/export)
          javac --class-path "lib/rust/parser/generate-java/java$sep$gen$sep$deps" -d "$gen" "$pkg/GeneratedFormatTests.java"
          java --class-path "$gen" org.enso.syntax2.GeneratedFormatTests
      - if: ${{ runner.os == 'Linux' && !cancelled() && steps.parser-self-tests.outcome == 'success' }}
        name: Compile the benchmarks, and run the runtime ones once
        run: sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "all runtime-benchmarks/compile language-server/Benchmark/compile searcher/Benchmark/compile std-benchmarks/compile; runtime-benchmarks/bench"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Upload Heap Dumps
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: Heap dumps (JVM Tests, ${{ inputs.os }}, amd64)
          path: |-
            test/**/*.hprof
            engine/**/*.hprof
          retention-days: 3
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Engine Test Reporter
        uses: dorny/test-reporter@v1
        with:
          max-annotations: 50
          name: Engine Tests Report (GraalVM CE, ${{ inputs.os }}, amd64)
          path: target/test-results/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # `tools/build-scripts`' `stdlib-api-check` runs what `./run backend stdlib-api-check` ran, against
  # the downloaded distribution at the build job's version.
  standard-library-api-check:
    name: Standard Library API check (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Check the Standard Library API
        run: corepack pnpm --filter build-scripts run stdlib-api-check
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # Note [Standard Library Tests Without ./run]
  # ===========================================
  # `tools/build-scripts`' `stdlib-test` runs a suite as `./run backend test <suite>` did (see its
  # `src/stdlib-test/run.ts`), and starts the HTTP test helper itself, with sbt (hence `setup-jvm`).
  # What moved out of `./run` into this file:
  # - Postgres and SQL Server are service containers, on Linux only as before (Windows runners have
  #   none, so Windows is a job of its own, under the same name). A suite gets a database when its
  #   matrix entry asks (`postgres`, `mssql`); an empty image starts no container, and the runner
  #   drops the connection variables that are empty, since Enso reads an empty variable as "".
  #   Images: `postgres:18` (`./run` took `latest`, 18.6 when this moved) and SQL Server
  #   `2022-latest`, as before. Postgres must be on localhost:5432: `Generic_JDBC_Tests` connects
  #   to `jdbc:postgresql:<db>`.
  # - The JVM suite's small JDK has its own step (`small-jdk`), at `target/small-jdk` as before.
  # - GraalPy comes from `setup-jvm` (`graalpy`), for `Examples_Tests`' Python spec.
  # - `ENSO_TEST_JUNIT_DIR` is set here; `./run` wrote it to `GITHUB_ENV` for the reporter.
  # The engine package is the build job's, at the build job's version.
  stdlib-tests:
    name: Standard Library ${{ matrix.title }} Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    env:
      GRAAL_EDITION: GraalVM CE
      ENSO_TEST_JUNIT_DIR: ${{ github.workspace }}/target/test-results
    strategy:
      # Each suite reports on its own, as when they were separate jobs.
      fail-fast: false
      matrix:
        include: ${{ fromJSON(inputs.stdlib-suites) }}
    services:
      postgres:
        image: ${{ matrix.postgres && 'postgres:18' || '' }}
        env:
          POSTGRES_DB: enso_test_db
          POSTGRES_USER: enso_test_user
          POSTGRES_PASSWORD: enso_test_password
        ports:
          - 5432:5432
        options: >-
          --shm-size 1gb
          --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U enso_test_user -d enso_test_db"
          --health-interval 5s --health-timeout 5s --health-retries 30
      sqlserver:
        image: ${{ matrix.mssql && 'mcr.microsoft.com/mssql/server:2022-latest' || '' }}
        env:
          ACCEPT_EULA: "Y"
          MSSQL_SA_PASSWORD: "enso_test_password_<YourStrong@Passw0rd>"
        ports:
          - 1433:1433
        options: --shm-size 1gb
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: stdlib-tests
          graalpy: "true"
      - if: matrix.small-jdk
        name: Build the small JDK
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "buildSmallJdkForRelease ${{ github.workspace }}/target/small-jdk"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      # The line `./run` waited for (`sqlserver.rs`).
      - if: matrix.mssql
        name: Wait for SQL Server
        run: |-
          for _ in $(seq 150); do
            # Captured first: `grep -q` stops reading early, which `pipefail` would report.
            logs=$(docker logs "$ID" 2>&1)
            if grep -qF "SQL Server is now ready for client connections" <<< "$logs"; then exit 0; fi
            sleep 2
          done
          echo "::error::SQL Server did not start within 300 s."
          docker logs "$ID"
          exit 1
        env:
          ID: ${{ job.services.sqlserver.id }}
      - name: Run the Standard Library tests
        run: corepack pnpm --filter build-scripts run stdlib-test ${{ matrix.suite }}
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          ENSO_LIB_S3_AWS_ACCESS_KEY_ID: ${{ secrets.ENSO_LIB_S3_AWS_ACCESS_KEY_ID }}
          ENSO_LIB_S3_AWS_REGION: ${{ secrets.ENSO_LIB_S3_AWS_REGION }}
          ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: ${{ secrets.ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY }}
          ENSO_POSTGRES_DATABASE: ${{ matrix.postgres && 'enso_test_db' || '' }}
          ENSO_POSTGRES_HOST: ${{ matrix.postgres && 'localhost:5432' || '' }}
          ENSO_POSTGRES_USER: ${{ matrix.postgres && 'enso_test_user' || '' }}
          ENSO_POSTGRES_PASSWORD: ${{ matrix.postgres && 'enso_test_password' || '' }}
          ENSO_SQLSERVER_DATABASE: ${{ matrix.mssql && 'tempdb' || '' }}
          ENSO_SQLSERVER_HOST: ${{ matrix.mssql && 'localhost' || '' }}
          ENSO_SQLSERVER_PORT: ${{ matrix.mssql && '1433' || '' }}
          ENSO_SQLSERVER_USER: ${{ matrix.mssql && 'sa' || '' }}
          ENSO_SQLSERVER_PASSWORD: ${{ matrix.mssql && 'enso_test_password_<YourStrong@Passw0rd>' || '' }}
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Standard Library Test Reporter
        uses: dorny/test-reporter@v1
        with:
          # Only the AWS suite may report no tests, as before.
          fail-on-empty: ${{ matrix.suite != 'std-aws' }}
          max-annotations: 50
          name: Standard Library Tests Report (GraalVM CE, ${{ inputs.os }}, amd64)
          path: ${{ env.ENSO_TEST_JUNIT_DIR }}/*/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Upload Heap Dumps
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: Heap dumps (Standard Library ${{ matrix.title }} Tests, ${{ inputs.os }}, amd64)
          path: |-
            test/**/*.hprof
            engine/**/*.hprof
          retention-days: 3
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # The same as `stdlib-tests`, without the databases: Windows runners have no service containers.
  stdlib-tests-windows:
    name: Standard Library ${{ matrix.title }} Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    if: inputs.os == 'windows'
    needs: [build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    env:
      GRAAL_EDITION: GraalVM CE
      ENSO_TEST_JUNIT_DIR: ${{ github.workspace }}/target/test-results
    strategy:
      # Each suite reports on its own, as when they were separate jobs.
      fail-fast: false
      matrix:
        include: ${{ fromJSON(inputs.stdlib-suites) }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: stdlib-tests
          graalpy: "true"
      - if: matrix.small-jdk
        name: Build the small JDK
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "buildSmallJdkForRelease ${{ github.workspace }}/target/small-jdk"
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Run the Standard Library tests
        run: corepack pnpm --filter build-scripts run stdlib-test ${{ matrix.suite }}
        env:
          ENSO_VERSION: ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
          ENSO_LIB_S3_AWS_ACCESS_KEY_ID: ${{ secrets.ENSO_LIB_S3_AWS_ACCESS_KEY_ID }}
          ENSO_LIB_S3_AWS_REGION: ${{ secrets.ENSO_LIB_S3_AWS_REGION }}
          ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: ${{ secrets.ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY }}
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Standard Library Test Reporter
        uses: dorny/test-reporter@v1
        with:
          # Only the AWS suite may report no tests, as before.
          fail-on-empty: ${{ matrix.suite != 'std-aws' }}
          max-annotations: 50
          name: Standard Library Tests Report (GraalVM CE, ${{ inputs.os }}, amd64)
          path: ${{ env.ENSO_TEST_JUNIT_DIR }}/*/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - if: (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Upload Heap Dumps
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: Heap dumps (Standard Library ${{ matrix.title }} Tests, ${{ inputs.os }}, amd64)
          path: |-
            test/**/*.hprof
            engine/**/*.hprof
          retention-days: 3
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

`git diff origin/develop -- .github/workflows/engine-checks-platform.yml` must
show only: the `stdlib-suites` input description, the workflow `env` (skip flag
gone), the `build-script` job gone, and the standard-library jobs. Every other
job is byte-identical to develop's (the earlier PRs put it there).

Commit this as the final state:

```bash
corepack pnpm exec prettier --write .github
node tools/ci/check-workflows.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3j && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-3j .github/workflows/engine-checks.yml > "$SCRATCH/compare-3j.md"
git add .github/workflows/engine-checks.yml .github/workflows/engine-checks-platform.yml
git commit -m "Standard Library tests: tools/build-scripts' stdlib-test, Linux service containers, no ./run"
```

Expected: `Workflow policy: OK`, `actionlint-ok`; `compare-3j.md` shows D10
only.

- [ ] **Step 3: Add the temporary side-by-side, as a commit of its own**

`./run` runs beside the new runner in this PR only, uploading both sides' JUnit
reports. Make these four edits to `engine-checks-platform.yml`:

1. In the workflow `env`, before `  # Read by \`.github/actions/git-clean\`.`,
   add:

<!-- prettier-ignore -->
```yaml
  # TEMPORARY (PR 3j's side-by-side): `./run` in `stdlib-tests-old` reads it.
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
```

2. Right after `jobs:`, add:

<!-- prettier-ignore -->
```yaml
  # TEMPORARY (PR 3j's side-by-side): compiles `./run` for `stdlib-tests-old`.
  build-script:
    name: Build Script (${{ inputs.os }}, amd64)
    runs-on: ${{ inputs.runner }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Compile the build script
        uses: ./.github/actions/build-script
```

3. In **both** `stdlib-tests` and `stdlib-tests-windows`, after the "Upload Heap
   Dumps" step (after its `retention-days: 3` line), add:

<!-- prettier-ignore -->
```yaml
      # TEMPORARY (PR 3j's side-by-side): the reports, for `junit-compare`.
      - if: success() || failure()
        name: Upload JUnit results
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: JUnit new (${{ matrix.suite }}, ${{ inputs.os }})
          overwrite: true
          path: target/test-results
          retention-days: 3
```

4. At the end of the file, add:

<!-- prettier-ignore -->
```yaml

  # TEMPORARY (PR 3j's side-by-side): the same suites through `./run`, as on develop, with their
  # JUnit reports uploaded for `junit-compare`.
  stdlib-tests-old:
    name: Standard Library ${{ matrix.title }} Tests (GraalVM CE) (${{ inputs.os }}, amd64) (old ./run)
    needs: [build-script, build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    env:
      GRAAL_EDITION: GraalVM CE
    strategy:
      fail-fast: false
      matrix:
        include: ${{ fromJSON(inputs.stdlib-suites) }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - run: ./run backend test ${{ matrix.suite }}
        env:
          ENSO_LIB_S3_AWS_ACCESS_KEY_ID: ${{ secrets.ENSO_LIB_S3_AWS_ACCESS_KEY_ID }}
          ENSO_LIB_S3_AWS_REGION: ${{ secrets.ENSO_LIB_S3_AWS_REGION }}
          ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: ${{ secrets.ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: success() || failure()
        name: Upload JUnit results
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: JUnit old (${{ matrix.suite }}, ${{ inputs.os }})
          overwrite: true
          path: target/test-results
          retention-days: 3
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

Then:

```bash
corepack pnpm exec prettier --write .github/workflows/engine-checks-platform.yml
node tools/ci/check-workflows.mjs
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-3j && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
git add .github/workflows/engine-checks-platform.yml
git commit -m "TEMPORARY: run the Standard Library suites through ./run too, for the side-by-side"
git rev-parse HEAD > "$SCRATCH/3j-temporary-sha"
git push -u origin ci/stdlib-test
```

Expected: `Workflow policy: OK`, `actionlint-ok` (both were checked on this
exact text while writing the plan).

Write `$SCRATCH/pr-3j.md`: R9, R10 and the spec corrections (the runner starts
the HTTP test helper; Linux-only databases; no library server; no
`ENSO_LAUNCHER`; empty variables dropped); that the PR merges only after the
side-by-side; D10; `compare-3j.md`; a "Side-by-side" section that Step 4 fills
in; "Part of #289's Phase 3."; the attribution lines.

```bash
gh pr create --base develop --head ci/stdlib-test --label "CI: No changelog needed" \
  --title "Build simplification, PR 3j: the Standard Library tests without ./run" \
  --body-file "$SCRATCH/pr-3j.md"
gh workflow run engine-checks.yml --ref ci/stdlib-test
```

The dispatch is the second sample (CLAUDE.md: a single run is not evidence).

- [ ] **Step 4: The side-by-side (spec verification; must-carry 1)**

Run `"$SCRATCH/wait-pr.sh" <N> 360` in the background. First look at the new
jobs' wiring in the PR run:

```bash
pr=$(gh run list --workflow engine-pull-request.yml --branch ci/stdlib-test -L 1 --json databaseId --jq '.[0].databaseId')
gh run view "$pr" --json jobs --jq '.jobs[] | select(.name | test("Standard Library")) | "\(.conclusion)\t\(.name)"'
gh run view "$pr" --log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Starting postgres service|Starting sqlserver service|Suite [a-z-]+:|::warning::|GraalPy [0-9]|Server started|Skipping the AWS" | sed 's/^.*\t//' | sort | uniq -c
```

Expected:

- 16 Standard Library entries: 14 completed and green (7 new, 7 "(old ./run)"),
  and 2 skipped — `stdlib-tests-windows` in the Linux call and `stdlib-tests` in
  the Windows call, unexpanded because their `if:` is false;
- Postgres started for the Linux Native and JVM jobs only, SQL Server for
  Microsoft only (the empty `image` started nothing elsewhere — see Ruling
  R-plan-7 for the fallback if GitHub rejects an empty image);
- no `::warning::` about a missing database;
- `GraalPy 3.12.8 (GraalVM CE Native 25.0.1)` in every new job's set-up;
- `Server started.` (the HTTP test helper) in every new job except AWS, and
  `Skipping the AWS standard library tests` in both AWS jobs, old and new.

Then compare each suite, Linux and Windows, for both runs (the PR run and the
dispatch):

```bash
disp=$(gh run list --workflow engine-checks.yml --branch ci/stdlib-test --event workflow_dispatch -L 1 --json databaseId --jq '.[0].databaseId')
for run in $pr $disp; do
  for pair in "standard-library-in-native linux" "standard-library linux" "std-microsoft linux" "std-aws linux" \
              "standard-library-in-native windows" "standard-library windows" "std-aws windows"; do
    set -- $pair; d="$SCRATCH/sbs-$run-$1-$2"; mkdir -p "$d"
    gh run download "$run" -n "JUnit old ($1, $2)" -D "$d/old" 2>/dev/null || mkdir -p "$d/old"
    gh run download "$run" -n "JUnit new ($1, $2)" -D "$d/new" 2>/dev/null || mkdir -p "$d/new"
    echo "### run $run: $1 ($2)"
    if [ -z "$(ls -A "$d/old")" ] && [ -z "$(ls -A "$d/new")" ]; then echo "both skipped (no reports)"; continue; fi
    (cd /c/Repos/Enso/ide-bs-3j && corepack pnpm --silent --filter build-scripts run junit-compare -- "$d/old" "$d/new"); echo "exit $?"
  done
done | tee "$SCRATCH/side-by-side.md"
grep -E "^###|Examples_Tests|Table_Tests|Generic_JDBC_Tests|Microsoft_Tests|Base_Tests|Cloud_Tests|exit|both skipped" "$SCRATCH/side-by-side.md"
```

Expected, for every suite and both runs: `exit 0`, every project `same`, and:

- `Examples_Tests` on Linux JVM **30 / 0 / 0** on both sides (GraalPy runs
  `Python_Examples_Spec`; 29 / 0 / 1 means GraalPy is missing on that side) —
  must-carry 1; on Linux native and on Windows 29 / 0 / 1 on both sides;
- Linux `Table_Tests` about 7,590 / 0 / 155 (JVM) and `Generic_JDBC_Tests` 60 /
  0 / 0: Postgres is wired (Windows: about 5,816 and 46, no Postgres, as
  before);
- `Microsoft_Tests` 629 / 0 / 43: SQL Server is wired;
- `Base_Tests` and `Cloud_Tests` equal on both sides: the HTTP test helper is
  wired;
- `Base_Internal_Tests`, `Table_Internal_Tests` present:
  `--disable-private-check`;
- both AWS suites "both skipped".

A project that differs in one run only, by a test or two, is a flake: re-run
that pair once more (`gh workflow run engine-checks.yml --ref ci/stdlib-test`)
and compare again; if it still differs, read the changed cases `junit-compare`
lists. A project that differs in both runs is a wiring fault: fix it in the
final-state code (the `stdlib-tests` or `stdlib-tests-windows` job, the runner,
or `setup-jvm`), never only in the temporary pieces, commit on top, push, and
repeat the whole step. Only a difference proven flaky on develop too (it changes
between two develop runs) may be `--allow`ed, and the PR body says which and
why.

Put `side-by-side.md` (in `<details>`), the two run links and the job times in
the PR body.

- [ ] **Step 5: Remove the side-by-side, update the docs, merge**

```bash
cd /c/Repos/Enso/ide-bs-3j
git revert --no-edit "$(cat "$SCRATCH/3j-temporary-sha")"
! grep -nE 'stdlib-tests-old|^  build-script:|ENSO_BUILD_SKIP|JUnit (old|new)' .github/workflows/engine-checks-platform.yml && echo "side-by-side removed"
```

Expected: the revert applies cleanly (it undoes the temporary commit by its SHA,
whatever fixes came after it) and prints `side-by-side removed`.

In `.github/CLAUDE.md`, under `## What still goes through \`./run\``, replace
the paragraph before the table (develop's lines 80–90; earlier PRs shift them).
It starts with the line

<!-- prettier-ignore -->
```markdown
Build simplification Phase 2 moves the steps where `./run` only wraps one sbt
```

and ends with the line

<!-- prettier-ignore -->
```markdown
`engine-checks-platform.yml`).
```

Replace it with:

<!-- prettier-ignore -->
```markdown
Build simplification Phases 2 and 3 moved every pull-request check off `./run`.
Where it only wrapped one sbt call, the workflows call sbt (Phase 2). Its real
logic went to sbt tasks (`checkEnsoSyntax`, `ciBuildEngineDistribution`,
`buildEngineBundle`), to `tools/build-scripts` (`version`, `stdlib-api-check`,
`ide-build`, `stdlib-test`), or to plain workflow steps (the JVM tests) (Phase
3). A moved step sets every variable `./run` set for it; the Notes in each
workflow say which. A job that runs a distribution built by another job uses
that job's version, from its outputs, not sbt's default `0.0.0-dev`: see Note
[Lint Reads The Distribution's Version] in `engine-checks-platform.yml`.
Release, promote, the nightly checks and the macOS checks still call `./run`
until Phase 4.
```

and the row whose cells are `` `engine-checks-platform.yml` › stdlib tests ``
and `` `./run backend test …` `` gets the cells
`` `corepack pnpm --filter build-scripts run stdlib-test <suite>` `` and
`` No: `setup-jvm` (GraalPy), `setup-build-scripts` ``.

In `CLAUDE.md`, replace the paragraph of develop's lines 62–69. It starts with
the line

<!-- prettier-ignore -->
```markdown
CI is moving off `./run` (the build-simplification spec,
```

and ends with the line `until Phase 5.`. Replace it with:

<!-- prettier-ignore -->
```markdown
CI runs no default pull-request check through `./run` any more (the
build-simplification spec,
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`, Phases 2
and 3): the workflows call sbt directly, with `.github/actions/setup-jvm`
providing GraalVM, sbt, flatc and GraalPy, and run the logic that left `./run`
from `tools/build-scripts` (`corepack pnpm --filter build-scripts run <command>`;
`toolchain-check` compares a local toolchain with the pins). `.github/CLAUDE.md`
("What still goes through `./run`") lists each step. Release, promote, the
nightly checks and the label-gated macOS checks still use `./run` until Phase
4; locally, `./run` keeps working until Phase 5.
```

In `build_tools/CLAUDE.md`, replace the paragraph of develop's lines 54–59. It
starts with the line

<!-- prettier-ignore -->
```markdown
CI is moving the steps where `./run` only wraps one sbt call to direct sbt
```

and ends with the line `command.`. Replace it with:

<!-- prettier-ignore -->
```markdown
CI's pull-request checks no longer call `./run` (build simplification Phases 2
and 3; `.github/CLAUDE.md`, "What still goes through `./run`"). Release,
promote, the nightly checks and the macOS checks still do, until Phase 4, and
the build-simplification spec retires this CLI in Phase 5. Until then, keep
`./run`'s behaviour for the call sites that still use it; `tools/build-scripts`
and the sbt tasks that replaced the rest mirror what `./run` did, so a fix to
one belongs in the other too.
```

```bash
corepack pnpm exec prettier --write .github/CLAUDE.md CLAUDE.md build_tools/CLAUDE.md
corepack pnpm exec prettier --check .github/CLAUDE.md CLAUDE.md build_tools/CLAUDE.md
git grep -n "Yes: Phase 3" -- .github/CLAUDE.md
git add .github/CLAUDE.md CLAUDE.md build_tools/CLAUDE.md
git commit -m "Docs: no pull-request check goes through ./run any more"
git push
```

Expected: Prettier clean; the `git grep` prints nothing (every Phase 3 row
flipped). Run `"$SCRATCH/wait-pr.sh" <N> 360` in the background. When every
check is green, and the side-by-side in the PR body passed:
`gh pr merge <N> --squash`.

---

### Task 16: Close out Phase 3

**Files:** none in the repository.

- [ ] **Step 1: Check develop**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide grep -nE '^\s*(- )?run: .*\./run( |$)' origin/develop -- .github/workflows/changelog.yml .github/workflows/engine-checks-platform.yml .github/workflows/ide-packaging.yml .github/workflows/engine-checks.yml
git -C /c/Repos/Enso/ide grep -nE 'uses: \./\.github/actions/(setup-)?build-script$' origin/develop -- .github/workflows | grep -vE "nightly|release|promote|macos"
```

Expected: both print nothing. (The Notes still mention `./run`, to say what each
step replaced; the patterns count only steps that run it or use its actions.)
(The `build-script` and `setup-build-script` composite actions remain for the
generator-era workflows' own copies of those steps and for Phase 4; Phase 5
deletes them with `build_tools/`.)

- [ ] **Step 2: Record and tidy**

- Comment on #289: the ten PR links, "Phase 3 complete", and the "Tickets to
  raise" list below (for the user to file; do not file them).
- Comment on #313: its first bullet (sbt detection) is done by 3b; what remains
  is a `setup-jvm` step with an `if:` counted as always run, and nothing
  enforcing unique `cache-key`s (3j's two standard-library jobs share
  `stdlib-tests` across their matrix legs, which the key's OS part separates
  only by platform). Leave #313 open.
- Remove the worktrees `ide-bs-3a` … `ide-bs-3j` and `ide-bs-p3base` with
  `git -C /c/Repos/Enso/ide worktree remove <dir>` once their branches have
  merged.
- Delete `~/enso-target` in WSL only if this plan created it (Task 8 Step 3) and
  nothing else uses it; otherwise leave it.

---

## Tickets to raise

Found while planning; out of Phase 3's scope. Do not raise them; list them in
the close-out comment for the user.

1. **The JVM tests' Enso benchmark dry run never runs.**
   `./run backend test jvm` asks for runtime benchmarks, and the Enso dry run
   only fires for Enso ones; it would also fail without `target/small-jdk`.
   Decide whether CI should dry-run `test/Benchmarks`
   (`ENSO_BENCHMARK_TEST_DRY_RUN`) and add it on purpose. (R8)
2. **The heap-dump `JAVA_TOOL_OPTIONS` never reach the JVM tests.** `./run`
   configured `-XX:+HeapDumpOnOutOfMemoryError` for `test jvm` but passed it
   only to the standard-library tests, so the "Heap dumps (JVM Tests …)"
   artifact can only hold dumps from tests that add the flag themselves. (R8)
3. **The GUI and the installer disagree on the version in PR builds.** The GUI
   job derives `ENSO_IDE_VERSION=<date>-dev` (`2026.10.22-dev`); the installer
   and the engine use `version`'s `2026.1.1-dev`. (R11)
4. **`Cargo.run` swallows non-zero exits** (`project/Cargo.scala`): a failing
   `cargo build` of the parser's JNI library or Java generator only logs.
   `checkEnsoSyntax` avoids it; the parser build does not.
5. **The API check cannot see a removed module.** `enso --docs api` writes into
   the package's `docs/api` without deleting stale files, so a deleted module's
   `.md` never shows in the diff (the same under `./run`).
6. **`verifyGeneratedPackage` is skipped on Windows** ("FIXME … CRLF issues?"),
   inherited from `./run`; nobody has checked whether it still fails there.
7. **`ilammy/msvc-dev-cmd` runs on node20** (v1.13.0, 2024). Watch GitHub's
   node20 retirement; the pwsh fallback is in `setup-msvc`'s comment.
8. **`app/electron-client` has no `test:unit` script**, so its headless vitest
   tests (`tests/headless/`, which cover the `ENSO_BUILD_*` contract that
   `ide-build` feeds) do not run in `ci:unit-test`.

## Self-review against the spec

| Spec section / requirement                                                                                                                                                                                                                  | Where                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3: move the real logic, one PR each: `version`, `changelog-check`, `stdlib-api-check`, `buildEngineBundle`, `checkEnsoSyntax`, `backend test jvm`, `ci-build-engine-distribution`, `ide build`, `stdlib-test` with service containers | Tasks 1–2 (3a), 6 (3c), 7 (3d), 11 (3g), 8 (3e), 12 (3h), 9–10 (3f), 13 (3i), 14–15 (3j)                                                                                      |
| Phase 3 gate: merge on green; `stdlib-test` after a side-by-side run                                                                                                                                                                        | Global Constraints; Task 15 Step 4 (both sides, two runs, pass/fail/skip per project)                                                                                         |
| Must-carry 1: GraalPy; diff `Examples_Tests` specifically                                                                                                                                                                                   | Task 3 (pin), Task 14 Step 4 (`setup-jvm` input), Task 15 Step 4 (30/0/0 on Linux JVM, both sides)                                                                            |
| Must-carry 2: `setup-msvc` for the first Windows native-image job off `./run`; the DLL copy into the engine package                                                                                                                         | Task 10 (`setup-msvc`, the build job), Task 9 (`MsvcRuntime`, in `ciBuildEngineDistribution` and, Task 11, `buildEngineBundle`); the 7 DLLs checked in Task 10 Step 5         |
| Must-carry 3: `ci-build-engine-distribution` (clean, build, IR cache check, DLLs, versioned verify), `backend test jvm`, `ide build` after `version`                                                                                        | Tasks 9–10; Task 12; Task 13 (after 3a and 3g)                                                                                                                                |
| Must-carry 4: the version hand-off, `id: build`, the three outputs                                                                                                                                                                          | Task 10 (the version step keeps `id: build`); "The version hand-off"; Tasks 7, 12, 15 read the outputs                                                                        |
| Must-carry 5: per-command environment (`ENSO_LAUNCHER`, Windows factors, `ENSO_TEST_JUNIT_DIR` and its reset, `all`/`;` batching, quoted `-D`)                                                                                              | The P1–P10 table; Note [JVM Tests Without ./run] (Task 12); `invocation.ts` and its tests (Task 14); every sbt line quoted                                                    |
| Must-carry 6: the `SBT_CALL` blind spot (wrappers, `sbt.bat`, `bash -c`, sbt from `tools/build-scripts`)                                                                                                                                    | Task 4 (`callsSbt`, `buildScriptsSbtCommands`, `checkBuildScriptsSpawnSbtThroughHelper`); Task 14 Step 3 shows `stdlib-test` detected                                         |
| Must-carry 7: clean-ups if self-hosted runners arrive first                                                                                                                                                                                 | P8: no-ops on hosted runners; the runner keeps the IR cache and bench-report clean-ups under `GITHUB_ACTIONS` (Task 14); #258 still needs its own clean step for the sbt jobs |
| Must-carry 8: `toolchain-check` reads the same text as the awk reader and the policy                                                                                                                                                        | Task 3 (`toolchain-pins.mjs` + the awk-equivalence test), Task 5 (`toolchain-check` imports it)                                                                               |
| Must-carry 9: `check-syntax` becomes `checkEnsoSyntax`; the lint job drops `setup-build-script`                                                                                                                                             | Task 8                                                                                                                                                                        |
| Components: `tools/build-scripts` (pnpm package, vitest, root-level access)                                                                                                                                                                 | Tasks 1–2; R3; R-plan-1 (no root alias scripts)                                                                                                                               |
| Components: `version` publishes the contract to `GITHUB_ENV` and `GITHUB_OUTPUT`, `export` lines locally                                                                                                                                    | Task 1 (`publish`, tested); R4                                                                                                                                                |
| Components: `changelog-check`                                                                                                                                                                                                               | Task 6 (R-user-1: a GitHub script, a deliberate deviation recorded in the spec)                                                                                               |
| Components: `stdlib-api-check`, same failure message                                                                                                                                                                                        | Task 7 (`failureLines` tested; the negative CI test)                                                                                                                          |
| Components: `stdlib-test` (meta args, JUnit dir, time factors, selection, clean-ups; GraalPy; services)                                                                                                                                     | Task 14; Task 15 (services, GraalPy); the spec corrected per R9                                                                                                               |
| Components: `toolchain-check` with install hints                                                                                                                                                                                            | Task 5                                                                                                                                                                        |
| sbt additions: `buildEngineBundle`, `checkEnsoSyntax`, the CI build                                                                                                                                                                         | Tasks 11, 8, 9 (R6 replaces the "CI flag" with a task; the spec corrected)                                                                                                    |
| CI structure: `setup-jvm` (+ GraalPy), `setup-msvc`; services on Linux; required-check names unchanged                                                                                                                                      | Tasks 14, 10, 15; Global Constraints; the comparison in every PR                                                                                                              |
| Verification: `version` against real tag sets; `stdlib-test` side by side; `buildEngineBundle` byte-level listing on Linux and Windows                                                                                                      | Task 1 (the Rust tests and origin's real tags as a table); Task 15 Step 4; Task 11 Step 5                                                                                     |
| Throughout: Linux as well as Windows; no `git stash`, no `--no-verify`; Prettier on docs                                                                                                                                                    | Global Constraints; WSL runs in Tasks 2–5, 8, 9, 11; Windows runs of every moved job                                                                                          |
| Risks: Windows native image needs MSVC                                                                                                                                                                                                      | Task 10 (`setup-msvc`, its check step and fallback note)                                                                                                                      |
| Risks: two ways to build during Phases 2–4                                                                                                                                                                                                  | Every PR updates `.github/CLAUDE.md`; Task 15 Step 5 updates `CLAUDE.md` and `build_tools/CLAUDE.md`; every Rust command stays for Phase 4's workflows                        |

**Spec references corrected against the code** (all in the spec, 2026-10-22):

- `tools/build-scripts` runs under Node's type stripping, not `tsx` (R3).
- `version` reads `latest-release` before tags, ignores an invalid
  `ENSO_VERSION` silently, and is new in writing `GITHUB_ENV` (R4);
  `build-config.yaml` keeps `latest-release` after Phase 5.
- `changelog-check` is a GitHub script (R-user-1).
- `checkEnsoSyntax` wraps the Rust tool, not JNI (R-user-2).
- The CI build is a task, `ciBuildEngineDistribution`, not a flag (R6).
- `stdlib-test`: the runner starts the HTTP test helper; Postgres and SQL Server
  only on Linux; the library server belongs to the JVM tests; `ENSO_LAUNCHER`
  plays no part; empty service variables are removed (R9).
- GraalPy is a `setup-jvm` input with a `toolchain.graalpy` pin (R10).

**Placeholder scan:** `<N>` is a PR number, known once `gh pr create` prints it;
`<id>`, `$pr`, `$dev`, `$disp` are printed by `gh run list`; `$SCRATCH` is the
executing session's scratchpad; `<version>`, `<os>` and `<suite>` inside Notes,
docs and expected output name values the runs print. No step says "similar to"
another; each repeats its commands. Every code step carries the complete file or
the exact text to insert.

**Consistency:** the names match across tasks:

- the package `build-scripts`, its scripts `version`, `toolchain-check`,
  `stdlib-api-check`, `ide-build`, `stdlib-test`, `junit-compare`, and the entry
  points `src/commands/<script>.ts`;
- `REPO_ROOT`, `capture`, `runInherited`, `invocation`, `commandArguments`,
  `repositoryVersions`, `findEnginePackage`, `ensoBinary`, `spawnSbt`,
  `killTree` — defined in Tasks 1, 7, 14 and used under those names;
- `readToolchainPins`, `TOOLCHAIN_PINS`, `TOOLCHAIN_PIN_FILES`, `callsSbt`,
  `buildScriptsSbtCommands`, `BUILD_SCRIPTS_SBT_HELPER`,
  `checkBuildScriptsSpawnSbtThroughHelper`;
- the sbt tasks `checkEnsoSyntax`, `ciBuildEngineDistribution`,
  `buildEngineBundle`; `MsvcRuntime.copyCrtDlls`,
  `GatherLicenses.verifyPackageAt`, `EngineBundle.create`,
  `Builder.localPlatform`;
- the actions `setup-build-scripts`, `setup-msvc`, and `setup-jvm`'s `graalpy`;
  the cache keys `build-engine-distribution`, `jvm-tests`, `build-backend`,
  `stdlib-tests`, `enso-code-lint`;
- the step ids `build` (build job), `version` (IDE backend), `tests` and
  `parser-self-tests` (JVM tests); the matrix fields `small-jdk`, `postgres`,
  `mssql`; the service ids `postgres` and `sqlserver`;
- the Notes [Engine Distribution Without ./run], [Lint Reads The Distribution's
  Version], [JVM Tests Without ./run], [Standard Library Tests Without ./run],
  [Engine Bundle Without ./run] and, in `build.sbt`, [CI Engine Distribution
  Build].

**Tested before writing** (2026-10-22, on a scratch worktree of develop at
`2e89229ef6` with every change of this plan applied):

- `tools/build-scripts`: 117 vitest tests pass on Windows; `tsc --noEmit` and
  ESLint (`--max-warnings=0`) clean; Prettier clean. The counts per PR (57, 65,
  76, 84, 117) were measured by running the subset each PR adds.
- `version` prints `2026.1.1-dev`, which is what develop's `./run` published;
  `ENSO_EDITION=""` fails with `./run`'s message.
- `toolchain-check` ran on this machine (the report in Task 5).
- The filtered install (`setup-build-scripts`' command) takes 7 seconds and is
  enough to run `version`.
- `stdlib-test std-aws` on Windows (credentials present here, so it did not
  skip) started the HTTP test helper through `sbt.bat`, saw it accept
  connections, and left no process behind; the dry run lists the logged command
  lines.
- The workflow policy: 94 `node:test` tests pass on Windows and WSL, including
  the awk-equivalence test on both; `Workflow policy: OK` on the final
  workflows, with `stdlib-test` detected as an sbt command.
- actionlint 1.7.12 with shellcheck 0.11.0 is clean on every final workflow, and
  on the temporary side-by-side version; shellcheck is clean on `setup-jvm`'s
  six bash steps, `list-tree.sh` and `compare-trees.sh`.
- sbt (WSL): the build loads with all the Scala and `build.sbt` changes;
  `scalafmtSbtCheck` passes; `checkEnsoSyntax` checked 986 files in five batches
  and passed, and failed with exit 1 on a planted syntax error.
- The GraalPy 25.0.1 archives exist and unpack to
  `graalpy-community-25.0.1-<os>-amd64/bin/graalpy`.
- Not run: a full `ciBuildEngineDistribution` or `buildEngineBundle` (native
  images; CI proves them, Tasks 10 and 11), `MsvcRuntime` (needs the runner's
  MSVC), `ide-build` end to end, and any GitHub Actions run.

## Rulings

1. **R-user-1 (the user's decision, 2026-10-22):** `changelog-check` is an
   inline `actions/github-script` step in `changelog.yml` using
   `pulls.listFiles`, with the same label and error text, no checkout and no
   Build Script job; not a `tools/build-scripts` command.
   - **Why:** labels and changed files are GitHub's; a local command has no use.
     `./run` diffed against `origin/<default branch>`, so a stacked PR passed on
     its parent's entry (memory: stacked PR merge order); the PR's own file list
     fixes that.
   - **Cost if wrong:** a PR with more than 3,000 files is cut off by the API;
     such a PR would fail the check and need the label.
2. **R-user-2 (the user's decision, 2026-10-22):** `checkEnsoSyntax` is an sbt
   task that runs `cargo run -p enso-parser-debug --bin check_syntax --release`
   over the same files, batched for Windows, checking the exit code itself (not
   through `Cargo.run`); errors and warnings both fail. Not a JNI port. The
   nightly keeps `./run libraries check-syntax` until Phase 4.
   - **Why:** exact parity with a few dozen lines; the JNI side has no tree
     walker, and porting one would lose parity.
   - **Cost if wrong:** the lint job needs cargo (the hosted image's rustup
     provides it, as for the parser build `lintEnso` already does); a
     self-hosted runner (#258) would need `setup-rust`.
3. **R3:** the package runs under Node 24's type stripping
   (`node src/commands/<name>.ts`, erasable syntax only, `.ts` import
   extensions) and is tested with vitest; no `tsx`. `.prettierignore` un-ignores
   it (`tools/*` + `!tools/build-scripts`), and a dedicated `Build Scripts`
   workflow runs its typecheck, lint and tests on changes to it or to what it
   reads; the GUI checks also run them, through `-r`, when GUI files change. CI
   jobs run it on Node 24 too: `setup-node` installs `.node-version` on every OS
   and checks it (Task 2), since the images carry Node 22.
   - **Why:** no new dependency (the two-week rule), nothing to compile. The GUI
     gate does not cover `tools/`, and widening it would run 30 minutes of GUI
     checks for a script change.
   - **Cost if wrong:** if a needed feature is not erasable, add `tsx` then.
4. **R4:** `version` is a port, quirks included: dev from `latest-release`,
   `git ls-remote --tags origin` only without that key, the nightly, rc, stable
   and patch rules, an empty or invalid `ENSO_VERSION` ignored silently, a set
   `ENSO_EDITION` (even empty) required to equal it. It publishes to
   `GITHUB_OUTPUT` under the same names and to `GITHUB_ENV`; locally `export`
   lines. A strict SemVer regex guards npm `semver`'s quirks (a leading `v`,
   padding; build metadata kept verbatim; `compareBuild` for Rust's ordering).
   The Rust tests are a vitest table, with origin's real tags added.
   - **Why:** the spec and the hand-off need the same value as `./run`.
     Consequence: `build-config.yaml` keeps `latest-release` after Phase 5 (the
     spec's End state now says so).
   - **Cost if wrong:** the silent fallback stays a footgun (a typo in a release
     input gives a `-dev` build); Phase 4 can make it an error with the release
     test as its proof.
5. **R5:** the build job's version step keeps `id: build` and publishes the
   three outputs (must-carry 4); the lint, API check, JVM tests and
   standard-library tests take them from the build job.
   - **Why:** one computation per run; every consumer names the same package.
   - **Cost if wrong:** none known; a missing output fails the lint's guard step
     loudly.
6. **R6:** `ciBuildEngineDistribution` is a task of its own, called as
   `sbt "clean; all ciBuildEngineDistribution"`: `buildEngineDistribution`,
   `checkIRCacheSizes`, the Windows MSVC runtime copy, and versioned
   `verifyGeneratedPackage` (engine, Base, Table, Image, Database; not on
   Windows). The DLL copy is `project/MsvcRuntime.scala`, shared with
   `buildEngineBundle`.
   - **Why:** a flag inside `buildEngineDistribution` would fire in every CI job
     that reaches it (`CI` is always set) and cannot host `checkIRCacheSizes`,
     which depends on it. One sbt session also saves six JVM starts.
   - **Cost if wrong:** two names for nearly one build; the Note says which to
     use where.
7. **R7:** `.github/actions/setup-msvc` wraps `ilammy/msvc-dev-cmd@v1` (major
   tag, as the repository pins) and checks `cl`, `dumpbin` and
   `VCToolsRedistDir`; the Windows build, IDE backend and JVM-test jobs use it.
   - **Why:** `./run` applied the same environment; the DLL copy needs
     `VCToolsRedistDir` and `dumpbin` even if GraalVM 25 finds MSVC by itself.
   - **Cost if wrong:** the action runs on node20; the comment in `setup-msvc`
     holds the pwsh replacement (Tickets to raise, 7).
8. **R8:** `backend test jvm` becomes workflow steps with `./run`'s exact
   commands, OS conditions and traps (`ENSO_TEST_JUNIT_DIR` only on `sbt test`;
   the Windows factors absent, not empty, on Linux; the deferred `sbt test`
   failure). Today's behaviour is kept: the Enso benchmark dry run that never
   fired and the heap-dump options that never reached the JVM tests are not
   added (Tickets to raise, 1 and 2).
   - **Why:** parity first; changing what CI tests belongs in its own PR.
   - **Cost if wrong:** none in behaviour; the tickets say what to add.
9. **R9:** `stdlib-test` is a `tools/build-scripts` command. It starts the HTTP
   test helper itself (`sbt http-test-helper/run`, through `src/lib/sbt.ts`);
   Postgres and SQL Server are Linux `services:` (Windows has no service
   containers); the library server is the JVM tests' only; `ENSO_LAUNCHER` plays
   no part; empty service variables are removed. Job names stay exactly as today
   (Linux and Windows are two jobs under one name template). The gate is the
   side-by-side with `junit-compare`, which checks pass, fail and skip counts
   per project, `Examples_Tests` explicitly.
   - **Why:** the spec's "services supplied by the caller" cannot hold for our
     own Java helper, and an empty variable reads as `""` in Enso, turning a
     skipped database group into a failing one. Skip counts are where a
     mis-wired service hides.
   - **Cost if wrong:** a wiring fault shows as a skip-count difference in the
     side-by-side, before merge.
10. **R10:** GraalPy is a `setup-jvm` input (`graalpy: "true"`) pinned by
    `toolchain.graalpy` in `build-config.yaml`, which Workflow Lint holds equal
    to `graalMavenPackagesVersion`. The standard-library jobs set it on both
    platforms, as `./run` installed it everywhere (only the Linux JVM suite's
    outcome depends on it).
    - **Why:** one place for the version, checked like the others.
    - **Cost if wrong:** about 30 seconds of download per Windows leg; drop it
      there if it matters.
11. **R11:** `ide build` replicates what CI needs (the table in Task 13) and
    drops the rest, each with its reason; electron-builder's hook writes the
    `.sha256`. The GUI/installer version mismatch is out of scope (Tickets to
    raise, 3).
    - **Why:** YAML cannot unset the empty signing variables, so a script is
      needed; the rest follows `./run` exactly.
    - **Cost if wrong:** a dropped item that something read would show as a
      packaging or package-test failure on the PR.
12. **R12:** the policy's `SBT_CALL` covers wrappers, `cmd /c`, `sbt.bat`,
    paths, `bash -c`/`pwsh -Command` scripts and sbt started from
    `tools/build-scripts` (a command whose entry point imports `src/lib/sbt.ts`;
    no other module may start sbt). One pin parser,
    `tools/ci/toolchain-pins.mjs`, serves the policy and `toolchain-check`, and
    a test holds it equal to `setup-jvm`'s awk. `toolchain-check` is a
    `tools/build-scripts` command.
    - **Why:** must-carry 6 and 8; the awk and JS readers disagreed on glued
      comments and duplicates.
    - **Cost if wrong:** over-matching forces a cheap `setup-jvm`;
      under-matching is a missed call, which the shape tests guard.
13. **R13:** one PR per item, in the order of the PR table; merge on green,
    except 3j after its side-by-side; `buildEngineBundle` verified by the
    byte-level listing against develop's `./run` bundle on Linux and Windows,
    with develop-against-develop as the control for nondeterministic files. Each
    PR updates its `.github/CLAUDE.md` rows and takes `CI: No changelog needed`.
14. **R-plan-1:** no root `package.json` aliases for the commands (the spec said
    "exposed through root scripts").
    - **Why:** `corepack pnpm --filter build-scripts run <command>` is the one
      spelling the workflows, the docs and the policy's detector use; a second
      spelling would need a second detector rule.
    - **Cost if wrong:** add aliases later, and teach `BUILD_SCRIPTS_RUN` them.
15. **R-plan-2:** each command is its own entry point
    (`src/commands/<name>.ts`), with the logic in `src/<name>/` behind injected
    side effects.
    - **Why:** the policy follows imports from the entry point to decide which
      commands start sbt; tests need no process spawning.
    - **Cost if wrong:** none known.
16. **R-plan-3:** `stdlib-api-check` keeps `./run`'s behaviour: libraries in
    sorted order (`./run`'s was the file system's), stopping at the first that
    differs, blind to removed modules.
    - **Why:** parity; the sorting changes no outcome.
    - **Cost if wrong:** a second broken library shows only after the first is
      fixed, as today.
17. **R-plan-4:** `stdlib-test` runs each project from the repository root, as
    `./run` did, not from `test/`.
    - **Why:** parity; the native launcher moves to `test/` itself.
    - **Cost if wrong:** none: the side-by-side would show it.
18. **R-plan-5:** the API check job gets no `setup-jvm`.
    - **Why:** the check runs the native `bin/enso`, which needs no JDK; the JDK
      `./run` installed was its own provisioning.
    - **Cost if wrong:** the PR's own API check run fails, before merge; add
      `setup-jvm` (no flatc) then.
19. **R-plan-6:** the runner deletes the global IR cache and `bench-report.xml`
    files only when `GITHUB_ACTIONS=true`, where `./run` used `CI`.
    - **Why:** a developer's `CI=true` shell must not delete
      `%LOCALAPPDATA%\enso\cache` (Global Constraints).
    - **Cost if wrong:** none on hosted runners.
20. **R-plan-7:** a matrix entry that needs no database gets `image: ''`, which
    starts no service container.
    - **Why:** one Linux job keeps the job names and the matrix; the alternative
      splits jobs per database.
    - **Cost if wrong:** if GitHub rejects an empty image, the PR run fails at
      job set-up. Fallback: drop the two `image:` expressions for the literal
      images (`postgres:18`, `mcr.microsoft.com/mssql/server:2022-latest`) so
      every Linux leg starts both; the step `env` still passes the variables
      only where the matrix asks, so behaviour is unchanged (no other project
      reads them), at about 2 GB of memory for SQL Server per leg.
21. **R-plan-8:** Postgres is `postgres:18`, not `./run`'s `latest` (18.6 when
    this moved), with a `pg_isready` health check; SQL Server keeps
    `2022-latest` and `./run`'s readiness line (a wait step), since the image's
    `sqlcmd` path is not certain enough for a health check.
    - **Why:** a pinned major does not move silently; readiness as `./run` had
      it.
    - **Cost if wrong:** a Postgres 19 never arrives by itself; bump it on
      purpose.
22. **R-plan-9:** the cloud suites (`std-cloud-related`, `std-snowflake*`)
    refuse to run when the five Enso Cloud credentials are set, since signing in
    to the cloud (AWS CLI, Cognito) has not moved; they run without them, as on
    forks.
    - **Why:** no pull-request job uses those suites; Phase 4 ports the sign-in
      with the nightly.
    - **Cost if wrong:** none for pull requests.
23. **R-plan-10:** `toolchain-check` runs `sbt --script-version` through
    `capture`, not `src/lib/sbt.ts`, and the convention reads "only
    `src/lib/sbt.ts` runs sbt tasks".
    - **Why:** it asks the launcher for its version and loads no build, so it
      needs no `setup-jvm`; no workflow runs `toolchain-check`, and routing it
      through the helper would make the policy demand `setup-jvm` for it.
    - **Cost if wrong:** if a workflow ever runs `toolchain-check` without a
      JDK, the sbt line only warns (the launcher check is not strict).
