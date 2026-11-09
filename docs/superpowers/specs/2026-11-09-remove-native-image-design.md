# Remove GraalVM Native Image

The engine ships twice: as a native image (`bin/enso` built by `native-image`)
and as Java on GraalVM's JDK (`enso --jvm`, and the shell launchers of a
development build). The IDE opens projects on the native image by default, and
the JVM-by-default programme (discussion #518) is moving it to the JVM. This
design goes one step further: **Enso stops building a native image at all.** The
IDE and the CLI run only on the JVM, on the GraalVM JDK the bundle already
ships.

The owner approved it on 2026-11-09. It supersedes stage 4 of
`2026-11-03-jvm-by-default-design.md` ("the CLI stays native") and absorbs its
stage 5 ("retire the guest JVM"), including that spec's owner answer 2 (the
native CLI switching to the JVM by itself): there is no native CLI left to
switch. Stage 3 of that spec (the switch to `jvm` by default, with its gate) is
unchanged and is Phase B here. The GraalVM 25.5 upgrade
(`2026-11-09-graalvm-25.5-upgrade-design.md`, PR #661, "P") comes first: it
keeps native green only until this removal, and its re-gate decides when Phase B
may ship.

The footprint below was surveyed on `origin/develop` (f755c7f54a) on 2026-11-09.
Paths are checked against it; line numbers drift and are given only where they
help find a place.

## Why

- **Two engines, one product.** Every engine change is built and tested twice
  (native and JVM standard-library suites, native and JVM IDE opens), and native
  needs its own configuration: 34 `META-INF/native-image` files (the runner's
  `reflect-config.json` alone is about 3,000 lines), build-time initialisation
  lists, `Feature` classes, and substitutions for libraries that touch AWT.
- **The guest JVM.** Library Java that the image does not compile in (everything
  but Base, Table, Database and DuckDB: `stdLibsJars` in `build.sbt`) runs in a
  HotSpot JVM that the image starts inside its own process and talks to over
  `lib/java/jvm-channel` and `lib/java/jvm-interop` (33 Java files, about 4,700
  lines). It is slow to cross and costly to own (the JVM-by-default spec's
  problem statement).
- **The JVM is now close enough.** With the levers of #518 (ydoc in Node, CDS,
  the per-user AOT cache, C2 for the host, the warm spare engine of
  `2026-11-08-jvm-warm-engine-design.md`), the IDE's JVM open was within 1.23×
  (welcome) and 1.09× (`image`) of native at 8 CPUs on 25.0.1 (#659). P re-runs
  that gate on 25.5.
- **Security.** Only GraalVM CE's innovation line gets fixes (P). Each monthly
  bump that must also keep `native-image` green costs a builder-compatibility
  round (P's open question 3); without native there is none.

## Decisions (owner, 2026-11-09)

1. **Launcher.**
   - **IDE:** the project service (`app/project-manager-shim`) starts the
     bundled `java` directly. It builds the command line itself from
     `jvm.options` and `ENSO_JVM_OPTIONS`. No `bin/enso`, no `cmd.exe` in
     between: one process, the right PID, a clean stdin.
   - **CLI:** keeps the shell launchers `bin/enso` and `bin/enso.bat`, fixed to
     read `ENSO_JVM_OPTIONS` and to handle quoted options.
2. **Rollout in three phases.**
   - **Phase A, now, before the switch.** Remove the native-only pieces that
     nothing on the JVM path needs, each in its own PR:
     1. the guest JVM;
     2. the ydoc native library;
     3. CI's native-only jobs.

     The native engine build job stays: the escape hatch needs it.

   - **Phase B: the switch** to `jvm` by default (stage 3 of the JVM-by-default
     spec), after P and its re-gate on the upgraded build.
     `ENSO_ENGINE_MODE=native` and `package.yaml` `jvm: false` remain for one
     release.
   - **Phase C, one release after the switch:** native goes. The shim spawns
     `java` directly, the engine-mode machinery goes, `bin/enso(.bat)` are the
     only launchers, and every native-only file, dependency, job and document is
     deleted.

3. **CLI start-up on the JVM is accepted.** It is measured and reported
   (`--version`, `--new`, `--run`), not gated. The CLI uses the bundled JDK's
   CDS archive only; no AOT cache for the CLI for now.

## Phase A: native-only pieces nothing on the JVM path needs

Three PRs. Each takes `CI: No changelog needed` except where noted. Nothing in
them changes a JVM run.

### A1. The guest JVM

**What goes.**

- `lib/java/jvm-channel`'s `Channel` and its SVM entry points, and all of
  `lib/java/jvm-interop`, with their `META-INF/native-image` files.
- The guest branch of `EnsoPolyglotJava`
  (`engine/runtime/.../EnsoPolyglotJava.java`):
  - `initOtherJvm` and the `java:0#guest` EPB source;
  - the `enso.classLoading` option;
  - the `ENSO_JAVA=espresso` branch.
- `runtime-language-epb`: `JavaPolyglotNode`'s guest loader and its hard-coded
  module list, and `HostClassLoader`'s `TruffleOptions.AOT` guest path.
- The dual-JVM tests and suites:
  - `ChannelInSingleJvmTest`;
  - `OtherJvmGCTest`, `OtherJvmJavaScriptTest`, `OtherJvmLoggerTest`,
    `OtherJvmObjectTest`;
  - `EpbJvmObjectTest`, `GuestJavaInteropTest`;
  - `FibGuestJavaPolyglotBenchmarks`;
  - the `std-mock-dual-microsoft` suite in
    `tools/build-scripts/src/stdlib-test/suites.ts` and its tests.
- The guest's workarounds:
  - CI's `vm.max_map_count` step (Note [Memory Map Limit For Guest Libraries] in
    `engine-checks-platform.yml`);
  - `-Dtruffle.UseFallbackRuntime` in `OtherJvmUtils`;
  - the proxy half of `Builder.makeLocal` and `ColumnStorageProxy` (the off-heap
    storages stay: Arrow and Python use them).

**What stays until Phase C.** The native launcher still starts HotSpot in its
own process for `--jvm` (`Main.launchJvm`, `JVM.create` and `executeMain`). That
JNI-invocation subset of `jvm-channel` (`JVM`, `PosixJVM`, `WindowsJVM`, the
invocation part of `JNI`, `JNIBoot`) is kept: it moves into `engine/runner`, or
`jvm-channel` shrinks to it. `distribution/bin/enso.def`, `.exp` and `.lib`,
which export the JNI symbols from `enso.exe`, stay with it.

**What a native run does instead.** `isHostClassLoadingFor` already answers
"hosted" for an AOT-ready package under native and for every package under the
JVM. A1 replaces the guest fallback with an error: loading a class for a library
whose Java is not in the image fails with one message that names the library and
the way out, for example:

> Standard.Image's Java is not part of the native engine. Run on the JVM:
> `enso --jvm`, `jvm: true` in package.yaml, or `ENSO_ENGINE_MODE=jvm` in the
> IDE.

That applies to Image, Postgres, AWS, Google, Microsoft, Snowflake, Tableau,
Saas, Generic_JDBC and SQLite (which #484 moved into the guest). It holds until
the native engine goes in Phase C.

**Ordering constraints, found in the survey.**

- **The engine-hosted ydoc server uses jvm-interop on the JVM too.**
  `YdocServerImpl` (`lib/java/ydoc-server-registration`) loads the ydoc server
  through `OtherJvmClassLoader` in both modes: under the JVM it is "single JVM
  mock mode", with `ydoc-server.jar` added to the loader. Deleting jvm-interop
  therefore breaks the `ENSO_YDOC_HOST=engine` rollback in every mode. PR M of
  the JVM-by-default plan deletes the engine-hosted server, but only after a
  release has shipped with the Node host. **A1 lands after PR M** (open question
  1).
- **The re-gate needs a native `image` baseline.** P's re-gate compares
  `jvm-spare` with native on the welcome **and** `image` templates, and the
  `image` template calls Standard.Image, which runs in the guest under native.
  After A1 a native open of that template fails. **A1 lands after the re-gate's
  measurement**, or the re-gate takes its native `image` numbers from a pre-A1
  build measured in the same session (the route P's open question 3 already
  describes).
- **Native CI suites that use guest libraries move first.** `std-aws`,
  `std-microsoft` and `std-cloud-related` run the native launcher without
  `--jvm` (`suites.ts`). A1 gives them `runnerArgs: ['--jvm']`, so they test the
  JVM path, which is the one users get after Phase B. The `standard-library`
  suite already runs `--jvm` on the small JDK.
- **The IDE's default is still native between A1 and B.** A project that uses a
  guest library fails to open on a native engine with the message above until
  the user sets `jvm: true` or `ENSO_ENGINE_MODE=jvm`. That is acceptable on
  nightlies, not in a release (open question 2).

**Enso-side crossing rules.** `Enso_Secret`'s class-name exception match, the
`In_Memory_*` foreign-table conversions and the `JDBCDriverTypes`
exception-class indirection exist because objects crossed the channel. They are
harmless on the JVM. They are removed in a follow-up ticket filed with A1, not
in A1, so A1 stays a deletion of Java.

### A2. The ydoc native library

The ydoc server already runs in Node by default (`ENSO_YDOC_HOST=node`, stage 1a
of the JVM-by-default spec). What goes:

- `ydoc-server`'s `buildNativeImage` and its wiring into
  `buildEngineDistributionNoIndex`/`buildEngineBundle`;
- the `-ydoc` value of `ENSO_LAUNCHER` (`project/GraalVM.scala`) and its use in
  `engine-checks-platform.yml`;
- `lib/java/ydoc-server`'s seven `META-INF/native-image` files.

The bundle loses `component/org.enso.ydoc.server.dll`/`.so` (140 MB in a local
Windows build), and IDE packaging and release lose its build. CI history puts
that build at 4 to 7 minutes on Linux (the note in
`engine-checks-platform.yml`).

Without the library, `ENSO_YDOC_HOST=engine` works only with a JVM engine. If PR
M is cleared to go now, A2 and PR M become one PR that also deletes the
engine-hosted server (open question 1). Otherwise A2 makes a native engine with
`ENSO_YDOC_HOST=engine` fail at the open with a message that says to use the
Node host or the JVM.

`gatherLicenses` is re-run and the NOTICE files regenerated (not CI-checked;
root `CLAUDE.md`).

### A3. CI's native-only jobs

- **Native standard-library suites go:**
  - `standard-library-in-native` in `engine-checks.yml`,
    `engine-checks-nightly.yml` and `macos-checks.yml`;
  - Snowflake Native in `extra-nightly-tests.yml` (`std-snowflake`; the JVM job
    `std-snowflake-jvm` stays);
  - the suite definitions, the `stdlib-native` alias, and their tests in
    `tools/build-scripts/src/stdlib-test/` (`suites.ts`, `suites.test.ts`,
    `plan.test.ts`, and `invocation.ts`'s `nativeRunner` once no suite sets it).
- **The macOS native steps** in `macos-checks.yml` go. macOS keeps its JVM
  suites.
- **Benchmarks:** `std-libs-benchmark.yml` sets `ENSO_LAUNCHER: native,-ls` only
  because the retired build CLI did. JMH runs in the sbt JVM, so the native
  runner is built and never used. It becomes the default (`shell`).
  `engine-benchmark.yml` sets nothing and needs nothing.
- **`setup-msvc` stays** where it is used in Phase A: the native engine build
  job, IDE packaging, release, and `sbt test` on Windows (os-environment's tests
  build native images). Nothing in A3 removes its last caller; it goes in Phase
  C.
- **The native engine build job stays.** "Build Engine Distribution
  (native,test)" (`engine-checks-platform.yml`) builds the escape hatch, and its
  artifact feeds `gui-checks.yml`, `extra-nightly-tests.yml` and the docs-site
  jobs. Its name and the artifact's are labels that
  `tools/ci/check-workflows.mjs` matches; they change in Phase C, not now.

Each removed job is listed in the PR with its median duration over its last ten
develop runs, so the CI time saved is measured, not estimated.

## Phase B: the switch

Stage 3 of the JVM-by-default spec, unchanged:

- after P's PR 3 (25.5) and P's re-gate passing on the upgraded build;
- `DEFAULT_ENGINE_MODE` in
  `app/project-manager-shim/src/projectService/engineMode.ts` becomes `jvm`;
- a CHANGELOG entry under `#### Enso IDE`;
- the owner's installer test before the merge (merge gate for features).

`ENSO_ENGINE_MODE=native`, `--engine-mode=native` and `package.yaml`
`jvm: false` stay for one release as the rollback. The native engine is still
built and bundled, so they work.

The packaged-IDE tests open a project in the default (JVM) mode and once with
`ENSO_ENGINE_MODE=native`, so the escape hatch stays tested for its release.
After A1, the native open uses the welcome template, which needs no guest
library.

**CLI measurement.** Phase B also measures the CLI on the JVM, since its numbers
are what Phase C's users get. On the owner's machine and in WSL, a release
distribution built with `ENSO_LAUNCHER=shell` against one built with `native`:
`enso --version`, `enso --new`, and `enso --run` of a one-line program and of a
Table script, 10 cold runs each, medians. The report goes to #518. It is not a
gate (decision 3).

## Phase C: native goes

One release after Phase B shipped without being flipped back. Several PRs,
ordered so that each leaves a working build: the IDE's launch first, then the
build, then the code, then the documents.

### C1. The IDE starts `java` itself

**Today.** `EnsoRunner` (`projectService/ensoRunner.ts`) finds `enso.exe` or
`enso.bat` (or `enso`) in the bundle, and on Windows runs a `.bat` through
`cmd.exe /c`. The native launcher then starts HotSpot in its own process through
JNI. With the shell launcher, `cmd.exe` and `java.exe` are two processes, so the
shim's PID, stdin and kill reach `cmd.exe`, not the engine (the startup timeout
in `ensoRunner.ts` kills the whole tree for that reason).

**Design.** A new `projectService/javaLaunch.ts` builds the command for every
engine the shim starts:

```
<runtime>/bin/java[.exe]
  --sun-misc-unsafe-memory-access=allow
  --enable-native-access=org.graalvm.truffle
  --add-opens=java.base/java.nio=ALL-UNNAMED
  <jvm.options lines>
  <ENSO_JVM_OPTIONS options>
  --module-path <engine>/component
  -m org.enso.runner/org.enso.runner.Main
  <engine arguments>
```

- The fixed list is `Main.launchJvm`'s. It moves into `jvm.options` in C1, so
  the shim, the shell launchers and the runner read one list and cannot drift.
- `jvm.options` is parsed as `JvmOptions.java` does (trim, BOM, `#` comments);
  `projectService/jvmOptions.ts` already splits `ENSO_JVM_OPTIONS` the
  launcher's way. A shared fixture of tricky lines (spaces, quotes, BOM, CRLF)
  is tested against both.
- `<runtime>` is the bundle's `runtime/graalvm-*` directory, which the AOT cache
  key already resolves (`jvmAot/key.ts`).
- Every engine the shim starts uses it: `--server` (open), `--run`, `--standby`
  (the spare), `--new`, `--version`, and the AOT training run
  (`jvmAot/trainer.ts`). `--jvm` is no longer passed.
- The working directory stays the project's parent, as today, so
  `EnsoContext.checkWorkingDirectory` holds.
- The engine is one process: the stdin-newline shutdown, the watchdog and the
  kill reach the JVM itself.

`bin/enso(.bat)` are then used only by people at a terminal.

**What goes in the shim and Electron.**

- `engineMode.ts`, its tests, `liftJvmFlag`, the `ENGINE_TIMEOUTS.native` column
  (`timeouts.ts`) and the per-mode choice in `EnsoRunner`. The JVM column
  becomes the only one, still overridable by `ENSO_ENGINE_STARTUP_TIMEOUT_MS`
  and `ENSO_ENGINE_TERMINATE_TIMEOUT_MS`.
- Electron's `--engine-mode`/`--jvm` (`configParser.ts`, `index.ts`),
  `isJvmDefaultEngine` in `jvmAotSettings.ts`, the spare's "default engine is
  native" condition, and the GUI's hiding of the spare setting under native
  (`spareEngineSync.ts`). `options.ts` and the `ProjectManager` types drop the
  mode.
- `ENSO_ENGINE_MODE` and `package.yaml` `jvm:` stay parseable and do nothing. A
  value asking for native logs one line in the engine log ("the native engine
  was removed; running on the JVM").
- The engine log panel's first line stops naming a mode.
- The perf harness (`perf/openTime.ts`, `OPEN_PERF_ENGINES`) and
  `ide-packaging.yml`'s `open_perf_engines` drop `native`. `electronTest.ts`
  stops forcing native.
- **The AppImage engine copy** (`jvmAot/stableEngine.ts`, Note [The AppImage
  Engine Is Copied Out]) exists because the native launcher finds the JVM's
  paths through its own resolved executable, so a symlink did not help. With the
  shim naming every path, a symlink at `<userData>/engine/<version>` may be
  enough. The copy goes only if the check below passes.

### C2. The launchers and the build

**`bin/enso` and `bin/enso.bat`** become the CLI's only launchers:

- they read `ENSO_JVM_OPTIONS` after `jvm.options`, with `JvmOptions.java`'s
  rule (one option per line if the value has a newline, else split on
  whitespace);
- `enso.bat` accepts quoted options (an `-Xlog` file under a path with spaces)
  and a UTF-8 BOM, which it does not today (its own comment: "the quoted -Xlog
  file form is only for the native launcher");
- the fixed option list comes from `jvm.options` (C1), not from the scripts;
- they put the user's working directory into `-Denso.user.dir`, as
  `Main.launchJvm` does today (see "The working directory" below).

**The build.**

- `project/NativeImage.scala` (616 lines) and `MsvcRuntime.scala` (after the
  check below).
- `SmallJDK.buildSmallJDKForNativeImage`, `NI_BUILDER_MODULES`,
  `ADDITIONAL_NI_BUILD_MODS`, and the native-image module path. The release
  JDK's `NI_BASE_MODULES` and the copied `lib/svm` and `lib/static` go if the
  check below passes.
- `GraalVM.EnsoLauncher` and `ENSO_LAUNCHER`. Its only remaining value would be
  `shell`, so it is removed rather than kept as a one-value switch. A set
  `ENSO_LAUNCHER` logs a warning for one release. `tools/build-scripts`'
  `ide-local` stops setting it.
- `build.sbt`: the engine-runner image task (`NativeLibraryFeature`,
  `EnsoLibraryFeature`, the gax-grpc features, build-time initialisation, the
  `enso.exp` linker option), `stdLibsJars`, `extraNITestLibs`, the
  `buildSmallJdk` for native image, and the os-environment test images.
- `DistributionPackage.scala`: always the shell launchers.
  `EngineDistributionChecks` stops calling `MsvcRuntime` if it goes.
- `distribution/bin/enso.def`, `enso.exp`, `enso.lib`.
- The direct `org.graalvm.sdk:nativeimage` dependency of the engine projects
  (about 20 lines in `build.sbt`). **The jar itself stays in `component/`:** it
  is one of `GraalVM.modules`, which Truffle and the polyglot API need on the
  module path.
- `tools/legal-review/*/org.graalvm.sdk.nativeimage-*` stay for the same reason.

**CI and release.**

- The engine build job builds the shell distribution; the artifact name drops
  `(native,test)`, with `check-workflows.mjs`, `gui-checks.yml`,
  `extra-nightly-tests.yml`, `docs-site.yml` and `docs-site-build.yml` updated
  in the same PR.
- `ide-packaging.yml` and `release.yml` (Linux, Windows and the self-hosted
  macOS job) drop `ENSO_LAUNCHER: native`.
- `setup-msvc` goes when no caller is left. `MsvcRuntime` reads
  `VCToolsRedistDir` from it, so the two go together, or both stay (the check
  below).
- `sbt test` on Windows no longer builds native images.

### C3. The code

- `engine/runtime/.../nativeimage/NativeLibraryFeature.java` and
  `NativeLibrarySearchPath.java`; `engine/runner/.../EnsoLibraryFeature.java`.
- `std-bits/table/.../nativeimage/workarounds/` (`OnlyWithDesktop`,
  `Target_GraphicsEnvironment`, `Target_Toolkit`).
- **The AOT-readiness machinery:** `PackageUtils` (`AOT_READY`, `markAotReady`,
  `isAotReady`, `checkAotReady`), `Package.isAotReady`/`markAotReady`, the
  `checkAot` parameters of `DefaultLocalLibraryProvider`,
  `ResolvedLibrary.toString(isAot)`, and
  `EnsoPolyglotJava.isHostClassLoadingFor` (always hosted). Readiness is
  recorded only at image build time, never in `package.yaml`, so no library on
  disk declares it.
- **`HostEnsoUtils.isAot()` and its callers:** `ContextFactory` (the runtime
  server instrument), `PythonHomeFinder`, `MainModule` (log line and library
  provider), `LocalLibraryManager`, `LibraryPreinstallHandler`,
  `DependencyPreinstaller`, `DefaultPackageRepository`, and `Main`'s three
  branches. Each keeps its JVM branch.
- **`ImageInfo` branches:**
  - `Main`, `Utils.adjustCwdToProject`;
  - `File_Utils.getExecutableLocation` (keeps the module branch);
  - `Parser.java`'s build-time buffer handling (in the Java generated from
    `lib/rust/parser/generate-java/java`);
  - `PackageUtils`;
  - `TruffleOptions.AOT` in `RuntimeServerInstrument` and
    `ForeignParsingException` (and in `HostClassLoader`/`JavaPolyglotNode`, if
    A1 left any).
- **The in-process JNI launcher:** `Main.launchJvm`'s JNI branch, and what A1
  left of `jvm-channel` (`JVM`, `PosixJVM`, `WindowsJVM`, `JNI`, `JNIBoot`,
  `JNIDirectives`, `JNINativeInterface`). `--jvm` stays accepted; on the JVM it
  already does nothing unless it names a different JDK, which still relaunches
  through `ProcessBuilder`.
- **os-environment's native-only code** (`@CFunction` code that only runs in an
  image):
  - `WindowsArguments`, which reads the wide command line;
  - `PosixWorkingDirectory`/`WindowsWorkingDirectory`'s `chdir`;
  - `MacTrashBin`/`WindowsTrashBin`. `TrashBin` has no product caller on
    develop, only os-environment's own tests, so it goes with its tests.

  `TestCollectorFeature` and the test-only `META-INF/native-image` files go too.

- **The remaining `META-INF/native-image` files** (all 34 are gone after A1, A2
  and C3), and `module-info` `requires org.graalvm.nativeimage` where nothing
  uses it any more.

### C4. The documents

- The 13 `CLAUDE.md` files that name the native image or launcher (`git grep -l`
  on develop: the root, `.github/`, `app/electron-client/`,
  `app/project-manager-shim/`, `engine/`, `engine/runner/`, `project/`,
  `std-bits/`, `std-bits/postgres/`, `std-bits/sqlite/`,
  `lib/scala/json-rpc-server/`, and the Postgres and XML library ones), and the
  others that mention the native engine (about 20 in all).
- The root `CLAUDE.md`'s "Running an Enso test project by hand" (the
  distribution's `bin/enso` is now always the shell launcher).
- `test/Generic_JDBC_Tests/README.md`; `docs-site/CLAUDE.md` and
  `docs-site/docs/getting-started/index.md`.
- The wiki: Infrastructure-Native-Image is retired with a pointer to this spec,
  and Infrastructure stops listing native-image and dual-JVM guides.
- A CHANGELOG entry under `#### Enso IDE` and `#### Enso Language & Runtime`:
  the native engine is gone, `ENSO_ENGINE_MODE=native` and `jvm: false` no
  longer do anything, and the CLI runs on the bundled JDK. This is visible to
  CLI users.

## What the JVM-only distribution needs

- **The bundled GraalVM JDK, jlinked.** `SmallJDK.buildSmallJDKForRelease`
  already builds it for the bundle, and the `standard-library` suite already
  runs `--jvm` on it (`target/small-jdk`). So today's module list is exercised
  on the JVM path every PR. It stays jlinked rather than a full JDK; a full JDK
  is the fallback only if a library needs a module jlink leaves out. P adds
  `java.sql`, `java.transaction.xa` and `java.xml` explicitly for 25.5.
- **CDS.** jlink's `--generate-cds-archive` is already on (stage 1b), with the
  packaging check `bin/java -Xshare:on -version`. The CLI relies on it alone
  (decision 3).
- **The IDE's AOT cache** (`jvmAot/`), keyed on the app version, the engine and
  runtime paths and `jvm.options`. C1's move of the fixed options into
  `jvm.options` changes the key once, so every user retrains once.
- **The Rust parser's JNI library** (`enso_parser.dll`/`.so`/`.dylib`, built by
  sbt from `enso-parser-jni`) stays; it is JNI, not native image. Its
  `crt-static` build (`.cargo/config.toml`) needs no MSVC runtime.
- **Native libraries inside jars** stay.
  `test/{Base,Cloud}_Tests/data/native_libs.json` lists the JNI libraries
  embedded in jars (`libtruffleattach`, `libtrufflenfi`), and
  `Embedded_Native_Libs_Spec` checks that no other jar carries any (the rest are
  extracted to a library's `polyglot/lib`, which `NativeLibraryFinder` loads on
  the JVM). Neither is about the native image, and Workflow Lint's
  `checkNativeLibsFixtures` stays.

## Check before deleting

Each is a check in the PR that deletes the thing, with the result in its
description.

| Before deleting                                                   | Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MsvcRuntime`, `setup-msvc` (C2)                                  | Its 7 copied DLLs are not all for `enso.exe`: `component/` gets `vcruntime140`/`_1`, Snowflake's `polyglot/lib` and `python-home/lib-graalpython` get `vcruntime140` (its own doc comment). On a clean Windows VM without the Visual C++ redistributable, a JVM-only bundle without them opens a project, runs a Snowflake connection's driver load and a Python cell. If any fails, `MsvcRuntime` stays without the `bin/` part, and so does `setup-msvc` for packaging. |
| The release JDK's `NI_BASE_MODULES`, `lib/svm`, `lib/static` (C2) | A release bundle built without them: `java --list-modules` diffed, the JVM standard-library suite, one packaged-IDE open, a Python cell and a JavaScript cell. `org.graalvm.nativeimage` is also a jar in `component/`; the check confirms the system-image copy is not the one Truffle resolves.                                                                                                                                                                         |
| `stableEngine.ts`, the AppImage copy (C1)                         | A real AppImage (CI or WSLg): train the AOT cache with the shim's `java` through a `<userData>/engine/<version>` symlink, relaunch (a new mount), and check `use.log` is empty and the open is cached. The `java` launcher may resolve its own home through the real path, which would put the mount back into the cache's paths; then the copy stays.                                                                                                                    |
| `WindowsArguments` (C3)                                           | `java.exe` builds `args` from the ANSI command line. Open a project, and `enso --run` one, under a path with characters outside the ANSI code page (for example `C:\Users\Łukasz\` on a cp1252 system), from the IDE and from `enso.bat`. A spare's arguments arrive as JSON on stdin and are unaffected. If a path is mangled, the shim passes paths through the standby-style stdin line or an argument file, and the CLI case is documented.                           |
| `PosixWorkingDirectory`/`WindowsWorkingDirectory` (C3)            | See "The working directory" below.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Each `ImageInfo`/`isAot` branch (C3)                              | The JVM branch is the one the JVM suites already run; the PR shows, per site, that the deleted branch was unreachable on the JVM (`inImageRuntimeCode()` or `inImageBuildtimeCode()` is false there).                                                                                                                                                                                                                                                                     |
| `native_libs.json` (none)                                         | Checked in this design: JNI libraries in jars, kept.                                                                                                                                                                                                                                                                                                                                                                                                                      |

### The working directory

`EnsoContext.checkWorkingDirectory` expects the process's working directory to
be the project root's parent, and asserts it under `-ea`. The native image
honours that for any caller: `Utils.adjustCwdToProject` finds the project root
and calls `chdir` (`PosixWorkingDirectory`), keeping the user's directory in
`-Denso.user.dir`. A JVM cannot change its own working directory, so on the
shell launchers today `enso --run <project>` from elsewhere only warns (and
fails under `-ea`, the root `CLAUDE.md`'s first trap). The IDE is unaffected:
the shim already starts every engine in the project's parent.

For the CLI, C2's launchers take over what the image did: for `--run` and
`--in-project` they find the project root (the nearest ancestor with
`package.yaml`), `cd` to its parent, and pass the original directory as
`-Denso.user.dir`. That is a few lines in `sh`, more in `cmd`. If `enso.bat`
cannot do it reliably, the alternative is a launcher-side `java` helper class
run before the engine, which costs a second JVM start (open question 3).

## Testing per phase

- **A1.** `sbt compile "Test/compile"`, `runtime-integration-tests`,
  `runtime-language-epb` tests; a new test that a native-mode load of a non-AOT
  library fails with the message (against the `native,test` distribution the
  native engine build job uploads); the JVM standard-library suite and the moved
  `std-aws`/`std-microsoft`/`std-cloud-related` suites on `--jvm`; one
  packaged-IDE open of the `image` template on the JVM. Linux and Windows.
- **A2.** `sbt buildEngineBundle` with the default `ENSO_LAUNCHER`: no
  `org.enso.ydoc.server` library in `component/` (size saved recorded); the
  packaged-IDE tests (Node ydoc host); `gatherLicenses`.
- **A3.** Workflow Lint; the build-scripts tests; one dispatch of
  `std-libs-benchmark.yml` with `just-check` to show the benchmarks still build
  and run without the native runner.
- **B.** As stage 3: the re-gate report, the installer test, the packaged-IDE
  tests in both modes; plus the CLI measurement.
- **C1.** Shim unit tests: the command line (fixed list, `jvm.options`,
  `ENSO_JVM_OPTIONS`, module path, arguments) for open, run, standby, new,
  version and training; the shared option-parsing fixture against
  `JvmOptions.java`; a fake engine that checks its PID is the one the shim holds
  and that the stdin newline reaches it. The Playwright suite and the
  packaged-IDE tests on Linux (AppImage) and Windows; the AppImage check above.
- **C2.** A shell distribution on Linux, Windows and macOS: `--version`,
  `--new`, `--run` from the project's parent and from elsewhere, an option with
  spaces in `ENSO_JVM_OPTIONS`, a `jvm.options` with a BOM; the root
  `CLAUDE.md`'s by-hand recipe; the formatting job; `gatherLicenses`,
  `bloopInstall` and the manifest round-trip (root `CLAUDE.md`: a clean
  `sbt compile` proves none of them). The MSVC and JDK-module checks above.
- **C3.** Every JVM suite: `sbt test`, the standard-library suites on Linux,
  Windows and macOS, the packaged-IDE tests.
- **Throughout:** the root `CLAUDE.md`'s Linux rule. Paths, processes and
  quoting differ between the hosts, and C1 and C2 are about exactly those.

## Rollback per phase

- **A1, A2, A3:** each is a revert. Nothing on disk changes; no user setting
  depends on them. A1's revert restores guest hosting for native runs.
- **B:** as stage 3: `ENSO_ENGINE_MODE=native`, `--engine-mode=native` or
  `jvm: false` per user or project, without a release; the default flips back in
  one line with one.
- **C:** one release after B, so a user who needed native has had a release to
  say so. C1 is revertible on its own (the shim goes back to `bin/enso`). C2/C3
  delete the build of native; undoing them means reverting the PRs and
  rebuilding, so they go only after C1 has been on nightlies without an issue.
  If a JVM-only defect appears after a release, it is fixed forward; there is no
  native to fall back to, which is the point of the one-release wait.

## Risks

- **Guest libraries on native between A1 and C.** A native open or CLI run of a
  project that uses Image, Postgres, AWS, Google, Microsoft, Snowflake, Tableau,
  Saas, Generic_JDBC or SQLite fails with a message instead of working slowly.
  In the IDE that matters only while native is the default (A1 to B) and for
  users who flip back after B.
- **CLI users.** Start-up becomes a JVM start with CDS but no AOT cache. Scripts
  that call `enso` many times in a row slow down by the measured difference
  (Phase B report). The process is `java`, not `enso`, in process lists.
- **Libraries relying on the AOT rules.** None declares AOT readiness (it is
  recorded only at image build time), so removing it changes no library's
  behaviour on the JVM, where everything is hosted already. The Enso-side
  crossing rules stay harmless until their follow-up ticket.
- **Coverage while native still ships.** After A3, native standard-library
  regressions between A3 and C are caught only by the packaged-IDE tests in
  native mode. Native is the default only until B and the escape hatch after it,
  so this is accepted.
- **Windows command lines.** `WindowsArguments` existed for the image; whether
  `java.exe` loses non-ANSI characters in paths is checked before C3, with the
  stdin-line fallback for the shim.
- **The AppImage copy.** If the symlink check fails, the 1.8 GB copy stays, with
  its disk-space rules.
- **MSVC runtime.** If the clean-VM check fails, `MsvcRuntime` and `setup-msvc`
  stay for the non-launcher DLLs.
- **CI time.** It falls (the native image builds, the native suites, the ydoc
  image), but the JVM suites that replace native coverage (`std-aws` and the
  others on `--jvm`) run at JVM speed. Each Phase A and C PR reports the
  durations it removed and added.
- **P's native work.** Until A3 and C, P's bumps still keep the native build
  green "minimally"; every phase that lands first shrinks what that means.

## Order with the GraalVM upgrade (P, #661)

```
P PR1 ─ P PR2 ─ P PR3 (25.5) ─ re-gate ─ B (switch) ── one release ── C1 ─ C2 ─ C3 ─ C4
      A2, A3 (now, in any order)        └─ A1 (after PR M and the re-gate's native baseline)
```

- A2 and A3 can land now, before or between P's PRs. Each removes work P's PR 3
  would otherwise keep green (the ydoc image, the native suites).
- A1 after PR M and after the re-gate's native `image` measurement (or with the
  pre-A1 baseline). If it lands before P's PR 3, PR 3 no longer needs
  `jvm-interop`'s `Message.resolve` fix (P's API table).
- B after P's PR 3 and the re-gate, as P fixes.
- C one release after B.

## Out of scope

- An AOT cache for the CLI (decision 3); Leyden JEPs 516/544, which need a JDK
  GraalVM does not ship yet.
- Espresso and Crema.
- A launcher written in a native language (a small Rust or C stub). The shell
  launchers and the shim's direct `java` cover the IDE and the CLI (decision 1).
- Heap sizing; the JVM-by-default spec's RSS reporting stays as it is.

## Open questions for the owner

1. **PR M now?** A1 cannot delete jvm-interop while `YdocServerImpl` uses it,
   and PR M (deleting the engine-hosted ydoc server) waits for a release with
   the Node host. _Recommendation:_ if no one has needed
   `ENSO_YDOC_HOST=engine`, fold PR M into A2 now. Otherwise A2 removes only the
   image, and A1 waits for PR M.
2. **Releases between A1 and B.** The IDE's default is still native then, so a
   project using a guest library fails to open until the user sets `jvm: true`
   or `ENSO_ENGINE_MODE=jvm`. _Recommendation:_ cut no release between A1 and B.
   If one is needed, revert A1 on the release branch only.
3. **The CLI's working directory.** On the JVM, `enso --run <project>` from
   another directory no longer changes to the project's parent.
   _Recommendation:_ the shell launchers find the project root and `cd`, passing
   `-Denso.user.dir`, as the native image did; a second JVM start only if
   `enso.bat` cannot do it reliably.
