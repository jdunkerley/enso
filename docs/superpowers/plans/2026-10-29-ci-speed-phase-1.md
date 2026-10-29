# CI Speed Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 of the CI speed design: five independent workflow changes that
shorten time to green on pull requests.

**Architecture:** Each task is one PR against `develop`, made in its own
worktree on its own branch, so the five can run in parallel. They touch some of
the same files under `.github/`, so they merge one at a time, merging `develop`
into the next one in between.

**Tech Stack:** GitHub Actions (hand-written YAML, composite actions), `gh` CLI,
Node test runner (`node --test`) for `tools/ci/check-workflows.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-29-ci-speed-design.md` (Phase 1,
sections 1a–1e, and the Verification and Rules sections).

## Global Constraints

- Free GitHub-hosted runners only.
- A PR may skip only what its changed files cannot affect; **develop and
  releases always run everything** (`github.event_name != 'pull_request'` keeps
  every job).
- Every skip is visible in the job summary (`$GITHUB_STEP_SUMMARY`) of the job
  that decided it, naming what was skipped and why.
- Follow `.github/CLAUDE.md`: actions pinned by major tag; composite steps keep
  their shell; aggregator names ("IDE Required Checks", "GUI Required Checks",
  "Engine Required Checks") unchanged; every `pull_request` trigger keeps
  `paths-ignore: ["docs/superpowers/**"]`.
- Every PR: label `CI: No changelog needed`; body via `--body-file`; "Closes"
  the ticket if one exists, otherwise "Part of the CI speed design (#417)";
  record before/after timings of the affected jobs in the PR.
- Check every workflow change with `node tools/ci/check-workflows.mjs`,
  `node --test tools/ci/*.test.mjs`, and actionlint (the WSL command in
  `.github/CLAUDE.md`, or the PR's Workflow Lint check if WSL is unavailable —
  say which).
- Never run `git stash` yourself; never force-push; leave
  `.claude/settings.local.json` out of commits.

---

### Task 1: App-only PRs package with develop's backend (spec 1a)

Branch `ci/reuse-develop-backend`.

**Files:**

- Modify: `.github/workflows/ide-packaging.yml` (new `build_backend` input;
  `build-backend` job `if:`; new `find-backend` job; `package-ide` download
  step)
- Modify: `.github/workflows/ide-pull-request.yml` (pass the input)
- Modify: `.github/CLAUDE.md` (describe the reuse)

**Interfaces:**

- Produces: `ide-packaging.yml` `workflow_call` input `build_backend: boolean`
  (default `true`).
- Produces: job `find-backend` with output `run-id` (the develop run whose
  `backend-<os>` artifacts to use; empty when `build-backend` runs).

- [ ] **Step 1: Add the input.** In `ide-packaging.yml` under `workflow_call`:

```yaml
workflow_call:
  inputs:
    build_backend:
      description: >-
        Build the backend. When false (a PR that changes no engine file), the
        packaging uses the backend of the newest develop run whose commit is an
        ancestor of the PR's head.
      type: boolean
      default: true
```

Add the same input (`type: boolean`, `default: true`) under `workflow_dispatch`
too. Without it a hand-started run has no `inputs.build_backend`, and in Actions
expressions `null == false` is **true** (both coerce to 0), so the backend would
silently not be built.

- [ ] **Step 2: Gate `build-backend`.**

```yaml
build-backend:
  if: ${{ inputs.build_backend != false }}
```

- [ ] **Step 3: Add `find-backend`.** A Linux job, run only when the backend is
      not built. It lists unexpired `backend-linux` artifacts from develop runs
      (newest first), and picks the first whose commit is an ancestor of the PR
      head, using the compare API (`status` of `<sha>...<head>` is `ahead` or
      `identical`). It requires both `backend-linux` and `backend-windows` to
      exist in that run. If none qualifies among the first 30 candidates, it
      fails with a clear error naming the fixes: merge develop into the branch,
      or add the `CI: Build IDE` label (which builds the backend). Write the
      choice to the step summary.

