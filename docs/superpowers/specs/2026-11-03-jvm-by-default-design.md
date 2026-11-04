# JVM by default

The IDE starts every project's engine as a native image. Library Java that the
image does not compile in (Image, Postgres, AWS, Google, Microsoft, Snowflake,
Tableau, Saas, Generic_JDBC) runs in a guest HotSpot JVM that the image creates
in its own process and talks to over a hand-written JNI channel. That channel is
unfinished and costly to own, and crossing it is slow unless a library is
designed around it. The owner has decided to move the IDE's engine to the JVM.
This design says how, in stages, and with what gate.

The evidence is in discussion #518 and the session's research notes
(`guest-jvm-audit.md`, `landscape.md`, `measurement.md`,
`measurement-library.md`, `decision.md`). Numbers marked _measured_ come from
the open-time harness on GitHub's 4-vCPU runners (medians of 5 cold opens, ms
from the click). Numbers marked _estimate_ are inferences from those
measurements.

## Problem

Today, on the same runner, the JVM is far behind native:

| `welcomeShown`, first open (measured) | Native | JVM, no cache | JVM + AOT cache |
| ------------------------------------- | -----: | ------------: | --------------: |
| Linux, welcome template               |  6.2 s |        17.0 s |          11.5 s |
| Windows, welcome template             | 16.0 s |        46.3 s |          42.3 s |
| Linux, `image` template (library)     | 13.3 s |        23.2 s |          17.4 s |
| Windows, `image` template (library)   | 20.4 s |        60.6 s |          50.7 s |

Most of the gap is not Enso's own warm-up (`measurement.md` section 2):

- **The ydoc server runs as a cold GraalJS bundle.** Under native it is a
  separate native-image library (`org.enso.ydoc.server.dll`/`.so`); under the
  JVM, `YdocServerImpl` falls back to "single JVM mock mode" and runs
  `ydoc-server.jar`'s JS on GraalJS in the engine JVM. `lsReady` to `firstNode`
  is **+4.2 s on Linux and +14.7 s on Windows** against native, the largest
  single item. 114 of the 118 Truffle compilations before the first node are
  `ydoc.cjs` or JS built-ins.
- **The bundled JDK has no CDS archive.** `SmallJDK.buildSmallJDKForRelease`
  calls `jlink` without `--generate-cds-archive`, so even the JDK's own classes
  are parsed at every start.
- **The AOT cache is not shipped.** A JDK 25 AOT cache removes 5.5 s (Linux) /
  4.0 s (Windows) of class bootstrap, but it is path-bound, so the harness makes
  one by hand on the runner. Users get none.
- **The JIT competes with the open.** By `welcomeShown`, HotSpot's compilers
  have used 17 s (Linux) / 47 s (Windows) of thread time on a 4-core machine.
  `-Dpolyglot.engine.Mode=latency` alone took Windows from 2.65x to 2.32x
  native.
- **The project service's timeouts assume a native engine.** 30 s to pass
  `/_health` and 10 s to exit (`ensoRunner.ts`). A JVM recording AOT training
  data on Windows broke both.

`measurement.md` section 5 estimates, with every lever applied: Linux ~6 to 7.5
s against native's 6.2 s; Windows ~20 to 25 s against 16 s (1.25x to 1.6x). For
the library project: Linux about parity, Windows 1.4x to 1.6x. So the Windows
gate below is reachable, but not certain.

## Decisions (the owner's, 2026-11-03, discussion #518)

Option A: JVM by default, staged, with a Windows gate.

1. **First, fix the JVM's biggest open-time costs:** the ydoc server on cold
   GraalJS; the bundled JDK's missing CDS archive; shipping or auto-training the
   AOT cache; JIT tuning for the open; project-service timeouts that assume a
   native engine.
2. **Re-measure native against JVM** on both platforms, for the new-project
   template and a library-using project, with the open-time harness.
3. **Gate:** if Windows JVM open time is within about 1.5x of native, switch the
   IDE's engine to the JVM by default.
4. **Keep native for the CLI** (`enso --run`, scripts) for now.
5. **Then retire the guest-JVM machinery** once nothing needs it.

"JVM" means GraalVM's JDK in JVM mode: since Truffle 25.1 the optimising runtime
needs it (`landscape.md` section 2).

## Design

Five stages. Stage 1 is several PRs, each measured before and after with the
harness. Stage 1 also carries the GraalVM upgrade track, which runs alongside
it.

```
1  levers ──► 2  measure ──► 3  gate, switch ──► 4 (CLI stays native) ──► 5  retire guest JVM
   └── GraalVM upgrade track (#20/#36) ──┘ (must land before 3 ships)
```

### Stage 1a. The ydoc server leaves the engine

Three options were weighed.

