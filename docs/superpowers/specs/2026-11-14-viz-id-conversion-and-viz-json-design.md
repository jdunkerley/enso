# Default visualisation by conversion, and `Viz_Json`

Follow-up to piece 1 of the visualisation layering work
(`2026-11-13-visualization-depends-on-base-design.md`, PRs #744–#751). Piece 1
moved the visualisations onto data types in `Standard.Visualization` that
libraries convert to. Two older extension points still use methods instead:
`default_visualization` (which visualisation a node opens with) and
`to_default_visualization_data` (what the JSON visualisation receives). This
spec moves both onto conversions, in the same pattern.

A second spec will replace the table visualisation's many JSON shapes with one
format; it is out of scope here.

## Intent

- A library says how its values are visualised only by defining conversions to
  Visualization's types, in the module of its own public type. No extension
  methods for visualisation remain.
- The JSON visualisation keeps receiving bounded data for large values.
- Nothing a user sees changes, except that an Image node now opens in the Image
  visualisation instead of the table.

## Facts (2026-11-14, `develop` at cae28b6d05)

- The IDE evaluates `a -> a.default_visualization.to_js_object.to_json` in
  module `Standard.Visualization.Helpers` when a node has no selected
  visualisation
  (`app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts:77`).
  The result outranks matching by type; on error the GUI matches by type.
- Definitions: `Any` → Table and `JS_Object` → JSON (Visualization
  `Helpers.enso`); `Vector`, `Array` → Table (`Helpers.enso`, redundant);
  `Table` → its implementation (in-memory Table, database SQL Query); `Column`,
  `Row` → Table (redundant). Only `JS_Object` and a database table differ from
  the `Any` answer. Image has none, so an Image node opens as a table.
- `Id.Library` / `Id.from_module` are never produced, and the GUI cannot load a
  library visualisation id (`stores/visualization/index.ts`, "not yet
  implemented").
- `default_preprocessor x` (`Visualization/src/Preprocessor.enso`) calls
  `x.to_default_visualization_data`. It is the preprocessor of the JSON and
  Image visualisations and of custom visualisations that declare none, and the
  GUI's initial preprocessor. Definitions: `Any` → `to_json` (with a
  `_to_js_object_error_` fallback), `Nothing`, `Error`, `JS_Object`, `Vector`
  and `Array` (depth 5, 100 items), `Text` (lazy-text chunks over 2000
  characters), `Table` (first 10 rows:
  `{"number_of_rows", "columns":[{"name", "data"}]}`), `Column` (first 100
  values: `{"length","name","data"}`), `Row` (its vector), `XML_Document`,
  `XML_Element`.
- The lazy-text path (`to_lazy_visualization_data`,
  `make_lazy_visualization_data`, `Preprocessor.lazy_preprocessor`,
  `Visualization/src/Text.enso`) has no GUI consumer.
- An in-memory `Table.to_js_object` builds an object per row (unbounded); a
  database table's is its SQL.
- Conversion lookup tries, for each of the value's visible types then `Any`: the
  source type's module, the target type's module, the calling module, its
  imports. So `Id.from`/`Viz_Json.from` for Base types live in the target module
  (Visualization), and for Table/Column/Row in Table's modules on the public
  types (implementation types are hidden; piece 1's spike).

## Design

### 1. `Id.from` replaces `default_visualization`

- `Visualization/src/Id.enso` defines `Id.from (that:Any) = Id.table` and
  `Id.from (that:JS_Object) = Id.json`.
- Table defines
  `Id.from (that:Table) = that.implementation.default_viz_id that.underlying`
  (renaming the implementations' `default_visualization`): in-memory →
  `Id.table`, database → `Id.sql_query`. No `Column` or `Row` conversion: the
  `Any` answer is the same.
- Image defines `Id.from (that:Image) = Id.image` in its own module. Image
  thereby imports Visualization (allowed: other libraries depend on
  Visualization, not Base).
- Deleted: every `default_visualization` method (Visualization's `Helpers`,
  Table, Column, Row, both implementations), `Id.Library` and `Id.from_module`
  (and their `to_js_object` branch: `library` is always `null`, kept in the JSON
  so the GUI parser is unchanged).
- The GUI evaluates `a -> (Id.from a).to_js_object.to_json` in
  `Standard.Visualization.Helpers` (still imports `Id`). The engine test
  `RuntimeVisualizationsTest.scala` ("be able to use external libraries…")
  changes to the same expression.
- A user type picks its default with `Id.from (that:My_Type) = Id.json` in its
  own module. No compatibility shim (no external users).

### 2. `Viz_Json` replaces `to_default_visualization_data`

- New `Visualization/src/Viz_Json.enso`: `type Viz_Json` with
  `Value json_text:Text` — the JSON the JSON visualisation receives. Base
  conversions in the same module, reproducing today's output:
  - `Any` → `to_json`, with today's `{"value", "_to_js_object_error_"}` fallback
    when `to_js_object` panics;
  - `Nothing` → `{"type": "Nothing"}`;
  - `JS_Object` → `render`;
  - `Vector`, `Array` → today's `render_vector` (depth 5, 100 items, leaves
    through `Viz_Json.from`);
  - `Text` → `to_json` up to 2000 characters; a longer text is cut to its first
    2000 characters plus `…` (today it becomes a lazy-text chunk object that no
    viewer understands; this is the one output change, unpinned today).
- Table defines `Viz_Json.from (that:Table)` (first 10 rows, today's shape;
  database tables read 10 rows) and `Viz_Json.from (that:Column)` (first 100
  values) on the public types, and `Viz_Json.from (that:Row)` (its vector). XML
  defines conversions for `XML_Document` and `XML_Element` (today's tree JSON).
- `default_preprocessor x` becomes `(Viz_Json.from x).json_text`; a dataflow
  error is caught first, as `Error.to_default_visualization_data` does today,
  and the display-text fallback on failure stays.
- Deleted: every `to_default_visualization_data` method, the lazy-text path
  listed in Facts, and the dead statement at `Table/src/Table.enso:3994`.
- Piece 2 (the lazy JSON and Object explorer) builds on `Viz_Json` instead of
  replacing a method.

### 3. Side effects checked

- The GUI's conversion index (`suggestionDb.conversionSources`) gains `Id` and
  `Viz_Json` entries. Only visualisations that declare a `dataType` consult it,
  and none declares `Id` or `Viz_Json`, so the picker is unchanged.
  `WidgetAnyToTarget` lists conversion targets for a widget's expected type;
  `Id` and `Viz_Json` appear only where a parameter expects those types (none in
  user-facing APIs).
- The component browser already hides all of `Standard.Visualization`.

## Delivery

Two PRs, each its own branch from `develop`:

1. **Id conversion** — Visualization, Table, Database, Image, the GUI
   expression, the engine test, API docs, guides. Changelog entry (Image nodes
   open in the Image visualisation).
2. **Viz_Json** — Visualization, Table, Database, XML, deletions, API docs,
   guides. `CI: No changelog needed`.

## Verification

- Goldens: `Pinned_Spec`'s `default_*` cases switch to
  `(Id.from value).to_js_object.to_json` and stay unchanged; a new
  `default_image` golden pins `{"library":null,"name":"Image"}`. The `data_*`
  cases switch to `Preprocessor.default_preprocessor` and stay unchanged; new
  goldens pin `data_long_text` (the cut text), `data_nothing`, `data_error`,
  `data_xml_document` and `data_vector_deep` (depth and item bounds) — the last
  four generated on `develop` first.
- `Id_Spec`, `Helpers_Spec`, `Table_Conversions_Spec` move to the conversions.
- Layering grep: no `default_visualization` or `to_default_visualization_data`
  left in `distribution/`, `app/gui/src`, `engine/` (`git grep`).
- `-Werror` lint, `stdlib-api-check`, `check-workflows` (Image's `dependsOn`
  gains Visualization).
- GUI: the `visualizationData` unit tests and typecheck/lint.
- Installer check (PR 1): an Image node opens in the Image visualisation; a
  table, a database table (SQL Query) and a `JS_Object` (JSON) open as before.

## Non-goals

- The table visualisation's formats (next spec).
- Making the JSON visualisation lazy or explorable (piece 2).
- Library (non-builtin) visualisation ids: the GUI cannot load them today.
