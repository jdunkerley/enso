# Build Simplification, Phases 0 and 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy away the Bazel and dead-CI remnants (Phase 0), then replace the
Rust-generated GitHub workflows with hand-written ones built from composite
actions, matrices and reusable workflows, checked by actionlint, and delete the
generator (Phase 1). Every workflow still calls `./run`.

**Architecture:** Phase 0 is one pull request of deletions and doc fixes. Phase
1 lands in seven pull requests:

- 1a adds the shared pieces and changes no job:
  - six composite actions;
  - a temporary job-by-job comparison script;
  - a permanent workflow-policy check that ports the generator's unit tests;
  - the actionlint workflow;
  - a "hand-maintained" header on the generated files that stay as they are.
- 1b–1f each rewrite one family of generated workflows. Each is proven by its
  own CI run, plus `workflow_dispatch` runs where the pull request alone cannot
  exercise it.
- 1g deletes `build_tools/ci-gen` and `enso_build::ci_gen`.

The release workflows are not restructured here; Phase 4 does that, with the
user and an rc prerelease.

**Tech Stack:** GitHub Actions YAML (composite actions, `workflow_call`,
`strategy.matrix`); actionlint 1.7.12 with shellcheck; Node 24 ESM scripts with
the `yaml` package and `node:test`; Rust (`enso-build`, `ide-ci`) for the
deletion; `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-20-build-simplification-design.md`
(design PR #289). Read it before starting. The controller's decisions that bind
this plan, and the rulings this plan makes where the spec leaves a choice, are
listed at the end ("Rulings").

## Global Constraints

- **Runs unattended.** Never publish anything:
  - no `release.yml`, `promote.yml` or `nightly.yml` run;
  - no tag, no release;
  - no `gh workflow run` of anything except the workflows named in Tasks 9–11.
- **Merge on green, and only on green.** Every PR takes the label
  `CI: No changelog needed`. Merge with `gh pr merge <N> --squash` once every
  check has passed. A red check is handled by "When a check fails" below, never
  by merging anyway.
- **When a check fails:**
  1. Look up the same job in develop's latest push run of that workflow (Task 0
     records them in `$SCRATCH/baseline.md`).
  2. Re-run the failed jobs once: `gh run rerun <run-id> --failed`.
  3. If it fails again and develop fails the same job at the same step, it is
     not this PR's failure. Do not merge. Comment the evidence on the PR (both
     run links and the failing step), leave the PR open, and go on.
  4. A later PR that needs this one's files is then based on this PR's branch (a
     stacked PR). Before merging a parent, retarget its child to `develop`
     (memory: stacked PR merge order).
  5. If develop passes that job, the failure is this PR's: fix it.
- **Never** `git stash`, `--no-verify`, `--force` pushes, or edits to your own
  permissions or settings files.
- **Use `corepack pnpm`**, never bare `pnpm` or `npm`, locally. The workflows
  keep the commands they already use.
- **Linux is checked as well as Windows.**
  - actionlint runs in WSL (Task 0 installs it) and in CI on `ubuntu-latest`.
  - The Rust deletion in Task 12 is tested in WSL with its own
    `CARGO_TARGET_DIR`, after `. ~/.enso-toolchain.sh`.
  - Never run pnpm in WSL against `/mnt/c`.
- **Keep these verbatim in every rewritten workflow**, and check them with the
  comparison script:
  - triggers (including `types:` and `paths-ignore: ["docs/superpowers/**"]`);
  - `concurrency:` groups;
  - job display names that other workflows read;
  - the aggregator names "Engine Required Checks", "GUI Required Checks", "IDE
    Required Checks" and "WASM Required Checks" (their files are not touched at
    all);
  - secrets and variables;
  - artifact names;
  - `permissions:`;
  - `continue-on-error`, `timeout-minutes`;
  - the label handling (`CI: Clean build required`, `CI: Build IDE`,
    `CI: No changelog needed`).

  Every difference the comparison reports is listed, with its reason, in the PR.

- **Required checks:** the live ruleset ("Protect develop/main", id 22027783)
  requires no status check. Its rules are deletion, non-fast-forward, a pull
  request with squash merges and no required approvals, and linear history.
  `GET …/branches/develop/protection` returns 404: there is no classic branch
  protection. `.github/settings.yml` lists upstream's contexts, but the Settings
  app is not active on this fork. So nothing on GitHub keys on a check's name.
  The four aggregator names are kept anyway: reviewers look for them, and the
  memory notes rely on them.
- **Actions are pinned by major tag** (`actions/checkout@v5`), as the repository
  does everywhere; the repository does not require SHA pinning. The one new
  third-party piece, `docker://rhysd/actionlint:1.7.12`, is pinned to an exact
  version released 2026-03-30, which is older than the two-week minimum.
- **Docs are formatted with Prettier**:
  `corepack pnpm exec prettier --write <file>` on every Markdown, YAML or JSON
  file you touch. `tools/` is in `.prettierignore`; the scripts below are
  already formatted with the repository's options, so copy them exactly.
- **Commits** end with the executing session's attribution trailers. **PR
  bodies** end with its attribution lines.
- **Watching CI:**
  - Use `gh` with `--jq` only (there is no `jq` binary).
  - Put a time cap on every wait.
  - Never sleep in the foreground: run the watcher below with
    `run_in_background`, and work on the next task meanwhile (memory: work while
    CI runs).

  Save this once as `$SCRATCH/wait-pr.sh`:

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

`$SCRATCH` is the executing session's scratchpad directory.

---

## Branches, worktrees and PRs

All worktrees are created from `origin/develop` under `C:\Repos\Enso\`, with
`git -C C:\Repos\Enso\ide worktree add <dir> -b <branch> origin/develop`.

| PR  | Branch                           | Worktree    | Tasks | Validated by                                                            |
| --- | -------------------------------- | ----------- | ----- | ----------------------------------------------------------------------- |
| 0   | `chore/build-tidy-up`            | `ide-bs-p0` | 0–2   | its own CI (GUI checks, IDE packaging)                                  |
| 1a  | `ci/workflow-foundations`        | `ide-bs-1a` | 3–6   | its own CI, including the new Workflow Lint job                         |
| 1b  | `ci/hand-written-changelog`      | `ide-bs-1b` | 7     | its own Changelog runs, with and without the label                      |
| 1c  | `ci/hand-written-std-libs-label` | `ide-bs-1c` | 8     | its own runs (direct and via ✨ Engine), plus a throwaway labelling PR  |
| 1d  | `ci/hand-written-engine-checks`  | `ide-bs-1d` | 9     | its own ✨ Engine run, plus a `workflow_dispatch` with a clean build    |
| 1e  | `ci/hand-written-ide-packaging`  | `ide-bs-1e` | 10    | its own ✨ IDE run, plus a `workflow_dispatch` with a clean build       |
| 1f  | `ci/hand-written-benchmarks`     | `ide-bs-1f` | 11    | `workflow_dispatch` of both benchmarks with `just-check`                |
| 1g  | `ci/retire-ci-gen`               | `ide-bs-1g` | 12    | its own CI (WASM, engine, IDE, GUI, Workflow Lint) and WSL `cargo test` |

- PR 0 merges before PR 1a is opened.
- 1b–1f each start from `develop` after 1a has merged. They touch separate files
  and can be open at the same time.
- 1g starts after 1b–1f have all merged, and after #288 has merged or closed.

The design branch `design/build-simplification` (worktree
`C:\Repos\Enso\ide-build`, draft PR #289) carries only the spec and this plan.

## The generated workflows and what happens to each

There are 11 generated workflows (first line `# This file is auto-generated`),
and #288, if it merges first, adds a 12th, `macos-checks.yml`.