```yaml
find-backend:
  name: Find develop's backend
  if: ${{ inputs.build_backend == false }}
  runs-on: ubuntu-latest
  timeout-minutes: 10
  outputs:
    run-id: ${{ steps.find.outputs.run-id }}
  steps:
    - id: find
      env:
        GH_TOKEN: ${{ github.token }}
        REPO: ${{ github.repository }}
        HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
      run: |
        candidates=$(gh api -X GET "repos/$REPO/actions/artifacts" -f name=backend-linux -f per_page=100 \
          --jq '[.artifacts[] | select(.expired | not) | select(.workflow_run.head_branch == "develop")
                 | "\(.workflow_run.id) \(.workflow_run.head_sha)"] | .[:30] | .[]')
        while read -r run_id sha; do
          [ -n "$run_id" ] || continue
          status=$(gh api "repos/$REPO/compare/$sha...$HEAD_SHA" --jq .status)
          case "$status" in ahead|identical) ;; *) continue ;; esac
          windows=$(gh api "repos/$REPO/actions/runs/$run_id/artifacts" \
            --jq '[.artifacts[] | select(.name == "backend-windows" and (.expired | not))] | length')
          [ "$windows" -ge 1 ] || continue
          echo "run-id=$run_id" >> "$GITHUB_OUTPUT"
          echo "Backend not built: no engine files changed. Using develop run [$run_id](https://github.com/$REPO/actions/runs/$run_id) at \`$sha\`." >> "$GITHUB_STEP_SUMMARY"
          exit 0
        done <<< "$candidates"
        echo "::error::No develop backend whose commit is an ancestor of $HEAD_SHA. Merge develop into the branch, or add the 'CI: Build IDE' label to build one."
        exit 1
```

Check the artifact retention of `backend-<os>` (no `retention-days` means the
repository default, 90 days); keep it.

- [ ] **Step 4: Point `package-ide` at it.** Add `find-backend` to `needs`, keep
      the existing `if:` and extend it so a failed `find-backend` skips
      packaging the same way a failed `gui-build` does. In "Download backend",
      add:

```yaml
with:
  name: backend-${{ matrix.os }}
  path: dist/backend
  run-id: ${{ needs.find-backend.outputs.run-id || github.run_id }}
  github-token: ${{ github.token }}
```

The `Edition File` and `fbs-schema` uploads stay in `build-backend` (only
`release.yml` reads its own copies).

- [ ] **Step 5: Pass the input from `ide-pull-request.yml`.**

```yaml
ide-packaging:
  uses: ./.github/workflows/ide-packaging.yml
  with:
    build_backend: >-
      ${{ github.event_name != 'pull_request'
          || needs.engine-changed-files.outputs.any_changed == 'true'
          || contains(github.event.pull_request.labels.*.name, 'CI: Build IDE')
      }}
```

`ide-pull-request.yml` needs `permissions: actions: read` (as
`gui-pull-request.yml` has) for the artifact API and cross-run download; add it
with a comment. Check `release.yml` and any other caller of `ide-packaging.yml`
still build (the default is `true`).

- [ ] **Step 6: Document.** In `.github/CLAUDE.md` "Where the build logic
      lives", add a row for `ide-packaging.yml › Find develop's backend` and a
      sentence under Conventions: app-only PRs package with the newest develop
      backend that is an ancestor of the PR head; the `CI: Build IDE` label or
      any engine change builds it.

- [ ] **Step 7: Verify.** Run the policy script and tests and actionlint. Open
      the PR: this PR changes only `.github/` and docs, so its IDE run must take
      the reuse path. Check in its run that `Build Backend` is skipped,
      `find-backend` names a develop run in the summary, both `Package New IDE`
      legs pass, and record the packaging wall time against a recent app-only PR
      (45–50 min). Then push an empty commit with the `CI: Build IDE` label
      added and confirm the backend is built.

