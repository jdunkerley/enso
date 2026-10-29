# ydoc-shared

Types and primitives shared between `ydoc-server` and its clients (GUI,
inspect). **Also owns the in-browser Enso AST module.**

## What lives here

- `src/ast/` — The Enso AST as used on the client. Parsing happens via the Rust
  parser compiled to WASM (`rust-ffi` package). This AST is the _authoritative_
  structural representation for the GUI — the project-view binds reactive Vue
  state to it. Exported as `ydoc-shared/ast`.
- `src/languageServer.ts` + `src/languageServer/`,
  `src/languageServerTypes.ts` + `src/languageServerTypes/` — Type definitions
  and client helpers for the Enso LS JSON-RPC protocol.
- `src/yjsModel.ts` — The canonical Yjs document shape used for a single opened
  module (text + metadata + awareness).
- `src/binaryProtocol.ts` — Custom binary framing used on top of Yjs (metadata
  round-tripping without flattening to text).
- `src/ensoFile.ts` — `.enso` file format helpers (on-disk representation
  reconstructed client-side).
- `src/ydocControl.ts` — the `ydoc:control` channel's messages (the GUI's
  `flush` request, the server's `flushed` answer), the server's deadline, and
  the state-vector and delete-set helpers; `src/moduleFlusher.ts` — the client's
  end of `flush` (the GUI re-exports it). See `app/ydoc-server/CLAUDE.md`
  ("Control channel").
- `src/uuid.ts`, `src/util/` — small helpers.
- `parser-codegen/` — scripts/inputs that derive some of the AST TS types from
  the Rust parser's metamodel. Re-run when the parser output format changes.

## WASM dependency

The AST module depends on `rust-ffi` (`workspace:*`). Changes to
`lib/rust/parser/` that touch the metamodel propagate here via the WASM build;
don't forget to rebuild the FFI package (`corepack pnpm run -r compile` from
repo root).

## Exports

Entry points in `package.json`:

- `ydoc-shared/ast` → `src/ast/index.ts`
- `ydoc-shared/<name>` → `src/<name>.ts` for any top-level file

Import by the most specific subpath available — don't import `ydoc-shared` with
a bare specifier.

## Test

Vitest only (`pnpm run test:unit`). Tests live in `src/__tests__/`.

## Gotchas

- `xxHash128` (`src/ast/ffi.ts`, `hash-wasm`) has a JVM twin: the production
  ydoc server runs on GraalJS and gets it from `lib/java/ydoc-polyfill`. Hashes
  it returns are stored in the Yjs doc (a function's `docLineMarkdownHash`) and
  compared on the other side, so the two must agree byte for byte (#394). Change
  the input encoding or output format on one side only with the other, and
  regenerate the vectors in `ParserPolyfillTest`.

- Closing a `YjsChannel` is final: it stops observing its `Y.Array`, and a later
  `subscribe` on it never hears another message. `YjsTransport` therefore takes
  a fresh channel when it connects again after `close`, and `YjsServerTransport`
  hands the Language Server a new channel pair on every `connect` and closes the
  old pair on `close` (#143). Keep that shape for any new channel-backed
  transport.
