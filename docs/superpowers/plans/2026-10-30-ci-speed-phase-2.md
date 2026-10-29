# CI Speed Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of the CI speed design: shorten the engine test path by
sharding and selecting the standard library tests, slimming `JVM Tests`, caching
Rust, and finding out whether `JVM Tests` can stop waiting for the build.

**Architecture:** Eight tasks, each its own PR against `develop` from its own
worktree and branch. Tasks 1, 2 and 4–8 can be implemented in parallel; task 3
needs tasks 1 and 2 merged. Tasks 3–7 touch `engine-checks-platform.yml`, so
they merge one at a time, merging `develop` into the next in between (the order
is under "Merge order"). Task 8 is a time-boxed spike that ends in a written
go/no-go, not in a workflow change.

**Tech Stack:** GitHub Actions (hand-written YAML, composite actions), `gh` CLI,
Node test runner (`node --test`) for `tools/ci/*.mjs`, TypeScript run by Node
with vitest for `tools/build-scripts`, `Swatinem/rust-cache@v2`,
`taiki-e/install-action@v2`.

**Spec:** `docs/superpowers/specs/2026-10-29-ci-speed-design.md` (Phase 2,
sections 2a–2d, and the Rules, Targets, Verification and Rollout sections).

## Global Constraints

- Free GitHub-hosted runners only. No larger (paid) runners, no self-hosted
  runners added.
- "A PR's checks may skip only what its changed files cannot affect."
- "develop always runs every job and every test project." Every selection falls
  back to everything when `GITHUB_EVENT_NAME` is not `pull_request`, when the
  changed-file list is empty, and for any path the selection does not know.
- "Every skip is visible: the job summary of the job that decided it says what
  was skipped and why."
- Every job keeps (or, if new, gets) `timeout-minutes`: 90 for tests, 45 for
  builds, 30 otherwise, raised where the slowest recent run needs more than 1.5×
  headroom (`.github/CLAUDE.md`). `check-workflows.mjs` fails a job without one.
- Every workflow keeps its top-level `permissions:`; a job that needs more has
  its own block that repeats `contents: read`. A caller grants the union of what
  the workflows it calls need.
- Follow `.github/CLAUDE.md`: actions pinned by major tag (a new third-party
  action at least two weeks old); composite steps keep their shell; aggregator
  names ("Engine Required Checks", "IDE Required Checks", "GUI Required Checks",
  "WASM Required Checks") unchanged; every `pull_request` trigger keeps
  `paths-ignore: ["docs/superpowers/**"]` or a `paths` whitelist without it; a
  reusable workflow called with a matrix has no `concurrency:`; a job that runs
  `sbt` uses `setup-jvm` first; jobs that resolve the same build share
  `cache-key: engine`; quote `-D` arguments.
- The Actions cache is capped at 10 GB (8.7 GB in use on 2026-10-29, including
  superseded entries that `prune-caches.yml` removes weekly). A new cache entry
  states its measured size in the PR.
