# Standard.Database_Test_Suite

The conformance suite every database backend runs against itself: the shared
table operations (`Common_Table_Operations`), the database specs
(`Database/Common`, `Upload_Spec`, `Transaction_Spec`, `IR_Spec`) and their
helpers. A test library: `catalogue: false`, so the component browser never
offers it, and it is in the engine distribution but not in the IDE installer
(`EngineBundle.librariesNotBundled`).

## Main entry points

- `Database_Test_Suite.add_specs suite_builder backend` — adds the parts of the
  suite `backend` runs and returns their `Test_Setup`.
- `Backend.Value name connect …` — a database backend; `Backend.In_Memory` is
  the in-memory table (`Table_Tests` runs it; `SQLite_Tests` and
  `Postgres_Tests` run theirs).
- `Known_Issue` — the closed set of known failures, each with its issue.
- `Suite_Part` — `Common`, `Table_Operations`, `Upload`, `IR`, `Transactions`.
- `Util`, `Common_Table_Operations.Util`, `Database.Helpers.Name_Generator`,
  `Database.JSON_Table_Data` — helpers for a backend's own specs.

## Layout

- `src/Internal/Setups.enso` — the setups `add_specs` derives from a `Backend`.
- `data/data.csv` — the table the aggregate specs read
  (`Database_Test_Suite.data_directory`).
- `std-bits/database-test-suite/` — `ExplodingStorage`, for `Upload_Spec`.

## Pitfalls

- A spec never reads the backend's name or group prefix to decide anything: it
  asks the setup (`flagged`, `is_feature_supported`, `is_operation_supported`,
  `is_aggregate_supported`) or `setup.has_known_issue`.
  `tools/ci/check-workflows.mjs` (`checkSuiteIgnoresBackendNames`) fails
  otherwise.
- A new `Dialect_Flag` is answered by every dialect: their `case` has no
  default, so a missing branch panics at run time.
- `enso_project` in the suite names the project that runs it, not the suite: the
  suite's own files are reached through `Database_Test_Suite.data_directory`
  (`Project_Description.new Standard.Database_Test_Suite.Main`).
- A lambda whose whole body is an ascription (`x-> (x:Numeric_Column)`) cannot
  be written to the IR cache (`No persistance for … Type$Ascription`), so
  library indexing fails; bind it first (`refined = (x:T)`, then `refined`).
- The suite imports no test project (`enso_dev.*`) and writes no file into
  itself: it uses `File.create_temporary_file`.

## Testing a database backend

A backend's test project runs the suite against itself with a `Backend`
descriptor; `test/DuckDB_Tests/src/DuckDB_Spec.enso` is the smallest one.

1. **A project.** `test/<Backend>_Tests/package.yaml` (`namespace: enso_dev`,
   `prefer-local-libraries: true`) and `src/Main.enso` calling your specs.
   Outside this repository, any project that has `Standard.Database_Test_Suite`
   in its edition.
2. **The descriptor.** `connect` opens a new connection (called with `Nothing`);
   `name` gives the groups' prefix. This is all of DuckDB's:

   ```enso
   import Standard.Database_Test_Suite
   from Standard.Database_Test_Suite import Backend, Known_Issue, Suite_Part

   duckdb_backend =
       Backend.Value "DuckDB In-Memory" (_ -> Database.connect DuckDB.In_Memory) temporary_tables=False known_failures=[Known_Issue.Filter_After_Distinct] parts=[Suite_Part.Common, Suite_Part.Table_Operations]

   add_specs suite_builder =
       Database_Test_Suite.add_specs suite_builder duckdb_backend
   ```

   The defaults run every part (`Suite_Part.all`) with temporary tables and the
   advanced edge cases; `temporary_tables=False`, `persistent_connections=False`
   (a new connection sees nothing of an earlier one),
   `run_advanced_edge_cases=False` (remote and slow databases;
   `ENSO_ADVANCED_EDGE_CASE_TESTS` still runs them), `parts=[…]` and
   `is_integer_type=…` change them.

3. **Capabilities.** What the suite runs follows your dialect: its
   `is_feature_supported` (`Feature`), `flagged` (`Dialect_Flag`),
   `is_operation_supported` and `check_aggregate_support`. A spec that fails
   because the backend genuinely behaves differently is a dialect answer, not a
   test change.
4. **Known issues.** A spec that fails because of a bug lists the bug: add a
   constructor to `Known_Issue` with its `description` and `issue_url`, make the
   spec ask `setup.has_known_issue` (or use `setup.pending_for`), and put it in
   your backend's `known_failures`. A misspelt issue does not compile.
5. **Your own specs.** Take the `setup` that `add_specs` returns: it has the
   shared connection (`setup.default_connection.get`), `table_builder`,
   `light_table_builder`, `materialize` and the capability questions. The
   helpers `Util`, `Common_Table_Operations.Util` and
   `Database.Helpers.Name_Generator` are for you too.
6. **No server, no failure.** When the database is not configured, register one
   pending group instead of calling `add_specs`, as
   `test/Postgres_Tests/src/Postgres_Spec.enso` does
   (`suite_builder.group "[PostgreSQL] Database tests" pending=message (_-> Nothing)`).
7. **In this repository**, add the project to `tools/ci/stdlib-test-map.yaml`
   (`node tools/ci/check-workflows.mjs` says what is missing); a backend that
   needs a server in CI gets a shard with `needs:`.
