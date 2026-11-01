# A database test suite for every backend

The shared table and database tests become a library,
`Standard.Database_Test_Suite`, that any database backend runs against itself:
ours (SQLite, PostgreSQL, DuckDB, SQL Server, Snowflake, Redshift) and a third
party's published through the library system. A backend describes itself in a
few lines; what it supports comes from its dialect, and what is broken from a
short list of known issues. Each backend gets its own test project, and
`Table_Tests` keeps only the in-memory tests.

## Decisions (the user's, 2026-10-31)

- **Audience: any library author.** The suite ships as a library, so a backend
  published through the library system can run the same conformance tests.
- **Capabilities come from the dialect, plus known issues.** A backend states
  what it supports once, in its dialect; the tests list only known failures
  (with an issue) and policy.
- **Layout: a suite library, and one test project per backend.** `Table_Tests`
  keeps the in-memory tests.

## Where things are today

(From a read of the code on 2026-10-31.)

- The shared suite is `test/Table_Tests/src/Common_Table_Operations/` (37 spec
  files and `Join/`, about 850 KB), entered through
  `Common_Table_Operations.Main.add_specs suite_builder setup`, with
  `Database/Common/*` (`Common_Spec`, `Names_Length_Limits_Spec`, `Audit_Spec`,
  `Default_Ordering_Spec`, `IR_Spec`, `Single_Column_Table_Spec`),
  `Database/Upload_Spec` and `Database/Transaction_Spec` beside it. All take a
  `Test_Setup.Config` record (`prefix`, `table_fn`, `empty_table_fn`,
  `table_builder`, `materialize`, `is_database`, `test_selection`,
  `aggregate_test_selection`, `create_connection_func`, `light_table_builder`,
  `is_integer_type`, `is_feature_supported`, `flagged`,
  `is_operation_supported`).
- Six backends plug in: SQLite and PostgreSQL in `Table_Tests/src/Database/`,
  DuckDB (`test/DuckDB_Tests`), SQL Server (`test/Microsoft_Tests`), Snowflake
  (`test/Snowflake_Tests`) and Redshift (`test/AWS_Tests`). They reach the suite
  by importing `enso_dev.Table_Tests.*`; test projects have no `dependencies:`
  and resolve each other as local libraries.
- About 40 lines of identical wiring (table builders, `materialize`, a lazy
  default connection, the table functions, the three dialect closures) are
  repeated in seven places (six backends and the in-memory spec).
- Capabilities live in three places: the dialect's `Feature` (20 variants) and
  `Dialect_Flag` (35 variants, `Standard.Database.Dialects`); a test-only
  `Aggregate_Spec.Test_Selection` of 12 flags hand-set per backend; and 11
  checks of the backend's name (`setup.prefix == …`) in
  `Common_Table_Operations` and `Upload_Spec`.
- `Table_Tests` and `Generic_JDBC_Tests` import each other.
- CI splits `Table_Tests` into PostgreSQL / SQLite File / Rest shards by a regex
  on the group-name prefix (`tools/ci/stdlib-test-map.yaml`,
  `ENSO_TEST_GROUP_FILTER`). Snowflake and Redshift never run in normal CI (no
  credentials).

## 1. The suite library and the backend descriptor

`Standard.Database_Test_Suite` is a new library beside `Standard.Test`, shipped
like the other non-core libraries (so it can later be downloaded like them). It
depends on Test, Table and Database, and holds:

- the shared specs, moved from `Table_Tests`: `Common_Table_Operations/*`,
  `Database/Common/*`, `Upload_Spec`, `Transaction_Spec`, and the helpers they
  use (`Name_Generator`, `Util`);
- their test data (`data.csv` and the rest), read from the library's own `data`
  directory instead of `Project_Description.new enso_dev.Table_Tests`;
- the `Backend` descriptor, the only thing a backend author writes:

```enso
Backend.Value
    name="PostgreSQL"                     # group prefix "[PostgreSQL] "
    connect=(-> Database.connect (Postgres.Server …))
    temporary_tables=True                 # SQLite: False
    known_failures=[Known_Issue.Join_Nulls_8243]
    run_advanced_edge_cases=True          # Snowflake, Redshift: False
```

- one entry point, `Database_Test_Suite.add_specs suite_builder backend`, which
  derives what is repeated seven times today: the table builders, `materialize`,
  the lazy shared connection, the table functions, and the capability queries on
  `connection.dialect`.

The in-memory backend uses the same entry point with a descriptor whose
capabilities are those of the in-memory table, so `Table_Tests` still runs the
shared specs against it.

A backend's test project becomes:

