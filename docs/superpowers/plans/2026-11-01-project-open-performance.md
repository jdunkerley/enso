# Project Open Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cold open of a new project, from the click to the welcome table,
takes 4 s or less on Windows and Linux with the native launcher and the
core-only template, and a CI job records the open-time phases on every develop
push and warns when they regress. The same harness produces the
native-against-JVM comparison that the JVM decision waits for.

**Architecture:** Eight tasks, each its own PR against `develop` from its own
worktree and branch. Task 1 turns the spike's Playwright driver into
`app/electron-client/perf/openTime.ts` with a CI step in `ide-packaging.yml`; it
changes no behaviour. Every later task is one fix from section 1 of the spec and
proves itself with the harness's before and after medians: start-up health
polling (Task 2), the suggestion database requested at connect time (Task 3),
one bindings cache read per library (Task 4), no open-time edit for a new
project (Task 5), the Windows connect gap (Task 6) and the Windows
second-project engine start (Task 7), each traced first, and the first
visualisation not deferred, with widget queries after the visible visualisations
(Task 8, which carries the changelog entry).

**Tech Stack:** TypeScript (`app/electron-client` with Playwright's `_electron`
and vite-node, `app/gui` Vue and vitest, `app/ydoc-server` vitest,
`app/project-manager-shim` vitest), Scala and Java (`engine/runtime`,
`engine/runtime-instrument-common`, `engine/language-server`; JUnit, ScalaTest),
GitHub Actions YAML and the workflow policy (`tools/ci/check-workflows.mjs`,
`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`
(merged #488). The spike's driver and scripts (`drive.cjs`, `ydc/tm-op.mjs`,
`gui_an.py`, `summ.py`, `merge.py`) and its run logs are in the controller's
session scratchpad, `open-perf/`; Task 1 is a port of `drive.cjs` and
`gui_an.py`, and nothing else reads them.

## Global Constraints

- The spec's decisions stand: the target is click to the welcome table shown in
  ≤ 4 s cold on Windows and Linux, native launcher, core-only template (#482);
  the CI job records the phases on every develop push and warns, never fails;
  the JVM move is decided after these fixes on a native-against-JVM run of the
  same harness, and Native Image stays until then.
- One task, one fix, one PR. Every fix PR gives the harness's before and after
  medians in its description (Task 1's "Proof" section says how).
- Verify on Linux (WSL; source `~/.enso-toolchain.sh` first, and give cargo its
  own `CARGO_TARGET_DIR`) as well as Windows, as the root `CLAUDE.md` says.
- A local release build for measurement uses
  `ENSO_VERSION=2026.1.1-rc.1 ENSO_EDITION=2026.1.1-rc.1`, and deletes
  `target/rust/parser-jni` first, or the parser is a debug build.
- Unset the credential environment variables (`ENSO_*`, `AWS_*`, `SNOWFLAKE*`,
  `GOOGLE_*`, `AZURE_*`, `GCP_*`, `DATABRICKS*`) before any test or harness run.
  The harness strips them itself; a test run does not.
- Java and Scala changes pass `sbt "scalafmtCheckAll; javafmtCheckAll"` (run
  `javafmtAll` and `scalafmtAll` first).
- TypeScript changes pass the package's `typecheck`, `lint` and unit tests
  (`corepack pnpm --filter <package> run typecheck`, `run lint`,
  `run test:unit`; for `enso`,
  `corepack pnpm --filter enso exec vitest --run tests/headless`), and
  `corepack pnpm exec prettier --check` on the changed files.
- Workflow changes pass `node tools/ci/check-workflows.mjs`,
  `node --test tools/ci/*.test.mjs` and actionlint (`.github/CLAUDE.md`,
  "Checking a change").
- Never run `git stash` in any form, `git reset --hard`, a force-push or
  `--no-verify`; leave `.claude/settings.local.json` out of commits. Never push
  to the wiki. PR bodies are written with the Write tool and passed with
  `--body-file`, and end with the session's attribution. Commit messages end
  with exactly these two lines, whatever model writes them:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

## Rulings made while planning

- **Order (merge order below).** By risk and dependency: the harness first,
  since every fix is measured with it; then the smallest, most contained fixes
  (Task 2, the shim's polling; Task 3, one GUI request moved; Task 4, one engine
  cache), so each later measurement starts from a quieter baseline; then Task 5,
  which builds on #482 (merged: it edits the template #482 rewrote, and builds
  on the template test #482 added); then the two Windows traces (Tasks 6 and 7),
  which touch nothing the others do; and last Task 8, the largest saving and the
  only change to locking and to the order in which the GUI attaches
  visualisations. Task 8 is measured after Task 3, because Task 3 moves what
  Task 8's wait was stuck behind. No suggestion job takes the compilation lock.
  But `search/getSuggestionsDatabase` makes the runtime run
  `InvalidateModulesIndexCommand`, which schedules an `EnsureCompiledJob`, and
  that job holds the write compilation lock. In the spike's debug run
  (`win/devd-core-1`, second open) it took that lock 11 ms after the first
  execution. The deferred welcome table's `ExecuteJob` then did not start for
  2.4 s (5.81 s → 8.25 s after the click), and the table showed at 8.76 s.
- **One changelog entry, carried by Task 8 (the user's instruction,
  2026-11-01).** An open users can feel is a visible change, but each fix alone
  saves 0.1–2.5 s and none is a feature. Tasks 1–7 take the
  `CI: No changelog needed` label (add it when opening the PR); Task 8 adds one
  entry under `#### Enso IDE`, "Projects open faster", in the
  `- [Description][NNN]` form with
  `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, NNN Task 8's own PR
  number (open the PR, then add the entry). Task 8 is ordered last so that it is
  the last fix to merge. Should Task 6 or 7 merge after it anyway, it keeps the
  label: the entry already describes the result. Task 1 changes nothing users
  see.
- **The harness opens projects it creates beforehand, from the drive (Task 1).**
  The spec says the harness "creates a new project from the template". The spike
  created each project with the packaged engine's `enso --new` (the same command
  `EnsoRunner.createProject` runs for the dashboard's New Project button,
  `ensoRunner.ts:512`) and opened it by double-clicking its row, so the click
  marks the open alone, not the creation. The harness does the same: two
  projects per launch, created with the bundled launcher before the app starts,
  each never opened before. The first open of a launch is the cold one the
  target is about. The second (another project in the same session, the case
  Task 7 traces) is reported beside it.
- **"Cold" means a fresh IDE process and a project never opened (Task 1).** The
  project names are unique per launch (`OpenTime<base-36 time>a`/`b`), so no
  project IR cache exists. The harness also deletes the two projects' caches
  (`<data dir>/cache/ir/local/<name>`, after `DistributionManager`'s
  `irCacheDirectory`, `cache/ir`) after the launch, but only to tidy up: the
  unique names already make each open cold. The standard library's caches stay
  as installed: the packaged native engine has its standard library compiled in
  ahead of time (Note in `app/electron-client/globalSetup.ts`), and a JVM run
  uses the caches its bundle ships, as a user's would.
- **The phases and where each mark comes from (Task 1).** Each is ms from the
  click on the project's row, for the first and the second open:
  - `engineUp`: the first line of Electron's stdout containing
    `org.enso.runner.Utils` (the launcher's first output, inherited through the
    shim's `stdio: ['pipe', 'inherit', 'pipe']`, `ensoRunner.ts:584`), else the
    Language Server log's first line;
  - `lsReady`: the log's `Started server at json`;
  - `openAnswered`: the response to `/api/project-service/project/open`;
  - `guiConnected`: the GUI opening the WebSocket whose URL contains
    `/project/index` (the ydoc socket; the spike's `ws_index`);
  - `firstNode`: the first `.GraphNode` visible;
  - `firstExecution`: the log's `The first execution finished.`;
  - `welcomeShown`: a `.TableVisualization` containing `Welcome To Enso!`.

  After the welcome table, as `drive.cjs` does, the harness opens the component
  browser and the `format` dropdown and records `cbEntries`, `formatWidget` and
  `dropdownItems`: Task 8 must show that the widget queries it moves still
  arrive. These come after the headline mark and do not change it. The harness
  uses the spike's alternative selectors for each. A launch that misses one of
  these extras records it in the run's `notMeasured` list, and the report gives
  a warning for it. It never passes silently.

- **The baseline is the core template (Task 1).** #482 has merged, so develop's
  template imports only Base, Table, Database, Examples and Visualization, and
  Task 1's local runs are compared with the spec's "core" columns (Windows 6811,
  Linux 6198 ms to the welcome table). The report still records which template
  it measured: `template` is `core` when the template's `Main.enso` has no
  `Standard.AWS` import, `full` otherwise. The 15% comparison is made only
  against a develop artifact with the same `template`, so a branch that predates
  #482 (`full`) is never compared with a `core` baseline.

- **The first execution reaches the log at INFO (Task 1).** The spike's GUI runs
  logged at INFO, and `SuggestionsHandler` logs `The first execution finished.`
  at DEBUG (`SuggestionsHandler.scala:442`), so the spec's "First execution
  done" row came from its debug runs, which are slower. Task 1 raises that one
  line to INFO: one line per project open, nothing a user sees, and the harness
  measures at the default level. This makes Task 1 an engine change, so its PR
  builds the backend.
- **Language Server log times are local times (Task 1).** The log pattern is
  `[%level] [%d{yyyy-MM-dd'T'HH:mm:ss.SSS}] [%logger] %msg%n`
  (`lib/scala/logging-config/.../Appender.java:72`), which logback writes in the
  JVM's default time zone, with no offset. The spike parsed them as UTC, which
  happened to be right in the UK in November. The harness parses them as local
  time (`new Date(y, m - 1, d, h, mi, s, ms)`), which is right everywhere,
  including CI's UTC runners.
- **Each launch gets its own log directory (Task 1).** The harness sets
  `ENSO_LOG_DIRECTORY=<run dir>/logs`; the engine honours it
  (`DistributionManager.scala:389`) and so does the shim
  (`getEngineLogDirectory`, `distributionManager.ts`). The two Language Server
  logs of a launch are told apart by their first timestamp: an open's log is the
  earliest one that starts after its click. The spike's search of the shared log
  directory by modification time is not needed.
- **The credential variables stripped (Task 1).** Every key matching
  `/^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS)/i` (the spike's list,
  which covers the spec's `ENSO_*`, `AWS_*`, Snowflake and cloud), plus
  `GITHUB_TOKEN` and `GH_TOKEN`, which the packaging job sets for other steps.
  The harness then sets only its own `ENSO_TEST`, `ENSO_TEST_PROJECTS_DIR`,
  `ENSO_AI_DISABLED`, `ENSO_LOG_DIRECTORY` and, for the JVM, `ENSO_ENGINE_ARGS`.
- **How the JVM run is started (Task 1).** The shim reads `ENSO_ENGINE_ARGS` and
  puts it before its own arguments (`ProjectService.default`,
  `projectService/index.ts:118`), so `ENSO_ENGINE_ARGS=--jvm` makes every engine
  run on the JVM. The native launcher then starts the JVM in its own process
  through JNI (`Main.launchJvm`, `useJNI = ImageInfo.inImageCode()`) with the
  JDK `JavaFinder` finds, the bundle's `runtime/graalvm-ce-java…` (it looks in
  the distribution's runtimes first). A JVM created through JNI reads
  `JAVA_TOOL_OPTIONS`, and that is the only way to give it `-XX:` options: the
  launcher passes the JVM nothing but its fixed options and `-D` properties. So
  the cache goes in `JAVA_TOOL_OPTIONS`.
- **The AOT cache (Task 1).** Created once per harness invocation, in
  `<out>/aot/`, where it stays (a cache cannot be moved): a training launch with
  `-XX:AOTMode=record -XX:AOTConfiguration=<out>/aot/enso.aotconf` that opens
  the first project and closes the app (the engine exits on the shim's newline,
  which writes the configuration); then the bundle's `java` with
  `-XX:AOTMode=create -XX:AOTConfiguration=… -XX:AOTCache=<out>/aot/enso.aot`
  and the launcher's own JVM options (`--sun-misc-unsafe-memory-access=allow`,
  `--enable-native-access=org.graalvm.truffle`,
  `--add-opens=java.base/java.nio=ALL-UNNAMED`, `--module-path=<component>`,
  `-m org.enso.runner/org.enso.runner.Main`); then a check launch with
  `-XX:AOTCache=…` and logging on, which fails the harness if Electron's stdout
  shows an `[aot]` line at error or warning level (a mismatched cache is
  reported there, and the JVM silently runs without it). Measured launches pass
  `-XX:AOTCache=<out>/aot/enso.aot -Xlog:disable -Xlog:all=off`, so a mismatch
  never writes to stdout during a measurement. GraalVM 25.0.1
  (`build-config.yaml`) has all three modes.
  - **Timeouts.** The whole preparation is time-boxed: the training and check
    launches count against the JVM engine's own budget, and the `create` step
    has a 5-minute `spawnSync` timeout and the credential-free environment.
  - **Two writers.** Every JVM that exits during the training launch writes the
    configuration, and the last writer wins. The only other JVM is the training
    project's own engine, since the harness opens one project. So if the check
    launch rejects the cache, the harness retries the whole preparation once
    before failing.
  - **Options that differ.** The `create` step's options differ from the JNI
    launch's (`-Djdk.module.main` and `-D` properties instead of `-m`). The
    check launch is what catches a cache that this makes unusable.
- **The CI step (Task 1).** In `ide-packaging.yml`'s `package-ide`, after "Run
  Package Tests", on both platforms, with `continue-on-error: true`: a broken
  harness or a slow runner produces a warning and a summary line, never a red
  job. It runs when `open_perf` is true: every develop push
  (`ide-pull-request.yml` passes `github.event_name == 'push'`), a pull request
  with the `CI: Open perf` label, or a hand-started run's `open_perf` input. A
  hand-started run's `open_perf_jvm` input adds the JVM to the same run, after
  the native runs on the same build. The previous develop result is the newest
  unexpired `open-perf-<os>` artifact of a develop run of this repository other
  than this one, found with `gh api` (as `find-backend` does) and downloaded
  with `actions/download-artifact@v5` and `run-id` (the job already has
  `actions: read`). The harness compares and prints the warnings
  (`::warning title=Open time::…`), so the rules are unit-tested.
- **The label must start a run (Task 1).** `ide-pull-request.yml` treats any
  label other than `CI: Build IDE` as an unrelated label event and makes the run
  inert (Note [Ignoring Unrelated Label Events]), so adding `CI: Open perf`
  would do nothing until the next push. Its six copies of the test (the
  concurrency group, the three changed-files jobs, the summary job's name and
  `if`) also exempt `CI: Open perf`, the packaging `if` and `PACKAGING_EXPECTED`
  run on it, and the Note says why the IDE copy names two labels where the GUI
  copy names one. A new policy rule, `checkOpenPerf`, fails a copy that forgets
  the second label, an open-time step without `continue-on-error: true`, an
  open-time step before "Run Package Tests", and a `package-ide` with no "Run
  Package Tests" step at all. Removing the label is also a related label event,
  so it starts a run, and `cancel-in-progress` cancels any packaging run in
  progress. That is acceptable. The PR body and the `.github/CLAUDE.md` line say
  so.
- **A time budget instead of a guess at Windows CI's speed (Task 1).** The Note
  on `FIRST_PROJECT_TIMEOUT` in `tests/electronTest.ts` recorded the Windows CI
  runner taking 91–115 s to the first visualisation (#169); that predates the
  catalogue fix (#485) and the core template, and nobody has measured since.
  - **One budget per engine.** Each engine gets its own `--budget-minutes` (12
    in CI), started when that engine's loop starts. Native launches can never
    use up the JVM's share. The JVM's share includes its AOT preparation.
  - **When it stops.** The harness stops starting launches when an engine's
    budget is spent, and reports how many it got. Fewer than 3 successful first
    opens give a warning, not a median.
  - **The worst launch.** One launch can overrun its budget by at most its own
    worst case: 120 s to launch, plus per open 180 s to the welcome table and
    150 s of extras, twice, which is about 13 min. So the job can spend at most
    25 min per engine on the harness.
  - **The job timeout.** `package-ide`'s `timeout-minutes` goes from 30 to
    `${{ inputs.open_perf_jvm && 90 || 45 }}`. Its slowest recent develop leg
    took 17 min (Windows, 2026-11-01).
    - Native only is 17 + 12 = 29 min typical, with the 45 caps a worst-case
      overrun.
    - Native and JVM is 17 + 2 × 25 = 67 min worst case, so 90.
- **The 4 s warning will fire on CI (Task 1).** Shared runners are slower than
  the machines the target was set on; on Windows CI the warning is likely on
  every run until the fixes land and possibly after. The spec's rule stays as
  written; the 15% comparison against the platform's own develop history is the
  signal a reviewer acts on. The summary shows both.
- **The harness's unit tests run locally, not in CI (Task 1).**
  `app/electron-client` has no `test:unit` script, so `ci:unit-test` never runs
  its `tests/headless/*.test.ts` today. Adding one would start running all of
  them in GUI CI, a separate decision; the PR body says the tests were run
  locally, and the follow-up is proposed there.
- **Polling at 25 ms may not help on Windows (Task 2).** A refused connection to
  an unbound loopback port is retried by Windows before it fails, so a health
  check that starts before the engine listens can take far longer than 25 ms
  there, and the interval after it matters less. The spike's `project/open`
  answer came at the same time on both platforms (396 / 398 ms), so the engine
  usually listens before the first check; the harness decides. If Task 2's
  Windows median of `openAnswered` does not move, the PR says so, and Task 6's
  trace covers the shim's side of the open as well.
- **Component groups still wait for the first execution (Task 3).** Only the
  suggestion database request moves. `runtime/getComponentGroups` answers from
  the packages loaded so far (`GetComponentGroupsCmd` returns
  `getPackageRepository.getComponents`, i.e. `loadedComponents`), so asked at
  connect time it would miss the groups of the libraries the project imports.
  `SuggestionUpdateProcessor` needs the groups to build entries, so updates that
  arrive before them are queued, as they already are (`#setupUpdateHandler`'s
  `earlyUpdates`, registered synchronously before the request goes out). The
  catalogue holds its entries back until the first execution (Note [Catalogue
  Entries In The Suggestions Database]), so requesting early sends nothing extra
  early.
  - **The request also moves an `EnsureCompiledJob`.** It schedules
    `InvalidateModulesIndexCommand`'s `EnsureCompiledJob` (write compilation
    lock), and that moves earlier too. Arriving at connect time, it can lengthen
    the first compile instead of blocking the welcome table after it. Which
    costs less is for the harness to show. If `firstExecution` gets later by
    more than `welcomeShown` gets earlier, the PR says so and Task 3 waits for
    the user's decision.
- **One bindings map, owned by `TruffleCompilerContext` (Task 4).**
  `TruffleCompilerContext.libraryBindings(LibraryName)` reads a library's
  bindings cache at most once and both callers use it:
  `DefaultPackageRepository.getLibraryBindings` (import resolution) loses its
  `loadedLibraryBindings` map, and `deserializeModule` (module loading) loses
  `known`. It remembers every answer that came from reading the cache file,
  found or not (today's `loadedLibraryBindings` remembered both, `known` only
  hits). It does not remember the answers that did not read the file: the
  compile target's skip (Note [Compile Target Skips Its Bindings Cache]), the
  abort of a library waiting for serialisation, and an interrupt; those are
  asked again, as today.
  - **Invalidation is versioned.** Each library has a generation counter.
    `serializeLibrary` bumps it before submitting the task, and the task bumps
    it again in its `finally`, once the file is written. A read stores its
    answer only if the generation it started under is still current (`compute`
    on the memo, checking the generation). So a read that overlaps a write can
    never leave a stale answer behind. Remembering "absent" answers is new for
    module loading (`known` kept only hits); this versioning is what makes it
    safe.
  - **Interrupts propagate as today.** `libraryBindings` throws
    `InterruptedException`. `deserializeModule` keeps its catch, and import
    resolution propagates it out of
    `DefaultPackageRepository.getLibraryBindings` (a Scala method, so there is
    no checked exception to declare), exactly as `deserializeLibraryBindings`
    did.
  - **Clearing.** `TruffleCompilerContext.shutdown` clears the memo, and so does
    `DefaultPackageRepository.shutdown`, through the context's new
    `clearLibraryBindings()`. `EnsoContext.shutdown` calls both
    (`compiler.shutdown`, which reaches the context's, then
    `packageRepository.shutdown`; `EnsoContext.java:333-334`; check in Step 2
    that `Compiler.shutdown` calls `context.shutdown`). But clearing from both
    keeps the old map's lifetime even if one is ever called alone.
  - **Cost if wrong:** a module that today retried a missing cache per module
    now loads from its own IR cache straight away, which is what the retry led
    to.
- **The open-time edit: the template's id map, and `execute` unchanged (Task
  5).** The spec asks for two things: the template ships the id map the ydoc
  server would write, and an edit that only adds ids or metadata goes out with
  `execute: false`. Only the first is safe. The open-time edit happens because
  the file's id map names fewer ASTs than the module has (`syncFileContents`,
  `idsNotSetByMap > 0`), so the server assigns ids to the rest and sends the
  whole map (`unsyncedIdMap`). The engine compiled the file with the file's ids,
  so before the edit it knows no id for any subexpression and reports no value
  for one. With `execute: true` the edit aborts the jobs and re-executes
  (`EditFileCmd`: `abortAllJobs`, compile, then `executeJobs`), and the
  subexpressions' values arrive; with `execute: false` it only compiles
  (`else if (request.idMap.isDefined)`), and they never arrive until something
  else executes those expressions. The persisted id map keeps only the ids of
  nodes and widgets (`getIdMapToPersist`), so every reopened project takes this
  path: `execute: false` would lose its subexpression values (argument widgets'
  subject types, port types) on every open. So Task 5 changes the template only:
  with every AST's id in the file, `idsNotSetByMap` is 0, the server sends no
  edit, and the engine's first compile already has all the ids. That removes the
  edit for every new project, the case the target is about. A reopened project
  still pays it; the follow-up (persist the whole id map, or let an id-only edit
  re-execute without aborting) is proposed in the PR, not done here.
- **The full id map is generated, not hand-written (Task 5).** A test in
  `app/ydoc-server` with `UPDATE_TEMPLATE_ID_MAP=1` parses the template exactly
  as `syncFileContents` does, sets the ids the file has, lets the parser's span
  map supply the rest (`Ast.spanMapToIdMap`, the server's own call), and writes
  the result with `serializeIdMap` and `combineFileParts`. The welcome node
  keeps `fcf199e6-d2b1-44b7-be92-a47545d6a593`, which the getting-started tests
  and #482's template test name. The code and the metadata's `snapshot` do not
  change, so the snapshot still matches the code.
- **What the write-lock attempt excludes today (Task 8).**
  `UpsertVisualizationJob` runs on the high-priority pool
  (`highPriority = true`; `JobExecutionEngine` sends such jobs to
  `prioritized-job-pool`, not `job-pool`). It holds only the context _read_
  lock, and tries the compilation _write_ lock. That attempt fails whenever
  anyone holds the compilation read lock: `ExecuteJob` (for its whole run,
  together with the context read lock, `ExecuteJob.java:189-194`),
  `SerializeModuleJob`, `OpenFileCmd`, `CloseFileCmd` and
  `RefactoringRenameJob`. So the failed attempt is what keeps an attach out of a
  running execution of the same context. That execution owns the frame's
  `RuntimeCache` and its `UpdatesSynchronizationState`, and evaluates Enso code.
  Evaluating under the read lock alone would break that exclusion, so Task 8
  does not.
- **The visualisation is evaluated by its context's execution, or alone (Task
  8).** The spike's debug log shows where the 2.4 s went (`win/devd-core-1`,
  second open):
  1. The welcome table's attach came 29 ms before the running first execution
     ended. That was after the run's last `processAllUnevaluatedVisualizations`,
     which `runProgram` calls after each expression and once at the end
     (`ProgramExecutionSupport.scala:118, 260`).
  2. The deferred attach then needed a new `ExecuteJob`, and
     `rescheduleIfNeeded` or the attach's own job queued one.
  3. That job waited 2.4 s for the compilation read lock behind the
     `EnsureCompiledJob` (write lock) that the post-execution
     `search/getSuggestionsDatabase` had just started.

  Of the options, two would not help:
  - A high-priority `ExecuteJob` still needs that read lock, so it would gain
    nothing.
  - Evaluating under the read lock is unsafe, as the ruling above says.

  The chosen design has two parts. Neither ever evaluates beside a running
  execution of the context:
  - **(a) In the running execution.** Before `ExecuteJob.execute` releases its
    locks, it evaluates the visualisations deferred while it ran, from its own
    frame's cache (`ProgramExecutionSupport.processPendingVisualizations`, which
    is the existing `processAllUnevaluatedVisualizations` on the stack's top
    frame). This runs on the execution's own thread, under the execution's
    locks, and is the same code its run already calls after every expression. It
    closes the window in step 1, before an `EnsureCompiledJob` can take the
    write lock.
  - **(b) Alone, when the context is idle.** When the compilation write lock is
    busy, `UpsertVisualizationJob` also tries the context _write_ lock with the
    compilation _read_ lock, both without blocking. The context write lock fails
    while any `ExecuteJob` of the context runs (each holds the context read
    lock), so this evaluates only when no execution of the context is running,
    and none can start until it is done. The compilation read lock keeps out
    compiles and admits only readers that do not touch this context's frames
    (`SerializeModuleJob`, the file commands, rename). Locks are taken in
    `ExecuteJob`'s order, context then compilation, so the order is unchanged. A
    visualisation that needs compilation still defers: `findModule` answers
    `RequiresCompilation` without the write lock.
  - **(c) Otherwise it defers as today**, and the next execution picks it up.

- **Widget queries wait for the visible visualisations, or one second after the
  first execution (Task 8).** The GUI marks the visualisations it attaches for
  widgets (`widgetFunctionCallInfo.ts`, `get_widget_json`; `tableColumns.ts`,
  the column-name query) as background. `ExecutionContext` attaches them only
  once every visible visualisation it has attached has answered or failed (its
  slot is no longer `pending`), or 1 s after its first `executionComplete` (or
  `executionFailed`), whichever comes first, and from then on as soon as they
  are configured: the hold applies once per context, to the open. Ordering the
  attaches inside one sync is not enough, since the engine runs each attach as
  its own job and a widget query that loads libraries (the `format` dropdown's
  `File_Format.all` loads Image and SQLite, ~0.7 s cold) holds the write lock
  ahead of the table's. Cost if wrong: a dropdown opened within that window
  shows its static values a little longer. When a project has no visible
  visualisation, the widgets wait up to 1 s longer on its first open.
- **Departures from the spec.** Each PR names its own departure in its body, and
  Task 8's PR lists them all:
  - `--engines native,jvm` instead of `--engine jvm`: one run can measure both,
    on the same build.
  - The first-execution log line at INFO.
  - Task 5 ships the template's id map only, with no `execute: false`.
  - Task 5 relies on #482's test helpers (`TEMPLATE_MAIN`, `WELCOME_NODE`,
    `fakeLanguageServerWithModules(names, content)`), which #482 (now merged)
    added.
  - Task 8's engine half is (a) and (b) above, not the spec's "evaluated from
    the cached value at once".

## Merge order

Task 1 first; it merges on green CI (no behaviour change; its engine change is a
log level). Then Tasks 2–8 in order, each branched from `develop` after the one
before it merged, so that each before-and-after measurement isolates one fix.
Task 5 starts only after #482 has merged.

- **Invisible, merge on green:** Task 2 (a polling interval) and Task 4 (the
  same bindings, read once); Tasks 6 and 7 when they end in documentation only.
- **Change behaviour, merge after the user's OK** (usually after an installer
  test): Task 3 (when suggestions arrive), Task 5 (the template file), Task 8
  (when visualisations are evaluated, the order of widget queries, and the
  changelog entry); Tasks 6 and 7 when their trace leads to a code fix.

---

### Task 1: The open-time harness and its CI step

No change visible to users: `CI: No changelog needed`.

**Files:**

- Create: `app/electron-client/perf/openTimeReport.ts` (the pure logic: log
  parsing, phases, medians, the Markdown table, the warnings, the environment)
- Create: `app/electron-client/perf/openTime.ts` (the driver and its command
  line)
- Create: `app/electron-client/perf/jvmAotCache.ts` (the JVM's AOT cache)
- Create: `app/electron-client/tests/packagedIde.ts` (where the packaged app,
  its engine launcher, its `java` and its engine component are; moved out of
  `tests/electronTest.ts` and `globalSetup.ts`)
- Test: `app/electron-client/tests/headless/openTimeReport.test.ts`
- Modify: `app/electron-client/tests/electronTest.ts`,
  `app/electron-client/globalSetup.ts` (import from `tests/packagedIde.ts`)
- Modify: `app/electron-client/package.json` (`perf:open`),
  `app/electron-client/tsconfig.json` (`./perf` in `include`)
- Modify:
  `engine/language-server/src/main/scala/org/enso/languageserver/search/SuggestionsHandler.scala`
  (the first-execution line at INFO)
- Modify: `.github/workflows/ide-packaging.yml`,
  `.github/workflows/ide-pull-request.yml`
- Modify: `tools/ci/check-workflows.mjs`, `tools/ci/check-workflows.test.mjs`
  (`checkOpenPerf`)
- Modify: `.github/CLAUDE.md`, `app/electron-client/CLAUDE.md`

**Interfaces:**

- Produces: the command
  `corepack pnpm --filter enso run perf:open --out <dir> [--runs 5] [--engines native|jvm|native,jvm] [--baseline <open-time.json>] [--summary <file>] [--exe <path>] [--profile] [--budget-minutes 12]`,
  which writes `<out>/open-time.json` (an `OpenTimeReport`),
  `<out>/open-time.md` and, per launch, `<out>/<engine>-<n>/` (`marks.json`,
  `electron-out.log`, `logs/`, and with `--profile` a renderer
  `first.cpuprofile` and `second.cpuprofile`). Every later task's proof uses it.
- Produces: in `openTimeReport.ts`, `PHASES`, `EXTRAS`, `type Phase`,
  `type Extra`, `type OpenTimes = Partial<Record<Phase | Extra, number>>`,
  `type Engine = 'native' | 'jvm'`, `interface Mark`, `interface RunResult`,
  `interface OpenTimeReport`, `interface LsLogLine`,
  `parseLsLogLine(line: string): LsLogLine | null`,
  `openTimes(marks: readonly Mark[], tag: OpenTag, ls: readonly LsLogLine[] | undefined): OpenTimes`,
  `median(values: readonly number[]): number | undefined`,
  `summarise(report: OpenTimeReport): EngineSummary[]`,
  `renderMarkdown(report: OpenTimeReport, baseline: OpenTimeReport | undefined): string`,
  `regressionWarnings(report: OpenTimeReport, baseline: OpenTimeReport | undefined, limits?: { limitMs: number; tolerance: number }): string[]`,
  `credentialFreeEnv(env: NodeJS.ProcessEnv): Record<string, string>`,
  `notMeasured(times: OpenTimes): (Phase | Extra)[]`,
  `type Template = "core" | "full"`,
  `comparable(report: OpenTimeReport, baseline: OpenTimeReport | undefined): baseline is OpenTimeReport`.
  `RunResult` carries `notMeasured`, and `OpenTimeReport` carries `template`.
- Produces: the `CI: Open perf` label (the controller creates it on GitHub), the
  `open_perf` input of `ide-packaging.yml` (`workflow_call` and
  `workflow_dispatch`) and its `open_perf_jvm` input (`workflow_dispatch`), the
  artifact `open-perf-<linux|windows>`.

- [ ] **Step 1: Write the failing tests for the report logic**

Create `app/electron-client/tests/headless/openTimeReport.test.ts`:

```ts
/** @file The open-time harness's pure logic: log lines, phases, medians, warnings. */
import { describe, expect, test } from "vitest";
import {
  credentialFreeEnv,
  median,
  notMeasured,
  openTimes,
  parseLsLogLine,
  regressionWarnings,
  renderMarkdown,
  type Mark,
  type OpenTimeReport,
  type RunResult,
} from "../../perf/openTimeReport";

describe("parseLsLogLine", () => {
  test("reads the time as local time, since the log has no offset", () => {
    const line =
      "[INFO] [2026-11-01T01:30:33.556] [org.enso.languageserver.boot.LanguageServerComponent] Started server at json:127.0.0.1:30616, <secure-json-not-configured>";
    expect(parseLsLogLine(line)).toEqual({
      time: new Date(2026, 10, 1, 1, 30, 33, 556).getTime(),
      logger: "org.enso.languageserver.boot.LanguageServerComponent",
      message:
        "Started server at json:127.0.0.1:30616, <secure-json-not-configured>",
    });
  });
  test("ignores lines that are not log records", () => {
    expect(parseLsLogLine("    at org.enso.Foo.bar(Foo.java:1)")).toBeNull();
  });
});

const t0 = new Date(2026, 10, 1, 1, 30, 18, 0).getTime();
const ls = (offset: number, message: string) => ({
  time: t0 + offset,
  logger: "org.enso.languageserver.search.SuggestionsHandler",
  message,
});

describe("openTimes", () => {
  const marks: Mark[] = [
    { k: "first:click", t: t0 },
    { k: "engineStdout", t: t0 + 190 },
    { k: "resp", t: t0 + 395, u: "project/open" },
    { k: "wsOpen", t: t0 + 420, u: "ws://127.0.0.1:30617/project/other" },
    { k: "wsOpen", t: t0 + 921, u: "ws://127.0.0.1:30617/project/index?ls=x" },
    { k: "first:firstNode", t: t0 + 1449 },
    { k: "first:welcomeShown", t: t0 + 6811 },
    { k: "second:click", t: t0 + 20_000 },
    { k: "resp", t: t0 + 20_400, u: "project/open" },
  ];
  const lines = [
    ls(225, "Starting Language Server..."),
    ls(260, "Started server at json:127.0.0.1:30616"),
    ls(4574, "The first execution finished."),
  ];

  test("measures every phase from the click", () => {
    expect(openTimes(marks, "first", lines)).toEqual({
      engineUp: 190,
      lsReady: 260,
      openAnswered: 395,
      guiConnected: 921,
      firstNode: 1449,
      firstExecution: 4574,
      welcomeShown: 6811,
    });
  });
  test("takes the second open’s marks after its own click", () => {
    expect(openTimes(marks, "second", undefined).openAnswered).toBe(400);
  });
  test("falls back to the log’s first line when the launcher printed nothing", () => {
    const quiet = marks.filter((m) => m.k !== "engineStdout");
    expect(openTimes(quiet, "first", lines).engineUp).toBe(225);
  });
});

describe("median", () => {
  test("of an odd count is the middle value", () =>
    expect(median([5, 1, 3])).toBe(3));
  test("of an even count is the mean of the middle two", () =>
    expect(median([4, 1, 3, 2])).toBe(2.5));
  test("of nothing is undefined", () => expect(median([])).toBeUndefined());
});

function report(
  welcome: readonly (number | undefined)[],
  engine: "native" | "jvm" = "native",
  template: "core" | "full" = "core",
) {
  const runs: RunResult[] = welcome.map((welcomeShown, i) => ({
    engine,
    run: i + 1,
    first: welcomeShown == null ? {} : { welcomeShown },
    second: null,
    notMeasured: [],
    ...(welcomeShown == null ? { error: "no welcome table" } : {}),
  }));
  return {
    version: 1,
    platform: "linux",
    commit: null,
    template,
    runs,
  } satisfies OpenTimeReport;
}

describe("regressionWarnings", () => {
  test("none within the limit and the tolerance", () => {
    expect(
      regressionWarnings(
        report([3000, 3100, 3200]),
        report([3000, 3000, 3000]),
      ),
    ).toEqual([]);
  });
  test("one over 4 s", () => {
    const warnings = regressionWarnings(report([4100, 4200, 4300]), undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("4200 ms");
  });
  test("one more than 15% worse than develop", () => {
    const warnings = regressionWarnings(
      report([3500, 3500, 3500]),
      report([3000, 3000, 3000]),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("17%");
  });
  test("one when fewer than 3 first opens succeeded", () => {
    const warnings = regressionWarnings(
      report([3000, undefined, undefined]),
      undefined,
    );
    expect(warnings).toEqual([expect.stringContaining("1 of 3")]);
  });
  test("compares each engine with the same engine", () => {
    const both = {
      ...report([3000, 3000, 3000]),
      runs: [
        ...report([3000, 3000, 3000]).runs,
        ...report([9000, 9000, 9000], "jvm").runs,
      ],
    };
    expect(regressionWarnings(both, report([3000, 3000, 3000]))).toEqual([
      expect.stringContaining("jvm"),
    ]);
  });
  test("compares only with a baseline of the same template", () => {
    // develop measured the full template (before #482); this run the core one.
    expect(
      regressionWarnings(
        report([3000, 3000, 3000]),
        report([2000, 2000, 2000], "native", "full"),
      ),
    ).toEqual([]);
  });
  test("one when a launch did not measure an extra phase", () => {
    const missing = report([3000, 3000, 3000]);
    const runs = missing.runs.map((r, i) =>
      i === 0 ? { ...r, notMeasured: ["dropdownItems" as const] } : r,
    );
    expect(regressionWarnings({ ...missing, runs }, undefined)).toEqual([
      expect.stringContaining("dropdownItems"),
    ]);
  });
});

describe("notMeasured", () => {
  test("names the phases and extras an open lacks", () => {
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).toEqual(
      expect.arrayContaining(["engineUp", "formatWidget", "dropdownItems"]),
    );
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).not.toContain(
      "cbEntries",
    );
  });
});

describe("renderMarkdown", () => {
  test("has a row per phase and the develop column when there is a baseline", () => {
    const text = renderMarkdown(
      report([3000, 3100, 3200]),
      report([2900, 2900, 2900]),
    );
    expect(text).toContain("| **Welcome table visualisation shown** |");
    expect(text).toContain("3100");
    expect(text).toContain("2900");
  });
});

describe("credentialFreeEnv", () => {
  test("drops credentials and keeps the rest", () => {
    expect(
      credentialFreeEnv({
        ENSO_CLOUD_TOKEN: "x",
        AWS_SECRET_ACCESS_KEY: "x",
        SNOWFLAKE_PASSWORD: "x",
        GITHUB_TOKEN: "x",
        PATH: "/bin",
        LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
      }),
    ).toEqual({ PATH: "/bin", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run:
`corepack pnpm --filter enso exec vitest --run tests/headless/openTimeReport.test.ts`
Expected: FAIL, `Failed to resolve import "../../perf/openTimeReport"`.

- [ ] **Step 3: Write `openTimeReport.ts`**

Create `app/electron-client/perf/openTimeReport.ts`:

```ts
/**
 * @file The pure logic of the open-time harness (`openTime.ts`): reading the Language Server's
 * log, turning the driver's marks into phase times, and summarising, comparing and printing
 * them. See `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`, section 2.
 */

/** The phases of an open, in order, each named after the mark that ends it. */
export const PHASES = [
  "engineUp",
  "lsReady",
  "openAnswered",
  "guiConnected",
  "firstNode",
  "firstExecution",
  "welcomeShown",
] as const;
export type Phase = (typeof PHASES)[number];

/** Marks taken after the welcome table, which the headline does not include. */
export const EXTRAS = ["cbEntries", "formatWidget", "dropdownItems"] as const;
export type Extra = (typeof EXTRAS)[number];

export const LABELS: Record<Phase | Extra, string> = {
  engineUp: "Engine process running",
  lsReady: "Language server ready",
  openAnswered: "`project/open` answered",
  guiConnected: "GUI opens the ydoc socket",
  firstNode: "First graph node drawn",
  firstExecution: "First execution done",
  welcomeShown: "Welcome table visualisation shown",
  cbEntries: "Component browser lists entries",
  formatWidget: "`format` widget shown",
  dropdownItems: "`format` dropdown lists items",
};

/** The headline: click to the welcome table, first (cold) open. */
export const HEADLINE: Phase = "welcomeShown";

/** Milliseconds from the click on the project's row. */
export type OpenTimes = Partial<Record<Phase | Extra, number>>;
export type Engine = "native" | "jvm";
/** The first open of a launch is cold; the second opens another project in the same session. */
export type OpenTag = "first" | "second";

/** One timestamped event the driver saw (`k` its kind, `t` epoch ms), as in the spike's `marks.json`. */
export interface Mark {
  readonly k: string;
  readonly t: number;
  readonly u?: string;
  readonly [extra: string]: unknown;
}

export interface RunResult {
  readonly engine: Engine;
  readonly run: number;
  readonly first: OpenTimes;
  readonly second: OpenTimes | null;
  /** The phases and extras a successful launch did not record, first and second open together. */
  readonly notMeasured: readonly (Phase | Extra)[];
  readonly error?: string;
}

/** `core` when the new-project template has no `Standard.AWS` import (#482), `full` otherwise. */
export type Template = "core" | "full";

export interface OpenTimeReport {
  readonly version: 1;
  readonly platform: string;
  readonly commit: string | null;
  readonly template: Template;
  readonly runs: readonly RunResult[];
}

/** Whether `baseline` measured the same template, so that comparing with it means something. */
export function comparable(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
): baseline is OpenTimeReport {
  return baseline != null && baseline.template === report.template;
}

export interface LsLogLine {
  readonly time: number;
  readonly logger: string;
  readonly message: string;
}

const LS_LINE =
  /^\[(\w+)\] \[(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{3})\] \[([^\]]+)\] (.*)$/;

/* Note [Language Server Log Times Are Local]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The Language Server's log pattern is `[%level] [%d{yyyy-MM-dd'T'HH:mm:ss.SSS}] [%logger] %msg%n`
 * (`lib/scala/logging-config/.../Appender.java`): logback writes the time in the JVM's default
 * time zone and no offset. So it is read as local time, on the same clock as `Date.now()`.
 */

/** One record of the Language Server's log, or `null` for a continuation line. */
export function parseLsLogLine(line: string): LsLogLine | null {
  const match = LS_LINE.exec(line);
  if (!match) return null;
  const [, , y, mo, d, h, mi, s, ms, logger, message] = match;
  return {
    time: new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!, +ms!).getTime(),
    logger: logger!,
    message: message!,
  };
}

const LS_MARKS = {
  lsReady: /^Started server at json/,
  firstExecution: /^The first execution finished\./,
} as const;

/** The phase times of the open tagged `tag`, from the driver's marks and the open's log. */
export function openTimes(
  marks: readonly Mark[],
  tag: OpenTag,
  ls: readonly LsLogLine[] | undefined,
): OpenTimes {
  const click = marks.find((m) => m.k === `${tag}:click`)?.t;
  if (click == null) return {};
  const rel = (t: number | undefined) =>
    t == null ? undefined : Math.round(t - click);
  const after = (pred: (m: Mark) => boolean) =>
    marks.find((m) => m.t >= click && pred(m))?.t;
  const logged = (pattern: RegExp) =>
    ls?.find((l) => l.time >= click && pattern.test(l.message))?.time;
  const times: OpenTimes = {
    engineUp: rel(after((m) => m.k === "engineStdout") ?? ls?.[0]?.time),
    lsReady: rel(logged(LS_MARKS.lsReady)),
    openAnswered: rel(after((m) => m.k === "resp" && m.u === "project/open")),
    guiConnected: rel(
      after((m) => m.k === "wsOpen" && (m.u ?? "").includes("/project/index")),
    ),
    firstExecution: rel(logged(LS_MARKS.firstExecution)),
  };
  for (const key of ["firstNode", "welcomeShown", ...EXTRAS] as const) {
    times[key] = rel(marks.find((m) => m.k === `${tag}:${key}`)?.t);
  }
  return Object.fromEntries(
    Object.entries(times).filter(([, v]) => v != null),
  ) as OpenTimes;
}

/** The phases and extras an open did not record. */
export function notMeasured(times: OpenTimes): (Phase | Extra)[] {
  return [...PHASES, ...EXTRAS].filter((key) => times[key] == null);
}

/** The median, the mean of the middle two for an even count; `undefined` for none. */
export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface EngineSummary {
  readonly engine: Engine;
  /** Launches whose first open reached the headline mark, out of `launches`. */
  readonly succeeded: number;
  readonly launches: number;
  readonly first: OpenTimes;
  readonly second: OpenTimes;
}

/** The medians per engine, over the launches that did not fail. */
export function summarise(report: OpenTimeReport): EngineSummary[] {
  const engines = [...new Set(report.runs.map((r) => r.engine))];
  return engines.map((engine) => {
    const runs = report.runs.filter((r) => r.engine === engine);
    const medians = (pick: (r: RunResult) => OpenTimes | null) => {
      const out: OpenTimes = {};
      for (const key of [...PHASES, ...EXTRAS]) {
        const value = median(runs.flatMap((r) => pick(r)?.[key] ?? []));
        if (value != null) out[key] = value;
      }
      return out;
    };
    return {
      engine,
      succeeded: runs.filter((r) => r.first[HEADLINE] != null).length,
      launches: runs.length,
      first: medians((r) => r.first),
      second: medians((r) => r.second),
    };
  });
}

const cell = (value: number | undefined) =>
  value == null ? "–" : String(Math.round(value));

/** The medians as a Markdown table, with develop's first-open medians when there is a baseline. */
export function renderMarkdown(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
): string {
  if (!comparable(report, baseline)) baseline = undefined;
  const ours = summarise(report);
  const theirs = baseline ? summarise(baseline) : [];
  const header = ["Phase (end mark), ms from the click"];
  for (const s of ours) {
    header.push(`${s.engine} first`, `${s.engine} second`);
    if (baseline) header.push(`${s.engine} first, develop`);
  }
  const rows = [...PHASES, ...EXTRAS].map((key) => {
    const row = [key === HEADLINE ? `**${LABELS[key]}**` : LABELS[key]];
    for (const s of ours) {
      row.push(cell(s.first[key]), cell(s.second[key]));
      if (baseline)
        row.push(cell(theirs.find((t) => t.engine === s.engine)?.first[key]));
    }
    return `| ${row.join(" | ")} |`;
  });
  const counts = ours
    .map((s) => `${s.engine}: ${s.succeeded} of ${s.launches} launches`)
    .join(", ");
  return [
    `Medians, ${report.platform}, ${report.template} template${report.commit ? ` at \`${report.commit.slice(0, 10)}\`` : ""} (${counts}).`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows,
    "",
  ].join("\n");
}

/** The spec's thresholds: a median over 4 s, or more than 15% worse than develop's last run. */
export const DEFAULT_LIMITS = { limitMs: 4000, tolerance: 0.15 } as const;
/** Fewer successful first opens than this give no median. */
export const MIN_SUCCESSFUL = 3;

/** The warnings for the headline median of each engine; empty when all is well. */
export function regressionWarnings(
  report: OpenTimeReport,
  baseline: OpenTimeReport | undefined,
  limits: { limitMs: number; tolerance: number } = DEFAULT_LIMITS,
): string[] {
  const warnings: string[] = [];
  const previous = comparable(report, baseline) ? summarise(baseline) : [];
  for (const engine of new Set(report.runs.map((r) => r.engine))) {
    const missing = new Set(
      report.runs
        .filter((r) => r.engine === engine && r.error == null)
        .flatMap((r) => r.notMeasured),
    );
    if (missing.size > 0) {
      warnings.push(
        `${engine}: not measured in some launches: ${[...missing].join(", ")}`,
      );
    }
  }
  for (const s of summarise(report)) {
    if (s.succeeded < MIN_SUCCESSFUL) {
      warnings.push(
        `${s.engine}: only ${s.succeeded} of ${s.launches} first opens reached the welcome table; no median`,
      );
      continue;
    }
    const ours = s.first[HEADLINE]!;
    if (ours > limits.limitMs) {
      warnings.push(
        `${s.engine}: the cold open takes ${Math.round(ours)} ms, over ${limits.limitMs} ms`,
      );
    }
    const theirs = previous.find((p) => p.engine === s.engine)?.first[HEADLINE];
    if (theirs != null && ours > theirs * (1 + limits.tolerance)) {
      const worse = Math.round((ours / theirs - 1) * 100);
      warnings.push(
        `${s.engine}: the cold open takes ${Math.round(ours)} ms, ${worse}% worse than develop's ${Math.round(theirs)} ms`,
      );
    }
  }
  return warnings;
}

const CREDENTIALS =
  /^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS|GITHUB_TOKEN$|GH_TOKEN$)/i;

/** `env` without the credential variables (the spec: every run starts without them). */
export function credentialFreeEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] != null && !CREDENTIALS.test(entry[0]),
    ),
  );
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run:
`corepack pnpm --filter enso exec vitest --run tests/headless/openTimeReport.test.ts`
Expected: PASS (every test in the file). Fix the code, not the tests, until it
does.

