# lib/scala/logging-service-logback

The logback implementation of Enso's logging: `LogbackSetup` (the `LoggerSetup`
service: wires appenders onto a logback context from a parsed `logging-service`
config) and the logging server (`LoggingServer`, `SocketServer`,
`SocketLoggingNode`) that receives serialized events from socket appenders and
writes them to its own sinks. Overview: `docs/infrastructure/logging.md`.

- Every language server hosts its own logging server, on port 0 by default (any
  free loopback port). `SocketServer.bind()` binds on the caller's thread so a
  bind failure fails `LoggingServer.start`; see Note [Logging Server Binds
  Before It Starts] and, in `logging-service`, Note [Each Process Hosts Its Own
  Logging Server]. Never bind in `run()` alone: a failure there is invisible.
- `LogbackSetup.setupLocalSinks` is shared by the server (for received events)
  and by the local-logging fallback, so the two write the same files.
- `SocketServer` binds loopback only (Note [Logging Server Listens On Loopback
  Only]).
- Tests for this module's server live in `lib/java/logging-service-telemetry`
  (JUnit there; this project only has a test SLF4J provider).
