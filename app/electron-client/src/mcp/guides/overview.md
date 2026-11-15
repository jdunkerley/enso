# Working with an Enso project

An Enso project is a graph. Each node is an Enso expression bound to a name, and
the connections between nodes are the names one expression uses from another.
The tools here read and edit the project that is open in the IDE, and open or
create projects. Edits are made as ordinary nodes, and the user can undo them.
No tool changes the execution environment, settings or secrets;
`evaluate_expression` runs code, but only in the Design environment.

## How to work

1. Call `get_graph` first. It gives the method's `source` and lists every node
   with its id, name, expression (`code`), type, state and a short preview of
   its current value. There is no edge list: read the connections from each
   node's `code` (a node uses another by its `name`) and from `source`. Pass
   `previews: false` for a smaller answer.
2. Node ids are stable across edits. Pass a `node_id` from `get_graph` to
   `get_node` for the full expression, documentation, a longer value preview and
   the error text of one node, and to `evaluate_expression` to run in that
   node's scope.
3. Before naming a method you have not seen in the project, call
   `search_components`: without `self_type` it finds the functions called on a
   module or type (`Data.read`), with `self_type` (a node's `type`) the methods
   callable on a value of that type. Then call `get_component_docs` with a
   `name` from the results. Do not guess signatures from a name alone.
4. Use `evaluate_expression` to look at data: column names, row counts, a few
   rows, join shapes. Each call is a real language server round-trip, so ask for
   what you need and do not fan out. The expression must evaluate to Text:
   choose the encoding with `.to_text`, `.to_display_text` or `.to_json`.

## Building

1. Read the graph with `get_graph` first, so you build on what is there. With no
   project open, `get_app_state` tells you, `list_projects` finds one and
   `open_project` or `create_project` opens it.
2. Look components up (`search_components`, then `get_component_docs`) before
   using them.
3. Add a few nodes at a time with `add_nodes`: each statement is
   `name = expression`, and later statements may use the names of earlier ones.
   Pass whole import lines in `imports`. Use `add_function` for a top-level
   function and call it from a node as `Main.<name> args`.
4. Read the result of every edit: it lists the affected nodes with their types
   and errors, and `settled` says whether the engine finished evaluating them.
   When a node has an error or the wrong type, fix it with `edit_node`; use
   `remove_nodes` to drop a node. Check with `get_node` or `evaluate_expression`
   before building on a node.
5. Group a run of nodes that does one job with `collapse_nodes`, and explain a
   node with `set_node_comment`.
6. `select_nodes` and `open_method` move what the user sees; the other edits do
   not. `set_visualization` shows or hides a node's visualization.
7. Edits are refused while the project is in Live mode: ask the user to switch
   it back to Design.
8. Never assume a change reached disk. The edits are in the IDE; the user clicks
   Write to save them.

## Evaluating expressions

Examples, with `table` standing for a binding in scope:

- `table.column_names.to_json` is the column names as a JSON array.
- `(table.row_count).to_text` is a single number.
- `(table.first.to_text).take 200` previews a value.
- `((<expr>).catch_primitive (e -> e.to_display_text))` is needed when the
  expression may produce a DataflowError; otherwise the call returns the error
  wrapped in a hint rather than the value.

Evaluation runs only in the Design environment, where output is off: an
expression never writes to the file, database or service it names. A write that
supports a dry run (such as `.write` on Text or a Table) writes to a temporary
file instead and returns that file's path; other writes fail. While the user has
the project in Live mode, `evaluate_expression` is refused. Do not use it to
save data.

## Cap reads at the lowest layer

The tool-call timeout (about 25 seconds) fires during I/O (an HTTPS fetch,
parsing, a SQL round-trip), not during slicing after the parse. Wrapping a full
`Data.read` in `.take 100` does not save parse cost. Push the cap into the
reader or the SQL itself when you only want to look at the data.

- CSV / TSV: `Data.read "<path>" (..Delimited row_limit=(..First 100))`. The
  parser stops at row 100.
- Excel: `Data.read "<path>" (..Sheet 1 row_limit=(..First 100))` (the `Range`
  constructor takes `row_limit` too; `get_component_docs` has both).
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