| Workflow                    | Phase 1 treatment                                  | Why                                                                                                              |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `changelog.yml`             | Rewritten (PR 1b)                                  | Runs on every PR; its own PR proves it.                                                                          |
| `std-libs-labels.yml`       | Rewritten as a matrix (PR 1c)                      | Runs on every PR, directly and from ✨ Engine.                                                                   |
| `engine-checks.yml`         | Rewritten + `engine-checks-platform.yml` (PR 1d)   | The PR's ✨ Engine run proves it; a dispatch proves the clean-build path.                                        |
| `ide-packaging.yml`         | Rewritten as matrices (PR 1e)                      | The PR's ✨ IDE run proves it; a dispatch proves the clean-build path.                                           |
| `engine-benchmark.yml`      | Rewritten (PR 1f)                                  | Dispatch-only, publishes nothing; `gh workflow run --ref` with `just-check` proves it.                           |
| `std-libs-benchmark.yml`    | Rewritten (PR 1f)                                  | As above.                                                                                                        |
| `release.yml`               | Header only (PR 1a)                                | Publishes; validated only by a release (Phase 4, with the user).                                                 |
| `promote.yml`               | Header only (PR 1a)                                | Creates tags and releases; as above.                                                                             |
| `nightly.yml`               | Header only (PR 1a)                                | Calls `promote.yml`; as above.                                                                                   |
| `engine-checks-nightly.yml` | Header only (PR 1a)                                | A rewrite needs a full run of its macOS jobs (self-hosted Mac, may be offline at night) and Oracle GraalVM jobs. |
| `extra-nightly-tests.yml`   | Header only (PR 1a)                                | Its jobs need Snowflake and Enso Cloud secrets this repository does not have, so no run can validate a rewrite.  |
| `macos-checks.yml` (#288)   | Header only (PR 1a, or PR 1g if #288 merges later) | Needs the self-hosted Mac.                                                                                       |

`bench-upload.yml` was never generated (it has no generated header). It is not
touched: it publishes to `enso-org/engine-benchmark-results`.

## File map

| Path                                                                                                               | PR  | Change                                                      |
| ------------------------------------------------------------------------------------------------------------------ | --- | ----------------------------------------------------------- |
| `maven_install.json`, `app/electron-client/macos/stage-bazel-app.sh`                                               | 0   | Delete                                                      |
| `tools/ci/check-changelog.js`, `tools/ci/nightly/` (7 files)                                                       | 0   | Delete                                                      |
| `.prettierignore`, `app/electron-client/macos/README.md`                                                           | 0   | Drop the deleted files' lines                               |
| `CLAUDE.md`, `README.md`                                                                                           | 0   | Drop the Bazel mentions (and the `maven_install.json` site) |
| `tools/CLAUDE.md`, `tools/ci/README.md`                                                                            | 0   | Describe what `tools/ci` holds now                          |
| `docs/CONTRIBUTING.md`, `build_tools/CLAUDE.md`                                                                    | 0   | Stable Rust, `pnpm-lock.yaml`; no `install/`                |
| `package.json`, `pnpm-lock.yaml`                                                                                   | 1a  | Root dev dependency `yaml` 2.9.1 (already in the lockfile)  |
| `tools/ci/compare-workflows.mjs` + `.test.mjs`                                                                     | 1a  | Create (deleted again in 1g)                                |
| `tools/ci/check-workflows.mjs` + `.test.mjs`                                                                       | 1a  | Create (permanent)                                          |
| `.github/actions/*/action.yml` (six actions, Task 5)                                                               | 1a  | Create                                                      |
| `.github/workflows/workflow-lint.yml`, `.github/actionlint.yaml`, `.github/CLAUDE.md`                              | 1a  | Create                                                      |
| `.github/workflows/formatting.yml`, `enso4igv.yml`                                                                 | 1a  | Fix the shellcheck findings                                 |
| `.github/workflows/{release,promote,nightly,engine-checks-nightly,extra-nightly-tests}.yml`                        | 1a  | Replace the generated header                                |
| `.github/workflows/changelog.yml`                                                                                  | 1b  | Rewrite                                                     |
| `.github/workflows/std-libs-labels.yml`                                                                            | 1c  | Rewrite                                                     |
| `.github/workflows/engine-checks.yml`, `engine-checks-platform.yml`, `engine-changed-files.yml`                    | 1d  | Rewrite / create / list the new files                       |
| `.github/workflows/ide-packaging.yml`                                                                              | 1e  | Rewrite                                                     |
| `.github/workflows/engine-benchmark.yml`, `std-libs-benchmark.yml`                                                 | 1f  | Rewrite                                                     |
| `build_tools/ci-gen/`, `build_tools/build/src/ci_gen.rs`, `build_tools/build/src/ci_gen/`                          | 1g  | Delete                                                      |
| `build_tools/build/src/ci/input.rs`, `build_tools/ci_utils/src/actions/workflow/definition.rs`                     | 1g  | Delete (only the generator used them)                       |
| `Cargo.toml`, `Cargo.lock`, `build_tools/build/src/{lib.rs,ci.rs}`, `build_tools/ci_utils/src/actions/workflow.rs` | 1g  | Unhook the deleted code                                     |
| `build_tools/build/src/release/manifest.rs`, `build_tools/build/src/release.rs`                                    | 1g  | Take `RELEASE_TARGETS`; fix comments                        |
| `CLAUDE.md`, `.github/CLAUDE.md`, `build_tools/CLAUDE.md`, `build_tools/build/CLAUDE.md`                           | 1g  | Point at the hand-written workflows                         |
| `app/rust-ffi/CLAUDE.md`, `app/rust-ffi/Cargo.toml` (comment), `.vscode/launch.json`                               | 1g  | Drop the generator references                               |
| The `PR_IGNORED_PATHS` comments in `*-pull-request.yml` and `formatting.yml`                                       | 1g  | Point at the policy check                                   |
| `tools/ci/compare-workflows.mjs` + `.test.mjs`                                                                     | 1g  | Delete                                                      |

---

## Phase 0: tidy-up (PR 0)

### Task 0: Preconditions and the CI baseline

**Files:** none in the repository. Creates `$SCRATCH/baseline.md`,
`$SCRATCH/wait-pr.sh`, and the WSL tools under `~/tools`.

**Interfaces:**

- Produces: `$SCRATCH/baseline.md`, which records, per workflow, develop's
  latest push run id and its per-job conclusions. Every later "When a check
  fails" step reads it. Also produces the WSL binaries
  `~/tools/actionlint-1.7.12/actionlint` and
  `~/tools/shellcheck-v0.11.0/shellcheck`, used by Tasks 5–12.

- [ ] **Step 1: Check the state of #288 and of develop**

```bash
cd /c/Repos/Enso/ide && git fetch origin
gh pr view 288 --json state,mergedAt,headRefName --jq '"\(.state) \(.mergedAt) \(.headRefName)"'
git grep -l "This file is auto-generated" origin/develop -- .github/workflows
```

Expected:

- #288's state is `OPEN`, `MERGED` or `CLOSED`.
- 11 files are listed (12 with `macos-checks.yml` if #288 has merged):
  `changelog`, `engine-benchmark`, `engine-checks-nightly`, `engine-checks`,
  `extra-nightly-tests`, `ide-packaging`, `nightly`, `promote`, `release`,
  `std-libs-benchmark` and `std-libs-labels`.

Write both results at the top of `$SCRATCH/baseline.md`. If the list holds a
file not in this plan's table "The generated workflows", stop and report.

- [ ] **Step 2: Record develop's CI baseline**

```bash
for wf in engine-pull-request.yml ide-pull-request.yml gui-pull-request.yml wasm-pull-request.yml formatting.yml enso4igv.yml std-libs-labels.yml; do
  id=$(gh run list --workflow "$wf" --branch develop --event push --limit 1 --json databaseId --jq '.[0].databaseId')
  echo "## $wf (run $id)"
  gh run view "$id" --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name)"' | sort -k2
done >> "$SCRATCH/baseline.md"
```

Expected: a section per workflow. On 2026-10-20 develop was red on two jobs:

- "Build Engine Distribution (GraalVM CE) (native,test) (windows, amd64)";
- "Build Backend (windows, amd64)".

Its std-libs-labels push runs also fail by design: there is no PR to label. For
every red develop job, re-run it once to tell a flake from a real failure, then
append the result:

```bash
gh run rerun <run-id> --failed
```

- [ ] **Step 3: Install actionlint and shellcheck in WSL**

```bash
wsl -e bash -lc 'set -e; mkdir -p ~/tools/actionlint-1.7.12 && cd ~/tools/actionlint-1.7.12 &&
  [ -x actionlint ] || { curl -sSfL -o al.tgz https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz && tar xzf al.tgz actionlint; };
  cd ~/tools && [ -x shellcheck-v0.11.0/shellcheck ] || { curl -sSfL -o sc.txz https://github.com/koalaman/shellcheck/releases/download/v0.11.0/shellcheck-v0.11.0.linux.x86_64.tar.xz && tar xJf sc.txz; };
  ~/tools/actionlint-1.7.12/actionlint -version | head -1; ~/tools/shellcheck-v0.11.0/shellcheck --version | sed -n 2p'
```

Expected: `1.7.12` and `version: 0.11.0`.

- [ ] **Step 4: Measure actionlint on develop**

```bash
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide && ~/tools/actionlint-1.7.12/actionlint -no-color -oneline -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck' | sed 's/:[0-9]*:[0-9]*:/:/' | sort | uniq -c
```

Run it in a worktree at `origin/develop`; the `ide` worktree on `develop` will
do once it is up to date. Expected findings, all of which PR 1a deals with:

- `release.yml` ×12 and `promote.yml` ×2: `clean_build_required` is not defined;
- `changelog.yml` ×2: the same;
- `std-libs-labels.yml` ×1: `description` is an unexpected key;
- `enso4igv.yml` ×10 and `formatting.yml` ×2: shellcheck SC2006, SC2003, SC2046
  and SC2086.

Anything else (for example a new finding from #288) is added to Task 6's fixes
or ignores, with its reason.

- [ ] **Step 5: Save the CI watcher**

Write `$SCRATCH/wait-pr.sh` with the content in Global Constraints, then
`chmod +x "$SCRATCH/wait-pr.sh"`.

No commit: this task changes nothing in the repository.

### Task 1: Remove the Bazel and dead-CI remnants

**Files:**

- Delete: `maven_install.json`, `app/electron-client/macos/stage-bazel-app.sh`,
  `tools/ci/check-changelog.js`, `tools/ci/nightly/` (`bump-version.js`,
  `extract-release-notes.js`, `github.js`, `package.json`, `preflight-check.js`,
  `publish-release.js`, `trigger-workflow.js`)
- Modify: `.prettierignore:48`, `app/electron-client/macos/README.md:71`,
  `CLAUDE.md:58-60` and `CLAUDE.md:216`, `README.md:152-154`

**Interfaces:** none (no code consumes these files).

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-p0 -b chore/build-tidy-up origin/develop
cd /c/Repos/Enso/ide-bs-p0 && corepack pnpm install --frozen-lockfile --ignore-scripts
```

Expected: the worktree is created and the install finishes. It is needed only
for Prettier.

- [ ] **Step 2: Prove that nothing uses them (the failing check)**

```bash
cd /c/Repos/Enso/ide-bs-p0
git grep -n -i -E "maven_install|stage-bazel-app|check-changelog|tools/ci/nightly|ci/nightly/|BazelSupport|bump-version\.js|extract-release-notes|preflight-check\.js|publish-release\.js|trigger-workflow\.js" -- ':!docs/superpowers/**'
git grep -n -i bazel -- build.sbt project/ README.md CLAUDE.md
```

Expected now, before the change:

- the first command lists only `.prettierignore:48`, `CLAUDE.md:59`,
  `CLAUDE.md:216`, `app/electron-client/macos/README.md:71`,
  `app/electron-client/macos/stage-bazel-app.sh:8` and `tools/CLAUDE.md:11`;
- the second lists only `CLAUDE.md:58`, `CLAUDE.md:59`, `CLAUDE.md:216` and
  `README.md:153`.

`build.sbt` and `project/` mention Bazel nowhere, so the "dormant `BazelSupport`
hooks" that CLAUDE.md describes no longer exist. If either command lists
anything else (a real use), stop and report instead of deleting.

- [ ] **Step 3: Delete the files**

```bash
git rm -q maven_install.json app/electron-client/macos/stage-bazel-app.sh tools/ci/check-changelog.js
git rm -q -r tools/ci/nightly
```

- [ ] **Step 4: Drop the references**

- `.prettierignore`: delete the line `maven_install.json` (line 48).
- `app/electron-client/macos/README.md`: delete the line
  ``- `stage-bazel-app.sh`: Bazel helper target used to stage the built app.``
- `CLAUDE.md`: delete the paragraph

  ```
  Bazel was previously being rolled out as a fourth ("target") build system and
  has been removed from the IDE side; some dormant `BazelSupport` hooks remain in
  the engine's `build.sbt`.
  ```

  together with the blank line after it. Also delete the bullet
  ``- `maven_install.json` — the dormant Bazel pin; needs Bazel to repin.`` from
  the "Toolchain versions are duplicated all over" list.

- `README.md`: replace

  ```
  This repository is a fork of the original Enso Analytics repository. The forked
  version adjusts the build process to not depend on Bazel or the services of Enso
  Analytics.
  ```

  with

  ```
  This repository is a fork of the original Enso Analytics repository. The forked
  version adjusts the build process and does not depend on the services of Enso
  Analytics.
  ```

- [ ] **Step 5: Re-run the check**

Run both commands from Step 2.

Expected:

- the first lists only `tools/CLAUDE.md:11` (Task 2 fixes it);
- the second prints nothing.

The other Bazel mentions are left as they are; see Ruling 14. They are:

- `app/electron-client/macos/README.md` (title, lines 4, 10 and 36) and
  `build-dmg.mjs`'s `stageAppFromBazel`, which is dead code needing a Mac to
  rework;
- the historical comments in `app/rust-ffi/build-wasm.mjs`,
  `app/ydoc-shared/generate-ast.mjs`, `app/electron-client/src/guiConfig.ts` and
  `internal/dependenciesVersions.cjs`;
- `tools/enso4igv`'s folder-name filter.

- [ ] **Step 6: Format and commit**

```bash
corepack pnpm exec prettier --write CLAUDE.md README.md app/electron-client/macos/README.md
git add -A && git commit -m "Remove the Bazel pin, its staging script and the unused tools/ci scripts"
```

### Task 2: Correct the stale build docs, and land PR 0

**Files:**

- Modify: `docs/CONTRIBUTING.md:247-279`, `build_tools/CLAUDE.md:27-29`,
  `tools/CLAUDE.md:11`, `tools/ci/README.md` (whole file)

**Interfaces:** none.

- [ ] **Step 1: Find the stale statements (the failing check)**

```bash
cd /c/Repos/Enso/ide-bs-p0
git grep -n -E "nightly rust toolchain|package-lock.json|rustup toolchain install stable|previous three steps" -- docs/CONTRIBUTING.md
git grep -n "install/" -- build_tools/CLAUDE.md; ls build_tools/install 2>&1
git grep -n -E "check-changelog|docker|releases/" -- tools/CLAUDE.md tools/ci/README.md
```

Expected:

- CONTRIBUTING lines 249, 255, 258 and 275 are listed;
- `build_tools/CLAUDE.md:27` is listed, and `build_tools/install` does not
  exist;
- `tools/CLAUDE.md:11` and the Docker sections of `tools/ci/README.md` are
  listed. `tools/ci/docker` was deleted upstream in #14245.

- [ ] **Step 2: Rewrite the Rust and Documentation set-up sections of
      `docs/CONTRIBUTING.md`**

Replace everything from `### Getting Set Up (Rust)` up to (not including)
`You can format all of our documentation and configuration as follows:` with:

````markdown
### Getting Set Up (Rust)

The Rust code in this repository (the parser, and the `./run` build CLI) builds
with the stable toolchain pinned in
[`rust-toolchain.toml`](../rust-toolchain.toml), with its `clippy` and `rustfmt`
components and the `wasm32-unknown-unknown` target. Installing
[Rustup](https://rustup.rs) is all you need: it installs that toolchain the
first time `cargo` runs in the repository.

With the tools listed above in place, `./run ide build` builds the IDE.

### Getting Set Up (Documentation)

We enforce automated formatting of all of our documentation and configuration
using the fairly common [prettier](https://prettier.io) automatic formatter. You
can install prettier for our project by running the following command:

```bash
enso$ corepack pnpm install
```

This needs Node and corepack, set up as described under
[System Requirements](#system-requirements).

The version of prettier is pinned by our [`pnpm-lock.yaml`](../pnpm-lock.yaml),
so that formatting changes arrive all at once.
````

- [ ] **Step 3: Fix `build_tools/CLAUDE.md`**

Delete the bullet:

```
- `install/` — Windows installer/uninstaller toolchain. Four crates: `install`
  (shared library), `install/config`, `install/installer`,
  `install/uninstaller`.
```

- [ ] **Step 4: Fix `tools/CLAUDE.md` and `tools/ci/README.md`**

In `tools/CLAUDE.md` replace the `ci/` bullet with:

```
- `ci/` — CI helper scripts: `windows-installer-smoke.ps1` (installs, starts and uninstalls the Windows installer in IDE packaging, #251).
```

If `tools/ci/wait-for-macos-runner.sh` exists (#288 merged), end the bullet
instead with
``… #251), `wait-for-macos-runner.sh` (gates jobs on the self-hosted Mac).``

Replace the whole of `tools/ci/README.md` with:

```markdown
# CI Tools

Scripts that the GitHub workflows run:

- `windows-installer-smoke.ps1` — installs the Windows installer silently,
  checks it is registered and starts, then uninstalls it (IDE packaging, #251).
  It refuses to run where an Enso is already installed.
```

(Again add `wait-for-macos-runner.sh` as a second bullet if it exists.)

- [ ] **Step 5: Re-run the check, format, commit**

Re-run the commands of Step 1. Expected: no output, except `ls` reporting that
`build_tools/install` does not exist.

```bash
corepack pnpm exec prettier --write docs/CONTRIBUTING.md build_tools/CLAUDE.md tools/CLAUDE.md tools/ci/README.md
corepack pnpm exec prettier --check docs/CONTRIBUTING.md build_tools/CLAUDE.md CLAUDE.md README.md app/electron-client/macos/README.md
git add -A && git commit -m "Correct the Rust, prettier and tools/ci set-up docs"
```

`tools/` is prettier-ignored, so the `--write` on its files is a no-op. The
`--check` must pass.

- [ ] **Step 6: Open PR 0**

```bash
git push -u origin chore/build-tidy-up
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, Phase 0: remove the Bazel and dead-CI remnants" \
  --body-file "$SCRATCH/pr0.md"
```

`$SCRATCH/pr0.md` contains:

- what was deleted and why (unreferenced: the Step 2 grep of Task 1);
- the CLAUDE.md correction (no `BazelSupport` hooks remain);
- the doc fixes;
- a "Not changed" list: the remaining Bazel mentions of Task 1, Step 5;
- the attribution lines.

If #288 is still open: its `tools/CLAUDE.md` hunk now conflicts with this PR's.
Comment on #288 with the resolved line: this PR's bullet with the
`wait-for-macos-runner.sh` clause.

- [ ] **Step 7: Wait for CI, then merge**

Run `$SCRATCH/wait-pr.sh <N> 180` in the background. The changes touch `app/**`
(the deleted script), so the GUI checks and IDE packaging run.

- Exit 0: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

---

## Phase 1: hand-written workflows

### Task 3: The comparison script (PR 1a)

**Files:**

- Modify: `package.json` (root `devDependencies`), `pnpm-lock.yaml`
- Create: `tools/ci/compare-workflows.mjs`,
  `tools/ci/compare-workflows.test.mjs`

**Interfaces:**

- Produces the CLI
  `node tools/ci/compare-workflows.mjs --base <git-ref> [--head <git-ref> | --head-dir <dir>] [--rename "<base job>=<head job>"]... <workflow file>...`.
  It prints a Markdown report, one `##` section per entry workflow: a
  `### Workflow` diff of name/on/concurrency/permissions/env, a `### <job>` diff
  per changed job, `(only in base)`/`(only in head)` jobs, and
  `### Unchanged jobs`. Its exit code is always 0; reading the report is the
  check.
- Exports, for the tests:
  - `gitReader(ref, cwd?)` and `dirReader(dir)` → `(file) => string | null`;
  - `substitute(value, context)`;
  - `evaluateCondition(condition, context, runnerOs?)` →
    `{ keep: false } | { keep: true, rest?: string }`;
  - `matrixLegs(strategy, context)` → `object[] | [null]`;
  - `runnerOsOf(runsOn)`;
  - `expandWorkflow(read, file, inputs?, collected?)`;
  - `describeWorkflow(read, file)` →
    `{ header: string[], jobs: Map<string, string[]> }`;
  - `diffLines(a, b)`;
  - `compareWorkflow(baseRead, headRead, file, renames?)`.
- Used by Tasks 7–11 to write each PR's "Intended differences".

- [ ] **Step 1: Create the worktree and add `yaml`**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1a -b ci/workflow-foundations origin/develop
cd /c/Repos/Enso/ide-bs-1a && corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm add -D -E -w --ignore-scripts yaml@2.9.1
git diff --stat package.json pnpm-lock.yaml
```

Expected:

- `package.json` gains `"yaml": "2.9.1"` in `devDependencies`. Keep it exact:
  the version is already in the lockfile, so the release-age policy is met and
  nothing new is downloaded.
- `pnpm-lock.yaml` changes only in the root importer (a few lines). If the
  lockfile diff touches anything else, revert both files with
  `git checkout package.json pnpm-lock.yaml` and stop: the tree needs the
  CLAUDE.md "broken install" treatment first.

- [ ] **Step 2: Write the failing tests**

Create `tools/ci/compare-workflows.test.mjs`:

<!-- prettier-ignore -->
```js
// Run with `node --test tools/ci/compare-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  compareWorkflow,
  describeWorkflow,
  diffLines,
  evaluateCondition,
  matrixLegs,
} from './compare-workflows.mjs'

/** A reader over in-memory files. */
const memory = (files) => (file) => files[file] ?? null

describe('matrixLegs', () => {
  test('a job without a matrix has one leg', () => {
    assert.deepEqual(matrixLegs(undefined, {}), [null])
  })
  test('include-only matrices list their entries', () => {
    const legs = matrixLegs({ matrix: { include: [{ os: 'linux' }, { os: 'windows' }] } }, {})
    assert.deepEqual(legs, [{ os: 'linux' }, { os: 'windows' }])
  })
  test('axes multiply, include extends matching legs, exclude removes', () => {
    const legs = matrixLegs(
      {
        matrix: {
          os: ['linux', 'windows'],
          suite: ['a', 'b'],
          include: [{ os: 'linux', runner: 'ubuntu-latest' }],
          exclude: [{ os: 'windows', suite: 'b' }],
        },
      },
      {},
    )
    assert.deepEqual(legs, [
      { os: 'linux', suite: 'a', runner: 'ubuntu-latest' },
      { os: 'linux', suite: 'b', runner: 'ubuntu-latest' },
      { os: 'windows', suite: 'a' },
    ])
  })
  test('include may come from an input through fromJSON', () => {
    const legs = matrixLegs(
      { matrix: { include: '${{ fromJSON(inputs.suites) }}' } },
      { inputs: { suites: '[{"suite": "jvm"}]' } },
    )
    assert.deepEqual(legs, [{ suite: 'jvm' }])
  })
})

describe('evaluateCondition', () => {
  test('decides the platform, matrix values and inputs', () => {
    assert.deepEqual(evaluateCondition("runner.os == 'Windows'", {}, 'Linux'), { keep: false })
    assert.deepEqual(
      evaluateCondition("matrix.os == 'linux'", { matrix: { os: 'linux' } }, 'Linux'),
      {
        keep: true,
        rest: undefined,
      },
    )
    assert.deepEqual(evaluateCondition("inputs.os == 'linux'", { inputs: { os: 'windows' } }), {
      keep: false,
    })
  })
  test('keeps what it cannot decide, and never splits a disjunction', () => {
    assert.deepEqual(evaluateCondition("always() && runner.os != 'Windows'", {}, 'Linux'), {
      keep: true,
      rest: 'always()',
    })
    assert.deepEqual(evaluateCondition('${{ (always()) && (a || b) }}', {}, 'Linux'), {
      keep: true,
      rest: 'always() && (a || b)',
    })
    assert.deepEqual(evaluateCondition("runner.os == 'Windows' || x", {}, 'Linux'), {
      keep: true,
      rest: "('Linux' == 'Windows' || x)",
    })
  })
})

describe('describeWorkflow', () => {
  const files = {
    '.github/workflows/entry.yml': `
name: Entry
on: workflow_dispatch
jobs:
  platform:
    strategy:
      matrix:
        include:
          - { os: linux, runner: ubuntu-latest }
          - { os: windows, runner: windows-latest }
    uses: ./.github/workflows/called.yml
    with:
      os: \${{ matrix.os }}
      runner: \${{ matrix.runner }}
`,
    '.github/workflows/called.yml': `
on:
  workflow_call:
    inputs:
      os: { type: string, required: true }
      runner: { type: string, required: true }
jobs:
  build:
    name: Build (\${{ inputs.os }})
    runs-on: \${{ inputs.runner }}
    steps:
      - uses: ./.github/actions/greet
        with:
          who: \${{ inputs.os }}
  lint:
    name: Lint
    if: inputs.os == 'linux'
    needs: [build]
    runs-on: \${{ inputs.runner }}
    strategy:
      matrix:
        part: [a, b]
    steps:
      - run: lint \${{ matrix.part }}
`,
    '.github/actions/greet/action.yml': `
inputs:
  who: { required: true }
runs:
  using: composite
  steps:
    - if: runner.os == 'Windows'
      shell: pwsh
      run: echo windows \${{ inputs.who }}
    - if: runner.os != 'Windows'
      shell: bash
      run: echo \${{ inputs.who }}
      env:
        GITHUB_TOKEN: \${{ github.token }}
`,
  }

  test('flattens reusable calls, expands matrices, inlines composite actions', () => {
    const { jobs } = describeWorkflow(memory(files), '.github/workflows/entry.yml')
    assert.deepEqual([...jobs.keys()], ['Build (linux)', 'Lint (a)', 'Lint (b)', 'Build (windows)'])
    assert.deepEqual(jobs.get('Build (linux)'), [
      'runs-on: ubuntu-latest',
      'step: run[bash]: echo linux | env: GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}',
      'secrets: GITHUB_TOKEN',
    ])
    assert.deepEqual(jobs.get('Build (windows)'), [
      'runs-on: windows-latest',
      'step: run[pwsh]: echo windows windows',
    ])
    assert.deepEqual(jobs.get('Lint (b)'), [
      'runs-on: ubuntu-latest',
      'needs: Build (linux)',
      'step: run[bash]: lint b',
    ])
  })

  test('identical versions report no differences', () => {
    const read = memory(files)
    const report = compareWorkflow(read, read, '.github/workflows/entry.yml')
    assert.ok(!report.includes('```diff'), report)
    assert.match(report, /### Unchanged jobs/)
  })
})

test('diffLines keeps common lines and marks the rest', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'c', 'd']), ['- b', '+ d'])
  assert.deepEqual(diffLines(['a'], ['a']), [])
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `node --test tools/ci/compare-workflows.test.mjs`

Expected: FAIL, with `Cannot find module …/compare-workflows.mjs`.

- [ ] **Step 4: Write the script**

Create `tools/ci/compare-workflows.mjs`:

<!-- prettier-ignore -->
````js
#!/usr/bin/env node
// Compares two versions of the workflows job by job, and prints the differences as Markdown.
//
//     node tools/ci/compare-workflows.mjs --base <git-ref> [--head <git-ref> | --head-dir <dir>]
//          [--rename "<base job>=<head job>"]... <workflow file>...
//
// For each job it lists the name, `runs-on`, `needs`, `if`, env, permissions,
// `continue-on-error`, `timeout-minutes`, and every step: the command it runs (with its shell) or
// the action it uses (with its inputs), its condition and its env. Secrets, variables and the
// artifacts uploaded and downloaded are listed per job. It expands `strategy.matrix`, calls to
// local reusable workflows (`uses: ./.github/workflows/…`, flattened: the called jobs keep their
// own names) and local composite actions (`uses: ./.github/actions/…`, inlined), and drops the
// steps and jobs whose condition is decided by the platform, a matrix value or an input. So a
// hand-written workflow compares job for job with the generated one it replaces.
//
// Without `--head` or `--head-dir` the head is the working tree. Jobs are matched by name; two
// base jobs with the same name are told apart by `[runs-on]`, and `--rename` pairs a base job
// with a differently named head job (it applies to `needs` too).
//
// Temporary: it reviews the build simplification's Phase 1 pull requests, and is deleted with the
// CI generator at the end of that phase.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

// === Reading ===

/** Reads repository files as of a git ref; `null` when absent. */
export function gitReader(ref, cwd = process.cwd()) {
  return (file) => {
    try {
      return execFileSync('git', ['show', `${ref}:${file}`], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      })
    } catch {
      return null
    }
  }
}

/** Reads repository files from a directory; `null` when absent. */
export function dirReader(dir) {
  return (file) => {
    const target = path.join(dir, file)
    return existsSync(target) ? readFileSync(target, 'utf8') : null
  }
}

// === Expressions ===

const EXPRESSION = /\$\{\{\s*([\s\S]*?)\s*\}\}/g
const REFERENCE = /\b(matrix|inputs)\.([A-Za-z0-9_-]+)/g

function lookup(context, reference) {
  const match = /^(matrix|inputs)\.([A-Za-z0-9_-]+)$/.exec(reference.trim())
  if (!match) return undefined
  const scope = context[match[1]]
  return scope && Object.hasOwn(scope, match[2]) ? scope[match[2]] : undefined
}

/** A value as an expression literal; a value that is itself an expression is inlined. */
function literal(value) {
  if (typeof value !== 'string') return JSON.stringify(value)
  const expression = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(value)
  return expression ? `(${expression[1]})` : `'${value.replace(/'/g, "''")}'`
}

/**
 * Replaces the known `matrix.*` and `inputs.*` references, and `runner.os` once the job's
 * platform is known, inside a bare expression.
 */
function substituteInExpression(expression, context) {
  const replaced = expression.replace(REFERENCE, (reference) => {
    const value = lookup(context, reference)
    return value === undefined ? reference : literal(value)
  })
  return context.runnerOs ? replaced.replace(/\brunner\.os\b/g, `'${context.runnerOs}'`) : replaced
}

/** Folds `'a' == 'b'` and `'a' == 'b' && 'x' || 'y'` once both sides are literals. */
function fold(expression) {
  const comparison = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(expression)
  if (comparison)
    return String(
      (comparison[1].toLowerCase() === comparison[3].toLowerCase()) === (comparison[2] === '=='),
    )
  const choice = /^'([^']*)'\s*(==|!=)\s*'([^']*)'\s*&&\s*'([^']*)'\s*\|\|\s*'([^']*)'$/.exec(
    expression,
  )
  if (choice) {
    const holds = (choice[1].toLowerCase() === choice[3].toLowerCase()) === (choice[2] === '==')
    return holds ? choice[4] : choice[5]
  }
  return undefined
}

/** Replaces the known `matrix.*` and `inputs.*` references in a YAML value, recursively. */
export function substitute(value, context) {
  if (typeof value === 'string') {
    const whole = /^\$\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(value)
    if (whole) {
      const found = lookup(context, whole[1])
      if (found !== undefined) return found
    }
    return value.replace(EXPRESSION, (all, inner) => {
      const found = lookup(context, inner)
      if (found !== undefined) return typeof found === 'string' ? found : JSON.stringify(found)
      const replaced = substituteInExpression(inner, context).trim()
      return fold(replaced) ?? `\${{ ${replaced} }}`
    })
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, context))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, context)]),
    )
  }
  return value
}

/** Splits at a top-level operator, outside quotes and parentheses. */
function splitTopLevel(expression, operator) {
  const parts = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "'") quoted = !quoted
    if (quoted) continue
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index))
      start = index + operator.length
      index += operator.length - 1
    }
  }
  parts.push(expression.slice(start))
  return parts.map((part) => part.trim())
}

/** Whether the first parenthesis closes at the very end. */
function wrapsWhole(expression) {
  let depth = 0
  let quoted = false
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "'") quoted = !quoted
    if (quoted) continue
    if (char === '(') depth++
    if (char === ')') {
      depth--
      if (depth === 0 && index < expression.length - 1) return false
    }
  }
  return depth === 0
}

function stripParentheses(expression) {
  let current = expression.trim()
  while (current.startsWith('(') && current.endsWith(')') && wrapsWhole(current)) {
    current = current.slice(1, -1).trim()
  }
  return current
}

