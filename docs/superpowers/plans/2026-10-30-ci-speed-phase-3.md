# CI Speed Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take an engine PR's median push-to-green from ~57 to ≤ 40 min without
changing what is tested, by shortening the Windows critical path.

**Architecture:** Five tasks, each its own PR against `develop` from its own
worktree and branch. Task 1 (a group filter in `Standard.Test`) must merge
before Task 2 (splitting `Table_Tests` with it). Task 3 is a time-boxed
investigation that ends in a written finding. Task 4 (no ydoc image in the
engine checks) is independent. Task 5 (splitting JVM Tests) merges last. Tasks
2, 4 and 5 touch `.github/workflows/engine-checks-platform.yml`, so they merge
one at a time, with `develop` merged into the next in between.

**Tech Stack:** GitHub Actions (hand-written YAML), sbt (Scala build definitions
in `build.sbt` and `project/*.scala`), Enso (the `Standard.Test` library and
`test/Test_Tests`), TypeScript run by Node with vitest (`tools/build-scripts`),
Node test runner for `tools/ci/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-30-ci-speed-phase-3-design.md` (merged
#453). It argues from the CI speed design,
`docs/superpowers/specs/2026-10-29-ci-speed-design.md`.

## Global Constraints

- Goal: "An engine PR's median push-to-green **≤ 40 min** … with no change to
  what is tested."
- "A PR skips only what its changed files cannot affect; develop runs every job
  and every test project; every skip is visible."
- Free GitHub-hosted runners only (20 concurrent jobs on the free plan).
- Each PR records its before and after from **two runs of each** (run-to-run
  noise is 25–40 %): "before" is the two most recent green runs of the affected
  jobs on `develop` or on a PR that ran them; "after" is the PR's own run plus
  one full re-run (`gh run rerun <run id>`). Cite run IDs. Each PR also records
  its runs' largest job queue time (`started_at − created_at`).
- Test counts never drop: a change that splits tests proves the parts' counts
  add up to the unsplit run's, citing the runs.
- Follow `.github/CLAUDE.md` (timeouts, permissions, pinned actions, quoted `-D`
  arguments, `setup-jvm` before `sbt`, unchanged aggregator names) and the root
  `CLAUDE.md`.
- Check workflow changes with `node tools/ci/check-workflows.mjs` and
  `node --test tools/ci/*.test.mjs` (actionlint runs in the PR's Workflow Lint
  check). Changes to `tools/build-scripts` also pass
  `corepack pnpm --filter build-scripts run typecheck`, `run lint` and
  `run test:unit`.
- Every PR: label `CI: No changelog needed` (a user-visible library fix found by
  Task 3 instead gets a `CHANGELOG.md` entry); body written with the Write tool
  and passed with `--body-file`; "Part of the CI speed design (#417)"; the
  "Closes #N" of any ticket it finishes.
- Never run `git stash` in any form; never `git reset --hard`; never force-push;
  never `--no-verify`; leave `.claude/settings.local.json` out of commits.
  Commit messages end with the session's `Co-Authored-By` and `Claude-Session`
  lines; PR bodies end with the session's attribution.

## Rulings made while planning

- **Group filter, not `main`'s filter (Task 1).** The spec has `stdlib-test`
  pass the filter as the argument of `Table_Tests`' `main`. That argument goes
  to `Suite.run_with_filter`, which matches a group's name and, when the group
  does not match, each spec's name
  (`distribution/lib/Standard/Test/0.0.0-dev/src/Suite.enso`, `run_impl`). Spec
  names carry no backend prefix, so an "everything else" filter would also pick
  up the specs of the excluded groups and run them twice. Task 1 adds a
  group-only filter to `Standard.Test` instead (a `group_filter` argument of
  `run_with_filter`, defaulting to the `ENSO_TEST_GROUP_FILTER` variable), and
  `stdlib-test` sets the variable. Cost if wrong: a change to `Standard.Test`,
  which runs every standard-library test project on its PR.
- **Database, not OS (Task 2).** The spec limits the PostgreSQL shard by OS. The
  Windows suites are passed without `postgres` (`engine-checks.yml`), so a split
  part declares `needs: postgres` and the plan drops it for a suite entry
  without `postgres: true`. The "rest" part's filter is built from the parts
  that are kept, so on Windows it also runs the (skipped) PostgreSQL groups.
  Same effect as the spec, and it follows the database wherever it is.

## Merge order

Task 1 → Task 2; Task 4 whenever green; Task 5 last. Task 3 is a finding (a
docs-only PR) and merges whenever it is done. Before merging Task 2, 4 or 5,
merge `develop` into it if another of them merged first. Tasks 1, 3 and 4 can be
implemented in parallel from the start; Task 2 starts when Task 1 merges; Task 5
can be implemented in parallel and rebased last.

---

### Task 1: a group-only filter in `Standard.Test`

**Files:**

- Modify: `distribution/lib/Standard/Test/0.0.0-dev/src/Suite_Config.enso`
  (`Value`, `from_environment`)
- Modify: `distribution/lib/Standard/Test/0.0.0-dev/src/Suite.enso`
  (`run_with_filter`, `run_impl`)
- Modify: `distribution/lib/Standard/Test/0.0.0-dev/src/Internal/Helpers.enso`
  (new `groups_matching`)
- Create: `test/Test_Tests/src/Group_Filter_Spec.enso`
- Modify: `test/Test_Tests/src/Main.enso`

**Interfaces:**

- Produces: `Suite.run_with_filter self filter should_exit output group_filter`
  with `group_filter : (Text | Nothing) = Nothing`; when `Nothing`, the
  `ENSO_TEST_GROUP_FILTER` environment variable (unset or empty: no filter). A
  group whose name the regex does not match (`Regex.match`, so anchor with `^`)
  is dropped with all its specs. Task 2 relies on the variable's name and on
  this "group only" behaviour.

- [ ] **Step 1: Write the failing test.** Create
      `test/Test_Tests/src/Group_Filter_Spec.enso`:

```enso
from Standard.Base import all
from Standard.Test import all

import Standard.Base.Runtime.Ref.Ref

## Runs a small suite with `group_filter` and returns the names of the specs that ran.
private run_inner group_filter =
    ran = Ref.new []
    record name = ran.modify (_ + [name])
    inner = Test.build inner_builder->
        inner_builder.group "[PostgreSQL] Rounding" group_builder->
            group_builder.specify "[SQLite File] lookalike spec name" <| record "pg"
        inner_builder.group "[SQLite File] Rounding" group_builder->
            group_builder.specify "rounds" <| record "file"
        inner_builder.group "In-Memory Rounding" group_builder->
            group_builder.specify "rounds" <| record "memory"
    inner.run_with_filter should_exit=False output=(_->Nothing) group_filter=group_filter
    ran.get

add_specs suite_builder =
    suite_builder.group "group_filter" group_builder->
        group_builder.specify "runs every group without a group filter" <|
            run_inner Nothing . should_equal ["pg", "file", "memory"]

        group_builder.specify "runs only the groups whose name matches" <|
            run_inner "^\[SQLite File\]" . should_equal ["file"]

        group_builder.specify "does not fall back to spec names" <|
            # The PostgreSQL group's spec is named like a SQLite File group; it must not run.
            run_inner "^\[SQLite File\]" . contains "pg" . should_be_false

        group_builder.specify "takes a negative lookahead for the rest" <|
            run_inner "^(?!(?:\[PostgreSQL\]|\[SQLite File\]))" . should_equal ["memory"]
```

Add `import project.Group_Filter_Spec` and
`Group_Filter_Spec.add_specs suite_builder` to `test/Test_Tests/src/Main.enso`'s
`add_specs`, next to the existing ones.

- [ ] **Step 2: Run it and see it fail.** Build a distribution
      (`sbt buildEngineDistribution`, shell launcher; see root `CLAUDE.md`, and
      give cargo its own target directory under WSL), then, from `test/`:

```bash
cd test && JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Test_Tests"
```

Expected: the new group fails with an error that `run_with_filter` has no
argument `group_filter`.

- [ ] **Step 3: Implement.** In `Internal/Helpers.enso` (a private module, so
      only the library uses it), next to `name_matches`:

```enso
## Groups whose name matches `group_filter`: all of them when it is `Nothing`. A group that does
   not match is dropped with all its specs (unlike `run_with_filter`'s `filter`, which falls back
   to the specs' names).
groups_matching (groups : Vector) (group_filter : (Text | Nothing)) -> Vector =
    if group_filter.is_nothing then groups else
        groups.filter group-> name_matches group.name group_filter
```

In `Suite_Config.enso`, add the field and read the variable (an empty value
means no filter):

```enso
    Value (print_only_failures : Boolean) (output_path : (File | Nothing)) (use_ansi_colors : Boolean) (caller_project_root : File | Nothing) (group_filter : Text | Nothing)
```

```enso
        group_filter_text = Environment.get "ENSO_TEST_GROUP_FILTER" . if_nothing ""
        group_filter = if group_filter_text.is_empty then Nothing else group_filter_text
        Suite_Config.Value print_only_failures results_path use_ansi_colors project_root group_filter
```

Document `group_filter` in `Value`'s argument list. In `Suite.enso`, add the
argument to `run_with_filter` (document it: "Only groups whose name matches this
regex run, each with all its specs; defaults to the `ENSO_TEST_GROUP_FILTER`
environment variable"), pass it to `run_impl`, and filter the groups before the
existing `filter` logic:

```enso
    run_with_filter self (filter : (Text | Nothing) = Nothing) (should_exit : Boolean = True) (output:Text->Nothing=IO.println) (group_filter : (Text | Nothing) = Nothing) -> (Boolean | Nothing) =
        config = Suite_Config.from_environment
        self.run_impl output config filter should_exit (group_filter.if_nothing config.group_filter)
```

In `run_impl`, take `(group_filter : (Text | Nothing) = Nothing)` as its last
argument and replace `self.groups.flat_map` with
`(Helpers.groups_matching self.groups group_filter).flat_map`. Keep every other
caller of `run_impl` working (grep the library for `run_impl`).

- [ ] **Step 4: Run it and see it pass.** Same command as Step 2. Expected:
      `Test_Tests` passes, the new group included. Then check that the nested
      runs did not overwrite the project's JUnit file: run once more with
      `ENSO_TEST_JUNIT_DIR=$PWD/../target/junit-check` and confirm
      `../target/junit-check/Test_Tests/JUnit.xml` holds the outer suite's
      groups (`group_filter`, `pending is lazy`, …), not only the inner suite's
      three. If it holds only the inner suite's, the nested runs clobber it:
      move the four cases to `test/Base_Internal_Tests` calling
      `Helpers.groups_matching` directly (that project runs with
      `--disable-private-check`) and drop `run_inner`.

- [ ] **Step 5: Check the filter end to end.** With the distribution from Step
      2, from `test/`:

```bash
ENSO_TEST_GROUP_FILTER='^\[SQLite In-Memory\] Table\.join' JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Table_Tests"
```

Expected: only groups starting `[SQLite In-Memory] Table.join` (or whatever
groups that prefix names — check one group name in
`test/Table_Tests/src/Database/` first) run, a small non-zero number of tests.

- [ ] **Step 6: Commit and open the PR.** Title
      `Standard.Test: a group-only filter (ENSO_TEST_GROUP_FILTER)`. Body: the
      ruling above, the test, the end-to-end check's output, and that the PR
      runs every standard-library test project (it changes `Standard.Test`).

---

### Task 2: split `Table_Tests` by database backend

Needs Task 1 merged (branch from `develop` after it).

**Files:**

- Modify: `tools/build-scripts/src/stdlib-test/plan.ts` (map type,
  `MatrixEntry`, new `splitParts`, `planMatrix`, `planSummary`) and
  `plan.test.ts`
- Modify: `tools/build-scripts/src/stdlib-test/invocation.ts`
  (`testEnvironment`) and `invocation.test.ts`
- Modify: `tools/build-scripts/src/stdlib-test/run.ts` (the zero-test guard) and
  `run.test.ts`
- Modify: `tools/build-scripts/src/commands/stdlib-test.ts` (usage text, header
  comment)
- Modify: `tools/ci/stdlib-test-map.yaml` (the `split` of the Table shard and
  its documentation)
- Modify: `tools/ci/check-workflows.mjs` (`checkStdlibTestMap`: validate
  `split`) and `tools/ci/check-workflows.test.mjs`
- Modify: `.github/workflows/engine-checks-platform.yml` (`stdlib-tests` and
  `stdlib-tests-without-services`: pass the group filter; Note [Standard Library
  Test Selection])
- Modify: `.github/CLAUDE.md` (the sharding sentence),
  `tools/build-scripts/CLAUDE.md` (`stdlib-test`)

**Interfaces:**

- Consumes: Task 1's `ENSO_TEST_GROUP_FILTER` (group names only).
- Produces: matrix entries with an optional `group-filter`; job titles
  `<suite title> (Table <part>)`, e.g. `Native (Table PostgreSQL)`.

- [ ] **Step 1: Failing tests for the plan.** In `plan.test.ts`, with a map
      whose shards are:

```ts
const splitShards = [
  {
    name: "Table",
    projects: ["Table_Tests"],
    split: [
      {
        name: "PostgreSQL",
        groups: "\\[PostgreSQL\\]",
        needs: "postgres" as const,
      },
      { name: "SQLite File", groups: "\\[SQLite File\\]" },
      { name: "Rest" },
    ],
  },
  { name: "Others", projects: "*" as const },
];
```

add cases (use the file's existing fixtures for suites and projects):

```ts
test("a split shard is one job per part, with a group filter", () => {
  const matrix = planMatrix(
    [nativeWithPostgres],
    { ...map, shards: splitShards },
    projects,
    all,
    true,
  );
  expect(matrix.filter((m) => m.only === "Table_Tests")).toEqual([
    {
      ...nativeWithPostgres,
      title: "Native (Table PostgreSQL)",
      only: "Table_Tests",
      "group-filter": "^(?:\\[PostgreSQL\\])",
    },
    {
      ...nativeWithPostgres,
      title: "Native (Table SQLite File)",
      only: "Table_Tests",
      "group-filter": "^(?:\\[SQLite File\\])",
    },
    {
      ...nativeWithPostgres,
      title: "Native (Table Rest)",
      only: "Table_Tests",
      "group-filter": "^(?!(?:\\[PostgreSQL\\]|\\[SQLite File\\]))",
    },
  ]);
});

test("a part that needs postgres is dropped without it, and the rest covers its groups", () => {
  const matrix = planMatrix(
    [nativeWithoutPostgres],
    { ...map, shards: splitShards },
    projects,
    all,
    true,
  );
  expect(
    matrix
      .filter((m) => m.only === "Table_Tests")
      .map((m) => [m.title, m["group-filter"]]),
  ).toEqual([
    ["Native (Table SQLite File)", "^(?:\\[SQLite File\\])"],
    ["Native (Table Rest)", "^(?!(?:\\[SQLite File\\]))"],
  ]);
});

test("without sharding a split shard is not split", () => {
  const matrix = planMatrix(
    [nativeWithPostgres],
    { ...map, shards: splitShards },
    projects,
    all,
    false,
  );
  expect(matrix.some((m) => m["group-filter"] != null)).toBe(false);
});

test("a split shard must name exactly one project and end in one part without groups", () => {
  const bad = [
    {
      name: "T",
      projects: ["Table_Tests", "Base_Tests"],
      split: [{ name: "Rest" }],
    },
    { name: "O", projects: "*" as const },
  ];
  expect(() =>
    planMatrix(
      [nativeWithPostgres],
      { ...map, shards: bad },
      projects,
      all,
      true,
    ),
  ).toThrow(/one project/);
  const noRest = [
    {
      name: "T",
      projects: ["Table_Tests"],
      split: [{ name: "A", groups: "x" }],
    },
    { name: "O", projects: "*" as const },
  ];
  expect(() =>
    planMatrix(
      [nativeWithPostgres],
      { ...map, shards: noRest },
      projects,
      all,
      true,
    ),
  ).toThrow(/without `groups`/);
});
```

where `nativeWithPostgres` is
`{ suite: 'standard-library-in-native', title: 'Native', 'small-jdk': false, postgres: true }`
and `nativeWithoutPostgres` the same without `postgres`. Run
`corepack pnpm --filter build-scripts run test:unit`. Expected: these fail (no
`split`, no `group-filter`).

- [ ] **Step 2: Implement the plan.** In `plan.ts`:

```ts
/** One job of a split shard. */
export interface SplitPart {
  readonly name: string;
  /** A regex matched at the start of the project's test group names; the last part has none. */
  readonly groups?: string;
  /** The part runs only for a suite entry with this database. */
  readonly needs?: "postgres";
}
```

Add `readonly split?: readonly SplitPart[]` to the shard type in
`StdlibTestMap`, and `readonly 'group-filter'?: string` (documented as
"`ENSO_TEST_GROUP_FILTER`: the test groups this job runs") to `MatrixEntry`.
Then:

```ts
/**
 * The jobs a split shard becomes for `entry`, each with its group filter: the parts `entry` has
 * the database for, and a last part that runs every group the others leave out. Empty when the
 * shard is not split or only its last part is left.
 */
export function splitParts(
  split: readonly SplitPart[] | undefined,
  entry: SuiteEntry,
): { readonly name: string; readonly filter: string }[] {
  if (split == null) return [];
  const kept = split.filter(
    (part) => part.needs == null || entry[part.needs] === true,
  );
  const named = kept.flatMap((part) =>
    part.groups != null ? [part.groups] : [],
  );
  if (named.length === 0) return [];
  return kept.map((part) => ({
    name: part.name,
    filter:
      part.groups != null
        ? `^(?:${part.groups})`
        : `^(?!(?:${named.join("|")}))`,
  }));
}
```

In `planMatrix`, validate each shard with a `split` before the loop (throw
`Error('Shard <name>: a split shard names one project.')` unless `projects` is a
one-element array, and
`Error('Shard <name>: a split ends in exactly one part without \`groups\`.')`unless exactly the last part lacks`groups`). In the shard loop, replace the single `matrix.push`
with:

```ts
if (only.length === 0) continue;
const parts = splitParts(shard.split, entry);
if (parts.length === 0) {
  matrix.push({
    ...entry,
    title: `${entry.title} (${name})`,
    only: only.join(","),
  });
} else {
  for (const part of parts)
    matrix.push({
      ...entry,
      title: `${entry.title} (${name} ${part.name})`,
      only: only.join(","),
      "group-filter": part.filter,
    });
}
```

(destructure `shard` rather than `{ name, projects: listed }` so `shard.split`
is in reach). `planSummary`'s table gains a third column, `Groups`
(`entry['group-filter'] ?? 'all'`). Run the unit tests: the new cases pass and
the old ones still do (update the summary test's expected table).

- [ ] **Step 3: Failing tests for the runner's guard.** In `run.test.ts`, using
      its fake context, add: (a) with
      `env.ENSO_TEST_GROUP_FILTER = '^\\[SQLite File\\]'` and
      `only: ['Table_Tests']`, a run whose JUnit directory holds a
      `Table_Tests/JUnit.xml` with only `<skipped>` cases returns 1 and logs an
      `::error` containing `ran no test`; (b) the same with one passing case
      returns 0; (c) with the variable set and two projects selected,
      `runStdlibTests` rejects with `/one project/`. In `invocation.test.ts`: an
      empty `ENSO_TEST_GROUP_FILTER` is dropped from `testEnvironment`'s result,
      a non-empty one is kept. Run them: they fail.

- [ ] **Step 4: Implement the guard.** In `invocation.ts` `testEnvironment`,
      after the service variables loop:
      `if (env.ENSO_TEST_GROUP_FILTER === '') delete env.ENSO_TEST_GROUP_FILTER`.
      In `run.ts`, after `projects` is computed:

```ts
const groupFilter = env.ENSO_TEST_GROUP_FILTER ?? "";
if (groupFilter !== "" && projects.length !== 1)
  throw new Error(
    `ENSO_TEST_GROUP_FILTER (${groupFilter}) applies to one project; this run selects ` +
      `${projects.length}. Narrow it with --only.`,
  );
if (groupFilter !== "") context.log(`Test groups: ${groupFilter}`);
```

and replace `context.appendSummary(summaryMarkdown(readJUnitDir(junitDir)))`
with:

```ts
const results = readJUnitDir(junitDir);
context.appendSummary(summaryMarkdown(results));
if (groupFilter !== "") {
  for (const project of projects) {
    const { pass, fail } = count(results.get(project) ?? []);
    // A filter that matches no group still exits 0 (root CLAUDE.md): a typo would pass silently.
    if (pass + fail === 0)
      failures.push(`${project}: the group filter ${groupFilter} ran no test`);
  }
}
```

(import `count` from `./junit.ts`). If `run.test.ts`'s fake context cannot
supply JUnit files, give `StdlibTestContext` a
`readResults: (dir: string) => Map<string, TestCase[]>` member, pass
`readJUnitDir` from the command, and fake it in the tests. Update
`stdlib-test.ts`'s header comment and `tools/build-scripts/CLAUDE.md`'s
`stdlib-test` entry: "`ENSO_TEST_GROUP_FILTER` (one project only) runs the test
groups whose names match; a run in which it ran no test fails." Run the unit
tests, `typecheck` and `lint`: all pass.

- [ ] **Step 5: The map, its policy and the workflow.** In
      `tools/ci/stdlib-test-map.yaml`, replace the Table shard with:

```yaml
- name: Table
  projects: [Table_Tests]
  # One job per database backend (the backends take about a third of the time each). A part
  # with `needs` runs only where its suite has that database; the last runs every other group.
  split:
    - { name: PostgreSQL, groups: '\[PostgreSQL\]', needs: postgres }
    - { name: SQLite File, groups: '\[SQLite File\]' }
    - { name: Rest }
```

and extend the comment above `shards:` to describe `split`. In
`check-workflows.mjs` `checkStdlibTestMap`, report a shard whose `split` names
more than one project, lacks exactly one last part without `groups`, or has a
`needs` other than `postgres`; add a failing and a passing case for each to
`check-workflows.test.mjs`. In `engine-checks-platform.yml`, add to the "Run the
Standard Library tests" step's `env` in **both** `stdlib-tests` and
`stdlib-tests-without-services`:

```yaml
ENSO_TEST_GROUP_FILTER: ${{ matrix.group-filter || '' }}
```

and say in Note [Standard Library Test Selection] that a split shard's jobs each
run a slice of one project's test groups (`ENSO_TEST_GROUP_FILTER`), with the
guard. Update `.github/CLAUDE.md`'s sharding sentence the same way. Run
`node tools/ci/check-workflows.mjs` (`Workflow policy: OK`) and
`node --test tools/ci/*.test.mjs`.

- [ ] **Step 6: Local plan check.** Run the plan with the inputs of a Linux and
      a Windows `pull_request` run that changes a Table file (`STDLIB_SUITES`
      as in `engine-checks.yml`; for Windows drop the `postgres` and `mssql`
      keys):

```bash
STDLIB_SUITES='[{"suite": "standard-library-in-native", "title": "Native", "small-jdk": false, "postgres": true, "mssql": false}, {"suite": "standard-library", "title": "JVM", "small-jdk": true, "postgres": true, "mssql": false}]' \
  CHANGED_FILES='distribution/lib/Standard/Table/0.0.0-dev/src/Main.enso' \
  STDLIB_SHARDS=true GITHUB_EVENT_NAME=pull_request \
  corepack pnpm --filter build-scripts run -s stdlib-test-plan
```

Expected on Linux: `Native (Table PostgreSQL|SQLite File|Rest)` and the same for
JVM; on Windows: `SQLite File` and `Rest` only.

- [ ] **Step 7: Commit, open the PR, prove the counts.** Title
      `CI: split Table_Tests by database backend`. After CI, record per OS and
      suite the Table parts' pass/fail/skip (from each job's step summary) and
      their sums against the unsplit `Table_Tests` counts of the "before" runs;
      the passes and failures must match exactly (skips may differ only by the
      PostgreSQL groups on Windows, which skip in the Rest part as before).
      Record the slowest Native Table part's duration per OS against the old
      Native (Table) shard (before: 25m13 Linux, 23m47 Windows in run
      41024999010), and the queue time.

---

### Task 3: why are the Rounding tests slow? (time-boxed investigation)

A finding, not a code change. Time box: one working session of the investigating
agent (stop at the first of: a confirmed cause, or the box used up). Recommended
model: Opus.

**Files:**

- Create: `docs/superpowers/specs/2026-10-30-ci-speed-3b-finding.md`
- Read:
  `test/Table_Tests/src/Common_Table_Operations/Column_Operations_Spec.enso`
  (the group `Rounding numeric tests`), and the `round` implementations it
  reaches (`distribution/lib/Standard/Table/`, `.../Database/`).

- [ ] **Step 1: Measure the cases.** From a run's JUnit (the test reporter's
      summary or the job's step summary), list the 32 cases per backend with
      their times; note which are slow on all backends and which on one. The
      numbers to beat: 135 s (PostgreSQL), 112 s (SQLite File), 90 s (SQLite
      In-Memory) on Linux Native; 190 s in total on the JVM suite (run
      41024999010).
- [ ] **Step 2: Reproduce locally on one backend.** Using Task 1's group filter
      (or `main`'s filter on the group name):
      `ENSO_TEST_GROUP_FILTER='Rounding numeric tests'` and run `Table_Tests` as
      in Task 1 Step 5 (JVM launcher is fine). Time it.
- [ ] **Step 3: Find where the time goes.** Look for per-case setup that repeats
      (a table built or uploaded per case, a connection opened per case, a
      cross-product of inputs), and profile one case if that is not it
      (`--profiling-path` of the `enso` launcher, or timing around parts of the
      spec).
- [ ] **Step 4: Write the finding.** Cause, evidence, and one of: (a) a library
      performance bug, with the proposed fix and whether users would notice (a
      follow-up PR with a changelog entry); (b) a test cost, with a
      restructuring that keeps every case and assertion; (c) no cause found
      within the box, with what was ruled out. Expected saving per Table part.
      Open it as a docs-only PR (`docs/superpowers/**` starts no workflows).
- [ ] **Step 5: The follow-up.** For (a) or (b), the fix is its own PR after the
      finding merges, with the before/after of the Table parts (two runs each).
      For (c), nothing.

---

### Task 4: no ydoc native image in the engine checks

**Files:**

- Modify: `project/GraalVM.scala` (`EnsoLauncher`: a `-ydoc` component)
- Modify: `build.sbt` (`buildEngineDistributionNoIndex`)
- Modify: `.github/workflows/engine-checks-platform.yml`
  (`build-engine-distribution`'s `ENSO_LAUNCHER`, its comment)
- Modify: `.github/CLAUDE.md` if it describes the build job's output

**Interfaces:**

- Produces: `ENSO_LAUNCHER` accepts `-ydoc`, which leaves the ydoc server's
  native image out of `buildEngineDistributionNoIndex` (as `-ls` leaves the
  language server out of the runner image).

- [ ] **Step 1: Audit the consumers.** List every job that downloads the engine
      distribution artifact (`download-engine-distribution` in `.github/`),
      every caller of `engine-checks-platform.yml` (`engine-checks.yml`,
      `engine-checks-nightly.yml`, `macos-checks.yml`,
      `extra-nightly-tests.yml`), and every reference to the ydoc image's file
      in the repository
      (`git grep -n "ydoc" -- project build.sbt tools/build-scripts .github`).
      For each consumer, say whether it starts the ydoc server or checks its
      file (`EngineDistributionChecks`, `verifyGeneratedPackage`,
      `checkIRCacheSizes`). Stop and report if any does: the switch would break
      it.
- [ ] **Step 2: Add the component.** In `project/GraalVM.scala` add
      `disableYdoc` to `parsed` (a seventh flag) with
      `case "-ydoc" => disableYdoc = true`, and
      `def disableYdoc: Boolean = parsed._7` beside the others; document it in
      the object's comment with `-ls`.
- [ ] **Step 3: Skip the image.** In `build.sbt`, rewrite the task so that the
      ydoc image is not even scheduled when disabled (an `if` inside a
      `Def.taskIf` branch does not stop `.value`; use `Def.taskDyn`):

```scala
buildEngineDistributionNoIndex := Def.taskDyn {
  createEnginePackageNoIndex.value
  if (!shouldBuildNativeImage.value) Def.task(())
  else if (GraalVM.EnsoLauncher.disableYdoc)
    Def.task {
      (`engine-runner` / buildNativeImage).value
      (`engine-runner` / checkNativeImageSize).value
    }
  else
    Def.task {
      (`ydoc-server` / buildNativeImage).value
      (`engine-runner` / buildNativeImage).value
      (`engine-runner` / checkNativeImageSize).value
    }
}.value
```

Keep the existing `ThisBuild / buildEngineDistributionNoIndex` definition as it
is.

- [ ] **Step 4: Check locally that the switch works.** Linux (WSL) is faster:
      `ENSO_LAUNCHER=native,test,-ydoc sbt buildEngineDistributionNoIndex` and
      confirm the log has the `engine-runner` native image and no `ydoc-server`
      one; then `ENSO_LAUNCHER=native,test` and confirm both are still built.
      (If a full native build is too slow locally, say so and leave it to CI:
      the log of Build Engine Distribution shows which images were built.) Run
      `sbt "scalafmtCheckAll; scalafmtSbtCheck"`.
- [ ] **Step 5: Use it in the engine checks.** In `engine-checks-platform.yml`,
      set `ENSO_LAUNCHER: native,test,-ydoc` in `build-engine-distribution`'s
      `env`, and say in its comment why (no engine check starts the ydoc server;
      IDE packaging builds its own backend, ydoc image included). If the
      artifact name or a download step spells `native,test`, keep the name
      unchanged (it is a label) and say so in the comment.
- [ ] **Step 6: Commit, open the PR, measure.** Title
      `CI: the engine checks build no ydoc native image`. Record the Windows and
      Linux build step's duration (two runs each) against the "before" runs, the
      absence of the ydoc image in the build log, and that every job that
      downloads the distribution is green.

---

### Task 5: split JVM Tests across jobs (#433)

Merges last. Closes #433.

**Files:**

- Modify: `.github/workflows/engine-checks-platform.yml` (`jvm-tests`: a matrix
  of parts; Note and comment block)
- Modify: `.github/CLAUDE.md` (the JVM Tests row)
- Create (scratch, not committed): the per-project timing table

**Interfaces:**

- Consumes: the JVM tests step as it is on `develop` (bash, `pipefail`, the
  count of `[success] Total time` lines, #447/#448).
- Produces: `jvm-tests` jobs named
  `JVM Tests (<edition>) (<os>, <arch>) (<part>)`, each with its own test report
  (`Engine Tests Report (<edition>, <os>, <arch>, <part>)`) and heap-dump
  artifact.

- [ ] **Step 1: Measure per project.** From the JVM tests step of two recent
      green Windows and Linux runs (for example the runs of #448 and #450), find
      each sbt project's test time: sbt runs projects one at a time
      (`parallelExecution := false`), so take the timestamp between one
      project's first test output and its `Passed: Total` / `Tests:` summary
      lines. List the projects (`sbt projects`) and their times; the slowest
      should account for most of the ~37 min (Windows) / ~26 min (Linux) of
      `test`.
- [ ] **Step 2: Choose 2–3 parts.** Group the projects so the slowest part's
      test time plus its fixed cost (job setup ~5 min Windows, the engine
      package ~8 min Windows when the part needs it) is as low as possible.
      Write the table in the PR. A part's tests need the engine package if they
      read `engineDistributionRoot` (the 2c finding's table:
      `runtime-integration-tests` and the `std-benchmarks` compile do).
- [ ] **Step 3: Check the "rest" mechanism locally.** The last part runs `test`
      with the other parts' projects turned off. Confirm that a `set` disables a
      project's tests inside an aggregate `test` on a cheap project first:

```bash
sbt "-Dsbt.server.autostart=false" "set pkg / Test / test := {}; pkg/test"
```

Expected: no tests run for `pkg`, `[success] Total time` printed. (`set` lines
print no `Total time`; the JVM tests step relies on that, as at #448.)

- [ ] **Step 4: The matrix.** Give `jvm-tests` a `strategy` with
      `fail-fast: false` and one `include` entry per part, e.g.:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - part: runtime
        tasks:
          buildEngineDistributionNoIndex; set Global / parallelExecution :=
          false; runtime-integration-tests/test
        successes: 2
      - part: rest
        tasks:
          buildEngineDistributionNoIndex; set Global / parallelExecution :=
          false; set runtime-integration-tests / Test / test := {}; test
        successes: 2
```

(the real entries come from Step 2; `successes` counts the commands that are
tasks, not `set`s). The step runs
`sbt "-Dbench.compileOnly=true" "-Dsbt.server.autostart=false" "${{ matrix.tasks }}"`
into the log, and the check compares the count with `${{ matrix.successes }}`
instead of `2`. Put `(${{ matrix.part }})` in the job name, the test report name
and the heap-dump artifact name. Keep "Parser self-tests" in one part only
(`if: matrix.part == 'rest'` added to its condition). Keep every other step as
it is. Re-check `timeout-minutes` against the new parts' durations (90 unless
1.5× headroom needs more).

- [ ] **Step 5: Check callers and gates.** `engine-checks.yml`,
      `engine-checks-nightly.yml` and `macos-checks.yml` call the job through
      `jvm-tests: true`; confirm none reads its job name or outputs, and that
      the "Engine Required Checks" aggregator still waits for every part. Run
      `node tools/ci/check-workflows.mjs` and its tests.
- [ ] **Step 6: Commit, open the PR, prove the counts.** Title
      `CI: split JVM Tests across jobs (#433)`, "Closes #433". After CI: the
      parts' test report counts summed per OS against develop's (1882 passed /
      49 skipped on Windows, 1888 / 43 on Linux, at #448), each part's success
      count line, and when the last Windows part ends (minutes after the run
      starts) against the "before" runs (~51 min), two runs each, plus queue
      times.

---

## Closing the phase

- After Tasks 1–5 (and Task 3's follow-up, if any) merge: the final whole-branch
  review (Opus) over the phase's commits, as in phase 2.
- The re-measure over ~10 ordinary PRs on post-phase-3 `develop` (push-to-green
  medians per scenario and queue times) decides whether ≤ 40 min was reached. If
  queueing has grown, the shared engine build comes back (spec, "Concurrency").
