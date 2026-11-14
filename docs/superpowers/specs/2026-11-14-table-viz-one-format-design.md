# One data format for the table visualisation (spec B)

Follow-up to piece 1 of the visualisation layering work
(`2026-11-13-visualization-depends-on-base-design.md`) and to spec A
(`2026-11-14-viz-id-conversion-and-viz-json-design.md`). Today the table
visualisation receives twelve JSON shapes from as many producers, written in
Java and Enso, and the GUI tells them apart by a `type` field for three of them
and by which fields are present for the rest. This spec replaces them with one
format, written by one writer.

## Intent

- Every value renders **exactly as it does today**: the same columns, link
  columns, index column, tooltips, metrics, filters and row data. Only the wire
  format, the producers and the GUI parser change. (Owner decision, 2026-11-14.)
- One format for all three table viz messages: the view, the server-side row
  page, and the column filter's distinct values.
- One writer, in `Standard.Visualization`. Libraries supply data through
  `Viz_Table` sources; Java supplies the bulk pieces where speed needs it.
- Fixes only outright bugs: a database read error shows as an error, not an
  empty grid.

## Facts (2026-11-14, `develop` at 930830bb83)

The full inventory is in the session map behind this spec; the parts that shape
the design:

- **Shapes.** S1 `{"type":"Error","error"}`; S1b a database read error
  `{"error"}` with no `type` (rendered as an empty grid); S2 `EnsoTableOrColumn`
  (in-memory and database tables and columns, written in Java by
  `TableVizOperation.makeJSON`); S5 `Generic_Grid` (connections, Excel and
  Google workbooks, Hyper files, `Send_Response`); S6 `Matrix`; S7
  `Object_Matrix`; S8 `Vector`; S9 `Map` (Dictionary, Hashset, JS_Object, Row,
  each with different extras); S10 XML; S11 a single value. Also S3, the server
  row page `{"rows","row_count"}`, and S4, distinct values `{"distinct_vals"}`
  (made valid JSON by #757).
- **Inconsistencies.** Column-major `data` (S2, S5, S9, S10) against row-major
  `json` (S6–S8). Links four ways: `get_child_node_action` with
  `get_child_node_link_name` (S9, S10), per-header actions (S5), an index column
  (S2, S6–S8), and `links` (S11, ignored by the GUI). Row counts as
  `all_rows_count`, `row_count`, or absent. Dates in Java order
  (`type, constructor, _display_text_`), in Enso order (`_display_text_` first),
  or without display text (S4, `Decimal` from Java). `Generic_Grid` cells skip
  `Viz_Cell.render_value`.
- **GUI.** `TableVisualization.vue` `refresh()` dispatches on shape; eight
  TypeScript interfaces declare fields no producer sends and miss fields some
  do. A bare link action (`"at"`) is completed by the GUI by quoting the link
  column's value (`at "x"`); a template uses `{{#field}}` (raw) or `{{@field}}`
  (quoted).
- **Performance spike** (2026-11-14, throwaway; report `spike-enso-view-json.md`
  in the session scratchpad). An Enso writer reproducing S2 byte for byte,
  against Java's `tableVizJSON`, warm medians:

  | Case                   | Java    | Enso, metrics read in Enso | Enso, Java metrics piece |
  | ---------------------- | ------- | -------------------------- | ------------------------ |
  | 50×50, data inline     | 1.66 ms | 3.72 ms                    | 1.08 ms                  |
  | 1M×20, server mode     | 0.46 ms | 2.07 ms                    | 0.50 ms                  |
  | 10×1000                | 10.1 ms | 17.0 ms                    | 10.9 ms                  |
  | 1×2500                 | 38.8 ms | 66.1 ms                    | 41.5 ms                  |
  | 1000×50, database mode | 1.16 ms | 1.26 ms                    | 0.86 ms                  |

  The cost is reading every metric of every column in Enso; joining strings is
  not. With Java returning the metrics as one piece and the cells per column
  (`makeJSONForColumn`, which exists), Enso matches Java. The display type
  (`value_type.to_display_text`, ~0.6 ms at 50 columns, 6–13 ms at 1000) runs
  before Java's version cache is consulted today; a version-keyed Enso cache
  above it makes a repeat view ~0.02 ms. Java's metrics and cell caches hold
  1000 columns, so wider tables get racy metrics today (unchanged here).

## Design

### 1. The view message

```json
{
  "kind": "grid",
  "row_count": 1234,
  "columns": [
    {
      "name": "x",
      "value_type": {
        "constructor": "Integer",
        "display_text": "Integer (64 bits)"
      },
      "link": { "action": "at {{#key}}", "label": "value" },
      "metrics": [{ "name": "…", "values": [], "type": "Count" }],
      "multi_filter": true,
      "number_format": true
    }
  ],
  "index": { "label": "row", "action": "get_row {{#index}}" },
  "data": [[1, 2, 3]],
  "server": { "version_hash": "…" },
  "options": { "status_bar": true, "create_node": true }
}
```

- `kind`: `"grid"`, `"value"` (one value: `"value": <cell>`) or `"error"`
  (`"error": "<message>"`). `"error"` replaces S1 and S1b.
- `row_count`: the number of rows the value has (not the number sent).
- `columns`: every field but `name` is optional. `link` makes the column a link
  column; `label` is the tooltip noun ("Double click to view this value…",
  default "value"). `metrics`, `multi_filter`, `number_format`, `value_type`
  carry what S2 sends per column today.
- `index`: present when the view has the row-number column (S2, S6–S8); its
  action is the link on it.
- `data`: column-major, one array per entry of `columns` (the index column is
  not sent; the GUI numbers rows as today). `null` when `server` is present.
- `server`: present when the server sorts, filters and pages (today's
  `is_using_server_sort_and_filter`); `version_hash` as today.
- `options`: today's `use_bottom_status_bar` and `enable_create_node`.
- **Link templates are always explicit**: `{{#field}}` inserts the field's value
  raw, `{{@field}}` quoted; `#index` is the row number. The GUI no longer
  completes a bare action. Each producer writes the template that yields the
  node today's GUI makes for it (`getAstPattern`'s completion of a bare action,
  read off when the plan is written), so the created nodes do not change.

