# Build Simplification, Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the last workflows off `./run`: the release (`release.yml`,
`promote.yml`, `nightly.yml`) onto a `release` command in `tools/build-scripts`,
proven by an rc prerelease, and the dispatch-only and label-gated checks
(`engine-checks-nightly.yml`, `extra-nightly-tests.yml`, `macos-checks.yml`)
onto the Phase 3 reusable workflow, so that Phase 5 can delete `build_tools/`.

**Architecture:** Three pull requests, in order.

- **4a** adds `release <action>` to `tools/build-scripts`: `create-draft`,
  `upload-ide`, `publish`, `promote` and `update-latest-version`, ported from
  `build_tools/build/src/release.rs` and friends, over a small `fetch` client
  for GitHub's REST API, with vitest tests. No workflow changes; merge on green.
- **4b** rewrites `release.yml`, `promote.yml` and `nightly.yml` by hand on that
  command, sbt `buildEngineBundle` and `ide-build`, in the matrix style of
  `ide-packaging.yml`, and moves the workflow policy's release rules with them.
  `release.yml` gains a `publish` input (default `true`) and a `release-id`
  mode, so that a release can stop at a filled draft and be published later. 4b
  merges only after the user has started rc.5 from the branch as a draft, the
  controller has checked the draft against rc.4, the user has had it published
  and has updated rc.4 → rc.5 in the app. Then the nightly release is
  re-enabled.
- **4c** generalises `engine-checks-platform.yml` (macOS, `aarch64`, Oracle
  GraalVM, optional JVM tests and Linux checks, a JSON runner) and adds an
  `edition` to `setup-jvm`; `engine-checks-nightly.yml`,
  `extra-nightly-tests.yml` and `macos-checks.yml` become calls of it. It merges
  on green after the user has dispatched each nightly workflow once from the
  branch.

"What moves, and where" below maps every `./run` call to its new home.

**Tech Stack:** Node 24.21 (type stripping, global `fetch`), TypeScript 6.0.3
(`erasableSyntaxOnly`), vitest 3.2; GitHub's REST API (releases, release assets,
git refs); GitHub Actions (reusable workflows with outputs, `strategy.matrix`,
self-hosted runner gating, `graalvm/setup-graalvm@v1` with
`distribution: graalvm` for Oracle GraalVM); electron-builder's
`publish: 'never'` update feeds and `electron-updater`'s GitHub provider;
actionlint 1.7.12 with shellcheck 0.11.0; `node:test` for `tools/ci`; `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md`
(design PR #289): "`./run` (enso-build-cli)" → Release, "`tools/build-scripts`"
→ `release`, Phases (Phase 4: "Proven by an rc prerelease. Ask the user before
publishing."), Verification ("Release: an rc prerelease end to end … and the
installed rc updates from the previous rc") and Risks. The Phase 3 plan
(`docs/superpowers/plans/2026-10-22-build-simplification-phase-3.md`) has the
house style, the helper scripts and the conventions this plan continues; read
its Global Constraints and Task 0 first.

## Decisions for review

The controller's recommendations, encoded in the tasks below. The user may
overturn any of them at plan review; each says what changes if they do.

1. **Three PRs: 4a (commands), 4b (release workflows), 4c (nightly and macOS
   checks).** 4c also takes `macos-checks.yml`, which the brief did not list but
   which still calls `./run` (the `CI: macOS …` label checks); Phase 5 cannot
   delete `build_tools/` while it does. _If overturned:_ split
   `macos-checks.yml` into a 4d with the same steps as Task 9's macOS part.
2. **Drop dead weight from the release:** Sentry (`SENTRY_AUTH_TOKEN`,
   `ENSO_IDE_SENTRY_*`), the cloud and analytics variables (`ENSO_IDE_HOST`, the
   Google Analytics tag), `ENSO_AG_GRID_LICENSE_KEY`, the Apple and Microsoft
   signing secrets, and `assets.json`. Checked: nothing in the app, the engine,
   the launcher or the project manager reads `assets.json` (only upstream's
   website did, per `manifest.rs`); the app finds installers by extension in the
   GitHub release (`app/gui/src/utils/github.ts`). None of the variables or
   secrets is even defined on the fork (`gh api …/actions/secrets` lists only
   `RUNNER_STATUS_TOKEN`; there are no variables). Note [Signing The Installers]
   in the new `release.yml` says where signing goes later. _If overturned:_ add
   the `env` lines back to the "Package the IDE" steps and the secrets to
   `RELEASE_SECRETS`; restoring `assets.json` is a 20-line `publish` change.
3. **Installers: electron-builder builds with `publish: 'never'` (it already
   does), and `release upload-ide` uploads the installer, its `.sha256`, the
   `.blockmap` and the `latest*.yml` feed to the draft by its release id.** The
   client is plain `fetch` over the REST API, not Octokit (a new dependency) and
   not `gh`: `gh release upload` finds a draft by its tag, but after a re-run
   two drafts can share a tag, and the upload needs its own content types, retry
   and replacement rules (R1, R3). File names are unchanged, so
   `electron-updater` keeps working: it reads `latest.yml` / `latest-linux.yml`
   from the release whose tag shares the installed version's prerelease channel
   (`rc` → `rc`), exactly as rc.1–rc.4 did. _If overturned (Octokit):_ swap
   `src/lib/githubApi.ts`' body; its interface stays.
4. **Gate for 4b: rc.5 as a checked draft, then published, then the user's
   in-app update, before merging.** Nothing the new pipeline produces is public
   before it has been checked (a public prerelease is offered at once to every
   installed rc that includes prereleases). In order, each a STOP step in Task
   7:
   1. with the Mac online, the user dispatches `promote.yml` with
      `designator=rc` and `publish=false` from the 4b branch (or authorises the
      controller to make that one dispatch): it builds 2026.1.1-rc.5 and stops
      at the filled draft;
   2. the controller checks the draft against rc.4 (`release-parity.sh` with the
      draft's id: assets, content types, states, both feeds' versions, sizes and
      sha512s against the downloaded installers, the `.sha256` files, the body);
   3. the user OKs publishing;
   4. the user dispatches (or authorises) `release.yml` with `release-id` = the
      draft's id and `version=2026.1.1-rc.5`, which publishes that draft and
      runs the latest-version step;
   5. the user updates an installed rc.4 to rc.5 from the app;
   6. 4b merges;
   7. with the user's go-ahead, `nightly.yml` is re-enabled
      (`gh workflow enable nightly.yml`).

   No GitHub environment with required reviewers: it needs a settings change and
   would hold the unattended nightlies.

5. **The macOS release stays, gated as today.** `check-the-mac-os-runner` waits
   one minute for the self-hosted Mac (`wait-for-macos-runner.sh 1 skip`); when
   it is offline the macOS jobs are skipped, `continue-on-error` keeps a failing
   one from blocking, and `publish` adds a note naming the missing installer
   (verified on nightly.2026.10.23, which shipped without a `.dmg`). One fix:
   the latest-version job now tests the publish job's result itself; today a
   failed macOS job skips it (it was skipped on 2026.10.23's nightly).
6. **Release notes are not HTML-escaped, and lose the "Anonymous Data
   Collection" section.** Handlebars' `{{changelog}}` turned every backtick,
   quote and `<kbd>` of rc.4's notes into `&#x60;`-style entities, which GitHub
   shows literally; and the local-only IDE collects no usage data. _If
   overturned:_ add the section back to `releaseBody` in `notes.ts` (escaping
   should stay off).
7. **Release commands require a valid `ENSO_VERSION`.** `version` keeps
   `./run`'s silent `-dev` fallback (Phase 3's R4); `release` refuses an empty
   or invalid version, so a typo cannot publish a `-dev` release.
8. **The GUI is built once, on Linux, at the release version**, as
   `ide-packaging.yml` does, instead of once per platform inside `ide upload`.
   The web bundle is platform-independent. Every release job cleans before and
   after (the self-hosted Mac keeps its working tree; a release from a branch,
   as the rc test is, would otherwise not clean).
9. **`extra-nightly-tests.yml` is ported faithfully.** Its Snowflake and Enso
   Cloud secrets do not exist on the fork, so its Snowflake suites fail as they
   would under `./run` (`Snowflake_Spec` refuses a set-but-empty
   `ENSO_SNOWFLAKE_ACCOUNT`), and the cloud suite skips its real-cloud tests.
   Enso Cloud sign-in is not ported (`stdlib-test` refuses a run that has all
   five credentials). Ticket 3 asks whether to keep these suites.
10. **Cache:** every release and nightly job that runs sbt uses `setup-jvm` with
    `cache-key: engine` (or `stdlib-tests` for the suites), which restores the
    shared entry and saves only on `develop` when that exact key is missing. The
    one new entry is `sbt-deps-engine-macOS-<hash>` (~850 MB), replacing the
    release's own `sbt-deps-macOS-<hash>`, which then expires; the
    `v0-rust-build-script-*` entries (1.4 GB) expire a week after the last
    `./run` build. The total stays near 4.5 GB of the 10 GB cap.

## Global Constraints

- **Never dispatch `release.yml`, `promote.yml` or `nightly.yml`**, and never
  enable `nightly.yml`, without the user: Task 7 stops for each. Never run
  `release create-draft`, `release upload-ide` or `release publish` outside a
  workflow; locally only `release promote` (it reads tags) and
  `release update-latest-version` with a prerelease `ENSO_VERSION` (a no-op).
  Never run `./run release …`. Read-only `gh api`, `gh release view`,
  `gh release download` and `gh run view` calls against `jdunkerley/enso` are
  fine.
- **Merge rules:** 4a on green. 4b only after Task 7's gate and the user's
  go-ahead. 4c on green after the user's dispatches (Task 9). Every PR takes the
  label `CI: No changelog needed` (CI and tooling, invisible to users), and
  merges with `gh pr merge <N> --squash`.
- **When a check fails:** as in Phase 3. Look up the same job in
  `$SCRATCH/baseline.md`; re-run the failed jobs once
  (`gh run rerun <run-id> --failed`); if develop fails the same job at the same
  step, comment the evidence on the PR and do not merge; otherwise fix it.
- **Never** `git stash`, `--no-verify`, `--force` pushes, or edits to your own
  permissions or settings files.
- **Use `corepack pnpm`**, never bare `pnpm` or `npm`, locally.
- **Linux as well as Windows:** run the policy tests and actionlint in WSL as
  well as on Windows (source `~/.enso-toolchain.sh` first; neither needs pnpm,
  so `/mnt/c` is fine for them). Never run pnpm in WSL against `/mnt/c`: the
  package's Linux run is its CI job ("Build Scripts", ubuntu), and a local Linux
  run, when wanted, is a clone on the Linux filesystem
  (`git clone /mnt/c/Repos/Enso/ide ~/enso-p4`, then `corepack pnpm install`
  there).
- **Never touch** the user's installed Enso, `%APPDATA%\Enso`,
  `%LOCALAPPDATA%\enso`, `%LOCALAPPDATA%\Programs\enso` or `~/.enso`. Do not
  install a release build: the in-app update test is the user's (Task 7).
- **Keep:** the aggregator names "Engine Required Checks", "GUI Required
  Checks", "IDE Required Checks" and "WASM Required Checks" (no aggregator file
  is touched); the pull-request workflows' job names, artifact names, triggers,
  secrets and `concurrency:` (4c's comparison shows only the intended
  differences); the release's job display names except the "Build Script" jobs
  (gone) and "GUI build (linux, amd64)" (new); `concurrency: release`.
- **Every job that runs sbt uses `setup-jvm` first**, with `rust: "true"` when
  sbt builds the parser (`buildEngineBundle`, `ciBuildEngineDistribution`, the
  JVM tests, `stdlib-test`'s HTTP helper), and a shared `cache-key` (`engine`,
  or `stdlib-tests` for the suites); `tools/ci/check-workflows.mjs` enforces the
  order. Quote every `-D` argument (`sbt "-Dsbt.server.autostart=false" …`).
- **actionlint clean** (1.7.12 with shellcheck 0.11.0, from WSL) on every
  workflow, and `node tools/ci/check-workflows.mjs` prints `Workflow policy: OK`
  on both hosts.
- **Actions are pinned by major tag**; no new third-party action or image is
  added (Oracle GraalVM comes from the same `graalvm/setup-graalvm@v1`).
- **Prettier:** run `corepack pnpm exec prettier --write <file>` on every
  Markdown, YAML, JSON or TypeScript file you touch, then `--check`. `tools/` is
  ignored except `tools/build-scripts`, so copy `tools/ci` files exactly as
  given. The code below is Prettier-clean already.
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
  meanwhile (memory: work while CI runs). The watchers are `$SCRATCH/wait-pr.sh`
  and `$SCRATCH/wait-run.sh` (Task 0).
- **Out of scope:** the Rust in `build_tools/` and `run*` (Phase 5; every
  `./run` command keeps working until then), `ide-packaging.yml`'s and
  `gui-checks.yml`'s dead variables (Ticket 1), Sentry in the GUI build (Ticket
  2).

`$SCRATCH` is the executing session's scratchpad directory. Every helper script
sets `GH_REPO=jdunkerley/enso` unless it is already set; the `gh` commands in
the steps assume it too (export it in each shell, or run them inside a checkout
of the fork).

---

## Branches, worktrees and PRs

Worktrees are created from `origin/develop` under `C:\Repos\Enso\`, with
`git -C /c/Repos/Enso/ide worktree add <dir> -b <branch> origin/develop`, then
`corepack pnpm install --frozen-lockfile --ignore-scripts` inside it.

| PR  | Branch                     | Worktree    | Tasks | Needs merged first | Validated by                                                                                                                                            |
| --- | -------------------------- | ----------- | ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4a  | `ci/release-build-scripts` | `ide-bs-4a` | 1–4   | —                  | "Build Scripts" CI (typecheck, lint, 176 tests on Linux); `release promote rc` prints `2026.1.1-rc.5` locally                                           |
| 4b  | `ci/release-workflows`     | `ide-bs-4b` | 5–7   | 4a                 | Workflow Lint and ✨ IDE; then rc.5 as a draft from the branch, checked against rc.4, published on the user's OK, and the user's in-app update (Task 7) |
| 4c  | `ci/nightly-checks`        | `ide-bs-4c` | 8–9   | 4b                 | ✨ Engine (the comparison shows only D9–D10); `CI: macOS …` labels on the PR; the user's dispatch of each nightly workflow                              |

- 4c's Task 8 touches no file 4b touches and may start while 4b waits for its
  gate; Task 9 edits the policy and `.github/CLAUDE.md` after 4b's changes, so
  it starts once 4b has merged (`git merge --no-edit origin/develop` first).
- The design branch `design/build-simplification` (worktree
  `C:\Repos\Enso\ide-build`, draft PR #289) carries only the spec and the plans.

## What moves, and where

The Rust is `build_tools/build/src/release.rs`, `release/manifest.rs`,
`release-body.md`, `changelog.rs`, `config.rs` (`with_latest_release`),
`version.rs` and `version/promote.rs` (already ported as `version.ts` in 3a),
`project/ide.rs` (`electron_image_filename`, `update_files`) and
`build_tools/cli/src/lib.rs` (`upload_ide_assets`, the `release` dispatch).

### Each `./run` call site

| Workflow › job                                    | `./run` command                                                                                                         | Becomes                                                                                   | PR  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --- |
| `promote.yml` › Promote release                   | `release promote <designator>`                                                                                          | `release promote "$DESIGNATOR"`                                                           | 4b  |
| `release.yml` › Create a release draft.           | `release create-draft`                                                                                                  | `release create-draft` (outputs `ENSO_RELEASE_ID`, `ENSO_VERSION`, as before)             | 4b  |
| `release.yml` › Build Backend (×3)                | `backend get`                                                                                                           | `version`, then `sbt "clean; all buildEngineBundle"` (as `ide-packaging.yml`)             | 4b  |
| `release.yml` › Build IDE (×3)                    | `ide upload --backend-source local --sign-artifacts`                                                                    | GUI from the new "GUI build" job; `ide-build --sign`; `release upload-ide`                | 4b  |
| `release.yml` › Verify License Packages           | `backend sbt '--' verifyLicensePackages`                                                                                | `sbt "-Dsbt.server.autostart=false" verifyLicensePackages`                                | 4b  |
| `release.yml` › Publish release                   | `release publish`                                                                                                       | `release publish`                                                                         | 4b  |
| `release.yml` › Update the latest release version | `release update-latest-version`                                                                                         | `release update-latest-version` (the PR step is unchanged)                                | 4b  |
| `engine-checks-nightly.yml` (49 `./run` steps)    | `backend ci-build-engine-distribution`, `test jvm`, `test <suite>`, `stdlib-api-check`, `libraries check-syntax`/`lint` | four calls of `engine-checks-platform.yml` (linux, windows, linux Oracle GraalVM, macos)  | 4c  |
| `extra-nightly-tests.yml` (8)                     | `backend ci-build-engine-distribution`, `test std-snowflake[-jvm]`, `test std-cloud-related`                            | one call of `engine-checks-platform.yml` for the distribution, then `stdlib-test <suite>` | 4c  |
| `macos-checks.yml` (10)                           | the same, on the Mac                                                                                                    | one call of `engine-checks-platform.yml` (`os: macos`, JSON runner)                       | 4c  |

Counts are `run:` steps that execute `./run`
(`git grep -nE '^\s*(- )?run: .*\./run( |$)'`): release 20, promote 2, nightly
0, engine-checks-nightly 49, extra-nightly-tests 8, macos-checks 10.

### What the release did besides the commands, and where it goes

| `./run` behaviour                                                                                                                                            | Phase 4                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version from `ENSO_VERSION`/`ENSO_EDITION` (the workflow `env`), published before every command                                                              | `releaseVersion` (strict, Decision 7); `create-draft` and `promote` publish the triple under the same names                                                                                                              |
| Tag-collision checks (`releases/tags/<tag>` published → error; `git/ref/tags/<tag>` exists → error; HEAD = `GITHUB_SHA`)                                     | `createDraft`, same order and messages                                                                                                                                                                                   |
| Body: Handlebars template, download links for all three targets, top section of `CHANGELOG.md`                                                               | `releaseBody` (Decision 6)                                                                                                                                                                                               |
| `publish`: note for missing installers (restating tag and target), publish, upload `assets.json`, check every download                                       | `publishRelease`: refuses a draft whose tag is not the version or that has an asset not fully `uploaded`; note; one PATCH that restates tag and target and sets `draft: false`; no `assets.json` (Decision 2); the check |
| `ide upload`: image, `.sha256`, then the update files that exist (Windows/Linux blockmap + feed; macOS feed, zip, blockmap), to the release id, draft or not | `ideUploadFiles` + `uploadIdeAssets`, same order and names, retried as `ide_ci::io::retry` (5 more, 0.5 s × 1.5); a draft's same-named assets are replaced, a published release's never are (R3)                         |
| Upload content type from the extension (`mime_guess`)                                                                                                        | `contentType`: `.exe`, `.yml`, `.json`, `.zip`, else `application/octet-stream` (what rc.4's assets show)                                                                                                                |
| `ENSO_BUILD_UPDATE_INFO=true` on the IDE jobs (blockmaps)                                                                                                    | Same, job `env`                                                                                                                                                                                                          |
| `ENSO_BUILD_SKIP_VERSION_CHECK`, `RUST_BACKTRACE`, the "Expose Artifact API" step, `GITHUB_TOKEN` on every step                                              | Gone: only `./run` read them; `GITHUB_TOKEN` stays on the steps that call GitHub                                                                                                                                         |
| Clean before/after on `develop` (always, in the IDE jobs)                                                                                                    | Always, every job (`ENSO_CI_CLEAN_BUILD: "true"`, Decision 8)                                                                                                                                                            |

## File map

| Path                                                                                         | PR     | Change                                                                                       |
| -------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `tools/build-scripts/src/lib/githubApi.ts` (+ test)                                          | 4a     | Create: the REST client                                                                      |
| `tools/build-scripts/src/release/{assets,notes,latestRelease,release}.ts` (+ tests)          | 4a     | Create: the port                                                                             |
| `tools/build-scripts/src/commands/release.ts`                                                | 4a     | Create: the entry point                                                                      |
| `tools/build-scripts/package.json`, `CLAUDE.md`                                              | 4a     | The `release` script; the Commands and Layout bullets                                        |
| `tools/ci/check-workflows.mjs`, `check-workflows.test.mjs`, `README.md`                      | 4b, 4c | The release rules (4b); the nightly and macOS rules (4c)                                     |
| `.github/workflows/release.yml`, `promote.yml`, `nightly.yml`                                | 4b     | Rewrite                                                                                      |
| `.github/actionlint.yaml`                                                                    | 4b     | Drop the two release ignores                                                                 |
| `docs/distribution/nightly.md`                                                               | 4b     | Where the release notes come from                                                            |
| `.github/actions/setup-jvm/action.yml`                                                       | 4c     | `edition` input                                                                              |
| `.github/workflows/engine-checks-platform.yml`                                               | 4c     | `arch`, `edition`, `jvm-tests`, `linux-checks`, JSON runner, outputs; macOS without services |
| `.github/workflows/engine-checks-nightly.yml`, `extra-nightly-tests.yml`, `macos-checks.yml` | 4c     | Rewrite                                                                                      |
| `.github/actions/build-script/`, `.github/actions/setup-build-script/`                       | 4c     | Delete (no workflow uses them)                                                               |
| `.github/actions/setup-rust/action.yml`                                                      | 4c     | Description: no `build-script` key                                                           |
| `.github/CLAUDE.md`                                                                          | 4b, 4c | Layout and "What still goes through `./run`" (`$SCRATCH/edit-github-claude.py`)              |

## Reference: intended differences

A PR lists each difference it shows, with this reason. Anything else is a
mistake.

| #   | PR  | Difference                                                                                                                                                                                                                                                                                                                                                                                           | Reason                                                                           |
| --- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| D1  | 4b  | `release.yml`: the three "Build Script" jobs, every `./run` step, `ENSO_BUILD_SKIP_VERSION_CHECK`, `RUST_BACKTRACE` and the "Expose Artifact API" steps are gone; job ids are short (`draft-release`, `build-backend`, `build-backend-macos`, `gui-build`, `upload-ide`, `upload-ide-macos`, `license-check`, `publish-release`, `update-latest-release-version`); Linux and Windows are matrix legs | The move; Phase 1–3 matrix style                                                 |
| D2  | 4b  | `release.yml`: new job "GUI build (linux, amd64)"; the IDE jobs download `gui` and `wasm-artifacts` instead of building the GUI                                                                                                                                                                                                                                                                      | Decision 8                                                                       |
| D3  | 4b  | `release.yml`: no Sentry, cloud, analytics, AG Grid or signing variables and secrets; no `assets.json`                                                                                                                                                                                                                                                                                               | Decision 2                                                                       |
| D4  | 4b  | `release.yml`: `ENSO_CI_CLEAN_BUILD: "true"`: every job cleans before and after                                                                                                                                                                                                                                                                                                                      | Decision 8                                                                       |
| D5  | 4b  | `release.yml`: "Update the latest release version" has `if: "!cancelled() && needs.publish-release.result == 'success'"`; the sbt cache comes from `setup-jvm` (`cache-key: engine`) instead of hand-written steps keyed `sbt-deps-<OS>`                                                                                                                                                             | Decision 5; Decision 10                                                          |
| D6  | 4b  | `promote.yml`: one job "Promote release (linux, amd64)" with three outputs, then `release.yml`; no "Build Script" job or clean steps. `nightly.yml`: no `env`                                                                                                                                                                                                                                        | The move                                                                         |
| D7  | 4b  | The release's body: no "Anonymous Data Collection" section, no HTML entities, no leading blank lines                                                                                                                                                                                                                                                                                                 | Decision 6                                                                       |
| D13 | 4b  | `release.yml`: inputs `publish` (boolean, default `true`) and `release-id` (default `""`); the five root build jobs run only when `release-id` is empty; "Publish release" runs when `release-id` is set, or when `publish` and the results allow, with `ENSO_RELEASE_ID` from the input or the draft job. `promote.yml`: input `publish`, passed on. The nightly uses the defaults                  | Decision 4 (Note [Publishing Later])                                             |
| D8  | 4b  | The policy's release rules name the new job ids and steps; `RELEASE_SECRETS` is `GITHUB_TOKEN` and `RUNNER_STATUS_TOKEN`; a new rule for the latest-version job's `if`; the publish job's `if` must test `inputs.publish`                                                                                                                                                                            | The rules follow the workflow                                                    |
| D9  | 4c  | Every job that uses `setup-jvm` (engine, IDE backend, formatting, enso4igv, release): "Read the pinned versions" starts with the `EDITION` check (`env: EDITION=community`), and "Check the toolchain" greps `$GRAALVM_VENDOR $GRAALVM_VERSION` (`GRAALVM_VENDOR` in its `env`)                                                                                                                      | `setup-jvm`'s `edition` input; `compare.sh` inlines composite actions            |
| D10 | 4c  | `engine-checks-platform.yml`: every job's `runs-on` is `${{ startsWith(inputs.runner, '[') && fromJSON(inputs.runner) \|\| inputs.runner }}` (`compare.sh` prints it with the runner substituted); the Windows standard-library job's id is `stdlib-tests-without-services`. Names, artifacts and steps are unchanged for the pull-request callers (the new inputs' defaults reproduce them)         | The JSON runner for the Mac; the job also serves macOS                           |
| D11 | 4c  | `engine-checks-nightly.yml`, `macos-checks.yml`, `extra-nightly-tests.yml`: rewritten as calls; their job names gain the caller's prefix (`linux / …`, `macos / …`, `linux (Oracle GraalVM) / …`)                                                                                                                                                                                                    | The move                                                                         |
| D12 | 4c  | `.github/actions/build-script` and `setup-build-script` deleted                                                                                                                                                                                                                                                                                                                                      | No workflow uses them since Phase 3 (the generator-era files inline their steps) |

---

### Task 0: Preconditions, tools and the baseline

**Files:** none in the repository. Creates `$SCRATCH/wait-pr.sh`,
`$SCRATCH/wait-run.sh`, `$SCRATCH/job-times.sh`, `$SCRATCH/compare.sh`,
`$SCRATCH/report-titles.sh`, `$SCRATCH/release-parity.sh`,
`$SCRATCH/edit-github-claude.py` and `$SCRATCH/baseline.md`.

**Interfaces:**

- Produces:
  - `wait-pr.sh <pr> [max-minutes]` — exit 0 when all checks passed, 1 when some
    failed, 2 on timeout;
  - `wait-run.sh <run-id> [max-minutes]` — waits for one workflow run; prints
    its conclusion; exit 0 on success, 1 otherwise, 2 on timeout;
  - `job-times.sh <run-id>` — `conclusion<TAB>minutes<TAB>job name` per job;
  - `compare.sh <worktree> <workflow file>…` — the job-by-job comparison against
    `origin/develop`, as Markdown;
  - `report-titles.sh <sha>` — the test reporters' check runs on a commit;
  - `release-parity.sh <old tag> <new tag | draft id> <work dir>` — the
    read-only comparison of a new release, published or still a draft, with an
    older published one, down to the installers' sha512s (Task 7);
  - `edit-github-claude.py <file> 4b|4c` — the `.github/CLAUDE.md` edits of
    Tasks 5 and 9;
  - `baseline.md` — the reference runs.

- [ ] **Step 1: Check the starting point**

```bash
export GH_REPO=jdunkerley/enso
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide log --oneline -1 origin/develop
for wf in release promote nightly engine-checks-nightly extra-nightly-tests macos-checks; do
  echo "$wf: $(git -C /c/Repos/Enso/ide grep -nE '^\s*(- )?run: .*\./run( |$)' origin/develop -- .github/workflows/$wf.yml | wc -l)"
