# Build Simplification, Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the Rust build tooling for good: give developers a one-command
local IDE build, delete `build_tools/`, `run`, `run.cmd`, `run.ps1` and the
standalone launcher (`engine/launcher`, `ensoup`, `lib/rust/launcher-shims`),
shrink the Rust workspace to the parser, reduce `build-config.yaml` to
`latest-release` and `toolchain:`, and leave no reference to any of them in the
tree.

**Architecture:** Four pull requests, in order. Each merges before the next
starts.

- **5a, "nothing needs `./run`"**: a new `tools/build-scripts` command,
  `ide-local`, builds an installer from the checkout in one go (what
  `./run ide build` did locally); `ide-build` shares its packaging code. The
  remaining _functional_ references move off `./run`: the `stdlib-test` cloud
  error, the WASM checks' generator-era job ids, the IDE path filter (which
  never listed `tools/build-scripts`), and every document that tells a developer
  to run `./run`. Nothing is deleted yet except the dead
  `tools/build-performance` script.
- **5b, the deletion**: `build_tools/`, `run*`, the workspace members and pins
  only they used, `Cargo.lock`'s 365 orphaned packages, `clippy.toml`'s
  `reqwest` rules, `build-config.yaml`'s dead keys, the editor and Git settings
  for `run.cmd`, the path filters, and every document whose statement becomes
  false when the files go.
- **5c, the standalone launcher**: the `launcher` sbt project, its native image
  `ensoup`, its packaging (`buildLauncherDistribution`, `makePackages`,
  `makeBundles`), `distribution/launcher*`, its licence review, its docs, the
  self-upgrade test's Rust shims, and the four pieces of
  `runtime-version-manager` that only the launcher used. It touches the engine
  build, so it is its own PR and it waits for an engine nightly the user
  dispatches.
- **5d, the sweep**: the history notes. Comments across the workflows, `tools/`,
  `project/` and `build.sbt` still say "as `./run` did" and cite `build_tools/…`
  paths that no longer exist. They are rewritten (comments only, checked
  mechanically), five Notes are renamed, and the final `git grep`s return
  nothing outside a short allowlist.