- [ ] **Step 5: Move the packaged-app lookups into `tests/packagedIde.ts`**

`tests/electronTest.ts` imports `playwright/test` and calls `base.extend` at
module load, which the harness must not do (it is not a Playwright Test run).
Create `app/electron-client/tests/packagedIde.ts` with `POSSIBLE_ELECTRON_PATHS`
and `electronExecutablePath` moved verbatim from `tests/electronTest.ts`, and
`findEngineLauncher` moved verbatim from `globalSetup.ts` (exported, and taking
the Electron path as a parameter instead of reading the import), plus:

```ts
/** The packaged engine's `resources/enso` directory next to the Electron binary, if any. */
export function engineBundleRoot(
  executable: string = electronExecutablePath,
): string | undefined {
  for (const resources of ["resources", "Resources"]) {
    const root = path.join(path.dirname(executable), resources, "enso");
    if (fs.existsSync(root)) return root;
  }
  return undefined;
}

/** The bundle's JDK (`runtime/graalvm-ce-java…/bin/java`), the one `JavaFinder` picks for `--jvm`. */
export function findBundledJava(
  executable: string = electronExecutablePath,
): string | undefined {
  const root = engineBundleRoot(executable);
  if (!root) return undefined;
  const runtimes = path.join(root, "runtime");
  const name = process.platform === "win32" ? "java.exe" : "java";
  for (const dir of fs.existsSync(runtimes) ? fs.readdirSync(runtimes) : []) {
    const java = path.join(runtimes, dir, "bin", name);
    if (fs.existsSync(java)) return java;
  }
  return undefined;
}

/** The engine's `component` directory, the module path the launcher gives the JVM. */
export function findEngineComponent(
  executable: string = electronExecutablePath,
): string | undefined {
  const launcher = findEngineLauncher(executable);
  if (!launcher) return undefined;
  const component = path.join(
    path.dirname(path.dirname(launcher)),
    "component",
  );
  return fs.existsSync(component) ? component : undefined;
}
```

