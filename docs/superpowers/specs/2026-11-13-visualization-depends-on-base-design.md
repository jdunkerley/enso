# Visualizations: data types and layering

## Intent

`Standard.Visualization` is the IDE's library of preprocessors: the Enso code
that turns a node's value into the JSON a visualisation in the graph editor
draws. Today the layering is upside down:

- **Base knows about visualisation.** `Base/Visualization/Table_Viz_Data.enso`
  is a Base type, and `JS_Object.to_default_visualization_data` is a Base
  method.
- **Visualization knows about every data library.** It imports `Standard.Table`
  and `Standard.Database` and switches on their types
  (`t : In_Memory_Table -> …`, `_ : DB_Table -> …`), so a new data library
  cannot get a chart without editing Visualization, and a new chart means a type
  switch across every data library.
- **Table depends on Visualization in secret.** `TableVizOperation.java:36`
  calls `Standard.Visualization.Table.Visualization.Helper.make_json` by name,
  which only resolves if something else has already loaded Visualization; a test
  without the import silently renders `"null"` cells.

This work makes visualisation an ordinary library in the middle of the stack:
Base knows nothing about it, Visualization depends only on Base, and every data
library that wants its values drawn depends on Visualization and converts to the
data types Visualization defines next to each standard visualisation. It is the
foundation for making visualisations more useful, so a new chart must be cheap
to add and must work for every value that can be shown as a table.

## Principles

These were settled before the design and everything below follows from them.

1. **Base knows nothing about visualisation.** Visualization depends only on
   Base. Other libraries may depend on Visualization.
2. **Each standard visualisation has a data type next to it, in Visualization.**
   A library makes its values drawable by defining a conversion to that type, in
   the module of its own type.
3. **Every value can be shown as a table.** Visualization defines the table data
   type and its conversions for Base's types; other libraries convert to it. The
   type supports slicing and operations, and a library may say an operation is
   not supported.
4. **Every value can be explored as a tree, two ways**: its `to_js_object`
   output (the JSON visualisation) and its true Enso structure (the Object
   visualisation), with one lazy, paged tree component in the GUI like a browser
   debugger's object inspector. _(Piece 2, own spec.)_
5. **Charts read from the table type.** Scatter, geo map, histogram and heatmap
   select the columns they need and read a bounded sample, so a database table
   is never read whole.
6. **The SQL viewer is driven the same way**: a SQL data type with methods,
   converted to by database tables and columns, doing what it does today.
7. **Any visualisation can add nodes**: chains, and static calls taking the
   node's value as an argument, not only a method on this node. Actions that
   depend on data come from Enso; actions that are purely gestures (a brush
   range, a map region) may be defined in the visualisation. _(Piece 3, own
   spec.)_
8. **Which visualisations a value offers is decided by its type**: a
   visualisation with a data type is offered when the value's type converts to
   that type.

## Pieces

| Piece | What                                                                               | Spec          |
| ----- | ---------------------------------------------------------------------------------- | ------------- |
| 1     | Data types, the dependency flip, charts on the table type, availability by type    | this document |
| 2     | Object and JSON explorer                                                           | to be written |
| 3     | Node actions from any visualisation                                                | to be written |
| 4     | Widgets query by method pointer; new projects drop `import Standard.Visualization` | to be written |

Pieces 2 and 3 depend on piece 1's dependency flip and not on each other. Piece
4 is independent of 2 and 3.

## Non-goals (piece 1)

- New charts. This makes them cheap; it does not add any.
- Removing `import Standard.Visualization` from new projects. That needs the
  widget queries changed first (piece 4): two of them compile
  `Standard.Visualization.Widgets.get_widget_json …` as text in the user's
  module (`widgetFunctionCallInfo.ts:152`, `formatForPath.ts:203`), which needs
  the import there, and `samples.test.ts` enforces it.
- Aggregation in the table type (database-side binning). The type is designed so
  it can be added later without breaking libraries.
- Changing what the Vue visualisations receive, except the histogram and heatmap
  bound below.

## Anti-goals

- **Reading a whole database table or column to draw a chart.** Today scatter
  and geo map read `..First 15000` and the table reads `max_rows`, but histogram
  calls `col.to_vector` on a database column and reads all of it
  (`Histogram.enso:28-32`), as does `Column.to_default_visualization_data`
  (`Helpers.enso:195`). After this work, no path does.