done
gh workflow list --all --json path,state --jq '.[] | select(.path | test("nightly|release|promote|macos")) | "\(.state)\t\(.path)"'
gh release list -L 8
gh api repos/jdunkerley/enso/releases --paginate --jq '.[] | select(.draft) | "\(.id)\t\(.name)"'
gh pr list --state open --search "build simplification" --json number,title --jq '.[] | "\(.number)\t\(.title)"'
```

Expected: develop at or after `c848ae9746`; the counts `release: 20`,
`promote: 2`, `nightly: 0`, `engine-checks-nightly: 49`,
`extra-nightly-tests: 8`, `macos-checks: 10`; `nightly.yml` is
`disabled_manually` (the user disabled it until 4b merges) and the other five
are `active`; the newest releases are `2026.1.1-nightly.2026.10.23`,
`…nightly.2026.10.22` and `2026.1.1-rc.4` … `rc.1`, all prereleases; no draft
release; no Phase 4 PR open. If a count differs, stop and report: develop moved
under this plan. **If `nightly.yml` is not `disabled_manually`, stop and ask the
user**: with the nightly enabled, 4b's merge would let the next 02:00 run take
the new pipeline before Task 7's go-ahead.

- [ ] **Step 2: Check the tools**

```bash
wsl -e bash -lc 'ls ~/tools/actionlint-1.7.12/actionlint ~/tools/shellcheck-v0.11.0/shellcheck && . ~/.enso-toolchain.sh && node --version'
node --version && py -3 --version
```

Expected: both binaries; Node 24.21.0 on both hosts; Python 3 through the `py`
launcher (memory: `python` is the Store stub).

- [ ] **Step 3: Save the helper scripts**

`$SCRATCH/wait-pr.sh`:

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

`$SCRATCH/wait-run.sh`:

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

`$SCRATCH/job-times.sh`:

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: job-times.sh <run-id>
# One line per job: conclusion, wall-clock minutes, display name.
export GH_REPO=${GH_REPO:-jdunkerley/enso}
gh run view "$1" --json jobs \
  --jq '.jobs[] | "\(.conclusion)\t\((((.completedAt // .startedAt | fromdateiso8601) - (.startedAt | fromdateiso8601)) / 60) | floor)m\t\(.name)"'
```

`$SCRATCH/compare.sh` (restores the comparison script that #303 deleted, runs it
from the worktree, and deletes it again):

<!-- prettier-ignore -->
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

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: report-titles.sh <commit-sha>
# The test reporters' check runs on a commit (dorny/test-reporter): name and title, which holds
# the passed, failed and skipped counts.
export GH_REPO=${GH_REPO:-jdunkerley/enso}
gh api "repos/{owner}/{repo}/commits/$1/check-runs?per_page=100" --paginate \
  --jq '.check_runs[] | select(.name | test("Tests Report")) | "\(.name)\t\(.output.title)"' | sort
```

`$SCRATCH/release-parity.sh` (shellcheck-clean; tested on rc.3 → rc.4 and the
two nightlies):

<!-- prettier-ignore -->
```bash
#!/usr/bin/env bash
# Usage: release-parity.sh <old tag> <new tag | new draft's release id> <work dir>
# Compares a new release with an older published one, read-only. A numeric second argument is a
# draft (by id, as a release test leaves it before publishing); otherwise a published tag.
# - flags: the new release is a draft (by id) or published (by tag), named "Enso <version>";
# - assets: names (version replaced by VERSION) and content types equal the old release's, apart
#   from `assets.json`; every asset's state is `uploaded`;
# - feeds: each `latest*.yml` names the version, and the installer it points at has the feed's
#   size and sha512, and the `.sha256` beside it matches (the installers are downloaded, ~1.7 GB;
#   PARITY_INSTALLERS=0 skips that and checks only sizes);
# - body: a "# Changelog" section, no HTML entities, and download links to uploaded installers.
# Prints a report; exits 1 when something that must match does not.
set -euo pipefail
export GH_REPO=${GH_REPO:-jdunkerley/enso}
old=$1 new=$2 work=$3
mkdir -p "$work/old" "$work/new"
status=0
fail() { echo "MISMATCH: $*"; status=1; }

gh api "repos/$GH_REPO/releases/tags/$old" > "$work/old/release.json"
if [[ $new =~ ^[0-9]+$ ]]; then
  mode=draft
  gh api "repos/$GH_REPO/releases/$new" > "$work/new/release.json"
else
  mode=published
  gh api "repos/$GH_REPO/releases/tags/$new" > "$work/new/release.json"
fi
jsonf() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((a,k)=>a?.[k],r);console.log(typeof v==="object"?JSON.stringify(v):v)' "$work/$1/release.json" "$2"; }
tag=$(jsonf new tag_name)

echo "== flags ($mode)"
for side in old new; do
  echo "$side: $(jsonf $side tag_name) draft=$(jsonf $side draft) prerelease=$(jsonf $side prerelease) name=$(jsonf $side name)"
done
[ "$(jsonf new draft)" = "$([ $mode = draft ] && echo true || echo false)" ] || fail "draft flag is $(jsonf new draft) for a $mode release"
[ "$(jsonf new name)" = "Enso $tag" ] || fail "the release is not named Enso $tag"

echo "== assets (name with the version as VERSION, content type, state)"
assets() {
  # shellcheck disable=SC2016 # JavaScript, not shell
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const a of r.assets)console.log(`${a.name}\t${a.content_type}\t${a.state}\t${a.size}\t${a.id}`)' "$work/$1/release.json"
}
assets old > "$work/old/assets-full.tsv"
assets new > "$work/new/assets-full.tsv"
shape() {
  local version
  version=$(jsonf "$1" tag_name | sed 's/[.]/[.]/g')
  cut -f1,2 "$work/$1/assets-full.tsv" | sed "s/$version/VERSION/g" | grep -v '^assets.json' | LC_ALL=C sort
}
shape old > "$work/old/assets.tsv"
shape new > "$work/new/assets.tsv"
cat "$work/new/assets.tsv"
# `assets.json` is gone on purpose (Decision 2), so it is left out on both sides.
diff "$work/old/assets.tsv" "$work/new/assets.tsv" || fail "asset names or content types differ"
awk -F'\t' '$3 != "uploaded" { print "MISMATCH: " $1 " is " $3 }' "$work/new/assets-full.tsv" | grep . && status=1

download() { # <asset name> <file>
  local id
  id=$(awk -F'\t' -v n="$1" '$1 == n { print $5 }' "$work/new/assets-full.tsv")
  [ -n "$id" ] || { fail "$1 is not uploaded"; return 1; }
  gh api -H 'Accept: application/octet-stream' "repos/$GH_REPO/releases/assets/$id" > "$2"
}

echo "== feeds and checksums"
while IFS= read -r feed; do
  download "$feed" "$work/new/$feed"
  file=$(awk '/^path:/ { print $2 }' "$work/new/$feed")
  size=$(awk '/^ *size:/ { print $2; exit }' "$work/new/$feed")
  sha512=$(awk '/^sha512:/ { print $2 }' "$work/new/$feed")
  version=$(awk '/^version:/ { print $2 }' "$work/new/$feed")
  actual=$(awk -F'\t' -v n="$file" '$1 == n { print $4 }' "$work/new/assets-full.tsv")
  echo "$feed: version $version, $file, feed size $size, asset size ${actual:-missing}"
  [ "$version" = "$tag" ] || fail "$feed names version $version"
  [ "$size" = "$actual" ] || fail "$feed size $size differs from $file's ${actual:-missing}"
  if [ "${PARITY_INSTALLERS:-1}" != 0 ]; then
    download "$file" "$work/new/$file"
    got=$(openssl dgst -sha512 -binary "$work/new/$file" | openssl base64 -A)
    [ "$got" = "$sha512" ] || fail "$file's sha512 is not the one $feed names"
    sum=${file%.*}.sha256
    download "$sum" "$work/new/$sum"
    [ "$(tr -d '\r\n' < "$work/new/$sum")" = "$(sha256sum "$work/new/$file" | cut -d' ' -f1)" ] ||
      fail "$sum does not match $file"
    echo "$file: sha512 and $sum match"
    rm -f "$work/new/$file"
  fi
done < <(cut -f1 "$work/new/assets-full.tsv" | grep -E '^latest.*[.]yml$')
while IFS= read -r sum; do
  download "$sum" "$work/new/$sum"
  grep -qxE '[0-9a-f]{64}' "$work/new/$sum" || fail "$sum is not one sha256 digest"
done < <(cut -f1 "$work/new/assets-full.tsv" | grep '[.]sha256$')

echo "== bodies"
jsonf old body > "$work/old/body.md"
jsonf new body > "$work/new/body.md"
grep -oE 'https://github\.com/[^)]+/releases/download/[^)]+' "$work/new/body.md" |
  while IFS= read -r link; do
    name=${link##*/}
    grep -q "^$name	" "$work/new/assets-full.tsv" ||
      echo "note: the body links $name, which is not uploaded (a skipped platform; publish adds a note)"
  done
grep -q '^# Changelog$' "$work/new/body.md" || fail "the body has no Changelog section"
if grep -qE '&#x[0-9A-F]+;|&quot;|&amp;' "$work/new/body.md"; then
  fail "the body has HTML entities"
fi
diff "$work/old/body.md" "$work/new/body.md" > "$work/body.diff" || true
echo "Body diff (old to new) is in $work/body.diff"
exit $status
```

`$SCRATCH/edit-github-claude.py` (the `.github/CLAUDE.md` edits of 4b and 4c,
robust to Prettier's re-wrapping and to a merge that takes develop's file):

<!-- prettier-ignore -->
```python
"""Updates .github/CLAUDE.md for Phase 4: `4b` (the release workflows) or `4c` (the nightly and
macOS checks).

Usage: py -3 edit-github-claude.py .github/CLAUDE.md 4b|4c, then run Prettier on the file.

Text is found by its words, whatever Prettier's wrapping, and table rows by their first cell; each
must be found exactly once. After a merge conflict in the file, take develop's version and run the
PR's stage again.
"""
import re
import sys

path, stage = sys.argv[1], sys.argv[2]
s = open(path, encoding='utf-8').read()
NL = chr(10)


def row(start, new):
    """Replaces the table row whose first cell starts with `start` (Prettier pads the cells)."""
    global s
    lines = s.split(NL)
    hits = [i for i, line in enumerate(lines) if line.startswith('| ' + start)]
    assert len(hits) == 1, start
    lines[hits[0]] = new.rstrip(NL)
    s = NL.join(lines)


def rep(old, new):
    """Replaces `old`, matched with any run of blanks where it has one (Prettier re-wraps)."""
    global s
    pattern = re.compile(r'\s+'.join(re.escape(word) for word in old.split()))
    found = pattern.findall(s)
    assert len(found) == 1, old[:70]
    s = pattern.sub(lambda _: new.rstrip(NL), s)


if stage == '4b':
    rep('''- `workflows/release.yml`, `promote.yml`, `nightly.yml` — releases. They are the
  generator's last output, kept unchanged until Phase 4 rewrites them; change
  them only together with an rc release test. `engine-checks-nightly.yml`,
  `extra-nightly-tests.yml` and `macos-checks.yml` are likewise kept in the
  generator's layout until Phase 4 (edit directly).
''', '''- `workflows/release.yml`, `promote.yml`, `nightly.yml` — releases. `promote.yml`
  (by hand, or from `nightly.yml`'s daily cron) computes the version and calls
  `release.yml`, which drafts the release, builds and uploads the installers and
  publishes it with `tools/build-scripts`' `release` command (Note [Release
  Without ./run] in `release.yml`). Change them only together with an rc release
  test. `engine-checks-nightly.yml`, `extra-nightly-tests.yml` and
  `macos-checks.yml` stay in the generator's layout until PR 4c (edit directly).
''')
    rep('''Release, promote, the nightly checks and the macOS
checks (label-gated) still call `./run` until Phase 4.
''', '''Phase 4 moved the releases to `tools/build-scripts`' `release` command (PR 4b);
the nightly checks and the macOS checks (label-gated) still call `./run` until
PR 4c.
''')
    row('release, promote, nightly, nightly checks, macOS', '''| `release.yml` | `release create-draft`, `upload-ide`, `publish`, `update-latest-version`; `buildEngineBundle`; `ide-build` | No: `setup-jvm`, `setup-msvc`, `setup-build-scripts` |
| `promote.yml` | `release promote <designator>` | No: `setup-build-scripts` |
| nightly checks, extra nightly tests, macOS | various | Yes: PR 4c |
''')
elif stage == '4c':
    rep('''  test. `engine-checks-nightly.yml`, `extra-nightly-tests.yml` and
  `macos-checks.yml` stay in the generator's layout until PR 4c (edit directly).
''', '''  test. `engine-checks-nightly.yml` (by hand) adds macOS and Oracle GraalVM to the
  engine checks, `extra-nightly-tests.yml` (by hand) the suites that need the
  Snowflake and Enso Cloud secrets, and `macos-checks.yml` the self-hosted Mac's
  checks for `macos-pull-request.yml`; all three call
  `engine-checks-platform.yml`.
''')
    rep('''- `actions/` — composite actions: `build-script` (compile `./run`'s CLI once per
  platform), `setup-build-script` (use it in a job), `setup-node`, `setup-rust`,
  `setup-jvm` (GraalVM, sbt,''', '''- `actions/` — composite actions: `setup-node`, `setup-rust`, `setup-jvm` (GraalVM
  CE, or Oracle GraalVM with `edition: oracle`, sbt,''')
    rep('''Phase 4 moved the releases to `tools/build-scripts`' `release` command (PR 4b);
the nightly checks and the macOS checks (label-gated) still call `./run` until
PR 4c.
''', '''Phase 4 moved the releases to `tools/build-scripts`' `release` command, and the
nightly and macOS checks to calls of `engine-checks-platform.yml`. No workflow
calls `./run` any more; `build_tools/` and `run*` stay, unused by CI, until
Phase 5 deletes them.
''')
    row('nightly checks, extra nightly tests, macOS', '''| `engine-checks-nightly.yml`, `macos-checks.yml` | calls of `engine-checks-platform.yml` | No |
| `extra-nightly-tests.yml` | `engine-checks-platform.yml`, then `stdlib-test <suite>` | No: `setup-jvm` (GraalPy), `setup-build-scripts` |
''')
else:
    raise SystemExit('stage?')
open(path, 'w', encoding='utf-8', newline=NL).write(s)
print('ok', stage)
```

Make them executable (`chmod +x "$SCRATCH"/*.sh`) and try the parity script on
two existing releases:

```bash
PARITY_INSTALLERS=0 "$SCRATCH/release-parity.sh" 2026.1.1-rc.3 2026.1.1-rc.4 "$SCRATCH/parity-selftest"; echo "exit $?"
```

Expected: exit 1, with exactly two mismatches, both genuine: rc.3 had no macOS
installer (the asset diff shows the two `enso-mac-arm64-VERSION` lines;
`assets.json` is left out on both sides), and rc.4's body has HTML entities
(Decision 6). The feeds line up:
`latest-linux.yml: version 2026.1.1-rc.4, … feed size 916435254, asset size 916435254`
and the same for `latest.yml` (756943715). (`PARITY_INSTALLERS=0` skips
downloading the installers; Task 7 runs it in full, which downloads about 1.7 GB
and checks each feed's sha512 and each `.sha256`.)

- [ ] **Step 4: Record the baseline**

```bash
{
  echo "## rc.4 — promote run 39230106012 (feature/ide-updater, 931935f7a7)"; "$SCRATCH/job-times.sh" 39230106012; echo
  echo "## nightly 2026.10.22 — nightly run 39868733997"; "$SCRATCH/job-times.sh" 39868733997; echo
  echo "## nightly 2026.10.23 — run 39914924767 (macOS Build Script failed; latest-version skipped)"; "$SCRATCH/job-times.sh" 39914924767; echo
  echo "## engine nightly checks — run 39515290706 (./run, 2026-10-20)"; "$SCRATCH/job-times.sh" 39515290706; echo
  sha=$(gh run view 39515290706 --json headSha --jq .headSha)
  echo "## report titles at $sha"; "$SCRATCH/report-titles.sh" "$sha"
} > "$SCRATCH/baseline.md"
cat "$SCRATCH/baseline.md"
```

Expected (recorded 2026-10-23): rc.4 — Build Backend 24 min (Linux), 30
(Windows), 156 (macOS, a cold Mac); Build IDE 7 / 15 / 15; Verify License
Packages 3; every job green. Nightly 2026.10.22 — all green, macOS included.
Nightly 2026.10.23 — "Build Script" (macOS) failed, its two macOS jobs skipped,
Publish green, "Update the latest release version" skipped (D5's bug). Engine
nightly checks — every job green except "Build Engine Distribution (GraalVM CE)
(native,test) (windows, amd64)" (failed, so the Windows tests were skipped); 25
jobs besides the three "Build Script" jobs.

Nothing is committed in this task.

---

### Task 1: The GitHub REST client (PR 4a)

**Files:**

- Create: `tools/build-scripts/src/lib/githubApi.ts`
- Test: `tools/build-scripts/src/lib/githubApi.test.ts`

**Interfaces:**

- Produces (`src/lib/githubApi.ts`):
  - `type FetchLike = (url: string, init?: RequestInit) => Promise<Response>`;
  - `interface ReleaseAsset { id: number; name: string; state: string }`;
  - `interface Release { id; tag_name; target_commitish; name: string | null; draft; prerelease; body: string | null; html_url; assets: readonly ReleaseAsset[] }`;
  - `interface GitHub { repository: string; json<T>(method, route, body?): Promise<T | null>; upload(releaseId, name, file, contentType): Promise<void>; status(url): Promise<number> }`
    — `json` answers `null` for a 204, and for a 404 on `GET` (the thing does
    not exist) or `DELETE` (absence is the goal); a 404 on `PATCH` or `POST`,
    and any other non-2xx, throws (R12); `upload` aborts after
    `uploadTimeoutMs(bytes)` (R11);
  - `uploadTimeoutMs(bytes): number` — ten minutes plus a second per megabyte;
  - `gitHub(options: { token; repository; fetch?; apiUrl?; uploadUrl? }): GitHub`;
  - `gitHubFromEnv(env): GitHub` (needs `GITHUB_TOKEN` and an `owner/name`
    `GITHUB_REPOSITORY`); `apiHeaders(token)`.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-4a -b ci/release-build-scripts origin/develop
cd /c/Repos/Enso/ide-bs-4a
corepack pnpm install --frozen-lockfile --ignore-scripts
```

- [ ] **Step 2: Write the failing test**

`tools/build-scripts/src/lib/githubApi.test.ts`:

<!-- prettier-ignore -->
```ts
/** @file The REST client: URLs, headers, bodies and error handling, against a fake `fetch`. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { gitHub, gitHubFromEnv, uploadTimeoutMs, type FetchLike } from './githubApi.ts'

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A `fetch` that records its calls and answers each with the next of `responses`. */
function fakeFetch(responses: Response[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      const response = responses.shift()
      if (response == null) throw new Error(`unexpected call: ${url}`)
      return response
    },
  }
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('json', () => {
  test('sends the token and the API version, and parses the answer', async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: 7 })])
    const api = gitHub({ token: 't0k', repository: 'o/r', fetch })
    expect(await api.json('GET', '/repos/o/r/releases/7')).toEqual({ id: 7 })
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/releases/7')
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer t0k',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(calls[0]?.init?.body).toBeUndefined()
  })
  test('sends a body as JSON', async () => {
    const { fetch, calls } = fakeFetch([json(201, { id: 1 })])
    await gitHub({ token: 't', repository: 'o/r', fetch }).json('POST', '/x', { draft: true })
    expect(calls[0]?.init?.body).toBe('{"draft":true}')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })
  test('404 is null for GET and DELETE; another failure throws with the message', async () => {
    const { fetch } = fakeFetch([
      json(404, { message: 'Not Found' }),
      json(404, { message: 'Not Found' }),
      json(422, { message: 'Validation Failed' }),
    ])
    const api = gitHub({ token: 't', repository: 'o/r', fetch })
    expect(await api.json('GET', '/a')).toBeNull()
    expect(await api.json('DELETE', '/a')).toBeNull()
    await expect(api.json('POST', '/b', {})).rejects.toThrow(
      /POST https:\/\/api\.github\.com\/b failed: 422 .*Validation Failed/,
    )
  })
  test('404 on PATCH or POST is an error: what was to change has gone', async () => {
    const { fetch } = fakeFetch([json(404, { message: 'Not Found' }), json(404, {})])
    const api = gitHub({ token: 't', repository: 'o/r', fetch })
    await expect(api.json('PATCH', '/releases/9', { draft: false })).rejects.toThrow(
      /PATCH .*releases\/9 failed: 404/,
    )
    await expect(api.json('POST', '/releases', {})).rejects.toThrow(/failed: 404/)
  })
  test('204 is null', async () => {
    const { fetch } = fakeFetch([new Response(null, { status: 204 })])
    expect(await gitHub({ token: 't', repository: 'o/r', fetch }).json('DELETE', '/x')).toBeNull()
  })
})

describe('upload', () => {
  test('posts the file to uploads.github.com, named and typed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upload-'))
    const file = path.join(dir, 'latest.yml')
    writeFileSync(file, 'version: 1\n')
    const { fetch, calls } = fakeFetch([json(201, { id: 3 })])
    await gitHub({ token: 't', repository: 'o/r', fetch }).upload(
      42,
      'enso-win-x64-2026.1.1.exe',
      file,
      'text/yaml',
    )
    expect(calls[0]?.url).toBe(
      'https://uploads.github.com/repos/o/r/releases/42/assets?name=enso-win-x64-2026.1.1.exe',
    )
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'text/yaml' })
    expect(Buffer.from(calls[0]?.init?.body as Uint8Array).toString()).toBe('version: 1\n')
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })
  test('an upload may take ten minutes plus a second per megabyte', () => {
    expect(uploadTimeoutMs(0)).toBe(600_000)
    expect(uploadTimeoutMs(1)).toBe(601_000)
    expect(uploadTimeoutMs(840_000_000)).toBe(1_440_000)
  })
  test('an empty file is refused before any call', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upload-'))
    const file = path.join(dir, 'empty.sha256')
    writeFileSync(file, '')
    const { fetch, calls } = fakeFetch([])
    await expect(
      gitHub({ token: 't', repository: 'o/r', fetch }).upload(1, 'empty.sha256', file, 'x/y'),
    ).rejects.toThrow('cannot be empty')
    expect(calls).toEqual([])
  })
})

test('status follows redirects and reports the final status', async () => {
  const { fetch, calls } = fakeFetch([new Response('body', { status: 200 })])
  expect(await gitHub({ token: 't', repository: 'o/r', fetch }).status('https://x/y')).toBe(200)
  expect(calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'follow' })
})