/**
 * Decides what it can of a condition: comparisons of the runner's OS, matrix values and inputs.
 * Returns `{ keep: false }` when the condition is statically false, else `{ keep: true, rest }`
 * with the conjuncts it could not decide (`undefined` when none are left).
 */
export function evaluateCondition(condition, context, runnerOs) {
  if (condition === undefined || condition === null) return { keep: true, rest: undefined }
  if (condition === false) return { keep: false }
  if (condition === true) return { keep: true, rest: undefined }
  let expression = String(condition).trim()
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expression)
  if (wrapped) expression = wrapped[1].trim()
  expression = substituteInExpression(expression, context)
  if (runnerOs) expression = expression.replace(/\brunner\.os\b/g, `'${runnerOs}'`)
  expression = stripParentheses(expression)
  const conjuncts =
    splitTopLevel(expression, '||').length > 1 ? [expression] : splitTopLevel(expression, '&&')
  const rest = []
  for (const conjunct of conjuncts) {
    const part = stripParentheses(conjunct)
    const comparison = /^'([^']*)'\s*(==|!=)\s*'([^']*)'$/.exec(part)
    if (comparison) {
      const equal = comparison[1].toLowerCase() === comparison[3].toLowerCase()
      if ((comparison[2] === '==') !== equal) return { keep: false }
      continue
    }
    if (part === 'true') continue
    if (part === 'false') return { keep: false }
    rest.push(splitTopLevel(part, '||').length > 1 ? `(${part})` : part)
  }
  return { keep: true, rest: rest.length > 0 ? rest.join(' && ') : undefined }
}

function fromJson(value) {
  if (typeof value !== 'string') return value
  const match = /^\$\{\{\s*fromJSON\(\s*'([\s\S]*)'\s*\)\s*\}\}$/.exec(value.trim())
  return match ? JSON.parse(match[1].replace(/''/g, "'")) : value
}

// === Expansion ===

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The legs of a job's matrix, as objects; `[null]` for a job without a matrix. */
export function matrixLegs(strategy, context) {
  if (strategy?.matrix === undefined) return [null]
  const matrix = fromJson(substitute(strategy.matrix, context))
  const { include, exclude, ...axes } = matrix
  let legs = [{}]
  for (const [key, values] of Object.entries(axes)) {
    const list = [fromJson(values)].flat()
    legs = legs.flatMap((leg) => list.map((value) => ({ ...leg, [key]: value })))
  }
  if (Object.keys(axes).length === 0) legs = []
  for (const excluded of [fromJson(exclude) ?? []].flat()) {
    legs = legs.filter(
      (leg) => !Object.entries(excluded).every(([key, value]) => sameValue(leg[key], value)),
    )
  }
  const axisKeys = Object.keys(axes)
  for (const included of [fromJson(include) ?? []].flat()) {
    const keys = axisKeys.filter((key) => key in included)
    const matching =
      keys.length > 0 ?
        legs.filter((leg) => keys.every((key) => sameValue(leg[key], included[key])))
      : []
    if (matching.length === 0) legs.push({ ...included })
    else for (const leg of matching) Object.assign(leg, included)
  }
  return legs
}

export function runnerOsOf(runsOn) {
  const labels = [runsOn ?? []].flat().map(String).join(' ').toLowerCase()
  if (labels.includes('windows')) return 'Windows'
  if (labels.includes('macos')) return 'macOS'
  if (labels.includes('ubuntu') || labels.includes('linux')) return 'Linux'
  return undefined
}

const normalizeToken = (value) =>
  typeof value === 'string' ? value.replace(/\bgithub\.token\b/g, 'secrets.GITHUB_TOKEN') : value

function render(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const oneLine = (text) => normalizeToken(String(text)).replace(/\s+/g, ' ').trim()

/** The steps of a job, with local composite actions inlined. */
function expandSteps(steps, context, runnerOs, read, outerCondition) {
  const result = []
  for (const step of steps ?? []) {
    const condition = evaluateCondition(step.if, context, runnerOs)
    if (!condition.keep) continue
    const combined = [outerCondition, condition.rest].filter(Boolean).join(' && ') || undefined
    const { if: _ignored, ...body } = step
    const resolved = substitute(body, { ...context, runnerOs })
    const uses = resolved.uses === undefined ? undefined : String(resolved.uses)
    if (uses?.startsWith('./.github/actions/')) {
      const text = read(`${uses.slice(2).replace(/\/$/, '')}/action.yml`)
      if (text === null) throw new Error(`Missing composite action ${uses}`)
      const action = parse(text)
      const inputs = Object.fromEntries(
        Object.entries(action.inputs ?? {}).map(([name, spec]) => [name, spec?.default]),
      )
      Object.assign(inputs, resolved.with ?? {})
      result.push(
        ...expandSteps(action.runs?.steps, { ...context, inputs }, runnerOs, read, combined),
      )
      continue
    }
    const shell = resolved.shell ?? (runnerOs === 'Windows' ? 'pwsh' : 'bash')
    result.push({
      uses,
      run: resolved.run,
      shell,
      with: resolved.with,
      env: resolved.env,
      if: combined,
    })
  }
  return result
}

function stepLine(step) {
  const parts = []
  if (step.run !== undefined) parts.push(`run[${step.shell}]: ${oneLine(step.run)}`)
  if (step.uses !== undefined) parts.push(`uses: ${step.uses}`)
  if (step.with) {
    const inputs = Object.entries(step.with)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${oneLine(render(value))}`)
    parts.push(`with: ${inputs.join('; ')}`)
  }
  if (step.if) parts.push(`if: ${oneLine(step.if)}`)
  if (step.env) {
    const env = Object.entries(step.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${oneLine(render(value))}`)
    parts.push(`env: ${env.join('; ')}`)
  }
  return `step: ${parts.join(' | ')}`
}

function jobLines(job) {
  const lines = []
  lines.push(`runs-on: ${[job.runsOn ?? []].flat().map(render).join(', ')}`)
  for (const need of [...job.needs].sort()) lines.push(`needs: ${need}`)
  if (job.if) lines.push(`if: ${oneLine(job.if)}`)
  for (const [key, value] of Object.entries(job.env).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`env: ${key}=${oneLine(render(value))}`)
  }
  if (job.permissions !== undefined) lines.push(`permissions: ${render(job.permissions)}`)
  if (job.continueOnError !== undefined)
    lines.push(`continue-on-error: ${render(job.continueOnError)}`)
  if (job.timeout !== undefined) lines.push(`timeout-minutes: ${render(job.timeout)}`)
  for (const step of job.steps) lines.push(stepLine(step))
  const text = normalizeToken(JSON.stringify({ ...job, needs: [] }))
  const names = (pattern) =>
    [...new Set([...text.matchAll(pattern)].map((match) => match[1]))].sort()
  const secrets = names(/secrets\.([A-Za-z0-9_]+)/g)
  const vars = names(/vars\.([A-Za-z0-9_]+)/g)
  if (secrets.length > 0) lines.push(`secrets: ${secrets.join(', ')}`)
  if (vars.length > 0) lines.push(`vars: ${vars.join(', ')}`)
  const artifacts = (action) =>
    job.steps
      .filter((step) => step.uses?.startsWith(`actions/${action}-artifact@`))
      .map((step) => render(step.with?.name ?? step.with?.pattern ?? '(all)'))
  const uploads = artifacts('upload')
  const downloads = artifacts('download')
  if (uploads.length > 0) lines.push(`uploads: ${uploads.join(', ')}`)
  if (downloads.length > 0) lines.push(`downloads: ${downloads.join(', ')}`)
  return lines
}

/**
 * Expands a workflow into its jobs: `{ header: string[], jobs: Map<name, string[]> }`. `inputs`
 * are the values a caller passes (the called workflow's defaults fill the rest).
 */
export function expandWorkflow(read, file, inputs = {}, collected = []) {
  const text = read(file)
  if (text === null) throw new Error(`Missing workflow ${file}`)
  const doc = parse(text)
  const declared = doc.on?.workflow_call?.inputs ?? {}
  const workflowInputs = {
    ...Object.fromEntries(Object.entries(declared).map(([name, spec]) => [name, spec?.default])),
    ...inputs,
  }
  const baseContext = { inputs: workflowInputs }
  const workflowEnv = substitute(doc.env ?? {}, baseContext)
  const entriesById = new Map()
  const pending = []
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    entriesById.set(id, [])
    for (const leg of matrixLegs(job.strategy, baseContext)) {
      const context = { inputs: workflowInputs, matrix: leg ?? {} }
      const condition = evaluateCondition(job.if, context, undefined)
      if (!condition.keep) continue
      if (typeof job.uses === 'string' && job.uses.startsWith('./.github/workflows/')) {
        const before = collected.length
        expandWorkflow(read, job.uses.slice(2), substitute(job.with ?? {}, context), collected)
        entriesById.get(id).push(...collected.slice(before))
        continue
      }
      const rawName = job.name ?? id
      let name = String(substitute(rawName, context))
      if (leg && Object.keys(leg).length > 0 && !/matrix\./.test(String(rawName))) {
        name += ` (${Object.values(leg).map(render).join(', ')})`
      }
      const runsOn = substitute(job['runs-on'], context)
      const runnerOs = runnerOsOf(runsOn)
      const entry = {
        name,
        runsOn,
        needIds: [job.needs ?? []].flat(),
        needs: [],
        if:
          condition.rest === undefined ?
            undefined
          : evaluateCondition(condition.rest, context, runnerOs).rest,
        env: { ...workflowEnv, ...substitute(job.env ?? {}, context) },
        permissions: job.permissions,
        continueOnError: substitute(job['continue-on-error'], context),
        timeout: job['timeout-minutes'],
        steps: expandSteps(job.steps, context, runnerOs, read, undefined),
      }
      entriesById.get(id).push(entry)
      pending.push(entry)
      collected.push(entry)
    }
  }
  for (const entry of pending) {
    entry.needs = entry.needIds.flatMap((id) => entriesById.get(id) ?? [{ name: `?${id}` }])
  }
  return { doc, jobs: collected }
}

/** Header lines and job lines for one entry workflow. */
export function describeWorkflow(read, file) {
  const { doc, jobs } = expandWorkflow(read, file)
  const header = [
    `name: ${render(doc.name)}`,
    `on: ${render(doc.on)}`,
    `concurrency: ${render(doc.concurrency)}`,
    `permissions: ${render(doc.permissions)}`,
    `env: ${render(doc.env)}`,
  ]
  const counts = new Map()
  for (const job of jobs) counts.set(job.name, (counts.get(job.name) ?? 0) + 1)
  const keyOf = (job) =>
    counts.get(job.name) > 1 ? `${job.name} [${[job.runsOn].flat().join(', ')}]` : job.name
  const byName = new Map()
  for (const job of jobs) {
    const needs = job.needs.map((need) => (counts.has(need.name) ? keyOf(need) : need.name))
    byName.set(keyOf(job), jobLines({ ...job, needs }))
  }
  return { header, jobs: byName }
}

// === Diff ===

/** A line diff (longest common subsequence); `[]` when equal. */
export function diffLines(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i][j] =
        before[i] === after[j] ?
          table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) out.push(`- ${before[i++]}`)
    else out.push(`+ ${after[j++]}`)
  }
  while (i < before.length) out.push(`- ${before[i++]}`)
  while (j < after.length) out.push(`+ ${after[j++]}`)
  return out
}

/** The Markdown report for one entry workflow. */
export function compareWorkflow(baseRead, headRead, file, renames = new Map()) {
  const rename = (name) => renames.get(name) ?? name
  const describe = (read) => {
    try {
      return describeWorkflow(read, file)
    } catch (error) {
      if (/^Missing workflow/.test(error.message)) return { header: [], jobs: new Map() }
      throw error
    }
  }
  const base = describe(baseRead)
  const head = describe(headRead)
  const baseJobs = new Map(
    [...base.jobs].map(([name, lines]) => [
      rename(name),
      lines.map((line) => (line.startsWith('needs: ') ? `needs: ${rename(line.slice(7))}` : line)),
    ]),
  )
  const out = [`## \`${file}\``, '']
  const headerDiff = diffLines(base.header, head.header)
  if (headerDiff.length > 0) out.push('### Workflow', '', '```diff', ...headerDiff, '```', '')
  const same = []
  for (const name of [...new Set([...baseJobs.keys(), ...head.jobs.keys()])]) {
    const before = baseJobs.get(name)
    const after = head.jobs.get(name)
    if (before && after) {
      const diff = diffLines(before, after)
      if (diff.length === 0) same.push(name)
      else out.push(`### ${name}`, '', '```diff', ...diff, '```', '')
    } else if (before) {
      out.push(
        `### ${name} (only in base)`,
        '',
        '```diff',
        ...before.map((line) => `- ${line}`),
        '```',
        '',
      )
    } else {
      out.push(
        `### ${name} (only in head)`,
        '',
        '```diff',
        ...after.map((line) => `+ ${line}`),
        '```',
        '',
      )
    }
  }
  if (same.length > 0) out.push('### Unchanged jobs', '', ...same.map((name) => `- ${name}`), '')
  return out.join('\n')
}

function main(argv) {
  let base
  let headRead
  const renames = new Map()
  const files = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--base') base = argv[++index]
    else if (arg === '--head') headRead = gitReader(argv[++index])
    else if (arg === '--head-dir') headRead = dirReader(path.resolve(argv[++index]))
    else if (arg === '--rename') {
      const [from, to] = argv[++index].split('=')
      renames.set(from, to)
    } else files.push(arg)
  }
  if (!base || files.length === 0) {
    console.error(
      'Usage: compare-workflows.mjs --base <ref> [--head <ref> | --head-dir <dir>] [--rename "a=b"]... <workflow>...',
    )
    process.exit(2)
  }
  const baseRead = gitReader(base)
  headRead ??= dirReader(process.cwd())
  const reports = files.map((file) =>
    compareWorkflow(
      baseRead,
      headRead,
      path.posix.join('.github/workflows', path.basename(file)),
      renames,
    ),
  )
  console.log(`# Workflow comparison: \`${base}\` → head\n\n${reports.join('\n')}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))
````

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test tools/ci/compare-workflows.test.mjs`

Expected: `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 6: Check it against the repository itself**

```bash
node tools/ci/compare-workflows.mjs --base HEAD engine-checks.yml ide-packaging.yml changelog.yml std-libs-labels.yml engine-benchmark.yml engine-pull-request.yml ide-pull-request.yml
```

Expected: every section lists its jobs under `### Unchanged jobs` and has no
`diff` block (HEAD against an unmodified working tree).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tools/ci/compare-workflows.mjs tools/ci/compare-workflows.test.mjs
git commit -m "Add a job-by-job workflow comparison script for the Phase 1 rewrites"
```

### Task 4: The workflow policy check (PR 1a)

**Files:**

- Create: `tools/ci/check-workflows.mjs`, `tools/ci/check-workflows.test.mjs`

**Interfaces:**

- Consumes: the `yaml` dev dependency (Task 3).
- Produces the CLI `node tools/ci/check-workflows.mjs [repo-root]`: one line per
  violation; exit 1 if any, else `Workflow policy: OK` and exit 0.
- Exports:
  - `SPEC_PATHS`, `loadRepo(root)` → `{ workflows, actions }`, `CHECKS`, and
    `checkRepo(root)` → `string[]`;
  - one function per rule, each taking `{ workflows, actions }` and returning
    `string[]`: `checkPullRequestsIgnoreSpecs`, `checkSetupNodeCache`,
    `checkReleaseIsIdeOnly`, `checkOnlyMacosReleaseJobsMayFail`,
    `checkMacosJobsAreGated`, `checkMacosChecksRunWhatIsRequested`,
    `checkIdePackagingNeedsNoCloudAccount` and `checkWindowsInstallerSmokeTest`.
- Used by Task 6 (`workflow-lint.yml` runs it) and by Task 12, which proves that
  every generator test is ported.

Which Rust test each rule ports:

| Rust test (`build_tools/build/src/ci_gen.rs`, `ci_gen/job.rs`) | Rule                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pull_request_workflows_ignore_spec_and_plan_changes`          | `checkPullRequestsIgnoreSpecs` (now every `pull_request` workflow, not only the two generated) |
| `setup_node_steps_disable_package_manager_cache`               | `checkSetupNodeCache` (every `setup-node` before `pnpm/action-setup`, composite actions too)   |
| `release_is_ide_only_and_needs_no_cloud_secrets`               | `checkReleaseIsIdeOnly` (plus an allow-list of the secrets `release.yml` may read)             |
| `only_macos_release_jobs_may_fail_without_blocking_publishing` | `checkOnlyMacosReleaseJobsMayFail`                                                             |
| `ide_jobs_need_no_cloud_account` (`job.rs`)                    | `checkIdePackagingNeedsNoCloudAccount`                                                         |
| `windows_packaging_smoke_tests_the_installer` (`job.rs`)       | `checkWindowsInstallerSmokeTest`                                                               |
| #288: `release_skips_macos_jobs_without_holding_up_publishing` | `checkMacosJobsAreGated` (applies once `check-the-mac-os-runner` exists)                       |
| #288: `nightly_skips_macos_jobs_when_runner_offline`           | `checkMacosJobsAreGated`                                                                       |
| #288: `macos_checks_run_only_what_is_requested`                | `checkMacosChecksRunWhatIsRequested` (applies once `macos-checks.yml` exists)                  |

- [ ] **Step 1: Write the failing tests**

Create `tools/ci/check-workflows.test.mjs`:

<!-- prettier-ignore -->
```js
// Run with `node --test tools/ci/check-workflows.test.mjs`.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkIdePackagingNeedsNoCloudAccount,
  checkMacosJobsAreGated,
  checkOnlyMacosReleaseJobsMayFail,
  checkPullRequestsIgnoreSpecs,
  checkReleaseIsIdeOnly,
  checkRepo,
  checkSetupNodeCache,
  checkWindowsInstallerSmokeTest,
  loadRepo,
} from './check-workflows.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const scratch = mkdtempSync(path.join(tmpdir(), 'check-workflows-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

let fixtureCount = 0
/** A repository holding only the given `.github` files (paths relative to `.github`). */
function fixture(files) {
  const root = path.join(scratch, `repo-${fixtureCount++}`)
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(root, '.github', file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  return loadRepo(root)
}

const RELEASE_OK = `
name: Release
on: workflow_dispatch
env:
  ENSO_BUILD_UPDATE_INFO: "true"
jobs:
  draft:
    runs-on: ubuntu-latest
    steps:
      - run: ./run release create-draft && ./run release publish
      - run: ./run release update-latest-version && ./run ide upload
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
  enso-build-ci-gen-upload-ide-macos-aarch64:
    runs-on: [macos-latest]
    continue-on-error: true
    steps: []
`

describe('checkPullRequestsIgnoreSpecs', () => {
  test('accepts paths-ignore with the spec paths, and a paths whitelist', () => {
    const repo = fixture({
      'workflows/a.yml':
        'on:\n  pull_request:\n    paths-ignore: ["docs/superpowers/**"]\njobs: {}\n',
      'workflows/b.yml': 'on:\n  pull_request:\n    paths: ["engine/**"]\njobs: {}\n',
      'workflows/c.yml': 'on: workflow_call\njobs: {}\n',
    })
    assert.deepEqual(checkPullRequestsIgnoreSpecs(repo), [])
  })
  test('rejects a pull_request trigger without the spec paths', () => {
    const repo = fixture({ 'workflows/a.yml': 'on: [push, pull_request]\njobs: {}\n' })
    assert.equal(checkPullRequestsIgnoreSpecs(repo).length, 1)
  })
})

describe('checkSetupNodeCache', () => {
  test('requires package-manager-cache: false before pnpm/action-setup, in workflows and actions', () => {
    const repo = fixture({
      'workflows/a.yml': `
on: push
jobs:
  ok:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with: { cache: pnpm }
  bad:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v5
`,
      'actions/setup-node/action.yml': `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v5
      with: { package-manager-cache: false }
`,
    })
    const problems = checkSetupNodeCache(repo)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /a\.yml › bad/)
  })
})

describe('checkReleaseIsIdeOnly', () => {
  test('accepts an IDE-only release', () => {
    assert.deepEqual(checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': RELEASE_OK })), [])
  })
  test('rejects cloud steps and cloud secrets', () => {
    const text = RELEASE_OK.replace(
      './run ide upload',
      './run ide upload --backend-source release',
    ).replace('secrets.GITHUB_TOKEN', 'secrets.CI_PRIVATE_TOKEN')
    const problems = checkReleaseIsIdeOnly(fixture({ 'workflows/release.yml': text }))
    assert.ok(problems.some((p) => p.includes('--backend-source release')))
    assert.ok(problems.some((p) => p.includes('reads secret `CI_PRIVATE_TOKEN`')))
  })
})

describe('checkOnlyMacosReleaseJobsMayFail', () => {
  test('accepts a tolerant macOS upload', () => {
    assert.deepEqual(
      checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': RELEASE_OK })),
      [],
    )
  })
  test('rejects a tolerant Linux job and a blocking macOS upload', () => {
    const text = RELEASE_OK.replace('continue-on-error: true', 'continue-on-error: false').replace(
      '  draft:\n    runs-on: ubuntu-latest',
      '  draft:\n    runs-on: ubuntu-latest\n    continue-on-error: true',
    )
    assert.equal(
      checkOnlyMacosReleaseJobsMayFail(fixture({ 'workflows/release.yml': text })).length,
      2,
    )
  })
})

describe('checkMacosJobsAreGated', () => {
  test('applies only once the gate job exists', () => {
    assert.deepEqual(checkMacosJobsAreGated(fixture({ 'workflows/release.yml': RELEASE_OK })), [])
  })
  test('rejects an ungated macOS job', () => {
    const repo = fixture({
      'workflows/engine-checks-nightly.yml': `
on: workflow_dispatch
jobs:
  check-the-mac-os-runner: { runs-on: ubuntu-latest, steps: [] }
  tests-macos: { runs-on: [self-hosted, macOS], steps: [] }
`,
    })
    assert.equal(checkMacosJobsAreGated(repo).length, 1)
  })
})

describe('IDE packaging', () => {
  const packaging = (smoke) => `
on: workflow_call
jobs:
  package-ide:
    runs-on: \${{ matrix.runner }}
    steps:
      - name: Upload ide
        uses: actions/upload-artifact@v5
      ${smoke}
`
  test('accepts a Windows-only smoke test after the upload', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': packaging(
        "- if: matrix.os == 'windows'\n        run: ./tools/ci/windows-installer-smoke.ps1",
      ),
    })
    assert.deepEqual(checkWindowsInstallerSmokeTest(repo), [])
    assert.deepEqual(checkIdePackagingNeedsNoCloudAccount(repo), [])
  })
  test('rejects a smoke test on every platform, and a cloud account', () => {
    const repo = fixture({
      'workflows/ide-packaging.yml': packaging(
        '- run: ./tools/ci/windows-installer-smoke.ps1\n        env: { ENSO_TEST_USER: x }',
      ),
    })
    assert.equal(checkWindowsInstallerSmokeTest(repo).length, 1)
    assert.equal(checkIdePackagingNeedsNoCloudAccount(repo).length, 1)
  })
})

test('the repository follows the policy', () => {
  assert.deepEqual(checkRepo(repoRoot), [])
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tools/ci/check-workflows.test.mjs`

Expected: FAIL, with `Cannot find module …/check-workflows.mjs`.

- [ ] **Step 3: Write the check**

Create `tools/ci/check-workflows.mjs`:

<!-- prettier-ignore -->
```js
#!/usr/bin/env node
// Workflow policy: the rules that the CI generator's unit tests enforced
// (`build_tools/build/src/ci_gen.rs` and `ci_gen/job.rs`, removed in Phase 1 of the build
// simplification), checked against the hand-written workflows and composite actions instead.
// `.github/workflows/workflow-lint.yml` runs it after actionlint:
//
//     node tools/ci/check-workflows.mjs [repo-root]
//
// It prints one line per violation and exits 1 if there is any.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

/** Specs and plans: a pull request that changes only these starts no workflow. */
export const SPEC_PATHS = 'docs/superpowers/**'

/** Loads every workflow and every local composite action under `root/.github`. */
export function loadRepo(root) {
  const read = (file) => {
    const text = readFileSync(file, 'utf8')
    return { text, doc: parse(text) }
  }
  const workflows = {}
  const workflowsDir = path.join(root, '.github', 'workflows')
  for (const file of readdirSync(workflowsDir).sort()) {
    if (/\.ya?ml$/.test(file)) workflows[file] = read(path.join(workflowsDir, file))
  }
  const actions = {}
  const actionsDir = path.join(root, '.github', 'actions')
  if (existsSync(actionsDir)) {
    for (const name of readdirSync(actionsDir).sort()) {
      const file = path.join(actionsDir, name, 'action.yml')
      if (existsSync(file)) actions[name] = read(file)
    }
  }
  return { workflows, actions }
}

function triggers(doc) {
  const on = doc?.on
  if (typeof on === 'string') return { [on]: null }
  if (Array.isArray(on)) return Object.fromEntries(on.map((event) => [event, null]))
  return on ?? {}
}

const runsOnLabels = (job) => [job?.['runs-on'] ?? []].flat().map(String)
const isMacos = (job) => runsOnLabels(job).some((label) => /^macos/i.test(label))
const isWindowsOnly = (job) =>
  runsOnLabels(job).length > 0 && runsOnLabels(job).every((label) => /^windows/i.test(label))

/** Every `pull_request` trigger ignores specs and plans (CLAUDE.md, "PR CI skips ..."). */
export function checkPullRequestsIgnoreSpecs({ workflows }) {
  const problems = []
  for (const [file, { doc }] of Object.entries(workflows)) {
    const on = triggers(doc)
    for (const event of ['pull_request', 'pull_request_target']) {
      if (!(event in on)) continue
      const filter = on[event] ?? {}
      const ignored = filter['paths-ignore'] ?? []
      const only = filter.paths
      const ignoresSpecs =
        ignored.includes(SPEC_PATHS) ||
        (Array.isArray(only) && !only.some((pattern) => String(pattern).startsWith('docs/')))
      if (!ignoresSpecs) {
        problems.push(`${file}: its \`${event}\` trigger lacks \`paths-ignore: ["${SPEC_PATHS}"]\``)
      }
    }
  }
  return problems
}

