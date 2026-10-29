# CI Speed — Design

Date: 2026-10-29. Status: approved in discussion, awaiting spec review.

## Goal

Shorten **time to green on a pull request**: the wall-clock time from a push to
its last check finishing. Runner-minutes matter less: the repository is public,
so hosted minutes are free.

Constraints:

- **Free GitHub-hosted runners only.** No larger (paid) runners, no self-hosted
  runners. Every gain comes from restructuring, caching and skipping work.
- **A PR may run less than develop.** A PR's checks may skip what its changed
  files cannot affect. **develop keeps running everything** after every merge,
  and that run is the safety net.

## Where the time goes today

Measured on 2026-10-29 from ~70 runs (one day's sample, ±10%):

| Scenario                              | Push to green | Critical path                                                                                               |
| ------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Engine change                         | 75–80 min     | Build Engine Distribution (Linux 24, Windows 23–35) → slowest test leg (Linux Std Lib JVM 53, JVM Tests 49) |
| App/GUI change with IDE packaging     | 45–50 min     | IDE Build Backend, Windows (23–38) → Package New IDE, Windows (11)                                          |
| GUI change, tests only                | 14 min        | Prettier → Build WASM → Lint GUI (4–5) → Playwright (7) → merge reports                                     |
| develop push (everything, not a gate) | 85–127 min    | the full matrix                                                                                             |

Queue time is negligible and the sbt dependency cache always hits. The time goes
into work that is slow, duplicated or unneeded:

- `Examples_Tests` compiles numpy 2.2.6 from source with GraalPy's pip on Linux:
  12–13 minutes, against 2–6 seconds on the other legs.
- The standard library test projects run one after another in one job:
  `Table_Tests` takes 16–19 minutes, `DuckDB_Tests` 6–7, `Base_Tests` 3–5,
  everything else under a minute.
- Linux `JVM Tests` rebuilds the ydoc native image (7 min) that the build job
  already built, compiles and runs the benchmarks (7 min), and builds the Rust
  WASM parser in `pnpm install` (3 min) without needing it.
- App-only PRs rebuild the engine backend from scratch (24 min Linux, 23–38
  Windows) although it is identical to develop's. Half of the recent PRs were
  app-only.
- Engine PRs build the engine bundle twice per OS at the same time: once in the
  Engine workflow, once in IDE packaging.
- No engine or IDE job caches Rust: every `pnpm install` recompiles 100+ crates.
- No engine job sets `timeout-minutes`, so a hang runs for the default 6 hours
  (#406's 2-hour hang, #409).
- Fifteen `*-change-labels` jobs each take a runner on every push.

## Targets

| Scenario                      | Today     | Target                          |
| ----------------------------- | --------- | ------------------------------- |
| App/GUI change with packaging | 45–50 min | **≤ 25 min**                    |
| Engine change                 | 75–80 min | **≤ 55 min** (≤ 40 if 2c works) |
| GUI change, tests only        | 14 min    | **≤ 10 min**                    |
| Longest a hung job can run    | 6 h       | **≤ 1.5 h**                     |

Medians, measured by re-running the timing analysis on the ~10 PRs after each
phase lands.

## Rules for skipping work (the safety net)

1. A PR's checks may skip only what its changed files cannot affect.
2. develop always runs every job and every test project.
3. A develop failure gets a ticket and is fixed (or the cause reverted) before
   other work, as now.
4. Every skip is visible: the job summary of the job that decided it says what
   was skipped and why (for example "Build Backend skipped: no engine files
   changed; using develop run 123456 at abc1234").

## Phase 1: quick wins

Five independent changes, one PR each.

### 1a. App-only PRs package with develop's backend

In `ide-packaging.yml`, `Build Backend` runs only when `engine-changed-files`
reports engine changes, or on develop, or for a release. Otherwise
`Package New IDE` downloads the backend from a develop run of the same workflow,
the way `gui-checks.yml` already downloads develop's engine distribution
(`actions: read`, newest unexpired artifact from develop).

The backend chosen is the newest develop artifact **whose commit is an ancestor
of the PR's head commit**, not simply the newest: a PR that is behind develop
must not be packaged with a newer engine whose protocol its GUI does not know.
If none of the recent develop runs qualifies (all expired, or the PR branched
before them), the job builds the backend as today. The job summary names the run
and commit used.

### 1b. Time limits

Every engine job gets `timeout-minutes`: 90 for test jobs, 45 for build jobs, 30
for the rest (about 1.7× today's p90). `tools/ci/check-workflows.mjs` gains a
rule that every job in a hand-written workflow sets `timeout-minutes`, with a
test, so new jobs cannot forget it.

### 1c. numpy for `Examples_Tests`

First establish why only Linux compiles numpy from source (most likely no
prebuilt wheel matches GraalPy on Linux). Fix that cause where possible;
otherwise cache GraalPy's pip wheel cache (or the built environment), keyed on
the GraalPy version and the requirement, saved on develop only like the sbt
cache.

### 1d. Playwright does not wait for lint

The Playwright shards depend on `build-wasm` only. Lint still gates the GUI
result through the aggregator job, so a lint failure still fails the PR.

### 1e. One label job

The fifteen `*-change-labels` jobs become one job that applies every label.
Check first that nothing (rulesets, aggregators, `needs:`) depends on the
individual job names. This saves runner-minutes and clutter, not time to green.

## Phase 2: the engine test path

Starts after phase 1 is measured.

### 2a. Shard and select the standard library tests

Each standard library test leg runs as three parallel shards, using
`stdlib-test --only`: `Table_Tests`; `Base_Tests` + `DuckDB_Tests` +
`Cloud_Tests`; everything else. The longest shard is then `Table_Tests` (~19
min), so a leg drops from 35–53 minutes to about 20–22.

On a PR, the projects that run are selected from the changed files:

- the engine, shared `std-bits/` code, `Standard.Base`, or the test harness →
  every project;
- only `distribution/lib/Standard/<Lib>/` or `std-bits/<lib>/` → that library's
  test project **and the test projects of every library that depends on it**
  (Table pulls in Database, DuckDB, Snowflake and the others).

The library → test project map and the dependency relation live in one file
under `tools/ci/`. `check-workflows.mjs` fails when a library under
`distribution/lib/Standard/` has no entry, so a new library cannot be silently
skipped. develop always runs every project. The job summary lists which projects
ran and why.

### 2b. Slim `JVM Tests`

- Use the ydoc native image from the build job's artifact instead of rebuilding
  it (−7 min Linux).
- Move the benchmark compile and run into a separate job that runs in parallel
  (−7 min on the path).
- Skip the Rust WASM build in this job's `pnpm install` if the tests do not need
  it (−3 Linux, −4 Windows).

The 18-minute runtime suite stays one piece: splitting it needs harness changes
and is a separate ticket if wanted.

### 2c. Start the JVM tests without waiting for the build (investigation)

Establish whether `sbt test` needs the built distribution. If it does not,
`JVM Tests` no longer `needs:` the build job and starts at once (up to −20 min
on engine PRs). If it does, record why and stop.

### 2d. Rust cache

Add `Swatinem/rust-cache` to the engine and IDE jobs that compile the parser,
saved on develop only (−3 to −5 min on the build jobs, which are on the critical
path). It must fit the cache budget that #314 (PR #416) frees.

## Phase 3: one shared engine build (outline)

Engine PRs build the bundle once per OS and feed both the tests and the IDE
packaging. The Engine and IDE workflows are separate runs, so `needs:` cannot
join them. Two options to compare then: a parent PR workflow calling both as
reusable workflows, or the engine build job also producing the IDE backend
artifact and packaging waiting for it. This mostly saves runner-minutes (~85
weighted per engine PR), so it comes last and gets its own short design once
phases 1 and 2 have landed.

## Out of scope

- Paid or self-hosted runners.
- Running less on develop. Gating develop pushes on changed files would save the
  most runner-minutes, but it weakens "develop is green at every merge commit";
  not doing it.
- Making slow tests faster (the runtime suite, `Table_Tests` itself).

## Verification

CI changes cannot be unit-tested like code, so each PR:

1. passes the Workflow Lint check (actionlint, `check-workflows.mjs` and its
   tests); new policy rules get tests;
2. shows the change working on its own run — 1a's PR is app-only, so its own
   packaging must use a develop backend and say so in the summary; a selection
   PR gets a throwaway test PR that touches one library to show only the right
   projects run;
3. is followed by a green develop run after merge; a develop failure caused by
   the change is fixed or reverted immediately;
4. records its before and after timings in the PR.

## Rollout

- Phase 1's five changes run in parallel (Sonnet agents in separate worktrees,
  one PR each). They touch the same workflow files, so they merge one at a time,
  merging develop into the next in between.
- A Haiku agent re-measures after each phase against the targets.
- Phase 2 starts after phase 1 is measured; phase 3's design after phase 2.
- `.github/CLAUDE.md` and the wiki's CI-and-Workflows page describe the skip
  rules, the develop backend reuse, the test map (and how to add a library to
  it) and the time limits.

These are CI and tooling changes, invisible to users: every PR takes the
`CI: No changelog needed` label.