describe('gitHubFromEnv', () => {
  test('needs the token and an owner/name repository', () => {
    expect(() => gitHubFromEnv({ GITHUB_REPOSITORY: 'o/r' })).toThrow('GITHUB_TOKEN is not set.')
    expect(() => gitHubFromEnv({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o' })).toThrow(
      'GITHUB_REPOSITORY is not `owner/name`: "o".',
    )
    expect(gitHubFromEnv({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' }).repository).toBe('o/r')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run:
`corepack pnpm --filter build-scripts exec vitest run src/lib/githubApi.test.ts`
Expected: FAIL, `Failed to load url ./githubApi.ts` (the module does not exist).

- [ ] **Step 4: Write the client**

`tools/build-scripts/src/lib/githubApi.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file A small client for GitHub's REST API over `fetch`, for the release commands. It does what
 * `./run`'s octocrab calls did and no more: JSON requests against one repository, release-asset
 * uploads (`uploads.github.com`), and checking that a download URL answers. Plain `fetch` rather
 * than Octokit (a new dependency) or `gh`: `gh release upload` finds a release by its tag, and
 * after a re-run two drafts can share one, so the upload must name the draft by id; and the
 * commands need the content type, the retry and the replacement rules in their own hands.
 */
import { readFileSync } from 'node:fs'

/** The part of `fetch` the client uses; tests pass a fake. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** A release asset, as the API returns it (the fields the commands read). */
export interface ReleaseAsset {
  readonly id: number
  readonly name: string
  /** `uploaded`, or `starter` for an upload that never finished. */
  readonly state: string
}

/** A release, as the API returns it (the fields the commands read). */
export interface Release {
  readonly id: number
  readonly tag_name: string
  readonly target_commitish: string
  readonly name: string | null
  readonly draft: boolean
  readonly prerelease: boolean
  readonly body: string | null
  readonly html_url: string
  readonly assets: readonly ReleaseAsset[]
}

/** What the release commands need from GitHub. */
export interface GitHub {
  /** `owner/name`. */
  readonly repository: string
  /**
   * A JSON request to `https://api.github.com<route>`: the parsed body, or `null` for a 204. A 404
   * is `null` for `GET` (the thing does not exist) and `DELETE` (absence is the goal); for any
   * other method it is an error, like every other status that is not 2xx.
   */
  json<T>(method: string, route: string, body?: unknown): Promise<T | null>
  /**
   * Uploads `file` as the asset `name` of release `releaseId`. The file is read whole: an installer
   * is under 1 GB, and a buffer gives the request the `Content-Length` the upload API wants.
   */
  upload(releaseId: number, name: string, file: string, contentType: string): Promise<void>
  /** The HTTP status of a GET of `url` (redirects followed); the body is not read. */
  status(url: string): Promise<number>
}

/** Where the client connects, and with what. */
export interface GitHubOptions {
  readonly token: string
  readonly repository: string
  readonly fetch?: FetchLike
  readonly apiUrl?: string
  readonly uploadUrl?: string
}

/** The headers of every API call. */
export function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'enso-build-scripts',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** An error for a response that is not 2xx, with the API's message. */
async function failure(method: string, url: string, response: Response): Promise<Error> {
  const text = await response.text().catch(() => '')
  return new Error(
    `${method} ${url} failed: ${response.status} ${response.statusText} ${text}`.trim(),
  )
}

/**
 * How long one upload of `bytes` may take: ten minutes, plus a second per megabyte (1 MB/s, a
 * slow home uplink; an 840 MB `.dmg` gets 24 minutes). Without it a stalled upload would hang
 * until the job's timeout. `fetch`'s own timeouts (undici's `headersTimeout` and
 * `bodyTimeout`, 300 s each) cover only the wait for the response, not sending the body.
 */
export function uploadTimeoutMs(bytes: number): number {
  return 600_000 + Math.ceil(bytes / 1_000_000) * 1000
}

/** A client for `options.repository`. */
export function gitHub(options: GitHubOptions): GitHub {
  const doFetch = options.fetch ?? fetch
  const apiUrl = options.apiUrl ?? 'https://api.github.com'
  const uploadUrl = options.uploadUrl ?? 'https://uploads.github.com'
  const headers = apiHeaders(options.token)
  return {
    repository: options.repository,
    async json<T>(method: string, route: string, body?: unknown): Promise<T | null> {
      const url = `${apiUrl}${route}`
      const response = await doFetch(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.status === 404 && (method === 'GET' || method === 'DELETE')) return null
      if (!response.ok) throw await failure(method, url, response)
      if (response.status === 204) return null
      return (await response.json()) as T
    },
    async upload(releaseId: number, name: string, file: string, contentType: string) {
      const content = readFileSync(file)
      if (content.length === 0) throw new Error(`Release asset file cannot be empty: ${file}`)
      const url =
        `${uploadUrl}/repos/${options.repository}/releases/${releaseId}/assets` +
        `?name=${encodeURIComponent(name)}`
      const response = await doFetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType },
        body: content,
        signal: AbortSignal.timeout(uploadTimeoutMs(content.length)),
      })
      if (!response.ok) throw await failure('POST', url, response)
    },
    async status(url: string): Promise<number> {
      const response = await doFetch(url, { method: 'GET', redirect: 'follow' })
      await response.body?.cancel()
      return response.status
    },
  }
}

/** The client for this workflow run: `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, both required. */
export function gitHubFromEnv(env: Readonly<Record<string, string | undefined>>): GitHub {
  const token = env.GITHUB_TOKEN ?? ''
  const repository = env.GITHUB_REPOSITORY ?? ''
  if (token === '') throw new Error('GITHUB_TOKEN is not set.')
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`GITHUB_REPOSITORY is not \`owner/name\`: ${JSON.stringify(repository)}.`)
  }
  return gitHub({ token, repository })
}
```

- [ ] **Step 5: Run the test to see it pass**

Run:
`corepack pnpm --filter build-scripts exec vitest run src/lib/githubApi.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/build-scripts/src/lib/githubApi.ts tools/build-scripts/src/lib/githubApi.test.ts
git commit -m "tools/build-scripts: a small fetch client for GitHub's REST API"
```

(with the trailers from Global Constraints, as in every commit below).

---

### Task 2: Installers, release notes and `latest-release` (PR 4a)

**Files:**

- Create: `tools/build-scripts/src/release/assets.ts`, `notes.ts`,
  `latestRelease.ts` (one deliberate difference from `config.rs`: a CRLF
  `build-config.yaml` keeps its CRLF, where Rust rewrote it with LF; R14)
- Test: `tools/build-scripts/src/release/assets.test.ts`, `notes.test.ts`,
  `latestRelease.test.ts`

**Interfaces:**

- Consumes: `TargetOs` (`'linux' | 'windows' | 'macos'`) from
  `src/ide-build/ideBuild.ts`; `latestReleaseFromConfig` from
  `src/version/version.ts`; `REPO_ROOT` from `src/lib/repo.ts`.
- Produces:
  - `assets.ts`:
    `ReleaseTarget { os; arch: 'x64' | 'x86_64' | 'arm64'; pretty }`,
    `RELEASE_TARGETS` (Windows, Linux, macOS (Apple silicon), in that order),
    `releaseTarget(os)`, `installerName(target, version)`,
    `downloadUrl(repository, tag, name)`, `checksumPath(file)`,
    `splitUploaded(version, uploaded): { present; missing }`,
    `missingInstallersNote(missing)`,
    `updateFiles(os, installer, distDir, exists): string[]`,
    `UploadFile { file; name }`,
    `ideUploadFiles(os, version, distDir, exists): UploadFile[]`,
    `contentType(name)`;
  - `notes.ts`: `prettyName(version)`, `topReleaseNotes(changelog)`,
    `releaseBody(repository, version, changelog)`;
  - `latestRelease.ts`: `LATEST_RELEASE_KEY`,
    `withLatestRelease(configText, version)`.

- [ ] **Step 1: Write the failing tests**

`tools/build-scripts/src/release/assets.test.ts` (the `manifest.rs` and
`project/ide.rs` tests, plus rc.4's real names and content types):

<!-- prettier-ignore -->
```ts
/** @file The release's installers and update files (the `manifest.rs` and `project/ide.rs` tests). */
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  checksumPath,
  contentType,
  downloadUrl,
  ideUploadFiles,
  installerName,
  missingInstallersNote,
  RELEASE_TARGETS,
  releaseTarget,
  splitUploaded,
  updateFiles,
} from './assets.ts'

test('the installers are the IDE images electron-builder names', () => {
  expect(RELEASE_TARGETS.map((target) => installerName(target, '2026.2.0'))).toEqual([
    'enso-win-x64-2026.2.0.exe',
    'enso-linux-x86_64-2026.2.0.AppImage',
    'enso-mac-arm64-2026.2.0.dmg',
  ])
})

test("rc.4's download link, as published", () => {
  expect(
    downloadUrl(
      'jdunkerley/enso',
      '2026.1.1-rc.4',
      installerName(releaseTarget('linux'), '2026.1.1-rc.4'),
    ),
  ).toBe(
    'https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.4/enso-linux-x86_64-2026.1.1-rc.4.AppImage',
  )
})

test('the checksum replaces the last extension only', () => {
  expect(checksumPath('dist/ide/enso-win-x64-2026.1.1-rc.4.exe')).toBe(
    'dist/ide/enso-win-x64-2026.1.1-rc.4.sha256',
  )
  expect(checksumPath('enso-linux-x86_64-2026.1.1.AppImage')).toBe(
    'enso-linux-x86_64-2026.1.1.sha256',
  )
})

describe('splitUploaded (uploaded_manifest_leaves_out_missing_installers)', () => {
  test('a release without the dmg lists Windows and Linux, and misses macOS', () => {
    const { present, missing } = splitUploaded('2026.2.0-rc.1', [
      'enso-win-x64-2026.2.0-rc.1.exe',
      'enso-win-x64-2026.2.0-rc.1.exe.blockmap',
      'enso-linux-x86_64-2026.2.0-rc.1.AppImage',
      'latest.yml',
    ])
    expect(present.map((target) => target.os)).toEqual(['windows', 'linux'])
    expect(missing.map((target) => target.pretty)).toEqual(['macOS (Apple silicon)'])
  })
  test('the note names the missing platforms', () => {
    const { missing } = splitUploaded('2026.2.0', [])
    expect(missingInstallersNote(missing)).toBe(
      '\n\n> [!NOTE]\n> This release was published without an installer for Windows, Linux, ' +
        'macOS (Apple silicon): that build failed or was skipped. Re-running its jobs in the ' +
        'release workflow uploads it here.',
    )
  })
})

describe('updateFiles (update_files_are_the_existing_feed_and_blockmaps)', () => {
  const dist = path.join('dist', 'ide')
  test('Windows: the blockmap and latest.yml, when they exist', () => {
    const installer = path.join(dist, 'enso-win-x64-2026.2.0.exe')
    expect(updateFiles('windows', installer, dist, () => false)).toEqual([])
    const present = new Set([
      `${installer}.blockmap`,
      path.join(dist, 'latest.yml'),
      path.join(dist, 'latest-linux.yml'),
    ])
    expect(updateFiles('windows', installer, dist, (file) => present.has(file))).toEqual([
      `${installer}.blockmap`,
      path.join(dist, 'latest.yml'),
    ])
  })
  test('Linux: latest-linux.yml', () => {
    const installer = path.join(dist, 'enso-linux-x86_64-2026.2.0.AppImage')
    const present = new Set([path.join(dist, 'latest-linux.yml')])
    expect(updateFiles('linux', installer, dist, (file) => present.has(file))).toEqual([
      path.join(dist, 'latest-linux.yml'),
    ])
  })
  test('macOS: the feed, the zip and its blockmap (macos_update_files_include_the_zip)', () => {
    const installer = path.join(dist, 'enso-mac-arm64-2026.2.0.dmg')
    expect(updateFiles('macos', installer, dist, () => true)).toEqual([
      path.join(dist, 'latest-mac.yml'),
      path.join(dist, 'enso-mac-arm64-2026.2.0.zip'),
      path.join(dist, 'enso-mac-arm64-2026.2.0.zip.blockmap'),
    ])
  })
})

describe('ideUploadFiles', () => {
  const dist = path.join('dist', 'ide')
  test('the installer, its checksum, then the update files, under their own names', () => {
    const exe = path.join(dist, 'enso-win-x64-2026.1.1-rc.5.exe')
    const present = new Set([
      exe,
      path.join(dist, 'enso-win-x64-2026.1.1-rc.5.sha256'),
      `${exe}.blockmap`,
      path.join(dist, 'latest.yml'),
    ])
    expect(
      ideUploadFiles('windows', '2026.1.1-rc.5', dist, (file) => present.has(file)).map(
        (entry) => entry.name,
      ),
    ).toEqual([
      'enso-win-x64-2026.1.1-rc.5.exe',
      'enso-win-x64-2026.1.1-rc.5.sha256',
      'enso-win-x64-2026.1.1-rc.5.exe.blockmap',
      'latest.yml',
    ])
  })
  test('a missing installer or checksum is an error', () => {
    expect(() => ideUploadFiles('linux', '2026.1.1', dist, () => false)).toThrow(
      'enso-linux-x86_64-2026.1.1.AppImage does not exist',
    )
    const installer = path.join(dist, 'enso-linux-x86_64-2026.1.1.AppImage')
    expect(() => ideUploadFiles('linux', '2026.1.1', dist, (file) => file === installer)).toThrow(
      'enso-linux-x86_64-2026.1.1.sha256 does not exist',
    )
  })
})

test("content types are what rc.4's assets were uploaded with", () => {
  expect(contentType('enso-win-x64-2026.1.1-rc.4.exe')).toBe(
    'application/vnd.microsoft.portable-executable',
  )
  expect(contentType('latest-linux.yml')).toBe('text/yaml')
  expect(contentType('enso-mac-arm64-2026.1.1-rc.4.dmg')).toBe('application/octet-stream')
  expect(contentType('enso-win-x64-2026.1.1-rc.4.exe.blockmap')).toBe('application/octet-stream')
  expect(contentType('enso-linux-x86_64-2026.1.1-rc.4.sha256')).toBe('application/octet-stream')
  expect(contentType('enso-mac-arm64-2026.1.1.zip')).toBe('application/zip')
})
```

`tools/build-scripts/src/release/notes.test.ts`:

<!-- prettier-ignore -->
````ts
/** @file The release notes: the top changelog section, and the body around it. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { prettyName, releaseBody, topReleaseNotes } from './notes.ts'

const CHANGELOG = [
  '# Next Release',
  '',
  '#### Enso IDE',
  '',
  '- [Tidy up uses `Ctrl`+<kbd>L</kbd> & "quotes"][74]',
  '',
  '```',
  '# not a heading, inside a fence',
  '```',
  '',
  '[74]: https://github.com/jdunkerley/enso/pull/74',
  '',
  '# Enso 2026.1',
  '',
  '- older',
  '',
].join('\n')

describe('topReleaseNotes (Changelog::top_release_notes)', () => {
  test('the first section, trimmed, with a fenced `#` line kept as text', () => {
    expect(topReleaseNotes(CHANGELOG)).toBe(
      [
        '#### Enso IDE',
        '',
        '- [Tidy up uses `Ctrl`+<kbd>L</kbd> & "quotes"][74]',
        '',
        '```',
        '# not a heading, inside a fence',
        '```',
        '',
        '[74]: https://github.com/jdunkerley/enso/pull/74',
      ].join('\n'),
    )
  })
  test('the last section runs to the end of the file', () => {
    expect(topReleaseNotes('# Only\n\nbody\n')).toBe('body')
  })
  test('a file without a level-1 heading is an error', () => {
    expect(() => topReleaseNotes('## Two\n#### Four\n')).toThrow(
      'Failed to find a level one header.',
    )
  })
  test('CRLF line endings, as a Windows checkout has them', () => {
    expect(topReleaseNotes('# A\r\n\r\nx\r\n# B\r\ny\r\n')).toBe('x')
  })
  test("the repository's CHANGELOG.md has a top section", () => {
    const changelog = readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
    const notes = topReleaseNotes(changelog)
    expect(notes.startsWith('#### ')).toBe(true)
    expect(notes).not.toMatch(/^# /m)
  })
})

test('the release name', () => {
  expect(prettyName('2026.1.1-rc.5')).toBe('Enso 2026.1.1-rc.5')
})

test('the body lists every installer, then the notes verbatim (no HTML entities)', () => {
  expect(releaseBody('jdunkerley/enso', '2026.1.1-rc.5', CHANGELOG)).toBe(
    [
      '# Download',
      '',
      '## Enso IDE',
      '',
      'Enso IDE is the main product of the Enso project. The packages are stand-alone, they contain both GUI and the backend.',
      '',
      'Download links:',
      '- [Windows](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-win-x64-2026.1.1-rc.5.exe)',
      '- [Linux](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-linux-x86_64-2026.1.1-rc.5.AppImage)',
      '- [macOS (Apple silicon)](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-mac-arm64-2026.1.1-rc.5.dmg)',
      '',
      'This is the recommended download for most users.',
      '',
      '# Changelog',
      '',
      topReleaseNotes(CHANGELOG),
      '',
    ].join('\n'),
  )
})
````

`tools/build-scripts/src/release/latestRelease.test.ts` (the `config.rs` tests):

<!-- prettier-ignore -->
```ts
/** @file Moving `latest-release` (the `config.rs` tests). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { latestReleaseFromConfig } from '../version/version.ts'
import { withLatestRelease } from './latestRelease.ts'

test('updating latest-release keeps the rest of the file', () => {
  const config =
    '# A comment.\n\nlatest-release: 2025.3.4\n\nrequired-versions:\n  node: =16.15.0\n'
  const updated = withLatestRelease(config, '2026.1.1')
  expect(updated).toBe(
    '# A comment.\n\nlatest-release: 2026.1.1\n\nrequired-versions:\n  node: =16.15.0\n',
  )
  // Re-applying the same version is a no-op, so a release that did not move the key leaves the
  // file (and therefore the pull request) empty.
  expect(withLatestRelease(updated, '2026.1.1')).toBe(updated)
})

test('updating latest-release requires the key', () => {
  expect(() => withLatestRelease('wasm-size-limit: 16.20 MiB\n', '2026.1.1')).toThrow(
    'The build configuration has no `latest-release` entry to update.',
  )
})

test('a CRLF file stays CRLF', () => {
  expect(withLatestRelease('a: 1\r\nlatest-release: 2025.3.4\r\n', '2026.1.1')).toBe(
    'a: 1\r\nlatest-release: 2026.1.1\r\n',
  )
})

test("the repository's build-config.yaml is updatable, and reads back", () => {
  const config = readFileSync(path.join(REPO_ROOT, 'build-config.yaml'), 'utf8')
  expect(latestReleaseFromConfig(config)).not.toBeNull()
  expect(latestReleaseFromConfig(withLatestRelease(config, '2026.1.1'))?.text).toBe('2026.1.1')
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm --filter build-scripts exec vitest run src/release`
Expected: FAIL, three files, `Failed to load url ./assets.ts` (and `./notes.ts`,
`./latestRelease.ts`).

- [ ] **Step 3: Write the three modules**

`tools/build-scripts/src/release/assets.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The release's installers and the files that go with them: a port of
 * `build_tools/build/src/release/manifest.rs` and of `project/ide.rs`' `electron_image_filename`
 * and `Artifact::update_files`. One deliberate difference: there is no `assets.json`. Only
 * upstream's website read it; nothing in this repository does.
 */
import path from 'node:path'
import type { TargetOs } from '../ide-build/ideBuild.ts'

/** A platform a release ships an installer for. */
export interface ReleaseTarget {
  readonly os: TargetOs
  /** The architecture as electron-builder spells it in the file name. */
  readonly arch: 'x64' | 'x86_64' | 'arm64'
  /** How the release notes name the platform. */
  readonly pretty: string
}

/**
 * The installers a release ships, in the order the notes list them. `release.yml` builds one for
 * each; keep the two in step.
 */
export const RELEASE_TARGETS: readonly ReleaseTarget[] = [
  { os: 'windows', arch: 'x64', pretty: 'Windows' },
  { os: 'linux', arch: 'x86_64', pretty: 'Linux' },
  { os: 'macos', arch: 'arm64', pretty: 'macOS (Apple silicon)' },
]

/** The release target for `os`. */
export function releaseTarget(os: TargetOs): ReleaseTarget {
  const target = RELEASE_TARGETS.find((candidate) => candidate.os === os)
  if (target == null) throw new Error(`No release target for ${os}.`)
  return target
}

/** The installer electron-builder writes for `target` (`artifactName` in its configuration). */
export function installerName(target: ReleaseTarget, version: string): string {
  switch (target.os) {
    case 'linux':
      return `enso-linux-${target.arch}-${version}.AppImage`
    case 'macos':
      return `enso-mac-${target.arch}-${version}.dmg`
    case 'windows':
      return `enso-win-${target.arch}-${version}.exe`
  }
}

/** The public download URL of a release asset. */
export function downloadUrl(repository: string, tag: string, name: string): string {
  return `https://github.com/${repository}/releases/download/${tag}/${name}`
}

/** `file` with its last extension replaced by `.sha256`, as `computeHashes` names the checksum. */
export function checksumPath(file: string): string {
  const extension = path.extname(file)
  return `${file.slice(0, file.length - extension.length)}.sha256`
}

/**
 * The installers named in `uploaded`, and the targets whose installer is not there. The macOS jobs
 * do not block publishing, so a release can go out without its `.dmg`.
 */
export function splitUploaded(
  version: string,
  uploaded: readonly string[],
): { readonly present: ReleaseTarget[]; readonly missing: ReleaseTarget[] } {
  const present: ReleaseTarget[] = []
  const missing: ReleaseTarget[] = []
  for (const target of RELEASE_TARGETS) {
    if (uploaded.includes(installerName(target, version))) present.push(target)
    else missing.push(target)
  }
  return { present, missing }
}

/** The note `publish` appends to the body when installers are missing. */
export function missingInstallersNote(missing: readonly ReleaseTarget[]): string {
  const platforms = missing.map((target) => target.pretty).join(', ')
  return (
    `\n\n> [!NOTE]\n> This release was published without an installer for ${platforms}: that ` +
    'build failed or was skipped. Re-running its jobs in the release workflow uploads it here.'
  )
}

/**
 * What `electron-updater` needs next to the installer: the feed and the blockmaps, and on macOS
 * the zip it updates from. Release builds write them (`ENSO_BUILD_UPDATE_INFO`, and a signed
 * macOS build for the zip); those that do not exist are left out.
 */
export function updateFiles(
  os: TargetOs,
  installer: string,
  distDir: string,
  exists: (file: string) => boolean,
): string[] {
  const candidates =
    os === 'windows' ? [`${installer}.blockmap`, path.join(distDir, 'latest.yml')]
    : os === 'linux' ? [`${installer}.blockmap`, path.join(distDir, 'latest-linux.yml')]
    : [
        path.join(distDir, 'latest-mac.yml'),
        `${installer.slice(0, -'.dmg'.length)}.zip`,
        `${installer.slice(0, -'.dmg'.length)}.zip.blockmap`,
      ]
  return candidates.filter(exists)
}

/** One file to upload, and the asset name it gets. */
export interface UploadFile {
  readonly file: string
  readonly name: string
}

/**
 * Everything `upload-ide` uploads from `distDir` for `os`: the installer, its `.sha256`, then the
 * update files. The installer and the checksum must exist.
 */
export function ideUploadFiles(
  os: TargetOs,
  version: string,
  distDir: string,
  exists: (file: string) => boolean,
): UploadFile[] {
  const installer = path.join(distDir, installerName(releaseTarget(os), version))
  const checksum = checksumPath(installer)
  for (const required of [installer, checksum]) {
    if (!exists(required)) throw new Error(`${required} does not exist: was the IDE packaged?`)
  }
  return [installer, checksum, ...updateFiles(os, installer, distDir, exists)].map((file) => ({
    file,
    name: path.basename(file),
  }))
}

/** The content type an asset is uploaded with, as `./run` guessed it from the extension. */
export function contentType(name: string): string {
  const extension = path.extname(name).toLowerCase()
  switch (extension) {
    case '.exe':
      return 'application/vnd.microsoft.portable-executable'
    case '.yml':
    case '.yaml':
      return 'text/yaml'
    case '.json':
      return 'application/json'
    case '.zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}
```

`tools/build-scripts/src/release/notes.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The release's name and notes: a port of `build_tools/build/src/release.rs`
 * (`generate_release_body`, `release-body.md`) and `changelog.rs` (`top_release_notes`). Two
 * deliberate differences: the notes are not HTML-escaped (Handlebars' `{{changelog}}` turned every
 * backtick, quote and `<kbd>` into an entity, which GitHub then showed literally), and the
 * "Anonymous Data Collection" section is gone (the IDE is local-only and sends no usage data).
 */
import { downloadUrl, installerName, RELEASE_TARGETS } from './assets.ts'

/** The release's display name: `Enso <version>`. */
export function prettyName(version: string): string {
  return `Enso ${version}`
}

/**
 * The start and end offsets of each level-1 ATX heading (`# …`) outside fenced code blocks: the
 * headings `pulldown_cmark` reported as `HeadingLevel::H1`, for the shape `CHANGELOG.md` has.
 */
function levelOneHeadings(text: string): { start: number; end: number; title: string }[] {
  const headings: { start: number; end: number; title: string }[] = []
  let fence: string | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    const start = offset
    offset += line.length + 1
    const content = line.replace(/\r$/, '')
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(content)
    if (fenceMatch != null) {
      const marker = fenceMatch[1] ?? ''
      if (fence == null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence != null) continue
    const heading = /^ {0,3}#(?:[ \t]+(.*?))?[ \t]*$/.exec(content)
    if (heading != null) {
      headings.push({ start, end: start + line.length, title: (heading[1] ?? '').trim() })
    }
  }
  return headings
}

/**
 * The notes under the first level-1 heading of `CHANGELOG.md`, up to the next one, trimmed: the
 * `# Next Release` section while a release is being prepared.
 */
export function topReleaseNotes(changelog: string): string {
  const [first, second] = levelOneHeadings(changelog)
  if (first == null) throw new Error('Failed to find a level one header.')
  return changelog.slice(first.end, second?.start ?? changelog.length).trim()
}

/** The release body: download links for every installer, then the changelog section. */
export function releaseBody(repository: string, version: string, changelog: string): string {
  const links = RELEASE_TARGETS.map(
    (target) =>
      `- [${target.pretty}](${downloadUrl(repository, version, installerName(target, version))})`,
  )
  return [
    '# Download',
    '',
    '## Enso IDE',
    '',
    'Enso IDE is the main product of the Enso project. The packages are stand-alone, they contain both GUI and the backend.',
    '',
    'Download links:',
    ...links,
    '',
    'This is the recommended download for most users.',
    '',
    '# Changelog',
    '',
    topReleaseNotes(changelog),
    '',
  ].join('\n')
}
```

`tools/build-scripts/src/release/latestRelease.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `latest-release` in `build-config.yaml`, which a release moves forward: a port of
 * `build_tools/build/src/config.rs` `with_latest_release`.
 */

/** The `build-config.yaml` key recording the most recent stable Enso release. */
export const LATEST_RELEASE_KEY = 'latest-release'

/**
 * `configText` with its `latest-release` entry set to `version`. Line by line rather than through
 * a YAML round trip, so that the comments and layout survive. A missing key is an error: adding it
 * silently would hide a renamed or removed entry. One deliberate difference from the Rust: a CRLF
 * file keeps its CRLF line endings (`with_latest_release` rewrote every line ending as LF).
 */
export function withLatestRelease(configText: string, version: string): string {
  const prefix = `${LATEST_RELEASE_KEY}:`
  let found = false
  const lines = configText.split('\n').map((line) => {
    if (!line.startsWith(prefix)) return line
    found = true
    return `${LATEST_RELEASE_KEY}: ${version}${line.endsWith('\r') ? '\r' : ''}`
  })
  if (!found) {
    throw new Error(`The build configuration has no \`${LATEST_RELEASE_KEY}\` entry to update.`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `corepack pnpm --filter build-scripts exec vitest run src/release`
Expected: PASS, 22 tests (assets 11, notes 7, latestRelease 4). The two tests
that read the repository's `CHANGELOG.md` and `build-config.yaml` pass on
develop's files.

- [ ] **Step 5: Commit**

```bash
git add tools/build-scripts/src/release
git commit -m "tools/build-scripts: release installers, notes and latest-release, ported from build_tools"
```

---

### Task 3: The release operations (PR 4a)

**Files:**

- Create: `tools/build-scripts/src/release/release.ts`
- Test: `tools/build-scripts/src/release/release.test.ts`

**Interfaces:**

- Consumes: `GitHub`, `Release` (Task 1); everything in `assets.ts` and
  `notes.ts` (Task 2); `retryDelays` from `src/ide-build/ideBuild.ts`;
  `deduceKind`, `parseVersion`, `Designation`, `Version` from
  `src/version/version.ts`.
- Produces (`src/release/release.ts`):
  - `releaseVersion(env): Version` — strict `ENSO_VERSION` (Decision 7);
  - `releaseId(env): number` — `ENSO_RELEASE_ID`;
  - `parseDesignation(text): Designation`; `isPrerelease(version): boolean`;
  - `DraftInputs { version; commit; head: string | null; changelog; log }`;
    `createDraft(api, inputs): Promise<Release>`;
  - `publishRelease(api, id, version, log): Promise<ReleaseTarget[]>` (the
    missing targets) — refuses a published release, a draft whose tag is not
    `version`, and a draft with an asset whose `state` is not `uploaded`;
    `validateRelease(api, id, installers)`;
  - `uploadIdeAssets(api, id, files, log, wait?)` — uploads to the release `id`,
    draft or published: on a draft a same-named asset (from an earlier run, or a
    failed attempt) is deleted and replaced; on a published release nothing is
    ever deleted, and a same-named asset, or one a failed attempt left, is an
    error (R3); `sleep(ms)`.

- [ ] **Step 1: Write the failing test**

`tools/build-scripts/src/release/release.test.ts` (an in-memory GitHub; the
`release.rs` behaviour, including its error messages):

<!-- prettier-ignore -->
```ts
/** @file The release operations, against an in-memory GitHub. */
/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case. */
import { describe, expect, test } from 'vitest'
import type { GitHub, Release, ReleaseAsset } from '../lib/githubApi.ts'
import { version } from '../version/version.ts'
import {
  createDraft,
  isPrerelease,
  parseDesignation,
  publishRelease,
  releaseId,
  releaseVersion,
  uploadIdeAssets,
} from './release.ts'

interface Call {
  readonly method: string
  readonly route: string
  readonly body?: unknown
}

/**
 * A GitHub that answers from `routes` (`"<METHOD> <route>"` → answer, or a function of the body)
 * and records every call. An unknown route answers `null` (404).
 */
function fakeGitHub(
  routes: Record<string, unknown>,
  options: {
    uploadFailures?: number
    statuses?: Record<string, number>
  } = {},
): { api: GitHub; calls: Call[]; uploads: string[] } {
  const calls: Call[] = []
  const uploads: string[] = []
  let failures = options.uploadFailures ?? 0
  const api: GitHub = {
    repository: 'o/r',
    async json<T>(method: string, route: string, body?: unknown): Promise<T | null> {
      calls.push({ method, route, ...(body === undefined ? {} : { body }) })
      const answer = routes[`${method} ${route}`]
      const value =
        typeof answer === 'function' ? (answer as (b: unknown) => unknown)(body) : answer
      return (value ?? null) as T | null
    },
    async upload(id: number, name: string, _file: string, type: string) {
      if (failures > 0) {
        failures--
        throw new Error('connection reset')
      }
      uploads.push(`${id} ${name} ${type}`)
    },
    async status(url: string) {
      return options.statuses?.[url] ?? 200
    },
  }
  return { api, calls, uploads }
}

const release = (overrides: Partial<Release> = {}): Release => ({
  id: 9,
  tag_name: '2026.1.1-rc.5',
  target_commitish: 'abc',
  name: 'Enso 2026.1.1-rc.5',
  draft: true,
  prerelease: true,
  body: 'notes',
  html_url: 'https://github.com/o/r/releases/tag/untagged-1',
  assets: [],
  ...overrides,
})

describe('releaseVersion', () => {
  test('ENSO_VERSION, which must be a version', () => {
    expect(releaseVersion({ ENSO_VERSION: '2026.1.1-rc.5' }).text).toBe('2026.1.1-rc.5')
    expect(() => releaseVersion({})).toThrow('ENSO_VERSION is not a version: "".')
    expect(() => releaseVersion({ ENSO_VERSION: 'v2026.1.1' })).toThrow('"v2026.1.1"')
  })
  test('a set ENSO_EDITION must equal it', () => {
    expect(() => releaseVersion({ ENSO_VERSION: '2026.1.1', ENSO_EDITION: '2026.1.2' })).toThrow(
      'Inconsistent ENSO_VERSION and ENSO_EDITION variable values.',
    )
  })
})

test('releaseId', () => {
  expect(releaseId({ ENSO_RELEASE_ID: '258412335' })).toBe(258412335)
  expect(() => releaseId({ ENSO_RELEASE_ID: '' })).toThrow('ENSO_RELEASE_ID is not a release id')
})

test('parseDesignation', () => {
  expect(parseDesignation('rc')).toBe('rc')
  expect(() => parseDesignation('beta')).toThrow(
    'Unknown designation "beta"; expected one of stable, patch, rc, nightly.',
  )
})

test('rc and nightly are prereleases, stable is not', () => {
  expect(isPrerelease(version('2026.1.1-rc.5'))).toBe(true)
  expect(isPrerelease(version('2026.1.1-nightly.2026.10.23'))).toBe(true)
  expect(isPrerelease(version('2026.1.1'))).toBe(false)
})

describe('createDraft', () => {
  const inputs = (head: string | null = 'abc') => ({
    version: version('2026.1.1-rc.5'),
    commit: 'abc',
    head,
    changelog: '# Next Release\n\n- a change\n',
    log: () => {},
  })
  test('creates a prerelease draft at the commit, named and with the notes', async () => {
    const { api, calls } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    expect((await createDraft(api, inputs())).id).toBe(9)
    expect(calls.map((call) => `${call.method} ${call.route}`)).toEqual([
      'GET /repos/o/r/releases/tags/2026.1.1-rc.5',
      'GET /repos/o/r/git/ref/tags/2026.1.1-rc.5',
      'POST /repos/o/r/releases',
    ])
    expect(calls[2]?.body).toMatchObject({
      tag_name: '2026.1.1-rc.5',
      target_commitish: 'abc',
      name: 'Enso 2026.1.1-rc.5',
      prerelease: true,
      draft: true,
    })
    expect((calls[2]?.body as { body: string }).body).toContain('# Changelog\n\n- a change\n')
  })
  test('a stable version is not a prerelease', async () => {
    const { api, calls } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    await createDraft(api, { ...inputs(), version: version('2026.2.1') })
    expect(calls[2]?.body).toMatchObject({ prerelease: false })
  })
  test('refuses another HEAD, a published release and an existing tag', async () => {
    await expect(createDraft(fakeGitHub({}).api, inputs('def'))).rejects.toThrow(
      'Local HEAD def is not the same as the commit abc we were ordered to build.',
    )
    const published = fakeGitHub({
      'GET /repos/o/r/releases/tags/2026.1.1-rc.5': release({ draft: false }),
    })
    await expect(createDraft(published.api, inputs())).rejects.toThrow(
      'Release 2026.1.1-rc.5 has already been published.',
    )
    const tagged = fakeGitHub({
      'GET /repos/o/r/git/ref/tags/2026.1.1-rc.5': { object: { sha: 'f00', type: 'commit' } },
    })
    await expect(createDraft(tagged.api, inputs())).rejects.toThrow(
      'Tag 2026.1.1-rc.5 already exists on remote as {"sha":"f00","type":"commit"}.',
    )
  })
  test('outside a checkout there is no HEAD to compare', async () => {
    const { api } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    expect((await createDraft(api, inputs(null))).id).toBe(9)
  })
})

describe('publishRelease', () => {
  const all = [
    { id: 1, name: 'enso-win-x64-2026.1.1-rc.5.exe', state: 'uploaded' },
    { id: 2, name: 'enso-linux-x86_64-2026.1.1-rc.5.AppImage', state: 'uploaded' },
    { id: 3, name: 'enso-mac-arm64-2026.1.1-rc.5.dmg', state: 'uploaded' },
  ]
  test('publishes with the tag restated, and checks every installer downloads', async () => {
    const published = release({ draft: false, assets: all })
    let first = true
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/releases/9': () => {
        const answer = first ? release({ assets: all }) : published
        first = false
        return answer
      },
    })
    expect(await publishRelease(api, 9, version('2026.1.1-rc.5'), () => {})).toEqual([])
    expect(calls[1]).toEqual({
      method: 'PATCH',
      route: '/repos/o/r/releases/9',
      body: { tag_name: '2026.1.1-rc.5', target_commitish: 'abc', body: 'notes', draft: false },
    })
  })
  test('without the dmg: a note, and macOS is not checked', async () => {
    const two = all.slice(0, 2)
    let first = true
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/releases/9': () => {
        const answer = first ? release({ assets: two }) : release({ draft: false, assets: two })
        first = false
        return answer
      },
    })
    const logged: string[] = []
    const missing = await publishRelease(api, 9, version('2026.1.1-rc.5'), (l) => logged.push(l))
    expect(missing.map((target) => target.os)).toEqual(['macos'])
    expect((calls[1]?.body as { body: string }).body).toBe(
      'notes\n\n> [!NOTE]\n> This release was published without an installer for macOS (Apple ' +
        'silicon): that build failed or was skipped. Re-running its jobs in the release workflow ' +
        'uploads it here.',
    )
    expect(logged[0]).toBe('::warning::Publishing without installers for: macOS (Apple silicon).')
  })
  test('refuses a published release and a missing one', async () => {
    const done = fakeGitHub({ 'GET /repos/o/r/releases/9': release({ draft: false }) })
    await expect(publishRelease(done.api, 9, version('2026.1.1'), () => {})).rejects.toThrow(
      'Release has been already published!',
    )
    await expect(
      publishRelease(fakeGitHub({}).api, 9, version('2026.1.1'), () => {}),
    ).rejects.toThrow('Release 9 does not exist.')
  })
  test('refuses a draft of another version, and one with a half-written asset', async () => {
    const other = fakeGitHub({ 'GET /repos/o/r/releases/9': release() })
    await expect(publishRelease(other.api, 9, version('2026.1.1-rc.6'), () => {})).rejects.toThrow(
      'Release 9 is 2026.1.1-rc.5, not 2026.1.1-rc.6: check the release id and version.',
    )
    const partial = fakeGitHub({
      'GET /repos/o/r/releases/9': release({
        assets: [...all.slice(0, 2), { id: 3, name: all[2]?.name ?? '', state: 'starter' }],
      }),
    })
    await expect(
      publishRelease(partial.api, 9, version('2026.1.1-rc.5'), () => {}),
    ).rejects.toThrow(
      'Not publishing: assets not fully uploaded: enso-mac-arm64-2026.1.1-rc.5.dmg (starter).',
    )
    expect(partial.calls.some((call) => call.method === 'PATCH')).toBe(false)
  })
  test('an installer that does not download fails the validation', async () => {
    let first = true
    const url =
      'https://github.com/o/r/releases/download/2026.1.1-rc.5/enso-win-x64-2026.1.1-rc.5.exe'
    const { api } = fakeGitHub(
      {
        'GET /repos/o/r/releases/9': () => {
          const answer = first ? release({ assets: all }) : release({ draft: false, assets: all })
          first = false
          return answer
        },
      },
      { statuses: { [url]: 404 } },
    )
    await expect(publishRelease(api, 9, version('2026.1.1-rc.5'), () => {})).rejects.toThrow(
      `Failed to download asset: ${url} (404).`,
    )
  })
})

describe('uploadIdeAssets', () => {
  const exe = 'enso-win-x64-2026.1.1-rc.5.exe'
  const files = [
    { file: `/d/${exe}`, name: exe },
    { file: '/d/latest.yml', name: 'latest.yml' },
  ]

  /**
   * A GitHub holding one release whose assets change as the client acts: a successful upload
   * adds an `uploaded` asset, a failed one (the first `failures`) a `starter` one, a DELETE removes.
   */
  function statefulGitHub(
    draft: boolean,
    assets: ReleaseAsset[],
    failures = 0,
  ): { api: GitHub; log: string[]; current: () => ReleaseAsset[] } {
    const log: string[] = []
    let left = failures
    let nextId = 100
    let held = [...assets]
    const api: GitHub = {
      repository: 'o/r',
      async json<T>(method: string, route: string): Promise<T | null> {
        log.push(`${method} ${route}`)
        if (method === 'GET' && route === '/repos/o/r/releases/9') {
          return release({ draft, assets: held }) as T
        }
        const deleted = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(route)
        if (method === 'DELETE' && deleted != null) {
          held = held.filter((asset) => asset.id !== Number(deleted[1]))
          return null
        }
        throw new Error(`unexpected ${method} ${route}`)
      },
      async upload(_id: number, name: string) {
        log.push(`upload ${name}`)
        if (left > 0) {
          left--
          held = [...held, { id: nextId++, name, state: 'starter' }]
          throw new Error('connection reset')
        }
        held = [...held, { id: nextId++, name, state: 'uploaded' }]
      },
      async status() {
        return 200
      },
    }
    return { api, log, current: () => held }
  }
  const noWait = async () => {}

  test('uploads each file to the draft, typed by its name', async () => {
    const { api, uploads } = fakeGitHub({ 'GET /repos/o/r/releases/9': release() })
    await uploadIdeAssets(api, 9, files, () => {})
    expect(uploads).toEqual([
      `9 ${exe} application/vnd.microsoft.portable-executable`,
      '9 latest.yml text/yaml',
    ])
  })
  test('on a draft, a failed upload deletes its half-written asset and retries', async () => {
    const { api, log, current } = statefulGitHub(true, [], 1)
    const waits: number[] = []
    await uploadIdeAssets(
      api,
      9,
      files,
      () => {},
      async (ms) => {
        waits.push(ms)
      },
    )
    expect(waits).toEqual([500])
    expect(log.filter((line) => line.startsWith('DELETE'))).toEqual([
      'DELETE /repos/o/r/releases/assets/100',
    ])
    expect(current().map((asset) => `${asset.name} ${asset.state}`)).toEqual([
      `${exe} uploaded`,
      'latest.yml uploaded',
    ])
  })
  test('on a draft, an asset an earlier run uploaded is replaced', async () => {
    const { api, current } = statefulGitHub(true, [{ id: 7, name: exe, state: 'uploaded' }])
    const logged: string[] = []
    await uploadIdeAssets(api, 9, files, (line) => logged.push(line), noWait)
    expect(logged[0]).toBe(`Replacing ${exe}, left on the draft by an earlier run.`)
    expect(current().map((asset) => asset.id)).toEqual([100, 101])
  })
  test('on a draft, the last failed attempt is cleaned up too, then the error stands', async () => {
    const { api, current } = statefulGitHub(true, [], 6)
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      'connection reset',
    )
    expect(current()).toEqual([])
  })
  test('on a published release, a missing installer is added', async () => {
    const { api, current } = statefulGitHub(false, [
      { id: 1, name: 'latest.yml', state: 'uploaded' },
    ])
    await uploadIdeAssets(api, 9, [files[0] ?? { file: '', name: '' }], () => {}, noWait)
    expect(current().map((asset) => asset.name)).toEqual(['latest.yml', exe])
  })
  test('on a published release, an existing asset is never replaced', async () => {
    const { api, log } = statefulGitHub(false, [{ id: 1, name: 'latest.yml', state: 'uploaded' }])
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      "Release 2026.1.1-rc.5 is published and already has latest.yml; a published release's " +
        'assets are never replaced. Delete the asset by hand first if it must change.',
    )
    expect(log.some((line) => line.startsWith('DELETE'))).toBe(false)
  })
  test('on a published release, a failed upload is not cleaned up: it stops', async () => {
    const { api, log } = statefulGitHub(false, [], 1)
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      `Uploading ${exe} to the published release 2026.1.1-rc.5 failed and left a partial asset`,
    )
    expect(log.some((line) => line.startsWith('DELETE'))).toBe(false)
  })
  test('a release that does not exist is an error', async () => {
    await expect(uploadIdeAssets(fakeGitHub({}).api, 9, files, () => {})).rejects.toThrow(
      'Release 9 does not exist.',
    )
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run:
`corepack pnpm --filter build-scripts exec vitest run src/release/release.test.ts`
Expected: FAIL, `Failed to load url ./release.ts`.

- [ ] **Step 3: Write the operations**

`tools/build-scripts/src/release/release.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file The release operations: a port of `build_tools/build/src/release.rs` (`draft_a_new_release`,
 * `publish_release`, `validate_release`, `update_latest_release_version`,
 * `resolve_version_designation`) and of `./run ide upload`'s upload half
 * (`build_tools/cli/src/lib.rs` `upload_ide_assets`). Deliberate differences, each named where it
 * happens: the release version must be given (no silent `-dev` fallback), no `assets.json`, the
 * draft is edited and published in one call, a draft with a half-written asset is not published,
 * and an upload replaces same-named assets on a draft but never touches a published release's.
 */
/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case. */
import { retryDelays } from '../ide-build/ideBuild.ts'
import type { GitHub, Release } from '../lib/githubApi.ts'
import { deduceKind, parseVersion, type Designation, type Version } from '../version/version.ts'
import {
  contentType,
  downloadUrl,
  installerName,
  missingInstallersNote,
  splitUploaded,
  type ReleaseTarget,
  type UploadFile,
} from './assets.ts'
import { prettyName, releaseBody } from './notes.ts'

/**
 * The version a release command works on: `ENSO_VERSION`, which the release workflow sets from its
 * input. Unlike `version`, an empty or invalid value is an error (Phase 3's R4 left that footgun to
 * this phase): a typo must not produce a `-dev` release. A set `ENSO_EDITION` must equal it.
 */
export function releaseVersion(env: Readonly<Record<string, string | undefined>>): Version {
  const text = env.ENSO_VERSION ?? ''
  const parsed = parseVersion(text)
  if (parsed == null) throw new Error(`ENSO_VERSION is not a version: ${JSON.stringify(text)}.`)
  if (env.ENSO_EDITION !== undefined && env.ENSO_EDITION !== parsed.text) {
    throw new Error('Inconsistent ENSO_VERSION and ENSO_EDITION variable values.')
  }
  return parsed
}

/** `ENSO_RELEASE_ID`, the draft `create-draft` made. */
export function releaseId(env: Readonly<Record<string, string | undefined>>): number {
  const text = env.ENSO_RELEASE_ID ?? ''
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`ENSO_RELEASE_ID is not a release id: ${JSON.stringify(text)}.`)
  }
  return Number(text)
}

const DESIGNATIONS: readonly Designation[] = ['stable', 'patch', 'rc', 'nightly']

/** `promote`'s argument. */
export function parseDesignation(text: string | undefined): Designation {
  const found = DESIGNATIONS.find((designation) => designation === text)
  if (found == null) {
    throw new Error(
      `Unknown designation ${JSON.stringify(text)}; expected one of ${DESIGNATIONS.join(', ')}.`,
    )
  }
  return found
}

/** Whether `version` is a prerelease (nightly, rc or dev): GitHub marks it so. */
export function isPrerelease(version: Version): boolean {
  return deduceKind(version) !== 'stable'
}

/** What `createDraft` needs besides GitHub. */
export interface DraftInputs {
  readonly version: Version
  /** The commit to tag (`GITHUB_SHA`). */
  readonly commit: string
  /** The checkout's `HEAD`, or `null` outside a git checkout. */
  readonly head: string | null
  /** The text of `CHANGELOG.md`. */
  readonly changelog: string
  readonly log: (line: string) => void
}

/**
 * Creates the draft release for `inputs.version` at `inputs.commit`. Refuses when the checkout is
 * at another commit, when a release of that tag is already published, or when the tag exists.
 */
export async function createDraft(api: GitHub, inputs: DraftInputs): Promise<Release> {
  const tag = inputs.version.text
  if (inputs.head != null && inputs.head !== inputs.commit) {
    throw new Error(
      `Local HEAD ${inputs.head} is not the same as the commit ${inputs.commit} we were ordered to build.`,
    )
  }
  const repo = `/repos/${api.repository}`
  // `releases/tags/<tag>` finds published releases only, so a hit is always a published one.
  const colliding = await api.json<Release>('GET', `${repo}/releases/tags/${tag}`)
  if (colliding != null) {
    if (!colliding.draft) throw new Error(`Release ${tag} has already been published.`)
    inputs.log(
      `Release ${tag} has already been drafted: ${colliding.html_url}. Creating a new one.`,
    )
  }
  const ref = await api.json<{ object: unknown }>('GET', `${repo}/git/ref/tags/${tag}`)
  if (ref != null) {
    throw new Error(`Tag ${tag} already exists on remote as ${JSON.stringify(ref.object)}.`)
  }
  const release = await api.json<Release>('POST', `${repo}/releases`, {
    tag_name: tag,
    target_commitish: inputs.commit,
    name: prettyName(tag),
    body: releaseBody(api.repository, tag, inputs.changelog),
    prerelease: isPrerelease(inputs.version),
    draft: true,
  })
  if (release == null) throw new Error(`Creating the draft release ${tag} returned nothing.`)
  inputs.log(`Drafted ${release.name ?? tag} (id ${release.id}): ${release.html_url}`)
  return release
}

/** Release `id`; an error when it does not exist. */
async function getRelease(api: GitHub, id: number): Promise<Release> {
  const release = await api.json<Release>('GET', `/repos/${api.repository}/releases/${id}`)
  if (release == null) throw new Error(`Release ${id} does not exist.`)
  return release
}

/**
 * Publishes the draft `id`, which must be release `version` (its tag) and hold only fully
 * uploaded assets: a `starter` asset is an upload that died part-way, and would be published
 * broken. Installers that were not uploaded (a skipped or failed macOS build) are named in a note
 * appended to the body. The tag and target are restated in the same call: editing a draft
 * without them turns it into `untagged-…`, and it would publish without a tag. Then checks that
 * every uploaded installer downloads. Returns the targets left out.
 */
export async function publishRelease(
  api: GitHub,
  id: number,
  version: Version,
  log: (line: string) => void,
): Promise<ReleaseTarget[]> {
  const release = await getRelease(api, id)
  if (!release.draft) throw new Error('Release has been already published!')
  if (release.tag_name !== version.text) {
    throw new Error(
      `Release ${id} is ${release.tag_name}, not ${version.text}: check the release id and version.`,
    )
  }
  const partial = release.assets.filter((asset) => asset.state !== 'uploaded')
  if (partial.length > 0) {
    const names = partial.map((asset) => `${asset.name} (${asset.state})`).join(', ')
    throw new Error(`Not publishing: assets not fully uploaded: ${names}. Re-run their uploads.`)
  }
  const { present, missing } = splitUploaded(
    version.text,
    release.assets.map((asset) => asset.name),
  )
  let body = release.body ?? ''
  if (missing.length > 0) {
    log(`::warning::Publishing without installers for: ${missing.map((t) => t.pretty).join(', ')}.`)
    body += missingInstallersNote(missing)
  }
  await api.json('PATCH', `/repos/${api.repository}/releases/${id}`, {
    tag_name: release.tag_name,
    target_commitish: release.target_commitish,
    body,
    draft: false,
  })
  log(`Published ${release.tag_name}: ${release.html_url}`)
  await validateRelease(api, id, present)
  return missing
}

/**
 * Checks that release `id` is published and that each of `installers` downloads. Run only after
 * publishing: a draft's download URLs do not work. A failure is reported, but the release stays
 * published, as before.
 */
export async function validateRelease(
  api: GitHub,
  id: number,
  installers: readonly ReleaseTarget[],
): Promise<void> {
  const release = await getRelease(api, id)
  if (release.draft) throw new Error(`Release ${id} is not published.`)
  for (const target of installers) {
    const url = downloadUrl(
      api.repository,
      release.tag_name,
      installerName(target, release.tag_name),
    )
    const status = await api.status(url)
    if (status < 200 || status >= 300) {
      throw new Error(`Failed to download asset: ${url} (${status}).`)
    }
  }
}

/** Waits `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Deletes release `id`'s asset `name`, if it has one. */
async function deleteAssetNamed(api: GitHub, id: number, name: string): Promise<void> {
  const stale = (await getRelease(api, id)).assets.find((asset) => asset.name === name)
  if (stale != null) {
    await api.json('DELETE', `/repos/${api.repository}/releases/assets/${stale.id}`)
  }
}

/**
 * Uploads `files` to release `id`, each retried as `./run` retried it (five more times, 0.5 s
 * growing by half).
 *
 * - On a draft, an asset of the same name is replaced: one left by an earlier run of the job
 *   before the upload, and the half-written one a failed attempt leaves before each retry and
 *   after the last (GitHub refuses a second asset of a name).
 * - On a published release (re-running a skipped platform's jobs adds its installer, as with
 *   `./run`), nothing is ever deleted or replaced: an asset of the same name, or one a failed
 *   attempt left, stops the upload with an error.
 */
export async function uploadIdeAssets(
  api: GitHub,
  id: number,
  files: readonly UploadFile[],
  log: (line: string) => void,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<void> {
  const release = await getRelease(api, id)
  const tag = release.tag_name
  const delays = retryDelays(5)
  for (const { file, name } of files) {
    if (release.assets.some((asset) => asset.name === name)) {
      if (!release.draft) {
        throw new Error(
          `Release ${tag} is published and already has ${name}; a published release's assets ` +
            'are never replaced. Delete the asset by hand first if it must change.',
        )
      }
      log(`Replacing ${name}, left on the draft by an earlier run.`)
      await deleteAssetNamed(api, id, name)
    }
    for (let attempt = 0; ; attempt++) {
      try {
        log(`Uploading ${name}.`)
        await api.upload(id, name, file, contentType(name))
        break
      } catch (error) {
        const leftover = (await getRelease(api, id)).assets.some((asset) => asset.name === name)
        if (leftover && !release.draft) {
          throw new Error(
            `Uploading ${name} to the published release ${tag} failed and left a partial ` +
              `asset, which is never deleted automatically; delete it by hand and re-run. ` +
              `(${String(error)})`,
            { cause: error },
          )
        }
        if (leftover) await deleteAssetNamed(api, id, name)
        const delay = delays[attempt]
        if (delay == null) throw error
        log(`Uploading ${name} failed (${String(error)}); retrying in ${delay} ms.`)
        await wait(delay)
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run:
`corepack pnpm --filter build-scripts exec vitest run src/release/release.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/build-scripts/src/release/release.ts tools/build-scripts/src/release/release.test.ts
git commit -m "tools/build-scripts: draft, upload to, publish and validate a release"
```

---

### Task 4: The `release` command, and PR 4a

**Files:**

- Create: `tools/build-scripts/src/commands/release.ts`
- Modify: `tools/build-scripts/package.json` (`scripts`),
  `tools/build-scripts/CLAUDE.md` (Commands, Layout)

**Interfaces:**

- Consumes: Tasks 1–3; `publish` from `src/lib/github.ts`; `capture`,
  `commandArguments`, `REPO_ROOT` from `src/lib/repo.ts`; `targetOs` from
  `src/ide-build/ideBuild.ts`; `generateVersion`, `isReleaseMode`,
  `parseLsRemoteTags`, `todayUtc` from `src/version/version.ts`.
- Produces: the script
  `corepack pnpm --filter build-scripts run release <action>`, with the actions
  `create-draft` (outputs `ENSO_VERSION`, `ENSO_EDITION`, `ENSO_RELEASE_MODE`,
  `ENSO_RELEASE_ID`), `upload-ide`, `publish`, `promote <designator>` (outputs
  the version triple) and `update-latest-version` (output
  `ENSO_LATEST_RELEASE_UPDATED`). Task 5's workflows call exactly these.

- [ ] **Step 1: Write the entry point**

`tools/build-scripts/src/commands/release.ts`:

<!-- prettier-ignore -->
```ts
/**
 * @file `release <action>`: the release workflow's steps, as `./run release …` and `./run ide
 * upload` ran them. Every action talks to GitHub with `GITHUB_TOKEN`, about `GITHUB_REPOSITORY`.
 *
 * - `create-draft` — drafts release `ENSO_VERSION` at `GITHUB_SHA`, with the notes from
 *   `CHANGELOG.md`; publishes `ENSO_RELEASE_ID` and the version triple.
 * - `upload-ide` — uploads this platform's installer, its `.sha256` and the update files from
 *   `dist/ide` to the draft `ENSO_RELEASE_ID`.
 * - `publish` — publishes the draft `ENSO_RELEASE_ID`, noting missing installers, and checks the
 *   installers download.
 * - `promote <stable|patch|rc|nightly>` — the next version of that kind after `origin`'s tags;
 *   publishes the version triple. Needs no token.
 * - `update-latest-version` — records a stable `ENSO_VERSION` as `latest-release` in
 *   `build-config.yaml`; publishes `ENSO_LATEST_RELEASE_UPDATED`. Needs no token.
 *
 *     corepack pnpm --filter build-scripts run release create-draft
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { targetOs } from '../ide-build/ideBuild.ts'
import { publish } from '../lib/github.ts'
import { gitHubFromEnv } from '../lib/githubApi.ts'
import { capture, commandArguments, REPO_ROOT } from '../lib/repo.ts'
import { ideUploadFiles } from '../release/assets.ts'
import { withLatestRelease } from '../release/latestRelease.ts'
import {
  createDraft,
  isPrerelease,
  parseDesignation,
  publishRelease,
  releaseId,
  releaseVersion,
  uploadIdeAssets,
} from '../release/release.ts'
import {
  generateVersion,
  isReleaseMode,
  parseLsRemoteTags,
  todayUtc,
  type Version,
} from '../version/version.ts'

const USAGE =
  'Usage: release create-draft | upload-ide | publish | promote <stable|patch|rc|nightly> | update-latest-version'

/** The version triple, under the names `./run` published. */
function versionValues(version: Version): Record<string, string> {
  return {
    ENSO_VERSION: version.text,
    ENSO_EDITION: version.text,
    ENSO_RELEASE_MODE: String(isReleaseMode(version)),
  }
}

/** The checkout's `HEAD`, or `null` when this is not a git checkout. */
function head(): string | null {
  const result = capture('git', ['rev-parse', '--verify', 'HEAD'])
  return result.status === 0 ? result.stdout.trim() : null
}

/** `origin`'s tags as versions. */
function remoteReleases(): Version[] {
  const result = capture('git', ['ls-remote', '--tags', 'origin'])
  if (result.status !== 0) {
    throw new Error(`\`git ls-remote --tags origin\` failed: ${result.stderr.trim()}`)
  }
  return parseLsRemoteTags(result.stdout)
}

const log = (line: string) => console.log(line)

try {
  const [action, ...rest] = commandArguments()
  const env = process.env
  switch (action) {
    case 'create-draft': {
      const version = releaseVersion(env)
      const commit = env.GITHUB_SHA ?? ''
      if (commit === '') throw new Error('GITHUB_SHA is not set.')
      const draft = await createDraft(gitHubFromEnv(env), {
        version,
        commit,
        head: head(),
        changelog: readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'),
        log,
      })
      publish({ ...versionValues(version), ENSO_RELEASE_ID: String(draft.id) })
      break
    }
    case 'upload-ide': {
      const version = releaseVersion(env)
      const files = ideUploadFiles(
        targetOs(process.platform),
        version.text,
        path.join(REPO_ROOT, 'dist', 'ide'),
        existsSync,
      )
      await uploadIdeAssets(gitHubFromEnv(env), releaseId(env), files, log)
      break
    }
    case 'publish': {
      await publishRelease(gitHubFromEnv(env), releaseId(env), releaseVersion(env), log)
      break
    }
    case 'promote': {
      if (rest.length !== 1) throw new Error(USAGE)
      const designation = parseDesignation(rest[0])
      const version = generateVersion(designation, remoteReleases(), todayUtc(new Date()))
      // On stderr, so that locally `eval "$(… release promote rc)"` reads only the exports.
      console.error(`Promoting ${designation}: ${version.text}`)
      publish(versionValues(version))
      break
    }
    case 'update-latest-version': {
      const version = releaseVersion(env)
      const file = path.join(REPO_ROOT, 'build-config.yaml')
      let updated = false
      if (isPrerelease(version)) {
        log(`${version.text} is a prerelease; leaving the latest-release entry untouched.`)
      } else {
        const old = readFileSync(file, 'utf8')
        const next = withLatestRelease(old, version.text)
        updated = next !== old
        if (updated) {
          writeFileSync(file, next)
          log(`Recorded ${version.text} as the latest release in ${file}.`)
        } else {
          log(`${file} already records ${version.text} as the latest release.`)
        }
      }
      publish({ ENSO_LATEST_RELEASE_UPDATED: String(updated) })
      break
    }
    default:
      throw new Error(USAGE)
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

In `tools/build-scripts/package.json`, insert after the `junit-compare` script:

```json
    "release": "node src/commands/release.ts",
```

- [ ] **Step 2: Document it**

In `tools/build-scripts/CLAUDE.md`, after the `junit-compare` bullet of
"Commands", add:

<!-- prettier-ignore -->
```markdown
- `release <action>` — the release workflow's steps (`release.yml`,
  `promote.yml`), as `./run release …` and `./run ide upload` ran them:
  `create-draft` drafts release `ENSO_VERSION` at `GITHUB_SHA` with the top
  section of `CHANGELOG.md`; `upload-ide` uploads this platform's installer, its
  `.sha256` and the update feeds from `dist/ide` to the draft `ENSO_RELEASE_ID`;
  `publish` publishes it, noting missing installers, and checks that the
  installers download; `promote <stable|patch|rc|nightly>` computes the next
  version from `origin`'s tags; `update-latest-version` records a stable version
  as `latest-release` in `build-config.yaml`. They need `GITHUB_TOKEN` and
  `GITHUB_REPOSITORY` (except `promote` and `update-latest-version`). Run only
  `promote` locally: the others change the real repository's releases.
```

and in the "Layout" bullet for `src/lib/`, after "publishing to GitHub Actions
(`github.ts`)," insert "GitHub's REST API (`githubApi.ts`),", so that it reads:

<!-- prettier-ignore -->
```markdown
- `src/lib/` — shared helpers: the repository root and running programs
  (`repo.ts`), publishing to GitHub Actions (`github.ts`), GitHub's REST API
  (`githubApi.ts`), finding the engine package (`engine.ts`), starting sbt
  (`sbt.ts`, the only module that may).
```

Run `corepack pnpm exec prettier --write tools/build-scripts/CLAUDE.md`.

- [ ] **Step 3: Check the package**

```bash
cd /c/Repos/Enso/ide-bs-4a
corepack pnpm --filter build-scripts run typecheck
corepack pnpm --filter build-scripts run lint
corepack pnpm --filter build-scripts run test:unit 2>&1 | grep -E "Test Files|Tests "
corepack pnpm exec prettier --check tools/build-scripts
```

Expected: no type errors; ESLint clean with `--max-warnings=0` (the two release
modules disable `camelcase` for the API's field names, as the GUI's tests do);
`Test Files  17 passed`, `Tests  176 passed` (122 before, 54 new); Prettier
clean.

- [ ] **Step 4: Try the safe actions locally**

```bash
corepack pnpm --silent --filter build-scripts run release promote rc
corepack pnpm --silent --filter build-scripts run release promote nightly
ENSO_VERSION=2026.1.1-rc.5 corepack pnpm --silent --filter build-scripts run release update-latest-version
GITHUB_TOKEN= corepack pnpm --silent --filter build-scripts run release publish; echo "exit $?"
corepack pnpm --silent --filter build-scripts run release; echo "exit $?"
git status --short
```

Expected, on 2026-10-23 (the nightly index follows the day's existing
nightlies):

- `promote rc` prints `Promoting rc: 2026.1.1-rc.5` on stderr and the three
  `export` lines with `2026.1.1-rc.5` and `ENSO_RELEASE_MODE='true'`: rc.4 is
  the newest rc with the next stable's core (`2026.1.1`; there is no 2026
  stable);
- `promote nightly` gives `2026.1.1-nightly.<today>` (or `.<today>.1` when a
  nightly of today exists, as on 2026-10-23);
- `update-latest-version` prints
  `2026.1.1-rc.5 is a prerelease; leaving the latest-release entry untouched.`
  and `export ENSO_LATEST_RELEASE_UPDATED='false'`;
- `publish` without a token: `Error: GITHUB_TOKEN is not set.`, exit 1 (nothing
  reaches GitHub);
- no action: the usage line, exit 1;
- `git status` shows only this task's files: `build-config.yaml` is untouched.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add tools/build-scripts/src/commands/release.ts tools/build-scripts/package.json tools/build-scripts/CLAUDE.md
git commit -m "tools/build-scripts: the release command (create-draft, upload-ide, publish, promote, update-latest-version)"
git push -u origin ci/release-build-scripts
```

Write `$SCRATCH/pr-4a.md`: what the PR adds (the five actions, ported from
`release.rs`, `manifest.rs`, `changelog.rs`, `config.rs` and `ide upload`); the
deliberate differences (Decisions 2, 3, 6, 7; R3's replacement rules, R4's
single PATCH, R11's upload timeout, R12's 404 rule, R14's CRLF); that no
workflow uses it yet (4b does); the test count; "Part of #289's Phase 4."; the
attribution lines. Then:

```bash
gh pr create --base develop --head ci/release-build-scripts --label "CI: No changelog needed" \
  --title "Build simplification, PR 4a: the release command in tools/build-scripts" \
  --body-file "$SCRATCH/pr-4a.md"
```

- [ ] **Step 6: Wait, merge**

Run `"$SCRATCH/wait-pr.sh" <N> 150` in the background and start Task 5's reading
meanwhile. Expected checks: "Build Scripts" (green, about 2 minutes; its log
shows `Tests  176 passed` on Linux), Changelog (green by its label), Workflow
Lint (it runs on `tools/build-scripts/**`), and ✨ Engine
(`engine-changed-files.yml` lists `tools/build-scripts/**`; about an hour). When
every check is green: `gh pr merge <N> --squash`.

---

### Task 5: `release.yml`, `promote.yml` and `nightly.yml` on `tools/build-scripts`, with the policy (PR 4b)

**Files:**

- Modify: `tools/ci/check-workflows.mjs`, `tools/ci/check-workflows.test.mjs`,
  `tools/ci/README.md` (by `$SCRATCH/edit-policy-4b.py`, below)
- Rewrite: `.github/workflows/release.yml`, `promote.yml`, `nightly.yml`,
  `.github/actionlint.yaml`
- Modify: `.github/CLAUDE.md` (by `$SCRATCH/edit-github-claude.py`, Task 0),
  `docs/distribution/nightly.md`

**Interfaces:**

- Consumes: the `release` script and its outputs (Task 4); `version`,
  `ide-build` (Phase 3); sbt `buildEngineBundle`; the composite actions
  `setup-node`, `setup-build-scripts`, `setup-jvm`, `setup-msvc`, `setup-rust`,
  `git-clean`; `tools/ci/wait-for-macos-runner.sh`.
- Produces: `release.yml` (`workflow_dispatch`/`workflow_call`, inputs
  `version`, `publish` (default `true`) and `release-id` (default `""`); see
  Note [Publishing Later] in it) with the job ids `check-the-mac-os-runner`,
  `draft-release` (outputs `ENSO_RELEASE_ID`, `ENSO_VERSION`), `license-check`,
  `gui-build`, `build-backend` (matrix linux/windows), `build-backend-macos`,
  `upload-ide` (matrix), `upload-ide-macos`, `publish-release`,
  `update-latest-release-version`; `promote.yml` (inputs `designator` and
  `publish`, job `promote` with outputs `ENSO_VERSION`, `ENSO_EDITION`,
  `ENSO_RELEASE_MODE`, then `release`); the policy functions
  `checkReleaseIsIdeOnly`, `checkOnlyMacosReleaseJobsMayFail`,
  `checkMacosJobsAreGated` (same names, new rules) and the private helpers
  `isMacosCaller`, `ungatedMacosJobs` that Task 9 reuses.

- [ ] **Step 1: Create the worktree, once 4a has merged**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-4b -b ci/release-workflows origin/develop
cd /c/Repos/Enso/ide-bs-4b
corepack pnpm install --frozen-lockfile --ignore-scripts
git log --oneline -1 -- tools/build-scripts/src/commands/release.ts
```

Expected: the log names 4a's squash commit.

- [ ] **Step 2: Save the policy edit, and apply its tests first**

`$SCRATCH/edit-policy-4b.py` replaces the release section of the policy and of
its tests with the blocks it carries (and adds one clause to the README):

<!-- prettier-ignore -->
```python
"""The workflow policy's release rules, for Phase 4's release workflows (PR 4b).

Usage: py -3 edit-policy-4b.py <repository root>

Three targeted replacements, each between two markers that must occur exactly once:

- tools/ci/check-workflows.mjs: from `const RELEASE_FORBIDDEN = [` up to the comment before
  `checkMacosChecksRunWhatIsRequested` (the release rules);
- tools/ci/check-workflows.test.mjs: from `const RELEASE_OK = ` up to
  `describe('checkPullRequestsIgnoreSpecs'` (the release fixture), and from
  `describe('checkReleaseIsIdeOnly'` up to `describe('checkMacosChecksRunWhatIsRequested'` (the
  release tests; this drops the old `MACOS_UPLOAD`, `PUBLISH` and `GATE_IF`). The tests of
  `checkPullRequestsIgnoreSpecs` and `checkSetupNodeCache`, between the two, are kept.

It also adds one clause to tools/ci/README.md. Nothing is written unless every marker is found.
"""
import sys

root = sys.argv[1]
NL = chr(10)

POLICY = r'''const RELEASE_FORBIDDEN = [
  'deploy-runtime',
  'dispatch-build-image',
  'upload-backend',
  'ARTEFACT_S3',
  'ECR_PUSH',
  'CI_PRIVATE_TOKEN',
  'Download Edition File',
  '--backend-source release',
]
const RELEASE_REQUIRED = [
  'run release create-draft',
  'run release upload-ide',
  'run release publish',
  'run release update-latest-version',
  'ENSO_BUILD_UPDATE_INFO',
]
/**
 * The workflow token and the self-hosted Mac's status check. The fork ships unsigned and without
 * Sentry (build simplification, Phase 4): signing comes back as electron-builder's own settings,
 * with its secrets added here.
 */
const RELEASE_SECRETS = new Set(['GITHUB_TOKEN', 'RUNNER_STATUS_TOKEN'])

/** Releases are IDE-only GitHub releases and need no cloud secrets (`release_is_ide_only_...`). */
export function checkReleaseIsIdeOnly({ workflows }) {
  const release = workflows['release.yml']
  if (!release) return ['release.yml: missing']
  const problems = []
  for (const text of RELEASE_FORBIDDEN) {
    if (release.text.includes(text)) problems.push(`release.yml: still contains \`${text}\``)
  }
  for (const text of RELEASE_REQUIRED) {
    if (!release.text.includes(text)) problems.push(`release.yml: lacks \`${text}\``)
  }
  const secrets = new Set([...release.text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))
  for (const secret of secrets) {
    if (!RELEASE_SECRETS.has(secret)) problems.push(`release.yml: reads secret \`${secret}\``)
  }
  return problems
}

/** The macOS jobs of `release.yml`: the Mac builds the backend and the IDE, nothing else. */
const MACOS_RELEASE_JOBS = ['build-backend-macos', 'upload-ide-macos']

/** Only macOS jobs may fail without blocking publishing (`only_macos_release_jobs_may_fail_...`). */
export function checkOnlyMacosReleaseJobsMayFail({ workflows }) {
  const jobs = Object.entries(workflows['release.yml']?.doc?.jobs ?? {})
  const problems = []
  for (const [id, job] of jobs) {
    const tolerant = job?.['continue-on-error'] === true
    if (tolerant && !isMacos(job)) {
      problems.push(`release.yml › ${id}: only macOS jobs may set \`continue-on-error\``)
    }
    if (!tolerant && isMacos(job) && /build-backend|upload-ide/.test(id)) {
      problems.push(`release.yml › ${id}: a macOS backend or IDE job must not block publishing`)
    }
  }
  const macosIds = jobs.filter(([, job]) => isMacos(job)).map(([id]) => id)
  for (const required of MACOS_RELEASE_JOBS) {
    if (!macosIds.includes(required)) problems.push(`release.yml: has no macOS job \`${required}\``)
  }
  for (const id of macosIds) {
    if (!MACOS_RELEASE_JOBS.includes(id)) problems.push(`release.yml › ${id}: unexpected macOS job`)
  }
  return problems
}

/** A job that calls a reusable workflow for macOS (`with: { os: macos }`). */
const isMacosCaller = (job) => job?.with?.os === 'macos'

/**
 * The jobs of `file` that run on the Mac, or call a workflow for it, but do not wait for
 * `check-the-mac-os-runner` and run only when it reports the Mac online.
 */
function ungatedMacosJobs(file, jobs) {
  const problems = []
  const macos = (job) => isMacos(job) || isMacosCaller(job)
  if (!('check-the-mac-os-runner' in jobs) && Object.values(jobs).some(macos)) {
    problems.push(`${file}: has macOS jobs but no \`check-the-mac-os-runner\` gate job`)
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (!macos(job)) continue
    const needs = [job.needs ?? []].flat()
    if (
      !needs.includes('check-the-mac-os-runner') ||
      !String(job.if ?? '').includes('outputs.online')
    ) {
      problems.push(
        `${file} › ${id}: a macOS job must need \`check-the-mac-os-runner\` and run only when it reports the Mac online`,
      )
    }
  }
  return problems
}

/**
 * What `publish-release`'s `if` must test: the `publish` input (a release can stop at a checked
 * draft), and every job's result but macOS's.
 */
const PUBLISH_REQUIRES = [
  'inputs.publish',
  "needs.draft-release.result == 'success'",
  "needs.license-check.result == 'success'",
  "needs.upload-ide.result == 'success'",
]

/**
 * With the self-hosted Mac (#288), every macOS job waits for `check-the-mac-os-runner` and is
 * skipped while the Mac is offline, and publishing does not wait on macOS results
 * (`release_skips_macos_jobs_...`, `nightly_skips_macos_jobs_...`). The latest-version update
 * tests the publish job's result itself: by default a job is skipped when any job before it
 * failed, a macOS one included.
 */
export function checkMacosJobsAreGated({ workflows }) {
  const problems = []
  const nightly = workflows['engine-checks-nightly.yml']?.doc?.jobs
  if (nightly) {
    if (!('build-script-macos-aarch64' in nightly)) {
      problems.push('engine-checks-nightly.yml: has no macOS job `build-script-macos-aarch64`')
    }
    problems.push(...ungatedMacosJobs('engine-checks-nightly.yml', nightly))
  }
  const release = workflows['release.yml']?.doc?.jobs
  if (!release) return problems
  problems.push(...ungatedMacosJobs('release.yml', release))
  const publish = release['publish-release']
  if (!publish) return [...problems, 'release.yml: has no `publish-release` job']
  const condition = String(publish.if ?? '')
  if (![publish.needs ?? []].flat().includes('upload-ide-macos')) {
    problems.push('release.yml › publish-release: must still need the macOS IDE upload')
  }
  if (/macos/i.test(condition)) {
    problems.push('release.yml › publish-release: its `if` must not wait on a macOS job')
  }
  for (const required of PUBLISH_REQUIRES) {
    if (!condition.includes(required)) {
      problems.push(`release.yml › publish-release: its \`if\` lacks \`${required}\``)
    }
  }
  const update = release['update-latest-release-version']
  if (!update) return [...problems, 'release.yml: has no `update-latest-release-version` job']
  if (!String(update.if ?? '').includes("needs.publish-release.result == 'success'")) {
    problems.push(
      "release.yml › update-latest-release-version: its `if` must test `needs.publish-release.result == 'success'`",
    )
  }
  return problems
}

'''

FIXTURE = r'''const GATE_IF = "if: needs.check-the-mac-os-runner.outputs.online == 'true'"

const RELEASE_OK = `
name: Release
on: workflow_dispatch
env:
  ENSO_BUILD_UPDATE_INFO: "true"
jobs:
  check-the-mac-os-runner:
    runs-on: ubuntu-latest
    steps: []
  draft-release:
    runs-on: ubuntu-latest
    steps:
      - run: corepack pnpm --filter build-scripts run release create-draft
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
  build-backend-macos:
    needs: [check-the-mac-os-runner]
    ${GATE_IF}
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    steps: []
  upload-ide:
    runs-on: ubuntu-latest
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  upload-ide-macos:
    needs: [check-the-mac-os-runner, build-backend-macos]
    ${GATE_IF}
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    steps:
      - run: corepack pnpm --filter build-scripts run release upload-ide
  publish-release:
    runs-on: ubuntu-latest
    needs: [draft-release, license-check, upload-ide, upload-ide-macos]
    if: "!cancelled() && (inputs.release-id != '' || (inputs.publish && needs.draft-release.result == 'success' && needs.license-check.result == 'success' && needs.upload-ide.result == 'success'))"
    steps:
      - run: corepack pnpm --filter build-scripts run release publish
  update-latest-release-version:
    runs-on: ubuntu-latest
    needs: [draft-release, publish-release]
    if: "!cancelled() && needs.publish-release.result == 'success'"
    steps:
      - run: corepack pnpm --filter build-scripts run release update-latest-version
`

'''

RELEASE_TESTS = r'''describe('checkReleaseIsIdeOnly', () => {
  test('accepts an IDE-only release', () => {
    assert.deepEqual(checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': RELEASE_OK })), [])
  })
  test('rejects cloud steps, signing secrets, and a missing release setting', () => {
    const text = RELEASE_OK.replace(
      'run release upload-ide\n  upload-ide-macos',
      'run release upload-ide --backend-source release\n  upload-ide-macos',
    )
      .replace('secrets.GITHUB_TOKEN', 'secrets.CI_PRIVATE_TOKEN')
      .replace(
        'ENSO_BUILD_UPDATE_INFO: "true"',
        'CSC_LINK: ${{ secrets.APPLE_CODE_SIGNING_CERT }}',
      )
    const problems = checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': text }))
    assert.ok(problems.some((p) => p.includes('--backend-source release')))
    assert.ok(problems.some((p) => p.includes('reads secret `CI_PRIVATE_TOKEN`')))
    assert.ok(problems.some((p) => p.includes('reads secret `APPLE_CODE_SIGNING_CERT`')))
    assert.ok(problems.some((p) => p.includes('lacks `ENSO_BUILD_UPDATE_INFO`')))
  })
})

describe('checkOnlyMacosReleaseJobsMayFail', () => {
  const problems = (text) =>
    checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text }))
  test('accepts tolerant macOS backend and IDE jobs', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('rejects a tolerant Linux job and a blocking macOS upload', () => {
    const text = RELEASE_OK.replace(
      '    runs-on: [self-hosted, macOS]\n    continue-on-error: true\n    steps:\n',
      '    runs-on: [self-hosted, macOS]\n    steps:\n',
    ).replace(
      '  draft-release:\n    runs-on: ubuntu-latest',
      '  draft-release:\n    runs-on: ubuntu-latest\n    continue-on-error: true',
    )
    const found = problems(text)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('draft-release: only macOS jobs')))
    assert.ok(found.some((p) => p.includes('upload-ide-macos: a macOS backend or IDE job')))
  })
  test('rejects a release without its macOS IDE upload job, and an unexpected macOS job', () => {
    const found = problems(RELEASE_OK.replace('upload-ide-macos:', 'something-else:'))
    assert.ok(found.some((p) => p.includes('has no macOS job `upload-ide-macos`')))
    assert.ok(found.some((p) => p.includes('something-else: unexpected macOS job')))
  })
})

describe('checkMacosJobsAreGated', () => {
  const problems = (text) => checkMacosJobsAreGated(fixture({ 'workflows/release.yml': text }))
  test('accepts a gated release whose publish job does not wait on macOS', () => {
    assert.deepEqual(problems(RELEASE_OK), [])
  })
  test('accepts a gated nightly', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  build-script-macos-aarch64: { needs: [check-the-mac-os-runner], ${GATE_IF}, runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  test('rejects an ungated macOS job in the nightly, and a nightly without its macOS script job', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  tests-macos: { runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    const found = checkMacosJobsAreGated(repo)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('tests-macos')))
    assert.ok(found.some((p) => p.includes('build-script-macos-aarch64')))
  })
  test('rejects macOS jobs when the gate job is missing', () => {
    const text = RELEASE_OK.replace(
      '  check-the-mac-os-runner:\n    runs-on: ubuntu-latest\n    steps: []\n',
      '',
    )
    assert.ok(problems(text).some((p) => p.includes('no `check-the-mac-os-runner` gate job')))
  })
  test('rejects an ungated macOS job in the release', () => {
    const text = RELEASE_OK.replace(
      `  build-backend-macos:\n    needs: [check-the-mac-os-runner]\n    ${GATE_IF}\n`,
      '  build-backend-macos:\n',
    )
    assert.ok(problems(text).some((p) => p.includes('build-backend-macos: a macOS job must need')))
  })
  test('rejects a release with no publish job', () => {
    const text = RELEASE_OK.replace('publish-release:', 'something-else:')
    assert.ok(problems(text).some((p) => p.includes('no `publish-release` job')))
  })
  test('rejects a publish job that no longer needs the macOS upload', () => {
    const text = RELEASE_OK.replace(
      'needs: [draft-release, license-check, upload-ide, upload-ide-macos]',
      'needs: [draft-release, license-check, upload-ide]',
    )
    assert.ok(problems(text).some((p) => p.includes('must still need the macOS IDE upload')))
  })
  test('rejects a publish job that waits on macOS, and one that drops a required result', () => {
    const waits = problems(
      RELEASE_OK.replace(
        'inputs.publish && needs.draft-release',
        "inputs.publish && needs.upload-ide-macos.result == 'success' && needs.draft-release",
      ),
    )
    assert.ok(waits.some((p) => p.includes('must not wait on a macOS job')))
    const drops = problems(RELEASE_OK.replace(" && needs.license-check.result == 'success'", ''))
    assert.ok(drops.some((p) => p.includes("lacks `needs.license-check.result == 'success'`")))
    const unheld = problems(RELEASE_OK.replace('inputs.publish && ', ''))
    assert.ok(unheld.some((p) => p.includes('lacks `inputs.publish`')))
  })
  test('rejects a latest-version update that a failed macOS job would skip', () => {
    const text = RELEASE_OK.replace(
      `    if: "!cancelled() && needs.publish-release.result == 'success'"\n`,
      '',
    )
    assert.ok(
      problems(text).some((p) => p.includes('update-latest-release-version: its `if` must test')),
    )
  })
})

'''


def between(text, start, end, block):
    """`text` with [start, end) replaced by `block`; `start` and `end` must occur once each."""
    assert text.count(start) == 1 and text.count(end) == 1, (start, end)
    i, j = text.index(start), text.index(end)
    assert i < j, (start, end)
    return text[:i] + block + text[j:]


def read(path):
    return open(path, encoding='utf-8').read()


mjs = root + '/tools/ci/check-workflows.mjs'
test = root + '/tools/ci/check-workflows.test.mjs'
readme = root + '/tools/ci/README.md'
new_mjs = between(
    read(mjs),
    'const RELEASE_FORBIDDEN = [',
    '/** `macos-checks.yml` (#288) runs only what its inputs ask for',
    POLICY,
)
new_test = between(
    read(test), 'const RELEASE_OK = `', "describe('checkPullRequestsIgnoreSpecs', () => {", FIXTURE
)
new_test = between(
    new_test,
    "describe('checkReleaseIsIdeOnly', () => {",
    "describe('checkMacosChecksRunWhatIsRequested', () => {",
    RELEASE_TESTS,
)
old_sentence = 'macOS jobs are gated on' + NL + 'the self-hosted Mac,'
readme_text = read(readme)
assert readme_text.count(old_sentence) == 1, 'README sentence'
new_readme = readme_text.replace(
    old_sentence,
    'macOS jobs are gated on' + NL + "the self-hosted Mac, the release's latest-version update follows its publish job,",
)
for path, text in [(mjs, new_mjs), (test, new_test), (readme, new_readme)]:
    open(path, 'w', encoding='utf-8', newline=NL).write(text)
    print('edited', path)
```

To see the new tests fail against the old rules, apply the script, then put the
old `check-workflows.mjs` back for one run:

```bash
py -3 "$SCRATCH/edit-policy-4b.py" .
cp tools/ci/check-workflows.mjs "$SCRATCH/check-workflows-4b.mjs"
git show origin/develop:tools/ci/check-workflows.mjs > tools/ci/check-workflows.mjs
node --test --test-reporter=tap tools/ci/check-workflows.test.mjs 2>&1 | grep -E "not ok|^# (pass|fail)"
```

Expected: 9 failing tests, in `checkReleaseIsIdeOnly` (2),
`checkOnlyMacosReleaseJobsMayFail` (3) and `checkMacosJobsAreGated` (4: "accepts
a gated release …", "rejects a release with no publish job", "… waits on macOS,
and one that drops a required result", "rejects a latest-version update …");
"the repository follows the policy" still passes (old rules, old workflows):
`# pass 79`, `# fail 9`. The tests of `checkPullRequestsIgnoreSpecs` and
`checkSetupNodeCache`, which sit between the release fixture and the release
tests, are untouched and pass.

- [ ] **Step 3: Put the new rules back**

```bash
cp "$SCRATCH/check-workflows-4b.mjs" tools/ci/check-workflows.mjs
node --test --test-reporter=tap tools/ci/check-workflows.test.mjs 2>&1 | grep -E "not ok|^# (pass|fail)"
```

Expected: `# pass 87`, `# fail 1`: only "the repository follows the policy"
fails, listing the old `release.yml`'s problems: it lacks the
`run release upload-ide` step; it reads the Sentry, Apple and Microsoft secrets
(eight lines); it has no macOS jobs `build-backend-macos` and
`upload-ide-macos`; its three old macOS job ids are "unexpected"; and it has no
`publish-release` job. The next step fixes the workflow.

- [ ] **Step 4: Write the three workflows**

`.github/workflows/release.yml` (whole file):

<!-- prettier-ignore -->
```yaml
# Hand-written. Releases one version of the IDE: drafts a GitHub release, builds the engine bundle
# and the GUI, packages the installers for Windows, Linux and (on the self-hosted Mac, when it is
# online) macOS, uploads them with their checksums and update feeds to the draft, publishes it, and
# records a stable version as `latest-release`. Called by `promote.yml`, which computes the version;
# can be started by hand with one. The logic is `tools/build-scripts`' `release` command (build
# simplification, Phase 4; docs/superpowers/specs/2026-10-20-build-simplification-design.md). Change
# this file only together with an rc release test.

name: Release
on:
  workflow_dispatch:
    inputs:
      version:
        description: What version number this release should get.
        required: true
        type: string
      publish:
        description: >-
          Publish the release when its installers are uploaded. False stops at the draft, for a
          release test to check before anyone can download it; publish it later with
          `release-id`.
        required: false
        type: boolean
        default: true
      release-id:
        description: >-
          Publish this existing draft (its id, from the run that made it) and record its version,
          instead of building a release. `version` must be the draft's version.
        required: false
        type: string
        default: ""
  workflow_call:
    inputs:
      version:
        description: What version number this release should get.
        required: true
        type: string
      publish:
        description: >-
          Publish the release when its installers are uploaded. False stops at the draft, for a
          release test to check before anyone can download it; publish it later with
          `release-id`.
        required: false
        type: boolean
        default: true
      release-id:
        description: >-
          Publish this existing draft (its id, from the run that made it) and record its version,
          instead of building a release. `version` must be the draft's version.
        required: false
        type: string
        default: ""

concurrency: release

env:
  # Every build of this run is this version: `tools/build-scripts`' `version` and `release` read
  # `ENSO_VERSION`, and sbt reads both.
  ENSO_VERSION: ${{ inputs.version }}
  ENSO_EDITION: ${{ inputs.version }}
  # Read by `.github/actions/git-clean`. A release always cleans, before and after each job: the
  # self-hosted Mac keeps its working tree between runs.
  ENSO_CI_CLEAN_BUILD: "true"

# Note [Release Without ./run]
# ============================
# What `./run` did for each job, and where it went:
# - `release create-draft`, `release publish`, `release update-latest-version`, `release promote`
#   and the upload half of `ide upload` are `tools/build-scripts`' `release` command
#   (`src/release/`). The release version must be given: an invalid one is an error, not a `-dev`
#   build.
# - `backend get` is the sbt task `buildEngineBundle`, as in `ide-packaging.yml` (Note [Engine
#   Bundle Without ./run] there).
# - `ide upload` built the GUI on each platform; the GUI is the same web bundle everywhere, so one
#   job builds it, as `ide-packaging.yml` does, at the release version.
# - The packaging is `ide-build`, then `release upload-ide` uploads the installer, its `.sha256`
#   and what `electron-updater` reads (`latest.yml`, `latest-linux.yml`, the blockmaps; on a signed
#   Mac `latest-mac.yml` and the zip) to the draft, by its id. electron-builder never publishes:
#   `buildPackage` passes `publish: 'never'` and writes the feeds from its `publish` settings.
# - `backend sbt verifyLicensePackages` is a plain sbt step.
# - Gone, because the fork has no use for them: Sentry (`SENTRY_AUTH_TOKEN` and the
#   `ENSO_IDE_SENTRY_*` variables), the cloud and analytics variables (`ENSO_IDE_HOST`, the Google
#   Analytics tag; the IDE is local-only), the AG Grid licence key (the grid runs without one), the
#   Apple and Microsoft signing secrets, and `assets.json` (only upstream's website read it).
#
# Note [Publishing Later]
# ========================
# A release test must not publish what it has not checked: as soon as a prerelease is public, the
# installed apps that include prereleases are offered it. So `publish: false` stops a run at the
# filled draft (the publish and latest-version jobs are skipped), and a second run with
# `release-id: <the draft's id>` and the same `version` skips every build job and runs only those
# two. `release publish` checks that the draft's tag is `version`. The nightly calls this workflow
# through `promote.yml` with the defaults, and so publishes at once.
#
# Note [Signing The Installers]
# =============================
# The fork ships unsigned. To sign later, configure electron-builder, not this workflow's logic:
# Windows through `win.signtoolOptions` (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`) or
# `win.azureSignOptions` (Azure Trusted Signing), and macOS through `CSC_LINK`/`CSC_KEY_PASSWORD`
# with the notarization `afterSign` hook that `app/electron-client/electron-builder-config.ts`
# already has (`APPLEID`, `APPLEIDPASS`, `APPLETEAMID`). Pass the secrets as `env` on the
# "Package the IDE" steps and add them to `RELEASE_SECRETS` in `tools/ci/check-workflows.mjs`.
# `ide-build --sign` is already passed; without a certificate it changes nothing. A signed Mac
# build also writes `latest-mac.yml` and the zip, which `upload-ide` then uploads.

jobs:
  # The Mac is a self-hosted runner that may be offline. Its jobs wait for it for one minute and are
  # skipped when it does not appear; publishing then notes the missing installer. Keep in step with
  # `engine-checks-nightly.yml` and `macos-pull-request.yml`.
  check-the-mac-os-runner:
    name: Check the macOS runner
    if: inputs.release-id == ''
    runs-on: ubuntu-latest
    timeout-minutes: 6
    outputs:
      online: ${{ steps.wait.outputs.online }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - id: wait
        name: Wait for the macOS runner
        run: ./tools/ci/wait-for-macos-runner.sh 1 skip
        env:
          RUNNER_STATUS_TOKEN: ${{ secrets.RUNNER_STATUS_TOKEN }}

  draft-release:
    name: Create a release draft.
    if: inputs.release-id == ''
    runs-on: ubuntu-latest
    outputs:
      ENSO_RELEASE_ID: ${{ steps.prepare.outputs.ENSO_RELEASE_ID }}
      ENSO_VERSION: ${{ steps.prepare.outputs.ENSO_VERSION }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - id: prepare
        name: Create the draft release
        run: corepack pnpm --filter build-scripts run release create-draft
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  license-check:
    name: Verify License Packages (linux, amd64)
    if: inputs.release-id == ''
    runs-on: ubuntu-latest
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
          cache-key: engine
      - name: Verify the license packages
        run: sbt "-Dsbt.server.autostart=false" verifyLicensePackages
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  gui-build:
    name: GUI build (linux, amd64)
    if: inputs.release-id == ''
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - uses: ./.github/actions/setup-node
      - name: Clean before
        uses: ./.github/actions/git-clean
      - uses: ./.github/actions/setup-rust
        with:
          shared-key: wasm-parser
      - name: Add wasm target
        run: rustup target add wasm32-unknown-unknown
      # Keep the version in step with `wasm-bindgen` in `Cargo.lock` and with `gui-checks.yml`.
      - name: Install wasm-bindgen-cli
        uses: taiki-e/install-action@v2
        with:
          tool: wasm-bindgen-cli@0.2.128
      - name: Install dependencies
        run: corepack pnpm install
      - name: Build GUI
        run: corepack pnpm run build:gui --mode=production
        env:
          ENSO_IDE_COMMIT_HASH: ${{ github.sha }}
          ENSO_IDE_VERSION: ${{ inputs.version }}
          MODE: production
      - name: Collect GUI artifacts
        run: mkdir -p dist/gui/assets && cp -R app/gui/dist/. dist/gui/assets/
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
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  build-backend:
    name: Build Backend (${{ matrix.os }}, amd64)
    if: inputs.release-id == ''
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
          cache-key: engine
          flatc: "true"
          rust: "true"
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

  build-backend-macos:
    name: Build Backend (macos, aarch64)
    needs: [check-the-mac-os-runner]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    runs-on: [self-hosted, macOS]
    continue-on-error: true
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
          cache-key: engine
          flatc: "true"
          rust: "true"
      - id: version
        name: Compute the version
        run: corepack pnpm --filter build-scripts run version
      - name: Build the engine bundle
        run: sbt "-Dbench.compileOnly=false" "-Dsbt.server.autostart=false" "clean; all buildEngineBundle"
        env:
          LC_ALL: C.UTF-8
          SBT_SERVER_FORCESTART: "true"
      - name: Archive backend
        run: tar -cvf backend.tar -C built-distribution/engine-bundle-${{ steps.version.outputs.ENSO_VERSION }}-macos-aarch64/enso .
      - name: Upload backend
        uses: actions/upload-artifact@v5
        with:
          name: backend-macos
          path: backend.tar
      - name: Cleanup
        run: rm backend.tar
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # Packages the IDE for one platform and uploads it to the draft. The legs run despite the other
  # platform's failure, as in `ide-packaging.yml` (Note [Platform Legs Run Despite The Other
  # Platform's Failure] there); publishing still needs both.
  upload-ide:
    name: Build IDE (${{ matrix.os }}, amd64)
    needs: [draft-release, build-backend, gui-build]
    if: ${{ !cancelled() && needs.draft-release.result == 'success' && needs.gui-build.result == 'success' }}
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
    env:
      ENSO_BUILD_UPDATE_INFO: "true"
      ENSO_RELEASE_ID: ${{ needs.draft-release.outputs.ENSO_RELEASE_ID }}
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
      - name: Package the IDE
        run: corepack pnpm --filter build-scripts run ide-build --sign
      - name: Upload the installer to the draft release
        run: corepack pnpm --filter build-scripts run release upload-ide
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload ide
        uses: actions/upload-artifact@v5
        with:
          name: ide-${{ matrix.os }}-amd64
          path: ${{ matrix.installer }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  upload-ide-macos:
    name: Build IDE (macos, aarch64)
    needs:
      [check-the-mac-os-runner, draft-release, build-backend-macos, gui-build]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    runs-on: [self-hosted, macOS]
    continue-on-error: true
    env:
      ENSO_BUILD_UPDATE_INFO: "true"
      ENSO_RELEASE_ID: ${{ needs.draft-release.outputs.ENSO_RELEASE_ID }}
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
      - name: Download backend
        uses: actions/download-artifact@v5
        with:
          name: backend-macos
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
      - name: Package the IDE
        run: corepack pnpm --filter build-scripts run ide-build --sign
      - name: Upload the installer to the draft release
        run: corepack pnpm --filter build-scripts run release upload-ide
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload ide
        uses: actions/upload-artifact@v5
        with:
          name: ide-macos-aarch64
          path: dist/ide/enso-*.dmg
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  # Publishes when asked to (`publish`) and the draft, the license check and both hosted platforms
  # succeeded; macOS may have failed or been skipped, and the notes then say so. With `release-id`
  # it publishes that draft alone (Note [Publishing Later]).
  publish-release:
    name: Publish release (linux, amd64)
    needs: [draft-release, license-check, upload-ide, upload-ide-macos]
    if: "!cancelled() && (inputs.release-id != '' || (inputs.publish && needs.draft-release.result == 'success' && needs.license-check.result == 'success' && needs.upload-ide.result == 'success'))"
    runs-on: ubuntu-latest
    env:
      ENSO_RELEASE_ID: ${{ inputs.release-id != '' && inputs.release-id || needs.draft-release.outputs.ENSO_RELEASE_ID }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - name: Publish the release
        run: corepack pnpm --filter build-scripts run release publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  # Tests the publish job's result itself: by default a job is skipped when any job before it
  # failed, and a failed macOS job would then skip this one (the 2026.10.23 nightly's was).
  update-latest-release-version:
    name: Update the latest release version (linux, amd64)
    needs: [draft-release, publish-release]
    if: "!cancelled() && needs.publish-release.result == 'success'"
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - id: update
        name: Record a stable version as the latest release
        run: corepack pnpm --filter build-scripts run release update-latest-version
      - if: steps.update.outputs.ENSO_LATEST_RELEASE_UPDATED == 'true'
        name: Open a pull request with the update
        run: |-
          set -euo pipefail
          BRANCH="bump-latest-release-$ENSO_VERSION"
          TITLE="Record $ENSO_VERSION as the latest release"
          BODY="Local builds derive their version from this entry, so it follows the releases. Raised automatically by the release workflow."
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git switch -c "$BRANCH"
          git commit -m "$TITLE" -- build-config.yaml
          git push --force-with-lease origin "$BRANCH"
          gh pr create --base "$GITHUB_REF_NAME" --head "$BRANCH" --title "$TITLE" --body "$BODY"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`.github/workflows/promote.yml` (whole file):

<!-- prettier-ignore -->
```yaml
# Hand-written. Computes the next version of the requested kind from the repository's tags
# (`tools/build-scripts`' `release promote`), then releases it with `release.yml`. Started by hand
# for a stable, patch or rc release, and by `nightly.yml` for the nightly. Change this file only
# together with an rc release test.

name: Generate a new version
on:
  workflow_dispatch:
    inputs:
      designator:
        description: What kind of release should be promoted.
        required: true
        type: choice
        options:
          - stable
          - patch
          - rc
          - nightly
      publish:
        description: Publish the release (false stops at a draft; see Note [Publishing Later] in `release.yml`).
        required: false
        type: boolean
        default: true
  workflow_call:
    inputs:
      designator:
        description: What kind of release should be promoted.
        required: true
        type: string
      publish:
        description: Publish the release (false stops at a draft; see Note [Publishing Later] in `release.yml`).
        required: false
        type: boolean
        default: true

jobs:
  promote:
    name: Promote release (linux, amd64)
    runs-on: ubuntu-latest
    outputs:
      ENSO_VERSION: ${{ steps.promote.outputs.ENSO_VERSION }}
      ENSO_EDITION: ${{ steps.promote.outputs.ENSO_EDITION }}
      ENSO_RELEASE_MODE: ${{ steps.promote.outputs.ENSO_RELEASE_MODE }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - uses: ./.github/actions/setup-node
      - name: Set up the build scripts
        uses: ./.github/actions/setup-build-scripts
      - id: promote
        name: Compute the next version
        run: corepack pnpm --filter build-scripts run release promote "$DESIGNATOR"
        env:
          DESIGNATOR: ${{ inputs.designator }}

  release:
    name: Release
    needs: [promote]
    uses: ./.github/workflows/release.yml
    with:
      version: ${{ needs.promote.outputs.ENSO_VERSION }}
      publish: ${{ inputs.publish }}
    secrets: inherit
```

`.github/workflows/nightly.yml` (whole file; it stays disabled on GitHub until
Task 7):

<!-- prettier-ignore -->
```yaml
# Hand-written. The nightly release: `promote.yml` with the `nightly` designator, which releases
# `<next stable>-nightly.<date>` with `release.yml`. Change this file only together with a release
# test.

name: Nightly Release
on:
  # Every day at 02:00 UTC. The macOS installer is built on the self-hosted Mac when it is online;
  # otherwise the release goes out without it (see `check-the-mac-os-runner` in `release.yml`).
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch: {}

jobs:
  promote-nightly:
    name: Promote nightly
    uses: ./.github/workflows/promote.yml
    with:
      designator: nightly
    secrets: inherit
```

`.github/actionlint.yaml` (whole file: both ignores were for the generated
release workflows' undeclared `clean_build_required`):

<!-- prettier-ignore -->
```yaml
# actionlint configuration: https://github.com/rhysd/actionlint/blob/v1.7.12/docs/config.md
# Every ignore names one finding exactly and says why it stays. There are none at present.
paths: {}
```

- [ ] **Step 5: Update the docs**

```bash
py -3 "$SCRATCH/edit-github-claude.py" .github/CLAUDE.md 4b
```

In `docs/distribution/nightly.md`, "## Release Notes", replace the paragraph
"The release notes for nightly builds are generated automatically from the
template in `build/build/release-body.md`. … Please refer to the file to learn
more." with:

<!-- prettier-ignore -->
```markdown
The release notes are generated by `releaseBody` in
`tools/build-scripts/src/release/notes.ts` (`release create-draft`): a download
link for each installer, then the first section of `CHANGELOG.md`, as it is.
When an installer is missing at publishing, `release publish` adds a note naming
its platform.
```

Then
`corepack pnpm exec prettier --write .github/CLAUDE.md docs/distribution/nightly.md .github/workflows/release.yml .github/workflows/promote.yml .github/workflows/nightly.yml .github/actionlint.yaml`.

- [ ] **Step 6: Check, on both hosts**

```bash
cd /c/Repos/Enso/ide-bs-4b
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-4b && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)" && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
corepack pnpm exec prettier --check .github docs/distribution/nightly.md
git grep -nE '^\s*(- )?run: .*\./run( |$)' -- .github/workflows/release.yml .github/workflows/promote.yml .github/workflows/nightly.yml
```

Expected: `Workflow policy: OK` and `ℹ tests 97`, `ℹ pass 97`, `ℹ fail 0` on
both hosts; `actionlint-ok`; Prettier clean; the last command prints nothing.

- [ ] **Step 7: Commit**

```bash
git add -A .github/workflows/release.yml .github/workflows/promote.yml .github/workflows/nightly.yml .github/actionlint.yaml .github/CLAUDE.md docs/distribution/nightly.md tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs tools/ci/README.md
git commit -m "Release, promote and nightly on tools/build-scripts' release command, without ./run"
```

---

### Task 6: PR 4b

**Files:** none beyond Task 5.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin ci/release-workflows
```

Write `$SCRATCH/pr-4b.md`: the job mapping ("Each `./run` call site" and "What
the release did besides the commands"); the intended differences D1–D8 and D13
with their reasons; Decisions 2, 4, 5, 6, 8 and 10 in one line each; that **this
PR is merged only after the rc gate** (Task 7: rc.5 from this branch as a draft,
checked against rc.4, published on the user's OK, then the user's in-app update)
and that `nightly.yml` is re-enabled only after it merges; "Part of #289's Phase
4."; the attribution lines. Then:

```bash
gh pr create --base develop --head ci/release-workflows --label "CI: No changelog needed" \
  --title "Build simplification, PR 4b: release, promote and nightly without ./run" \
  --body-file "$SCRATCH/pr-4b.md"
```

- [ ] **Step 2: Wait for the PR's checks**

Run `"$SCRATCH/wait-pr.sh" <N> 120` in the background; start Task 8 meanwhile
(it touches no file this PR touches). Expected checks: Workflow Lint (green:
actionlint and the policy), Changelog (green by the label), and ✨ IDE
(`ide-changed-files.yml` covers `.github/**`; about 45 minutes; it packages the
IDE as on develop, so it proves nothing about the release, only that nothing
else broke). No PR check runs `release.yml`: Task 7 does.

If a check fails, apply "When a check fails" and do not continue to Task 7 until
it is green.

---

### Task 7: The rc gate, the merge, and the nightly (PR 4b)

**Files:** none in the repository.

Every step marked **STOP** waits for the user. Do not dispatch, enable, publish,
delete or merge anything without their explicit go-ahead in this conversation.
Nothing becomes public before Step 5: until then rc.5 is a draft, which only the
repository's owner can see.

- [ ] **Step 1: STOP — ask the user to start rc.5 as a draft, with the Mac
      online**

First check the Mac (read-only):

```bash
gh api repos/jdunkerley/enso/actions/runners --jq '.runners[] | "\(.name)\t\(.status)\t\([.labels[].name] | join(","))"'
```

Expected: `Jamess-Mac-mini	online	self-hosted,macOS,ARM64,enso-mac`. If it is
offline, stop and ask the user to bring it online: the rc test is the first run
of `buildEngineBundle` and `ide-build` on the Mac, and must not be left to an
unattended nightly.

Then tell the user, in one message:

- PR 4b is green and needs its rc test. This first run builds **2026.1.1-rc.5**
  from the head of `ci/release-workflows` and **stops at a draft**: nothing is
  published, and no installed app sees it;
- the command, for them to run (or to authorise you to run, once):

  ```bash
  gh workflow run promote.yml --repo jdunkerley/enso --ref ci/release-workflows -f designator=rc -f publish=false
  ```

- that the run takes about an hour, longer if the Mac is cold (rc.4's backends
  took 24 and 30 minutes on Linux and Windows, and up to two and a half hours on
  a cold Mac).

Wait for their answer. If they decline or postpone, stop here; 4c's Task 8 can
continue meanwhile.

- [ ] **Step 2: Watch the run, and find the draft**

```bash
id=$(gh run list --workflow promote.yml --branch ci/release-workflows -L 1 --json databaseId --jq '.[0].databaseId')
echo "$id"
"$SCRATCH/wait-run.sh" "$id" 300
```

(run the wait in the background). When it ends:

```bash
"$SCRATCH/job-times.sh" "$id" | tee "$SCRATCH/rc5-jobs.md"
draft=$(gh run view "$id" --log | grep -oE 'ENSO_RELEASE_ID=[0-9]+' | head -1 | cut -d= -f2)
gh api "repos/jdunkerley/enso/releases/$draft" --jq '"\(.id)\t\(.tag_name)\tdraft=\(.draft)\tprerelease=\(.prerelease)\t\(.target_commitish)"'
git -C /c/Repos/Enso/ide-bs-4b rev-parse HEAD
```

Expected: green, with "Promote release (linux, amd64)", then under `Release / `:
"Check the macOS runner", "Create a release draft.", "Verify License Packages
(linux, amd64)", "GUI build (linux, amd64)", "Build Backend (linux, amd64)",
"Build Backend (windows, amd64)", "Build Backend (macos, aarch64)", "Build IDE
(linux, amd64)", "Build IDE (windows, amd64)", "Build IDE (macos, aarch64)" all
green, and "Publish release (linux, amd64)" and "Update the latest release
version (linux, amd64)" **skipped** (`publish=false`). The promote job's log
shows `Promoting rc: 2026.1.1-rc.5`. The draft is `2026.1.1-rc.5`, `draft=true`,
`prerelease=true`, targeting the branch head.

If the macOS jobs were skipped or failed although the Mac was online, stop and
report: with the user's go-ahead, delete the draft
(`gh api -X DELETE "repos/jdunkerley/enso/releases/$draft"`), fix, and return to
Step 1.

- [ ] **Step 3: If the run failed — STOP**

Do not dispatch again. Collect the failing job's log tail
(`gh run view "$id" --log-failed | tail -80`) and the drafts left
(`gh api repos/jdunkerley/enso/releases --paginate --jq '.[] | select(.draft) | "\(.id)\t\(.name)"'`),
fix the cause on the branch (a new commit, pushed; wait for the PR checks
again), and report to the user: the failure, the fix, and the leftover draft's
id. Delete a leftover draft only with their go-ahead
(`gh api -X DELETE repos/jdunkerley/enso/releases/<id>`). Then return to Step 1.
Nothing was published: the next try is rc.5 again.

- [ ] **Step 4: Check the draft against rc.4**

```bash
"$SCRATCH/release-parity.sh" 2026.1.1-rc.4 "$draft" "$SCRATCH/parity-rc5-draft"; echo "exit $?"
head -60 "$SCRATCH/parity-rc5-draft/body.diff"
gh api repos/jdunkerley/enso/releases/tags/2026.1.1-rc.5 2>&1 | head -1
```

The parity script downloads the two installers named by the feeds (about 1.7 GB)
through the API, as a draft's public URLs do not work yet.

Expected:

- exit 0: `draft=true` and the name `Enso 2026.1.1-rc.5`; the same assets as
  rc.4 apart from `assets.json` (the `.exe`, its `.blockmap`, the `.AppImage`,
  the `.dmg`, three `.sha256` files, `latest.yml`, `latest-linux.yml`), with
  rc.4's content types, every one `uploaded`; each feed names `2026.1.1-rc.5`,
  the size of its installer, and the sha512 of the installer as downloaded; each
  `.sha256` matches its installer; the body has a "# Changelog" section and no
  HTML entities;
- the body diff shows only Decision 6 (no data-collection section, no entities),
  the new download links, and the changelog entries merged since rc.4
  (`git log 931935f7a7..HEAD -- CHANGELOG.md` lists their PRs);
- `releases/tags/2026.1.1-rc.5` is still `Not Found`: nothing is public.

Record anything else as a finding for the user.

- [ ] **Step 5: STOP — the user OKs publishing, and publishes the draft**

Report Step 4 (the parity output, the body diff summary, the job times against
rc.4's) and ask whether to publish. On their OK, give them the command to run
(or to authorise you to run, once):

```bash
gh workflow run release.yml --repo jdunkerley/enso --ref ci/release-workflows -f version=2026.1.1-rc.5 -f release-id=<draft id>
```

Tell them that once it finishes, every installed rc with prereleases enabled is
offered rc.5.

- [ ] **Step 6: Watch the publish run, and check the published release**

```bash
pid=$(gh run list --workflow release.yml --branch ci/release-workflows -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/wait-run.sh" "$pid" 60
"$SCRATCH/job-times.sh" "$pid"
PARITY_INSTALLERS=0 "$SCRATCH/release-parity.sh" 2026.1.1-rc.4 2026.1.1-rc.5 "$SCRATCH/parity-rc5"; echo "exit $?"
gh run view "$pid" --log | grep -E "ENSO_LATEST_RELEASE_UPDATED|is a prerelease; leaving|Published 2026" | head -4
gh pr list --state all --head bump-latest-release-2026.1.1-rc.5 --json number --jq length
gh api repos/jdunkerley/enso/releases --paginate --jq '[.[] | select(.draft)] | length'
gh api repos/jdunkerley/enso/releases/latest --jq .tag_name 2>&1 | head -1
```

Expected: the run is green with only "Publish release (linux, amd64)" and
"Update the latest release version (linux, amd64)" run, every build job skipped;
the parity script exits 0 in published mode (the installers were already checked
byte by byte in Step 4); the log shows `Published 2026.1.1-rc.5`, then
`2026.1.1-rc.5 is a prerelease; leaving the latest-release entry untouched.` and
`ENSO_LATEST_RELEASE_UPDATED=false`; no bump PR (`0`); no draft left (`0`);
`releases/latest` still 404 (only prereleases exist).

If the publish job fails, stop and report; the draft is still a draft unless the
log shows `Published`, in which case say so plainly (the next rc test is rc.6).

- [ ] **Step 7: STOP — ask the user to update rc.4 → rc.5 in the app**

Ask the user to test the in-app update, on the machine where rc.4 is installed:
Settings → Local → include prerelease versions on; the app offers 2026.1.1-rc.5;
download, restart; Help → About (or the window title) shows rc.5 and a project
opens. On Linux the AppImage updates the same way if they want to try it; macOS
builds are unsigned, so they update by hand (`ENSO_IDE_UPDATES=manual`), as rc.4
did. Do not install or update anything yourself.

Wait for their result. If the update fails, collect what they report (the
updater's log is in the app's log), compare `latest.yml` with rc.4's
(`$SCRATCH/parity-rc5-draft/new/latest.yml` against
`gh release download 2026.1.1-rc.4 -p latest.yml`), fix on the branch, and
return to Step 1 for rc.6.

- [ ] **Step 8: STOP — merge on the user's go-ahead**

When the user confirms the update worked and says to merge:

```bash
gh pr merge <N> --squash
git -C /c/Repos/Enso/ide fetch origin && git -C /c/Repos/Enso/ide log --oneline -1 origin/develop
```

- [ ] **Step 9: STOP — re-enable the nightly release on the user's go-ahead**

Ask the user whether to re-enable the nightly release now (it then publishes
`2026.1.1-nightly.<date>` every day at 02:00 UTC from `develop`, with `publish`
at its default, `true`). On their go-ahead:

```bash
gh workflow enable nightly.yml --repo jdunkerley/enso
gh workflow list --all --json path,state --jq '.[] | select(.path == ".github/workflows/nightly.yml") | .state'
```

Expected: `active`.

- [ ] **Step 10: Check the first nightly**

After the next 02:00 UTC run:

```bash
nid=$(gh run list --workflow nightly.yml -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/wait-run.sh" "$nid" 300
"$SCRATCH/job-times.sh" "$nid"
new=$(gh release list -L 1 --json tagName --jq '.[0].tagName')
"$SCRATCH/release-parity.sh" 2026.1.1-nightly.2026.10.22 "$new" "$SCRATCH/parity-nightly"; echo "exit $?"
```

Expected: the run is green with the jobs of Step 2 under `Promote nightly / `,
publish and latest-version included. Against nightly.2026.10.22 (which had the
Mac's installer) the parity script exits 0 when the Mac was online; when it was
offline, its one mismatch is the asset diff's two `enso-mac-arm64-VERSION`
lines, and the body ends with the note. If the nightly fails, tell the user, and
with their go-ahead disable it again (`gh workflow disable nightly.yml`) while
the cause is fixed in a new PR.

---

### Task 8: `setup-jvm`'s edition, and the platform checks for macOS and Oracle GraalVM (PR 4c)

**Files:**

- Modify: `.github/actions/setup-jvm/action.yml`
- Modify: `.github/workflows/engine-checks-platform.yml` (by
  `$SCRATCH/edit-platform.py`, below)

**Interfaces:**

- Produces:
  - `setup-jvm` input `edition`: `community` (default) or `oracle`;
  - `engine-checks-platform.yml` inputs `arch` (default `amd64`), `edition`
    (default `GraalVM CE`), `jvm-tests` (default `true`), `linux-checks`
    (default `true`), `runner` as a label or a JSON list, `stdlib-suites` may be
    `[]`; outputs `ENSO_VERSION`, `ENSO_EDITION`, `ENSO_RELEASE_MODE` (the build
    job's). Task 9's callers use exactly these names. With the defaults, the
    pull-request callers' job names, artifacts and steps are what they were.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-4c -b ci/nightly-checks origin/develop
cd /c/Repos/Enso/ide-bs-4c
corepack pnpm install --frozen-lockfile --ignore-scripts
```

(4b need not have merged for this task.)

- [ ] **Step 2: Add the edition to `setup-jvm`**

`$SCRATCH/edit-setup-jvm.py` makes the four changes (the input; the edition
check at the start of "Read the pinned versions", which also gives the vendor
string; the `setup-graalvm` distribution; and the vendor in "Check the
toolchain": Oracle GraalVM prints
`Java(TM) SE Runtime Environment Oracle GraalVM 25.0.1+…`, CE prints
`… GraalVM CE 25.0.1+…`):

<!-- prettier-ignore -->
```python
"""Adds the `edition` input to .github/actions/setup-jvm/action.yml (Phase 4, PR 4c).

Usage: py -3 edit-setup-jvm.py <path to setup-jvm's action.yml>

Four replacements; each must match exactly once, or nothing is written.
"""
import sys

path = sys.argv[1]
s = open(path, encoding='utf-8').read()


def rep(old, new):
    global s
    assert s.count(old) == 1, f'found {s.count(old)}: {old[:70]!r}'
    s = s.replace(old, new)


rep('''    required: true
  flatc:''', '''    required: true
  edition:
    description: >-
      `community` (GraalVM CE, the default) or `oracle` (Oracle GraalVM, at the same version), which
      the nightly checks also build and test with. `./run` chose it by `GRAAL_EDITION`.
    required: false
    default: community
  flatc:''')
rep('''    - name: Read the pinned versions
      id: pins
      shell: bash
      run: |-
        pin() {''', '''    - name: Read the pinned versions
      id: pins
      shell: bash
      env:
        EDITION: ${{ inputs.edition }}
      run: |-
        case "$EDITION" in
          community) echo "vendor=GraalVM CE" >> "$GITHUB_OUTPUT" ;;
          oracle) echo "vendor=Oracle GraalVM" >> "$GITHUB_OUTPUT" ;;
          *)
            echo "::error::setup-jvm: unknown edition \\`$EDITION\\` (community or oracle)."
            exit 1
            ;;
        esac
        pin() {''')
rep('''        distribution: graalvm-community''',
    '''        distribution: ${{ inputs.edition == 'oracle' && 'graalvm' || 'graalvm-community' }}''')
rep('''        GRAALVM_VERSION: ${{ steps.pins.outputs.graalvm }}
        FLATC_VERSION''', '''        GRAALVM_VERSION: ${{ steps.pins.outputs.graalvm }}
        GRAALVM_VENDOR: ${{ steps.pins.outputs.vendor }}
        FLATC_VERSION''')
rep('''grep -qF "GraalVM CE $GRAALVM_VERSION" <<< "$java"''',
    '''grep -qF "$GRAALVM_VENDOR $GRAALVM_VERSION" <<< "$java"''')
open(path, 'w', encoding='utf-8', newline=chr(10)).write(s)
print('setup-jvm: edited')
```

```bash
py -3 "$SCRATCH/edit-setup-jvm.py" .github/actions/setup-jvm/action.yml
```

Expected: `setup-jvm: edited`.

- [ ] **Step 3: Generalise the platform workflow**

`$SCRATCH/edit-platform.py` (each replacement must match the stated number of
times, or nothing is written; it ends by checking that no `GraalVM CE` or
`amd64` name is left outside the Linux-only jobs):

<!-- prettier-ignore -->
```python
"""Generalises .github/workflows/engine-checks-platform.yml for Phase 4 (PR 4c).

Usage: py -3 edit-platform.py <path to engine-checks-platform.yml>

Each replacement must match exactly the number of times given, or nothing is written.
"""
import sys

path = sys.argv[1]
s = open(path, encoding='utf-8').read()


def rep(old, new, count=1):
    global s
    found = s.count(old)
    assert found == count, f'expected {count}, found {found}: {old[:70]!r}'
    s = s.replace(old, new)


RUNNER = "${{ startsWith(inputs.runner, '[') && fromJSON(inputs.runner) || inputs.runner }}"
EDITION = "${{ inputs.edition == 'Oracle GraalVM' && 'oracle' || 'community' }}"

rep('''# Hand-written. One platform's engine checks: the engine distribution, then the tests and checks
# that use it. `engine-checks.yml` calls it once per platform. It has no `concurrency:` of its own:
# the platforms' calls would share the group and cancel each other.
''', '''# Hand-written. One platform's engine checks: the engine distribution, then the tests and checks
# that use it. `engine-checks.yml` calls it once per platform; `engine-checks-nightly.yml` also for
# macOS and for Oracle GraalVM, `macos-checks.yml` for the self-hosted Mac, and
# `extra-nightly-tests.yml` for the distribution alone. It has no `concurrency:` of its own: the
# platforms' calls would share the group and cancel each other.
''')
rep('''      os:
        description: "`linux` or `windows`: names the jobs and artifacts; `linux` adds the Linux-only checks."
        required: true
        type: string
      runner:
        description: The runner label for every job.
        required: true
        type: string
''', '''      os:
        description: "`linux`, `windows` or `macos`: names the jobs and artifacts; `linux` adds the Linux-only checks and the databases."
        required: true
        type: string
      arch:
        description: "`amd64`, or `aarch64` for the self-hosted Mac: names the jobs and artifacts."
        required: false
        type: string
        default: amd64
      runner:
        description: >-
          The runner for every job: a label (`ubuntu-latest`), or a JSON list of labels
          (`["self-hosted", "macOS"]`).
        required: true
        type: string
      edition:
        description: "`GraalVM CE` or `Oracle GraalVM`: the JDK every job builds and runs with; part of the names."
        required: false
        type: string
        default: GraalVM CE
      jvm-tests:
        description: Run the JVM tests.
        required: false
        type: boolean
        default: true
      linux-checks:
        description: On Linux, also run the Enso lint and the Standard Library API check.
        required: false
        type: boolean
        default: true
''')
rep('''          <bool>}`: the JVM suite needs the small JDK; `postgres` and `mssql` (Linux only) start that
          database for the suite.
''', '''          <bool>}`: the JVM suite needs the small JDK (not built for Oracle GraalVM, which
          `stdlib-test` runs without it); `postgres` and `mssql` (Linux only) start that database for
          the suite. `[]` runs none.
''')
rep('''        type: boolean
        default: false

env:''', '''        type: boolean
        default: false
    outputs:
      ENSO_VERSION:
        description: The engine distribution's version, for a caller's own jobs that download it.
        value: ${{ jobs.build-engine-distribution.outputs.ENSO_VERSION }}
      ENSO_EDITION:
        description: The engine distribution's edition.
        value: ${{ jobs.build-engine-distribution.outputs.ENSO_EDITION }}
      ENSO_RELEASE_MODE:
        description: Whether the distribution was built in release mode.
        value: ${{ jobs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}

env:''')
rep("    runs-on: ${{ inputs.runner }}\n", f"    runs-on: {RUNNER}\n", 6)
rep("(GraalVM CE) (native,test) (${{ inputs.os }}, amd64)",
    "(${{ inputs.edition }}) (native,test) (${{ inputs.os }}, ${{ inputs.arch }})", 7)
rep("Tests (GraalVM CE) (${{ inputs.os }}, amd64)",
    "Tests (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})", 3)
rep("Report (GraalVM CE, ${{ inputs.os }}, amd64)",
    "Report (${{ inputs.edition }}, ${{ inputs.os }}, ${{ inputs.arch }})", 3)
rep("Tests, ${{ inputs.os }}, amd64)", "Tests, ${{ inputs.os }}, ${{ inputs.arch }})", 3)
rep("      GRAAL_EDITION: GraalVM CE\n", "      GRAAL_EDITION: ${{ inputs.edition }}\n", 2)
rep("          cache-key: engine\n", f"          cache-key: engine\n          edition: {EDITION}\n", 3)
rep("          cache-key: stdlib-tests\n",
    f"          cache-key: stdlib-tests\n          edition: {EDITION}\n", 2)
rep("      - if: matrix.small-jdk\n",
    "      - if: matrix.small-jdk && inputs.edition != 'Oracle GraalVM'\n", 2)
rep('''    name: Enso Code Lint (linux, amd64)
    if: inputs.os == 'linux'
''', '''    name: Enso Code Lint (linux, amd64)
    if: inputs.os == 'linux' && inputs.linux-checks
''')
rep('''    name: Standard Library API check (linux, amd64)
    if: inputs.os == 'linux'
''', '''    name: Standard Library API check (linux, amd64)
    if: inputs.os == 'linux' && inputs.linux-checks
''')
rep('''  jvm-tests:
    name: JVM Tests (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})
    needs: [build-engine-distribution]
''', '''  jvm-tests:
    name: JVM Tests (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})
    if: inputs.jvm-tests
    needs: [build-engine-distribution]
''')
rep(f'''    if: inputs.os == 'linux'
    needs: [build-engine-distribution]
    runs-on: {RUNNER}
    permissions:
      checks: write
    env:''', f'''    if: inputs.os == 'linux' && inputs.stdlib-suites != '[]'
    needs: [build-engine-distribution]
    runs-on: {RUNNER}
    permissions:
      checks: write
    env:''')
rep('''  # - Postgres and SQL Server are service containers, on Linux only as before (Windows runners have
  #   none, so Windows is a job of its own, under the same name). One job with
  #   OS-conditional `services:` is not possible: a Windows runner cannot start the Linux
  #   containers, so the Windows job is the same steps without them. A suite gets a database when its
''', '''  # - Postgres and SQL Server are service containers, on Linux only as before (Windows runners have
  #   none, and the self-hosted Mac has no Docker, so they share a job of their own,
  #   `stdlib-tests-without-services`, under the same name). One job with OS-conditional
  #   `services:` is not possible: a Windows runner cannot start the Linux containers, so that job
  #   is the same steps without them. A suite gets a database when its
''')
rep('''  # The same as `stdlib-tests`, without the databases: Windows runners have no service containers.
  stdlib-tests-windows:
    name: Standard Library ${{ matrix.title }} Tests (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})
    if: inputs.os == 'windows'