**Tech Stack:** Node 24.21 (type stripping), TypeScript 6.0.3
(`erasableSyntaxOnly`), vitest 3.2; Rust 1.98.1 (`cargo metadata` for the lock
shrink); sbt 1.10.6 on GraalVM CE 25.0.1; GitHub Actions; actionlint 1.7.12 with
shellcheck 0.11.0; `node:test` for `tools/ci`; Python 3 (`py -3`) for the check
scripts; `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md`
(design PR #289): "End state" (the Rust workspace, the entry points, "Removed"),
"Phases" (Phase 5: "Delete `build_tools/`, `run*` and the provisioning code …
Update the docs and every CLAUDE.md that mentions `./run`", gate "Merge on
green"), "Remnants", and "Risks" ("Local developers lose auto-provisioning").
This plan updates the spec's End state and Phase 5 row for the user's launcher
decision of 2026-10-24. The Phase 4 plan
(`docs/superpowers/plans/2026-10-23-build-simplification-phase-4.md`) has the
house style this plan follows.

## Decisions for review

The controller's recommendations, encoded in the tasks. The user may overturn
any of them; each says what changes if they do.

1. **Four PRs (5a replacements, 5b deletion, 5c launcher, 5d sweep), in that
   order.**
   - 5a before 5b: every caller and every instruction moves off `./run` while it
     still exists, so 5a can be reverted alone and 5b deletes only dead code.
   - 5b alone: its diff is ~23,000 deleted lines of Rust; keeping the few dozen
     edited lines beside them small lets a reviewer read them.
   - 5c after 5b (the user's ruling): it changes the engine build and the JVM
     tests, so it needs the engine nightly, which 5a and 5b do not.
   - 5d last: its comment rewrites touch the same files as 5b and 5c
     (`project/DistributionPackage.scala`'s `makeArchive` comment is deleted by
     5c, for example), and its pointer to the old code names the commit 5b
     deleted from. Its zero-reference `git grep` is then the programme's final
     check.

   _If overturned (fewer PRs):_ 5d's tasks fold into 5b; the Note renames and
   the pointer commit stay as written.

2. **`ide-local` is a new command; `ide-build` keeps its CI role.** `ide-local`
   runs `sbt buildEngineBundle`, copies the bundle to `dist/backend`, builds the
   GUI into `dist/gui`, then packages, always replacing `dist/backend` and
   `dist/gui` (and clearing `dist/ide`), so it never reuses an old
   `dist/backend`: the stale-engine trap of `--backend-source local` cannot
   happen. The engine itself builds incrementally, as `sbt buildEngineBundle`
   always does; `sbt clean` first is the escape hatch. It imports
   `src/lib/sbt.ts`, so the workflow policy counts it as an sbt call; it is
   never run in CI. `ide-build` stays sbt-free, because the packaging job has no
   `setup-jvm`. _If overturned (a recipe instead):_ drop Task 1's command and
   keep its four commands in `docs/CONTRIBUTING.md`.
3. **The Rust `enso-formatter` (`./run fmt`'s import grouper) is retired, not
   ported.** No CI job runs it; `cargo fmt` and Prettier remain.
4. **`gui-changed-files.yml` gains `.cargo/**`, `Cargo.lock`, `Cargo.toml` and
   `rust-toolchain.toml`, one glob per line, in both of its lists** (the full
   list, and the "excluding GUI tests" list whose `any_changed_excluding_tests`
   output `ide-pull-request.yml` reads). The GUI build compiles the WASM parser
   through cargo, but a lock or toolchain change does not start the GUI checks
   today. With this, 5b's own lock change runs them. _If overturned:_ add the
   `CI: Build IDE` label to 5b's PR instead.
5. **`ide-changed-files.yml` gains `tools/build-scripts/**`** (5a). `ide-build`
   packages every installer, yet a change to it does not start IDE packaging;
   `build_tools/**` had that role for `./run`.
6. **The history notes are rewritten mechanically, not restructured** (Ruling
   R1). After 5b they point at files that do not exist. In full: the five Notes
   named "… Without ./run" are renamed, every `build_tools/…` path becomes "the
   retired build CLI's `x.rs`" with one pointer to the last commit that has the
   old code (in `tools/build-scripts/CLAUDE.md`), and the test names and
   descriptions are renamed. Elsewhere "`./run`" becomes "the retired build CLI"
   in place; paragraphs and Note bullet lists keep their facts and shape. _If
   overturned:_ skip Tasks 8–10; the final grep then allows every comment line.
7. **Allowlist for the final greps:** `docs/superpowers/**` (specs and plans are
   history), `CHANGELOG.md` (released notes), `docs/libraries/sharing.md`'s
   permalink to `enso-org/enso` at a fixed commit,
   `app/gui/integration-test/mock/data/latestGithubReleases.json` (a recorded
   GitHub API response that names upstream's `launcher-manifest.yaml` asset),
   and
   `lib/scala/distribution-manager/src/main/scala/org/enso/distribution/DistributionManager.scala`'s
   `OS.executableName("ensoup")`: the portable-mode detection that Decision 9
   keeps (Ticket 4). **Do not touch that line** in any PR of this plan.
8. **`build-config.yaml` keeps `latest-release` and `toolchain:` only.**
   `wasm-size-limit` and `required-versions` were read only by `build_tools`.
9. **Launcher removal stops at code that becomes unreferenced.** Deleted from
   `runtime-version-manager`: the `runner` and `cli` packages,
   `EngineRepository` and `Resources.LauncherExecutable` (nothing outside the
   launcher uses them, not even tests). Kept: everything else, though most of it
   is then used only by its own tests. `engine/runner`'s `JavaFinder` uses
   `GraalRuntime`, `GraalVMVersion` and `GraalVersionManager`, and the language
   server's tests use `FakeEnvironment` and `TestableThreadSafeFileLockManager`.
   Ticket 4 proposes the deeper cut. Kept unchanged: `lib/scala/cli`,
   `distribution-manager`, `editions`, `pkg`, `library-manager`, `downloader`,
   the engine runner (`bin/enso`, `enso.exe`, `ENSO_LAUNCHER`), and the engine
   manifest's `minimum-launcher-version` field, which `Manifest` still requires.
10. **No nightly dispatch for 5a, 5b or 5d.** They change no workflow's
    behaviour (5a renames three job ids, D3). 5c changes what `sbt test` runs on
    every platform, so the user dispatches `engine-checks-nightly.yml` from its
    branch before it merges (Task 7).
11. **`distribution/enso.bundle.template` goes in 5b.** Only `build_tools`'
    `paths.yaml` read it; `EngineBundle` writes the `.enso.bundle` marker
    itself.

## Global Constraints

- **Never dispatch `release.yml`, `promote.yml` or `nightly.yml`**, and never
  enable or disable a workflow, without the user. The only dispatch this plan
  asks for is Task 7's `engine-checks-nightly.yml`, and the user starts it.
- **Do not run Standard Library tests locally** (`stdlib-test` without
  `--dry-run`, `enso --run test/…`, `sbt` test tasks over `test/`): this machine
  has real AWS credentials. The JVM tests (`sbt test`) run in CI only; locally,
  compile them (`Test/compile`).
- **Merge rules:** every PR merges on green (CI and tooling; the spec's Phase 5
  gate), except 5c, which also waits for the user's nightly (Task 7). Every PR
  takes the label `CI: No changelog needed` (invisible to users) and merges with
  `gh pr merge <N> --squash`.
- **When a check fails:** look up the same job in `$SCRATCH/baseline.md`; re-run
  the failed jobs once (`gh run rerun <run-id> --failed`); if develop fails the
  same job at the same step, comment the evidence on the PR and do not merge;
  otherwise fix it. A `LibraryUploadTest` `ConnectException` on Windows is the
  known harness race (root CLAUDE.md): re-run before investigating.
- **Keep the aggregator names verbatim:** "Engine Required Checks", "GUI
  Required Checks", "IDE Required Checks", "WASM Required Checks". No aggregator
  file is touched. Job display names stay (D3 changes job ids only).
- **Never** `git stash`, `--no-verify`, `--force` pushes, or edits to your own
  permissions or settings files.
- **Use `corepack pnpm`**, never bare `pnpm` or `npm`, locally.
- **Linux as well as Windows:** `cargo test --workspace` in WSL with
  `. ~/.enso-toolchain.sh` and `CARGO_TARGET_DIR=$HOME/enso-target`; the policy
  tests and actionlint in WSL (neither needs pnpm, so `/mnt/c` is fine). Never
  run pnpm in WSL against `/mnt/c`: a Linux pnpm or sbt run is a clone on the
  Linux filesystem (`git clone /mnt/c/Repos/Enso/ide ~/enso-p5`, then
  `corepack pnpm install` there).
- **Never touch** the user's installed Enso, `%APPDATA%\Enso`,
  `%LOCALAPPDATA%\enso`, `%LOCALAPPDATA%\Programs\enso` or `~/.enso`. Do not run
  an installer this plan builds, and do not run
  `tools/ci/windows-installer-smoke.ps1` locally (it installs into the user's
  `Programs\enso`).
- **actionlint clean** (1.7.12 with shellcheck 0.11.0, from WSL) on every
  workflow, and `node tools/ci/check-workflows.mjs` prints `Workflow policy: OK`
  on both hosts.
- **Prettier:** `corepack pnpm exec prettier --write <file>` on every Markdown,
  YAML, JSON or TypeScript file you touch, then `--check`. `tools/` is ignored
  except `tools/build-scripts`, so copy `tools/ci` changes exactly as given.
- **Commits** end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx
  ```

  **PR bodies** end with:

  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx
  ```

- **Watching CI:** `gh` with `--jq` only (there is no `jq` binary); a time cap
  on every wait; waits run with `run_in_background`, and the next task proceeds
  meanwhile where it does not depend on the result.

`$SCRATCH` is the executing session's scratchpad directory, with a `p5/`
subfolder for this phase's scripts.

---

## Branches, worktrees and PRs

Worktrees are created from `origin/develop` under `C:\Repos\Enso\` with
`git -C /c/Repos/Enso/ide worktree add <dir> -b <branch> origin/develop`, then
`corepack pnpm install --frozen-lockfile --ignore-scripts` inside it.

| PR  | Branch                      | Worktree    | Tasks | Needs merged first | Validated by                                                                                                                                    |
| --- | --------------------------- | ----------- | ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 5a  | `build/phase5-replacements` | `ide-bs-5a` | 1–3   | PR #346 (4c)       | Build Scripts CI (184 tests), ✨ IDE, ✨ Engine, ✨ WASM; `ide-local` producing an installer on Windows and on Linux                            |
| 5b  | `build/phase5-delete`       | `ide-bs-5b` | 4–5   | 5a                 | `cargo test --workspace` on both hosts (55 suites, 172 tests); ✨ WASM, ✨ Engine, ✨ IDE, ✨ GUI; the reference grep                           |
| 5c  | `build/phase5-launcher`     | `ide-bs-5c` | 6–7   | 5b                 | `sbt compile` and `Test/compile` of everything on both hosts; `verifyLicensePackages`; ✨ Engine (JVM tests), ✨ IDE; the user's engine nightly |
| 5d  | `build/phase5-sweep`        | `ide-bs-5d` | 8–11  | 5c                 | `comment-only.py` and `yaml-same.mjs` show comments only; the final greps print nothing; full PR CI                                             |

The design branch `design/build-simplification` (worktree
`C:\Repos\Enso\ide-build`, draft PR #289) carries only the spec and the plans.

## What replaces each `./run` command

5a writes this table into `docs/CONTRIBUTING.md` ("Building the IDE"), without
its first column's `./run` spelling (Task 2 gives the exact text).

| `./run` command                                       | Replacement                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ide build` (default: everything from source)         | `corepack pnpm --filter build-scripts run ide-local` (new, Task 1)                           |
| `ide build --backend-source local --gui-source local` | `corepack pnpm --filter build-scripts run ide-build`                                         |
| `ide upload`, `release …`                             | CI only: `release.yml` (`release <action>`); locally only `release promote <designator>`     |
| `gui build`                                           | `corepack pnpm run build:gui`                                                                |
| `gui check`                                           | `corepack pnpm run ci-check`                                                                 |
| `backend get` / `backend build`                       | `sbt buildEngineBundle` (`ENSO_LAUNCHER=native` for what the IDE ships)                      |
| `backend sbt -- <args>`                               | `sbt <args>`                                                                                 |
| `backend ci-build-engine-distribution`                | `sbt "clean; all ciBuildEngineDistribution"`                                                 |
| `backend test jvm`                                    | `sbt test` (CI's full steps: the `jvm-tests` job in `engine-checks-platform.yml`)            |
| `backend test <suite>`                                | `corepack pnpm --filter build-scripts run stdlib-test <suite>`                               |
| `backend stdlib-api-check`                            | `corepack pnpm --filter build-scripts run stdlib-api-check`                                  |
| `backend benchmark runtime` / `enso-jmh`              | `sbt runtime-benchmarks/bench` / `sbt std-benchmarks/bench` (`benchOnly <name>` for one)     |
| `java-gen build`                                      | `sbt syntax-rust-definition/compile` (sbt runs `enso-parser-generate-java` itself)           |
| `libraries check-syntax` / `libraries lint`           | `sbt checkEnsoSyntax` / `sbt lintEnso`                                                       |
| `fmt`                                                 | `corepack pnpm run format` and `cargo fmt` (Decision 3)                                      |
| `changelog-check`                                     | CI only (`changelog.yml`)                                                                    |
| `git-clean`                                           | `corepack pnpm run git-clean`                                                                |
| `wasm build` / `runtime build`                        | `corepack pnpm install` (the `postinstall` builds the WASM parser)                           |
| Toolchain provisioning                                | `corepack pnpm --filter build-scripts run toolchain-check`, then the install hints it prints |
| The MSVC environment on Windows                       | a Visual Studio Developer PowerShell or "x64 Native Tools Command Prompt" (`vcvars64.bat`)   |

## File map

| Path                                                                                                                                                                                                                                                                           | PR  | Change                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---------------------------------------------------------------------------------------------- |
| `tools/build-scripts/src/ide-build/packageIde.ts`                                                                                                                                                                                                                              | 5a  | Create: the packaging shared by `ide-build` and `ide-local`                                    |
| `tools/build-scripts/src/ide-build/ideLocal.ts` (+ `ideLocal.test.ts`)                                                                                                                                                                                                         | 5a  | Create: `ide-local`'s inputs                                                                   |
| `tools/build-scripts/src/commands/ide-local.ts`, `ide-build.ts`; `src/lib/sbt.ts`; `package.json`                                                                                                                                                                              | 5a  | Create / rewrite / `runSbt` / the script                                                       |
| `tools/build-scripts/src/stdlib-test/run.ts`, `run.test.ts`                                                                                                                                                                                                                    | 5a  | The cloud-credentials error no longer names `./run`                                            |
| `.github/workflows/wasm-checks.yml`, `ide-changed-files.yml`                                                                                                                                                                                                                   | 5a  | Job ids (D3); `tools/build-scripts/**` (Decision 5)                                            |
| `tools/build-performance/`                                                                                                                                                                                                                                                     | 5a  | Delete (dead: drives a `./run.sh wasm build` that has not existed for years)                   |
| `docs/CONTRIBUTING.md`, `docs/distribution/nightly.md`, `test/Google_Test/README.md`                                                                                                                                                                                           | 5a  | The replacement commands                                                                       |
| `app/electron-client/CLAUDE.md`, `internal/CLAUDE.md`, `engine/language-server/CLAUDE.md`, `tools/CLAUDE.md`, `tools/build-scripts/CLAUDE.md`, `.claude/skills/testing-and-evaluation/SKILL.md`                                                                                | 5a  | Build guidance without `./run`                                                                 |
| `build_tools/`, `run`, `run.cmd`, `run.ps1`, `distribution/enso.bundle.template`                                                                                                                                                                                               | 5b  | Delete                                                                                         |
| `Cargo.toml`, `Cargo.lock`, `clippy.toml`, `build-config.yaml`                                                                                                                                                                                                                 | 5b  | Shrink                                                                                         |
| `.gitattributes`, `.gitignore`, `.prettierignore`, `.vscode/launch.json`                                                                                                                                                                                                       | 5b  | Drop the `run.cmd`, `build_tools` and `./run` entries                                          |
| `.github/workflows/{engine,ide,wasm,gui}-changed-files.yml`                                                                                                                                                                                                                    | 5b  | Path filters                                                                                   |
| `CLAUDE.md`, `.github/CLAUDE.md`, `lib/rust/CLAUDE.md`, `lib/rust/macro-utils/CLAUDE.md`, `tools/CLAUDE.md`, `app/gui/src/project-view/assets/CLAUDE.md`, `distribution/CLAUDE.md`                                                                                             | 5b  | What exists now                                                                                |
| `engine/launcher/`, `lib/rust/launcher-shims/`, `project/LauncherShimsForTest.scala`, `distribution/launcher/`, `distribution/launcher-manifest.yaml`, `tools/legal-review/launcher/`, `docs/distribution/{launcher,launcher-cli,fallback-launcher-release-infrastructure}.md` | 5c  | Delete                                                                                         |
| `build.sbt`, `project/DistributionPackage.scala`                                                                                                                                                                                                                               | 5c  | The launcher project, its packaging and `makePackages`/`makeBundles`                           |
| `lib/scala/runtime-version-manager/src/main/…` (`runner/`, `cli/`, `EngineRepository`, `Resources`, `module-info.java`)                                                                                                                                                        | 5c  | Code only the launcher used                                                                    |
| `Cargo.toml`, `Cargo.lock`, `.gitignore`, `.prettierignore`, `tools/native-image-config-cleanup/index.js`, `.github/workflows/engine-checks-platform.yml` (one comment)                                                                                                        | 5c  | The launcher's entries                                                                         |
| launcher docs and CLAUDE.md files (Task 6 Step 6)                                                                                                                                                                                                                              | 5c  | Edit                                                                                           |
| ~50 files of history comments (Tasks 8–10)                                                                                                                                                                                                                                     | 5d  | Comments, five Note names, four test names, two sbt task descriptions, one package description |

## Reference: intended differences

| #   | PR  | Difference                                                                                                                                                                                        | Reason                                             |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| D1  | 5a  | A new `ide-local` script; `ide-build`'s behaviour is unchanged (same steps, same order, same messages)                                                                                            | Decision 2                                         |
| D2  | 5a  | `stdlib-test` with all five Enso Cloud credentials set fails with a message that no longer says to use `./run`                                                                                    | `./run` is going                                   |
| D3  | 5a  | `wasm-checks.yml` job ids `enso-build-ci-gen-job-native-test-linux-amd64`, `…-wasm-lint-…`, `…-parser-wasm-test-…` become `native-test`, `lint`, `parser-wasm-test`; their `name:`s are unchanged | Generator leftovers; check names come from `name:` |
| D4  | 5a  | A change under `tools/build-scripts/` starts IDE packaging                                                                                                                                        | Decision 5                                         |
| D5  | 5b  | A change to `Cargo.lock`, `Cargo.toml`, `rust-toolchain.toml` or `.cargo/` starts the GUI checks; `build_tools/**` and `run*` leave every filter                                                  | Decision 4; the files are gone                     |
| D6  | 5c  | `sbt test` no longer builds `ensoup` and the shims or runs the launcher's tests; the JVM Tests job gets shorter                                                                                   | The launcher is gone                               |
| D7  | 5c  | `sbt verifyLicensePackages` (the release's licence check) no longer checks a `launcher` distribution                                                                                              | Its review folder and package are gone             |

---

### Task 0: Preconditions, tools and the baseline

**Files:** none in the repository. Creates `$SCRATCH/p5/wait-pr.sh`,
`wait-run.sh`, `yaml-same.mjs`, `comment-only.py`, `rename-notes.py`,
`pattern.txt`, `launcher-pattern.txt` and `baseline.md`.

**Interfaces:**

- Produces:
  - `wait-pr.sh <pr> [max-minutes]`: exit 0 when all checks passed, 1 when some
    failed, 2 on timeout;
  - `wait-run.sh <run-id> [max-minutes]`: prints the run's conclusion; exit 0 on
    success, 1 otherwise, 2 on timeout;
  - `yaml-same.mjs` (run as
    `node --input-type=module -e "$(cat "$SCRATCH/p5/yaml-same.mjs")" <base> [--expect <file>:<path>]… <file>…`
    from the repository root): lists every YAML value that differs between
    `<base>` and the working tree as `<file>:<path>`; exit 0 only when each one
    is named by an `--expect` and each `--expect` did change. Comments do not
    survive parsing, so comment edits show nothing; a comment inside a `run:`
    script or a `description:` is part of a value and must be expected;
  - `comment-only.py <base> [--allow <substring>]… [-- <pathspec>…]`: exit 0
    when every changed line, added or removed, of a non-YAML code file in the
    pathspec is a comment or contains an `--allow` substring (pass both the old
    and the new text of each string the sweep rewrites);
  - `rename-notes.py`: Task 8's Note renames;
  - `pattern.txt` (the build-CLI reference pattern) and `launcher-pattern.txt`
    (the standalone-launcher pattern), read by every grep below;
  - `baseline.md`: the reference runs and counts.

- [ ] **Step 1: Check the starting point**

```bash
export GH_REPO=jdunkerley/enso
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide log --oneline -1 origin/develop
gh pr view 346 --json state,mergeCommit --jq '"\(.state) \(.mergeCommit.oid)"'
git -C /c/Repos/Enso/ide grep -nE '^\s*(- )?run: .*\./run( |$)|enso-build-cli|ENSO_BUILD_CLI_BIN' origin/develop -- .github
git -C /c/Repos/Enso/ide ls-tree origin/develop --name-only | grep -E '^(build_tools|run|run\.cmd|run\.ps1|maven_install\.json)$'
gh pr list --state open --search "Phase 5" --json number,title --jq '.[] | "\(.number)\t\(.title)"'
```

Expected: PR #346 is `MERGED`; the `.github` grep prints nothing (Phase 4 left
no workflow on `./run`); the tree lists `build_tools`, `run`, `run.cmd`,
`run.ps1` and not `maven_install.json` (Phase 0 removed it, with
`stage-bazel-app.sh`, the unreferenced `tools/ci/nightly/*.js` and
`tools/ci/check-changelog.js`; the spec's "Remnants" list is otherwise done); no
Phase 5 PR open. **If #346 has not merged, stop and tell the user**: 5a needs
4c's workflows and the deletion of `.github/actions/build-script`.

- [ ] **Step 2: Check the tools**

```bash
wsl -e bash -lc 'ls ~/tools/actionlint-1.7.12/actionlint ~/tools/shellcheck-v0.11.0/shellcheck && . ~/.enso-toolchain.sh && node --version && cargo --version && sbt --script-version'
node --version && cargo --version && py -3 --version
```

Expected: both binaries; Node 24.21.0 and cargo 1.98.1 on both hosts; sbt 1.10.6
in WSL; Python 3 through the `py` launcher (`python` is the Store stub).

- [ ] **Step 3: Save the helper scripts**

`$SCRATCH/p5/wait-pr.sh`:

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: wait-pr.sh <pr-number> [max-minutes]
# Waits until no check on the PR is pending (or the time cap), then prints every
# check that did not pass. Exit 0 = all passed, 1 = some failed, 2 = timed out.
export GH_REPO=${GH_REPO:-jdunkerley/enso}
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

`$SCRATCH/p5/wait-run.sh`:

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: wait-run.sh <run-id> [max-minutes]
# Waits for one workflow run to complete (or the time cap) and prints its conclusion.
# Exit 0 = success, 1 = any other conclusion, 2 = timed out.
export GH_REPO=${GH_REPO:-jdunkerley/enso}
run=$1
deadline=$(( $(date +%s) + ${2:-300} * 60 ))
while :; do
  status=$(gh run view "$run" --json status --jq .status 2>/dev/null || echo unknown)
  [ "$status" = "completed" ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "timed out"; exit 2; }
  sleep 120
done
conclusion=$(gh run view "$run" --json conclusion --jq .conclusion)
echo "$conclusion"
[ "$conclusion" = "success" ]
```

`$SCRATCH/p5/yaml-same.mjs`:

<!-- prettier-ignore -->
```js
// Usage (from the repository root, so that `yaml` resolves from its node_modules):
//   node --input-type=module -e "$(cat yaml-same.mjs)" <base-ref> [--expect <file>:<path>]... <file>...
// Parses each YAML file at <base-ref> and in the working tree and lists every value that differs,
// as `<file>:<path>` (`jobs.jvm-tests.steps.9.run`). Comments do not survive parsing, so a
// comment-only change shows nothing. A difference passes only when it is named by an `--expect`;
// exit 1 when any other differs, or when an `--expect` names a value that did not change.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { parse } from 'yaml'

const args = process.argv.slice(1)
const base = args.shift()
const expected = new Set()
const files = []
while (args.length > 0) {
  const arg = args.shift()
  if (arg === '--expect') expected.add(args.shift())
  else files.push(arg)
}

/** The paths below `prefix` at which `a` and `b` differ. */
function differences(a, b, prefix) {
  if (isDeepStrictEqual(a, b)) return []
  const objects = a != null && b != null && typeof a === 'object' && typeof b === 'object'
  if (!objects || Array.isArray(a) !== Array.isArray(b)) return [prefix]
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap((key) => differences(a[key], b[key], prefix === '' ? key : `${prefix}.${key}`))
}

const found = new Set()
for (const file of files) {
  const before = parse(execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' }))
  const after = parse(readFileSync(file, 'utf8'))
  for (const path of differences(before, after, '')) found.add(`${file}:${path}`)
}
let failed = 0
for (const entry of found) {
  const ok = expected.has(entry)
  console.log(`${ok ? 'expected' : 'UNEXPECTED'}: ${entry}`)
  if (!ok) failed++
}
for (const entry of expected) {
  if (!found.has(entry)) {
    console.log(`MISSING (expected to change, did not): ${entry}`)
    failed++
  }
}
console.log(`${files.length} files compared, ${found.size} values differ, ${failed} problems.`)
process.exit(failed === 0 ? 0 : 1)
```

`$SCRATCH/p5/comment-only.py`:

<!-- prettier-ignore -->
```python
"""Usage: py -3 comment-only.py <base-ref> [--allow <substring>]... [-- <pathspec>...]

Fails when the working tree's change against <base-ref> (limited to <pathspec>, default the whole
tree) touches a code line that is not a comment. Code files: .ts .mjs .js .scala .sbt .java .rs
.toml .ps1 .sh (YAML is checked by yaml-same.mjs instead: there a comment can sit inside a value).
A changed line, added or removed, passes when, stripped, it is empty or starts with //, /*, *, */ or
#; or when it contains one of the --allow substrings. Pass the old text and the new text of each
string literal the sweep rewrites on purpose. Prints every offending line; exit 1 if any.
"""
import subprocess
import sys

CODE = ('.ts', '.mjs', '.js', '.scala', '.sbt', '.java', '.rs', '.toml', '.ps1', '.sh')
COMMENT = ('//', '/*', '*', '*/', '#')

args = sys.argv[1:]
base = args.pop(0)
allowed, paths = [], []
while args:
    arg = args.pop(0)
    if arg == '--allow':
        allowed.append(args.pop(0))
    elif arg == '--':
        paths, args = args, []
    else:
        sys.exit(f'unexpected argument: {arg}')
diff = subprocess.run(['git', 'diff', '-U0', base, '--', *paths], capture_output=True, text=True,
                      encoding='utf-8', check=True).stdout
bad = []
current = None
for line in diff.splitlines():
    if line.startswith('+++ ') or line.startswith('--- '):
        if line.startswith('+++ '):
            current = line[6:] if line.startswith('+++ b/') else None
        continue
    if current is None or not current.endswith(CODE) or line[:1] not in '+-':
        continue
    text = line[1:].strip()
    if text == '' or text.startswith(COMMENT) or any(a in text for a in allowed):
        continue
    bad.append(f'{current}: {line}')
for entry in bad:
    print(entry)
print(f'{len(bad)} changed code lines are not comments.')
sys.exit(1 if bad else 0)
```

`$SCRATCH/p5/rename-notes.py`:

<!-- prettier-ignore -->
```python
"""Usage: py -3 rename-notes.py   (from the repository root)

Renames the Notes named after the retired build CLI, everywhere they are cited, and resizes the
`=====` underline below each renamed Note's own header to the header's length. A citation broken
across a line end (`[Engine` / `Bundle Without ./run]`) is not matched; the sweep's grep finds it.
"""
import pathlib
import re
import subprocess

RENAMES = {
    'Engine Bundle Without ./run': 'The Engine Bundle',
    'Engine Distribution Without ./run': 'The Engine Distribution Build',
    'JVM Tests Without ./run': 'The JVM Test Steps',
    'Release Without ./run': 'Where The Release Logic Lives',
    'Standard Library Tests Without ./run': 'The Standard Library Suites',
}
files = subprocess.run(['git', 'grep', '-lF', 'Without ./run]', '--', '.', ':!docs/superpowers'],
                       capture_output=True, text=True, check=True).stdout.split()
for name in files:
    path = pathlib.Path(name)
    lines = path.read_text(encoding='utf-8').split('\n')
    for i, line in enumerate(lines):
        renamed = line
        for old, new in RENAMES.items():
            renamed = renamed.replace(f'[{old}]', f'[{new}]')
        lines[i] = renamed
        header = re.match(r'^(\s*#\s*)(Note \[[^]]+\])\s*$', renamed)
        if (renamed != line and header and i + 1 < len(lines)
                and re.match(r'^\s*#\s*=+\s*$', lines[i + 1])):
            lines[i + 1] = header.group(1) + '=' * len(header.group(2))
    path.write_text('\n'.join(lines), encoding='utf-8', newline='')
    print(f'rewrote {name}')
```

`$SCRATCH/p5/pattern.txt` (one line; it matches `./run`, `run.cmd`, `run.ps1`,
`run.sh`, `build_tools`, the crate names and the CLI's variables, and not
`./run.ts` imports or the `enso-build-scripts` User-Agent):

```
build_tools|(^|[^./a-zA-Z])\./run([^.a-zA-Z_]|\.($|[[:space:]])|$)|\brun\.(cmd|ps1|sh)\b|enso-build-(cli|ci-gen|macros|base)|enso-build([^-a-z]|$)|enso_build|\bide[-_]ci\b|ENSO_BUILD_CLI_BIN|ENSO_BUILD_SKIP_VERSION_CHECK
```

`$SCRATCH/p5/launcher-pattern.txt` (one line; the standalone launcher, not the
engine runner):

```
ensoup|launcher-shims|LauncherShims|buildLauncherDistribution|launcherDistributionRoot|launcher-manifest|engine/launcher|org\.enso\.launcher|distribution/launcher|UpgradeSpec|launcher_version_log|fallback-launcher|launcher-cli\.md|launcher\.md|createLauncherPackage|makeBundles|makePackages
```

Write the two pattern files with `printf '%s\n' '<pattern>' > <file>` so that no
editor adds a second line.

- [ ] **Step 4: Record the baseline**

```bash
P=$(cat "$SCRATCH/p5/pattern.txt"); L=$(cat "$SCRATCH/p5/launcher-pattern.txt")
git -C /c/Repos/Enso/ide grep -cE "$P" origin/develop -- . ':!build_tools' ':!run' ':!run.cmd' ':!run.ps1' ':!docs/superpowers' | wc -l
git -C /c/Repos/Enso/ide grep -cE "$L" origin/develop -- . ':!engine/launcher' ':!docs/superpowers' ':!build_tools' | wc -l
gh run list --branch develop --limit 30 --json databaseId,workflowName,conclusion,createdAt \
  --jq '.[] | "\(.createdAt)\t\(.conclusion)\t\(.workflowName)\t\(.databaseId)"'
```

**Do not check out anything in `C:\Repos\Enso\ide`** (the user's checkout): the
greps read `origin/develop` directly. Expected: about 77 files for the build-CLI
pattern and about 33 for the launcher pattern (counted on 2026-10-24 with #346
merged into develop locally; a few more or fewer is fine, the final greps are
what matter). Write `$SCRATCH/baseline.md`: the two counts, and for each of ✨
Engine, ✨ GUI, ✨ IDE, ✨ WASM, Build Scripts and Workflow Lint the latest
develop run's id and conclusion, with the failing job's name for any that is not
green. Nothing is committed in this task.

---

### Task 1: `ide-local`, and `ide-build` on shared packaging code (PR 5a)

**Files:**

- Create: `tools/build-scripts/src/ide-build/packageIde.ts`
- Create: `tools/build-scripts/src/ide-build/ideLocal.ts`,
  `tools/build-scripts/src/ide-build/ideLocal.test.ts`
- Create: `tools/build-scripts/src/commands/ide-local.ts`
- Modify: `tools/build-scripts/src/commands/ide-build.ts` (rewrite),
  `tools/build-scripts/src/lib/sbt.ts` (add `runSbt`),
  `tools/build-scripts/package.json` (the `ide-local` script),
  `tools/build-scripts/CLAUDE.md` (the Commands bullet)

**Interfaces:**

- Consumes: `ideBuildVariables`, `latestBundledEngine`, `packagingSteps`,
  `retryDelays`, `targetOs` (`src/ide-build/ideBuild.ts`); `capture`,
  `commandArguments`, `REPO_ROOT`, `runInherited` (`src/lib/repo.ts`); `osName`,
  `archName` (`src/lib/engine.ts`); `repositoryVersions`
  (`src/version/repository.ts`); `Versions`, `Version`, `version`
  (`src/version/version.ts`); `SBT_ENV`, `sbtArguments` (`src/lib/sbt.ts`).
- Produces:
  - `packageIde.ts`: `distDir(name: 'gui' | 'backend' | 'ide'): string`,
    `installWorkspace(): void`, `commitHash(): string`,
    `interface PackageOptions { version: Version; sign: boolean; install: boolean }`,
    `packageIde(options: PackageOptions): void`;
  - `ideLocal.ts`: `ENGINE_BUNDLE_COMMAND = 'buildEngineBundle'`,
    `engineBundleDir(repoRoot, version, platform, arch): string`,
    `engineBuildEnv(env, versions: Versions): NodeJS.ProcessEnv`,
    `msvcProblem(platform, env): string | null`,
    `guiBuildArgs(mode: string): string[]`,
    `guiBuildEnv(env, version: string, commitHash: string): NodeJS.ProcessEnv`;
  - `sbt.ts`: `runSbt(command: string, env: NodeJS.ProcessEnv): number`;
  - the script `ide-local` (`node src/commands/ide-local.ts`), options
    `--mode <vite mode>` (default `production`).

- [ ] **Step 1: Create the branch**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-5a -b build/phase5-replacements origin/develop
cd /c/Repos/Enso/ide-bs-5a && corepack pnpm install --frozen-lockfile --ignore-scripts
cd tools/build-scripts && corepack pnpm run test:unit 2>&1 | grep -E 'Tests '
```

Expected: `179 passed`.

- [ ] **Step 2: Write the failing test**

`tools/build-scripts/src/ide-build/ideLocal.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file `ide-local`'s inputs: the bundle path, sbt's and the GUI's environments, the MSVC check. */
import path from 'node:path'
import { expect, test } from 'vitest'
import { version } from '../version/version.ts'
import {
  ENGINE_BUNDLE_COMMAND,
  engineBuildEnv,
  engineBundleDir,
  guiBuildArgs,
  guiBuildEnv,
  msvcProblem,
} from './ideLocal.ts'

test('the bundle is where EngineBundle.root puts it', () => {
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'linux', 'x64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-linux-amd64', 'enso'),
  )
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'win32', 'x64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-windows-amd64', 'enso'),
  )
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'darwin', 'arm64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-macos-aarch64', 'enso'),
  )
})

test('sbt builds the bundle incrementally', () => {
  expect(ENGINE_BUNDLE_COMMAND).toBe('buildEngineBundle')
})

test('sbt gets the version triple and a native launcher, unless the caller chose one', () => {
  const versions = { version: version('2026.1.1-dev'), releaseMode: false }
  expect(engineBuildEnv({ PATH: '/bin' }, versions)).toEqual({
    PATH: '/bin',
    ENSO_VERSION: '2026.1.1-dev',
    ENSO_EDITION: '2026.1.1-dev',
    ENSO_RELEASE_MODE: 'false',
    ENSO_LAUNCHER: 'native',
  })
  expect(engineBuildEnv({ ENSO_LAUNCHER: '' }, versions).ENSO_LAUNCHER).toBe('native')
  expect(engineBuildEnv({ ENSO_LAUNCHER: 'shell' }, versions).ENSO_LAUNCHER).toBe('shell')
  expect(engineBuildEnv({ ENSO_VERSION: 'stale' }, versions).ENSO_VERSION).toBe('2026.1.1-dev')
})

test('only Windows needs the MSVC developer environment', () => {
  expect(msvcProblem('linux', {})).toBeNull()
  expect(msvcProblem('darwin', {})).toBeNull()
  expect(msvcProblem('win32', { VCToolsRedistDir: 'C:\\VS\\Redist\\MSVC\\14.44\\' })).toBeNull()
  expect(msvcProblem('win32', {})).toContain('VCToolsRedistDir is not set')
  expect(msvcProblem('win32', { VCToolsRedistDir: '' })).toContain('vcvars64.bat')
})

test('the GUI is built in the requested mode, with the version and commit', () => {
  expect(guiBuildArgs('production')).toEqual(['run', 'build:gui', '--mode=production'])
  expect(guiBuildEnv({ PATH: '/bin' }, '2026.1.1-dev', 'abc123')).toEqual({
    PATH: '/bin',
    ENSO_IDE_VERSION: '2026.1.1-dev',
    ENSO_IDE_COMMIT_HASH: 'abc123',
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run:
`cd tools/build-scripts && corepack pnpm exec vitest run src/ide-build/ideLocal.test.ts`
Expected: FAIL, `Failed to resolve import "./ideLocal.ts"`.

- [ ] **Step 4: Write `ideLocal.ts`**

<!-- prettier-ignore -->
```ts
/**
 * @file `ide-local`'s inputs: the IDE built from this checkout's sources, start to finish. The
 * engine bundle comes from sbt's `buildEngineBundle`, the GUI from `build:gui`, and both are copied
 * into `dist/` afresh before the packaging, so an installer never carries an engine or a GUI left
 * over from an earlier build.
 */
import path from 'node:path'
import { archName, osName } from '../lib/engine.ts'
import type { Versions } from '../version/version.ts'

/** The sbt command that builds the engine bundle. No `clean`: a local build is incremental. */
export const ENGINE_BUNDLE_COMMAND = 'buildEngineBundle'

/**
 * The bundle `buildEngineBundle` leaves (`EngineBundle.root` in `project/EngineBundle.scala`):
 * `built-distribution/engine-bundle-<version>-<os>-<arch>/enso`.
 */
export function engineBundleDir(
  repoRoot: string,
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const triple = `${version}-${osName(platform)}-${archName(arch)}`
  return path.join(repoRoot, 'built-distribution', `engine-bundle-${triple}`, 'enso')
}

/**
 * sbt's environment for the bundle: the version triple, as the `version` command publishes it, and
 * `ENSO_LAUNCHER=native` (what the IDE ships, and CI's packaging passes) unless the caller set one.
 */
export function engineBuildEnv(env: NodeJS.ProcessEnv, versions: Versions): NodeJS.ProcessEnv {
  const launcher = env.ENSO_LAUNCHER ?? ''
  return {
    ...env,
    ENSO_VERSION: versions.version.text,
    ENSO_EDITION: versions.version.text,
    ENSO_RELEASE_MODE: String(versions.releaseMode),
    ENSO_LAUNCHER: launcher !== '' ? launcher : 'native',
  }
}

/**
 * Why the engine bundle cannot be built in this environment, or `null`. On Windows the native
 * images link with MSVC, and `MsvcRuntime` copies the runtime DLLs from `VCToolsRedistDir`, which
 * only a Visual Studio developer environment sets.
 */
export function msvcProblem(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  if (platform !== 'win32' || (env.VCToolsRedistDir ?? '') !== '') return null
  return (
    'VCToolsRedistDir is not set. Run this from a Visual Studio "Developer PowerShell" or ' +
    '"x64 Native Tools Command Prompt" (or after vcvars64.bat): the engine bundle\'s native images ' +
    'need the MSVC environment.'
  )
}

/** The GUI build: `build:gui` in a Vite mode (CI builds `production`). */
export function guiBuildArgs(mode: string): string[] {
  return ['run', 'build:gui', `--mode=${mode}`]
}

/** The GUI build's environment: the version and commit it shows, as `ide-build` gives the IDE. */
export function guiBuildEnv(
  env: NodeJS.ProcessEnv,
  version: string,
  commitHash: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    ENSO_IDE_VERSION: version,
    ENSO_IDE_COMMIT_HASH: commitHash,
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `corepack pnpm exec vitest run src/ide-build/ideLocal.test.ts` Expected:
PASS, 5 tests.

- [ ] **Step 6: Move the packaging into `packageIde.ts`**

Create `tools/build-scripts/src/ide-build/packageIde.ts` (the body of today's
`commands/ide-build.ts`, as functions):

<!-- prettier-ignore -->
```ts
/**
 * @file Packaging the IDE from `dist/gui` and `dist/backend` into `dist/ide`: the step that
 * `ide-build` (CI) and `ide-local` (a developer's whole build) share.
 */
import path from 'node:path'
import { capture, REPO_ROOT, runInherited } from '../lib/repo.ts'
import type { Version } from '../version/version.ts'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
} from './ideBuild.ts'

/** `dist/<name>` under the repository: the packaging's inputs (`gui`, `backend`) and output (`ide`). */
export function distDir(name: 'gui' | 'backend' | 'ide'): string {
  return path.join(REPO_ROOT, 'dist', name)
}

/** Blocks for `ms` milliseconds. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** `corepack pnpm install`, retried five times. */
export function installWorkspace(): void {
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
export function commitHash(): string {
  const fromCi = process.env.GITHUB_SHA ?? ''
  if (fromCi !== '') return fromCi
  const head = capture('git', ['rev-parse', '--verify', 'HEAD'])
  if (head.status !== 0) throw new Error(`\`git rev-parse --verify HEAD\` failed: ${head.stderr}`)
  return head.stdout.trim()
}

/** How {@link packageIde} runs. */
export interface PackageOptions {
  readonly version: Version
  /** Sign the installer (release only). */
  readonly sign: boolean
  /** Run `corepack pnpm install` first; a caller that has just installed passes `false`. */
  readonly install: boolean
}

/**
 * Runs `build:ide` and `dist:ide` over `dist/gui` and `dist/backend`, with the variables
 * electron-builder reads, leaving the installer and its `.sha256` in `dist/ide`. Throws when a step
 * fails, or when `dist/backend` holds no engine.
 */
export function packageIde(options: PackageOptions): void {
  const backendDir = distDir('backend')
  console.log(
    `Packaging IDE ${options.version.text} with engine ${latestBundledEngine(backendDir)}.`,
  )
  if (options.install) installWorkspace()
  const variables = ideBuildVariables(
    {
      version: options.version,
      commitHash: commitHash(),
      os: targetOs(process.platform),
      sign: options.sign,
      guiDir: distDir('gui'),
      ideDir: distDir('ide'),
      backendDir,
    },
    process.env,
  )
  for (const step of packagingSteps(variables, process.env)) {
    const status = runInherited('corepack', ['pnpm', ...step.args], {
      env: step.env,
    })
    if (status !== 0) {
      throw new Error(`\`corepack pnpm ${step.args.join(' ')}\` failed (exit ${status}).`)
    }
  }
}
```

Replace the whole of `tools/build-scripts/src/commands/ide-build.ts` with:

<!-- prettier-ignore -->
```ts
/**
 * @file `ide-build`: packages the IDE from `dist/gui` and `dist/backend` into `dist/ide`, as CI's
 * packaging jobs do once other jobs have built the GUI and the engine bundle. The version is the
 * `version` command's (so `ENSO_VERSION` overrides it). Pass `--sign` to sign (release only). To
 * build both from this checkout first, use `ide-local`.
 *
 *     corepack pnpm --filter build-scripts run ide-build
 */
import { parseArgs } from 'node:util'
import { packageIde } from '../ide-build/packageIde.ts'
import { commandArguments } from '../lib/repo.ts'
import { repositoryVersions } from '../version/repository.ts'

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { sign: { type: 'boolean', default: false } },
  })
  packageIde({
    version: repositoryVersions().version,
    sign: values.sign,
    install: true,
  })
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

`ide-build` behaves exactly as before (D1): the same log line, install, steps,
errors and exit code. It does not import `src/lib/sbt.ts`, so the packaging job
still needs no `setup-jvm`.

- [ ] **Step 7: Add `runSbt` to `src/lib/sbt.ts`**

Change the import line `import { invocation } from './repo.ts'` to
`import { invocation, runInherited } from './repo.ts'`, and insert before
`/** Stops a process started by {@link spawnSbt} and everything it started. */`:

<!-- prettier-ignore -->
```ts
/**
 * Runs `sbt <command>` in the repository to completion, with this process's output, and returns
 * its exit status (-1 when sbt cannot start).
 */
export function runSbt(command: string, env: NodeJS.ProcessEnv): number {
  return runInherited('sbt', sbtArguments(command), {
    env: { ...env, ...SBT_ENV },
  })
}
```

- [ ] **Step 8: Write the command**

`tools/build-scripts/src/commands/ide-local.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `ide-local`: builds the IDE installer from this checkout, start to finish. It builds the
 * engine bundle with sbt (`buildEngineBundle`, `ENSO_LAUNCHER=native` unless set), copies it to
 * `dist/backend`, installs the workspace, builds the GUI into `dist/gui`, and packages both into
 * `dist/ide`, as `ide-build` does in CI. `dist/backend`, `dist/gui` and `dist/ide` are replaced,
 * never reused. On Windows, run it from a Visual Studio developer prompt (the native images need
 * MSVC). Never run in CI: it starts sbt, so the workflow policy would require `setup-jvm` first.
 *
 *     corepack pnpm --filter build-scripts run ide-local [--mode <vite mode>]
 */
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ENGINE_BUNDLE_COMMAND,
  engineBuildEnv,
  engineBundleDir,
  guiBuildArgs,
  guiBuildEnv,
  msvcProblem,
} from '../ide-build/ideLocal.ts'
import { commitHash, distDir, installWorkspace, packageIde } from '../ide-build/packageIde.ts'
import { commandArguments, REPO_ROOT, runInherited } from '../lib/repo.ts'
import { runSbt } from '../lib/sbt.ts'
import { repositoryVersions } from '../version/repository.ts'

/** Replaces `target` with a copy of the directory `source`. */
function replaceWithCopy(source: string, target: string): void {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, verbatimSymlinks: true })
}

try {
  const { values } = parseArgs({
    args: commandArguments(),
    options: { mode: { type: 'string', default: 'production' } },
  })
  const problem = msvcProblem(process.platform, process.env)
  if (problem != null) throw new Error(problem)
  const versions = repositoryVersions()
  const version = versions.version.text
  console.log(`Building IDE ${version} from this checkout.`)

  const sbtStatus = runSbt(ENGINE_BUNDLE_COMMAND, engineBuildEnv(process.env, versions))
  if (sbtStatus !== 0) throw new Error(`sbt failed (exit ${sbtStatus}).`)
  const bundle = engineBundleDir(REPO_ROOT, version, process.platform, process.arch)
  if (!existsSync(bundle)) throw new Error(`sbt left no engine bundle at ${bundle}.`)
  replaceWithCopy(bundle, distDir('backend'))

  installWorkspace()
  const guiStatus = runInherited('corepack', ['pnpm', ...guiBuildArgs(values.mode)], {
    env: guiBuildEnv(process.env, version, commitHash()),
  })
  if (guiStatus !== 0) throw new Error(`The GUI build failed (exit ${guiStatus}).`)
  rmSync(distDir('gui'), { recursive: true, force: true })
  replaceWithCopy(path.join(REPO_ROOT, 'app', 'gui', 'dist'), path.join(distDir('gui'), 'assets'))

  rmSync(distDir('ide'), { recursive: true, force: true })
  packageIde({ version: versions.version, sign: false, install: false })
  console.log(`Done: the installer is in ${distDir('ide')}.`)
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

In `tools/build-scripts/package.json`, after
`"ide-build": "node src/commands/ide-build.ts",` add
`"ide-local": "node src/commands/ide-local.ts",`.

In `tools/build-scripts/CLAUDE.md`, in the `ide-build` bullet, replace its last
sentence (the one beginning "Locally: build the GUI into" and ending "to
dist/backend first.") with "Locally, use `ide-local`.", and add after the
bullet:

```markdown
- `ide-local [--mode <vite mode>]` — the whole IDE from this checkout: sbt
  `buildEngineBundle` (`ENSO_LAUNCHER=native` unless set; on Windows, from a
  Visual Studio developer prompt, which it checks), the bundle copied to
  `dist/backend`, `pnpm install`, `build:gui` into `dist/gui`, then
  `ide-build`'s packaging into `dist/ide`. It replaces `dist/backend`,
  `dist/gui` and `dist/ide` every time, so it never reuses an old engine bundle;
  the engine itself builds incrementally (`sbt clean` first for a clean one). It
  starts sbt, so it never runs in CI.
```

- [ ] **Step 9: Check the package**

The TypeScript blocks above are in the package's style (single quotes, no
semicolons); paste them as they are. Step 9's `prettier --write` is the
authority either way.

```bash
cd /c/Repos/Enso/ide-bs-5a
corepack pnpm exec prettier --write tools/build-scripts/src tools/build-scripts/package.json tools/build-scripts/CLAUDE.md
corepack pnpm exec prettier --check tools/build-scripts
cd tools/build-scripts && corepack pnpm run typecheck && corepack pnpm run lint && corepack pnpm run test:unit 2>&1 | grep -E 'Tests '
cd ../.. && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)'
```

Expected: Prettier clean; `tsc` and ESLint silent; `184 passed`;
`Workflow policy: OK`; `ℹ pass 98`, `ℹ fail 0`. (Verified on a scratch tree of
develop with #346 merged, 2026-10-24.)

- [ ] **Step 10: Commit**

```bash
git add tools/build-scripts
git commit -m "Build scripts: ide-local builds the IDE from the checkout; ide-build shares its packaging" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 2: Every caller and instruction off `./run` (PR 5a)

**Files:**

- Modify: `tools/build-scripts/src/stdlib-test/run.ts:86-89`,
  `tools/build-scripts/src/stdlib-test/run.test.ts:94,107`
- Modify: `.github/workflows/wasm-checks.yml:17,32,47`,
  `.github/workflows/ide-changed-files.yml:15-18,36`
- Delete: `tools/build-performance/` (one file, `bench-build.sh`)
- Modify: `tools/CLAUDE.md:9`, `docs/CONTRIBUTING.md`,
  `docs/distribution/nightly.md:42`, `test/Google_Test/README.md:9`,
  `.claude/skills/testing-and-evaluation/SKILL.md:29-30`,
  `app/electron-client/CLAUDE.md`, `internal/CLAUDE.md:14-17`,
  `engine/language-server/CLAUDE.md:50-56`

**Interfaces:**

- Consumes: `ide-local` (Task 1).
- Produces: the D2 message text, which `run.test.ts` asserts:
  `'cannot sign in to Enso Cloud'`; the job ids `native-test`, `lint`,
  `parser-wasm-test`.

- [ ] **Step 1: The cloud-credentials error (D2)**

In `tools/build-scripts/src/stdlib-test/run.test.ts`, change the test name
`'the cloud suites refuse cloud credentials, which still need ./run'` to
`'the cloud suites refuse cloud credentials'`, and its expectation
`).rejects.toThrow('Phase 4')` to
`).rejects.toThrow('cannot sign in to Enso Cloud')`. Run
`corepack pnpm exec vitest run src/stdlib-test/run.test.ts` in
`tools/build-scripts`: FAIL (the old message has no such text).

In `run.ts`, replace

<!-- prettier-ignore -->
```ts
      'Enso Cloud test credentials are set, but signing in to the cloud has not moved off `./run` ' +
        'yet (Phase 4): use `./run backend test` for the cloud suites.',
```

with

<!-- prettier-ignore -->
```ts
      'Enso Cloud test credentials are set, but stdlib-test cannot sign in to Enso Cloud: unset ' +
        `${CLOUD_VARIABLES.join(', ')} to run the cloud suites without the real cloud.`,
```

Run the test again: PASS. Then `corepack pnpm run typecheck`, `lint`,
`test:unit` (184 passed).

- [ ] **Step 2: The WASM job ids (D3)**

In `.github/workflows/wasm-checks.yml` rename the three job keys:
`enso-build-ci-gen-job-native-test-linux-amd64:` → `native-test:`,
`enso-build-ci-gen-job-wasm-lint-linux-amd64:` → `lint:`,
`enso-build-ci-gen-job-parser-wasm-test-linux-amd64:` → `parser-wasm-test:`.
Nothing refers to them (`git grep -n enso-build-ci-gen` prints only these three
lines before the edit); `wasm-pull-request.yml` needs the called workflow, not
its jobs. Check:
`node --input-type=module -e "$(cat "$SCRATCH/p5/yaml-same.mjs")" origin/develop .github/workflows/wasm-checks.yml`
reports `1 differ` (the keys), and nothing else changed:
`git diff -U0 .github/workflows/wasm-checks.yml | grep '^[-+] ' ` shows only the
three key lines on each side.

- [ ] **Step 3: The IDE path filter (D4)**

In `.github/workflows/ide-changed-files.yml`, replace the comment

```yaml
# The build and packaging plumbing of the IDE: the build script (`./run`, `build_tools/`), the
# toolchains, the dependency manifests and the workflows. GUI sources are covered by
```

with

```yaml
# The build and packaging plumbing of the IDE: the build scripts (`tools/build-scripts`; `./run` and
# `build_tools/` until build simplification Phase 5 deletes them), the toolchains, the dependency
# manifests and the workflows. GUI sources are covered by
```

and add `tools/build-scripts/**` on the line after `build_tools/**` in `files:`.
(5b deletes the `./run` half of the comment with the files.)

- [ ] **Step 4: Delete the dead benchmark script**

`tools/build-performance/bench-build.sh` drives
`./run.sh wasm build --wasm-profile`, a script and a command that no longer
exist. Delete the directory (`git rm -r tools/build-performance`) and, in
`tools/CLAUDE.md`, delete the bullet whose first words are "`build-performance/`
— Benchmark script". In the same file replace

```markdown
- `build-scripts/` — TypeScript package with the build logic that leaves `./run`
  (build simplification, Phase 3): `version` and the CI commands. Node runs it
  directly; see its CLAUDE.md.
```

with

```markdown
- `build-scripts/` — TypeScript package with the build logic: `version`,
  `toolchain-check`, `ide-local` (a developer's whole IDE build) and the CI
  commands. Node runs it directly; see its CLAUDE.md.
```

- [ ] **Step 5: `docs/CONTRIBUTING.md`**

Four edits.

1. In "System Requirements", replace the Flatbuffers bullet

   ```markdown
   - [Flatbuffers Compiler](https://google.github.io/flatbuffers) with version
     24.3.25. It is automatically downloaded when using the `run` command. For
     direct `sbt` usage, you can download the `flatc` binary from the
     [release assets](https://github.com/google/flatbuffers/releases/tag/v24.3.25).
   ```

   with

   ```markdown
   - [Flatbuffers Compiler](https://google.github.io/flatbuffers) at the version
     pinned as `toolchain.flatc` in [`build-config.yaml`](../build-config.yaml):
     download the `flatc` binary from the
     [release assets](https://github.com/google/flatbuffers/releases/tag/v24.3.25)
     and put it on your `PATH`.
   ```

   Delete the `7z`/`7za`/`7zz` bullet (only the build CLI used it) and the
   bullet "On Windows, the `run` command must be run in the latest version of
   `Powershell` or in `cmd`." After the corepack bullet add:

   ```markdown
   - To check what you have installed against the pinned versions, run
     `corepack pnpm install` once, then
     `corepack pnpm --filter build-scripts run toolchain-check`: it names each
     tool that differs and how to install the right one.
   ```

2. In "Getting Set Up (Rust)", replace

   ```markdown
   The Rust code in this repository (the parser, and the `./run` build CLI)
   builds
   ```

   with

   ```markdown
   The Rust code in this repository (the parser, its WASM build for the GUI and
   its JNI build for the engine) builds
   ```

   and replace the paragraph "With the tools listed above in place,
   `./run ide build` builds the IDE." with "sbt and `corepack pnpm install` run
   `cargo` themselves; you rarely need to."

3. Add an h3 section immediately before "### Running Enso from CLI" (after "###
   Building Enso Engine" and its h4 subsections; not before "#### Running IDE",
   which sits under "### Testing Enso Libraries"):

   ````markdown
   ### Building the IDE

   With the tools above installed, one command builds an installer from your
   checkout:

   ```bash
   enso$ corepack pnpm install
   enso$ corepack pnpm --filter build-scripts run ide-local
   ```

   It builds the engine bundle with `sbt buildEngineBundle`, the GUI with
   `corepack pnpm run build:gui`, and packages both with electron-builder into
   `dist/ide` (about an hour from a clean checkout). On Windows, run it from a
   Visual Studio "Developer PowerShell" or "x64 Native Tools Command Prompt":
   the engine's native images need the MSVC environment, and the command stops
   at once without it.

   The other build steps, each on its own:

   | Task                                                   | Command                                                        |
   | ------------------------------------------------------ | -------------------------------------------------------------- |
   | Package from an existing `dist/gui` and `dist/backend` | `corepack pnpm --filter build-scripts run ide-build`           |
   | The GUI only                                           | `corepack pnpm run build:gui`                                  |
   | The GUI's checks (lint, types, unit tests)             | `corepack pnpm run ci-check`                                   |
   | The engine bundle the IDE ships                        | `sbt buildEngineBundle` (with `ENSO_LAUNCHER=native`)          |
   | The engine distribution                                | `sbt buildEngineDistribution`                                  |
   | The engine's JVM tests                                 | `sbt test`                                                     |
   | One Standard Library suite                             | `corepack pnpm --filter build-scripts run stdlib-test <suite>` |
   | The Standard Library API check                         | `corepack pnpm --filter build-scripts run stdlib-api-check`    |
   | Benchmarks                                             | `sbt runtime-benchmarks/bench`, `sbt std-benchmarks/bench`     |
   | The parser's Java classes                              | `sbt syntax-rust-definition/compile`                           |
   | Enso syntax and lint checks                            | `sbt checkEnsoSyntax`, `sbt lintEnso`                          |
   | Formatting                                             | `corepack pnpm run format`, `cargo fmt`                        |
   | The WASM parser                                        | `corepack pnpm install` (its `postinstall` builds it)          |
   | Cleaning the working tree                              | `corepack pnpm run git-clean`                                  |
   | The version a build gets                               | `corepack pnpm --silent --filter build-scripts run version`    |
   ````

4. In "System Requirements", the `ensoup` Native Image bullet
   (`CONTRIBUTING.md:191`) is left for 5c, which rewrites it.

- [ ] **Step 6: The other documents**

- `docs/distribution/nightly.md:42`: replace "Build script automatically
  generates a new version for each nightly build, based" with "The release
  workflow (`promote.yml`, through `tools/build-scripts`' `release promote`)
  generates a new version for each nightly build, based" and re-wrap the
  paragraph with Prettier.
- `test/Google_Test/README.md`: replace the block

  ```bash
  enso$ ./run ide build
  enso$ ls ./dist/ide/enso-linux-*.AppImage
  ```

  with

  ```bash
  enso$ corepack pnpm --filter build-scripts run ide-local
  enso$ ls ./dist/ide/enso-linux-*.AppImage
  ```

- `.claude/skills/testing-and-evaluation/SKILL.md:29-30`: replace
  "(`--mode staging` option in case of `./run ide build` script)" with
  "(`--mode staging`, e.g.
  `corepack pnpm --filter build-scripts run ide-local --mode staging`)".
- `internal/CLAUDE.md:14-17`: replace "The `./run` (Cargo) build sets
  `ENSO_IDE_VERSION` / `ENSO_IDE_COMMIT_HASH` as env vars before the Vite build
  (`build_tools/build/src/ide/web.rs`);" with "The build sets `ENSO_IDE_VERSION`
  / `ENSO_IDE_COMMIT_HASH` as env vars before the Vite build
  (`tools/build-scripts`' `ide-build` and `ide-local`, `ideBuildVariables` in
  `src/ide-build/ideBuild.ts`);".
- `engine/language-server/CLAUDE.md:50-56`: replace the fenced block

  ```
  ./run backend test          # integration tests
  ./run backend bench         # benches
  ```

  with

  ```
  sbt language-server/test    # integration tests
  sbt language-server/bench   # benches
  ```

  and keep the "Or from SBT directly:" paragraph after it only if it then adds
  something; if it repeats the same commands, delete it.

- `app/electron-client/CLAUDE.md`:
  - lines 50-51 and 155-156: "chosen by `update_mode` in
    `build_tools/build/src/ide/web.rs`" and "set by `update_mode` in
    `build_tools/build/src/ide/web.rs`" → "chosen by `updateMode` in
    `tools/build-scripts/src/ide-build/ideBuild.ts`" (and "set by …" likewise);
  - replace the paragraph at lines 94-100 ("Currently driven by
    `./run ide build` … until build simplification Phase 5.") with:

    ```markdown
    Packaging is driven by `tools/build-scripts`: `ide-local` builds the engine
    bundle and the GUI from the checkout and packages them, and `ide-build`
    packages an existing `dist/gui` and `dist/backend` (what CI does). Don't
    call `electron-builder` or `pnpm run dist` by hand unless you're debugging
    packaging: those commands wire the engine bundle, the GUI and Electron
    together with the right env vars.
    ```

  - line 105: "(the Rust installer under `build_tools/install` was removed)" →
    "(the old Rust installer was removed)";
  - lines 116-120: replace "`./run ide build` defaults to
    `--backend-source build`, which compiles the engine from these sources.
    Reaching for `--backend-source release --backend-release latest` to skip
    that ~25 minute Scala build produces" with "`ide-local` always compiles the
    engine from these sources. Packaging a released engine instead (unpacking
    one into `dist/backend` and running `ide-build`) to skip that ~25 minute
    Scala build produces";
  - line 145: "once `./run ide build` has produced the engine bundle." → "once
    `ide-local` (or `sbt buildEngineBundle`) has produced the engine bundle.";
  - lines 150-152: "nothing reads it: `./run` and the `watch:*` scripts still
    set it" → "nothing reads it: the `watch:*` scripts still set it".

Run Prettier `--write` then `--check` on every Markdown file above.

- [ ] **Step 7: Check what is left**

```bash
cd /c/Repos/Enso/ide-bs-5a
P=$(cat "$SCRATCH/p5/pattern.txt")
git grep -nE "$P" -- docs/CONTRIBUTING.md docs/distribution test .claude app/electron-client/CLAUDE.md internal engine/language-server/CLAUDE.md tools/CLAUDE.md tools/build-scripts/src/stdlib-test/run.ts tools/build-scripts/src/stdlib-test/run.test.ts .github/workflows/wasm-checks.yml
```

Expected: only `tools/build-scripts/src/stdlib-test/run.ts`' two comment lines
(3 and 28, which Task 9 rewrites) and `tools/CLAUDE.md:22` ("belongs in
`build_tools/`", which Task 4 Step 8 rewrites when the directory goes).
`node tools/ci/check-workflows.mjs` → `Workflow policy: OK`; actionlint from WSL
clean.

- [ ] **Step 8: Commit**

```bash
git add -A tools .github docs test .claude app/electron-client/CLAUDE.md internal/CLAUDE.md engine/language-server/CLAUDE.md
git commit -m "Move the remaining callers and instructions off ./run" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 3: Prove `ide-local`, and PR 5a

**Files:** none beyond Tasks 1–2.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin build/phase5-replacements
```

Write `$SCRATCH/pr-5a.md`: what `ide-local` does and why it always replaces
`dist/backend` (the stale-engine trap); D1–D4 with their reasons; for D2, that
`extra-nightly-tests.yml` still passes the five `ENSO_CLOUD_*` values to
`stdlib-test` and keeps them on purpose: the fork defines none of them (so the
cloud suite runs without the real cloud, as now), and if someone defines all
five the suite fails at once with D2's message, as it already did with the old
one (Phase 4's Ticket 3 decides the suite's future); that 5b deletes
`build_tools/` and `run*` next; "Part of #289's Phase 5."; the attribution
lines. Then:

```bash
gh pr create --base develop --head build/phase5-replacements --label "CI: No changelog needed" \
  --title "Build simplification, PR 5a: ide-local, and nothing left that needs ./run" \
  --body-file "$SCRATCH/pr-5a.md"
"$SCRATCH/p5/wait-pr.sh" <N> 180   # run_in_background
```

Expected checks: Build Scripts, Workflow Lint, Changelog (label), ✨ Engine
(`tools/build-scripts/**`), ✨ IDE (`.github/**` and D4), ✨ WASM
(`.github/workflows/wasm*`), GUI checks (they run the build scripts' tests too).

- [ ] **Step 2: Build an installer on Windows with `ide-local`** (meanwhile)

The agent's shell is not a developer prompt: enter the MSVC environment through
`cmd` and `vcvars64.bat` (VS 18 Professional), and check that the Node on that
`PATH` is still the repository's (the user's notes record an nvm-windows
`run.cmd` trap and a stale MSVC `PATH` entry).

```bash
cd /c/Repos/Enso/ide-bs-5a
git submodule update --init --recursive
corepack pnpm install --frozen-lockfile
corepack pnpm --filter build-scripts run ide-local; echo "exit=$?"   # the guard
cmd //c '"C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul && node --version && corepack pnpm --version && where cl'
cmd //c '"C:\Program Files\Microsoft Visual Studio\18\Professional\VC\Auxiliary\Build\vcvars64.bat" >nul && corepack pnpm --filter build-scripts run ide-local > %TEMP%\ide-local-win.log 2>&1'
```

Expected: the bare run stops at once with `Error: VCToolsRedistDir is not set.`
and `exit=1`; the second command prints `v24.21.0`, the pinned pnpm and a
`cl.exe` path; the third runs for about an hour (`run_in_background`).

Expected: `Done: the installer is in C:\Repos\Enso\ide-bs-5a\dist\ide.`;
`dist\ide\enso-win-x64-<version>.exe` and its `.sha256` exist; the engine in
`dist\ide\win-unpacked\resources\enso\dist\<version>\` has today's timestamps
and `<version>` is the one `ide-local` printed. **Do not run the installer**
(Global Constraints).

- [ ] **Step 3: Build on Linux** (meanwhile, in WSL)

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && rm -rf ~/enso-p5 && git clone -q --branch build/phase5-replacements /mnt/c/Repos/Enso/ide-bs-5a ~/enso-p5 && cd ~/enso-p5 && git submodule update --init --recursive && corepack pnpm install --frozen-lockfile && corepack pnpm --filter build-scripts run ide-local > ~/ide-local-linux.log 2>&1; echo exit=$?; ls -la dist/ide/*.AppImage'
```

Expected: `exit=0`, one `enso-linux-x86_64-<version>.AppImage`. If the private
`app/gui/.dev-env` submodule cannot be fetched in WSL, record it and rely on the
Windows run plus CI's Linux packaging (which runs `ide-build`, the same
packaging code).

What Steps 2–3 do not cover: macOS (`ide-local` is untested there; CI never
packages the Mac from a PR), signing (`ide-local` never signs), and starting the
installed app (left to CI's smoke test and Package Tests).

- [ ] **Step 4: Merge on green**

When `wait-pr.sh` exits 0 and Steps 2–3 succeeded: `gh pr merge <N> --squash`.
If a check fails, apply "When a check fails".

---

### Task 4: Delete `build_tools/` and `run*`; shrink the workspace (PR 5b)

**Files:**

- Delete: `build_tools/`, `run`, `run.cmd`, `run.ps1`,
  `distribution/enso.bundle.template`
- Modify: `Cargo.toml`, `Cargo.lock`, `clippy.toml`, `build-config.yaml`,
  `.gitattributes:4-5`, `.gitignore:26`, `.prettierignore:6-7`,
  `.vscode/launch.json:37-42`
- Modify: `.github/workflows/engine-changed-files.yml:31,54`,
  `ide-changed-files.yml`, `wasm-changed-files.yml:33`, `gui-changed-files.yml`
  (both `files:` lists)
- Modify: `CLAUDE.md`, `.github/CLAUDE.md`, `lib/rust/CLAUDE.md:3-6`,
  `lib/rust/macro-utils/CLAUDE.md:3-6`, `tools/CLAUDE.md:22`,
  `app/gui/src/project-view/assets/CLAUDE.md:22-23`,
  `distribution/CLAUDE.md:20-21`

**Interfaces:**

- Consumes: 5a merged (no caller of `./run` remains).
- Produces: the workspace members `app/rust-ffi`, `lib/rust/launcher-shims`
  (until 5c), `lib/rust/macro-utils`, `lib/rust/metamodel`,
  `lib/rust/parser/debug`, `lib/rust/parser/debug/fuzz`,
  `lib/rust/parser/generate-java`, `lib/rust/parser/jni`,
  `lib/rust/parser/macros`, `lib/rust/parser/schema`,
  `lib/rust/parser/src/syntax/tree/visitor`, `lib/rust/prelude`,
  `lib/rust/prelude/macros`, `lib/rust/reflect`, `lib/rust/zst`.

- [ ] **Step 1: Create the branch and record the Rust baseline**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-5b -b build/phase5-delete origin/develop
cd /c/Repos/Enso/ide-bs-5b && corepack pnpm install --frozen-lockfile --ignore-scripts
git rev-parse HEAD > "$SCRATCH/p5/pre-deletion-commit.txt"
grep -c '^\[\[package\]\]' Cargo.lock
```

Expected: 506 packages. `pre-deletion-commit.txt` holds the develop commit 5b
starts from: the last one with `build_tools/`. It goes into 5b's PR body (Task 5
Step 4); Task 9 derives it again from 5b's merge commit, so it does not depend
on this scratch file surviving.

- [ ] **Step 2: Delete the files**

```bash
git rm -rq build_tools run run.cmd run.ps1 distribution/enso.bundle.template
```

- [ ] **Step 3: The workspace manifest**

In `Cargo.toml`, delete the two members `"build_tools/cli",` and
`"build_tools/macros/lib",`, and replace everything from
`[workspace.dependencies]` up to (not including) `[workspace.lints]` with:

```toml
[workspace.dependencies]
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# !!!!!!!!!! WARNING !!!!!!!!!!
# !!!!!!!!!!!!!!!!!!!!!!!!!!!!!
# We are trying to maintain a minimum set of dependencies. Before adding a new dependency, consult
# the core development team. Thank you!
boolinator = { version = "2.4.0" }
clap = { version = "4.6.7", features = [
	"derive",
	"env",
	"wrap_help",
	"string",
] }
console_error_panic_hook = { version = "0.1.7" }
convert_case = { version = "0.12.0" }
derive-where = "1.7.0"
derive_more = { version = "2.1.1", features = [
	"index",
	"index_mut",
	"deref",
	"deref_mut",
	"display",
	"from",
	"into",
	"as_ref",
	"add",
	"add_assign",
] }
proc-macro2 = { version = "1.0.107" }
quote = { version = "1.0.47" }
serde = { version = "1.0.229", features = ["derive", "rc"] }
serde_json = { version = "1.0.151", features = ["raw_value"] }
syn = { version = "3.0.6", features = [
	"full",
	"extra-traits",
	"printing",
	"parsing",
	"visit",
	"visit-mut",
] }

```

These eleven are exactly the `{ workspace = true }` dependencies of the
remaining members (checked crate by crate on 2026-10-24); the 35 others
(`octocrab`, `reqwest`, `rustls`, `tokio`, `windows`, `winreg`, …) and Note [TLS
Backend] served only `build_tools`. Versions and features are unchanged.

`clippy.toml` becomes the single line `type-complexity-threshold = 500` (the
`disallowed-methods` block guarded `reqwest`, which is gone).

- [ ] **Step 4: Shrink the lock without moving anything**

```bash
cp Cargo.lock "$SCRATCH/p5/Cargo.lock.before"
cargo metadata --format-version 1 > /dev/null
grep -c '^\[\[package\]\]' Cargo.lock
nv() { awk '/^name = /{n=$3} /^version = /{print n" "$3}' "$1" | sort; }
nv "$SCRATCH/p5/Cargo.lock.before" > "$SCRATCH/p5/nv.before"; nv Cargo.lock > "$SCRATCH/p5/nv.after"
echo "added or changed:"; comm -13 "$SCRATCH/p5/nv.before" "$SCRATCH/p5/nv.after"
echo "removed: $(comm -23 "$SCRATCH/p5/nv.before" "$SCRATCH/p5/nv.after" | wc -l)"
```

Expected: 141 packages; "added or changed:" followed by nothing; `removed: 365`.
`cargo metadata` only drops unused entries; never use `cargo update` or
`cargo generate-lockfile` here (they re-resolve versions).

- [ ] **Step 5: `build-config.yaml`**

Delete `wasm-size-limit: 16.20 MiB`, the blank line after it, and the whole
`required-versions:` block (the key and its three comment lines). Replace the
file's first line `# Options intended to be common for all developers.` with
`# Versions the build reads. Nothing here is installed by the build itself.`
Keep the `latest-release` comment and key and the `toolchain:` comment and block
byte for byte (`setup-jvm`'s awk, `tools/ci/toolchain-pins.mjs` and the
release's `withLatestRelease` read them).

Check: `node --test tools/ci/toolchain-pins.test.mjs` passes, and in
`tools/build-scripts`,
`corepack pnpm exec vitest run src/release src/version src/toolchain` passes.

- [ ] **Step 6: Editor, Git and Prettier settings**

- `.gitattributes`: delete the last two lines (the `run.cmd` comment and
  `/run.cmd text eol=crlf`).
- `.gitignore`: delete `/build_tools/rust/target/`.
- `.prettierignore`: delete the comment line "# Release body template should not
  be auto-formatted, …" and `build_tools/build/release-body.md`.
- `.vscode/launch.json`: delete the configuration object
  `{ "type": "lldb", "request": "launch", "name": "Rust ./run", "cargo": ["run", "-p", "enso-build-cli"], },`
  (the whole object, with its trailing comma).

- [ ] **Step 7: Path filters (D5)**

- `engine-changed-files.yml`: delete `build_tools/cli/**` (from `files:`) and
  `build_tools/**/CLAUDE.md` (from `files_ignore:`).
- `ide-changed-files.yml`: delete `build_tools/**`, `run`, `run.cmd` and
  `run.ps1` from `files:`, and replace the comment's first sentence with "The
  build and packaging plumbing of the IDE: the build scripts
  (`tools/build-scripts`), the toolchains, the dependency manifests and the
  workflows."
- `wasm-changed-files.yml`: delete `build_tools/**`.
- `gui-changed-files.yml` has two lists, kept in sync: the `files:` of step
  `gui-changed-files` (output `any_changed`, which the GUI checks read) and the
  `files:` of step `gui-changed-files-excluding-tests` (output
  `any_changed_excluding_tests`, which `ide-pull-request.yml` reads to decide
  packaging). In **both**, add these four lines after `lib/rust/**`, one glob
  per line, at the list's indentation:

  <!-- prettier-ignore -->
  ```yaml
              .cargo/**
              Cargo.lock
              Cargo.toml
              rust-toolchain.toml
  ```

  Above `jobs:`, extend the comment block with one line: "# The Rust files are
  here because the GUI build compiles the WASM parser through cargo." Check both
  lists with
  `node --input-type=module -e "$(cat "$SCRATCH/p5/yaml-same.mjs")" origin/develop --expect .github/workflows/gui-changed-files.yml:jobs.gui-changed-files.steps.1.with.files --expect .github/workflows/gui-changed-files.yml:jobs.gui-changed-files.steps.2.with.files .github/workflows/gui-changed-files.yml`
  (two expected differences, nothing else), and
  `grep -c '^            Cargo.lock$' .github/workflows/gui-changed-files.yml`
  prints `2`.

Check: `node tools/ci/check-workflows.mjs` → OK; actionlint clean (WSL).

- [ ] **Step 8: The documents that described what is now gone**

- `CLAUDE.md`:
  - delete the "Top-level layout" bullet "- `build_tools/` — The `./run` CLI
    (Rust). The end-to-end build orchestrator for the IDE/engine bundle.", and
    change the `tools/` bullet to "- `tools/` — Auxiliary dev tools: the build
    scripts (`tools/build-scripts`), the IGV plugin, the HTTP test helper, CI
    scripts, benchmark analysis.";
  - in "Build systems", change the Cargo bullet to:

    ```markdown
    - **Cargo** — only for the parser: the `[workspace]` in root `Cargo.toml`
      (the parser crates under `lib/rust/`, `parser/debug` and its fuzzer,
      `app/rust-ffi`, and `lib/rust/launcher-shims` until the standalone
      launcher goes). sbt and the pnpm `postinstall` run it for you.
    ```

    and replace the two paragraphs from "The `./run` (or `run.cmd` / `run.ps1`)
    script at the repo root dispatches" through "locally, `./run` keeps working
    until Phase 5." with:

    ```markdown
    There is no orchestrator above these: the Rust build CLI was removed in
    build simplification Phase 5
    (`docs/superpowers/specs/2026-10-20-build-simplification-design.md`). What
    needs more than one tool lives in `tools/build-scripts`
    (`corepack pnpm --filter build-scripts run <command>`): `ide-local` builds
    an installer from the checkout, `version` computes the version,
    `toolchain-check` compares a local toolchain with the pins, and the CI
    commands. CI calls sbt directly, with `.github/actions/setup-jvm` providing
    GraalVM, sbt, flatc and GraalPy. `docs/CONTRIBUTING.md` ("Building the IDE")
    lists the command for each build task.
    ```

  - delete the bullet "**`cargo test --workspace` has one guaranteed failure on
    Windows.** …" (all seven lines: the `ide-ci` tar test is gone, and the
    workspace passes on Windows, 172 tests);
  - replace "Worth doing for any dependency touching platform surface: `nix` is
    POSIX-only and cannot be compiled on Windows at all, while
    `windows`/`winreg` only compile on Windows — neither half is verifiable from
    one host alone." with "Worth doing for anything that touches platform
    surface: paths, processes, native images and file permissions behave
    differently on the two hosts."
- `.github/CLAUDE.md`:
  - first paragraph: "Every workflow is hand-written YAML: the Rust generator
    (`build_tools/ci-gen`) is retired (build simplification, Phase 1;" → "Every
    workflow is hand-written YAML (build simplification;";
  - "Composite actions keep the shell a step had" bullet: "and on Windows
    `./run` and `tar` behave differently under Git Bash." → "and on Windows
    `tar` behaves differently under Git Bash.";
  - replace the whole section "## What still goes through `./run`" (heading,
    paragraph and table) with:

    ```markdown
    ## Where the build logic lives

    Workflows call sbt directly for the engine, and `tools/build-scripts` for
    what needs more than one tool. A job that runs a distribution built by
    another job uses that job's version, from its outputs, not sbt's default
    `0.0.0-dev`: see Note [Lint Reads The Distribution's Version] in
    `engine-checks-platform.yml`.

    | Workflow › job                                           | Step                                                                                                       | Set up by                                        |
    | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
    | `formatting.yml`, `enso4igv.yml`                         | `sbt …`                                                                                                    | `setup-jvm`                                      |
    | `engine-benchmark.yml`                                   | `sbt runtime-benchmarks/bench` (`benchOnly <name>`)                                                        | `setup-jvm`                                      |
    | `std-libs-benchmark.yml`                                 | `sbt std-benchmarks/bench` (`benchOnly <name>`)                                                            | `setup-jvm`                                      |
    | `engine-checks-platform.yml` › Enso Code Lint            | `sbt lintEnso` (version from the build job), `sbt checkEnsoSyntax`                                         | `setup-jvm`                                      |
    | `engine-checks-platform.yml` › Build Engine Distribution | `version`, then `sbt "clean; all ciBuildEngineDistribution"`                                               | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
    | `engine-checks-platform.yml` › JVM Tests                 | `sbt …` steps                                                                                              | `setup-jvm`, `setup-msvc`                        |
    | `engine-checks-platform.yml` › API check                 | `corepack pnpm --filter build-scripts run stdlib-api-check`                                                | `setup-build-scripts`                            |
    | `engine-checks-platform.yml` › stdlib tests              | `corepack pnpm --filter build-scripts run stdlib-test <suite>`                                             | `setup-jvm` (GraalPy), `setup-build-scripts`     |
    | `changelog.yml`                                          | `actions/github-script` (`pulls.listFiles`)                                                                | —                                                |
    | `ide-packaging.yml` › Build Backend                      | `version`, then `sbt "clean; all buildEngineBundle"`                                                       | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
    | `ide-packaging.yml` › Package New IDE                    | `corepack pnpm --filter build-scripts run ide-build`                                                       | `setup-build-scripts`                            |
    | `release.yml`                                            | `release create-draft`, `upload-ide`, `publish`, `update-latest-version`; `buildEngineBundle`; `ide-build` | `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
    | `promote.yml`                                            | `release promote <designator>`                                                                             | `setup-build-scripts`                            |
    | `engine-checks-nightly.yml`, `macos-checks.yml`          | calls of `engine-checks-platform.yml`                                                                      | —                                                |
    | `extra-nightly-tests.yml`                                | `engine-checks-platform.yml`, then `stdlib-test <suite>`                                                   | `setup-jvm` (GraalPy), `setup-build-scripts`     |
    ```

- `lib/rust/CLAUDE.md:3-6`: "These are general-purpose Rust building blocks —
  the "tools" layer (`build_tools/`) and the parser-integration shim
  (`app/rust-ffi/`) live elsewhere but share the same workspace." → "These are
  the parser and its building blocks; the parser's WASM shim (`app/rust-ffi/`)
  lives elsewhere but shares the same workspace."
- `lib/rust/macro-utils/CLAUDE.md:3-6`: delete "`enso-build-macros-lib`, " from
  the list of users.
- `tools/CLAUDE.md:22`: "Don't put anything here that belongs in `build_tools/`
  (orchestration) or `engine/`/`lib/` (production code)." → "Don't put
  production code here: it belongs in `engine/` or `lib/`."
- `app/gui/src/project-view/assets/CLAUDE.md:22-23`: delete the sentence "A
  renamed or added font directory must also be listed in
  `build_tools/build/paths.yaml`."
- `distribution/CLAUDE.md:20-21`: delete the `enso.bundle.template` bullet.

Run Prettier `--write` then `--check` on every Markdown and YAML file above.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Delete build_tools and run*: the Rust workspace is the parser" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 5: Prove the deletion, and PR 5b

**Files:** none beyond Task 4.

- [ ] **Step 1: Rust on both hosts**

```bash
cd /c/Repos/Enso/ide-bs-5b
cargo fmt -- --check && echo FMT-OK
cargo test --workspace > "$SCRATCH/p5/cargo-win.log" 2>&1; echo "exit=$?"
grep -E '^test result' "$SCRATCH/p5/cargo-win.log" | awk '{s+=$4; f+=$6; n++} END {print n " suites, passed=" s ", failed=" f}'
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-5b && export CARGO_TARGET_DIR=$HOME/enso-target && cargo test --workspace > /tmp/p5-cargo.log 2>&1; echo "exit=$?"; grep -E "^test result" /tmp/p5-cargo.log | awk "{s+=\$4; f+=\$6; n++} END {print n \" suites, passed=\" s \", failed=\" f}"; cargo fmt -- --check && echo FMT-OK'
cargo clippy --workspace --all-targets 2>&1 | grep -E '^warning: `'
```

Expected: `FMT-OK` twice; `exit=0` and `55 suites, passed=172, failed=0` on both
hosts (Windows included: the `ide-ci` tar failure left with the crate); clippy
reports only `enso-parser`'s one existing warning (Ticket 2). All verified on a
scratch tree on 2026-10-24.

- [ ] **Step 2: The references are gone**

```bash
P=$(cat "$SCRATCH/p5/pattern.txt")
git grep -nE 'enso-build-cli|ENSO_BUILD_CLI_BIN|run\.cmd|run\.ps1|build_tools/' -- . ':!docs/superpowers' ':!CHANGELOG.md' ':!docs/libraries/sharing.md' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|#|/\*)'
git grep -lE "$P" -- . ':!docs/superpowers' | wc -l
```

Expected: the first command (every hit that is not a comment line) prints
nothing: no configuration, script or document still names the deleted files. The
second counts the files Tasks 8–10 still have (about 50: comments, plus
`CHANGELOG.md` and the allowlist of Decision 7).

- [ ] **Step 3: Policy and actionlint**

`node tools/ci/check-workflows.mjs` (`Workflow policy: OK`) and
`node --test tools/ci/*.test.mjs` (98 pass) on Windows and in WSL; actionlint
from WSL clean.

- [ ] **Step 4: Push, open the PR, merge on green**

```bash
git push -u origin build/phase5-delete
```

Write `$SCRATCH/pr-5b.md`: the deleted paths; the workspace before and after (17
→ 15 members, 506 → 141 locked packages, 46 → 11 workspace pins, none moved —
Step 4 of Task 4's comparison); D5; Decisions 3, 4, 8 and 11 in one line each;
the Rust results of Step 1; a line "Pre-deletion commit: <hash>" with the hash
from `$SCRATCH/p5/pre-deletion-commit.txt` (the last develop commit with
`build_tools/`, which 5d's pointer names); "Part of #289's Phase 5."; the
attribution lines.

```bash
gh pr create --base develop --head build/phase5-delete --label "CI: No changelog needed" \
  --title "Build simplification, PR 5b: delete build_tools and run*" --body-file "$SCRATCH/pr-5b.md"
"$SCRATCH/p5/wait-pr.sh" <N> 180   # run_in_background
```

Expected checks: ✨ WASM (`Cargo.*`: native tests, `cargo fmt`, the parser's
`wasm-pack` test), ✨ Engine (`Cargo.*`, `build-config.yaml`: sbt builds the JNI
parser with the new lock), ✨ IDE, ✨ GUI (D5: the WASM build with the new
lock), Workflow Lint, Build Scripts, Changelog. Merge on green
(`gh pr merge <N> --squash`).

What this does not cover: macOS (no PR job builds the parser on the Mac; the
lock only lost entries, so the Mac resolves the same versions; the next nightly
release, built on the Mac when it is online, is the first Mac build after it).

---

### Task 6: Remove the standalone launcher (PR 5c)

**Files:**

- Delete: `engine/launcher/` (84 files: sources, tests, `application.conf`, the
  native-image configuration under
  `src/main/resources/META-INF/native-image/org/enso/launcher`, test resources),
  `lib/rust/launcher-shims/`, `project/LauncherShimsForTest.scala`,
  `distribution/launcher/` (`README.md`, `.enso.bundle`, `THIRD-PARTY/`),
  `distribution/launcher-manifest.yaml`, `tools/legal-review/launcher/`,
  `docs/distribution/launcher.md`, `docs/distribution/launcher-cli.md`,
  `docs/distribution/fallback-launcher-release-infrastructure.md`
- Delete:
  `lib/scala/runtime-version-manager/src/main/scala/org/enso/runtimeversionmanager/runner/`
  (11 files), `…/cli/Arguments.scala`,
  `…/releases/engine/EngineRepository.scala`
- Modify: `build.sbt` (seven places, Step 3),
  `project/DistributionPackage.scala` (Step 4),
  `lib/scala/runtime-version-manager/src/main/java/module-info.java`,
  `…/locking/Resources.scala`
- Modify: `Cargo.toml:7`, `Cargo.lock`, `.gitignore:108`, `.prettierignore`
  (`distribution/launcher/THIRD-PARTY`),
  `tools/native-image-config-cleanup/index.js:7`,
  `.github/workflows/engine-checks-platform.yml:255`,
  `project/NativeImage.scala:574` (a comment), `project/Dependencies.scala`
  (Note [Engine And Launcher Version]),
  `engine/language-server/src/test/scala/org/enso/languageserver/websocket/json/BaseServerTest.scala:417`
  (a comment), `tools/legal-review/CLAUDE.md`,
  `lib/scala/logging-service/CLAUDE.md`
- Modify (docs): `docs/distribution/README.md`, `distribution.md`, `bundles.md`,
  `release-policy.md`, `licenses.md`, `docs/getting-enso.md`,
  `docs/infrastructure/README.md`, `native-image.md`, `logging.md`,
  `docs/libraries/sharing.md`, `docs/CONTRIBUTING.md`, `CLAUDE.md`,
  `engine/CLAUDE.md`, `engine/runner/CLAUDE.md`, `project/CLAUDE.md`,
  `lib/scala/CLAUDE.md`, `lib/rust/CLAUDE.md`, `distribution/CLAUDE.md`

**Interfaces:**

- Consumes: 5b merged.
- Produces: no sbt project `launcher`; no tasks `buildLauncherDistribution` or
  `launcherDistributionRoot`; no commands `makePackages`, `makeBundles`;
  `DistributionPackage.Builder(ensoVersion: String, artifactRoot: File)` with
  `artifactName`, `localPlatform`, `localArtifact` only; the Rust workspace of
  14 members.

What stays, and why (Decision 9): `lib/scala/cli` (the engine runner, the
language server and five more projects depend on it), `distribution-manager`
(`PortableDistributionManager` still detects an installed distribution by
`bin/ensoup`; Ticket 4), `editions`, `pkg`, `library-manager` (the runner's
`--upload` and the language server's publish handler use `LibraryUploader`),
`downloader`, `version-output`, `runtime-version-manager`'s `components`,
`config`, `releases` (minus `EngineRepository`), `locking` and `testing`
packages (its own tests, the runner's `JavaFinder` and the language server's
tests use them), `TestArchivePackager` (its tests' `FakeReleaseProvider`), the
engine runner (`bin/enso`, `enso.bat`, `enso.exe`, `ENSO_LAUNCHER`, its
`checkOutdatedLauncher`, which checks the runner's own native image), and the
engine manifest's `minimum-launcher-version` (`Manifest` requires the field).

- [ ] **Step 1: Create the branch**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-5c -b build/phase5-launcher origin/develop
cd /c/Repos/Enso/ide-bs-5c && corepack pnpm install --frozen-lockfile --ignore-scripts
L=$(cat "$SCRATCH/p5/launcher-pattern.txt")
git grep -lE "$L" -- . ':!engine/launcher' ':!docs/superpowers' > "$SCRATCH/p5/launcher-before.txt"; wc -l < "$SCRATCH/p5/launcher-before.txt"
```

Expected: about 32 files (Task 0's count; it already left `build_tools` out).

- [ ] **Step 2: Delete the launcher's files**

```bash
git rm -rq engine/launcher lib/rust/launcher-shims project/LauncherShimsForTest.scala \
  distribution/launcher distribution/launcher-manifest.yaml tools/legal-review/launcher \
  docs/distribution/launcher.md docs/distribution/launcher-cli.md \
  docs/distribution/fallback-launcher-release-infrastructure.md
R=lib/scala/runtime-version-manager/src/main/scala/org/enso/runtimeversionmanager
git rm -rq $R/runner $R/cli/Arguments.scala $R/releases/engine/EngineRepository.scala
```

- [ ] **Step 3: `build.sbt`**

1. `GatherLicenses.distributions`: delete the first entry

   ```scala
     Distribution(
       "launcher",
       file("distribution/launcher/THIRD-PARTY"),
       Distribution.sbtProjects(launcher)
     ),
   ```

2. The root project's `aggregate(…)` list: delete the line `    launcher,`.
3. The root project's settings: delete the block

   ```scala
     .settings(
       commands ++= {
         Seq(
           packageBuilder.value.makePackages,
           packageBuilder.value.makeBundles
         )
       }
     )
   ```

   and, in its `clean` override, the line
   `        launcherDistributionRoot.value,`.

4. `packageBuilder := { … }`: the constructor becomes

   ```scala
     new DistributionPackage.Builder(
       ensoVersion  = ensoVersion,
       artifactRoot = artifactRoot
     )
   ```

5. Delete the whole `lazy val launcher = project` definition: from that line
   down to and including its last line (the `.dependsOn` on `version-output`),
   which sits just before the definition of the `distribution-manager` project.
   That is about 90 lines: the native image `ensoup`, and the `Test / test` and
   `Test / testOnly` overrides that depend on `buildNativeImage` and
   `LauncherShimsForTest.prepare()`.
6. Delete
   `lazy val launcherDistributionRoot = settingKey[File]("Root of built launcher distribution")`
   and its setting
   `launcherDistributionRoot := packageBuilder.value.localArtifact("launcher") / "enso"`.
7. Delete
   `lazy val buildLauncherDistribution = taskKey[Unit]("Builds the launcher distribution")`
   and its `buildLauncherDistribution := { … }` body (ten lines).

Then
`git grep -nwE 'launcher|LauncherShimsForTest|buildLauncherDistribution|launcherDistributionRoot|makePackages|makeBundles' build.sbt`
must print only lines about the engine runner (`ENSO_LAUNCHER`, "native
launcher" in `buildEngineBundle`'s description, `GraalVM.EnsoLauncher`). Read
each remaining line and confirm.

- [ ] **Step 4: `project/DistributionPackage.scala`**

- Delete
  `def createLauncherPackage(distributionRoot: File, cacheFactory: CacheStoreFactory): Unit = { … }`.
- In `class Builder`: the parameters become
  `(ensoVersion: String, val artifactRoot: File)`; delete `extractZip`,
  `listZip`, `extractTarGz`, `extract`, `graalArchive`, `copyGraal`,
  `copyEngine`, `makeExecutable`, `fixLauncher`, `makeArchive` (with its
  `COPYFILE_DISABLE` comment), `builtArtifact`, `builtArchive`,
  `cleanDirectory`, `makePackages` and `makeBundles`. Keep `artifactName`,
  `localPlatform` and `localArtifact`.
- Remove imports the deletions leave unused (`scala.sys.process.*` pieces,
  `ProcessLogger`) only if scalac then warns about them; check with the compile
  in Task 7.

Check:
`git grep -nE 'builtArtifact|builtArchive|makeArchive|fixLauncher|copyEngine|copyGraal|graalArchive' -- build.sbt project`
prints nothing.

- [ ] **Step 5: `runtime-version-manager`, the shims and the small entries**

- `module-info.java`: delete `exports org.enso.runtimeversionmanager.cli;` and
  `exports org.enso.runtimeversionmanager.runner;`.
- `locking/Resources.scala`: delete the `LauncherExecutable` case object and its
  doc comment (8 lines).
- Then confirm nothing used what went:
  `git grep -nE 'runtimeversionmanager\.(runner|cli)\b|EngineRepository|LauncherExecutable' -- '*.scala' '*.java'`
  prints nothing.
- `Cargo.toml`: delete the member `"lib/rust/launcher-shims",`; then
  `cargo metadata --format-version 1 > /dev/null` and check that the lock lost
  exactly one package (`launcher-shims`) and changed nothing else (the `nv`
  comparison of Task 4 Step 4: "added or changed:" empty, `removed: 1`).
- `.gitignore`: delete `/ensoup`. `.prettierignore`: delete
  `distribution/launcher/THIRD-PARTY`.
- `tools/native-image-config-cleanup/index.js:7`: delete the array entry
  `'../../engine/launcher/src/main/resources/META-INF/native-image/org/enso/launcher',`.
- `.github/workflows/engine-checks-platform.yml:255`: "# `sbt test` builds
  native images on Windows too (the launcher's and os-environment's tests)." →
  "# `sbt test` builds native images on Windows too (os-environment's tests)."

- [ ] **Step 6: The documents**

The engine runner (`bin/enso`, the "native launcher") is a different thing:
leave every mention of it. Edit only what describes `ensoup`, the launcher
distribution or its upgrade:

- `docs/distribution/README.md`: delete the three index entries for
  `launcher.md`, `launcher-cli.md` and
  `fallback-launcher-release-infrastructure.md`.
- `docs/distribution/distribution.md`: delete the paragraph citing "The
  [universal launcher](./launcher.md)" and the "[plugins](./launcher.md#…)"
  sentence; remove the two `ensoup` lines from the layout trees (lines 60 and
  117).
- `docs/distribution/bundles.md`: delete the "`ensoup` Bundles" section and its
  table-of-contents entry.
- `docs/distribution/release-policy.md`: delete the S3 note citing
  `fallback-launcher-release-infrastructure.md` (line 19), the paragraph on the
  `launcher-manifest.yaml` asset (around lines 170-197) and the "[Workflow]"
  link at line 260; where a sentence then loses its subject, rephrase it to the
  engine and the IDE.
- `docs/distribution/licenses.md`: drop "launcher" from the list of
  distributions with a licence package (the engine and the libraries remain).
- `docs/getting-enso.md:17`: "These assets contain bundles that include the
  `ensoup` updater, an engine" → describe the IDE installers and the engine
  bundle the release publishes now (read the paragraph; keep it short).
- `docs/infrastructure/README.md:17`: drop "used for building the `ensoup`
  native binary" (keep the runner's).
- `docs/infrastructure/native-image.md`: change line 14 to "Native Image is used
  for building the `enso` executable"; delete the "`ensoup` Configuration"
  section, its contents entry, the `native-image-agent` command for
  `engine/launcher` (line 113) and the "`ensoup` Portability" sentence (line
  68).
- `docs/infrastructure/logging.md`: delete the `launcher` row (line 140) and
  change "via `ensoup` or" (line 282) to drop the `ensoup` alternative.
- `docs/libraries/sharing.md:77-85`: replace the `ensoup publish-library`
  instructions with

  ````markdown
  Then you can use the `enso` runner to upload the project:

  ```bash
  enso --upload <URL> --in-project <path to project root>
  ```

  Pass `--auth-token <token>` (or set `ENSO_AUTH_TOKEN`) if the repository needs
  authentication, and `--hide-progress` to suppress progress bars.
  ````

  (the options are `UPLOAD_OPTION`, `IN_PROJECT_OPTION`, `AUTH_TOKEN` and
  `HIDE_PROGRESS` in `engine/runner/src/main/java/org/enso/runner/Main.java`;
  confirm `AUTH_TOKEN`'s long name there before writing it).

- `docs/CONTRIBUTING.md:191-196`: "If you want to be able to build the `ensoup`
  Native Image, you will need" → "If you want to be able to build the `enso`
  Native Image (`ENSO_LAUNCHER=native`), you will need".
- `CLAUDE.md` (Build systems, the Cargo bullet from Task 4): delete ", and
  `lib/rust/launcher-shims` until the standalone launcher goes".
- `engine/CLAUDE.md`: delete the `launcher/` bullet (line 23), and change line
  16's "(`enso` / `ensoup` command)" to "(`enso` command)".
- `engine/runner/CLAUDE.md:30`: "`enso`/`ensoup` commands" → "`enso` command".
- `project/CLAUDE.md:15-16`: "Native Image task definitions for the launcher and
  `ensoup`." → "Native Image task definitions (the `enso` runner, the ydoc
  server and the tests' images)."
- `project/NativeImage.scala:574`: the comment "…, which is a crucial Launcher
  functionality." refers to the standalone launcher's downloads; read the
  paragraph and reword it for what the setting still does (comment only).
- `lib/scala/CLAUDE.md`: line 5 drop "and launcher" from the list of sharers;
  line 25 "used by launcher and runner" → "used by the runner and the language
  server".
- `lib/rust/CLAUDE.md`: delete the `launcher-shims/` bullet.
- `distribution/CLAUDE.md`: delete the `launcher/` and `launcher-manifest.yaml`
  bullets.
- `tools/legal-review/CLAUDE.md:4`: drop the `launcher` review directory from
  its list.
- `lib/scala/logging-service/CLAUDE.md:4`: drop the launcher from the users of
  `LoggingSetupHelper` (read the line; keep the runner and the language server).
- `project/Dependencies.scala`, Note [Engine And Launcher Version]: rename it
  Note [Engine Version] (the citation at `val ensoVersion` too) and drop the
  sentences about the launcher sharing the engine's version; a comment-only
  change.
- `engine/language-server/src/test/scala/org/enso/languageserver/websocket/json/BaseServerTest.scala:417`:
  the comment that mentions the launcher; reword it for what the test does
  (comment only).

Run Prettier on every Markdown file touched.

- [ ] **Step 7: Nothing names the launcher any more**

```bash
L=$(cat "$SCRATCH/p5/launcher-pattern.txt")
git grep -nE "$L" -- . ':!docs/superpowers' ':!CHANGELOG.md' ':!app/gui/integration-test/mock/data/latestGithubReleases.json'
```

Expected: exactly one line,
`lib/scala/distribution-manager/src/main/scala/org/enso/distribution/DistributionManager.scala:411:      OS.executableName("ensoup")`
(the portable-mode detection that stays, Decision 7: **do not touch it**).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Remove the standalone launcher (ensoup), its packaging, shims and docs" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 7: Prove the launcher's removal, the nightly, and PR 5c

**Files:** none beyond Task 6.

- [ ] **Step 1: sbt loads, compiles and compiles the tests, on Linux**

sbt over `/mnt/c` is slow; use a Linux clone:

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && rm -rf ~/enso-p5c && git clone -q --branch build/phase5-launcher /mnt/c/Repos/Enso/ide-bs-5c ~/enso-p5c && cd ~/enso-p5c && corepack pnpm install --frozen-lockfile && sbt "-Dsbt.server.autostart=false" "projects; compile; Test/compile; verifyLicensePackages; scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck" > ~/p5c-sbt.log 2>&1; echo exit=$?; grep -E "\[error\]|\[warn\].*(unused|never used)" ~/p5c-sbt.log | head -40'
```

Run with `run_in_background` (about 40 minutes). Expected: `exit=0`; the
`projects` listing has no `launcher`; no `[error]`. Read every `unused` warning
that names `DistributionPackage.scala` or `runtime-version-manager` and remove
what it names (then re-run the failing part). `verifyLicensePackages` is the
release's licence check (D7): it must pass without the launcher distribution.

- [ ] **Step 2: The same on Windows**

```bash
cd /c/Repos/Enso/ide-bs-5c
sbt "-Dsbt.server.autostart=false" "compile; Test/compile; verifyLicensePackages" > "$SCRATCH/p5/p5c-sbt-win.log" 2>&1; echo exit=$?
```

Expected: `exit=0`. Do not run `sbt test` locally (Global Constraints: the JVM
tests run in CI; the Standard Library tests never run here).

- [ ] **Step 3: Rust**

`cargo test --workspace` on both hosts as in Task 5 Step 1. Expected: `exit=0`
and 172 passed; fewer suites than 5b's 55, because `launcher-shims`' library and
its five binaries each had an empty one. Record the exact figures.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin build/phase5-launcher
```

Write `$SCRATCH/pr-5c.md`: what was removed (Task 6's Files) and what stays and
why (Task 6's "What stays"); D6, D7; Decision 9; the local results of Steps 1–3;
that it **merges only after the user's engine nightly from this branch**; Ticket
4; what it does not verify (root CLAUDE.md: "say which of these a change did not
verify"): `bloopInstall` (the BSP configuration for Metals and IntelliJ), the
shape of the `gatherLicenses` report (only `verifyLicensePackages` ran), and the
engine runner's native image without the `runner` and `cli` packages, which only
CI's IDE packaging (`buildEngineBundle` with `ENSO_LAUNCHER=native`) builds;
"Part of #289's Phase 5."; the attribution lines.

```bash
gh pr create --base develop --head build/phase5-launcher --label "CI: No changelog needed" \
  --title "Build simplification, PR 5c: remove the standalone launcher" --body-file "$SCRATCH/pr-5c.md"
"$SCRATCH/p5/wait-pr.sh" <N> 240   # run_in_background
```

Expected checks: ✨ Engine (Linux and Windows: the engine distribution, JVM
tests, lint, API check, the Standard Library suites), ✨ IDE (packaging, the
Windows smoke test and the Linux Package Tests), ✨ WASM (`Cargo.*`), ✨ GUI
(`Cargo.*`, D5), Workflow Lint, Changelog. Compare the JVM Tests jobs' durations
with `$SCRATCH/baseline.md`: they should be shorter (D6).

- [ ] **Step 5: STOP — ask the user to dispatch the engine nightly**

Tell the user: "5c changes what `sbt test` runs on every platform. Please start
the engine nightly from the branch:
`gh workflow run engine-checks-nightly.yml --ref build/phase5-launcher` (with
the Mac online, if you want its leg to run)." Wait for their reply, then:

```bash
id=$(gh run list --workflow engine-checks-nightly.yml --branch build/phase5-launcher -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/p5/wait-run.sh" "$id" 360   # run_in_background
```

Expected: green on Linux, Windows, Linux with Oracle GraalVM and (if online)
macOS. A failing leg: compare with the last develop run of the same workflow
before blaming the PR.

- [ ] **Step 6: Check that installed projects still start**

In the PR run, open the Linux "Package New IDE" job's "Run Package Tests" log
and the Windows "Smoke-test the installer" step:

```bash
gh run view <ide-run-id> --log --job <linux package job id> | grep -E "passed|failed|project" | tail -20
```

Expected: the Package Tests pass (they start the packaged app and open a
project); the smoke test starts the app.

- [ ] **Step 7: Merge**

When the PR checks and the nightly are green: `gh pr merge <N> --squash`.

What 5c's checks do not cover: the release path (`release.yml` is not run; its
`verifyLicensePackages` step is covered by Steps 1–2, its `buildEngineBundle` by
IDE packaging); macOS when the Mac is offline; a user who still has an `ensoup`
from an upstream release (nothing in the IDE calls it; the engine runner does
not need it); `sbt test` locally (CI only).

---

### Task 8: The history notes in `.github` (PR 5d, part 1)

**Files:** comments, plus four YAML values that hold history text:

- `.github/CLAUDE.md`
- `.github/actions/setup-jvm/action.yml` (its `description:`, line 5, and
  `inputs.edition.description`, line 19, are YAML values)
- `.github/actions/setup-msvc/action.yml` (its `description:`, lines 2–6, is a
  YAML value)
- `.github/workflows/{build-scripts, changelog, engine-benchmark, engine-checks-nightly, engine-checks-platform, extra-nightly-tests, ide-packaging, macos-checks, macos-pull-request, release}.yml`
  (`engine-checks-platform.yml:278`, `# ./run reset the JUnit directory…`, is a
  shell comment inside the `run:` script of step 9 of `jvm-tests`, "Generate the
  parser's Java sources", so it is part of a YAML value too)

**Interfaces:**

- Consumes: 5c merged.
- Produces: the Note names `[The Engine Bundle]`,
  `[The Engine Distribution Build]`, `[The JVM Test Steps]`,
  `[Where The Release Logic Lives]`, `[The Standard Library Suites]`, used by
  Tasks 9 and 10 wherever a Note is cited.

**The rules** (Ruling R1; the same for Tasks 8–10). The sweep is mechanical: it
removes dangling references, it does not restructure.

1. **`./run` becomes "the retired build CLI"** in place: "as `./run` did" → "as
   the retired build CLI did"; "`./run`'s …" → "the retired build CLI's …";
   "`./run backend test <suite>`" → "the retired build CLI's
   `backend test <suite>`". Keep the sentence, its facts and its reason.
2. **Paths into `build_tools/` lose the path**:
   "`build_tools/build/src/release.rs` (`draft_a_new_release`)" → "the retired
   build CLI's `release.rs` (`draft_a_new_release`)". Function names stay; they
   are searchable at the pointer commit (Task 9 Step 2).
3. **Note bullet lists keep their facts and their shape**: "What `./run` did for
   each job, and where it went:" → "What the retired build CLI did for each job,
   and where it went:". Do not rewrite them into another form.
4. **Re-wrap only the paragraph you touched**, to the file's width (100 columns
   here), in its comment style.

- [ ] **Step 1: Create the branch and list the work**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-5d -b build/phase5-sweep origin/develop
cd /c/Repos/Enso/ide-bs-5d && corepack pnpm install --frozen-lockfile --ignore-scripts
P=$(cat "$SCRATCH/p5/pattern.txt")
git grep -cE "$P" -- . ':!docs/superpowers' ':!CHANGELOG.md' ':!docs/libraries/sharing.md' | tee "$SCRATCH/p5/sweep-before.txt"
git grep -n 'Without ./run]' -- . ':!docs/superpowers'
```

Expected: about 50 files, all in Tasks 8–10's file lists (on 2026-10-24's tree
`engine-checks-platform.yml` had 26 hits, `tools/build-scripts/CLAUDE.md` 10). A
file on no list is a reference 5a–5c missed: add it to the task whose directory
it is in.

- [ ] **Step 2: Rename the Notes**

```bash
py -3 "$SCRATCH/p5/rename-notes.py"
git grep -n 'Without ./run' -- . ':!docs/superpowers'
```

Expected: it rewrites `.github/CLAUDE.md`, `engine-checks-platform.yml`,
`extra-nightly-tests.yml`, `ide-packaging.yml`, `release.yml`; the grep then
prints one line, `release.yml:73` (a citation broken over two lines: "(Note
[Engine" / "Bundle Without ./run] there)"). Fix it by hand to "(Note [The Engine
Bundle] there)" and re-wrap the comment to 100 columns.

- [ ] **Step 3: Rewrite the `.github` hits**

Apply the rules to every hit in `.github` (`git grep -nE "$P" -- .github`),
including the three `description:` texts and the `run:` script's comment (rule
1: "# The retired build CLI reset the JUnit directory before the tests; stale
reports would be published.").

- [ ] **Step 4: Check that only comments and the four values changed**

```bash
base=$(git merge-base HEAD origin/develop)
node --input-type=module -e "$(cat "$SCRATCH/p5/yaml-same.mjs")" "$base" \
  --expect .github/actions/setup-jvm/action.yml:description \
  --expect .github/actions/setup-jvm/action.yml:inputs.edition.description \
  --expect .github/actions/setup-msvc/action.yml:description \
  --expect .github/workflows/engine-checks-platform.yml:jobs.jvm-tests.steps.9.run \
  $(git diff --name-only "$base" -- '.github/*.yml' '.github/*.yaml')
git diff "$base" -- .github/workflows/engine-checks-platform.yml | grep -A2 -B2 'JUnit directory'
git grep -nE "$P" -- .github
```

Expected: `4 values differ, 0 problems` (no `UNEXPECTED`, no `MISSING`); the
`run:` diff is the one comment line; the last grep prints nothing. Then
`node tools/ci/check-workflows.mjs` (`Workflow policy: OK`), actionlint (WSL),
`corepack pnpm exec prettier --check .github`.

- [ ] **Step 5: Commit**

```bash
git add .github
git commit -m "Sweep, part 1: the .github comments no longer describe ./run" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 9: The history notes in `tools/` (PR 5d, part 2)

**Files:** `tools/build-scripts/CLAUDE.md`, `tools/build-scripts/package.json`
(the description), `tools/build-scripts/src/**` (24 files), and
`tools/ci/{check-workflows.mjs, check-workflows.test.mjs, toolchain-pins.mjs}`.

**Interfaces:**

- Consumes: Task 8's Note names; 5b's PR (its merge commit's parent is the
  pointer commit).
- Produces: the pointer commit in `tools/build-scripts/CLAUDE.md`, which Task 10
  relies on.

- [ ] **Step 1: The non-comment strings in `tools/`**

These, and only these, change code text:

| File                                                           | Old                                                                                                  | New                                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tools/build-scripts/src/stdlib-api-check/apiCheck.test.ts:34` | `test("the failure message is ./run's", () => {`                                                     | `test('the failure message names the library and the diff', () => {`                               |
| `tools/build-scripts/src/ide-build/ideBuild.test.ts:57`        | `test("the children's variables, as ./run set them for a PR build", () => {`                         | `test("the children's variables for a PR build", () => {`                                          |
| `tools/build-scripts/src/stdlib-test/suites.test.ts:44`        | `describe('selection, as ./run selected', () => {`                                                   | `describe('selection', () => {`                                                                    |
| `tools/ci/check-workflows.test.mjs:536`                        | `"./run backend sbt '--' verifyLicensePackages",`                                                    | `"some-tool sbt '--' verifyLicensePackages",`                                                      |
| `tools/ci/check-workflows.test.mjs:543`                        | `'time ./run backend get',`                                                                          | `'time some-tool get',`                                                                            |
| `tools/build-scripts/package.json:5`                           | `"description": "The build logic that leaves ./run: version, toolchain-check and the CI commands.",` | `"description": "The build logic: version, toolchain-check, the IDE builds and the CI commands.",` |

Then run the three test files (`corepack pnpm exec vitest run <file>` in
`tools/build-scripts`) and `node --test tools/ci/check-workflows.test.mjs`.

- [ ] **Step 2: The pointer commit**

The commit before 5b's deletion is the parent of 5b's squash merge; derive it
from GitHub, not from a scratch file (it is also in 5b's PR body):

```bash
merge=$(gh pr list --state merged --head build/phase5-delete --json mergeCommit --jq '.[0].mergeCommit.oid')
PRE=$(git rev-parse "$merge^")
git cat-file -e "$PRE:build_tools/CLAUDE.md" && echo "pointer commit $PRE has build_tools"
git cat-file -e "$merge:build_tools/CLAUDE.md" 2>/dev/null || echo "and its child does not"
```

Expected: both lines print. Check that `$PRE` equals the "Pre-deletion commit"
in 5b's PR body.

Replace `tools/build-scripts/CLAUDE.md`'s first paragraph with the following,
`<PRE>` being the full hash:

```markdown
# tools/build-scripts

The build logic that needs more than one tool (build simplification; the spec is
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`). TypeScript
that Node runs as it is (type stripping): each command is
`node src/commands/<name>.ts`, started from anywhere with
`corepack pnpm --filter build-scripts run <name>`.

Several commands and sbt tasks reproduce what the retired Rust build CLI did,
quirks included; their comments say so where it matters. That CLI's sources are
in Git at `<PRE>`: `git ls-tree -r --name-only <PRE> | grep '\.rs$'` lists them,
and `git show <PRE>:<path>` prints one.
```

and change its "Port, do not improve" convention to "**Keep the behaviour CI
relies on.** A command that reproduces the retired build CLI keeps its quirks
unless a PR names the difference."

- [ ] **Step 3: Rewrite the `tools/` comments**

Apply Task 8's rules to every hit under `tools/` (`git grep -nE "$P" -- tools`).

- [ ] **Step 4: Check that only comments and the six strings changed**

```bash
base=$(git merge-base HEAD origin/develop)
py -3 "$SCRATCH/p5/comment-only.py" "$base" \
  --allow "the failure message is ./run's" --allow "the failure message names the library and the diff" \
  --allow "the children's variables, as ./run set them" --allow "the children's variables for a PR build" \
  --allow "describe('selection, as ./run selected'" --allow "describe('selection', () => {" \
  --allow "./run backend sbt '--' verifyLicensePackages" --allow "some-tool sbt '--' verifyLicensePackages" \
  --allow "time ./run backend get" --allow "time some-tool get" \
  -- tools
git diff "$base" -- '*.json' | grep '^[-+] '
git grep -nE "$P" -- tools
```

Expected: `0 changed code lines are not comments.`; the JSON diff is the
`package.json` description, one line each way; the last grep prints nothing.
Then in `tools/build-scripts`: `typecheck`, `lint`, `test:unit` (184 passed);
`node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs` (98)
on both hosts; `corepack pnpm exec prettier --check tools/build-scripts`.

- [ ] **Step 5: Commit**

```bash
git add tools
git commit -m "Sweep, part 2: the build scripts and the policy no longer describe ./run" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 10: The rest, and the final greps (PR 5d, part 3)

**Files:** `build.sbt`,
`project/{EngineBundle, EngineDistributionChecks, EnsoSyntaxCheck, MsvcRuntime, Dependencies}.scala`,
`lib/scala/runtime-version-manager/…/releases/testing/TestArchivePackager.scala`,
`app/electron-client/buildInfo.ts`,
`app/electron-client/electron-builder-config.ts`, and whatever Task 8 Step 1
listed that is in none of Tasks 8–10's directories.

**Interfaces:**

- Consumes: Task 8's Note names; Task 9's pointer commit.
- Produces: the programme's final greps.

- [ ] **Step 1: The two sbt task descriptions**

| File                                            | Old                                                                             | New                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `build.sbt` (`buildEngineBundle`'s description) | ``… engine-bundle-<version>-<os>-<arch>/enso, as `./run backend get` did. " +`` | `… engine-bundle-<version>-<os>-<arch>/enso. " +`             |
| `build.sbt` (`checkEnsoSyntax`'s description)   | ``"`./run libraries check-syntax`; see project/EnsoSyntaxCheck.scala."``        | `"the Enso syntax check; see project/EnsoSyntaxCheck.scala."` |

Find them with the command below (the line numbers moved in 5c), and read the
sentence around each so that it still reads correctly.

```bash
git grep -nF -e 'as `./run backend get` did' -e '`./run libraries check-syntax`' build.sbt
```

- [ ] **Step 2: Comments the pattern cannot see, and the rest**

Apply Task 8's rules to every remaining hit
(`git grep -nE "$P" -- . ':!docs/superpowers' ':!CHANGELOG.md' ':!docs/libraries/sharing.md'`),
and also to two mentions the pattern misses:

- `app/electron-client/electron-builder-config.ts:365`: "electron-builder never
  uploads: the build CLI does" → "electron-builder never uploads:
  `tools/build-scripts`' `release upload-ide` does".
- `project/Dependencies.scala:62-63`: "used by the Rust build script via regex
  matching" → name the readers that remain: "read by
  `tools/ci/toolchain-pins.mjs` (the workflow policy's pin check) and by
  developers' WSL toolchain scripts, by regex matching" (read the comment first;
  keep its warning about the format).

- [ ] **Step 3: Check that only comments and the two descriptions changed**

```bash
base=$(git merge-base HEAD origin/develop)
py -3 "$SCRATCH/p5/comment-only.py" "$base" \
  --allow 'as `./run backend get` did. "' --allow 'engine-bundle-<version>-<os>-<arch>/enso. "' \
  --allow '`./run libraries check-syntax`; see project/EnsoSyntaxCheck' --allow 'the Enso syntax check; see project/EnsoSyntaxCheck' \
  -- build.sbt project lib app
```

Expected: `0 changed code lines are not comments.` Then compile what changed:
`sbt "-Dsbt.server.autostart=false" "projects; runtime-version-manager/Test/compile"`
loads the build (it compiles `project/` and `build.sbt`) and the one Scala
source; `corepack pnpm --filter enso run typecheck` for `app/electron-client`;
Prettier `--check` on the two TypeScript files.

- [ ] **Step 4: The final greps**

```bash
P=$(cat "$SCRATCH/p5/pattern.txt"); L=$(cat "$SCRATCH/p5/launcher-pattern.txt")
git grep -nE "$P" -- . ':!docs/superpowers' ':!CHANGELOG.md'
git grep -nE "$L" -- . ':!docs/superpowers' ':!CHANGELOG.md'
git ls-files | grep -E '^(build_tools/|run$|run\.cmd$|run\.ps1$|engine/launcher/|lib/rust/launcher-shims/)'
```

Expected, exactly (Decision 7):

- the first grep prints one line,
  `docs/libraries/sharing.md:59:- [build_tools/build/src/engine/edition.rs](https://github.com/enso-org/enso/blob/607b33414f94e77746c3880c417b5ebd523ad9f6/build_tools/build/src/engine/edition.rs).`
  (an upstream permalink);
- the second prints the three lines of
  `app/gui/integration-test/mock/data/latestGithubReleases.json` (recorded API
  data) and
  `lib/scala/distribution-manager/src/main/scala/org/enso/distribution/DistributionManager.scala`'s
  `OS.executableName("ensoup")` (kept on purpose: do not touch it);
- the `ls-files` check prints nothing.

Anything else is a miss: fix it under the rules.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Sweep, part 3: the build, project and app comments no longer describe ./run" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DeWeRfNarvWR4LBYCUZHYx"
```

---

### Task 11: PR 5d

**Files:** none beyond Tasks 8–10.

- [ ] **Step 1: Push, open, merge on green**

```bash
git push -u origin build/phase5-sweep
```

Write `$SCRATCH/pr-5d.md`: Task 8's rules; the Note renames; the string tables
of Task 9 Step 1 and Task 10 Step 1; the outputs of the three checks (Task 8
Step 4, Task 9 Step 4, Task 10 Step 3) and of the final greps with their allowed
results; the pointer commit; "Part of #289's Phase 5."; the attribution lines.

```bash
gh pr create --base develop --head build/phase5-sweep --label "CI: No changelog needed" \
  --title "Build simplification, PR 5d: the comments no longer describe ./run" --body-file "$SCRATCH/pr-5d.md"
"$SCRATCH/p5/wait-pr.sh" <N> 240   # run_in_background
```

Expected checks: ✨ Engine (`project/`, `build.sbt`, `lib/`), ✨ IDE
(`.github/**`, `app/electron-client/**`), ✨ GUI (`app/**`), Build Scripts,
Workflow Lint, Changelog. They prove only that the comments broke nothing; the
three checks are the real proof. Merge on green.

---

### Task 12: Close out Phase 5

**Files:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md` on
the design branch (status line).

- [ ] **Step 1: Check develop**

```bash
git -C /c/Repos/Enso/ide fetch origin
P=$(cat "$SCRATCH/p5/pattern.txt"); L=$(cat "$SCRATCH/p5/launcher-pattern.txt")
git -C /c/Repos/Enso/ide grep -cE "$P" origin/develop -- . ':!docs/superpowers' ':!CHANGELOG.md'
git -C /c/Repos/Enso/ide grep -cE "$L" origin/develop -- . ':!docs/superpowers' ':!CHANGELOG.md'
git -C /c/Repos/Enso/ide show origin/develop:Cargo.toml | sed -n '/members/,/]/p'
```

Expected: `docs/libraries/sharing.md:1`; then
`app/gui/integration-test/mock/data/latestGithubReleases.json:3` and
`lib/scala/distribution-manager/src/main/scala/org/enso/distribution/DistributionManager.scala:1`;
the 14 members (`app/rust-ffi` and the 13 under `lib/rust`).

- [ ] **Step 2: Watch the first nightly release after 5b and 5c**

If `nightly.yml` is enabled, after the next 02:00 UTC run:

```bash
nid=$(gh run list --workflow nightly.yml -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/p5/wait-run.sh" "$nid" 300
```

Expected: green, including the macOS build when the Mac is online (the first Mac
parser build on the shrunk lock). If it fails, compare with the previous nightly
before blaming Phase 5, and tell the user. If `nightly.yml` is disabled, say so
in the close-out comment instead; do not enable it.

- [ ] **Step 3: Record and tidy**

- Mark the spec's status line "Phase 5 complete <date>" on the design branch
  (one-line commit, plain push).
- Comment on #289: the four PR links, the nightly runs (Task 7's dispatch and
  Step 2's), "Phase 5 complete; the build-simplification programme is done", and
  the "Tickets to raise" list below (for the user to file; do not file them).
- Update the user's memory note `local-windows-installer-build.md`: its
  `cargo run -p enso-build-cli -- ide build …` recipe no longer exists; the
  recipe is now `ide-local` from a `vcvars64.bat` environment (Task 3 Step 2),
  and its traps 1 and 3 (a stale `dist/backend`; nvm's `run.cmd`) are gone.
- Remove the worktrees `ide-bs-5a` … `ide-bs-5d` with
  `git -C /c/Repos/Enso/ide worktree remove <dir>` once their branches have
  merged, and the WSL clones `~/enso-p5`, `~/enso-p5c`.

---

## Tickets to raise

Found while planning; out of Phase 5's scope. Do not raise them; list them in
the close-out comment for the user.

1. **Add a clippy job.** With `build_tools` gone the workspace has one clippy
   warning (`result_large_err` in `enso-parser`, lib and test). Fix it and add
   `cargo clippy --workspace --all-targets -- -D warnings` to `wasm-checks.yml`;
   then correct the root CLAUDE.md's "There is no clippy job".
2. **`.cargo/config.toml` explains `crt-static` with the removed installer.**
   Check what still needs the static CRT and `rust-lld` on Windows (the JNI
   `enso_parser.dll`, loaded by the engine without the VC++ redistributable?)
   and reword the comment, or drop the setting.
3. **The macOS DMG scripts are Bazel-era.**
   `app/electron-client/macos/build-dmg.mjs` (`macos:build-dmg`) stages the app
   with `bazel run //app/electron-client:stage_bazel_macos_app`, which no longer
   exists; only `--app <path>` works. Delete the scripts, or port them to
   electron-builder's output together with Phase 4's Ticket 5 (signing). The Mac
   signing path also still shells out to `7za`
   (`app/electron-client/tasks/signArchivesMacOs.ts:246`), which 5a drops from
   `CONTRIBUTING.md`'s requirements; document it there if signing comes back.
4. **`runtime-version-manager` is now mostly test-only.** After 5c, outside its
   own tests only `engine/runner`'s `JavaFinder` (`GraalRuntime`,
   `GraalVMVersion`, `GraalVersionManager`) and the language server's tests
   (`FakeEnvironment`, `TestableThreadSafeFileLockManager`) use it. The rest
   (`RuntimeVersionManager`, the release providers, `Manifest`'s
   `minimum-launcher-version`, `InstallerKind.Launcher`,
   `PortableDistributionManager`'s `ensoup` detection, `locking-test-helper`)
   served the launcher and the old project manager. Shrink it to what is used,
   with the tests that cover that.
5. **`lib/scala/project-manager` holds one Java file** (`EmptyProjectManager`)
   and a README, and is not an sbt project. Check whether anything loads it,
   then delete it or say why it stays.
6. **The GUI's mock release data names upstream assets.**
   `app/gui/integration-test/mock/data/latestGithubReleases.json` is a recorded
   `enso-org/enso` release with `launcher-manifest.yaml`; refresh it from a fork
   release when the update tests next change.

## Rulings

From the independent review of 2026-10-24 and the user's answers to its open
questions.

1. **R1: the sweep (5d) stays, done mechanically.** The Notes are renamed in
   full; `build_tools/…` paths become "the retired build CLI's `x.rs`" with one
   pointer commit; the test names and descriptions are renamed. "As `./run` did"
   becomes "as the retired build CLI did" in place: paragraphs and Note bullet
   lists keep their facts and shape (Task 8's rules).
   - **Why:** after 5b the comments cite files that do not exist, but their
     reasons still matter; restructuring them would risk losing the why for
     little gain.
2. **R2: the sweep is three tasks (8: `.github`; 9: `tools/`; 10: the rest),
   each with its own checks**, then one PR (Task 11).
   - **Why:** about 200 hits in about 50 files is too much for one subagent's
     context, and checks that run only at the end find mistakes late.
3. **R3: the proof scripts judge what they can.** `comment-only.py` checks added
   and removed lines of non-YAML code, and passes a rewritten string only by its
   old and new text (`--allow`). `yaml-same.mjs` checks YAML by value, and a
   value that holds history text (an action's `description:`, a comment inside a
   `run:` script) must be named with `--expect`.
4. **R4: `DistributionManager.scala`'s `ensoup` stays and is allowlisted** in
   every launcher grep (Decision 7). It is the runner's portable-mode detection;
   changing it belongs to Ticket 4.
5. **R5: the pointer commit is derived, not remembered.** It is the parent of
   5b's squash merge (Task 9 Step 2), and 5b's PR body records it too.
6. **R6: `runtime-version-manager`'s deeper cut is Ticket 4, not 5c.** It would
   rewrite `RuntimeVersionManagerSpec` and decide the engine manifest's
   `minimum-launcher-version`, a format question; 5c deletes only what nothing
   references.
7. **R7: the GUI path filter gains the Rust files in both lists**, one glob per
   line (Decision 4), rather than a one-off `CI: Build IDE` label on 5b.
8. **R8: `ide-local` is a command**, with the per-step table in
   `CONTRIBUTING.md` for anyone debugging one stage (Decision 2). It clears
   `dist/ide` too, so the installer it reports is the one it built.
9. **R9: skipped review points.** None of the thirteen Minor findings was
   skipped. Minor 10 (the TypeScript's quote style) is met by printing the
   blocks in the package's style behind `prettier-ignore`, plus a note that Step
   9's Prettier run is the authority.

## Self-review against the spec

| Spec section / requirement                                                                                                     | Where                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5: delete `build_tools/`, `run*` and the provisioning code                                                               | Task 4 (the provisioning code is `build_tools/build`'s `ide_ci::cache::goodie` and `vs.rs`, deleted with it)                                          |
| Phase 5: decide `launcher-shims`                                                                                               | User's ruling 2026-10-24: removed with the standalone launcher (Task 6); spec End state updated                                                       |
| Phase 5: update the docs and every CLAUDE.md that mentions `./run`                                                             | Task 2 (instructions), Task 4 Step 8 (statements of existence), Task 6 Step 6 (launcher), Tasks 8–10 (history)                                        |
| End state, Rust workspace: parser crates, `parser/debug` and fuzz, `app/rust-ffi`                                              | Task 4 Step 3, Task 6 Step 5; Task 12 Step 1 checks the 14 members                                                                                    |
| End state, entry points: sbt, `corepack pnpm`, cargo only for the parser                                                       | Task 1 (`ide-local` replaces `./run ide build`), Task 2 Step 5 (the command table)                                                                    |
| End state, `build-config.yaml` reduced to `latest-release` and `toolchain:`                                                    | Task 4 Step 5                                                                                                                                         |
| Remnants: `maven_install.json`, `stage-bazel-app.sh`, `tools/ci/nightly/*.js`, `tools/ci/check-changelog.js`, stale docs       | Phase 0 deleted the files (Task 0 Step 1 confirms); the stale docs are Task 2 Step 5 (`CONTRIBUTING.md`) and `build_tools/CLAUDE.md` goes with Task 4 |
| Risks: local developers lose auto-provisioning                                                                                 | Task 2 Step 5 (`toolchain-check` and the MSVC prompt in `CONTRIBUTING.md`); `ide-local`'s MSVC guard                                                  |
| Risks: required-check names                                                                                                    | Global Constraints; D3 changes job ids under unchanged `name:`s; no aggregator touched                                                                |
| Verification, throughout: Linux and Windows; no `git stash`, no `--no-verify`; Prettier                                        | Global Constraints; Tasks 3, 5, 7 on both hosts                                                                                                       |
| Gate: merge on green                                                                                                           | Tasks 3, 5, 11; Task 7 adds the user's nightly for the launcher (Decision 10)                                                                         |
| Brief: `Cargo.lock` shrinks cleanly; `cargo test --workspace` works; unused workspace pins                                     | Task 4 Steps 3–4 (506 → 141, nothing moved; 46 → 11 pins), Task 5 Step 1                                                                              |
| Brief: `.github` (filters, setup-msvc, wasm-checks, engine-benchmark, changelog.yml, paths-ignore)                             | Task 2 Steps 2–3, Task 4 Step 7, Task 8 (comments). `paths-ignore` lists only `docs/superpowers/**`, generated by nothing since Phase 1: no change    |
| Brief: `build.sbt`, `project/*.scala`, `electron-client`, `.gitattributes` … `.vscode`, `TestArchivePackager`, CLAUDE.md, docs | Tasks 4, 6, 8–10 (file lists)                                                                                                                         |

**Placeholder scan:** `<N>` is a PR number, known once `gh pr create` prints it;
`<ide-run-id>`, `<linux package job id>`, `$id`, `$nid` come from `gh run list`
/ `gh run view`; `<PRE>` is derived in Task 9 Step 2 from 5b's merge commit (and
recorded in 5b's PR body by Task 5 Step 4). The documents in Task 6 Step 6 are
given as targeted edits rather than full replacement text because they are long
upstream prose; each edit names its line and what goes.

**Consistency:** `ideLocal.ts`' six exports and `packageIde.ts`' five are used
with the same names and signatures in `commands/ide-local.ts` and
`commands/ide-build.ts`; `runSbt(command, env)` is defined in Task 1 Step 7 and
used in Step 8; the job ids `native-test`, `lint`, `parser-wasm-test` (D3); the
Note names in Task 8's Interfaces match `rename-notes.py`'s table, and no
document written before 5d cites a Note by its new name.

**Tested before writing** (2026-10-24, on a scratch worktree of develop with
#346 merged):

- `tools/build-scripts` with Task 1 applied: 184 vitest tests pass on Windows (5
  new), `tsc --noEmit`, ESLint `--max-warnings=0` and Prettier clean; the
  workflow policy OK and its 98 tests pass. `ide-local` itself was not run (an
  hour per host; Task 3).
- Task 4's deletion and manifest: `cargo metadata` shrank the lock 506 → 141
  with no package added or moved; `cargo test --workspace` passed on Windows and
  in WSL (55 suites, 172 tests, exit 0); `cargo fmt -- --check` clean on both;
  clippy showed only `enso-parser`'s warning.
- `yaml-same.mjs`, `comment-only.py` and `rename-notes.py` ran against the tree
  (the first two again after the review, in their final form): `yaml-same.mjs`
  reported the `setup-jvm` description and the `jvm-tests` step 9 script as
  unexpected until `--expect`ed, and the two `gui-changed-files.yml` lists as
  the only differences of Task 4 Step 7; `comment-only.py` passed a comment
  edit, flagged a renamed test name on both its `-` and `+` lines, and passed it
  with `--allow` for the old and the new text; `rename-notes.py` renamed the
  five Notes in the five files and left the one split citation, as Task 8 Step 2
  says. A parse of every `.github` YAML file found the pattern inside exactly
  four values outside the path filters: the three action descriptions and that
  `run:` script (Task 8).
- The two patterns were checked against the tree: the build-CLI pattern finds 77
  files and skips `./run.ts` imports and the `enso-build-scripts` User-Agent;
  the launcher pattern finds 33 files outside `engine/launcher`.
- Not run: any sbt task after the launcher's removal (Task 7), `ide-local` (Task
  3), any workflow.
