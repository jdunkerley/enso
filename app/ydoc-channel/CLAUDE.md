# ydoc-channel

Small Yjs-based **bidirectional message channel** library shared by
`ydoc-server`, `ydoc-shared`, and the GUI. Wraps a Yjs doc and a transport
(WebSocket or otherwise) into a typed request/response / event channel.

Not a reimplementation of `y-protocols` — it sits alongside it for control-plane
messages that shouldn't live inside the synced `Y.Doc`'s root types.

Kept framework-free and dependency-light on purpose (`lib0` + `yjs` only) so
both Node and GraalJS bundles can consume it.

## Closing

`close()` is final and idempotent: it stops observing the `Y.Array`, runs the
`onClose` handlers once and emits one `close` event. `onClose` exists for the
Java side — the Language Server registers a no-argument callback through
`org.enso.ydoc.api.YjsChannel.onClose` on each channel it is handed in
`onConnect`, and `YdocJsonRpcServer` ends that JSON-RPC session (sends
`MessageHandler.Disconnected`) when it runs (#369). A handler registered after
the close runs at once. Renaming or changing its arity breaks the JVM side
silently, since GraalJS maps the Java interface onto this class by member name.
