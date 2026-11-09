# ydoc-server

Yjs server that bridges the Enso Language Server and GUI clients (Yjs/CRDT over
WebSocket). It runs in Node beside the engine (`NodeYdocHost`, "Node host"
below): in the IDE in an Electron utility process, under `dev:vite` in the dev
server itself, reaching the Language Server over its channel sockets. Under
`ENSO_YDOC_HOST=engine` (the one-release rollback) it still runs inside the
engine's JVM via `ydoc-server-polyglot` (GraalJS), through in-process channel
callbacks. The Playwright mocks (`gui/integration-test/mock/localApi.ts`) use
its `WSSharedDoc`/`YjsConnection` directly. It holds a Yjs document per opened
Enso module and reconciles local edits with LS file state.

## Role in the architecture

```
GUI (ydoc client) <--Yjs-->  ydoc-server  <--LS JSON-RPC-->  Language Server
```

The GUI never touches the raw LS text protocol — it only mutates a Yjs document.
This server:

- Accepts Yjs updates from clients via `y-protocols` / `y-websocket`.
- Diffs them against its in-memory copy of the file, emits `text/applyEdit` to
  the LS, and serializes LS notifications (`text/didChange`, file open/close)
  back into Yjs updates.
- Acts as the collaborative merge point: multiple GUI clients pointing at the
  same project converge here.

## Companion packages

- `ydoc-shared/` — types and the AST module shared with clients.
- `ydoc-channel/` — thin Yjs transport wrapper used by both sides.
- `ydoc-server-polyglot/` — this very server, but re-bundled for GraalJS so it
  can run _inside_ the engine's JVM process. If you change server behavior,
  build/test both variants.
- `ydoc-inspect/` — dev proxy that dumps all traffic; use it when debugging sync
  bugs.

## Source layout

- `src/ydoc.ts` — entry, sets up the WebSocket listener and per-doc session
  state.
- `src/languageServerSession.ts` — one session per open project; owns the LS
  JSON-RPC client.
- `src/edits.ts` — translation between Yjs operations and LS `TextEdit`s (via
  `fast-diff`).
- `src/serialization.ts` — binary ydoc wire format.
- `src/auth.ts` — token validation; shared with the cloud.
- `src/fileFormat.ts` — Enso `.enso` file serialization.
- `src/YjsBinaryChannel.ts` — custom binary channel over Yjs (for metadata the
  engine doesn't parse).
- `src/nodeHost.ts`, `src/remoteChannelServer.ts`, `src/nodeByteBuffer.ts` — the
  Node host (see "Node host" below).
- `src/inspect.ts` — developer instrumentation; gated by env vars and used by
  `ydoc-inspect`.

## Running

- In the IDE: Electron's utility process (`electron-client/src/ydocHost/`) hosts
  one listener per opened project; the project-manager shim asks it to listen
  before it starts the engine (`project-manager-shim/CLAUDE.md`, "ydoc host").
- In dev: `dev:vite` hosts it in the dev server's own Node: `vite.config.ts`
  loads this package through Vite's SSR loader (`ssrYdocHost`; the compiled
  `dist/` does not run in plain Node) and hands the shim middleware a
  `NodeYdocHost`. The GUI takes each project's ydoc address from `project/open`.
  A change here reaches the next opened project after a dev server restart (the
  host is created once).
- `ENSO_YDOC_HOST=engine` (rollback, one release): the engine serves ydoc on the
  port the shim passes as `LANGUAGE_SERVER_YDOC_PORT`; a hand-started
  `enso --server` serves none unless that variable is set.
- Standalone: `pnpm run dev:inspect` runs the server through `ydoc-inspect`.
- Polyglot (inside engine): see `ydoc-server-polyglot/`.

## Gotchas

- The LS is authoritative for file contents at rest — Yjs is authoritative only
  while a session is live. On reconnect, the server may need to re-seed the Yjs
  doc from LS state; see `languageServerSession.ts`.
- Binary messages use a custom framing (`YjsBinaryChannel`); don't assume plain
  Yjs awareness protocol works end-to-end.