/**
 * `actions/setup-node` caches the package manager's store by default (v5, from `packageManager`),
 * which needs `pnpm` on the PATH. A `setup-node` step that runs before `pnpm/action-setup` must
 * turn that off (the generator's `setup_node_steps_disable_package_manager_cache`).
 */
export function checkSetupNodeCache({ workflows, actions }) {
  const problems = []
  const check = (where, steps) => {
    let pnpmReady = false
    for (const step of steps ?? []) {
      const uses = String(step?.uses ?? '')
      if (uses.startsWith('pnpm/action-setup@')) pnpmReady = true
      if (!uses.startsWith('actions/setup-node@') || pnpmReady) continue
      const cache = step.with?.['package-manager-cache']
      if (cache !== false && cache !== 'false') {
        problems.push(
          `${where}: \`${step.name ?? uses}\` runs before pnpm is set up, so it needs \`package-manager-cache: false\``,
        )
      }
    }
  }
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) check(`${file} › ${id}`, job?.steps)
  }
  for (const [name, { doc }] of Object.entries(actions)) {
    check(`.github/actions/${name}`, doc?.runs?.steps)
  }
  return problems
}

const RELEASE_FORBIDDEN = [
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
  'release create-draft',
  'release publish',
  'update-latest-version',
  'ide upload',
  'ENSO_BUILD_UPDATE_INFO',
]
/** The workflow token, code signing, Sentry source maps, and the self-hosted Mac's status check. */
const RELEASE_SECRETS = new Set([
  'GITHUB_TOKEN',
  'APPLE_CODE_SIGNING_CERT',
  'APPLE_CODE_SIGNING_CERT_PASSWORD',
  'APPLE_NOTARIZATION_USERNAME',
  'APPLE_NOTARIZATION_PASSWORD',
  'APPLE_NOTARIZATION_TEAM_ID',
  'MICROSOFT_CODE_SIGNING_CERT',
  'MICROSOFT_CODE_SIGNING_CERT_PASSWORD',
  'SENTRY_AUTH_TOKEN',
  'RUNNER_STATUS_TOKEN',
])

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
  if (!jobs.some(([id, job]) => isMacos(job) && /upload-ide/.test(id))) {
    problems.push('release.yml: has no macOS IDE upload job')
  }
  return problems
}

/**
 * With the self-hosted Mac (#288), every macOS job waits for `check-the-mac-os-runner` and is
 * skipped while the Mac is offline, and publishing does not wait on macOS results
 * (`release_skips_macos_jobs_...`, `nightly_skips_macos_jobs_...`). Applies once a workflow has
 * that gate job.
 */
