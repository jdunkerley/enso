# Standard.Visualization

Preprocessors and helpers used by the Enso IDE to render values as charts,
tables, geo maps, etc. The IDE invokes these automatically — **user code should
not import this library**. The agent should not generate code that imports from
it either.

## Main entry points (IDE-facing only)

- `Preprocessor.default_preprocessor value` — IDE entry: encode an arbitrary
  value as JSON for visualization; it returns `(Viz_Json.from value).json_text`.
- `Tree.prepare value` and `Tree.children value path start count` — IDE entries
  of the JSON visualization: the root of `Viz_Tree.from value` with its first
  page of 100 children, and one page of the branch that `path` (keys and
  indices) leads to. Both return JSON text:
  - a node is `{"kind":"leaf","value":…}` or
    `{"kind":"object"|"array","size":…,"label":…}`; an entry is
    `{"key":…,<node fields>,"expr":<node expression or null>}`;
  - a page is `{"start":…,"size":…,"entries":[…]}`; `prepare` returns
    `{"root":…}` or `{"root":…,"children":<page>}` (both with `"actions"` first
    when the value offers any); `children` returns a page or `{"error":…}`. The
    goldens `test/Visualization_Tests/data/pinned/tree_*` pin it;
  - a value that is a dataflow error shows its payload's tree as the root;
  - `prepare` falls back to a leaf of the value's display text when building the
    tree fails;
  - a `path` walks an array's child by index and an object's by key (through its
    `child_of`, else by looking through its pages); a key other than an Integer
    on an array is a miss at once, reading no page. A missing key is an
    `Illegal_Argument` ("No child has the key …");
  - the GUI chains a child's `expr` after its ancestors' with the spaced dot
    (`.get 'tags'` then `.at 1` on node `data` is `data.get 'tags' . at 1`); if
    an ancestor has none (`null`), the child has none either.
- `Geo_Map.process_to_json_text value` — IDE entry for the geo-map widget.
- `Scatter_Plot.process_to_json_text value` — IDE entry for the scatter-plot
  widget.

## Common usage

There is none for user code. The IDE calls these functions; user-defined
components and workflows should not.

## Layout

- `src/Preprocessor.enso` — default visualization preprocessor.
- `src/Tree.enso` — the JSON visualization's entry points over `Viz_Tree`.
- `src/Helpers.enso` — display utilities (truncation, formatting, timing).
- `src/Internal/Columns_Source.enso`, `src/Internal/View_Source.enso`,
  `src/Internal/Names.enso` — the in-memory sources and name matching behind
  `Viz_Table`.