How today's shapes map:

| Today                 | Becomes                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| S2 table / column     | grid with `index` (`get_row` / `at`), per-column metrics, `server` when paged          |
| S6 Matrix, S8 Vector  | grid with `index` (`at {{#index}}`), columns `0…n` / `Value`                           |
| S7 Object_Matrix      | grid with `index`, one column per key                                                  |
| S9 Dictionary         | grid `key`, `value`; `key` links `at {{#key}}`, label `value`                          |
| S9 Row                | grid `column`, `value`; `column` links `at {{@column}}`                                |
| S9 JS_Object, Hashset | grid `key`, `value` / `key`; no link                                                   |
| S10 XML               | grid `key`, `type`, `value`; `key` links `get_child_element {{#key}}` / `get {{#key}}` |
| S5 Generic_Grid       | grid; each linked column carries its own `link`                                        |
| S11 single value      | `kind: "value"`                                                                        |
| S1, S1b               | `kind: "error"`                                                                        |

Examples, from today's goldens:

```json
{
  "kind": "grid",
  "row_count": 4,
  "columns": [
    { "name": "column", "link": { "action": "at {{@column}}" } },
    { "name": "value" }
  ],
  "data": [
    ["x", "y", "label", "when"],
    [
      2,
      5.5,
      "b",
      {
        "_display_text_": "2021-02-02",
        "type": "Date",
        "constructor": "new",
        "day": 2,
        "month": 2,
        "year": 2021
      }
    ]
  ]
}
```

```json
{
  "kind": "grid",
  "row_count": 2,
  "columns": [
    { "name": "key", "link": { "action": "at {{#key}}", "label": "value" } },
    { "name": "value" }
  ],
  "data": [
    ["a", "b"],
    [1, "[1, 2]"]
  ]
}
```

### 2. Cells

One encoding everywhere (view, row page, distinct values): `null`, booleans,
finite numbers and text plain; anything else an object whose first field is
`_display_text_`, then `type` and the value's fields: dates and times, decimals
(which gain a display text from Java), big integers, NaN and infinities, nested
values (`Viz_Cell.render_value` as today). Java's cell writer (`JsonOperation`
with display text) is brought to the same field order as `Viz_Cell`.
`Generic_Grid`'s cells go through `Viz_Cell.render_value` like every other shape
(the visible text is the same; the snapshot check in §6 confirms).