- **The binary data channel is shared and reference-counted, not per socket.**
  The GUI opens its data channel (`gui-data-<uuid>`) on the index doc but sends
  the same `data` parameter on every doc's socket (index, modules, the
  visualization subdoc). `setupGatewayClient` therefore takes a reference with
  `YjsBinaryChannel.acquire` on the session's index doc and `release`s it when
  its socket closes; the channel closes with the last reference, and the next
  `acquire` makes a fresh one (a new Language Server connection). A plain
  forever-cache closed on any socket's close handed every later connection a
  dead channel, so uploads and downloads went unanswered (#396). A
  per-connection channel, like `YjsServerTransport`'s, would not do here: two
  channels on one array would each receive, and answer, the same requests.
- A file whose id map names fewer ASTs than the module has gets an id-assigning
  edit on open, which re-executes the project (`execute: true`; `execute: false`
  would lose the subexpressions' values, since the engine compiled without their
  ids). The new-project template
  (`lib/scala/pkg/src/main/resources/default/src/Main.enso`) ships its full id
  map so a new project gets none: regenerate it with
  `UPDATE_TEMPLATE_ID_MAP=1 corepack pnpm --filter ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts -t "full id map"`
  after changing the template's code.
- The Polyglot variant runs on GraalJS — only a subset of Node APIs is
  available. Check that any new dep works in both `node` and `graaljs` before
  importing.
- **Under `ENSO_YDOC_HOST=engine` this code runs in the engine's JVM**
  (`ydoc-server-polyglot`, packed into the engine's `ydoc-server` jar), so a
  change reaches that path only through a rebuilt engine. The default Node host
  is bundled into the Electron client (`ydocHost.mjs`) instead.

## Node host

`NodeYdocHost` (`src/nodeHost.ts`) runs this server in a plain Node process
instead of the engine's GraalJS: `listen({ host, port, languageServer })` starts
one WebSocket listener per opened project (resolving once the port accepts; a
second `listen` on a port replaces the first), `close(port)` and `closeAll()`
stop them. It reaches the Language Server through `remoteChannelServer`
(`src/remoteChannelServer.ts`), a `YjsChannelServer` whose every channel is one
WebSocket to `ws://<host>:<port>/channel/<kind>?token=<token>`, kind being
`json`, `binary`, `vis-control` or `vis-data`. Messages sent before the socket
opens are buffered; text frames are strings, binary frames `Uint8Array`s. The
token is the engine's `LANGUAGE_SERVER_CHANNEL_TOKEN`; the Language Server
refuses a socket without it. Bytes are `Uint8Array`s (`nodeByteBufferClass`,
whose `view` replaces GraalJS's `new Uint8Array(new ArrayBuffer(byteBuffer))`).

- **A GUI socket's `Origin` is checked before the upgrade** (#596, Note [The
  ydoc Listener Checks Origin] in `src/origin.ts`). A handshake whose `Origin`
  is not in the listen request's `allowedOrigins` gets `403`; one without
  `Origin` (a Node client) is accepted. The hosts fill the list: Electron's
  `UtilityProcessYdocHost.allowOrigins` with the content server's
  `https://localhost:<port>` under each loopback name (set by the server's
  `onListening` once it listens, so `--no-window`, where a browser loads the
  pages, works too), `dev:vite`'s `ssrYdocHost` with the dev server's own
  addresses (its port under each loopback name, and Vite's `resolvedUrls`). A
  dev server opened by the machine's host name, through `server.origin` or a
  reverse proxy is refused: add the origin to `devServerOrigins` in
  `gui/vite.config.ts`. No list refuses every browser page. The engine-hosted
  server (`ENSO_YDOC_HOST=engine`) makes the same check since #614, with the
  host's `allowedOrigins()` passed in `LANGUAGE_SERVER_YDOC_ALLOWED_ORIGINS`.
  GraalJS has no `URL`, so `originOf` falls back to `parseOrigin` there: `http`
  and `https` only, canonical hosts only (dotted-quad IPv4, `[::1]`, no `xn--`),
  and anything it does not recognise is refused. `origin.test.ts` holds it to
  `URL`'s answers over the #628 review's adversarial cases. Not covered: other
  local processes, which can omit `Origin` (#615).
- **A socket for a document its session does not hold is refused before the
  upgrade** (#601, Note [An Unknown Document Is Refused Before The Upgrade] in
  `src/handshake.ts`): `404` for a module doc the `ls=` session does not hold
  (or a session that does not exist yet), `400` with no doc or no `ls=`.
  `y-websocket` resets its backoff when a socket opens, so upgrading and then
  closing made a stale client retry every ~100 ms (91 attempts in 10 s,
  measured); refused before the upgrade it backs off (7 in 10 s). The
  engine-hosted server refuses the same way since #614 (`documentRefusal`,
  through the polyfill's `verifyClient`).
- **One session opens two `json` sockets**, not one: `YjsServerTransport` hands
  the Language Server a proxy channel (for the GUI) and a backend channel (the
  ydoc server's own). The Language Server must accept both.
- **An LS restart takes the GUI sockets with it.** When a `json` socket closes
  without the ydoc side having closed it, the listener closes every GUI socket
  it holds and the session goes with them; the GUI reconnects, as after an
  engine restart when the server lived in the engine. The end of any other
  channel (`vis-control`, `vis-data`, `binary`) ends its own session the same
  way (`LanguageServerSession.channelLost`: its guarded `unregister`, then its
  GUI sockets closed): no channel reconnects, and a session that lost
  `vis-control` sent its attaches nowhere, so the project never executed (#646,
  Note [A Lost Channel Ends The Session] in `src/languageServerSession.ts`). The
  session's own `YjsServerTransport` closes too when the Language Server ends
  either of its channels (Note [The Language Server Ends A Channel] in
  `ydoc-shared/src/util/net/YjsTransport.ts`), so the session gives up its URL
  at once. Before that, a session outlived the engine's restart, sent into dead
  channels for ~75 s and then took `src/Main.enso`'s write capability from the
  GUI's new session (#593).
- **A new session makes the GUI rebuild its project stores.** When the Node host
  restarts, the Language Server keeps running, but the GUI's JSON session over
  the old proxy socket ends with the process (and the Language Server destroys
  that client's execution context); the new session's proxy socket is a session
  nobody initializes. Each session adds its id to the index doc's
  `serverSessions` (Note [A New Server Session] in `ydoc-shared/yjsModel.ts`). A
  GUI that sees a second id calls `reconnectProject`, which rebuilds the
  project's stores with a new `ls=` name (deferred to the end of an opening
  under way) and shows a toast. Edits that had not reached the file are carried
  over (#604, `gui/src/providers/openedProjects/module/carryOver.ts`): once the
  new session has loaded the module, the GUI puts its own text back if the file
  is one it had itself since the last update from this server, and otherwise
  keeps the file and offers its version in a toast; node metadata, the
  selection, the open dock and an open component browser come back too. Undo
  history does not (it refers to the old docs). An engine restart should take
  the same path in both host modes (the Node host's sockets are dropped with the
  engine, and under `ENSO_YDOC_HOST=engine` the server dies with it), but that
  is #602 and unverified; under the engine host a restart on new ports leaves
  the GUI retrying the old `ydocUrl`, which this does not cover.
- **Every session reference is released.** The process outlives its engines, so
  a session that is never released lives on with its Language Server client: a
  connection refused because its doc is unknown (a GUI reconnecting with the
  module doc ids of an earlier session) releases the session it was handed, and
  one that arrives when there is no session at all is refused before any is
  built (only `index` may start one).
- **Sessions are process-global.** `LanguageServerSession.sessions` is keyed by
  the GUI's `ls=` name, not by listener, so one Node process hosting several
  listeners relies on those names being distinct. They are: the GUI's `ls=` is
  `gui-rpc-<random uuid>`, made per opened project
  (`gui/src/providers/openedProjects/project/project.ts`), not the Language
  Server's address. A client that reused one name across projects would be
  handed the other project's session (and that listener's `dropClients` would
  not cover it).
- **`listen` calls for one port must not overlap**: await each; two concurrent
  calls both pass `close` and the second fails with EADDRINUSE. (Electron's
  utility process chains them per port,
  `electron-client/src/ydocHost/serve.ts`.)
- A listener's server error after it started is logged, not thrown: one process
  hosts every project's listener.
- **Channel sockets have no `maxPayload`** (`0`), like the in-process channels
  they replace; `ws`'s 100 MiB default would close a channel on a large
  visualization frame. The token is only sent to loopback hosts (`channelUrl`
  throws otherwise).
- A socket that fails to connect (the Language Server gone, or a 403 for a wrong
  token, logged as a misconfiguration) is reported after a doubling delay (250
  ms to 5 s) so the GUI's reconnecting is not a hot loop. A GUI socket error
  (bad frame) closes only that socket.
- A closed session closes the Language Server ends of its visualization channels
  too (`VisualizationBridge.close`): in Node each is a socket.
- The four socket races (#214 first message on open, #396 shared data channel,
  #409 double close, #494 local terminate) are re-tested on this transport in
  `__tests__/nodeHost.test.ts`, 50 cycles each, against a fake Language Server.

## Control channel

`ydoc:control` (`ydoc-shared/ydocControl`) is a JSON `YjsChannel` on each
project's index doc, beside the visualization bridge's `vis:control`. Its one
request is `flush`, which the GUI sends before saving a version (the client's
end is `ydoc-shared/moduleFlusher`, used through
`app/gui/src/providers/openedProjects/project/flush.ts`). The request carries,
for each module doc the GUI loaded, its guid, state vector (`[clientId, clock]`
pairs) and delete set (`{ clientId: [[clock, length]] }`). The delete set is
needed because a deletion advances no clock: a last edit that only deletes is
invisible in a state vector. Both travel as JSON, not base64: `lib0`'s base64 is
Node- or browser-specific, and GraalJS is neither.

The **whole** state vector and delete set of each module doc are sent, not only
the GUI's "own" edits. Filtering them is wrong: a graph edit is made in a fresh
`Y.Doc` (`MutableModule.edit()`, a random client ID per edit) and applied by
`applyEdit`, which is a non-local transaction, so its insertions are under a
client ID the GUI's doc never owns and its deletions are not local. A delete set
is also keyed by the deleted item's _creator_, not the deleter. The server
checks the description against its own doc directly (`deleteSetCovers`: a binary
search per wanted range, then only the structs it spans), since the check reruns
on every update of the module while a flush waits, on the engine's ydoc thread.

`LanguageServerSession.flush` answers `flushed` with `ok` or an `error` text
(also when the flush throws). Everything is bounded by **one deadline**,
`FLUSH_DEADLINE_MS` (4 s) from the request, the Language Server's requests
included. The GUI waits longer (`FLUSH_TIMEOUT_MS`, 6 s) and keeps listening
until its auto-save fallback (7 s), so a refusal is never taken for a save. For
each module, `ModulePersistence.flush`:

1. waits until the shared doc covers that state vector and delete set, which
   proves the GUI's last edit arrived over the module's own socket;
2. waits until those edits reached the Language Server (`updateToApply` empty,
   state `Synchronized`);
3. checks the disk time: the file's `lastModifiedTime` must equal the one the
   session recorded after its last open, reload, `text/autoSave` or own save. A
   mismatch is checked again after `DISK_RECHECK_MS` (500 ms, or less near the
   deadline), so an auto-save already on its way is not an outside change. Plain
   `text/save` overwrites unconditionally, so without this check a flush could
   overwrite an outside edit that the Language Server's own auto-save would have
   declined;
4. waits for sync again (edits made during the check), reads `syncedVersion` and
   sends `text/save` in the same tick. The session holds the write lock and no
   edit of its own is then in flight, so the lock and version checks pass unless
   the Language Server's buffer changed by some other route.

It refuses if the Language Server rejected one of the module's edits while it
waited (`droppedEdits`): the module then reloads from disk and ends up
`Synchronized` again, with the edit gone. Any refusal writes nothing, so the
Language Server's pending auto-save stays in place. A `text/save` that fails is
reported and tried once more after `SAVE_RETRY_MS` (6 s, the engine's auto-save
delay), unless the module has moved on; one that times out is not retried, since
it may still be carried out. Modules the session does not know are skipped.
