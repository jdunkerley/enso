# project-manager-shim

TypeScript Project Manager implementation used by **both the dev workflow and
the shipped Electron build**. The name "shim" is historical — this package began
as a dev-only stand-in for the Scala Project Manager under
`lib/scala/project-manager`, but the Scala PM is no longer wired into any build,
so this TS service is now the real thing.

## Why

The GUI needs a project manager socket for `pnpm dev:vite` and the packaged
Electron app. Running the old Scala/Java PM required a long build and a GraalVM
JDK. This package speaks the same protocol natively against a local engine
distribution — fast to iterate on, no JVM needed.

## Subpath exports

Consumers import by subpath (see `package.json#exports`):

- `project-manager-shim` — public helpers (`findEnsoExecutable`,
  `findStdlibRoot`, …).
- `project-manager-shim/jvmAot` — the per-user JDK AOT cache (see below).
- `project-manager-shim/handler` — JSON-RPC request handler, and
  `acceptLocalRequest` / `checkLocalRequest` (`handler/localRequest.ts`): the
  one check both hosts (Electron's `server.ts`, the Vite middleware in
  `app/gui/project-manager-shim-middleware/`) run before serving a request. It
  refuses a `Host` other than a loopback name (plus a dev server's configured
  host) with the server's port, and an `/api/` request whose `Sec-Fetch-Site` is
  not `same-origin`/`none` or whose `Origin` is not the server's own. Requests
  with neither header (curl, scripts) pass. Every route this package serves over
  HTTP relies on it: none checks the caller itself.
- `project-manager-shim/localMetadata` — local labels and Recent store (see
  below).
- `project-manager-shim/localSecrets` — the encrypted local secrets file (see
  below).
- `project-manager-shim/localVersioning` — git-based versioning of local
  projects.
- `project-manager-shim/projectService` — project-lifecycle service.

## Finding the engine

