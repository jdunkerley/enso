# A warm engine for the JVM

When the IDE runs its engine on the JVM, opening a project is slower than on
native, and most of the gap is not Enso's work: it is the JVM starting, the
Language Server initialising, and the JIT compiling the engine's own Java while
the project opens. This design starts a spare engine while the user is on the
dashboard, warms it up, and hands it to the next project opened. It is part of
the "find a path to make the JVM fast enough" work in discussion #518, after the
spec `2026-11-03-jvm-by-default-design.md` and its failed M2 gate.

Numbers marked _measured_ come from the open-time harness (`perf:open`, release
build, medians of 5–10 cold opens, ms from the click) on the owner's Windows
machine (32 logical CPUs; 4 and 8 emulated by pinning the IDE's whole process
tree with CPU affinity). Numbers marked _estimate_ are inferences from those
measurements.

## Problem

The re-gate is at **8 logical CPUs**: the JVM's `welcomeShown` and
`libraryShown` within 1.5× of native (owner decision, 2026-11-08; CI's 4 CPUs is
reported, not gated). At 8 CPUs:

| First open (measured) | Native |    JVM | Ratio | To pass |
| --------------------- | -----: | -----: | ----: | ------- |
| Welcome template      | 2.65 s | 4.79 s |  1.81 | −0.8 s  |
| `image` template      | 3.36 s | 5.10 s |  1.52 | −0.1 s  |

Where the JVM's extra time goes (measured, 32 CPUs, welcome):

- **JIT compilation of the engine's own Java** (compiler passes, Truffle nodes,
  the Language Server): about 10 s of compiler CPU by `welcomeShown`, competing
  with the open's own work. The effect grows as cores shrink: the ratio is 1.45
  at 32 CPUs, 1.81 at 8 and 2.33 at 4.
- **JVM and Language Server start:** +0.4 s before the Language Server logs
  anything, and +0.46 s from its init to "Started server" (Akka, ZIO,
  pureconfig, ~4,800 lambda classes the AOT cache does not hold, JCE jar
  verification).

Neither can be done before the user clicks today, because every engine is
spawned by `project/open` with its project already fixed.

## How an engine starts today

- The project service (`app/project-manager-shim`, inside Electron's main
  process) serves `project/open`. `EnsoRunner.openProject`
  (`projectService/ensoRunner.ts`) finds two free ports, makes a `--root-id`,
  and spawns
  `enso --server --root-id … --project-id … --path <project> --interface 127.0.0.1 --rpc-port …`
  plus the extra arguments (`--jvm`, log level), with
  `LANGUAGE_SERVER_YDOC_PORT` in the environment and the project's parent folder
  as the working directory.
- It waits for `/_health`, then for the ydoc port, then hands the sockets to the
  GUI. A watchdog polls `/_health` and respawns a crashed engine.
- Closing a project writes a newline to the engine's stdin (`LanguageServerApp`
  blocks on it), waits for exit and kills it after a timeout. One process per
  project; nothing is reused.
- The Language Server's configuration (`LanguageServerConfig`: root, project id,
  ports; the ydoc port) is fixed at boot and used throughout `MainModule`.

## Decisions

Taken with the owner during brainstorming:

1. **A started and warmed-up spare**, not only a started one: the JIT's work is
   the largest cost, and only a warm-up moves it off the open.
2. **A new spare when the user returns to the dashboard**: one exists only while
   no project is open, so no memory is spent on it while the user works.
3. **The warm-up loads the default template's imports**: Standard.Base,
   Standard.Table and Standard.Visualization.
4. **A visible setting from the start**, "Pre-start the engine", on by default,
   so that people short of memory can turn it off.
5. **Approach A, a deferred start**: the spare is a JVM in a standby mode that
   warms up and then waits for the arguments `project/open` would have passed;
   with them it starts the Language Server exactly as today. The Language
   Server's boot and configuration do not change.

Rejected:

- **A standby Language Server bound later** (boot Akka, ports and ydoc without a
  project, then a `bind` request). It would also save the Language Server's own
  init (_estimate_ 0.3–0.5 s more), but every component built from
  `LanguageServerConfig` would need late binding, and partly-bound states are a
  new class of bug. It stays a possible later step if measurements after this
  design and the startup trims (S2) show Language Server init dominating.
- **Reusing an engine across projects.** One fresh process per project, killed
  on close, is what keeps a crash or leaked state in one project from reaching
  the next.
- **A spare for the native engine.** Native starts its Language Server in about
  0.2 s; a spare would save little.
- **Warming up the last project's imports.** Closer for people who reopen one
  project, but a wrong guess loads library Java for nothing. A possible later
  step if library-heavy projects still open slowly.

## Design

### Engine: the standby mode (`engine/runner`)

