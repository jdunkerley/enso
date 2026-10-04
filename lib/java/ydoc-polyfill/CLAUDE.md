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

## Tests

`sbt ydoc-polyfill/test`. `WebSocketServerFirstMessageTest` guards #214; it
fails on the old code without any extra load (a few of 100 connections lose
their first message). The same race through the real bundle (a `YdocTest`-style
open/close loop in `ydoc-server`) only showed up under CPU load: 7 of 200
sockets on a 32-core machine with 40 busy processes, none when idle.
