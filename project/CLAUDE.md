# project/

SBT meta-build: plugins, helpers, and task definitions that drive `build.sbt`.
Every non-trivial build concern the engine has lives here as a Scala file.

## High-impact files

- `JPMSPlugin.scala` + `JPMSUtils.scala` — Generates JPMS `--module-path`,
  `--add-modules`, patches, and exports for every SBT project with
  `.enablePlugins(JPMSPlugin)`. The engine is a JPMS app; touching modules
  without this plugin produces broken runtimes. See in-file docstring.
- `FrgaalJavaCompiler.scala` — Wires up the [Frgaal](https://frgaal.org/) Java
  compiler so we can use modern Java language features while targeting older
  bytecode versions.
- `GraalVM.scala` — Graal detection and options. The native image is no longer
  built (native-image removal C2, #683): `NativeImage.scala` and `ENSO_LAUNCHER`
  are gone, and the distribution's launchers are always the shell scripts in
  `distribution/bin`.
- `Cargo.scala` — Calls into the Rust workspace (for parser JNI + wasm).
- `GenerateFlatbuffers.scala` — Runs `flatc` from the `PATH` (at the version in
  `flatbuffersVersion`, `project/Dependencies.scala`) to generate the LS
  binary-protocol bindings.
- `Distribution.scala` + `DistributionPackage.scala` — Produces the engine
  distribution directory layout (matches `distribution/`). `indexStdLibs`
  re-indexes a library whose sources changed or that has no `catalogue.json`
  (unless its `package.yaml` says `catalogue: false`), and drops those
  libraries' bindings caches first: on Windows a memory-mapped one cannot be
  overwritten later in the same indexing process.
  `EngineBundle.librariesNotBundled` names the standard libraries the IDE bundle
  leaves out (and `IRCaches.checkCacheSizes` does not count):
  `Database_Test_Suite`. `createEnginePackage` also copies
  `distribution/engine/jvm.options` to the package root (beside `component/`),
  and `EngineDistributionChecks.afterBuild` fails when it is missing: the
  launcher (`engine/runner` `JvmOptions`) and the shell launchers read it.
- `Editions.scala` — Edition-manifest generation (fills in the versions of
  `distribution/edition.template.yaml`).
- `GatherLicenses.scala` — Drives the legal-review report and checks
  (`gatherLicenses`, `verifyLicensePackages`); the dependency list comes from
  each project's coursier `update` report (`src/main/scala/licenses/`, see
  `tools/legal-review/CLAUDE.md`). `sbt-license-report` only supplies its
  licence types and settings.
- `IRCaches.scala` — Compiles IR caches that ship with the stdlib for fast
  startup.
- `EnsoLint.scala` — Project-wide lint rules invoked as an SBT task.
- `EnsoProjects.scala` — Shared project-configuration DSL used by `build.sbt`.
- `SmallJDK.scala` — Builds a trimmed JDK image for the distribution: jlink of
  named JDK modules only, with no module path and nothing copied from the build
  JDK's `lib/` (the native-image modules and `lib/svm`, `lib/static`,
  `lib/graalvm`, `lib/truffle` went in #701). The modules Truffle's optimizing
  runtime needs are listed explicitly (Note [The Release JDK's Truffle
  Modules]); check `Truffle.getRuntime().getName()` (not `Interpreted`) after
  changing them. Its jlink run passes `--generate-cds-archive`, so the image
  carries `lib/server/classes*.jsa` (`bin/server` on Windows; class-data sharing
  for the jlinked modules); `checkSharing` runs `java -Xshare:on -version` on it
  and fails `buildEngineBundle` when the archive does not map. On Windows it
  embeds `java-utf8.manifest` in the image's `java.exe` and `javaw.exe` first
  (`JavaUtf8Manifest.scala`, Note [The Bundled java.exe Uses UTF-8], #693): a
  UTF-8 `activeCodePage`, merged into their own manifest with `mt.exe`, so the
  JVM's options keep characters outside the ANSI code page. `mt.exe` comes from
  the PATH, else the newest `Windows Kits\10\bin\<version>\x64`; the build fails
  when there is none, the merge loses an element, or the result does not run
  with `sun.jnu.encoding = UTF-8`. It drops the launchers' Oracle signature.
- `AntlrSources.scala` — Strips the absolute grammar path from the header
  comment of the Java that sbt-antlr4 generates for `std-table` (Note [ANTLR
  Output Has No Absolute Paths], #696): javac reads a backslash followed by `u`
  in that path as a unicode escape, comments included, so a checkout under such
  a directory failed to compile.
- `Dependencies.scala` — Central dependency version catalog.
- `plugins.sbt` — SBT plugin versions. Pinned to known-good combinations; don't
  bump casually.

## Conventions

- Any reusable build step goes into a plugin or an object here, not inline in
  `build.sbt`.
- Scala 2 syntax (SBT's version). Don't try to import Scala 3 features.
- When adding a new JPMS module, wire it through `JPMSPlugin` — don't hand-roll
  module flags.

## Testing

- The meta-build has no test sources and no test framework on its classpath
  (`project/plugins.sbt` adds none), so there is no seam for unit-testing code
  here. Loading the build (any `sbt` command) compiles it; that is the check.
