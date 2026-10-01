# lib/scala/logging-config

Parsing of the `logging-service` section of `application.conf`
(`LoggingServiceConfig`, `LoggingServer` for its `server` section, one class per
appender) and the abstract `LoggerSetup` that backends implement (the logback
one is in `logging-service-logback`). Overview:
`docs/infrastructure/logging.md`.

- A `socket` appender with `port = 0` names no server; `LogbackSetup` refuses it
  (Note [Socket Appender Port 0]) so callers fall back to local logging.
- Every `${?ENV}` override in the configs is read at parse time; `parseConfig`
  invalidates typesafe-config caches, so system properties set before it (e.g.
  in tests) take effect.