`electronTest.ts` re-exports `electronExecutablePath` from `./packagedIde` (the
specs import it from there), and `globalSetup.ts` imports `findEngineLauncher`
and calls `findEngineLauncher(electronExecutablePath)`. Run
`corepack pnpm --filter enso run typecheck`; expected: no errors.

- [ ] **Step 6: Write the driver, `perf/openTime.ts`**

Create `app/electron-client/perf/openTime.ts`, a port of the spike's `drive.cjs`
(one launch: open the first project from the drive, wait for the welcome table,
open the component browser and the `format` dropdown, close the project, open
the second the same way):

```ts
/**
 * @file The open-time harness: launches the packaged IDE, opens two new projects in turn (the
 * first open is cold) and records when each phase of an open ends. See
 * `docs/superpowers/specs/2026-11-01-project-open-performance-design.md`, section 2, and
 * `app/electron-client/CLAUDE.md` ("Open-time harness").
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { _electron, type ElectronApplication, type Page } from "playwright";
import {
  electronExecutablePath,
  findEngineLauncher,
} from "../tests/packagedIde";
import { createJvmAotCache, measuredJvmToolOptions } from "./jvmAotCache";
import {
  comparable,
  credentialFreeEnv,
  notMeasured,
  openTimes,
  parseLsLogLine,
  regressionWarnings,
  renderMarkdown,
  type Engine,
  type LsLogLine,
  type Mark,
  type OpenTag,
  type OpenTimeReport,
  type RunResult,
  type Template,
} from "./openTimeReport";

const OPEN_TIMEOUT_MS = 180_000;
const POLL_MS = 20;

interface Options {
  readonly out: string;
  readonly runs: number;
  readonly engines: readonly Engine[];
  readonly baseline: string | undefined;
  readonly summary: string | undefined;
  readonly exe: string;
  readonly profile: boolean;
  readonly budgetMinutes: number;
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: argv.filter((arg, i) => !(i === 0 && arg === "--")),
    options: {
      out: { type: "string" },
      runs: { type: "string", default: "5" },
      engines: { type: "string", default: "native" },
      baseline: { type: "string" },
      summary: { type: "string" },
      exe: { type: "string" },
      profile: { type: "boolean", default: false },
      "budget-minutes": { type: "string", default: "12" },
    },
  });
  // `parseArgs` types an option with a default as possibly undefined: apply the defaults here.
  if (!values.out) throw new Error("--out <dir> is required");
  const engines = (values.engines ?? "native").split(",").map((e) => e.trim());
  for (const engine of engines) {
    if (engine !== "native" && engine !== "jvm")
      throw new Error(`Unknown engine: ${engine}`);
  }
  return {
    out: path.resolve(values.out),
    runs: Number(values.runs ?? "5"),
    engines: engines as Engine[],
    baseline: values.baseline,
    summary: values.summary,
    exe: values.exe ?? electronExecutablePath,
    profile: values.profile ?? false,
    budgetMinutes: Number(values["budget-minutes"] ?? "12"),
  };
}

/** The timestamped events of one launch. */
class Marks {
  readonly list: Mark[] = [];
  add(k: string, extra: Record<string, unknown> = {}) {
    this.list.push({ k, t: Date.now(), ...extra });
  }
}

async function poll(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return true;
    } catch {
      // The element is not there yet.
    }
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Run the bundled launcher's `--new`, as the dashboard's New Project button does. */
async function createProject(
  launcher: string,
  projectsDir: string,
  name: string,
) {
  fs.mkdirSync(projectsDir, { recursive: true });
  const target = path.join(projectsDir, name);
  // The Windows launcher may be `enso.bat`, which Node spawns only through a shell.
  const useShell = launcher.endsWith(".bat");
  const quote = (s: string) => (useShell ? `"${s}"` : s);
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      quote(launcher),
      ["--new", quote(target), "--new-project-name", name],
      {
        cwd: projectsDir,
        env: credentialFreeEnv(process.env),
        shell: useShell,
        stdio: "ignore",
      },
    );
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`enso --new ${name} exited with ${code}`);
}

async function openProject(
  page: Page,
  name: string,
  tag: OpenTag,
  marks: Marks,
  dir: string,
  profile: boolean,
) {
  const row = page.getByTestId("drive-view").getByText(name, { exact: true });
  await row.waitFor({ state: "visible", timeout: 60_000 });
  const cdp = profile ? await page.context().newCDPSession(page) : undefined;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
  }
  marks.add(`${tag}:click`);
  await row.dblclick();
  await page
    .locator(".GraphNode")
    .first()
    .waitFor({ state: "visible", timeout: OPEN_TIMEOUT_MS });
  marks.add(`${tag}:firstNode`);
  const shown = await poll(
    async () =>
      (
        (await page
          .locator(".TableVisualization")
          .first()
          .textContent({ timeout: 100 })) ?? ""
      ).includes("Welcome To Enso!"),
    OPEN_TIMEOUT_MS,
  );
  if (!shown)
    throw new Error(`${tag}: no welcome table within ${OPEN_TIMEOUT_MS} ms`);
  marks.add(`${tag}:welcomeShown`);
  if (cdp) {
    const { profile: cpuProfile } = await cdp.send("Profiler.stop");
    fs.writeFileSync(
      path.join(dir, `${tag}.cpuprofile`),
      JSON.stringify(cpuProfile),
    );
    await cdp.detach();
  }
  // After the headline: the component browser and the `format` dropdown, as the spike did.
  await page.waitForTimeout(300);
  const node = page.locator(".GraphNode").first();
  await node.click({ position: { x: 10, y: 10 } }).catch(() => {});
  await page.keyboard.press("Enter");
  await page
    .locator(".ComponentBrowser")
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => {});
  // The spike's three alternatives (`drive.cjs`), so a renamed class costs one, not the mark.
  const entries = page.locator(
    '.ComponentBrowser .ComponentList .component, .ComponentBrowser [class*="ComponentEntry"], .ComponentBrowser .list-variant .component',
  );
  if (await poll(async () => (await entries.count()) > 5, 60_000))
    marks.add(`${tag}:cbEntries`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await node.click({ position: { x: 10, y: 10 } }).catch(() => {});
  const format = page.locator(".WidgetSelection", { hasText: /^format$/ });
  if (await poll(async () => (await format.count()) > 0, 30_000)) {
    marks.add(`${tag}:formatWidget`);
    await format
      .first()
      .click()
      .catch(() => {});
    const items = page.locator(
      '.DropdownWidget .item, .DropdownWidget li, .DropdownWidget [role="option"]',
    );
    if (await poll(async () => (await items.count()) > 3, 60_000))
      marks.add(`${tag}:dropdownItems`);
    await page.keyboard.press("Escape");
  }
}

async function closeProject(page: Page, name: string) {
  await page.getByRole("tab", { name }).locator(".CloseButton").click();
  // "Keep versions of your projects with git?" may ask first (see `answerRepositoryPrompt`).
  const prompt = page.getByTestId("repository-prompt");
  await prompt
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => prompt.getByTestId("alert-dialog-cancel").click())
    .catch(() => {});
}

/** Every Language Server log the launch wrote, each as its records, earliest first. */
function readLsLogs(logDir: string): LsLogLine[][] {
  const files = fs.existsSync(logDir)
    ? fs
        .readdirSync(logDir, { recursive: true, encoding: "utf8" })
        .filter((f) => /enso-language-server.*\.log$/.test(f))
    : [];
  return files
    .map((f) =>
      fs
        .readFileSync(path.join(logDir, f), "utf8")
        .split(/\r?\n/)
        .flatMap((line) => parseLsLogLine(line) ?? []),
    )
    .filter((lines) => lines.length > 0)
    .sort((a, b) => a[0]!.time - b[0]!.time);
}

/** An open's log: the earliest one that starts after its click. */
function logOf(logs: LsLogLine[][], marks: readonly Mark[], tag: OpenTag) {
  const click = marks.find((m) => m.k === `${tag}:click`)?.t;
  return click == null
    ? undefined
    : logs.find((lines) => lines[0]!.time >= click);
}

/** One launch: two projects, the first open cold. */
async function measureLaunch(
  options: Options,
  engine: Engine,
  run: number,
  extraEnv: Record<string, string>,
  opens: readonly OpenTag[] = ["first", "second"],
): Promise<RunResult & { readonly stdout: string }> {
  const dir = path.join(options.out, `${engine}-${run}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const projectsDir = path.join(dir, "projects");
  const logDir = path.join(dir, "logs");
  const launcher = findEngineLauncher(options.exe);
  if (!launcher) throw new Error(`No engine launcher next to ${options.exe}`);
  const stamp = Date.now().toString(36);
  const names = {
    first: `OpenTime${stamp}a`,
    second: `OpenTime${stamp}b`,
  } as const;
  for (const tag of opens)
    await createProject(launcher, projectsDir, names[tag]);
  const marks = new Marks();
  const stdoutLines: string[] = [];
  const out = fs.createWriteStream(path.join(dir, "electron-out.log"));
  const env = {
    ...credentialFreeEnv(process.env),
    ENSO_TEST: "true",
    ENSO_TEST_PROJECTS_DIR: projectsDir.replace(/\\/g, "/"),
    ENSO_AI_DISABLED: "1",
    ENSO_LOG_DIRECTORY: logDir,
    ...extraEnv,
  };
  let app: ElectronApplication | undefined;
  let error: string | undefined;
  try {
    marks.add("launch");
    app = await _electron.launch({
      executablePath: options.exe,
      env,
      timeout: 120_000,
    });
    const onOutput = (source: string) => (data: Buffer) => {
      for (const line of String(data).split(/\r?\n/)) {
        if (!line) continue;
        out.write(`${Date.now()} ${source} ${line}\n`);
        stdoutLines.push(line);
        if (line.includes("org.enso.runner.Utils")) marks.add("engineStdout");
      }
    };
    app.process().stdout?.on("data", onOutput("o"));
    app.process().stderr?.on("data", onOutput("e"));
    const page = await app.firstWindow();
    page.on("response", (r) => {
      const url = r.url();
      if (url.includes("/api/project-service/")) {
        marks.add("resp", {
          u: url.replace(/^.*\/api\/project-service\//, ""),
          s: r.status(),
        });
      }
    });
    page.on("websocket", (ws) => marks.add("wsOpen", { u: ws.url() }));
    page.on("console", (m) =>
      out.write(
        `${Date.now()} console.${m.type()} ${m.text().slice(0, 400)}\n`,
      ),
    );
    await page
      .getByTestId("drive-view")
      .waitFor({ state: "visible", timeout: 120_000 });
    for (const tag of opens) {
      await openProject(page, names[tag], tag, marks, dir, options.profile);
      await closeProject(page, names[tag]);
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    error = String(e).slice(0, 500);
  } finally {
    await Promise.race([
      app?.close(),
      new Promise((resolve) => setTimeout(resolve, 20_000)),
    ]).catch(() => {});
    try {
      app?.process().kill();
    } catch {
      // Already gone.
    }
    out.end();
    fs.writeFileSync(
      path.join(dir, "marks.json"),
      JSON.stringify(marks.list, null, 1),
    );
    for (const name of Object.values(names)) {
      fs.rmSync(path.join(engineIrCacheRoot(), name), {
        recursive: true,
        force: true,
      });
    }
  }
  const logs = readLsLogs(logDir);
  const first = openTimes(
    marks.list,
    "first",
    logOf(logs, marks.list, "first"),
  );
  const second = opens.includes("second")
    ? openTimes(marks.list, "second", logOf(logs, marks.list, "second"))
    : null;
  return {
    engine,
    run,
    first,
    second,
    // Recorded, never silent: the report warns about every phase or extra a launch missed.
    notMeasured: [
      ...new Set([
        ...notMeasured(first),
        ...(second ? notMeasured(second) : []),
      ]),
    ],
    ...(error ? { error } : {}),
    stdout: stdoutLines.join("\n"),
  };
}

/** `<data dir>/cache/ir/local`, where the engine keeps a project's IR cache. */
function engineIrCacheRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const data =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
          "enso",
        )
      : path.join(
          process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
          "enso",
        );
  return path.join(data, "cache", "ir", "local");
}

