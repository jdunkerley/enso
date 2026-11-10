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

The `enso` native image creates the JVM in its own process through JNI, except
on Linux, where since GraalVM 25.5 it starts `java` as a process (the image
exports `JVM_IsStaticallyLinked`, and an in-process JVM then never loads
libnio). `Main.launchJvm` starts the JVM with a fixed option list, then appends
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

`enso --jvm --standby` is the IDE's spare engine (spec
`docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`; Note [Standby
Mode] in `Standby.java`). It starts the JVM as `--jvm` does, then on a
background thread runs `StandbyWarmUp` (a throwaway context on a temporary copy
of the default template whose `Main` imports Base, Table, Database, Examples and
Visualization, builds, filters, aggregates and sorts a table and prepares its
visualization) and `StandbyPreloader`. It prints the markers
`standby: warm-up running`, `standby: warm-up finished` (or
`standby: warm-up abandoned`),
`standby: warm-up done in N ms, <preloading>, process CPU C ms` and
`STANDBY READY <ms since process start>` on stderr.

It then reads one line from stdin (`Standby.awaitRequest(System.in)`, the same
stream object the Language Server later reads its shutdown line from: never a
reader or a fresh stream over the descriptor): `{"args":[...],"env":{...}}`
(`StandbyRequest`), the arguments `project/open` would have passed. The line is
refused unless it is a `--server` line without `--standby`, `--jvm`,
`--in-project` or `--run`, and its `--path` must be absolute and not a
filesystem root. `env` accepts only `LANGUAGE_SERVER_YDOC_PORT` and
`LANGUAGE_SERVER_CHANNEL_TOKEN` (set as the `language-server.*` configuration
properties) and `ENSO_LOCAL_PROJECT_ID` and `ENSO_LOCAL_PROJECT_SESSION_ID` (set
as `enso.env.<NAME>`, read through `org.enso.common.ProcessEnvironment`). Any
code that reads one of those four from the environment must read it the same
way. The spare's spawn environment must not carry
`LANGUAGE_SERVER_CHANNEL_TOKEN` or `LANGUAGE_SERVER_YDOC_PORT` (the
configuration prefers the environment, so the engine refuses a line that sets
one of them while it is inherited); only the four names go in the line, and
everything else (the secrets key, other variables) goes in the spawn
environment. It then sets the context's working directory
(`enso.context.workingDirectory`, applied by `ContextFactory`) to the parent of
`--path` and calls `launch` with the arguments. A closed stdin before the line
exits with 0.

- Until the line the root logger is at WARN (`Standby.quietLogging`; no appender
  is installed), because the Language Server sets up logging itself. Messages
  before it are stderr lines (`standby: warning: warm-up failed: …`).
- The warm-up's project is `local.Enso_Standby_Warm_Up`, a reserved name; the IR
  cache the compiler writes for it under `<data>/cache/ir/local/` is deleted
  with its folder after the warm-up.
- `--vm.D enso.standby.warmUp=false` skips the warm-up (tests);
  `--vm.D enso.standby.abandonWarmUp=false` waits for a running warm-up when the
  line arrives instead of cancelling it, which is the default since #659
  (measured at 8 CPUs, an open that waited for the warm-up was slower than a
  cold start; one that cancelled it was faster).
- The preload list (`src/main/resources/org/enso/runner/standby-preload.txt`) is
  generated: run a Language Server boot without an AOT cache with
  `JAVA_TOOL_OPTIONS=-Xlog:class+load=info:file=<log>` (the shell launcher of
  `built-distribution/` does not read `ENSO_JVM_OPTIONS`), then
  `node tools/standby-preload/generate.mjs <log> <the list>`. Classes that have
  gone are skipped at run time; regenerate it when a release's count drops
  noticeably (the standby line says `preloaded N of M classes`). It is skipped
  when the JVM runs with an AOT cache, which already holds those classes. The
  cache is seen only in `jvm.options` and `ENSO_JVM_OPTIONS` (`JvmOptions.all`);
  one given through `JAVA_TOOL_OPTIONS` is not seen and only causes a needless
  preload. A `jvm.options` that cannot be read only turns preloading off
  (`Standby.preloadFor` logs a warning).
- **The process's working directory is the temporary directory**, and the JVM's
  cannot be changed once it runs. Enso therefore resolves against the context's
  working directory (the project's parent), not the process's, wherever it can:
  `File_Helpers.get_file` (every relative local `File`, made absolute in a
  standby engine), `File.current_directory`, and `Process.run` without a
  directory (`System.create_process`). The builtin
  `System.working_directory_override` answers the context's directory only when
  the `enso.context.workingDirectory` property is set, never by comparing paths.
  Known differences from a normal engine: a relative `File` shows its absolute
  path; Java code handed a raw relative string (user code through
  `polyglot java import`) resolves it against the temporary directory; and
  `File.resolve_local_file` sees a relative path as absolute, so it skips the
  cloud-project branch (never reached in the local-only IDE). Any new engine or
  std-bits code that resolves a path against the process (`user.dir`, `Path.of`
  of a relative string, a `ProcessBuilder` without a directory) must go through
  the context's working directory instead.
- With `abandonWarmUp=false`, a warm-up still running 60 s after the line is
  cancelled (`standby: warm-up abandoned after 60 s`); an abandoned warm-up that
  ignores its cancel for 60 s is waited for, with
  `standby: warning: the abandoned warm-up did not stop within 60 s`, and is not
  cancelled again. A value other than `false` (any case) abandons, so a typo
  keeps the default (`Standby.abandonOnLine`). A bad line, or stdin closing
  before the line, cancels a running warm-up and waits for it before the process
  exits, so its folder is deleted. After stdin closes that wait is at most 10 s
  (`Standby.CLOSE_WAIT`; the IDE may be quitting): a warm-up still running then
  is left to the exit, with a
  `standby: warning: the cancelled warm-up did not stop within 10 s` line. The
  warm-up's folder and cache are deleted file by file: what cannot be (a file
  still open on Windows) is left, with one warning line.
- Tests:
  - `StandbyRequestTest` (`StandbyRequest`, `StandbyJson`): the grammar; errors
    never echo a value (a sentinel in each malformed form).
  - `StandbyTest`: the wait (the line before and after the warm-up, abandon, the
    60 s limit, a bad line or a closed stdin stopping a running warm-up, stdin
    closed first, the bounded wait for a warm-up that ignores its cancel, an
    abandoned warm-up cancelled only once, `abandonOnLine`, `readLine` leaving
    the rest of stdin), and an unreadable `jvm.options`.
  - `StandbyPreloaderTest`: the list and the AOT-cache skip.
  - `StandbyWarmUpTest`: a cancel before the run, and deletion that goes on past
    an undeletable file.
  - `ContextWorkingDirectoryTest` (runtime-integration-tests): the context's
    working directory.
  - `StandbyProcessTest` runs the real `built-distribution/` (CI's JVM tests
    build one with `buildEngineDistributionNoIndex`; skipped without one): no
    warm-up, a full warm-up (only library caches written, no log lines on
    stdout), a warm-up abandoned mid-run, stdin closed first, and the refused
    lines (relative path, filesystem root, not a `--server` line, an inherited
    channel token).