''', '''  # The same as `stdlib-tests`, without the databases: Windows runners have no service containers,
  # and the self-hosted Mac has no Docker (`./run` started the databases on Linux only).
  stdlib-tests-without-services:
    name: Standard Library ${{ matrix.title }} Tests (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})
    if: inputs.os != 'linux' && inputs.stdlib-suites != '[]'
''')
assert 'GraalVM CE)' not in s and ', amd64)' not in s.replace('(linux, amd64)', ''), 'a name was missed'
open(path, 'w', encoding='utf-8', newline='\n').write(s)
print('engine-checks-platform.yml: edited')
```

```bash
py -3 "$SCRATCH/edit-platform.py" .github/workflows/engine-checks-platform.yml
corepack pnpm exec prettier --write .github/workflows/engine-checks-platform.yml .github/actions/setup-jvm/action.yml
```

Expected: `engine-checks-platform.yml: edited`; Prettier changes nothing.

- [ ] **Step 4: Check, on both hosts, and compare**

```bash
node tools/ci/check-workflows.mjs
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-4c && node tools/ci/check-workflows.mjs && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-4c .github/workflows/engine-checks.yml .github/workflows/ide-packaging.yml .github/workflows/formatting.yml .github/workflows/enso4igv.yml > "$SCRATCH/compare-4c.md"
grep -E '^[-+] ' "$SCRATCH/compare-4c.md" | sed -E 's/(run\[bash\]: .{50}).*/\1…/' | sort | uniq -c | sort -rn
```

Expected: `Workflow policy: OK` on both hosts; `actionlint-ok`; the comparison
shows only D9 (16 pairs of `setup-jvm` step lines: the pins step gains the
`case "$EDITION"` check and `env: EDITION=community`; the toolchain check greps
`$GRAALVM_VENDOR`) and D10 (8 Linux and 5 Windows `runs-on` pairs, printed as
`${{ startsWith('ubuntu-latest', '[') && fromJSON('ubuntu-latest') || 'ubuntu-latest' }}`
and the same for `windows-latest`). No job name, artifact name or other step
differs.

- [ ] **Step 5: Commit**

```bash
git add .github/actions/setup-jvm/action.yml .github/workflows/engine-checks-platform.yml
git commit -m "engine-checks-platform: macOS, aarch64, Oracle GraalVM and optional checks; setup-jvm's edition"
```

---

### Task 9: The nightly, extra and macOS checks as calls, and PR 4c

**Files:**

- Rewrite: `.github/workflows/engine-checks-nightly.yml`,
  `extra-nightly-tests.yml`, `macos-checks.yml`
- Delete: `.github/actions/build-script/`, `.github/actions/setup-build-script/`
- Modify: `.github/actions/setup-rust/action.yml` (description),
  `tools/ci/check-workflows.mjs`, `tools/ci/check-workflows.test.mjs` (by
  `$SCRATCH/edit-policy-4c.py`), `.github/CLAUDE.md` (by
  `$SCRATCH/edit-github-claude.py`)

**Interfaces:**

- Consumes: Task 8's inputs and outputs; 4b's policy helpers `isMacos`,
  `isMacosCaller`, `ungatedMacosJobs` in `tools/ci/check-workflows.mjs`.
- Produces: no `./run` call left in any workflow.

- [ ] **Step 1: Bring the branch up to date, once 4b has merged**

```bash
cd /c/Repos/Enso/ide-bs-4c
git fetch origin && git merge --no-edit origin/develop
grep -n "const isMacosCaller" tools/ci/check-workflows.mjs
```

Expected: a clean merge (Task 8 and 4b touch different files), and the grep
finds 4b's helper. If 4b has not merged, stop here and wait.

- [ ] **Step 2: Write the three workflows**

`.github/workflows/engine-checks-nightly.yml` (whole file):

<!-- prettier-ignore -->
```yaml
# Hand-written. The engine's checks on every platform and edition the pull-request checks leave
# out: Linux and Windows as in `engine-checks.yml`, plus Linux on Oracle GraalVM and macOS on the
# self-hosted Mac (skipped while it is offline). Each is one call of `engine-checks-platform.yml`.
# Started by hand.

name: Engine Nightly Checks
on:
  workflow_dispatch:
    inputs:
      clean_build_required:
        description: Clean before and after the run.
        required: false
        type: boolean
        default: false

jobs:
  # Waits one minute for the Mac; keep in step with `release.yml` and `macos-pull-request.yml`.
  check-the-mac-os-runner:
    name: Check the macOS runner
    runs-on: ubuntu-latest
    timeout-minutes: 6
    outputs:
      online: ${{ steps.wait.outputs.online }}
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
      - id: wait
        name: Wait for the macOS runner
        run: ./tools/ci/wait-for-macos-runner.sh 1 skip
        env:
          RUNNER_STATUS_TOKEN: ${{ secrets.RUNNER_STATUS_TOKEN }}

  # The suites each platform ran under `./run`. Oracle GraalVM had no lint or API check, and its JVM
  # suite runs without the small JDK (`stdlib-test` leaves it out for that edition).
  platform:
    name: ${{ matrix.name }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: linux
            os: linux
            runner: ubuntu-latest
            edition: GraalVM CE
            linux-checks: true
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false, "postgres": true, "mssql": false},
              {"suite": "standard-library", "title": "JVM", "small-jdk": true, "postgres": true, "mssql": false},
              {"suite": "std-aws", "title": "AWS", "small-jdk": false, "postgres": false, "mssql": false},
              {"suite": "std-microsoft", "title": "Microsoft", "small-jdk": false, "postgres": false, "mssql": true}]
          - name: windows
            os: windows
            runner: windows-latest
            edition: GraalVM CE
            linux-checks: true
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false},
              {"suite": "standard-library", "title": "JVM", "small-jdk": true},
              {"suite": "std-aws", "title": "AWS", "small-jdk": false}]
          - name: linux (Oracle GraalVM)
            os: linux
            runner: ubuntu-latest
            edition: Oracle GraalVM
            linux-checks: false
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false, "postgres": true, "mssql": false},
              {"suite": "standard-library", "title": "JVM", "small-jdk": true, "postgres": true, "mssql": false},
              {"suite": "std-aws", "title": "AWS", "small-jdk": false, "postgres": false, "mssql": false},
              {"suite": "std-microsoft", "title": "Microsoft", "small-jdk": false, "postgres": false, "mssql": true}]
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: ${{ matrix.os }}
      runner: ${{ matrix.runner }}
      edition: ${{ matrix.edition }}
      linux-checks: ${{ matrix.linux-checks }}
      stdlib-suites: ${{ matrix.stdlib-suites }}
      clean_build_required: ${{ inputs.clean_build_required == true }}
    secrets: inherit

  macos:
    name: macos
    needs: [check-the-mac-os-runner]
    if: needs.check-the-mac-os-runner.outputs.online == 'true'
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: macos
      arch: aarch64
      runner: '["self-hosted", "macOS"]'
      stdlib-suites: >-
        [{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false},
        {"suite": "standard-library", "title": "JVM", "small-jdk": true},
        {"suite": "std-aws", "title": "AWS", "small-jdk": false}]
      clean_build_required: ${{ inputs.clean_build_required == true }}
    secrets: inherit
```

`.github/workflows/macos-checks.yml` (whole file; `macos-pull-request.yml` calls
it unchanged):

<!-- prettier-ignore -->
```yaml
# Hand-written. The engine's checks on the self-hosted Mac, as `macos-pull-request.yml` asks for
# them with its labels: the engine distribution always, the JVM tests with `engine`, the Standard
# Library suites with `libraries`. One call of `engine-checks-platform.yml`; the Mac has no Docker,
# so its suites run without the databases, as under `./run`.

name: macOS Checks
on:
  workflow_call:
    inputs:
      clean_build_required:
        description: Clean before and after the run.
        required: false
        type: boolean
        default: false
      engine:
        description: Run the engine's JVM tests.
        required: false
        type: boolean
        default: false
      libraries:
        description: Run the Standard Library tests.
        required: false
        type: boolean
        default: false

jobs:
  macos:
    name: macos
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: macos
      arch: aarch64
      runner: '["self-hosted", "macOS"]'
      jvm-tests: ${{ inputs.engine }}
      stdlib-suites: >-
        ${{ inputs.libraries && '[{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false},
        {"suite": "standard-library", "title": "JVM", "small-jdk": true},
        {"suite": "std-aws", "title": "AWS", "small-jdk": false}]' || '[]' }}
      clean_build_required: ${{ inputs.clean_build_required }}
    secrets: inherit
```

`.github/workflows/extra-nightly-tests.yml` (whole file):

<!-- prettier-ignore -->
```yaml
# Hand-written. The Standard Library suites that need outside services: Snowflake (on the JVM and
# native) and the cloud-related projects. The Linux engine distribution comes from
# `engine-checks-platform.yml`, called with no checks of its own; the suites are this file's job.
# Started by hand.
#
# Note [Extra Tests Without Their Secrets]
# ========================================
# The suites read the Snowflake and Enso Cloud secrets and variables, which this repository does
# not have. `stdlib-test` passes them on as `./run` did, empty ones included, so a run without them
# behaves as `./run`'s did: the Snowflake suites fail (`Snowflake_Spec` refuses an
# `ENSO_SNOWFLAKE_ACCOUNT` that is set but empty), and the cloud suite skips its real-cloud tests
# (no credentials file is made). Signing in to Enso Cloud did not move off `./run`: `stdlib-test`
# refuses to run when all five cloud credentials are set.

name: Extra Nightly Tests
on:
  workflow_dispatch:
    inputs:
      clean_build_required:
        description: Clean before and after the run.
        required: false
        type: boolean
        default: false

env:
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ github.ref == 'refs/heads/develop' || inputs.clean_build_required == true }}"

jobs:
  engine:
    name: linux
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: linux
      runner: ubuntu-latest
      jvm-tests: false
      linux-checks: false
      stdlib-suites: "[]"
      clean_build_required: ${{ inputs.clean_build_required == true }}
    secrets: inherit

  # As `stdlib-tests` in `engine-checks-platform.yml` (Note [Standard Library Tests Without ./run]
  # there), with these suites' secrets, `REPORT_ALL_TESTS`, and their job and report names.
  extra-tests:
    name: ${{ matrix.name }}
    needs: [engine]
    runs-on: ubuntu-latest
    permissions:
      checks: write
    env:
      GRAAL_EDITION: GraalVM CE
      ENSO_TEST_JUNIT_DIR: ${{ github.workspace }}/target/test-results
      REPORT_ALL_TESTS: "1"
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: Snowflake Tests (JVM) (LinuxLatest)
            suite: std-snowflake-jvm
            report: Extra Library Tests Report
            postgres: false
            mssql: false
            heap-dumps: false
          - name: Snowflake Tests (Native) (LinuxLatest)
            suite: std-snowflake
            report: Extra Library Tests Report
            postgres: false
            mssql: false
            heap-dumps: false
          - name: Standard Library Cloud Tests (GraalVM CE) (LinuxLatest)
            suite: std-cloud-related
            report: Standard Library Tests Report
            postgres: true
            mssql: true
            heap-dumps: true
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
          name: Engine Distribution (GraalVM CE) (native,test) (linux, amd64)
      - name: Set up the JVM toolchain
        uses: ./.github/actions/setup-jvm
        with:
          cache-key: stdlib-tests
          graalpy: "true"
          rust: "true"
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
          ENSO_VERSION: ${{ needs.engine.outputs.ENSO_VERSION }}
          ENSO_EDITION: ${{ needs.engine.outputs.ENSO_EDITION }}
          ENSO_RELEASE_MODE: ${{ needs.engine.outputs.ENSO_RELEASE_MODE }}
          ENSO_CLOUD_COGNITO_REGION: ${{ vars.ENSO_CLOUD_COGNITO_REGION }}
          ENSO_CLOUD_COGNITO_USER_POOL_ID: ${{ vars.ENSO_CLOUD_COGNITO_USER_POOL_ID }}
          ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID: ${{ vars.ENSO_CLOUD_COGNITO_USER_POOL_WEB_CLIENT_ID }}
          ENSO_CLOUD_TEST_ACCOUNT_PASSWORD: ${{ secrets.ENSO_CLOUD_TEST_ACCOUNT_PASS }}
          ENSO_CLOUD_TEST_ACCOUNT_USERNAME: ${{ secrets.ENSO_CLOUD_TEST_ACCOUNT_USERNAME }}
          ENSO_LIB_S3_AWS_ACCESS_KEY_ID: ${{ matrix.suite == 'std-cloud-related' && secrets.ENSO_LIB_S3_AWS_ACCESS_KEY_ID || '' }}
          ENSO_LIB_S3_AWS_REGION: ${{ matrix.suite == 'std-cloud-related' && secrets.ENSO_LIB_S3_AWS_REGION || '' }}
          ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY: ${{ matrix.suite == 'std-cloud-related' && secrets.ENSO_LIB_S3_AWS_SECRET_ACCESS_KEY || '' }}
          ENSO_SNOWFLAKE_ACCOUNT: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_ACCOUNT || '' }}
          ENSO_SNOWFLAKE_DATABASE: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_DATABASE || '' }}
          ENSO_SNOWFLAKE_PASSWORD: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_PASSWORD || '' }}
          ENSO_SNOWFLAKE_SCHEMA: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_SCHEMA || '' }}
          ENSO_SNOWFLAKE_USER: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_USER || '' }}
          ENSO_SNOWFLAKE_WAREHOUSE: ${{ matrix.suite != 'std-cloud-related' && secrets.ENSO_SNOWFLAKE_WAREHOUSE || '' }}
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
          max-annotations: 50
          name: ${{ matrix.report }} (GraalVM CE, linux, amd64)
          path: ${{ env.ENSO_TEST_JUNIT_DIR }}/*/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - if: matrix.heap-dumps && (success() || failure()) && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)
        name: Upload Heap Dumps
        uses: actions/upload-artifact@v5
        with:
          if-no-files-found: ignore
          name: Heap dumps (Standard Library Cloud Tests, linux, amd64)
          path: |-
            test/**/*.hprof
            engine/**/*.hprof
          retention-days: 3
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

- [ ] **Step 3: Delete the unused composite actions**

```bash
git -C /c/Repos/Enso/ide-bs-4c grep -nE 'uses: \./\.github/actions/(setup-)?build-script$' -- .github
git rm -r .github/actions/build-script .github/actions/setup-build-script
```

Expected: the grep prints nothing (no workflow uses them). In
`.github/actions/setup-rust/action.yml`, replace the `shared-key` description's
last two lines,

```
      `Swatinem/rust-cache` key shared by the jobs that build the same crates (`build-script` for
      the `./run` CLI, `wasm-parser` for the GUI's parser).
```

with:

```
      `Swatinem/rust-cache` key shared by the jobs that build the same crates (`wasm-parser` for
      the GUI's parser).
```

- [ ] **Step 4: Move the policy's nightly and macOS rules**

`$SCRATCH/edit-policy-4c.py`:

<!-- prettier-ignore -->
```python
"""The workflow policy's nightly and macOS rules, for Phase 4's nightly checks (PR 4c).

Usage: py -3 edit-policy-4c.py <repository root>

In tools/ci/check-workflows.mjs: the nightly needs a macOS call of `engine-checks-platform.yml`
instead of its `build-script-macos-aarch64` job, and `checkMacosChecksRunWhatIsRequested` checks
the one call that `macos-checks.yml` becomes. In tools/ci/check-workflows.test.mjs: the matching
nightly tests, and the `checkMacosChecksRunWhatIsRequested` block (up to `describe('IDE
packaging'`). Each old text must be found exactly once.
"""
import sys

root = sys.argv[1]


def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, old[:80], n)
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8', newline='\n').write(s)


edit(root + '/tools/ci/check-workflows.mjs', [
    ('''    if (!('build-script-macos-aarch64' in nightly)) {
      problems.push('engine-checks-nightly.yml: has no macOS job `build-script-macos-aarch64`')
    }
