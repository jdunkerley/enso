# Database Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shared table and database tests become a library,
`Standard.Database_Test_Suite`, that any database backend runs against itself: a
backend writes a `Backend` descriptor of a few lines, what it supports comes
from its dialect, what is broken from a closed list of `Known_Issue`s, and each
backend has its own test project, with `Table_Tests` keeping the in-memory
tests.

**Architecture:** Four tasks, each its own PR against `develop` from its own
worktree and branch, in this order. Task 1 (dialect capabilities: the 12
hand-set aggregate flags of `Aggregate_Spec.Test_Selection` give way to
questions to the dialect, with three new `Dialect_Flag`s) changes no test
outcome. Task 2 (the library: the shared specs, helpers and `data.csv` move into
`distribution/lib/Standard/Database_Test_Suite`, with `Backend`, `Known_Issue`,
`Suite_Part` and one `add_specs`; the checks of the backend's name become
capabilities or known issues; every user switches over; a `check-workflows.mjs`
rule keeps names out) builds on Task 1's `is_aggregate_supported`. Task 3
(`test/SQLite_Tests` and `test/Postgres_Tests` take their backends out of
`Table_Tests`; CI shards by project) builds on Task 2's descriptor. Task 4 (the
"Testing a database backend" guide, in the suite's `CLAUDE.md` and the wiki)
documents what Tasks 2 and 3 built.

**Tech Stack:** Enso
(`distribution/lib/Standard/{Database,SQLite,DuckDB,Microsoft,Snowflake,AWS,Database_Test_Suite}`,
`test/*_Tests`), Java (`std-bits/database-test-suite`), sbt (`build.sbt`),
TypeScript with vitest (`tools/build-scripts`), Node with `node:test`
(`tools/ci/check-workflows.mjs`), YAML (`tools/ci/stdlib-test-map.yaml`,
`distribution/edition.template.yaml`).