/**
 * The template the packaged engine creates projects from: `core` once #482 has dropped the
 * `Standard.AWS` import, `full` before. Read from a project the launcher has just created.
 */
async function packagedTemplate(options: Options): Promise<Template> {
  const launcher = findEngineLauncher(options.exe);
  if (!launcher) throw new Error(`No engine launcher next to ${options.exe}`);
  const dir = path.join(options.out, "template");
  fs.rmSync(dir, { recursive: true, force: true });
  await createProject(launcher, dir, "OpenTimeTemplate");
  const main = fs.readFileSync(
    path.join(dir, "OpenTimeTemplate", "src", "Main.enso"),
    "utf8",
  );
  return /^from Standard\.AWS import/m.test(main) ? "full" : "core";
}

function readReport(file: string | undefined): OpenTimeReport | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")) as OpenTimeReport;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  fs.mkdirSync(options.out, { recursive: true });
  const template = await packagedTemplate(options);
  const runs: RunResult[] = [];
  for (const engine of options.engines) {
    // Each engine has its own budget, which a JVM run's AOT preparation counts against.
    const deadline = Date.now() + options.budgetMinutes * 60_000;
    let extraEnv: Record<string, string> = {};
    if (engine === "jvm") {
      let cache: string;
      try {
        cache = await createJvmAotCache(
          options.out,
          options.exe,
          (env, opens) => measureLaunch(options, "jvm", 0, env, opens),
        );
      } catch (e) {
        console.warn(
          `Open time: no JVM runs, the AOT cache could not be made: ${String(e)}`,
        );
        runs.push({
          engine,
          run: 0,
          first: {},
          second: null,
          notMeasured: [],
          error: String(e),
        });
        continue;
      }
      extraEnv = {
        ENSO_ENGINE_ARGS: "--jvm",
        JAVA_TOOL_OPTIONS: measuredJvmToolOptions(cache),
      };
    }
    for (let run = 1; run <= options.runs; run++) {
      if (Date.now() > deadline) {
        console.warn(
          `Open time: the ${options.budgetMinutes}-minute budget is spent; ${run - 1} ${engine} launches.`,
        );
        break;
      }
      const { stdout, ...result } = await measureLaunch(
        options,
        engine,
        run,
        extraEnv,
      );
      void stdout; // Read only by the AOT cache check.
      console.log(`${engine} ${run}: ${JSON.stringify(result)}`);
      runs.push(result);
    }
  }
  const report: OpenTimeReport = {
    version: 1,
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? null,
    template,
    runs,
  };
  const baseline = readReport(options.baseline);
  const markdown = renderMarkdown(report, baseline);
  const warnings = regressionWarnings(report, baseline);
  fs.writeFileSync(
    path.join(options.out, "open-time.json"),
    JSON.stringify(report, null, 1),
  );
  fs.writeFileSync(path.join(options.out, "open-time.md"), markdown);
  console.log(markdown);
  for (const warning of warnings) {
    console.log(
      process.env.GITHUB_ACTIONS
        ? `::warning title=Open time::${warning}`
        : `WARNING: ${warning}`,
    );
  }
  if (options.summary) {
    const lines = [
      "## Open time",
      "",
      markdown,
      ...(comparable(report, baseline)
        ? []
        : [
            `No develop baseline of the ${template} template to compare with.`,
            "",
          ]),
      ...warnings.map((w) => `- ⚠️ ${w}`),
      "",
    ];
    fs.appendFileSync(options.summary, lines.join("\n"));
  }
}

await main();
```

- [ ] **Step 7: Write `perf/jvmAotCache.ts`**

```ts
/**
 * @file The JDK AOT start-up cache for the harness's `--engines jvm` runs: recorded on a training
 * launch, created with the bundle's `java`, then checked. A cache cannot be moved, so it is made in
 * place, under `<out>/aot/`. See the rulings in
 * `docs/superpowers/plans/2026-11-01-project-open-performance.md` (Task 1).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findBundledJava, findEngineComponent } from "../tests/packagedIde";
import {
  credentialFreeEnv,
  type OpenTag,
  type RunResult,
} from "./openTimeReport";

/** The options the launcher gives the JVM it starts through JNI (`Main.launchJvm`). */
const LAUNCHER_JVM_OPTIONS = [
  "--sun-misc-unsafe-memory-access=allow",
  "--enable-native-access=org.graalvm.truffle",
  "--add-opens=java.base/java.nio=ALL-UNNAMED",
];

type Launch = (
  env: Record<string, string>,
  opens: readonly OpenTag[],
) => Promise<RunResult & { readonly stdout: string }>;

/** `JAVA_TOOL_OPTIONS` for a measured launch: the cache, and no JVM logging on stdout. */
export function measuredJvmToolOptions(cache: string): string {
  return `-XX:AOTCache=${cache} -Xlog:disable -Xlog:all=off`;
}

/** How long `-XX:AOTMode=create` may take. */
const CREATE_TIMEOUT_MS = 5 * 60_000;

/**
 * Record, create and check the cache; returns its path, or throws saying which stage failed. A
 * rejected cache is made once more: every JVM that exits during the training launch writes the
 * configuration, and the last writer wins.
 */
export async function createJvmAotCache(
  out: string,
  exe: string,
  launch: Launch,
): Promise<string> {
  try {
    return await prepareJvmAotCache(out, exe, launch);
  } catch (e) {
    if (!String(e).includes("rejected the AOT cache")) throw e;
    console.warn(`Open time: ${String(e)}; preparing the AOT cache once more.`);
    return await prepareJvmAotCache(out, exe, launch);
  }
}

async function prepareJvmAotCache(
  out: string,
  exe: string,
  launch: Launch,
): Promise<string> {
  const java = findBundledJava(exe);
  const component = findEngineComponent(exe);
  if (!java || !component)
    throw new Error(`No bundled JDK or engine component next to ${exe}`);
  const dir = path.join(out, "aot");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, "enso.aotconf");
  const cache = path.join(dir, "enso.aot");

  const training = await launch(
    {
      ENSO_ENGINE_ARGS: "--jvm",
      JAVA_TOOL_OPTIONS: `-XX:AOTMode=record -XX:AOTConfiguration=${config}`,
    },
    ["first"],
  );
  if (!fs.existsSync(config)) {
    throw new Error(
      `The JVM wrote no AOT configuration (training launch: ${training.error ?? "no error"})`,
    );
  }

  const created = spawnSync(
    java,
    [
      "-XX:AOTMode=create",
      `-XX:AOTConfiguration=${config}`,
      `-XX:AOTCache=${cache}`,
      ...LAUNCHER_JVM_OPTIONS,
      `--module-path=${component}`,
      "-m",
      "org.enso.runner/org.enso.runner.Main",
    ],
    {
      encoding: "utf8",
      env: credentialFreeEnv(process.env),
      timeout: CREATE_TIMEOUT_MS,
    },
  );
  if (created.status !== 0 || !fs.existsSync(cache)) {
    throw new Error(
      `Creating the AOT cache failed (${created.status}): ${created.stdout}${created.stderr}`,
    );
  }

  // A cache the JVM cannot use is reported on stdout as an `[aot]` error or warning, and the JVM
  // then runs without it, so this launch keeps the JVM's logging on.
  const check = await launch(
    { ENSO_ENGINE_ARGS: "--jvm", JAVA_TOOL_OPTIONS: `-XX:AOTCache=${cache}` },
    ["first"],
  );
  const rejected = check.stdout
    .split("\n")
    .find((line) => /\[(error|warning)\]\[aot/.test(line));
  if (rejected) throw new Error(`The JVM rejected the AOT cache: ${rejected}`);
  return cache;
}
```

The training and check launches are numbered `jvm-0` (the second overwrites the
first's directory, which is not needed afterwards).

- [ ] **Step 8: Wire the script and the type-check**

In `app/electron-client/package.json`'s `scripts`, after `ide-integration-test`:

```json
    "perf:open": "vite-node perf/openTime.ts",