- `src/Internal/View_Json.enso` — the one writer of the table view's three
  messages (the view, a server row page, a column's distinct values). Public:
  Table, Database and XML build their views with `grid_json`, `View_Column`,
  `View_Link`, `value_json`, `error_json`, `table_view`. It also holds the views
  of the built-in values: `vector_view` (also arrays), `dictionary_view`,
  `hashset_view`, `js_object_view` and `value_view` (any other value). Libraries
  write their own with `Viz_Table.from_columns` or `from_view`. The GUI reads
  the messages with the zod schema in
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`.
- `src/Geo_Map.enso`, `src/Scatter_Plot.enso` — per-visualization preprocessors.
- `src/Table/Visualization.enso` — IDE entry points of the table view
  (`prepare_visualization`, `get_rows_for_table`,
  `get_distinct_values_for_column`), written against `Viz_Table`.
- `src/SQL/Visualization.enso` — IDE entry point of the SQL view, written
  against `SQL_Viz`.
- `src/Internal/Chart_Limits.enso` — the row bounds and `local_rows`, which the
  charts use to read a bounded number of rows from any `Viz_Table`.
- `src/Widgets.enso`, `src/Id.enso`, `src/Warnings.enso`, `src/File_Upload.enso`
  — supporting IDE utilities.

## Data types

Public types a library converts its values to, so the IDE depends on
Visualization and not on each data library.

- `Viz_Table` (`src/Viz_Table.enso`) - what the table view shows. Build one with
  `Viz_Table.from_source source`, `from_columns headers columns` (in-memory) or
  `from_view make_json` (a view with no columns). Its source supplies, as
  methods:
  - Required: `table_view_json max_rows`, `column_names`, `column_kinds`,
    `row_count`, `select_columns names`, `slice start count`,
    `sample count seed`, `supported_operations`. Methods returning a table
    return a `Viz_Table`.
  - Capability `"rows"`: `rename_columns names`, `add_row_number name`,
    `filter_between name low high`, `rows_json`, `column_values name`.
  - Capability `"server_rows"`:
    `server_rows_json start sort_columns sort_directions filter_columns filter_conditions`,
    `distinct_values_json column_index filter_columns filter_conditions`.
  - Capability `"spatial"`: `spatial_layers_json`.
  - Capability `"view_pieces"`: `column_cells_json index start count` (a JSON
    array of cells; `index` is the column's position in `column_names`, read by
    position because a lookup by name cost ~100 ms on 2,500 columns) and
    `column_metrics_json` (per column, the `value_type`, `metrics`,
    `multi_filter` and `number_format` fields), which `View_Json.table_view`
    assembles. The in-memory source implements them in Java.

  A source lists the capabilities it has in `supported_operations`; calling an
  operation it lacks gives `Viz_Unsupported.Error operation`. `Viz_Column_Kind`
  (`Numeric`, `Textual`, `Logical`, `Date_Only`, `Date_And_Time`, `Time_Only`,
  `Other`, plus a display name) describes a column. `Internal/Columns_Source`,
  `Internal/View_Source` and `Internal/Names` are the in-memory sources and name
  matching.

- `SQL_Viz` (`src/SQL_Viz.enso`) - what the SQL view shows: dialect, code and
  interpolations.
- `Viz_Cell` (`src/Viz_Cell.enso`) - how a value renders inside a table cell;
  Base values render here, a library renders its own types by a conversion.
- `Viz_Json` (`src/Viz_Json.enso`) - the JSON the JSON visualization receives,
  kept small: Base values here (text over 2000 characters is cut, vectors to 100
  items and 5 levels), a library's large types by
  `Viz_Json.from (that:Its_Public_Type)` (Table: 10 rows; Column: 100 values;
  XML: the element tree).
- `Viz_Tree` (`src/Viz_Tree.enso`) - a value as the JSON visualization's lazy
  tree: a `Leaf` (scalar JSON) or a `Branch` (kind, size, label and
  `children start count`, one page of `Viz_Tree_Child` with key, tree and node
  expression, and an optional `child_of key` that finds one child without
  building a page). Build branches with `Viz_Tree.paged`, or with
  `Viz_Tree.lookup_paged` when a key can be found directly. Base values convert
  here (any other value: its `to_js_object`, with no node expressions); a
  library or a user type describes its own with
  `Viz_Tree.from (that:Its_Public_Type)` (Table: row count, columns and rows
  read a page at a time; Column, Row; XML: attributes and children).
- `Viz_Actions` (`src/Viz_Actions.enso`, with `Viz_Action` and
  `Viz_Action_Kind`) - the nodes a value's visualisations can create. Each
  `Viz_Action` has an `id` a visualisation looks for, a label, an icon, a kind
  (`Chain` on the node, or `New_Node`, whose template names the node with
  `{{node}}`) and a template: `{{#x}}` a value (a number when it reads as one),
  `{{@x}}` a value as it is, `{{x}}` an expression the visualisation builds, `*`
  for a vector of them. Base: a vector or array offers `open_row`
  (`at {{#index}}`); any other value none. Table: `open_row`, `open_column`,
  `open_cell`, `sort`, `filter`, `remove_columns`, `reorder_columns`,
  `brush_filter`; Column: `open_row`; Row: `open_row` (`at {{#index}}`, its
  values by number; the scatter plot and tree send it, but the Row's table view
  does not: `Viz_Table.from_view … has_actions=False`, as it has no `#` column
  and the action would hide its `at {{@column}}` link). A user type offers its
  own with `Viz_Actions.from (that:My_Type)`. The table view, scatter plot and
  tree preprocessors send them as an `"actions"` array first in their JSON
  (`Viz_Actions.add_to_json`; absent when there are none, never on an error);
  the Warnings preprocessor sends
  `{"warnings":[…],"actions":[remove_warnings]}`. The links of the table view
  stay in the view (its `link` and `index`): they are the view's own `Chain`
  actions.
- `Id` (`src/Id.enso`) - which visualisation a node opens with. `Id.from`
  answers it: any value gives `Id.table`, a `JS_Object` `Id.json`; a library
  picks another for its type with `Id.from (that:Its_Public_Type)` (Table: SQL
  Query for a database table; Image: `Id.Library "Standard.Image" "Image"`).
  `Id.Builtin name` is a visualization the GUI implements;
  `Id.Library library name` one a library ships in its `visualizations/` folder
  (`to_js_object`: `{"library": {"name": library}, "name": name}`; `library` is
  `<namespace>.<name>`, as `Standard.Image`). The GUI watches that folder of
  every loaded library and registers each `.vue` file it finds as
  `{ kind: 'Library', name: library }`, waiting up to 10 s for a library that is
  still loading; see `app/gui/src/project-view/stores/visualization/CLAUDE.md`.

Layering rule: Visualization imports only `Standard.Base`; Base knows nothing
about visualisation. Libraries (`Table`, `Database`, ...) import Visualization
and convert their values to its data types, so nothing here may import them.

Rule: conversions are on the public types (`Viz_Table.from (that:Table)`), and
an implementation raises `No_Such_Conversion` when it cannot supply a type.

How to add a chart: read `Viz_Table` (`Chart_Limits.local_rows` first); add a
data type only when the chart needs something a table cannot give.

## Table view message

`{"kind":"grid"|"value"|"error", …}`. A value is `{"kind":"value","value":c}`
with `c` one cell (below); an error is `{"kind":"error","error":text}`. A grid
has `columns` (`name`, optional `link` `{action, label}` where `label` names the
link column, optional `value_type` `{constructor, display_text}`, optional
`metrics` `[{name, value, type}]` with `type` one of `Text`/`Count`/`Percentage`
and `value` possibly `null`, `multi_filter`, `number_format`), column-major
`data`, optional `row_count`, `index` (the row-number column's link),
`version_hash`, `server` (`true` when the GUI pages rows from the engine; `data`
is then `null` and rows come as row pages) and `options` (`status_bar`,
`disable_sort_when_partial`). A link action is an explicit template:
`{{#field}}` (a number when it reads as one), `{{@field}}` (as it is),
`{{#index}}` (the row number). A cell is `null`, a boolean, a finite number,
text, or an object starting with `_display_text_`; `{"_missing_":true}` is a
cell its row lacks. A row page is `{"row_count","index","data"}`; distinct
values `{"values"}`. Changing it means regenerating the goldens and keeping the
GUI snapshot (`__tests__/tableViewSnapshot.test.ts`) unchanged.

## Things to avoid in generated code

- **Do not import `Standard.Visualization` in user code.** It is internal to the
  IDE; the JSON shape is not stable.
- Do not call `Preprocessor.*` or `*.process_to_json_text` — the IDE calls them
  on your behalf when a node is visualized.
- Do not depend on the JSON encoding produced; treat it as IDE-internal.

## Where to read more

- `src/Main.enso` and `src/Preprocessor.enso` — entry points.
- `test/Visualization_Tests/src/` — IDE-side regression tests.