export function checkMacosJobsAreGated({ workflows }) {
  const problems = []
  for (const file of ['release.yml', 'engine-checks-nightly.yml']) {
    const jobs = workflows[file]?.doc?.jobs ?? {}
    if (!('check-the-mac-os-runner' in jobs)) continue
    for (const [id, job] of Object.entries(jobs)) {
      if (!isMacos(job)) continue
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
  }
  const release = workflows['release.yml']?.doc?.jobs ?? {}
  if ('check-the-mac-os-runner' in release) {
    const entry = Object.entries(release).find(([id]) => id.includes('publish-release'))
    if (!entry) return [...problems, 'release.yml: has no publish job']
    const [id, publish] = entry
    const condition = String(publish.if ?? '')
    const needs = [publish.needs ?? []].flat()
    if (!needs.some((need) => /upload-ide-macos/.test(need))) {
      problems.push(`release.yml › ${id}: must still need the macOS IDE upload`)
    }
    if (/macos/i.test(condition)) {
      problems.push(`release.yml › ${id}: its \`if\` must not wait on a macOS job`)
    }
    for (const required of [
      'upload-ide-linux-amd64',
      'upload-ide-windows-amd64',
      'draft-release',
    ]) {
      if (!condition.includes(required))
        problems.push(`release.yml › ${id}: its \`if\` lacks ${required}`)
    }
  }
  return problems
}

/** `macos-checks.yml` (#288) runs only what its inputs ask for (`macos_checks_run_only_...`). */
export function checkMacosChecksRunWhatIsRequested({ workflows }) {
  const jobs = workflows['macos-checks.yml']?.doc?.jobs
  if (!jobs) return []
  const problems = []
  const conditions = Object.entries(jobs).map(([id, job]) => [id, job?.if])
  for (const [id, condition] of conditions) {
    if (/build-engine-distribution/.test(id) && condition !== undefined) {
      problems.push(`macos-checks.yml › ${id}: the engine distribution must always be built`)
    }
  }
  const count = (input) => conditions.filter(([, condition]) => condition === input).length
  if (count('inputs.engine') !== 1)
    problems.push('macos-checks.yml: exactly one job must run on `inputs.engine`')
  if (count('inputs.libraries') !== 3) {
    problems.push('macos-checks.yml: exactly three jobs must run on `inputs.libraries`')
  }
  for (const [id, job] of Object.entries(jobs)) {
    if (!isMacos(job)) problems.push(`macos-checks.yml › ${id}: must run on macOS`)
  }
  return problems
}

const IDE_FORBIDDEN = [
  'ENSO_TEST_USER',
  'ENSO_CLOUD_TEST_ACCOUNT',
  '.enso/credentials',
  'playwright/.auth',
  'MAPBOX',
]

/** The IDE is local-only: packaging needs no Enso Cloud account (`ide_jobs_need_no_cloud_account`). */
export function checkIdePackagingNeedsNoCloudAccount({ workflows }) {
  const packaging = workflows['ide-packaging.yml']
  if (!packaging) return ['ide-packaging.yml: missing']
  return IDE_FORBIDDEN.filter((text) => packaging.text.includes(text)).map(
    (text) => `ide-packaging.yml: mentions \`${text}\``,
  )
}

/**
 * Windows packaging installs, starts and uninstalls the installer after uploading it, and only on
 * Windows (`windows_packaging_smoke_tests_the_installer`, #251).
 */
export function checkWindowsInstallerSmokeTest({ workflows }) {
  const jobs = Object.entries(workflows['ide-packaging.yml']?.doc?.jobs ?? {})
  const problems = []
  let found = false
  for (const [id, job] of jobs) {
    const steps = job?.steps ?? []
    steps.forEach((step, index) => {
      if (!String(step?.run ?? '').includes('tools/ci/windows-installer-smoke.ps1')) return
      found = true
      if (!/windows/i.test(String(step.if ?? '')) && !isWindowsOnly(job)) {
        problems.push(
          `ide-packaging.yml › ${id}: the installer smoke test must run only on Windows`,
        )
      }
      if (
        !steps
          .slice(0, index)
          .some((earlier) => String(earlier?.name ?? '').startsWith('Upload ide'))
      ) {
        problems.push(
          `ide-packaging.yml › ${id}: the installer must be uploaded before it is smoke-tested`,
        )
      }
    })
  }
  if (!found) problems.push('ide-packaging.yml: no step runs tools/ci/windows-installer-smoke.ps1')
  return problems
}

export const CHECKS = [
  checkPullRequestsIgnoreSpecs,
  checkSetupNodeCache,
  checkReleaseIsIdeOnly,
  checkOnlyMacosReleaseJobsMayFail,
  checkMacosJobsAreGated,
  checkMacosChecksRunWhatIsRequested,
  checkIdePackagingNeedsNoCloudAccount,
  checkWindowsInstallerSmokeTest,
]

/** Every violation in the repository at `root`, one message each. */
export function checkRepo(root) {
  const repo = loadRepo(root)
  return CHECKS.flatMap((check) => check(repo))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRepo(path.resolve(process.argv[2] ?? '.'))
  for (const problem of problems) console.log(problem)
  if (problems.length > 0) {
    console.log(`\n${problems.length} workflow policy violation(s).`)
    process.exit(1)
  }
  console.log('Workflow policy: OK')
}
```

- [ ] **Step 4: Run the tests and the check**

```bash
node --test tools/ci/check-workflows.test.mjs
node tools/ci/check-workflows.mjs
```

Expected: `ℹ tests 12`, `ℹ pass 12`, `ℹ fail 0`; then `Workflow policy: OK`. The
last test runs the check over this repository. If #288 has merged, the macOS
rules apply to its files too, and pass: this was checked against #288's branch
on 2026-10-20.

- [ ] **Step 5: Commit**

```bash
git add tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs
git commit -m "Add the workflow policy check, porting the CI generator's tests"
```

### Task 5: The composite actions (PR 1a)

**Files:**

- Create: `.github/actions/setup-node/action.yml`,
  `.github/actions/setup-rust/action.yml`,
  `.github/actions/build-script/action.yml`,
  `.github/actions/setup-build-script/action.yml`,
  `.github/actions/git-clean/action.yml`,
  `.github/actions/download-engine-distribution/action.yml`

**Interfaces:**

- Produces (each used as `uses: ./.github/actions/<name>`, after
  `actions/checkout`):
  - `setup-node`: no inputs. On macOS, `actions/setup-node@v5` from
    `.node-version` with `package-manager-cache: false`; on Windows and macOS,
    corepack 0.36.0. These are the generator's `setup_node`/`setup_corepack`
    steps. (The spec's pnpm store cache arrives with Phase 2, when jobs call
    pnpm directly.)
  - `setup-rust`: input `shared-key` (required). `Swatinem/rust-cache@v2`, saved
    only on `develop`. The toolchain comes from `rust-toolchain.toml`.
  - `build-script`: no inputs. `setup-rust` with key `build-script`, then
    `cargo build -p enso-build-cli`, then uploads the artifact
    `enso-build-cli-${{ runner.os }}`.
  - `setup-build-script`: no inputs. Exposes the Artifact API variables, runs
    `setup-node`, downloads `enso-build-cli-${{ runner.os }}`, exports
    `ENSO_BUILD_CLI_BIN`, and runs `./run --help`.
  - `git-clean`: no inputs. Runs `corepack pnpm run git-clean --verbose` when
    the env var `ENSO_CI_CLEAN_BUILD` is `'true'`. Each workflow sets that
    variable.
  - `download-engine-distribution`: input `name` (required). Replaces
    `built-distribution/` and `test/` from that artifact.
- Every step keeps the shell the generated step had: PowerShell on Windows, bash
  elsewhere.

- [ ] **Step 1: Write the six actions**

`.github/actions/setup-node/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up Node and corepack
description: >-
  Node from `.node-version` on macOS, whose runner image lacks a suitable one, and corepack 0.36.0
  everywhere but Linux, whose image already has a recent one. The jobs that call `./run` use it;
  the GUI checks set up pnpm their own way (`pnpm/action-setup`).
runs:
  using: composite
  steps:
    - if: runner.os == 'macOS'
      name: Setup nodejs version
      uses: actions/setup-node@v5
      with:
        node-version-file: .node-version
        # The store cache needs pnpm on the PATH, which the next step provides.
        package-manager-cache: false
    - if: runner.os == 'Windows'
      name: Install corepack
      shell: pwsh
      run: npm install -g --force corepack@0.36.0 && corepack --version
    - if: runner.os == 'macOS'
      name: Install corepack
      shell: bash
      run: npm install -g --force corepack@0.36.0 && corepack --version
```

`.github/actions/setup-rust/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up Rust
description: >-
  The Cargo cache for a job that compiles Rust. The toolchain itself comes from
  `rust-toolchain.toml`: rustup installs it on the first `cargo` call. Only `develop` saves the
  cache, so pull requests share one warm cache instead of each writing their own.
inputs:
  shared-key:
    description: >-
      `Swatinem/rust-cache` key shared by the jobs that build the same crates (`build-script` for
      the `./run` CLI, `wasm-parser` for the GUI's parser).
    required: true
runs:
  using: composite
  steps:
    - name: Cache Rust build
      uses: Swatinem/rust-cache@v2
      with:
        save-if: ${{ github.ref == 'refs/heads/develop' }}
        shared-key: ${{ inputs.shared-key }}
```

`.github/actions/build-script/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Compile the build script
description: >-
  Compiles `enso-build-cli`, the binary behind `./run`, and uploads it as
  `enso-build-cli-<runner OS>` for the jobs of this run that use it (see `setup-build-script`).
  Each workflow builds it once per platform, in a job of its own: those jobs never clean the
  working tree, so the Cargo cache they save on `develop` stays whole. Expects the repository to
  be checked out.
runs:
  using: composite
  steps:
    - uses: ./.github/actions/setup-rust
      with:
        shared-key: build-script
    # PowerShell on Windows, bash elsewhere: the shells the job used before.
    - if: runner.os == 'Windows'
      name: Compile
      shell: pwsh
      run: cargo build -p enso-build-cli
      env:
        GITHUB_TOKEN: ${{ github.token }}
    - if: runner.os != 'Windows'
      name: Compile
      shell: bash
      run: cargo build -p enso-build-cli
      env:
        GITHUB_TOKEN: ${{ github.token }}
    - name: Upload
      uses: actions/upload-artifact@v5
      with:
        if-no-files-found: error
        name: enso-build-cli-${{ runner.os }}
        path: target/rust/debug/enso-build-cli${{ runner.os == 'Windows' && '.exe' || '' }}
        retention-days: 1
```

`.github/actions/setup-build-script/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Set up the build script
description: >-
  Makes the `enso-build-cli` compiled earlier in this run (by `build-script`) the binary behind
  `./run`, through `ENSO_BUILD_CLI_BIN`, and runs `./run --help` once. Before that it exposes the
  Artifact API variables that `./run` reads and sets up Node and corepack. Expects the repository
  to be checked out.
runs:
  using: composite
  steps:
    - name: Expose Artifact API and context information.
      uses: actions/github-script@v8
      with:
        script: |
          core.exportVariable("ACTIONS_RUNTIME_TOKEN", process.env["ACTIONS_RUNTIME_TOKEN"])
          core.exportVariable("ACTIONS_RUNTIME_URL", process.env["ACTIONS_RUNTIME_URL"])
          core.exportVariable("GITHUB_RETENTION_DAYS", process.env["GITHUB_RETENTION_DAYS"])
          console.log(context)
    - uses: ./.github/actions/setup-node
    - name: Download Build Script
      uses: actions/download-artifact@v5
      with:
        name: enso-build-cli-${{ runner.os }}
        path: ${{ runner.temp }}/enso-build-cli
    - name: Configure Build Script
      shell: bash
      run: |-
        BIN="$RUNNER_TEMP/enso-build-cli/enso-build-cli"
        [ "$RUNNER_OS" = "Windows" ] && BIN="$BIN.exe"
        chmod +x "$BIN" || true
        echo "ENSO_BUILD_CLI_BIN=$BIN" >> "$GITHUB_ENV"
      env:
        GITHUB_TOKEN: ${{ github.token }}
    # PowerShell on Windows (it runs `run.ps1`), bash elsewhere: the shells the jobs used before.
    - if: runner.os == 'Windows'
      name: Build Script Setup
      shell: pwsh
      run: ./run --help
      env:
        GITHUB_TOKEN: ${{ github.token }}
    - if: runner.os != 'Windows'
      name: Build Script Setup
      shell: bash
      run: ./run --help
      env:
        GITHUB_TOKEN: ${{ github.token }}
```

`.github/actions/git-clean/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Clean the working tree
description: >-
  Runs `corepack pnpm run git-clean --verbose` when `ENSO_CI_CLEAN_BUILD` is `true`. Each workflow
  sets that variable at its top, from the `CI: Clean build required` label, a run on `develop`, or
  the `clean_build_required` input. Use it twice per job: before the work, and after it with
  `if: always()`.
runs:
  using: composite
  steps:
    # `always()`: the "after" call runs when the job has failed, and its steps must run too.
    - if: always() && env.ENSO_CI_CLEAN_BUILD == 'true' && runner.os == 'Windows'
      shell: pwsh
      run: corepack pnpm run git-clean --verbose
      env:
        GITHUB_TOKEN: ${{ github.token }}
    - if: always() && env.ENSO_CI_CLEAN_BUILD == 'true' && runner.os != 'Windows'
      shell: bash
      run: corepack pnpm run git-clean --verbose
      env:
        GITHUB_TOKEN: ${{ github.token }}
```

`.github/actions/download-engine-distribution/action.yml`:

<!-- prettier-ignore -->
```yaml
name: Download the engine distribution
description: >-
  Replaces `built-distribution/` and `test/` with the ones packed by this run's engine
  distribution job, from its artifact.
inputs:
  name:
    description: The artifact's name, e.g. `Engine Distribution (GraalVM CE) (native,test) (linux, amd64)`.
    required: true
runs:
  using: composite
  steps:
    - shell: bash
      run: rm -rf built-distribution test
    - name: Download Engine Distribution
      uses: actions/download-artifact@v5
      with:
        name: ${{ inputs.name }}
    - shell: bash
      run: ls -l built-distribution.tar
    # Windows' own `tar` (from PowerShell) unpacks what Windows' own `tar` packed; Git Bash's would
    # be a different program.
    - if: runner.os == 'Windows'
      name: Unpack Engine Distribution
      shell: pwsh
      run: |-
        tar -xvf built-distribution.tar -C .
        rm built-distribution.tar
    - if: runner.os != 'Windows'
      name: Unpack Engine Distribution
      shell: bash
      run: |-
        tar -xvf built-distribution.tar -C .
        rm built-distribution.tar
```

- [ ] **Step 2: Lint and check them**

```bash
corepack pnpm exec prettier --check .github/actions
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-1a && ~/tools/actionlint-1.7.12/actionlint -no-color -oneline -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck' | grep -c actions/ || true
node tools/ci/check-workflows.mjs
```

Expected:

- Prettier passes.
- The `grep -c` prints `0`. actionlint reports problems in a local action
  through the workflows that use it; none does yet, which Tasks 7–11 cover.
- `Workflow policy: OK`. The `setup-node` action sets
  `package-manager-cache: false`.

- [ ] **Step 3: Commit**

```bash
git add .github/actions
git commit -m "Add composite actions for the build script, Node, Rust, cleaning and the engine distribution"
```

### Task 6: Workflow Lint, the "hand-maintained" headers, and PR 1a

**Files:**

- Create: `.github/workflows/workflow-lint.yml`, `.github/actionlint.yaml`,
  `.github/CLAUDE.md`
- Modify:
  - `.github/workflows/formatting.yml:39` and
    `.github/workflows/enso4igv.yml:125-126,136,151,160` (shellcheck);
  - lines 1–2 of `release.yml`, `promote.yml`, `nightly.yml`,
    `engine-checks-nightly.yml`, `extra-nightly-tests.yml` and, if present,
    `macos-checks.yml`.

**Interfaces:**

- Consumes `tools/ci/check-workflows.mjs` and its tests (Task 4).
- Produces:
  - the check "Workflow Lint", run on any change under `.github/**` or
    `tools/ci/**`;
  - `.github/actionlint.yaml`, whose `changelog.yml` and `std-libs-labels.yml`
    entries Tasks 7 and 8 remove.

- [ ] **Step 1: See actionlint fail on the branch**

Run the Task 0, Step 4 command in `/mnt/c/Repos/Enso/ide-bs-1a`. Expected: the
same 29 findings.

- [ ] **Step 2: Fix the shellcheck findings in the two hand-written workflows**

In `.github/workflows/formatting.yml` replace

```
          echo $GITHUB_WORKSPACE/sbt/bin/ >> $GITHUB_PATH
```

with

```
          echo "$GITHUB_WORKSPACE/sbt/bin/" >> "$GITHUB_PATH"
```

In `.github/workflows/enso4igv.yml` replace

```
          echo "POM_VERSION=`mvn -q -DforceStdout help:evaluate -Dexpression=project.version | cut -f1 -d -`" >> "$GITHUB_ENV"
          echo "MICRO_VERSION=`expr $GITHUB_RUN_NUMBER - $MICRO_VERSION_OFFSET`" >> "$GITHUB_ENV"
```

with

```
          echo "POM_VERSION=$(mvn -q -DforceStdout help:evaluate -Dexpression=project.version | cut -f1 -d -)" >> "$GITHUB_ENV"
          echo "MICRO_VERSION=$((GITHUB_RUN_NUMBER - MICRO_VERSION_OFFSET))" >> "$GITHUB_ENV"
```

and, in all three places it occurs (the Build with Maven, Build VSCode Extension
and Run Tests with Maven steps), replace

```
-Denso.parser.lib=`pwd`/enso_parser/
```

with

```
-Denso.parser.lib="$(pwd)/enso_parser/"
```

The same commands with the same values: `$(…)` for backticks, shell arithmetic
for `expr`, quotes against word splitting. Both workflows run on this PR
(`formatting.yml` on every PR, `enso4igv.yml` because its own file changed),
which proves them.

- [ ] **Step 3: Replace the generated headers that stay**

The first two lines of each of these files are:

```
# This file is auto-generated. Do not edit it manually!
# Edit the enso_build::ci_gen module instead and run `cargo run --package enso-build-ci-gen`.
```

In `release.yml`, `promote.yml` and `nightly.yml`, replace those two lines with:

```
# Hand-maintained. This is the last output of the CI generator (`build_tools/ci-gen`), which is
# retired in Phase 1 of the build simplification
# (docs/superpowers/specs/2026-10-20-build-simplification-design.md). It is kept unchanged on
# purpose: Phase 4 rewrites the release workflows and proves them with an rc prerelease, so change
# this file only together with such a release test.
```

In `engine-checks-nightly.yml`, replace them with:

```
# Hand-maintained. This is the last output of the CI generator (`build_tools/ci-gen`), which is
# retired in Phase 1 of the build simplification
# (docs/superpowers/specs/2026-10-20-build-simplification-design.md). Its one-job-per-platform
# layout stays until Phase 2 moves it onto `engine-checks-platform.yml`: only a full manual run can
# validate a rewrite, and that needs the self-hosted Mac and the Oracle GraalVM jobs to run.
# Edit this file directly.
```

In `extra-nightly-tests.yml`, replace them with:

```
# Hand-maintained. This is the last output of the CI generator (`build_tools/ci-gen`), which is
# retired in Phase 1 of the build simplification
# (docs/superpowers/specs/2026-10-20-build-simplification-design.md). Its layout stays until
# Phase 2: its jobs need the Snowflake and Enso Cloud test secrets, which this repository does not
# have, so no run can validate a rewrite. Edit this file directly.
```

If `macos-checks.yml` exists (#288 merged), replace its two lines with:

```
# Hand-maintained. This is the last output of the CI generator (`build_tools/ci-gen`), which is
# retired in Phase 1 of the build simplification
# (docs/superpowers/specs/2026-10-20-build-simplification-design.md). Its layout stays until
# Phase 2: validating a rewrite needs the self-hosted Mac. Edit this file directly.
```

Then confirm that only the files being rewritten in PRs 1b–1f still carry the
generated header:

```bash
git grep -l "This file is auto-generated" -- .github/workflows
```

Expected: exactly `changelog.yml`, `engine-benchmark.yml`, `engine-checks.yml`,
`ide-packaging.yml`, `std-libs-benchmark.yml` and `std-libs-labels.yml`.

- [ ] **Step 4: Add the actionlint configuration**

`.github/actionlint.yaml`:

<!-- prettier-ignore -->
```yaml
# actionlint configuration: https://github.com/rhysd/actionlint/blob/v1.7.12/docs/config.md
# Every ignore names one finding exactly and says why it stays.
paths:
  # The release workflows keep the CI generator's last output until Phase 4 of the build
  # simplification rewrites them (docs/superpowers/specs/2026-10-20-build-simplification-design.md),
  # proven by an rc prerelease. Their clean-up steps read an input they do not declare, which
  # evaluates to null: harmless, and not worth an unproven change to a release workflow.
  .github/workflows/release.yml:
    ignore:
      - 'property "clean_build_required" is not defined in object type \{version: string\}'
  .github/workflows/promote.yml:
    ignore:
      - 'property "clean_build_required" is not defined in object type \{designator: string\}'
  # Generated; rewritten by PR 1b of the build simplification, which removes this entry.
  .github/workflows/changelog.yml:
    ignore:
      - 'property "clean_build_required" is not defined in object type \{\}'
  # Generated; rewritten by PR 1c of the build simplification, which removes this entry.
  .github/workflows/std-libs-labels.yml:
    ignore:
      - 'unexpected key "description" for "workflow" section'
```

The ignore patterns are regular expressions matched against each message. The
`release.yml` one matched all 12 findings when checked on 2026-10-20.

- [ ] **Step 5: Add the Workflow Lint workflow**

`.github/workflows/workflow-lint.yml`:

<!-- prettier-ignore -->
```yaml
# Hand-written. Lints the workflows and composite actions with actionlint, then checks the rules
# that the CI generator's unit tests used to enforce (`tools/ci/check-workflows.mjs`).

name: Workflow Lint
on:
  push:
    branches:
      - develop
    paths:
      - ".github/**"
      - "tools/ci/**"
  pull_request:
    # A whitelist: specs and plans (`docs/superpowers/**`) never match it.
    paths:
      - ".github/**"
      - "tools/ci/**"

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}-workflow-lint
  cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}

permissions:
  contents: read

jobs:
  workflow-lint:
    name: Workflow Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      # The image (actionlint 1.7.12, released 2026-03-30) bundles shellcheck, so `run:` scripts are
      # checked too. It reads `.github/actionlint.yaml`.
      - name: actionlint
        uses: docker://rhysd/actionlint:1.7.12
        with:
          args: -color
      - name: 📦 Setup pnpm
        uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        name: ⎔ Setup Node
        with:
          node-version-file: .node-version
          cache: "pnpm"
      - name: 📦 Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts
      - name: Workflow policy
        run: node tools/ci/check-workflows.mjs
      - name: Workflow policy tests
        run: node --test tools/ci/check-workflows.test.mjs
```

- [ ] **Step 6: Add `.github/CLAUDE.md`**

The directory has none (`~/.claude/skills/project-structure`). Create
`.github/CLAUDE.md`:

<!-- prettier-ignore -->
````markdown
# .github

GitHub Actions workflows, the composite actions they share, and repository
settings. Every workflow is hand-written YAML: the Rust generator
(`build_tools/ci-gen`) is retired (build simplification, Phase 1;
`docs/superpowers/specs/2026-10-20-build-simplification-design.md`).

**Status:** Phase 1 converts the generated workflows one pull request at a time.
A workflow whose first line still reads `# This file is auto-generated` has not
been converted yet, and some files named below may not exist yet.

## Layout

- `workflows/*-pull-request.yml` — the entry points for pull requests and
  `develop` pushes (✨ Engine, ✨ GUI, ✨ IDE, ✨ WASM). Each runs its
  `*-changed-files.yml` gate, calls the matching checks workflow, and ends in an
  aggregator job.
- `workflows/*-changed-files.yml` — path gating: which files start which checks.
- `workflows/engine-checks.yml` + `engine-checks-platform.yml`,
  `ide-packaging.yml`, `gui-checks.yml`, `wasm-checks.yml` — the checks,
  callable (`workflow_call`) and mostly startable by hand (`workflow_dispatch`).
- `workflows/changelog.yml`, `std-libs-labels.yml`, `formatting.yml`,
  `enso4igv.yml`, `workflow-lint.yml` — single-purpose pull-request workflows.
- `workflows/release.yml`, `promote.yml`, `nightly.yml` — releases. They are the
  generator's last output, kept unchanged until Phase 4 rewrites them; change
  them only together with an rc release test. `engine-checks-nightly.yml` and
  `extra-nightly-tests.yml` are likewise kept as generated until Phase 2.
- `workflows/engine-benchmark.yml`, `std-libs-benchmark.yml`, `bench-upload.yml`
  — benchmarks, started by hand. `bench-upload.yml` keys on the other two by
  their `name:`; keep those names.
- `actions/` — composite actions: `build-script` (compile `./run`'s CLI once per
  platform), `setup-build-script` (use it in a job), `setup-node`, `setup-rust`,
  `git-clean`, `download-engine-distribution`.
- `actionlint.yaml` — actionlint's configuration; each ignore says why it stays.
- `settings.yml`, `mergify.yml` — inherited from upstream. Neither is live on
  this fork: the branch rules are a repository ruleset, which requires no status
  check.

## Conventions

- **Keep the aggregator names verbatim:** "Engine Required Checks", "GUI
  Required Checks", "IDE Required Checks", "WASM Required Checks". They are what
  a reviewer (or a ruleset) looks for.
- **Every `pull_request` trigger ignores `docs/superpowers/**`** (or uses a
  `paths` whitelist that leaves it out). `tools/ci/check-workflows.mjs` fails
  any workflow that forgets.
- **A new workflow or composite action used by the engine checks goes on the
  list in `engine-changed-files.yml`**, or a change to it will not run them.
  `ide-changed-files.yml` already covers all of `.github/**`.
- **One OS/arch set is one `strategy.matrix`**, with `fail-fast: false`. Where a
  platform's failure must not skip or delay the other platform's jobs, the
  platform is a reusable workflow called with a matrix (`engine-checks.yml`);
  where waiting costs no wall-clock time, legs use `if: ${{ !cancelled() }}`
  (see Note [Platform Legs Run Despite The Other Platform's Failure] in
  `ide-packaging.yml`).
- **A reusable workflow called with a matrix has no `concurrency:`**: its legs
  would share the group and cancel each other.
- **Composite actions keep the shell a step had**: PowerShell on Windows, bash
  elsewhere, as two steps with `runner.os` conditions. A composite step must
  name its shell, and on Windows `./run` and `tar` behave differently under Git
  Bash.
- **`ENSO_CI_CLEAN_BUILD`**, set at the top of a workflow, decides whether
  `git-clean` cleans: the `CI: Clean build required` label, a run on `develop`,
  or the `clean_build_required` input.
- **Actions are pinned by major tag** (`@v5`), as everywhere here; a new
  third-party action or image must be at least two weeks old. The actionlint
  image is pinned to an exact version.

## Checking a change

- `actionlint` (Linux, from WSL): download the pinned release once, then run it
  from the repository root with shellcheck:

  ```bash
  wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide && ~/tools/actionlint-1.7.12/actionlint -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck'
  ```

- `node tools/ci/check-workflows.mjs` and
  `node --test tools/ci/check-workflows.test.mjs` — the workflow policy (the
  rules the generator's tests enforced).
- A pull request from a branch of this repository runs **its own** workflow
  files and composite actions, so the PR's checks are the test of a workflow
  change. A workflow that only runs by hand is tested with
  `gh workflow run <file> --ref <branch>`, which runs the branch's version.
````

Task 12 deletes the **Status** paragraph once every workflow is converted.

- [ ] **Step 7: Verify everything on Linux and Windows**

```bash
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-1a && ~/tools/actionlint-1.7.12/actionlint -no-color -oneline -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo ACTIONLINT-CLEAN'
node tools/ci/check-workflows.mjs
node --test tools/ci/check-workflows.test.mjs tools/ci/compare-workflows.test.mjs
corepack pnpm exec prettier --check .github
node tools/ci/compare-workflows.mjs --base origin/develop release.yml promote.yml nightly.yml engine-checks-nightly.yml extra-nightly-tests.yml formatting.yml enso4igv.yml
```

Expected:

- `ACTIONLINT-CLEAN`;
- `Workflow policy: OK`;
- `ℹ tests 21`, `ℹ pass 21`;
- Prettier passes;
- the comparison shows no `diff` block except two. `enso4igv.yml`'s `build_java`
  job shows the four rewritten `run` steps, and `formatting.yml`'s
  `Test Formatting` job shows the quoted `echo`. A header comment is not part of
  the comparison, so the five header-only files show no difference at all.

- [ ] **Step 8: Commit and open PR 1a**

```bash
git add .github/workflows .github/actionlint.yaml .github/CLAUDE.md
git commit -m "Lint workflows with actionlint and the policy check; mark the generated workflows that stay as hand-maintained"
git push -u origin ci/workflow-foundations
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1a: composite actions, Workflow Lint, hand-maintained headers" \
  --body-file "$SCRATCH/pr1a.md"
```

`$SCRATCH/pr1a.md` contains:

- what the PR adds: the six actions, unused until 1b–1f; the comparison script,
  temporary; the policy check, permanent, with the porting table of Task 4;
  Workflow Lint; the header notes;
- the headers table, i.e. this plan's table "The generated workflows";
- the shellcheck fixes, in the Step 7 comparison output;
- "Required checks": the Global Constraints paragraph;
- the attribution lines.

- [ ] **Step 9: Wait for CI, then merge**

Run `$SCRATCH/wait-pr.sh <N> 240` in the background. Expected checks: Workflow
Lint, Code Formatting, the enso4igv build, Changelog, the GUI checks
(`package.json` changed), IDE packaging (`.github/**` changed), and the labels.

- Exit 0: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

Do not start Tasks 7–11 on `develop` before this merges. If it is blocked, base
them on `ci/workflow-foundations` instead.

### Task 7: Rewrite `changelog.yml` (PR 1b)

**Files:**

- Modify: `.github/workflows/changelog.yml` (whole file),
  `.github/actionlint.yaml` (drop the `changelog.yml` entry)

**Interfaces:**

- Consumes: the `build-script`, `setup-build-script` and `git-clean` actions
  (Task 5).
- Produces: jobs `build-script` ("Build Script (linux, amd64)") and `changelog`
  ("Changelog", unchanged), with the triggers unchanged.

- [ ] **Step 1: Create the worktree; see the ignore entry still needed**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1b -b ci/hand-written-changelog origin/develop
cd /c/Repos/Enso/ide-bs-1b && corepack pnpm install --frozen-lockfile --ignore-scripts
```

Delete the `changelog.yml` entry, with its comment line, from
`.github/actionlint.yaml`, and run actionlint (Task 6, Step 7 command, in this
worktree). Expected: FAIL. `changelog.yml` reports
`property "clean_build_required" is not defined in object type {}` twice.

- [ ] **Step 2: Write the new `changelog.yml`**

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

env:
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ contains(github.event.pull_request.labels.*.name, 'CI: Clean build required') || github.ref == 'refs/heads/develop' }}"

jobs:
  build-script:
    name: Build Script (linux, amd64)
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Compile the build script
        uses: ./.github/actions/build-script

  changelog:
    name: Changelog
    needs: [build-script]
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - run: ./run changelog-check
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean
```

- [ ] **Step 3: Lint, check, compare**

Run the Task 6, Step 7 commands (actionlint, the policy check, the tests,
Prettier), then:

```bash
node tools/ci/compare-workflows.mjs --base origin/develop --rename "Build Script=Build Script (linux, amd64)" changelog.yml > "$SCRATCH/cmp-1b.md"
```

Expected: actionlint is clean and the policy check passes. `cmp-1b.md` shows
exactly these differences:

- D1 (the Build Script job's name);
- D2 (the Artifact API step now follows the checkout);
- D3 (the clean conditions);
- D4 (`ENSO_CI_CLEAN_BUILD` in the env);
- D5 (the `clean_build_required` term is dropped).

The D-numbers refer to "Reference: intended differences" below. Any other line
is a mistake to fix.

- [ ] **Step 4: Commit, push, open PR 1b**

```bash
git add .github/workflows/changelog.yml .github/actionlint.yaml
git commit -m "Hand-write the Changelog workflow"
git push -u origin ci/hand-written-changelog
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1b: hand-written Changelog workflow" --body-file "$SCRATCH/pr1b.md"
```

`$SCRATCH/pr1b.md` contains:

- a summary;
- "Intended differences": every diff line of `cmp-1b.md`, with its D-number and
  reason;
- "Validation": filled in by Step 5;
- the attribution lines.

- [ ] **Step 5: Prove both outcomes of the check on the PR's own runs**

The pull request runs its own `changelog.yml`, because its branch is in this
repository.

1. With the label, the Changelog check passes.
2. Remove the label: `gh pr edit <N> --remove-label "CI: No changelog needed"`.
   Wait for the new Changelog run with
   `gh run list --workflow changelog.yml --branch ci/hand-written-changelog --limit 1`.
   Expected: failure in the `./run changelog-check` step.
3. Add the label back. Expected: the next run passes.

Record the three run links in the PR body under "Validation".

- [ ] **Step 6: Wait for CI, then merge**

`$SCRATCH/wait-pr.sh <N> 240` in the background. IDE packaging and Workflow Lint
run (`.github/**`).

- Exit 0: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

### Task 8: Rewrite `std-libs-labels.yml` as a matrix (PR 1c)

**Files:**

- Modify: `.github/workflows/std-libs-labels.yml` (whole file),
  `.github/actionlint.yaml` (drop the `std-libs-labels.yml` entry)

**Interfaces:**

- Produces one matrix job `stdlib-api-check` over 14 libraries. Each leg is
  named `<Library>-change-labels`, as before, and the labels are
  `-libs-API-change-<Library>`. The triggers, including `workflow_call` from
  `engine-pull-request.yml` ("🏷 Append labels to PR"), are unchanged.

- [ ] **Step 1: Create the worktree; see the ignore entry still needed**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1c -b ci/hand-written-std-libs-label origin/develop
cd /c/Repos/Enso/ide-bs-1c && corepack pnpm install --frozen-lockfile --ignore-scripts
```

Delete the `std-libs-labels.yml` entry, with its comment line, from
`.github/actionlint.yaml`, and run actionlint. Expected: FAIL with
`unexpected key "description" for "workflow" section`.

- [ ] **Step 2: Write the new `std-libs-labels.yml`**

<!-- prettier-ignore -->
```yaml
# Hand-written. Adds the `-libs-API-change-<Library>` label to a pull request that changes the API
# signature files (`docs/api`) of a standard library. Runs on its own and, from
# `engine-pull-request.yml`, as "🏷 Append labels to PR".

name: 🏷 Standard Library Labels
on:
  push:
    branches:
      - develop
  pull_request:
    # Specs and plans alone start no checks; every `pull_request` workflow ignores them
    # (`tools/ci/check-workflows.mjs` checks it).
    paths-ignore:
      - "docs/superpowers/**"
  workflow_dispatch: {}
  workflow_call: {}

permissions:
  checks: write
  pull-requests: write

jobs:
  stdlib-api-check:
    name: ${{ matrix.library }}-change-labels
    runs-on: ubuntu-latest
    strategy:
      # Each library is labelled on its own, as when they were separate jobs.
      fail-fast: false
      matrix:
        library:
          - AWS
          - Base
          - Database
          - DuckDB
          - Generic_JDBC
          - Google
          - Image
          - Microsoft
          - Saas
          - Snowflake
          - Table
          - Tableau
          - Test
          - Visualization
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
          fetch-depth: 2
      - id: changed-files
        name: ${{ matrix.library }}-changed-files
        uses: step-security/changed-files@v45
        with:
          files: distribution/lib/Standard/${{ matrix.library }}/**/docs/api/**/**.md
      - name: List all changed files in ${{ matrix.library }}
        env:
          ANY_CHANGED: ${{ steps.changed-files.outputs.any_changed }}
          ALL_CHANGED_FILES: ${{ steps.changed-files.outputs.all_changed_files }}
        run: |
          if [[ "$ANY_CHANGED" == "true" ]]; then
            echo "Files changed:"
          fi
          for file in ${ALL_CHANGED_FILES}; do
            echo "$file"
          done
      - if: steps.changed-files.outputs.any_changed == 'true'
        name: Append -libs-API-change-${{ matrix.library }} label
        uses: actions-ecosystem/action-add-labels@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          labels: -libs-API-change-${{ matrix.library }}
```

- [ ] **Step 3: Lint, check, compare**

Run the Task 6, Step 7 commands, then:

```bash
node tools/ci/compare-workflows.mjs --base origin/develop std-libs-labels.yml > "$SCRATCH/cmp-1c.md"
```

Expected: actionlint is clean and the policy check passes. `cmp-1c.md` shows,
for each of the 14 jobs, only:

- D4 (`ENSO_BUILD_SKIP_VERSION_CHECK` is dropped: no `./run` here);
- D6 (the step id `changed-files`; the list step reads its outputs from env
  vars; the `description:` key is gone).

- [ ] **Step 4: Commit, push, open PR 1c**

```bash
git add .github/workflows/std-libs-labels.yml .github/actionlint.yaml
git commit -m "Hand-write the Standard Library labels workflow as a matrix"
git push -u origin ci/hand-written-std-libs-label
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1c: Standard Library labels as a matrix" --body-file "$SCRATCH/pr1c.md"
```

- [ ] **Step 5: Prove the labelling path with a throwaway PR**

The PR's own runs prove that all 14 legs run and pass with nothing to label. To
prove that a label is still added:

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1c-probe -b ci/probe-std-libs-label ci/hand-written-std-libs-label
cd /c/Repos/Enso/ide-bs-1c-probe
f=$(git ls-files 'distribution/lib/Standard/Base/*/docs/api/*.md' | head -1); echo "$f"
printf '\n' >> "$f"
git commit -am "Probe: touch one Base API file (do not merge)"
git push -u origin ci/probe-std-libs-label
gh pr create --draft --base ci/hand-written-std-libs-label --title "Probe: std-libs labels (do not merge)" --body "Throwaway: proves the matrix still labels. Closed without merging."
```

1. Wait for its "🏷 Standard Library Labels" run (about a minute):
   `gh run list --workflow std-libs-labels.yml --branch ci/probe-std-libs-label --limit 1`.
2. Check the labels: `gh pr view <probe> --json labels --jq '[.labels[].name]'`.
   Expected: `["-libs-API-change-Base"]` and no other `-libs-API-change-*`
   label.
3. Cancel every other run on the probe branch:
   `gh run list --branch ci/probe-std-libs-label --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' | xargs -r -n1 gh run cancel`.
4. Close the PR, delete the branch, and remove the worktree:

   ```bash
   gh pr close <probe> --delete-branch
   git -C /c/Repos/Enso/ide worktree remove /c/Repos/Enso/ide-bs-1c-probe
   ```

Record the probe's run link and label in PR 1c's body under "Validation".

- [ ] **Step 6: Wait for CI, then merge**

`$SCRATCH/wait-pr.sh <N> 240` in the background. Check that the ✨ Engine run
shows the 14 "🏷 Append labels to PR / <Library>-change-labels" legs.

- Exit 0: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

### Task 9: Rewrite the engine checks as per-platform pipelines (PR 1d)

**Files:**

- Modify: `.github/workflows/engine-checks.yml` (whole file),
  `.github/workflows/engine-changed-files.yml:39`
- Create: `.github/workflows/engine-checks-platform.yml`

**Interfaces:**

- Consumes: the `build-script`, `setup-build-script`, `git-clean` and
  `download-engine-distribution` actions (Task 5).
- Produces:
  - `engine-checks.yml`: the same triggers (`workflow_dispatch` with
    `clean_build_required`, `workflow_call`) and the same `concurrency`. One
    job, `platform`, calls `engine-checks-platform.yml` with a matrix of `os`
    (`linux`/`windows`), `runner`, and `stdlib-suites` (JSON).
  - `engine-checks-platform.yml`: inputs `os`, `runner`, `stdlib-suites`
    (string, JSON `[{"suite", "title"}]`), and `clean_build_required` (boolean).
    Its jobs keep the display names of the generated ones exactly: "Build Engine
    Distribution (GraalVM CE) (native,test) (<os>, amd64)", "Enso Code Lint
    (linux, amd64)", "JVM Tests (GraalVM CE) (<os>, amd64)", "Standard Library
    API check (linux, amd64)", and "Standard Library <Title> Tests (GraalVM CE)
    (<os>, amd64)". They also keep the artifact names ("Engine Distribution
    (GraalVM CE) (native,test) (<os>, amd64)", the heap dumps) and the report
    names.
- `engine-pull-request.yml` (its aggregator "Engine Required Checks") is not
  touched.

- [ ] **Step 1: Create the worktree; record the old job list**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1d -b ci/hand-written-engine-checks origin/develop
cd /c/Repos/Enso/ide-bs-1d && corepack pnpm install --frozen-lockfile --ignore-scripts
```

- [ ] **Step 2: Write `engine-checks.yml`**

<!-- prettier-ignore -->
```yaml
# Hand-written. The engine's checks on Linux and Windows: called by `engine-pull-request.yml`, and
# can be started by hand. Each platform is its own pipeline (`engine-checks-platform.yml`), so a
# platform's failure neither skips nor delays the other's checks.

name: Engine Checks
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
  group: ${{ github.workflow }}-${{ github.ref }}-engine-checks
  cancel-in-progress: ${{ github.ref != 'refs/heads/develop' }}

jobs:
  platform:
    name: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: linux
            runner: ubuntu-latest
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native"},
              {"suite": "standard-library", "title": "JVM"},
              {"suite": "std-aws", "title": "AWS"},
              {"suite": "std-microsoft", "title": "Microsoft"}]
          - os: windows
            runner: windows-latest
            stdlib-suites: >-
              [{"suite": "standard-library-in-native", "title": "Native"},
              {"suite": "standard-library", "title": "JVM"},
              {"suite": "std-aws", "title": "AWS"}]
    uses: ./.github/workflows/engine-checks-platform.yml
    with:
      os: ${{ matrix.os }}
      runner: ${{ matrix.runner }}
      stdlib-suites: ${{ matrix.stdlib-suites }}
      clean_build_required: ${{ inputs.clean_build_required == true }}
    secrets: inherit
```

- [ ] **Step 3: Write `engine-checks-platform.yml`**

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
          JSON list of the Standard Library test suites to run, each
          `{"suite": "<./run backend test argument>", "title": "<job title>"}`.
        required: true
        type: string
      clean_build_required:
        description: Clean before and after each job.
        required: false
        type: boolean
        default: false

env:
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ contains(github.event.pull_request.labels.*.name, 'CI: Clean build required') || github.ref == 'refs/heads/develop' || inputs.clean_build_required }}"

jobs:
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

  build-engine-distribution:
    name: Build Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
    needs: [build-script]
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LAUNCHER: native,test
      GRAAL_EDITION: GraalVM CE
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - run: ./run backend ci-build-engine-distribution
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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

  enso-code-lint:
    name: Enso Code Lint (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-script, build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    env:
      ENSO_LINT_ENABLE_GITHUB_ANNOTATIONS: "true"
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Check syntax
        run: ./run libraries check-syntax
      - name: Download the engine distribution
        uses: ./.github/actions/download-engine-distribution
        with:
          name: Engine Distribution (GraalVM CE) (native,test) (${{ inputs.os }}, amd64)
      - run: ./run libraries lint
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  jvm-tests:
    name: JVM Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    needs: [build-script, build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    env:
      GRAAL_EDITION: GraalVM CE
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
      - run: ./run backend test jvm
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
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
          path: ${{ env.ENSO_TEST_JUNIT_DIR }}/*.xml
          path-replace-backslashes: true
          reporter: java-junit
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  standard-library-api-check:
    name: Standard Library API check (linux, amd64)
    if: inputs.os == 'linux'
    needs: [build-script, build-engine-distribution]
    runs-on: ${{ inputs.runner }}
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
      - run: ./run backend stdlib-api-check
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Clean after
        if: always()
        uses: ./.github/actions/git-clean

  stdlib-tests:
    name: Standard Library ${{ matrix.title }} Tests (GraalVM CE) (${{ inputs.os }}, amd64)
    needs: [build-script, build-engine-distribution]
    runs-on: ${{ inputs.runner }}
    permissions:
      checks: write
    env:
      GRAAL_EDITION: GraalVM CE
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

- [ ] **Step 4: Make changes to the new files start the engine checks**

In `.github/workflows/engine-changed-files.yml`, replace the line

```
            .github/workflows/engine-checks-optional.yml
```

(a file that does not exist) with

```
            .github/workflows/engine-checks-platform.yml
            .github/actions/**
```

- [ ] **Step 5: Lint, check, compare**

Run the Task 6, Step 7 commands, then:

```bash
node tools/ci/compare-workflows.mjs --base origin/develop \
  --rename "Build Script [ubuntu-latest]=Build Script (linux, amd64)" \
  --rename "Build Script [windows-latest]=Build Script (windows, amd64)" \
  engine-checks.yml engine-changed-files.yml > "$SCRATCH/cmp-1d.md"
git diff --quiet origin/develop -- .github/workflows/engine-pull-request.yml && echo AGGREGATOR-UNCHANGED
```

Expected: actionlint is clean and the policy check passes. In `cmp-1d.md`, every
one of the 15 base jobs is matched by name (no `(only in base)` /
`(only in head)` sections), and the differences are exactly:

- D1 (the Build Script names, paired by the renames; their steps match);
- D2, D3 and D4;
- D7 (`fail-on-empty=true` written out for the Native, JVM and Microsoft
  reporters);
- D10 (`ENSO_BUILD_SKIP_VERSION_CHECK` moves from `engine-checks.yml`'s env to
  the platform workflow's: the `### Workflow` diff);
- D11 (`engine-changed-files.yml` lists the new files: a `with: files=`
  difference in its one job).

The last command prints `AGGREGATOR-UNCHANGED`.

- [ ] **Step 6: Commit, push, open PR 1d**

```bash
git add .github/workflows/engine-checks.yml .github/workflows/engine-checks-platform.yml .github/workflows/engine-changed-files.yml
git commit -m "Hand-write the engine checks as one reusable pipeline per platform"
git push -u origin ci/hand-written-engine-checks
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1d: hand-written engine checks" --body-file "$SCRATCH/pr1d.md"
```

The body explains why each platform is its own reusable-workflow call: on
develop run 39490850802, the Windows distribution failed while the Linux tests
still ran and reported, and the Linux JVM tests (57 minutes) are the longest
path. A flat matrix would have skipped them, or started them 20 minutes later.
It lists every difference of `cmp-1d.md` with its D-number.

- [ ] **Step 7: Prove the clean-build path with a dispatch**

The PR run never cleans: it has no `CI: Clean build required` label, and it is
not on `develop`. Start the same workflow by hand with a clean build:

```bash
gh workflow run engine-checks.yml --ref ci/hand-written-engine-checks -f clean_build_required=true
gh run list --workflow engine-checks.yml --branch ci/hand-written-engine-checks --event workflow_dispatch --limit 1 --json databaseId,url --jq '.[0]'
```

Expected:

- In every job, the `git-clean` steps of "Clean before" and "Clean after" run,
  rather than being skipped, and succeed.
- The job conclusions match the PR run's.
- The two runs do not cancel each other: their concurrency groups differ by
  workflow name.

- [ ] **Step 8: Compare the job conclusions with develop**

```bash
pr_run=$(gh run list --workflow engine-pull-request.yml --branch ci/hand-written-engine-checks --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$pr_run" --json jobs --jq '.jobs[] | "\(.conclusion)\t\(.name | split(" / ") | last)"' | sort -k2 > "$SCRATCH/1d-jobs.txt"
```

Compare `1d-jobs.txt` with the ✨ Engine section of `$SCRATCH/baseline.md`,
ignoring the Build Script names. Expected: the same jobs with the same
conclusions, or better. A job that is red here but green on develop is this PR's
failure.

- [ ] **Step 9: Wait for CI, then merge**

`$SCRATCH/wait-pr.sh <N> 300` in the background.

- Exit 0, and the dispatch run green: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

### Task 10: Rewrite `ide-packaging.yml` with matrices (PR 1e)

**Files:**

- Modify: `.github/workflows/ide-packaging.yml` (whole file)

**Interfaces:**

- Consumes: the `build-script`, `setup-build-script`, `setup-node`, `setup-rust`
  and `git-clean` actions (Task 5).
- Produces matrix jobs over `linux`/`windows`:
  - `build-script` ("Build Script (<os>, amd64)");
  - `build-backend` ("Build Backend (<os>, amd64)", artifact `backend-<os>`,
    with "Edition File" and "fbs-schema" from Linux only);
  - `package-ide` ("Package New IDE (<os>, amd64)", artifact `ide-<os>`,
    `test-traces-<os>-amd64`).

  Plus `gui-build` ("GUI build (linux, amd64)", artifacts `gui` and
  `wasm-artifacts`). The triggers, `concurrency` and secrets are unchanged.
  `ide-pull-request.yml` ("IDE Required Checks") is not touched.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1e -b ci/hand-written-ide-packaging origin/develop
cd /c/Repos/Enso/ide-bs-1e && corepack pnpm install --frozen-lockfile --ignore-scripts
```

- [ ] **Step 2: Write the new `ide-packaging.yml`**

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
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
  # Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "${{ contains(github.event.pull_request.labels.*.name, 'CI: Clean build required') || github.ref == 'refs/heads/develop' || inputs.clean_build_required == true }}"

# Note [Platform Legs Run Despite The Other Platform's Failure]
# ============================================================
# A matrix job needs every leg of the matrix job before it, so by default a Windows backend that
# fails would skip the Linux packaging too. `if: ${{ !cancelled() }}` lets each leg run anyway; a
# leg whose own input failed then fails at its download step. The Linux legs still wait for the
# slower Windows ones, which does not lengthen the run: the Windows legs are its longest path.

jobs:
  build-script:
    name: Build Script (${{ matrix.os }}, amd64)
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
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Compile the build script
        uses: ./.github/actions/build-script

  build-backend:
    name: Build Backend (${{ matrix.os }}, amd64)
    needs: [build-script]
    # See Note [Platform Legs Run Despite The Other Platform's Failure].
    if: ${{ !cancelled() }}
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
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - name: Restore sbt / Coursier downloads
        uses: actions/cache/restore@v4
        with:
          key: sbt-deps-${{ runner.os }}-${{ hashFiles('**/*.sbt', 'project/build.properties', 'project/plugins.sbt', 'project/Dependencies.scala', 'build-config.yaml') }}
          path: |-
            ~/.sbt
            ~/.ivy2/cache
            ~/.cache/coursier
            ~/AppData/Local/Coursier/Cache
            ~/Library/Caches/Coursier
          restore-keys: sbt-deps-${{ runner.os }}-
      - run: ./run backend get
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: "!cancelled() && github.ref == 'refs/heads/develop'"
        name: Save sbt / Coursier downloads
        uses: actions/cache/save@v4
        with:
          key: sbt-deps-${{ runner.os }}-${{ hashFiles('**/*.sbt', 'project/build.properties', 'project/plugins.sbt', 'project/Dependencies.scala', 'build-config.yaml') }}
          path: |-
            ~/.sbt
            ~/.ivy2/cache
            ~/.cache/coursier
            ~/AppData/Local/Coursier/Cache
            ~/Library/Caches/Coursier
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
        run: tar -cvf backend.tar -C dist/backend .
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

  package-ide:
    name: Package New IDE (${{ matrix.os }}, amd64)
    needs: [build-script, build-backend, gui-build]
    # See Note [Platform Legs Run Despite The Other Platform's Failure].
    if: ${{ !cancelled() }}
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
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
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
        run: ./run ide build --backend-source local --gui-source local --gui-upload-artifact false
        env:
          ENSO_IDE_AG_GRID_LICENSE_KEY: ${{ vars.ENSO_AG_GRID_LICENSE_KEY }}
          ENSO_IDE_GOOGLE_ANALYTICS_TAG: ${{ vars.ENSO_CLOUD_GOOGLE_ANALYTICS_TAG }}
          ENSO_IDE_HOST: ${{ vars.ENSO_HOST }}
          ENSO_IDE_SENTRY_DSN: ${{ vars.ENSO_CLOUD_SENTRY_DSN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - if: matrix.os == 'windows'
        run: ./run ide build --backend-source local --gui-source local --gui-upload-artifact false
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

- [ ] **Step 3: Lint, check, compare**

Run the Task 6, Step 7 commands, then:

```bash
node tools/ci/compare-workflows.mjs --base origin/develop \
  --rename "Build Script [ubuntu-latest]=Build Script (linux, amd64)" \
  --rename "Build Script [windows-latest]=Build Script (windows, amd64)" \
  ide-packaging.yml > "$SCRATCH/cmp-1e.md"
git diff --quiet origin/develop -- .github/workflows/ide-pull-request.yml && echo AGGREGATOR-UNCHANGED
```

Expected:

- actionlint is clean.
- The policy check passes. `checkWindowsInstallerSmokeTest` sees the smoke
  step's `matrix.os == 'windows'`, after "Upload ide".
- `cmp-1e.md` matches all 7 jobs by name. The differences are exactly D1, D2,
  D3, D4, and D8 (each leg also needs the other platform's legs, and has
  `if: !cancelled()`).
- "GUI build" differs only by D4. Each "Package New IDE" leg's steps are
  otherwise identical, Windows signing env and smoke test included.
- The last command prints `AGGREGATOR-UNCHANGED`.

- [ ] **Step 4: Commit, push, open PR 1e**

```bash
git add .github/workflows/ide-packaging.yml
git commit -m "Hand-write IDE packaging with platform matrices"
git push -u origin ci/hand-written-ide-packaging
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1e: hand-written IDE packaging" --body-file "$SCRATCH/pr1e.md"
```

The body explains D8 with the numbers from develop run 39473904433:

- the Linux backend took 22 minutes and the Windows one 41;
- the Linux packaging now starts after the Windows backend, but finishes at
  about 19:15, against 19:18 for the Windows packaging, so the run is no longer.

It lists every difference with its D-number.

- [ ] **Step 5: Prove the clean-build path with a dispatch**

```bash
gh workflow run ide-packaging.yml --ref ci/hand-written-ide-packaging -f clean_build_required=true
```

Expected: the "Clean before" and "Clean after" steps run in the Build Backend
and Package New IDE legs and succeed, and the conclusions match the PR run's.

- [ ] **Step 6: Compare the job conclusions with develop, then merge**

Do as Task 9, Step 8 with `ide-pull-request.yml` and the ✨ IDE section of the
baseline. Then run `$SCRATCH/wait-pr.sh <N> 240` in the background.

- Exit 0, and the dispatch run green: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

### Task 11: Rewrite the two benchmark workflows (PR 1f)

**Files:**

- Modify: `.github/workflows/engine-benchmark.yml`,
  `.github/workflows/std-libs-benchmark.yml` (whole files)

**Interfaces:**

- Keeps the workflow names "Benchmark Engine" and "Benchmark Standard
  Libraries": `bench-upload.yml`'s `workflow_run` trigger keys on them. Also
  keeps the inputs (`bench-name`, `just-check`), the env contract
  (`ENSO_BUILD_BENCH_NAME`, `ENSO_BUILD_MINIMAL_RUN`), `timeout-minutes: 240`,
  and the artifact `benchmark-results.xml`.

- [ ] **Step 1: Create the worktree**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1f -b ci/hand-written-benchmarks origin/develop
cd /c/Repos/Enso/ide-bs-1f && corepack pnpm install --frozen-lockfile --ignore-scripts
```

- [ ] **Step 2: Write `engine-benchmark.yml`**

<!-- prettier-ignore -->
```yaml
# Hand-written. Runs the engine's runtime benchmarks when started by hand; `bench-upload.yml`
# publishes the results when a run completes (it keys on this workflow's name).

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
  ENSO_BUILD_BENCH_NAME: ${{ inputs.bench-name }}
  ENSO_BUILD_MINIMAL_RUN: ${{ true == inputs.just-check }}
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
  # Benchmarks always start and end with a clean working tree. Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "true"

jobs:
  build-script:
    name: Build Script (linux, amd64)
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Compile the build script
        uses: ./.github/actions/build-script

  benchmark-engine-graal-vm-ce:
    name: Benchmark Engine (GraalVM CE)
    needs: [build-script]
    runs-on: ubuntu-latest
    timeout-minutes: 240
    env:
      GRAAL_EDITION: GraalVM CE
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - run: ./run backend benchmark runtime
        env:
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
# publishes the results when a run completes (it keys on this workflow's name).

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
  ENSO_BUILD_BENCH_NAME: ${{ inputs.bench-name }}
  ENSO_BUILD_MINIMAL_RUN: ${{ true == inputs.just-check }}
  ENSO_BUILD_SKIP_VERSION_CHECK: "true"
  # Benchmarks always start and end with a clean working tree. Read by `.github/actions/git-clean`.
  ENSO_CI_CLEAN_BUILD: "true"

jobs:
  build-script:
    name: Build Script (linux, amd64)
    runs-on: ubuntu-latest
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Compile the build script
        uses: ./.github/actions/build-script

  benchmark-standard-libraries-graal-vm-ce:
    name: Benchmark Standard Libraries (GraalVM CE)
    needs: [build-script]
    runs-on: ubuntu-latest
    timeout-minutes: 240
    env:
      GRAAL_EDITION: GraalVM CE
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
      - name: Set up the build script
        uses: ./.github/actions/setup-build-script
      - name: Clean before
        uses: ./.github/actions/git-clean
      - run: ./run backend benchmark enso-jmh
        env:
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

- [ ] **Step 4: Lint, check, compare**

Run the Task 6, Step 7 commands, then:

```bash
node tools/ci/compare-workflows.mjs --base origin/develop --rename "Build Script=Build Script (linux, amd64)" engine-benchmark.yml std-libs-benchmark.yml > "$SCRATCH/cmp-1f.md"
```

Expected: actionlint is clean. The differences are exactly:

- D1 and D2;
- D4 (`ENSO_CI_CLEAN_BUILD: "true"`);
- D9 ("Clean before" is no longer `always()`).

- [ ] **Step 5: Commit, push, open PR 1f**

```bash
git add .github/workflows/engine-benchmark.yml .github/workflows/std-libs-benchmark.yml
git commit -m "Hand-write the benchmark workflows"
git push -u origin ci/hand-written-benchmarks
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1f: hand-written benchmark workflows" --body-file "$SCRATCH/pr1f.md"
```

- [ ] **Step 6: Run both benchmarks in check mode from the branch**

Neither workflow runs on a pull request. `gh workflow run --ref` runs the
branch's version of the file; the file must also exist on `develop`, and both
do.

```bash
gh workflow run engine-benchmark.yml --ref ci/hand-written-benchmarks -f just-check=true
gh workflow run std-libs-benchmark.yml --ref ci/hand-written-benchmarks -f just-check=true
```

Expected: both runs succeed, and each uploads `benchmark-results.xml`.

Each completion also starts `bench-upload.yml` from `develop`. It fails at
"Checkout engine-benchmark-results repository", as every run has since
2026-05-28: this repository has no `ENSO_BENCHMARK_RESULTS_TOKEN`, so nothing is
published. That failure is not this PR's.

If a benchmark run fails, start the same workflow on `develop` (same
`-f just-check=true`):

- if develop fails the same step, the failure is pre-existing: follow "When a
  check fails";
- if develop passes, fix this PR.

Record the run links in the PR body under "Validation".

- [ ] **Step 7: Wait for CI, then merge**

`$SCRATCH/wait-pr.sh <N> 240` in the background (IDE packaging and Workflow Lint
run).

- Exit 0, and both benchmark runs green: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

### Task 12: Retire the generator (PR 1g)

**Files:**

- Delete:
  - `build_tools/ci-gen/` (the crate and its `CLAUDE.md`);
  - `build_tools/build/src/ci_gen.rs` and `build_tools/build/src/ci_gen/`
    (`job.rs`, `step.rs`);
  - `build_tools/build/src/ci/input.rs`;
  - `build_tools/ci_utils/src/actions/workflow/definition.rs`;
  - `tools/ci/compare-workflows.mjs` and `tools/ci/compare-workflows.test.mjs`.
- Modify:
  - Rust: `Cargo.toml` (workspace members), `Cargo.lock`,
    `build_tools/build/src/lib.rs`, `build_tools/build/src/ci.rs`,
    `build_tools/build/src/release.rs`,
    `build_tools/build/src/release/manifest.rs`,
    `build_tools/ci_utils/src/actions/workflow.rs`;
  - docs and config: `CLAUDE.md`, `build_tools/CLAUDE.md`,
    `build_tools/build/CLAUDE.md`, `app/rust-ffi/CLAUDE.md`,
    `app/rust-ffi/Cargo.toml` (comment), `.vscode/launch.json`,
    `.github/CLAUDE.md`;
  - the "keep in step with `PR_IGNORED_PATHS`" comments in
    `engine-pull-request.yml`, `gui-pull-request.yml`, `ide-pull-request.yml`,
    `wasm-pull-request.yml`, `formatting.yml` and, if present,
    `macos-pull-request.yml`.

**Interfaces:**

- Produces `enso_build::release::manifest::RELEASE_TARGETS: [(OS, Arch); 3]`,
  moved from `enso_build::ci_gen`.
- `./run` keeps building and running.

- [ ] **Step 1: Check the preconditions (the failing check)**

```bash
cd /c/Repos/Enso/ide && git fetch origin
gh pr list --state open --json number,headRefName --jq '.[] | select(.headRefName | startswith("ci/hand-written") or startswith("ci/workflow-foundations")) | "\(.number) \(.headRefName)"'
gh pr view 288 --json state --jq .state
git grep -l "This file is auto-generated" origin/develop -- .github/workflows
```

Expected:

- no open `ci/hand-written-*` PRs (1b–1f merged);
- #288 is `MERGED` or `CLOSED`;
- no generated file left, except `macos-checks.yml` if #288 merged after PR 1a.

If a 1b–1f PR is still open, or #288 is open, stop here and report: deleting
`ci_gen.rs` now would leave #288 with a modify/delete conflict. If
`macos-checks.yml` (or any file #288 regenerated) still has the generated
header, Step 3 gives it the Task 6, Step 3 header.

- [ ] **Step 2: Create the worktree; inventory the Rust tests**

```bash
git -C /c/Repos/Enso/ide worktree add /c/Repos/Enso/ide-bs-1g -b ci/retire-ci-gen origin/develop
cd /c/Repos/Enso/ide-bs-1g && corepack pnpm install --frozen-lockfile --ignore-scripts
git grep -n -A1 "#\[test\]" -- build_tools/build/src/ci_gen.rs build_tools/build/src/ci_gen | grep "fn "
```

Expected: every test named is in Task 4's porting table (six, or nine with
#288). If one is not, port it before going on: add a rule and a test to
`tools/ci/check-workflows.mjs` and its tests, in the same style, and add a row
to the table in the PR body. Then run:

```bash
node --test tools/ci/check-workflows.test.mjs && node tools/ci/check-workflows.mjs
```

Expected: pass, and `Workflow policy: OK`.

- [ ] **Step 3: Give any remaining generated file the hand-maintained header**

Apply Task 6, Step 3 to any file still listed by
`git grep -l "This file is auto-generated" -- .github/workflows`. Expected
afterwards: that command prints nothing.

- [ ] **Step 4: Move `RELEASE_TARGETS` out of `ci_gen`**

In `build_tools/build/src/release/manifest.rs`, after
`ASSETS_MANIFEST_FILENAME`, add the constant. Copy its value from `ci_gen.rs` as
it stands: on 2026-10-20 it is the one below.

```rust
/// The platforms a release ships an IDE installer for. `.github/workflows/release.yml` builds and
/// uploads one for each; keep the two in step.
pub const RELEASE_TARGETS: [(OS, Arch); 3] =
    [(OS::Windows, Arch::X86_64), (OS::Linux, Arch::X86_64), (OS::MacOS, Arch::AArch64)];
```

Then, in the same file:

- `for (os, arch) in crate::ci_gen::RELEASE_TARGETS {` becomes
  `for (os, arch) in RELEASE_TARGETS {`;
- `(see \`add_release_steps\` in \`ci_gen\`)`becomes`(see
  \`.github/workflows/release.yml\`)`.

In `build_tools/build/src/release.rs`, change the comment's
``(see `add_release_steps`)`` to ``(see `.github/workflows/release.yml`)``.

- [ ] **Step 5: Delete the generator and the code only it used**

```bash
git rm -q -r build_tools/ci-gen build_tools/build/src/ci_gen build_tools/build/src/ci_gen.rs build_tools/build/src/ci/input.rs build_tools/ci_utils/src/actions/workflow/definition.rs
git rm -q tools/ci/compare-workflows.mjs tools/ci/compare-workflows.test.mjs
```

Then unhook them:

- `Cargo.toml`: delete the workspace member line `"build_tools/ci-gen",`.
- `build_tools/build/src/lib.rs`: delete `pub mod ci_gen;`.
- `build_tools/build/src/ci.rs`: delete `pub mod input;` and the now-empty
  `// === Export ===` banner above it. In the `BUILD_IDE` doc comment, replace
  `The generated workflows do not use it: it is matched in the hand-written`
  with `It is matched in the hand-written`.
- `build_tools/ci_utils/src/actions/workflow.rs`: delete `pub mod definition;`.

Check that nothing else used them:

```bash
git grep -n -E "ci_gen|ci::input|workflow::definition|enso-build-ci-gen" -- ':!docs/superpowers/**'
```

Expected: no Rust or TOML hits. The remaining hits are the docs and comments of
Steps 6 and 7, and they go there.

- [ ] **Step 6: Build and test on Windows**

```bash
cargo build -p enso-build-cli
cargo test -p enso-build -p ide-ci
cargo fmt -- --check
cargo clippy -p enso-build -p ide-ci -p enso-build-cli --all-targets 2>&1 | grep -E "^(warning|error)" | sort | uniq -c
./run --help >/dev/null && echo RUN-OK
git diff --stat Cargo.lock
```

Expected:

- the build succeeds, and `Cargo.lock` drops the `enso-build-ci-gen` package;
- the tests pass, the generator's tests now being gone;
- fmt is clean;
- clippy shows no warning that the same command on `origin/develop` does not.
  Measure that first, in the `ide` worktree on develop: clippy is a convention
  here, not a CI gate;
- `RUN-OK`.

Do not run `cargo test --workspace` on Windows. Its known `ide-ci` tar failure
is in CLAUDE.md; the workspace run is Step 8, on Linux.

- [ ] **Step 7: Point the docs and comments at the hand-written workflows**

- `CLAUDE.md`, in "PR CI skips the GUI checks…", replace

  ```
  Changelog: `paths-ignore` lists it in each `pull_request` trigger, generated
  from `PR_IGNORED_PATHS` in `build_tools/build/src/ci_gen.rs` and copied by
  hand into the hand-written workflows. No check is required by the ruleset, so
  nothing is left waiting.
  ```

  with

  ```
  Changelog: `paths-ignore` lists it in each `pull_request` trigger, and
  `tools/ci/check-workflows.mjs` (run by the Workflow Lint check) fails a
  workflow that forgets it. No check is required by the ruleset, so nothing is
  left waiting.
  ```

  and add after that bullet:

  ```
  - **The GitHub workflows are hand-written YAML** (the Rust generator was
    removed in Phase 1 of the build simplification). Shared steps live in
    `.github/actions/`, and the Workflow Lint check runs actionlint and the
    workflow policy on any change under `.github/`. See `.github/CLAUDE.md`.
  ```

- `build_tools/CLAUDE.md`:
  - delete the `ci-gen/` bullet (two lines);
  - in the `build/` bullet, change
    `(engine, GUI, IDE, backend, release, changelog, CI YAML generation inputs)`
    to `(engine, GUI, IDE, backend, release, changelog)`.
- `build_tools/build/CLAUDE.md`: replace the bullet
  ``- `ci/`, `ci_gen/`, `ci.rs`, `ci_gen.rs` — CI-matrix and GitHub Actions YAML generation inputs. Output is written by `enso-build-ci-gen`.``
  with ``- `ci.rs` — CI label names and the big-memory runner check.``
- `app/rust-ffi/CLAUDE.md`: replace
  ``in `build_tools/build/src/ci_gen/step.rs` (`install_wasm_bindgen`; regenerate `.github/workflows/ide-packaging.yml` with `cargo run -p enso-build-ci-gen`) and in the hand-maintained `.github/workflows/gui-checks.yml`.``
  with
  ``in the `wasm-bindgen-cli@…` steps of `.github/workflows/ide-packaging.yml` and `.github/workflows/gui-checks.yml`.``
- `app/rust-ffi/Cargo.toml`: replace the two comment lines
  ``# `build_tools/build/src/ci_gen/step.rs` (`install_wasm_bindgen`, which generates``
  /
  ``# `.github/workflows/ide-packaging.yml`) and `.github/workflows/gui-checks.yml`; move all of them together.``
  with
  ``# `.github/workflows/ide-packaging.yml` and `.github/workflows/gui-checks.yml`; move all of them together.``
- `.vscode/launch.json`: delete the `"Rust Gen CI"` configuration object (the
  six lines from `{` to `},` around
  `"cargo": ["run", "-p", "enso-build-ci-gen"]`).
- `.github/CLAUDE.md`: delete the **Status** paragraph.
- In `engine-pull-request.yml`, `gui-pull-request.yml`, `ide-pull-request.yml`,
  `wasm-pull-request.yml`, `formatting.yml` (and `macos-pull-request.yml` if
  present), replace the comment

  ```
      # Specs and plans alone start no checks; keep in step with `PR_IGNORED_PATHS` in
      # `build_tools/build/src/ci_gen.rs`.
  ```

  with

  ```
      # Specs and plans alone start no checks; every `pull_request` workflow ignores them
      # (`tools/ci/check-workflows.mjs` checks it).
  ```

  In `macos-pull-request.yml`, also replace "keep in step with
  `MACOS_RUNNER_WAIT_MINUTES` in `build_tools/build/src/ci_gen.rs`" with "keep
  in step with the `wait-for-macos-runner.sh` calls in `release.yml` and
  `engine-checks-nightly.yml`".

Then:

```bash
git grep -n -E "ci_gen|ci-gen|PR_IGNORED_PATHS|auto-generated" -- ':!docs/superpowers/**' ':!CHANGELOG.md'
corepack pnpm exec prettier --write CLAUDE.md build_tools/CLAUDE.md build_tools/build/CLAUDE.md app/rust-ffi/CLAUDE.md .github
corepack pnpm exec prettier --check CLAUDE.md build_tools/CLAUDE.md build_tools/build/CLAUDE.md app/rust-ffi/CLAUDE.md .github
```

Expected:

- the `git grep` hits only `.github/CLAUDE.md` ("the Rust generator
  (`build_tools/ci-gen`) is retired") and the hand-maintained headers ("the CI
  generator (`build_tools/ci-gen`)"), which are history and stay;
- Prettier passes.

- [ ] **Step 8: Verify on Linux, and lint**

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/ide-bs-1g && export CARGO_TARGET_DIR=$HOME/enso-target && cargo test --workspace 2>&1 | tail -15'
wsl -e bash -lc 'cd /mnt/c/Repos/Enso/ide-bs-1g && ~/tools/actionlint-1.7.12/actionlint -no-color -oneline -shellcheck ~/tools/shellcheck-v0.11.0/shellcheck && echo ACTIONLINT-CLEAN'
node tools/ci/check-workflows.mjs && node --test tools/ci/check-workflows.test.mjs
```

Expected:

- every test passes on Linux, including `ide-ci`'s tar test;
- `ACTIONLINT-CLEAN`;
- `Workflow policy: OK`, and the tests pass.

- [ ] **Step 9: Commit, push, open PR 1g**

```bash
git add -A
git commit -m "Remove the CI workflow generator; the workflows are hand-written"
git push -u origin ci/retire-ci-gen
gh pr create --base develop --label "CI: No changelog needed" \
  --title "Build simplification, PR 1g: remove the CI workflow generator" --body-file "$SCRATCH/pr1g.md"
```

The body contains:

- the deleted code, with line counts (`git diff --stat origin/develop`);
- the test-porting table, with any rows Step 2 added;
- the `RELEASE_TARGETS` move;
- the Linux and Windows verification;
- the attribution lines.

- [ ] **Step 10: Wait for CI, then merge**

`$SCRATCH/wait-pr.sh <N> 300` in the background. The change touches
`build_tools/**`, `Cargo.toml`, `Cargo.lock`, `app/rust-ffi/**` and
`.github/**`, so the WASM checks (`cargo test --workspace` on Linux), the engine
checks, IDE packaging, the GUI checks and Workflow Lint all run.

- Exit 0: `gh pr merge <N> --squash`.
- Otherwise follow "When a check fails".

After merging, remove the merged worktrees:

```bash
git -C /c/Repos/Enso/ide worktree remove /c/Repos/Enso/ide-bs-<x>
```

Do this for each worktree whose PR has merged. Never `--force` one that has
uncommitted changes; report it instead.

---

## Reference: intended differences

The comparison script prints these differences for a correct rewrite. A PR lists
each one it shows, with the reason given here. Anything not listed is a mistake.

| #   | Difference                                                                                                                                                                                                    | Reason                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | "Build Script" jobs are named "Build Script (<os>, amd64)" and have the job id `build-script`. The upload path is one expression with `.exe` on Windows.                                                      | Two jobs were both named "Build Script", which made the check list ambiguous. No workflow, ruleset or protection reads that name or id.                                                                                     |
| D2  | "Expose Artifact API and context information." runs after the checkout, not before.                                                                                                                           | It is inside `setup-build-script`, and a local action can only run once the repository is checked out. The step only exports three variables, which nothing reads before `./run`.                                           |
| D3  | Clean steps are `if: always() && env.ENSO_CI_CLEAN_BUILD == 'true'`, and "Clean after" adds an outer `always()`.                                                                                              | The label/`develop`/input condition is computed once per workflow. It has the same truth table. A composite action's own step needs `always()` to run when the job has already failed.                                      |
| D4  | Env `ENSO_CI_CLEAN_BUILD` is added; `ENSO_BUILD_SKIP_VERSION_CHECK` is dropped from `std-libs-labels.yml`.                                                                                                    | The former carries D3. The latter is read only by `./run`, which `std-libs-labels.yml` never calls.                                                                                                                         |
| D5  | `changelog.yml` drops the `inputs.clean_build_required` term from its clean condition.                                                                                                                        | A `pull_request`-only workflow has no inputs. actionlint flags it, and it always evaluated to null.                                                                                                                         |
| D6  | `std-libs-labels.yml`: the step id is `changed-files` (it was `<Library>-changed-files`), the list step reads its outputs from env vars, and the top-level `description:` key is gone.                        | One matrix job instead of 14 copies. Env vars rather than `${{ }}` inside a script, as GitHub's hardening guide advises. `description:` is not a workflow key (actionlint); GitHub ignored it.                              |
| D7  | The test reporter's `fail-on-empty` is written out (`true`; `false` for AWS, as before).                                                                                                                      | One matrix job for all the suites. `true` is `dorny/test-reporter`'s default.                                                                                                                                               |
| D8  | `ide-packaging.yml`: each matrix leg needs the whole previous matrix job, and has `if: ${{ !cancelled() }}`.                                                                                                  | Matrices. `!cancelled()` keeps a platform's legs running when the other platform fails: Note [Platform Legs Run Despite The Other Platform's Failure]. The run is no longer, because the Windows legs are its longest path. |
| D9  | Benchmarks: "Clean before" is no longer `always()`.                                                                                                                                                           | It goes through `git-clean`. It differs only when the set-up steps before it fail, and then the benchmark step is skipped anyway.                                                                                           |
| D10 | `engine-checks.yml` has no workflow `env`; `engine-checks-platform.yml` carries `ENSO_BUILD_SKIP_VERSION_CHECK`. In the GitHub UI, the check names gain a platform level ("⚙️ Checks / linux / JVM Tests …"). | A called workflow does not inherit its caller's env. The per-platform call keeps a platform's failure from skipping the other's tests (Task 9). No ruleset reads these names.                                               |
| D11 | `engine-changed-files.yml` lists `engine-checks-platform.yml` and `.github/actions/**`, instead of the non-existent `engine-checks-optional.yml`.                                                             | Changes to the new files must start the engine checks.                                                                                                                                                                      |

## Self-review against the spec

| Spec section / requirement                                                                                                                 | Task(s)                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase 0: delete `maven_install.json`, `stage-bazel-app.sh`, the unreferenced `tools/ci` JS                                                 | 1 (each proven unreferenced by `git grep` first)                                                                                                       |
| Phase 0: the Bazel mentions; correct CLAUDE.md's Bazel note                                                                                | 1 (README, CLAUDE.md; `BazelSupport` verified absent); the rest is listed (Ruling 14)                                                                  |
| Phase 0: fix `CONTRIBUTING.md` (nightly Rust, `package-lock.json`) and `build_tools/CLAUDE.md` (`install/`)                                | 2                                                                                                                                                      |
| Phase 0 gate: merge on green                                                                                                               | 2, Step 7                                                                                                                                              |
| Phase 1: hand-written workflows replace the 11 generated ones                                                                              | 7–11 (rewritten), 6 (header-only, Ruling 1), 12 (the generator is gone, and no file is left with a generated header)                                   |
| Phase 1: they still call `./run`, built by `setup-rust`                                                                                    | 5 (`build-script` = `setup-rust` + `cargo build`), 7–11                                                                                                |
| Phase 1: composite actions (`setup-node`, `setup-jvm`, `setup-rust`, `setup-msvc`)                                                         | 5: `setup-node`, `setup-rust`, plus the `./run` actions. `setup-jvm` and `setup-msvc` are not created, because no Phase 1 job uses them (Ruling 4)     |
| Phase 1: `strategy.matrix` for OS/arch                                                                                                     | 8, 9, 10                                                                                                                                               |
| Phase 1: reusable workflows (engine checks, IDE packaging)                                                                                 | 9 (`engine-checks-platform.yml`), 10 (still `workflow_call` from ✨ IDE)                                                                               |
| Phase 1: actionlint on `.github/**` changes                                                                                                | 6                                                                                                                                                      |
| Phase 1: delete `build_tools/ci-gen` and `enso_build::ci_gen`                                                                              | 12                                                                                                                                                     |
| Phase 1 gate: merge on green after a job-by-job comparison                                                                                 | 3 (script); 7–11 Step "compare"; Reference D1–D11                                                                                                      |
| Verification: a script lists job names, triggers, `needs`, commands and secrets for old and new; differences intended and listed in the PR | 3, and the PR bodies of 7–11                                                                                                                           |
| Verification: every workflow exercised once, by a PR or `workflow_dispatch`, before its predecessor is deleted                             | 7 (own runs, label on/off), 8 (own + probe PR), 9 and 10 (own + dispatch), 11 (dispatch); the header-only ones keep their content (nothing is deleted) |
| Required checks keep their exact names                                                                                                     | Global Constraints; no aggregator file is changed                                                                                                      |
| Required checks use `re-actors/alls-green`                                                                                                 | Deferred (Ruling 5)                                                                                                                                    |
| Unchanged: path gating, unrelated-label handling, secrets, labels                                                                          | 7–11 (comparison); the `*-pull-request.yml` and `*-changed-files.yml` files are untouched, except D11                                                  |
| Throughout: Linux and Windows, no `git stash`, no `--no-verify`, Prettier                                                                  | Global Constraints; 6, Step 7 and 12, Step 8 (WSL)                                                                                                     |
| Risk: required-check names                                                                                                                 | Kept; the ruleset requires none (Global Constraints)                                                                                                   |
| Out of scope: the parser build, new orchestrators, self-hosted runners                                                                     | Respected. #288's self-hosted Mac work is only coordinated with (Tasks 0, 2, 12)                                                                       |

**Spec references corrected against the code:**

- The spec counts 13 hand-written workflows. `bench-upload.yml` is one of them
  and has no generated header; it is untouched.
- The "dormant `BazelSupport` hooks" that CLAUDE.md mentions no longer exist:
  `git grep -i bazel -- build.sbt project/` is empty.
- `engine-changed-files.yml` listed a non-existent `engine-checks-optional.yml`
  (D11).
- `tools/CLAUDE.md` listed `docker/` and `releases/` under `tools/ci`. Neither
  exists (Task 2).

**Placeholder scan:**

- `<N>` and `<probe>` are PR numbers, known only once `gh pr create` prints
  them.
- `<run-id>` is printed by `gh run list`.
- `$SCRATCH` is the executing session's scratchpad.

There is no TBD or "similar to" anywhere; each task repeats the commands it
needs.

**Consistency:** the names used across tasks match:

- the composite action names `setup-node`, `setup-rust`, `build-script`,
  `setup-build-script`, `git-clean` and `download-engine-distribution`;
- `ENSO_CI_CLEAN_BUILD`;
- `engine-checks-platform.yml`'s inputs `os`, `runner`, `stdlib-suites` and
  `clean_build_required`;
- the policy functions in Task 4's table;
- the comparison script's flags `--base`, `--head-dir` and `--rename`.

**Tested before writing:**

- Every YAML file and script in this plan was run on 2026-10-20 against a copy
  of the repository at `a9cf4c3f9d`: actionlint 1.7.12 with shellcheck 0.11.0
  was clean, and Prettier passed. The policy check reported OK on the current
  workflows, on #288's branch, and on the rewritten set. Both test files pass
  (21 tests).
- The comparison of the rewritten workflows against `develop` showed exactly the
  differences D1–D11.

## Rulings

1. **Ruling:** five generated workflows get only a header change in Phase 1:
   `release.yml`, `promote.yml`, `nightly.yml`, `engine-checks-nightly.yml` and
   `extra-nightly-tests.yml` (and #288's `macos-checks.yml`). `bench-upload.yml`
   is untouched. The two benchmarks are rewritten, proven by
   `gh workflow run --ref` with `just-check`.
   - **Why:** the plan runs unattended overnight (controller decision 1). The
     release three publish, and only a release proves them, which is Phase 4
     with the user. `engine-checks-nightly.yml` needs the self-hosted Mac, which
     may be offline at night, and Oracle GraalVM jobs. `extra-nightly-tests.yml`
     needs Snowflake and Enso Cloud secrets the fork lacks. `bench-upload.yml`
     was never generated and publishes to another repository.
   - **Cost if wrong:** 3.5k lines stay in generator layout until Phase 2 or 4.
     They still work, and `actionlint.yaml` names the two findings it tolerates.
2. **Ruling:** the refactored pull-request workflows keep their triggers,
   concurrency groups, path gating, label handling, secrets, consumed artifact
   names, permissions, `continue-on-error` and `timeout-minutes`, and every job
   display name except "Build Script". The aggregator files are not touched. The
   live required checks were checked: the ruleset requires none, and classic
   protection is absent.
   - **Why:** controller decision 2. Nothing on GitHub keys on a check name
     today, but reviewers and the memory notes do.
   - **Cost if wrong:** low. A rename shows up in the comparison report before
     the merge.
3. **Ruling:** a job-by-job comparison script (`tools/ci/compare-workflows.mjs`,
   Node, tested) lives in the repository from PR 1a to PR 1g, then is deleted.
   Each PR pastes its report, every line classified D1–D11.
   - **Why:** controller decision 3, and the spec's verification. It has to
     survive across worktrees and sessions, so the scratchpad would not do. It
     is not shipped: 1g deletes it.
   - **Cost if wrong:** a missed difference reaches `develop`. Each PR's own CI
     run is the backstop.
4. **Ruling:** Phase 1 creates six composite actions:
   - `setup-node` and `setup-rust` (the spec's names);
   - `build-script` and `setup-build-script` (the existing "compile once per
     platform, download in each job" pattern);
   - `git-clean` and `download-engine-distribution`.

   It creates no `setup-jvm` or `setup-msvc`: `./run` still provisions GraalVM,
   sbt and MSVC in Phase 1, so nothing would use them. `setup-node` keeps the
   generator's behaviour, and the pnpm store cache waits for Phase 2. Steps keep
   their old shells: PowerShell on Windows, bash elsewhere.
   - **Why:** controller decision 4: build `./run` once per workflow, and create
     only the actions that are used.
   - **Cost if wrong:** Phase 2 adds `setup-jvm`/`setup-msvc` when jobs call sbt
     directly.

5. **Ruling:** the aggregators keep their own bash logic, and
   `re-actors/alls-green` is not adopted in Phase 1.
   - **Why:** the GUI and IDE aggregators fail when a changed-files gate did not
     succeed, treat a skipped or cancelled check as success only when it was not
     expected to run, and rename themselves on unrelated label events.
     alls-green's `allowed-skips` is close, but it fails a cancelled job that
     was not expected, and it cannot rename the check. The aggregator files are
     hand-written already, outside Phase 1's scope (controller decision 4: only
     if it changes nothing).
   - **Cost if wrong:** four ~25-line scripts stay. Adopting alls-green later is
     a separate PR.
6. **Ruling:** actionlint 1.7.12 runs as `docker://rhysd/actionlint:1.7.12`
   (released 2026-03-30, with shellcheck bundled), plus the policy check, in a
   new "Workflow Lint" workflow gated on `.github/**` and `tools/ci/**`.
   `.github/actionlint.yaml` ignores only the named `clean_build_required`
   findings in `release.yml` and `promote.yml` (until Phase 4). It also
   temporarily ignores those in `changelog.yml` and `std-libs-labels.yml`, which
   1b and 1c remove.
   - **Why:** controller decision 4: pinned, old enough, and consistent with the
     major-tag pinning used everywhere else. The hand-written findings
     (`formatting.yml`, `enso4igv.yml`) are fixed, not ignored, because both
     workflows run on PR 1a and prove the fix.
   - **Cost if wrong:** a newer shellcheck in the image could report more than
     0.11.0 did locally. Fix or narrowly ignore it in PR 1a.
7. **Ruling:** the generator's unit tests become a permanent policy check
   (`tools/ci/check-workflows.mjs`, run by Workflow Lint, with `node:test`
   tests), not part of the temporary comparison script. #288's three new tests
   are ported in advance, and each applies once its structure exists.
   - **Why:** controller decision 5. Those assertions guard the workflows after
     the generator is gone, and must keep running. "Release needs only
     `GITHUB_TOKEN`" is in fact "only the workflow token, code signing, Sentry
     and the runner-status token": `release.yml` reads `APPLE_*`,
     `MICROSOFT_CODE_SIGNING_*` and `SENTRY_AUTH_TOKEN` today, so the check is
     an allow-list of exactly those.
   - **Cost if wrong:** a rule too strict blocks a legitimate change. It is one
     function and one test to adjust.
8. **Ruling:** the scripts are plain Node ESM in `tools/ci/`, using a new
   exact-pinned root dev dependency, `yaml@2.9.1` (already in the lockfile).
   They are not a new `tools/build-scripts` package.
   - **Why:** Phase 1 needs two small scripts. The spec's TypeScript package,
     with tsx and vitest, belongs to Phase 3, and can absorb the policy check
     then.
   - **Cost if wrong:** Phase 3 moves one file and its test.
9. **Ruling:** the engine checks run as one reusable workflow per platform
   (`engine-checks.yml` calls `engine-checks-platform.yml` with a matrix), not
   as flat matrices.
   - **Why:** with flat matrices, every leg waits for the whole previous matrix
     job. On develop run 39490850802 the Windows distribution (40 minutes)
     failed while the Linux tests ran and reported. A flat matrix would have
     skipped them, or, with `!cancelled()`, started the 57-minute Linux JVM
     tests 20 minutes late, lengthening the run.
   - **Cost if wrong:** the check names gain a platform level (D10). Flattening
     later is mechanical.
10. **Ruling:** IDE packaging uses flat matrices with `if: ${{ !cancelled() }}`
    (D8).
    - **Why:** the GUI build is shared by both platforms, so a per-platform
      reusable workflow would have to wait for it before building the backend.
      Waiting for the Windows backend costs nothing, because the Windows legs
      are the longest path (develop run 39473904433: 41 against 22 minutes).
    - **Cost if wrong:** Linux packaging results arrive about 20 minutes later
      than before.
11. **Ruling:** a red check that develop shows too is never merged over. The PR
    stays open with the evidence, and the dependent PRs stack on it.
    - **Why:** controller decision 7 says merge on green. On 2026-10-20, develop
      was red on its Windows engine distribution and Windows backend, which
      every Phase 1 PR runs.
    - **Cost if wrong:** the user wakes to open PRs rather than merged ones,
      which is safe and reversible.
12. **Ruling:** PR 1g also deletes `ide_ci::actions::workflow::definition`
    (1,144 lines) and `enso_build::ci::input`, and moves `RELEASE_TARGETS` into
    `release/manifest.rs`. It waits until #288 has merged or closed.
    - **Why:** only the generator used the two modules. `release/manifest.rs` is
      the only other user of `RELEASE_TARGETS`. #288 edits `ci_gen.rs`, so
      deleting the file first would hand #288 a modify/delete conflict.
    - **Cost if wrong:** restore the modules from git. Phase 5 deletes
      `build_tools/` anyway.
13. **Ruling:** `ENSO_CI_CLEAN_BUILD` is a workflow-level env var, read by the
    `git-clean` action.
    - **Why:** a composite action cannot see the workflow's `inputs`, and the
      condition was copied into every clean step (two per job).
    - **Cost if wrong:** one more variable in every job's environment. Nothing
      else reads it: `git grep` finds no other use.
14. **Ruling:** Phase 0 removes the Bazel mentions in `README.md` and
    `CLAUDE.md` only, plus the line naming the deleted script. It leaves:
    - `app/electron-client/macos/README.md`'s Bazel workflow text and
      `build-dmg.mjs`'s `stageAppFromBazel`, which is dead code;
    - the historical comments in five source files.
    - **Why:** controller decision 6 names README and CLAUDE.md. Reworking the
      macOS DMG script needs a Mac, which an unattended run cannot test.
    - **Cost if wrong:** a few stale mentions remain, listed in PR 0 as a
      follow-up.
15. **Ruling:** PRs are validated by their own CI runs. A `pull_request` from a
    branch of this repository runs the PR's own workflow files and its local
    actions, after `actions/checkout`. On top of that:
    - `gh workflow run --ref` proves the dispatch-only and clean-build paths;
    - a throwaway draft PR proves std-libs labelling.
    - **Why:** controller decision 7. It was confirmed on #288, whose runs used
      its modified `gui-checks.yml`.
    - **Cost if wrong:** none for the merged PRs, which had to be green on their
      own files.
16. **Ruling:** the PR split is:
    - PR 0, the tidy-up;
    - 1a: actions, scripts, Workflow Lint, the header notes;
    - 1b changelog, 1c std-libs labels, 1d engine checks, 1e IDE packaging, 1f
      benchmarks;
    - 1g: delete the generator.

    Every PR has the `CI: No changelog needed` label and merges on green.
    - **Why:** controller decision 7. One workflow family per PR keeps each PR's
      CI run a test of exactly one rewrite.
    - **Cost if wrong:** more PRs to watch. They are independent after 1a.

17. **Ruling:** the standing rules hold in every task:
    - Linux verification: actionlint in WSL and in CI, `cargo test --workspace`
      in WSL;
    - no `git stash`, no `--no-verify`, no force push;
    - Prettier on every document touched;
    - the `CI: No changelog needed` label, never a CHANGELOG entry.
    - **Why:** controller decision 8 and CLAUDE.md. None of these changes is a
      feature or a visible style change, and several bug classes here show only
      on Linux.
    - **Cost if wrong:** none. These rules only add checks.