''', '''    if (!Object.values(nightly).some(isMacosCaller)) {
      problems.push('engine-checks-nightly.yml: has no job that runs the platform checks on macOS')
    }
'''),
    ('''/** `macos-checks.yml` (#288) runs only what its inputs ask for (`macos_checks_run_only_...`). */
export function checkMacosChecksRunWhatIsRequested({ workflows }) {
  const jobs = workflows['macos-checks.yml']?.doc?.jobs
  if (!jobs) return []
  const problems = []
  const conditions = Object.entries(jobs).map(([id, job]) => [id, job?.if])
  if (!conditions.some(([id]) => /build-engine-distribution/.test(id))) {
    problems.push('macos-checks.yml: has no engine distribution job')
  }
  for (const [id, condition] of conditions) {
    if (/build-engine-distribution/.test(id) && condition !== undefined) {
      problems.push(`macos-checks.yml › ${id}: the engine distribution must always be built`)
    }
  }
  const count = (input) => conditions.filter(([, condition]) => condition === input).length
  if (count('inputs.engine') !== 1) {
    problems.push('macos-checks.yml: exactly one job must run on `inputs.engine`')
  }
  if (count('inputs.libraries') !== 3) {
    problems.push('macos-checks.yml: exactly three jobs must run on `inputs.libraries`')
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (!isMacos(job)) problems.push(`macos-checks.yml › ${id}: must run on macOS`)
  }
  return problems
}
''', '''/** The suites `macos-checks.yml` runs on `inputs.libraries`, as `./run` did on the Mac. */
const MACOS_LIBRARY_SUITES = ['standard-library-in-native', 'standard-library', 'std-aws']

