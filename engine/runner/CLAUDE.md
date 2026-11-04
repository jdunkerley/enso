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
