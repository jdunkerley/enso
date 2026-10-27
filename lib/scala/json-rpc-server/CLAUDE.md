# json-rpc-server

Akka-based JSON-RPC 2.0 server core used by `engine/language-server`. Protocol
definitions (`Protocol`, `Method`, `Errors`), the per-connection
`MessageHandler` (parses web messages, routes them to a client controller) and
its `MessageHandlerSupervisor`.

## Two transports

- `JsonRpcServer` — WebSocket (akka-http). The stream completing sends
  `MessageHandler.Disconnected`, which reaches the client controller and ends
  the session (`JsonSessionTerminated` in the language server).
- `YdocJsonRpcServer` — the one the IDE uses: JSON-RPC carried in a Yjs channel
  by the in-process ydoc server (`org.enso.ydoc.api.YjsChannel`). Its
  `OnCloseHandler`, registered with `channel.onClose`, is the equivalent of the
  stream completing; it fires at most once per channel (#369). The ydoc server
  closes the channels when its project session ends (last WebSocket client gone)
  and when it reconnects to the language server.

Classes called from JS (the channel's message and close handlers,
`ServerCallbacks`) are listed in
`src/main/resources/META-INF/native-image/.../reflect-config.json`; add any new
one there.

## Testing

```bash
sbt "json-rpc-server/testOnly org.enso.jsonrpc.YdocJsonRpcServerSpec"
```

`YdocJsonRpcServerSpec` drives `ServerCallbacks` with a fake `YjsChannel`, so it
needs neither GraalJS nor the ydoc server.