/**
 * `macos-checks.yml` (#288) runs only what its inputs ask for (`macos_checks_run_only_...`): it is
 * one call of `engine-checks-platform.yml` on the self-hosted Mac, which always builds the engine
 * distribution, runs the JVM tests on `inputs.engine`, and the three library suites on
 * `inputs.libraries` (else none, `[]`).
 */
export function checkMacosChecksRunWhatIsRequested({ workflows }) {
  const jobs = workflows['macos-checks.yml']?.doc?.jobs
  if (!jobs) return []
  const entries = Object.entries(jobs)
  if (entries.length !== 1) {
    return ['macos-checks.yml: must be one call of `engine-checks-platform.yml`']
  }
  const [[id, job]] = entries
  const where = `macos-checks.yml › ${id}`
  const problems = []
  if (job?.uses !== './.github/workflows/engine-checks-platform.yml') {
    problems.push(`${where}: must call \\`engine-checks-platform.yml\\``)
  }
  if (job?.if !== undefined) {
    problems.push(`${where}: the engine distribution must always be built`)
  }
  const inputs = job?.with ?? {}
  const runner = String(inputs.runner ?? '')
  if (!isMacosCaller(job) || !runner.includes('self-hosted') || !runner.includes('macOS')) {
    problems.push(`${where}: must run on the self-hosted Mac`)
  }
  if (String(inputs['jvm-tests'] ?? '').replace(/\\s/g, '') !== '${{inputs.engine}}') {
    problems.push(`${where}: \\`jvm-tests\\` must be \\`inputs.engine\\``)
  }
  const suites = String(inputs['stdlib-suites'] ?? '').trim()
  const named = [...suites.matchAll(/"suite":\\s*"([^"]+)"/g)].map((match) => match[1])
  if (
    !/^\\$\\{\\{\\s*inputs\\.libraries\\s*&&/.test(suites) ||
    !/\\|\\|\\s*'\\[\\]'\\s*\\}\\}$/.test(suites) ||
    named.join() !== MACOS_LIBRARY_SUITES.join()
  ) {
    problems.push(
      `${where}: \\`stdlib-suites\\` must be ${MACOS_LIBRARY_SUITES.join(', ')} on \\`inputs.libraries\\`, else \\`[]\\``,
    )
  }
  return problems
}
'''),
])

edit(root + '/tools/ci/check-workflows.test.mjs', [
    ('''  test('accepts a gated nightly', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  build-script-macos-aarch64: { needs: [check-the-mac-os-runner], ${GATE_IF}, runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  test('rejects an ungated macOS job in the nightly, and a nightly without its macOS script job', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  tests-macos: { runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    const found = checkMacosJobsAreGated(repo)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('tests-macos')))
    assert.ok(found.some((p) => p.includes('build-script-macos-aarch64')))
  })
