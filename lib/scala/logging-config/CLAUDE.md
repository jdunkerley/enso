# lib/scala/logging-config

Parsing of the `logging-service` section of `application.conf`
(`LoggingServiceConfig`, `LoggingServer` for its `server` section, one class per
appender) and the abstract `LoggerSetup` that backends implement (the logback
one is in `logging-service-logback`). Overview:
`docs/infrastructure/logging.md`.

- A `socket` appender with `port = 0` names no server; `LogbackSetup` refuses it
  (Note [Socket Appender Port 0]) so callers fall back to local logging.
- A system property `<logger>.Logger.level=<level>` (`--vm.D` on the `enso`
  command line) overrides that logger's level in the config: `LoggersLevels`
  puts it first, and `ApplicationFilter` (logging-service-logback) takes the
  first entry whose name the event's logger name starts with, so it covers the
  logger's children too. The IDE's Engine logs settings rely on it; see
  `LoggersLevelsTest`, which also checks the engine configs keep SQL queries
  (`warn`) and progress timings (`error`) off.
- Every `${?ENV}` override in the configs is read at parse time; `parseConfig`
  invalidates typesafe-config caches, so system properties set before it (e.g.
  in tests) take effect.
