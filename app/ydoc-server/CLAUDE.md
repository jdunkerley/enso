# ydoc-server

Node-side Yjs server that bridges the Enso Language Server (JSON-RPC over
WebSocket) and GUI clients (Yjs/CRDT over WebSocket). It holds a Yjs document
per opened Enso module and reconciles local edits with LS file state.

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
- `src/inspect.ts` — developer instrumentation; gated by env vars and used by
  `ydoc-inspect`.

## Running

- In dev: `corepack pnpm run -r compile` from repo root, then the GUI's
  `dev:vite` spawns a server via its Vite middleware. Override via
  `ENSO_IDE_YDOC_SERVER_URL=ws://host:port`.
- Standalone: `pnpm run dev:inspect` runs the server through `ydoc-inspect`.
- Polyglot (inside engine): see `ydoc-server-polyglot/`.

## Gotchas

- The LS is authoritative for file contents at rest — Yjs is authoritative only
  while a session is live. On reconnect, the server may need to re-seed the Yjs
  doc from LS state; see `languageServerSession.ts`.
- Binary messages use a custom framing (`YjsBinaryChannel`); don't assume plain
  Yjs awareness protocol works end-to-end.
- The Polyglot variant runs on GraalJS — only a subset of Node APIs is
  available. Check that any new dep works in both `node` and `graaljs` before
  importing.
- **This code runs in the engine's JVM** (`ydoc-server-polyglot`, packed into
  the engine's `ydoc-server` jar), so a change reaches the IDE only through a
  rebuilt engine — an installer built with `--backend-source local` against an
  old engine still runs the old server.

## Control channel

`ydoc:control` (`ydoc-shared/ydocControl`) is a JSON `YjsChannel` on each
project's index doc, beside the visualization bridge's `vis:control`. Its one
request is `flush`, which the GUI sends before saving a version
(`app/gui/src/providers/openedProjects/project/flush.ts`). The request carries
each module doc's guid and the GUI's state vector for it, as `[clientId, clock]`
pairs (JSON, not base64: `lib0`'s base64 is Node- or browser-specific, and
GraalJS is neither). `LanguageServerSession.flush` answers `flushed` with `ok`
or an `error` text, after `ModulePersistence.flush` has, for each module:

1. waited (`FLUSH_WAIT_MS`, 4 s) until the shared doc covers that state vector,
   which proves the GUI's last edit arrived over the module's own socket;
2. waited (the same 4 s) until those edits reached the Language Server
   (`updateToApply` empty, state `Synchronized`);
3. checked the disk time: the file's `lastModifiedTime` must equal the one the
   session recorded after its last open, reload, `text/autoSave` or own save. A
   mismatch is checked again after `DISK_RECHECK_MS` (500 ms), so an auto-save
   already on its way is not an outside change. Plain `text/save` overwrites
   unconditionally, so without this check a flush could overwrite an outside
   edit that the Language Server's own auto-save would have declined;
4. sent `text/save` with the version it holds (it is the write-lock holder, so
   the save is never denied for the lock or the version).

Any refusal writes nothing, so the Language Server's pending auto-save stays in
place. A `text/save` that fails is reported and tried once more after
`SAVE_RETRY_MS` (6 s, the engine's auto-save delay), unless the module has moved
on. Modules the session does not know are skipped.