- **A silent change of default visualisation** for any type.
- **Two ways to do one thing.** The SQL type, the table type and every later
  data type use the same pattern (below); the table view's `{{#key}}` link
  mini-language survives piece 1 only as data carried through, and piece 3
  replaces it.

## Facts the design rests on

- **The engine loads Visualization on demand** when the IDE attaches a
  visualisation by module name (`UpsertVisualizationJob.scala:470-480`,
  `EnsoContext.ensureModuleIsLoaded`). Once the data libraries import
  Visualization it is loaded anyway whenever their values exist.
- **Conversion lookup** tries the source type's module, then the target type's,
  then the caller's module and its imports
  (`MethodResolutionAlgorithm.java:85-121`). A conversion defined next to its
  source type is found from anywhere.
- **"No conversion exists" is detectable**: `T.from v` raises a
  `No_Such_Conversion` panic, and the idiom
  `Panic.catch No_Such_Conversion (T.from v) handler` is already used
  (`Data_Link_Capabilities.enso:39`, `Table_Upload_Implementation.enso:27`). A
  dataflow error raised inside a conversion passes through untouched.
- **Tables are intersection values.** A table is `Table & In_Memory_Table`; a
  one-column table adds the column types, and a 1×1 one `& Integer`
  (`Table_Refinements.enso:18-35`); a database table is `Table & DB_Table`, plus
  `Spatial_Table` and the column types where they apply
  (`DB_Table_Refinements.enso`). A conversion tries only the value's **visible**
  types, in cast order with `Table` first, and each type's lookup falls back to
  `Any` (`InvokeConversionNode.java:198-227`, `UnresolvedConversion.java:65`).
  The implementation types are normally hidden, and nothing in Base can list
  hidden types. The spike (below) measured what this means.
- **Table and Column reach their implementation** through
  `self.implementation.<method> self.underlying`
  (`Table.Value underlying implementation`, `Table.enso:286`). The
  implementations are `In_Memory_Table_Implementation`,
  `DB_Table_Implementation` and their column counterparts, types with static
  methods, private to their libraries.
- **The IDE knows all of a value's types**: the type info it gets carries
  `visibleTypes` and `hiddenTypes` (`stores/visualization/index.ts:243-246`).
- **The IDE already lists a type's conversion targets**: the `to` widget scans
  the suggestion database for `from` methods whose `that` is the source type or
  `Any` (`WidgetAnyToTarget.vue:33-64`).
- **The default visualisation** is chosen by evaluating
  `a.default_visualization` in `Standard.Visualization.Helpers`
  (`visualizationData.ts:77`). A method defined in the value's own type's module
  is found from there.
- **Base's `Table_Viz_Data` is converted to by** Redshift (AWS), DuckDB, Excel,
  Google Sheets, SQL Server (Microsoft), Postgres, SQLite, Snowflake, Hyper
  (Tableau), XML (element and document), Base's own email `Send_Response`, and
  Visualization's catch-all `from (that:Any)`.

## The design (piece 1)

Names are working names; final ones are left to the builder.

### 1. The pattern every data type follows

A visualisation's data type is a Visualization type with **documented methods
that are the contract**. It wraps a value the library supplies (the library's
own object, or a small adapter type) and each method delegates to the same-named
method on it. An optional method has a default in the wrapper that reports "not
supported", so the contract can grow without breaking libraries that do not
implement the new part; the type also reports which optional methods its value
supports, so the GUI can hide controls rather than try and fail.

A library supplies the data type by a conversion,
`Viz_Table.from (that:My_Type) = …`, defined in `My_Type`'s module.

**Intersection types (proven by the spike):** a library defines every conversion
and `default_visualization` on its **public** type (`Table`, `Column`, `Row`)
and dispatches inside through the existing implementation idiom:

```
Viz_Table.from (that:Table) = that.implementation.to_viz_table that.underlying
SQL_Viz.from (that:Table) = that.implementation.to_sql_viz that.underlying
Table.default_visualization self = self.implementation.default_visualization self.underlying
```

Database supplies the database answers in `DB_Table_Implementation` and
`DB_Column_Implementation`, so Table never names a database type. An
implementation that cannot supply a data type (the in-memory table for
`SQL_Viz`) raises the `No_Such_Conversion` panic, which the preprocessor's
helper treats exactly like a missing conversion. Never define a conversion on
`In_Memory_Table`, `DB_Table`, `Spatial_Table` or another implementation or
refinement type: with an `Any` catch-all visible it is never reached, and
without one it is reached only after an explicit cast.

