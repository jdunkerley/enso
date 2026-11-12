# lib/java/ydoc-polyfill

Web/Node API polyfills (WebSocket, timers, crypto, zlib, URL, …) for GraalJS
inside the JVM. Each API is a Java `ProxyExecutable`
(`src/main/java/.../web/*.java`) paired with a JS shim
(`src/main/resources/.../web/*.js`) that the Java side evaluates. EPB
(`EpbContext` in `runtime-language-epb`) installs them, and the parser functions
below, in its JavaScript context. They were written for the engine-hosted ydoc
server (the `ydoc-server-polyglot` bundle), which is gone: the ydoc server runs
only in Node now, so parts of this module (the WebSocket server, the parser
functions) have no production caller left beyond EPB.

## Threading

- All JS runs on one executor thread (EPB passes the Enso language's
  `ScheduledExecutorService`). Helidon's callbacks arrive on its own socket
  threads and are re-posted to the executor with `handleCallback`, so for one
  connection they run in the order Helidon called them.
- `WebSocketServer.onconnect` fires on the socket's `open`, not on `upgrade`.
  Helidon calls `onHttpUpgrade` before it writes the `101` and `onOpen` (which
  sets the session) only after, so a socket handed over on `upgrade` cannot send
  yet; a send there was silently lost (#214). Any new per-connection callback
  that needs the session must wait for `open` too.
- `WebSocketServer`'s `verifyClient(url, origin)` runs from `onHttpUpgrade`, on
  the executor, while Helidon's thread waits. Unlike `ws`'s boolean contract,
  only `undefined` or `null` accepts; `{status, reason}` refuses with that
  status before the `101` (thrown as a `RequestException`), and anything else
  (`true`, `false`, a throw) refuses with `500` (Note [The Engine-Hosted
  Listener Refuses Before The Upgrade], #614, written for the engine-hosted ydoc
  server).

## Parser functions

`ParserPolyfill` + `parser.js` define on `globalThis` the parser functions the
engine-hosted ydoc server's `ffiPolyglot.ts` used to destructure (the JVM
counterpart of the WASM `app/rust-ffi`), calling `org.enso.syntax2.Parser` over
JNI.

`xxHash128` gives byte-for-byte the digest the GUI gets from `hash-wasm`
(`app/ydoc-shared/src/ast/ffi.ts`); that mattered while function-doc hashes
travelled in the Yjs doc between the GUI and the engine-hosted server (#394).
`Parser.xxHash128` encodes the string as UTF-8 the way JS does (an unpaired
surrogate becomes U+FFFD, not Java's `?`) and the JNI library hashes it with
`twox-hash`'s XXH3-128, seed 0, printed as 32 lowercase hex digits, high half
first. `ParserPolyfillTest.xxHash128MatchesHashWasm` holds digests generated
with `hash-wasm`; regenerate them with it, never with the code under test.

## Tests

`sbt ydoc-polyfill/test`. `WebSocketServerFirstMessageTest` guards #214; it
fails on the old code without any extra load (a few of 100 connections lose
their first message). The same race through the real bundle (a `YdocTest`
open/close loop in the deleted `ydoc-server` module) only showed up under CPU
load: 7 of 200 sockets on a 32-core machine with 40 busy processes, none when
idle.

`close()` on a socket the peer already closed must not throw, and JS sees one
`close` event however many times Helidon and the fallback path report it (#409).
`close()` without a code is `terminate()`, which also dispatches `close` itself:
Helidon does not always report a close for a socket torn down locally, and the
event was lost when the peer's close raced it (#494). The WebSocket tests take
their locks from `TimedLock` (10 s, then fail) and their ports from
`TimedLock.freePort()`, so a missed handler fails a test instead of hanging the
job.
