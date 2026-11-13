# Visualization Data Types (Piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Standard.Visualization` depend only on `Standard.Base`, with
every data library supplying its values to the visualisations through
conversions to data types that Visualization defines, without changing the
JSON any visualisation receives today (except the histogram's new row bound).

**Architecture:** Visualization defines `Viz_Table` (a wrapper whose methods
are the contract, delegating to a library-supplied _source_), `SQL_Viz` and
`Viz_Cell`. Table and Database define conversions to them on their **public**
types (`Table`, `Column`, `Row`) and dispatch inside through the existing
`that.implementation.<method> that.underlying` idiom. The preprocessors convert
once and read the data type; Base types keep their existing renderers, now
reached through conversions defined in Visualization.

**Tech Stack:** Enso standard library (`distribution/lib/Standard/*`), the
Enso test framework (`test/*_Tests`), TypeScript/Vue in `app/gui` (step 5
only), vitest.

**Spec:**
`docs/superpowers/specs/2026-11-13-visualization-depends-on-base-design.md`
(read it first, including "Changed while planning" at its end).

## Global Constraints

- Visualization imports nothing from `Standard.*` except `Standard.Base` once
  step 4 lands; Base imports nothing from Visualization and loses
  `Base/Visualization/` in step 3.
- Every conversion and `default_visualization` lives on a **public** type
  (`Table`, `Column`, `Row`, or a Base type), never on `In_Memory_Table`,
  `DB_Table`, `Spatial_Table`, `In_Memory_Column`, `DB_Column` or a refined
  type. An implementation that cannot supply a data type raises
  `Panic.throw (No_Such_Conversion.Error <Target> <value> Nothing)`.
- The IDE-facing module paths and function names stay:
  `Standard.Visualization.Table.Visualization.prepare_visualization`,
  `.get_rows_for_table`, `.get_distinct_values_for_column`, `.Helper.make_json`
  (called by name from `TableVizOperation.java:36`),
  `Standard.Visualization.Scatter_Plot.process_to_json_text`,
  `Standard.Visualization.Geo_Map.process_to_json_text`,
  `Standard.Visualization.Histogram.process_to_json_text`,
  `Standard.Visualization.SQL.Visualization.prepare_visualization`,
  `Standard.Visualization.Helpers` (`default_visualization` is evaluated
  there), `Standard.Visualization.Preprocessor`, `.Warnings`, `.Widgets`.
- `Standard.Visualization`'s `Main.enso` keeps every export.
- Every entity added to a library carries `## ---` / `private: true` / `---`
  doc metadata (the component browser and catalogue skip them).
- Database reads for charts are bounded: 15000 rows (`chart_row_bound`).
- New projects keep `import Standard.Visualization` (piece 4 removes it).
- Changelog: steps 1–4 take the `CI: No changelog needed` label; step 5 takes
  an entry (see its task).

## Working environment

- Work on a branch per step from `develop` (step N's branch from step N−1's
  once it merged). Use a worktree; never `git stash`.
- Enso tests need a built engine distribution containing your library
  changes. After **any** edit under `distribution/lib/`, rebuild it (sbt
  copies the changed library sources; it is incremental):

  ```bash
  sbt buildEngineDistribution
  ```

  WSL is the practical Linux route (`CLAUDE.md`, "Verifying changes"): prefix
  every WSL command with `. ~/.enso-toolchain.sh &&`, and set
  `ENSO_REPO=/mnt/c/.../<worktree>` when working in a Windows worktree.

- Run an Enso test project like this (from the repository root). `FILTER` is
  optional; **a filter that matches nothing still exits 0**, so check the
  printed test count against an unfiltered run:

  ```bash
  cd test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" FILTER
  ```

  Projects this plan uses: `Visualization_Tests`, `Table_Tests`,
  `XML_Tests`, `SQLite_Tests`, `DuckDB_Tests`, `Base_Tests`.

- API docs: each library with `docs/api` is checked by
  `corepack pnpm --filter build-scripts run stdlib-api-check` (stops at the
  first library that differs). Regenerate one library's committed docs with:

  ```bash
  sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/<Lib>/0.0.0-dev"
  ```

- GUI (step 5): `corepack pnpm --filter enso-gui test:unit -- <path>`,
  `corepack pnpm --filter enso-gui typecheck`,
  `corepack pnpm --filter enso-gui lint`.

---

## Step 1 — Pin today's JSON (PR 1, label `CI: No changelog needed`)

Every later step must leave these files byte-identical. They are generated
from `develop` before anything changes.

### Task 1.1: Golden-file helper and the pinned cases

**Files:**

- Create: `test/Visualization_Tests/src/Pinned.enso`
- Create: `test/Visualization_Tests/src/Pinned_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`
- Create (generated): `test/Visualization_Tests/data/pinned/*.json`

**Interfaces:**

- Produces: `Pinned.expect_pinned name:Text ~json_text:Text` — compares
  `json_text` (normalised) with `data/pinned/<name>.json`; with the environment
  variable `ENSO_UPDATE_PINNED=1` it writes the file instead.

- [ ] **Step 1: Write the helper**

`test/Visualization_Tests/src/Pinned.enso`:

```enso
from Standard.Base import all

from Standard.Test import all

## Replaces the parts of the JSON that change between runs.
   `table_version_hash` embeds a storage key that differs on every run.
normalise (text : Text) -> Text =
    text.replace (regex '"table_version_hash":"[^"]*"') '"table_version_hash":"<hash>"'

## Compares `json_text` with the pinned file `data/pinned/<name>.json`.
   With `ENSO_UPDATE_PINNED=1` in the environment it (re)writes the file.
expect_pinned (name : Text) ~json_text =
    dir = enso_project.data / "pinned"
    file = dir / (name + ".json")
    actual = normalise json_text
    case Environment.get "ENSO_UPDATE_PINNED" of
        "1" ->
            dir.create_directory
            actual.write file on_existing_file=..Overwrite . should_succeed
        _ ->
            expected = file.read_text
            actual.should_equal expected
```

- [ ] **Step 2: Write the cases**

`test/Visualization_Tests/src/Pinned_Spec.enso`. Each case is one value
through one preprocessor. The database values use SQLite in memory.

```enso
from Standard.Base import all
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument

from Standard.Table import Table, Column
import Standard.Database.Connection.Database
import Standard.Database.Extensions.Upload_Table
from Standard.SQLite import SQLite
from Standard.XML import XML_Document

import Standard.Visualization.Geo_Map
import Standard.Visualization.Helpers
import Standard.Visualization.Histogram
import Standard.Visualization.Preprocessor
import Standard.Visualization.Scatter_Plot
import Standard.Visualization.SQL.Visualization as SQL_Visualization
import Standard.Visualization.Table.Visualization

from Standard.Test import all

from project.Pinned import expect_pinned

type Atom
    Value x y

type Data
    Value ~data

    mem_table self = self.data.at 0
    mem_column self = self.data.at 1
    db_table self = self.data.at 2
    db_column self = self.data.at 3
    row self = self.data.at 4
    connection self = self.data.at 5
    geo_table self = self.data.at 6
    big_table self = self.data.at 7
    db_geo_table self = self.data.at 8
    cells_table self = self.data.at 9

    setup = Data.Value <|
        mem_table = Table.new [["x", [1, 2, 3]], ["y", [4.5, 5.5, 6.5]], ["label", ["a", "b", "c"]], ["when", [Date.new 2020 1 1, Date.new 2021 2 2, Date.new 2022 3 3]]]
        mem_column = mem_table.at "y"
        connection = Database.connect SQLite.In_Memory
        db_table = mem_table.select_into_database_table connection "pinned" temporary=True
        db_column = db_table.at "y"
        row = mem_table.rows.at 1
        geo_table = Table.new [["Latitude", [51.5, 48.8]], ["lon", [-0.1, 2.3]], ["name", ["London", "Paris"]], ["colour", ["red", "blue"]]]
        big_table = Table.new [["x", 0.up_to 20000 . to_vector], ["y", 0.up_to 20000 . map (i-> i * 2)]]
        db_geo_table = geo_table.select_into_database_table connection "pinned_geo" temporary=True
        cells_table = Table.new [["v", [mem_table, mem_column, row, [1, 2], Dictionary.from_vector [["k", 1]]]]]
        [mem_table, mem_column, db_table, db_column, row, connection, geo_table, big_table, db_geo_table, cells_table]

add_specs suite_builder =
    data = Data.setup

    suite_builder.group "Pinned table view JSON" group_builder->
        table_view name ~value max_rows=1000 =
            group_builder.specify name <|
                expect_pinned ("table_" + name) (Visualization.prepare_visualization value max_rows)
        table_view "mem_table" data.mem_table
        table_view "mem_column" data.mem_column
        table_view "mem_1col_table" (data.mem_table.select_columns ["y"])
        table_view "mem_1x1_table" (Table.new [["n", [7]]])
        table_view "db_table" data.db_table 2
        table_view "db_column" data.db_column 2
        table_view "row" data.row
        table_view "vector" [1, 2, 3] 2
        table_view "matrix" [[1, 2], [3, 4]]
        table_view "object_matrix" [Atom.Value 1 "a", Atom.Value 2 "b"]
        table_view "rows_matrix" data.mem_table.rows.to_vector
        table_view "array" [1, 2, 3].to_array 2
        table_view "dictionary" (Dictionary.from_vector [["a", 1], ["b", [1, 2]]])
        table_view "hashset" (Hashset.from_vector [3, 1, 2])
        table_view "js_object" (JS_Object.from_pairs [["a", 1], ["b", "two"]])
        table_view "function" (x-> x + 1)
        table_view "number" 42
        table_view "text" "hello"
        table_view "atom" (Atom.Value 1 [2, 3])
        table_view "error" (Error.throw (Illegal_Argument.Error "boom"))
        table_view "connection" data.connection
        table_view "xml_document" (XML_Document.parse '<foo id="10"><bar>hello</bar>text</foo>')
        table_view "cells" data.cells_table
        table_view "cells_vector" [data.mem_table, data.mem_column, data.row, data.db_table, data.db_column]

    suite_builder.group "Pinned default visualisation" group_builder->
        default name ~value =
            group_builder.specify name <|
                expect_pinned ("default_" + name) value.default_visualization.to_js_object.to_json
        default "mem_table" data.mem_table
        default "db_table" data.db_table
        default "mem_column" data.mem_column
        default "db_column" data.db_column
        default "row" data.row
        default "vector" [1, 2]
        default "array" [1, 2].to_array
        default "js_object" (JS_Object.from_pairs [["a", 1]])
        default "atom" (Atom.Value 1 2)

    suite_builder.group "Pinned default preprocessor JSON" group_builder->
        default_data name ~value =
            group_builder.specify name <|
                expect_pinned ("data_" + name) (Preprocessor.default_preprocessor value)
        default_data "mem_table" data.mem_table
        default_data "db_table" data.db_table
        default_data "mem_column" data.mem_column
        default_data "db_column" data.db_column
        default_data "row" data.row
        default_data "vector" [1, [2, 3]]
        default_data "js_object" (JS_Object.from_pairs [["a", 1]])
        default_data "text" "hello"

    suite_builder.group "Pinned server-side row model" group_builder->
        group_builder.specify "rows" <|
            expect_pinned "ssrm_rows" (Visualization.get_rows_for_table data.mem_table 0)
        group_builder.specify "rows of a column" <|
            expect_pinned "ssrm_rows_column" (Visualization.get_rows_for_table data.mem_column 1)
        group_builder.specify "sorted rows" <|
            expect_pinned "ssrm_rows_sorted" (Visualization.get_rows_for_table data.mem_table 0 [0] [-1])
        group_builder.specify "filtered rows" <|
            expect_pinned "ssrm_rows_filtered" (Visualization.get_rows_for_table data.mem_table 0 Nothing Nothing [0] [Filter_Condition.Greater 1])
        group_builder.specify "distinct values" <|
            expect_pinned "ssrm_distinct" (Visualization.get_distinct_values_for_column data.mem_table 2)

    suite_builder.group "Pinned scatter plot JSON" group_builder->
        scatter name ~value bounds=Nothing limit=Nothing =
            group_builder.specify name <|
                expect_pinned ("scatter_" + name) (Scatter_Plot.process_to_json_text value bounds limit)
        scatter "mem_table" data.mem_table
        scatter "mem_table_limit" data.mem_table limit=15000
        scatter "mem_column" data.mem_column
        scatter "mem_1col_x" (Table.new [["X", [5, 6, 7]]])
        scatter "mem_no_x" (Table.new [["a", ["p", "q"]], ["b", [1, 2]]])
        scatter "mem_colour_rownumber" (Table.new [["x", [1, 2]], ["Colour", ["r", "g"]], ["Row_Number", [10, 11]], ["y", [3, 4]], ["z", [5, 6]]])
        scatter "mem_bounds" data.mem_table [1, 2, 0, 10]
        scatter "mem_sampled" data.big_table limit=100
        scatter "db_table" data.db_table
        scatter "db_table_limit" data.db_table limit=2
        scatter "db_column" data.db_column
        scatter "vector" [3, 1, 2]
        scatter "vector_bounds" [3, 1, 2, 5] [0, 2, 0, 10]

    suite_builder.group "Pinned geo map JSON" group_builder->
        geo name ~value =
            group_builder.specify name <|
                expect_pinned ("geo_" + name) (Geo_Map.process_to_json_text value)
        geo "mem_table" data.geo_table
        geo "mem_table_nothing_known" data.mem_table
        geo "db_table" data.db_geo_table
        geo "vector" [1, 2]

    suite_builder.group "Pinned histogram JSON" group_builder->
        histogram name ~value =
            group_builder.specify name <|
                expect_pinned ("histogram_" + name) (Histogram.process_to_json_text value)
        histogram "mem_table" data.mem_table
        histogram "mem_value_column" (Table.new [["a", [1, 2]], ["Value", [9, 8]]])
        histogram "mem_column" data.mem_column
        histogram "db_table" data.db_table
        histogram "vector" [1, 2, 3]
        histogram "range" (2.up_to 5)

    suite_builder.group "Pinned SQL JSON" group_builder->
        group_builder.specify "db_table" <|
            expect_pinned "sql_db_table" (SQL_Visualization.prepare_visualization (data.db_table.filter "x" (..Greater 1)))
        group_builder.specify "db_column" <|
            expect_pinned "sql_db_column" (SQL_Visualization.prepare_visualization (data.db_column + 1))

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

Every helper takes its value suspended (`~value`), so that the dataflow error
of the `error` case reaches the preprocessor instead of short-circuiting the
helper call.

- [ ] **Step 3: Register the spec**

In `test/Visualization_Tests/src/Main.enso` add `import project.Pinned_Spec`
next to the other imports and `Pinned_Spec.add_specs suite_builder` in `main`,
keeping the alphabetical order the file uses.

- [ ] **Step 4: Run without goldens to see it fail**

Build the distribution, then run the project filtered to `Pinned`:

```bash
sbt buildEngineDistribution
cd test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" Pinned
```

Expected: every `Pinned …` test FAILS with a `File_Error` (the files do not
exist). If any case fails with a different error, the value expression is
wrong: fix the case, do not drop it.

- [ ] **Step 5: Generate the goldens on `develop` code**

```bash
cd test && ENSO_UPDATE_PINNED=1 JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" Pinned
```

Then run again **without** `ENSO_UPDATE_PINNED`. Expected: all `Pinned` tests
PASS. Run it a third time to prove the files are stable (no run-dependent
data apart from the normalised hash). If a file differs between runs, find
the unstable field and add it to `normalise` with a comment saying why.

Open three or four of the generated files and check they hold real JSON (not
an error text), especially `scatter_db_table`, `table_cells`,
`geo_db_table` and `sql_db_table`.

- [ ] **Step 6: Run the whole project**

Run `Visualization_Tests` unfiltered. Expected: everything passes, and the
count is the previous count plus the new cases.

- [ ] **Step 7: Commit**

```bash
git add test/Visualization_Tests/src/Pinned.enso test/Visualization_Tests/src/Pinned_Spec.enso test/Visualization_Tests/src/Main.enso test/Visualization_Tests/data/pinned
git commit -m "Visualization_Tests: pin every chart's JSON before the data-type work"
```

Open the PR with the `CI: No changelog needed` label.

---

## Step 2 — The data types (PR 2, label `CI: No changelog needed`)

Visualization gains its data types. Nothing calls them yet.

### Task 2.1: `Viz_Column_Kind` and `Viz_Table` with its two Base sources

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Column_Kind.enso`
- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Table.enso`
- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/Columns_Source.enso`
- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Source.enso`
- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/Names.enso`
- Test: `test/Visualization_Tests/src/Viz_Table_Spec.enso`, `Main.enso`

**Interfaces:**

- Produces (all in `Standard.Visualization`):
  - `Viz_Column_Kind.Viz_Kind` constructors `Numeric`, `Textual`, `Logical`,
    `Date_Only`, `Date_And_Time`, `Time_Only`, `Other`.
  - `Viz_Column_Kind.Viz_Column_Kind.Value (kind : Viz_Kind) (display_name : Text)`,
    `.is_numeric -> Boolean`, `.is_date_or_time -> Boolean`,
    static `Viz_Column_Kind.infer (values : Vector) -> Viz_Column_Kind`.
  - `Viz_Table.Viz_Table` with statics `from_source source`,
    `from_columns (headers : Vector Viz_Header) (columns : Vector Vector)`,
    `from_view (make_json : Integer -> Text)` and methods
    `table_view_json (max_rows:Integer=1000) -> Text`, `column_names`,
    `column_kinds`, `row_count`, `select_columns names`, `slice start count`,
    `sample count seed`, `supported_operations`, `supports operation`;
    capability `"rows"`: `rename_columns names`, `add_row_number name`,
    `filter_between name low high`, `rows_json -> Vector Text`,
    `column_values name -> Vector`; capability `"server_rows"`:
    `server_rows_json start sort_columns sort_directions filter_columns filter_conditions -> Text`,
    `distinct_values_json column_index filter_columns filter_conditions -> Text`;
    capability `"spatial"`: `spatial_layers_json -> Text`.
  - `Viz_Table.Viz_Header` constructors `Link name tooltip action`,
    `Label name`.
  - `Viz_Table.Viz_Unsupported.Error operation`.
  - `Internal.Names.select_insensitive (names : Vector Text) (wanted : Vector Text) (reorder : Boolean) -> Vector Text`,
    `Internal.Names.find_insensitive (names : Vector Text) (candidates : Vector Text) -> Text | Nothing`.
- The source contract every library implements (methods on the source):
  required `table_view_json max_rows`, `column_names`, `column_kinds`,
  `row_count`, `select_columns names`, `slice start count`,
  `sample count seed`, `supported_operations`; and the methods of each
  capability it lists. Methods returning a table return a `Viz_Table`.

- [ ] **Step 1: Write the failing spec**

`test/Visualization_Tests/src/Viz_Table_Spec.enso`:

```enso
from Standard.Base import all

import Standard.Visualization.Internal.Names
from Standard.Visualization.Viz_Column_Kind import Viz_Column_Kind, Viz_Kind
from Standard.Visualization.Viz_Table import Viz_Table, Viz_Header, Viz_Unsupported

from Standard.Test import all

add_specs suite_builder =
    suite_builder.group "Viz_Table from columns" group_builder->
        grid = Viz_Table.from_columns [Viz_Header.Link "Table" "table" "query", Viz_Header.Label "Rows"] [["a", "b", "c"], [1, 2, 3]]

        group_builder.specify "renders the Generic_Grid table view" <|
            json = grid.table_view_json . parse_json
            json.get "type" . should_equal "Generic_Grid"
            json.get "data" . should_equal [["a", "b", "c"], [1, 2, 3]]
            json.get "headers" . at 0 . get "get_child_node_action" . should_equal "query"
            json.get "headers" . at 1 . get "visualization_header" . should_equal "Rows"

        group_builder.specify "describes its columns" <|
            grid.column_names . should_equal ["Table", "Rows"]
            grid.column_kinds . map .kind . should_equal [Viz_Kind.Textual, Viz_Kind.Numeric]
            grid.column_kinds . map .display_name . should_equal ["Char", "Integer"]
            grid.row_count . should_equal 3

        group_builder.specify "selects, slices and samples" <|
            grid.select_columns ["Rows", "Missing"] . column_names . should_equal ["Rows"]
            grid.slice 1 5 . table_view_json . parse_json . get "data" . should_equal [["b", "c"], [2, 3]]
            grid.sample 10 42 . row_count . should_equal 3
            grid.sample 2 42 . row_count . should_equal 2

        group_builder.specify "says the optional operations are unsupported" <|
            grid.supported_operations . should_equal []
            grid.supports "rows" . should_be_false
            grid.rows_json . should_fail_with Viz_Unsupported

    suite_builder.group "Viz_Table from a view" group_builder->
        view = Viz_Table.from_view (max_rows-> '{"rows":' + max_rows.to_text + '}')

        group_builder.specify "passes the row limit to the view" <|
            view.table_view_json 7 . should_equal '{"rows":7}'
            view.table_view_json . should_equal '{"rows":1000}'

        group_builder.specify "has no columns" <|
            view.column_names . should_equal []
            view.row_count . should_equal Nothing
            view.select_columns ["a"] . table_view_json 3 . should_equal '{"rows":3}'
            view.sample 5 1 . column_names . should_equal []

    suite_builder.group "Viz_Column_Kind.infer" group_builder->
        group_builder.specify "classifies vectors" <|
            Viz_Column_Kind.infer [1, Nothing, 2] . display_name . should_equal "Integer"
            Viz_Column_Kind.infer [1, 2.5] . display_name . should_equal "Float"
            Viz_Column_Kind.infer [True] . kind . should_equal Viz_Kind.Logical
            Viz_Column_Kind.infer [Date.new 2020] . kind . should_equal Viz_Kind.Date_Only
            Viz_Column_Kind.infer [1, "a"] . kind . should_equal Viz_Kind.Other
            Viz_Column_Kind.infer [] . kind . should_equal Viz_Kind.Other

    suite_builder.group "Names" group_builder->
        names = ["x", "Colour", "label", "Row_Number", "y"]
        group_builder.specify "select_insensitive keeps table order without reorder" <|
            Names.select_insensitive names ["row_number", "x"] False . should_equal ["x", "Row_Number"]
        group_builder.specify "select_insensitive follows the wanted order with reorder" <|
            Names.select_insensitive names ["row_number", "x"] True . should_equal ["Row_Number", "x"]
        group_builder.specify "find_insensitive takes the first candidate that matches" <|
            Names.find_insensitive names ["color", "colour"] . should_equal "Colour"
            Names.find_insensitive names ["size"] . should_equal Nothing
```

Register it in `Main.enso` (`import project.Viz_Table_Spec`,
`Viz_Table_Spec.add_specs suite_builder`).

- [ ] **Step 2: Run to see it fail**

Rebuild and run `Visualization_Tests` filtered to `Viz_Table`. Expected: the
project fails to compile (`Viz_Table` does not exist).

- [ ] **Step 3: Write `Viz_Column_Kind.enso`**

```enso
from Standard.Base import all

## ---
   private: true
   ---
   The broad kind of values in a visualised column. Charts choose columns by
   kind; the kinds are Visualization's own, as Base cannot name Table's
   `Value_Type`.
type Viz_Kind
    ## ---
       private: true
       ---
    Numeric
    ## ---
       private: true
       ---
    Textual
    ## ---
       private: true
       ---
    Logical
    ## ---
       private: true
       ---
    Date_Only
    ## ---
       private: true
       ---
    Date_And_Time
    ## ---
       private: true
       ---
    Time_Only
    ## ---
       private: true
       ---
    Other

## ---
   private: true
   ---
   A column's kind, and the name the column's library gives its type (Table's
   `Value_Type.to_name`), which charts put in their JSON.
type Viz_Column_Kind
    ## ---
       private: true
       ---
    Value (kind : Viz_Kind) (display_name : Text)

    ## ---
       private: true
       ---
    is_numeric self -> Boolean = self.kind == Viz_Kind.Numeric

    ## ---
       private: true
       ---
    is_date_or_time self -> Boolean =
        [Viz_Kind.Date_Only, Viz_Kind.Date_And_Time, Viz_Kind.Time_Only].contains self.kind

    ## ---
       private: true
       ---
       Infers the kind of a vector of values held in memory. `Nothing` values
       are ignored; an empty or mixed vector is `Other`.
    infer (values : Vector) -> Viz_Column_Kind =
        present = values.filter (v-> v.is_nothing.not)
        all_are predicate = present.not_empty && (present.all predicate)
        if all_are (v-> v.is_a Integer) then Viz_Column_Kind.Value Viz_Kind.Numeric "Integer" else
            if all_are (v-> v.is_a Number) then Viz_Column_Kind.Value Viz_Kind.Numeric "Float" else
                if all_are (v-> v.is_a Text) then Viz_Column_Kind.Value Viz_Kind.Textual "Char" else
                    if all_are (v-> v.is_a Boolean) then Viz_Column_Kind.Value Viz_Kind.Logical "Boolean" else
                        if all_are (v-> v.is_a Date_Time) then Viz_Column_Kind.Value Viz_Kind.Date_And_Time "Date_Time" else
                            if all_are (v-> v.is_a Date) then Viz_Column_Kind.Value Viz_Kind.Date_Only "Date" else
                                if all_are (v-> v.is_a Time_Of_Day) then Viz_Column_Kind.Value Viz_Kind.Time_Only "Time" else
                                    Viz_Column_Kind.Value Viz_Kind.Other "Mixed"
```

- [ ] **Step 4: Write `Internal/Names.enso`**

```enso
private

from Standard.Base import all

## The names in `names` that equal (ignoring case) one in `wanted`, as
   `Table.select_columns … case_sensitivity=..Insensitive error_on_missing_columns=False`
   returns them: in the table's order, or with `reorder` in `wanted`'s order
   (each name once, at its first match).
select_insensitive (names : Vector Text) (wanted : Vector Text) (reorder : Boolean) -> Vector Text =
    matches name = wanted.any (w-> w.equals_ignore_case name)
    if reorder.not then names.filter matches else
        wanted.flat_map (w-> names.filter (n-> n.equals_ignore_case w)) . distinct

## The first name in `names` that equals (ignoring case) the earliest
   candidate that matches anything, or `Nothing`.
find_insensitive (names : Vector Text) (candidates : Vector Text) -> Text | Nothing =
    found = select_insensitive names candidates True
    if found.is_empty then Nothing else found.first
```

- [ ] **Step 5: Write `Viz_Table.enso`**

```enso
from Standard.Base import all

import project.Internal.Columns_Source.Columns_Source
import project.Internal.View_Source.View_Source
import project.Viz_Column_Kind.Viz_Column_Kind

## ---
   private: true
   ---
   The table every value can be shown as, and the data the table view and the
   charts read. A library makes its values drawable by a conversion
   `Viz_Table.from (that:Its_Public_Type)` defined in the module of that type,
   returning `Viz_Table.from_source` of its own source, or `from_columns` /
   `from_view` when its data is a few in-memory columns or only a table view.
   The source's methods are the contract; see this library's `CLAUDE.md`.
type Viz_Table
    ## ---
       private: true
       ---
    private Value source

    ## ---
       private: true
       ---
       Wraps a library's implementation of the contract.
    from_source source -> Viz_Table = Viz_Table.Value source

    ## ---
       private: true
       ---
       In-memory columns, shown as a `Generic_Grid`.
    from_columns (headers : Vector Viz_Header) (columns : Vector Vector) -> Viz_Table =
        Viz_Table.Value (Columns_Source.Value headers columns)

    ## ---
       private: true
       ---
       A value with a table view and no columns; `make_json` takes the row
       limit the view shows.
    from_view (make_json : Integer -> Text) -> Viz_Table =
        Viz_Table.Value (View_Source.Value make_json)

    ## ---
       private: true
       ---
       The JSON the table view draws.
    table_view_json self (max_rows : Integer = 1000) -> Text =
        self.source.table_view_json max_rows

    ## ---
       private: true
       ---
    column_names self -> Vector Text = self.source.column_names

    ## ---
       private: true
       ---
    column_kinds self -> Vector Viz_Column_Kind = self.source.column_kinds

    ## ---
       private: true
       ---
       The number of rows, or `Nothing` when it is not cheap to know.
    row_count self -> Integer | Nothing = self.source.row_count

    ## ---
       private: true
       ---
       The named columns, in the given order; names that are not columns are
       skipped.
    select_columns self (names : Vector Text) -> Viz_Table = self.source.select_columns names

    ## ---
       private: true
       ---
    slice self (start : Integer) (count : Integer) -> Viz_Table = self.source.slice start count

    ## ---
       private: true
       ---
       At most `count` rows: the library's quick sample (a random sample in
       memory, the first rows in a database). Bounded, always.
    sample self (count : Integer) (seed : Integer) -> Viz_Table = self.source.sample count seed

    ## ---
       private: true
       ---
       The optional capabilities the source supports: any of `"rows"`,
       `"server_rows"`, `"spatial"`.
    supported_operations self -> Vector Text = self.source.supported_operations

    ## ---
       private: true
       ---
    supports self (operation : Text) -> Boolean = self.supported_operations.contains operation

    ## ---
       private: true
       ---
    rename_columns self (names : Vector Text) -> Viz_Table =
        self.require "rows" <| self.source.rename_columns names

    ## ---
       private: true
       ---
       Appends a column of row numbers starting at 0.
    add_row_number self (name : Text) -> Viz_Table =
        self.require "rows" <| self.source.add_row_number name

    ## ---
       private: true
       ---
    filter_between self (name : Text) low high -> Viz_Table =
        self.require "rows" <| self.source.filter_between name low high

    ## ---
       private: true
       ---
       Each row as a JSON object keyed by column name, rendered by the library.
    rows_json self -> Vector Text = self.require "rows" <| self.source.rows_json

    ## ---
       private: true
       ---
    column_values self (name : Text) -> Vector = self.require "rows" <| self.source.column_values name

    ## ---
       private: true
       ---
       A page of the table view's server-side row model.
    server_rows_json self (start : Integer) sort_columns sort_directions filter_columns filter_conditions -> Text =
        self.require "server_rows" <| self.source.server_rows_json start sort_columns sort_directions filter_columns filter_conditions

    ## ---
       private: true
       ---
    distinct_values_json self (column_index : Integer) filter_columns filter_conditions -> Text =
        self.require "server_rows" <| self.source.distinct_values_json column_index filter_columns filter_conditions

    ## ---
       private: true
       ---
       The geo map's layers for a spatial table.
    spatial_layers_json self -> Text = self.require "spatial" <| self.source.spatial_layers_json

    private require self (operation : Text) ~action =
        if self.supports operation then action else Error.throw (Viz_Unsupported.Error operation)

## ---
   private: true
   ---
   A column header of a `from_columns` table.
type Viz_Header
    ## ---
       private: true
       ---
       Column whose cells create child nodes with `action`.
    Link name tooltip action

    ## ---
       private: true
       ---
    Label name

## ---
   private: true
   ---
   Raised when a visualisation asks a value for an operation its library does
   not support.
type Viz_Unsupported
    ## ---
       private: true
       ---
    Error (operation : Text)

    ## ---
       private: true
       ---
    to_display_text self -> Text =
        "The visualised value does not support `" + self.operation + "`."
```

- [ ] **Step 6: Write the two Base sources**

`Internal/Columns_Source.enso`:

```enso
private

from Standard.Base import all

import project.Viz_Column_Kind.Viz_Column_Kind
import project.Viz_Table.Viz_Header
import project.Viz_Table.Viz_Table

## Columns held in memory; the table view is a `Generic_Grid`, exactly as
   Base's `Table_Viz_Data.GenericGrid` rendered it.
type Columns_Source
    Value (headers : Vector Viz_Header) (columns : Vector Vector)

    table_view_json self _ -> Text =
        header_json header = case header of
            Viz_Header.Label _ -> JS_Object.from_pairs [["visualization_header", header.name]]
            Viz_Header.Link _ _ _ -> JS_Object.from_pairs [["visualization_header", header.name], ["child_label", header.tooltip], ["get_child_node_action", header.action]]
        JS_Object.from_pairs [["type", "Generic_Grid"], ["data", self.columns], ["headers", self.headers.map header_json]] . to_json

    column_names self -> Vector Text = self.headers.map .name

    column_kinds self -> Vector Viz_Column_Kind = self.columns.map Viz_Column_Kind.infer

    row_count self -> Integer = if self.columns.is_empty then 0 else self.columns.first.length

    select_columns self (names : Vector Text) -> Viz_Table =
        all_names = self.column_names
        kept = names.map (n-> all_names.index_of n) . filter (i-> i.is_nothing.not)
        Viz_Table.from_columns (kept.map (i-> self.headers.at i)) (kept.map (i-> self.columns.at i))

    slice self (start : Integer) (count : Integer) -> Viz_Table =
        Viz_Table.from_columns self.headers (self.columns.map (c-> c.drop start . take count))

    sample self (count : Integer) (seed : Integer) -> Viz_Table =
        n = self.row_count
        if n <= count then Viz_Table.from_columns self.headers self.columns else
            picked = (0.up_to n).to_vector.take (..Sample count seed=seed)
            Viz_Table.from_columns self.headers (self.columns.map (c-> picked.map (i-> c.at i)))

    supported_operations self -> Vector Text = []
```

`Internal/View_Source.enso`:

```enso
private

from Standard.Base import all

import project.Viz_Table.Viz_Table

## A value that has only a table view.
type View_Source
    Value (make_json : Integer -> Text)

    table_view_json self (max_rows : Integer) -> Text = (self.make_json) max_rows
    column_names self -> Vector Text = []
    column_kinds self -> Vector = []
    row_count self -> Nothing = Nothing
    select_columns self _ -> Viz_Table = Viz_Table.from_view self.make_json
    slice self _ _ -> Viz_Table = Viz_Table.from_view self.make_json
    sample self _ _ -> Viz_Table = Viz_Table.from_view self.make_json
    supported_operations self -> Vector Text = []
```

`Viz_Table.enso` and the two sources import each other; Enso resolves
module cycles inside a library.

- [ ] **Step 7: Run the spec**

Rebuild, run `Visualization_Tests` filtered to `Viz_Table`, then to `Names`.
Expected: PASS. Then run it unfiltered: the `Pinned` goldens still pass.

- [ ] **Step 8: Commit**

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: Viz_Table, its column kinds and the two in-memory sources"
```

### Task 2.2: `SQL_Viz` and `Viz_Cell`

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/SQL_Viz.enso`
- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Cell.enso`
- Test: `test/Visualization_Tests/src/Viz_Cell_Spec.enso`, `Main.enso`

**Interfaces:**

- Produces: `SQL_Viz.SQL_Viz.Value (dialect : Text) (code : Text) (interpolations : Vector)`
  and `.to_json_text -> Text` (the exact JSON
  `SQL.Visualization.prepare_visualization` returns today);
  `Viz_Cell.Viz_Cell.Value (render : Integer -> Any) (pairs : Vector | Nothing)`,
  static `Viz_Cell.render_value value (level:Integer=0) -> Any` (today's
  `_make_json_for_value`, with the Table and Database branches replaced by
  `(Viz_Cell.from value).render level`), and the catch-all
  `Viz_Cell.from (that:Any)`.

- [ ] **Step 1: Write the failing spec**

`test/Visualization_Tests/src/Viz_Cell_Spec.enso`:

```enso
from Standard.Base import all

from Standard.Visualization.SQL_Viz import SQL_Viz
from Standard.Visualization.Viz_Cell import Viz_Cell

from Standard.Test import all

type Thing
    Value x

add_specs suite_builder =
    suite_builder.group "Viz_Cell" group_builder->
        group_builder.specify "renders Base values as the table view does" <|
            Viz_Cell.render_value Nothing . should_equal Nothing
            Viz_Cell.render_value "a" . should_equal "a"
            Viz_Cell.render_value [1, 2, 3, 4, 5, 6] . should_equal "[1, 2, 3, 4, 5, … 1 items]"
            Viz_Cell.render_value [1, 2] 1 . should_equal "[… 2 items]"
            Viz_Cell.render_value (Thing.Value 1) . should_equal (Thing.Value 1).to_display_text

        group_builder.specify "has no record pairs for an ordinary value" <|
            (Viz_Cell.from (Thing.Value 1)).pairs . should_equal Nothing

    suite_builder.group "SQL_Viz" group_builder->
        group_builder.specify "renders the SQL view JSON" <|
            viz = SQL_Viz.Value "SQLite" 'SELECT ? AS "x"' [2, Date.new 2020 1 2]
            json = viz.to_json_text . parse_json
            json.get "dialect" . should_equal "SQLite"
            json.get "code" . should_equal 'SELECT ? AS "x"'
            json.get "interpolations" . at 0 . get "enso_type" . should_equal "Standard.Base.Data.Numbers.Integer"
            json.get "interpolations" . at 1 . get "value" . should_equal "2020-01-02"
```

Register it in `Main.enso`. Run filtered to `Viz_Cell`; expected: compile
failure.

- [ ] **Step 2: Write `SQL_Viz.enso`**

```enso
from Standard.Base import all

## ---
   private: true
   ---
   What the SQL view shows: the query's text and its interpolated values.
   Database tables and columns convert to it (`SQL_Viz.from (that:Table)`, in
   `Standard.Table`, dispatching to the database implementation).
type SQL_Viz
    ## ---
       private: true
       ---
    Value (dialect : Text) (code : Text) (interpolations : Vector)

    ## ---
       private: true
       ---
       The JSON the SQL view draws. For each interpolation it gives its value
       and its Enso type name.
    to_json_text self -> Text =
        code = self.code.replace (regex "::variant, \{'enso-null-replacement-marker'.*?\}::variant") ", NULL"
        mapped = self.interpolations.map value->
            enso_type = value.to Meta.Type . qualified_name
            used_value = case value of
                _ : Date -> value.to_text
                _ : Time_Of_Day -> value.to_text
                _ : Date_Time -> value.to_text
                _ -> value
            JS_Object.from_pairs [["value", used_value], ["enso_type", enso_type]]
        JS_Object.from_pairs [["dialect", self.dialect], ["code", code], ["interpolations", mapped]] . to_text
```

- [ ] **Step 3: Write `Viz_Cell.enso`**

Copy `_make_json_for_value` and `_to_js_object_with_display_text` from
`Visualization/src/Table/Visualization.enso` (as on `develop`) into the type
below as `render_value` and `_with_display_text`. Delete the `row : Row`,
`table : Table`, `col : Column`, `db_table : DB_Table` and `db_col : DB_Column`
branches and change the last branch from `_ -> val.to_display_text` to
`_ -> (Viz_Cell.from val).render level`. Rename the recursive calls to
`Viz_Cell.render_value`. The result:

```enso
from Standard.Base import all

## ---
   private: true
   ---
   How a value appears inside a table view cell. Base values are rendered
   here; a library renders its own types by a conversion
   `Viz_Cell.from (that:Its_Public_Type)`.
type Viz_Cell
    ## ---
       private: true
       ---
       - `render`: the cell's JSON at a nesting level (0 for a top-level cell).
       - `pairs`: for a record shown as one row of an object matrix, its
         name/value pairs; otherwise `Nothing`.
    Value (render : Integer -> Any) (pairs : Vector | Nothing)

    ## ---
       private: true
       ---
       The JSON of `value` in a table view cell.
    render_value value (level : Integer = 0) -> Any = case value of
        Nothing -> Nothing
        txt : Text -> txt
        num : Number ->
            js_version = if num.is_finite then num.to_js_object else JS_Object.from_pairs [["type", "Float"], ["value", num.to_text]]
            if js_version.is_a JS_Object . not then js_version else
                pairs = [['_display_text_', num.to_display_text]] + js_version.field_names.map f-> [f, js_version.get f]
                JS_Object.from_pairs pairs
        boolean : Boolean -> boolean
        vec : Vector ->
            if level != 0 then "[… "+vec.length.to_text+" items]" else
                truncated = vec.take 5 . map v-> (Viz_Cell.render_value v level+1).to_text
                prepared = if vec.length > 5 then truncated + ["… " + (vec.length - 5).to_text+ " items"] else truncated
                "[" + (prepared.join ", ") + "]"
        array : Array -> Viz_Cell.render_value array.to_vector level
        dict : Dictionary ->
            if level != 0 then "{… "+dict.length.to_text+" items}" else
                truncated = dict.keys.take 5 . map k-> k.to_text + ": " + (Viz_Cell.render_value (value.get k) level+1).to_text
                prepared = if dict.length > 5 then truncated + ["… " + (dict.length - 5).to_text+ " items"] else truncated
                "{" + (prepared.join ", ") + "}"
        set : Hashset ->
            if level != 0 then "{… "+set.length.to_text+" items}" else
                truncated = set.to_vector.take 5 . map k-> (Viz_Cell.render_value k level+1).to_text
                prepared = if set.length > 5 then truncated + ["… " + (set.length - 5).to_text+ " items"] else truncated
                "{" + (prepared.join ", ") + "}"
        f : Function -> "[Function "+f.to_text+"]"
        date : Date -> _with_display_text date
        date_time : Date_Time -> _with_display_text date_time
        time : Time_Of_Day -> _with_display_text time
        _ -> (Viz_Cell.from value).render level

## ---
   private: true
   ---
Viz_Cell.from (that:Any) = Viz_Cell.Value (_-> that.to_display_text) Nothing

private _with_display_text value =
    js_version = value.to_js_object
    pairs = [['_display_text_', value.to_display_text]] + js_version.field_names.map f-> [f, js_version.get f]
    JS_Object.from_pairs pairs
```

Check the copied branches against `develop` line by line: the only intended
differences are the five deleted branches, the last branch and the names.

- [ ] **Step 4: Run, commit**

Rebuild; run `Visualization_Tests` filtered to `Viz_Cell` and `SQL_Viz`
(PASS), then unfiltered (all pass, goldens unchanged).

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: SQL_Viz and Viz_Cell data types"
```

### Task 2.3: API docs and the library guide

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/**`
  (regenerated)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`

- [ ] **Step 1:** Regenerate Visualization's API docs with the `--docs=api`
      command from "Working environment", then run
      `corepack pnpm --filter build-scripts run stdlib-api-check` and expect it
      to pass.
- [ ] **Step 2:** In Visualization's `CLAUDE.md`, add a section `## Data
types` listing `Viz_Table` (with the source contract from Task 2.1's
      Interfaces, required and per capability), `SQL_Viz` and `Viz_Cell`, and
      the rule "conversions on public types, implementations raise
      `No_Such_Conversion` when they cannot supply a type".
- [ ] **Step 3:** Commit (`git add distribution/lib/Standard/Visualization`,
      message `Visualization: API docs and guide for the data types`) and open
      the PR with `CI: No changelog needed`.

---

## Step 3 — The flip (PR 3, label `CI: No changelog needed`)

Table, Database and the other data libraries import Visualization and convert
to its types; Base loses `Table_Viz_Data`; the table view and its server-side
row model run on `Viz_Table`. Until step 4, Visualization's chart modules
still import Table and Database, so the two libraries import each other; that
cycle resolves (checked on a distribution, 2026-11-14) and step 4 removes it.

### Task 3.1: Table's sources, cells and methods

**Files:**

- Create: `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Viz_Helpers.enso`
- Create: `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Viz_Source.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Column.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Row.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Table_Implementation.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Column_Implementation.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Helpers.enso` (remove what Table now owns)
- Test: `test/Visualization_Tests/src/Table_Conversions_Spec.enso`, `Main.enso`

**Interfaces:**

- Consumes: `Viz_Table`, `Viz_Column_Kind`, `Viz_Kind`, `SQL_Viz`,
  `Viz_Cell` (step 2); `Standard.Visualization.Id.Id`.
- Produces:
  - `Standard.Table.Internal.Viz_Helpers` (a non-`private` module so
    Database can import it): `column_kind (value_type : Value_Type) -> Viz_Column_Kind`,
    `column_kinds table -> Vector Viz_Column_Kind`,
    `table_cell table level -> Text`, `column_cell column level -> Text`,
    `row_cell row level -> Text`, `row_table_view_json row -> Text`.
  - `In_Memory_Viz_Source.Value table column` (column is the original
    `Column` or `Nothing`), supporting `["rows", "server_rows"]`.
  - On the implementation types (static, like their other methods):
    `to_viz_table`, `to_sql_viz`, `default_visualization`.
  - Conversions `Viz_Table.from`, `SQL_Viz.from`, `Viz_Cell.from` on `Table`
    and `Column`; `Viz_Table.from` and `Viz_Cell.from` on `Row`.
  - Methods `default_visualization` on `Table`, `Column`, `Row`;
    `to_default_visualization_data` on `Column` and `Row`.

- [ ] **Step 1: Write the failing Table-side spec**

Create `test/Visualization_Tests/src/Table_Conversions_Spec.enso` and register
it:

```enso
from Standard.Base import all
import Standard.Base.Errors.Common.No_Such_Conversion

from Standard.Table import Table
from Standard.Visualization.SQL_Viz import SQL_Viz
from Standard.Visualization.Viz_Cell import Viz_Cell
from Standard.Visualization.Viz_Column_Kind import Viz_Kind
from Standard.Visualization.Viz_Table import Viz_Table

from Standard.Test import all

add_specs suite_builder =
    suite_builder.group "Table to Viz_Table" group_builder->
        t = Table.new [["x", [1, 2, 3]], ["s", ["a", "b", "c"]]]

        group_builder.specify "describes an in-memory table" <|
            vt = Viz_Table.from t
            vt.column_names . should_equal ["x", "s"]
            vt.column_kinds . map .kind . should_equal [Viz_Kind.Numeric, Viz_Kind.Textual]
            vt.column_kinds . map .display_name . should_equal ["Integer", "Char"]
            vt.row_count . should_equal 3
            vt.supported_operations . should_equal ["rows", "server_rows"]

        group_builder.specify "a one-column and a 1x1 table are tables, not columns" <|
            Viz_Table.from (t.select_columns ["x"]) . column_names . should_equal ["x"]
            Viz_Table.from (Table.new [["n", [7]]]) . column_names . should_equal ["n"]

        group_builder.specify "row operations act like Table's own" <|
            vt = Viz_Table.from t . add_row_number "rn" . filter_between "x" 2 3 . select_columns ["rn", "x"]
            vt.column_values "rn" . should_equal [1, 2]
            vt.rename_columns ["a", "b"] . column_names . should_equal ["a", "b"]
            vt.rows_json . length . should_equal 2

        group_builder.specify "a column converts with its table" <|
            Viz_Table.from (t.at "s") . column_names . should_equal ["s"]

        group_builder.specify "an in-memory table has no SQL" <|
            Panic.catch No_Such_Conversion (SQL_Viz.from t) (_-> "none") . should_equal "none"

        group_builder.specify "cells of tables, columns and rows" <|
            (Viz_Cell.from t).render 1 . should_equal "Table{3 rows x 2 columns}"
            (Viz_Cell.from (t.at "x")).render 1 . should_equal "Column{x: 3 rows}"
            (Viz_Cell.from (t.rows.at 0)).pairs . should_equal [["x", 1], ["s", "a"]]
```

Rebuild and run filtered to `Table to Viz_Table`; expected: FAIL with
`No_Such_Conversion` (only the `Any` catch-all of `Viz_Cell` exists, and
`Viz_Table` has none yet).

- [ ] **Step 2: Write `Internal/Viz_Helpers.enso`**

`table_cell`, `column_cell` and `row_cell` are the `table : Table`,
`col : Column` and `row : Row` branches of `_make_json_for_value` on
`develop`, unchanged except that the recursive call becomes
`Viz_Cell.render_value`. `row_table_view_json` is `make_json_for_row` from
`Visualization/src/Table/Visualization.enso`, with `_make_json_for_value`
replaced the same way. (The `db_table`/`db_col` branches on `develop` are
unreachable, because a database table also matches `table : Table` first, so
database values render as `Table{…}`/`Column{…}` today and keep doing so.)

```enso
from Standard.Base import all

import Standard.Visualization.Viz_Cell.Viz_Cell
from Standard.Visualization.Viz_Column_Kind import Viz_Column_Kind, Viz_Kind

import project.Value_Type.Value_Type

## ---
   private: true
   ---
   Visualization's kind for a column of this value type.
column_kind (value_type : Value_Type) -> Viz_Column_Kind =
    kind = if value_type.is_numeric then Viz_Kind.Numeric else
        if value_type.is_text then Viz_Kind.Textual else
            if value_type.is_boolean then Viz_Kind.Logical else
                case value_type of
                    Value_Type.Date -> Viz_Kind.Date_Only
                    Value_Type.Date_Time _ -> Viz_Kind.Date_And_Time
                    Value_Type.Time -> Viz_Kind.Time_Only
                    _ -> Viz_Kind.Other
    Viz_Column_Kind.Value kind value_type.to_name

## ---
   private: true
   ---
column_kinds table -> Vector Viz_Column_Kind =
    table.columns.map (c-> column_kind c.value_type)

## ---
   private: true
   ---
table_cell table (level : Integer) -> Text =
    if level != 0 then "Table{" + table.row_count.to_text + " rows x " + table.column_count.to_text + " columns}" else
        truncated = table.columns.take 5 . map _.name
        prepared = if table.column_count > 5 then truncated + ["… " + (table.column_count - 5).to_text+ " more"] else truncated
        "Table{" + table.row_count.to_text + " rows x [" + (prepared.join ", ") + "]}"

## ---
   private: true
   ---
column_cell column (level : Integer) -> Text =
    if level != 0 then "Column{" + column.name + ": " + column.row_count.to_text + " rows}" else
        items = Viz_Cell.render_value column.to_vector level
        "Column{" + column.name + ": " + items + "}"

## ---
   private: true
   ---
row_cell row (level : Integer) -> Text =
    if level != 0 then "Row{" + row.length + " columns}" else
        truncated = row.column_names.take 5 . map _.to_text
        prepared = if row.length > 5 then truncated + ["… " + (row.length - 5).to_text+ " more"] else truncated
        "Row{" + (prepared.join ", ") + "}"

## ---
   private: true
   ---
   The table view of a single row.
row_table_view_json row -> Text =
    header = ["header", ["column", "value"]]
    all_rows = ["all_rows_count", row.length]
    column_names = row.column_names
    values = ((0.up_to row.length).map idx-> Viz_Cell.render_value (row.get idx))
    data = ["data", [column_names, values]]
    links = ["get_child_node_action", "at"]
    get_child_node_action_link_name = ["get_child_node_link_name", "column"]
    JS_Object.from_pairs [header, all_rows, data, links, get_child_node_action_link_name, ["type", "Map"]] . to_json
```

`row_cell` keeps `develop`'s `"Row{" + row.length + …` at level ≠ 0 as it is
(moved, not fixed); fixing it would change a golden.

- [ ] **Step 3: Write `Internal/In_Memory_Viz_Source.enso`**

`server_rows_json` is the body of `get_rows_for_table` (from `max_rows=1000`
on) and `distinct_values_json` the body of `get_distinct_values_for_column`
(after the logging wrapper), both from `Visualization/src/Table/Visualization.enso`
on `develop`, with `table` replaced by `self.table`. `apply_sort_to_table`
and `apply_filter_to_table` move here unchanged as private functions.

```enso
private

from Standard.Base import all

import Standard.Visualization.Viz_Table.Viz_Table

import project.Column.Column
import project.In_Memory_Column.In_Memory_Column
import project.In_Memory_Table.In_Memory_Table
import project.Internal.Viz_Helpers
import project.Sort_Column.Sort_Column
import project.Table.Table

## The `Viz_Table` source of an in-memory table or column. `column` is the
   original column when the value was a column (its table view differs), else
   `Nothing`; `table` is the table operations act on.
type In_Memory_Viz_Source
    Value table column

    table_view_json self _ -> Text = case self.column of
        Nothing -> (self.table:In_Memory_Table).to_table_viz_json
        column -> (column:In_Memory_Column).to_table_viz_json

    column_names self -> Vector Text = self.table.column_names
    column_kinds self -> Vector = Viz_Helpers.column_kinds self.table
    row_count self -> Integer = self.table.row_count
    select_columns self (names : Vector Text) -> Viz_Table = _wrap (self.table.select_columns names reorder=True error_on_missing_columns=False on_problems=..Ignore)
    slice self (start : Integer) (count : Integer) -> Viz_Table = _wrap (self.table.take (start.up_to start+count))
    sample self (count : Integer) (seed : Integer) -> Viz_Table = _wrap (self.table.take (..Sample count seed=seed))
    supported_operations self -> Vector Text = ["rows", "server_rows"]
    rename_columns self (names : Vector Text) -> Viz_Table = _wrap (self.table.rename_columns names)
    add_row_number self (name : Text) -> Viz_Table = _wrap (self.table.add_row_number name)
    filter_between self (name : Text) low high -> Viz_Table = _wrap (self.table.filter name (..Between low high))
    rows_json self -> Vector Text = self.table.rows . map .to_json_data
    column_values self (name : Text) -> Vector = self.table.at name . to_vector

    server_rows_json self (start_number : Integer) sort_col_index_list sort_direction_list filter_col filter_condition -> Text =
        # Must stay in sync with the IDE's `cacheBlockSize` in AgGridTableView.vue
        # (app/gui/src/project-view/components/shared/AgGridTableView.vue) — a one-sided change would silently break paging.
        max_rows=1000
        table = self.table
        col_name = table.make_temp_column_name
        table_with_index = table.add_row_number col_name
        table_with_index_ordered = table_with_index.reorder_columns [col_name] ..Before_Other_Columns
        filtered_table = if filter_col.is_nothing then table_with_index_ordered else _apply_filter_to_table table_with_index_ordered 0 filter_col filter_condition True
        sorted_table = if sort_col_index_list.is_nothing then filtered_table else _apply_sort_to_table filtered_table sort_col_index_list sort_direction_list
        sliced_json = sorted_table.columns.map (c-> c.to_json_data start_number max_rows)
        '{"rows":[' + (sliced_json.join ",") + '], "row_count":' + filtered_table.row_count.to_text + '}'

    distinct_values_json self (column_index : Integer) filter_col filter_condition -> Text =
        filtered_table = if filter_col.is_nothing then self.table else _apply_filter_to_table self.table 0 filter_col filter_condition False
        filtered_column = (filtered_table.columns.at column_index):In_Memory_Column
        filtered_column.await_metrics
        distinct_json = filtered_column.distinct_values_json . if_nothing "null"
        '{"distinct_vals":' + distinct_json + '}'

private _wrap table = Viz_Table.from (table:Table)

private _apply_sort_to_table table sort_col_index_list sort_direction_list =
    parse_direction d = if d == -1 then Sort_Direction.Descending else Sort_Direction.Ascending
    get_pattern i = (Sort_Column.Index ((sort_col_index_list.get i)+1) (parse_direction (sort_direction_list.get i)))
    sort_pattern = ((0.up_to sort_col_index_list.length).map idx-> get_pattern idx)
    table.sort sort_pattern

private _apply_filter_to_table table i filter_cols filter_conditions has_index_col =
    if i == filter_cols.length then table else
        col = filter_cols.get i
        condition = filter_conditions.get i
        correct_index = if has_index_col then col+1 else col
        filtered_table = table.filter (correct_index) (condition)
        @Tail_Call _apply_filter_to_table filtered_table i+1 filter_cols filter_conditions has_index_col
```

`select_columns` passes `error_on_missing_columns=False on_problems=..Ignore`
so that a missing name is skipped, as the contract says.

- [ ] **Step 4: Implementation methods**

Append to the `In_Memory_Table_Implementation` type (same indentation as its
other methods) and add the imports
`import Standard.Base.Errors.Common.No_Such_Conversion`,
`import Standard.Visualization.Id.Id`,
`import Standard.Visualization.SQL_Viz.SQL_Viz`,
`import Standard.Visualization.Viz_Table.Viz_Table`,
`import project.Internal.In_Memory_Viz_Source.In_Memory_Viz_Source`:

```enso
    to_viz_table (this_table : Table & In_Memory_Table) =
        Viz_Table.from_source (In_Memory_Viz_Source.Value this_table Nothing)

    to_sql_viz (this_table : Table & In_Memory_Table) =
        Panic.throw (No_Such_Conversion.Error SQL_Viz this_table Nothing)

    default_visualization (this_table : Table & In_Memory_Table) = Id.table
```

`default_visualization` ignores `this_table` (an unused-argument warning, as
elsewhere); keep the parameter so that every implementation has one shape.

Append to `In_Memory_Column_Implementation` (same imports):

```enso
    to_viz_table (this_column : Column & In_Memory_Column) =
        Viz_Table.from_source (In_Memory_Viz_Source.Value this_column.to_table this_column)

    to_sql_viz (this_column : Column & In_Memory_Column) =
        Panic.throw (No_Such_Conversion.Error SQL_Viz this_column Nothing)
```

- [ ] **Step 5: Conversions and methods on the public types**

At the end of `Table.enso` (imports at the top:
`import Standard.Visualization.Id.Id`, `import Standard.Visualization.SQL_Viz.SQL_Viz`,
`import Standard.Visualization.Viz_Cell.Viz_Cell`,
`import Standard.Visualization.Viz_Table.Viz_Table`,
`import project.Internal.Viz_Helpers`):

```enso
## ---
   private: true
   ---
   The table view and charts read a table through its implementation.
Viz_Table.from (that:Table) = that.implementation.to_viz_table that.underlying

## ---
   private: true
   ---
   Only a database table has SQL; an in-memory one raises `No_Such_Conversion`.
SQL_Viz.from (that:Table) = that.implementation.to_sql_viz that.underlying

## ---
   private: true
   ---
Viz_Cell.from (that:Table) = Viz_Cell.Value (level-> Viz_Helpers.table_cell that level) Nothing

## ---
   private: true
   ---
   Guides the visualization system to display the most suitable graphical
   representation for this table.
Table.default_visualization self -> Id = self.implementation.default_visualization self.underlying
```

At the end of `Column.enso` (same imports):

```enso
## ---
   private: true
   ---
Viz_Table.from (that:Column) = that.implementation.to_viz_table that.underlying

## ---
   private: true
   ---
SQL_Viz.from (that:Column) = that.implementation.to_sql_viz that.underlying

## ---
   private: true
   ---
Viz_Cell.from (that:Column) = Viz_Cell.Value (level-> Viz_Helpers.column_cell that level) Nothing

## ---
   private: true
   ---
Column.default_visualization self -> Id = Id.table

## ---
   private: true
   ---
   Shows a JSON serialization of a truncated version of this column, for the
   benefit of visualization in the IDE. Reads at most 100 values, also from a
   database.
Column.to_default_visualization_data self -> Text =
    size = ['length', self.row_count]
    name = ['name', self.name]
    max_data = 100
    data = ['data', self.read (..First max_data) . to_vector]
    JS_Object.from_pairs [size, name, data] . to_text
```

At the end of `Row.enso` (imports `import Standard.Visualization.Helpers`,
`import Standard.Visualization.Id.Id`, `import Standard.Visualization.Viz_Cell.Viz_Cell`,
`import Standard.Visualization.Viz_Table.Viz_Table`, `import project.Internal.Viz_Helpers`):

```enso
## ---
   private: true
   ---
Viz_Table.from (that:Row) = Viz_Table.from_view (_-> Viz_Helpers.row_table_view_json that)

## ---
   private: true
   ---
Viz_Cell.from (that:Row) =
    pairs = that.column_names.map (n-> [n, that.get n])
    Viz_Cell.Value (level-> Viz_Helpers.row_cell that level) pairs

## ---
   private: true
   ---
Row.default_visualization self -> Id = Id.table

## ---
   private: true
   ---
   Returns a Text used to display this row in the IDE by default.
Row.to_default_visualization_data self -> Text = Helpers.render_vector self.to_vector
```

(`Row.to_default_visualization_data` on `develop` is
`self.to_vector.to_default_visualization_data`, and
`Vector.to_default_visualization_data` is `render_vector self`.)

- [ ] **Step 6: Run the spec**

In `Visualization/src/Helpers.enso` delete the definitions that Table now
owns, so that no method is defined twice: `Table.default_visualization`,
`Column.default_visualization`, `Column.to_default_visualization_data`,
`Row.default_visualization`, `Row.to_default_visualization_data` and
`Table.to_lazy_visualization_data`, and the imports
`Standard.Table.In_Memory_Table.In_Memory_Table`, `Standard.Table.Row.Row`,
`from Standard.Table import Column, Table` and
`project.Table as Table_Visualization`.

Rebuild; run `Visualization_Tests` filtered to `Table to Viz_Table`. Expected:
PASS.

- [ ] **Step 7: Commit**

```bash
git add distribution/lib/Standard/Table test/Visualization_Tests
git commit -m "Table: convert tables, columns and rows to Visualization's data types"
```

### Task 3.2: Visualization's table view on `Viz_Table`

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Json.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Table.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Table/Visualization.enso`
- Delete: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Table.enso`
- Delete: `test/Visualization_Tests/src/Lazy_Table_Spec.enso` (and its two
  lines in `Main.enso`)

**Interfaces:**

- Consumes: Task 3.1's conversions.
- Produces: `Viz_Table.from` for `Any`, `Vector`, `Array`, `Dictionary`,
  `Hashset`, `JS_Object`, `Number`, `Send_Response`; `View_Json` (private
  module) with `make_json_for_vector`, `make_json_for_dictionary`,
  `make_json_for_hashset`, `make_json_for_js_object`, `make_json_for_other`,
  `make_json_for_error`.

- [ ] **Step 1: Move the Base renderers**

Create `Internal/View_Json.enso` (first line `private`; imports
`from Standard.Base import all`, `import Standard.Base.Data.Vector.Builder`,
`import project.Viz_Cell.Viz_Cell`) and **move** into it, unchanged except
as listed, from `Table/Visualization.enso`: `max_columns`,
`make_json_for_error`, `make_json_for_vector`, `make_json_for_matrix`,
`make_json_for_object_matrix`, `make_json_for_dictionary`,
`_make_json_for_hashset` (rename to `make_json_for_hashset`, drop `private`),
`make_json_for_js_object`, `_make_json_for_other` (rename to
`make_json_for_other`, drop `private`). Changes:

- every `_make_json_for_value x` becomes `Viz_Cell.render_value x`;
- `make_json_for_error` becomes

  ```enso
  make_json_for_error error =
      JS_Object.from_pairs [["type", "Error"], ["error", error.to_display_text]] . to_json
  ```

  (what `Table_Viz_Data.Error … . get_js_object . to_json` produced);

- in `make_json_for_object_matrix`, replace the `_ : Row ->` branch and the
  final `_ ->` branch with one `_ ->` branch:

  ```enso
          _ ->
              record = (Viz_Cell.from row).pairs
              if record.is_nothing.not then JS_Object.from_pairs (record.map p-> [p.first, Viz_Cell.render_value p.second]) else
                  js_object = row.to_js_object
                  if js_object.is_a JS_Object . not then False else
                      if js_object.field_names.sort == ["constructor", "type"] then False else
                          pairs = js_object.field_names.map f-> [f, Viz_Cell.render_value (js_object.get f)]
                          JS_Object.from_pairs pairs
  ```

  A Row's record pairs are its column names and values, exactly what the old
  `_ : Row` branch iterated.

- [ ] **Step 2: Base conversions in `Viz_Table.enso`**

Add the imports `import Standard.Base.Network.Email.Email_Send_Response.Send_Response`,
`import project.Internal.View_Json`, `import project.Viz_Cell.Viz_Cell`, and
append:

```enso
## ---
   private: true
   ---
Viz_Table.from (that:Any) = Viz_Table.from_view (_-> View_Json.make_json_for_other that . to_json)

## ---
   private: true
   ---
Viz_Table.from (that:Vector) = Viz_Table.from_view (max_rows-> View_Json.make_json_for_vector that max_rows . to_json)

## ---
   private: true
   ---
Viz_Table.from (that:Array) = Viz_Table.from that.to_vector

## ---
   private: true
   ---
Viz_Table.from (that:Dictionary) = Viz_Table.from_view (max_rows-> View_Json.make_json_for_dictionary that max_rows)

## ---
   private: true
   ---
Viz_Table.from (that:Hashset) = Viz_Table.from_view (max_rows-> View_Json.make_json_for_hashset that max_rows)

## ---
   private: true
   ---
Viz_Table.from (that:JS_Object) = Viz_Table.from_view (max_rows-> View_Json.make_json_for_js_object that max_rows)

## ---
   private: true
   ---
Viz_Table.from (that:Number) = Viz_Table.from_view (_-> JS_Object.from_pairs [["json", Viz_Cell.render_value that]] . to_json)

## ---
   private: true
   ---
   The response to sending an email (Base cannot depend on Visualization).
Viz_Table.from (that:Send_Response) =
    Viz_Table.from_columns [Viz_Header.Label "Status", Viz_Header.Label "Email"] [[that.to_text], [that.email.to_text]]
```

(`Base/…/Email_Send_Response.enso` defines the type `Send_Response`; check the
name there before writing the import.)

A conversion from `Number` must catch `Integer` and `Float` values: the
`table_number` golden checks it. If it fails because 42 reached the `Any`
catch-all, add the same conversion for `(that:Integer)` and `(that:Float)`.

- [ ] **Step 3: Slim `Table/Visualization.enso`**

The module keeps `Helper`, `prepare_visualization`,
`get_rows_for_table` and `get_distinct_values_for_column`. Replace its
imports with:

```enso
from Standard.Base import all

import project.Helpers
import project.Internal.View_Json
import project.Viz_Cell.Viz_Cell
import project.Viz_Table.Viz_Table
from project.Helpers import time_visualization, short_display
```

and the kept definitions with:

```enso
## ---
   private: true
   ---
   Provides the callback for TableVizOperation which converts values to JSON.
   `TableVizOperation.java` calls it by name; keep the module path and names.
type Helper
    ## ---
       private: true
       ---
    make_json value = Viz_Cell.render_value value . to_json

## ---
   private: true
   ---
   Prepares any value for the table visualization. A database value
   materializes at most `max_rows` rows.

   ## Arguments
    - `y`: The value to prepare for visualization.
    - `max_rows`: The maximum number of rows to display.
prepare_visualization : Any -> Integer -> Text
prepare_visualization y max_rows=1000 = time_visualization Visualization ("prepare_visualization: " + (short_display y)) <|
    if y.is_error then View_Json.make_json_for_error y.catch else
        x = Warning.set y []
        case x of
            f : Function ->
                pairs = [['_display_text_', '[Function '+f.to_text+']']]
                value = JS_Object.from_pairs pairs
                JS_Object.from_pairs [["json", value]] . to_json
            _ -> (Viz_Table.from x).table_view_json max_rows

## ---
   private: true
   ---
   Gets the distinct values of a column, used for filter options.
get_distinct_values_for_column : Any -> Integer -> Vector | Nothing -> Vector | Nothing -> Text
get_distinct_values_for_column table column_index filter_col=Nothing filter_condition=Nothing =
    time_visualization Visualization ("get_distinct_values_for_column: " + (short_display table) + "[" + column_index.to_text + "]") <|
        (Viz_Table.from table).distinct_values_json column_index filter_col filter_condition

## ---
   private: true
   ---
   Prepares the row data for the table view's server-side row model.
get_rows_for_table : Any -> Integer -> Vector | Nothing -> Vector | Nothing -> Vector | Nothing -> Vector | Nothing -> Text
get_rows_for_table table_or_column start_number sort_col_index_list=Nothing sort_direction_list=Nothing filter_col=Nothing filter_condition=Nothing =
    time_visualization Visualization ("get_rows_for_table: " + (short_display table_or_column) + "[" + start_number.to_text + "]") <|
        (Viz_Table.from table_or_column).server_rows_json start_number sort_col_index_list sort_direction_list filter_col filter_condition
```

Delete everything else in the module: `_make_json_for_db_table` (Task 3.3
moves it to Database), `apply_sort_to_table`, `apply_filter_to_table`
(moved in Task 3.1), the `Table_Viz_Data.from (that:Any)` conversion (now
`Viz_Table.from (that:Any)`), `_make_json_for_value` and
`_to_js_object_with_display_text` (now in `Viz_Cell`).

Function stays a branch before the conversion: a `Function` value passed to
a conversion is the one case this plan does not want to discover at run time.

- [ ] **Step 4: Delete the lazy table code**

`git rm distribution/lib/Standard/Visualization/0.0.0-dev/src/Table.enso
test/Visualization_Tests/src/Lazy_Table_Spec.enso` and remove
`import project.Lazy_Table_Spec` and `Lazy_Table_Spec.add_specs suite_builder`
from `test/Visualization_Tests/src/Main.enso`. Keep `Text.enso`,
`Lazy_Text_Spec` and `Preprocessor.lazy_preprocessor`: the default
visualisation of a long `Text` uses the lazy text window.

- [ ] **Step 5: Run, commit**

Rebuild; run `Visualization_Tests` unfiltered. Expected: all pass except the
database `Pinned` cases and `Table_Spec`'s database cases, which fail until
Task 3.3 (the database table has no `to_viz_table` yet). Commit:

```bash
git add -A distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: the table view reads Viz_Table; lazy table code removed"
```

### Task 3.3: Database's source

**Files:**

- Create: `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Viz_Source.enso`
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso`
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Column_Implementation.enso`
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/Common/Connections_Helpers.enso`

**Interfaces:**

- Consumes: Task 3.1's `Viz_Helpers.column_kinds`; Visualization's types.
- Produces: `DB_Viz_Source.Value table column spatial` (spatial is the
  `Spatial_Table` refinement of the table, or `Nothing`); implementation
  statics `to_viz_table`, `to_sql_viz`, `default_visualization` (table only).

- [ ] **Step 1: Write `Internal/DB_Viz_Source.enso`**

`_db_table_view_json` is `_make_json_for_db_table` from `develop`'s
`Table/Visualization.enso`, unchanged apart from the name.

```enso
private

from Standard.Base import all

import Standard.Table.In_Memory_Column.In_Memory_Column
import Standard.Table.In_Memory_Table.In_Memory_Table
import Standard.Table.Internal.Viz_Helpers
import Standard.Visualization.Viz_Table.Viz_Table

## The `Viz_Table` source of a database table or column. Only a bounded
   `sample` reads data; the row operations are not supported, so a chart
   samples first and works on the in-memory result.
type DB_Viz_Source
    Value table column spatial

    table_view_json self (max_rows : Integer) -> Text =
        _db_table_view_json self.table max_rows is_column=self.column.is_nothing.not

    column_names self -> Vector Text = self.table.column_names
    column_kinds self -> Vector = Viz_Helpers.column_kinds self.table
    row_count self -> Integer = self.table.row_count
    select_columns self (names : Vector Text) -> Viz_Table = Viz_Table.from (self.table.select_columns names reorder=True error_on_missing_columns=False on_problems=..Ignore)
    slice self (start : Integer) (count : Integer) -> Viz_Table = Viz_Table.from (self.table.take (start.up_to start+count))
    sample self (count : Integer) _ -> Viz_Table = Viz_Table.from (self.table.read (..First count))
    supported_operations self -> Vector Text = if self.spatial.is_nothing then [] else ["spatial"]

private _db_table_view_json t max_rows is_column =
    dataframe = t.read (..First max_rows)
    case dataframe.is_error of
        False ->
            all_rows_count = t.row_count
            in_memory = if is_column then (dataframe.at 0):In_Memory_Column else dataframe:In_Memory_Table
            in_memory.to_table_viz_json all_rows_count False
        True ->
            JS_Object.from_pairs [["error", 'Error querying the database:\n' + dataframe.catch.to_display_text]] . to_json
```

`spatial_layers_json` is added in step 4 (Task 4.3), with the geo map.

- [ ] **Step 2: Implementation methods**

In `DB_Table_Implementation` (imports `import Standard.Table.Spatial_Table.Spatial_Table`
if missing, `import Standard.Visualization.Id.Id`,
`import Standard.Visualization.SQL_Viz.SQL_Viz`,
`import Standard.Visualization.Viz_Table.Viz_Table`,
`import project.Internal.DB_Viz_Source.DB_Viz_Source`):

```enso
    to_viz_table (this_table : Table & DB_Table) =
        refined = DB_Table_Refinements.refine_table this_table
        spatial = case refined of
            s : Spatial_Table -> s
            _ -> Nothing
        Viz_Table.from_source (DB_Viz_Source.Value this_table Nothing spatial)

    to_sql_viz (this_table : Table & DB_Table) =
        prepared = this_table.to_sql.prepare
        SQL_Viz.Value this_table.dialect_name prepared.first prepared.second

    default_visualization (this_table : Table & DB_Table) = Id.sql_query
```

In `DB_Column_Implementation` (same imports minus `Spatial_Table`, `Id`):

```enso
    to_viz_table (this_column : Column & DB_Column) =
        Viz_Table.from_source (DB_Viz_Source.Value this_column.to_table this_column Nothing)

    to_sql_viz (this_column : Column & DB_Column) =
        prepared = this_column.to_sql.prepare
        SQL_Viz.Value this_column.dialect_name prepared.first prepared.second
```

If `DB_Table_Refinements` (or its `refine_table`) is not reachable from the
implementation module, use the same import `DB_Table.enso` uses
(`import project.Internal.Type_Refinements.DB_Table_Refinements`), which the
implementation module already has.

- [ ] **Step 3: `Connections_Helpers.enso`**

```enso
from Standard.Base import all
from Standard.Visualization.Viz_Table import Viz_Table, Viz_Header

## ---
   private: true
   ---
get_table_viz_data tables =
    Viz_Table.from_columns [Viz_Header.Link "Table" "table" "query"] [tables]
```

- [ ] **Step 4: Run**

Add to `Table_Conversions_Spec.enso` a group using SQLite (copy the
`Database.connect SQLite.In_Memory` / `select_into_database_table` setup from
`Pinned_Spec`):

```enso
    suite_builder.group "Database values to Viz_Table" group_builder->
        connection = Database.connect SQLite.In_Memory
        dt = (Table.new [["x", [1, 2, 3]]]).select_into_database_table connection "conv" temporary=True

        group_builder.specify "a database table samples by reading its first rows" <|
            vt = Viz_Table.from dt
            vt.supports "rows" . should_be_false
            sampled = vt.sample 2 0
            sampled.supports "rows" . should_be_true
            sampled.column_values "x" . should_equal [1, 2]

        group_builder.specify "a database table has SQL" <|
            (SQL_Viz.from dt).dialect . should_equal "SQLite"

        group_builder.specify "the default visualisation of a database table is the SQL view" <|
            dt.default_visualization . should_equal Id.sql_query
```

(imports: `import Standard.Database.Connection.Database`,
`import Standard.Database.Extensions.Upload_Table`,
`from Standard.SQLite import SQLite`, `import Standard.Visualization.Id.Id`.)
Rebuild; run `Visualization_Tests` unfiltered. Expected: all pass, all
goldens unchanged.

- [ ] **Step 5: Commit** — `git add distribution/lib/Standard/Database test/Visualization_Tests`,
      message `Database: convert database tables and columns to Visualization's data types`.

### Task 3.4: The other libraries, and Base loses `Table_Viz_Data`

**Files:**

- Modify (each: its `Table_Viz_Data` imports and conversions):
  `AWS/0.0.0-dev/src/Database/Redshift/Redshift_Connection.enso`,
  `DuckDB/0.0.0-dev/src/DuckDB_Connection.enso`,
  `Excel/0.0.0-dev/src/Excel_Workbook.enso`,
  `Google/0.0.0-dev/src/Google_Sheets_Workbook.enso`,
  `Microsoft/0.0.0-dev/src/SQLServer_Connection.enso`,
  `Postgres/0.0.0-dev/src/Postgres_Connection.enso`,
  `SQLite/0.0.0-dev/src/SQLite_Connection.enso`,
  `Snowflake/0.0.0-dev/src/Snowflake_Connection.enso`,
  `Tableau/0.0.0-dev/src/Hyper_File.enso`, `XML/0.0.0-dev/src/XML.enso`
  (all under `distribution/lib/Standard/`)
- Modify: `Base/0.0.0-dev/src/Network/Email/Email_Send_Response.enso`,
  `Base/0.0.0-dev/src/Data/Json.enso`
- Modify: `Visualization/0.0.0-dev/src/Helpers.enso` (receives
  `JS_Object.to_default_visualization_data`)
- Delete: `Base/0.0.0-dev/src/Visualization/Table_Viz_Data.enso`

- [ ] **Step 1: Mechanical rewrite in each library.** In every file listed:
  - the import `Standard.Base.Visualization.Table_Viz_Data.Table_Viz_Data`
    (and `Table_Viz_Header`) becomes
    `from Standard.Visualization.Viz_Table import Viz_Table, Viz_Header`
    (keep only the names the file uses);
  - `Table_Viz_Data.from (that:X) =` becomes `Viz_Table.from (that:X) =`;
  - `Table_Viz_Data.GenericGrid` becomes `Viz_Table.from_columns`;
  - `Table_Viz_Header.Link` / `.Label` become `Viz_Header.Link` / `.Label`;
  - in `XML.enso`, `Table_Viz_Data.Limited (max_rows-> X)` becomes
    `Viz_Table.from_view (max_rows-> X . to_json)` (both conversions:
    `XML_Element`, `XML_Document`).

  Nothing else in the bodies changes. For example DuckDB:

  ```enso
  Viz_Table.from (that:DuckDB_Connection) =
      tables = that.tables schema="*" . filter "Schema" (..Is_In schema_black_list ..Remove)
      multi_schema = tables.at "Schema" . to_vector . any s-> s != that.schema
      case multi_schema of
          True  ->
              Viz_Table.from_columns [Viz_Header.Link "Table" "table" "query (..Table_Name {{@Table}} {{@Schema}})", Viz_Header.Label "Schema"] [tables.at "Name" . to_vector, tables.at "Schema" . to_vector]
          False ->
              Viz_Table.from_columns [Viz_Header.Link "Table" "table" "query (..Table_Name {{@Table}})"] [tables.at "Name" . to_vector]
  ```

- [ ] **Step 2: Base.** Delete `src/Visualization/Table_Viz_Data.enso` (and the
      now-empty directory). In `Email_Send_Response.enso` delete the
      `Table_Viz_Data` import and the `Table_Viz_Data.from (that:Send_Response)`
      conversion (Task 3.2 Step 2 moved it). In `Json.enso` delete
      `JS_Object.to_default_visualization_data`, and in the same commit add it
      to `Visualization/src/Helpers.enso`, after `JS_Object.default_visualization`
      (`render` is already imported there):

  ```enso
  ## ---
     private: true
     ---
     Transform the JS_Object into text for displaying as part of its default
     visualization.
  JS_Object.to_default_visualization_data self -> Text = render self
  ```

      Then confirm nothing in the repository still names it:

  ```bash
  git grep -n "Table_Viz_Data\|Table_Viz_Header\|Base.Visualization" -- distribution test ':!*/docs/api/*'
  ```

  Expected: no output.

- [ ] **Step 3: Run the affected test projects** after a rebuild:
      `Visualization_Tests` (all pass, goldens unchanged), `XML_Tests` (its
      `Visualization_Spec` passes unchanged), `SQLite_Tests`, `DuckDB_Tests`,
      `Base_Tests`, `Table_Tests`. Record each project's test count and
      compare with `develop`.

- [ ] **Step 4: Check cells render without the import.** Create a throwaway
      project outside the repository (in your scratch directory) whose
      `Main.enso` imports only `Standard.Base` and `Standard.Table`:

  ```enso
  from Standard.Base import all
  from Standard.Table import Table

  main =
      t = Table.new [["v", [[1, 2], Date.new 2020 1 1]]]
      IO.println (t.at "v" . to_json_data)
  ```

  Run it (`cd <scratch> && <dist>/bin/enso --no-ir-caches --run <Project>`).
  Expected: the vector cell prints as `"[1, 2]"`, not `null`. On `develop`
  the same program prints `null` for it (Visualization is not loaded); try it
  there to see the difference.

- [ ] **Step 5: Regenerate API docs** for Base, Visualization, Table,
      Database, AWS, DuckDB, Excel, Google, Microsoft, Postgres, SQLite,
      Snowflake, Tableau and XML with the `--docs=api` command, then run
      `stdlib-api-check` until it passes.

- [ ] **Step 6: Commit**

```bash
git add -A distribution/lib/Standard
git commit -m "Libraries convert to Visualization's Viz_Table; Base drops Table_Viz_Data"
```

### Task 3.5: Guides

- [ ] **Step 1:** `distribution/lib/Standard/CLAUDE.md`, the `Visualization/`
      line of the library index: "IDE-only visualisation preprocessors and the
      data types other libraries convert to (`Viz_Table`, `SQL_Viz`, `Viz_Cell`).
      Depends only on `Base`; **do not import in user code**." Add a
      "Cross-library pitfalls" bullet: Base knows nothing about visualisation;
      a library makes its values drawable by a conversion to a Visualization
      data type, defined in the module of its **public** type.
- [ ] **Step 2:** Visualization's `CLAUDE.md` Layout: remove `src/Table.enso`,
      add the new modules; Table's and Database's `CLAUDE.md`: one line each
      naming `Internal/Viz_Helpers.enso` / `Internal/In_Memory_Viz_Source.enso`
      / `Internal/DB_Viz_Source.enso`.
- [ ] **Step 3:** Commit (`Guides: visualisation data types and layering`),
      open the PR with `CI: No changelog needed`.

---

## Step 4 — The charts (PR 4, label `CI: No changelog needed`)

Scatter, geo map and histogram read `Viz_Table`; SQL reads `SQL_Viz`;
Visualization's last `Standard.Table`/`Standard.Database` imports go. The
histogram gains a row bound. **The GUI does not register the Histogram (or
Heatmap) visualisation** (`stores/visualization/index.ts` builtins), so no
user sees that change; hence the label, not a changelog entry.

### Task 4.1: Chart constants and the scatter plot

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/Chart_Limits.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Scatter_Plot.enso`

**Interfaces:**

- Produces: `Chart_Limits.chart_row_bound = 15000`,
  `Chart_Limits.chart_sample_seed = 15975382`,
  `Chart_Limits.local_rows (vt : Viz_Table) (bound : Integer) -> Viz_Table`
  (the table itself when it supports `"rows"`, else its bounded sample).

- [ ] **Step 1: `Internal/Chart_Limits.enso`**

```enso
private

from Standard.Base import all

import project.Viz_Table.Viz_Table

## How many rows a chart reads from a source that cannot work on its rows in
   place (a database).
chart_row_bound = 15000

## The seed every chart samples with, so a chart is stable between updates.
chart_sample_seed = 15975382

## `vt` when it can work on its rows in place; otherwise a bounded sample of
   it, which can. A database table therefore reads at most `bound` rows.
local_rows (vt : Viz_Table) (bound : Integer) -> Viz_Table =
    if vt.supports "rows" then vt else vt.sample bound chart_sample_seed
```

- [ ] **Step 2: Rewrite `Scatter_Plot.enso`**

The goldens from step 1 are the test: `scatter_*` must stay byte-identical.
Keep `json_from_vector` unchanged. Replace the imports and `x_column`,
`json_from_table` and `process_to_json_text` with:

```enso
from Standard.Base import all

import project.Helpers
import project.Internal.Chart_Limits
import project.Internal.Names
import project.Viz_Table.Viz_Table
from project.Helpers import time_visualization, short_display

## ---
   private: true
   ---
   The name of the x column: the column named 'X' or 'x', else the left-most
   column when it is numeric or a date or time and not named 'Y'/'y'.
x_column_name : Viz_Table -> Text | Nothing
x_column_name vt = if vt.column_names.length == 1 then Nothing else
    names = vt.column_names
    by_name = if names.contains "X" then "X" else if names.contains "x" then "x" else Nothing
    if Nothing != by_name then by_name else
        first = names.first
        kind = vt.column_kinds.first
        is_good = (kind.is_numeric || kind.is_date_or_time) && first != "Y" && first != "y"
        if is_good then first else Nothing

## ---
   private: true
   ---
json_from_viz_table : Viz_Table -> Vector Integer | Nothing -> Integer | Nothing -> Text
json_from_viz_table vt bounds limit =
    names = vt.column_names
    if names.length == 1 && names.first.equals_ignore_case "x" then json_from_viz_table (vt.rename_columns ["Value"] . add_row_number "Index" . select_columns ["Index", "Value"]) bounds limit else
        x = x_column_name vt
        if Nothing == x then json_from_viz_table (vt.add_row_number "x") bounds limit else
            kinds = vt.column_kinds
            x_kind = kinds.at (names.index_of x)
            ## The same columns `Table.select_columns … . get 1` found: the second
               match in table order, which is not always the colour column.
            color = Names.select_insensitive names [x, "color", "colour"] False . get 1
            row_number = Names.select_insensitive names [x, "row_number"] False . get 1
            base_names = Names.select_insensitive names [x, "shape", "label", "size"] True
            with_row_number = if Nothing == row_number then vt.add_row_number "row_number" else vt
            row_number_name = row_number.if_nothing "row_number"
            core_names = base_names + (if Nothing == color then [] else ["color"]) + [row_number_name]
            core_sources = base_names + (if Nothing == color then [] else [color]) + [row_number_name]
            data_names = names.zip kinds . filter (p-> core_names.contains p.first . not && p.second.is_numeric) . map .first
            if data_names.length == 0 then '{"data":[],"axis":{},"is_multi_series":false,"get_row_method":"get_row","x_value_type":"Integer","error_message":"At least one numeric (other than X) must be provided for a scatter plot."}' else
                merged = with_row_number.select_columns core_sources+data_names
                ## Bound Data
                bounded = if bounds.is_nothing then merged else
                    x_filtered = merged.filter_between x (bounds.at 0) (bounds.at 1)
                    if data_names.length != 1 then x_filtered else
                        x_filtered.filter_between data_names.first (bounds.at 2) (bounds.at 3)
                ## Limit the number of rows to be visualized.
                limited = if limit.is_nothing || bounded.row_count<=limit then bounded else
                    bounded.sample limit Chart_Limits.chart_sample_seed
                ## Create the JSON for the data rows
                field_names = ["x"] + (core_names.drop 1 . map c-> c.to_case ..Lower) + ["y"] + (1.up_to data_names.length . map i-> "(y_multi " + (i-1).to_text + ")")
                merged_names = [x] + core_names.drop 1 + data_names
                name_map = merged_names.zip field_names
                filtered = name_map.take 1 + name_map.drop core_names.length
                axes_json = '{' + ((filtered.map p-> p.second.to_json + ':{"label":' + p.first.to_json + '}') . join ',') + '}'
                data_json = "[" + (limited.rename_columns field_names . rows_json . join ',') + "]"
                '{"data":' + data_json + ',"axis":' + axes_json + ',"is_multi_series":' + (data_names.length > 1).to_json + ',"get_row_method":"get_row","x_value_type":"' + x_kind.display_name + '","error_message":null}'

## ---
   private: true
   ---
   Default preprocessor for the scatter-plot visualization.
   Generates JSON text describing the scatter-plot visualization.

   ## Arguments
    - `value`: the value to be visualized.
process_to_json_text : Any -> Integer | Nothing -> Integer | Nothing -> Text
process_to_json_text value bounds=Nothing limit=Nothing = time_visualization Scatter_Plot ("process_to_json_text: " + (short_display value)) <|
    case value of
        _ : Vector -> json_from_vector value bounds limit
        _ : Array -> json_from_vector value bounds limit
        _ ->
            vt = Viz_Table.from value
            if vt.column_names.is_empty then json_from_vector value.to_vector bounds limit else
                ## A database reads at most `limit` rows (15000 when there is no limit) before anything else, as before.
                json_from_viz_table (Chart_Limits.local_rows vt (limit.if_nothing Chart_Limits.chart_row_bound)) bounds limit
```

Notes for the implementer, each mirrors `develop`'s `json_from_table`:

- `merged` must have the same columns in the same order as `develop`'s
  `core_table.zip (Table.new data_columns)`: `x`, the matched
  shape/label/size, the colour column, the row-number column, then the data
  columns. When `color` was matched under another name (`Colour`), `develop`
  copied it as `color`; selecting the source column and renaming it to
  `color` through `field_names` yields the same JSON keys. Row JSON keys come
  from `field_names`, which are what `develop` renamed to.
- `develop`'s `data_columns` excluded `core_table.column_names` (which hold
  `"color"`, not the source name), so a numeric column named `Colour` stays a
  data column there and here (`core_names` holds `"color"`).
- The pathological case where the colour or row-number column is to the
  **left** of `x` (then `develop`'s `get 1` picks `x` itself) duplicates a
  column there and cannot here; it is not pinned and is accepted.

- [ ] **Step 3: Run**

Rebuild; run `Visualization_Tests` filtered to `scatter` and then
`Scatter Plot`. Expected: every `Pinned scatter …` golden and the existing
`Scatter_Plot_Spec` pass. A failing golden means the rewrite differs: diff the
actual JSON (print it in a scratch test) against the file before changing
anything else. Never regenerate a golden in this step.

- [ ] **Step 4: Commit** — `git add distribution/lib/Standard/Visualization`,
      message `Scatter plot reads Viz_Table`.

### Task 4.2: Histogram with its bound

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Histogram.enso`
- Test: `test/Visualization_Tests/src/Histogram_Spec.enso`

- [ ] **Step 1: Write the failing bound test** — append to
      `Histogram_Spec.enso`'s group:

```enso
        group_builder.specify "reads at most 15000 values of a large table" <|
            table = Table.new [["value", 0.up_to 20000 . to_vector]]
            json = Histogram.process_to_json_text table . parse_json
            json.get "data" . get "values" . length . should_equal 15000
```

Run filtered to `reads at most`; expected: FAIL (20000 values).

- [ ] **Step 2: Rewrite** — replace `from_table` and `from_value` and the
      imports (`Update`, `from_vector`, `process_to_json_text` stay):

```enso
from Standard.Base import all

import project.Helpers
import project.Internal.Chart_Limits
import project.Internal.Names
import project.Viz_Table.Viz_Table
from project.Helpers import time_visualization, short_display

## ---
   private: true
   ---
   Plots the column named 'value' (any case), else the first numeric column,
   reading at most 15000 values.
from_viz_table : Viz_Table -> Update
from_viz_table vt =
    names = vt.column_names
    by_name = Names.find_insensitive names ["value"]
    first_numeric = names.zip vt.column_kinds . find if_missing=Nothing (p-> p.second.is_numeric)
    chosen = if Nothing != by_name then by_name else
        if Nothing == first_numeric then Nothing else first_numeric.first
    if Nothing == chosen then Update.Value [] Nothing else
        bound = Chart_Limits.chart_row_bound
        local = Chart_Limits.local_rows (vt.select_columns [chosen]) bound
        bounded = if local.row_count <= bound then local else local.sample bound Chart_Limits.chart_sample_seed
        Update.Value (bounded.column_values chosen) chosen

## ---
   private: true
   ---
from_value : Any -> Update
from_value value =
    case value of
        _ : Vector -> from_vector value
        _ ->
            vt = Viz_Table.from value
            if vt.column_names.is_empty then from_vector value.to_vector else from_viz_table vt
```

- [ ] **Step 3: Run** — the new test passes; all `Pinned histogram …`
      goldens pass unchanged (they are all under the bound); `Histogram_Spec`
      passes. Commit: `Histogram reads Viz_Table, at most 15000 values`.

### Task 4.3: Geo map, spatial layers and SQL

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Geo_Map.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/SQL/Visualization.enso`
- Modify: `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Viz_Source.enso`

- [ ] **Step 1: Geo map** — `name_sets` becomes public (drop `private`, add
      `## --- private: true ---`) so Database can use it. Replace the imports,
      `json_from_table`, `json_from_spatial_table` (moves to Database, step 2)
      and `process_to_json_text`:

```enso
from Standard.Base import all

import project.Helpers
import project.Internal.Chart_Limits
import project.Internal.Names
import project.Viz_Table.Viz_Table
from project.Helpers import time_visualization, short_display

## ---
   private: true
   ---
   The column names the geo map recognises, by role; the first is the role.
name_sets = [['label', 'name'], ['latitude', 'lat', 'lt'], ['longitude', 'lon', 'lng', 'long'], ['radius', 'size'], ['color', 'colour']]

## ---
   private: true
   ---
   Construct JSON describing the geo map of a table.
json_from_viz_table : Viz_Table -> JS_Object
json_from_viz_table vt =
    names = vt.column_names
    pairs = name_sets.map set->
        found = Names.find_insensitive names set
        if Nothing == found then Nothing else ["df_" + set.first, vt.column_values found]
    JS_Object.from_pairs <| pairs.filter ..Not_Nothing

## ---
   private: true
   ---
   Default preprocessor for the geo map visualization, generating JSON text
   describing the geo map visualization.

   ## Arguments
    - `value`: the value to be visualized.
process_to_json_text : Any -> Text
process_to_json_text value = time_visualization Geo_Map ("process_to_json_text: " + (short_display value)) <|
    vt = Viz_Table.from value
    if vt.supports "spatial" then vt.spatial_layers_json else
        if vt.column_names.is_empty then value.to_json else
            json_from_viz_table (Chart_Limits.local_rows vt Chart_Limits.chart_row_bound) . to_text
```

`develop`'s `json_from_table` selected `["X"]+set` with `reorder=True` after
adding a column `X`, then took the second column: that is the first table
column matching the earliest name in the set, which `find_insensitive`
returns. An in-memory table is read whole, as before; only a database table
is sampled (first 15000 rows, as before).

A `Vector` today reached `_ -> value.to_json`; it now converts to a
view-only `Viz_Table` (no columns) and reaches the same `value.to_json`.

- [ ] **Step 2: Spatial layers in Database** — in `DB_Viz_Source.enso` add
      `import Standard.Visualization.Geo_Map` and the method (the body is
      `develop`'s `json_from_spatial_table` with `table` → `self.spatial` and
      `_name_sets` → `Geo_Map.name_sets`):

```enso
    spatial_layers_json self -> Text =
        table = self.spatial
        spatial_columns = table.spatial_columns.map .name
        materialised = table.read_as_geojson (..First 5000)
        with_known = materialised.set "X" as="X"
        pairs = Geo_Map.name_sets.fold [["X","X"]] current->set->
            chosen = with_known.select_columns ["X"]+set reorder=True case_sensitivity=..Insensitive error_on_missing_columns=False on_problems=..Ignore
            if chosen.column_count == 1 then current else current + [[set.first, chosen.at 1 . name]]
        selected_columns = with_known.select_columns (pairs.map .second) reorder=True . rename_columns (pairs.map .first)
        base_layer = if (Nothing == (selected_columns.get "latitude") || Nothing == (selected_columns.get "longitude")) then [] else
            with_out_x = selected_columns.remove_columns ["X"]
            [with_out_x.rows.map .to_json . join "," '{"type": "Scatterplot_Layer", "layerName": "_points_", "data": [' "]}"]
        layers = base_layer + spatial_columns.map col-> '{"type": "GeoJsonLayer", "layerName": ' + col.to_json + ',"data":[' + (materialised.get col . to_vector . join ",") + ']}'
        '{"layers":[' + layers.join "," + ']}'
```

No test database here supports `Spatial`, so this path has no golden; it is
moved verbatim. Say so in the PR description.

- [ ] **Step 3: SQL** — `SQL/Visualization.enso` becomes:

```enso
from Standard.Base import all
import Standard.Base.Errors.Common.No_Such_Conversion
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument

import project.Helpers
import project.SQL_Viz.SQL_Viz
from project.Helpers import time_visualization, short_display

## ---
   private: true
   ---
   Prepares a database value for the SQL visualization: its SQL text and, for
   each interpolation, its value and Enso type name.

   ## Arguments
    - `table`: The database table or column to prepare for visualization.
prepare_visualization : Any -> Text
prepare_visualization table = time_visualization Visualization ("prepare_visualization: " + (short_display table)) <|
    sql = Panic.catch No_Such_Conversion (SQL_Viz.from table) _->
        Error.throw (Illegal_Argument.Error "This value has no SQL to show.")
    sql.to_json_text
```

- [ ] **Step 4: Run** — rebuild; `Visualization_Tests` unfiltered (every
      golden unchanged, `Geo_Map_Spec`, `SQL_Spec` pass), `SQLite_Tests`,
      `DuckDB_Tests`.

- [ ] **Step 5: The layering check**

```bash
git grep -nE "^(import|from) Standard\.(Table|Database|[A-Z][A-Za-z_]*)" -- distribution/lib/Standard/Visualization/0.0.0-dev/src | grep -v "Standard\.Base"
git grep -n "Visualization" -- distribution/lib/Standard/Base/0.0.0-dev/src
```

Expected: no output from either. If the first lists a module, finish moving
its Table/Database code before continuing.

- [ ] **Step 6: Docs, guide, commit** — regenerate API docs for Visualization
      and Database, run `stdlib-api-check`; in Visualization's `CLAUDE.md`
      add "How to add a chart: read `Viz_Table` (`Chart_Limits.local_rows`
      first); add a data type only when the chart needs something a table
      cannot give." Commit `Geo map and SQL view read Visualization's data types;
  Visualization depends only on Base` and open the PR with
      `CI: No changelog needed`.

---

## Step 5 — Availability by type in the GUI (PR 5, changelog entry)

A chart with a data type is offered when one of the value's types (visible
or hidden) has a conversion to that type, other than the `Any` catch-all. The
table view keeps its static `inputType` (`Any`), the SQL view keeps
`DB_Table | DB_Column` (spec §6).

### Task 5.1: The conversion index and the matching rule

**Files:**

- Modify: `app/gui/src/providers/openedProjects/suggestionDatabase/index.ts`
- Modify: `app/gui/src/project-view/stores/visualization/runtimeTypes.ts`
- Modify: `app/gui/src/project-view/stores/visualization/metadata.ts`
- Test: `app/gui/src/project-view/stores/visualization/__tests__/metadata.test.ts`

**Interfaces:**

- Produces: `SuggestionDb.conversionSources: ReactiveIndex` mapping a target
  type's `ProjectPath.key()` to the keys of the source types of its
  `from (that:…)` conversions; `VisualizationModule.dataType?: string`;
  `visualizationsForTypes(metadata, typeKeys, conversionSources) -> VisualizationId[]`.

- [ ] **Step 1: Write the failing test** (append to `metadata.test.ts`):

```ts
test("a visualization with a data type is offered for types that convert to it", () => {
  const db = new VisualizationMetadataDb();
  const scatter = toVisualizationId({
    module: { kind: "Builtin" },
    name: "Scatter Plot",
  });
  const table = toVisualizationId({
    module: { kind: "Builtin" },
    name: "Table",
  });
  db.set(scatter, {
    name: "Scatter Plot",
    dataType: "Standard.Visualization.Viz_Table.Viz_Table",
  });
  db.set(table, { name: "Table", inputType: "Standard.Base.Any.Any" });
  const vizTable = parseAbsoluteProjectPathRaw(
    "Standard.Visualization.Viz_Table.Viz_Table",
  );
  const tableType = parseAbsoluteProjectPathRaw("Standard.Table.Table.Table");
  const any = parseAbsoluteProjectPathRaw("Standard.Base.Any.Any");
  const intType = parseAbsoluteProjectPathRaw(
    "Standard.Base.Data.Numbers.Integer",
  );
  assert(vizTable.ok && tableType.ok && any.ok && intType.ok);
  const sources = (target: string) =>
    target === vizTable.value.key()
      ? new Set([tableType.value.key(), any.value.key()])
      : undefined;

  expect(visualizationsForTypes(db, [tableType.value.key()], sources)).toEqual([
    table,
    scatter,
  ]);
  // The `Any` catch-all does not offer a chart for every value.
  expect(visualizationsForTypes(db, [intType.value.key()], sources)).toEqual([
    table,
  ]);
});
```

Imports to add: `assert` from `vitest`, `parseAbsoluteProjectPathRaw` from
`@/util/projectPath`, `visualizationsForTypes` from
`@/stores/visualization/metadata`.

Run `corepack pnpm --filter enso-gui test:unit -- src/project-view/stores/visualization/__tests__/metadata.test.ts`;
expected: FAIL (`visualizationsForTypes` is not exported; `dataType` is not a
field).

- [ ] **Step 2: `runtimeTypes.ts`** — in the `VisualizationModule` zod
      object, next to `inputType`, add
      `dataType: z.string().optional(),` with a comment: "The Enso type the
      visualisation's preprocessor reads (`Standard.Visualization.*`); the
      visualisation is offered for every value whose type converts to it."

- [ ] **Step 3: `metadata.ts`**

```ts
export type VisualizationMetadata = Pick<
  VisualizationModule,
  "name" | "inputType" | "dataType" | "icon"
>;
```

In `VisualizationMetadataDb`, a visualisation with a `dataType` and no
`inputType` has no static types (otherwise `getTypesFromUnion` would make it
`Any`):

```ts
visualizationIdToType = new ReactiveIndex(this, (key, metadata) =>
  metadata.inputType == null && metadata.dataType != null
    ? []
    : getTypesFromUnion(metadata.inputType).map((type) => [key, type]),
);
```

and add:

```ts
/**
 * The visualizations offered for a value whose types (visible and hidden) have the keys `typeKeys`:
 * those whose static input type matches one of them or `Any`, then those whose data type one of
 * them converts to. A conversion from `Any` (a catch-all) does not count, so a chart is not offered
 * for every value.
 */
export function visualizationsForTypes(
  metadata: VisualizationMetadataDb,
  typeKeys: readonly string[],
  conversionSources: (targetKey: string) => ReadonlySet<string> | undefined,
): VisualizationId[] {
  const result = new Set<VisualizationId>([
    ...typeKeys.flatMap((key) => [
      ...(metadata.visualizationIdToType.reverseLookup(key) ?? []),
    ]),
    ...(metadata.visualizationIdToType.reverseLookup(ANY_TYPE_QN) ?? []),
  ]);
  for (const [id, meta] of metadata.entries()) {
    if (meta.dataType == null) continue;
    const target = parseAbsoluteProjectPathRaw(meta.dataType);
    if (!target.ok) continue;
    const sources = conversionSources(target.value.key());
    if (
      sources != null &&
      typeKeys.some((key) => key !== ANY_TYPE_QN && sources.has(key))
    ) {
      result.add(id);
    }
  }
  return [...result];
}
```

If `ReactiveDb` has no `entries()`, iterate `metadata.keys()` and
`metadata.get(id)`; check `app/gui/src/project-view/util/database/reactiveDb.ts`.
`ANY_TYPE_QN` must compare with type **keys**: if `ANY_TYPE_QN` is not a key,
use `ANY_TYPE.key()` (both are exported from `@/util/ensoTypes`).

- [ ] **Step 4: `SuggestionDb.conversionSources`** — in
      `suggestionDatabase/index.ts`, next to `methodOnTypeIndex`:

```ts
  /**
   * Conversion methods `Target.from (that:Source)`: the target type's key to the keys of its source
   * types. Visualizations use it to offer a chart for every type that converts to its data type.
   */
  readonly conversionSources = new ReactiveIndex(this, (_id, entry): [string, string][] => {
    if (entry.kind !== SuggestionKind.Method || entry.name !== 'from' || entry.selfType == null)
      return []
    const that = entry.arguments[0]
    if (that == null || that.name !== 'that') return []
    const source = parseAbsoluteProjectPathRaw(that.reprType)
    return source.ok ? [[entry.selfType.key(), source.value.key()]] : []
  })
```

Add a test in `suggestionDatabase`'s `__tests__` (create
`conversionSources.test.ts`) using `SuggestionDb.createMock` with one
`Viz_Table.from (that:Standard.Table.Table.Table)` entry and one unrelated
method, built with the entry factories the existing tests in that directory
use; assert `db.conversionSources.lookup(<Viz_Table key>)` is the set with
the Table key.

- [ ] **Step 5: Run** both tests; expected PASS. Commit
      (`GUI: index conversions; offer a visualization by its data type`).

### Task 5.2: Wire it in

**Files:**

- Modify: `app/gui/src/project-view/stores/visualization/index.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor.vue`
- Modify: `app/gui/src/project-view/components/visualizations/ScatterplotVisualization.vue`
- Modify: `app/gui/src/project-view/components/visualizations/GeoMapVisualization.vue`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: The store** — the factory takes the suggestion database:
      `(proj: ProjectStore, suggestionDb?: SuggestionDb) =>`; the builtin
      loop also copies `dataType`; `byType` becomes:

```ts
function* byType(
  typeInfo: Opt<TypeInfo>,
): IterableIterator<VisualizationIdentifier> {
  const types =
    typeInfo == null
      ? []
      : [...(typeInfo?.visibleTypes ?? []), ...(typeInfo?.hiddenTypes ?? [])];
  const vizzes =
    types.length === 0
      ? metadata.keys()
      : visualizationsForTypes(
          metadata,
          types.map((type) => type.key()),
          (target) => suggestionDb?.conversionSources.lookup(target),
        );
  for (const viz of vizzes) yield fromVisualizationId(viz);
}
```

`GraphEditor.vue`: `provideVisualizationStore(projectStore, suggestionDb.entries)`.
Find any other `provideVisualizationStore(` call (tests, mocks) with
`git grep -n "provideVisualizationStore("` and leave them without the second
argument (it is optional).

- [ ] **Step 2: The two charts** — in `ScatterplotVisualization.vue` and
      `GeoMapVisualization.vue` replace `export const inputType = …` with
      `export const dataType = 'Standard.Visualization.Viz_Table.Viz_Table'`.

- [ ] **Step 3: Check** `corepack pnpm --filter enso-gui typecheck`,
      `corepack pnpm --filter enso-gui lint`,
      `corepack pnpm --filter enso-gui test:unit`. Expected: clean, all pass.

- [ ] **Step 4: Check in the IDE** (build with `ide-local` or run the dev
      GUI against a built engine): a Table offers Table, Scatter Plot, Geo Map
      (as before); a DuckDB table also offers SQL Query; a Vector offers
      Scatter Plot (as before) and now Geo Map; an Integer offers neither
      chart; a DuckDB **connection** now offers Scatter Plot and Geo Map,
      which show their empty state. If a Table offers no chart, the language
      server did not send `Viz_Table.from` entries: check
      `suggestionDb.conversionSources` in the devtools before anything else.
      Attach before/after screenshots of the picker for a Table and a Vector
      to the PR (standing rule for UI PRs).

- [ ] **Step 5: Changelog** — under `# Next Release` / `#### Enso IDE`:

```markdown
- [Charts are offered for every value whose library can draw them, not a
  fixed list of types.][NNN]
```

with the link definition `[NNN]: https://github.com/jdunkerley/enso/pull/NNN`
(the PR's number).

- [ ] **Step 6: Commit and open the PR** (no label; it has an entry):
      `GUI: offer charts by data type`.

---

## Self-review against the spec

- §1 pattern, public-type rule: Tasks 3.1, 3.3 (conversions on `Table`,
  `Column`, `Row`; implementations; `No_Such_Conversion`).
- §2 `Viz_Table` contract, in-memory implementation, conversions table:
  Tasks 2.1, 3.1–3.4 (contract extended, see the spec's "Changed while
  planning").
- §3 `SQL_Viz`: Tasks 2.2, 3.3, 4.3.
- §4 charts: Tasks 4.1–4.3; heatmap needs no change (it uses the table view,
  already bounded at 1000 rows).
- §5 moves and deletions: Tasks 3.2 (lazy table, Helpers), 3.4 (Base,
  libraries), cell rendering 2.2/3.1/3.2, Java callback unchanged.
- §6 availability: Tasks 5.1, 5.2 (SQL keeps its static type).
- §7 layering note and grep: Tasks 3.5, 4.3 Step 5.
- Verification: goldens (1.1) for "JSON unchanged", database bounded reads
  (3.3 Step 4, 4.1, 4.2), cells without the import (3.4 Step 4), layering
  grep (4.3), `stdlib-api-check` (2.3, 3.4, 4.3), IDE check (5.2).