#### The spike

Run on a copy of the distribution built from `develop` on 2026-11-13, with a
Base-only library standing in for Visualization (imported by Table and
Database), and the conversion and `default_visualization` called from a
Base-only helper module, as the IDE does:

| Value                                    | On `Table`/`Column` via `implementation` | On `In_Memory_Table`, `Any` catch-all visible | On `DB_Table`, no catch-all                    |
| ---------------------------------------- | ---------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| in-memory table, 1-column, 1×1 `Integer` | `Table` → in-memory implementation ✔     | catch-all wins ✘                              | n/a                                            |
| in-memory column                         | `Column` → in-memory implementation ✔    | catch-all wins ✘                              | n/a                                            |
| database table, 1-column                 | `Table` → database implementation ✔      | catch-all wins ✘                              | not found ✘ (found only after `dt : DB_Table`) |
| database column                          | `Column` → database implementation ✔     | catch-all wins ✘                              | not found ✘                                    |
| vector, atom                             | catch-all ✔                              | catch-all ✔                                   | none ✔                                         |

A single-column table, which is also a `Column`, goes to the `Table` conversion,
not the `Column` one. `default_visualization` dispatches the same way as the
conversions. Inside the `Table` conversion `that` is narrowed to `Table`, so
implementation methods are reachable only through `that.implementation`, not by
calling them on `that`.

### 2. `Viz_Table`, the table data type

Required:

- `column_names`;
- `column_kinds`: per column, a kind from Visualization's own enum (numeric,
  text, boolean, date, date-time, time, other) **and** the library's display
  name for the type. Charts choose columns by kind; scatter's JSON carries the
  display name (today `x_value_type.to_name`), so it is unchanged;
- `row_count`, or `Nothing` when it is not cheap to know;
- `select_columns names` and `slice start count`, each returning a `Viz_Table`
  (lazy where the library is: a database stays a query);
- `read max_rows`, which materialises at most `max_rows` rows as column vectors.
  This is the only method that reads data, and it always has a bound.

Optional (default "not supported"):

- `sample n`: the library's own idea of a quick sample. The in-memory table uses
  its current `..Sample`, a database table its current `..First n`, so the rows
  charts show are the rows they show today;
- `sort`, `filter`, `distinct_values column limit`: what the table view's
  server-side row model needs (`get_rows_for_table`,
  `get_distinct_values_for_column`, `apply_sort_to_table`,
  `apply_filter_to_table`, called from `TableVisualization.vue:480,528`). Sort
  and filter take Visualization's own description, translated from the grid's
  model, not Table's `Sort_Column` or filter types;
- `supported_operations`, listing which of these the value supports.

Carried through unchanged for now: the per-column link metadata
(`get_child_node_action`, `child_label`, `visualization_header`) that the table
view turns into child nodes. Piece 3 replaces it.

**In-memory implementation.** Visualization ships one implementation of the
whole contract over plain vectors. Every Base conversion uses it, and so can any
library that only has rows in memory (workbooks, connections listing their
tables, XML).

**Conversions:**