`enso --jvm --standby` (with the usual `--log-level` and `--vm.D` options):

1. Starts the JVM as `--jvm` does today (same `jvm.options`, same AOT cache).
2. **Warm-up.** Creates a throwaway polyglot context on a temporary project,
   copied from the default template into a fresh folder under the system
   temporary directory, and runs a small program that imports Standard.Base,
   Standard.Table and Standard.Visualization, builds a table, filters,
   aggregates and sorts it, and prepares a table visualization of the result.
   The libraries' IR caches are read from the usual data directory, as an open
   would. It then closes the context and deletes the temporary folder.
3. **Preloading.** Loads (without initialising) the Language Server's classes
   that a boot uses, from a list kept in the runner, so that class loading and
   verification are done too.
4. Prints `STANDBY READY <ms>` on stderr and logs
   `standby: warm-up done in N ms`.
5. Reads **one line** from stdin: the arguments `project/open` would have
   passed, as a JSON array of strings, plus an optional object of environment
   additions (`LANGUAGE_SERVER_YDOC_PORT`). It applies the additions (the
   Language Server reads the ydoc port through `ApplicationConfig`; the runner
   sets the equivalent system property) and calls the existing `Main` entry with
   the arguments, exactly as if they had been on the command line. From then on
   the process is an ordinary Language Server.
6. If stdin closes before a line arrives, it exits with status 0.

Steps 2 and 3 run on a background thread; the line in step 5 is read as soon as
it arrives, and step 5 abandons a warm-up still running (settled in #659; see
"Open questions").

**Working directory.** `EnsoContext.checkWorkingDirectory` asserts that the
process's working directory is the project root's parent, and is fatal under
`-ea`. A spare starts before the project is known, so in standby mode the check
compares against the parent of `--path` from the argument line, not the
process's working directory. Relative paths in the arguments are not allowed in
standby mode (the project service always passes absolute ones).

**Isolation.** The warm-up's context is closed before the real one is created;
no Enso value, module or setting crosses from one to the other. What carries
over is the process: HotSpot's compiled code for the engine's Java, loaded
classes, and the warm-up's reads of the on-disk IR caches. The warm-up never
writes to the user's data directory beyond what any project open may write (IR
caches of the three libraries, which are shared and already exist after the
first run).

**Failure.** If the warm-up throws, the spare logs it at warning level and goes
on to standby; a broken warm-up must never stop a project from opening.

### Project service: the spare-engine manager (`app/project-manager-shim`)

A new `projectService/spareEngine.ts`, used by `EnsoRunner`:

- **When a spare exists:** only while the engine runs on the JVM (`--jvm` in the
  extra arguments), the setting is on, and no project is open. In practice: it
  starts when the project service starts (once the GUI has reported the setting,
  see below) and again after the last project closes; it is stopped when an open
  takes it or when it is no longer wanted.
- **Starting it:** it spawns the engine with the same executable, environment,
  extra arguments and log options an open would use, plus `--standby`, with the
  working directory set to the system temporary directory. It records those
  inputs (the "spawn key").
- **After a close:** it starts the new spare after the closing engine has exited
  or 2 s have passed, whichever is first, so that the two do not compete for
  CPU.
- **On `project/open`:** `openProject` takes the spare if it is alive and its
  spawn key equals what the open would use. It finds ports as today and writes
  the argument line to the spare's stdin, then treats the process exactly as a
  freshly spawned engine: the same `/_health` and ydoc waits, the watchdog, the
  stdin-newline shutdown and the shutdown hooks. If there is no spare, or the
  key differs, it spawns as today and stops the spare. A spare still warming up
  is taken anyway.