- [ ] **Step 8: Commit, push, open the PR** ("Part of the CI speed design
      (#417)").

---

### Task 2: Time limits on every job, enforced by the policy (spec 1b)

Branch `ci/timeout-minutes`.

**Files:**

- Modify: `tools/ci/check-workflows.mjs` (new `checkJobsHaveTimeouts`, added to
  `CHECKS`)
- Modify: `tools/ci/check-workflows.test.mjs` (tests)
- Modify: every workflow under `.github/workflows/` with a job that has
  `runs-on` and no `timeout-minutes`
- Modify: `.github/CLAUDE.md` (Conventions)

**Interfaces:**

- Produces: `export function checkJobsHaveTimeouts({ workflows }): string[]`.

- [ ] **Step 1: Write the failing tests** in `check-workflows.test.mjs`, using
      the file's existing `fixture` helper:

```js
describe("checkJobsHaveTimeouts", () => {
  test("accepts runner jobs with timeout-minutes, and reusable-workflow calls", () => {
    const repo = fixture({
      "workflows/a.yml":
        "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps: []\n  b:\n    uses: ./.github/workflows/c.yml\n",
    });
    assert.deepEqual(checkJobsHaveTimeouts(repo), []);
  });
  test("rejects a runner job without timeout-minutes", () => {
    const repo = fixture({
      "workflows/a.yml":
        "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n",
    });
    assert.deepEqual(checkJobsHaveTimeouts(repo), [
      "workflows/a.yml: job `a` has no `timeout-minutes` (the default is 6 hours)",
    ]);
  });
});
```

Add `checkJobsHaveTimeouts` to the import list. Match the message format the
other checks use for the file name (look at what `fixture` keys produce in other
tests' messages and adjust the expected string to it).

- [ ] **Step 2: Run** `node --test tools/ci/check-workflows.test.mjs`. Expected:
      FAIL (`checkJobsHaveTimeouts` is not exported).

- [ ] **Step 3: Implement** in `check-workflows.mjs`, next to the other checks:

```js
/**
 * A job left without `timeout-minutes` runs for GitHub's default of 6 hours when it hangs (#406's
 * JVM tests hung for 2 hours until cancelled). Jobs that call a reusable workflow cannot set it;
 * the called workflow's jobs do.
 */
export function checkJobsHaveTimeouts({ workflows }) {
  const problems = [];
  for (const [file, { doc }] of Object.entries(workflows)) {
    for (const [id, job] of Object.entries(doc?.jobs ?? {})) {
      if (job?.uses || job?.["timeout-minutes"] !== undefined) continue;
      problems.push(
        `${file}: job \`${id}\` has no \`timeout-minutes\` (the default is 6 hours)`,
      );
    }
  }
  return problems;
}
```

Add it to `CHECKS`.

- [ ] **Step 4: Run the tests.** Expected: PASS. Then run
      `node tools/ci/check-workflows.mjs`: it now lists every job without a
      limit.

- [ ] **Step 5: Add the limits.** For each listed job: **90** for test jobs
      (`jvm-tests`, `stdlib-tests*`, Playwright already has 15 — keep existing
      values), **45** for build jobs (`build-engine-distribution`,
      `build-backend`, `gui-build`, release builds), **30** for everything else.
      For each job you set, compare with its p90 in
      `docs/superpowers/specs/2026-10-29-ci-speed-design.md` (or the job's
      recent runs, `gh run view <id> --json jobs`): the limit must be at least
      1.5× the slowest recent run; raise it if not and say so in the PR. Release
      jobs (`release.yml`): check their recent durations the same way.

- [ ] **Step 6: Run the policy script** until it prints `Workflow policy: OK`,
      and the tests. Run actionlint.

- [ ] **Step 7: Document** in `.github/CLAUDE.md` Conventions: every job sets
      `timeout-minutes` (90 tests, 45 builds, 30 otherwise), checked by
      `check-workflows.mjs`.

- [ ] **Step 8: Commit, push, open the PR.** In the PR, list each job's new
      limit next to its recent p90.

---

### Task 3: Cache pip's wheels for `Examples_Tests` (spec 1c)

Branch `ci/cache-numpy-wheel`.

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml` (`stdlib-tests` job,
  Linux only)
- Modify: `.github/CLAUDE.md` (cache note)

**Background:** `test/Examples_Tests/src/Python_Examples_Spec.enso` runs only on
Linux (by design: "numpy can be installed only on Linux"). It creates a GraalPy
venv and runs `pip install numpy`, which compiles numpy from source (no wheel
for GraalPy on PyPI): 12–13 minutes. pip caches the wheel it builds in
`~/.cache/pip`; the runner discards it.

