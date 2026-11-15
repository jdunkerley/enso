# Working with an Enso project

An Enso project is a graph. Each node is an Enso expression bound to a name, and
the connections between nodes are the names one expression uses from another.
The tools here read the project that is open in the IDE. They are read-only:
none of them changes the project, the execution environment, settings or
secrets.

## How to work

1. Call `get_graph` first. It lists every node with its id, expression, type, a
   short preview of its current value, the connections and any problems. Pass
   `previews: false` for a smaller answer.
2. Node ids are stable across edits. Pass a `node_id` from `get_graph` to
   `get_node` for the full expression, documentation, neighbours and error of
   one node, and to `evaluate_expression` to run in that node's scope.
3. Before naming a method or type you have not seen in the project, call
   `search_components` (optionally with `self_type` to list the methods callable
   on a value of a type), then `get_component_docs` with a qualified name from
   the results. Do not guess signatures from a name alone.
4. Use `evaluate_expression` to look at data: column names, row counts, a few
   rows, join shapes. Each call is a real language server round-trip, so ask for
   what you need and do not fan out. The expression must evaluate to Text:
   choose the encoding with `.to_text`, `.to_display_text` or `.to_json`.

## Evaluating expressions

Examples, with `table` standing for a binding in scope:

- `table.column_names.to_json` is the column names as a JSON array.
- `(table.row_count).to_text` is a single number.
- `(table.first.to_text).take 200` previews a value.
- `((<expr>).catch_primitive (e -> e.to_display_text))` is needed when the
  expression may produce a DataflowError; otherwise the call returns the error
  wrapped in a hint rather than the value.

Evaluation runs in the Design environment, which cannot write files.

## Cap reads at the lowest layer

The tool-call timeout (about 25 seconds) fires during I/O (an HTTPS fetch,
parsing, a SQL round-trip), not during slicing after the parse. Wrapping a full
`Data.read` in `.take 100` does not save parse cost. Push the cap into the
reader or the SQL itself when you only want to look at the data.

- CSV / TSV: `Data.read "<path>" (..Delimited row_limit=(..First 100))`. The
  parser stops at row 100.
- Excel: see the `row_limit` parameter on the Sheet and Range constructors in
  `Excel/0.0.0-dev/src/Excel_Format.enso` (read the `library/Excel` guide).
- Database table: `.limit N` is pushed down until `.read`:
  `connection.query "MyTable" . limit 100`. Do not pull the whole table and then
  `.take`.
- URL with query parameters: narrow the parameters. A series fetched with a
  multi-year date range is slow; the same URL for one week has the same columns
  and fits the budget. For URLs the HTTPS round-trip is the long pole:
  `row_limit` on the format does not shrink it, only a narrower URL does.
- JSON, Parquet or plain HTTP without query parameters: no reader-side cap
  exists. Accept the cost, or probe the planned operation against a small
  literal, for example
  `Table.new [["Code",["XUDLADD"]],["Value",[1.6]]] . rename_columns ...`.

After capping, `.column_names`, `.row_count` and `.take 5 . to_text` are cheap.
If an expression could touch more than a few thousand rows of source data, the
read is not capped low enough.

When a call returns `Execution timed out.`, the read was too large: halve the
cap and retry, then fall back to a literal probe. A `Panic`, a `DataflowError`
or a type-mismatch message means the code is wrong instead.

## `Data.fetch` returns `Response`

`Data.fetch "<url>"` gives an HTTP `Response`, not a `Table`. Table methods such
as `.rename_columns`, `.column_names` and `.aggregate` do not exist on
`Response` and fail with `Method <name> of type Response could not be found`. To
get a parsed table either pass a format,
`Data.fetch "<url>" format=(..Delimited)` for CSV or `format=(..JSON)` for JSON,
or use `Data.read "<url>"`, which detects the format from the content type or
file extension. Prefer `Data.read` when the format is obvious; use `Data.fetch`
with an explicit format to override detection or to pass HTTP headers.

## Other guides

Read them with `get_guide` and a `topic`.

- `language`: Enso syntax and the common standard library entry points.
- `data-pitfalls`: mistakes that silently produce wrong data.
- `stdlib`: conventions shared by every standard library (when a library is
  bundled).
- `library/<Name>`: the public API, usage and pitfalls of one standard library,
  for example `library/Base` or `library/Table`. Read a library's guide before
  using it.
