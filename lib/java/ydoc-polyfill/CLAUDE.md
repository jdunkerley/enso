# lib/java/ydoc-polyfill

Web/Node API polyfills (WebSocket, timers, crypto, zlib, URL, …) that let the
`ydoc-server-polyglot` bundle run on GraalJS inside the JVM. Each API is a Java
`ProxyExecutable` (`src/main/java/.../web/*.java`) paired with a JS shim
(`src/main/resources/.../web/*.js`) that the Java side evaluates.

## Threading

- All JS runs on one executor thread (in production the `ydoc-server`'s
  `YdocScheduledExecutorService`, through its high-priority view). Helidon's
  callbacks arrive on its own socket threads and are re-posted to the executor
  with `handleCallback`, so for one connection they run in the order Helidon
  called them.
- `WebSocketServer.onconnect` fires on the socket's `open`, not on `upgrade`.
  Helidon calls `onHttpUpgrade` before it writes the `101` and `onOpen` (which
  sets the session) only after, so a socket handed over on `upgrade` cannot send
  yet; a send there was silently lost (#214). Any new per-connection callback
  that needs the session must wait for `open` too.

## Parser functions

`ParserPolyfill` + `parser.js` define on `globalThis` the parser functions that
`app/ydoc-server-polyglot/src/ffiPolyglot.ts` destructures (the JVM counterpart
of the WASM `app/rust-ffi`), calling `org.enso.syntax2.Parser` over JNI.
`ParserPolyfillTest.definesEveryFunctionFfiPolyglotExpects` reads that file and
fails when a name is missing (#360).

`xxHash128` must give byte-for-byte the digest the GUI gets from `hash-wasm`
(`app/ydoc-shared/src/ast/ffi.ts`), because function-doc hashes travel in the
Yjs doc between the two (#394). `Parser.xxHash128` encodes the string as UTF-8
the way JS does (an unpaired surrogate becomes U+FFFD, not Java's `?`) and the
JNI library hashes it with `twox-hash`'s XXH3-128, seed 0, printed as 32
lowercase hex digits, high half first.
`ParserPolyfillTest.xxHash128MatchesHashWasm` holds digests generated with
`hash-wasm`; regenerate them with it, never with the code under test.

## Tests

`sbt ydoc-polyfill/test`. `WebSocketServerFirstMessageTest` guards #214; it
fails on the old code without any extra load (a few of 100 connections lose
their first message). The same race through the real bundle (a `YdocTest`-style
open/close loop in `ydoc-server`) only showed up under CPU load: 7 of 200
sockets on a 32-core machine with 40 busy processes, none when idle.

`close()` on a socket the peer already closed must not throw, and JS sees one
`close` event however many times Helidon and the fallback path report it (#409).
The WebSocket tests take their locks from `TimedLock` (10 s, then fail) and
their ports from `TimedLock.freePort()`, so a missed handler fails a test
instead of hanging the job.