**What the engine-hosted ydoc server depends on.** `MainModule.scala:546-567`
starts it on a daemon thread with four in-process `YjsChannel.Server` callbacks:
JSON-RPC (`YdocJsonRpcServer.yjsChannelCallbacks`), binary
(`BinaryYdocServer.BinaryServerCallbacks`), visualisation control and
visualisation data (`VisualizationBridgeActor`). `YjsChannel`
(`lib/java/ydoc-api`) is a plain message pipe: `send(Object)`, `subscribe`,
`onClose`, and `Server.onConnect`. Beyond those four pipes the bundle needs only
two things from its host: Java `ByteBuffer`s
(`ydoc-server-polyglot/src/main.ts`) and the parser over JNI (`ydoc-polyfill`'s
`ParserPolyfill`). It has no other access to the engine. The Language Server's
RPC port now serves only HTTP endpoints (health, idleness, rename:
`YdocJsonRpcServer.serverRoute`). The JSON-RPC and binary WebSocket servers that
a Node ydoc once dialled are gone, so the four pipes are reachable only
in-process today.

The ydoc library is `OtherJvmClassLoader.create("org.enso.ydoc.server", …)` in
`YdocServerImpl.java:26-27`. Under native it loads the SVM library
`component/org.enso.ydoc.server.dll` (140 MB in a local Windows build) through
`JVM.create(libFile)`, and every message crosses the jvm-channel. Under the JVM,
`Channel.create(null, …)` is mock mode: the same serialisation, in one HotSpot,
with GraalJS running as Java bytecode. "Polyglot" here is the root CLAUDE.md's
third meaning, `ydoc-server-polyglot`. Enso's own `foreign js` (the first
meaning) and EPB (the second) are untouched by any option below.