```

In `app/electron-client/tsconfig.json`, `include` becomes
`["../vitest.node.base.ts", "./*.ts", "./src", "./tasks", "./tests", "./perf"]`.
Run `corepack pnpm --filter enso run typecheck` and `run lint`; expected: no
errors.

- [ ] **Step 9: Log the first execution at INFO**

In `SuggestionsHandler.scala`, the `Api.ExecutionComplete | Api.ExecutionFailed`
case:

```scala
      if (!state.executionFinished) {
        // Read by the open-time harness (`app/electron-client/perf/openTime.ts`): once per project.
        logger.info("The first execution finished.")
```

Run `sbt "language-server/testOnly org.enso.languageserver.search.*"`; expected:
PASS (no test reads the level).

- [ ] **Step 10: Run the harness locally, on Windows and on Linux**

Build an installer from the branch
(`corepack pnpm --filter build-scripts run ide-local`, with the release
variables from Global Constraints; in WSL from a Linux-side clone, `~/op-dev` as
the spike did). Then, with the credential variables unset:

```bash
corepack pnpm --filter enso run perf:open --out "$SCRATCH/t1-native" --runs 5
corepack pnpm --filter enso run perf:open --out "$SCRATCH/t1-both" --runs 3 --engines native,jvm
```

(on Linux under `xvfb-run` when there is no display; `$SCRATCH` is the session's
scratchpad). Expected:

- Every launch has all seven phases and the three extras (`notMeasured` empty;
  the report warns otherwise).
- `open-time.md` says it measured the `core` template, and the native medians
  are within about 15% of the spec's "Windows core" and "Linux core" columns
  (6811 / 6198 ms). The INFO level makes `firstExecution` earlier than the
  spike's debug runs, and nothing else should move. If the branch predates
  #482's merge, merge `develop` into it first (a merge commit, never a rebase).
- The JVM stage either completes, or fails naming the stage, inside its own
  budget. If the JVM training launch writes no configuration, the PR says so,
  and `--engines jvm` is fixed before Task 1 merges: the spec's comparison needs
  it.

- [ ] **Step 11: Add the CI step**

In `.github/workflows/ide-packaging.yml`:

- `workflow_dispatch.inputs` gains

  ```yaml
  open_perf:
    description: Measure the open time (app/electron-client/perf/openTime.ts).
    required: false
    type: boolean
    default: false
  open_perf_jvm:
    description:
      Measure the open time on the JVM too (with an AOT cache), after native, on
      the same build.
    required: false
    type: boolean
    default: false
  ```

  and `workflow_call.inputs` gains `open_perf` (`type: boolean`,
  `default: false`, description "Measure the open time: every develop push, and
  pull requests with the `CI: Open perf` label").

- `package-ide`: `timeout-minutes: ${{ inputs.open_perf_jvm && 90 || 45 }}`, a
  job-level

  ```yaml
  env:
    OPEN_PERF: ${{ inputs.open_perf == true }}
    OPEN_PERF_ENGINES: ${{ inputs.open_perf_jvm && 'native,jvm' || 'native' }}
  ```

  and, after the two "Run Package Tests" steps and before "Upload Test Traces":

  ```yaml
  # Note [Open Time In CI]
  # ======================
  # `app/electron-client/perf/openTime.ts` opens two new projects per launch, five launches,
  # and records when each phase of an open ends (spec
  # docs/superpowers/specs/2026-11-01-project-open-performance-design.md, section 2). It runs on
  # develop pushes, on pull requests with the `CI: Open perf` label and when started by hand
  # (`open_perf`, and `open_perf_jvm` for the JVM beside native). It compares with the newest
  # develop run's `open-perf-<os>` artifact and warns, never fails: shared runners are noisy,
  # so these steps continue on error (`checkOpenPerf` in tools/ci/check-workflows.mjs).
  - if: env.OPEN_PERF == 'true'
    name: Find develop's last open time
    id: open-perf-baseline
    continue-on-error: true
    shell: bash
    env:
      GH_TOKEN: ${{ github.token }}
      REPO: ${{ github.repository }}
      OS: ${{ matrix.os }}
      RUN_ID: ${{ github.run_id }}
    run: |
      run_id=$(gh api -X GET "repos/$REPO/actions/artifacts" -f name="open-perf-$OS" -f per_page=50 \
        --jq "[.artifacts[] | select(.expired | not)
               | select(.workflow_run.head_branch == \"develop\" and .workflow_run.head_repository_id == .workflow_run.repository_id)
               | select(.workflow_run.id != $RUN_ID)] | .[0].workflow_run.id // empty")
      echo "run-id=$run_id" >> "$GITHUB_OUTPUT"
  - if: env.OPEN_PERF == 'true' && steps.open-perf-baseline.outputs.run-id != ''
    name: Download develop's last open time
    continue-on-error: true
    uses: actions/download-artifact@v5
    with:
      name: open-perf-${{ matrix.os }}
      path: open-perf-baseline
      run-id: ${{ steps.open-perf-baseline.outputs.run-id }}
      github-token: ${{ github.token }}
  - if: env.OPEN_PERF == 'true' && matrix.os == 'linux'
    name: Measure the open time
    continue-on-error: true
    run: >-
      xvfb-run corepack pnpm --filter enso run perf:open --out
      "$GITHUB_WORKSPACE/open-perf" --runs 5 --engines "$OPEN_PERF_ENGINES"
      --budget-minutes 12 --baseline
      "$GITHUB_WORKSPACE/open-perf-baseline/open-time.json" --summary
      "$GITHUB_STEP_SUMMARY"
  - if: env.OPEN_PERF == 'true' && matrix.os == 'windows'
    name: Measure the open time
    continue-on-error: true
    run: >-
      corepack pnpm --filter enso run perf:open --out
      "$env:GITHUB_WORKSPACE/open-perf" --runs 5 --engines
      "$env:OPEN_PERF_ENGINES" --budget-minutes 12 --baseline
      "$env:GITHUB_WORKSPACE/open-perf-baseline/open-time.json" --summary
      "$env:GITHUB_STEP_SUMMARY"
  - if: env.OPEN_PERF == 'true' && !cancelled()
    name: Upload the open time
    continue-on-error: true
    uses: actions/upload-artifact@v5
    with:
      name: open-perf-${{ matrix.os }}
      path: |
        open-perf/open-time.json
        open-perf/open-time.md
        open-perf/*/marks.json
        open-perf/*/logs
      if-no-files-found: warn
  ```

  The GUI's `ENSO_IDE_*` variables are not set on these steps: the harness needs
  none.

In `.github/workflows/ide-pull-request.yml`:

- Every `github.event.label.name != 'CI: Build IDE'` becomes
  `github.event.label.name != 'CI: Build IDE' && github.event.label.name != 'CI: Open perf'`
  (six places: the concurrency group, the three changed-files jobs' `if`, the
  summary job's `name` and `if`).
- `ide-packaging`'s `if` and the summary step's `PACKAGING_EXPECTED` each gain
  `|| contains(github.event.pull_request.labels.*.name, 'CI: Open perf')`, and
  its `with:` gains

  ```yaml
      open_perf: ${{ github.event_name == 'push' || contains(github.event.pull_request.labels.*.name, 'CI: Open perf') }}
  ```

- The `pull_request` trigger's comment names both labels, and Note [Ignoring
  Unrelated Label Events] gains: "Here two labels are related, `CI: Build IDE`
  and `CI: Open perf` (which measures the open time, Note [Open Time In CI] in
  `ide-packaging.yml`); `gui-pull-request.yml`'s copy names only the first,
  since the GUI checks do not measure it."

- [ ] **Step 12: Add the policy rule, test first**

In `tools/ci/check-workflows.test.mjs`, a `describe('open time', …)` with three
tests on fixtures (built with the file's `fixture()`): a packaging workflow
whose `package-ide` has a "Run Package Tests" step followed by a step running
`perf:open` with `continue-on-error: true`, and a pull-request workflow whose
label tests all name both labels, gives `[]`; the same with the `perf:open` step
before "Run Package Tests", or without `continue-on-error`, gives one problem
each; a `package-ide` with a `perf:open` step and no "Run Package Tests" step
gives one problem; a pull-request workflow with one `!= 'CI: Build IDE'` lacking
the `CI: Open perf` half gives one problem. Run
`node --test tools/ci/check-workflows.test.mjs`; expected: FAIL (`checkOpenPerf`
is not exported).

Then in `tools/ci/check-workflows.mjs`, before `CHECKS`:

```js
/**
 * The open-time steps (Note [Open Time In CI] in `ide-packaging.yml`) warn and never fail, and run
 * after the package tests; and the IDE pull-request workflow treats `CI: Open perf` as a related
 * label wherever it treats `CI: Build IDE` as one, or adding the label would start an inert run.
 */
export function checkOpenPerf({ workflows }) {
  const problems = [];
  const job = workflows["ide-packaging.yml"]?.doc?.jobs?.["package-ide"];
  const steps = job?.steps ?? [];
  const lastTests = steps.findLastIndex(
    (s) => String(s?.name ?? "") === "Run Package Tests",
  );
  const measures = steps.some((s) =>
    String(s?.run ?? "").includes("perf:open"),
  );
  if (measures && lastTests < 0) {
    problems.push(
      'ide-packaging.yml › package-ide: measures the open time but has no "Run Package Tests" step',
    );
  }
  steps.forEach((step, index) => {
    if (!String(step?.run ?? "").includes("perf:open")) return;
    if (step["continue-on-error"] !== true) {
      problems.push(
        "ide-packaging.yml › package-ide: an open-time step must continue on error",
      );
    }
    if (index < lastTests) {
      problems.push(
        "ide-packaging.yml › package-ide: the open time is measured after the package tests",
      );
    }
  });
  const text = workflows["ide-pull-request.yml"]?.text ?? "";
  const buildIde = (text.match(/!= 'CI: Build IDE'/g) ?? []).length;
  const both = (
    text.match(
      /!= 'CI: Build IDE' && github\.event\.label\.name != 'CI: Open perf'/g,
    ) ?? []
  ).length;
  if (buildIde !== both) {
    problems.push(
      `ide-pull-request.yml: ${buildIde - both} unrelated-label test(s) do not exempt 'CI: Open perf'`,
    );
  }
  return problems;
}
```

and add `checkOpenPerf` to `CHECKS`. Run `node --test tools/ci/*.test.mjs`,
`node tools/ci/check-workflows.mjs` and actionlint; expected: all pass,
`Workflow policy: OK`.

- [ ] **Step 13: Document**

- `app/electron-client/CLAUDE.md`, a section "Open-time harness" after "Tests":
  what `perf:open` measures (the phases and where each comes from, as in the
  rulings), its options, its output, that it strips the credential variables,
  that a JVM run builds an AOT cache under `<out>/aot/` first, that
  `tests/packagedIde.ts` holds the packaged-app lookups, and that its unit tests
  run with `corepack pnpm --filter enso exec vitest --run tests/headless`.
- `.github/CLAUDE.md`: under "Layout", `ide-packaging.yml` also measures the
  open time (Note [Open Time In CI]); under "Conventions", the `CI: Open perf`
  label (adding or removing it starts a run, and removing it cancels a packaging
  run in progress); in the table, a row
  `ide-packaging.yml › Package New IDE | corepack pnpm --filter enso run perf:open (develop, CI: Open perf, by hand) | —`.

- [ ] **Step 14: Commit, open the PR, label and check**

Commit (`Open time: a harness and a CI step that measure it`), push, open the PR
with `--body-file` (what it measures, the local medians tables from Step 10 for
both platforms, that the headless tests were run locally and the proposed
`test:unit` follow-up, `CI: No changelog needed`). The controller creates the
label
(`gh label create "CI: Open perf" --color c5def5 --description "Measure the project open time in the IDE packaging"`)
and adds both labels. Expected in CI: both "Measure the open time" steps run,
the job summary has the table and "No develop baseline of the core template to
compare with.", the `open-perf-linux` and `open-perf-windows` artifacts exist.
Merge on green. After the merge, check the first develop run's summary and
artifacts (a develop-only condition cannot be proven on the PR).

**Proof for every later task.** With the branch's PR labelled `CI: Open perf`,
the job summary of each platform shows the branch's medians beside develop's
last ones. Copy both tables into the PR body under "Open time, before and
after", with the headline row's change. A task whose saving is Windows-only
(6, 7) also gives a local Windows run (Step 10's command on an installer from
develop and one from the branch).

---

### Task 2: Start-up health polling every 25 ms

No change visible to users: `CI: No changelog needed`. Merges on green.

**Files:**

- Modify: `app/project-manager-shim/src/projectService/ensoRunner.ts`
- Test:
  `app/project-manager-shim/src/projectService/__tests__/healthcheckDelay.test.ts`,
  `app/project-manager-shim/src/projectService/__tests__/healthPolling.test.ts`
- Modify: `app/project-manager-shim/src/projectService/__tests__/testPorts.ts`
  (a seventh band)
- Modify: `app/project-manager-shim/CLAUDE.md` ("Ports and the engine's health
  check")

**Interfaces:**

- Produces: `export function loadHealthcheckDelay(elapsedMs: number): number`.

- [ ] **Step 1: Write the failing test**

```ts
/** @file How long the runner waits between health checks while an engine starts. */
import { expect, test } from "vitest";
import { loadHealthcheckDelay } from "../ensoRunner.js";

test("polls every 25 ms in the first second, then every 250 ms", () => {
  expect(loadHealthcheckDelay(0)).toBe(25);
  expect(loadHealthcheckDelay(999)).toBe(25);
  expect(loadHealthcheckDelay(1000)).toBe(250);
  expect(loadHealthcheckDelay(30_000)).toBe(250);
});
```

The pure test alone proves nothing about the wiring, so a second test drives a
real `EnsoRunner` against a fake engine, in the style of `startupCrash.test.ts`.
Create
`app/project-manager-shim/src/projectService/__tests__/healthPolling.test.ts`:

- **The fake engine.** It is a copy of that file's `FAKE_ENSO` and `fakeEnso()`
  helpers, with one change. It listens at once but answers `503` to `/_health`
  for its first 300 ms. It counts those early requests in `<project>.early`:

  ```js
  const started = Date.now();
  let early = 0;
  http
    .createServer((_request, response) => {
      if (Date.now() - started < 300) {
        early += 1;
        fs.writeFileSync(project + ".early", String(early));
        response.statusCode = 503;
        response.end("starting");
      } else response.end("ok");
    })
    .listen(port, "127.0.0.1");
  ```

- **The test.** `'polls a starting engine several times in its first 300 ms'`:
  - `openProject` resolves;
  - the early count is at least 5 (at 25 ms there are about 12; at today's 250
    ms, with the first check at 250 ms, there is at most 1).
- **Its port band.** It uses a new band in `testPorts.ts`:
  `export const HEALTH_POLLING_PORT = randomPortInBand(6)`, with
  `FIRST_BAND_START` lowered from `12_000` to `9_000`. That file's comment says
  a seventh band needs it, and its sentence about "six bands" becomes "seven
  bands".

Run:
`corepack pnpm --filter project-manager-shim exec vitest run src/projectService/__tests__/healthcheckDelay.test.ts src/projectService/__tests__/healthPolling.test.ts`
Expected: both FAIL. The first because `loadHealthcheckDelay` is not exported,
the second with an early count of 0 or 1.

- [ ] **Step 2: Poll fast for the first second**

In `ensoRunner.ts`, beside `LOAD_HEALTHCHECK_INTERVAL`:

```ts
/* Note [Start-up Health Polling]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A native engine answers `/_health` some 200 ms after it is spawned, and the open waits for that
 * answer. Polling every 250 ms (the first check 250 ms after the spawn) added up to 250 ms to every
 * open, so the first second polls every 25 ms; a slow start (the JVM, a cold machine) then falls
 * back to 250 ms, so the checks never pile up.
 */
const LOAD_HEALTHCHECK_FAST_INTERVAL = 25;
const LOAD_HEALTHCHECK_FAST_PERIOD_MS = 1000;

/** The delay before the next start-up health check, `elapsedMs` after the engine was spawned. */
export function loadHealthcheckDelay(elapsedMs: number): number {
  return elapsedMs < LOAD_HEALTHCHECK_FAST_PERIOD_MS
    ? LOAD_HEALTHCHECK_FAST_INTERVAL
    : LOAD_HEALTHCHECK_INTERVAL;
}
```

In `startLoadingRoutine`, `const startedAt = Date.now()` before `healthCheck`,
`setTimeout(healthCheck, LOAD_HEALTHCHECK_INTERVAL)` inside it becomes
`setTimeout(healthCheck, loadHealthcheckDelay(Date.now() - startedAt))`, and the
first `setTimeout(healthCheck, 250)` becomes
`setTimeout(healthCheck, loadHealthcheckDelay(0))`.

- [ ] **Step 3: Run the shim's tests**

Run: `corepack pnpm --filter project-manager-shim run test:unit`, then
`typecheck` and `lint`. Expected: PASS, including `startupCrash.test.ts` and
`portInUse.test.ts`, which start fake engines.

- [ ] **Step 4: Document, prove, open the PR**

Add a sentence to `app/project-manager-shim/CLAUDE.md`'s "Ports and the engine's
health check": the start-up checks run every 25 ms for the first second and
every 250 ms after (Note [Start-up Health Polling]). Commit
(`Project open: poll the engine's health every 25 ms while it starts`), open the
PR with `CI: No changelog needed` and `CI: Open perf`, and give the proof (Task
1). Expected: `openAnswered` and everything after it earlier by up to 225 ms on
Linux; on Windows see the ruling.

---

### Task 3: Request the suggestion database when the GUI connects

No changelog entry here (`CI: No changelog needed`; Task 8 carries the one
entry). Merges after the user's OK.

**Files:**

- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts`
- Test:
  `app/gui/src/providers/openedProjects/suggestionDatabase/__tests__/loaded.test.ts`
- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/CLAUDE.md`

**Interfaces:**

- Changes:
  `Synchronizer.loadDatabase(entries, lsRpc, updateProcessor, initialDbRequest?)`
  takes the request already made; its one caller passes it.

- [ ] **Step 1: Write the failing test**

Add to `loaded.test.ts`:

```ts
test("the suggestion database is requested before the first execution", async () => {
  const getSuggestionsDatabase = vi.fn(() => new Promise<never>(() => {}));
  const { lsRpc } = mockLanguageServer({ getSuggestionsDatabase });
  const projectStore: Partial<ProjectStore> = {
    lsRpcConnection: lsRpc,
    // Never settles: the first execution has not finished.
    firstExecution: new Promise<never>(
      () => {},
    ) as Promise<unknown> as ProjectStore["firstExecution"],
  };
  const scope = effectScope();
  scope.run(() =>
    createSuggestionDbStore(
      projectStore as ProjectStore,
      mockProjectNameStore(),
    ),
  );
  await vi.waitFor(() =>
    expect(getSuggestionsDatabase).toHaveBeenCalledTimes(1),
  );
  scope.stop();
});
```

and in the test 'the store is loaded only once the initial suggestion database
is, not merely the groups', the comment "Groups arrive first; the database is
requested after them." becomes "Groups arrive first; the database answers after
them."

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/suggestionDatabase/__tests__/loaded.test.ts`
Expected: the new test FAILS (the request waits for the groups, which wait for
the first execution); the others pass.

- [ ] **Step 2: Send the request at connect time**

In `index.ts`, `Synchronizer`'s constructor:

```ts
    ).then(async (capability) => {
      if (!capability.ok) {
        capability.error.log('Will not receive database updates')
      }
      this.#setupUpdateHandler(lsRpc, updateProcessor) // Do not await
      // Note [The Suggestion Database Is Requested At Connect Time]
      const initialDbRequest = exponentialBackoff(() => lsRpc.getSuggestionsDatabase())
      return Synchronizer.loadDatabase(entries, lsRpc, await updateProcessor, initialDbRequest)
    })
```

with the Note above the class:

```ts
/* Note [The Suggestion Database Is Requested At Connect Time]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * `search/getSuggestionsDatabase` makes the language server invalidate its modules index and
 * start the runtime's background jobs. Sent after the first execution (when the component groups
 * arrive), those jobs ran while the welcome table waited, so it is sent as soon as the update
 * capability is held. The component groups still wait for the first execution: the runtime
 * reports only the groups of the libraries it has loaded. Updates that arrive before the groups
 * are queued by `#setupUpdateHandler` (registered before the request goes out) and applied after
 * the initial database, as before. The catalogue holds its entries back until the first execution
 * (Note [Catalogue Entries In The Suggestions Database] in the language server).
 */
```

and `loadDatabase`:

```ts
  static async loadDatabase(
    entries: SuggestionDb,
    lsRpc: LanguageServer,
    updateProcessor: SuggestionUpdateProcessor,
    initialDbRequest = exponentialBackoff(() => lsRpc.getSuggestionsDatabase()),
  ): Promise<{ currentVersion: number }> {
    const initialDb = await initialDbRequest
```

(the rest unchanged).

- [ ] **Step 3: Run the GUI's checks**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/suggestionDatabase`,
then `run typecheck`, `run lint`, `run test:unit`. Expected: PASS.

- [ ] **Step 4: Document, prove, open the PR**

In `suggestionDatabase/CLAUDE.md`, the `index.ts` bullet: the `Synchronizer`
requests the database as soon as it holds the update capability, and the groups
after the first execution (Note [The Suggestion Database Is Requested At Connect
Time]). Commit
(`Project open: request the suggestion database when the GUI connects`), open
the PR with `CI: No changelog needed` and `CI: Open perf`, give the proof, and
run the component browser by hand on the installer (CI's `ide-<os>` artifact):
it lists the imported libraries' components with their groups' colours, and
those of a library that is not imported (the catalogue). The abort rule from the
rulings applies here: if the harness shows a net loss (`firstExecution` later by
more than `welcomeShown` is earlier, or the headline worse), stop, do not ask
for a merge, and ask the user whether to keep Task 3. Otherwise wait for the
user's OK.

---

### Task 4: Read each library's bindings cache once

No change visible to users: `CI: No changelog needed`. Merges on green.

**Files:**

- Modify:
  `engine/runtime/src/main/java/org/enso/interpreter/runtime/TruffleCompilerContext.java`
  (`libraryBindings`, Note [One Bindings Cache Read Per Library]; `known`
  removed)
- Modify:
  `engine/runtime/src/main/scala/org/enso/interpreter/runtime/DefaultPackageRepository.scala`
  (`loadedLibraryBindings` removed)
- Test:
  `engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/LibraryBindingsReadOnceTest.java`,
  `engine/runtime-integration-tests/src/test/java/org/enso/interpreter/runtime/LibraryBindingsInvalidationTest.java`
- Modify: `engine/runtime/CLAUDE.md`

**Interfaces:**

- Produces:
  `scala.Option<ImportExportCache.CachedBindings> libraryBindings(LibraryName libraryName) throws InterruptedException`
  and `void clearLibraryBindings()` on `TruffleCompilerContext`
  (package-visible, as `deserializeLibraryBindings`, which `libraryBindings`
  replaces, was).

- [ ] **Step 1: Write the failing test**

Create `LibraryBindingsReadOnceTest.java` in
`engine/runtime-integration-tests/src/test/java/org/enso/compiler/test/`. It
persists `Fib_Test` exactly as `SerdeCompilerTest.parseSerializedModule` does
(the first context: `compiler.run(module)`, `serializeModule` for every compiled
module, `compiler.compile(false, true, scala.Option.empty())`, all futures
`true`), then opens a second context on the same package with IR caches enabled,
`RuntimeOptions.LOG_LEVEL` `WARNING`,
`.option("log.enso.org.enso.interpreter.runtime.SerializationPool.level", "FINE")`
and a `java.util.logging.Handler` that keeps every `LogRecord`, runs
`compiler.run(module)`, and asserts:

```java
    var restored =
        records.stream()
            .filter(r -> "Restored bindings for library [{0}].".equals(r.getMessage()))
            .map(r -> String.valueOf(r.getParameters()[0]))
            .toList();
    assertTrue("Fib_Test's bindings are restored: " + restored, restored.contains("local.Fib_Test"));
    for (var library : new java.util.HashSet<>(restored)) {
      assertEquals(
          library + "'s bindings cache is read once: " + restored,
          1,
          java.util.Collections.frequency(restored, library));
    }
```

Copy `ensoContextForPackage` from `SerdeCompilerTest` with the extra option and
the handler. Run:
`sbt "runtime-integration-tests/testOnly org.enso.compiler.test.LibraryBindingsReadOnceTest"`.
Expected: FAIL, `local.Fib_Test's bindings cache is read once` (2: once for
`Main`'s import of `Arith`, once to load a module). If it passes, the fixture
reaches only one of the two paths: make `Main` import `Arith` by a qualified
`import local.Fib_Test.Arith` in a copy of the fixture
(`src/test/resources/Fib_Bindings_Test`), and record which in the PR. Do not go
on until the test fails for the reason named.

The logger option follows the pattern `SerdeCompilerTest` uses
(`log.enso.org.enso.compiler.Compiler.level`): `log.enso.<class>.level`, where
`<class>` is the class `TruffleCompilerContext` hands to `context.getLogger(…)`
(`SerializationPool.class`; it is
`org.enso.interpreter.runtime.SerializationPool`,
`engine/runtime/src/main/java/org/enso/interpreter/runtime/SerializationPool.java`).
The records' logger name is
`enso.org.enso.interpreter.runtime.SerializationPool`, as in the spike's
Language Server log. If the handler captures no `Restored bindings` record at
all, the precondition assertion fails first. Then use `log.enso.level=FINE`
instead, and keep the message filter.

A second test covers the invalidation. It is
`engine/runtime-integration-tests/src/test/java/org/enso/interpreter/runtime/LibraryBindingsInvalidationTest.java`,
in that package because `libraryBindings` is package-visible. It uses one
context on the persisted `Fib_Test`:

1. Read the bindings once, with `libraryBindings(local.Fib_Test)` on the leaked
   `EnsoContext`'s compiler context.
2. Run `compiler.compile(false, true, scala.Option.empty())` again, which
   serialises the library, and wait for its future.
3. Read again.

It asserts that two `Restored bindings for library [local.Fib_Test]` records
exist: the second read went to the file, not the memo. It does not compile
before Step 2, since the method is new. After Step 2 it guards the generation
bump: without the bump it sees one record.

- [ ] **Step 2: One map in `TruffleCompilerContext`**

Replace `private final Map<LibraryName, MapToBindings> known = new HashMap<>();`
with:

```java
  /* Note [One Bindings Cache Read Per Library]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * Import resolution (`DefaultPackageRepository.getLibraryBindings`) and module loading
   * (`deserializeModule`) both need a library's bindings cache, and each kept its own map, so each
   * read the same file (Base's and Table's take ~250 ms each). `libraryBindings` reads it once and
   * both use it. It remembers every answer that came from the file, found or not; it does not
   * remember the compile target's skip (Note [Compile Target Skips Its Bindings Cache]), the abort
   * of a library waiting to be serialised, or an interrupt, which are asked again.
   *
   * Writing a library's cache (`serializeLibrary`) bumps the library's generation twice: before the
   * task is submitted and in the task's `finally`, after the file is written. A read stores its
   * answer only if the generation it started under is still the current one, so a read that
   * overlaps a write never leaves its stale answer behind; remembering "absent" (which `known`
   * never did) is safe because of that. `shutdown` forgets everything.
   */
  private record Remembered(long generation, scala.Option<ImportExportCache.CachedBindings> bindings) {}

  private final Map<LibraryName, Remembered> libraryBindings =
      new java.util.concurrent.ConcurrentHashMap<>();
  private final Map<LibraryName, java.util.concurrent.atomic.AtomicLong> bindingsGenerations =
      new java.util.concurrent.ConcurrentHashMap<>();

  private java.util.concurrent.atomic.AtomicLong bindingsGeneration(LibraryName libraryName) {
    return bindingsGenerations.computeIfAbsent(
        libraryName, n -> new java.util.concurrent.atomic.AtomicLong());
  }

  /** Forget the library's answer: its cache is being (re)written. */
  private void invalidateLibraryBindings(LibraryName libraryName) {
    bindingsGeneration(libraryName).incrementAndGet();
    libraryBindings.remove(libraryName);
  }

  /** Forget every answer. Also called by `DefaultPackageRepository.shutdown`. */
  void clearLibraryBindings() {
    bindingsGenerations.values().forEach(java.util.concurrent.atomic.AtomicLong::incrementAndGet);
    libraryBindings.clear();
  }

  /**
   * The library's bindings cache, read at most once per generation. See Note [One Bindings Cache
   * Read Per Library].
   *
   * @throws InterruptedException as `deserializeLibraryBindings` did; nothing is remembered then
   */
  scala.Option<ImportExportCache.CachedBindings> libraryBindings(LibraryName libraryName)
      throws InterruptedException {
    var generation = bindingsGeneration(libraryName);
    var startedUnder = generation.get();
    var known = libraryBindings.get(libraryName);
    if (known != null && known.generation() == startedUnder) return known.bindings();
    var read = readLibraryBindings(libraryName);
    if (read.remember()) {
      libraryBindings.compute(
          libraryName,
          (name, current) ->
              generation.get() == startedUnder ? new Remembered(startedUnder, read.bindings()) : current);
    }
    return read.bindings();
  }

  private record BindingsRead(scala.Option<ImportExportCache.CachedBindings> bindings, boolean remember) {}
```

Rename the body of `deserializeLibraryBindings` to
`private BindingsRead readLibraryBindings(LibraryName libraryName) throws InterruptedException`,
returning `new BindingsRead(scala.Option.empty(), false)` from the
compile-target and abort branches and `new BindingsRead(…, true)` from the two
branches after `loadCache(cache)`. `deserializeLibraryBindings` had two callers,
`deserializeModule` and `DefaultPackageRepository.getLibraryBindings` (checked:
`git grep -n deserializeLibraryBindings engine`), and both now call
`libraryBindings`, so it is gone; Note [Compile Target Skips Its Bindings Cache]
names `deserializeLibraryBindings`, which becomes `readLibraryBindings` there.
In `deserializeModule`, the `known` block becomes the following, inside the
`try … catch (InterruptedException ex) { // proceed }` it already has, so module
loading treats an interrupt exactly as before:

```java
        var cached = libraryBindings(library);
        bindings = cached.isDefined() ? cached.get().bindings() : null;
```

(`bindings` declared before the `try` as
`ImportExportCache.MapToBindings bindings = null;`).

In `serializeLibrary(Compiler, LibraryName)`,
`invalidateLibraryBindings(libraryName)` goes before `doSerializeLibrary`. The
task `doSerializeLibrary` returns is wrapped so that its `finally` calls
`invalidateLibraryBindings(libraryName)` again:

```java
    var write = doSerializeLibrary(compiler, libraryName);
    Callable<Boolean> task =
        () -> {
          try {
            return write.call();
          } finally {
            // Note [One Bindings Cache Read Per Library]: a read during the write is not kept.
            invalidateLibraryBindings(libraryName);
          }
        };
```

In `shutdown(boolean)`, the first line is `clearLibraryBindings();`.

- [ ] **Step 3: `DefaultPackageRepository` uses it**

The `loadedLibraryBindings` field becomes a set of the libraries whose
dependencies were loaded (its other job: `loadDependencies` reads the library's
manifest from disk, which must stay once per library):

```scala
  /** The libraries whose dependencies `getLibraryBindings` has loaded. */
  private val dependenciesLoaded: collection.mutable.Set[LibraryName] =
    collection.mutable.Set()
```

`shutdown` clears it instead of `loadedLibraryBindings`, and also calls
`compilerContext.clearLibraryBindings()` when the repository holds a
`TruffleCompilerContext`, keeping the old map's lifetime. Use the context the
repository already has: check what `DefaultPackageRepository`'s constructor
takes, and if it holds none, clear only from the context's `shutdown`, saying so
in the PR. `getLibraryBindings` becomes:

```scala
  override def getLibraryBindings(
    libraryName: LibraryName,
    moduleName: QualifiedName,
    context: CompilerContext
  ): Option[IRModule] = {
    val cache = ensurePackageIsLoaded(libraryName).toOption.flatMap { _ =>
      if (dependenciesLoaded.add(libraryName)) {
        loadedPackages.get(libraryName).flatten.foreach(loadDependencies(_))
      }
      // Note [One Bindings Cache Read Per Library] in TruffleCompilerContext.
      context
        .asInstanceOf[TruffleCompilerContext]
        .libraryBindings(libraryName)
    }
    cache.map(_.bindings.findForModule(moduleName))
  }
```

The result is today's: `cache` was an `Option[Option[CachedBindings]]` flattened
by `flatMap(_.map(…))`, and is now the `Option[CachedBindings]` itself. An
`InterruptedException` from `libraryBindings` propagates out of
`getLibraryBindings`, as `deserializeLibraryBindings`' did. Scala has no checked
exceptions, so nothing is declared or caught.

- [ ] **Step 4: Run the tests**

Run:
`sbt "runtime-integration-tests/testOnly org.enso.compiler.test.LibraryBindingsReadOnceTest org.enso.interpreter.runtime.LibraryBindingsInvalidationTest org.enso.compiler.test.SerdeCompilerTest org.enso.interpreter.caches.*"`,
then `sbt "runtime-integration-tests/test"` in WSL and on Windows, then the
formatters. Expected: PASS everywhere.

- [ ] **Step 5: Document, prove, open the PR**

`engine/runtime/CLAUDE.md`, "Non-obvious conventions": "A library's bindings
cache is read once per context, by `TruffleCompilerContext.libraryBindings`,
which import resolution and module loading share; see Note [One Bindings Cache
Read Per Library]." Commit (`Engine: read each library's bindings cache once`),
open the PR with `CI: No changelog needed` and `CI: Open perf`, give the proof.
Expected: `firstExecution` and `welcomeShown` earlier by 0.4–0.9 s.

---

### Task 5: No open-time edit for a new project

No changelog entry here (`CI: No changelog needed`). #482 has merged, so it can
start on develop. Merges after the user's OK.

**Files:**

- Modify: `lib/scala/pkg/src/main/resources/default/src/Main.enso` (its id map
  only)
- Test: `app/ydoc-server/src/__tests__/languageServerSession.test.ts` (#482's
  "the new-project template" block gains two tests and the generator)
- Modify: `app/ydoc-server/CLAUDE.md`, `lib/scala/pkg/CLAUDE.md`

**Interfaces:**

- Uses: #482's `TEMPLATE_MAIN`, `WELCOME_NODE` and
  `fakeLanguageServerWithModules(names, content)`.
- Produces: the edits recorded by `fakeLanguageServerWithModules` carry
  `execute: boolean`.

- [ ] **Step 1: Write the failing test**

In `fakeLanguageServerWithModules`, `edits` becomes
`{ path: string; newVersion: string; execute: boolean }[]` and the
`text/applyEdit` case pushes `execute: message.params.execute`. In the "the
new-project template" block:

```ts
// The template carries every AST's id, so the server has none to assign and sends no edit: the
// engine's first compile already has every id, and nothing aborts it (spec section 1, fix 3).
test("opens without an edit to the Language Server", async () => {
  const ls = fakeLanguageServerWithModules(
    ["Main.enso"],
    readFileSync(TEMPLATE_MAIN, "utf8"),
  );
  const { session } = await openWithGui("ws://template-no-edit", ls);
  templateSession = session;
  await sleep(200);
  expect(ls.edits).toEqual([]);
});
```

Run:
`corepack pnpm --filter ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts`
Expected: FAIL, one edit with `execute: true` (the ids of the ASTs the
template's map does not name).

- [ ] **Step 2: Generate the template's full id map**

Add, in the same block:

```ts
// `UPDATE_TEMPLATE_ID_MAP=1` rewrites the template's id map with every AST's id, exactly as
// `syncFileContents` would assign them; the ids the file already has are kept.
test.runIf(process.env.UPDATE_TEMPLATE_ID_MAP === "1")(
  "writes the template’s full id map",
  () => {
    const { code, idMapJson, metadataJson } = splitFileContents(
      readFileSync(TEMPLATE_MAIN, "utf8"),
    );
    const module = new Ast.MutableModule(new Y.Doc());
    const { root, spans } = Ast.parseModuleWithSpans(code, module);
    module.setRoot(root);
    Ast.setExternalIds(module, spans, deserializeIdMap(idMapJson!));
    const idMap = Ast.spanMapToIdMap(spans);
    writeFileSync(
      TEMPLATE_MAIN,
      combineFileParts({
        code,
        idMapJson: serializeIdMap(idMap),
        metadataJson: metadataJson!,
      }),
    );
  },
);
```

(imports: `writeFileSync` from `node:fs`, `splitFileContents` and
`combineFileParts` from `ydoc-shared/ensoFile`, `deserializeIdMap` and
`serializeIdMap` from `../serialization`). Run it once:

```bash
UPDATE_TEMPLATE_ID_MAP=1 corepack pnpm --filter ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts -t "full id map"
```

Then `git diff lib/scala/pkg/src/main/resources/default/src/Main.enso`: only the
line after `#### METADATA ####` changes, it still contains
`"fcf199e6-d2b1-44b7-be92-a47545d6a593"`, and the code and the `{"ide":…}` line
are byte-for-byte unchanged.

- [ ] **Step 3: Run the tests**

Run: `corepack pnpm --filter ydoc-server run test:unit`, `typecheck`, `lint`.
Expected: PASS, including #482's "opens with the welcome node’s id and its
visualization shown" and Step 1's test. Then `sbt "pkg/test"` (the template is a
`pkg` resource) and
`corepack pnpm -r --filter enso ide-integration-test gettingStarted.spec.ts` on
a local installer, Linux and Windows: the welcome table appears.

- [ ] **Step 4: Check nothing is lost**

On the installer, open a new project and check by hand: the node's output type
and the `Data.read` arguments' widgets (the `format` dropdown lists its items),
the welcome table. Run the harness: `formatWidget` and `dropdownItems` are
recorded in every launch, as on develop.

- [ ] **Step 5: Document, prove, open the PR**

`app/ydoc-server/CLAUDE.md`, "Gotchas": "A file whose id map names fewer ASTs
than the module has gets an id-assigning edit on open, which re-executes the
project (`execute: true`; `execute: false` would lose the subexpressions'
values, since the engine compiled without their ids). The new-project template
ships its full id map so a new project gets none: regenerate it with
`UPDATE_TEMPLATE_ID_MAP=1` after changing the template's code." The same
sentence, shortened, in `lib/scala/pkg/CLAUDE.md` beside the template. Commit
(`Project open: the template carries its full id map`), open the PR with
`CI: No changelog needed` and `CI: Open perf`, give the proof (expected:
`firstExecution` earlier by 0.25–1.1 s, and the log has no
`Aborting … jobs because edit file`), and propose the reopened-project follow-up
from the ruling. Wait for the user's OK.

---

### Task 6: The Windows connect gap, traced

No changelog entry. A documentation-only result merges on green; a fix merges
after the user's OK.

**Files:**

- Diagnosis: no file changes. The result is a fix in the file the trace names
  (with its own failing test), or a paragraph in `app/electron-client/CLAUDE.md`
  ("Open-time harness") saying where the time goes and why it stays.

**Interfaces:** none until the trace names a fix.

- [ ] **Step 1: Measure the gap on both platforms**

On develop's installer (with Tasks 1–5 merged), Windows and Linux:

```bash
corepack pnpm --filter enso run perf:open --out "$SCRATCH/t6-$(uname -s)" --runs 5 --profile
```

Record the medians of `guiConnected - openAnswered` (the spec: ~525 ms on
Windows, ~35 ms on Linux). If the Windows median is under 150 ms, the gap is
gone (an earlier task removed it): say so in a PR that adds the measured numbers
to the harness section of `app/electron-client/CLAUDE.md`, and stop.

- [ ] **Step 2: Find where the time goes**

For three Windows launches, take the renderer profile (`<run>/first.cpuprofile`)
between the `project/open` response and the ydoc socket's open (their times
relative to the profile's start are `openAnswered`/`guiConnected` plus the
profile's start offset, the click), and the `electron-out.log` console lines in
the same window. Classify the window's time as: renderer busy (profile samples
not `(idle)`; name the top three functions by self time), renderer idle waiting
(a timer, a request, a promise: name it from the console lines and the code that
runs after `project/open` resolves, `app/gui/src/providers/openedProjects/`), or
outside the renderer (Electron main or the network stack: the socket's `wsOpen`
mark long after the code that opens it ran).

- [ ] **Step 3: Apply the decision rule**

- More than half the gap is renderer work or a wait in the GUI or shim code: fix
  it there, with a failing test first (the test names the wait or the work), and
  prove it with the harness (expected: Windows `guiConnected` within 100 ms of
  Linux's gap). The PR waits for the user's OK.
- More than half is outside our code (Electron, Chromium's socket set-up, the
  OS): no fix. The PR documents the measurement, the profile's evidence and the
  conclusion in `app/electron-client/CLAUDE.md`, and merges on green.

Commit with a subject naming the outcome (`Project open: …` for a fix,
`Open-time harness: the Windows connect gap is …` for documentation), PR with
`CI: No changelog needed` and `CI: Open perf`.

---

### Task 7: The Windows second-project engine start, traced

No changelog entry. A documentation-only result merges on green; a fix merges
after the user's OK.

**Files:**

- Diagnosis: no file changes. The result is a fix (most likely in
  `app/project-manager-shim/src/projectService/ensoRunner.ts`) with its own
  failing test, or a paragraph in `app/project-manager-shim/CLAUDE.md`.

**Interfaces:** none until the trace names a fix.

- [ ] **Step 1: Measure**

From Task 6's runs (or new ones), compare `engineUp` of the second open with the
first on Windows and Linux (the spec: ~780 ms more on Windows for the second).
If the Windows difference is under 150 ms, document and stop, as in Task 6.

- [ ] **Step 2: Time the shim's stages**

On a local Windows build, add temporary `console.log(Date.now(), '<stage>')`
lines (not committed) in `EnsoRunner.openProject` before the wait for
`loadingProjects`, before and after `findServerPorts`, before
`childProcess.spawn` and in `OpenedProject.create` when the child reports its
`spawn` event; and in `OpenedProject.close` before and after `gracefulShutdown`.
Run three launches. Split the second open's click-to-`engineUp` into: the first
project's engine still shutting down (its close overlapping the second open),
the port search, the spawn call, and spawn to the launcher's first output.

- [ ] **Step 3: Apply the decision rule**

- The largest part is in the shim (waiting for the first engine's exit, the port
  search from `DEFAULT_JSONRPC_PORT` stepping over the closing engine's ports):
  fix it there with a failing vitest test in `src/projectService/__tests__/`
  that reproduces the wait with fake engines (a new file takes a port band in
  `testPorts.ts`, per the shim's CLAUDE.md), and prove it with the harness. The
  PR waits for the user's OK.
- The largest part is between the spawn call and the launcher's first output
  (process creation, antivirus scanning of the launcher): no fix. Document the
  stage times and the conclusion in `app/project-manager-shim/CLAUDE.md` and
  merge on green.

PR with `CI: No changelog needed` and `CI: Open perf`.

---

### Task 8: The first visualisation is not deferred; widget queries come after it

Carries the changelog entry. Merges after the user's OK.

**Files:**

- Modify:
  `engine/runtime-instrument-common/src/main/java/org/enso/interpreter/instrument/execution/Locking.java`
  (`tryWithReadCompilationLock`, `tryWithWriteContextLock`)
- Modify:
  `engine/runtime-instrument-common/src/main/scala/org/enso/interpreter/instrument/execution/ReentrantLocking.scala`
- Modify:
  `engine/runtime-instrument-common/src/main/scala/org/enso/interpreter/instrument/job/UpsertVisualizationJob.scala`
  (`evaluateWithoutBlocking`, Note [Visualisations Evaluated Alone Or By Their
  Execution])
- Modify:
  `engine/runtime-instrument-common/src/main/scala/org/enso/interpreter/instrument/job/ProgramExecutionSupport.scala`
  (`processPendingVisualizations`)
- Modify:
  `engine/runtime-instrument-common/src/main/java/org/enso/interpreter/instrument/job/ExecuteJob.java`
- Test:
  `engine/runtime-instrument-common/src/test/java/org/enso/interpreter/instrument/job/UpsertVisualizationLockTest.java`
- Test:
  `engine/runtime-integration-tests/src/test/scala/org/enso/interpreter/test/instrument/RuntimeVisualizationsTest.scala`
  (two tests)
- Modify: `app/gui/src/providers/openedProjects/project/executionContext.ts`
  (Note [Widget Queries After Visible Visualizations])
- Modify: `app/gui/src/providers/openedProjects/project/project.ts`
  (`useVisualizationData`'s `background` option)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`,
  `app/gui/src/project-view/composables/tableColumns.ts`
- Test:
  `app/gui/src/providers/openedProjects/project/__tests__/visualizationOrder.test.ts`
- Modify: `CHANGELOG.md`, `engine/runtime-instrument-common/CLAUDE.md`

**Interfaces:**

- Produces: on `Locking`,
  `boolean tryWithReadCompilationLock(Class<?> where, Runnable action)` and
  `boolean tryWithWriteContextLock(ContextLock contextLock, Class<?> where, Runnable action)`;
  `UpsertVisualizationJob.evaluateWithoutBlocking(locking: Locking, contextLock: ContextLock, where: Class[_], evaluate: java.util.function.Predicate[java.lang.Boolean]): Boolean`;
  `ProgramExecutionSupport.processPendingVisualizations(contextId: Api.ContextId)(implicit ctx: RuntimeContext): Unit`.
- Produces:
  `ExecutionContext.setVisualization(id, configuration, options?: { background?: boolean })`,
  `ProjectStore.useVisualizationData(configuration, options?: { background?: boolean })`,
  and the exported `visualizationsToAttach`, `foregroundSettled` and
  `BACKGROUND_RELEASE_AFTER_EXECUTION_MS` in `executionContext.ts`.

- [ ] **Step 0: Confirm where the wait is, on develop with Tasks 2–7**

Task 3 moved the `EnsureCompiledJob` the spike's wait was stuck behind (the
first ruling), so measure before building. Run the harness (5 launches, Windows
and Linux) with `ENSO_LOGSERVER_LOG_TO_FILE_LOG_LEVEL=debug` set by hand on
three extra launches. For each open, read the gap
`welcomeShown − firstExecution` and, in the debug log, the welcome table's
`UpsertVisualizationJob`, the next
`Starting ExecuteJob[…, trigger=attach/upsert visualization …]` and
`TableVizOperation`.

Decision rule:

- If the median gap is under 300 ms on both platforms, the engine half is not
  needed. Do Steps 5–9 only (the widget order), and say so in the PR.
- If not, find the window the deferral fell in. It is either during a running
  `ExecuteJob` (Step 3 (a)), or while only `SerializeModuleJob` or the file
  commands read (Step 3 (b)). Then do Steps 1–4. If the trace shows a third
  cause, stop and report it before writing code.

- [ ] **Step 1: Write the failing engine tests**

Create `UpsertVisualizationLockTest.java`. It drives `evaluateWithoutBlocking`
against a real `ReentrantLocking`, with another thread holding the locks that a
running `ExecuteJob`, `SerializeModuleJob` or `EnsureCompiledJob` holds:

```java
package org.enso.interpreter.instrument.job;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.enso.interpreter.instrument.execution.ReentrantLocking;
import org.junit.Test;

/** Note [Visualisations Evaluated Alone Or By Their Execution] in UpsertVisualizationJob. */
public class UpsertVisualizationLockTest {
  private final ReentrantLocking locking = new ReentrantLocking();
  private final UUID contextId = UUID.randomUUID();

  private enum Holder {
    /** An `ExecuteJob` of this context: the context read lock, then the compilation read lock. */
    EXECUTION,
    /** `SerializeModuleJob`: the compilation read lock only. */
    READER,
    /** `EnsureCompiledJob`: the compilation write lock. */
    COMPILE
  }

  private Thread hold(Holder holder, CountDownLatch held, CountDownLatch release) {
    Callable<Object> body =
        () -> {
          held.countDown();
          release.await(10, TimeUnit.SECONDS);
          return null;
        };
    var thread =
        new Thread(
            () -> {
              switch (holder) {
                case EXECUTION ->
                    locking.withReadContextLock(
                        locking.getOrCreateContextLock(contextId),
                        getClass(),
                        () -> locking.withReadCompilationLock(getClass(), body));
                case READER -> locking.withReadCompilationLock(getClass(), body);
                case COMPILE -> locking.withWriteCompilationLock(getClass(), body);
              }
            });
    thread.start();
    return thread;
  }

  /** What `evaluate` was told (null: not called), and whether the job was done. */
  private record Outcome(Boolean hadWrite, boolean done) {}

  private Outcome attachWhile(Holder holder, boolean evaluationIsEnough) throws Exception {
    var held = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var thread = holder == null ? null : hold(holder, held, release);
    if (thread != null) assertTrue(held.await(10, TimeUnit.SECONDS));
    var hadWrite = new AtomicReference<Boolean>();
    try {
      var done =
          UpsertVisualizationJob.evaluateWithoutBlocking(
              locking,
              locking.getOrCreateContextLock(contextId),
              getClass(),
              hasWrite -> {
                hadWrite.set(hasWrite);
                return hasWrite || evaluationIsEnough;
              });
      return new Outcome(hadWrite.get(), done);
    } finally {
      release.countDown();
      if (thread != null) thread.join(10_000);
    }
  }

  @Test
  public void neverEvaluatesBesideARunningExecutionOfTheContext() throws Exception {
    var outcome = attachWhile(Holder.EXECUTION, true);
    assertNull("not evaluated beside the execution", outcome.hadWrite());
    assertFalse("deferred to the execution", outcome.done());
  }

  @Test
  public void evaluatesAloneWhileABackgroundJobOnlyReads() throws Exception {
    var outcome = attachWhile(Holder.READER, true);
    assertEquals("under the read lock", Boolean.FALSE, outcome.hadWrite());
    assertTrue("evaluated without waiting", outcome.done());
  }

  @Test
  public void defersWhenTheReadLockIsNotEnough() throws Exception {
    var outcome = attachWhile(Holder.READER, false);
    assertFalse(outcome.done());
  }

  @Test
  public void neverEvaluatesMidCompile() throws Exception {
    var outcome = attachWhile(Holder.COMPILE, true);
    assertNull(outcome.hadWrite());
    assertFalse(outcome.done());
  }

  @Test
  public void takesTheWriteLockWhenAllIsFree() throws Exception {
    var outcome = attachWhile(null, true);
    assertEquals(Boolean.TRUE, outcome.hadWrite());
    assertTrue(outcome.done());
  }
}
```

In `RuntimeVisualizationsTest.scala`, add two tests in the style of "emit
visualization update when expression is computed" (same `context.Visualization`
module, `x -> encode x`):

- **"evaluate a visualisation attached during an execution in that execution,
  not beside it".**
  - `main`'s body is `x = 6 * 7`, then `y = Thread.sleep 1000`, then `x`, with
    `polyglot java import java.lang.Thread` and ids for `x` and `y`.
  - After the push, receive until `x`'s expression update, then send
    `AttachVisualization` for `x`.
  - Collect every response up to `ExecutionComplete`, and assert:
    - exactly one `VisualizationUpdate` for `x`, with `"42"`;
    - it comes after `y`'s expression update (so the running execution evaluated
      it once `y` ended, rather than a second thread evaluating it during the
      sleep);
    - it comes before that execution's `ExecutionComplete`.

  This is the exclusion the review asks for. Today's code gives the same order,
  because the failed write-lock attempt defers it, so the test pins the
  behaviour rather than failing first. Step 2 must keep it.

- **"report the execution as complete when a visualisation deferred during it
  fails".**
  - The first test's program and timing.
  - The attached visualisation's expression is `x -> Panic.throw "boom"`.
  - Assert, up to the run's end: an `ExecutionComplete` and no `ExecutionFailed`
    for the context, and the visualisation's failure reported as
    `VisualizationExpressionFailed` or `VisualizationEvaluationFailed` (as
    `processUnevaluatedVisualization` reports it today).
  - This pins the `try` around `processPendingVisualizations`.
- **"evaluate a visualisation attached to an idle context without an
  execution".**
  - The same program without the sleep.
  - After the first `ExecutionComplete`, attach.
  - The responses are `VisualizationAttached` and the `VisualizationUpdate`.
    Assert that no `ExecutionComplete` follows within 1 s (`context.receiveNone`
    after the two).

  Today the attach also runs an `ExecuteJob`, so the existing test expects an
  `executionComplete`, and this one fails on develop. Check that assertion in
  the existing test: if Step 3 makes the extra execution go away, update "emit
  visualization update when expression is computed" and its siblings where they
  expect it, and list each changed expectation in the PR.

Run:
`sbt "runtime-instrument-common/testOnly org.enso.interpreter.instrument.job.UpsertVisualizationLockTest"`
and
`sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.instrument.RuntimeVisualizationsTest"`.
Expected: the unit test fails to compile (`evaluateWithoutBlocking` does not
exist). The first integration test passes, as said. Record what the second does
on develop:

- **It fails** (an `ExecutionComplete` follows the attach, because the attach
  was deferred behind a background reader): it is (b)'s failing test.
- **It passes** (nothing held the lock at that moment): it stays as a guard, and
  the unit test's `evaluatesAloneWhileABackgroundJobOnlyReads` is (b)'s failing
  test.

The PR says which.

- [ ] **Step 2: The two non-blocking lock primitives**

In `Locking.java`, after `tryWithReadContextLock`:

```java
  /**
   * If one can enter read compilation lock without blocking, then invokes {@code action.run()}
   * while holding the lock and releasing it then. In such case this method returns {@code true}.
   * Otherwise it performs no action and returns {@code false}.
   *
   * @param where the class requesting the lock
   * @param action code to be executed while holding the lock
   * @return {@code true} if {@code action} was executed or {@code false} otherwise
   */
  boolean tryWithReadCompilationLock(Class<?> where, Runnable action);

  /**
   * If one can enter write context lock without blocking, then invokes {@code action.run()} while
   * holding the lock and releasing it then. In such case this method returns {@code true}.
   * Otherwise it performs no action and returns {@code false}.
   *
   * @param contextLock lock used to ensure exclusive access
   * @param where the class requesting the lock
   * @param action code to be executed while holding the lock
   * @return {@code true} if {@code action} was executed or {@code false} otherwise
   */
  boolean tryWithWriteContextLock(ContextLock contextLock, Class<?> where, Runnable action);
```

In `ReentrantLocking.scala`, after `tryWithReadContextLock`, the two
implementations. They are built as `tryWithWriteCompilationLock` and
`tryWithReadContextLock` are: `tryLock()`, `action.run()`, and `unlock()` in a
`finally`, with the same `logger.trace` lines naming the lock.
`tryWithReadCompilationLock` first applies `acquireReadCompilationLock`'s lock
ordering as a check that returns `false` instead of throwing:

```scala
    try {
      assertNoFileLock(
        s"Cannot acquire read compilation lock [${where.getSimpleName}]"
      )
      assertNotLocked(
        pendingEditsLock,
        s"Cannot acquire compilation read lock when having pending edits lock [${where.getSimpleName}]"
      )
    } catch {
      case e: IllegalStateException =>
        logger.trace(
          "tryWithReadCompilationLock [{}] failed due to lock ordering: {}",
          where.getSimpleName,
          e.getMessage
        )
        return false
    }
    val readLock = compilationLock.readLock()
```

`tryWithWriteContextLock` uses
`lock.asInstanceOf[ContextLockImpl].lock.writeLock()`. A thread that holds the
context's read lock cannot take its write lock (`ReentrantReadWriteLock` does
not upgrade), and the caller below never does.

- [ ] **Step 3: Evaluate alone, or by the execution**

**(b) In `UpsertVisualizationJob`'s companion**, after
`MaxEvaluationRetryCount`:

```scala
  /* Note [Visualisations Evaluated Alone Or By Their Execution]
   * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   * A running `ExecuteJob` holds its context's read lock and the compilation read lock for its whole
   * run, and owns the frame's runtime cache and sync state, so a visualisation is never evaluated
   * beside it. The job first tries what it always did: the context read lock and the compilation
   * write lock. When the write lock is busy, it tries the context *write* lock with the compilation
   * *read* lock: the first fails while any execution of the context runs, the second while a
   * compile runs, so the visualisation is evaluated alone, beside only readers that do not touch
   * this context's frames (`SerializeModuleJob`, the file commands, rename). `ExecuteJob`s of
   * *other* contexts may run meanwhile: they hold their own contexts' locks and the compilation
   * read lock, which this path shares. That is safe because each context has its own stack,
   * frames, runtime caches and sync state, so this evaluation touches none of theirs, and
   * evaluating Enso code in parallel with another context's execution is what two contexts'
   * `ExecuteJob`s already do on `job-pool` (`jobParallelism` threads). Otherwise it defers,
   * and `ExecuteJob` evaluates what was deferred during its run before it releases its locks
   * (`ProgramExecutionSupport.processPendingVisualizations`), so a deferral during the first
   * execution no longer waits for a new execution queued behind a compile.
   */

  /** Runs `evaluate` without blocking: under the context read lock and the compilation write lock
    * if both are free, else under the context write lock and the compilation read lock if those are.
    * `evaluate` is told whether it holds the compilation write lock and answers whether it is done.
    *
    * @return whether `evaluate` ran and was done; false means the caller defers
    */
  def evaluateWithoutBlocking(
    locking: Locking,
    contextLock: ContextLock,
    where: Class[_],
    evaluate: java.util.function.Predicate[java.lang.Boolean]
  ): Boolean = {
    var ran  = false
    var done = false
    locking.tryWithReadContextLock(
      contextLock,
      where,
      () =>
        locking.tryWithWriteCompilationLock(
          where,
          () => {
            ran  = true
            done = evaluate.test(java.lang.Boolean.TRUE)
          }
        )
    )
    if (!ran) {
      locking.tryWithWriteContextLock(
        contextLock,
        where,
        () =>
          locking.tryWithReadCompilationLock(
            where,
            () => done = evaluate.test(java.lang.Boolean.FALSE)
          )
      )
    }
    done
  }
```

(import `ContextLock` and `Locking` from
`org.enso.interpreter.instrument.execution`). `runImpl`'s body after the
`InFrame` match becomes:

```scala
    val contextLock =
      ctx.locking.getOrCreateContextLock(config.executionContextId)
    var result: Option[Executable] = None
    // Note [Visualisations Evaluated Alone Or By Their Execution]
    val evaluated = UpsertVisualizationJob.evaluateWithoutBlocking(
      ctx.locking,
      contextLock,
      classOf[UpsertVisualizationJob],
      hasWriteLock => {
        val (requiresCompilation, maybeResult) =
          evaluateAndExecuteVisualization(hasWriteLock.booleanValue())
        if (!requiresCompilation) result = maybeResult
        !requiresCompilation
      }
    )
    if (!evaluated) {
      UpsertVisualizationJob.logger.trace(
        "Could not evaluate visualization {} without blocking, deferring evaluation",
        visualizationId
      )
      result = deferVisualizationEvaluation()
    }
    result
```

`evaluateAndExecuteVisualization(false)` answers `(true, None)` only for
`RequiresCompilation`, so a module-not-found or a failed evaluation is still
reported at once.

**(a) In `ProgramExecutionSupport`**, beside `runProgram`:

```scala
  /** Evaluates, from the cache of the context's top frame, the visualisations deferred while the
    * current execution ran. Called by `ExecuteJob` before it releases its locks: see Note
    * [Visualisations Evaluated Alone Or By Their Execution] in `UpsertVisualizationJob`.
    */
  final def processPendingVisualizations(
    contextId: Api.ContextId
  )(implicit ctx: RuntimeContext): Unit =
    ctx.contextManager.getStack(contextId).headOption.foreach { frame =>
      processAllUnevaluatedVisualizations(contextId, frame.cache, frame.syncState)
    }
```

In `ExecuteJob.execute`, inside the compilation lock's lambda, between
`runProgram` and `handleOutcome`:

```java
                          Option<?> outcome =
                              ProgramExecutionSupport$.MODULE$.runProgram(
                                  contextId, stack, Option.apply(runInEnv), ctx);
                          // Note [Visualisations Evaluated Alone Or By Their Execution]
                          try {
                            ProgramExecutionSupport$.MODULE$.processPendingVisualizations(
                                contextId, ctx);
                          } catch (Exception e) {
                            // The program ran: a failing visualisation must not turn its
                            // ExecutionComplete into an ExecutionFailed.
                            logger.error("Failed to evaluate the pending visualizations", e);
                          }
                          handleOutcome(outcome, ctx);
```

A `ThreadInterruptedException` (the job cancelled) is an `Exception` too, and is
caught and logged in the same way. That matches what happens to an interrupt
during today's per-expression pass: the run ends and is rescheduled by its
canceller.

`rescheduleIfNeeded` stays as it is: a visualisation whose expression the run
did not compute is still unevaluated and gets its retry.

- [ ] **Step 4: Run the engine's tests**

Run:
`sbt "runtime-instrument-common/testOnly org.enso.interpreter.instrument.job.*"`,
then
`sbt "runtime-integration-tests/testOnly org.enso.interpreter.test.instrument.RuntimeVisualizationsTest org.enso.interpreter.test.instrument.RuntimeAsyncCommandsTest org.enso.interpreter.test.instrument.RuntimeServerTest"`
three times each (they are timing-sensitive), in WSL and on Windows, then the
formatters. Expected: PASS every time, both new integration tests included.
Compare any failure with develop's history for the same assertion before
attributing it.

- [ ] **Step 5: Write the failing GUI test**

Create
`app/gui/src/providers/openedProjects/project/__tests__/visualizationOrder.test.ts`:

```ts
/** @file Widget queries are attached after the visible visualizations (Note [Widget Queries After Visible Visualizations]). */
import { expect, test } from "vitest";
import type { Uuid } from "ydoc-shared/languageServerTypes";
import type { VisRequestId, VisSlotStatus } from "ydoc-shared/visualizations";
import type { ExternalId } from "ydoc-shared/yjsModel";
import {
  foregroundSettled,
  visualizationsToAttach,
  type NodeVisualizationConfiguration,
} from "../executionContext";

const config = (expressionId: string): NodeVisualizationConfiguration => ({
  expressionId: expressionId as ExternalId,
  visualizationModule: "Standard.Visualization.Preprocessor",
  expression: "x -> x",
});
const WIDGET = "widget" as Uuid;
const TABLE = "table" as Uuid;
// The widget query was configured first, as it can be when a node's widgets render before its
// visualization.
const configs = new Map([
  [WIDGET, config("a")],
  [TABLE, config("b")],
]);

test("holds widget queries back until released", () => {
  expect(
    visualizationsToAttach(configs, new Set([WIDGET]), false).map(([id]) => id),
  ).toEqual([TABLE]);
});
test("attaches the visible ones first once released", () => {
  expect(
    visualizationsToAttach(configs, new Set([WIDGET]), true).map(([id]) => id),
  ).toEqual([TABLE, WIDGET]);
});
test("the visible visualizations are settled once none is pending", () => {
  const status = new Map<string, VisSlotStatus>([
    ["r1", "ready"],
    ["r2", "pending"],
  ]);
  const statusOf = (rid: VisRequestId) => status.get(rid);
  expect(foregroundSettled(["r1" as VisRequestId], statusOf)).toBe(true);
  expect(foregroundSettled(["r1", "r2"] as VisRequestId[], statusOf)).toBe(
    false,
  );
  expect(foregroundSettled([], statusOf)).toBe(false);
});
```

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/project/__tests__/visualizationOrder.test.ts`
Expected: FAIL (`visualizationsToAttach` is not exported).

- [ ] **Step 6: Hold widget queries in `ExecutionContext`**

In `executionContext.ts`, after `visualizationConfigPreprocessorEqual`:

```ts
/* Note [Widget Queries After Visible Visualizations]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * The engine runs each attached visualization as its own job, and a widget query that loads
 * libraries (the `format` dropdown's `File_Format.all` loads Image and SQLite, ~0.7 s cold) holds
 * the compilation lock ahead of the welcome table's visualization. So the visualizations attached
 * for widgets (`background`) wait until every visible one this context attached has answered or
 * failed, or `BACKGROUND_RELEASE_AFTER_EXECUTION_MS` after the first execution ended, whichever
 * comes first. After that they are attached as soon as they are configured: the hold is once per
 * context, at open.
 */

/** How long after the first execution held widget queries are attached regardless. */
export const BACKGROUND_RELEASE_AFTER_EXECUTION_MS = 1000;

/** The configurations to attach, visible ones first; widget queries only once released. */
export function visualizationsToAttach<K>(
  configs: ReadonlyMap<K, NodeVisualizationConfiguration>,
  background: ReadonlySet<K>,
  backgroundReleased: boolean,
): [K, NodeVisualizationConfiguration][] {
  const all = [...configs];
  const foreground = all.filter(([id]) => !background.has(id));
  return backgroundReleased
    ? [...foreground, ...all.filter(([id]) => background.has(id))]
    : foreground;
}

/** Whether at least one visible visualization is attached and none of them is still pending. */
export function foregroundSettled(
  slots: Iterable<VisRequestId>,
  statusOf: (requestId: VisRequestId) => VisSlotStatus | undefined,
): boolean {
  let any = false;
  for (const requestId of slots) {
    any = true;
    if (statusOf(requestId) === "pending") return false;
  }
  return any;
}
```

(`VisSlotStatus` joins the file's `ydoc-shared/visualizations` import.) In the
class:

- fields:

  ```ts
  /** Visualizations attached for widgets: see Note [Widget Queries After Visible Visualizations]. */
  private backgroundVisualizations = new Set<Uuid>()
  private backgroundReleased = false
  private releaseTimer: ReturnType<typeof setTimeout> | undefined
  /** The slots of the attached visible visualizations. */
  private foregroundSlots = new Set<VisRequestId>()
  private unobserveSlots: (() => void) | null = null
  ```

- `subscribeToVisualizationsDoc`: when `doc` is null,
  `this.unobserveSlots?.(); this.unobserveSlots = null` before
  `this.visualizations = null`; after
  `this.visualizations = new Visualizations(doc)`:

  ```ts
  const vis = this.visualizations;
  const onSlots = () => this.releaseBackgroundIfSettled();
  this.unobserveSlots?.();
  vis.slots.observeDeep(onSlots);
  this.unobserveSlots = () => vis.slots.unobserveDeep(onSlots);
  ```

- `registerHandlers`: the `executionComplete` and `executionFailed` handlers
  each also call `this.startReleaseTimer()` for this context's events.
- new methods:

  ```ts
  private startReleaseTimer() {
    if (this.backgroundReleased || this.releaseTimer != null) return
    this.releaseTimer = setTimeout(() => this.releaseBackground(), BACKGROUND_RELEASE_AFTER_EXECUTION_MS)
  }

  private releaseBackgroundIfSettled() {
    const vis = this.visualizations
    if (this.backgroundReleased || !vis) return
    if (foregroundSettled(this.foregroundSlots, (rid) => vis.getSlot(rid)?.status)) this.releaseBackground()
  }

  private releaseBackground() {
    if (this.backgroundReleased) return
    this.backgroundReleased = true
    clearTimeout(this.releaseTimer)
    if (this.backgroundVisualizations.size > 0) this.sync()
  }
  ```

- `setVisualization(id, configuration, options: { background?: boolean } = {})`:
  besides today's body,
  `if (configuration != null && options.background) this.backgroundVisualizations.add(id) else this.backgroundVisualizations.delete(id)`.
- `syncVisualizations`: `for (const [id, config] of this.visualizationConfigs)`
  becomes
  `for (const [id, config] of visualizationsToAttach(this.visualizationConfigs, this.backgroundVisualizations, this.backgroundReleased))`;
  `attach` adds the request id to `this.foregroundSlots` unless
  `this.backgroundVisualizations.has(visId)`; `detach` deletes it before
  removing the slot. The detach loop is unchanged (a held query was never
  attached, so it is not in `state.visualizations`).
- `dispose`: `clearTimeout(this.releaseTimer)` and `this.unobserveSlots?.()`.
- Wherever the sync returns `{ status: 'not-created' }` (`handleError` and
  `dispose`), `this.foregroundSlots.clear()` first. A stale request id would
  read as settled (`getSlot` gives `null`), so it does no harm, but the set
  should name only live slots.

In `project.ts`,
`useVisualizationData(configuration, options: { background?: boolean } = {})`
passes `options` to `executionContext.setVisualization(id, config, options)`. In
`widgetFunctionCallInfo.ts`,
`toValue(project).useVisualizationData(visualizationConfig, { background: true })`;
in `tableColumns.ts`,
`project.useVisualizationData(visConfig, { background: true })`.

- [ ] **Step 7: Run the GUI's checks**

First check `widgetFunctionCallInfo.test.ts`'s mock
`useVisualizationData(config)` (line 108) and any assertion on its arguments: a
`toHaveBeenCalledWith(config)` would now see `(config, { background: true })`.
Update such assertions to the new call, and say so in the PR.

Run: the new test, then `corepack pnpm --filter enso-gui run typecheck`,
`run lint`, `run test:unit`, and
`corepack pnpm --filter enso-gui run test:integration -- widgets` and
`-- tableVisualisation` three times each, in WSL and on Windows. Expected: PASS.

- [ ] **Step 8: Prove it, and check the widgets**

Open the PR with `CI: Open perf` and give the proof, comparing `welcomeShown`
only. Part (a) moves where the `firstExecution` mark falls: the pending
visualisations are now evaluated before `ExecutionComplete`, which is what the
mark is logged on. So `welcomeShown − firstExecution` is no longer comparable
across the change. Expected: the headline down by the Step 0 gap's size, and at
or under 4 s on both platforms on a local run; `formatWidget` and
`dropdownItems` recorded in every launch. On the installer, by hand: the
`format` dropdown, a column-name dropdown on a table node, and a visualisation
on a newly added node all appear.

- [ ] **Step 9: The changelog entry, the document, the PR**

Under `# Next Release` › `#### Enso IDE`, first:

```markdown
- [Projects open faster: a new project shows its first table in about half the
  time it took.][NNN]
```

with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` among the link
definitions (NNN this PR's number; adjust "about half" to the measured ratio of
the headline before Task 2 and after this task). In
`engine/runtime-instrument-common/CLAUDE.md`, under "Commands and jobs": "A
visualisation is never evaluated beside a running execution of its context. It
is evaluated alone (with the context write lock and the compilation read lock)
when no execution or compile runs. Otherwise the execution evaluates it before
releasing its locks (Note [Visualisations Evaluated Alone Or By Their
Execution])." If Step 0 ruled the engine half out, leave this out. Commit
(`Project open: evaluate the first visualisation at once, widget queries after it`),
push, and in the PR body list the before-and-after headline of every task (1–8)
on both platforms, which is the spec's result. Also say in the PR body:

- nothing but the harness pins (a)'s ordering (pending visualisations evaluated
  before the locks are released);
- `RuntimeVisualizationsTest`'s first new test passes on develop too, since it
  pins the exclusion rather than proving (a).

Wait for the user's OK.
