# Standard.Table

A columnar table library for in-memory and database-backed data. Provides
`Table` and `Column` types with filtering, sorting, aggregation, joins, pivots,
and reading/writing delimited text (CSV/TSV).

## Main entry points

- `Table.new` — create a table from `[[name, vector], …]`.
- `Table.from_rows` — create a table from header row + row vectors.
- `Table.from_objects` — build a table from a vector of objects.
- `Table.at` — get a column by name or index.
- `Table.set` — add or update a column.
- `Table.filter` — filter rows by condition (supports `..Equal`, `..Greater`,
  `..Less`, `..Between`, `..Is_In`, … via `Filter_Condition` autoscope).
- `Table.select_columns` / `Table.remove_columns` — pick or drop columns.
- `Table.sort` — sort rows.
- `Table.aggregate` — group rows; `Aggregate_Column` has `..Count`, `..Sum`,
  `..Average`, `..Group_By`, `..First`, … (autoscope).
- `Table.cross_tab` — pivot rows to columns with an aggregation.
- `Table.join` — join two tables; supports inner, left, right, full.
- `Column` — column type with `.map`, `.filter`, `.zip`, etc.

## Common usage

```
table = Table.new [['Name', ['John', 'Paul']], ['Age', [25, 35]]]

filtered = table.filter 'Age' (..Greater 30)

sorted = table.sort ['Age']

grouped = table.aggregate ['Name'] [..Count, ..Sum 'Age']

pivot = (Table.new [['Id', ['A','A']], ['B', ['Name','Country']], ['C', ['Ada','UK']]])
    . cross_tab ['Id'] 'B' (..First 'C')
```

## Layout

- `src/Table.enso` — `Table` type and operations.
- `src/Column.enso` — `Column` type.
- `src/Aggregate_Column.enso` — aggregation specs (`..Count`, `..Sum`, …).
- `src/Value_Type.enso` — column type system.
- `src/Delimited/` — CSV/TSV reading and writing.
- `src/Extensions/` — type-extension methods (e.g. `Vector.to_table`).
- `src/Internal/Viz_Helpers.enso`, `src/Internal/In_Memory_Viz_Source.enso` —
  the conversion of `Table` to `Viz_Table`.
- `src/Internal/Column_Kinds.enso` — `of_value_type`, the `Column_Kind` of a
  `Value_Type`; `Table` and `Row` answer `Widget_Columns` from it (schema only).
  The database does the same without querying: see Database's CLAUDE.md.

## Things to avoid in generated code

- `Column.map`, `Table.rows` and `.to_vector.map` where a Table or Column method
  exists — `table.set (expr "[Price] * [Qty]") as="Total"`, Column arithmetic,
  `text_replace`, `trim`, `parse`, `fill_nothing`, `iif`, `filter`, `aggregate`,
  `merge`/`replace` for lookups. They run over the whole column at once and on a
  database table become SQL; `map` fails on a database column and its
  `to_vector` stops at 1,000 values.

- Joins with mismatched key types silently produce mismatch markers — verify
  column types are compatible before joining.

- EDI (ANSI X12) reading is not part of this library: it moved to `Standard.EDI`
  (`from Standard.EDI import all`).

- Fixed-width text reading is not part of this library either: it moved to
  `Standard.Fixed_Width` (`from Standard.Fixed_Width import all`).

- Alteryx `.yxdb` reading is not part of this library either: it moved to
  `Standard.YXDB` (`from Standard.YXDB import all`).

- Excel (`.xlsx`, `.xls`, `.xlsb`) reading and writing is not part of this
  library either: it moved to `Standard.Excel`
  (`from Standard.Excel import all`).

## Column pickers in annotations

- Annotate a column argument with a static `Widget.Column_Name …`,
  `Widget.Column_Names …`, `Widget.Column_Vector` or `Widget.Order_By` value
  (`from Standard.Base.Metadata import Widget`). The widget is a _reference_:
  the IDE reads the table's columns once per node and expands the reference, so
  never copy column names into a widget.
- Add `kinds=[Column_Kind.Numeric]` (and so on) only where the method rejects
  other kinds with a type error; leave it off where any column is fine.
- The builders in `src/Internal/Widget_Helpers.enso` return references too. A
  composite builder nests the references of its parts as the options of a
  grouped choice; it does not build a column list (except rename's item default,
  which needs the names). A `kinds=` argument needs
  `import Standard.Base.Metadata.Column_Kind.Column_Kind`.

## Where to read more

- `src/Table.enso` — type definition with method docs.
- `src/Aggregate_Column.enso` — list of aggregation constructors.
- `test/Table_Tests/src/In_Memory/` — comprehensive in-memory examples.
- `distribution/lib/Standard/Database_Test_Suite/0.0.0-dev/src/Common_Table_Operations/`
  — operations that work on both in-memory and database tables.
