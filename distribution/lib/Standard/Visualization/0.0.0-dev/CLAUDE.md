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
    `{"root":…}` or `{"root":…,"children":<page>}`; `children` returns a page or
    `{"error":…}`. The goldens `test/Visualization_Tests/data/pinned/tree_*` pin
    it;
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
  `src/Internal/Names.enso`, `src/Internal/View_Json.enso` — the in-memory
  sources, name matching and view JSON behind `Viz_Table`. `View_Json` writes
  every table view (`grid_json`, `value_json`, `error_json`), and holds the
  views of the built-in values: `vector_view` (also arrays), `dictionary_view`,
  `hashset_view`, `js_object_view` and `value_view` (any other value). Libraries
  write their own with `Viz_Table.from_columns` or `from_view`.
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
- `Id` (`src/Id.enso`) - which visualisation a node opens with. `Id.from`
  answers it: any value gives `Id.table`, a `JS_Object` `Id.json`; a library
  picks another for its type with `Id.from (that:Its_Public_Type)` (Table: SQL
  Query for a database table; Image: Image).

Layering rule: Visualization imports only `Standard.Base`; Base knows nothing
about visualisation. Libraries (`Table`, `Database`, ...) import Visualization
and convert their values to its data types, so nothing here may import them.

Rule: conversions are on the public types (`Viz_Table.from (that:Table)`), and
an implementation raises `No_Such_Conversion` when it cannot supply a type.

How to add a chart: read `Viz_Table` (`Chart_Limits.local_rows` first); add a
data type only when the chart needs something a table cannot give.

## Things to avoid in generated code

- **Do not import `Standard.Visualization` in user code.** It is internal to the
  IDE; the JSON shape is not stable.
- Do not call `Preprocessor.*` or `*.process_to_json_text` — the IDE calls them
  on your behalf when a node is visualized.
- Do not depend on the JSON encoding produced; treat it as IDE-internal.

## Where to read more

- `src/Main.enso` and `src/Preprocessor.enso` — entry points.
- `test/Visualization_Tests/src/` — IDE-side regression tests.
