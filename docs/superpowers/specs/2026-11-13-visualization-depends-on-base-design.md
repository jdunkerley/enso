# Visualization depends only on Base

## Intent

`Standard.Visualization` is the IDE's library of preprocessors: the Enso code
that turns a node's value into the JSON a chart in the graph editor draws. It
currently imports `Standard.Table` and `Standard.Database` and switches on their
types (`t : In_Memory_Table -> …`, `_ : DB_Table -> …`). That has three costs:

- **Layering.** A library that sits above Base knows about every data library. A
  new data library cannot get a visualisation without editing Visualization.
- **Scripts.** Every new project's `Main.enso` carries
  `import Standard.Visualization`, which is IDE plumbing a user should never
  see.
- **Growth.** Adding a chart means writing a type switch across Table, Database
  and anything else that should support it.

After this work, Visualization imports only Base. Each data library supplies its
data to the charts through **conversions** to types defined in Base, and new
projects do not import Visualization: the IDE loads it on demand. This is the
groundwork for making visualisations more useful, so a new chart must be cheap
to add and must work for every data type that can be shown as a table.

## Goals

- No `import`/`from` of any `Standard.*` library other than `Standard.Base` in
  `distribution/lib/Standard/Visualization/`.
- Every chart the IDE ships keeps working for every data type it works for
  today, with the same JSON reaching the IDE (the Vue visualisations do not
  change).
- New projects do not contain `import Standard.Visualization`.
- A third-party library can support any chart by defining a conversion in its
  own code.
- A new chart written against the shared tabular shape (below) works at once for
  in-memory tables, columns, database tables and columns, and any other type
  that converts to that shape.

## Non-goals

- New charts. This work makes them cheap; it does not add any.
- Changing what the IDE's TypeScript sends, except where the widget fallback
  (below) proves necessary.
- Removing `Standard.Visualization` or its public names. Existing projects keep
  their import and keep compiling.
- Moving `Searcher` or changing its dependencies.

## Anti-goals

- **Pulling a whole database table into memory to draw a chart.** Every database
  path today reads a bounded sample (`..First 15000` for scatter and geo map,
  `max_rows` for the table). That must hold.
- **Breaking an existing project** that imports Visualization or calls any name
  it exports.