''', '''  test('accepts a gated nightly', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  macos: { needs: [check-the-mac-os-runner], ${GATE_IF}, uses: ./.github/workflows/engine-checks-platform.yml, with: { os: macos } }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(repo), [])
  })
  test('rejects an ungated macOS call in the nightly, and a nightly with no macOS call', () => {
    const ungated = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  macos: { uses: ./.github/workflows/engine-checks-platform.yml, with: { os: macos } }
`,
    })
    const found = checkMacosJobsAreGated(ungated)
    assert.equal(found.length, 1)
    assert.match(found[0], /macos: a macOS job must need/)
    const none = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  linux: { uses: ./.github/workflows/engine-checks-platform.yml, with: { os: linux } }
`,
    })
    assert.deepEqual(checkMacosJobsAreGated(none), [
      'engine-checks-nightly.yml: has no job that runs the platform checks on macOS',
    ])
  })
'''),
])

MACOS_TESTS = r'''const MACOS_CHECKS_OK = `
on: workflow_call
jobs:
  macos:
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: macos
      arch: aarch64
      runner: '["self-hosted", "macOS"]'
      jvm-tests: \${{ inputs.engine }}
      stdlib-suites: >-
        \${{ inputs.libraries && '[{"suite": "standard-library-in-native"},
        {"suite": "standard-library"}, {"suite": "std-aws"}]' || '[]' }}
`

