# lib/java

Java support libraries for the engine. Two shapes live together here:

1. **Third-party wrappers** (`*-wrapper`) — Shim modules that re-export a vendor
   dependency (Akka, Netty epoll, JLine, JNA, OpenCV, Apache POI, gRPC, DuckDB,
   Scala stdlib, fansi, zio, `sqlite-jdbc`, `conscrypt`, Tableau, …) with a
   `module-info.java` that makes them JPMS-friendly. The engine is a JPMS
   application, so every non-modular dep must pass through a wrapper.
2. **First-party modules** — real engine components that happen to be written in
   Java:
   - `interpreter-dsl/` — annotation processor that generates Truffle `Node`
     boilerplate (`@BuiltinMethod`, `@Specialization`, etc.).
   - `persistance/` + `persistance-dsl/` — custom serialization framework used
     by `engine/polyglot-api/` and IR caches. Annotation-driven.
   - `os-environment/` — OS-specific helpers: the user's directories
     (`Directories`) and, on Windows, `main`'s arguments recovered from the wide
     command line (`Arguments`, `WindowsArguments`; Note [Arguments Outside The
     ANSI Code Page]). Its `@CFunction` code (working directory, trash bin) and
     `jvm-channel/` and `os-environment-lib/` went with the native image
     (#664, C3).
   - `ydoc-api/` — `YjsChannel`, the channel between the Language Server and the
     (Node) ydoc server, served over the channel sockets.
   - `ydoc-polyfill/` — Web/Node API polyfills and the parser functions for
     GraalJS, which EPB (`runtime-language-epb`) installs in its JavaScript
     context. The engine-hosted ydoc server (`ydoc-server`,
     `ydoc-server-registration`) that they were written for is gone.
   - `logging-service-common/`, `logging-service-opensearch/`,
     `logging-service-telemetry/` — pluggable logging sinks.
   - `python-extract/`, `benchmarks-common/`, `runtime-utils/`, `test-utils/` —
     small helpers.

## Adding a JPMS wrapper

1. Create `lib/java/<thing>-wrapper/` with `build.sbt` project definition (see
   `build.sbt` + `project/JPMSPlugin.scala`).
2. Declare a `module-info.java` that `requires transitive` the underlying
   automatic module.
3. Register the module in the engine's module graph (`project/JPMSUtils.scala`).
4. If the original jar ships an `Automatic-Module-Name`, use that; otherwise
   open a named module and document why.

## Style

Follow
[Style-Guide-Java](https://github.com/jdunkerley/enso/wiki/Style-Guide-Java).
Wrappers should contain _zero_ logic — only module declarations.