```enso
add_specs suite_builder =
    Database_Test_Suite.add_specs suite_builder postgres_backend
    Postgres_Specific_Spec.add_specs suite_builder
```

Group names keep today's prefixes (`[PostgreSQL]`, `[SQLite File]`, …), so test
reports read the same; CI no longer depends on them (section 3).

The library's `package.yaml` declares its `public-types` and `catalogue: false`
(a test tool's components do not belong in the component browser).

## 2. Capabilities and known issues

**Capabilities come only from the dialect.** The suite asks `connection.dialect`
through the three methods every dialect already implements:
`is_feature_supported`, `flagged` and `is_operation_supported`.

The 12 aggregate flags of `Aggregate_Spec.Test_Selection` move to the dialect,
each by this rule:

- where the product already exposes the operation, the suite asks
  `is_operation_supported "<OP>"` (likely `advanced_stats`, `std_dev`,
  `text_concat`, `text_shortest_longest`, `first_last`);
- where an existing flag says it, it is reused (`nan` → `Supports_Separate_NaN`,
  `date_support` → `Date_Time`);
- otherwise a new `Dialect_Flag` for the real product behaviour (likely
  `First_Last_Respects_Row_Order`, `Supports_Multi_Distinct`,
  `Reports_Aggregation_Problems`), answered by every dialect as the test
  projects set it today.

The implementation plan rules on each flag against each backend's current
override, so no test changes outcome.

**Known issues replace the checks of the backend's name.** The suite defines a
closed set, `Known_Issue` (e.g. `Join_Nulls_8243`, `Upload_Key_Order_10737`),
each with a description and an issue number. A spec affected by one asks
`backend.has_known_issue Known_Issue.X` and, if so, is `pending` with "Known
issue #8243". A backend lists its issues in `known_failures`; a misspelt one
fails with `No_Such_Method` when the descriptor is used (checked: it is a run
time error, not a compile error). Each of the 11 name checks becomes a
capability check (a genuine difference) or a known issue (a bug); the plan rules
on each.

**Policy stays on the descriptor.** `run_advanced_edge_cases` is policy, not a
fact about the dialect; `ENSO_ADVANCED_EDGE_CASE_TESTS` still overrides it.

**Guard rails.**

- Each backend's pass, fail and pending counts are the same before and after
  every PR (JUnit output compared with `tools/build-scripts`' `junit-compare`).
- A `tools/ci/check-workflows.mjs` rule fails any spec in the suite that reads
  the backend's `name` (or a `prefix`) to decide behaviour.

## 3. The move, CI, and the PRs

After step 1's Postgres move (Task 5 of
`docs/superpowers/plans/2026-10-30-postgres-sqlite-libraries.md`) has merged,
since PostgreSQL's tests move to a project that depends on `Standard.Postgres`.

1. **Dialect capabilities.** The new `Dialect_Flag`s, answered by every dialect
   (Postgres family, SQLite, DuckDB, SQL Server, Snowflake, Redshift); the
   aggregate specs ask the dialect instead of `Aggregate_Spec.Test_Selection`,
   and the hand-set flags go. Same counts per backend. No visible change.
2. **`Standard.Database_Test_Suite`.** The shared specs, helpers and data move
   in, with `Backend`, `Known_Issue` and `add_specs`; the 11 name checks become
   capabilities or known issues; every current user switches to it
   (`Table_Tests` with in-memory, SQLite and PostgreSQL for now; DuckDB,
   Microsoft, Snowflake, AWS). The edition, the test map, API docs, and the
   check-workflows rule. A changelog entry under `#### Enso Standard Library`:
   library authors get a conformance suite.
3. **One test project per backend.** `test/SQLite_Tests` and
   `test/Postgres_Tests` take their backend's descriptor and specific specs
   (including the type-mapping specs) out of `Table_Tests`, which keeps the
   in-memory tests. `Generic_JDBC_Tests` takes `Name_Generator` from the suite,
   ending the import cycle. CI shards by project: `Table`, `SQLite`, and
   `Postgres` (`needs: postgres`) replace the group-filter split; the
   `ENSO_TEST_GROUP_FILTER` machinery stays for later use.
4. **Docs.** "Testing a database backend" in the suite's `CLAUDE.md` and the
   wiki: write a `Backend`, list known issues, add your own specs, with
   `DuckDB_Tests` as the worked example.

Snowflake and Redshift do not run in CI: for them the proof is that their
projects compile and stay pending without credentials, and each PR says so.

## Out of scope

- Running Snowflake and Redshift in CI.
- An "unexpected pass" mode, where a fixed bug makes its stale known-issue entry
  fail.
- Reorganising Microsoft's and Snowflake's own backend-specific specs.
