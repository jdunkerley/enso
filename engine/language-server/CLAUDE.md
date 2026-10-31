# engine/language-server

The Enso Language Server (LS). Embedder-side service that owns a GraalVM
polyglot `Context` running the Enso runtime and exposes its capabilities over
**JSON-RPC (text protocol)** and a **binary protocol** for data links. The GUI
reaches the server only through the ydoc server that runs inside this process;
the `--rpc-port` JSON-RPC listener (default 8080) is still bound directly.

Read `README.md` here and
[Language-Server](https://github.com/jdunkerley/enso/wiki/Language-Server) for
the full protocol and design notes.

## Responsibilities

- Manage project state, open files, and Yjs-backed text sessions (via
  `ydoc-server-polyglot`).
- Expose code execution, node management, introspection, completion and
  renaming. There is no find-usages, jump-to-definition or type-interaction
  endpoint.
- Talk to the runtime via `polyglot-api` messages through
  `RuntimeServerInstrument` (the Truffle instrument attached to the runtime).
- Serve binary data links (file upload/download) over the ydoc server's binary
  channel. Visualization attach/detach/modify and one-shot expression evaluation
  go through a Yjs subdoc synced by the ydoc server, not JSON-RPC.

## Library catalogues

When the suggestion database is filled (project open, or
`search/invalidateSuggestionsDatabase`), `SuggestionsHandler` first inserts the
`catalogue.json` entries of every installed library the project resolves that
the runtime has not loaded (`InstalledCatalogues`, the listing of
`InstalledLibraries.find`), marked `fromCatalogue: true`, and swaps them for the
real suggestions when the library loads. See Note [Catalogue Entries In The
Suggestions Database] in `SuggestionsHandler` and Note [Library Catalogue] in
`TruffleCompilerContext`. A stale, corrupt or missing catalogue is skipped with
a warning in the log, an undecodable or duplicate entry likewise (the rest of
the library's entries still go in), and a library declaring `catalogue: false`
in its `package.yaml` (Visualization) is skipped quietly.

## Source layout

- `src/main/java/` — Java code: JSON-RPC endpoints, handlers, data-link
  protocol.
- `src/main/scala/` — Scala code: session/project management, higher-level
  services (text, suggestions, libraries).
- `src/main/resources/` — Static resources (logging config, protocol schemas).
- `src/main/schema/` — Flatbuffers schemas for the binary protocol. Generated
  bindings are checked in.
- `src/test/` — Scalatest + integration specs (each endpoint gets a spec).
- `src/bench/` — JMH benchmarks for hot protocol paths.

## Protocol

- **Text**: JSON-RPC 2.0 over WebSocket. Endpoints defined per feature (e.g.
  `text/applyEdit`, `session/initProtocolConnection`,
  `search/getSuggestionsDatabase`).
- **Binary**: Flatbuffers envelopes over WebSocket. Used for bulk data
  transfers.
- **Ydoc**: Yjs updates tunneled via a binary channel. When enabled, text
  protocol is still active but most edits ride on Yjs.

See [Language-Server](https://github.com/jdunkerley/enso/wiki/Language-Server)
for every endpoint's schema.

**A method needs two registrations.** `JsonRpc.scala` declares it to the
protocol (so its params parse); `JsonConnectionController` maps it to a handler.
A method in the first list but not the second parses and is then never answered
— that is how `search/completion` sat dead until #370. Check both when adding or
removing an endpoint, and grep the GUI (`app/ydoc-shared/` `languageServer.ts`)
and its Playwright mock (`app/gui/integration-test/mock/`) for callers.

## Threading

The LS uses Akka. Each client maintains an actor per concern (session,
suggestions, text, etc.). The runtime runs on its own thread(s) via Truffle.
Don't block Akka receivers on runtime calls — dispatch via `ask` / futures.

## Running standalone

```
sbt language-server/test    # integration tests
sbt language-server/bench   # benches
```

To start the server itself:

```
sbt language-server/run
```

Configured by `--log-level trace` during debugging. Expect a lot of output.
