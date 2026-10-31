# Standard.Postgres

PostgreSQL backend for `Standard.Database`: connect to a server, query it as a
deferred `DB_Table`, and open saved PostgreSQL data links.

## Main entry points

- `Postgres.Server host port database …` — `Database.connect` argument for a
  PostgreSQL server (host, port, database, schema, credentials, SSL mode, client
  certificate; see the doc block in `src/Postgres.enso`).
- `Postgres_Connection` — the connection type returned by `Database.connect`.
- Data links of type `Postgres_Connection` — read with `Data.read`. Files
  written before this library existed (`libraryName: Standard.Database`) still
  work.
- `SSL_Mode` and `Client_Certificate` are not in this library: they come from
  `Standard.Database`.

## Common usage

```
from Standard.Database import all
from Standard.Postgres import all

conn = Database.connect (Postgres.Server "localhost" 5432 "mydb")
t = conn.query "my_table"
result = t.read
```

## Layout

- `src/Postgres.enso` — `Postgres.Server`.
- `src/Postgres_Connection.enso` — connection type.
- `src/Postgres_Data_Link.enso` — private; the saved data link type.
- `src/Internal/` — `Pgpass` (the `.pgpass` reader, Postgres only) and the SPI
  registrations (`Postgres_Services`).
- The shared dialect, type mapping and error mapper are
  `Standard.Database.Postgres_Family` (DuckDB and Redshift use them too).

## Guest JVM

The `postgresql` driver is not compiled into the native image: this library runs
on the guest JVM, as `Standard.Microsoft` does. So it must create and use every
JDBC object itself: `Postgres_Connection` makes its own `JDBCDriverTypes`, and
`Internal/Postgres_Type_Mapping` wraps the family mapping with this library's
own `ColumnFetcherFactory` and `JDBCValueSetter` imports (the family's would be
Database's hosted classes). Keep new `polyglot java import`s of Database's Java
helpers in this library's modules, not in `Standard.Database`.

## Things to avoid in generated code

- Moved out of `Standard.Database`; `from Standard.Postgres import all` is
  needed in code run outside the IDE (the IDE adds it).
- Importing `SSL_Mode` or `Client_Certificate` from `Standard.Postgres`; take
  them from `Standard.Database`.

## Where to read more

- `test/Table_Tests/src/Database/Postgres_Spec.enso` — the Postgres test suite
  (needs a running server).
- `distribution/lib/Standard/Database/CLAUDE.md` — `DB_Table` semantics.
