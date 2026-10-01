# lib/java/logging-service-telemetry

The telemetry sink (`TelemetryAppenderImpl`, loaded by `logging-service-logback`
through `AbstractRemoteAppender`), which posts `org.enso.telemetry` events to
the cloud.

Its JUnit suite also holds the tests for the logging server and setup in
`lib/scala/logging-service*`, which have no JUnit setup of their own:
`SocketForwardingTest`, `LoggingServerPortTest` and
`LoggingSetupHelperFallbackTest` (which sets the process-wide logging, so it
must stay the only `LoggingSetupHelper` test in this JVM). Run with
`sbt logging-service-telemetry/test`.
