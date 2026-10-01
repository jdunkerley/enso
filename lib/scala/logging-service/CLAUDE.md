# lib/scala/logging-service

Process-level logging setup, independent of the logback backend:
`LoggingSetupHelper` (each service - language server, launcher - subclasses it)
and `LoggingServiceManager` (starts this process's logging server through the
`LoggingServiceFactory` service). Overview: `docs/infrastructure/logging.md`.

- `LoggingSetupHelper.setup(Level, boolean)` starts the logging server when the
  config's `logging-service.server.start` is set, then points the process's
  `socket` appender at the port actually bound, not the configured one (Note
  [Each Process Hosts Its Own Logging Server]).
- Any failure to start or reach a logging server goes through
  `fallBackToLocalLogging`, which logs a WARN. Do not fall back via the config's
  default appender alone: for a language server that is the `socket` appender,
  i.e. the thing that just failed.
- Process-wide state: `LoggerSetup.get()` and `LoggingServiceManager` are
  singletons, so only one helper setup can be exercised per test JVM.
- Tests that exercise this module live in `lib/java/logging-service-telemetry`.
