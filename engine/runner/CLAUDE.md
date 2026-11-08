# engine/runner

The CLI entry point for the engine. This is the **embedder-side** code that
constructs a GraalVM polyglot `Context`, initializes `EnsoLanguage`, and runs
user code (scripts, REPLs, tests, documentation).

## Structure

- `src/main/java/` — Main class, option parsing, project execution.
- `jupyter-kernel/` — Enso Jupyter kernel built on top of the runner.

## Embedder vs language

Only one `org.graalvm.polyglot` import boundary per process. The runner is the
**only** place that may depend on `graal-sdk` for polyglot APIs. Everything it
needs from the language comes back through `Value`.

## How it talks to the runtime

- Sets runtime options via `Context.Builder` (see `OptionsHelper` /
  `RuntimeOptions` in `engine/common`).
- Passes arguments / environment as context options.
- Drives execution by calling methods through `Value` using stringly-typed
  method names that match language-side registrations (chase constants across
  the boundary when debugging).

## Native Image

The runner is compiled to a native binary via Native Image for the `enso`
command (see
[Infrastructure-Native-Image](https://github.com/jdunkerley/enso/wiki/Infrastructure-Native-Image)).
Avoid anything that's not Native-Image-friendly (e.g. dynamic class loading,
reflection without config).

`EnsoLibraryFeature` decides which standard libraries are hosted in the image:
those whose `polyglot/java` jars are on the image class path, plus the Java-free
libraries `build.sbt` names in `enso.nativeImage.javaFreeLibraries`
(`Standard.XML`, whose imports are all JDK classes). It registers every
`polyglot java import` of those libraries for reflection and marks them
AOT-ready; any other library loads its Java in the guest JVM. See Note
[Java-Free Libraries In The Image] in `build.sbt`.

## JVM mode (`--jvm`)

`Main.launchJvm` starts the JVM with a fixed option list, then appends
`JvmOptions.all(component, System.getenv("ENSO_JVM_OPTIONS"))`, in this order:

1. `jvm.options` in the engine package root, beside `component/` (source
   `distribution/engine/jvm.options`, copied by `DistributionPackage` and
   required by `EngineDistributionChecks`): one option per line, `#` comments
   and blank lines ignored. It is the engine's, so the IDE and the CLI both get
   it.
2. `ENSO_JVM_OPTIONS`. A value containing a newline is split on newlines, so an
   option may contain spaces (a path under `C:\Users\John Smith\`, a quoted
   `-Xlog:…:file="…"`); the IDE's project-manager shim always writes it that
   way. A value without a newline is split on whitespace, which is what a person
   types.

Both come after the fixed list and before `--module-path`/`-m`. Keep
`JvmOptions` Native-Image friendly (plain `java.io`/`java.nio` only): it runs in
the `enso` native image. The shim's AOT trainer reads the same file when it
starts `java` itself (`app/project-manager-shim/src/jvmAot/trainer.ts`).

Rules for an option line (in the file or in `ENSO_JVM_OPTIONS`):

- It must be a JVM option, not a `java`-launcher one, in single-token form with
  `=`: `--add-opens=java.base/java.nio=ALL-UNNAMED`, never
  `--add-opens java.base/java.nio=…`, and no `@argfile`, `-jar` or `-cp`. On the
  native `enso` (the JNI path) each line becomes one `JavaVMOption`, which the
  launcher's own argument parsing never sees.
- The quoted form `-Xlog:…:file="C:\Users\John Smith\use.log"` is for the JNI
  path only (the `enso` native image, which is what the IDE runs). Where a JVM
  runs the runner and relaunches through `ProcessBuilder` (`--jvm <other JDK>`),
  Windows' argument quoting splits such an argument at its space; write the path
  unquoted there.
- A leading UTF-8 byte order mark is ignored.

The shell launchers `distribution/bin/enso` and `enso.bat` start the JVM
themselves and `--jvm` does not relaunch from them, so `Main.launchJvm` is not
involved: they read `jvm.options` on their own (`enso` with the same rules;
`enso.bat` skips blank, whitespace-only and `#` lines, also indented ones, trims
leading and trailing spaces and quotes each line, so `^ % ! & | < >` and spaces
survive literally; it does not support a byte order mark, a double quote or a
single quote in an option). They do not read `ENSO_JVM_OPTIONS`.

## Standby mode (`--standby`)

The IDE's spare engine; the design is in Note [Standby Mode] in `Standby.java`
and the spec `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`.
`StandbyPreloader` loads (without initialising) the classes listed in
`src/main/resources/org/enso/runner/standby-preload.txt`, the ones a Language
Server boot loads. The list is generated, not written: boot a Language Server
from a distribution built without an AOT cache, with
`JAVA_TOOL_OPTIONS=-Xlog:class+load=info:file=<log>`, then run
`node tools/standby-preload/generate.mjs <log> <list>`. Regenerate it when a
boot's classes change a lot. Preloading is skipped when `jvm.options` or
`ENSO_JVM_OPTIONS` carry `-XX:AOTCache=` or `-XX:SharedArchiveFile=` (the cache
holds the classes); a cache passed through `JAVA_TOOL_OPTIONS` is not seen and
only costs a needless preload.

`Main` handles `--standby` in `runStandby`: `Standby.awaitRequest(System.in)`
(the same stream object the Language Server later reads its shutdown line from;
never a reader or a fresh stream over the descriptor), then the line must start
a Language Server (`--server`, no `--standby`, `--jvm`, `--in-project` or
`--run`), its `--path` must be absolute and not a filesystem root, its variables
are applied, the context's working directory becomes the project's parent, and
`launch` runs again with the line's arguments. Until the line the root logger's
level is WARN (`Standby.quietLogging`; no appender is installed). A
`jvm.options` that cannot be read only turns preloading off
(`Standby.preloadFor` logs a warning). The warm-up's project is
`local.Enso_Standby_Warm_Up`; the IR cache the compiler writes for it under
`<data>/cache/ir/local/` is deleted with its folder. `StandbyProcessTest` runs
the real `built-distribution/` (`sbt buildEngineDistribution`) and is skipped
without one; it covers no warm-up, a full warm-up and a warm-up abandoned
mid-run.