### 3. The other two messages

- Server row page: `{"row_count": N, "start": S, "data": [[…], …]}`,
  column-major with the same cells; the row numbers are `start + i`, so the
  index array is no longer sent.
- Distinct values: `{"values": [cell, …]}`.

### 4. The writer

- One writer in Visualization (`Internal/View_Json.enso` grows into it) builds
  all three messages from a `Viz_Table` (piece 1's contract): names, kinds,
  `row_count`, `select_columns`/`slice`, and the capabilities.
- A source may supply bulk pieces as optional methods, which the writer uses
  when present: `column_cells_json name start count -> Text` (a JSON array) and
  `column_metrics_json -> Vector Text` (one JSON fragment per column). The
  in-memory source implements both through Java; other sources leave them out
  and the writer renders cells with `Viz_Cell.render_value`.
- **Performance rules** (from the spike): Enso never loops per cell or per
  metric key; it loops per column and joins with `Vector.join`. The finished
  view is cached by table version above the display-type computation
  (`TableValueCache` pattern), and not cached while any column's metrics are
  incomplete.
- Java: `TableVizOperation.makeJSON` (the whole-view writer) is deleted. Added:
  one call returning each column's metrics JSON and an "any incomplete" flag.
  Kept: `makeJSONForColumn`, the version id, the metrics computation.
- Every producer moves onto the writer: in-memory and database sources (the
  database read error becomes `kind: "error"`), `Viz_Table.from_columns`
  (`Generic_Grid` users unchanged: they already build a `Viz_Table`), and the
  vector, matrix, dictionary, JS_Object, Row and XML views (today's `View_Json`
  and `Viz_Helpers` functions).

### 5. GUI

- One zod schema for the three messages replaces the eight interfaces; one path
  in `refresh()` builds column definitions and rows.
- A message that fails the schema shows the error state with the zod message.
- The Playwright mocks (`tableVisualisation.spec.ts`, `codeFont.spec.ts`,
  `lsHandler.ts`, `table-vis-json/*.json`) are rewritten in the new format;
  their assertions stay.

### 6. Proof that views do not change

1. Before anything changes, a GUI unit test feeds each of today's goldens
   (`table_*`, `ssrm_*`, the distinct values) through today's `refresh()` logic
   and snapshots what AG Grid would receive: column definitions (names, link
   columns, tooltips, filters, index column) and rows.
2. After the change, the regenerated goldens through the new parser must give
   **identical** snapshots. A difference is a visible change and needs a
   recorded reason in the PR.

## Delivery

1. **B0**: the snapshot tests over today's goldens. Invisible;
   `CI: No changelog needed`; merges on green.
2. **B1**: the switch, one PR (the wire changes on both sides at once): the
   writer, the Java metrics piece and the deletion of `makeJSON`, every
   producer, the row page and distinct values, the zod parser, the Playwright
   mocks, the regenerated goldens. The plan splits it into tasks on one branch,
   with the snapshot test as the gate. Changelog: none, except a fix line for
   the database read error now showing.
3. **B2**: delete the dead parts: the old TypeScript interfaces,
   `Default_Visualizations_Spec` (it guards a file deleted long ago), the
   `Standard.Base.Data.Map.Map` input type, and anything left unused in Java.

## Verification

- B0's snapshots equal after B1 (the gate).
- Goldens: every `table_*` and `ssrm_*` file regenerated in the new format;
  `scatter_*`, `geo_*`, `sql_*`, `default_*`, `data_*` unchanged.
- Performance: a benchmark test (not a gate in CI) repeats the spike's cases and
  records the times in the PR; each must be within 10% of develop's Java path or
  faster.
- `-Werror` lint, `stdlib-api-check`, GUI typecheck, lint, unit and Playwright
  tests.
- Installer check: an in-memory table (paged and not), a database table, a
  Dictionary, a Row, a vector of vectors, an XML document, a connection and an
  Excel workbook look and behave as before (links, sort, filter, distinct
  values, create node).

## Non-goals

- Changing what any view shows (owner decision).
- The actions model (piece 3): links and the index action stay as templates
  here; piece 3 turns them into references to Enso-described actions.
- Raising the 1000-column cache limit in Java.
