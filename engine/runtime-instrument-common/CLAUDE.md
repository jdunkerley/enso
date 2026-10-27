# engine/runtime-instrument-common

Shared infrastructure of the runtime-server instrument: the handler that
receives `polyglot-api` requests from the language server, the commands they
become (`command/`, built by `CommandFactoryImpl`), the jobs those commands
schedule (`job/`, run by `execution/JobExecutionEngine`), execution contexts,
caches and visualizations.

## Commands and jobs

- A request becomes a **command** (`command/*Cmd`), which runs synchronously or
  asynchronously and usually schedules one or more **jobs** (`job/*Job`) on the
  `JobControlPlane`.
- Not every command needs a job: `StartBackgroundProcessingCmd` calls
  `JobControlPlane.startBackgroundJobs()` directly. Before adding a `Job`
  subclass, check something will actually submit it.

## Testing

Covered mainly by `runtime-integration-tests` (the `instrument` tests).