**(a) Load the native ydoc library from HotSpot.** Port the host side of
`lib/java/jvm-channel` from the SVM C API (`@CEntryPoint`, `@CStruct`,
`WordFactory`, `CTypeConversion`; `Channel.create` throws "Only usable from
SubstrateVM" outside the image, `Channel.java:167-169`) to FFM:

- a downcall to the library's JNI invocation entry;
- the `JNINativeInterface` table read as a `MemoryLayout`;
- an FFM upcall stub in place of the `@CEntryPoint` callback.

The library side stays as it is. An SVM shared library inside a HotSpot process
has a precedent: libgraal is one.

- Gain (estimate): what native's ydoc costs, so -3.5 s Linux / -12 s Windows
  (`measurement.md` section 4).
- Cost: one to two weeks of JNI/FFM work on the least-tested part of the code
  (the real channel path has no unit test; audit section 4.1).
- It **keeps** jvm-channel and jvm-interop (~4,700 lines) and the 140 MB ydoc
  native image for good, which works against stage 5.

**(b) Run the ydoc server in Node, outside the engine.** The server is a Node
program already: its plain Node build runs today under the Playwright mocks
(`gui/integration-test/mock/localApi.ts`), with the WASM parser (`app/rust-ffi`)
in place of the JNI one. The work:

- **Language Server:** a generic WebSocket adaptor on the existing RPC port. A
  connection to `/channel/{json,binary,vis-control,vis-data}` becomes one
  `YjsChannel`, handed to the same four `Server.onConnect` callbacks. The Scala
  and Java behind the channels (#369's `onClose` → `Disconnected`, the
  visualisation bridge's correlation) does not change. Text frames carry strings
  and binary frames carry `ByteBuffer`s, as now.
- **ydoc-server:** a `YjsChannelServer` over `ws` client sockets, and a small
  Node stand-in for `JavaByteBufferClass` over `Uint8Array`.
- **Host:** one Electron `utilityProcess` per app session, using Electron's own
  Node, so the bundle needs no Node binary. Electron's main process is not used,
  so a long diff in the ydoc server cannot stall the window. The shim asks it
  for a listener per opened project, on the port it already reserves
  (`findServerPorts`), and returns that address as `languageServerYdocAddress`.
  The GUI does not change. The Vite middleware (`dev:vite`) hosts the same
  server in-process; until now dev pointed at the engine's (`ws://<host>:5976`).
- **Security:** each engine gets a random token (environment variable). The shim
  hands the same token to the ydoc host, and the LS refuses a channel socket
  without it. A loopback client can reach today's ydoc port, but must not be
  able to drive the LS's channels directly.

Gain:

- **JVM (estimate):** -3.5 to -4.2 s Linux, -12 to -14.7 s Windows. That is the
  whole `lsReady`→`firstNode` excess: GraalJS leaves the engine JVM, and so do
  its ~14 s of compile work, which also frees cores for Enso's own first
  execution.
- **Native: a gain, not a risk.**
  - The ydoc server is listening before the open, so the ~300 to 450 ms wait for
    the engine's ydoc port goes (Note [Open Waits For The Ydoc Port]): -0.3 to
    -0.5 s per open, estimate.
  - The bundle loses the 140 MB `org.enso.ydoc.server` library, and CI loses its
    native-image build.
  - The engine process loses a second SVM isolate.
  - The xxHash128 parity rule between JNI and `hash-wasm` (#394) disappears:
    both ends use `hash-wasm`.

What it costs: two to three weeks. The new risk is the transport, an area where
the WebSocket polyfill needed four fixes (#214, #396, #409, #494). Visualisation
data takes one more loopback copy (LS → ydoc → GUI), which is cheap at the
megabyte sizes visualisations send.

**(c) Keep GraalJS and tune it.** Options: a separate Truffle engine for ydoc
with `engine.Mode=latency`, fewer compiler threads, and lower compilation
thresholds for `ydoc.cjs`. The measured ceiling is poor:

- `polyglot.engine.Compilation=false`, which stops all JIT of JS, was worse on
  Linux (JS stays interpreted: `firstNode` 18 s).
- Auxiliary engine caching, the Truffle-side fix, needs native image.

Gain (estimate): -0.5 to -1 s Linux, -1 to -4 s Windows. That leaves most of the
14.7 s.

**Recommendation: (b).** It is the only option that removes the cost rather than
reproducing native's. It helps native as well. It also removes, instead of
entrenching, the ydoc server's dependency on `OtherJvmClassLoader`, which is
stage 5's one ydoc blocker. (a) would close the gap about as well, but it keeps
~4,700 lines of SVM/JNI code alive for one consumer.

Order of work:

1. The LS adaptor and the Node transport land first, with the engine-hosted
   server still built. The shim picks the host: it sets
   `LANGUAGE_SERVER_YDOC_PORT` for the embedded server, or leaves it unset.
   `ENSO_YDOC_HOST=engine|node` (default `node`) is the rollback switch for one
   release.
2. A follow-up then deletes:
   - `app/ydoc-server-polyglot`;
   - `lib/java/ydoc-server`, `ydoc-polyfill` and `ydoc-server-registration`;
   - the ydoc native-image build.

   `lib/java/ydoc-api` stays as the LS's channel interface.

### Stage 1b. CDS in the bundled JDK

Add `--generate-cds-archive` to `jlinkArgs` in
`SmallJDK.buildSmallJDKForRelease` (`project/SmallJDK.scala:100-108`). The
archive must be generated after `copyLibDirs`, or by the same jlink run: it
covers only the jlinked modules, and `lib/{graalvm,svm,truffle}` are copied
afterwards. That is fine, because those are module-path jars that the AOT cache
covers.

- jlink then writes `lib/server/classes.jsa` (and `classes_nocoops.jsa`), about
  15 MB per platform.
- Every JVM start, cached or not, shares the JDK's own classes. The CI check:
  `java -Xshare:on -version` succeeds with the bundled runtime.
- Gain (estimate): 0.3 to 0.8 s on an uncached open; nothing once the AOT cache
  is in use.
- It also makes AOT training faster: the Windows training JVM that took 31 s to
  pass `/_health` had no sharing at all.

### Stage 1c. JVM options and how they reach the engine

**Today.** With `--jvm`, the native launcher creates HotSpot in its own process
(`Main.launchJvm`, `Main.java:1482-1567`: `JVM.create(javaHome, args)` through
jvm-channel's `JVM`). It passes a fixed list:

- `--sun-misc-unsafe-memory-access=allow`;
- `--enable-native-access=org.graalvm.truffle`;
- `--add-opens=java.base/java.nio=ALL-UNNAMED`;
- the module path;
- `-D` properties from `--vm.D`.

Nothing else reaches the JVM except `JAVA_TOOL_OPTIONS`, which
`JNI_CreateJavaVM` honours and which the harness uses. `JAVA_OPTS` and
`JDK_JAVA_OPTIONS` are read only by the `java` launcher, which is not on this
path. `JAVA_TOOL_OPTIONS` has three problems as a product mechanism:

- it also reaches the guest JVM under native, and any JVM a library spawns;
- it prints `Picked up JAVA_TOOL_OPTIONS` on stderr;
- a user's own value would have to be merged with ours.

**Design.**

- **`jvm.options`.** The engine distribution ships a `jvm.options` file beside
  `component/`, one option per line. `Main.launchJvm` reads it and appends its
  lines to the fixed list, on both the JNI and the `ProcessBuilder` paths. The
  tuned flags belong to the engine, so `enso --jvm` from the CLI gets them too.
- **`ENSO_JVM_OPTIONS`.** `launchJvm` appends the value of `ENSO_JVM_OPTIONS`
  after the file, split on whitespace. The shim uses it for the per-user AOT
  cache (stage 1d) and the harness for experiments (`--jvm-options` moves to it
  from `JAVA_TOOL_OPTIONS`).
- **Native access.** The file also carries
  `--enable-native-access=ALL-UNNAMED,org.enso.language.server`. The two JDK 25
  "restricted method" warnings will become errors in a later JDK.

**Which JIT options.** Measured on JVM + AOT so far (`measurement.md`):

| Option                                | Linux     | Windows              | Verdict                                                   |
| ------------------------------------- | --------- | -------------------- | --------------------------------------------------------- |
| `-Dpolyglot.engine.Mode=latency`      | no change | 2.65x → 2.32x native | candidate                                                 |
| `-Dpolyglot.engine.Compilation=false` | -2.3 s    | -9.4 s               | rejected: Enso never compiles, so peak is lost            |
| `-XX:TieredStopAtLevel=1`             | -1.3 s    | -9.1 s               | rejected: host code stays at C1, so std-bits peak is lost |
| `-XX:-UseJVMCICompiler`               | none      | none                 | rejected                                                  |

The two rejected winners show the open is JIT-bound on Windows. The candidates
reduce compile pressure without capping peak:

- `-Dpolyglot.engine.Mode=latency`;
- `-Dpolyglot.engine.CompilerThreads=1`;
- `-XX:CICompilerCount=2`, the tiered minimum, which caps host compile threads;
- a delayed host top tier (`-XX:Tier4InvocationThreshold` and
  `-XX:Tier4BackEdgeThreshold` raised 4x).

Stage 1c measures these **after stage 1a**, because taking GraalJS out changes
what the JIT is busy with. It measures each one alone and the best pair, with
`open_perf_jvm_options`, three dispatches each. It ships the set with the lowest
Windows median that also passes a **peak guard**. The guard is the Table and
Vector benchmarks of `test/Benchmarks` (run by hand through
`std-libs-benchmark.yml`), where no benchmark may regress by more than 5%
against the JVM defaults. The rejected options stay rejected: they trade peak
for open time, and data work is what the IDE is for.

### Stage 1d. The AOT cache lifecycle

**Constraints, from the code and the measurement:**

- A cache records the module path and the runtime it was trained with, and the
  JVM ignores it (`AOTMode=auto`) when they differ. It cannot be built at
  package time unless the install path is fixed.
- No platform has a fixed install path:
  - Windows: NSIS `oneClick`, `perMachine: false`
    (`electron-builder-config.ts:215-219`), so the path is under the user's
    profile.
  - Linux: an AppImage (`:191`), mounted at a fresh `/tmp/.mount_*` on every
    launch.
  - macOS: a dmg, dragged anywhere. Gatekeeper's App Translocation runs a
    quarantined app from a random path.
- The cache must be trained with the same JVM options it is used with.
- Recording during a real open slows that open: the recording JVM took 31 s to
  start on Windows. It also needs a clean, slow exit (more than 10 s on Windows
  to write the configuration). The IDE's close path cannot promise either (Notes
  in `perf/jvmAotCache.ts`).

**Choice: background training, started at app launch, yielding to opens.**

1. **Key.** The shim computes a key:
   - the app version;
   - the engine distribution's real path;
   - the bundled runtime's path;
   - a hash of `jvm.options`.

   The cache lives at `<userData>/jvm-aot/<key>/enso.aot`, outside the app
   bundle, so macOS code signing is untouched.

2. **Training.** At app launch, when JVM mode is the resolved default and no
   cache exists for the key, the shim starts a training run at below-normal
   priority (`os.setPriority`). The run uses a scratch project made from the
   bundled template (`enso --new`, native, under `<userData>/jvm-aot/train/`).
   It starts `enso --jvm --server` on that project, with
   `ENSO_JVM_OPTIONS=-XX:AOTCacheOutput=<key>/enso.aot.tmp`, which is JEP 514's
   one-step record and create. A headless driver then plays an IDE open over the
   stage 1a channel socket:
   - `session/initProtocolConnection`;
   - create an execution context and push `main`;
   - wait for the execution to complete;
   - attach the welcome node's table visualisation.

   The driver then asks the engine to stop with the usual newline on stdin, and
   gives it 5 minutes to create the cache and exit. On success the file is
   renamed into place, and the scratch project and every other key's directory
   are deleted. This "IDE-trained" workload includes the LS boot (Akka, Helidon)
   that a `--run` training misses. A `--run` training is the fallback if stage
   1a is late.

3. **Yielding.** When a project open starts while training runs, the training is
   killed and its files are deleted. It restarts 60 s after the last open was
   answered, so the training never competes with an open the user is watching.
   Only one training runs at a time: a lock file in `<userData>/jvm-aot/` guards
   against a second IDE window.
4. **Use.** For each JVM engine, when the key's cache exists, the shim adds
   `-XX:AOTCache=<cache> -Xlog:aot=warning,cds=warning:file=<key>/use.log` to
   `ENSO_JVM_OPTIONS`. `AOTMode` stays `auto`, so a cache the JVM refuses costs
   only its benefit and never an open. After the open, a non-empty `use.log`
   that names a mismatch deletes the cache, which retrains on the next launch.
5. **Invalidation on upgrade.** An update changes the version, and so the key.
   The first launch of the new version trains a new cache and deletes the old
   one. Nothing needs an installer hook, so electron-updater's silent install
   needs no change.

**The unstable paths.**

- **Linux AppImage.** The shim starts the engine through a symlink,
  `<userData>/engine/<version>` → `$APPDIR/…/enso`, refreshed at each launch.
  Whether that works depends on whether the JVM compares the module path as
  given or canonicalised. That is a stage 1d experiment (train via the symlink,
  remount, check `use.log`). If the JVM canonicalises, the fallback is to
  extract `component/` and the runtime to `<userData>/engine/<version>/` once
  per version and run from there. Size measured in the experiment; the
  `component/` directory alone is ~404 MB in a local Windows build. If neither
  is acceptable, Linux runs without the AOT cache but with CDS. The cost is ~2 s
  per open (measured, the Linux no-cache gap at `lsReady`), and the gate is
  Windows'.
- **macOS translocation.** When the engine path is under `AppTranslocation/`,
  the shim neither trains nor uses a cache. Those opens are uncached until the
  app is moved to a stable place, which macOS itself asks the user to do.
- **Windows.** The path is stable per user. Defender scans a new cache file
  once; measure it in stage 2.

**Disk.** The size is not measured yet. An estimate from ~23,000 cached classes
at the JDK archive's ~10 KB per class is 200 to 300 MB, with one cache per key
and old ones deleted. Stage 1d records the real size on all three platforms, and
the owner sees it in stage 2's report.

**The first open after install or upgrade** is the one uncached open. Measured
today, uncached costs +5.5 s (Linux) / +4 s (Windows) over cached. With stages
1a to 1c, the Windows first open is estimated at 24 to 30 s. If the user stays
on the dashboard for the length of a training (about 1 to 2 minutes, estimate),
even the first open is cached.

### Stage 1e. Timeouts and health

| Limit                                   | Native (unchanged) | JVM engine | Why                                                                                                        |
| --------------------------------------- | -----------------: | ---------: | ---------------------------------------------------------------------------------------------------------- |
| Start-up: `/_health` passed             |               30 s |      120 s | an uncached JVM passes at ~10 s on the CI Windows runner (measured); a slow laptop is 3x that              |
| Terminate: exit after the stdin newline |               10 s |       30 s | a JVM's shutdown runs Akka's and the JIT's teardown; the 10 s limit already killed recording JVMs          |
| ydoc port wait (`DEFAULT_YDOC_WAIT_MS`) |                5 s |       30 s | interim, until stage 1a: Windows JVM + AOT `openAnswered` came 5.3 s after `lsReady`, which is the 5 s cap |

- `ENSO_ENGINE_STARTUP_TIMEOUT_MS` and `ENSO_ENGINE_TERMINATE_TIMEOUT_MS` (#517)
  still override both columns.
- The resolved engine mode (stage 3) picks the column: `EnsoRunner` takes the
  mode with each open instead of one `startupTimeoutMs`.
- Health polling (#496) stays: 25 ms for the first second, 250 ms after. A JVM
  passes after 2 to 10 s, where the 250 ms step costs at most 250 ms.
- The running watchdog (3 failed checks, 3 s apart) is unaffected. The health
  `fetch` has no timeout, so a GC pause delays a check rather than failing it.
- The training run (stage 1d) is not an opened project, so it has its own
  limits: 180 s to start and 5 minutes to exit.

### Stage 1, alongside: the GraalVM upgrade (#20/#36)

`graalVersion` is held at CE 25.0.1 because 25.0.2 broke host-interop overload
caching (#36: `HostExecuteNode` asserts, and a wrong overload is picked silently
without `-ea`). Since April 2026 CE gets no 25.0.x security updates; only the
monthly feature line moves (25.1.3 onward; 25.5 is due 2026-11-03).

**Stage 1 does not include the upgrade, but stage 3 must not ship before it.**

- Stage 1's levers are measured against the baselines above, which were taken on
  25.0.1. Upgrading in the middle would mix two variables.
- #36 has unknown cost (an upstream bug, maybe already fixed in 25.1+). Blocking
  the levers on it could stall the whole programme.
- A JVM default routes **every** library's Java through host interop on HotSpot,
  which is exactly the layer #36 broke. The upgrade's host-interop behaviour
  must be settled before more code depends on it, and the gate must be confirmed
  on the GraalVM that ships.
- Truffle 25.1+ runs optimised only on a GraalVM 25.1+ JDK. `graalVersion`
  already moves the bundled JDK and the Truffle jars together, so the bundle
  stays consistent.

Order:

1. Minimise #36 to a standalone repro and check it against the current CE
   feature release, during stage 1.
2. Upgrade when it passes, or with a workaround in `HostMethodCallNode`.
3. Then run stage 2's full measurement on the upgraded build. If the upgrade
   lands after a first stage-2 run, the gate run is repeated on it before the
   switch.

The upgrade has its own spec and plan. This document fixes only the order.

### Stage 2. Re-measure

The harness (`app/electron-client/perf/openTime.ts`) gets three changes first:

- **`jvm` engine:** the production path, with the shim's own AOT cache (stage
  1d) and `jvm.options`. The harness-made cache (`jvmAotCache.ts`) goes: it
  would measure something users do not get.
- **`jvm-first` engine:** the same with the cache directory emptied, which is
  the first open after install.
- **RSS:** the engine process tree and the ydoc utility process, sampled at
  `welcomeShown` and 30 s later, alongside the existing hsperf snapshots.

Then the measurement, on develop with every stage 1 PR merged:

- `ide-packaging.yml` dispatched with `open_perf=true`,
  `open_perf_engines=native,jvm,jvm-first`, `open_perf_template=welcome,image`,
  `open_perf_runs=5` and `build_backend=true`.
- **Three dispatches**, so three runner draws per platform: 15 launches per cell
  per platform. Runners vary up to 2x between dispatches, so every ratio is
  taken within one dispatch (same runner), never across dispatches.
- **macOS:** one local run on the self-hosted Mac
  (`perf:open --engines native,jvm --template welcome,image --runs 5`). IDE
  packaging does not build macOS, so this is by hand.
- **Owner's machine:** one local Windows run (`--runs 10`), to check that the CI
  runner is not unrepresentative.

The report goes to discussion #518. For each platform it gives:

- the medians per phase;
- the per-dispatch ratios;
- RSS;
- the AOT cache's size and training time;
- the `jvm-first` numbers.

### Stage 3. The gate and the switch

**The gate.** The gate value is the median of the three per-dispatch ratios of
Windows JVM to Windows native. It is computed for `welcomeShown` (welcome
template) and `libraryShown` (`image` template).

| Both ratios | Outcome                                         |
| ----------- | ----------------------------------------------- |
| ≤ 1.5       | pass: the switch PR goes ahead                  |
| 1.5 to 1.6  | "about 1.5x": the owner decides from the report |
| > 1.6       | fail                                            |

Linux and macOS are reported, not gated. A Linux or macOS ratio worse than
Windows' is traced before the switch.

**How the engine mode is chosen.** Today:

- Electron's `--jvm` (`configParser.ts:29`) adds `--jvm` to the engine arguments
  (`index.ts:340`).
- `ENSO_ENGINE_ARGS` is appended (`ProjectService.default`, `index.ts:133`).
- The launcher itself enforces JVM mode for a project whose `package.yaml` says
  `jvm: true` (`Main.isJvmModeEnabled`, `Main.java:1447-1480`).
- `jvm: false` parses (`Config.jvm: Option[Boolean]`) but means nothing, since
  native is the default.

Stage 1 adds one function to the shim, `resolveEngineMode(projectPath)`. The
first match wins:

1. **The project's `package.yaml`:** `jvm: true` gives JVM and `jvm: false`
   gives native. Read with `localMetadata/packageYaml.ts`. This is the
   per-project override, and it stays. `jvm: false` gains a meaning, which is
   backward compatible.
2. **Electron's `--engine-mode=native|jvm`.** The old `--jvm` stays as an alias.
3. **`ENSO_ENGINE_MODE=native|jvm`**, the escape hatch that needs no release.
4. **The built-in default:** `native` until stage 3, then `jvm`.

The resolved mode decides three things:

- whether the shim passes `--jvm`;
- the timeout column (stage 1e);
- whether an AOT cache is used.

It applies to `--server` (opening a project) and to the IDE's `--run`
(`ensoRunner.ts:577`), so code that works in the editor runs the same way.
`--new`, `--version` and the filesystem commands stay native: they are short and
start no Language Server. The engine log panel's first line names the mode and
where it came from.

**The switch PR** is then one line (the default) plus a CHANGELOG entry under
`#### Enso IDE`. The entry is visible behaviour: projects open on the JVM, and
`ENSO_ENGINE_MODE=native` or `jvm: false` goes back. Under the merge gate for
features, it waits for the owner's OK after an installer test.

### Stage 4. The CLI stays native

No work. `enso` without `--jvm` stays a native image with the AOT-ready
libraries compiled in (`stdLibsJars`, `build.sbt:3906-3932`), and `jvm: true` /
`--jvm` keep working. Until stage 5, a CLI run of a non-AOT-ready library still
uses the guest JVM.

### Stage 5. Retire the guest JVM

A later phase with its own plan.

**It starts only when:**

1. The JVM default has shipped in a release and gone one full release cycle
   without being flipped back.
2. No library needs native hosting. In the IDE every library is hosted on the
   JVM: under `--jvm`, `EnsoPolyglotJava.find` loads every package hosted
   (`EnsoPolyglotJava.java:175-178`), and the JVM stdlib suite runs that
   configuration today. What still needs the guest is a **native CLI** run of a
   non-AOT-ready library. Its replacement is an open question (below).
3. #484 (SQLite into the guest, held) is closed as superseded.
4. The ydoc server no longer goes through `OtherJvmClassLoader`. Stage 1a's (b)
   removes `YdocServerImpl` entirely. Had (a) been chosen, the channel would
   have to stay for ydoc.

**What goes** (audit section 6, adjusted for a native CLI that stays):

- `lib/java/jvm-channel`'s `Channel`, and all of `lib/java/jvm-interop` (~4,700
  lines). The tests go with them: `ChannelInSingleJvmTest`, `OtherJvm*Test`,
  `EpbJvmObjectTest`, `GuestJavaInteropTest`, the `std-mock-dual-microsoft`
  suite definition, and `FibGuestJavaPolyglotBenchmarks`.
- The guest branch of `EnsoPolyglotJava`:
  - the `enso.classLoading` option;
  - `CtxData` and `initOtherJvm`;
  - the `ENSO_JAVA=espresso` branch.

  `JavaPolyglotNode`'s guest loader and its hard-coded module list go too.

- The Enso-side crossing rules:
  - `Enso_Secret`'s class-name exception match;
  - the `In_Memory_*` foreign-table conversions;
  - the `JDBCDriverTypes` exception-class indirection, which becomes optional.

  The "import Database's helpers yourself" pattern becomes harmless and may
  stay.

- The proxy half of `Builder.makeLocal`, and `ColumnStorageProxy`. The off-heap
  storages stay, since Arrow and Python use them.
- The guest workarounds: CI's `vm.max_map_count`, `JAVA_TOOL_OPTIONS` reaching
  only the guest, `-Dtruffle.UseFallbackRuntime`, and the guest-thread
  restriction.

**What stays:**

- **The launcher's in-process JVM start.** `Main.launchJvm` creates HotSpot with
  `org.enso.jvm.channel.JVM.create` and `executeMain`. That small JNI-invocation
  piece (`JVM`, `PosixJVM`, `WindowsJVM`, and the invocation subset of `JNI`)
  moves into `engine/runner`. It is not replaced by spawning `java`: one process
  keeps the shim's PID, stdin shutdown and kill semantics as they are.
- **`EnsoLibraryFeature`, `markAotReady` and the `stdLibsJars` split.** The
  native CLI still compiles the AOT-ready libraries in. The audit lists these as
  going only under a JVM-everywhere end state, which stage 4 rules out for now.

## Testing and measurement

- **Harness:** stage 2's changes. Every stage 1 PR gives before and after
  medians, from a dispatch or a local `perf:open`, in its description, as the
  project-open spec required.
- **Shim unit tests:**
  - the precedence of `resolveEngineMode` (package.yaml both ways, option, env,
    default);
  - the timeout columns per mode, with the environment overrides still winning;
  - the AOT cache manager with fake engines: the key; the training killed by an
    open and restarted; the lock; the rejection from `use.log`; the clean-up of
    other keys.
- **ydoc transport:**
  - a Scala test of the LS channel adaptor: four kinds, the token, `onClose` on
    socket close;
  - vitest for the Node `YjsChannelServer` against a fake LS;
  - the existing `ydoc-server` tests, now in Node only;
  - the Playwright suite unchanged, since it already uses the Node build;
  - the WebSocket edge cases of #214, #396, #409 and #494 re-tested on the new
    transport.
- **Packaged IDE:** the electron tests open a project in the default mode on
  Linux and Windows. After stage 3 they also open one with
  `ENSO_ENGINE_MODE=native`, so both modes stay covered.
- **CDS:** a packaging check that `runtime/…/bin/java -Xshare:on -version`
  exits 0.
- **Linux, not only Windows:** the AppImage path experiment needs a real
  AppImage (CI, or WSLg). Run the shim tests in WSL too (root CLAUDE.md).
- **Mode switching:** in stage 2, open the same project native → JVM → native
  and check that no IR or bindings cache is refused. Both modes are the same
  engine version, so none is expected; this check confirms it.

## Rollout and rollback

1. **Stage 1 PRs** each merge on green. They change nothing for a native user
   except stage 1a's ydoc host, which has `ENSO_YDOC_HOST=engine` as its
   rollback for one release.
2. **Stage 2** is a measurement only.
3. **Stage 3:** the switch merges after the gate and the GraalVM upgrade, and
   goes to nightlies, then the next release.
4. **Rollback without a release:**
   - a user sets `ENSO_ENGINE_MODE=native`, passes `--engine-mode=native`, or
     writes `jvm: false` in one project;
   - with a release, the default flips back in one line.

   Nothing on disk needs migrating either way. An unused AOT cache only costs
   disk, and the next version's first launch deletes it.

5. **If the gate fails:**
   - Stage 1 stays. It makes `--jvm` usable, and (b) speeds up native opens.
   - The mode plumbing stays, with the default at `native`.
   - Stage 5 does not start.
   - The report names the remaining gap, and the next candidates are measured
     before another gate run: lazy stdlib module loading (estimated -1 to -2 s
     on Windows) and fewer template imports.
   - Nothing is reverted.

## Out of scope

- The GraalVM upgrade itself (#20/#36): its own spec. Only its order is fixed
  here.
- Changing the CLI's default (stage 4).
- Lazy stdlib loading and template import trimming: next levers, if the gate
  needs them.
- Leyden JEP 516/544 (JDK 26/28): GraalVM stays on a JDK 25 base until about
  JDK 29.
- Auxiliary engine caching, Crema, and Espresso: native-side routes, not this
  programme.
- Heap sizing (`-Xmx`, `MaxRAMPercentage`): revisited only if stage 2's RSS
  calls for it.
- An Oracle GraalVM edition.

## Risks

- **Memory.**
  - A JVM engine keeps more resident than the image: metaspace for ~26,000
    classes, the code cache, and libgraal's heap. Estimate: several hundred MB
    more per open project, not measured yet; stage 2 measures it. The default
    heap ceiling is a quarter of RAM, the same as the guest JVM's today.
  - Against that: a library project under native already carries a guest JVM,
    and (b) takes GraalJS and its compiled code out of the engine. The Node ydoc
    process costs tens of MB, once per app session.
- **The first open after install or upgrade.**
  - It is uncached: an estimated 24 to 30 s on the Windows runner, against 16 s
    native. It is the first impression, and the gate does not measure it.
  - Stage 1d shortens the window: the training starts at launch.
  - Stage 2 reports `jvm-first` so the owner sees it.
- **macOS.**
  - Not in CI packaging. Measured by hand on the self-hosted Mac.
  - The entitlements already allow JIT (`entitlements.mac.plist`), and the cache
    lives outside the signed bundle.
  - A translocated app runs uncached.
  - GraalVM 25 CE has no macOS x64 build, which is already the case for native.
- **Licensing.** No change. JVM mode runs the GraalVM CE runtime that the bundle
  already ships for `--jvm` and for the guest JVM:
  - the JDK under GPLv2 with the Classpath Exception;
  - Truffle and GraalJS under UPL.

  Stage 1a removes the ydoc jars, so `gatherLicenses`' NOTICE must be
  regenerated (it is not CI-checked).

- **Linux AppImage paths.** If neither the symlink nor the extraction is
  acceptable, Linux runs without the AOT cache (~2 s per open). It is not gated.
- **The gate is borderline.** The estimates put Windows at 1.25x to 1.6x. A
  failed gate is a supported outcome (Rollout, point 5), not a stall.
- **The ydoc transport** is new code on a path with a history of socket races.
  Mitigations: the one-release `ENSO_YDOC_HOST=engine` rollback, and the edge
  cases re-tested.
- **The GraalVM upgrade** may stay blocked by #36. Stage 3 waits for it; stages
  1 and 2 do not.

## Open questions for the owner

1. **A visible setting?** This design gives the engine mode a CLI option, an
   environment variable and the per-project `jvm:` key, but no Settings-page
   toggle. Is that enough, or should Settings get "Engine: Automatic / JVM /
   Native"?
2. **After stage 5, the native CLI and a library that needs the guest** (Image,
   Postgres, AWS, …). The options:
   - fail with a message that says to use `--jvm` or `jvm: true`;
   - have the launcher switch to the JVM when the project depends on such a
     library.

   Recommendation: the message first, the automatic switch only if CLI users ask
   for it.

3. **Memory: gate or report?** Is RSS report-only in stage 2, or should the gate
   also cap it (for example JVM ≤ native + 500 MB per project)?

## Owner's answers (2026-11-04)

1. **No Settings toggle.** The engine mode is chosen by `package.yaml` `jvm:`,
   `--engine-mode` and `ENSO_ENGINE_MODE` only.
2. **The native CLI switches to the JVM automatically** when a library's Java is
   not in the native image (after the guest JVM is retired), with a one-line
   notice.
3. **Memory (RSS) is reported, not gated.** The gate is open time only; RSS is
   measured and published beside it.