- [ ] **Step 1: Confirm the cause.** In a recent Linux "Standard Library JVM
      Tests" log, find the `Collecting numpy … numpy-*.tar.gz` and
      `Building wheel for numpy` lines and the elapsed time. Confirm pip's cache
      directory on the runner is `~/.cache/pip` (pip's default on Linux; the
      venv's pip inherits it).

- [ ] **Step 2: Add the cache step** in `stdlib-tests`, after `setup-jvm` (which
      installs GraalPy and exposes the version as its `pins` step output — check
      the exact output name in `.github/actions/setup-jvm/action.yml`; if it is
      not exported, read `toolchain.graalpy` from `build-config.yaml` in a
      step):

```yaml
# Note [GraalPy Wheel Cache]
# Examples_Tests' Python spec pip-installs numpy into a GraalPy venv. PyPI has no wheel for
# GraalPy, so pip compiles it (12-13 min). pip keeps the built wheel in ~/.cache/pip; caching
# that directory lets later runs install it in seconds. Saved on develop only, like the sbt
# cache; keyed on the GraalPy version, as a wheel built for one GraalPy does not fit another.
- if: runner.os == 'Linux'
  name: Restore the GraalPy wheel cache
  uses: actions/cache/restore@v4
  with:
    path: ~/.cache/pip
    key: graalpy-pip-${{ runner.os }}-${{ steps.graalpy.outputs.version }}
```

and after the test step:

```yaml
- if: runner.os == 'Linux' && github.ref == 'refs/heads/develop'
  name: Save the GraalPy wheel cache
  uses: actions/cache/save@v4
  with:
    path: ~/.cache/pip
    key: graalpy-pip-${{ runner.os }}-${{ steps.graalpy.outputs.version }}
```

Use whatever step id provides the version (`steps.graalpy` above is a
placeholder name for that step; define it if you add a step). A save of an
existing key fails harmlessly; add `continue-on-error: true` to the save. Check
the entry size (expect tens of MB) fits the budget in `.github/CLAUDE.md`.

- [ ] **Step 3: Verify.** Run the policy script, its tests and actionlint. On
      the PR the cache misses (it is saved on develop only), so the PR shows no
      saving: after merge, check the next develop run saves the entry
      (`gh cache list | grep graalpy-pip`), then on the next PR that runs the
      Linux stdlib leg confirm `Examples_Tests` takes under a minute
      (`Using cached numpy-…whl`). Record both in the PR (as a comment after
      merge).

- [ ] **Step 4: Document** the cache in `.github/CLAUDE.md` next to the sbt
      cache note, and commit, push, open the PR.

---

### Task 4: Playwright does not wait for lint (spec 1d)

Branch `ci/playwright-parallel-lint`.

**Files:**

- Modify: `.github/workflows/gui-checks.yml:220-223` (the `playwright` job's
  comment and `needs:`)

- [ ] **Step 1: Change `needs`.**

```yaml
playwright:
  name: 🎭 Playwright Tests
  # Runs alongside lint. A lint failure still fails the GUI checks: `gui-pull-request.yml`'s
  # "GUI Required Checks" reads the result of this whole workflow.
  needs: [build-wasm]
```

- [ ] **Step 2: Check nothing else assumed the order.** Read `merge-reports` and
      `gui-pull-request.yml`'s aggregator: the aggregator reads
      `needs.gui-checks.result` (the called workflow), which is `failure` if any
      job fails, so a lint failure still fails "GUI Required Checks". Confirm by
      reading, and say so in the PR.

- [ ] **Step 3: Verify.** Policy script, tests, actionlint. The PR (it touches
      `gui-checks.yml`, so the GUI checks run) should show Playwright starting
      right after Build WASM; record GUI wall time against 13.6 min.

- [ ] **Step 4: Commit, push, open the PR.**

---

### Task 5: One label job instead of fourteen (spec 1e)

Branch `ci/one-label-job`.

**Files:**

- Modify: `.github/workflows/std-libs-labels.yml`
- Check: `.github/workflows/engine-pull-request.yml` (calls it as "🏷 Append
  labels to PR")

- [ ] **Step 1: Check dependants.** Grep `.github/` and `tools/ci/` for
      `change-labels`, `stdlib-api-check` and the "Append labels" job: nothing
      may `needs:` an individual leg or read its name. Check the repository
      ruleset requires no status check (`gh api repos/{owner}/{repo}/rulesets`).

- [ ] **Step 2: Replace the matrix job** with one job that finds every changed
      `docs/api` file once and adds every matching label. Skip it on pushes
      (labels only exist on PRs):

```yaml
jobs:
  stdlib-api-labels:
    name: Standard library API change labels
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checking out the repository
        uses: actions/checkout@v5
        with:
          clean: false
          fetch-depth: 2
      - id: changed-files
        name: Changed API files
        uses: step-security/changed-files@v45
        with:
          files: distribution/lib/Standard/*/**/docs/api/**/**.md
      - name: Add the labels
        if: steps.changed-files.outputs.any_changed == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR: ${{ github.event.pull_request.number }}
          FILES: ${{ steps.changed-files.outputs.all_changed_files }}
        run: |
          libraries=$(for f in $FILES; do echo "$f" | cut -d/ -f4; done | sort -u)
          for library in $libraries; do
            echo "-libs-API-change-$library"
            gh pr edit "$PR" --repo "${{ github.repository }}" --add-label "-libs-API-change-$library"
          done | tee -a "$GITHUB_STEP_SUMMARY"
```

A called workflow sees its caller's `github.event_name`, so from
`engine-pull-request.yml` on a develop push the job is skipped too. Keep the
`permissions:` block (`pull-requests: write`; `checks: write` only if still
needed — check). `cut -d/ -f4` takes the library from
`distribution/lib/Standard/<Library>/...`; check the path depth against a real
`docs/api` path.

- [ ] **Step 3: Verify.** Policy script, tests, actionlint. Make the PR's own
      run exercise it: the PR changes a workflow, not an API file, so the job
      runs and adds nothing. Then test the labelling with a throwaway branch
      that changes one line in a `docs/api` file of one library, opened as a
      draft PR: the right label appears; close it and delete the branch and the
      label from the throwaway PR.

- [ ] **Step 4: Commit, push, open the PR.** Record the runner-minutes saved (14
      jobs × ≥1 min → 1 job).

---

### After all five merge

- [ ] A Haiku agent re-runs the timing analysis on the next ~10 PRs (the method
      in the spec's measurement section) and compares with the targets: app/GUI
      with packaging ≤ 25 min, GUI-only ≤ 10 min. Report before phase 2 starts.
- [ ] Update the wiki's CI-and-Workflows page with the backend reuse, the time
      limits and the wheel cache.