- **Respawns** (the watchdog's, after a crash) are always ordinary spawns.
- **Failure:** a spare that fails to start or dies is logged and dropped; it is
  not restarted until the next time no project is open. There is no retry loop.
- **Settings change** (engine, log level, `ENSO_ENGINE_ARGS`, the setting
  itself): the spare is stopped and, if still wanted, started again with the new
  inputs.
- **Quit:** the spare is killed with the other engines; its stdin closing makes
  it exit on its own as well.
- **Logging:** the manager logs each spare's start, `STANDBY READY` time, use or
  discard (with the reason) to the engine log, so a slow open can be traced to
  "no spare" or "spare discarded".

### The setting (GUI, Electron)

- **Where:** a new "Engine" section on the Settings page's Local tab
  (`app/gui/src/dashboard/layouts/Settings`), with one switch: **Pre-start the
  engine**, help text "Starts the engine in the background while you are on the
  dashboard, so projects open faster. Uses about 0.5–0.8 GB of memory while no
  project is open." On by default. The section is shown only when the project
  service reports that the engine runs on the JVM.
- **Storage:** a small store in `$/providers` (`localStorage`, like
  `engineLogSettings`).
- **Reaching the project service:** the GUI sends the value to the project
  service with a new request (`engine/setSpare`, `{ enabled: boolean }`) when
  the dashboard loads and whenever it changes. Until the first such request the
  project service starts no spare. The project service's answer to the existing
  initial requests says whether the engine runs on the JVM.
- **Override:** `ENSO_SPARE_ENGINE=0` in the environment disables the spare
  whatever the setting says (tests, the perf harness, support).

## Error handling summary

| Situation                             | Behaviour                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Spare fails to spawn or dies          | Logged, dropped; next open spawns as today; no retry until idle.                          |
| Warm-up throws                        | Logged; the spare still reaches standby.                                                  |
| Open while warming up                 | Spare taken; the warm-up is abandoned on the line (#659), never longer than a cold start. |
| Spawn key differs                     | Spare stopped; the open spawns as today.                                                  |
| Engine dies after the line is written | Today's crash path: watchdog, ordinary respawn.                                           |
| Setting off, or `ENSO_SPARE_ENGINE=0` | No spare; any running spare stopped.                                                      |
| IDE quits                             | Spare killed; it also exits when its stdin closes.                                        |

## Testing

- **Engine** (`engine/runner`, runtime integration tests where a process is
  needed):
  - a standby process given an argument line starts a Language Server that
    answers `/_health` and opens the project;
  - the working-directory check passes when the process's working directory is
    not the project's parent, and still fails on a wrong `--path` parent under
    `-ea`;
  - a warm-up that throws still reaches standby;
  - closing stdin before the line makes the process exit with 0.
- **Project service** (unit tests with a fake engine script, like the existing
  `ensoRunner` tests):
  - a spare exists only with the JVM, the setting on, and no project open;
  - an open takes a matching spare and writes the right line;
  - a spare whose spawn key differs is stopped and the open spawns normally;
  - a dead spare means an ordinary spawn and no retry loop;
  - a settings change stops and restarts the spare;
  - after the last close, the next spare starts once the old engine exits or 2 s
    pass;
  - quit kills the spare.
- **GUI:** the switch persists, is sent on load and on change, and is hidden
  when the engine is native (`localTab.test.ts`).
- **Integration (Playwright):** one spec opens a project with a spare and checks
  that the open used it (the engine log's "spare used" line). The other specs
  run with `ENSO_SPARE_ENGINE=0`, so their timing does not change.

## Measurement

- The perf harness gains an engine `jvm-spare`: launch the IDE with the JVM and
  the spare on, wait for the spare's `STANDBY READY` (or 15 s on the dashboard,
  as a user would spend), then open. Its first and second opens both come from a
  spare (the second after returning to the dashboard).
- Run on the owner's machine at 8 CPUs, interleaved with `native` and `jvm`,
  welcome and `image` templates, ≥ 5 runs each; 4 and 32 CPUs reported too.
  Together with the other open-time changes in flight (the standard Java
  compiler for the engine's Java, the Language Server startup trims, the
  openFile race fix), this is the re-gate's evidence.
- The PR reports the spare's idle memory (working set after `STANDBY READY`),
  the warm-up's duration and CPU time, and the open-time effect.

_Estimate_ (from the N1 measurements): −1.0 s at 32 CPUs, −2.0 s at 4, about
−1.4 s at 8, which alone would bring the welcome ratio at 8 CPUs to about 1.3.

## Rollout

Three PRs, in order:

1. **Engine:** the standby mode and the working-directory change, with tests.
   Invisible on its own (nothing passes `--standby` yet):
   `CI: No changelog needed`, merged on green after review.
2. **Project service and GUI:** the spare manager, the setting,
   `engine/setSpare`, `ENSO_SPARE_ENGINE`, tests. A visible change (a new
   setting): a changelog entry, and the owner's installer test before merging.
3. **Perf harness:** `jvm-spare` and the measurement report.

The IDE's default engine stays native. The spare affects only people who run the
JVM engine until the re-gate passes and the owner switches the default (stage 3
of the JVM-by-default spec).

## Open questions

- **Open during the warm-up:** settled by #659: abandon it the moment the line
  arrives. At 8 CPUs the first open's welcome table came after 4145 ms when it
  abandoned the warm-up, 4628 ms on a cold start and 5889 ms when it waited for
  the warm-up (pooled medians of three rounds; abandoning was faster than both
  in every round), so waiting broke the promise of never being longer than a
  cold start. `enso.standby.abandonWarmUp=false` still waits.
- **The class list for preloading** (step 3): generated from a training run (the
  classes a Language Server boot loads) or hand-kept. PR 1 decides, by what the
  AOT cache already holds: classes it archives need no preloading.
