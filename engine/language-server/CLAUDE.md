# engine/language-server

The Enso Language Server (LS). Embedder-side service that owns a GraalVM
polyglot `Context` running the Enso runtime and exposes its capabilities over
**JSON-RPC (text protocol)** and a **binary protocol** for data links. The GUI
reaches the server only through the ydoc server. The ydoc server runs in Node
and connects to the channel sockets below, or runs inside this process when
`LANGUAGE_SERVER_YDOC_PORT` is set (it has no default); the `--rpc-port`
JSON-RPC listener (default 8080) is still bound directly.

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
`search/invalidateSuggestionsDatabase`), `SuggestionsHandler` inserts the
`catalogue.json` entries of every installed library the project resolves that
the runtime has not loaded, once the first execution has completed or failed (or
30 s after the clear, if none does), so they neither delay it nor include the
libraries it loads (`InstalledCatalogues`, the listing of
`InstalledLibraries.find`), marked `fromCatalogue: true`, and swaps them for the
real suggestions when the library loads. See Note [Catalogue Entries In The
Suggestions Database] in `SuggestionsHandler` and Note [Library Catalogue] in
`TruffleCompilerContext`. A stale, corrupt or missing catalogue is skipped with
a warning in the log, an undecodable or duplicate entry likewise (the rest of
the library's entries still go in), and a library declaring `catalogue: false`
in its `package.yaml` (Visualization) is skipped quietly.

## Library load failures

The runtime sends `Api.LibraryLoadFailed` once per library it cannot load.
`JsonConnectionController` forwards it to its client as `library/loadFailed`;
`LibraryLoadFailures` (an actor `MainModule` creates before the runtime starts)
keeps them for `library/listLoadFailures`, which also starts with an
`EditionNotFound` entry when the project's edition does not resolve. The
listings that need the project's edition (`library/listPublicTypes`, the
catalogues) use
`EditionReferenceResolver.resolveCurrentProjectEditionOrDefault`, which falls
back to the default edition as the runtime does; never `.get` the project's own
edition there.

## Suggestions database snapshot

`search/getSuggestionsDatabase` is answered only after the runtime has
invalidated its index and the repository is clean, with the clean repository's
version; the clean moves the version on. A client applies only the update
notifications not older than that version, so those of updates applied before
the clean (whose entries it removed) are dropped. See Note [The Snapshot Follows
The Clear] in `SuggestionsHandler` (#477).

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

**Channel sockets.** `YjsChannelEndpoint` serves the ydoc server's four channels
as WebSockets on the RPC port:
`/channel/{json,binary,vis-control,vis-data}?token=<t>` (text frames are
`String`s, binary frames `ByteBuffer`s). The token is
`LANGUAGE_SERVER_CHANNEL_TOKEN` (`language-server.channel-token`), a random
string per engine start; it is compared in constant time, never logged, and an
engine started without one refuses every channel socket (`403`; an unknown kind
is `404`). Also refused with `403`, before the token is looked at: a peer that
is not on loopback (the connection's own remote address, never
`X-Forwarded-For`; needs `remote-address-attribute = on`, set in
`application-ls.conf`) and a handshake from a web page (an `Origin` header, or a
`Sec-Fetch-Site` other than `none`). A blank token is no token. Inbound messages
for a handler that has not subscribed yet are kept (the newest 1024 per
channel). See Note [The Channel Socket].

**The RPC port refuses web pages.** The HTTP routes that change state,
`POST /refactoring/renameProject` and `POST /_idle/reset`, answer `403` to a
request with an `Origin` header or a `Sec-Fetch-Site` other than `none`, before
the body is read: a cross-site `text/plain` form `POST` needs no CORS preflight
(#613). Their caller, the shim's Node `fetch`, sends neither (it does send
`Sec-Fetch-Mode: cors`, which is not looked at). One helper, `BrowserPageGuard`,
serves these routes and the channel sockets; see Note [The RPC Port Refuses Web
Pages]. A new state-changing route takes `refuseBrowserPages` too.
`renameProject` also answers `415` to a body that is not `application/json`,
which a browser sends only after a CORS preflight (never answered here), so even
an old browser that sends no `Origin` cannot post it.

A session opens **two** `json` sockets (the ydoc server's proxy channel for the
GUI and its backend channel); each socket is its own channel and controller. The
visualization bridge drops a control or data channel when it closes (unless a
newer one replaced it): a closed channel is a normal end, logged at trace.

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

At startup `StartupWarmUp` reads the jar manifests and sets up the default SSL
context on a background thread, ahead of Akka doing both on the main thread
(Note [Startup Warm-Up]).

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
