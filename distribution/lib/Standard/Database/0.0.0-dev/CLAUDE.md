# Standard.Database

SQL abstraction for relational databases. Returns a deferred `DB_Table` (query
plan, not data) that mirrors the in-memory `Table` API; call `.read` to
materialize. Database has no backend of its own: backends (Postgres, SQLite,
DuckDB, Snowflake, SQL Server, …) ship in their own libraries —
`Standard.Postgres`, `Standard.SQLite`, `Standard.DuckDB`, `Standard.Snowflake`,
`Standard.Microsoft`, etc. (Postgres and SQLite are no longer in
`Standard.Database`: `from Standard.Postgres import all`,
`from Standard.SQLite import all`.) The PostgreSQL dialect base that Postgres,
DuckDB and Redshift share stays here, in `Postgres_Family`, with `SSL_Mode` and
`Client_Certificate`.

## Main entry points

- `Database.connect <details>` — open a connection. `<details>` is a backend
  type, e.g. `DuckDB.In_Memory`, `Postgres.Server host port db creds` (from
  `Standard.Postgres`), `SQLServer_Details.SQLServer …`.
- `connection.tables` — list tables in the connection.
- `connection.query "table_name"` — get a deferred `DB_Table` for an existing
  table.
- `connection.query (..Raw_SQL "SELECT …")` — run raw SQL.
- `db_table.read` — materialize a deferred table to in-memory `Table`.
- `db_table.filter`, `.sort`, `.aggregate`, `.join`, `.set`, `.at` — same
  interface as in-memory `Table`; the operations build SQL.
- `db_table.select_into_database_table connection "name"` — bulk-load in-memory
  rows into the database.

## Common usage

```
conn = Database.connect DuckDB.In_Memory

db_table = conn.query "employees"
filtered = db_table.filter 'department' (..Equal "Sales")
in_memory = filtered.read

count = db_table.aggregate ['department'] [..Count]

raw = conn.query (..Raw_SQL "SELECT id, name FROM users WHERE active = true")
```

## Layout

- `src/Connection/` — `Connection`, connection options, credentials.
- `src/DB_Table.enso` — deferred table type.
- `src/DB_Column.enso` — deferred column type.
- `src/SQL_Query.enso` — query construction (`..Table_Name`, `..Raw_SQL`).
- `src/SQL_Statement.enso` — prepared SQL statement.
- `src/Dialect.enso` — dialect dispatch (each backend implements one).
- `src/Postgres_Family/` — the PostgreSQL dialect, type mapping, error mapper
  and encoding helpers that Postgres, DuckDB and Redshift share. Not exported
  from `Main.enso`; other libraries import the modules directly.
- `src/Connection/Connection.enso` — the table-name pickers every backend uses,
  `make_table_name_selector` and `make_table_name_with_schema_selector`, are
  searchable resolvers: with the IDE's search text they ask `tables name_like=…`
  (the text, its `\`, `%` and `_` escaped, between `%`s: the database's own
  match, case-sensitive on DuckDB), without it they list every table. Their
  configuration (`add_custom`, `schema_black_list`) is pre-applied in each
  annotation, as `make_schema_selector`'s `include_any` and Snowflake's
  `make_stage_selector`'s `include_home` are.
- `src/Internal/DB_Table_Implementation.enso` — `DB_Table`'s `Widget_Columns`
  must never query the database: it reads a column's type with
  `SQL_Type_Reference.known`, which is `Nothing` for a type not fetched yet
  (kind `Other`, type name `""`), where `get` would run a query
  (`src/Internal/SQL_Type_Reference.enso`).
- `src/Internal/DB_Viz_Source.enso` — the conversion of `DB_Table` to
  `Viz_Table` and `SQL_Viz`.
- `visualizations/SQL_Query.vue` — the SQL Query view of a `DB_Table` or
  `DB_Column`: the generated SQL pretty-printed with `sql-formatter`, each
  interpolated value coloured by its Enso type, keywords, strings, quoted
  identifiers, numbers and comments coloured with the code editor's palette (a
  small tokenizer in the file; it runs on the formatted text before escaping,
  and never on a value; not handled: MySQL `#` comments, Postgres `E'…'` and
  `$$…$$` strings, hex `0x…` numbers), text selectable and Ctrl+C (Cmd+C on
  macOS) copying it. It is not built with the IDE: the GUI compiles it at run
  time once the library is loaded (it may import only `vue`, `sql-formatter` and
  the IDE's `builtins`; see
  `app/gui/src/project-view/stores/visualization/CLAUDE.md`). Its preprocessor,
  `Standard.Visualization.SQL.Visualization`, and the `SQL_Viz` data type stay
  in Standard.Visualization, because Table converts to `SQL_Viz` and
  Visualization cannot import Database. `DB_Table`'s `default_viz_id`
  (`DB_Table_Implementation`) answers
  `Id.Library "Standard.Database" "SQL Query"` to open it. A node saved with the
  old built-in id `SQL Query` still opens it (`movedVisualizations.ts`).

## Things to avoid in generated code

- Assuming all backends support the same SQL — operations that work on one
  backend may fail on another (verify by looking at the backend library's test
  suite).
- Reaching into raw SQL when the high-level API would do — generated SQL is
  dialect-aware, raw SQL is not.

## Where to read more

- `src/Connection/Connection.enso` — connection methods.
- `src/DB_Table.enso` — deferred table operations.
- `distribution/lib/Standard/Database_Test_Suite/` — the same suite runs against
  the in-memory table and every database backend.
- Which aggregates a backend runs is its dialect's `check_aggregate_support`;
  how they behave, its `flagged` answers (`First_Last_Respects_Row_Order`,
  `Reports_Aggregation_Problems`, `Concatenate_Follows_Row_Order`): a new
  `Dialect_Flag` must be answered by every dialect, whose `case` has no default.
- `test/SQLite_Tests/`, `test/Postgres_Tests/`, `test/DuckDB_Tests/`,
  `test/Snowflake_Tests/`, `test/Microsoft_Tests/` — one project per backend.