`findEnsoExecutable` looks at `ENSO_ENGINE_PATH`, then at the caller's
`preferred` launcher (a Linux AppImage's copy, `EngineSettings.ensoExecutable`),
then next to the running executable (the packaged app), then under the
checkout's `built-distribution/` (`sbt buildEngineDistribution`). Nothing
downloads an engine (#359): a prebuilt one would not match the checkout, and the
fork's releases ship installers only. Dev mode (`dev:vite`) warns at start-up
when there is none, and fails the first project-service request with the same
message. The `ProjectService` tests skip without one; GUI CI on Linux gives them
develop's engine distribution artifact (`.github/workflows/gui-checks.yml`).

## Sample projects (`src/samples/`)

`LocalSamples` (Electron creates one with the bundle, `resources/samples`, and
passes it to the server) installs the samples shipped with the application in
`<projects>/Samples` and keeps them up to date. Nothing is downloaded (the old
`downloadSamples` fetched an unpinned upstream branch on every start).

- **First start** (`sync`, when `Samples` is missing): the whole bundle is
  copied to `.Samples.<pid>.tmp` with a manifest, `Samples/.samples.json`, and
  renamed into place, so an interrupted copy leaves no half-filled `Samples`. If
  that rename fails and removing the staging folder fails too (both on a lock),
  a later start removes `.Samples.<pid>.tmp` from the projects folder once
  `Samples` exists (`clearFailedInstalls`). The bundle's top-level `CLAUDE.md`
  is not copied: a dev run copies the source `samples/`, whose contributor notes
  the packaged app leaves out. Deleting the whole `Samples` folder therefore
  reinstalls every sample at the next start.
- **The manifest** (`{ version: 1, samples, data, files }`) records, for each
  sample (a bundle folder with a `package.yaml`) and each `Data/` file, the
  content hash it was installed with, or `null` when that is unknown. A sample's
  hash (`hashSample`) covers its files by relative path, but not hidden ones
  (the IDE's `.enso/`), not `output/` (what the sample writes), not
  `package.yaml`'s `labels` (the Drive writes them) and, for `.enso` files, only
  the code above `#### METADATA ####`, with line endings normalised
  (`ensoCodeForHash`): opening a sample makes the IDE rewrite its metadata (node
  positions, widget and visualisation state), and that is not an edit. An update
  still replaces the whole file, metadata included.
- **Hashing is cheap and never reads a file whole without need**: other files
  are hashed as a stream, so their size is no limit, and `files` caches each
  disk file's `size`, `mtimeMs` and hash (`FileHasher`), so a file whose size
  and time are unchanged is not read again. `sync` rewrites the cache; `status`
  only reads it. The bundle is hashed once per `LocalSamples`.
- **Only "no such file" means missing** (`ENOENT`, `ENOTDIR`). Anything else
  (`EACCES`, `EBUSY`, a folder where a file should be, a file that vanishes
  while it is read) makes the copy `Unreadable`: it is never overwritten, the
  start-up check logs it and moves on to the next sample, `status` reports it as
  `unreadable` and still reports the others, and an update keeps it as an edited
  copy before installing the bundle (never through version history).
- **Every later start** compares the bundle (B), the manifest (M) and the disk
  (D) for each sample and `Data/` file (`compareSample`, whose test lists every
  case): not on disk and not in the manifest, it is copied in (a new sample, or
  an install from before manifests); not on disk but in the manifest, the user
  deleted it and it stays deleted (Update Sample would bring it back, but a
  deleted sample has no row to start it from; deleting the whole `Samples`
  folder reinstalls everything); D = B is current; D = M, M ≠ B is unedited with
  a changed bundle and is replaced, keeping its `.enso/`, its `output/` files
  (the user's copy of a file the bundle also ships there wins) and its labels;
  otherwise it is edited and left alone, with an update when M ≠ B. **A copy the
  manifest has no record of** (an install from before manifests, whose samples
  read the old per-sample `data/`) that differs from the bundle is recorded as
  `null`: edited, with an update, never overwritten. Only the current bundle is
  known, so an old sample that was never edited counts as edited too. An edited
  `Data/` file whose bundle changed is kept with no sign in the Drive, and
  nothing replaces it.
- **A manifest from a newer version** (a `version` above 1, after a downgrade)
  is never rewritten: `sync` changes nothing and logs it, `status` reports only
  whether each sample is as bundled, and the updates refuse.
- **Changes are staged and renamed** (`.<name>.<pid>.tmp` beside the target; a
  replaced folder goes aside as `.<name>.<pid>.old` first, since a rename over a
  folder is not one step on Windows; a failed rename puts it back). The next
  start removes what an interrupted change left, moving an `.old` back when its
  target is missing. All of a `LocalSamples`' operations are serialised
  (`serialised`, keyed by the `Samples` folder), and the manifest and a
  `package.yaml` are written to a temporary file and renamed into place.
- **An open or opening project is never changed.** `sync` and the updates take
  an `isOpen`, which Electron answers with
  `ProjectService.isProjectOpenOrOpening` (from the moment `openProject` starts
  on a project, through the runner's loading and running projects, paths
  compared whatever their separators and, on Windows, case). They ask before a
  change and again just before its rename (after the user's `output/` has been
  copied, which can take a while); a sample found busy is a `SampleBusyError`,
  whose message says why (open, or the run marker's path). The other side waits
  too: `openProject` of a project in a `Samples` folder counts it as opening and
  then waits for the changes queued on that folder (`samplesSettled`), so an
  open never meets a half-done update. Opening a sample therefore waits for a
  queued sync or update to finish, a whole Update All included (a hung network
  share would hold the open with it).
- **Run markers** (`samples/runMarker.ts`). A headless `--startup.project` run
  takes no single-instance lock, so `runLocalProjectByPath` writes
  `<project>/.enso/run-<pid>.lock` (`{ pid, host }`, with this machine's time),
  rewrites it every 30 s (so one a reader deleted as stale comes back), removes
  it when the run ends and on SIGINT/SIGTERM (`removeOnSignals`, which then
  exits with 130/143), and the samples treat a project with a live marker as
  open. A marker is live when touched within 2 minutes, written on this host,
  and its pid is not known to be gone (`EPERM`, another user's process, is not
  known either way, so the heartbeat decides); any other marker is deleted when
  read, so a crash or a reused pid blocks nothing for long. An update never
  carries a marker into the new copy.
- **Update Sample** (`update(name, { isOpen, versioning, now })`) replaces a
  sample with its bundle. Nothing of the user's: a missing sample is copied in,
  one as bundled is refreshed (keeping `.enso/`, `output/` and labels). An
  edited one (it differs from the bundle) is kept, by one of two routes, decided
  per sample (`status` reports it as `route`, with the `copyName` the copy route
  would use and the `ignoredChanges` below, for the Drive's confirmation;
  `status` takes a `now`, as the updates do, so tests never depend on today's
  date):
  - **`version`**, when `LocalVersioning.isVersioned` says the sample's
    repository is enabled and usable (git installed, consent given, no merge in
    progress; the check the version history makes).
    `LocalVersioning.replaceAsVersion` runs under the repository's lock: it asks
    the open-sample check again first (`beforeSave`, so a sample opened
    meanwhile fails with `SampleBusyError` and no version is saved), commits the
    sample's uncommitted changes as `Saved before updating the sample`
    (`BEFORE_UPDATE_MESSAGE`), checks that nothing is left unsaved and that the
    sample has a version, then removes the files git tracks in it except its
    `output/` (not `.enso/`, not what git ignores, not the user's results),
    removes the folders that held only those files (a user's empty folder
    stays), copies the bundle in (the user's copy of a file the bundle ships in
    `output/` wins), puts the labels back, records the manifest, and commits
    `Updated sample <Name>`, with `Samples/.samples.json` when the repository
    tracks it (an untracked manifest is never added, and neither is one outside
    the sample's repository, as when the sample is a repository of its own). No
    `_edited_` copy. The files it hands over are under the sample's path as the
    IDE knows it, not git's spelling of the repository's path (another case on
    Windows, a junction or symbolic link, macOS's `/private/var`), so the checks
    after it compare like with like. If the first commit fails for any reason
    (an `index.lock`, a git error), the work tree has not changed: it throws
    `VersionSaveError`, and the sample falls back to the copy route, reported in
    `fellBack` with git's message. If anything after it fails, the work tree is
    put back as that commit (`restore --source=<commit> --staged`, then
    `--worktree`, as `restore` does, never `reset --hard`, and `clean -f -d` of
    only the paths the bundle ships, never `-x`, so an untracked file the user
    saved meanwhile stays), the manifest is written back as it was, and the
    error says the user's work is in the version
    `Saved before updating the sample`.
  - **A file git ignores is never overwritten silently.** It is in no version.
    When the bundle ships a file that exists in the sample with other content
    and git ignores it (`LocalVersioning.ignoredPaths`, `git check-ignore`), the
    sample takes the copy route: `status` lists those files in `ignoredChanges`
    (the confirmation says why), and the update reports them in `fellBack`.
    `replaceAsVersion` asks git again under the lock, before anything is saved
    (`protect`), so a refusal adds no version however often it is retried; and
    `replaceInPlace` checks once more, before it changes anything, for any
    changed file that is not in the saved version (ignored, or written
    meanwhile), and throws saying so.
  - **`copy`** otherwise (and for an unreadable sample): it is renamed to
    `<Name>_edited_<yyyy>_<mm>_<dd>` (then `_2`, `_3`, ...) beside it, with that
    name in its `package.yaml` too, and a fresh copy is installed. The date uses
    underscores because a project name allows only letters, digits and `_`. A
    copy whose `package.yaml` cannot be renamed is still kept, and is reported
    in `unrenamed` (the Drive tells the user to rename it); a file where a
    sample's folder should be has no `package.yaml` and is not reported. **This
    route does not tell local versioning**: it does not call `commitMove`, so in
    a versioned repository whose versioning is off the history stays on the
    sample's path, and the `_edited_` copy starts with none.

  Either way the manifest then records the bundle's hash, so the sample no
  longer has an update.

- **Update All** (`updateAll(...)`) updates, as above, every sample whose state
  is `updateAvailable` (an edited sample whose bundle changed, or an unedited
  one the next start would update) and no other: an edited sample with no
  update, a deleted sample and `Data/` files are left alone. It refuses when one
  of those samples is open, before changing anything; one that fails part way is
  reported in `failed`, and the rest are still updated and recorded. There is no
  Reset All any more (owner's ruling, #622). A sample's original comes back
  through Update Sample (any sample) or its version history; a deleted sample or
  `Data/` file only by renaming or deleting the `Samples` folder, which the next
  start reinstalls whole.
- **One process at a time.** The repository lock and `serialised` order the
  changes of one process only. A second process on the same projects folder (a
  dev server, an `ENSO_TEST` instance) can change the same sample at the same
  time; the single-instance lock keeps two IDEs apart, and this predates the
  updates.
- **Routes** (POST to `/api/project-service/samples/*`, served by
  `handler/projectService.ts` from the `LocalSamples` passed to
  `handleProjectServiceRequest` after `keyFromEnvironment`, with the host's
  `LocalVersioning`): `status` (each bundled sample's `name`, `path`, `state`:
  `current`, `edited`, `updateAvailable`, `missing` or `unreadable`, `route` and
  `copyName`, `ignoredChanges`, and the `Samples` `directory`, all with `/`),
  `update` `{ name }` and `update-all`, which answer
  `{ updated, versioned, kept, unrenamed, fellBack, failed }`. The updates
  refuse a sample the project service has open or opening. The Vite middleware
  has no `LocalSamples`, so under `dev:vite` the routes fail and the Drive shows
  no sample actions.

Tests: `src/samples/__tests__/installSamples.test.ts`, the version route with
real git in `src/samples/__tests__/updateSamples.test.ts` (30 s per test, as in
`localVersioning.test.ts`), the guards of `replaceAsVersion` (each of which a
mutation turns a test red) in
`localVersioning/__tests__/replaceAsVersion.test.ts`, the `samples routes` in
`handler/__tests__/projectService.test.ts`,
`projectService/__tests__/openOrOpening.test.ts` (with the wait on `Samples`)
and the run marker in `__tests__/runProjects.test.ts`.

## Scope

Historically some advanced features (multi-engine, upgrade) deferred to the old
Scala PM. Those paths now need to live here or be served by the language server
directly — don't add Scala-PM back-references when extending this package.

## Tests that start engines

Test files that start (fake) engines pass `firstPort` from
`projectService/__tests__/testPorts.ts`, never the default: each file has its
own band (parallel workers), and each run starts at a random port inside it
(another checkout's run at the same time). A new such file needs a band of its
own there. The bands are 2,000 ports wide and ten of them end at 29,000; an
eleventh, `spareOpen.test.ts`'s, is 7,000 to 8,000 (clear of 5173 and 8080).
Another needs the first band's start lowered, or a gap found the same way.

## Ports and the engine's health check

`EnsoRunner.openProject` probes for two free ports and then starts the engine,
so another program can take one in between. The engine's `/_health` answers a
bare `OK` with nothing that identifies it, so a lookalike answer cannot be told
apart; the runner relies on the engine's own failure instead. An engine that
exits while starting with a bind failure on stderr (`Address already in use`,
`BindException`, `EADDRINUSE`) makes the open probe again and start another
engine, up to `PORT_ATTEMPTS` (3) times; any other early exit fails the open
(#336). Not covered: another program that answers `/_health` with a success
before the engine has failed to bind. The start-up checks run every 25 ms for
the first second and every 250 ms after (Note [Start-up Health Polling] in
`ensoRunner.ts`). The limits come per launch from the engine mode's column
(`ENGINE_TIMEOUTS`, `engineTimeouts(mode)` in `projectService/timeouts.ts`):

| Limit                                   | Native | JVM engine |
| --------------------------------------- | -----: | ---------: |
| Start-up: `/_health` passed             |   30 s |      120 s |
| Terminate: exit after the stdin newline |   10 s |       30 s |
| ydoc port wait                          |    5 s |       30 s |

An engine that has not passed `/_health` within the start-up limit is killed.
`ENSO_ENGINE_STARTUP_TIMEOUT_MS` and `ENSO_ENGINE_TERMINATE_TIMEOUT_MS` override
both columns (the shim's own AOT training launch gets longer limits of its own).
A runner called without a launch (tests) keeps the native values.

`project/open` is also answered only once the engine's ydoc port accepts a
connection (`EnsoRunner`'s `ydocWaitMs`, per launch from the mode's column,
`DEFAULT_YDOC_WAIT_MS` only for a launch without a mode; Note [Open Waits For
The Ydoc Port]). The ydoc server listens ~300 ms after `/_health` passes, and a
GUI that connected earlier was refused (measured). That is consistent with
Windows retrying a refused loopback connect after ~500 ms (inferred from the
constant 510 to 525 ms gap). On Linux the GUI was refused too and connected only
on y-websocket's third retry, ~1.4 s after the answer, so the wait helps there
as well; the open-time harness hid it until `guiConnected` was changed to mean
the socket is open (Note [The GUI Is Connected When Its Socket Is Open] in
`app/electron-client/perf/openTimeReport.ts`). The ydoc server binds
`localhost`, which the JVM resolves to `127.0.0.1` (an IPv4-mapped address on
Linux), the address the probe and the GUI use. The wait is bounded, the startup
timeout stops applying once `/_health` has passed, and `EnsoRunner` defaults to
none, because the fake engines of the tests have no ydoc server
(`healthPolling.test.ts` has the one that does). Under the Node ydoc host (next
section) there is no wait: the listener is up before the engine is spawned.

The health checks, the ydoc polls and the startup timeout read the time and
schedule through a `StartupClock` (`EnsoRunner`'s `startupClock` option, the
real clock by default). Tests of that schedule replace it and assert the delays
the runner asks for, never real elapsed time: a fake engine is a separate Node
process whose start-up a loaded CI runner stretches unpredictably (Note
[Start-Up Tests Read The Schedule] in `healthPolling.test.ts`).

## ydoc host (`projectService/ydocHost.ts`)

An opened project's ydoc server runs in one of two places, chosen per open by
`ENSO_YDOC_HOST` (`ydocHostKind`; any case, an unknown value warns and means
`node`):

- `node` (default) — the runner's `YdocHost` (`EnsoRunner`'s `ydocHost` option,
  passed in as `EngineSettings.ydocHost`) `listen`s on the ydoc port **before**
  the engine is spawned, connected to the engine's Language Server channel
  sockets (`ws://127.0.0.1:<rpc port>/channel/<kind>?token=…`). The engine gets
  no `LANGUAGE_SERVER_YDOC_PORT`, so it starts no embedded server. The listener
  is closed by the `close-ydoc-listener` shutdown hook (after the engine has
  exited) and when an attempt fails. A listener whose port was taken after the
  search (`EADDRINUSE`) makes the open search again, like an engine's bind
  failure. Electron's host is a utility process
  (`app/electron-client/src/ydocHost/`), `dev:vite`'s is `NodeYdocHost` itself.
- `engine` — the one-release rollback (removed with the engine-hosted server, PR
  M of the JVM-by-default plan): the engine gets `LANGUAGE_SERVER_YDOC_PORT` and
  serves ydoc in GraalJS, as before. It also gets
  `LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS`, the host's `allowedOrigins()`
  comma-separated (empty without a host, so every browser page is refused;
  #614). A runner without a host (the tests' fakes, headless runs) behaves the
  same way.

Either way every engine start gets `LANGUAGE_SERVER_CHANNEL_TOKEN`
(`newChannelToken`, 32 random bytes as hex, fresh per open; a respawn keeps its
open's token). The Language Server refuses channel sockets without it, from a
non-loopback peer, or with an `Origin` header. Sessions in one host are keyed by
the GUI's `ls=` name, which is `gui-rpc-<random uuid>` per opened project in the
GUI, so two listeners in one process never share one
(`app/ydoc-server/CLAUDE.md`, "Sessions are process-global"). Tests:
`__tests__/ydocHost.test.ts`.

## Engine mode (`projectService/engineMode.ts`)

`ProjectService.openProject` and `runProject` resolve which engine a project
gets, the first match winning: the project's `package.yaml` `jvm: true|false`
(`readPackageJvmMode`; a non-boolean or malformed value is ignored, so
`jvm: false` now means native even when the default is JVM); Electron's
`--engine-mode=native|jvm` (`--jvm` is an alias; passed in as
`EngineSettings.option`); `ENSO_ENGINE_MODE=native|jvm` (an unknown value is
ignored); then `DEFAULT_ENGINE_MODE`, `jvm` since the switch (stage 3 of the
JVM-by-default plan, in #666; `ENSO_ENGINE_MODE=native` or `jvm: false` goes
back). The result (`ResolvedEngineMode`: mode and source) decides whether the
runner puts `--jvm` first in the engine's arguments and which timeout column
applies; both travel in the `EngineLaunch` that
`Runner.openProject`/`runProject` take. `--new`, `--version` and the filesystem
commands do not take a launch and stay native. The engine log panel's first line
is `Engine mode: <mode> (<source>)` (`EngineLogChannel.notice`, a `stderr` line
before any session).

A `--jvm` in `ENSO_ENGINE_ARGS` (a developer back door; the open-time harness
sets `ENSO_ENGINE_MODE` instead) is lifted into the `jvm` option by
`ProjectService.default` (`liftJvmFlag`): the log names `--engine-mode`, the JVM
limits apply, and a project's `jvm: false` still wins. Headless
`--startup.project` runs take `--engine-mode` too (`runLocalProjectByPath`'s
`engine`). Re-opening an open project writes no second mode line.

## Spare engine (`projectService/spareEngine.ts`)

A JVM engine started with `--standby` while no project is open (spec
`docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`; engine side in
engine/runner CLAUDE.md, "Standby mode"). `EnsoRunner` owns one `SpareEngine`
(`startSpare`, `stopSpare`, `spareAvailableAgain`, `spareAlive`, `spareState`,
`sparePid`).

- **The take.** An open whose `EngineLaunch` has a `spareKey` takes a spare
  started with the same key, on its first attempt only; a spare with another key
  is stopped, and the open spawns as before. The open's log gets one
  `Engine: pre-started spare used (…)` or `Engine: no pre-started spare (…)`
  line (`EngineLogSink.notice`); an open without a key leaves the spare alone
  and says nothing. When no spare was running, the line gives the service's
  reason (`EngineLaunch.spareIdleReason`, the last decision's), and there is no
  line at all when spares are off (the setting, `ENSO_SPARE_ENGINE=0`). Under an
  engine-hosted ydoc server with allowed origins there is no spare (the line
  cannot carry them).
- **The line.** The spare gets `{"args":[...],"env":{...}}` on stdin: the open's
  arguments from `--server` on (never `--jvm`, which the engine refuses there),
  and in `env` only the four `LINE_VARIABLES` (channel token, ydoc port under an
  engine-hosted ydoc server, project id and session id). Everything else, the
  secrets key included, is in the spare's spawn environment, which never carries
  a line variable or `LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS` (`spareSpawnEnv`;
  the engine exits 1 on an inherited one). The line holds the token: it is never
  logged.
- **Stderr.** `take()` stops reading the spare's stderr; `OpenedProject`
  attaches its reader in microtasks of the same turn (its spawner hands the
  spare over), so nothing may be awaited between the take and
  `OpenedProject.create`.
- **Timeouts.** A spare taken while still warming up gets
  `SPARE_WARM_UP_LIMIT_MS` (60 s, when the engine abandons a warm-up) on top of
  the startup limit, for that engine only.
- **Failure.** A taken spare that exits or times out before its health check
  makes the open try again with an ordinary engine (and a second notice line);
  that try does not use up one of the `PORT_ATTEMPTS`. A respawn after the open
  is always an ordinary spawn. The worst case is a spare still warming up that
  never starts: ~300 s (the JVM's 120 s startup limit plus the 60 s warm-up
  limit, then up to 120 s for an ordinary engine) before the open is answered.
- **Kills.** An engine that misses its startup limit, and one that does not stop
  in time on close, is killed with its process tree (`killTree`): under a `.bat`
  launcher killing `cmd.exe` alone would leave the engine running beside the one
  that replaces it.
- **Stop.** `stop` closes the spare's stdin, on which it exits by itself; one
  still running after `SPARE_STOP_GRACE_MS` (10 s, an `unref`'d timer) is killed
  with its tree. A quit cannot rely on that timer, since the process exits
  first: `stopSpare(reason, { waitMs })` (`ProjectService.stopSpareEngine`)
  waits up to `waitMs` for the spare, and any stopped one still exiting, kills
  the trees of those left and waits up to 1 s more. Electron uses it with 5 s on
  every quit and before an update installs (electron-client CLAUDE.md).
- `hasProjectsInUse` (loading or running, not counting a project whose close has
  begun) is what the service asks before starting the next spare.

**When the service wants one** (`ProjectService.refreshSpare`, decisions one at
a time on a queue). None until the GUI's first `setSpareEngine` (the setting;
POST `/api/project-service/engine/setSpare` `{ enabled: boolean }` answers
`{ engineMode }`, a non-boolean `enabled` is an error; clients:
`ProjectManager.setSpareEngine`, `LocalBackend.setSpareEngine`); then a spare is
wanted unless, in this order: quitting (`stopSpareEngine`, for good), the
setting is off, `ENSO_SPARE_ENGINE=0`, the default engine
(`resolveDefaultEngineMode`) is native, `ENSO_YDOC_HOST=engine`, the AOT cache
is training (`JvmAotCache.isTraining`: from its launch check until a cache is
made, one waiting to begin included; Electron refreshes after `start()` and when
`onTrainingEnded` says a training finished or failed, not when an open stopped
it), `--profiling-path` is among the extra arguments (a relative path, which
standby refuses), a project is opening, or a project is in use. An unwanted
spare is stopped with that reason, except for an opening project, which takes
the spare or stops it itself. The refresh runs on `setSpareEngine`, after a
failed open (once it no longer counts as opening), and after a close, once the
closing engine has exited or `SPARE_AFTER_CLOSE_MS` (2 s,
`EngineSettings.spareAfterCloseMs`, an `unref`'d timer) has passed, whichever is
first. A native open stops the spare. When a close's engine takes longer than 2
s to exit, a spare starts 2 s into the close (the gate's delay), beside the
closing engine; reopening the project then takes it if its key matches. A quit
that is cancelled after the spare was stopped (`stopSpareEngine` is for good)
leaves no spare for the rest of the session.

- **No spare beside an open.** `openProject` counts itself (`opensInFlight`,
  `opensStarted`) from its first line, before any await. The decision to start
  is made after the refresh's last await (the AOT options, then the runner's
  `hasProjectsInUse`), with nothing awaited before `startSpare`: a quit, an open
  in flight, any open started since the refresh began, or an AOT training that
  began meanwhile means no spare. A spare whose start failed is tried again
  (`spareAvailableAgain`) only by the refresh after a close, and only when that
  refresh starts one.
- **The key** (`spareKeyFor`): mode, the service's extra arguments, the AOT
  options, the extra environment (the secrets key) and `ENSO_JVM_OPTIONS`. A JVM
  open computes it from the same inputs, so with the same settings it takes the
  spare; its own engine logging (`--vm.D`) and the line variables travel in the
  line and are not part of it. Engine mode, log level and `ENSO_ENGINE_ARGS`
  change only at launch, so a changed input (a rotated secrets key, a new AOT
  cache) is caught by the key at the take, which stops the stale spare.

Tests: `__tests__/spareEngine.test.ts`, `__tests__/spareOpen.test.ts` (with the
service, `through the service`) and `__tests__/spareService.test.ts` (the
decisions, with a recording runner), with the fake engine
`__tests__/fakeSpareEngine.ts`.

## JDK AOT cache (`src/jvmAot/`)

A JVM engine starts faster with a JDK AOT cache (JEP 483/514). A cache records
the module path and the runtime it was trained with, and no platform installs
the IDE at a fixed path, so it cannot ship in the installer: each user trains
their own (spec `docs/superpowers/specs/2026-11-03-jvm-by-default-design.md`,
stage 1d). A cache built elsewhere and copied in is refused even behind a
directory junction at a fixed path, since the JVM resolves the real path
(measured 2026-11-11, #668). On Windows the installer trains it (`trainNow`,
below); elsewhere the IDE does, at launch. `JvmAotCache` (`index.ts`) owns its
lifecycle; Electron creates one in `app/electron-client/src/projectService.ts`
and passes it to the `ProjectService` as `EngineSettings.jvmAot`. The Vite dev
server has none.

- **Key** (`key.ts`): the first 16 hex digits of SHA-256 over the app version,
  the real path of the engine distribution (`dist/<version>`), the bundled
  runtime (the one directory under `<root>/runtime/`) and the text of the
  engine's `jvm.options`. The cache is `<userData>/jvm-aot/<key>/enso.aot`
  (`ENSO_JVM_AOT_DIR` replaces `<userData>/jvm-aot`). No runtime (a development
  build), a macOS `AppTranslocation/` path or a Linux AppImage mount
  (`/.mount_<random>/`, `isAppImageMount`): no key, so nothing is trained or
  used.
- **Training** (`trainer.ts`, `driver.ts`): `start()`, called once the window is
  up, decides at once (so the spare engine is held back and the toast shows) and
  begins the training `startDelayMs` (10 s) later, so it does not compete with
  the IDE's own start-up (#670). `trainNow()` trains at once and resolves with
  `trained`, `failed` or `skipped` (nothing to do, or another process holds the
  lock); Electron's `--train-jvm-aot` uses it, at `trainingPriority: 'normal'`.
  A training runs only when the JVM is the resolved default
  (`resolveDefaultEngineMode`, so nothing happens while the default is native),
  there is no cache for the key and no other process holds `<root>/train.lock`
  (`lock.ts`: created exclusively with the pid and a random token, and touched
  every minute; a lock whose pid is dead, or that has not been touched for 10
  minutes, since pids are reused, is taken over. A takeover, a heartbeat and a
  release run only while holding `train.lock.takeover`, created exclusively, so
  a stale lock is removed in place, never moved aside and put back, and no
  takeover can land between a holder's token check and its touch or delete (Note
  [Takeovers Are Serialised], #603). A taker that finds the takeover file held
  gives up; a release retries for 2 s and then leaves its lock. A takeover file
  is stale when its pid is dead or after 30 s, since it is held for
  milliseconds. Both files are written under a unique name and hard-linked into
  place, so neither is ever seen empty (Note [A Lock File Appears Complete]).
  `.stale-` asides left by earlier versions, and `.new-` files a crash left, are
  deleted once older than 10 minutes). `EngineTrainer` makes a scratch project
  with `enso --new` (native, the welcome template) in
  `<root>/enso-aot-training/`, starts `enso --jvm --server` on it at
  below-normal priority (`os.setPriority`; `normal` for the installer) with
  `ENSO_JVM_OPTIONS` adding `-XX:AOTMode=record` and
  `-XX:AOTConfiguration=<key>/enso.aot.aotconf`, a fresh
  `LANGUAGE_SERVER_CHANNEL_TOKEN` and no `LANGUAGE_SERVER_YDOC_PORT`, waits for
  `/_health` (180 s), and `driveOpen` plays an open over the Language Server's
  channel sockets (`/channel/{json,vis-control,vis-data}?token=`):
  `session/initProtocolConnection`, `executionContext/create` and `push` of
  `main`, an `attach` of the table visualisation to the node the template's
  metadata shows one for (`welcomeNodeId`), then waits for `executionComplete`
  and the visualisation's answer. Then the stdin newline, up to 5 minutes for
  the JVM to write the configuration and exit, and the bundled `java` creates
  the cache (`aotCreateArguments`: the launcher's fixed options, the
  `jvm.options` lines, an inherited `ENSO_JVM_OPTIONS`) as `.tmp`, renamed into
  place. A finished training keeps its own key directory and the most recently
  used other one (two installs sharing `userData` would otherwise delete each
  other's cache at every launch) and deletes older ones; it only ever deletes
  directories named like a key (16 hex digits), since `ENSO_JVM_AOT_DIR` may
  name a directory holding other things. A failed training (not an abort) leaves
  no `enso.aot` and is not retried until the next launch. While another process
  holds the lock, the cache tries again every `retrainDelayMs` (60 s) and stays
  `isTraining` until that process's cache appears (or it gets the lock and
  trains itself); a lock that cannot be taken at all (an error) counts as a
  failed training. `start()` calls `onTrainingStarted` once it has found that a
  training is due (never when the cache is there); a finished or failed
  training, and a cache found made by another process, call `onTrainingEnded`
  with `trained` or `failed` (Electron refreshes the spare engine and tells the
  GUI, which shows a toast meanwhile). A training that throws while it starts (a
  lock release that fails) ends as `failed` too (`startFailed`). While another
  process holds `train.lock`, this window shows the training toast as well, and
  reports `trained` up to 60 s (`retrainDelayMs`) after the other process
  finishes. `dispose()` (Electron's `before-quit`) aborts a running training
  before it awaits anything, which kills its engine or `java` at once; the
  `.tmp` and `.aotconf` such a quit can leave are deleted by the next `start()`.
  Three things measured on the Windows bundle shaped this (Notes in `driver.ts`
  and `trainer.ts`):
  - `/_health` passes while the Language Server is still initialising, and a
    channel socket opened then is dropped (`1006`): the driver reconnects once a
    second until the session is initialised (a `403` fails at once).
  - With no visualisation attached, `executionComplete` never came; the GUI
    attaches as it connects, and so does the driver.
  - JEP 514's one-step `-XX:AOTCacheOutput=` fails: its forked child JVM lacks
    the JNI-started JVM's modules (`jdk.internal.vm.ci`), hence record, then
    create with `java`, as the open-time harness once did before it measured
    this cache.
- **Yielding**: `ProjectService.openProject` calls `openStarted()` before the
  engine starts (any mode) and `openAnswered()` after the answer, a failure
  included. A training not yet begun waits until 60 s after the last open in
  flight was answered; a running one goes on through opens, at below-normal
  priority (#669: an open used to kill it, so a user who opened projects every
  minute or two never got a cache). Measured on the Windows bundle (2026-11-11),
  a training takes 42 to 47 s at normal priority at 2, 4, 8 or 32 CPUs: the
  JVM's start in record mode (~15 s) and the driven open (~16 to 19 s) dominate,
  so the ~110 s seen in the IDE was the low priority competing with its
  start-up, not the CPU count.
- **Use**: a JVM open or run gets `jvmOptions()` in its launch, two options,
  `-XX:AOTCache=<key>/enso.aot` and
  `-Xlog:aot=warning,cds=warning:file="<key>/use.log"::filecount=0` (the path
  quoted, so the `:` of `C:` does not end the option; no rotation, so one log
  rewritten by each JVM: checked on the bundled JDK, its mtime moves at every
  start even when it stays empty), when the cache exists. The log's time is the
  key's "last used"; without a log, `enso.aot`'s. `AOTMode` stays `auto`, so a
  cache the JVM refuses costs only its benefit. After such an open
  `checkUseLog()` deletes the cache when `use.log` has a line `aotRejection`
  (`useLog.ts`) matches; it retrains at the next launch.
- **`ENSO_JVM_OPTIONS`** is built by `jvmOptionsValue`
  (`projectService/jvmOptions.ts`, which also holds `LAUNCHER_JVM_OPTIONS`,
  `parseJvmOptionsFile` and `aotCreateArguments`): an inherited value is split
  as the launcher splits it (lines if it has a newline, else whitespace) and the
  shim's options follow one per line; a single option gets a trailing newline,
  so that the launcher reads it as a line and a space in its path survives.
- **Known limits**: `os.setPriority` lowers the launcher's process; on Linux,
  where priority is per thread, threads the JVM created before the call keep
  normal priority. Two JVM engines open at once share `use.log`. Any `[warning]`
  from `aot`/`cds` deletes the cache, so a benign warning that recurs would
  retrain at every launch (none seen so far). A Linux AppImage's first launch of
  a build has no cache (next bullet).
- **Linux AppImage** (`stableEngine.ts`, Note [The AppImage Engine Is Copied
  Out]): an AppImage mounts at a new `/tmp/.mount_<random>` at every launch (and
  `--appimage-extract-and-run` extracts to a `/tmp/appimage_extracted_<hash>/`
  that it deletes; `isAppImageMount` covers both), and the JVM refuses a cache
  whose module path moved (`shared class paths mismatch`). A symlink at a fixed
  path does not help, because the native launcher resolves its own executable,
  so the JVM still sees the mount's paths (experiment X1 of the plan, measured
  on WSLg; discussion #518). So the IDE runs a copy of the bundle:
  `stableEnginePath` copies `resources/enso` (`.enso.bundle`, without which the
  launcher does not find the bundled runtime, `dist/`, `runtime/`: ~1.8 GB, ~15
  s with `fs.cp` on an NVMe disk under WSL) to `<userData>/engine/<version>/`,
  times kept, through a temporary directory renamed into place with a
  `.complete` file written last that holds a fingerprint of the bundle (the
  launcher's and `runtime.jar`'s size and mtime, the runtime's name; a dev build
  keeps its version, so the fingerprint decides).
  - **Only when the JVM is the default engine** (Electron's `appImageEngine`
    checks `isJvmDefaultEngine`): while it is native, an AppImage copies nothing
    and uses no disk.
  - **Room first**: the copy needs the bundle's size plus 1 GiB or 20%,
    whichever is more (`fs.statfs`); short of that it deletes the other copies
    and looks again, then gives up. A failed copy is deleted at once (a
    read-only directory is made writable and the delete retried) and recorded in
    `<userData>/engine/.failed.json` (fingerprint, time, reason); that build is
    not tried again for a day. A success deletes the record.
  - **Clean-up**: a copy also deletes leftover temporary directories and other
    versions' copies except the most recently used one (the marker is touched at
    each use), but never a copy holding a running process's executable
    (`/proc/<pid>/exe`; an engine left by a crashed IDE).
  - **Wiring**: Electron (`appImageEngine` in
    `app/electron-client/src/jvmAotSettings.ts`), when `APPIMAGE` is set and
    `ENSO_ENGINE_PATH` is not (one inside `<userData>/engine/` is not the user's
    but an earlier IDE's copy, inherited through an update's relaunch:
    `prepareAppImageEngine` drops it, `isEngineCopyPath`), passes a complete
    copy's launcher as `EngineSettings.ensoExecutable` (and to
    `findEnsoExecutable`'s `preferred` for the cache) before the project service
    and the cache are created. It is never put in the environment: an in-app
    update relaunches the new AppImage with the old process's environment, which
    would make the new version run the old version's copy. With no complete
    copy, that launch runs the mounted engine with no cache and starts the copy
    once the first open has been answered (`EngineSettings.openObserver`; or a
    minute after the window loaded with no open, never while one is in flight),
    so that the copy does not compete with that open for the AppImage's mount;
    the cache trains from the next launch on. If the copy cannot be made, the
    AppImage runs the JVM with CDS only, the spec's accepted fallback.
- **Tests**: `jvmAot/__tests__/` — `key`, `lock`, `driver` (against
  `fakeLanguageServer.ts`), `trainer` (a fake `enso` script that imports the
  same fake, port band `JVM_AOT_TRAINER_PORT`), `cache` (a fake trainer and fake
  timers) and `stableEngine` (a fake bundle in a temp tree, with hooks for free
  space, running processes and the copy); `findEnsoExecutable.test.ts` the
  order; `projectService/__tests__/jvmAot.test.ts` covers the service's calls.

## Child processes

Always attach an `'error'` listener to a child's stdin (`EnsoRunner` does at
spawn): a write to an exited child fails asynchronously with `EPIPE`, and with
no listener that is an unhandled error that fails vitest runs and can crash the
Electron main process (#401).

To kill a child together with what it started, use `killTree`
(`src/childProcess/killTree.ts`): on Windows a `.bat` launcher runs under
`cmd.exe`, and killing `cmd.exe` alone orphans the engine (`taskkill /T /F`
there, `SIGKILL` elsewhere). The AOT trainer and the spare engine
(`projectService/spareEngine.ts`, which first closes the spare's stdin and kills
only after `SPARE_STOP_GRACE_MS`, 10 s) use it.

## A second project's engine start on Windows (measured, no fix)

The project-open performance spec expected a Windows engine start of ~780 ms for
the second project of a session. The open-time harness (release build
2026.1.1-rc.1, native engine, `core` template, 10 launches, Windows 11) does not
show it: `engineUp` (click to the launcher's first output) has a median of 171
ms for the first open and **130 ms for the second**, and `lsReady` 227 / 192 ms.
The second is faster at the median (the first pays for cold file caches) and by
the mean it is 94 ms slower (164 vs 258 ms), under the 150 ms bar for tracing
it. The same Windows build's earlier 5-launch run gave 159 / 114 ms.

What is real is intermittent: 3 of the 10 second opens took 414 to 652 ms
(`engineUp`), the other seven 109 to 223 ms; the first opens stayed within 136
to 199 ms. Those slow ones are about 300 to 500 ms later than the rest. The
cause was not traced (the stage timing in `EnsoRunner` was not instrumented,
since the median does not call for a fix); the candidates are the first
project's engine still shutting down while the second is spawned (the port
search steps over its ports) and antivirus scanning of the launcher after a
recent run. If a future report shows a consistently slow second open, instrument
`EnsoRunner.openProject` (before `loadingProjects`, around `findServerPorts`,
before `spawn`, at the child's `spawn` event) and `OpenedProject.close` around
`gracefulShutdown` to split it before changing anything. Reproduce with
`perf:open --runs 10` (`app/electron-client/CLAUDE.md`, "Open-time harness").

## Local secrets (`src/localSecrets/`)

`LocalSecrets` is the Node side of `~/.enso/secrets.json` (`ENSO_SECRETS_FILE`
overrides), byte-for-byte compatible with the engine's Java `LocalSecretStore`.
The format, crypto (AES-256-GCM, AAD = name), lock file (`<file>.lock`) and
error kinds are specified in
`docs/superpowers/specs/2026-10-18-local-secrets-design.md`; the fixtures in
`test/fixtures/local-secrets/` pin the compatibility in both directions.

- It never returns a decrypted value. `readValueForTests` (in `crypto.ts`, not
  re-exported) is for tests only.
- Writes take the in-process `serialised` queue and the cross-process lock file,
  re-read inside the lock, and write `<file>.tmp` then rename.
- `rotate(oldKey, newKey)` (Electron main only) decrypts everything before
  writing anything, under one hold of the lock; a wrong old key is `WRONG_KEY`
  with the file untouched.
- `EnsoRunner.hasRunningProjects()` counts opened projects (loading included)
  and live `--run` processes; key rotation and reset wait for it to be false.
- `update` and `delete` with no file at all answer `NOT_FOUND` before taking the
  lock, which would create the directory and a transient lock file.
- Bad names throw a plain `Error`; the store's own failures are
  `LocalSecretsError` with a `kind`.

## Local metadata (`src/localMetadata/`)

`LocalMetadata` keeps what the local drive needs beyond the filesystem:

- `<userData>/labels.json` — label definitions,
  `{ version: 1, labels: Label[], deletedNames?: string[] }`. `deletedNames` are
  tombstones: a name on a project counts while it is a live label, is ignored
  while it is a tombstone, and is otherwise (a project from another machine)
  added as a new label when read.
- `<userData>/recent.json` — recently opened projects,
  `{ version: 1, entries: [{ path, projectId, openedAt }] }`, newest first, at
  most 20, unique by project UUID. Reads hide entries whose `project.json` `id`
  no longer matches; `recordRecent` prunes them.
- A project's labels — an optional `labels: string[]` in its `package.yaml` (the
  engine preserves the key), read and written by `localMetadata/packageYaml.ts`.
  `readProjectLabels` moves labels that earlier versions wrote to
  `.enso/project.json` into `package.yaml` (whose own labels win) and strips
  them from `project.json`.

`<userData>` is Electron's `app.getPath('userData')` in the app
(`app/electron-client/src/projectService.ts`), and `ENSO_DEV_USER_DATA_DIR` or
`app/gui/.dev-profile/userData` under the Vite middleware.

Rules worth keeping:

- **Write `project.json` only through `localMetadata/jsonFile.ts`**
  (`updateJsonFile`), which serialises writers per path and renames a temporary
  file into place. A plain `writeFile` of a fresh object drops `lastOpened`
  written by someone else.
- Rename a temporary file over an existing one with `renameWithRetry`, not a
  bare `fs.rename`. On Windows, real-time virus scanning holds a file it has
  just seen written for about a second, and a rename over it fails with `EPERM`
  meanwhile; the helper retries `EPERM`/`EACCES`/`EBUSY` for up to 5 s (#275).
  The same goes for a folder: Windows refuses to rename one while another
  process has any file in it open, and a virus scanner opens the files of a
  folder just filled. On CI's Windows runners, under `%TEMP%`, a bare rename of
  a folder inside one that had just been renamed into place failed with `EPERM`
  in a sizeable share of attempts (each lock gone within milliseconds); the same
  steps elsewhere on the disk never failed, and a rerun on a developer machine
  gave no failures at all, so how often it happens depends on the machine and
  its scanner. `installAll`'s rename of the staged `Samples` uses the helper for
  this reason, and a test that renames such a folder itself retries too (#622).
- A corrupt or newer `labels.json`/`recent.json` is renamed to
  `<name>.corrupt-<ts>`/`<name>.newer-<ts>` and treated as empty. A corrupt
  `project.json` is never moved: that would cost the project its UUID.
- Recent follows the shim's own changes: the generic `--filesystem-move-from`
  and `--filesystem-delete` commands rewrite or forget entries by path prefix
  (they also move whole folders), and `ProjectService` reports `project/rename`
  and `project/delete` by UUID through `ProjectLifecycleListener`.
- The endpoints are `labels/{list,create,delete}`, `project/set-labels` and
  `recent/{list,record,forget}` under `/api/project-service/`. Hosts pass the
  store to `handleProjectServiceRequest` and `handleFilesystemCommand`; without
  it, the routes answer with a JSON-RPC error and listings carry no labels.

## Local versioning (`src/localVersioning/`)

`LocalVersioning` stores snapshots of local projects as git commits, using the
user's own git CLI. Projects inside the same repository share its history, but
every commit is scoped to its own paths — changes to project A are never
recorded with project B's, and a change the user staged by hand elsewhere is
neither committed nor unstaged.

### Module and routes

- `src/localVersioning/index.ts`: `LocalVersioning` (constructed with a
  `VersioningConsent`) with `status`, `init`, `enable`, `disable`, `commit`,
  `commitIfEnabled`, `log`, `fileAt`, `setComment`, `restore`, `exportAt`,
  `commitMove`, `isVersioned`, `ignoredPaths` and `replaceAsVersion` (the
  samples' version route, see "Sample projects"), and the lookup `repositoryOf`.
- `src/localVersioning/consent.ts`: `VersioningConsent`, the persisted record of
  enabled repositories (see _Consent_ below).
- `src/localVersioning/git.ts`: `findGit`, `runGit`, `findRepoRoot`,
  `repositoryKey`, `identityArgs` (see _Identity fallback_ below).
- Routes (POST to `/api/project-service/versioning/*`): `status`, `init`,
  `enable`, `disable`, `enable-if-inside`, `commit`, `commit-if-enabled` (the
  close hook's `commitIfEnabled`, for a version the IDE saves before changing a
  project itself, such as an edition switch), `log`, `file-at`, `restore`,
  `duplicate-at`, `set-comment`. `enableIfInside(repoRoot, rootPath)` enables a
  repository whose root is the GUI's local root or inside it, comparing
  `repositoryKey`s (real paths), unless the user opted out of it. See
  `handler/projectService.ts` for request/response shapes. `commit` with an
  empty or whitespace-only `message` saves as `Saved`. The `restore` route (not
  `LocalVersioning.restore`) refuses a running project.

### Consent: a repository is versioned only once it is enabled

`findRepoRoot` finds _any_ enclosing repository: a dotfiles repo in the user's
home, a work monorepo above the projects folder. Committing to it unasked would
put "Saved on close" commits on whatever branch is checked out. So the shim
versions a repository only once it is _enabled_.

- Consent is a per-repository record in `<userData>/versioning.json`
  (`{ version: 1, enabledRepositories: [...], disabledRepositories?: [...] }`,
  written by `VersioningConsent` through the `jsonFile.ts` helpers, so a corrupt
  or newer file, or one whose lists are not lists, is moved aside and read as
  empty, as for `labels.json`; an entry that is not a string is dropped alone,
  so the others keep their consent). It is never written into the user's
  repository or git configuration. Repositories are compared by real path,
  lowercased on Windows (`repositoryKey`, which the operation lock uses too).
- `disable` records an opt-out (`disabledRepositories` in `versioning.json`,
  still version 1); only `enable` clears it; `status` reports `optedOut`.
  `enableIfInside` never re-enables an opted-out repository.
- Hosts construct `LocalVersioning` with a store in `<userData>` (Electron:
  `app.getPath('userData')`; dev middleware: `DEV_USER_DATA_DIRECTORY`). A
  `LocalVersioning` without one must not exist outside tests.
- `status` reports `enabled` (`false` with no git or repository); `changed`,
  `lastVersion` and `blocked` are computed regardless, so the GUI can show a
  prompt. `init` enables the repository it creates. `enable(repoRoot)` rejects a
  path that is not a repository root.
- Not enabled: the close hook (`commitIfEnabled`) and `commitMove` skip silently
  (no warning); `commit`, `restore` and `setComment` reject with
  `Versioning is not enabled for the repository at <repoRoot>.`. `log`, `fileAt`
  and `exportAt` change nothing in the repository and work regardless.
- The check runs inside the locked operation, through `this.consent` (never a
  public locked method).

### Serialisation: an operation lock and a call queue

- **Operation lock.** Each public operation (`status`, `commit`, `log`,
  `fileAt`, `setComment`, `restore`, `exportAt`, `commitMove`) holds its
  repository's lock from its first git call to its last, so a commit's several
  calls, and the `rev-parse HEAD` that gives its id, never interleave with
  another operation; reads take it too, for a consistent snapshot. The lock is
  keyed by the repository's real path and shared by all instances. Operations
  call only the unlocked `…In` helpers (`restore` → `commitIn`, `setComment` →
  `logIn`), never a public method, so they cannot wait on themselves. A failing
  operation releases the lock.
- **Call queue.** Every git call also goes through
  `runGit(cwd, args, { queueKey: repoRoot })`, which runs one call per
  repository at a time, FIFO. Queues drain themselves; a failing call does not
  block later ones.

Both only order the IDE's own calls. The user's git, run at the same time, can
still hit `index.lock`; such a failure is reported (`blocked`, or a rejected
commit), never retried silently.

### How git is run

`runGit` adds `-c core.quotepath=false`, `GIT_TERMINAL_PROMPT=0` and
`GIT_OPTIONAL_LOCKS=0` (read-only commands such as `status` must not take the
index lock just to refresh it; commands that change the index take it anyway),
and drops inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`,
`GIT_NAMESPACE` and `GIT_PREFIX` (a caller's own `env`, such as `exportAt`'s
`GIT_INDEX_FILE`, still applies). `findGit` caches only a git it found, so
installing git while the IDE runs needs no restart.

**Every path from data reaches git as a literal pathspec**: `literal(p)` gives
`:(literal)<p>`, `excludeEnso(p)` gives `:(exclude,literal)<p>/.enso`, and
`projectPathspecs(p)` is the pair, used by `status`, `log`, `add`, `reset`,
`diff`, `commit`, `restore`, `rm`, `clean`, `ls-files` and `ls-tree`. A plain
pathspec would read `*`, `?` and `[` in a folder name as a glob, matching a
sibling (`P [x]` matches a file `P x`) — and `clean` would delete it.
`GIT_LITERAL_PATHSPECS=1` is no alternative: it disables the exclude magic too.
`<id>:<path>` revisions are not pathspecs, and are resolved (`cat-file -e`)
before use.

### Version ids

`fileAt`, `setComment`, `restore` and `exportAt` accept only a full commit hash
(40 or 64 lowercase hex digits), so nothing from a caller can reach git as an
option (`--output=…`) or a revision expression (`HEAD~1`); abbreviated ids are
rejected. `setComment`, `restore` and `exportAt` also check the id is in the
project's own `log`.

### Identity fallback

`identityArgs` tries `git var GIT_AUTHOR_IDENT`. If git has no identity (a
minimal config), commits and notes use `-c` overrides for
`Enso IDE <ide@localhost>`; nothing is written to the user's config. When git
does resolve an identity (`user.name`/`user.email`, or the environment), commits
use it and no override is passed.

### Ignore lines

`init` appends two lines to the root `.gitignore`, unless a `**/.enso/` line is
already there (then the file is left alone, even without `*.bak`):

- `**/.enso/` — the IDE-generated project metadata (id, GUI settings).
- `*.bak` — editor and backup files, ignored by convention.

A repository's `.gitignore` is otherwise never touched. **The `.enso/` folder is
excluded from every commit independently of `.gitignore`**, via pathspec, so it
is never versioned even in a repository that tracks it.

### Notes reference

Comments on versions are git notes under `refs/notes/enso`. Each commit has at
most one; `setComment` overwrites it. `log` shows the note, else the commit
message without any `Enso-Moved-From` trailer. An empty comment removes the note
(`notes remove`, with the identity fallback).

### Close hook and moves

`ProjectService.openProject` registers a `'version-on-close'` shutdown hook
before any rename hook, so a project is saved before its directory moves. The
runner runs shutdown hooks in registration order, and `remove-from-list` is
registered first (when the engine starts), so the project is no longer listed as
running while its close commit is made. The hook commits the project as
`Saved on close` if it changed and the repository is enabled; a failure is
logged and returned as `versioningWarning` on the `closeProject` result, and the
close still succeeds.

A rename (`renameProject`) or a filesystem move of a project directory commits
both paths together (`commitMove`), with an `Enso-Moved-From: <old path>`
trailer (repository-relative). `log` follows it, reading the commits at the
current path newest first up to the first one with a trailer:

- a trailer naming another path is a move _in_: that commit is listed, and the
  commits before it at the old path follow (at most 100 moves), so A → B → A
  lists all three stretches, and a reused name (B deleted, A renamed to B) shows
  A's history, not the deleted B's;
- a trailer naming the current path is a move _away_ by an earlier project:
  neither it nor anything older at that path is listed.

A trailer path that is not plain and repository-relative (absolute, with
empty/`.`/`..` segments, starting with `:` or `-`, or containing `\`) is
ignored, since anyone can write a commit message. Glob characters are allowed
(folders such as `Projects [2026]` are real): every pathspec is literal, see
_How git is run_. A project at the repository root never follows trailers; as
`git log -- .` lists every commit, its history starts at the commit that last
added the root `package.yaml`.

`fileAt`, `exportAt` and `restore` use the path the project had at the version,
and resolve `<id>:<path>` (`cat-file -e`) before using it, so a missing path
fails as such. A restore across a move replaces the current path's files with
the old path's tree (`rm --cached`, `read-tree --prefix`, `restore --worktree`,
`clean`). Every precondition is checked before the work tree or index changes;
if a step still fails, the index is reset to `HEAD` for the project (no deletion
stays staged).

### Renames by case only

On a file system that ignores case (Windows, macOS; git's `core.ignorecase`),
`Data/Sales.csv` and `data/sales.csv` are one file, and git keeps whichever
spelling its index has: `add -A` never records a rename by case, and
`git commit -- <paths>` re-adds the paths under `HEAD`'s spelling or refuses the
new one as an alias (`will not add file alias`). So (#641):

- Only where `core.ignorecase` is set (asked once per repository), `commitIn`
  first drops from the index the project's files that are on disk under another
  case (`unstageCaseRenames`, using `spellingsOnDisk` from `src/fileCase.ts`),
  so `add -A` adds them under the disk's spelling, then `add -f`s those
  spellings (they were tracked, so one an ignore rule matches stays tracked);
  and when the index then stages a file of `HEAD` under another case (two staged
  names that differ only in case, `hasCaseAliases`), it commits through a
  temporary index (`HEAD` plus the index's entries for the paths,
  `commitStaged`) instead of `git commit -- <paths>`. A change the user staged
  elsewhere is still left out.
- `restore` (and `replaceAsVersion`'s put-back) restores the index, then the
  work tree (`restoreInPlace`), never `--staged --worktree` in one step: that
  wrote the renamed file under its old name and then deleted it as the new name,
  the same file. The files the version does not have are then `clean`ed by name
  (a case alias counts as tracked, so it is kept) with their emptied folders,
  and `matchSpelling` renames what the disk kept under another case to the
  index's spelling, so the next commit records no rename the user never made
  (only where `core.ignorecase` is set). A left-over file git now ignores stays
  on disk (no `-x`). If the work-tree step fails (a file held open on Windows),
  the index is reset to `HEAD` for the project, so no half-restore stays staged.
  `clean`'s paths go in batches of at most 24,000 characters (it has no
  `--pathspec-from-file`).
- Names are compared by one folding (`foldCase`, lower case): narrower than
  NTFS's or APFS's, so a name it misses is at worst not matched, never matched
  to another file; where several entries fold alike, the one the path opens
  (same `dev`/`ino`) is taken. No Unicode normalisation (macOS NFD names are not
  matched, which is safe).
- The samples' update (`changedBundleFiles`) names a bundle file by the spelling
  it has on disk, so the check for changed files outside the saved version
  matches it to the file git tracks, and `replaceInPlace` renames a folder kept
  under the old case (one holding a file git ignores) to the bundle's name.

### Timeouts and robustness

- The close hook and `commitMove` bound **all** their git work — the repository
  lookups included — with `withinVersioningTimeout` (15 s), then give up with
  `VERSIONING_TIMEOUT_MESSAGE`. **The git process is not killed** (killing it
  mid-commit can leave `index.lock`): it runs on, and its operation keeps the
  repository's lock until it ends, so later operations on that repository wait
  for it. That is the accepted cost.
- IDE commits and notes are automatic snapshots, so the user's configuration for
  hand-written commits never applies: `--no-verify` (skips `pre-commit` and
  `commit-msg`), `-c core.hooksPath=<null device>` (no hook at all runs,
  `post-commit` and auto-push hooks included) and `-c commit.gpgsign=false` (no
  signing prompt).
- A merge, rebase, cherry-pick, revert or bisect in progress blocks versioning
  (`blocked` in `status`; `commit` rejects). One `git rev-parse --git-path …`
  call finds every state's file.
- `commit` skips paths with nothing tracked (no `HEAD`, not staged) and no
  changes on disk.
- `exportAt` creates the target's parent if needed and claims the target with a
  non-recursive `mkdir` (an existing directory is rejected, never used or
  removed).

### Tests

`localVersioning.test.ts` runs real git, dozens of processes per test. On
Windows a test takes 1–5 s on an idle machine, so the file sets
`vi.setConfig({ testTimeout: 30_000 })`, and so do the other files that run real
git: `replaceAsVersion.test.ts`,
`handler/__tests__/filesystemVersioning.test.ts`,
`samples/__tests__/updateSamples.test.ts`, the `versioning on close` block of
`projectService/__tests__/lifecycle.test.ts`, and the `versioning routes` block
of `handler/__tests__/projectService.test.ts` (`{ timeout: 30_000 }`): under
load, vitest's default 5 s failed a different handful of tests each run (#395).
A vitest timeout can be reported as `STACK_TRACE_ERROR` (the placeholder error
vitest builds the timeout from), so read that as "timed out", not as an error in
the code. A timed-out test's body also keeps running into the next test, so look
at the first failure, not the ones after it.

### Known limitations

- Moving a project out of its repository (or to another repository) leaves the
  old path's removal uncommitted.
- Deleting a project, or moving a folder that contains projects, leaves the
  removal uncommitted too; it shows in the user's `git status`.
- A restore across a move is refused when the repository tracks the project's
  `.enso/` both in the version's tree (at the old path) and in the index at the
  current path: `read-tree --prefix` would fail with
  `error: Entry '<path>/.enso/…' overlaps with '<path>/.enso/…'.  Cannot bind.`
  The check runs first, so nothing changes. A tracked `.enso/` on one side only
  does not block it.
- A project at the repository root can only be restored to a version recorded at
  `.` (which, as it never follows moves, is every version it lists); a version
  from another path is refused, never restored over the whole repository.
- `restore --worktree` can overwrite a file that is now ignored but was tracked
  in the old version; "Saved before restore" does not capture it, as it commits
  only tracked and unignored files.
- The root-project history cut (`--diff-filter=A` on `package.yaml`) misses a
  `package.yaml` added by a merge commit; the whole history is then listed.
- At a move boundary `log` follows first parents only (`<move commit>^`): a move
  recorded in a merge commit follows its first parent.
- If a cross-move restore fails after its `restore --worktree` step, the index
  is reset but the work tree may hold part of the old version; `HEAD` (the
  `Saved before restore` commit) still has everything. Any restore that fails
  after that commit says so:
  `Restoring failed; your work was saved as the version 'Saved before restore' and can be restored from the list. (<git's message>)`.

## Engine logs (`src/engineLogs/`)

`--list-project-sessions` (`handler/filesystem.ts`) names each session's file as
`logFile`: its active `.log`, or its lowest-numbered archive when it has only
archives. The Logs panel reveals an earlier session's file with it.
`--list-project-session-pages <sessionId>` lists a session's pages, oldest
first: `archive:N` per rolled archive, then `active`. Each is a `scrollId` that
`--get-project-session-logs` reads whole, so the viewer can read a session from
its newest page backwards, one file at a time (`sessionLogWindow.ts`).

`project/open` may carry `engineLogging`
(`{ sqlQueries?, performanceTimings? }`, from the GUI's Settings → Local →
Engine logs). `openProject` adds `engineLoggingArgs(engineLogging)`
(`enso-common/src/services/engineLogs.ts`) to the engine's arguments, after
`ENSO_ENGINE_ARGS` and the service's own: a
`--vm.D <logger>.Logger.level=<level>` per option that is on, nothing otherwise.
The engine keeps them across restarts until the project closes; a project
already open keeps the ones it was opened with. Test:
`projectService/__tests__/engineLogging.test.ts`.

`ProjectService.engineLogs` (an `EngineLogHub`) holds one `EngineLogChannel` per
open project, keyed by its directory (resolved, lower case on Windows).
`openProject` opens it before the engine starts, so start-up lands in the replay
buffer; the runner feeds it through `EngineLogSink` (`engineStarted`,
`engineStderr`, `projectClosed`), and `closeProject` closes it too.

- **Sources.** The engine's stderr: spawned piped, every chunk still written to
  this process's stderr. And the session's active `.log` file,
  `<getEngineLogDirectory()>/<local project key>/<prefix>-yyyy-MM-dd-HH-mm-ss.log`
  — the newest such file that was not there when the engine started — followed
  by `LogFileTailer` (a directory `fs.watch` plus a 500 ms poll; a smaller or a
  different file is a roll-over, read again from offset 0). A read that fails is
  logged once, not on every poll: the same failure again is silent until a read
  succeeds or the failure changes. After `stop()`, `poll()` no longer reads.
- **Events.** `waiting` (an engine started; its file is not there yet),
  `session` (`sessionId` in the `listProjectSessions` format, `logFile`) and
  `line` (`source`, `sessionId` — `null` before the file is found — `text`).
  Each takes the next `seq` in a 5,000-event `ReplayBuffer`.
- **Route.**
  `GET /api/engine-logs/stream?project=<GUI project id>[&channel=<id>&after=<seq>]`
  (`handler/engineLogs.ts`), as server-sent events:
  1. `hello` (`channel`, `oldestSeq`, `nextSeq`, `sessionId`, `logFile`);
  2. the buffered events after `after` (all of them unless `channel` is the
     current one);
  3. live events, with a `: heartbeat` comment every 15 s;
  4. `end`: `closed`, or `not-open` when the project has no channel.

  Both hosts route it right after `acceptLocalRequest`. The wire types are in
  `enso-common/src/services/engineLogs.ts`. A write to a socket that has gone
  away ends the subscription quietly instead of throwing into the channel.

- **Ordering (#280).** Node reports a child's `exit` before its stdio has
  drained, so the old engine's last stderr (a crash dump) can still be in the
  pipe. `ChildProcessHandle.waitForDrain` waits for `close` (bounded by 1 s,
  since a grandchild can hold the pipe), and both `WatchedChildProcess` (before
  it respawns, hence before the next `engineStarted`) and the graceful shutdown
  (before `projectClosed`) wait for it. In the channel, `engineStarted` chains
  every replaced tailer's `stop()` (`stopping`), so a second start cannot emit
  `waiting` before the first one's tailer has emitted its final lines.
- **Tests** never touch real log directories: channels take a temporary
  `logDirectory`, and code that calls `getEngineLogDirectory()` runs with
  `ENSO_LOG_DIRECTORY` stubbed.
- **Known limitation:** lines appended to the old file between the last read and
  a roll-over are not streamed. They are in the rolled archive, so they show up
  in the panel's history.
- **Only rolling logback configurations are supported.** The finder looks for a
  file whose name ends `-yyyy-MM-dd-HH-mm-ss.log`; with a non-rolling config
  (one fixed file name) it never finds the session's file, and the panel stays
  on "Waiting for the engine…" (stderr lines still stream).

## Local datalinks (`src/datalinks.ts`)

A datalink is a `<name>.datalink` file holding the datalink's JSON, the format
the standard library reads with `Data.read`. The extension is exact and
case-sensitive, as the standard library's `data_link_extension`. A directory
listing reports such a file as a `DatalinkEntry` without parsing it, so a file
that is not valid JSON is still listed; reading it reports the problem.

- Routes (POST to `/api/project-service/datalink/*`, served by
  `handler/projectService.ts`): `read` `{ path }` returns the JSON; `create`
  `{ path, value }`, `update` `{ path, value }` and `delete` `{ path }` return
  `null`. Failures are JSON-RPC errors `datalink/<op> failed: <message>`.
- Paths must be absolute, already normalised (no `.`/`..` segments) and name a
  `.datalink` file; anything else is refused. Datalinks live in any folder, so
  there is no root to confine them to.
- Writes are `writeJsonAtomic` under `serialised`. `create` is exclusive
  (`writeJsonExclusive`: the temporary file is hard-linked into place, which
  fails on an existing file or a dangling symlink; on a file system without hard
  links it falls back to a `wx` write) and refuses a missing folder; `update`
  refuses a missing file, `delete` anything but a file; `read` of a missing file
  says `Datalink not found`. Values must be JSON objects. Schema validation is
  the GUI's.

### Secrets routes (`handler/projectService.ts`)

`secrets/list`, `create {name,value}`, `update {name,value}`, `delete {name}`
and `status` (the store's status plus `keyFromEnvironment`) are served from the
`LocalSecrets` passed to `handleProjectServiceRequest` (after `localVersioning`,
then `keyFromEnvironment`). No route returns a value. Without a store they fail
with `Local secrets are not available in this host.`; store errors surface as
`secrets/<op> failed: <message>`. `ProjectService.default(…, extraEnvironment)`
appends its entries to every engine's environment (Task 8 uses it for the key).
