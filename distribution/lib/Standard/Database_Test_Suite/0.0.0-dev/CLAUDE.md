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
  the in-memory table (`Table_Tests` runs it).
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