- **A silent change of default visualisation** for any type (which chart opens
  when a node's visualisation is first shown).

## Constraints and facts the design rests on

- **The engine already loads a library on demand.** When the IDE attaches a
  visualisation whose module is `Standard.Visualization.X`,
  `UpsertVisualizationJob.findModule` calls `EnsoContext.ensureModuleIsLoaded`,
  which loads the library through the package repository whether or not the
  project imports it. No engine change is needed to drop the import.
- **The IDE names modules, not imports.** It refers to
  `Standard.Visualization.Preprocessor`, `.Helpers`, `.Widgets`,
  `.Table.Visualization`, `.Scatter_Plot`, `.Histogram`, `.Geo_Map`,
  `.SQL.Visualization` and `.Warnings` by qualified name (about 20 sites in
  `app/gui/src`). These module paths and the names the IDE calls in them stay.
- **Preprocessor expressions are evaluated in the Visualization module the IDE
  names**, so extension methods defined there apply. That is why
  `a.default_visualization` (sent with module `Standard.Visualization.Helpers`)
  finds `Table.default_visualization` today. Once Visualization no longer
  imports Table, those extension methods must live on the types themselves.
- **Widget arguments are evaluated in the user's module.** The IDE sends
  `visualizationModule` = the module being edited and the method name as the
  expression `.name` (`widgetFunctionCallInfo.ts`), so the unresolved symbol is
  scoped to the user's module, which imports whatever it calls. The
  `from Standard.Table import all` / `from Standard.Database import all` lines
  in `Widgets.enso` therefore appear unnecessary. This is to be proven, not
  assumed (see the widget part).
- **Base already has the conversion pattern.**
  `Base/Visualization/Table_Viz_Data.enso` is a target type; about ten libraries
  define `Table_Viz_Data.from (that:X)` in the module of their own type `X`
  (DuckDB, Snowflake, Postgres, SQLite, SQL Server, Redshift, Excel, Hyper,
  Google Sheets, `Email_Send_Response`). Visualization itself defines the
  catch-all `Table_Viz_Data.from (that:Any)`. New conversions follow the same
  rule: **define each conversion in the module that defines the source type**,
  so it resolves wherever a value of that type exists.
- **Base cannot name Table's types**, including `Value_Type`. Anything in Base
  that describes a column's type uses its own small vocabulary.

## Approaches considered

- **A. One Base type per chart.** `Histogram_Viz_Data`, `Scatter_Viz_Data` and
  so on, and every data library converts to every one. Data libraries keep full
  control (a database can aggregate in SQL), but conversions grow as charts ×
  libraries, so every new chart means editing every data library.
- **B. One shared tabular shape.** One Base type describing "named, typed
  columns with a way to read rows"; every data library converts to it once; the
  charts are written once against it. A new chart works everywhere at once, but
  no library can do better than handing over a sample (no SQL-side binning).
- **C. B as the default, A where a library can do better.** _(Chosen.)_ Each
  chart is written against the shared tabular shape. A chart may also define its
  own Base type, and a library converts to that only when it has something
  better to offer. The chart's preprocessor tries the specific conversion first
  and falls back to the tabular one. New charts stay cheap and data libraries
  keep control where it matters, at the cost of two mechanisms and a documented
  fallback order.

For widgets, the options were a separate IDE-only widgets library (moves the
problem), resolving the method where the user called it (chosen), or deferring.
Given the fact above, "where the user called it" is already what happens, so the
expected change is only deleting the imports.

## The design

### 1. New Base types (`Standard.Base.Visualization`)

All `private: true` in their doc metadata, like `Table_Viz_Data`.

- **`Id`**, moved unchanged from `Standard.Visualization.Id`. Table's own
  `default_visualization` methods must return it, so it has to be in Base.
  `Standard.Visualization.Id` becomes a re-export so existing references keep
  working.
- **The tabular shape** (working name `Tabular_Viz_Data`): a description of a
  table that a chart can read from without knowing where it lives.
  - column names;
  - a per-column kind from a Base enum (numeric, text, boolean, date, date-time,
    time, other). The kind lets a chart pick suitable columns, as histogram and
    scatter do today with `value_type.is_numeric`;
  - the total row count where it is cheap to know, otherwise `Nothing`;
  - **a function that reads up to `n` rows** and returns the columns as vectors.
    A conversion cannot take arguments, but the chart decides the row limit
    (scatter 15000, table `max_rows`, histogram all rows for in-memory data), so
    the limit has to be passed when reading, not when converting. For a database
    table the function does `read (..First n)`; for an in-memory table it
    slices. This is what keeps the "never read a whole database table" anti-goal
    true.
- **Chart-specific types**, one for each chart that has a reason to let a
  library do better than the tabular fallback. Initially:
  - `Table_Viz_Data`, existing. The table view needs more than the tabular shape
    (value types for formatting, lazy cell windows, sort and filter), so it
    stays a specific type.
  - `SQL_Viz_Data`: the SQL text and its interpolations. Only database types
    convert to it; it has no tabular fallback.
  - `Geo_Map_Viz_Data`: what the map needs. `Spatial_Table` converts to it
    directly; anything else falls back to the tabular shape, looking for
    latitude and longitude columns as today.
  - Histogram and scatter start with **no** specific type: their current
    database behaviour is exactly "sample and compute in memory", which the
    tabular fallback reproduces. A specific type is added later when a library
    wants SQL-side binning.

  Each type renders itself to the JSON the matching Vue visualisation expects
  today, as `Table_Viz_Data.get_js_object` does.

### 2. Conversions in the data libraries

Each defined in the module of its source type:

| Source type                                                                          | Converts to                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `In_Memory_Table`, `In_Memory_Column`                                                | tabular shape, `Table_Viz_Data`                                     |
| `Row`                                                                                | `Table_Viz_Data`                                                    |
| `DB_Table`, `DB_Column`                                                              | tabular shape (sampled), `Table_Viz_Data` (sampled), `SQL_Viz_Data` |
| `Spatial_Table`                                                                      | `Geo_Map_Viz_Data`                                                  |
| Base collection types (`Vector`, `Array`, `Dictionary`, `Hashset`, `JS_Object`, XML) | handled in Base or Visualization, which may depend on Base freely   |

The body of each conversion is the code that is in the corresponding `case … of`
branch in Visualization today, moved, not rewritten.

### 3. The fallback rule in the preprocessors

A chart's preprocessor does, in order:

1. Try `Specific_Viz_Data.from value`. If it succeeds, render it.
2. Otherwise try the tabular shape, `Tabular_Viz_Data.from value`, and build the
   chart from it.
3. Otherwise the chart's existing behaviour for a value it cannot show (for
   example histogram's `from_vector value.to_vector`, or the table's catch-all
   `Table_Viz_Data.from (that:Any)`).

"Otherwise" means _no conversion exists_, not _the conversion failed_: a
dataflow error raised inside a conversion (say, a database read failing) must
reach the user as that error, not quietly fall through to a worse visualisation.
This rule lives in one helper in Visualization, used by every chart, and is
documented in Visualization's `CLAUDE.md` as the way to add a chart.