- Every PR: label `CI: No changelog needed`; body via `--body-file`; "Part of
  the CI speed design (#417)"; record before/after timings of the affected jobs,
  citing run IDs.
- Check every workflow change with `node tools/ci/check-workflows.mjs`,
  `node --test tools/ci/*.test.mjs`, and actionlint (the WSL command in
  `.github/CLAUDE.md`, or the PR's Workflow Lint check if WSL is unavailable —
  say which). Changes to `tools/build-scripts` also pass
  `corepack pnpm --filter build-scripts run typecheck`, `run lint` and
  `run test:unit`.
- Never run `git stash` in any form; never force-push; leave
  `.claude/settings.local.json` out of commits.

## The measurements this plan is based on

Measured on 2026-10-29 with `gh run list --workflow engine-pull-request.yml` and
`gh run view <id> --json jobs`, and per test project from the job logs
(`gh run view --job <id> --log`: the runner prints `Suite <name>: <projects>`,
then each project ends with `<n> tests failed.`).

Runs used (all `engine-pull-request.yml`, attempt 1, success):

- PRs: 40945989560, 40932467860, 40917821709, 40916940874, 40899346622
  (40889034310 for job durations only: its Windows jobs were re-run).
- develop: 40945709532, 40932297635, 40915800655, 40888963085.
- Per-project durations: the four Linux/Windows standard library Native and JVM
  jobs of 40945709532, 40945989560, 40932467860, 40932297635 and 40899346622 (20
  logs).

### Job durations (minutes)

| Job                                | PR runs (6)                        | Median | develop (4)            |
| ---------------------------------- | ---------------------------------- | ------ | ---------------------- |
| Build Engine Distribution, Linux   | 23.5, 15.8, 21.0, 24.6, 18.4, 24.3 | 22     | 20.1, 25.0, 15.1, 24.6 |
| Build Engine Distribution, Windows | 35.3, 31.2, 34.6, 34.8, 34.0, 32.7 | 34     | 34.0, 35.3, 36.3, 36.1 |
| JVM Tests, Linux                   | 37.9, 52.0, 38.1, 51.3, 50.8, 51.1 | 51     | 53.3, 52.2, 52.3, 34.8 |
| JVM Tests, Windows                 | 54.9, 53.5, 54.3, 42.9, 52.3, 33.6 | 53     | 35.8, 55.7, 54.2, 47.8 |
| Standard Library JVM, Linux        | 37.9, 47.2, 33.0, 54.1, 48.0, 52.2 | 48     | 32.3, 55.8, 38.6, 43.5 |
| Standard Library Native, Linux     | 29.5, 29.0, 44.3, 31.2, 47.8, 30.8 | 31     | 48.3, 38.4, 37.8, 50.2 |
| Standard Library JVM, Windows      | 29.4, 39.9, 31.9, 25.3, 36.5, 33.9 | 33     | 42.2, 38.9, 36.2, 42.6 |
| Standard Library Native, Windows   | 41.9, 40.9, 40.3, 40.1, 41.2, 32.9 | 41     | 38.2, 46.0, 47.4, 46.4 |
| Standard Library AWS / Microsoft   | 1.3–4.6 / 4.5–6.4                  |        |                        |
| Enso Code Lint / API check (Linux) | 4.7–13.8 / 2.0–2.2                 |        |                        |
| Push to green (first job → last)   | 90, 84, 90, 79, 87                 | 87     | 85–127                 |

**The critical path is now Windows**: Build Engine Distribution, Windows (31–35)
→ JVM Tests, Windows (43–55). It was the last job to finish in four of the five
PR runs. The spec's critical path (Linux build → Linux stdlib JVM) is the second
longest.

### Inside `JVM Tests` (steps, minutes)

| Step                                    | Linux PR 40945989560 | Linux develop 40945709532 | Windows PR 40945989560 |
| --------------------------------------- | -------------------- | ------------------------- | ---------------------- |
| Install the library server's deps       | 2.0                  | 0.9                       | 5.3                    |
| … of which `cargo install wasm-bindgen` | 1.2                  | (in Clean before: 1.6)    | 3.2                    |
| Build the ydoc native image             | 4.8 (image 3.6)      | 7.1 (image 5.4)           | — (Linux only)         |
| JVM tests (`sbt test`)                  | 23.7                 | 31.9                      | 44.4                   |
| Benchmarks compile and run              | 5.2                  | 7.2                       | — (Linux only)         |

The build jobs pay the same `cargo install wasm-bindgen-cli` inside sbt's ydoc
bundle step: 1.2 min Linux, 2.9–3.2 min Windows (build logs of 40945709532 and
40945989560).

### Per test project (minutes, min–max over the 20 logs)

| Project             | Linux JVM  | Linux Native | Windows JVM | Windows Native |
| ------------------- | ---------- | ------------ | ----------- | -------------- |
| Table_Tests         | 11.4–20.8  | 15.8–28.4    | 12.1–16.1   | 15.3–19.6      |
| DuckDB_Tests        | 3.8–6.7    | 5.5–8.6      | 6.1–7.9     | 7.3–9.7        |
| Base_Tests          | 2.6–5.0    | 2.9–5.0      | 3.0–5.7     | 3.7–4.5        |
| Cloud_Tests         | 0.8–1.2    | 0.9–1.2      | 1.3–1.5     | 1.2–2.2        |
| Examples_Tests      | 7.8–13.7 ¹ | 0.1–0.2      | 0.2–0.3     | 0.1–0.2        |
| Base_Internal_Tests | 0.4–0.7    | 0.7–1.2      | 0.6–1.1     | 1.3–1.9        |
| the other 9 summed  | 1.6–2.8    | 1.4–2.1      | 2.5–3.3     | 1.7–2.2        |

¹ numpy compiled from source; the GraalPy wheel cache (#423, #431) should take
it under a minute once develop has saved it.

Per-job overhead before the first project (checkout, download, `setup-jvm`,
small JDK, HTTP helper): 2–3 min Linux, 3–4 min Windows on PRs; develop adds 2–6
min of `Clean before`.

### What phase 2 can and cannot reach

| Path (PR, medians)                   | Today | After tasks 3–7  | And task 8 goes |
| ------------------------------------ | ----- | ---------------- | --------------- |
| Windows build → Windows JVM Tests    | 87    | ~78 (−4, −4, −1) | ~52 (no wait)   |
| Windows build → slowest Windows leg  | 75    | ~54              | ~54             |
| Linux build → slowest Linux leg      | 70    | ~50              | ~50             |
| Linux build → Linux JVM Tests        | 73    | ~60              | ~41             |
| **Engine PR push to green (median)** | 87    | **~78**          | **~55**         |

The spec's "≤ 55 min" target for phase 2 without 2c is out of reach: Windows JVM
Tests (`sbt test` alone is 44 min) waits for the 34-min Windows build, and 2a,
2b and 2d leave that path almost untouched. Only task 8 (2c) or splitting the
runtime suite (out of scope, see Decisions) moves it.

## Tasks

| Task | Spec | Branch                       | Saves on its job(s)                                                                    | Saves on engine push-to-green                                 | Needs |
| ---- | ---- | ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----- |
| 1    | 2a   | `ci/stdlib-test-map`         | — (map and policy)                                                                     | 0                                                             | —     |
| 2    | 2a   | `ci/stdlib-test-plan`        | — (command)                                                                            | 0                                                             | —     |
| 3    | 2a   | `ci/stdlib-shards`           | Linux legs 31–48 → ~14–31; Windows 33–41 → ~15–24; library-only PRs skip most projects | 0 now; up to −20 once task 8 lands (Windows legs become pole) | 1, 2  |
| 4    | 2b   | `ci/jvm-tests-no-ydoc-image` | Linux JVM Tests −4 to −5                                                               | 0 (off the critical path)                                     | —     |
| 5    | 2b   | `ci/benchmarks-job`          | Linux JVM Tests −5 to −7                                                               | 0 (off the critical path)                                     | —     |
| 6    | 2b   | `ci/prebuilt-wasm-bindgen`   | builds −1.2 Linux / −3 Windows; JVM Tests −1.2 / −3.2                                  | **−6** (Windows build and Windows JVM Tests)                  | —     |
| 7    | 2d   | `ci/engine-rust-cache`       | −0.5 to −2 per job that compiles the parser                                            | −1 to −3                                                      | —     |
| 8    | 2c   | `ci/spike-jvm-tests-no-wait` | — (spike: written finding, go/no-go)                                                   | if go: −25 to −30 (Windows JVM Tests stops waiting 31–35 min) | —     |

### Merge order

All tasks except 3 can be implemented at once, in separate worktrees (Sonnet
implementers; Opus for the task 8 spike). Merge one at a time, merging `develop` into the next branch and
letting its checks finish in between:

1. **Task 6** — the largest saving on today's critical path.
2. **Task 7** — adds steps next to task 6's in the same jobs.
3. **Task 4**, then **task 5** — both edit the `jvm-tests` job; task 5 copies
   task 6's and 7's steps into its new job.
4. **Task 1** and **task 2** (in either order; they touch different files).
5. **Task 3** — starts after 1 and 2 have merged.
6. **Task 8** — its finding PR is docs-only and merges whenever it is written;
   start the spike first, since its answer decides whether phase 2 reaches the
   target. If it says go, its implementation is a follow-up ticket that merges
   after task 3.

---

### Task 1: The standard library test map and its policy rule (spec 2a)

Branch `ci/stdlib-test-map`. Model: Sonnet.

**Files:**

- Create: `tools/ci/stdlib-test-map.yaml`
- Modify: `tools/ci/check-workflows.mjs` (`STDLIB_TEST_MAP`, `loadStdlib`,
  `loadRepo` returns `stdlib`, new `checkStdlibTestMap` in `CHECKS`)
- Modify: `tools/ci/check-workflows.test.mjs`
- Modify: `.github/workflows/workflow-lint.yml` (`paths` of both triggers)
- Modify: `tools/ci/README.md`, `.github/CLAUDE.md`

**Interfaces:**

- Produces: `tools/ci/stdlib-test-map.yaml` with this shape (task 2 reads it):
  - `everything.libraries: string[]` — a change to these libraries runs every
    project;
  - `everything.stdBits: string[]` — the same for these `std-bits/` directories;
  - `libraries.<Name>.stdBits: string[]` and `.dependsOn: string[]` (the
    libraries `<Name>`'s sources import, direct only);
  - `testProjects.<X_Tests>.imports: string[]` (`Standard.*` libraries) and
    `.testImports: string[]` (`enso_dev.*` projects);
  - `shards: { name: string, projects: string[] | "*" }[]`, the last one `"*"`.
- Produces: `export const STDLIB_TEST_MAP = 'tools/ci/stdlib-test-map.yaml'` and
  `export function checkStdlibTestMap({ stdlib }): string[]` in
  `check-workflows.mjs`.

- [ ] **Step 1: Write the map.** Create `tools/ci/stdlib-test-map.yaml` (the
      imports below are today's, computed with the regex of step 4):

```yaml
# The standard library test map: which `test/*_Tests` projects a pull request runs, from the files
# it changes. `tools/build-scripts`' `stdlib-test-plan` reads it (Note [Standard Library Test
# Selection] in `.github/workflows/engine-checks-platform.yml`). `tools/ci/check-workflows.mjs`
# (`checkStdlibTestMap`) fails when it no longer matches the repository, and its message says what
# to change.
#
# Adding a library: an entry under `libraries`, with its `std-bits` directories and `dependsOn`,
# exactly the libraries its sources import (top-level `from`/`import Standard.X` lines).
# Adding a test project: an entry under `testProjects`, with the `Standard.*` libraries it imports
# (`imports`) and the `enso_dev.*` projects it imports (`testImports`).
# develop runs every project whatever this file says.

# A change to any of these runs every test project.
everything:
  libraries: [Base, Test]
  stdBits: [benchmarks, tests]

libraries:
  AWS: { stdBits: [aws], dependsOn: [Base, Database, Table] }
  Base: { stdBits: [base], dependsOn: [] }
  Database: { stdBits: [database], dependsOn: [Base, Table] }
  DuckDB: { stdBits: [duckdb], dependsOn: [Base, Database, Table] }
  Examples: { stdBits: [], dependsOn: [Base, Table] }
  Generic_JDBC: { stdBits: [], dependsOn: [Base, Database, Table] }
  Geo: { stdBits: [], dependsOn: [Base, Table] }
  Google: { stdBits: [google], dependsOn: [Base, Table] }
  Google_Api: { stdBits: [], dependsOn: [] }
  Image: { stdBits: [image], dependsOn: [Base] }
  Microsoft: { stdBits: [microsoft], dependsOn: [Base, Database, Table] }
  Saas: { stdBits: [saas], dependsOn: [Base, Table] }
  Searcher: { stdBits: [], dependsOn: [Base] }
  Snowflake: { stdBits: [snowflake], dependsOn: [Base, Database, Table] }
  Table: { stdBits: [table], dependsOn: [Base] }
  Tableau: { stdBits: [tableau], dependsOn: [Base, Table] }
  Test: { stdBits: [], dependsOn: [Base] }
  Visualization: { stdBits: [], dependsOn: [Base, Database, Table] }

testProjects:
  AWS_Tests:
    imports: [AWS, Base, Database, Table, Test]
    testImports: [Base_Tests, Cloud_Tests, Table_Tests]
  Base_Internal_Tests: { imports: [Base, Test], testImports: [Cloud_Tests] }
  Base_Tests: { imports: [AWS, Base, Test], testImports: [Helpers] }
  Cloud_Tests:
    imports: [Base, Table, Test]
    testImports: [Base_Tests, Table_Tests]
  DuckDB_Tests:
    imports: [Base, Database, DuckDB, Table, Test]
    testImports: [Table_Tests]
  Examples_Tests: { imports: [Base, Examples, Test], testImports: [Base_Tests] }
  Generic_JDBC_Tests:
    imports: [Base, Database, Generic_JDBC, Test]
    testImports: [Table_Tests]
  Geo_Tests: { imports: [Base, Geo, Table, Test], testImports: [] }
  Image_Tests: { imports: [Base, Image, Test], testImports: [Cloud_Tests] }
  Microsoft_Tests:
    imports: [Base, Database, Microsoft, Table, Test]
    testImports: [Base_Tests, Cloud_Tests, Table_Tests]
  Saas_Tests:
    imports: [Base, Saas, Table, Test]
    testImports: [Base_Tests, Table_Tests]
  Snowflake_Tests:
    imports: [Base, Database, Snowflake, Table, Test]
    testImports: [Base_Tests, Cloud_Tests, Table_Tests]
  Table_Internal_Tests:
    imports: [Base, Database, Table, Test, Visualization]
    testImports: []
  Table_Tests:
    imports: [Base, Database, Examples, Table, Test, Visualization]
    testImports: [Base_Tests, Cloud_Tests, Generic_JDBC_Tests, Test_Tests]
  Tableau_Tests:
    imports: [Base, Table, Tableau, Test]
    testImports: [Table_Tests]
  Test_Tests: { imports: [Base, Test], testImports: [] }
  Visualization_Tests:
    imports:
      [AWS, Base, Database, Examples, Geo, Image, Table, Test, Visualization]
    testImports: []

# The jobs a standard library suite that runs "every project but …" splits into; a suite with an
# allow list (AWS, Microsoft) stays one job. Each shard runs the listed projects the suite runs;
# the last (`"*"`) runs the rest. Sized from the timings in
# docs/superpowers/plans/2026-10-30-ci-speed-phase-2.md: Table_Tests alone is the longest.
shards:
  - { name: Table, projects: [Table_Tests] }
  - { name: Base, projects: [Base_Tests, DuckDB_Tests, Cloud_Tests] }
  - { name: Others, projects: "*" }
```

Run `npx -y prettier@3 --write tools/ci/stdlib-test-map.yaml` and keep its
layout.

- [ ] **Step 2: Write the failing tests** in `check-workflows.test.mjs`. Add
      `checkStdlibTestMap` to the import list, and:

```js
const STDLIB_MAP_OK = `
everything: { libraries: [Base], stdBits: [] }
libraries:
  Base: { stdBits: [], dependsOn: [] }
  Table: { stdBits: [table], dependsOn: [Base] }
testProjects:
  Table_Tests: { imports: [Table], testImports: [Helpers] }
shards:
  - { name: Table, projects: [Table_Tests] }
  - { name: Others, projects: "*" }
`;

/** A standard library with Base and Table, `std-bits/table` and `test/Table_Tests`. */
const STDLIB_FILES = {
  "distribution/lib/Standard/Base/0.0.0-dev/package.yaml": "name: Base\n",
  "distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso":
    "import Standard.Base.Any\n",
  "distribution/lib/Standard/Table/0.0.0-dev/package.yaml": "name: Table\n",
  // The indented import is an example in a doc comment: it must not count.
  "distribution/lib/Standard/Table/0.0.0-dev/src/Main.enso":
    "from Standard.Base import all\n## Example\n    import Standard.Geo\n",
  "std-bits/table/README.md": "",
  "test/Table_Tests/package.yaml": "name: Table_Tests\n",
  "test/Table_Tests/src/Main.enso":
    "from Standard.Table import all\nimport enso_dev.Helpers\nimport enso_dev.Table_Tests.Util\n",
};

const at = "tools/ci/stdlib-test-map.yaml:";

describe("checkStdlibTestMap", () => {
  test("accepts a map that matches the repository", () => {
    const repo = fixture(
      {},
      { ...STDLIB_FILES, "tools/ci/stdlib-test-map.yaml": STDLIB_MAP_OK },
    );
    assert.deepEqual(checkStdlibTestMap(repo), []);
  });
  test("accepts a repository without a standard library or a map", () => {
    assert.deepEqual(checkStdlibTestMap(fixture({})), []);
  });
  test("requires the map once there is a standard library", () => {
    assert.deepEqual(checkStdlibTestMap(fixture({}, STDLIB_FILES)), [
      `${at} missing (every library under distribution/lib/Standard needs an entry)`,
    ]);
  });
  test("reports what the map lacks", () => {
    const repo = fixture(
      {},
      {
        ...STDLIB_FILES,
        "distribution/lib/Standard/Geo/0.0.0-dev/package.yaml": "name: Geo\n",
        "distribution/lib/Standard/Geo/0.0.0-dev/src/Main.enso":
          "from Standard.Table import all\n",
        "distribution/lib/Standard/Table/0.0.0-dev/src/Database.enso":
          "import Standard.Database.Connection\n",
        "std-bits/geo/README.md": "",
        "test/Geo_Tests/package.yaml": "name: Geo_Tests\n",
        "test/Geo_Tests/src/Main.enso": "from Standard.Geo import all\n",
        "tools/ci/stdlib-test-map.yaml": STDLIB_MAP_OK,
      },
    );
    assert.deepEqual(checkStdlibTestMap(repo), [
      `${at} no entry for library \`Geo\` (distribution/lib/Standard/Geo)`,
      `${at} \`libraries.Table.dependsOn\` lacks \`Database\`: distribution/lib/Standard/Table imports Standard.Database`,
      `${at} std-bits/geo belongs to no library (add it to a library's \`stdBits\` or to \`everything.stdBits\`)`,
      `${at} no entry for test project \`Geo_Tests\` (test/Geo_Tests)`,
    ]);
  });
  test("reports stale entries and malformed shards", () => {
    const stale = `
everything: { libraries: [Base, Gone], stdBits: [] }
libraries:
  Base: { stdBits: [], dependsOn: [] }
  Table: { stdBits: [table, old], dependsOn: [Base] }
  Old: { stdBits: [], dependsOn: [] }
testProjects:
  Table_Tests: { imports: [Table], testImports: [Helpers] }
  Old_Tests: { imports: [], testImports: [] }
shards:
  - { name: Table, projects: [Table_Tests, Nope_Tests] }
  - { name: Again, projects: [Table_Tests] }
  - { name: Rest, projects: [Table_Tests] }
`;
    const repo = fixture(
      {},
      { ...STDLIB_FILES, "tools/ci/stdlib-test-map.yaml": stale },
    );
    assert.deepEqual(checkStdlibTestMap(repo), [
      `${at} \`libraries.Old\` names no directory under distribution/lib/Standard`,
      `${at} std-bits/old is listed but does not exist`,
      `${at} \`testProjects.Old_Tests\` names no test project under test/`,
      `${at} \`everything.libraries\` names \`Gone\`, which is not a library`,
      `${at} the last shard must have \`projects: "*"\` (the projects no other shard names)`,
      `${at} shard \`Table\` names \`Nope_Tests\`, which is not a test project`,
      `${at} shard \`Again\` names \`Table_Tests\`, which shard \`Table\` already runs`,
    ]);
  });
});
```

- [ ] **Step 3: Run** `node --test tools/ci/check-workflows.test.mjs`. Expected:
      FAIL (`checkStdlibTestMap` is not exported).

- [ ] **Step 4: Implement** in `check-workflows.mjs`. Next to the other
      constants:

```js
/** The standard library test map; see `checkStdlibTestMap`. */
export const STDLIB_TEST_MAP = "tools/ci/stdlib-test-map.yaml";

/**
 * A top-level import of a standard library or of a test project. An indented one is an example in
 * a doc comment and does not count.
 */
const ENSO_IMPORT = /^(?:from|import)\s+(?:Standard\.(\w+)|enso_dev\.(\w+))/gm;
```

Before `loadRepo`:

```js
/** The names of the directories in `dir`, sorted; none when it does not exist. */
function subdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every `.enso` file under `dir`. */
function ensoFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ensoFiles(full);
    return entry.name.endsWith(".enso") ? [full] : [];
  });
}

/** The libraries and the test projects that the `.enso` files under `dir` import, but `self`. */
function ensoImports(dir, self) {
  const libraries = new Set();
  const tests = new Set();
  for (const file of ensoFiles(dir)) {
    for (const [, library, project] of readFileSync(file, "utf8").matchAll(
      ENSO_IMPORT,
    )) {
      if (library != null && library !== self) libraries.add(library);
      if (project != null && project !== self) tests.add(project);
    }
  }
  return { libraries: [...libraries].sort(), tests: [...tests].sort() };
}

/**
 * What `checkStdlibTestMap` compares the map with: the libraries under
 * `distribution/lib/Standard` (their first version directory with a `package.yaml`), the
 * `std-bits` directories and the `test/*_Tests` projects with a `package.yaml`, the last as
 * `tools/build-scripts`' `discoverProjects` finds them.
 */
function loadStdlib(root) {
  const mapFile = path.join(root, STDLIB_TEST_MAP);
  const map = existsSync(mapFile) ? parse(readFileSync(mapFile, "utf8")) : null;
  const standard = path.join(root, "distribution", "lib", "Standard");
  const libraries = {};
  for (const name of subdirectories(standard)) {
    const version = subdirectories(path.join(standard, name)).find((dir) =>
      existsSync(path.join(standard, name, dir, "package.yaml")),
    );
    libraries[name] =
      version == null
        ? []
        : ensoImports(path.join(standard, name, version, "src"), name)
            .libraries;
  }
  const testDir = path.join(root, "test");
  const testProjects = {};
  for (const name of subdirectories(testDir)) {
    if (
      !name.endsWith("_Tests") ||
      !existsSync(path.join(testDir, name, "package.yaml"))
    )
      continue;
    testProjects[name] = ensoImports(path.join(testDir, name, "src"), name);
  }
  return {
    map,
    libraries,
    stdBits: subdirectories(path.join(root, "std-bits")),
    testProjects,
  };
}
```

In `loadRepo`, return `stdlib: loadStdlib(root)` too, and add "the standard
library test map" to its doc comment. After `checkWorkflowsDeclarePermissions`:

```js
/**
 * The standard library test map (`tools/ci/stdlib-test-map.yaml`) decides which test projects a
 * pull request runs (spec 2a), so a library or test project missing from it, or an import it does
 * not know, would silently skip tests. It must name every library, `std-bits` directory and test
 * project, and its import lists must equal the sources' top-level imports.
 */
export function checkStdlibTestMap({ stdlib }) {
  const { map, libraries, stdBits, testProjects } = stdlib;
  const at = `${STDLIB_TEST_MAP}:`;
  if (map == null) {
    if (Object.keys(libraries).length === 0) return [];
    return [
      `${at} missing (every library under distribution/lib/Standard needs an entry)`,
    ];
  }
  const problems = [];
  const compare = (label, declared, actual, source, prefix) => {
    for (const name of actual) {
      if (!(declared ?? []).includes(name)) {
        problems.push(
          `${at} \`${label}\` lacks \`${name}\`: ${source} imports ${prefix}${name}`,
        );
      }
    }
    for (const name of declared ?? []) {
      if (!actual.includes(name)) {
        problems.push(
          `${at} \`${label}\` lists \`${name}\`, which ${source} does not import`,
        );
      }
    }
  };
  const declaredLibraries = map.libraries ?? {};
  for (const [name, imports] of Object.entries(libraries)) {
    const entry = declaredLibraries[name];
    const source = `distribution/lib/Standard/${name}`;
    if (entry == null)
      problems.push(`${at} no entry for library \`${name}\` (${source})`);
    else
      compare(
        `libraries.${name}.dependsOn`,
        entry.dependsOn,
        imports,
        source,
        "Standard.",
      );
  }
  for (const name of Object.keys(declaredLibraries)) {
    if (!(name in libraries)) {
      problems.push(
        `${at} \`libraries.${name}\` names no directory under distribution/lib/Standard`,
      );
    }
  }
  const owned = new Set([
    ...(map.everything?.stdBits ?? []),
    ...Object.values(declaredLibraries).flatMap(
      (entry) => entry?.stdBits ?? [],
    ),
  ]);
  for (const dir of stdBits) {
    if (!owned.has(dir)) {
      problems.push(
        `${at} std-bits/${dir} belongs to no library (add it to a library's \`stdBits\` or to \`everything.stdBits\`)`,
      );
    }
  }
  for (const dir of owned) {
    if (!stdBits.includes(dir))
      problems.push(`${at} std-bits/${dir} is listed but does not exist`);
  }
  const declaredTests = map.testProjects ?? {};
  for (const [name, imports] of Object.entries(testProjects)) {
    const entry = declaredTests[name];
    const source = `test/${name}`;
    if (entry == null) {
      problems.push(`${at} no entry for test project \`${name}\` (${source})`);
      continue;
    }
    compare(
      `testProjects.${name}.imports`,
      entry.imports,
      imports.libraries,
      source,
      "Standard.",
    );
    compare(
      `testProjects.${name}.testImports`,
      entry.testImports,
      imports.tests,
      source,
      "enso_dev.",
    );
  }
  for (const name of Object.keys(declaredTests)) {
    if (!(name in testProjects)) {
      problems.push(
        `${at} \`testProjects.${name}\` names no test project under test/`,
      );
    }
  }
  for (const name of map.everything?.libraries ?? []) {
    if (!(name in libraries)) {
      problems.push(
        `${at} \`everything.libraries\` names \`${name}\`, which is not a library`,
      );
    }
  }
  const shards = map.shards ?? [];
  if (shards.at(-1)?.projects !== "*") {
    problems.push(
      `${at} the last shard must have \`projects: "*"\` (the projects no other shard names)`,
    );
  }
  const runBy = new Map();
  for (const shard of shards.slice(0, -1)) {
    for (const project of Array.isArray(shard.projects) ? shard.projects : []) {
      if (!(project in testProjects)) {
        problems.push(
          `${at} shard \`${shard.name}\` names \`${project}\`, which is not a test project`,
        );
      } else if (runBy.has(project)) {
        problems.push(
          `${at} shard \`${shard.name}\` names \`${project}\`, which shard \`${runBy.get(project)}\` already runs`,
        );
      } else {
        runBy.set(project, shard.name);
      }
    }
  }
  return problems;
}
```

Add `checkStdlibTestMap` to `CHECKS`.

- [ ] **Step 5: Run the tests.** `node --test tools/ci/check-workflows.test.mjs`
      — expected PASS, including the existing `checkRepo(repoRoot)` test, which
      now checks the real map. Then `node tools/ci/check-workflows.mjs` —
      expected `Workflow policy: OK`. If either reports a real mismatch, the
      repository changed since 2026-10-29: fix the map, not the rule.

- [ ] **Step 6: Make Workflow Lint run when the map can go stale.** In
      `.github/workflows/workflow-lint.yml`, add to the `paths` of **both**
      `push` and `pull_request`:

```yaml
# `tools/ci/check-workflows.mjs` checks the standard library test map against these.
- "distribution/lib/Standard/**/*.enso"
- "distribution/lib/Standard/*/*/package.yaml"
- "std-bits/**"
- "test/*/package.yaml"
- "test/**/*.enso"
```

- [ ] **Step 7: Document.** In `tools/ci/README.md` "Workflow policy", add to
      the list of rules: "the standard library test map names every library,
      `std-bits` directory and test project, with their imports exactly". In
      `.github/CLAUDE.md` "Checking a change", add: "Workflow Lint also runs on
      standard library and test project changes: it checks
      `tools/ci/stdlib-test-map.yaml` against their imports. A new library,
      `std-bits` directory, test project or cross-library import needs an entry
      there; the failure message says which."

- [ ] **Step 8: Verify and open the PR.** Policy script, its tests, actionlint.
      Then show the rule catching drift: on a scratch commit (not pushed), add
      `import Standard.Geo` at the top of any `.enso` file under
      `distribution/lib/Standard/Image/` and run
      `node tools/ci/check-workflows.mjs` — expected one line naming
      `libraries.Image.dependsOn` and `Geo`; revert it. Quote that line in the
      PR body. Commit, push, open the PR.

---

### Task 2: `stdlib-test-plan`, the selection and sharding command (spec 2a)

Branch `ci/stdlib-test-plan`. Model: Sonnet. Independent of task 1: its tests
use their own map, and the command reads `tools/ci/stdlib-test-map.yaml` only at
run time (task 3 runs it after task 1 has merged).

**Files:**

- Create: `tools/build-scripts/src/stdlib-test/plan.ts`
- Create: `tools/build-scripts/src/stdlib-test/plan.test.ts`
- Create: `tools/build-scripts/src/commands/stdlib-test-plan.ts`
- Modify: `tools/build-scripts/package.json` (`scripts`)
- Modify: `tools/build-scripts/CLAUDE.md` ("Commands")

**Interfaces:**

- Consumes: `suiteNamed`, `selects`, `discoverProjects` from
  `src/stdlib-test/suites.ts`; `REPO_ROOT` from `src/lib/repo.ts`; the map shape
  of task 1.
- Produces (task 3 relies on these):
  - command `corepack pnpm --filter build-scripts run stdlib-test-plan`, reading
    `STDLIB_SUITES` (the `stdlib-suites` JSON), `CHANGED_FILES`
    (space-separated), `STDLIB_SHARDS` (`false` disables sharding) and
    `GITHUB_EVENT_NAME`; writing `matrix=<JSON array>` to `GITHUB_OUTPUT` and a
    summary to `GITHUB_STEP_SUMMARY`;
  - each matrix entry is the suite entry it came from (`suite`, `title`,
    `small-jdk`, `postgres`, `mssql`) plus `only: string` (comma-separated
    project names, never empty), with `title` suffixed ` (<shard name>)` for a
    sharded suite. An empty array means no job.
- The command must not import `src/lib/sbt.ts` (directly or through another
  module): the `stdlib-plan` job has no `setup-jvm`, and the policy fails a job
  that reaches sbt without it.

- [ ] **Step 1: Write the failing tests** in `src/stdlib-test/plan.test.ts`:

```ts
/** @file Tests for the standard-library test plan: selection from changed files, and sharding. */
import { describe, expect, test } from "vitest";
import {
  planMatrix,
  planSummary,
  selectTestProjects,
  type StdlibTestMap,
  type SuiteEntry,
} from "./plan.ts";

const MAP: StdlibTestMap = {
  everything: { libraries: ["Base", "Test"], stdBits: ["tests"] },
  libraries: {
    Base: { stdBits: ["base"], dependsOn: [] },
    Table: { stdBits: ["table"], dependsOn: ["Base"] },
    Database: { stdBits: ["database"], dependsOn: ["Base", "Table"] },
    Geo: { stdBits: [], dependsOn: ["Base", "Table"] },
    Tableau: { stdBits: ["tableau"], dependsOn: ["Base", "Table"] },
    Test: { stdBits: [], dependsOn: ["Base"] },
  },
  testProjects: {
    AWS_Tests: { imports: ["Base"], testImports: [] },
    Base_Tests: { imports: ["Base", "Test"], testImports: [] },
    DuckDB_Tests: { imports: ["Database"], testImports: ["Table_Tests"] },
    Geo_Tests: { imports: ["Geo", "Table"], testImports: [] },
    Table_Tests: {
      imports: ["Database", "Table"],
      testImports: ["Base_Tests"],
    },
    Tableau_Tests: { imports: ["Tableau"], testImports: ["Table_Tests"] },
    Visualization_Tests: { imports: ["Geo"], testImports: [] },
  },
  shards: [
    { name: "Table", projects: ["Table_Tests"] },
    { name: "Base", projects: ["Base_Tests", "DuckDB_Tests"] },
    { name: "Others", projects: "*" },
  ],
};

const sorted = (files: readonly string[]) => {
  const { projects } = selectTestProjects(MAP, files);
  return projects == null ? null : [...projects].sort();
};

describe("selectTestProjects", () => {
  test("runs everything outside a pull request", () => {
    expect(selectTestProjects(MAP, null).projects).toBeNull();
  });
  test("a library with no dependents runs its own test project", () => {
    expect(
      sorted([
        "distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso",
      ]),
    ).toEqual(["Tableau_Tests"]);
  });
  test("a std-bits directory counts as its library", () => {
    expect(sorted(["std-bits/tableau/src/main/java/X.java"])).toEqual([
      "Tableau_Tests",
    ]);
  });
  test("runs every project that imports the library", () => {
    expect(
      sorted(["distribution/lib/Standard/Geo/0.0.0-dev/src/Geo.enso"]),
    ).toEqual(["Geo_Tests", "Visualization_Tests"]);
  });
  test("runs the projects of the libraries that depend on it, transitively", () => {
    expect(
      sorted(["distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso"]),
    ).toEqual([
      "DuckDB_Tests",
      "Geo_Tests",
      "Table_Tests",
      "Tableau_Tests",
      "Visualization_Tests",
    ]);
  });
  test("a test project runs, with the projects that import it", () => {
    expect(sorted(["test/Table_Tests/src/Main.enso"])).toEqual([
      "DuckDB_Tests",
      "Table_Tests",
      "Tableau_Tests",
    ]);
  });
  test.each([
    "distribution/lib/Standard/Base/0.0.0-dev/src/Main.enso",
    "distribution/lib/Standard/Test/0.0.0-dev/src/Main.enso",
    "distribution/lib/Standard/New/0.0.0-dev/src/Main.enso",
    "std-bits/base/src/X.java",
    "std-bits/tests/src/X.java",
    "std-bits/unknown/src/X.java",
    "test/Helpers/src/Main.enso",
    "test/Unknown_Tests/src/Main.enso",
    "engine/runtime/src/main/java/X.java",
    ".github/workflows/engine-checks-platform.yml",
    "tools/build-scripts/src/stdlib-test/run.ts",
  ])("%s runs everything", (file) => {
    expect(
      sorted([
        "distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso",
        file,
      ]),
    ).toBeNull();
  });
  test("says why", () => {
    expect(selectTestProjects(MAP, ["engine/x.java"]).reasons).toEqual([
      "engine/x.java: outside any one library or test project; every project runs.",
    ]);
  });
});

const PROJECTS = [
  "AWS_Tests",
  "Base_Tests",
  "DuckDB_Tests",
  "Geo_Tests",
  "Microsoft_Tests",
  "Table_Tests",
  "Tableau_Tests",
  "Visualization_Tests",
];
const JVM: SuiteEntry = {
  suite: "standard-library",
  title: "JVM",
  "small-jdk": true,
  postgres: true,
  mssql: false,
};
const AWS: SuiteEntry = { suite: "std-aws", title: "AWS", "small-jdk": false };

describe("planMatrix", () => {
  test("shards a deny-list suite and keeps an allow-list suite whole", () => {
    expect(
      planMatrix(
        [JVM, AWS],
        MAP,
        PROJECTS,
        { projects: null, reasons: [] },
        true,
      ),
    ).toEqual([
      { ...JVM, title: "JVM (Table)", only: "Table_Tests" },
      { ...JVM, title: "JVM (Base)", only: "Base_Tests,DuckDB_Tests" },
      {
        ...JVM,
        title: "JVM (Others)",
        only: "Geo_Tests,Tableau_Tests,Visualization_Tests",
      },
      { ...AWS, only: "AWS_Tests" },
    ]);
  });
  test("drops the jobs with no selected project", () => {
    const selection = { projects: new Set(["Tableau_Tests"]), reasons: [] };
    expect(planMatrix([JVM, AWS], MAP, PROJECTS, selection, true)).toEqual([
      { ...JVM, title: "JVM (Others)", only: "Tableau_Tests" },
    ]);
  });
  test("keeps one job per suite when sharding is off", () => {
    expect(
      planMatrix(
        [JVM, AWS],
        MAP,
        PROJECTS,
        { projects: null, reasons: [] },
        false,
      ),
    ).toEqual([
      {
        ...JVM,
        only: "Base_Tests,DuckDB_Tests,Geo_Tests,Table_Tests,Tableau_Tests,Visualization_Tests",
      },
      { ...AWS, only: "AWS_Tests" },
    ]);
  });
});

describe("planSummary", () => {
  test("lists the reasons and the jobs", () => {
    const selection = {
      projects: new Set(["Tableau_Tests"]),
      reasons: ["a.enso: Standard.Tableau"],
    };
    const matrix = planMatrix([JVM], MAP, PROJECTS, selection, true);
    expect(planSummary(selection, matrix)).toEqual([
      "### Standard library tests",
      "",
      "- a.enso: Standard.Tableau",
      "",
      "| Job | Projects |",
      "| --- | --- |",
      "| JVM (Others) | Tableau_Tests |",
    ]);
  });
  test("says when no job runs", () => {
    const selection = {
      projects: new Set<string>(),
      reasons: ["x: Standard.Google"],
    };
    expect(planSummary(selection, [])).toEqual([
      "### Standard library tests",
      "",
      "- x: Standard.Google",
      "",
      "No test project is affected: the standard library test jobs are skipped.",
    ]);
  });
});
```

- [ ] **Step 2: Run** `corepack pnpm --filter build-scripts run test:unit`.
      Expected: FAIL (`./plan.ts` does not exist).

- [ ] **Step 3: Implement** `src/stdlib-test/plan.ts`:

```ts
/**
 * @file Which standard-library test projects a run executes, and the jobs they split into: the
 * logic of `stdlib-test-plan` (Note [Standard Library Test Selection] in
 * `.github/workflows/engine-checks-platform.yml`). Pure; the command does the I/O.
 */
import { selects, suiteNamed } from "./suites.ts";

/** `tools/ci/stdlib-test-map.yaml`. */
export interface StdlibTestMap {
  readonly everything: {
    readonly libraries: readonly string[];
    readonly stdBits: readonly string[];
  };
  readonly libraries: Readonly<
    Record<
      string,
      {
        readonly stdBits?: readonly string[];
        readonly dependsOn?: readonly string[];
      }
    >
  >;
  readonly testProjects: Readonly<
    Record<
      string,
      {
        readonly imports?: readonly string[];
        readonly testImports?: readonly string[];
      }
    >
  >;
  readonly shards: readonly {
    readonly name: string;
    readonly projects: readonly string[] | "*";
  }[];
}

/** One entry of a platform's `stdlib-suites` input. */
export interface SuiteEntry {
  readonly suite: string;
  readonly title: string;
  readonly "small-jdk": boolean;
  readonly postgres?: boolean;
  readonly mssql?: boolean;
}

/** One standard-library test job. */
export interface MatrixEntry extends SuiteEntry {
  /** `stdlib-test --only`'s value: the projects this job runs, comma-separated. */
  readonly only: string;
}

/** The projects to run, and why. */
export interface Selection {
  /** `null`: every project. */
  readonly projects: ReadonlySet<string> | null;
  readonly reasons: readonly string[];
}

const LIBRARY = /^distribution\/lib\/Standard\/([^/]+)\//;
const STD_BITS = /^std-bits\/([^/]+)\//;
const TEST_PROJECT = /^test\/([^/]+_Tests)\//;

/** `start` and everything `next` reaches from it. */
function closure(
  start: Iterable<string>,
  next: (item: string) => readonly string[],
): Set<string> {
  const seen = new Set(start);
  const queue = [...seen];
  for (let item = queue.pop(); item != null; item = queue.pop()) {
    for (const found of next(item)) {
      if (!seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
    }
  }
  return seen;
}

/**
 * The test projects that `changedFiles` can affect (`null`: outside a pull request, every one). A
 * changed library selects the projects that import it or any library depending on it; a changed
 * test project selects itself; either also selects the projects that import a selected one. Any
 * other path, an `everything` library or `std-bits` directory, or a name the map does not know
 * selects every project.
 */
export function selectTestProjects(
  map: StdlibTestMap,
  changedFiles: readonly string[] | null,
): Selection {
  if (changedFiles == null) {
    return {
      projects: null,
      reasons: ["Not a pull request: every project runs."],
    };
  }
  const libraries = new Set<string>();
  const direct = new Set<string>();
  const reasons: string[] = [];
  const everything = (file: string, why: string): Selection => ({
    projects: null,
    reasons: [`${file}: ${why}; every project runs.`],
  });
  for (const file of changedFiles) {
    const library = LIBRARY.exec(file)?.[1];
    const stdBits = STD_BITS.exec(file)?.[1];
    const project = TEST_PROJECT.exec(file)?.[1];
    if (library != null) {
      if (map.everything.libraries.includes(library)) {
        return everything(file, `every project uses Standard.${library}`);
      }
      if (map.libraries[library] == null) {
        return everything(file, `Standard.${library} is not in the test map`);
      }
      libraries.add(library);
      reasons.push(`${file}: Standard.${library}`);
    } else if (stdBits != null) {
      if (map.everything.stdBits.includes(stdBits)) {
        return everything(file, `std-bits/${stdBits} is shared`);
      }
      const owner = Object.entries(map.libraries).find(([, entry]) =>
        (entry.stdBits ?? []).includes(stdBits),
      )?.[0];
      if (owner == null)
        return everything(file, `std-bits/${stdBits} is not in the test map`);
      if (map.everything.libraries.includes(owner)) {
        return everything(file, `every project uses Standard.${owner}`);
      }
      libraries.add(owner);
      reasons.push(`${file}: Standard.${owner}`);
    } else if (project != null && map.testProjects[project] != null) {
      direct.add(project);
      reasons.push(`${file}: ${project}`);
    } else {
      return everything(file, "outside any one library or test project");
    }
  }
  const dependents = (library: string) =>
    Object.entries(map.libraries)
      .filter(([, entry]) => (entry.dependsOn ?? []).includes(library))
      .map(([name]) => name);
  const affected = closure(libraries, dependents);
  for (const [name, entry] of Object.entries(map.testProjects)) {
    if ((entry.imports ?? []).some((library) => affected.has(library)))
      direct.add(name);
  }
  const importers = (project: string) =>
    Object.entries(map.testProjects)
      .filter(([, entry]) => (entry.testImports ?? []).includes(project))
      .map(([name]) => name);
  return { projects: closure(direct, importers), reasons };
}

/**
 * The jobs for `entries` (a platform's suites): a suite that runs every project but a deny list
 * splits into the map's shards when `shard` is on; an allow-list suite stays one job. Projects
 * the selection leaves out are dropped, and so are the jobs left with none.
 */
export function planMatrix(
  entries: readonly SuiteEntry[],
  map: StdlibTestMap,
  projects: readonly string[],
  selection: Selection,
  shard: boolean,
): MatrixEntry[] {
  const chosen = (list: readonly string[]) =>
    list.filter(
      (project) =>
        selection.projects == null || selection.projects.has(project),
    );
  const matrix: MatrixEntry[] = [];
  for (const entry of entries) {
    const { suite } = suiteNamed(entry.suite);
    const inSuite = projects.filter((project) => selects(suite, project));
    if (suite.allow != null || !shard) {
      const only = chosen(inSuite);
      if (only.length > 0) matrix.push({ ...entry, only: only.join(",") });
      continue;
    }
    const taken = new Set<string>();
    for (const { name, projects: listed } of map.shards) {
      const shardProjects =
        listed === "*"
          ? inSuite.filter((project) => !taken.has(project))
          : listed.filter((project) => inSuite.includes(project));
      for (const project of shardProjects) taken.add(project);
      const only = chosen(shardProjects);
      if (only.length > 0)
        matrix.push({
          ...entry,
          title: `${entry.title} (${name})`,
          only: only.join(","),
        });
    }
  }
  return matrix;
}

/** The most reasons the job summary lists; a large pull request has thousands of files. */
const MAX_REASONS = 50;

/** The job summary: why, then which jobs run which projects. */
export function planSummary(
  selection: Selection,
  matrix: readonly MatrixEntry[],
): string[] {
  const reasons = selection.reasons
    .slice(0, MAX_REASONS)
    .map((reason) => `- ${reason}`);
  if (selection.reasons.length > MAX_REASONS) {
    reasons.push(
      `- … and ${selection.reasons.length - MAX_REASONS} more files`,
    );
  }
  const lines = ["### Standard library tests", "", ...reasons, ""];
  if (matrix.length === 0) {
    lines.push(
      "No test project is affected: the standard library test jobs are skipped.",
    );
    return lines;
  }
  lines.push("| Job | Projects |", "| --- | --- |");
  for (const entry of matrix)
    lines.push(`| ${entry.title} | ${entry.only.split(",").join(", ")} |`);
  return lines;
}
```

- [ ] **Step 4: Run** `corepack pnpm --filter build-scripts run test:unit`.
      Expected: PASS.

- [ ] **Step 5: Add the command**, `src/commands/stdlib-test-plan.ts`:

```ts
/**
 * @file `stdlib-test-plan`: the standard-library test jobs of one platform, for the `stdlib-plan`
 * job of `engine-checks-platform.yml` (Note [Standard Library Test Selection] there). It reads
 * `STDLIB_SUITES` (the platform's `stdlib-suites` JSON), `CHANGED_FILES` (space-separated) and
 * `STDLIB_SHARDS` (`false` keeps one job per suite), writes `matrix=<JSON>` to `GITHUB_OUTPUT`
 * (stdout when unset) and why to the job summary. Unless `GITHUB_EVENT_NAME` is `pull_request` and
 * `CHANGED_FILES` names a file, every project runs.
 *
 *     STDLIB_SUITES='[{"suite":"standard-library","title":"JVM","small-jdk":true}]' \
 *       corepack pnpm --silent --filter build-scripts run stdlib-test-plan
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "../lib/repo.ts";
import {
  planMatrix,
  planSummary,
  selectTestProjects,
  type StdlibTestMap,
  type SuiteEntry,
} from "../stdlib-test/plan.ts";
import { discoverProjects } from "../stdlib-test/suites.ts";

try {
  const env = process.env;
  const entries = JSON.parse(env.STDLIB_SUITES ?? "[]") as SuiteEntry[];
  const mapFile = path.join(REPO_ROOT, "tools", "ci", "stdlib-test-map.yaml");
  const map = parse(readFileSync(mapFile, "utf8")) as StdlibTestMap;
  const files = (env.CHANGED_FILES ?? "")
    .split(/\s+/)
    .filter((file) => file !== "");
  const changed =
    env.GITHUB_EVENT_NAME === "pull_request" && files.length > 0 ? files : null;
  const selection = selectTestProjects(map, changed);
  const projects = discoverProjects(path.join(REPO_ROOT, "test"));
  const matrix = planMatrix(
    entries,
    map,
    projects,
    selection,
    env.STDLIB_SHARDS !== "false",
  );
  const output = `matrix=${JSON.stringify(matrix)}\n`;
  const outputFile = env.GITHUB_OUTPUT ?? "";
  if (outputFile !== "") appendFileSync(outputFile, output);
  else process.stdout.write(output);
  const summaryFile = env.GITHUB_STEP_SUMMARY ?? "";
  if (summaryFile !== "")
    appendFileSync(
      summaryFile,
      `${planSummary(selection, matrix).join("\n")}\n`,
    );
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 2;
}
```

In `package.json` `scripts`, after `stdlib-test`:
`"stdlib-test-plan": "node src/commands/stdlib-test-plan.ts",`.

- [ ] **Step 6: Try it by hand** (Git Bash, from the repository root; the map
      comes from task 1, so on this branch copy it in from task 1's branch
      first, or run after task 1 merged — do not commit the copy):

```bash
STDLIB_SUITES='[{"suite":"standard-library","title":"JVM","small-jdk":true},{"suite":"std-aws","title":"AWS","small-jdk":false}]' \
GITHUB_EVENT_NAME=pull_request \
CHANGED_FILES='distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso' \
  corepack pnpm --silent --filter build-scripts run stdlib-test-plan
```

Expected:
`matrix=[{"suite":"standard-library","title":"JVM (Others)","small-jdk":true,"only":"Tableau_Tests"}]`.
Without `GITHUB_EVENT_NAME`, four entries (three JVM shards and AWS).

- [ ] **Step 7: Document** in `tools/build-scripts/CLAUDE.md` "Commands", after
      `stdlib-test`: "`stdlib-test-plan` — CI's standard-library test jobs for
      one platform: which projects a pull request's changed files can affect
      (`tools/ci/stdlib-test-map.yaml`), split into the map's shards, as a
      `matrix` output; every project outside a pull request. It must not start
      sbt (its job has no `setup-jvm`)."

- [ ] **Step 8: Verify and open the PR.** `typecheck`, `lint`, `test:unit` of
      build-scripts; `node tools/ci/check-workflows.mjs` (it reads
      `tools/build-scripts` to see which commands start sbt: the new one must
      not). Commit, push, open the PR.

---

### Task 3: Shard and select the standard library tests (spec 2a)

Branch `ci/stdlib-shards`, from `develop` after tasks 1 and 2 merged. Model:
Sonnet.

**Files:**

- Modify: `.github/workflows/engine-pull-request.yml` (pass `changed-files`)
- Modify: `.github/workflows/engine-checks.yml` (`workflow_call` input, pass it
  on)
- Modify: `.github/workflows/engine-checks-platform.yml` (inputs `changed-files`
  and `stdlib-shards`; new `stdlib-plan` job; both stdlib jobs)
- Modify: `.github/workflows/macos-checks.yml`,
  `.github/workflows/engine-checks-nightly.yml` (macOS leg:
  `stdlib-shards: false`)
- Modify: `.github/CLAUDE.md`

**Interfaces:**

- Consumes: `stdlib-test-plan` (task 2) and `tools/ci/stdlib-test-map.yaml`
  (task 1); `stdlib-test <suite> --only <list>` (exists).
- Produces: `engine-checks.yml` and `engine-checks-platform.yml` input
  `changed-files: string` (default `''` = every project);
  `engine-checks-platform.yml` input `stdlib-shards: boolean` (default `true`)
  and job `stdlib-plan` with output `matrix`.

- [ ] **Step 1: Pass the changed files down.** In `engine-pull-request.yml`,
      `engine-checks` job:

```yaml
engine-checks:
  name: ⚙️ Checks
  uses: ./.github/workflows/engine-checks.yml
  needs: [engine-changed-files]
  if:
    needs.engine-changed-files.outputs.any_changed == 'true' || github.ref ==
    'refs/heads/develop'
  with:
    # A pull request runs only the standard library tests its files can affect; develop runs all
    # (Note [Standard Library Test Selection] in `engine-checks-platform.yml`).
    changed-files:
      ${{ github.event_name == 'pull_request' &&
      needs.engine-changed-files.outputs.all_changed_files || '' }}
  secrets: inherit
```

In `engine-checks.yml`, replace `workflow_call: {}` with:

```yaml
workflow_call:
  inputs:
    changed-files:
      description: >-
        The pull request's changed files, space-separated, for the standard
        library test selection; empty runs every test project.
      required: false
      type: string
      default: ""
```

and pass `changed-files: ${{ inputs.changed-files || '' }}` in the `platform`
job's `with:` (a hand-started run has no such input, so it is `''`).

- [ ] **Step 2: Add the inputs** to `engine-checks-platform.yml`, after
      `stdlib-suites`:

```yaml
changed-files:
  description: >-
    A pull request's changed files, space-separated: the standard library tests
    run only the projects they can affect. Empty (the default, and always
    outside a pull request) runs every project.
  required: false
  type: string
  default: ""
stdlib-shards:
  description: >-
    Split each standard library suite into the shards of
    `tools/ci/stdlib-test-map.yaml`. The self-hosted Mac passes false: it is one
    runner, so shards would queue behind each other.
  required: false
  type: boolean
  default: true
```

- [ ] **Step 3: Add the `stdlib-plan` job**, before `stdlib-tests`:

```yaml
# Note [Standard Library Test Selection]
# ======================================
# The standard library suites run as parallel jobs, one per shard of
# `tools/ci/stdlib-test-map.yaml` (Table_Tests alone; Base, DuckDB and Cloud; the rest), and on a
# pull request only the projects its changed files can affect: a library's change selects every
# project importing it or a library that depends on it, a test project's change selects it and the
# projects importing it, and anything else selects every project. develop, hand-started runs and
# the other callers pass no changed files and run every project. `tools/build-scripts`'
# `stdlib-test-plan` decides, writes why in this job's summary, and returns the jobs as `matrix`;
# `stdlib-test --only` runs each job's projects. A new library or test project must be added to
# the map (`tools/ci/check-workflows.mjs` fails until it is).
stdlib-plan:
  name: Standard Library test plan (${{ inputs.os }}, ${{ inputs.arch }})
  if: inputs.stdlib-suites != '[]'
  runs-on: ubuntu-latest
  timeout-minutes: 10
  outputs:
    matrix: ${{ steps.plan.outputs.matrix }}
  steps:
    - name: Checking out the repository
      uses: actions/checkout@v5
    - uses: ./.github/actions/setup-node
    - name: Set up the build scripts
      uses: ./.github/actions/setup-build-scripts
    - id: plan
      name: Plan the Standard Library test jobs
      run: corepack pnpm --filter build-scripts run stdlib-test-plan
      env:
        STDLIB_SUITES: ${{ inputs.stdlib-suites }}
        CHANGED_FILES: ${{ inputs.changed-files }}
        STDLIB_SHARDS: ${{ inputs.stdlib-shards }}
```

- [ ] **Step 4: Point both stdlib jobs at it.** In `stdlib-tests`:

```yaml
stdlib-tests:
  name:
    Standard Library ${{ matrix.title }} Tests (${{ inputs.edition }}) (${{
    inputs.os }}, ${{ inputs.arch }})
  if:
    inputs.os == 'linux' && needs.stdlib-plan.result == 'success' &&
    needs.stdlib-plan.outputs.matrix != '[]'
  needs: [build-engine-distribution, stdlib-plan]
  # (runs-on, timeout-minutes, permissions, env unchanged)
  strategy:
    # Each job reports on its own, as when the suites were separate jobs.
    fail-fast: false
    matrix:
      include: ${{ fromJSON(needs.stdlib-plan.outputs.matrix) }}
```

The same `needs`, `if` (with `inputs.os != 'linux'`) and `matrix` in
`stdlib-tests-without-services`. In both jobs' "Run the Standard Library tests"
step:

```yaml
run:
  corepack pnpm --filter build-scripts run stdlib-test ${{ matrix.suite }}
  --only "${{ matrix.only }}"
```

In both "Standard Library Test Reporter" steps, make the check name unique per
job:

```yaml
name:
  Standard Library Tests Report (${{ matrix.title }}, ${{ inputs.edition }}, ${{
  inputs.os }}, ${{ inputs.arch }})
```

In `stdlib-tests`, the GraalPy wheel cache must be saved only by the job that
runs `Examples_Tests` (an entry is never overwritten, and a shard without it
never pip-installs numpy): change the `if:` of "Check for the GraalPy numpy
wheel" to

```yaml
if:
  ${{ !cancelled() && github.ref == 'refs/heads/develop' &&
  contains(format(',{0},', matrix.only), ',Examples_Tests,') }}
```

and update the last sentences of Note [GraalPy Wheel Cache] to "Only the job
that runs Examples_Tests saves it". The heap-dump artifact names already include
`matrix.title`, so they stay unique per shard: check.

- [ ] **Step 5: Keep the self-hosted Mac whole.** Add `stdlib-shards: false` to
      the `with:` of the `macos` job in `macos-checks.yml` and of the
      self-hosted `macos` job in `engine-checks-nightly.yml`, each with the
      comment "One self-hosted runner: shards would only queue behind each
      other."

- [ ] **Step 6: Document** in `.github/CLAUDE.md`: a Conventions bullet "**The
      standard library tests are sharded and selected** (Note [Standard Library
      Test Selection]): each suite runs as the shards of
      `tools/ci/stdlib-test-map.yaml`, and a pull request runs only the projects
      its changed files can affect; develop runs all. Add a new library or test
      project to the map." and a row in "Where the build logic lives":
      `engine-checks-platform.yml › Standard Library test plan` |
      `corepack pnpm --filter build-scripts run stdlib-test-plan` |
      `setup-build-scripts`. Update the stdlib-tests row to
      `stdlib-test <suite> --only <projects>`.

- [ ] **Step 7: Verify.** Policy script, its tests, actionlint. This PR changes
      workflows, so its own run selects every project: check the plan job's
      summary says so, that the Linux and Windows legs show the three shards
      plus AWS (and Microsoft on Linux), and record each stdlib job's duration
      against the medians above (Linux JVM 48, Linux Native 31, Windows JVM 33,
      Windows Native 41). Measure queueing too, as the PR now starts up to 20
      engine jobs at once (the free plan's concurrency limit is 20 jobs):

```bash
gh api "repos/jdunkerley/enso/actions/runs/<run id>/jobs?per_page=100" \
  --jq '[.jobs[] | select(.started_at != null) | ((.started_at|fromdate) - (.created_at|fromdate))] | max'
```

Record the largest queue time in seconds (today: 3–7). If any job queued more
than 3 minutes, say so in the PR: the fallback is two Windows shards (see
Decisions).

- [ ] **Step 8: Show the selection on a throwaway PR.** From this branch, make
      `ci/throwaway-stdlib-select` with one change: a comment line added at the
      end of `distribution/lib/Standard/Tableau/0.0.0-dev/src/Hyper_File.enso`
      (`# Throwaway: CI selection test.`). Open it as a draft PR against
      `ci/stdlib-shards`, labelled `CI: No changelog needed`. Expected: the plan
      jobs' summaries list the file and `Tableau_Tests`; on each OS only the
      Native and JVM "Others" shards run, each with `Tableau_Tests` only; the
      Table, Base, AWS and Microsoft jobs do not appear; "Engine Required
      Checks" passes. Link the run in this PR, then close the throwaway PR and
      delete its branch.

- [ ] **Step 9: Commit, push, open the PR.** After merge, check the next develop
      run plans every project and its stdlib jobs all pass.

---

### Task 4: JVM Tests use the build's ydoc native image (spec 2b)

Branch `ci/jvm-tests-no-ydoc-image`. Model: Sonnet.

**Background:** `jvm-tests` runs `sbt "all ydoc-server/buildNativeImage"` on
Linux (4.8 min on PR 40945989560, 7.1 on develop 40945709532), copied from the
retired build CLI. The image lands in the engine distribution's `component/`
(`build.sbt`, `ydoc-server` › `rebuildNativeImage`, `targetDir`), which the job
has just downloaded: `buildEngineDistribution` built it in the build job
(`Generating 'org.enso.ydoc.server.so'` in that job's log). No test under
`*/src/test` loads it: `git grep -n -i ydoc -- '*/src/test/*'` finds only the
JVM-side `ydoc-polyfill`/`ydoc-server` tests and two language-server specs,
which use the Java classes.

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml` (`jvm-tests`: remove
  the "Build the ydoc native image" step; Note [The JVM Test Steps])

- [ ] **Step 1: Confirm nothing needs the rebuilt image.** Run
      `git grep -n -i -e "ydoc" -- "*/src/test/*"` and
      `git grep -n "org.enso.ydoc.server.so\|libydoc\|ydoc.server.dll"` and read
      each hit. Expected: none loads the native library. If one does, stop and
      report it in the PR instead.

- [ ] **Step 2: Remove the step** (the `if: runner.os == 'Linux'` step named
      "Build the ydoc native image") and add to Note [The JVM Test Steps]:

```yaml
# - The retired build CLI rebuilt the ydoc native image here on Linux (4-7 min). It is not
#   rebuilt: the downloaded distribution's `component/` holds the one the build job made, and no
#   test loads it. The ydoc server's JavaScript bundle, which the tests do use, is still built by
#   `sbt test` (`ydoc-server`'s resource generator).
```

- [ ] **Step 3: Verify.** Policy script, its tests, actionlint. On the PR's run,
      compare Linux "JVM Tests" with develop: the duration (median 51 PR) and
      the test counts of the "Engine Tests Report (GraalVM CE, linux, amd64)"
      check, which must be identical:

```bash
gh api "repos/jdunkerley/enso/commits/<head sha>/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.name | test("Engine Tests Report")) | "\(.name): \(.output.title)"'
```

Run the same for the merge base's develop commit and put both in the PR.

- [ ] **Step 4: Commit, push, open the PR.**

---

### Task 5: Benchmarks in their own job (spec 2b)

Branch `ci/benchmarks-job`. Model: Sonnet. Merges after tasks 6 and 7: its new
job carries their two steps (if either has not merged when you rebase, leave
that step out and say so in the PR).

**Background:** the last step of Linux `jvm-tests` compiles the benchmarks and
runs the runtime ones once: 5.2 min (PR 40945989560) to 7.2 (develop
40945709532), after the 24–32 min `sbt test`. In its own job it runs alongside.
It needs the downloaded distribution (`runtime-benchmarks/bench` depends on
`buildEngineDistribution`; `std-benchmarks` needs a built distribution) and the
build job's version, as now.

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml` (remove the step from
  `jvm-tests`; new `jvm-benchmarks` job; Note [The JVM Test Steps])
- Modify: `.github/CLAUDE.md` ("Where the build logic lives")

- [ ] **Step 1: Remove the step** "Compile the benchmarks, and run the runtime
      ones once" from `jvm-tests`, and in Note [The JVM Test Steps] change "A
      failing `sbt test` does not stop the parser self-tests or the benchmark
      step" to "A failing `sbt test` does not stop the parser self-tests".

- [ ] **Step 2: Add the job** after `jvm-tests`:

```yaml
# Note [The Benchmark Job]
# ========================
# The benchmark compile and the one run of the runtime benchmarks that the retired build CLI's
# `backend test jvm` ended with, in a job of its own so that it runs alongside the JVM tests
# instead of after them (5-7 min off that job). Linux only, as before. It no longer waits for the
# parser self-tests: it compiles what it needs itself. The distribution and its version are the
# build job's (`bench` depends on `buildEngineDistribution`).
jvm-benchmarks:
  name:
    Benchmarks (${{ inputs.edition }}) (${{ inputs.os }}, ${{ inputs.arch }})
  if: inputs.jvm-tests && inputs.os == 'linux'
  needs: [build-engine-distribution]
  runs-on:
    ${{ startsWith(inputs.runner, '[') && fromJSON(inputs.runner) ||
    inputs.runner }}
  timeout-minutes: 45
  env:
    # Note [The Engine's Cargo Target Directory] (task 7)
    CARGO_TARGET_DIR: ${{ github.workspace }}/../cargo-target
  steps:
    - name: Checking out the repository
      uses: actions/checkout@v5
      with:
        clean: false
    - uses: ./.github/actions/setup-node
    # From task 6: the prebuilt CLI, so the ydoc bundle's postinstall does not `cargo install` it.
    - name: Install wasm-bindgen-cli
      uses: taiki-e/install-action@v2
      with:
        tool: wasm-bindgen-cli@0.2.128
    - name: Clean before
      uses: ./.github/actions/git-clean
    - name: Download the engine distribution
      uses: ./.github/actions/download-engine-distribution
      with:
        name:
          Engine Distribution (${{ inputs.edition }}) (native,test) (${{
          inputs.os }}, ${{ inputs.arch }})
    - name: Set up the JVM toolchain
      uses: ./.github/actions/setup-jvm
      with:
        cache-key: engine
        edition:
          ${{ inputs.edition == 'Oracle GraalVM' && 'oracle' || 'community' }}
        flatc: "true"
        rust: "true"
    # From task 7: restore only; the build job saves the entry.
    - uses: ./.github/actions/setup-rust
      with:
        shared-key: engine
        save: "false"
        workspaces: ". -> ../cargo-target"
    - name: Compile the benchmarks, and run the runtime ones once
      run:
        sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "all
        runtime-benchmarks/compile language-server/Benchmark/compile
        searcher/Benchmark/compile std-benchmarks/compile;
        runtime-benchmarks/bench"
      env:
        ENSO_VERSION:
          ${{ needs.build-engine-distribution.outputs.ENSO_VERSION }}
        ENSO_EDITION:
          ${{ needs.build-engine-distribution.outputs.ENSO_EDITION }}
        ENSO_RELEASE_MODE:
          ${{ needs.build-engine-distribution.outputs.ENSO_RELEASE_MODE }}
        LC_ALL: C.UTF-8
        SBT_SERVER_FORCESTART: "true"
    - name: Clean after
      if: always()
      uses: ./.github/actions/git-clean
```

- [ ] **Step 3: Check the limit.** The PR's run gives the job's first duration;
      it compiles the engine from scratch, so expect 15–25 min. If it is over 30
      min (45 / 1.5), raise `timeout-minutes` to 1.5× it and say so in the PR.

- [ ] **Step 4: Document** a row in `.github/CLAUDE.md` "Where the build logic
      lives": `engine-checks-platform.yml › Benchmarks` |
      `sbt … runtime-benchmarks/bench` (version from the build job) |
      `setup-jvm`.

- [ ] **Step 5: Verify.** Policy script (it checks `sbt` follows `setup-jvm`),
      its tests, actionlint. On the PR's run record Linux "JVM Tests" (median 51
      before) and "Benchmarks" durations, and that the engine push-to-green did
      not grow (Linux JVM Tests is off the critical path, so expect no change).

- [ ] **Step 6: Commit, push, open the PR.**

---

### Task 6: Prebuilt `wasm-bindgen-cli` in the engine jobs (spec 2b, third bullet)

Branch `ci/prebuilt-wasm-bindgen`. Model: Sonnet.

**Background:** the spec asks to skip the Rust WASM build in `JVM Tests`'
`pnpm install`. The WASM parser itself is not what costs: the tests need the
ydoc server bundle, `build:ydoc-server-polyglot` runs `postinstall` and
`pnpm -r compile` (both build `rust-ffi`), and `build-wasm.mjs`'s stamp makes
the repeats free. What costs is `build-wasm.mjs` running
`cargo install wasm-bindgen-cli` on every fresh runner: 1.2 min Linux, 2.9–3.2
min Windows, in both the build job (inside sbt) and `JVM Tests`. The GUI jobs
already install the prebuilt binary with `taiki-e/install-action`, which
`build-wasm.mjs` then finds (it checks `wasm-bindgen --version`). See Decisions.

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml`
  (`build-engine-distribution`, `jvm-tests`)
- Modify: `.github/workflows/ide-packaging.yml` (`build-backend`)
- Modify: `tools/ci/check-workflows.mjs` (`ROOT_FILES`, new
  `checkWasmBindgenPins`), `tools/ci/check-workflows.test.mjs`
- Modify: `.github/workflows/workflow-lint.yml` (`paths`: the pin's source)
- Modify: `app/rust-ffi/CLAUDE.md`, `tools/ci/README.md`

**Interfaces:**

- Produces:
  `export function checkWasmBindgenPins({ workflows, actions, files }): string[]`
  and `export const WASM_BINDGEN_SOURCE = 'app/rust-ffi/build-wasm.mjs'`.

- [ ] **Step 1: Write the failing tests** (add `checkWasmBindgenPins` to the
      imports):

```js
describe("checkWasmBindgenPins", () => {
  const source = {
    "app/rust-ffi/build-wasm.mjs": "const WASM_BINDGEN_VERSION = '0.2.128'\n",
  };
  const install = (version) =>
    `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 30\n    steps:\n      - uses: taiki-e/install-action@v2\n        with:\n          tool: wasm-bindgen-cli@${version}\n`;
  test("accepts installs at the pinned version", () => {
    assert.deepEqual(
      checkWasmBindgenPins(
        fixture({ "workflows/a.yml": install("0.2.128") }, source),
      ),
      [],
    );
  });
  test("rejects an install at another version", () => {
    assert.deepEqual(
      checkWasmBindgenPins(
        fixture({ "workflows/a.yml": install("0.2.127") }, source),
      ),
      [
        "a.yml: installs wasm-bindgen-cli@0.2.127, but app/rust-ffi/build-wasm.mjs pins 0.2.128",
      ],
    );
  });
});
```

- [ ] **Step 2: Run** `node --test tools/ci/check-workflows.test.mjs`. Expected:
      FAIL (not exported).

- [ ] **Step 3: Implement.** Add `WASM_BINDGEN_SOURCE` to `ROOT_FILES`, and:

```js
/** Where the `wasm-bindgen` CLI version is pinned; see `checkWasmBindgenPins`. */
export const WASM_BINDGEN_SOURCE = "app/rust-ffi/build-wasm.mjs";

/**
 * The prebuilt `wasm-bindgen` CLI that jobs install must be the version `build-wasm.mjs` pins:
 * with another one, `build-wasm.mjs` falls back to `cargo install` (minutes), or, if versions
 * drift the other way, emits bindings against the wrong ABI (`app/rust-ffi/CLAUDE.md`).
 */
export function checkWasmBindgenPins({ workflows, actions = {}, files }) {
  const source = files[WASM_BINDGEN_SOURCE];
  if (source == null) return [];
  const pinned = /const WASM_BINDGEN_VERSION = '([^']+)'/.exec(source)?.[1];
  if (pinned == null)
    return [`${WASM_BINDGEN_SOURCE}: no \`const WASM_BINDGEN_VERSION = '…'\``];
  const problems = [];
  const scan = (label, text) => {
    for (const [, version] of text.matchAll(/wasm-bindgen-cli@([\w.+-]+)/g)) {
      if (version !== pinned) {
        problems.push(
          `${label}: installs wasm-bindgen-cli@${version}, but ${WASM_BINDGEN_SOURCE} pins ${pinned}`,
        );
      }
    }
  };
  for (const [file, { text }] of Object.entries(workflows)) scan(file, text);
  for (const [name, { text }] of Object.entries(actions))
    scan(`actions/${name}`, text);
  return problems;
}
```

Add it to `CHECKS`. Run the tests: PASS; `node tools/ci/check-workflows.mjs`: OK
(the existing `gui-checks.yml` and `ide-packaging.yml` installs are at 0.2.128).

- [ ] **Step 4: Add the install step** to `build-engine-distribution` and
      `jvm-tests` in `engine-checks-platform.yml`, and to `build-backend` in
      `ide-packaging.yml`, right after `./.github/actions/setup-node` (before
      "Clean before": on develop `git-clean` runs `pnpm`, whose `postinstall`
      builds the WASM):

```yaml
# The prebuilt CLI: otherwise the ydoc bundle's `postinstall` (`app/rust-ffi/build-wasm.mjs`)
# runs `cargo install wasm-bindgen-cli`, 1.2 min on Linux and 3 on Windows. The version must be
# `WASM_BINDGEN_VERSION` in `build-wasm.mjs` (`check-workflows.mjs` checks it).
- name: Install wasm-bindgen-cli
  uses: taiki-e/install-action@v2
  with:
    tool: wasm-bindgen-cli@0.2.128
```

The step is the same on Windows (`taiki-e/install-action` supports it; it puts
the binary in `~/.cargo/bin`, where `build-wasm.mjs` looks).

- [ ] **Step 5: Keep the pin's site list true.** In `app/rust-ffi/CLAUDE.md`,
      "CI installs the same CLI from a prebuilt binary, so the version is also
      written in the `wasm-bindgen-cli@…` steps of" — list
      `engine-checks-platform.yml` (build, JVM tests), `ide-packaging.yml` (GUI
      build, backend build) and `gui-checks.yml`, and add "`check-workflows.mjs`
      fails a step at another version". Add the rule to `tools/ci/README.md`. In
      `workflow-lint.yml`, add `"app/rust-ffi/build-wasm.mjs"` to both `paths`
      lists with the comment "the `wasm-bindgen` pin".

- [ ] **Step 6: Verify.** Policy script, its tests, actionlint. In the PR's run
      logs (engine and IDE), check the build and JVM Tests jobs on both OSs
      print `rust-ffi: …` without `Installing wasm-bindgen-cli`. Record the
      durations of "Build Engine Distribution" (medians 22 Linux, 34 Windows),
      "JVM Tests" (51, 53) and the engine push-to-green (median 87).

- [ ] **Step 7: Commit, push, open the PR.**

---

### Task 7: Rust cache for the engine jobs (spec 2d)

Branch `ci/engine-rust-cache`. Model: Sonnet. Merges after task 6.

**Background:** two things defeat a plain `Swatinem/rust-cache` here. The build
job starts with `sbt clean`, and develop's "Clean after" (`git-clean`, i.e.
`git clean -xdf`) runs before the cache's post-job save; both delete the
checkout's `target/`, where `.cargo/config.toml` sends Cargo (`target/rust`). So
the engine jobs build into a target directory outside the checkout. The parser's
JNI library is built by sbt with its own `--target-dir` under
`lib/rust/parser/target`, which `sbt clean` deletes; it stays uncached.

**Files:**

- Modify: `.github/actions/setup-rust/action.yml` (inputs `save`, `workspaces`)
- Modify: `.github/workflows/engine-checks-platform.yml`
  (`build-engine-distribution`, `enso-code-lint`, `jvm-tests`: `env`, step)
- Modify: `.github/workflows/ide-packaging.yml` (`build-backend`: `env`, step)
- Modify: `tools/ci/prune-caches.mjs`, `tools/ci/prune-caches.test.mjs`
- Modify: `.github/CLAUDE.md` (cache note)

**Interfaces:**

- Produces: `setup-rust` inputs `save` (`"true"` default) and `workspaces`
  (`". -> target"` default, rust-cache's own default, so `gui-build` and
  `release.yml` behave as now). Engine jobs use `shared-key: engine`.

- [ ] **Step 1: Extend `setup-rust`:**

```yaml
inputs:
  shared-key:
    # (unchanged)
  save:
    description: >-
      Whether this job saves the cache on `develop` ("true", the default). Jobs
      sharing a key pass "false" except the one that compiles the most, so that
      it decides the entry.
    required: false
    default: "true"
  workspaces:
    description: >-
      `Swatinem/rust-cache`'s `workspaces`: the Cargo workspace and its target
      directory. The engine jobs build into `../cargo-target` (Note [The
      Engine's Cargo Target Directory] in `engine-checks-platform.yml`).
    required: false
    default: ". -> target"
runs:
  using: composite
  steps:
    - name: Cache Rust build
      uses: Swatinem/rust-cache@v2
      with:
        save-if:
          ${{ github.ref == 'refs/heads/develop' && inputs.save == 'true' }}
        shared-key: ${{ inputs.shared-key }}
        workspaces: ${{ inputs.workspaces }}
```

- [ ] **Step 2: Move the engine jobs' Cargo target and restore the cache.** Add
      this Note above `build-engine-distribution`:

```yaml
# Note [The Engine's Cargo Target Directory]
# ==========================================
# The jobs that compile Rust (the parser's WASM build and AST generator in the ydoc bundle, the
# Java generator, the syntax check) build into `../cargo-target`, next to the checkout, not into
# `.cargo/config.toml`'s `target/rust`: the build job starts with `sbt clean`, and on develop
# `git-clean` runs before the Rust cache's post-job save, and both delete `target/`. They share
# one cache entry per OS (`setup-rust`, key `engine`), which only the build job saves, on develop.
# The parser's JNI library is built by sbt into `lib/rust/parser/target` with its own
# `--target-dir` and is not cached (`sbt clean` deletes it).
```

In `build-engine-distribution`, `enso-code-lint` and `jvm-tests` (and
`build-backend` in `ide-packaging.yml`, with a one-line pointer to this Note),
add to the job's `env:` (create the block where there is none):

```yaml
CARGO_TARGET_DIR: ${{ github.workspace }}/../cargo-target
```

and right after "Set up the JVM toolchain" (which installs the toolchain the
cache's key hashes):

```yaml
- uses: ./.github/actions/setup-rust
  with:
    shared-key: engine
    save: "true" # "false" in every job but build-engine-distribution
    workspaces: ". -> ../cargo-target"
```

with `save: "false"` in `enso-code-lint`, `jvm-tests` and `build-backend`.

- [ ] **Step 3: Prune superseded Rust entries.** In `prune-caches.mjs`, extend
      the superseded rule to rust-cache's keys
      (`v0-rust-<shared key>-<OS>-<arch>-<8 hex>-<8 hex>`): replace `HASHED_KEY`
      and its two uses with:

```js
/**
 * The family of a key whose trailing hash changes when the cached inputs do: `<family>-<sha256>`
 * (`sbt-deps-*`, `node-cache-*`), or rust-cache's `v0-rust-<key>-<OS>-<arch>-<8 hex>-<8 hex>`.
 */
function familyOf(key) {
  return (
    /^((?:sbt-deps|node-cache)-.+)-[0-9a-f]{64}$/.exec(key)?.[1] ??
    /^(v0-rust-.+)-[0-9a-f]{8}-[0-9a-f]{8}$/.exec(key)?.[1]
  );
}
```

(`const family = familyOf(cache.key)` in both loops), update the header comment
("superseded: a dependency cache (`sbt-deps-*`, `node-cache-*`, `v0-rust-*`)"),
and add to `prune-caches.test.mjs`:

```js
test("keeps only the newest rust-cache entry per ref and key", () => {
  const develop = "refs/heads/develop";
  const old = cache(
    "v0-rust-engine-Linux-x64-41224fa4-c5f6eaaa",
    develop,
    "2026-10-25T00:00:00Z",
    "2026-10-29T00:00:00Z",
  );
  const fresh = cache(
    "v0-rust-engine-Linux-x64-41224fa4-f564551b",
    develop,
    "2026-10-28T00:00:00Z",
  );
  const windows = cache(
    "v0-rust-engine-Windows-x64-41224fa4-c5f6eaaa",
    develop,
    "2026-10-25T00:00:00Z",
    "2026-10-29T00:00:00Z",
  );
  assert.deepEqual(run([old, fresh, windows]), [
    "v0-rust-engine-Linux-x64-41224fa4-c5f6eaaa",
  ]);
});
```

Run `node --test tools/ci/prune-caches.test.mjs`: PASS.

- [ ] **Step 4: Document** in `.github/CLAUDE.md`, after the GraalPy wheel cache
      sentences: "The engine jobs that compile Rust share a Rust cache
      (`setup-rust`, key `engine`, `v0-rust-engine-<OS>-…`, saved on develop by
      the build job only) and build into `../cargo-target` (Note [The Engine's
      Cargo Target Directory])."

- [ ] **Step 5: Verify, with a go/no-go on the saving.** Policy script, tests,
      actionlint. The PR's own run restores nothing (only develop saves), so:
      merge only after measuring on develop. Merge, then:
  1. on the next develop run, check the entries exist and their size:
     `gh cache list --key v0-rust-engine --json key,sizeInBytes`. Budget: at
     most 600 MB per OS. If larger, open a follow-up PR setting
     `cache-targets: "false"` in `setup-rust` for the engine (registry and
     binaries only) and re-measure;
  2. on the next engine PR, compare in the build and JVM Tests logs the Cargo
     lines (`Finished … in …`) and the step durations with this plan's tables.
     Expected −0.5 to −2 min per job. If the build jobs save under 30 s on
     Windows, revert the PR (the entries cost budget for nothing) and record why
     in #417. Post the numbers as a PR comment either way.

- [ ] **Step 6: Commit, push, open the PR.**

---

### Task 8: Spike — can JVM Tests start without the build? (spec 2c)

Branch `ci/spike-jvm-tests-no-wait` (never merged). Model: Opus (the analysis is
the deliverable). Time box: **one working day and at most three CI runs**. Start
it first: on Windows, `JVM Tests` (43–55 min) waits for the build (31–35 min),
and that path is today's critical path, so the answer decides whether phase 2
reaches ≤ 55 min.

**Question:** does `sbt test` (with the parser self-tests) need anything from
the build job beyond what sbt builds itself? If not, `jvm-tests` drops
`needs: [build-engine-distribution]` and starts at once.

**What is known (2026-10-29):** the job downloads the distribution and passes
the build job's `ENSO_VERSION` only so that sbt's `engineDistributionRoot`
(`built-distribution/enso-engine-<version>-<os>-<arch>/enso-<version>`) points
at it. `runtime-integration-tests` passes
`-Dpolyglot.enso.languageHomeOverride=<engineDistributionRoot>/component`
(`build.sbt` around line 2884), and `languageHome` is also read by
`engine/language-server/src/test/scala/org/enso/languageserver/websocket/json/BaseServerTest.scala`,
`engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/SerializationManagerTest.java`
and
`engine/runtime-integration-tests/src/test/scala/org/enso/interpreter/test/InterpreterTest.scala`.

**Files:**

- Create (finding, its own docs-only PR):
  `docs/superpowers/specs/2026-10-30-ci-speed-2c-finding.md`
- Throwaway (never merged): `.github/workflows/engine-checks-platform.yml` on
  the spike branch

- [ ] **Step 1: Read.** List every place the JVM test run reads the downloaded
      distribution:
      `git grep -n "engineDistributionRoot\|built-distribution\|languageHome" -- build.sbt project "*/src/test/*"`,
      and for each `Test` task in `build.sbt` whether it depends on
      `buildEngineDistribution`, `createEnginePackage` or a native image. Note
      what each one reads (`component/` jars, `lib/Standard`, a native binary).

- [ ] **Step 2: Run the experiment.** On the spike branch, in `jvm-tests`:
      delete `needs: [build-engine-distribution]`, the "Download the engine
      distribution" step and every `ENSO_VERSION`, `ENSO_EDITION` and
      `ENSO_RELEASE_MODE` line (sbt then uses its default `0.0.0-dev`). Open a
      draft PR "[spike] JVM tests without the build — do not merge", labelled
      `CI: No changelog needed`. Let both OSs run.

- [ ] **Step 3: Compare with develop.** For the spike run and the develop run of
      its merge base, collect the "Engine Tests Report" titles (passed, failed,
      skipped) with the `check-runs` command of task 4, and the failing suites
      from the log:
      `gh run view --job <id> --log | grep -E "\*\*\* FAILED|\[error\] (Failed|Error)"`.
      Record the job durations and the start times (the spike's `JVM Tests`
      should start within ~1 min of the run).

- [ ] **Step 4: Classify each difference** as (a) needs only what sbt can build
      in the job (for example the `component/` jars: measure
      `sbt buildEngineDistributionNoIndex` with `ENSO_LAUNCHER=shell`, if that
      is the missing piece, in a second run), (b) needs a native image or the
      launcher (no sbt-only fix), or (c) a flake (re-run once; also check
      develop's history for the same assertion before blaming the change).

- [ ] **Step 5: Decide.**
  - **Go** if every difference is (a) or (c) and the extra in-job build, if any,
    keeps the Windows `JVM Tests` under the Windows build plus the slowest
    Windows stdlib shard (≈ 55 min).
  - **Partial go** if the (b) failures sit in few sbt projects: those projects'
    tests move to a small job that still needs the build, and the rest starts at
    once. Give the project list and both jobs' expected durations.
  - **No-go** otherwise, with the reason.

- [ ] **Step 6: Write the finding** in
      `docs/superpowers/specs/2026-10-30-ci-speed-2c-finding.md`: the question;
      what reads the distribution (step 1); the runs (IDs, counts, durations);
      the classification; the decision; for a go, the exact change (jobs,
      `needs`, env, steps) and the expected push-to-green, and a ticket for the
      implementation that names this file. Run `npx -y prettier@3 --check` on
      it. Open it as its own PR (docs only: it starts no CI), close the spike PR
      and delete its branch.

---

### After all tasks merge

- [ ] A Haiku agent re-runs the timing analysis of this plan's "measurements"
      section on the next ~10 engine PRs (job durations, per-project times from
      the logs, push to green) and compares with the targets: engine change ≤ 55
      min (≤ 40 if 2c works). Report before phase 3's design starts.
- [ ] Update the wiki's CI-and-Workflows page: the test map and how to add a
      library to it, the shards, the selection rules, the benchmark job, the
      Rust cache and the Cargo target directory.

## Decisions for the reviewer

1. **Selection uses each test project's own imports, and test projects importing
   test projects, not only "the test projects of every library that depends on
   it".** `Visualization_Tests` imports Geo, Image and AWS, and many projects
   import `Table_Tests`, `Base_Tests` or `Cloud_Tests` (`enso_dev.*`); the
   spec's rule would miss them. _Cost if wrong:_ a few small projects run that
   need not.
2. **The dependency relation is written in the map, and the policy requires it
   to equal the sources' top-level imports exactly** (the spec says the relation
   lives in the file, and a hand-kept relation drifts). Workflow Lint therefore
   also runs on standard library and test `.enso`/`package.yaml` changes. _Cost
   if wrong:_ a PR adding a cross-library import fails Workflow Lint until a
   one-line map edit, which the message spells out.
3. **"Everything" is wider than the spec's list.** Besides the engine,
   `Standard.Base` and shared `std-bits/` (`tests`, `benchmarks`), it covers
   `Standard.Test` (the harness), any `test/` path outside a `*_Tests` project
   (`Helpers`, `fixtures`, `Benchmarks`), workflows and `tools/build-scripts`,
   any library, `std-bits` directory or project the map does not know, and every
   non-PR run. _Cost if wrong:_ only runner time.
4. **A change inside `test/<X>_Tests/` selects X and the projects that import
   it** (spec silent). _Cost if wrong:_ a project that reads another's data
   files without importing it would be skipped; none does today
   (`Project_Description.new enso_dev.Table_Tests` in DuckDB_Tests comes with an
   import).
5. **Shards: Table_Tests | Base_Tests + DuckDB_Tests + Cloud_Tests | the rest**,
   as the spec says, confirmed by the measurements: Table_Tests (11–28 min) is
   the longest shard everywhere. The legs become ~14–31 min, not the spec's
   20–22: Linux Native Table_Tests alone reached 28.4. The AWS and Microsoft
   suites stay one job each; macOS (one self-hosted runner) is not sharded.
   _Cost if wrong:_ up to 20 engine jobs at once can hit the free plan's 20-job
   concurrency limit and queue; task 3 measures it, and the fallback is two
   Windows shards (Table | the rest: 16–20 min each), one map change.
6. **The plan job runs on `ubuntu-latest` for every platform**, also for the
   Windows and macOS callers: it needs only Node. _Cost if wrong:_ none
   expected; a Windows runner would add ~1 min per plan.
7. **No "run everything" label.** Touching any non-library file already runs
   everything, and develop always does. _Cost if wrong:_ a reviewer who wants a
   full run on a library-only PR pushes a no-op change to a workflow comment.
8. **The test reporter's check name gains `matrix.title`.** With shards, six
   jobs per OS would publish under one name. _Cost if wrong:_ none; nothing
   requires the check names (the ruleset requires no status check).
9. **2b's third bullet is done as "install the prebuilt `wasm-bindgen-cli`", not
   "skip the WASM build".** The tests need the ydoc bundle, whose build runs
   `postinstall` and `pnpm -r compile`, both of which build `rust-ffi`; the WASM
   build itself takes 18–42 s and runs once per job. The minutes are in
   `cargo install wasm-bindgen-cli` (1.2 Linux, 3 Windows), paid in the build
   jobs too, so task 6 also covers them, which puts it on the critical path. It
   adds three more copies of the version, so a policy rule now checks every copy
   against `build-wasm.mjs`. _Cost if wrong:_ none to correctness; if the WASM
   build could be avoided entirely, a further ~0.5 min per job is left.
10. **The ydoc native image step is removed rather than fed from the artifact**:
    the artifact already puts it in place (task 4). _Cost if wrong:_ a test that
    loads the native ydoc library would run against the build job's image (the
    same sources); task 4 step 1 checks no such test exists.
11. **The benchmark job no longer waits for the parser self-tests and compiles
    the engine itself** (~15–25 min of runner time, off the critical path).
    _Cost if wrong:_ ~15 extra runner-minutes per engine run.
12. **The Rust cache builds outside the checkout (`../cargo-target`) and only
    the build job saves it.** Inside the checkout, `sbt clean` and develop's
    `git-clean` delete it before it is used or saved. The JNI library stays
    uncached. The spec's "−3 to −5 min" for 2d mostly came from the
    `wasm-bindgen-cli` install, which task 6 removes, so task 7 expects −0.5 to
    −2 and carries its own revert rule. _Cost if wrong:_ up to ~1.2 GB of the 10
    GB cache for little gain, which the revert rule bounds. On the self-hosted
    Mac `../cargo-target` persists between runs; it grows until cleaned by hand.
13. **The spec's phase 2 target (≤ 55 min without 2c) is not reachable.** The
    critical path is now Windows: build 31–35 → JVM Tests 43–55 (`sbt test`
    alone 44). Tasks 3–7 bring the engine PR from a median of 87 to about 78;
    only task 8 (or splitting the runtime suite, which the spec puts out of
    scope) gets to ~55. _Recommendation:_ open the runtime-suite split ticket
    now, so that it is ready if task 8 says no-go. _Cost if wrong:_ none; it is
    a ticket.
14. **Task 8 is planned as a spike that ends in a written finding**, with an
    Opus model, a one-day time box and a three-run cap; its implementation is a
    follow-up ticket. _Cost if wrong:_ a day.
