# Project open performance

Opening a project feels sluggish. A measured spike (2026-11-01, develop
`5e79cfd8c1`, release native build, raw data in the session scratchpad
`open-perf/`) found that half of what the user waits for is work around the
engine, not the engine itself. This design cuts a cold open to 4 s or less and
keeps it there with a timing job in CI. It also produces the native-against-JVM
comparison the engine's move to the JVM is waiting for.

## Decisions (the user's, 2026-11-01)

- **Target:** click to the welcome table shown, **≤ 4 s cold**, on Windows and
  Linux, native launcher, the core-only template (#482).
- **Tracking:** a CI job records the open-time phases on every develop push and
  warns (does not fail) on a regression.
- **The JVM move is decided after these fixes,** on a native-against-JVM run of
  the same harness. Native Image stays until then.

## Where the time goes today

Medians of 5, ms from the click, cold open of a new project:

| Phase (end mark)                      | Windows full | Windows core | Linux full | Linux core |
| ------------------------------------- | -----------: | -----------: | ---------: | ---------: |
| Engine process running                |          188 |          183 |        147 |        139 |
| `project/open` answered               |          396 |          395 |        398 |        390 |
| GUI opens the ydoc socket             |          921 |          921 |        434 |        424 |
| First graph node drawn                |         1958 |         1449 |       1952 |       1431 |
| First execution done                  |         6571 |         4574 |       8520 |       4950 |
| **Welcome table visualisation shown** |     **8878** |     **6811** |   **8975** |   **6198** |

"Full" is today's template, with 12 imports. "Core" is #482's, which keeps Base,
Table, Database, Examples and Visualization. The engine alone, from spawn to the
first execution done with no GUI, takes 3.2 s / 2.5 s on Windows and 3.9 s / 2.8
s on Linux. The renderer is 85% idle throughout. Postgres's and SQLite's caches
ship and are used, and the guest JVM never starts during an open.

## 1. The fixes

Each fix is its own PR, measured before and after with the harness in section 2.
Savings are the spike's estimates, apart from the template, which was measured.

1. **The first visualisation is not deferred (about 1.5–2.5 s).**
   - `UpsertVisualizationJob` defers a visualisation until the next `ExecuteJob`
     when it cannot take the compilation lock. That is exactly when the
     post-execution suggestion jobs run. When the expression has just been
     computed, the visualisation is evaluated from the cached value at once, or
     its execution is scheduled immediately.
   - Widget queries (`get_widget_json`, e.g. the `format` dropdown, whose
     `File_Format.all` calls `Meta.lookup_services` and loads Image and SQLite)
     run after the visible visualisations, not before them. A cold lookup takes
     about 0.7 s, so the dropdown is still ready long before anyone clicks it.
2. **The suggestion database is requested when the GUI connects (about 0.1–0.5
   s).**
   - Today `loadGroups(... firstExecution)` in `suggestionDatabase/index.ts`
     waits for the first execution. The request then invalidates the modules
     index and starts 14 background jobs right while the welcome table is
     waiting.
   - The catalogue already holds its entries back until the first execution
     (Note [Catalogue Entries In The Suggestions Database]), so requesting early
     sends nothing extra early.
3. **No recompile from the ydoc server's open-time edit (about 0.25–1.1 s).**
   - The ydoc server persists the ids it assigns (`languageServerSession.ts`
     sends `execute = newIdMap != null`). Every fresh project therefore gets an
     edit that aborts the first compile and recompiles.
   - An edit that only adds ids or metadata goes out with `execute: false`. The
     template also ships with the id map the server would write, so a new
     project needs no edit at all.
4. **Each library's bindings cache is read once (about 0.4–0.9 s).** Import
   resolution (`DefaultPackageRepository.loadedLibraryBindings`) and module
   compilation (`TruffleCompilerContext.known`) share one in-memory map. Today
   each reads the same file: Base and Table take about 250 ms each.
5. **Start-up and Windows gaps (about 0.3–0.7 s).**
   - The project-manager shim (`ensoRunner.ts`) polls `/_health` every 25 ms for
     the first second, instead of every 250 ms.
   - The ~525 ms Windows-only gap between `project/open` being answered and the
     GUI opening the ydoc socket is traced and fixed, or documented if it lies
     outside the code.
   - The ~780 ms Windows engine start of a second project in the same session is
     traced and fixed, or documented, the same way.
6. **Handled elsewhere:** the core-only template (#482, 2.1–2.8 s, measured) and
   the catalogue's open cost (#485, merged: 1.3–4.6 s down to 15–300 ms).

Projected cold open after all of them: about 3.4 s on Windows and 3.8 s on
Linux, which meets the target.

## 2. The timing harness and the CI job

**The harness.** The spike's Playwright script becomes a maintained tool,
`app/electron-client/perf/openTime.ts`, beside the electron tests.

- It launches the packaged IDE and creates a new project from the template, 5
  times cold.
- For each phase it records a timestamp: click, engine process up, language
  server ready, GUI connected, first node drawn, first execution done (from the
  language server's log), and welcome table shown.
- It writes a JSON file and a Markdown table of medians, and runs the same way
  locally (`corepack pnpm --filter enso run perf:open`) and in CI.
- Every run starts with the credential environment variables (`ENSO_*`, `AWS_*`,
  Snowflake, cloud) removed.

**In CI.**

- It is a step in the IDE packaging workflow, after the installer is built and
  the electron tests have run, on Linux and Windows.
- It runs on every develop push, and on a pull request only with a new
  `CI: Open perf` label, so pull requests pay no extra time by default. It adds
  about 2–3 minutes per platform.
- The table goes into the job summary, and the JSON is kept as an artifact.
- If the median exceeds 4 s, or is more than 15% worse than the last develop
  run's artifact, the job emits a GitHub warning annotation. It does not fail,
  because shared runners are noisy.

**The JVM comparison.**

- The harness takes `--engine jvm`. It starts the engine on the bundled JVM with
  the JDK AOT start-up cache. The cache is created on the machine first, because
  it cannot be relocated or shipped.
- A `workflow_dispatch` input runs native and JVM side by side on the same
  build. Run once the fixes in section 1 are in, it gives the numbers the JVM
  decision is made on.

**Proof for every fix PR:** the PR runs the harness, locally or with the label,
and gives the before and after medians in its description.

## Out of scope

- Moving the engine to the JVM: decided afterwards, from section 2's comparison.
- Taking SQLite off the native image (#484): it stays on hold until the harness
  shows whether starting the guest JVM lands on the open path once the widget
  lookup is deferred.
- Making the template not need `Standard.Visualization` (#474).
- Performance after the project is open (editing, execution of large data).
