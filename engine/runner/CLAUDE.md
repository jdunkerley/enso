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
the `enso` native image. The open-time harness reads the same file when it
starts `java` itself (`app/electron-client/perf/jvmAotCache.ts`).
