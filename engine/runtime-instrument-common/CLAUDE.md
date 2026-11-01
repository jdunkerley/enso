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
- A visualisation is never evaluated beside a running execution of its context.
  It is evaluated alone (with the context write lock and the compilation read
  lock) when no execution or compile runs. Otherwise the execution evaluates it
  before releasing its locks (Note [Visualisations Evaluated Alone Or By Their
  Execution]).

## Testing

Covered mainly by `runtime-integration-tests` (the `instrument` tests).
