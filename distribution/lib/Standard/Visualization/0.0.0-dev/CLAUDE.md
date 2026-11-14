# Standard.Visualization

Preprocessors and helpers used by the Enso IDE to render values as charts,
tables, geo maps, etc. The IDE invokes these automatically — **user code should
not import this library**. The agent should not generate code that imports from
it either.

## Main entry points (IDE-facing only)

- `Preprocessor.default_preprocessor value` — IDE entry: encode an arbitrary
  value as JSON for visualization.
- `Geo_Map.process_to_json_text value` — IDE entry for the geo-map widget.
- `Scatter_Plot.process_to_json_text value` — IDE entry for the scatter-plot
  widget.

## Common usage

There is none for user code. The IDE calls these functions; user-defined
components and workflows should not.

## Layout

- `src/Preprocessor.enso` — default visualization preprocessor.
- `src/Helpers.enso` — display utilities (truncation, formatting, timing).
- `src/Internal/Columns_Source.enso`, `src/Internal/View_Source.enso`,
  `src/Internal/Names.enso`, `src/Internal/View_Json.enso` — the in-memory
  sources, name matching and view JSON behind `Viz_Table`.
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