### 4. Extension methods move onto their types

The extension methods in `Visualization/Helpers.enso` on non-Base types become
ordinary methods in the Table library:

- `Table.default_visualization`, `Column.default_visualization`,
  `Row.default_visualization` (returning the Base `Id`).
- `Column.to_default_visualization_data`, `Row.to_default_visualization_data`
  (`Table.to_default_visualization_data` is already in `Table.enso`).
- `Table.to_lazy_visualization_data`, and the lazy-table helpers in
  `Visualization/Table/Visualization.enso` it calls.

Extension methods on Base types (`Any`, `Vector`, `Array`, `Text`, `Nothing`,
`Error`, `JS_Object`) may stay in Visualization: they need nothing beyond Base,
and they apply because the IDE evaluates in Visualization's modules.

`Table.default_visualization` currently tests `self.is_a In_Memory_Table` and
returns `Id.table` or `Id.sql_query`. Once it is a method, the in-memory and
database table types each return their own answer and the type test goes away.

### 5. Widgets

1. Delete the `Standard.Table` and `Standard.Database` imports from
   `Visualization/Widgets.enso`.
2. Prove it: the widget specs in `test/Visualization_Tests/src/Widgets/` and
   `test/Table_Tests/src/Internal/Widget_Helpers_Spec.enso` must pass, and so
   must a widget on an **extension method that a data library adds to a Base
   type** (for example `Text.parse_to_table`), called from a module that imports
   that library but not Visualization. Add a spec for that case if none exists.
3. Only if step 2 fails: change the IDE to send the method's fully qualified
   name from its suggestion entry instead of `.name`, and teach
   `get_widget_json` to accept it.

`column_names_json` stays: it is duck-typed (`table.column_names`) and needs no
import.

### 6. Removing the import from projects

- Remove `import Standard.Visualization` from the new-project template,
  `lib/scala/pkg/src/main/resources/default/src/Main.enso`.
- Remove it from the GUI integration mock project,
  `app/gui/integration-test/mock/project/src/Main.enso`.
- Test projects that import Visualization to test it (`Visualization_Tests`)
  keep the import. `Table_Tests` and `Table_Internal_Tests`, which import it
  incidentally, drop it where they can, so they double as proof that Table works
  without it.
- Leave the stale `Standard.Visualizations` example in the doc comment of
  `Base/Meta/Enso_Project.enso` alone unless it is being edited anyway.

### 7. Keeping existing projects working

`Standard.Visualization`'s `Main.enso` keeps exporting every name it exports
today (`File_Upload.file_uploading`, `Helpers`, `Id`, `Preprocessor`,
`Table.Visualization`, `Warnings`, `Widgets`); `Id` becomes a re-export of the
Base type.

### 8. Keeping the layering true

Add a note to `Visualization/0.0.0-dev/CLAUDE.md` and to
`distribution/lib/Standard/CLAUDE.md`: Visualization imports only Base; data
reaches it through conversions; how to add a chart (tabular shape first,
specific type only when a library can do better). A grep over Visualization's
sources for `Standard\.` imports other than Base is the check; whether to put it
in CI is left to the builder.

## Delivery

Each step leaves every chart working and can be its own PR:

1. Base `Id` and tabular shape; Widgets imports removed and proven; template and
   mock imports removed.
2. Table view through `Table_Viz_Data` conversions; extension methods moved onto
   Table's types.
3. Histogram and scatter on the tabular shape; geo map on `Geo_Map_Viz_Data`
   with the tabular fallback.
4. SQL view through `SQL_Viz_Data`; the last Table and Database imports deleted
   from Visualization.

## Verification

- `Visualization_Tests`, `Table_Tests`, `Base_Tests` and the database test
  projects that cover visualisation (at least one SQL backend, so DuckDB or
  SQLite) pass.
- Each chart's JSON for each source type is unchanged. The existing specs pin
  most of it. Where a chart × source pair has no spec today, add one before
  moving its code, so the move is checked against the old behaviour.
- A database spec shows a chart reads a bounded sample, not the whole table.
- In the IDE, a new project (no Visualization import) shows the table,
  histogram, scatter, geo map and SQL views and widget dropdowns for a Table and
  a DuckDB table. This is a manual check unless the builder finds a cheap
  automated one.

## Left to the builder

- Final names of the tabular shape, its column-kind enum and the specific types.
- How the fallback helper detects "no conversion exists" as distinct from a
  conversion that errors.
- Whether the tabular shape also carries per-column display names or formats.
- Whether the import grep goes into CI.
- Changelog: the visible change is one fewer import in new projects. Our call is
  `CI: No changelog needed` for steps 1–4. A chart that is new or newly works
  for a data type would get an entry.