| Source                                                                          | Where                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Vector`, `Array`, `Dictionary`, `Hashset`, `JS_Object`, `Text`, any other atom | Visualization                                                       |
| Email `Send_Response`                                                           | Visualization (Base can't)                                          |
| `Any`: one cell, as `_make_json_for_other` today                                | Visualization                                                       |
| `Table`, `Column`, `Row` (in-memory and database, by implementation)            | Table, dispatching to Database's implementation for database values |
| Connections, workbooks, Hyper files, XML                                        | each library, as today                                              |
| Image's `Histogram` (one column of its values, as `value.to_vector` today)      | Image                                                               |

Each conversion body is the code in today's `Table_Viz_Data.from` or the
matching `case … of` branch in Visualization, moved, not rewritten, so the table
view's JSON for every source is unchanged. Because `Viz_Table.from (that:Any)`
exists, every value offers the table view.

### 3. `SQL_Viz`, the SQL data type

The SQL text and its interpolations, rendering the JSON `SQLVisualization.vue`
gets today. By the rule in §1 the conversion is on `Table` and `Column`; the
database implementations answer and the in-memory ones raise
`No_Such_Conversion`. No fallback: the SQL preprocessor shows its unsupported
state for a value with no SQL.

### 4. Charts

| Chart     | Reads                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| Table     | `Viz_Table`, as today                                                                           |
| Scatter   | `Viz_Table` → select its columns → `sample 15000` (or `slice 0 15000` where unsupported)        |
| Geo map   | the same, choosing latitude and longitude columns as today                                      |
| Histogram | `Viz_Table` → select its column → bounded sample. **Output changes** for values over the bound. |
| Heatmap   | `Viz_Table` → bounded read                                                                      |
| SQL       | `SQL_Viz`                                                                                       |

The histogram and heatmap bound is new: it changes their output only for tables
over the bound, and it is also a speed fix (today a million-row column reaches
the GUI as a million-element JSON array). When aggregation is added to the
contract, histogram moves to it and becomes exact for any size.

Each chart's preprocessor converts once (`Panic.catch No_Such_Conversion`) and
shows its existing empty or unsupported state when no conversion exists; it
never catches an error raised inside a conversion.

### 5. What moves, what goes

- **Base:** `Base/Visualization/Table_Viz_Data.enso` and
  `JS_Object.to_default_visualization_data` are deleted (the latter becomes a
  Visualization extension method). `Send_Response`'s conversion moves to
  Visualization.
- **Visualization:** drops every `Standard.Table` and `Standard.Database`
  import. `Id` stays here. The extension methods on Base types (`Any`, `Vector`,
  `Array`, `Text`, `Nothing`, `Error`, `JS_Object`) stay; those on Table's types
  move into Table as ordinary methods (`default_visualization`,
  `to_default_visualization_data` for `Table`, `Column`, `Row`), returning
  Visualization's `Id`. The table view's server-side row model functions keep
  their module paths and names (the IDE calls them) but become thin: convert to
  `Viz_Table`, call the contract.
- **Cell rendering:** `Helper.make_json` stays in Visualization, without its
  Table and Database branches (a table in a cell renders through its display
  text or a `Viz_Table` summary). Table's Java callback keeps calling it by
  name; it is now safe, because Table imports Visualization.
- **Deleted, unused:** `Table.to_lazy_visualization_data`, the lazy table
  helpers in `Visualization/src/Table.enso` and the lazy text code they use.
  Nothing in the IDE calls them; `Lazy_Text_Spec` and `Lazy_Table_Spec` go with
  them.
- **Libraries** that converted to Base's `Table_Viz_Data` import Visualization
  and convert to `Viz_Table`: Table, Database, AWS, DuckDB, Excel, Google,
  Microsoft, Postgres, SQLite, Snowflake, Tableau, XML, and Image (for its
  `Histogram`).
- `Standard.Visualization`'s `Main.enso` keeps exporting every name it exports
  today.

### 6. Availability in the IDE

A Vue visualisation that has a data type names that type instead of a list of
input types. The IDE offers it for a value when any of the value's types
(visible and hidden) has a `from` conversion to it in the suggestion database,
or an `Any` conversion exists (the same scan as the `to` widget, shared). So
Table is offered for everything, and scatter, geo map, histogram and heatmap for
anything that converts to `Viz_Table`, which is everything. A chart with nothing
suitable to draw (no numeric columns) shows its empty state with a reason.

**The SQL view is the exception and keeps its static `inputType`**
(`DB_Table | DB_Column`, matched against hidden types as today). Its conversion
has to sit on `Table` (§1), so a pure by-type rule would offer it for every
in-memory table and then say "not available". Keeping the static type changes
nothing users see. The rule for any future visualisation like it: when only some
implementations of a public type can supply the data type, the visualisation
names the implementation types statically. See open question 1 for the engine
change that would remove the exception.

Visualisations without a data type (image, warnings, loading error, and JSON
until piece 2) keep their static `inputType`.

The default is unchanged: `default_visualization`, defined by each type on its
public type, falling back to `Any.default_visualization` (the table view).

### 7. Keeping the layering true

A note in `Visualization/0.0.0-dev/CLAUDE.md` and
`distribution/lib/Standard/CLAUDE.md`: Base knows nothing about visualisation;
Visualization imports only Base; data reaches a visualisation through a
conversion to its data type, defined next to the source type; how to add a chart
(read `Viz_Table`; add a data type only when the chart needs something a table
cannot give). A grep over Visualization's sources for `Standard.` imports other
than Base, and over Base's for `Visualization`, is the check.

## Delivery (piece 1)

Each step leaves every visualisation working.

0. **Spike. Done 2026-11-13**, results in §1. The rule held for every value
   shape. The spike also found that implementation-type conversions are
   unreachable without a catch-all as well as with one, which moved the SQL
   conversion onto `Table` and produced the SQL availability exception (§6).
1. **Pin the current JSON.** Specs for every chart × source pair that has none
   today, so every later step is checked against today's behaviour.
2. **The types.** `Viz_Table` with its in-memory implementation, and `SQL_Viz`,
   in Visualization, with their specs. Nothing uses them yet.
3. **The flip.** Libraries import Visualization and convert to `Viz_Table`;
   Base's `Table_Viz_Data` deleted; Table's methods moved; the table view on
   `Viz_Table`; the lazy code deleted.
4. **The charts.** Scatter, geo map, histogram (with its bound and a spec of the
   change), heatmap on `Viz_Table`; SQL on `SQL_Viz`; Visualization's last Table
   and Database imports deleted.
5. **Availability by type** in the GUI.

## Verification

- `Visualization_Tests`, `Table_Tests`, `Base_Tests`, `XML_Tests` and at least
  one database test project (DuckDB or SQLite) pass.
- Every chart's JSON for every source type is unchanged, against the specs from
  step 1, except histogram and heatmap above the bound, which have their own
  spec.
- A database spec shows each chart reads a bounded number of rows.
- A Table test without `import Standard.Visualization` renders real cells, not
  `"null"`.
- The layering grep finds nothing.
- `stdlib-api-check` passes with the regenerated `docs/api` for Base,
  Visualization and every library whose conversions moved.
- In the IDE: a Table, a DuckDB table, a Vector and an atom each offer the
  expected visualisations and show the table, scatter, geo map, histogram and
  SQL views. Manual unless the builder finds a cheap automated check.

## Left to the builder

- Final names of the types, the column-kind enum and the contract methods.
- The sort and filter description the contract takes.
- The histogram and heatmap bound (15000, as scatter, unless there is a reason
  not to).
- Whether the layering grep goes into CI.
- Changelog: the histogram bound is a visible change, so step 4 takes an entry;
  the other steps take `CI: No changelog needed` unless a chart newly works for
  a data type.

## Open questions for the owner

Decided overnight on the conservative side; each can be revisited without
changing the rest of the design.

1. **Should conversions also try a value's hidden types?** The engine tries only
   visible types (`InvokeConversionNode.doMultiValue` uses
   `findAllTypesOrNull(that, false)`), which is why every conversion must sit on
   the public type and the SQL view keeps a static input type. Trying hidden
   types after visible ones would let `SQL_Viz.from (that:DB_Table)` work and
   make availability purely by type. It is a language-semantics change with
   reach well beyond visualisation, so this design does not depend on it.
   Recommendation: no, not as part of this work.

## Changed while planning

Found while writing the piece 1 plan
(`docs/superpowers/plans/2026-11-14-visualization-data-types-piece1.md`,
2026-11-14). Each keeps today's JSON; the plan's golden files check it.

1. **`Viz_Table` has a required `table_view_json max_rows`.** The table view
   draws many JSON shapes today (Vector, Matrix, Object_Matrix, Map,
   Generic_Grid, Error, Table's Java-rendered JSON, Row and Dictionary maps with
   their `get_child_node_action` templates). Each source renders its own, moved
   as-is; `Viz_Table.from_view` covers values that have only a table view (no
   columns), `Viz_Table.from_columns` the in-memory grids that Base's
   `Table_Viz_Data.GenericGrid` produced.
2. **The contract's operations are grouped as capabilities** listed by
   `supported_operations`: required `column_names`, `column_kinds`, `row_count`,
   `select_columns`, `slice`, `sample`; `"rows"` (`rename_columns`,
   `add_row_number`, `filter_between`, `rows_json`, `column_values`), which
   replaces `read`, so the charts' row work runs on the library's own table
   operations and renders the same JSON; `"server_rows"` (the table view's
   server-side row model, which is how the sort, filter and distinct values of
   decision B reach the IDE); `"spatial"` (the geo map's layers for a spatial
   database table). A chart takes a bounded `sample` first when the source does
   not support `"rows"`, which is what bounds every database read.
3. **Base values keep their chart paths.** Scatter on a `Vector`/`Array`,
   histogram on a `Vector`, and the geo map and charts on a value with no
   columns keep `develop`'s code; only values that convert to a `Viz_Table` with
   columns go through it. Image's `Histogram` needs no conversion (its path is
   unchanged), so Image is not among the libraries that depend on Visualization.
4. **Cells:** `Viz_Cell` (data type, `render level` and record `pairs`),
   converted to by Table's `Table`, `Column` and `Row`, keeps the cell JSON of
   tables, columns and rows inside cells. `develop`'s `DB_Table{…}` and
   `DB_Column{…}` cell branches are unreachable (a database table matches
   `Table` first), so they are dropped without a change in output.
5. **Heatmap needs no change:** it uses the table view's preprocessor, already
   bounded at 1000 rows. **Neither Histogram nor Heatmap is registered in the
   GUI** (`stores/visualization/index.ts` builtins), so the histogram bound is
   invisible to users: step 4 takes `CI: No changelog needed`, and step 5 (the
   picker) takes the changelog entry.
6. **Lazy text stays.** `Text.to_default_visualization_data` uses the lazy text
   window, so only the lazy **table** code is deleted.
7. **The geo map keeps reading an in-memory table whole**, as today; only a
   database table is sampled (first 15000 rows, as today).
8. **Availability: an `Any` conversion does not offer a chart.** Every value
   converts to `Viz_Table` through the catch-all, so counting it would offer
   scatter and geo map for every value. A chart is offered when one of the
   value's types has its own conversion; the table view keeps its static `Any`
   input type.
9. **Step 3 has a temporary library cycle** (Table imports Visualization while
   Visualization's chart modules still import Table). It resolves at run time
   (tested on a distribution, 2026-11-14); step 4 removes it.

10. **A source without `"rows"` shows the chart's empty state.**
    `Viz_Table.from_columns` and `from_view` sources (connections, workbooks,
    Hyper files, XML, a `Send_Response`) supply the required part of the
    contract only. After `Chart_Limits.local_rows`, a scatter plot or geo map
    whose source still lacks `"rows"` returns its existing empty JSON (the "At
    least one numeric" message, `{}`) instead of raising `Viz_Unsupported`.
11. **The geo map's JSON changes for values with columns that are not tables.**
    On `develop` only `Spatial_Table`, `DB_Table` and `In_Memory_Table` take the
    table path and everything else gets `value.to_json`; now any value with
    columns does (an in-memory or database column, a connection, a workbook).
    The plan pins the old output (`geo_mem_column`, `geo_db_column`,
    `geo_connection`) and regenerates those three files in the step that changes
    it. The GUI geo map's `inputType` is `Standard.Table.Table.Table` today, so
    these values never reached it in the IDE.
12. **Widgets may keep their Table and Database imports until piece 4.**
    `Widgets.enso` imports both. The plan tries to drop them (Task 4.4); if a
    widget spec fails without them, `Widgets.enso` keeps them as the one
    exception to the layering rule, until piece 4 moves the widgets, and the
    layering grep excludes it.
13. **The conversion index is not shared with `WidgetAnyToTarget`.** Spec §6
    says "the same scan as the `to` widget, shared". The plan adds
    `SuggestionDb.conversionSources` for the visualization picker and leaves
    `WidgetAnyToTarget.vue`'s linear scan alone; sharing it is left to piece 4.

## Decided at review (2026-11-14)

- **Histogram and Heatmap are deleted** (a new step 0), not moved onto
  `Viz_Table`: neither is registered in the GUI. This supersedes the histogram
  and heatmap rows in §4 and note 5 above. Image's `Histogram` data type stays.
- **Spatial geo maps** stay as they are, without a golden file; they are
  addressed later.
- Golden changes made on purpose. `geo_mem_table_nothing_known` changed: develop
  filled every role with a placeholder all-"X" column when the table had a
  column named `x`. `geo_mem_column`, `geo_db_column` and `geo_connection`
  changed: columns and connections now take the table path and give `{}`.
- Steps 4 and 5 otherwise as planned; step 5 keeps the changelog entry.
