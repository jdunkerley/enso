# Standard.SQLite

SQLite backend for `Standard.Database`: in-memory or file databases, and reading
`.db`/`.sqlite` files with `Data.read`.

## Main entry points

- `SQLite.In_Memory` — `Database.connect` argument for an ephemeral in-memory
  database.
- `SQLite.From_File path` — `Database.connect` argument for an on-disk database.
- `SQLite_Connection` — the connection type returned by `Database.connect`.
- `SQLite_Format` — file-format SPI for `.db`/`.sqlite` files.

## Common usage

```
from Standard.SQLite import all

conn = Database.connect (SQLite.From_File "x.db")
t = conn.query "my_table"
result = t.read
```

## Layout

- `src/SQLite.enso` — `SQLite.In_Memory`, `SQLite.From_File`.
- `src/SQLite_Connection.enso` — connection type.
- `src/SQLite_Format.enso` — file format.
- `src/Internal/` — dialect, type mapping, error mapper, entity naming and the
  SPI registrations (`SQLite_Services`).

## Things to avoid in generated code

- Assuming an `In_Memory` database persists — close the connection and the data
  is gone. Use `From_File` for persistence.
- Moved out of `Standard.Database`; `from Standard.SQLite import all` is needed
  in code run outside the IDE (the IDE adds it).

## Where to read more

- `test/Table_Tests/src/Database/SQLite_Spec.enso` — the SQLite test suite.
- `distribution/lib/Standard/Database/CLAUDE.md` — `DB_Table` semantics.
