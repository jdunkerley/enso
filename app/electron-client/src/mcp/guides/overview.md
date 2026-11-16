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
4. Read the result of every edit. `add_nodes` and `edit_node` return the nodes
   they made or changed, with their types and errors; `collapse_nodes` returns
   the function's name and the node that calls it; `set_node_comment` and
   `set_visualization` return the node; `remove_nodes` returns only the ids it
   removed and `add_function` only the function's name, so after either call
   `get_graph` to see the nodes they affected. `settled: true`: the engine has
   reported results for the changed nodes, so the types and errors in this
   result are current. `settled: false`: it had not within 20 seconds; call
   `get_node` later. When a node has an error or the wrong type, fix it with
   `edit_node`; use `remove_nodes` to drop a node. Check with `get_node` or
   `evaluate_expression` before building on a node.
5. Group a run of nodes that does one job with `collapse_nodes`, and explain a
   node with `set_node_comment`.
6. `select_nodes` and `open_method` are the only project tools that change the
   selection, and with `get_visualization` the only ones that move the view; the
   edits do not. `set_visualization` shows or hides a node's visualization.
   `get_visualization` lets you look at a node's visualization as the user sees
   it: `format: "image"` (the default) is a picture of it, `format: "data"` is
   the data the view was given (at most 20,000 characters). It shows a hidden
   visualization first (`shown: true`), as `set_visualization` does; hide it
   again if the user did not ask to see it. For a picture it may also move the
   view (`moved: true`) to bring the visualization on screen. To read values,
   `get_node` and `evaluate_expression` are better; use `get_visualization` to
   see a chart or what the user is looking at.
7. Every tool that changes the project is refused while it is in Live mode: ask
   the user to switch it back to Design. Reading, selecting and navigating
   (`select_nodes`, `open_method`) still work there; `get_visualization` works
   there only for a visualization already shown.
8. Your edits are saved with the project as you make them. Do not turn Write on
   (writing a node's output: a file, a database table). Code that enables the
   output context (`with_enabled_context`, `with_enabled`, binding a runtime
   builtin, building a method name by reflection, looking a method up by a name
   in text, or evaluating text as code) is refused. Only the user turns Write
   on, by clicking it on a node; `edit_node` and `collapse_nodes` refuse a node
   they did. Your edits can still cause a write in two ways you should avoid:
   calling a function in the user's project that itself enables output, and
   changing a node upstream of one the user has switched Write on for (it
   re-runs with your change). Ask the user before doing either.
9. Your edits form one undo step for the user until you pause for 10 seconds,
   the user edits the project or leaves its tab, or `open_method` changes the
   method; then the next edit starts a new step. Edits from several agents run
   one at a time. An edit whose turn comes after the method on screen changed is
   refused with nothing changed: call `get_graph` and try again. There is no
   undo tool: to take a change back, edit or remove the nodes.

## Evaluating expressions

Examples, with `table` standing for a binding in scope:

- `table.column_names.to_json` is the column names as a JSON array.
- `(table.row_count).to_text` is a single number.
- `(table.first.to_text).take 200` previews a value.
- `((<expr>).catch_primitive (e -> e.to_display_text))` is needed when the
  expression may produce a DataflowError; otherwise the call returns the error
  wrapped in a hint rather than the value.

Evaluation runs only in the Design environment, where output is off: a write in
the expression does not reach the file, database or service it names. A write
that supports a dry run (such as `.write` on Text or a Table) writes to a
temporary file instead and returns that file's path; other writes fail. While
the user has the project in Live mode, `evaluate_expression` is refused. Do not
use it to save data, and do not turn Write on in it: the code that enables the
output context is refused here as in the edits (item 8 above), and an expression
that calls a function of the user's project which enables output can still
write. Ask the user before doing that.

## Cap reads at the lowest layer

`evaluate_expression` waits 25 seconds for an expression's result, then answers
with an error. The limit fires during I/O (an HTTPS fetch, parsing, a SQL
round-trip), not during slicing after the parse. Wrapping a full `Data.read` in
`.take 100` does not save parse cost. Push the cap into the reader or the SQL
itself when you only want to look at the data.

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
