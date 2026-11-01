# std-bits/database

Java helpers for `Standard.Database` (`distribution/lib/Standard/Database/`),
also used by the other database libraries (Postgres, SQLite, DuckDB, Microsoft,
Snowflake, AWS Redshift, Generic_JDBC). Packaged as `std-database.jar`. It ships
no JDBC driver: each backend library carries its own (`std-bits/postgres`,
`std-bits/sqlite`, …).

## Layout

- `JDBCProxy` — opens every JDBC connection (Enso can't call `DriverManager`
  directly: the drivers would not be found). It wraps the connection it returns.
- `audit/` — the wrappers: `LocalAuditedConnection` logs each statement to the
  `Standard.Database.Connection` logger at INFO; `CloudAuditedConnection` sends
  it to the Enso Cloud audit log instead (data links opened while signed in).
- `JDBCBatchInsert`, `JDBCValueSetter`, `fetchers/` — bulk insert, parameter
  binding and column reading.
- `dryrun/` — synchronisation and hidden-table bookkeeping.

## Rules

- **Every connection is wrapped**, data link or not. Anything that needs a
  driver's own class (`DuckDBConnection`, …) must take a `java.sql.Connection`
  and `unwrap` it — see `std-bits/duckdb`'s `DuckDBUtils`. A parameter typed as
  the driver class fails at the Enso→Java call.
- The wrappers must behave exactly like the driver: delegate every method,
  including the interfaces' `default` ones (`enquoteIdentifier` and friends), or
  the interface's generic version silently replaces the driver's. Statements'
  `getConnection()` returns the audited connection; a `PreparedStatement`'s
  SQL-string methods throw `SQLException`, as JDBC requires; `prepareCall` is
  logged when prepared and returns the driver's own `CallableStatement`.
- The wrapper is not inescapable: `getMetaData().getConnection()`,
  `ResultSet.getStatement()` and a `CallableStatement` reach the driver's
  objects, and what runs through them is not logged.
- **Log the SQL text only.** Never bound parameter values, never connection
  properties (credentials travel there); the URL is logged through
  `LocalAuditedConnection.redactUrl`, which is pattern matching and can't catch
  every form, so never claim that credentials can't appear.
- **Logging must never break a connection or a statement.** The URL is read
  lazily on the first line logged, any failure falls back to a fixed label, and
  `JDBCProxy` returns the raw connection if the wrapper can't be created. While
  INFO is off nothing is built (`isAuditEnabled`).
- The logger is at `warn` in the engine configs, so logging is off unless the
  IDE's Log SQL queries setting (or
  `--vm.D Standard.Database.Connection.Logger.level=info`) turns it on.
- Inside the engine, SLF4J is backed by `TruffleLoggerWrapper`
  (`lib/scala/logging-truffle-connector`), not logback, and it is on the
  `std-tests` classpath too, so a test can't attach a logback appender:
  `LocalAuditedConnection` has a package-private constructor taking the logger.

## Tests

No test sources here: Java tests live in `std-bits/tests`
(`org.enso.database.audit`, run with `sbt "std-tests/testOnly ..."`), and the
behaviour through Enso is covered by `test/SQLite_Tests`, `test/Postgres_Tests`
and the other database test projects.