**Spec:** `docs/superpowers/specs/2026-10-31-database-test-suite-design.md`
(merged #480). It runs after step 1 of the library system has moved PostgreSQL
out of `Standard.Database` (Task 5 of
`docs/superpowers/plans/2026-10-30-postgres-sqlite-libraries.md`, branch
`feat/postgres-library`): `Standard.Postgres` at
`distribution/lib/Standard/Postgres/0.0.0-dev/` (`Postgres`,
`Postgres_Connection`, `Internal/Pgpass`, `Internal/Postgres_Services`), the
Postgres dialect staying in Database at
`distribution/lib/Standard/Database/0.0.0-dev/src/Postgres_Family/Postgres_Dialect.enso`,
and `test/Table_Tests/src/Database/Postgres_Spec.enso` importing
`from Standard.Postgres import all`. `Standard.SQLite` exists since #468.

## Global Constraints

- The spec's decisions stand: the suite is a library any library author can run
  (`Standard.Database_Test_Suite`, shipped like the other non-core libraries);
  capabilities come from the dialect, and a backend lists only its known
  failures (each with an issue) and its policy; a suite library plus one test
  project per backend, with `Table_Tests` keeping the in-memory tests.
- Changelog: Task 2 adds the entry under `# Next Release` →
  `#### Enso Standard Library` in the `- [Description][NNN]` form with
  `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`, NNN the PR's own number
  (open the PR, then add the entry). Tasks 1, 3 and 4 take the
  `CI: No changelog needed` label, added when opening the PR.
- A change to a standard library's public Enso signatures regenerates that
  library's committed `docs/api`
  (`sbt "runEngineDistribution --no-ir-caches --docs=api --in-project <library dir>"`;
  the generator never deletes a stale file, so `git rm` the pages of a removed
  module first), and `corepack pnpm --filter build-scripts run stdlib-api-check`
  passes.
- Verify on Linux (WSL; source `~/.enso-toolchain.sh` first, give cargo its own
  `CARGO_TARGET_DIR`) as well as Windows, as the root `CLAUDE.md` says. The
  databases run in WSL's Docker; Windows runs the projects that need none.
- No test changes outcome: every task leaves the same pass, fail and pending
  counts per backend, shown with `junit-compare` (the proof steps). Snowflake
  and Redshift have no credentials here or in CI: for them the proof is that
  their projects compile and report their one pending group, and each PR says
  so. The one known exception is Redshift's "should allow grouping by dates"
  (Task 1's ruling), which would run on a credentialed Redshift only.
- `Standard.Database_Test_Suite` is in the engine distribution (CI,
  `stdlib-test`, `enso` users) but not in the IDE installer, like a library to
  be downloaded later (the user's decision): `buildEngineBundle` leaves it out
  (Task 2 Step 11).
- Run an Enso test project from `test/` (the project root's parent), with
  `JAVA_TOOL_OPTIONS="-enableassertions"`, and check that tests ran: a filter
  that matches nothing still exits 0.
- `node tools/ci/check-workflows.mjs` and `node --test tools/ci/*.test.mjs` pass
  after any change to `tools/ci/`, to a library's `package.yaml` or `Main.enso`,
  or to a test project's imports. `tools/build-scripts` changes pass
  `corepack pnpm --filter build-scripts run typecheck`, `run lint` and
  `run test:unit`. Java and Scala changes pass
  `sbt "scalafmtCheckAll; javafmtCheckAll"` (run `javafmtAll` and `scalafmtAll`
  first). GUI test changes pass `corepack pnpm --filter enso-gui run test:unit`
  and `corepack pnpm exec prettier --check` on the changed files.
- Never run `git stash` in any form, `git reset --hard`, a force-push or
  `--no-verify`; leave `.claude/settings.local.json` out of commits. Never push
  to the wiki: Task 4 gives the page's text, and the controller pushes it. PR
  bodies are written with the Write tool and passed with `--body-file`, cite the
  spec (#480), and end with the session's attribution. Commit messages end with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

## Rulings made while planning

- **There are 13 aggregate flags, of which 12 are read (Task 1).**
  `Aggregate_Spec.Test_Selection.Config` (`Aggregate_Spec.enso:19-20`) declares
  `problem_handling` too, and nothing reads it. It is deleted with the type.
  Cost if wrong: none.
- **What decides an aggregate today is `check_aggregate_support`, not
  `is_operation_supported` (Task 1; a departure from the spec's "likely"
  list).** `make_aggregate_column`
  (`Database/src/Internal/Aggregate_Helper.enso`) starts with
  `Error.return_if_error (dialect.check_aggregate_support aggregate)`; every
  dialect implements it (interface in `Database/src/Dialects/Dialect.enso:192`).
  `is_operation_supported` only asks whether the SQL generator's dictionary has
  an entry, and the two disagree where it matters: SQL Server's
  `make_dialect_operations` has `agg_shortest` and `agg_longest` while its
  `check_aggregate_support` rejects `Shortest` and `Longest`; Redshift's
  dictionary extends the Postgres one (with `MODE`) and adds `agg_median` and
  `agg_percentile`, while its `check_aggregate_support` rejects `Mode`, `Median`
  and `Percentile`. Asking `is_operation_supported` would start SQL Server's
  shortest/longest specs and Redshift's statistics specs, which today are off.
  So `Test_Setup` gains `is_aggregate_supported : Aggregate_Column -> Boolean`,
  answered for a database by
  `(connection.dialect.check_aggregate_support aggregate).is_error.not` and by
  `True` in memory; it is still the dialect that answers. Cost if wrong: none
  for outcomes (the table below matches today's flags on every backend); the
  suite asks a fourth dialect method besides the spec's three.
- **Each aggregate flag (Task 1).** "Check X" is `is_aggregate_supported X`. The
  table shows today's hand-set value per backend (PG = PostgreSQL, SL = SQLite,
  DK = DuckDB, MS = SQL Server, SF = Snowflake, RS = Redshift; blank = the
  default `True`) and what the product answers; every row agrees.

  | Flag                        | Ruling                                                           | Today `False` on | Product answer                                                                                                                 |
  | --------------------------- | ---------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
  | `advanced_stats`            | check `Median`, `Mode`, `Percentile`                             | SL MS RS         | SL, MS, RS reject all three; PG, DK, SF accept                                                                                 |
  | `std_dev`                   | check `Standard_Deviation`                                       | none             | all accept                                                                                                                     |
  | `text_shortest_longest`     | check `Shortest`, `Longest`                                      | SL MS            | SL, MS reject; others accept                                                                                                   |
  | `first_last`                | check `First` with `ignore_nothing=False`, `order_by=["B"]`      | MS               | MS rejects every `First`; others accept                                                                                        |
  | `first_last_multi_order`    | check `First`, `ignore_nothing=False`, `order_by=["B", "C"]`     | MS               | as `first_last`                                                                                                                |
  | `first_last_ignore_nothing` | check `First` with `ignore_nothing=True`, `order_by=["B"]`       | SL MS            | SL rejects `ignore_nothing=True`, MS every `First`                                                                             |
  | `multi_distinct`            | check `Count_Distinct ["A", "B"]`                                | SL MS RS         | SL, MS, RS reject more than one column                                                                                         |
  | `text_concat`               | check `Concatenate` and new flag `Concatenate_Follows_Row_Order` | MS SF            | all accept `Concatenate`; MS (`string_agg`) and SF (`LISTAGG`) aggregate without the row order                                 |
  | `first_last_row_order`      | new flag `First_Last_Respects_Row_Order`                         | every database   | `First`/`Last` without `order_by` raise `Aggregation_Requires_Order` on every database (`throw_ordering_required`)             |
  | `aggregation_problems`      | new flag `Reports_Aggregation_Problems`                          | every database   | only the in-memory table computes per value and reports `Invalid_Aggregation`                                                  |
  | `nan`                       | existing `Supports_Separate_NaN`                                 | SL               | the group is already inside `if setup.flagged ..Supports_Separate_NaN`, and SL answers `False`: the extra `pending` is dropped |
  | `date_support`              | existing `Date_Time`                                             | SL RS            | SL answers `False`; RS see the next ruling                                                                                     |

  The new flags are answered `False` by the six dialects, except
  `Concatenate_Follows_Row_Order`, which is `True` for Postgres, SQLite, DuckDB
  and Redshift and `False` for SQL Server and Snowflake; the in-memory backend
  answers `True` (its `flagged` defaults to `True`). The spec's other likely
  flags, `Supports_Multi_Distinct` among them, are not needed: the check covers
  them. Cost if wrong: a flag answered differently from today changes a count,
  which the proof step shows.

- **Redshift's `date_support=False` is stale (Task 1).** It was set in 2022
  (#3673), before Redshift's dialect answered `Date_Time -> True`, and every
  other `Date_Time` spec runs on Redshift. `date_support` becomes
  `setup.flagged ..Date_Time`, so on a Redshift with credentials "should allow
  grouping by dates" now runs. No run here or in CI changes: Redshift has no
  credentials, and without them it registers one pending group. Cost if wrong:
  one failing spec on a credentialed Redshift run, answered by a `Known_Issue`.
- **`Dialect_Flag` variants and the backends outside Database (Tasks 1, 2).**
  The variants are `private: true` doc metadata, not the `private` keyword, so
  other libraries match on them. Every dialect answers `flagged` with an
  exhaustive `case flag of` and no `_ ->` branch (Postgres_Dialect in Database,
  SQLite, DuckDB, SQLServer, Snowflake, Redshift), so a variant one of them does
  not list is an `Inexhaustive_Pattern_Match` panic at run time: each new
  variant goes into all six. The in-memory `flagged` ends in `_ -> True`. The
  variants are listed in `Database/docs/api/Dialects/Dialect_Flag.md`, which is
  regenerated; the stale `Database/docs/api/Dialect_Flag.md` (an old module
  path, never deleted by the generator) stays as it is.
- **The 13 checks of the backend's name (Task 2).** The spec counted 11; a grep
  of the shared files finds 13 sites, 12 on the prefix or group name and one on
  `dialect_name`. Each becomes a capability (a genuine difference) or a
  `Known_Issue` (a bug, with an issue):

  | Site                                       | Today                                               | Ruling                                                                                                                                                                                                      |
  | ------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `Aggregate_Spec.enso:1025`                 | Snowflake-only order-agnostic `Concatenate` group   | `Known_Issue.Unordered_Concatenate` (enso-org#10412, open): the group runs for a backend that lists it                                                                                                      |
  | `Aggregate_Spec.enso:1818`                 | "with Concatenate" off for Snowflake and SQL Server | capability: `test_selection.concatenate.not` (no backend rejects `Concatenate`, so it runs nowhere, as today)                                                                                               |
  | `Column_Operations_Spec.enso:204`          | Snowflake sorts by an added row id                  | capability: new flag `Reads_Rows_In_Insertion_Order` (Snowflake returns an unordered table's rows in no fixed order, which SQL allows; the comment's enso-org#10321 is an unrelated, closed Postgres issue) |
  | `Column_Operations_Spec.enso:1546`         | SQLite: min/max with `Nothing` pending              | capability: new flag `Row_Min_Max_Ignores_Nothing` (SQLite's scalar `MIN`/`MAX` return `NULL` for any `NULL` argument)                                                                                      |
  | `Expression_Spec.enso:335`, `:368`, `:384` | SQLite also checks `Nothing` literals               | capability: new flag `Supports_Null_Typed_Columns` (only SQLite holds a column of `Nothing` with no type)                                                                                                   |
  | `Integration_Tests.enso:159`               | DuckDB skips filter-after-distinct                  | `Known_Issue.Filter_After_Distinct` (a new issue on this fork, filed in Task 2 Step 1)                                                                                                                      |
  | `Join/Join_Spec.enso:237`                  | PostgreSQL pending "TODO: fix issue #8243"          | `Known_Issue.Full_Join_With_Between` (enso-org#8243, open: "Postgres does not support a `Full` join with `Between` condition")                                                                              |
  | `Text_Column_Spec.enso:161`                | PostgreSQL and Snowflake expect code-point reversal | capability: new flag `Text_Reverse_Keeps_Grapheme_Clusters` (their `REVERSE` reverses code points)                                                                                                          |
  | `Upload_Spec.enso:433`, `:629`, `:1034`    | Snowflake pending until #10737                      | capability: new flag `Enforces_Primary_Key_Uniqueness` (enso-org#10737, "Snowflake does not enforce uniqueness of PRIMARY KEY by default", closed as not planned: Snowflake's behaviour, not a bug)         |

  SQL Server's literal-table workaround
  (`light_table_builder columns = table_builder columns`, enso-org#11487, open)
  is not a name check but is a known bug: `Known_Issue.No_Literal_Tables`, and
  the suite builds a real table for a backend that lists it. That leaves four
  known issues (`Full_Join_With_Between`, `Unordered_Concatenate`,
  `No_Literal_Tables`, `Filter_After_Distinct`, all open bugs) and five new
  flags, answered as the tests expect today: `Supports_Null_Typed_Columns`
  `True` only for SQLite; `Row_Min_Max_Ignores_Nothing` `False` only for SQLite;
  `Text_Reverse_Keeps_Grapheme_Clusters` `False` for Postgres and Snowflake
  (Redshift's `REVERSE` is the same function, but Redshift has never run this
  spec, so it keeps today's expectation, `True`);
  `Reads_Rows_In_Insertion_Order` and `Enforces_Primary_Key_Uniqueness` `False`
  only for Snowflake. Cost if wrong: an unexpected pass or failure on a
  credentialed Snowflake or Redshift run.

- **`Known_Issue` constructors are named for the bug, not the number (Task 2).**
  `issue_url` carries the number. That lets the DuckDB issue, which does not
  exist yet, be filed in Task 2 Step 1 and its URL written into `issue_url`, the
  one value the plan cannot know in advance. Cost if wrong: none.
- **Audit and saved-connection specs stay in a test project (Task 2; a departure
  from "`Database/Common/*` moves").** `Audit_Spec` and
  `Save_Connection_Data_Link` drive the Enso Cloud mock of `Cloud_Tests`
  (`Cloud_Tests_Setup`, `Temporary_Directory`, `get_audit_log_events`), and a
  library in `distribution/lib` cannot import a test project: `indexStdLibs`
  compiles it without `test/` on the library path. They move to
  `test/Cloud_Tests/src/Database/`, and `Audit_Spec`'s `main` (the only user of
  `Postgres_Spec`'s `Temporary_Data_Link_File` there) is deleted. Postgres, SQL
  Server and Snowflake call them from `enso_dev.Cloud_Tests`. The test map
  already selects `Cloud_Tests` on any Database change (it imports
  `Table_Tests`, and after the move `Standard.Database`). Cost if wrong: a
  third-party backend runs these two by hand, as today.
- **`run_with_and_without_output` is copied, `Round_Spec` is copied (Task 2).**
  `Upload_Spec` and `Names_Length_Limits_Spec` import the first from
  `Cloud_Tests_Setup` (seven lines over `Context.Output`); the suite's `Util`
  gets its own. `Column_Operations_Spec` reuses
  `enso_dev.Base_Tests.Data.Round_Spec` (286 lines, Base and Test only); it is
  copied to the suite's `Common_Table_Operations/Round_Spec.enso` rather than
  moved, because moving it would make `Base_Tests` import the suite and so be
  selected by every Table, Database and SQLite pull request. Each copy says
  where the other is. Cost if wrong: the two `Round_Spec` copies drift; both
  still test.
- **The suite has Java: `std-bits/database-test-suite` (Task 2).** One
  `Upload_Spec` spec ("should not create any table if upload fails") builds a
  column from `org.enso.table_test_helpers.ExplodingStorage`, which ships only
  in the test jar `test/Base_Tests/polyglot/java/base-test-java-helpers.jar`
  (copied into `test/Table_Tests/polyglot/java`). A polyglot import resolves at
  run time against the jars of the loaded packages (`IrToTruffle`
  `processPolyglotJavaImport` → `context.lookupJavaClass`), so in a backend
  project that does not load `Table_Tests` (Task 3) the class would be missing.
  `ExplodingStorage` and `ExplodingStoragePayload` move to
  `std-bits/database-test-suite` (package `org.enso.database_test_suite`),
  packaged into the library's `polyglot/java`, so the library works for a third
  party too. No third-party dependency: no `GatherLicenses` entry, no
  `THIRD-PARTY`. `Util.set_writable` (the only user of
  `org.enso.base_test_helpers.FileSystemHelper`) stays in `Table_Tests`, as
  `test/Table_Tests/src/IO/File_Util.enso`. In the native engine the jar is
  loaded as it is today from `test/Table_Tests/polyglot/java`: it is in no
  native image either way (`stdLibsJars` lists no test jar, and this plan adds
  nothing to the image). `std-bits/table`'s
  `META-INF/native-image/org/enso/table/reflect-config.json` names the two
  classes under their old package; the two entries move to the new package with
  the rename (Task 2 Step 2), so they stay right for as long as Table is in the
  image. The native run of Task 2 Step 12 shows the spec "should not create any
  table if upload fails" passing for both SQLite backends, as before. Cost if
  wrong: that one spec fails in the native suite only; Step 12 shows it before
  the PR.
- **Nothing assumes SQLite or Postgres in the native image (Tasks 2, 3).** Step
  1's Task 5 keeps Postgres in the guest JVM, and SQLite is leaving the image
  (`feat/sqlite-off-native-image`). The suite and the backend projects only call
  Enso APIs; no reflection config, `stdLibsJars` entry or native-image feature
  is added or relied on for either, and the proof runs the native suite as CI
  builds it at the time.
- **`Util` in the suite widens the test map's fan-out (Task 2; accepted).**
  `Cloud_Tests`, `Saas_Tests`, `Tableau_Tests`, `AWS_Tests` and `Google_Test`
  use `Util`'s table assertions, so they import the suite, and a change to it,
  SQLite or Database selects them. The spec puts `Util` in the suite; a separate
  small helper library would avoid the fan-out, at the cost of a second test
  library. Cost if wrong: a few more test projects run on such pull requests.
- **The suite depends on SQLite (Task 2).** Six specs (`Core_Spec`,
  `Cross_Join_Spec`, `Join_Spec`, `Lookup_Spec`, `Union_Spec`, `Zip_Spec`) check
  that columns or tables of two different connections are refused, and open the
  second one with `Database.connect (SQLite.In_Memory)`. SQLite ships with every
  installation, so the suite's `dependsOn` is
  `[Base, Database, SQLite, Table, Test]`. Cost if wrong: none.
- **Which parts of the suite a backend runs is on the descriptor (Task 2).**
  Today the backends differ: PostgreSQL, SQLite and Snowflake run the common
  specs, the table operations, `Upload_Spec`, `IR_Spec` and `Transaction_Spec`;
  Redshift the first two and `IR_Spec`; DuckDB and SQL Server the first two.
  Turning a part on is a change of counts, so `Backend` has
  `parts=Suite_Part.all` (the full conformance run for a new backend) and the
  three backends that run less list their parts. Cost if wrong: none; a later PR
  can turn parts on.
- **`Database_Test_Suite.add_specs` returns its `Test_Setup` (Task 2).** A
  backend's own specs use the same lazy connection and table builders
  (`setup.expect_integer_type`, `setup.table_builder`, Snowflake's
  `default_connection`), so the one entry point returns the setup it built, and
  `Test_Setup` gains `backend` and `default_connection`. Cost if wrong: none.
- **The `Table_Tests` ↔ `Generic_JDBC_Tests` cycle ends in Task 2, not Task 3.**
  `Generic_JDBC_Tests` imports only `Name_Generator` from `Table_Tests`, which
  Task 2 moves, so it must switch in Task 2. The other direction is
  `Postgres_Spec`'s
  `import enso_dev.Generic_JDBC_Tests.Generic_JDBC_Connection_Spec` and
  `import enso_dev.Table_Tests`, both unused, and deleted in Task 2. Cost if
  wrong: none.
- **`JSON_Table_Data` moves into the suite (Task 2).** `DuckDB_In_Memory_Spec`
  imports it from `Postgres_Spec`; a DuckDB project depending on the Postgres
  test project would undo Task 3. It is backend-neutral (a table with a JSON
  column, made with `execute_update`) and becomes
  `Standard.Database_Test_Suite.Database.JSON_Table_Data`. Cost if wrong: none.
- **The suite writes no file into itself (Task 2).** An installed library can be
  read-only, so `Integration_Tests`' `transient/add_row_number.xls` and
  `Upload_Spec`'s `transient/sql.log` become `File.create_temporary_file`s. The
  suite's `data/` holds only `data.csv`, read by the table functions the suite
  derives and, through `Database_Test_Suite.data_directory`, by Snowflake's bulk
  and stage specs. `data.csv` has one other reader, `Table_Tests`'
  `IO/YXDB_Spec.enso:81` ("Should error gracefully when reading a non-YXDB
  file"), which needs any CSV: it reads `one_row.csv`, already in
  `Table_Tests/data`, instead (a move, not a copy, so the file has one home).
  The other moved data (`pgpass.conf`, `postgres_known_encodings.txt`,
  `datalinks/postgres-*.datalink`, Task 3) has no reader outside
  `Postgres_Spec`, `Library_Discovery_Spec` and the GUI's
  `dataLinkSchema.test.ts`; each task greps for it. Cost if wrong: none.
- **The suite is not in the IDE installer, and the IR-cache budget does not grow
  (Task 2; the user's decision).** Every installer (`ide-packaging.yml`,
  `release.yml`, `ide-local`) takes its engine from `buildEngineBundle`, whose
  `EngineBundle.create` copies the whole engine package into
  `built-distribution/engine-bundle-…/enso/dist/<version>`. It gains a list,
  `EngineBundle.librariesNotBundled = Seq("Database_Test_Suite")`, whose
  `lib/Standard/<name>` directories it skips, so the engine distribution (CI,
  `stdlib-test`, `enso` users) keeps the suite and the installer does not. The
  edition still names it (`repository: release`), as a library to be fetched
  later; it is not added to `uploadedLibraries` (`project/Editions.scala`),
  which would put an archive into every bundle. The moved sources are 1.19 MB of
  `.enso`, and IR caches run at about 20 times the source, so about 24 MB of
  `.ir`: the total, 79.8 MB today against `EXPECTED_MAX_SIZE_MB = 88`, would
  pass it. `IRCaches.checkCacheSizes` runs on the engine package's
  `lib/Standard` (from `EngineDistributionChecks.afterBuild`, called by both
  `ciBuildEngineDistribution` and `buildEngineBundle`), and its purpose is the
  size users get, so it leaves out the libraries in
  `EngineBundle.librariesNotBundled` and logs their size on its own line; the
  budget stays 88. Since nothing reaches the installer, the IDE never loads the
  suite, its `public-types` never reach the IDE's import fixer, and Task 2 has
  no installer surface. Cost if wrong: none for users; the suite's caches are
  measured but not budgeted.
- **`Library_Discovery_Spec` goes to `Postgres_Tests` (Task 3).** It reads a
  SQLite file and a saved Postgres data link from a child project without the
  imports, and needs no server. In `Postgres_Tests` (which imports both
  `Standard.Postgres` and `Standard.SQLite`) a change to either library selects
  it, as `Table_Tests` does today; the Postgres data links move with it, and the
  GUI's `dataLinkSchema.test.ts` reads them from there. Cost if wrong: none.
- **A shard can need a database (Task 3).** The map's shards gain
  `needs: postgres`, with the split parts' meaning: for a suite entry without
  that database the shard is dropped and its projects run, and skip their
  database groups, in the `"*"` shard, as `Table_Tests`' `[PostgreSQL]` groups
  do today in its last part. The `split`/`ENSO_TEST_GROUP_FILTER` code stays,
  unused by the map. Cost if wrong: none.
- **Moved projects are compared by group prefix (Task 3).** `junit-compare`
  compares project by project, and Task 3 moves groups between projects. It
  gains `--by-group-prefix`, which pools every project's cases and compares them
  per leading `[Backend]` of the group name (one row for groups without one), so
  "`[PostgreSQL]` in `Table_Tests`" before is compared with "`[PostgreSQL]` in
  `Postgres_Tests`" after. Cost if wrong: none.

## Merge order

Task 1, then Task 2, then Task 3, then Task 4. Tasks 1, 3 and 4 change nothing
visible and merge on green CI. Task 2 is a feature (it has the changelog entry),
so it waits for the user's OK after green CI, as features do; it adds nothing to
the installer (ruling above), so there is no installer test. Task 1 merges after
step 1's Task 5 (`Standard.Postgres`) has merged, so its baseline includes the
move. It can start before: branched from `develop`, it overlaps Task 5 only in
`test/Table_Tests/src/Database/Postgres_Spec.enso`, and at different lines (Task
5 the imports at 12–16, Task 1 the setup at 790–805); merge `develop` in (a
merge commit, never a rebase or force-push) once Task 5 merges and take the
proof's baseline from that merge. Each later task branches from `develop` after
the previous one merges.

---

### Task 1: Dialect capabilities for the aggregate specs

No change visible to users: `CI: No changelog needed`.

**Files:**

- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Dialects/Dialect_Flag.enso`
  (three variants)
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Postgres_Family/Postgres_Dialect.enso`,
  `distribution/lib/Standard/SQLite/0.0.0-dev/src/Internal/SQLite_Dialect.enso`,
  `distribution/lib/Standard/DuckDB/0.0.0-dev/src/Internal/DuckDB_Dialect.enso`,
  `distribution/lib/Standard/Microsoft/0.0.0-dev/src/Internal/SQLServer_Dialect.enso`,
  `distribution/lib/Standard/Snowflake/0.0.0-dev/src/Internal/Snowflake_Dialect.enso`,
  `distribution/lib/Standard/AWS/0.0.0-dev/src/Database/Redshift/Internal/Redshift_Dialect.enso`
  (`flagged`)
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/docs/api/Dialects/Dialect_Flag.md`
  (generated)
- Modify: `test/Table_Tests/src/Common_Table_Operations/Aggregate_Spec.enso`,
  `test/Table_Tests/src/Common_Table_Operations/Main.enso` (`Test_Setup`)
- Modify: `test/Table_Tests/src/In_Memory/Common_Spec.enso`,
  `test/Table_Tests/src/Database/SQLite_Spec.enso`,
  `test/Table_Tests/src/Database/Postgres_Spec.enso`,
  `test/DuckDB_Tests/src/DuckDB_Spec.enso`,
  `test/Microsoft_Tests/src/SQLServer_Spec.enso`,
  `test/Snowflake_Tests/src/Snowflake_Spec.enso`,
  `test/AWS_Tests/src/Redshift_Spec.enso`
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/CLAUDE.md`

**Interfaces:**

- Produces: `Dialect_Flag.First_Last_Respects_Row_Order`,
  `Dialect_Flag.Reports_Aggregation_Problems`,
  `Dialect_Flag.Concatenate_Follows_Row_Order`, answered by all six dialects.
- Produces: `Test_Setup.Config`'s field
  `is_aggregate_supported : Aggregate_Column -> Boolean` in place of
  `aggregate_test_selection`. Task 2 derives it in `Setups.database_setup`.
- Produces: `Aggregate_Spec.Aggregate_Support` (private constructor,
  `from_setup setup`), with the old flag names as fields plus `concatenate`
  (whether `Concatenate` runs at all). Task 2's `Aggregate_Spec.enso:1818` rule
  reads `concatenate`.

- [ ] **Step 1: The baseline.** On Linux, build the engine from `develop` at
      Task 5's merge commit (a clone or worktree on the Linux filesystem is much
      faster than `/mnt/c`) and record the JUnit reports of every database
      backend that runs here. Start the databases the way CI does
      (`.github/workflows/engine-checks-platform.yml`, `postgres:18` and
      `mssql/server:2022-latest`):

```bash
. ~/.enso-toolchain.sh
docker start enso-pg 2>/dev/null || docker run -d --name enso-pg -p 5432:5432 \
  -e POSTGRES_DB=enso_test_db -e POSTGRES_USER=enso_test_user \
  -e POSTGRES_PASSWORD=enso_test_password postgres:18
docker start enso-mssql 2>/dev/null || docker run -d --name enso-mssql -p 1433:1433 \
  -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=enso_test_password_<YourStrong@Passw0rd>' \
  mcr.microsoft.com/mssql/server:2022-latest
export ENSO_POSTGRES_DATABASE=enso_test_db ENSO_POSTGRES_HOST=localhost:5432 \
  ENSO_POSTGRES_USER=enso_test_user ENSO_POSTGRES_PASSWORD=enso_test_password
export ENSO_SQLSERVER_DATABASE=tempdb ENSO_SQLSERVER_HOST=localhost ENSO_SQLSERVER_PORT=1433 \
  ENSO_SQLSERVER_USER=sa 'ENSO_SQLSERVER_PASSWORD=enso_test_password_<YourStrong@Passw0rd>'
J=$HOME/junit/task1-before
sbt buildEngineDistribution
ENSO_TEST_JUNIT_DIR=$J/native corepack pnpm --filter build-scripts run stdlib-test -- \
  standard-library-in-native --only Table_Tests,DuckDB_Tests,Snowflake_Tests
ENSO_TEST_JUNIT_DIR=$J/microsoft corepack pnpm --filter build-scripts run stdlib-test -- std-microsoft
(cd test && ENSO_TEST_JUNIT_DIR=$J/aws JAVA_TOOL_OPTIONS="-enableassertions" \
  ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/AWS_Tests")
```

`stdlib-test` writes `<ENSO_TEST_JUNIT_DIR>/<project>/JUnit.xml` (it empties the
directory first, hence one directory per run) and starts the HTTP test helper
itself; `AWS_Tests` runs by hand because the `std-aws` suite skips itself
without AWS credentials. Expected: `Table_Tests` reports its `[PostgreSQL]` and
`[SQLite File]` groups run, `Microsoft_Tests` its `[SQLServer]` groups, and
`Snowflake_Tests` and `AWS_Tests` one pending `Database tests` group each. On
Windows, the same `standard-library-in-native` run without the databases, into
`%USERPROFILE%\junit\task1-before\native`.

- [ ] **Step 2: The flags.** In `Dialect_Flag.enso`, after
      `Supports_Regex_Match`:

```enso
    ## ---
       private: true
       ---
       Specifies if `First` and `Last` without `order_by` take the rows in
       their order. If `False`, they require an ordering and report
       `Aggregation_Requires_Order` without one.
    First_Last_Respects_Row_Order
    ## ---
       private: true
       ---
       Specifies if an aggregation reports problems found in individual values
       (`Invalid_Aggregation`, for example values `Minimum` cannot compare), as
       the in-memory backend does.
    Reports_Aggregation_Problems
    ## ---
       private: true
       ---
       Specifies if `Concatenate` joins the values in the order of the rows.
       If `False`, the order of the parts is unspecified.
    Concatenate_Follows_Row_Order
```

In each dialect's `flagged`, after its `Dialect_Flag.Supports_Regex_Match ->`
line, add the three answers:

| Dialect file                            | `First_Last_Respects_Row_Order` | `Reports_Aggregation_Problems` | `Concatenate_Follows_Row_Order` |
| --------------------------------------- | ------------------------------- | ------------------------------ | ------------------------------- |
| `Postgres_Family/Postgres_Dialect.enso` | `False`                         | `False`                        | `True`                          |
| `SQLite/.../SQLite_Dialect.enso`        | `False`                         | `False`                        | `True`                          |
| `DuckDB/.../DuckDB_Dialect.enso`        | `False`                         | `False`                        | `True`                          |
| `Microsoft/.../SQLServer_Dialect.enso`  | `False`                         | `False`                        | `False`                         |
| `Snowflake/.../Snowflake_Dialect.enso`  | `False`                         | `False`                        | `False`                         |
| `AWS/.../Redshift_Dialect.enso`         | `False`                         | `False`                        | `True`                          |

For example, Postgres_Dialect becomes:

```enso
            Dialect_Flag.Supports_Regex_Match -> True
            Dialect_Flag.First_Last_Respects_Row_Order -> False
            Dialect_Flag.Reports_Aggregation_Problems -> False
            Dialect_Flag.Concatenate_Follows_Row_Order -> True
```

Then
`git grep -c "Dialect_Flag.Concatenate_Follows_Row_Order ->" -- 'distribution/lib/Standard/*/src/*.enso'`
prints six files with one match each.

- [ ] **Step 3: `Test_Setup`.** In `Common_Table_Operations/Main.enso`, the
      `Config` line's `aggregate_test_selection` becomes
      `is_aggregate_supported`, and its doc bullet becomes:

```enso
       - is_aggregate_supported: A function that takes an `Aggregate_Column`
         and returns whether the backend can compute it (a database answers
         with its dialect's `check_aggregate_support`).
```

- [ ] **Step 4: `Aggregate_Spec`.** Delete `type Test_Selection` (lines 19–20)
      and put in its place:

```enso
## The aggregates the backend under test supports, and how they behave, asked
   of the backend: see Note [Aggregate Capabilities].
type Aggregate_Support
    private Value advanced_stats:Boolean text_concat:Boolean concatenate:Boolean text_shortest_longest:Boolean first_last:Boolean first_last_row_order:Boolean first_last_multi_order:Boolean first_last_ignore_nothing:Boolean std_dev:Boolean multi_distinct:Boolean aggregation_problems:Boolean date_support:Boolean

    ## Asks the backend of `setup` what it supports.
    from_setup setup -> Aggregate_Support =
        supports aggregate = setup.is_aggregate_supported aggregate
        concatenate = supports (Aggregate_Column.Concatenate "A")
        advanced_stats = (supports (Aggregate_Column.Median "A")) && (supports (Aggregate_Column.Mode "A")) && (supports (Aggregate_Column.Percentile 0.5 "A"))
        text_shortest_longest = (supports (Aggregate_Column.Shortest "A")) && (supports (Aggregate_Column.Longest "A"))
        first_last = supports (Aggregate_Column.First "A" ignore_nothing=False order_by=["B"])
        first_last_multi_order = supports (Aggregate_Column.First "A" ignore_nothing=False order_by=["B", "C"])
        first_last_ignore_nothing = supports (Aggregate_Column.First "A" ignore_nothing=True order_by=["B"])
        std_dev = supports (Aggregate_Column.Standard_Deviation "A")
        multi_distinct = supports (Aggregate_Column.Count_Distinct ["A", "B"])
        Aggregate_Support.Value advanced_stats=advanced_stats text_concat=(concatenate && (setup.flagged ..Concatenate_Follows_Row_Order)) concatenate=concatenate text_shortest_longest=text_shortest_longest first_last=first_last first_last_row_order=(setup.flagged ..First_Last_Respects_Row_Order) first_last_multi_order=first_last_multi_order first_last_ignore_nothing=first_last_ignore_nothing std_dev=std_dev multi_distinct=multi_distinct aggregation_problems=(setup.flagged ..Reports_Aggregation_Problems) date_support=(setup.flagged ..Date_Time)

## Note [Aggregate Capabilities]
   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   Whether an aggregate runs at all is asked as the product asks it:
   `make_aggregate_column` (Database's `Internal/Aggregate_Helper.enso`) first
   calls the dialect's `check_aggregate_support`, and so does
   `setup.is_aggregate_supported`. The SQL generator's
   `is_operation_supported` is not the same question: SQL Server's generator
   has `SHORTEST` and `LONGEST`, and Redshift's `MODE`, `MEDIAN` and
   `PERCENTILE`, while their `check_aggregate_support` rejects them. How a
   supported aggregate behaves is a `Dialect_Flag`: `First_Last_Respects_Row_Order`,
   `Reports_Aggregation_Problems`, `Concatenate_Follows_Row_Order`, `Date_Time`.
   The column names are placeholders: `check_aggregate_support` looks only at
   the kind of aggregate, the number of columns, `ignore_nothing` and whether
   there is an `order_by`.
```

In `add_aggregate_specs`, `test_selection = setup.aggregate_test_selection`
(line 55) becomes `test_selection = Aggregate_Support.from_setup setup`. In the
NaN group (line 1342) delete ` pending=(resolve_pending test_selection.nan)`:
the line becomes
`    if setup.flagged ..Supports_Separate_NaN then suite_builder.group prefix+"Table.aggregate should correctly handle NaN" group_builder->`.
Then
`grep -n "test_selection\.nan\|problem_handling\|Test_Selection" Aggregate_Spec.enso`
prints nothing; the other `test_selection.<flag>` uses read the same names and
stay. The two name checks at 1025 and 1818 stay until Task 2.

- [ ] **Step 5: The backends.** In each of the seven setups, delete the
      `aggregate_selection = Common_Table_Operations.Aggregate_Spec.Test_Selection.Config …`
      line (and, in `SQLite_Spec.enso`, the comment block above it, whose
      reasons the Note now gives), add the function, and in the
      `Test_Setup.Config` line replace
      `aggregate_test_selection=aggregate_selection` with
      `is_aggregate_supported=is_aggregate_supported_fn`.
  - Database backends (`SQLite_Spec.enso` `sqlite_spec`, `Postgres_Spec.enso`
    `add_postgres_specs`, `DuckDB_Spec.enso` `duckdb_spec`,
    `SQLServer_Spec.enso` `add_sqlserver_specs`, `Snowflake_Spec.enso`
    `add_snowflake_specs`, `Redshift_Spec.enso` `add_database_specs`), next to
    `flagged_fn`:

```enso
    is_aggregate_supported_fn aggregate = (default_connection.get.dialect.check_aggregate_support aggregate).is_error.not
```

- In memory (`In_Memory/Common_Spec.enso` `in_memory_setup`), next to
  `is_operation_supported_fn`:

```enso
    is_aggregate_supported_fn _ =
        True
```

`git grep -n "aggregate_selection\|aggregate_test_selection\|Aggregate_Spec.Test_Selection" -- test`
prints nothing.

- [ ] **Step 6: Build, docs, proof.** Rebuild (`sbt buildEngineDistribution`),
      regenerate the API docs and check them:

```bash
sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Database/0.0.0-dev"
git status --short distribution/lib/Standard/Database/0.0.0-dev/docs/api
corepack pnpm --filter build-scripts run stdlib-api-check
```

Expected: only `docs/api/Dialects/Dialect_Flag.md` changes, with the three names
in its sorted list; no other library's `docs/api` changes (`flagged`'s signature
is unchanged). Repeat Step 1's commands with `J=$HOME/junit/task1-after`, then
compare each pair:

```bash
for run in native microsoft aws; do
  corepack pnpm --silent --filter build-scripts run junit-compare -- \
    $HOME/junit/task1-before/$run $HOME/junit/task1-after/$run
done
```

Expected: every row `same` (`Table_Tests`, `DuckDB_Tests`, `Snowflake_Tests`,
`Microsoft_Tests`, `AWS_Tests`). A row that differs names its cases below the
table; a known flake is re-run, and only a documented one may be `--allow`ed,
with the reason in the PR body. On Windows, compare the `native` pair the same
way.

- [ ] **Step 7: Docs, commit, PR.** In `Database/0.0.0-dev/CLAUDE.md`'s "Where
      to read more", after the `Common_Table_Operations` bullet, add: "Which
      aggregates a backend runs is its dialect's `check_aggregate_support`; how
      they behave, its `flagged` answers (`First_Last_Respects_Row_Order`,
      `Reports_Aggregation_Problems`, `Concatenate_Follows_Row_Order`): a new
      `Dialect_Flag` must be answered by every dialect, whose `case` has no
      default." Commit, open the PR
      (`Database: aggregate capabilities come from the dialect`) with the
      `CI: No changelog needed` label. Body: the flag table from the rulings,
      the `check_aggregate_support` ruling and its evidence, Redshift's
      `date_support`, the `junit-compare` tables, and that Snowflake and
      Redshift only compiled and stayed pending. Merge on green.

---

### Task 2: `Standard.Database_Test_Suite`

A feature for library authors: the changelog entry (Step 13).

**Files (moves):**

```bash
S=distribution/lib/Standard/Database_Test_Suite/0.0.0-dev
T=test/Table_Tests
H=test/Base_Tests/polyglot-sources/enso-test-java-helpers/src/main/java/org/enso/table_test_helpers
J=std-bits/database-test-suite/src/main/java/org/enso/database_test_suite
mkdir -p $S/src/Database/Common $S/src/Database/Helpers $S/src/Internal $S/data $S/docs/api \
  test/Cloud_Tests/src/Database $J
git mv $T/src/Common_Table_Operations $S/src/Common_Table_Operations
git mv $T/src/Common_Table_Operations.enso $S/src/Common_Table_Operations.enso
git mv $T/src/Util.enso $S/src/Util.enso
for f in Common_Spec Default_Ordering_Spec IR_Spec Names_Length_Limits_Spec Single_Column_Table_Spec; do
  git mv $T/src/Database/Common/$f.enso $S/src/Database/Common/$f.enso
done
git mv $T/src/Database/Upload_Spec.enso $S/src/Database/Upload_Spec.enso
git mv $T/src/Database/Transaction_Spec.enso $S/src/Database/Transaction_Spec.enso
git mv $T/src/Database/Helpers/Name_Generator.enso $S/src/Database/Helpers/Name_Generator.enso
git mv $T/data/data.csv $S/data/data.csv
git mv $T/src/Database/Common/Audit_Spec.enso test/Cloud_Tests/src/Database/Audit_Spec.enso
git mv $T/src/Database/Common/Save_Connection_Data_Link.enso \
  test/Cloud_Tests/src/Database/Save_Connection_Data_Link.enso
cp test/Base_Tests/src/Data/Round_Spec.enso $S/src/Common_Table_Operations/Round_Spec.enso
git mv $H/ExplodingStorage.java $H/ExplodingStoragePayload.java $J/
```

The library keeps the paths the files had under `test/Table_Tests/src`, so their
`project.Common_Table_Operations.*`, `project.Database.*` and `project.Util`
imports stay valid inside it.

**Files (create and modify):**

- Create: `$S/package.yaml`, `$S/src/Main.enso`, `$S/src/Backend.enso`,
  `$S/src/Known_Issue.enso`, `$S/src/Suite_Part.enso`,
  `$S/src/Internal/Setups.enso`, `$S/src/Database/JSON_Table_Data.enso`,
  `$S/CLAUDE.md`, `$S/docs/api/**` (generated),
  `std-bits/database-test-suite/CLAUDE.md`,
  `test/Table_Tests/src/IO/File_Util.enso`
- Modify (moved):
  `$S/src/Common_Table_Operations/{Main,Aggregate_Spec,Column_Operations_Spec,Date_Column_Spec,Date_Time_Column_Spec,Expression_Spec,Integration_Tests,Text_Column_Spec,Util,Round_Spec}.enso`,
  `$S/src/Common_Table_Operations/Join/Join_Spec.enso`,
  `$S/src/Database/Upload_Spec.enso`,
  `$S/src/Database/Common/Names_Length_Limits_Spec.enso`, `$S/src/Util.enso`,
  `test/Cloud_Tests/src/Database/{Audit_Spec,Save_Connection_Data_Link}.enso`,
  the two `.java` files (package), `test/Base_Tests/src/Data/Round_Spec.enso` (a
  note), `$S/src/Database/Common/Default_Ordering_Spec.enso` (a doc line)
- Modify:
  `std-bits/table/src/main/resources/META-INF/native-image/org/enso/table/reflect-config.json`
  (the two `ExplodingStorage*` entries' package)
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Dialects/Dialect_Flag.enso`
  and the six dialects' `flagged` (five more variants),
  `distribution/lib/Standard/Database/0.0.0-dev/docs/api/Dialects/Dialect_Flag.md`
- Modify: `test/Table_Tests/src/In_Memory/Common_Spec.enso`,
  `test/Table_Tests/src/Database/{SQLite_Spec,Postgres_Spec}.enso`,
  `test/Table_Tests/src/IO/{Excel_Spec,Delimited_Write_Spec,YXDB_Spec}.enso` and
  every `test/Table_Tests/src` file importing a moved module (Step 9)
- Modify: `test/DuckDB_Tests/src/{DuckDB_Spec,DuckDB_In_Memory_Spec}.enso`,
  `test/Microsoft_Tests/src/SQLServer_Spec.enso`,
  `test/Snowflake_Tests/src/{Snowflake_Spec,Snowflake_Bulk_Spec,Snowflake_Stage_Spec}.enso`,
  `test/AWS_Tests/src/{Redshift_Spec,S3_Spec}.enso`,
  `test/Generic_JDBC_Tests/src/{Generic_JDBC_Postgres_Spec,Generic_JDBC_SQLite_Spec}.enso`,
  `test/Cloud_Tests/src/Network/Fetch_Spec.enso`,
  `test/Saas_Tests/src/Salesforce_Spec.enso`,
  `test/Tableau_Tests/src/Write_Spec.enso`, `test/Google_Test/src/Main.enso`
- Modify: `build.sbt`, `.gitignore`, `distribution/edition.template.yaml`,
  `tools/ci/stdlib-test-map.yaml`, `tools/ci/check-workflows.mjs`,
  `tools/ci/check-workflows.test.mjs`, `tools/ci/README.md`,
  `project/EngineBundle.scala`, `project/IRCaches.scala`, `project/CLAUDE.md`
- Modify: `distribution/lib/Standard/CLAUDE.md`,
  `distribution/lib/Standard/Database/0.0.0-dev/CLAUDE.md`,
  `distribution/lib/Standard/Table/0.0.0-dev/CLAUDE.md`, `std-bits/CLAUDE.md`,
  `test/CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**

- Consumes: Task 1's `Test_Setup.is_aggregate_supported` and
  `Aggregate_Support.concatenate`.
- Produces: library `Standard.Database_Test_Suite` exporting `Backend`
  (`Backend.Value name connect temporary_tables=True persistent_connections=True known_failures=[] run_advanced_edge_cases=True parts=Suite_Part.all is_integer_type=(.is_integer)`,
  `Backend.In_Memory`, `prefix`, `has_known_issue`), `Known_Issue`
  (`Full_Join_With_Between`, `Unordered_Concatenate`, `No_Literal_Tables`,
  `Filter_After_Distinct`; `description`, `issue_url`, `pending`) and
  `Suite_Part` (`Common`, `Table_Operations`, `Upload`, `IR`, `Transactions`;
  `Suite_Part.all`); the module functions
  `Database_Test_Suite.add_specs suite_builder backend -> Test_Setup` and
  `Database_Test_Suite.data_directory -> File`.
- Produces: `Test_Setup.Config` gains `backend` and `default_connection` (a lazy
  holder; `.get`), and the methods `has_known_issue issue` and
  `pending_for issue`.
- Produces: modules `Standard.Database_Test_Suite.Util`,
  `….Common_Table_Operations.Util`, `….Database.Helpers.Name_Generator` and
  `….Database.JSON_Table_Data` (type `JSON_Table_Data`) for backends' own specs.
  Task 3's projects import them.
- Produces: `enso_dev.Cloud_Tests.Database.Audit_Spec` and
  `enso_dev.Cloud_Tests.Database.Save_Connection_Data_Link` (same `add_specs`
  signatures as before).
- Produces: `Dialect_Flag.Supports_Null_Typed_Columns`,
  `Dialect_Flag.Row_Min_Max_Ignores_Nothing`,
  `Dialect_Flag.Text_Reverse_Keeps_Grapheme_Clusters`,
  `Dialect_Flag.Reads_Rows_In_Insertion_Order`,
  `Dialect_Flag.Enforces_Primary_Key_Uniqueness`.
- Produces: sbt project `std-database-test-suite`; the policy rule
  `checkSuiteIgnoresBackendNames`; `EngineBundle.librariesNotBundled`.

- [ ] **Step 1: The DuckDB issue.** Write the body with the Write tool to
      `duckdb-distinct.md` in your scratch directory: "On DuckDB,
      `t.distinct ["A"]` followed by `.filter "B" (Filter_Condition.Equal 5)`
      returns rows the `distinct` had dropped: the filter changes which row of
      each group `distinct` keeps. The shared table specs skip that check for
      DuckDB (`Integration_Tests.enso`, the `distinct` integration spec);
      `Standard.Database_Test_Suite` lists it as
      `Known_Issue.Filter_After_Distinct`." Then:

```bash
gh issue create --repo jdunkerley/enso \
  --title "DuckDB: a filter after distinct changes which rows distinct kept" \
  --body-file <scratch>/duckdb-distinct.md
```

It prints the issue's URL. Step 3 writes that URL as
`Known_Issue.Filter_After_Distinct`'s `issue_url`, and the PR body names the
issue: the one value of this plan that exists only once the step has run.

Step 1's Task 5 is still in progress as this is written. Once it has merged,
re-check the three anchors this task takes from it: the `.gitignore` line
`distribution/lib/Standard/Postgres/*/polyglot/` (Step 5), the
`Standard.Postgres` entry in `distribution/edition.template.yaml` (Step 10), and
`Standard.Postgres`' paths in `Postgres_Spec.enso`'s imports (Step 8). Where one
differs, put the new line next to what Task 5 actually wrote.

- [ ] **Step 2: The moves.** Run the move block above. In the two `.java` files,
      `package org.enso.table_test_helpers;` becomes
      `package org.enso.database_test_suite;`, and in
      `std-bits/table/src/main/resources/META-INF/native-image/org/enso/table/reflect-config.json`
      the entries `org.enso.table_test_helpers.ExplodingStoragePayload` and
      `org.enso.table_test_helpers.ExplodingStorage` become
      `org.enso.database_test_suite.ExplodingStoragePayload` and
      `org.enso.database_test_suite.ExplodingStorage` (their `methods` stay;
      `PolyglotHelpers` and `RandomHelpers` stay in the old package). Move
      `YXDB_Spec`'s reader off `data.csv`: in
      `test/Table_Tests/src/IO/YXDB_Spec.enso:81`,
      `data_file = enso_project.data / 'data.csv'` becomes
      `data_file = enso_project.data / 'one_row.csv'`. Then:

```bash
git grep -n "table_test_helpers.Exploding" -- test std-bits distribution
git grep -n "data\.csv['\"]" -- test/Table_Tests
```

Expected: the first prints only `Upload_Spec`'s two imports, which Step 4
changes; the second prints only the readers Step 8 removes (`SQLite_Spec`'s and
`Postgres_Spec`'s `agg_in_memory_table`, `In_Memory/Common_Spec`'s
`agg_table_fn`).

- [ ] **Step 3: The library's own files.** `$S/package.yaml`:

```yaml
name: Database_Test_Suite
namespace: Standard
version: 0.0.0-dev
license: APLv2
authors:
  - name: Enso Team
    email: contact@enso.org
maintainers:
  - name: Enso Team
    email: contact@enso.org
public-types: [Backend, Known_Issue, Suite_Part]
catalogue: false
```

`$S/src/Main.enso` (one export per line, as `checkPublicTypes` reads them):

```enso
from Standard.Base import all

import project.Backend.Backend
import project.Common_Table_Operations.Main.Test_Setup
import project.Internal.Setups

export project.Backend.Backend
export project.Known_Issue.Known_Issue
export project.Suite_Part.Suite_Part

## Adds the parts of the suite that `backend` runs to `suite_builder`, and
   returns the `Test_Setup` they use, so that the backend's own specs can share
   its connection and table builders.

   ## Arguments
   - `suite_builder`: The builder the specs are added to.
   - `backend`: The backend under test.
add_specs suite_builder backend:Backend -> Test_Setup =
    Setups.add_specs suite_builder backend

## The suite's `data` directory, with `data.csv`.
data_directory -> File = enso_project.data
```

`$S/src/Suite_Part.enso`:

```enso
from Standard.Base import all

## A part of the suite, which a backend runs or not (`Backend.Value`'s `parts`).
type Suite_Part
    ## The specs every database shares: connections, queries, column
       information, name length limits, default ordering (`Database/Common`).
    Common

    ## The table operations, which the in-memory table runs too
       (`Common_Table_Operations`).
    Table_Operations

    ## Creating, uploading to, appending to and deleting from tables
       (`Upload_Spec`).
    Upload

    ## The internal representation of queries (`IR_Spec`).
    IR

    ## Transactions (`Transaction_Spec`).
    Transactions

    ## Every part: what a new backend runs.
    all -> Vector Suite_Part =
        [Suite_Part.Common, Suite_Part.Table_Operations, Suite_Part.Upload, Suite_Part.IR, Suite_Part.Transactions]
```

`$S/src/Known_Issue.enso` (`Filter_After_Distinct`'s URL is the one Step 1
printed):

```enso
from Standard.Base import all

## A known failure of a backend: a bug, with the issue that tracks it. A backend
   lists its known issues in `Backend.Value`'s `known_failures`; a spec that one
   affects is pending for that backend, or works around it. The set is closed:
   a misspelt issue does not compile.
type Known_Issue
    ## A `Full` join with a `Between` condition is not supported (PostgreSQL).
    Full_Join_With_Between

    ## `Concatenate` joins the values in no fixed order (Snowflake).
    Unordered_Concatenate

    ## A literal table cannot carry the type of a `Nothing` value (SQL Server).
    No_Literal_Tables

    ## A filter after `distinct` changes which rows the `distinct` kept (DuckDB).
    Filter_After_Distinct

    ## What goes wrong.
    description self -> Text = case self of
        Known_Issue.Full_Join_With_Between -> "a Full join with a Between condition is not supported"
        Known_Issue.Unordered_Concatenate -> "Concatenate joins the values in no fixed order"
        Known_Issue.No_Literal_Tables -> "a literal table cannot carry the type of a Nothing value"
        Known_Issue.Filter_After_Distinct -> "a filter after distinct changes which rows the distinct kept"

    ## The issue that tracks it.
    issue_url self -> Text = case self of
        Known_Issue.Full_Join_With_Between -> "https://github.com/enso-org/enso/issues/8243"
        Known_Issue.Unordered_Concatenate -> "https://github.com/enso-org/enso/issues/10412"
        Known_Issue.No_Literal_Tables -> "https://github.com/enso-org/enso/issues/11487"
        Known_Issue.Filter_After_Distinct -> "https://github.com/jdunkerley/enso/issues/<the number Step 1 printed>"

    ## The reason a spec it affects is pending.
    pending self -> Text =
        "Known issue: " + self.description + " (" + self.issue_url + ")."
```

`$S/src/Backend.enso`:

```enso
from Standard.Base import all

import project.Known_Issue.Known_Issue
import project.Suite_Part.Suite_Part

## The backend the suite runs against: the only thing a backend's test project
   writes. What it supports is asked of its connection's dialect.
type Backend
    ## A database backend.

       ## Arguments
       - `name`: The backend's name. Its test groups start with it in brackets
         (`"PostgreSQL"` gives `"[PostgreSQL] "`); specs never read it.
       - `connect`: Opens a new connection to the database under test; it is
         called with `Nothing`.
       - `temporary_tables`: Whether the tables the specs build are temporary.
       - `persistent_connections`: Whether a new connection sees the tables an
         earlier one made (`False` for SQLite in memory).
       - `known_failures`: The backend's known issues.
       - `run_advanced_edge_cases`: Whether the slower edge-case specs run;
         `ENSO_ADVANCED_EDGE_CASE_TESTS` runs them anyway.
       - `parts`: The parts of the suite to run.
       - `is_integer_type`: Whether the backend treats a `Value_Type` as an
         integer type.
    Value name:Text connect temporary_tables:Boolean=True persistent_connections:Boolean=True known_failures:Vector=[] run_advanced_edge_cases:Boolean=True parts:Vector=Suite_Part.all is_integer_type=(.is_integer)

    ## The in-memory table: the reference backend, which `Table_Tests` runs.
    In_Memory

    ## The text the backend's test groups start with.
    prefix self -> Text = case self of
        Backend.Value name _ _ _ _ _ _ _ -> "[" + name + "] "
        Backend.In_Memory -> "[In-Memory] "

    ## Whether the backend lists `issue` among its known failures.
    has_known_issue self issue:Known_Issue -> Boolean = case self of
        Backend.Value _ _ _ _ known_failures _ _ _ -> known_failures.contains issue
        Backend.In_Memory -> False
```

`$S/src/Database/JSON_Table_Data.enso`: `from Standard.Base import all`, then
`type JSON_Table_Data` moved unchanged from
`test/Table_Tests/src/Database/Postgres_Spec.enso` (lines 49–70:
`Value ~connection`, `expected`, `expected_objects`,
`setup create_connection_fn types`, `teardown`) and deleted there.

`std-bits/database-test-suite/CLAUDE.md`: "Java helpers for
`Standard.Database_Test_Suite`, packaged as its `polyglot/java` jar:
`ExplodingStorage` (a column storage that throws at a given index, so
`Upload_Spec` can interrupt an upload) and `ExplodingStoragePayload` (what it
throws). Depends on `std-table` only, as `provided`; no third-party jars."

- [ ] **Step 4: Imports and files inside the moved code.** Within the suite:

```bash
cd distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src
sed -i 's/^import enso_dev\.Table_Tests\.Util$/import project.Util/' \
  Common_Table_Operations/Date_Column_Spec.enso Common_Table_Operations/Date_Time_Column_Spec.enso \
  Common_Table_Operations/Text_Column_Spec.enso
sed -i 's/^import enso_dev\.Base_Tests\.Data\.Round_Spec$/import project.Common_Table_Operations.Round_Spec/' \
  Common_Table_Operations/Column_Operations_Spec.enso
sed -i 's/^from enso_dev\.Cloud_Tests\.Network\.Enso_Cloud\.Cloud_Tests_Setup import run_with_and_without_output$/from project.Util import run_with_and_without_output/' \
  Database/Upload_Spec.enso Database/Common/Names_Length_Limits_Spec.enso
sed -i 's/^polyglot java import org\.enso\.table_test_helpers\./polyglot java import org.enso.database_test_suite./' \
  Database/Upload_Spec.enso
sed -i 's/^from project\.In_Memory\.Common_Spec import in_memory_setup$/from project.Internal.Setups import in_memory_setup/' \
  Common_Table_Operations/Util.enso
cd -
git grep -n "enso_dev\.\|In_Memory\.Common_Spec\|table_test_helpers" -- distribution/lib/Standard/Database_Test_Suite
```

Expected: the grep prints nothing. Then by hand:

- `$S/src/Util.enso`: delete
  `polyglot java import org.enso.base_test_helpers.FileSystemHelper` and
  `set_writable`; after
  `import Standard.Base.Errors.Illegal_Argument.Illegal_Argument` add
  `import Standard.Base.Runtime.Context` (as `Cloud_Tests_Setup` imports it);
  after `normalize_lines` add:

```enso
## Runs `action` twice: with the Output context enabled, and in a dry run
   with it disabled. A copy of `Cloud_Tests_Setup.run_with_and_without_output`
   in `test/Cloud_Tests`, which a library cannot import.
run_with_and_without_output ~action =
    Context.Output.with_enabled <|
        Test.with_clue "(normal mode - Output context enabled) " <|
            action
    Context.Output.with_disabled <|
        Test.with_clue "(dry run - Output context disabled) " <|
            action
```

- `$S/src/Common_Table_Operations/Round_Spec.enso`: as its first line,
  `## A copy of test/Base_Tests/src/Data/Round_Spec.enso, which the table specs reuse for Column.round: a library cannot import a test project. Keep the two in step.`;
  and at the top of `test/Base_Tests/src/Data/Round_Spec.enso`,
  `## distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src/Common_Table_Operations/Round_Spec.enso is a copy of this file. Keep the two in step.`
- `Database/Common/Default_Ordering_Spec.enso` (line 41): the doc line
  `  group with the given`prefix` as its name prefix.` becomes
  `  group whose name starts with the given`prefix`.` (prose, but it would read
  as a test of `prefix.` to a plain grep; the policy rule skips doc blocks
  anyway).
- `Common_Table_Operations/Integration_Tests.enso` (line 183):
  `xls = (enso_project.data / 'transient' / 'add_row_number.xls')` becomes the
  two lines `xls = File.create_temporary_file "add_row_number" ".xls"` and
  `xls.delete_if_exists` (the Excel writer would read an existing empty file as
  a workbook).
- `Database/Upload_Spec.enso` (line 257):
  `log_file = (Project_Description.new enso_dev.Table_Tests).data / "transient" / "sql.log"`
  becomes `log_file = File.create_temporary_file "sql" ".log"` (the next line
  already deletes it before the log is written).
- `test/Table_Tests/src/IO/File_Util.enso`:

```enso
from Standard.Base import all

polyglot java import org.enso.base_test_helpers.FileSystemHelper

## Makes `file` writable or read-only.
set_writable file writable =
    path = file.absolute.path
    FileSystemHelper.setWritable path writable
```

In `IO/Excel_Spec.enso` add `import project.IO.File_Util` and change its three
`Util.set_writable` calls to `File_Util.set_writable`; in
`IO/Delimited_Write_Spec.enso` add
`from project.IO.File_Util import set_writable`.

- `test/Cloud_Tests/src/Database/Audit_Spec.enso` and
  `Save_Connection_Data_Link.enso`: run
  `sed -i -E 's/^(import|from) enso_dev\.Cloud_Tests\./\1 project./'` on both.
  In `Audit_Spec.enso` delete
  `import project.Database.Postgres_Spec.Temporary_Data_Link_File`,
  `from project.Database.Postgres_Spec import get_configured_connection_details`
  and `main` (its last seven lines), and `from project.Util import all` becomes
  `from Standard.Database_Test_Suite.Util import all`.

- [ ] **Step 5: `std-database-test-suite`.** In `build.sbt`, next to the
      `` `postgres-polyglot-root` `` value:

```scala
val `database-test-suite-polyglot-root` =
  stdLibComponentRoot("Database_Test_Suite") / "polyglot" / "java"
```

and after `` `std-generic-jdbc` ``:

```scala
lazy val `std-database-test-suite` = project
  .in(file("std-bits") / "database-test-suite")
  .settings(
    frgaalJavaCompilerSetting,
    autoScalaLibrary := false,
    Compile / packageBin / artifactPath :=
      `database-test-suite-polyglot-root` / "std-database-test-suite.jar",
    clean := Def.task {
      val _ = clean.value
      IO.delete(`database-test-suite-polyglot-root`)
    }.value
  )
  .dependsOn(`std-table` % "provided")
```

Add `` `std-database-test-suite`, `` to the root aggregate list (after
`` `std-database`, ``) and
``.dependsOn(`std-database-test-suite` / Compile / packageBin)`` to `runtime`'s
`(Runtime / compile)` chain (after `` `std-database` ``'s), so the jar is in
`distribution/lib` before `buildEngineDistribution` copies it. No
`GatherLicenses.distributions` entry: the jar has no third-party dependency. In
`.gitignore`, after `distribution/lib/Standard/Postgres/*/polyglot/`, add
`distribution/lib/Standard/Database_Test_Suite/*/polyglot/`. Run
`sbt "std-database-test-suite/packageBin; javafmtCheckAll"`; expected:
`$S/polyglot/java/std-database-test-suite.jar` exists.

- [ ] **Step 6: The setups and `add_specs`.** `$S/src/Internal/Setups.enso` (the
      in-memory part is `in_memory_setup`, moved from
      `test/Table_Tests/src/In_Memory/Common_Spec.enso` with `Dummy_Connection`;
      the database part is what the six backends repeat today):

```enso
from Standard.Base import all
import Standard.Base.Runtime.Ref.Ref

from Standard.Table import Aggregate_Column, Table

# `select_into_database_table` and `create_literal_table` are Database's
# extensions of `Table`, in scope only with Database imported.
from Standard.Database import all
import Standard.Database.Dialects.Dialect_Flag.Dialect_Flag
import Standard.Database.Dialects.Feature.Feature

import project.Backend.Backend
import project.Common_Table_Operations
import project.Common_Table_Operations.Main.Test_Selection
import project.Common_Table_Operations.Main.Test_Setup
import project.Database.Common.Common_Spec
import project.Database.Common.IR_Spec
import project.Database.Helpers.Name_Generator
import project.Database.Transaction_Spec
import project.Database.Upload_Spec
import project.Known_Issue.Known_Issue
import project.Suite_Part.Suite_Part

## ---
   private: true
   ---
   A value computed when first asked for, then kept.
type Lazy_Ref
    Value ~get

## ---
   private: true
   ---
   The connection of the in-memory backend, which has none.
type Dummy_Connection
    Value

    close self = Nothing

    drop_table self table =
        _ = table
        Nothing

## ---
   private: true
   ---
   Adds the parts of the suite that `backend` runs; returns their setup.
add_specs suite_builder backend:Backend -> Test_Setup =
    setup = case backend of
        Backend.In_Memory -> in_memory_setup
        _ -> database_setup backend
    case backend of
        Backend.In_Memory ->
            Common_Table_Operations.Main.add_specs suite_builder setup
        _ ->
            runs part = backend.parts.contains part
            prefix = setup.prefix
            if runs Suite_Part.Common then
                Common_Spec.add_specs suite_builder prefix backend.connect setup.default_connection setup
            if runs Suite_Part.Table_Operations then
                Common_Table_Operations.Main.add_specs suite_builder setup
            if runs Suite_Part.Upload then
                Upload_Spec.add_specs suite_builder setup backend.connect persistent_connector=backend.persistent_connections
            if runs Suite_Part.IR then
                IR_Spec.add_specs suite_builder setup prefix setup.default_connection.get
            if runs Suite_Part.Transactions then
                Transaction_Spec.add_specs suite_builder backend.connect prefix
    setup

## ---
   private: true
   ---
   The setup of the in-memory table.
in_memory_setup -> Test_Setup =
    agg_table_fn _ = (enso_project.data / "data.csv") . read
    empty_table_fn _ =
        table = agg_table_fn Nothing
        table.take 0
    materialize = x->x
    table_builder cols connection=Nothing =
        _ = connection
        Table.new cols
    light_table_builder columns =
        Table.new columns
    create_connection_func _ =
        Dummy_Connection.Value
    flagged_fn flag:Dialect_Flag =
        case flag of
            Dialect_Flag.Case_Insensitive_Ordering_By_Default -> False
            Dialect_Flag.Removes_Trailing_Whitespace_Casting_From_Char_To_Varchar -> False
            _ -> True
    is_feature_supported_fn feature:Feature =
        _ = feature
        True
    is_operation_supported_fn operation:Text =
        _ = operation
        True
    is_aggregate_supported_fn aggregate:Aggregate_Column =
        _ = aggregate
        True
    Test_Setup.Config Backend.In_Memory.prefix agg_table_fn empty_table_fn table_builder materialize is_database=False test_selection=Test_Selection.Config is_aggregate_supported=is_aggregate_supported_fn create_connection_func=create_connection_func light_table_builder=light_table_builder is_feature_supported=is_feature_supported_fn flagged=flagged_fn is_operation_supported=is_operation_supported_fn backend=Backend.In_Memory default_connection=(Lazy_Ref.Value Dummy_Connection.Value)

## ---
   private: true
   ---
   The setup of a database backend: a lazy default connection the specs
   share, the table builders, the `data.csv` tables, and the capabilities,
   asked of the connection's dialect.
database_setup backend:Backend -> Test_Setup =
    default_connection = Lazy_Ref.Value (backend.connect Nothing)
    dialect = Lazy_Ref.Value default_connection.get.dialect
    name_counter = Ref.new 0
    table_builder columns connection=Nothing =
        ix = name_counter.get
        name_counter . put ix+1
        name = Name_Generator.random_name "table_"+ix.to_text
        in_mem_table = Table.new columns
        in_mem_table.select_into_database_table (connection.if_nothing default_connection.get) name primary_key=Nothing temporary=backend.temporary_tables
    light_table_builder columns =
        if backend.has_known_issue Known_Issue.No_Literal_Tables then table_builder columns else
            default_connection.get.create_literal_table (Table.new columns) "literal_table"
    agg_in_memory_table = Lazy_Ref.Value ((enso_project.data / "data.csv") . read)
    agg_table_fn _ =
        agg_in_memory_table.get.select_into_database_table default_connection.get (Name_Generator.random_name "Agg1") primary_key=Nothing temporary=True
    empty_agg_table_fn _ =
        (agg_in_memory_table.get.take (..First 0)).select_into_database_table default_connection.get (Name_Generator.random_name "Agg_Empty") primary_key=Nothing temporary=True
    test_selection = Test_Selection.Config supported_replace_params=dialect.get.get_supported_replace_params run_advanced_edge_case_tests_by_default=backend.run_advanced_edge_cases
    # Ascribed, so that the specs' `setup.flagged ..Variant` resolves against
    # `Dialect_Flag` (as the backends' `flagged_fn flag:Dialect_Flag` did).
    is_feature_supported_fn feature:Feature = dialect.get.is_feature_supported feature
    flagged_fn flag:Dialect_Flag = dialect.get.flagged flag
    is_operation_supported_fn operation:Text = dialect.get.is_operation_supported operation
    is_aggregate_supported_fn aggregate:Aggregate_Column = (dialect.get.check_aggregate_support aggregate).is_error.not
    Test_Setup.Config backend.prefix agg_table_fn empty_agg_table_fn table_builder (.read) is_database=True test_selection=test_selection is_aggregate_supported=is_aggregate_supported_fn create_connection_func=backend.connect light_table_builder=light_table_builder is_integer_type=backend.is_integer_type is_feature_supported=is_feature_supported_fn flagged=flagged_fn is_operation_supported=is_operation_supported_fn backend=backend default_connection=default_connection
```

The call sites keep their forms: `setup.flagged ..X` (116 in the moved specs),
`setup.is_feature_supported Feature.X` (38), `setup.is_operation_supported "X"`
(11) and `setup.is_aggregate_supported (Aggregate_Column.X …)` (Task 1's
`Aggregate_Support`);
`git grep -nE "setup\.(flagged|is_feature_supported|is_operation_supported) " -- distribution/lib/Standard/Database_Test_Suite | grep -vE "flagged \.\.|is_feature_supported Feature\.|is_operation_supported \""`
prints nothing.

`temporary=backend.temporary_tables` keeps SQLite's and DuckDB's builders as
they are (they pass no `temporary=`, whose default is `False`). The replace
parameters are now the connected dialect's rather than the static
`<Backend>_Connection.get_dialect`'s: the same dialect, asked through the
connection the specs already open while registering (`setup.flagged` is called
there today). In `Common_Table_Operations/Main.enso`: add
`import project.Known_Issue.Known_Issue`; the `Config` line ends
`… flagged is_operation_supported backend default_connection`; add to the doc
bullets "- backend: The `Backend` under test." and "- default_connection: The
connection the specs share, made when first used (`.get`)."; and after
`expect_integer_type`:

```enso
    ## Whether the backend under test lists `issue` among its known failures.
    has_known_issue self issue:Known_Issue -> Boolean =
        self.backend.has_known_issue issue

    ## The reason a spec that `issue` affects is pending, if the backend under
       test lists it; otherwise `Nothing`.
    pending_for self issue:Known_Issue -> Text | Nothing =
        if self.has_known_issue issue then issue.pending else Nothing
```

- [ ] **Step 7: The checks of the backend's name.** Add
      `import project.Known_Issue.Known_Issue` to `Aggregate_Spec`,
      `Integration_Tests` and `Join/Join_Spec`, then (line numbers as before the
      move):
  - `Aggregate_Spec.enso:1024-1025`: the comment becomes
    `# A backend whose ordered Concatenate specs are off for this known issue still checks that Concatenate runs.`
    and `if setup.prefix.contains "Snowflake" then` becomes
    `if setup.has_known_issue Known_Issue.Unordered_Concatenate then`.
  - `Aggregate_Spec.enso:1818`: the condition becomes
    `if test_selection.concatenate.not then`.
  - `Column_Operations_Spec.enso:203-204`: the comment becomes
    `# Without an ordering, the backend may read the rows back in another order.`
    and the condition
    `if setup.flagged ..Reads_Rows_In_Insertion_Order then table_builder table_structure else`.
  - `Column_Operations_Spec.enso:1546`:
    `pending=(if setup.prefix.contains "SQLite" then "SQLite does not support …")`
    becomes
    `pending=(if (setup.flagged ..Row_Min_Max_Ignores_Nothing).not then "The backend does not ignore NULL values in inputs to functions, so if any input value is NULL then the result will also be NULL.")`.
  - `Expression_Spec.enso:335`, `:368`, `:384`:
    `sed -i -E 's/if setup\.is_database\.not \|\| \(setup\.prefix\.contains "SQLite"\) +then/if setup.flagged ..Supports_Null_Typed_Columns then/' Expression_Spec.enso`
    changes the three lines; the comment above each becomes
    `# This requires a column of Nothing, which only some backends can hold.`
  - `Integration_Tests.enso:158-159`: the comment becomes
    `## Known_Issue.Filter_After_Distinct: a filter after distinct changes which rows it kept.`
    and the condition
    `if (setup.has_known_issue Known_Issue.Filter_After_Distinct).not then`.
  - `Join/Join_Spec.enso:237`:
    `pending=(if prefix.contains "PostgreSQL" then "TODO: fix issue #8243")`
    becomes `pending=(setup.pending_for Known_Issue.Full_Join_With_Between)`.
  - `Text_Column_Spec.enso:161-166` becomes:

```enso
            case setup.flagged ..Text_Reverse_Keeps_Grapheme_Clusters of
                True -> result . to_vector . should_equal ["teerts", "", Nothing, "éfac", "A👩‍🔬"]
                False ->
                    # The backend's REVERSE function reverses code points, so it
                    # does not keep grapheme clusters together as Text.reverse does.
                    result . to_vector . should_equal ["teerts", "", Nothing, "éfac", "A🔬‍👩"]
```

- `Database/Upload_Spec.enso:433` and `:629`:
  `snowflake_constraints_pending = if prefix.contains "Snowflake" then "Disabled until https://github.com/enso-org/enso/issues/10737 is resolved."`
  becomes
  `snowflake_constraints_pending = if (setup.flagged ..Enforces_Primary_Key_Uniqueness).not then "The backend does not enforce the uniqueness of a PRIMARY KEY."`;
  `:1034` (in `test_table_append`, which has `setup`), whose condition reads
  `group_builder.name.contains "Snowflake"`, becomes the same line. (The
  variable's name stays: renaming it is not this change.)

In `Dialect_Flag.enso`, after Task 1's three variants:

```enso
    ## ---
       private: true
       ---
       Specifies if the backend can hold a column of `Nothing` with no other
       type, as an expression like `Nothing IS NULL` makes.
    Supports_Null_Typed_Columns
    ## ---
       private: true
       ---
       Specifies if `min` and `max` over several columns ignore `Nothing`
       values. If `False`, any `Nothing` argument makes the result `Nothing`.
    Row_Min_Max_Ignores_Nothing
    ## ---
       private: true
       ---
       Specifies if `reverse` keeps grapheme clusters together, as
       `Text.reverse` does. If `False`, it reverses code points.
    Text_Reverse_Keeps_Grapheme_Clusters
    ## ---
       private: true
       ---
       Specifies if reading a table without an ordering returns its rows in the
       order they were inserted. SQL does not promise it; most backends do it
       for small tables, Snowflake does not.
    Reads_Rows_In_Insertion_Order
    ## ---
       private: true
       ---
       Specifies if the database rejects rows that break the uniqueness of a
       `PRIMARY KEY`. Snowflake accepts them.
    Enforces_Primary_Key_Uniqueness
```

and in each dialect's `flagged`, after Task 1's three lines (column heads
shortened: Null-typed = `Supports_Null_Typed_Columns`, Min/max =
`Row_Min_Max_Ignores_Nothing`, Graphemes =
`Text_Reverse_Keeps_Grapheme_Clusters`, Insertion order =
`Reads_Rows_In_Insertion_Order`, Primary key =
`Enforces_Primary_Key_Uniqueness`):

| Dialect           | Null-typed | Min/max | Graphemes | Insertion order | Primary key |
| ----------------- | ---------- | ------- | --------- | --------------- | ----------- |
| Postgres_Dialect  | `False`    | `True`  | `False`   | `True`          | `True`      |
| SQLite_Dialect    | `True`     | `False` | `True`    | `True`          | `True`      |
| DuckDB_Dialect    | `False`    | `True`  | `True`    | `True`          | `True`      |
| SQLServer_Dialect | `False`    | `True`  | `True`    | `True`          | `True`      |
| Snowflake_Dialect | `False`    | `True`  | `False`   | `False`         | `False`     |
| Redshift_Dialect  | `False`    | `True`  | `True`    | `True`          | `True`      |

The in-memory backend answers all five `True` (its `flagged` ends in
`_ -> True`), as its specs expect today; `Upload_Spec`, the one reader of
`Enforces_Primary_Key_Uniqueness`, does not run in memory. Then

```bash
grep -rnE '\bprefix\s*(==|!=|\.)|group_builder\s*\.\s*name\b|dialect_name|backend\s*\.\s*name\b' \
  --include=*.enso distribution/lib/Standard/Database_Test_Suite | grep -vE '^[^:]+:[0-9]+:\s*#'
```

prints nothing (the one prose hit, `Default_Ordering_Spec.enso:41`, was reworded
in Step 4); Step 10's rule then agrees.

- [ ] **Step 8: The backends.** Each backend's setup code (its `table_builder`,
      `light_table_builder`, `materialize`, `Test_Selection`, `agg_*` functions,
      the four dialect closures, `Test_Setup.Config`, and its calls of
      `Common_Spec`, `Common_Table_Operations.Main`, `Upload_Spec`, `IR_Spec`
      and `Transaction_Spec`) gives way to a `Backend` and one call. Each file
      gains `import Standard.Database_Test_Suite` and
      `from Standard.Database_Test_Suite import Backend, Known_Issue, Suite_Part`
      (the names it uses), and loses its `Lazy_Ref` type and every import that
      no remaining line uses (check each name with `grep` in the file).
  - `test/Table_Tests/src/Database/SQLite_Spec.enso`: `sqlite_spec` becomes

```enso
sqlite_spec suite_builder name create_connection_func persistent_connector =
    backend = Backend.Value name create_connection_func temporary_tables=False persistent_connections=persistent_connector
    setup = Database_Test_Suite.add_specs suite_builder backend
    sqlite_specific_spec suite_builder setup.prefix create_connection_func setup
```

    and in `add_specs` the two calls become
    `sqlite_spec suite_builder "SQLite File" (_ -> create_file_connection database_file.file) persistent_connector=True`
    and
    `sqlite_spec suite_builder "SQLite In-Memory" (_ -> create_inmem_connection) persistent_connector=False`;
    the two `Transaction_Spec.add_specs` lines go (the suite runs them), and
    `in_file_prefix` and `in_memory_prefix` with them.

- `test/Table_Tests/src/Database/Postgres_Spec.enso`: `add_postgres_specs`
  becomes

```enso
add_postgres_specs suite_builder create_connection_fn db_name =
    backend = Backend.Value "PostgreSQL" create_connection_fn known_failures=[Known_Issue.Full_Join_With_Between]
    setup = Database_Test_Suite.add_specs suite_builder backend
    postgres_specific_spec suite_builder create_connection_fn db_name setup
```

    `add_table_specs`'
    `Transaction_Spec.add_specs suite_builder connection_builder "[PostgreSQL] "`
    goes; with `type JSON_Table_Data` gone (Step 3), its user at line 433 needs
    `import Standard.Database_Test_Suite.Database.JSON_Table_Data.JSON_Table_Data`;
    `import enso_dev.Generic_JDBC_Tests.Generic_JDBC_Connection_Spec` and
    `import enso_dev.Table_Tests` (both unused) go; the Audit and saved
    connection imports become `import enso_dev.Cloud_Tests.Database.Audit_Spec`
    and `import enso_dev.Cloud_Tests.Database.Save_Connection_Data_Link`.

- `test/Table_Tests/src/In_Memory/Common_Spec.enso` becomes:

```enso
from Standard.Base import all

from Standard.Test import Test

import Standard.Database_Test_Suite
from Standard.Database_Test_Suite import Backend

add_specs suite_builder =
    Database_Test_Suite.add_specs suite_builder Backend.In_Memory

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

- `test/DuckDB_Tests/src/DuckDB_Spec.enso` becomes:

```enso
from Standard.Base import all

from Standard.Database import all

from Standard.Test import all

import Standard.DuckDB.DuckDB.DuckDB

import Standard.Database_Test_Suite
from Standard.Database_Test_Suite import Backend, Known_Issue, Suite_Part

## DuckDB in memory, as the suite runs it.
duckdb_backend =
    Backend.Value "DuckDB In-Memory" (_ -> Database.connect DuckDB.In_Memory) temporary_tables=False known_failures=[Known_Issue.Filter_After_Distinct] parts=[Suite_Part.Common, Suite_Part.Table_Operations]

add_specs suite_builder =
    Database_Test_Suite.add_specs suite_builder duckdb_backend

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

    and in `DuckDB_In_Memory_Spec.enso`,
    `import enso_dev.Table_Tests.Database.Postgres_Spec.JSON_Table_Data` becomes
    `import Standard.Database_Test_Suite.Database.JSON_Table_Data.JSON_Table_Data`.

- `test/Microsoft_Tests/src/SQLServer_Spec.enso`: `add_sqlserver_specs` becomes

```enso
add_sqlserver_specs suite_builder create_connection_fn =
    backend = Backend.Value "SQLServer" create_connection_fn known_failures=[Known_Issue.No_Literal_Tables] parts=[Suite_Part.Common, Suite_Part.Table_Operations]
    Database_Test_Suite.add_specs suite_builder backend
```

    Of its imports at lines 19–28, `enso_dev.Table_Tests`,
    `….Database.Common.Common_Spec`, `….Database.Transaction_Spec` and
    `….Database.Upload_Spec` (these two were unused) and
    `….Common_Table_Operations` go; `….Database.Common.Audit_Spec` and
    `….Database.Common.Save_Connection_Data_Link` become
    `enso_dev.Cloud_Tests.Database.Audit_Spec` and
    `enso_dev.Cloud_Tests.Database.Save_Connection_Data_Link`; the
    `Name_Generator`, `Common_Table_Operations.Util` and `Util` imports change
    by the loop below.

- `test/Snowflake_Tests/src/Snowflake_Spec.enso`: `add_snowflake_specs` becomes

```enso
add_snowflake_specs suite_builder create_connection_fn db_name =
    backend = Backend.Value "Snowflake" create_connection_fn known_failures=[Known_Issue.Unordered_Concatenate] run_advanced_edge_cases=False is_integer_type=is_snowflake_integer
    setup = Database_Test_Suite.add_specs suite_builder backend
    snowflake_specific_spec suite_builder setup.default_connection db_name setup
    Auth_Spec.add_specs suite_builder setup.default_connection.get
```

    `add_table_specs`' `Transaction_Spec.add_specs suite_builder connection_builder prefix`
    goes; its imports change as SQL Server's, and `….Database.Common.IR_Spec`
    goes too. In `Snowflake_Bulk_Spec.enso` and `Snowflake_Stage_Spec.enso`,
    `file = (Project_Description.new enso_dev.Table_Tests).data / "data.csv"`
    becomes `file = Database_Test_Suite.data_directory / "data.csv"`, with
    `import Standard.Database_Test_Suite`.

- `test/AWS_Tests/src/Redshift_Spec.enso`: `add_database_specs` becomes

```enso
add_database_specs suite_builder create_connection_fn =
    backend = Backend.Value "Redshift" create_connection_fn run_advanced_edge_cases=False parts=[Suite_Part.Common, Suite_Part.Table_Operations, Suite_Part.IR]
    setup = Database_Test_Suite.add_specs suite_builder backend
    add_redshift_specific_specs suite_builder create_connection_fn setup
```

    and its imports `enso_dev.Table_Tests`, `….Common_Spec`, `….IR_Spec` and
    `….Common_Table_Operations` go.

Then the helper modules, for every remaining user:

```bash
for pair in \
  'enso_dev\.Table_Tests\.Common_Table_Operations\.Util|Standard.Database_Test_Suite.Common_Table_Operations.Util' \
  'enso_dev\.Table_Tests\.Database\.Helpers\.Name_Generator|Standard.Database_Test_Suite.Database.Helpers.Name_Generator' \
  'enso_dev\.Table_Tests\.Util|Standard.Database_Test_Suite.Util'; do
  from=${pair%%|*}; to=${pair#*|}
  git grep -lE "$from" -- test | xargs -r sed -i -E "s/$from/$to/"
done
git grep -n "enso_dev\.Table_Tests" -- test
```

Expected: the last grep prints nothing. The loop reaches `AWS_Tests`
(`Redshift_Spec`, `S3_Spec`), `Cloud_Tests` (`Fetch_Spec`), `Generic_JDBC_Tests`
(both specs), `Google_Test`, `Microsoft_Tests`, `Saas_Tests`, `Snowflake_Tests`
and `Tableau_Tests`.

- [ ] **Step 9: `Table_Tests`' own imports.** In `test/Table_Tests/src`:

```bash
cd test/Table_Tests/src
grep -rlE '^(import|from) project\.(Util|Common_Table_Operations|Database\.Helpers|Database\.Common|Database\.Upload_Spec|Database\.Transaction_Spec)\b' --include=*.enso . \
  | xargs -r sed -i -E 's/^(import|from) project\.(Util|Common_Table_Operations|Database\.Helpers|Database\.Common|Database\.Upload_Spec|Database\.Transaction_Spec)\b/\1 Standard.Database_Test_Suite.\2/'
cd -
```

(`\b` after `Util` leaves `project.Util_Spec` alone.) In `SQLite_Spec.enso` and
`Postgres_Spec.enso` delete the rewritten imports of `Common_Spec`, `IR_Spec`,
`Transaction_Spec`, `Upload_Spec` and `Common_Table_Operations`: the suite runs
them now. Then
`git grep -nE "^(import|from) project\.(Util|Common_Table_Operations|Database\.(Helpers|Common|Upload_Spec|Transaction_Spec))\b" -- test/Table_Tests`
prints nothing.

- [ ] **Step 10: Edition, test map, policy.** In
      `distribution/edition.template.yaml`, after the `Standard.Postgres` entry:

```text
  - name: Standard.Database_Test_Suite
    repository: release
    version: {{LIBS_VERSION}}
```

In `tools/ci/stdlib-test-map.yaml`, under `libraries` after `Database`:
`Database_Test_Suite: { stdBits: [database-test-suite], dependsOn: [Base, Database, SQLite, Table, Test] }`;
under `testProjects`, these entries replace today's:

```yaml
AWS_Tests:
  imports: [AWS, Base, Database, Database_Test_Suite, Table, Test]
  testImports: [Base_Tests, Cloud_Tests]
Cloud_Tests:
  imports: [Base, Database, Database_Test_Suite, Table, Test]
  testImports: [Base_Tests]
DuckDB_Tests:
  imports: [Base, Database, Database_Test_Suite, DuckDB, Table, Test]
  testImports: []
Generic_JDBC_Tests:
  imports:
    [Base, Database, Database_Test_Suite, Generic_JDBC, Postgres, SQLite, Test]
  testImports: []
Microsoft_Tests:
  imports: [Base, Database, Database_Test_Suite, Microsoft, Table, Test]
  testImports: [Base_Tests, Cloud_Tests]
Saas_Tests:
  imports: [Base, Database_Test_Suite, Saas, Table, Test]
  testImports: [Base_Tests]
Snowflake_Tests:
  imports: [Base, Database, Database_Test_Suite, Snowflake, Table, Test]
  testImports: [Base_Tests, Cloud_Tests]
Table_Tests:
  imports:
    [
      Base,
      Database,
      Database_Test_Suite,
      Examples,
      Postgres,
      SQLite,
      Table,
      Test,
      Visualization,
    ]
  testImports: [Base_Tests, Cloud_Tests, Test_Tests]
Tableau_Tests:
  imports: [Base, Database_Test_Suite, Table, Tableau, Test]
  testImports: []
```

`node tools/ci/check-workflows.mjs` compares these with the sources' top-level
imports and names any difference (`lacks …`, `lists …`): its message is the
authority, so fix the map until it prints `Workflow policy: OK` (an import the
cleanup of Step 8 left or removed shows up there). `checkPublicTypes` reads
`[Backend, Known_Issue, Suite_Part]` from `Main.enso`.

The policy rule, in `tools/ci/check-workflows.mjs`, after `STDLIB_TEST_MAP`:

<!-- prettier-ignore -->
```js
/** The database test suite's sources; see `checkSuiteIgnoresBackendNames`. */
export const DATABASE_TEST_SUITE = 'distribution/lib/Standard/Database_Test_Suite'

/**
 * A spec line that decides by the backend's name: a test of the group prefix (`prefix ==`,
 * `prefix.contains …`), of a group's name, of the dialect's name, or of `backend.name`.
 */
const BACKEND_NAME_TEST =
  /\bprefix\s*(?:==|!=|\.)|\bgroup_builder\s*\.\s*name\b|\bdialect_name\b|\bbackend\s*\.\s*name\b/

/** An Enso text literal, which the rule blanks out before it looks at a line. */
const ENSO_TEXT_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g
```

after `ensoImports`:

<!-- prettier-ignore -->
```js
/** The `.enso` sources of the database test suite, by path relative to `root`, with `/`. */
function loadSuiteSources(root) {
  const sources = {}
  for (const file of ensoFiles(path.join(root, DATABASE_TEST_SUITE))) {
    sources[path.relative(root, file).split(path.sep).join('/')] = readFileSync(file, 'utf8')
  }
  return sources
}
```

in `loadRepo`'s returned object, after `stdlib: loadStdlib(root),`, add
`suiteSources: loadSuiteSources(root),`; and after `checkPublicTypes`:

<!-- prettier-ignore -->
```js
/**
 * The database test suite asks the backend what it supports (its dialect, through the setup's
 * `flagged`, `is_feature_supported`, `is_operation_supported` and `is_aggregate_supported`) or
 * what is broken (`has_known_issue`), never its name (spec 2026-10-31-database-test-suite,
 * section 2). Only code counts: comment lines, doc blocks (a `##` line and the lines indented
 * under it) and text literals are skipped.
 */
export function checkSuiteIgnoresBackendNames({ suiteSources }) {
  const problems = []
  for (const [file, text] of Object.entries(suiteSources ?? {})) {
    let docIndent = null
    text.split('\n').forEach((line, i) => {
      const indent = line.length - line.trimStart().length
      if (/^\s*##/.test(line)) {
        docIndent = indent
        return
      }
      if (docIndent != null && (line.trim() === '' || indent > docIndent)) return
      docIndent = null
      if (/^\s*#/.test(line)) return
      if (!BACKEND_NAME_TEST.test(line.replace(ENSO_TEXT_LITERAL, '""'))) return
      problems.push(
        `${file}:${i + 1}: decides by the backend's name; ask the setup (\`flagged\`, \`is_feature_supported\`, \`is_operation_supported\`, \`is_aggregate_supported\`) or list a \`Known_Issue\``,
      )
    })
  }
  return problems
}
```

with `checkSuiteIgnoresBackendNames,` after `checkPublicTypes,` in `CHECKS`. In
`check-workflows.test.mjs`, import it and add after
`describe('checkPublicTypes', …)`:

<!-- prettier-ignore -->
```js
describe('checkSuiteIgnoresBackendNames', () => {
  const at = 'distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src/X_Spec.enso'
  const repo = (code) => fixture({}, { [at]: code })
  const why =
    "decides by the backend's name; ask the setup (`flagged`, `is_feature_supported`, `is_operation_supported`, `is_aggregate_supported`) or list a `Known_Issue`"

  test('accepts the prefix used as a name, questions to the setup, comments, docs and text', () => {
    const code = [
      '## Adds a group with the given `prefix` as its name prefix.',
      '   The prefix. is prose here, in a doc block.',
      'add_specs suite_builder prefix setup =',
      '    prefix_text = setup.prefix',
      '    suite_builder.group prefix+"Table.aggregate" group_builder->',
      '    # Snowflake once needed setup.prefix.contains "Snowflake" here.',
      '    if setup.flagged ..Date_Time then group_builder.specify "x" <| 1',
      '    group_builder.specify "reads the prefix. of a name" <| 1',
      '    in_file_prefix = "[SQLite File] "',
    ].join('\n')
    assert.deepEqual(checkSuiteIgnoresBackendNames(repo(code)), [])
  })
  test('rejects a test of the prefix, the group name, the dialect name and the backend name', () => {
    const code = [
      '    if setup.prefix.contains "SQLite" then 1',
      '    if prefix == "[SQLite] " then 1',
      '    if group_builder.name.contains "Snowflake" then 1',
      '    if t.dialect_name != "DuckDB" then 1',
      '    n = backend.name',
    ].join('\n')
    assert.deepEqual(
      checkSuiteIgnoresBackendNames(repo(code)),
      [1, 2, 3, 4, 5].map((line) => `${at}:${line}: ${why}`),
    )
  })
  test('checks the code after a doc block ends', () => {
    const code = ['## A spec.', '   More prose.', 'x = if prefix == "a" then 1'].join('\n')
    assert.deepEqual(checkSuiteIgnoresBackendNames(repo(code)), [`${at}:3: ${why}`])
  })
  test('looks only at the suite', () => {
    const other = 'distribution/lib/Standard/Table/0.0.0-dev/src/X.enso'
    assert.deepEqual(
      checkSuiteIgnoresBackendNames(fixture({}, { [other]: 'if prefix == "x" then 1\n' })),
      [],
    )
  })
})
```

The rule skips comment lines, doc blocks and text literals, so it reports
exactly the 13 sites of Step 7 on the sources as they are before Step 7 (checked
by running it over `test/Table_Tests/src` while planning) and none after.

In `tools/ci/README.md`'s "Workflow policy" paragraph, after "with their imports
exactly,", add "the database test suite decides nothing by a backend's name,".
Run
`corepack pnpm exec prettier --write tools/ci/check-workflows.mjs tools/ci/check-workflows.test.mjs`
(the snippets above are already in the repository's style: no semicolons, single
quotes, width 100), then `node --test tools/ci/check-workflows.test.mjs` and
`node tools/ci/check-workflows.mjs`.

- [ ] **Step 11: Not in the installer; build, size, API docs.** In
      `project/EngineBundle.scala`, in `object EngineBundle` before `root`:

```scala
  /** The standard libraries that the engine distribution has and the IDE's bundle leaves out: a
    * test library, to be fetched later like any library that is not bundled (the user's decision;
    * docs/superpowers/plans/2026-10-31-database-test-suite.md). `IRCaches.checkCacheSizes` does
    * not count them either, since its budget is what users get.
    */
  val librariesNotBundled: Seq[String] = Seq("Database_Test_Suite")
```

in `create`, the engine copy becomes

```scala
    copyTree(
      enginePackage,
      bundleRoot / "dist" / ensoVersion,
      skip = librariesNotBundled.map(name => (enginePackage / "lib" / "Standard" / name).toPath)
    )
```

and `copyTree` gains the parameter and skips those directories:

```scala
  private def copyTree(source: File, target: File, skip: Seq[Path] = Seq.empty): Unit = {
    val from = source.toPath
    val to   = target.toPath
    Files.walkFileTree(
      from,
      new SimpleFileVisitor[Path] {
        override def preVisitDirectory(
          dir: Path,
          attrs: BasicFileAttributes
        ): FileVisitResult =
          if (skip.contains(dir)) FileVisitResult.SKIP_SUBTREE
          else {
            Files.createDirectories(to.resolve(from.relativize(dir)))
            FileVisitResult.CONTINUE
          }
```

(`visitFile` is unchanged). In `project/IRCaches.scala`'s `checkCacheSizes`, the
loop becomes:

```scala
    for (libName <- stdLibRoot.listFiles()) {
      val libDir    = libName / ensoVersion
      val cacheSize = getCacheSizeForLib(libDir, log)
      if (EngineBundle.librariesNotBundled.contains(libName.getName)) {
        log.info(
          f"Not counted (not in the IDE bundle): ${libName.getName} ${cacheSize / (1024 * 1024)}%.2f MB"
        )
      } else {
        totalBytes += cacheSize
      }
    }
```

and in `project/CLAUDE.md`, the `Distribution.scala + DistributionPackage.scala`
bullet gains: "`EngineBundle.librariesNotBundled` names the standard libraries
the IDE bundle leaves out (and `IRCaches.checkCacheSizes` does not count):
`Database_Test_Suite`." `EXPECTED_MAX_SIZE_MB` stays 88. Then
`sbt ciBuildEngineDistribution` (it runs the size check) and
`sbt buildEngineBundle`:

```bash
ls built-distribution/enso-engine-*/enso-*/lib/Standard | grep -c '^Database_Test_Suite$'   # 1
ls built-distribution/engine-bundle-*/enso/dist/*/lib/Standard | grep -c '^Database_Test_Suite$'   # 0
```

Expected: `Libs cache size check successful: X/88 MB` with X as on Task 1's
build (the libraries are otherwise unchanged), a
`Not counted (not in the IDE bundle): Database_Test_Suite …` line (about 24 MB;
put the figure in the PR body), the suite in the engine package and not in the
bundle. Then the docs:

```bash
sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Database_Test_Suite/0.0.0-dev"
sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Database/0.0.0-dev"
corepack pnpm --filter build-scripts run stdlib-api-check
```

Expected: `$S/docs/api/**` is created (commit it; `stdlib-api-check` checks the
suite from now on) and Database's `Dialects/Dialect_Flag.md` gains the five
names.

- [ ] **Step 12: Proof.** Task 1 Step 1's commands, from `develop` at Task 1's
      merge into `$HOME/junit/task2-before` and from this branch into
      `$HOME/junit/task2-after`, with the native run over the whole suite
      (without `--only`: every project's imports changed); then Task 1 Step 6's
      comparison loop with `task2-`. Expected: every row `same`, among them
      `Table_Tests` (its `[In-Memory]`, `[SQLite File]`, `[SQLite In-Memory]`
      and `[PostgreSQL]` groups), `DuckDB_Tests`, `Microsoft_Tests`,
      `Generic_JDBC_Tests`, `Cloud_Tests`, `Base_Tests`, and `Snowflake_Tests`
      and `AWS_Tests` with their one pending group. In `Table_Tests`'
      `JUnit.xml`, the `[PostgreSQL]` Between spec's skip message reads
      `Known issue: a Full join with a Between condition is not supported (https://github.com/enso-org/enso/issues/8243).`
      In the native run, "should not create any table if upload fails" passes
      for `[SQLite File]` and `[SQLite In-Memory]` as before (the renamed
      `ExplodingStorage`; ruling on the suite's Java), and `YXDB_Spec`'s
      non-YXDB spec passes on `one_row.csv`. Windows: the native pair.

- [ ] **Step 13: Docs, changelog, commit, PR.** `$S/CLAUDE.md`:

```markdown
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
- The suite imports no test project (`enso_dev.*`) and writes no file into
  itself: it uses `File.create_temporary_file`.
```

`distribution/lib/Standard/CLAUDE.md`'s index, after the `Test/` line: "-
`Database_Test_Suite/` — The conformance suite database backends run against
themselves (test-only; `catalogue: false`)." In `Database/0.0.0-dev/CLAUDE.md`'s
"Where to read more", the `test/Table_Tests/src/Common_Table_Operations/` bullet
becomes "- `distribution/lib/Standard/Database_Test_Suite/` — the same suite
runs against the in-memory table and every database backend." In
`Table/0.0.0-dev/CLAUDE.md`'s "Where to read more" (line 60), the
`test/Table_Tests/src/Common_Table_Operations/` bullet becomes "-
`distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src/Common_Table_Operations/`
— operations that work on both in-memory and database tables." In
`std-bits/CLAUDE.md`'s modules, after `database/`: "- `database-test-suite/` —
`Standard.Database_Test_Suite`: `ExplodingStorage`, for its upload specs." In
`test/CLAUDE.md`'s Suites, after the provider bullet: "- Database backends run
`Standard.Database_Test_Suite` with a `Backend` descriptor; see that library's
`CLAUDE.md`." In `CHANGELOG.md`, `# Next Release` →
`#### Enso Standard Library`:

```markdown
- [Standard.Database_Test_Suite: a conformance suite for database backends. A
  library that adds a database describes its backend in a few lines and runs the
  same table and database tests as the built-in ones.][NNN]
```

with `[NNN]: https://github.com/jdunkerley/enso/pull/NNN` among the link
definitions. Title
`Standard.Database_Test_Suite: the shared table and database specs become a library`.
Body: the moves, the name-check table and the new flags from the rulings, the
DuckDB issue (Step 1), the rulings on the Audit and saved-connection specs,
`Round_Spec`, `ExplodingStorage` and SQLite, the installer exclusion and the
suite's measured IR-cache size, the `junit-compare` tables, and that Snowflake
and Redshift only compiled and stayed pending. A feature: after green CI, wait
for the user's OK before merging.

---

### Task 3: One test project per backend

No change visible to users: `CI: No changelog needed`.

**Files (moves):**

```bash
T=test/Table_Tests
mkdir -p test/SQLite_Tests/src test/SQLite_Tests/data/transient \
  test/Postgres_Tests/src test/Postgres_Tests/data/datalinks test/Postgres_Tests/data/transient
git mv $T/src/Database/SQLite_Spec.enso test/SQLite_Tests/src/SQLite_Spec.enso
git mv $T/src/Database/Codegen_Spec.enso test/SQLite_Tests/src/Codegen_Spec.enso
git mv $T/src/Database/Types/SQLite_Type_Mapping_Spec.enso test/SQLite_Tests/src/SQLite_Type_Mapping_Spec.enso
git mv $T/src/Database/Postgres_Spec.enso test/Postgres_Tests/src/Postgres_Spec.enso
git mv $T/src/Database/Types/Postgres_Type_Mapping_Spec.enso test/Postgres_Tests/src/Postgres_Type_Mapping_Spec.enso
git mv $T/src/Database/Library_Discovery_Spec.enso test/Postgres_Tests/src/Library_Discovery_Spec.enso
git mv $T/src/Database/README.md test/Postgres_Tests/README.md
git mv $T/data/pgpass.conf $T/data/postgres_known_encodings.txt test/Postgres_Tests/data/
for f in postgres-db postgres-table postgres-simple-query postgres-serialized-query; do
  git mv $T/data/datalinks/$f.datalink test/Postgres_Tests/data/datalinks/$f.datalink
done
git rm $T/src/Database/Main.enso
cp $T/data/transient/.gitignore test/SQLite_Tests/data/transient/.gitignore
cp $T/data/transient/.gitignore test/Postgres_Tests/data/transient/.gitignore
git add test/SQLite_Tests/data/transient/.gitignore test/Postgres_Tests/data/transient/.gitignore
```

After it, `test/Table_Tests/src/Database/` is gone (Task 2 emptied `Common/` and
`Helpers/`).

**Files (create and modify):**

- Create: `test/SQLite_Tests/package.yaml`, `test/SQLite_Tests/src/Main.enso`,
  `test/Postgres_Tests/package.yaml`, `test/Postgres_Tests/src/Main.enso`
- Modify: the moved `.enso` files (imports), `test/Table_Tests/src/Main.enso`
- Modify:
  `tools/build-scripts/src/stdlib-test/{plan,plan.test,junit,junit.test,invocation,invocation.test,suites}.ts`,
  `tools/build-scripts/src/commands/junit-compare.ts`,
  `tools/build-scripts/CLAUDE.md`
- Modify: `tools/ci/stdlib-test-map.yaml`, `tools/ci/check-workflows.mjs`,
  `tools/ci/check-workflows.test.mjs`
- Modify: `.github/workflows/engine-checks-platform.yml` (Note [Standard Library
  Test Selection] only)
- Modify: `app/gui/src/utils/__tests__/dataLinkSchema.test.ts`
- Modify: `test/CLAUDE.md`,
  `distribution/lib/Standard/Database/0.0.0-dev/CLAUDE.md`,
  `distribution/lib/Standard/SQLite/0.0.0-dev/CLAUDE.md`,
  `std-bits/database/CLAUDE.md`

**Interfaces:**

- Consumes: Task 2's `Database_Test_Suite.add_specs`, `Backend`, `Known_Issue`
  and helper modules.
- Produces: test projects `enso_dev.SQLite_Tests` (`[SQLite File]`,
  `[SQLite In-Memory]`, codegen and type-mapping groups) and
  `enso_dev.Postgres_Tests` (`[PostgreSQL]` groups and "Library discovery
  without an import"); `Table_Tests` runs only the in-memory backend and its
  in-memory, IO, formatting and helper specs.
- Produces: shards may carry `needs: postgres` (`StdlibTestMap.shards[].needs`).
- Produces: `junit-compare <old> <new> --by-group-prefix` (`byGroupPrefix(run)`
  in `stdlib-test/junit.ts`).

- [ ] **Step 1: `junit-compare --by-group-prefix`.** It must exist before the
      proof, and works on Task 2's reports as well. In
      `tools/build-scripts/src/stdlib-test/junit.ts`, after `readJUnitDir`:

<!-- prettier-ignore -->
```ts
/** The label of a group's backend: the leading `[…]` of its name, if any. */
export function groupPrefix(suite: string): string {
  return /^\[[^\]]+\]/.exec(suite)?.[0] ?? '(no prefix)'
}

/**
 * Every project's test cases pooled and keyed by `groupPrefix` instead of by project, so that
 * groups which moved from one project to another compare with themselves.
 */
export function byGroupPrefix(
  run: ReadonlyMap<string, readonly TestCase[]>,
): Map<string, TestCase[]> {
  const grouped = new Map<string, TestCase[]>()
  for (const cases of run.values()) {
    for (const testCase of cases) {
      const key = groupPrefix(testCase.suite)
      grouped.set(key, [...(grouped.get(key) ?? []), testCase])
    }
  }
  return new Map([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
```

In `src/commands/junit-compare.ts`: the doc comment's usage line becomes
`` `junit-compare <old dir> <new dir> [--allow Project]... [--by-group-prefix]` ``
with the sentence "With `--by-group-prefix` it pools the projects and compares
per backend (the `[…]` that starts a group's name), for groups that moved
between projects; `--allow` then names a prefix."; the options gain
`'by-group-prefix': { type: 'boolean', default: false },`; the usage error gains
` [--by-group-prefix]`; and the comparison becomes:

<!-- prettier-ignore -->
```ts
const regroup =
  values['by-group-prefix'] ? byGroupPrefix : (run: ReturnType<typeof readJUnitDir>) => run
const rows = compareRuns(regroup(readJUnitDir(oldDir)), regroup(readJUnitDir(newDir)))
```

with `byGroupPrefix` added to the import from `../stdlib-test/junit.ts`. In
`junit.test.ts`, import `byGroupPrefix` and `groupPrefix` and add:

<!-- prettier-ignore -->
```ts
describe('byGroupPrefix', () => {
  const testCase = (suite: string, status: 'pass' | 'skip' = 'pass') => ({
    suite,
    name: 'x',
    status,
  })
  test('pools the projects by the backend that starts each group name', () => {
    const before = new Map([
      [
        'Table_Tests',
        [
          testCase('[PostgreSQL] Join'),
          testCase('[In-Memory] Join'),
          testCase('Library discovery'),
        ],
      ],
    ])
    const after = new Map([
      ['Table_Tests', [testCase('[In-Memory] Join')]],
      ['Postgres_Tests', [testCase('[PostgreSQL] Join'), testCase('Library discovery')]],
    ])
    const rows = compareRuns(byGroupPrefix(before), byGroupPrefix(after))
    expect(rows.map((row) => [row.project, row.same])).toEqual([
      ['(no prefix)', true],
      ['[In-Memory]', true],
      ['[PostgreSQL]', true],
    ])
  })
  test('a group that changed status still differs', () => {
    const rows = compareRuns(
      byGroupPrefix(new Map([['A_Tests', [testCase('[SQLite File] X')]]])),
      byGroupPrefix(new Map([['B_Tests', [testCase('[SQLite File] X', 'skip')]]])),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.same).toBe(false)
  })
  test('names the prefix, or none', () => {
    expect(groupPrefix('[SQLite In-Memory] Table.aggregate')).toBe('[SQLite In-Memory]')
    expect(groupPrefix('Library discovery without an import')).toBe('(no prefix)')
  })
})
```

In `tools/build-scripts/CLAUDE.md`, the `junit-compare` bullet becomes
"`junit-compare <old> <new> [--by-group-prefix]` — compares two JUnit
directories project by project (pass, fail, skip), or with `--by-group-prefix`
backend by backend across projects (for groups that moved between projects); the
gate for moving tests." Run `corepack pnpm exec prettier --write` on the changed
`tools/build-scripts` files (the snippets are already in the repository's
style), then `typecheck`, `lint` and `test:unit` for `build-scripts`.

- [ ] **Step 2: The baseline.** Task 1 Step 1's commands from `develop` at Task
      2's merge, into `$HOME/junit/task3-before`, with the native run over the
      whole suite.

- [ ] **Step 3: The projects.** Run the move block. Both
      `test/SQLite_Tests/package.yaml` and `test/Postgres_Tests/package.yaml`
      are `DuckDB_Tests`' with the name changed:

```yaml
name: SQLite_Tests
namespace: enso_dev
version: 0.0.1
license: MIT
author: enso-dev@enso.org
maintainer: enso-dev@enso.org
prefer-local-libraries: true
```

```yaml
name: Postgres_Tests
namespace: enso_dev
version: 0.0.1
license: MIT
author: enso-dev@enso.org
maintainer: enso-dev@enso.org
prefer-local-libraries: true
```

`test/SQLite_Tests/src/Main.enso`:

```enso
from Standard.Base import all

from Standard.Test import Test

import project.Codegen_Spec
import project.SQLite_Spec

main filter=Nothing =
    suite = Test.build suite_builder->
        Codegen_Spec.add_specs suite_builder
        SQLite_Spec.add_specs suite_builder
    suite.run_with_filter filter
```

(`SQLite_Spec.add_specs` calls `SQLite_Type_Mapping_Spec.add_specs`, as before.)
`test/Postgres_Tests/src/Main.enso`:

```enso
from Standard.Base import all

from Standard.Test import Test

import project.Library_Discovery_Spec
import project.Postgres_Spec

main filter=Nothing =
    suite = Test.build suite_builder->
        Postgres_Spec.add_specs suite_builder
        Library_Discovery_Spec.add_specs suite_builder
    suite.run_with_filter filter
```

The moved files' imports:

```bash
sed -i -E \
  -e 's/^(import|from) project\.Database\.Types\./\1 project./' \
  -e 's/^(import|from) project\.Database\.(SQLite_Spec|Postgres_Spec)\b/\1 project.\2/' \
  test/SQLite_Tests/src/*.enso test/Postgres_Tests/src/*.enso
git grep -n "project\.Database\." -- test/SQLite_Tests test/Postgres_Tests
```

Expected: nothing. In `test/Table_Tests/src/Main.enso` delete
`import project.Database` and `Database.Main.add_specs suite_builder`. The data
the moved specs read through `enso_project.data` is now in their own project
(`nonexistent-data.db` and `transient/` for SQLite;
`postgres_known_encodings.txt`, `pgpass.conf`, `datalinks/postgres-*.datalink`
and `transient/` for Postgres);
`git grep -n "enso_project.data" -- test/SQLite_Tests test/Postgres_Tests` lists
only those names. The messages "See README.md for instructions" now point at
`test/Postgres_Tests/README.md`, whose first paragraph becomes "The PostgreSQL
backend's tests: the shared suite (`Standard.Database_Test_Suite`) and the
Postgres-specific specs. Without a server they are pending." (the rest, how to
set one up, stays).

- [ ] **Step 4: The GUI's data link test.** In
      `app/gui/src/utils/__tests__/dataLinkSchema.test.ts`, after
      `TABLE_DATA_LINKS_ROOT`:

<!-- prettier-ignore -->
```ts
const POSTGRES_DATA_LINKS_ROOT = path.resolve(REPO_ROOT, 'test/Postgres_Tests/data/datalinks/')
```

and every `path.resolve(TABLE_DATA_LINKS_ROOT, …)` that reads a
`postgres-*.datalink` uses `POSTGRES_DATA_LINKS_ROOT` instead: on `develop` the
test "correctly validates example Database .datalink files with the schema" (its
loop over the four Postgres names), and the `old` link of "validates Postgres
data links of both library names", which arrives with step 1's Task 5. The
HTTP-format links (`example-http-*`) stay in `Table_Tests` and keep
`TABLE_DATA_LINKS_ROOT`.
`git grep -n "postgres-" -- app/gui/src/utils/__tests__/dataLinkSchema.test.ts`
shows every such use. Run
`corepack pnpm --filter enso-gui run test:unit -- dataLinkSchema` and prettier
on the file.

- [ ] **Step 5: Shards by project.** In
      `tools/build-scripts/src/stdlib-test/plan.ts`, the `shards` element type
      gains `readonly needs?: 'postgres'` with the doc comment
      `/** The shard runs only for a suite entry with this database; otherwise its projects run in the "*" shard. */`,
      and in `planMatrix`'s loop over `map.shards`, one line after
      `const { name, projects: listed } = shard` (an excerpt: the rest of the
      loop's body stays):

<!-- prettier-ignore -->
```ts
for (const shard of map.shards) {
  const { name, projects: listed } = shard
  // Without its database the shard's projects stay untaken, so the "*" shard runs them
  // and their database groups are pending there, as a split part's are.
  if (shard.needs != null && entry[shard.needs] !== true) continue
}
```

In `plan.test.ts`, after `describe('planMatrix with a split shard', …)`:

<!-- prettier-ignore -->
```ts
const PROJECT_SHARDS: StdlibTestMap['shards'] = [
  { name: 'Table', projects: ['Table_Tests'] },
  { name: 'Postgres', projects: ['Postgres_Tests'], needs: 'postgres' },
  { name: 'Others', projects: '*' },
]

describe('planMatrix with a shard that needs a database', () => {
  // standard-library-in-native denies AWS_Tests and Microsoft_Tests (suites.ts NOT_SEPARATE).
  const projects = [...PROJECTS, 'Postgres_Tests'].sort()
  test('runs the shard where the suite has the database', () => {
    const matrix = planMatrix(
      [NATIVE_WITH_POSTGRES],
      { ...MAP, shards: PROJECT_SHARDS },
      projects,
      ALL,
      true,
    )
    expect(matrix.map((m) => [m.title, m.only])).toEqual([
      ['Native (Table)', 'Table_Tests'],
      ['Native (Postgres)', 'Postgres_Tests'],
      ['Native (Others)', 'Base_Tests,DuckDB_Tests,Geo_Tests,Tableau_Tests,Visualization_Tests'],
    ])
  })
  test('without the database its projects run in the "*" shard', () => {
    const matrix = planMatrix(
      [NATIVE_WITHOUT_POSTGRES],
      { ...MAP, shards: PROJECT_SHARDS },
      projects,
      ALL,
      true,
    )
    expect(matrix.map((m) => m.title)).toEqual(['Native (Table)', 'Native (Others)'])
    expect(matrix[1]?.only.split(',')).toContain('Postgres_Tests')
  })
})
```

In `tools/ci/check-workflows.mjs`' `checkStdlibTestMap`, before the
`for (const shard of shards) { if (shard.split == null) continue …` loop:

<!-- prettier-ignore -->
```js
for (const shard of shards) {
  if (shard.needs == null) continue
  if (shard.needs !== 'postgres') {
    problems.push(
      `${at} shard \`${shard.name}\` has \`needs: ${shard.needs}\`; only \`postgres\` is known`,
    )
  }
  if (shard.projects === '*') {
    problems.push(`${at} the "*" shard cannot have \`needs\` (its projects would run nowhere)`)
  }
}
```

and in `check-workflows.test.mjs`' `describe('checkStdlibTestMap', …)`:

<!-- prettier-ignore -->
```js
test('accepts a shard that needs postgres, and rejects another database or a "*" shard with needs', () => {
  const map = (shards) => STDLIB_MAP_OK.replace(/^shards:[\s\S]*$/m, `shards:\n${shards}`)
  const ok =
    '  - { name: Table, projects: [Table_Tests], needs: postgres }\n  - { name: Others, projects: "*" }\n'
  assert.deepEqual(
    checkStdlibTestMap(fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': map(ok) })),
    [],
  )
  const bad =
    '  - { name: Table, projects: [Table_Tests], needs: mysql }\n  - { name: Others, projects: "*", needs: postgres }\n'
  assert.deepEqual(
    checkStdlibTestMap(fixture({}, { ...STDLIB_FILES, 'tools/ci/stdlib-test-map.yaml': map(bad) })),
    [
      `${at} shard \`Table\` has \`needs: mysql\`; only \`postgres\` is known`,
      `${at} the "*" shard cannot have \`needs\` (its projects would run nowhere)`,
    ],
  )
})
```

(`STDLIB_MAP_OK`, at `check-workflows.test.mjs:840`, ends in its `shards:`
block, and its one test project is `Table_Tests`.) In
`tools/ci/stdlib-test-map.yaml`, the `shards` block becomes:

```yaml
# The jobs a standard library suite that runs "every project but …" splits into; a suite with an
# allow list (AWS, Microsoft) stays one job. Each shard runs the listed projects the suite runs;
# the last (`"*"`) runs the rest. A shard with `needs: postgres` runs only for a suite entry with
# that database; without it, its projects run (and their database groups are pending) in the last
# shard. A shard with one project may also `split` into parts by the groups of
# `ENSO_TEST_GROUP_FILTER` (none does now): each part runs the groups whose names start with its
# `groups` regex, and the last part, without `groups`, the rest.
shards:
  - { name: Table, projects: [Table_Tests] }
  - { name: SQLite, projects: [SQLite_Tests] }
  - { name: Postgres, projects: [Postgres_Tests], needs: postgres }
  - { name: Base, projects: [Base_Tests, DuckDB_Tests, Cloud_Tests] }
  - { name: Others, projects: "*" }
```

and under `testProjects`, `Table_Tests` becomes, with two new entries:

```yaml
Postgres_Tests:
  imports: [Base, Database, Database_Test_Suite, Postgres, SQLite, Table, Test]
  testImports: [Base_Tests, Cloud_Tests]
SQLite_Tests:
  imports: [Base, Database, Database_Test_Suite, SQLite, Table, Test]
  testImports: [Base_Tests]
Table_Tests:
  imports:
    [
      Base,
      Database,
      Database_Test_Suite,
      Examples,
      SQLite,
      Table,
      Test,
      Visualization,
    ]
  testImports: [Base_Tests, Cloud_Tests, Test_Tests]
```

(`node tools/ci/check-workflows.mjs` is again the authority on the exact lists.)
In `tools/build-scripts/src/stdlib-test/invocation.ts`'
`missingServiceWarnings`, `'Table_Tests'` becomes `'Postgres_Tests'` in the
condition and the message
(`Postgres_Tests runs without a Postgres database (ENSO_POSTGRES_* is not set).`),
and `invocation.test.ts`' three `missingServiceWarnings(['Table_Tests'…` calls
name `Postgres_Tests`. In `suites.ts`, `std-cloud-related`'s allow list gains
`'Postgres_Tests'` and `'SQLite_Tests'` after `'Table_Tests'`, so that suite
still runs the groups it ran inside `Table_Tests`. In
`.github/workflows/engine-checks-platform.yml`'s Note [Standard Library Test
Selection], "(Table_Tests alone; Base, DuckDB and Cloud; the rest)" becomes
"(Table_Tests; SQLite_Tests; Postgres_Tests where the suite has a Postgres;
Base, DuckDB and Cloud; the rest)", and "A split shard (Table_Tests, by database
backend) is several jobs" becomes "A split shard (none at present) is several
jobs". Run the policy and its tests, and the build-scripts checks.

- [ ] **Step 6: The plan, shown.** With the map in place:

```bash
STDLIB_SUITES='[{"suite":"standard-library-in-native","title":"Native","small-jdk":false,"postgres":true,"mssql":false},{"suite":"standard-library","title":"Windows","small-jdk":true,"postgres":false,"mssql":false}]' \
  corepack pnpm --silent --filter build-scripts run stdlib-test-plan
```

Expected (`GITHUB_EVENT_NAME` unset, so every project): jobs `Native (Table)`
(`Table_Tests`), `Native (SQLite)` (`SQLite_Tests`), `Native (Postgres)`
(`Postgres_Tests`), `Native (Base)`, `Native (Others)`; and `Windows (Table)`,
`Windows (SQLite)`, `Windows (Base)`, `Windows (Others)`, whose `only` contains
`Postgres_Tests`; no job has a `group-filter`. Put the output in the PR body,
and `node tools/ci/check-workflows.mjs` printing `Workflow policy: OK`.

- [ ] **Step 7: Proof.** Task 1 Step 1's commands from this branch into
      `$HOME/junit/task3-after` (native over the whole suite), then:

```bash
corepack pnpm --silent --filter build-scripts run junit-compare -- \
  $HOME/junit/task3-before/native $HOME/junit/task3-after/native --by-group-prefix
for run in microsoft aws; do
  corepack pnpm --silent --filter build-scripts run junit-compare -- \
    $HOME/junit/task3-before/$run $HOME/junit/task3-after/$run
done
```

Expected: every row `same`: in the native run `[In-Memory]`, `[SQLite File]`,
`[SQLite In-Memory]`, `[PostgreSQL]`, `[DuckDB In-Memory]`, `[Snowflake]` and
`(no prefix)` among them; `Microsoft_Tests` and `AWS_Tests` (where `[Redshift]`
is: `standard-library-in-native` denies `AWS_Tests`) as projects. `(no prefix)`
pools every project's groups without a backend prefix, so a flake in any of them
shows there: re-run, and only a documented flake may take
`--allow "(no prefix)"`, with the reason in the PR body. Also run each new
project by hand from `test/`, as the Global Constraints say, and check
`Postgres_Tests`' log shows its `[PostgreSQL]` groups run (not pending) with the
server, and pending without it. Windows: the native pair, `--by-group-prefix`
(Postgres pending there, as before).

- [ ] **Step 8: Docs, commit, PR.** `test/CLAUDE.md`'s Suites: the
      `Table_Tests/` bullet becomes "- `Table_Tests/`, `Table_Internal_Tests/` —
      `Standard.Table`, and the shared suite against the in-memory table." and a
      new bullet "- `SQLite_Tests/`, `Postgres_Tests/` — the SQLite and
      PostgreSQL backends: the shared suite and their own specs.
      `Postgres_Tests` needs a server (`README.md`), and holds the library
      discovery spec, which needs none."; the provider list keeps
      `DuckDB_Tests/`. `Database/0.0.0-dev/CLAUDE.md`'s "Where to read more":
      "`test/SQLite_Tests/`, `test/Postgres_Tests/`, `test/DuckDB_Tests/`,
      `test/Snowflake_Tests/`, `test/Microsoft_Tests/` — one project per
      backend." `SQLite/0.0.0-dev/CLAUDE.md`'s "Where to read more": the
      `test/Table_Tests/src/Database/SQLite_Spec.enso` bullet becomes
      "`test/SQLite_Tests/` — the SQLite test project (the shared suite and
      `SQLite_Spec.enso`)." `std-bits/database/CLAUDE.md`: "covered by
      `test/Table_Tests` (SQLite, Postgres)" becomes "covered by
      `test/SQLite_Tests`, `test/Postgres_Tests`". Commit, open the PR
      (`Tests: one test project per database backend`) with the
      `CI: No changelog needed` label. Body: the moves, the shard rule,
      `stdlib-test-plan`'s output, the `--by-group-prefix` comparison, and that
      Snowflake and Redshift only compiled and stayed pending. Merge on green.

---

### Task 4: "Testing a database backend"

Documentation only: `CI: No changelog needed`. The PR changes a `CLAUDE.md`
under `distribution/`, which the engine gate does not ignore, so the engine
checks run; that is expected.

**Files:**

- Modify: `distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/CLAUDE.md`
  (the guide)
- Modify: `test/DuckDB_Tests/src/DuckDB_Spec.enso` (a doc comment only)
- Modify: `test/CLAUDE.md`
- Wiki (the controller pushes it): new page `Libraries-Database-Test-Suite`, and
  a line each in `Libraries` and `_Sidebar`

**Interfaces:**

- Consumes: Tasks 2 and 3 as merged; no code changes.

- [ ] **Step 1: The guide.** Append to the suite's `CLAUDE.md`:

````markdown
## Testing a database backend

A backend's test project runs the suite against itself with a `Backend`
descriptor; `test/DuckDB_Tests/src/DuckDB_Spec.enso` is the smallest one.

1. **A project.** `test/<Backend>_Tests/package.yaml` (`namespace: enso_dev`,
   `prefer-local-libraries: true`) and `src/Main.enso` calling your specs.
   Outside this repository, any project that has `Standard.Database_Test_Suite`
   in its edition.
2. **The descriptor.** `connect` opens a new connection (called with `Nothing`);
   `name` gives the groups' prefix:

   ```enso
   import Standard.Database_Test_Suite
   from Standard.Database_Test_Suite import Backend, Known_Issue, Suite_Part

   my_backend = Backend.Value "My_DB" (_ -> Database.connect (My_DB.Server "localhost"))

   add_specs suite_builder =
       setup = Database_Test_Suite.add_specs suite_builder my_backend
       My_DB_Specific_Spec.add_specs suite_builder setup
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
````

In `test/DuckDB_Tests/src/DuckDB_Spec.enso`, the doc comment above
`duckdb_backend` becomes:

```enso
## DuckDB in memory, as the suite runs it: the worked example of
   "Testing a database backend" (Standard.Database_Test_Suite's CLAUDE.md).
   DuckDB runs the common database specs and the table operations, builds
   ordinary tables, and has one known issue.
```

In `test/CLAUDE.md`'s "Adding tests", a fifth item: "5. A database backend runs
the shared suite: see \"Testing a database backend\" in
`distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/CLAUDE.md`."

- [ ] **Step 2: The wiki page.** Write
      `libraries/Libraries-Database-Test-Suite.md` in a scratch clone of the
      wiki (do not push), with this text, and hand it to the controller:

````markdown
# Testing a Database Backend

`Standard.Database_Test_Suite` is the conformance suite every database backend
runs against itself: the table operations that the in-memory table also runs,
and the database specs (connections, uploads, transactions, the query IR). The
built-in backends (SQLite, PostgreSQL, DuckDB, SQL Server, Snowflake, Redshift)
run it from their own test projects, and a backend published through the library
system can run the same tests.

## The descriptor

A backend describes itself with a `Backend`; the suite derives the table
builders, the shared lazy connection, the test tables and the capability
questions from it:

```enso
import Standard.Database_Test_Suite
from Standard.Database_Test_Suite import Backend, Known_Issue, Suite_Part

duckdb_backend =
    Backend.Value "DuckDB In-Memory" (_ -> Database.connect DuckDB.In_Memory) temporary_tables=False known_failures=[Known_Issue.Filter_After_Distinct] parts=[Suite_Part.Common, Suite_Part.Table_Operations]

add_specs suite_builder =
    Database_Test_Suite.add_specs suite_builder duckdb_backend
```

That is the whole of `test/DuckDB_Tests/src/DuckDB_Spec.enso`.

| Argument                  | Default          | Meaning                                                             |
| ------------------------- | ---------------- | ------------------------------------------------------------------- |
| `name`                    | —                | The groups' prefix: `"[DuckDB In-Memory] "`. Specs never read it.   |
| `connect`                 | —                | Opens a new connection; called with `Nothing`.                      |
| `temporary_tables`        | `True`           | Whether the specs' tables are temporary.                            |
| `persistent_connections`  | `True`           | Whether a new connection sees an earlier one's tables.              |
| `known_failures`          | `[]`             | The backend's `Known_Issue`s.                                       |
| `run_advanced_edge_cases` | `True`           | The slower edge cases; `ENSO_ADVANCED_EDGE_CASE_TESTS` forces them. |
| `parts`                   | `Suite_Part.all` | `Common`, `Table_Operations`, `Upload`, `IR`, `Transactions`.       |
| `is_integer_type`         | `.is_integer`    | Which value types count as integers.                                |

## Capabilities come from the dialect

The suite asks the connection's dialect what it supports: `is_feature_supported`
(`Feature`), `flagged` (`Dialect_Flag`), `is_operation_supported`, and
`check_aggregate_support` for aggregates. A backend that behaves differently
answers differently there; the suite has no list of backends, and a policy check
fails any spec that tests a backend's name.

## Known issues

A failure that is a bug is a `Known_Issue`: a closed set, each with a
description and the issue that tracks it. A spec it affects is pending ("Known
issue: … (URL)") for the backends that list it. To add one: a constructor in
`Known_Issue.enso`, its `description` and `issue_url`, the spec asking
`setup.has_known_issue` or `setup.pending_for`, and the backend's
`known_failures`.

## Your own specs

`Database_Test_Suite.add_specs` returns the `Test_Setup` it used. A backend's
own specs take it to share the connection (`setup.default_connection.get`) and
the builders. Without a configured database, register one pending group instead
of calling `add_specs`.

## Where it lives

- `distribution/lib/Standard/Database_Test_Suite/` — the suite (its `CLAUDE.md`
  has the step-by-step guide).
- `test/SQLite_Tests`, `test/Postgres_Tests`, `test/DuckDB_Tests`,
  `test/Microsoft_Tests`, `test/Snowflake_Tests`, `test/AWS_Tests` — the
  built-in backends; `test/Table_Tests` runs the in-memory table.
- Design: `docs/superpowers/specs/2026-10-31-database-test-suite-design.md`.
````

In `libraries/Libraries.md`, after the JDBC bullet:

```markdown
- [**Database test suite:**](Libraries-Database-Test-Suite) Testing a database
  backend against the shared conformance suite.
```

and in `_Sidebar.md`, after `  - [[Libraries-Generic-JDBC-Driver]]`, the line
`  - [[Libraries-Database-Test-Suite]]`. Run
`corepack pnpm exec prettier --check` on the three wiki files and on the changed
`CLAUDE.md` files.

- [ ] **Step 3: Commit and PR.** Title `Docs: testing a database backend`, label
      `CI: No changelog needed`. Body: what the guide covers, and that the wiki
      page `Libraries-Database-Test-Suite` (text in the PR body, from Step 2) is
      for the controller to push. Merge on green; the controller pushes the wiki
      after the merge.

---

## Spec coverage

| Spec section                                                                                                                        | Task                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Decisions: any library author; capabilities from the dialect plus known issues; a suite library and one project per backend         | Global Constraints; 2 (library, descriptor), 1–2 (capabilities), 3 (projects) |
| 1. The library: beside `Standard.Test`, shipped like the non-core libraries, depends on Test, Table, Database                       | 2 (Steps 3, 10; edition; SQLite too, ruling)                                  |
| 1. The shared specs, `Database/Common/*`, `Upload_Spec`, `Transaction_Spec`, `Name_Generator`, `Util` move                          | 2 (moves; Audit and saved connections to `Cloud_Tests`, ruling)               |
| 1. Test data from the library's `data` directory                                                                                    | 2 (`data.csv`, `data_directory`, temporary files)                             |
| 1. `Backend` descriptor, `add_specs suite_builder backend`, derived builders and connection                                         | 2 (Steps 3, 6)                                                                |
| 1. In-memory backend through the same entry point                                                                                   | 2 (`Backend.In_Memory`, Step 8)                                               |
| 1. Group prefixes unchanged                                                                                                         | 2 (`Backend.prefix`), proof in 2 and 3                                        |
| 1. `public-types`, `catalogue: false`                                                                                               | 2 (Step 3)                                                                    |
| 2. The 12 aggregate flags move to the dialect, ruled per backend                                                                    | 1 (rulings, Steps 2–5)                                                        |
| 2. Known issues replace the name checks; the plan rules on each                                                                     | 2 (ruling table, Step 7)                                                      |
| 2. Policy on the descriptor; `ENSO_ADVANCED_EDGE_CASE_TESTS` overrides                                                              | 2 (`run_advanced_edge_cases`, `Test_Selection`)                               |
| 2. Guard rails: same counts per PR; check-workflows rule                                                                            | 1–3 (proof steps), 2 (Step 10)                                                |
| 3. After step 1's Task 5                                                                                                            | Merge order                                                                   |
| 3.1 Dialect capabilities, no visible change                                                                                         | 1                                                                             |
| 3.2 The library, the edition, the test map, API docs, the rule, changelog                                                           | 2                                                                             |
| 3.3 `SQLite_Tests`, `Postgres_Tests`, `Table_Tests` in-memory, `Generic_JDBC_Tests` cycle, shards by project, filter machinery kept | 3 (cycle ends in 2, ruling)                                                   |
| 3.4 Docs: `CLAUDE.md` and the wiki, DuckDB as the example                                                                           | 4                                                                             |
| Snowflake and Redshift: compile and stay pending; each PR says so                                                                   | Global Constraints; each PR body                                              |
| Out of scope: CI for Snowflake/Redshift, unexpected-pass mode, Microsoft/Snowflake specific specs                                   | Not done; their specific specs keep their shape                               |

## Self-review

- **Spec coverage:** every section maps to a task above; the departures (a
  fourth dialect question for aggregates, two `Database/Common` specs staying in
  `Cloud_Tests`, the cycle ending in Task 2, 13 name checks, 13 declared
  aggregate flags) are rulings with evidence. The review's round (data.csv's
  second reader, the doc-line false positive, the reflection config, the
  `Setups` imports and ascriptions, the installer exclusion, the two known
  issues that are capabilities, the `planMatrix` expectation) is folded in.
- **Native image:** nothing relies on SQLite or Postgres being in it, or adds to
  it.
- **Placeholders:** the only value not in the plan is the DuckDB issue's number,
  which exists once Task 2 Step 1 files it; Task 2 Step 3 says where it goes.
  `NNN` in the changelog entry is the PR's own number, by the repo's convention.
- **Names:** `Backend`, `Known_Issue` (`Full_Join_With_Between`,
  `Unordered_Concatenate`, `No_Literal_Tables`, `Filter_After_Distinct`),
  `Suite_Part` (`Common`, `Table_Operations`, `Upload`, `IR`, `Transactions`),
  `Test_Setup`'s `is_aggregate_supported`, `backend`, `default_connection`,
  `has_known_issue`, `pending_for`; `Aggregate_Support.from_setup` and its
  `concatenate`; the eight new `Dialect_Flag`s (Task 1:
  `First_Last_Respects_Row_Order`, `Reports_Aggregation_Problems`,
  `Concatenate_Follows_Row_Order`; Task 2: `Supports_Null_Typed_Columns`,
  `Row_Min_Max_Ignores_Nothing`, `Text_Reverse_Keeps_Grapheme_Clusters`,
  `Reads_Rows_In_Insertion_Order`, `Enforces_Primary_Key_Uniqueness`);
  `checkSuiteIgnoresBackendNames`, `byGroupPrefix`, `groupPrefix`,
  `std-database-test-suite`, `EngineBundle.librariesNotBundled`,
  `org.enso.database_test_suite` — each spelled the same in every task that uses
  it.