describe('checkMacosChecksRunWhatIsRequested', () => {
  const problems = (text) =>
    checkMacosChecksRunWhatIsRequested(fixture({ 'workflows/macos-checks.yml': text }))
  test('accepts one call that runs the JVM tests on engine and three suites on libraries', () => {
    assert.deepEqual(problems(MACOS_CHECKS_OK), [])
  })
  test('applies only once macos-checks.yml exists', () => {
    assert.deepEqual(checkMacosChecksRunWhatIsRequested(fixture({})), [])
  })
  test('rejects a missing library suite and an unrelated engine condition', () => {
    const text = MACOS_CHECKS_OK.replace(', {"suite": "std-aws"}', '').replace(
      'inputs.engine',
      'inputs.other',
    )
    const found = problems(text)
    assert.equal(found.length, 2)
    assert.ok(found.some((p) => p.includes('`jvm-tests` must be `inputs.engine`')))
    assert.ok(found.some((p) => p.includes('`stdlib-suites` must be')))
  })
  test('rejects suites that run without inputs.libraries', () => {
    const text = MACOS_CHECKS_OK.replace("inputs.libraries && '", "true && '")
    assert.ok(problems(text).some((p) => p.includes('`stdlib-suites` must be')))
  })
  test('rejects a gated call, a second job, and another workflow', () => {
    assert.ok(
      problems(MACOS_CHECKS_OK.replace('    uses:', '    if: inputs.engine\n    uses:')).some((p) =>
        p.includes('must always be built'),
      ),
    )
    assert.deepEqual(problems(`${MACOS_CHECKS_OK}  other: { runs-on: ubuntu-latest, steps: [] }\n`), [
      'macos-checks.yml: must be one call of `engine-checks-platform.yml`',
    ])
    assert.ok(
      problems(MACOS_CHECKS_OK.replace('engine-checks-platform.yml', 'engine-checks.yml')).some(
        (p) => p.includes('must call `engine-checks-platform.yml`'),
      ),
    )
  })
  test('rejects a call that does not run on the self-hosted Mac', () => {
    const found = problems(
      MACOS_CHECKS_OK.replace(`'["self-hosted", "macOS"]'`, 'ubuntu-latest').replace(
        'os: macos',
        'os: linux',
      ),
    )
    assert.deepEqual(found, ['macos-checks.yml › macos: must run on the self-hosted Mac'])
  })
})

'''

test_path = root + '/tools/ci/check-workflows.test.mjs'
text = open(test_path, encoding='utf-8').read()
start = "describe('checkMacosChecksRunWhatIsRequested', () => {"
end = "describe('IDE packaging', () => {"
assert text.count(start) == 1 and text.count(end) == 1
text = text[: text.index(start)] + MACOS_TESTS + text[text.index(end) :]
open(test_path, 'w', encoding='utf-8', newline=chr(10)).write(text)
print('edited the policy and its tests')
```

```bash
py -3 "$SCRATCH/edit-policy-4c.py" .
py -3 "$SCRATCH/edit-github-claude.py" .github/CLAUDE.md 4c
corepack pnpm exec prettier --write .github
```

- [ ] **Step 5: Check, on both hosts**

```bash
node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (tests|pass|fail)"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-4c && node tools/ci/check-workflows.mjs && node --test tools/ci/*.test.mjs 2>&1 | grep -E "ℹ (pass|fail)" && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo actionlint-ok'
corepack pnpm exec prettier --check .github
git grep -nE '^\s*(- )?run: .*\./run( |$)' -- .github
"$SCRATCH/compare.sh" /c/Repos/Enso/ide-bs-4c .github/workflows/engine-checks.yml .github/workflows/release.yml > "$SCRATCH/compare-4c-final.md"
```

Expected: `Workflow policy: OK`, `ℹ tests 98`, `ℹ pass 98`, `ℹ fail 0` on both
hosts; `actionlint-ok`; Prettier clean; **no `./run` step in any workflow**; the
comparison shows D9 and D10 for the engine checks, and **only D9** for
`release.yml` (its four `setup-jvm` jobs, the license check and the three
backends, pass no `edition`, so they get `community`: the same GraalVM CE as
before, now checked through `$GRAALVM_VENDOR`). That and actionlint are this
PR's release-path check; the release itself first runs the change in the next
nightly after the merge, which Task 10 Step 2 watches. Say so in the PR body.

- [ ] **Step 6: Commit, push, open the PR with the macOS labels**

```bash
git add -A .github tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs
git commit -m "Nightly, extra and macOS checks as calls of engine-checks-platform.yml, without ./run"
git push -u origin ci/nightly-checks
```

Write `$SCRATCH/pr-4c.md`: what moves (the three workflows, 67 `./run` steps);
the new inputs; D9–D12 with reasons (attach `compare-4c-final.md` in
`<details>`); that the user dispatches each nightly workflow once from the
branch before merging; that no workflow calls `./run` any more, so Phase 5 can
delete `build_tools/`; "Part of #289's Phase 4."; the attribution lines. Then:

```bash
gh pr create --base develop --head ci/nightly-checks \
  --label "CI: No changelog needed" --label "CI: macOS Engine" --label "CI: macOS Libraries" \
  --title "Build simplification, PR 4c: the nightly and macOS checks without ./run" \
  --body-file "$SCRATCH/pr-4c.md"
```

The two macOS labels make `macos-pull-request.yml` run the new
`macos-checks.yml` on the Mac (its `🍎 Wait for the Mac` job fails if the Mac is
offline: then ask the user to bring it online, and re-run that job).

- [ ] **Step 7: Wait for the PR's checks**

Run `"$SCRATCH/wait-pr.sh" <N> 240` in the background. Expected: Workflow Lint,
Changelog; ✨ Engine (Linux and Windows, as on develop: the names are unchanged,
D10 is invisible at run time); ✨ IDE; and 🍎 macOS: "🍎 Wait for the Mac", then
"⚙️ Engine and Libraries / macos / Build Engine Distribution (GraalVM CE)
(native,test) (macos, aarch64)", "… / JVM Tests (GraalVM CE) (macos, aarch64)"
and the Native, JVM and AWS "Standard Library … Tests (GraalVM CE) (macos,
aarch64)" jobs. Check `"$SCRATCH/report-titles.sh" <head sha>`: an "Engine Tests
Report (GraalVM CE, macos, aarch64)" and a "Standard Library Tests Report
(GraalVM CE, macos, aarch64)"; compare their counts with the macOS lines of the
baseline (`$SCRATCH/baseline.md`, run 39515290706).

- [ ] **Step 8: STOP — ask the user to dispatch the two nightly workflows from
      the branch**

When the PR is green, ask the user to run (or to authorise you to run, once
each):

```bash
gh workflow run engine-checks-nightly.yml --repo jdunkerley/enso --ref ci/nightly-checks
gh workflow run extra-nightly-tests.yml --repo jdunkerley/enso --ref ci/nightly-checks
```

These publish nothing. The first takes about as long as the engine checks on
four platforms (the Mac's legs are skipped if it is offline).

- [ ] **Step 9: Compare the engine nightly with the `./run` baseline**

```bash
nid=$(gh run list --workflow engine-checks-nightly.yml --branch ci/nightly-checks -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/wait-run.sh" "$nid" 360
gh run view "$nid" --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name | sub("^[^/]+ / "; ""))"' | sort -t$'\t' -k2 > "$SCRATCH/nightly-new.tsv"
gh run view 39515290706 --json jobs --jq '.jobs[] | select(.name != "Build Script") | "\(.conclusion)\t\(.name)"' | sort -t$'\t' -k2 > "$SCRATCH/nightly-old.tsv"
diff <(cut -f2 "$SCRATCH/nightly-old.tsv") <(cut -f2 "$SCRATCH/nightly-new.tsv") && echo "same 25 jobs"
"$SCRATCH/report-titles.sh" "$(gh run view "$nid" --json headSha --jq .headSha)"
gh run view "$nid" --log | grep -m2 -E "Oracle GraalVM 25\.0\.1"
```

Expected, **with the Mac online**
(`gh run view "$nid" --json jobs --jq '.jobs[] | select(.name == "Check the macOS runner") | .conclusion'`
is `success` and a `macos / …` job ran): the same 25 job names as the baseline
(each now under its caller: `linux / `, `windows / `,
`linux (Oracle GraalVM) / `, `macos / `). **With the Mac offline**, the skipped
`macos` call shows as one skipped job named `macos` instead of the five
`(macos, aarch64)` jobs; compare the rest:

```bash
diff <(cut -f2 "$SCRATCH/nightly-old.tsv" | grep -v 'macos, aarch64') <(cut -f2 "$SCRATCH/nightly-new.tsv" | grep -vx macos) && echo "same 20 jobs"
```

and ask the user whether to dispatch again with the Mac online before merging
(the Mac's legs were proven on the PR's `CI: macOS …` run, Step 7). In both
cases: green wherever the baseline was green, and the Windows build green too
unless develop's PR checks show the same failure; one "Engine Tests Report" and
one "Standard Library Tests Report" per platform and edition, with counts within
the tests added on develop since the baseline's commit; the Oracle legs log
`Oracle GraalVM 25.0.1` in "Check the toolchain", and their JVM suite skipped
"Build the small JDK". A count that differs beyond added tests: ask the user to
dispatch develop's `engine-checks-nightly.yml` (still `./run`, until this
merges) for a same-day side by side, and compare with `junit-compare` as Phase
3's Task 15 did.

- [ ] **Step 10: Check the extra nightly against its prediction**

```bash
eid=$(gh run list --workflow extra-nightly-tests.yml --branch ci/nightly-checks -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/wait-run.sh" "$eid" 240
"$SCRATCH/job-times.sh" "$eid"
gh run view "$eid" --log | grep -m3 -E "ENSO_SNOWFLAKE_ACCOUNT is set, but empty|Enso Cloud authentication|Suite std-"
```

Expected, as Note [Extra Tests Without Their Secrets] predicts: "linux / Build
Engine Distribution (GraalVM CE) (native,test) (linux, amd64)" green; "Snowflake
Tests (JVM) (LinuxLatest)" and "Snowflake Tests (Native) (LinuxLatest)" red with
`ENSO_SNOWFLAKE_ACCOUNT is set, but empty` (the fork has no Snowflake secrets,
and `./run` passed them on empty in the same way); "Standard Library Cloud Tests
(GraalVM CE) (LinuxLatest)" with the Base, Table, AWS, Image and Microsoft
projects' results as in the PR suites (its real-cloud tests skip without
credentials). If the result differs from that, ask the user to dispatch
develop's `extra-nightly-tests.yml` (`./run`) and compare the two runs job by
job before merging.

- [ ] **Step 11: Merge**

Report Steps 9–10 to the user. When the comparison holds (and the PR checks are
green): `gh pr merge <N> --squash`.

---

### Task 10: Close out Phase 4

**Files:** none in the repository.

- [ ] **Step 1: Check develop**

```bash
git -C /c/Repos/Enso/ide fetch origin
git -C /c/Repos/Enso/ide grep -nE '^\s*(- )?run: .*\./run( |$)' origin/develop -- .github
git -C /c/Repos/Enso/ide grep -nE 'enso-build-cli|ENSO_BUILD_SKIP_VERSION_CHECK' origin/develop -- .github
gh workflow list --all --json path,state --jq '.[] | select(.path | test("nightly")) | "\(.state)\t\(.path)"'
```

Expected: the two greps print nothing; `nightly.yml` is `active` (Task 7).
`build_tools/`, `run`, `run.cmd` and `run.ps1` remain for Phase 5, unused by CI.

- [ ] **Step 2: Watch the first nightly after 4c**

4c changed `setup-jvm`, which the release's sbt jobs use (D9). After the next
02:00 UTC nightly:

```bash
nid=$(gh run list --workflow nightly.yml -L 1 --json databaseId --jq '.[0].databaseId')
"$SCRATCH/wait-run.sh" "$nid" 300
"$SCRATCH/job-times.sh" "$nid"
gh run view "$nid" --log | grep -m4 -E "GraalVM CE 25\.0\.1"
```

Expected: green, as Task 7 Step 10's run; the release's `setup-jvm` steps log
`GraalVM CE 25.0.1` in "Check the toolchain". If it fails in `setup-jvm`, tell
the user and, with their go-ahead, disable the nightly while it is fixed.

- [ ] **Step 3: Record and tidy**

- Comment on #289: the three PR links, rc.5's link and the parity summary, the
  first nightly's run, "Phase 4 complete", and the "Tickets to raise" list below
  (for the user to file; do not file them).
- Remove the worktrees `ide-bs-4a`, `ide-bs-4b`, `ide-bs-4c` with
  `git -C /c/Repos/Enso/ide worktree remove <dir>` once their branches have
  merged.
- Delete `$SCRATCH/parity-*` directories only after the comment is posted.

---

## Tickets to raise

Found while planning; out of Phase 4's scope. Do not raise them; list them in
the close-out comment for the user.

1. **The PR packaging and GUI checks still pass dead variables.**
   `ide-packaging.yml` and `gui-checks.yml` pass `ENSO_IDE_AG_GRID_LICENSE_KEY`,
   `ENSO_IDE_GOOGLE_ANALYTICS_TAG`, `ENSO_IDE_HOST`, `ENSO_IDE_SENTRY_DSN` and
   the `MICROSOFT_CODE_SIGNING_CERT*` secrets, none of which exists on the fork.
   Drop them as Decision 2 did for the release.
2. **Sentry is still built into the GUI.** `@sentry/vite-plugin` uploads source
   maps when `SENTRY_AUTH_TOKEN` is set, which only the old `release.yml` did;
   `pnpm-workspace.yaml`'s `allowBuilds` keeps `@sentry/cli` for it, with a
   comment naming `release.yml`. Remove the plugin, the dependency and the
   comment (an app change of its own).
3. **The extra nightly tests cannot pass on the fork.** There are no Snowflake
   or Enso Cloud secrets, so the Snowflake suites always fail and the cloud
   suite never reaches the cloud; `.github/PULL_REQUEST_TEMPLATE.md` still asks
   contributors to schedule upstream's run. Decide: drop the workflow, drop the
   Snowflake suites, or add a Snowflake account (see #68 for the Redshift
   analogue).
4. **The nightly's heap-dump artifacts can collide.** The GraalVM CE and Oracle
   GraalVM legs on Linux both name theirs `Heap dumps (JVM Tests, linux, amd64)`
   (and the same for the suites), as under `./run`; if both legs dump, the
   second upload fails. Add the edition to the name for non-default editions.
5. **The installers are unsigned.** Windows shows SmartScreen warnings, and
   unsigned macOS builds have no update feed (`ENSO_IDE_UPDATES=manual`, no
   `latest-mac.yml` or zip). Note [Signing The Installers] in `release.yml` says
   where certificates go (electron-builder's `win.signtoolOptions` or
   `win.azureSignOptions`, `CSC_LINK` and the notarization hook).
6. **The release still uploads artifacts nobody downloads:** "Edition File" and
   "fbs-schema" (in `ide-packaging.yml` too). Kept for parity; drop them in
   both.
7. **Upstream links in the release docs.** `docs/distribution/release-policy.md`
   and `nightly.md` link `enso-org/enso`'s workflow pages; point them at the
   fork's, and describe the rc test of Task 7 as the way to prove a release
   change.
8. **`enso-remove-draft-releases`** (`build_tools/cli/src/bin/`) deletes drafts
   in `enso-org/enso`, hard-coded. Phase 5 deletes it with `build_tools/`;
   `gh api -X DELETE repos/jdunkerley/enso/releases/<id>` replaces it.
9. **Re-running a platform's release jobs after a day fails.** The
   `wasm-artifacts` artifact is kept for one day (`retention-days: 1`, as in
   `ide-packaging.yml`), so re-running "Build IDE" days after a release, to add
   a missing installer as the publish note suggests, fails at its download. Keep
   it for the release as long as the `gui` artifact, or document re-running the
   whole platform chain.

## Self-review against the spec

| Spec section / requirement                                                                                                       | Where                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Phase 4: release, promote, nightly and `ide upload` on `tools/build-scripts`                                                     | Tasks 1–4 (the command), 5–7 (the workflows)                                                                                     |
| Phase 4 gate: proven by an rc prerelease; ask the user before publishing                                                         | Task 7: STOP steps 1, 5, 7, 8, 9; rc.5 stops at a draft that is checked before the user OKs and starts its publishing (R13)      |
| Components, `release`: `create-draft` (tag collision, body template, notes from `CHANGELOG.md`)                                  | `createDraft`, `releaseBody`, `topReleaseNotes` (Tasks 2–3), with the Rust messages                                              |
| `publish` (asset manifest, missing-platform note, asset validation)                                                              | `publishRelease`, `validateRelease`; the manifest is dropped (Decision 2) and the validation checks the installers directly (R5) |
| `promote <designator>` (next version from tags)                                                                                  | `release promote` over 3a's `generateVersion` and `git ls-remote --tags origin` (Task 4; rc.5 checked locally)                   |
| `update-latest-version`                                                                                                          | `withLatestRelease` (the `config.rs` tests) and the action (Task 4); its job no longer skipped by macOS (D5)                     |
| `upload-ide` (installers, `.sha256`, `.blockmap`, `latest*.yml`)                                                                 | `ideUploadFiles`, `uploadIdeAssets` (Tasks 2–3); the feed names unchanged (Decision 3)                                           |
| "All of these use the `gh` CLI or Octokit"                                                                                       | Plain `fetch` instead (Decision 3, R1): neither can upload to a draft by id without a new dependency                             |
| CI structure: reusable workflows for release and promote; matrices                                                               | `release.yml` (`workflow_call`), `promote.yml` → `release.yml`; Linux/Windows matrices, macOS as gated jobs (Task 5)             |
| CI structure: required-check names; `actionlint`                                                                                 | No aggregator touched; actionlint in Tasks 5, 8, 9                                                                               |
| Verification, Release: an rc prerelease end to end (draft, upload, publish, manifest, update feed), and the installed rc updates | Task 7 Steps 2–5 (`release-parity.sh`, the user's update); the manifest is gone by Decision 2                                    |
| Verification, throughout: Linux and Windows; no `git stash`, no `--no-verify`; Prettier on docs                                  | Global Constraints; WSL runs in Tasks 5, 8, 9; Build Scripts CI on Linux (Task 4)                                                |
| Risks: release touches published artifacts; goes last; every publish waits for the user                                          | Task 7; Global Constraints' first bullet                                                                                         |
| Risks: two ways to build during Phases 2–4                                                                                       | `.github/CLAUDE.md`'s table updated by 4b and 4c; Task 10 confirms no workflow calls `./run`                                     |
| Out of scope: the macOS release path beyond keeping it working                                                                   | Kept as is (Decision 5); signing is Ticket 5                                                                                     |
| Phase 5 prerequisite: nothing in CI calls `./run`                                                                                | 4c (Task 9 Step 5, Task 10 Step 1)                                                                                               |

**Placeholder scan:** `<N>` is a PR number, known once `gh pr create` prints it;
`$id`, `$nid`, `$eid` come from `gh run list`; `<id>` in the draft deletion is
printed by the preceding listing; `<head sha>` and `<date>` are values the runs
print. No step says "similar to" another: Tasks 5 and 9 each carry their whole
workflows and edit scripts.

**Consistency:** the names match across tasks:

- the script `release` and its actions `create-draft`, `upload-ide`, `publish`,
  `promote`, `update-latest-version`; the outputs `ENSO_RELEASE_ID`,
  `ENSO_VERSION`, `ENSO_EDITION`, `ENSO_RELEASE_MODE`,
  `ENSO_LATEST_RELEASE_UPDATED` (Task 4) and the workflow expressions that read
  them (Task 5);
- `GitHub`, `Release`, `gitHub`, `gitHubFromEnv` (Task 1); `RELEASE_TARGETS`,
  `installerName`, `ideUploadFiles`, `contentType`, `splitUploaded`,
  `missingInstallersNote`, `releaseBody`, `topReleaseNotes`, `withLatestRelease`
  (Task 2); `releaseVersion`, `releaseId`, `parseDesignation`, `createDraft`,
  `publishRelease`, `uploadIdeAssets` (Task 3);
- the release job ids of D1, which the 4b policy names (`build-backend-macos`,
  `upload-ide-macos`, `publish-release`, `update-latest-release-version`,
  `draft-release`, `license-check`, `upload-ide`);
- `engine-checks-platform.yml`'s inputs `arch`, `edition`, `jvm-tests`,
  `linux-checks`, `runner`, `stdlib-suites` and outputs (Task 8), used by Task
  9's three callers; `setup-jvm`'s `edition` values `community`/`oracle`;
- the policy helpers `isMacosCaller` and `ungatedMacosJobs` (4b), used by 4c.

**Tested before writing** (2026-10-23, on scratch worktrees of develop at
`c848ae9746` with every change of this plan applied, in order):

- `tools/build-scripts`: 176 vitest tests pass on Windows (54 new: githubApi 10,
  assets 11, notes 7, latestRelease 4, release 22); `tsc --noEmit`, ESLint
  `--max-warnings=0` and Prettier clean.
- `release promote rc` printed `2026.1.1-rc.5` against the fork's tags;
  `promote nightly` printed `2026.1.1-nightly.2026.10.23.1`;
  `update-latest-version` with `2026.1.1-rc.5` left `build-config.yaml` alone;
  `publish` without a token stopped at `GITHUB_TOKEN is not set.`.
- The policy: with 4b applied to develop (the old nightly and macOS workflows),
  97 `node:test` tests pass on Windows and WSL and the policy is OK, with the
  tests of `checkPullRequestsIgnoreSpecs` and `checkSetupNodeCache` kept; the
  new release tests fail as Task 5 Step 2 says against the old rules (79 pass, 9
  fail), and the old `release.yml` fails the new rules as Step 3 says; with 4c
  applied, 98 pass on both hosts. Each edit script ran on develop's files in the
  plan's order (4b, then 4c) and produced the files the checks ran on.
- actionlint 1.7.12 with shellcheck 0.11.0 is clean on every final workflow (4b
  alone, and 4b + 4c); Prettier is clean on `.github`, the docs and the package;
  `release-parity.sh` is shellcheck-clean, and ran on rc.3 → rc.4 (without
  installers) and, in full, on the two nightlies: it downloaded both installers
  through the API, and each matched its feed's sha512 and its `.sha256`; the
  expected mismatches only. The runner listing of Task 7 Step 1 works with the
  user's token (`Jamess-Mac-mini online …`).
- `compare.sh` on the 4c engine checks shows only D9 and D10.
- Not run: any workflow (no dispatch, upload or publish; so neither
  `publish: false` nor the `release-id` mode has run), `ide-build` on macOS,
  `buildEngineBundle` on the Mac (both first run in Task 7), Oracle GraalVM
  through `setup-graalvm` (first run in Task 9), and the package's tests on
  Linux (its CI job runs them).

## Rulings

1. **R1:** the REST client is plain `fetch` (Node 24's), not Octokit or `gh`.
   - **Why:** `gh release upload <tag>` does find a draft by its tag, but after
     a re-run two drafts can share one, so the upload must name the draft by id;
     and the commands need the content type, the retry and R3's replacement
     rules in their own hands. Octokit is a new dependency for five endpoints.
   - **Cost if wrong:** a hand-written client to maintain (100 lines, tested).
2. **R2:** an upload reads the whole file into memory and posts a buffer.
   - **Why:** the upload API wants a `Content-Length`, which a buffer gives
     without any streaming setup; the installers are under 1 GB and the runners
     have 7 GB or more.
   - **Cost if wrong:** an installer near 2 GB would need a streamed body.
3. **R3:** `upload-ide` uploads to the release by id, draft or published, as
   `./run` did; a draft's assets may be replaced, a published release's never.
   - On a draft, a same-named asset is deleted and replaced: one an earlier run
     of the job uploaded (a re-run replaces its own installer), and the
     half-written one (`state: starter`) a failed attempt leaves, before each
     retry and after the last. GitHub refuses a second asset of a name, so
     `./run`'s plain retry could not succeed.
   - On a published release (re-running a skipped platform's jobs adds its
     installer, as the note says), nothing is ever deleted: a same-named asset,
     or a partial one a failed attempt left, stops the upload with an error that
     says to delete it by hand.
   - `publish` refuses a draft with any asset not `uploaded`, so a half-written
     installer is never published.
   - **Why:** a published release's files are what users download; replacing one
     silently would change a published version. A draft is private.
   - **Cost if wrong:** a broken upload to a published release needs a hand
     deletion before the re-run.
4. **R4:** `publish` sends one PATCH with the note, the tag, the target and
   `draft: false`.
   - **Why:** `./run` made two calls (edit, then publish); one call cannot leave
     an edited but unpublished draft, and it restates the tag, as the second
     call had to.
   - **Cost if wrong:** none known.
5. **R5:** the validation downloads each uploaded installer's public URL rather
   than going through `assets.json`.
   - **Why:** `assets.json` is gone (Decision 2); the check was always about the
     installers.
   - **Cost if wrong:** none.
6. **R6:** `topReleaseNotes` finds level-1 ATX headings outside fenced code
   blocks.
   - **Why:** that is what `pulldown_cmark` reported for `CHANGELOG.md`'s shape;
     a full Markdown parser would be a new dependency. Setext headings (`===`)
     are not recognised; the changelog has none.
   - **Cost if wrong:** a setext heading would merge two sections; the test on
     the real file would catch a structural change only when the package is
     touched.
7. **R7:** `release promote` logs to stderr.
   - **Why:** locally `eval "$(… release promote rc)"` then reads only the
     exports, as `version`'s output does; in CI the values go to
     `GITHUB_OUTPUT`.
   - **Cost if wrong:** none.
8. **R8:** `engine-checks-platform.yml` takes its runner as a label or a JSON
   list
   (`startsWith(inputs.runner, '[') && fromJSON(inputs.runner) || inputs.runner`).
   - **Why:** the self-hosted Mac needs two labels; `gui-checks.yml` already
     takes a JSON list for the same reason, and this form leaves the existing
     callers' plain labels working.
   - **Cost if wrong:** none; the PR comparison shows the expression only.
9. **R9:** `extra-nightly-tests.yml` keeps its own suite job instead of the
   platform workflow's.
   - **Why:** its secrets, `REPORT_ALL_TESTS`, job names and report names
     differ; passing them through the platform workflow would put Snowflake
     secrets on every pull-request suite. The platform workflow builds the
     distribution and publishes its version as outputs for it.
   - **Cost if wrong:** two copies of the suite steps; Ticket 3 may delete one.
10. **R10:** 4c deletes `.github/actions/build-script` and `setup-build-script`.
    - **Why:** nothing uses them since Phase 3 (the generator-era files inline
      their steps, and those are rewritten here).
    - **Cost if wrong:** none; Phase 5 would have deleted them.
11. **R11:** an upload aborts after ten minutes plus a second per megabyte
    (`uploadTimeoutMs`; 24 minutes for an 840 MB `.dmg`), through an
    `AbortSignal` on the request.
    - **Why:** a stalled upload would otherwise hang until the job's timeout.
      undici's own `headersTimeout` and `bodyTimeout` (300 s) cover only the
      wait for the response, not sending the body, so they do not cut a slow
      upload short; the signal bounds the whole request. No `undici` import is
      needed (it is not a dependency here).
    - **Cost if wrong:** an uplink under 1 MB/s would fail the Mac's upload;
      raise the rate in `uploadTimeoutMs`.
12. **R12:** a 404 is `null` only for `GET` (the thing does not exist) and
    `DELETE` (absence is the goal); on `PATCH` or `POST` it is an error.
    - **Why:** a `PATCH` to a release someone deleted meanwhile must fail, not
      pass silently and leave `publish` to report a confusing "not published".
    - **Cost if wrong:** none.
13. **R13:** the publish hold is a `publish` input (default `true`) on
    `release.yml` and `promote.yml`, and a `release-id` mode of `release.yml`
    that runs only the publish and latest-version jobs for an existing draft.
    - **Why:** the rc test must stop at a draft that can be checked. A separate
      publish workflow would be simpler, but `workflow_dispatch` needs the
      workflow file on the default branch, so a new file could not be dispatched
      from the 4b branch before it merges; `release.yml` already exists there. A
      GitHub environment with required reviewers would need a settings change
      and would hold the unattended nightlies. `release publish` checks that the
      draft's tag is the given version, so a wrong `release-id` cannot publish
      another release.
    - **Cost if wrong:** five root jobs carry `if: inputs.release-id == ''`.
14. **R14:** `withLatestRelease` keeps a CRLF `build-config.yaml` CRLF.
    - **Why:** Rust's `lines()` and `"\n"` rewrote every line ending as LF,
      which on a CRLF checkout would turn the bump PR into a whole-file diff. CI
      checks out LF, so the release workflow sees no difference.
    - **Cost if wrong:** none.
