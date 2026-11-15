# One Data Format for the Table Visualisation (Spec B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the twelve JSON shapes the table visualisation receives with
one format, written by one Enso writer in `Standard.Visualization` and read by
one zod schema in the GUI, without changing what any value shows.

**Architecture:** PR B0 freezes today's behaviour: it extracts the GUI's
`refresh()` logic into a pure module (`TableVisualization/tableView.ts`) and
snapshots what it makes of every pinned golden (column definitions, link
tooltips, the node each link creates, rows, row counts, digit grouping, flags).
PR B1 switches both sides at once: Java keeps the cells, the per-column metrics
piece and the version id; Enso's `Internal/View_Json.enso` assembles every
message; the GUI parses with zod. The B0 snapshot must not change. PR B2 deletes
what B1 left unused.

**Tech Stack:** Enso standard library (`distribution/lib/Standard/*`), Java
(`std-bits/table`), the Enso test framework and golden files (`expect_pinned`),
TypeScript/Vue 3 with AG Grid Community and zod 3 in `app/gui`, vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-table-viz-one-format-design.md`
(binding). Read it first, then "Spec gaps resolved while planning" below: the
plan departs from the spec's text in the places listed there, each to keep a
view exactly as it is today.

## Global Constraints

- **Every value renders exactly as it does today** (owner decision, 2026-11-14):
  the same columns, link columns, index column, tooltips, metrics, filters, row
  data, and the same node text when a link is double-clicked.
- **The gate:** the B0 snapshot file
  `app/gui/src/project-view/components/visualizations/__tests__/__snapshots__/tableViewSnapshot.test.ts.snap`
  is unchanged by B1 except its `table_db_read_error` entry (the one intended
  fix). Any other difference is a visible change: B1 does not merge with one.
- One format for all three table viz messages (view, server row page, distinct
  values); one writer, `Standard.Visualization.Internal.View_Json`.
- **Link templates are always explicit**: `{{#field}}` inserts the row's value
  of `field`, as a number when it reads as one; `{{@field}}` inserts it as it
  is; `{{#index}}` is the row number. The GUI no longer completes a bare action.
- Performance rules (spike, 2026-11-14): Enso loops per column, never per cell
  or per metric key on the table path; it joins with `Vector.join`. The
  in-memory view is cached by table version above the display-type computation
  and not cached while any column's metrics are incomplete. Each spike case must
  be within 10% of `develop` or faster (B0.4 records the baseline).
- Visualization imports only `Standard.Base`. Libraries import Visualization,
  never the reverse.
- Every entity added in a **non-private** module carries `## ---` /
  `private: true` / `---` doc metadata.
- An unused argument is silenced with `_ = that` on its own line.
- No unused imports: the `-Werror` lint fails on them. After deleting code,
  remove each import the file no longer uses.
- Goldens: every `table_*` and `ssrm_*` file is regenerated in the new format;
  `scatter_*`, `geo_*`, `sql_*`, `default_*` are unchanged; `data_*` are
  unchanged except the date field order in `data_mem_table.json` (gap 2).
- Fixes only outright bugs: a database read error shows as an error, not an
  empty grid. The other recorded differences are listed under the gaps.
- Changelog: B0 and B2 take the `CI: No changelog needed` label. B1 adds one fix
  line under `#### Enso IDE` (no label).
- Merge gates: B0 and B2 merge on green. B1 waits for the owner's installer
  check (a large switch) before merging.
- Never `git stash`.

## Spec gaps resolved while planning

Each was found by reading today's code against the spec; the plan resolves it as
stated. Record them in the B1 PR description.

1. **Row numbers of a server page.** The spec makes them `start + i` and stops
   sending the index. Today the server adds the row number _before_ sorting and
   filtering (`In_Memory_Viz_Source.server_rows_json`), so a sorted or filtered
   page shows each row's original number (`ssrm_rows_sorted.json` has
   `[2,1,0]`), and `get_row {{#index}}` on it gets the right row. `start + i`
   would show `0,1,2` and get the wrong row. The page keeps the numbers:
   `{"row_count":N,"index":[…],"data":[[…],…]}`. `start` is dropped (the index
   carries it).
2. **`data_mem_table.json` changes.** Spec §2 reorders Java's display-text cell
   writer (`_display_text_` first), and the JSON view of an in-memory table
   (`Viz_Json.from (that:Table)`, spec A) uses that writer (`to_json_data`). Its
   dates change field order (same values). B1.1 regenerates it; nothing else in
   `data_*` changes.
3. **`version_hash` is not only for the server mode.** The GUI keys the grid on
   it (`gridIdHash`) for every in-memory view, paged or not. It is a top-level
   optional field; `server` becomes `"server": true` when the server pages.
4. **`row_count` is optional.** Today a `from_columns` grid (connections, Excel,
   `Send_Response`), a single value and an error send no row count, and the IDE
   shows none. The writer omits it for them.
5. **Sorting a partial view.** Today only a vector, matrix or object-matrix view
   turns sorting and filtering off (and says so) when it holds fewer rows than
   the value has; a partial database table or dictionary does not. The writer
   says which with `"options":{"disable_sort_when_partial":true}`.
6. **Digit grouping (`number_format`).** Today's GUI decides grouping from the
   values only for dictionary, row, XML and matrix views; for a `from_columns`
   grid, a vector's `Value` column and object-matrix columns an indexing slip
   (`Object.keys` of an array) leaves it off. The writer sends
   `"number_format": false` for those columns and omits it where the GUI decides
   from the values; tables send Java's value as today.
7. **Absent cells.** Column-major data cannot leave a cell out, but a short row
   of a vector of vectors (or a `Nothing` row, or an object-matrix row lacking a
   key) shows an empty cell today, not `Nothing`. The writer sends
   `{"_missing_":true}` for such a cell; the GUI turns it back into an empty
   cell.
8. **Per-column metrics** are `{"name","value","type"}` (one value per column),
   not the spec sketch's `values: []`. The GUI applies today's filtering (drop
   `null` and 0 %).
9. **Object-matrix column order.** Today a row object's keys reach the GUI
   through `JSON.parse`, which puts integer-like keys first. The writer orders
   each row's keys the same way, so the columns keep their order.
10. **Bare actions in `from_columns` users.** Connections (`"query"`), Excel and
    Google workbooks (`"read"`) pass bare actions. Their libraries now pass
    `query {{@Table}}` and `read {{@worksheets}}`, which the GUI turned the bare
    action into.
11. **The writer must be public.** `Internal/View_Json.enso` is a `private`
    module; Table, Database and XML call it. B1.2 drops `private` from it (its
    entities are `private: true`, as `Internal/Names.enso`'s are).
12. **`column_metrics_json` also carries the value type.** Visualization cannot
    compute `value_type.to_display_text` (it does not import Table), so each
    fragment is
    `"value_type":{…},"metrics":[…],"multi_filter":…,"number_format":…`. The
    optional methods are a capability, `"view_pieces"`, as every optional
    `Viz_Table` method is.
13. **Distinct values `null`.** When a column has too many distinct values to
    list, today sends `null` and the GUI passes it on; `"values": null` keeps
    that.
14. **`index` in a template** always means the row number (a column named
    `index` cannot be referenced by a template; no producer does).
15. **A vector of empty vectors** has no columns, so it shows no rows (today:
    one row per vector holding only its number). Degenerate; recorded.
16. **A payload that is not a table view message.** While the visualisation is
    switched, the component can briefly receive another visualisation's data.
    Today a non-object shows as a single value (the _first_ value the component
    received: a stale copy) and an object as an empty grid. B1: a non-object
    shows as a single value (the current one), an object without a `kind` as an
    empty grid, and only a message with a `kind` that fails the schema shows the
    zod error.
17. **Column order after moving columns.** Today only table, dictionary, row and
    XML views know their column names for "is the column order changed"; B1
    knows them for every grid, so moving a matrix's columns back to their order
    clears the "reordered" state. Not in the snapshot; recorded.
18. **Two more goldens in B0.** No golden covers a paged view (`data: null`) or
    the database read error, so B0 pins both (`table_mem_server_table`,
    `table_db_read_error`) from today's code.

## Working environment

- Windows worktrees, one per PR: B0 in `C:\Repos\Enso\ide-viz-b0` (branch
  `viz/table-format-b0` from `origin/develop`); B1 in `C:\Repos\Enso\ide-viz-b1`
  (branch `viz/table-format-b1` from `origin/develop` once B0 and spec A's #763
  have merged); B2 in `C:\Repos\Enso\ide-viz-b2` (branch `viz/table-format-b2`
  from `origin/develop` once B1 has merged). Never `git stash`.
- Enso builds and tests run in the WSL clone `~/vizwork2`. First time only:

  ```bash
  wsl -e bash -lc 'git clone /mnt/c/Repos/Enso/ide ~/vizwork2'
  ```

  Before each build, sync the worktree into it (replace `<wt>` with the worktree
  folder name and `<branch>` with its branch). The clone's `origin` is the
  Windows checkout, whose local `develop` is stale, so fetch the branch ref
  itself, never `origin/develop`:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork2 && git fetch -q /mnt/c/Repos/Enso/ide refs/heads/<branch> && git checkout -qf FETCH_HEAD && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/std-bits/ std-bits/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/distribution/lib/ distribution/lib/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/test/ test/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/engine/runtime-integration-tests/ engine/runtime-integration-tests/ && \
    rsync -a /mnt/c/Repos/Enso/<wt>/tools/ci/ tools/ci/ && \
    sbt buildEngineDistribution'
  ```

  `app/` is not synced: the clone sees only its **committed** state (this
  matters for the `table-vis-json` fixtures in B1.3).

- Run an Enso test project in `~/vizwork2`. `FILTER` is optional, and **a filter
  that matches nothing still exits 0**, so check the printed test count:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork2/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" FILTER'
  ```

  To (re)write golden files, prefix the command with `ENSO_UPDATE_PINNED=1`
  (each regenerated case then **fails** on purpose), copy the new files from
  `~/vizwork2/test/Visualization_Tests/data/pinned/` back to the worktree, and
  run again without it.

- `-Werror` lint, one directory per run (no `-ea`), in `~/vizwork2`:

  ```bash
  built-distribution/enso-engine-*/enso-*/bin/enso --enable-static-analysis --hide-progress -Werror --compile <dir>
  ```

- API docs: regenerate one library's committed `docs/api` in `~/vizwork2`, then
  copy the library's `docs/api/` folder back to the worktree:

  ```bash
  sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/<Lib>/0.0.0-dev"
  ```

  The local `stdlib-api-check` gives false differences on rsync'd files; CI runs
  it.

- GUI (Windows worktree, after `corepack pnpm install --frozen-lockfile` and
  `corepack pnpm -r compile`):
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`,
  `corepack pnpm --filter enso-gui run lint`, and Playwright with
  `corepack pnpm --filter enso-gui run test:integration -- <spec path>`
  (timing-sensitive: run a spec three times before reading a failure).
- Prettier's import organiser corrupts Vue SFCs only on Linux. After editing
  `TableVisualization.vue`, check it from WSL too:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd /mnt/c/Repos/Enso/<wt> && corepack pnpm exec prettier --check app/gui/src/project-view/components/visualizations/TableVisualization.vue'
  ```

---

## File structure

| File                                                                                     | PR      | Responsibility                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`     | B0 → B1 | The pure view model: data → column defs, rows, grouping, flags; row page; distinct values. B1 swaps in the parser. |
| `app/gui/src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts` | B0      | The gate: today's goldens through the real logic, snapshotted.                                                     |
| `app/gui/src/project-view/components/visualizations/__tests__/tableViewMessage.test.ts`  | B1      | The new parser's own cases (errors, missing cells, `{{#index}}`, pages).                                           |
| `app/gui/src/project-view/components/visualizations/TableVisualization.vue`              | B0, B1  | Owns state, AG Grid and the server calls; delegates to `tableView.ts`.                                             |
| `app/gui/src/project-view/components/visualizations/TableVisualization/CLAUDE.md`        | B0, B1  | What lives where, and the snapshot gate.                                                                           |
| `app/gui/integration-test/mock/tableView.ts`                                             | B1      | `matrixView` for the Playwright mocks.                                                                             |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Json.enso`          | B1      | The one writer: every view, row page and distinct-values message.                                                  |
| `std-bits/table/.../operation/TableVizOperation.java`                                    | B1      | Cells per column (kept), per-column view fragments and the incomplete check (added); `makeJSON` deleted.           |
| `std-bits/table/.../operation/unary/JsonOperation.java`                                  | B1      | Cell encoding: display text first; decimals and big integers gain one.                                             |
| `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Viz_Source.enso`       | B1      | The in-memory source: `view_pieces`, the version cache, the row page.                                              |
| `test/Visualization_Tests/src/Table_View_Benchmark_Spec.enso`                            | B0      | Timings of the spike's cases (not a CI gate).                                                                      |

---

## PR B0 — Snapshot today's table views (invisible)

### Task B0.1: Pin a paged view and a database read error

**Files:**

- Modify: `test/Visualization_Tests/src/Pinned_Spec.enso` (`Data` and the
  "Pinned table view JSON" group)
- Create: `test/Visualization_Tests/data/pinned/table_mem_server_table.json`,
  `table_db_read_error.json`

**Interfaces:**

- Produces: two goldens of today's output that B0.3 snapshots.

- [ ] **Step 1: Add a dropped database table to `Data`.** In `Pinned_Spec.enso`
      add the accessor after `cells_table`:

```enso
    db_gone_table self = self.data.at 10
```

In `setup`, after the `cells_table = …` line, add:

```enso
        ## A database table whose table is dropped after the reference is made:
           reading it fails, which the table view has to show.
        db_gone_table = (Table.new [["a", [1]]]).select_into_database_table connection "pinned_gone" temporary=True
        connection.drop_table "pinned_gone"
```

and append `db_gone_table` to the result vector
(`[mem_table, …, cells_table, db_gone_table]`).

- [ ] **Step 2: Add the two cases.** At the end of the "Pinned table view JSON"
      group add:

```enso
        table_view "mem_server_table" (warm data.big_table)
        table_view "db_read_error" data.db_gone_table
```

- [ ] **Step 3: Generate them on today's code.** Sync (`<wt>` `ide-viz-b0`,
      `<branch>` `viz/table-format-b0`), build, run `Visualization_Tests` with
      `ENSO_UPDATE_PINNED=1` and filter `Pinned table view JSON`. Copy
      `table_mem_server_table.json` and `table_db_read_error.json` back. Run
      again without it. Expected: all pass, and `git status` shows only the two
      new files and `Pinned_Spec.enso` (`table_connection.json` still lists
      `pinned` and `pinned_geo` only). Check by eye:
      `table_mem_server_table.json` has `"all_rows_count":20000`,
      `"is_using_server_sort_and_filter":true` and `"data":null`;
      `table_db_read_error.json` is
      `{"error":"Error querying the database:\n…"}` naming `pinned_gone`.

- [ ] **Step 4: Lint and commit.** Run the `-Werror` lint on
      `test/Visualization_Tests` (expected: no warnings), then:

```bash
git add test/Visualization_Tests
git commit -m "Visualization tests: pin a paged table view and a database read error"
```

### Task B0.2: Extract the view model from `TableVisualization.vue`

A pure move: no behaviour changes. Every function below is moved verbatim except
where its dependency on component state becomes a parameter.

**Files:**

- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVisualisationTooltip.ts:2`
- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/CLAUDE.md`

**Interfaces:**

- Produces (B0.3 and B1.5 rely on these names and shapes):
  - `INDEX_FIELD_NAME = '#'`, `getSvgTemplate(icon: string): string`
  - `type Data`, `type DataQualityMetricValue`
  - `interface TableViewContext { isSSRM: boolean; getFilterValues: (params: SetFilterValuesFuncParams<any, string>) => Promise<void>; createNode: (pattern: Pattern<Ast.Expression>) => void; previousRowData: Record<string, any>[]; initialData: unknown }`
  - `interface TableView { columnDefs: ColDef[]; rowData: Record<string, any>[] | undefined; isTruncated: boolean | undefined; dataGrouping: Map<string, boolean>; rowCount: number; showRowCount: boolean }`
  - `interface TableViewFlags { allRowCount: number | undefined; versionHash: string | null | undefined; isSSRM: boolean; bottomStatusBarRequested: boolean; createNodeEnabled: boolean; columnNames: string[]; columnTypes: Map<string, string> }`
  - `buildTableView(value: unknown, ctx: TableViewContext): TableView`
  - `tableViewFlags(value: unknown): TableViewFlags`
  - `rowsFromPage(columnDefs: ColDef[], page: unknown): { rows: Record<string, any>[]; rowCount: number }`
  - `distinctValuesFromResponse(response: unknown): any`

- [ ] **Step 1: Create `tableView.ts`.**

```ts
/**
 * The table visualisation's view of the data `prepare_visualization` sends: the column
 * definitions and rows AG Grid receives, and the flags the component reads. Pure (the component
 * passes in what it owns), so that `__tests__/tableViewSnapshot.test.ts` can run it over the
 * pinned goldens in `test/Visualization_Tests/data/pinned`.
 */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";
import { svgUseHref } from "@/util/icons";
import type {
  CellDoubleClickedEvent,
  ColDef,
  ICellRendererParams,
  ITooltipParams,
  SetFilterValuesFuncParams,
} from "ag-grid-community";
import { TableVisualisationTooltip } from "./TableVisualisationTooltip";
import {
  isError,
  isGenericGrid,
  type Error,
  type GenericGrid,
} from "./TableVisualisationTypes";
import {
  getCellDataType,
  getFilterParams,
  getFilterType,
} from "./tableVizFilterSetUpUtils";
import type { ValueType } from "./tableVizUtils";

export const INDEX_FIELD_NAME = "#";

export type Data =
  | number
  | string
  | Error
  | Matrix
  | ObjectMatrix
  | EnsoTableOrColumn
  | GenericGrid;

interface Matrix {
  type: "Matrix";
  column_count: number;
  all_rows_count: number;
  json: unknown[][];
  value_type: ValueType[];
  get_child_node_action: string;
  child_label: string;
  visualization_header: string;
}

interface ObjectMatrix {
  type: "Object_Matrix";
  column_count: number;
  all_rows_count: number;
  json: object[];
  value_type: ValueType[];
  get_child_node_action: string;
  child_label: string;
  visualization_header: string;
}

interface EnsoTableOrColumn {
  type: "EnsoTableOrColumn";
  json: unknown;
  all_rows_count?: number;
  header: string[] | undefined;
  data: unknown[][] | undefined;
  value_type: ValueType[];
  has_index_col: boolean | undefined;
  links: string[] | undefined;
  get_child_node_action: string;
  get_child_node_link_name: string;
  child_label: string;
  visualization_header: string;
  data_quality_metrics?: DataQualityMetric[];
  is_using_server_sort_and_filter: boolean;
  use_bottom_status_bar: boolean;
  enable_create_node: boolean;
  requires_number_format: boolean[];
  is_using_multi_filter: boolean[];
  table_version_hash?: string;
}

type DataQualityMetricNumber = {
  name: string;
  values: (number | null)[];
  type: "Percentage" | "Count";
};

type DataQualityMetricText = {
  name: string;
  values: (string | null)[];
  type: "Text";
};

type DataQualityMetric = DataQualityMetricNumber | DataQualityMetricText;

export type DataQualityMetricValue =
  | {
      name: string;
      value: number;
      displayType: "Percentage" | "Count";
    }
  | {
      name: string;
      value: string;
      displayType: "Text";
    };

/** What `buildTableView` needs from the component. */
export interface TableViewContext {
  /** Whether the server sorts, filters and pages the rows. */
  isSSRM: boolean;
  /** Fetches a set filter's values from the server. */
  getFilterValues: (
    params: SetFilterValuesFuncParams<any, string>,
  ) => Promise<void>;
  /** Creates a node from a link's pattern; the pattern is applied to the visualised node. */
  createNode: (pattern: Pattern<Ast.Expression>) => void;
  /** The rows of the previous refresh: a server-side view keeps them. */
  previousRowData: Record<string, any>[];
  /** The data the component was created with: what a value that is not a JSON object shows. */
  initialData: unknown;
}

/** What a refresh gives AG Grid and the status bar. */
export interface TableView {
  columnDefs: ColDef[];
  /** `undefined`: keep the previous rows (the server-side row model). */
  rowData: Record<string, any>[] | undefined;
  /** `undefined`: keep the previous value. */
  isTruncated: boolean | undefined;
  /** Per column: whether its numbers group their digits. */
  dataGrouping: Map<string, boolean>;
  rowCount: number;
  showRowCount: boolean;
}

/** What the component reads from the data outside a refresh. */
export interface TableViewFlags {
  allRowCount: number | undefined;
  versionHash: string | null | undefined;
  isSSRM: boolean;
  bottomStatusBarRequested: boolean;
  createNodeEnabled: boolean;
  /** The column names that server-side requests index into. */
  columnNames: string[];
  /** Column name to its value type's constructor, for the filters. */
  columnTypes: Map<string, string>;
}

export const getSvgTemplate = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16"><use xlink:href="${svgUseHref(icon)}"/></svg>`;
```

Then append, **verbatim from `TableVisualization.vue`**, these functions, making
only the listed changes:

- `addRowIndex` (`.vue` 641-643): unchanged.
- `getValueTypeIcon` (645-664): unchanged.
- `toField` (666-777): signature becomes
  `function toField(name: string, options: { index?: number; valueType?: ValueType | null | undefined } = {}, data: Data, ctx: TableViewContext): ColDef`;
  every `props.data` becomes `data`; `isSSRM.value` becomes `ctx.isSSRM`;
  `getFilterValues` becomes `ctx.getFilterValues`.
- `ParsedActionTemplate`, `parseActionTemplate`, `isNumber`, `getAstPattern`
  (779-824): unchanged.
- `createNode` (826-846): becomes

```ts
/**
 * Creates a new node in the graph based on the given action template and data from a grid row.
 *
 * The action string should be of the format `at {{#fieldname}}` which will generate a Node `at 2`
 * or `at {{\@fieldname}}` which will generate a Node `at "2"`
 * If the action contains no placeholders then the defaultSelector is used like so
 * `action {{\@defaultSelector}}`
 */
function createNode(
  params: CellDoubleClickedEvent,
  defaultSelector: string,
  action: string,
  ctx: TableViewContext,
) {
  const pattern = getAstPattern(params, action, defaultSelector);
  if (pattern) ctx.createNode(pattern);
}
```

- `LinkFieldOptions`, `toLinkField` (848-872): `toLinkField` gains a last
  parameter `ctx: TableViewContext` and its double-click becomes
  `onCellDoubleClicked: (params) => createNode(params, fieldName, getChildAction, ctx),`.

Then add the rest of the module:

```ts
/** What a value that is not a JSON object shows: the value itself, in one cell. */
function defaultData(value: unknown) {
  return {
    type: typeof value,
    json: value,
    // eslint-disable-next-line camelcase
    all_rows_count: 1,
    data: undefined,
    header: undefined,
    // eslint-disable-next-line camelcase
    value_type: undefined,
    // eslint-disable-next-line camelcase
    has_index_col: false,
    links: undefined,
    // eslint-disable-next-line camelcase
    get_child_node_action: "",
    // eslint-disable-next-line camelcase
    get_child_node_link_name: undefined,
    // eslint-disable-next-line camelcase
    child_label: undefined,
    // eslint-disable-next-line camelcase
    visualization_header: undefined,
    // eslint-disable-next-line camelcase
    is_using_server_sort_and_filter: undefined,
    // eslint-disable-next-line camelcase
    requires_number_format: undefined,
  };
}

/** Rows from column-major `data`; the index column holds the row number (or, for a server page, `data[0]`). */
export function createRowsForTable(
  columnDefs: ColDef[],
  data: unknown[][],
  shift: number,
  isSSrm: boolean,
) {
  const rows = data && data.length > 0 ? (data[0]?.length ?? 0) : 0;
  const getIndexInfo = (i: number) => {
    return isSSrm ? data?.[0]?.[i] : i;
  };
  return Array.from({ length: rows }, (_, i) => {
    return Object.fromEntries(
      columnDefs.map((h, j) => {
        return [
          h.field,
          h.field === INDEX_FIELD_NAME
            ? getIndexInfo(i)
            : data?.[j - shift]?.[i],
        ];
      }),
    );
  });
}

/** The view of `value`, the data `prepare_visualization` sent. */
export function buildTableView(
  value: unknown,
  ctx: TableViewContext,
): TableView {
  const data = value as Data;
  // If the user switches from one visualization type to another, we can receive the raw object.
  const data_ = typeof data === "object" ? data : defaultData(ctx.initialData);
  let columnDefs: ColDef[] = [];
  let rowData: Record<string, any>[] | undefined = undefined;
  let isTruncated: boolean | undefined = undefined;
  // … the body of `refresh()` (`.vue` 912-1048), see below …
  const rowCount = data_.all_rows_count == null ? 1 : data_.all_rows_count;
  return {
    columnDefs,
    rowData,
    isTruncated,
    dataGrouping: headerGroupingMap,
    rowCount,
    showRowCount: !(data_.all_rows_count == null),
  };
}
```

The body is `refresh()`'s lines 912-1048 with these replacements and nothing
else: `columnDefs.value = X` → `columnDefs = X`; `columnDefs.value.push(` →
`columnDefs.push(`; `rowData.value = X` → `rowData = X`; `isTruncated.value = X`
→ `isTruncated = X`; `toField(a)` → `toField(a, {}, data, ctx)`;
`toField(v, { index: i, valueType })` →
`toField(v, { index: i, valueType }, data, ctx)`; `toLinkField(x, {…})` →
`toLinkField(x, {…}, ctx)`; `createRowsForTable(D, s, f)` →
`createRowsForTable(columnDefs, D, s, f)`; `props.data` → `data`; and before
`const headerGroupingMap = new Map()` insert
`const rows = rowData ?? ctx.previousRowData`, then use `rows` for the two reads
of `rowData.value` (`determineGrouping` and the `Object.keys(rowData.value[0])`
line). Lines 1050-1062 (paging and `defaultColDef`) stay in the component.

Finish the module with the flags, the page and the distinct values:

```ts
function columnTypes(data: Data): Map<string, string> {
  const colMap: Map<string, string> = new Map();
  if (typeof data === "object" && !("error" in data)) {
    const valueTypes = "value_type" in data ? data.value_type : [];
    const headers = "header" in data ? data.header : [];
    headers?.forEach((header, index) => {
      if (valueTypes[index]) {
        colMap.set(header, valueTypes[index].constructor);
      }
    });
  }
  return colMap;
}

/** What the component reads from `value` outside a refresh. */
export function tableViewFlags(value: unknown): TableViewFlags {
  const data = value as Data;
  const isObject = typeof data === "object";
  return {
    allRowCount: isObject && "all_rows_count" in data ? data.all_rows_count : 0,
    versionHash:
      isObject && "table_version_hash" in data ? data.table_version_hash : null,
    isSSRM: Boolean(
      isObject &&
      "is_using_server_sort_and_filter" in data &&
      data.is_using_server_sort_and_filter,
    ),
    bottomStatusBarRequested:
      isObject &&
      "use_bottom_status_bar" in data &&
      Boolean(data.use_bottom_status_bar),
    createNodeEnabled: Boolean(
      isObject && "enable_create_node" in data && data.enable_create_node,
    ),
    columnNames: isObject && "header" in data ? (data.header ?? []) : [],
    columnTypes: columnTypes(data),
  };
}

/** The rows of a server-side page (`get_rows_for_table`), for the view's `columnDefs`. */
export function rowsFromPage(
  columnDefs: ColDef[],
  page: unknown,
): { rows: Record<string, any>[]; rowCount: number } {
  const value = page as { rows: unknown[][]; row_count: number };
  return {
    rows: createRowsForTable(columnDefs, value.rows, 0, true),
    rowCount: value.row_count,
  };
}

/** A column's distinct values (`get_distinct_values_for_column`), for its set filter. */
export function distinctValuesFromResponse(response: unknown): any {
  return (response as { distinct_vals: unknown }).distinct_vals;
}
```

- [ ] **Step 2: Point the tooltip at the new module.** In
      `TableVisualisationTooltip.ts` replace
      `import type { DataQualityMetricValue } from '../TableVisualization.vue'`
      with `import type { DataQualityMetricValue } from './tableView'`.

- [ ] **Step 3: Slim down `TableVisualization.vue`.** In the first
      `<script lang="ts">` block:
  - delete lines 80-150 (`Data` … `DataQualityMetricValue`) and add, after the
    imports,
    `export type { DataQualityMetricValue } from './TableVisualization/tableView'`;
  - replace the imports of `TableVisualisationTooltip`,
    `./TableVisualization/TableVisualisationTypes` and
    `./TableVisualization/tableVizFilterSetUpUtils` with

```ts
import {
  buildTableView,
  distinctValuesFromResponse,
  getSvgTemplate,
  INDEX_FIELD_NAME,
  rowsFromPage,
  tableViewFlags,
  type Data,
} from "./TableVisualization/tableView";
```

- drop `svgUseHref`, `CellDoubleClickedEvent` and `ITooltipParams` from the
  imports and `type ValueType` from the `tableVizUtils` import.

In `<script setup>`:

- delete `const INDEX_FIELD_NAME = '#'` (181) and `getSvgTemplate` (210-211);
- change `const filteredRowCount = ref(null)` (187) to
  `const filteredRowCount = ref<number | null>(null)`;
- replace `allRowCount`, `tableVersionHash`, `isSSRM` (288-303) and
  `isCreateNewNodeEnabled` (313-318) with

```ts
const viewFlags = computed(() => tableViewFlags(props.data));

const allRowCount = computed(() => viewFlags.value.allRowCount);

const tableVersionHash = computed(() => viewFlags.value.versionHash);

const isSSRM = computed(() => viewFlags.value.isSSRM);
```

and, where `isCreateNewNodeEnabled` was,

```ts
const isCreateNewNodeEnabled = computed(
  () => viewFlags.value.createNodeEnabled,
);
```

- delete `createRowsForTable` (413-425);
- replace `getFilterValues` (427-453) with

```ts
async function getFilterValues(params: SetFilterValuesFuncParams) {
  const colName = params.colDef.field;
  const filters = params.api.getFilterModel();
  const columnHeaders = viewFlags.value.columnNames;
  const gridFilterModelList: Array<GridFilterModel> = filters
    ? makeFilterModelList(filters)
    : [];
  const { filterColumnIndexList, filterActions, valueList } =
    convertFilterModel(gridFilterModelList, columnHeaders, colTypeMap.value);
  const index = columnHeaders.findIndex((h: string) => colName === h);
  const server = ssrmServer.value;
  if (server) {
    const response = await server.getSetFilterValues(
      index,
      filterColumnIndexList,
      filterActions,
      valueList,
    );
    if (response.success) {
      params.success(response.data);
    }
  }
}
```

(the server exists only when `isSSRM`, which only a header-carrying table sets,
so the old `'header' in props.data` guard is implied);

- in `getSetFilterValues` replace `data: response.value.distinct_vals,` with
  `data: distinctValuesFromResponse(response.value),`;
- in `getData` replace
  `const columnHeaders = typeof props.data === 'object' && 'header' in props.data ? (props.data.header ?? []) : []`
  with `const columnHeaders = viewFlags.value.columnNames`, each
  `{ success: false, data: null, rowCount: undefined }` with
  `{ success: false, rows: [], rowCount: undefined }`, and the success path
  (from `filteredRowCount.value = …` to its `return`) with

```ts
const page = rowsFromPage(columnDefs.value, response.value);
filteredRowCount.value = page.rowCount;
return { success: true, rows: page.rows, rowCount: page.rowCount };
```

- replace `interface Response` and `createInfiniteDatasource` (572-598) with

```ts
interface Response {
  rows: Record<string, any>[];
  success: boolean;
  rowCount: number | undefined;
}

function createInfiniteDatasource(): IDatasource {
  return {
    getRows: async (params: IGetRowsParams) => {
      const server = ssrmServer.value;
      if (server) {
        const serverResponse = await server.getData(params);
        const response: Response = serverResponse
          ? serverResponse
          : { rows: [], success: false, rowCount: 0 };
        if (response.success) {
          params.successCallback(response.rows, response.rowCount);
        } else {
          // The Infinite Row Model has no failed-load visual state to hook into and
          // `params.failCallback()` is a no-op here, so settle the grid to visibly empty rather
          // than leaving it spinning forever.
          params.successCallback([], 0);
        }
      }
    },
  };
}
```

- delete `addRowIndex` through `DEFAULT_DATA` (641-898);
- replace `refresh()` (908-1063) with

```ts
// The data the component was created with: what a value that is not a JSON object shows.
const initialData = props.data;

// Update state computed from the input `data`.
function refresh() {
  const view = buildTableView(props.data, {
    isSSRM: isSSRM.value,
    getFilterValues,
    createNode: (pattern) =>
      config.createNodes({ content: pattern, commit: true }),
    previousRowData: rowData.value,
    initialData,
  });
  columnDefs.value = view.columnDefs;
  if (view.rowData !== undefined) rowData.value = view.rowData;
  if (view.isTruncated !== undefined) isTruncated.value = view.isTruncated;
  dataGroupingMap.value = view.dataGrouping;
  rowCount.value = view.rowCount;
  showRowCount.value = view.showRowCount;
  const newPageLimit = Math.ceil(view.rowCount / rowLimit.value);
  pageLimit.value = newPageLimit;
  if (page.value > newPageLimit) {
    page.value = newPageLimit;
  }

  // If data is truncated, we cannot rely on sorting/filtering so will disable.
  defaultColDef.value.filter = !isTruncated.value;
  defaultColDef.value.sortable = !isTruncated.value;
}
```

- replace `colTypeMap` (1065-1077) with
  `const colTypeMap = computed(() => viewFlags.value.columnTypes)`;
- in `onColumnStateChange` replace the `defaultColOrder` expression with
  `const defaultColOrder = viewFlags.value.columnNames`.

- [ ] **Step 4: Write `TableVisualization/CLAUDE.md`.**

```markdown
# TableVisualization

The table visualisation (`../TableVisualization.vue`) and its helpers.

- `tableView.ts`: the pure view model. It turns the JSON `prepare_visualization`
  sends into AG Grid's column definitions and rows, the digit grouping, the row
  counts and the flags the component reads; it also reads a server row page and
  a column's distinct values. The component owns state, AG Grid and the server
  calls and passes the rest in (`TableViewContext`).
- `../__tests__/tableViewSnapshot.test.ts`: the gate on that model. It runs
  every pinned golden of `test/Visualization_Tests/data/pinned` (`table_*`,
  `ssrm_*`) through `tableView.ts` and snapshots the result, including each
  link's tooltip and the node it creates. A change to the wire format must leave
  the snapshot unchanged (regenerate the goldens, not the snapshot); a change to
  the snapshot is a visible change.
- `TableVizDataSourceUtils.ts`: the server-side requests (sort, filter, page).
- `tableVizFilterSetUpUtils.ts`, `tableVizFilterUtils.ts`,
  `CommunitySetFilter.ts`: the filters. `TableVisualisationTooltip.ts`: the
  header tooltip with the data quality metrics. `tableVizToolbar.ts`: the
  toolbar.
```

- [ ] **Step 5: Run the GUI checks.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations`,
      then `typecheck` and `lint`. Expected: pass (the status-bar test is
      untouched). Check the formatted `.vue` from WSL (Working environment).
      Then run the table Playwright specs three times each:
      `corepack pnpm --filter enso-gui run test:integration -- integration-test/project-view/tableVisualisation.spec.ts integration-test/project-view/codeFont.spec.ts`.
      Expected: pass.

- [ ] **Step 6: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: move the table view model out of TableVisualization.vue"
```

### Task B0.3: Snapshot every golden through the view model

**Files:**

- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts`
- Create (generated):
  `app/gui/src/project-view/components/visualizations/__tests__/__snapshots__/tableViewSnapshot.test.ts.snap`

**Interfaces:**

- Consumes: `buildTableView`, `tableViewFlags`, `rowsFromPage`,
  `distinctValuesFromResponse`, `TableViewContext` (B0.2).
- Produces: the snapshot file, B1's gate. B1.5 may change only the two context
  lines marked below in this test file.

- [ ] **Step 1: Write the test.**

```ts
import { Ast } from "@/util/ast";
import type {
  CellDoubleClickedEvent,
  ColDef,
  ITooltipParams,
} from "ag-grid-community";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildTableView,
  distinctValuesFromResponse,
  rowsFromPage,
  tableViewFlags,
  type TableViewContext,
} from "../TableVisualization/tableView";

// The gate of spec B (docs/superpowers/specs/2026-11-14-table-viz-one-format-design.md, "Proof
// that views do not change"). Each pinned golden of `test/Visualization_Tests` is what the table
// visualisation's preprocessors send for one kind of value; this records what the visualisation
// makes of it. A wire-format change regenerates the goldens and must leave this snapshot as it is.
// Resolve the goldens relative to this file: vitest may run from `app/gui`.
const pinnedDir = path.resolve(
  __dirname,
  "../../../../../../../test/Visualization_Tests/data/pinned",
);

function readPinned(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(pinnedDir, `${name}.json`), "utf-8"),
  );
}

const viewGoldens = fs
  .readdirSync(pinnedDir)
  .filter((file) => file.startsWith("table_") && file.endsWith(".json"))
  .map((file) => file.slice(0, -".json".length))
  .sort();

/** Each server row page golden, with the view golden whose columns it fills. */
const pageGoldens = [
  ["ssrm_rows", "table_mem_table"],
  ["ssrm_rows_column", "table_mem_column"],
  ["ssrm_rows_sorted", "table_mem_table"],
  ["ssrm_rows_filtered", "table_mem_table"],
] as const;

const distinctGoldens = ["ssrm_distinct", "ssrm_distinct_nothing"];

/** The node the visualised value comes from; a link's pattern is applied to it. */
const SOURCE_NODE = "operator1";

function makeContext(data: unknown, created: string[]): TableViewContext {
  return {
    isSSRM: tableViewFlags(data).isSSRM,
    getFilterValues: async () => {},
    createNode: (pattern) =>
      created.push(
        pattern.instantiateCopied([Ast.parseExpression(SOURCE_NODE)!]).code(),
      ),
    previousRowData: [], // B0 only: B1.5 deletes this line.
    initialData: data, // B0 only: B1.5 deletes this line.
  };
}

/**
 * A JSON picture of `value` that does not depend on key order or on function identity: object
 * keys sorted, functions shown as `[function]` (classes AG Grid instantiates by name), and the
 * icon sprite's URL dropped from header templates.
 */
function plain(value: unknown, key?: string): unknown {
  if (typeof value === "function") {
    return key === "filter" || key === "tooltipComponent"
      ? `[class ${value.name}]`
      : "[function]";
  }
  if (value instanceof Map) return plain(Object.fromEntries(value));
  if (Array.isArray(value)) return value.map((item) => plain(item));
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return Object.fromEntries(
      keys.map((k) => [k, plain((value as Record<string, unknown>)[k], k)]),
    );
  }
  if (typeof value === "string")
    return value.replace(/xlink:href="[^"#]*#/g, 'xlink:href="#');
  return value;
}

/** Each column definition, and for a link column its tooltip, its cells and the node each row creates. */
function describeColumns(
  columnDefs: ColDef[],
  rows: Record<string, any>[] | undefined,
  created: string[],
) {
  return columnDefs.map((col) => {
    const described: Record<string, unknown> = { colDef: plain(col) };
    if (col.onCellDoubleClicked) {
      const tooltip = col.tooltipValueGetter as (
        params: ITooltipParams,
      ) => unknown;
      described.linkTooltip = tooltip({
        node: { rowPinned: null },
      } as ITooltipParams);
      described.linkCells = (rows ?? []).map((row) =>
        col.cellRenderer({ value: row[col.field!] }),
      );
      described.createdNodes = (rows ?? []).map((row) => {
        created.length = 0;
        col.onCellDoubleClicked!({ data: row } as CellDoubleClickedEvent);
        return created[0];
      });
    }
    return described;
  });
}

function viewSnapshot(name: string) {
  const data = readPinned(name);
  const created: string[] = [];
  const view = buildTableView(data, makeContext(data, created));
  const flags = tableViewFlags(data);
  return {
    columns: describeColumns(view.columnDefs, view.rowData, created),
    rowData:
      view.rowData === undefined
        ? "unchanged (server-side rows)"
        : plain(view.rowData),
    isTruncated: view.isTruncated ?? false,
    rowCount: view.rowCount,
    showRowCount: view.showRowCount,
    numberGrouping: Object.fromEntries(
      view.columnDefs.map((col) => [
        col.field,
        view.dataGrouping.get(col.field!) ?? false,
      ]),
    ),
    flags: plain({
      allRowCount: flags.allRowCount,
      versionHash: flags.versionHash,
      isSSRM: flags.isSSRM,
      bottomStatusBarRequested: flags.bottomStatusBarRequested,
      createNodeEnabled: flags.createNodeEnabled,
      columnTypes: flags.columnTypes,
    }),
  };
}

describe("Table view of each pinned golden", () => {
  test.each(viewGoldens)("%s", (name) => {
    expect(viewSnapshot(name)).toMatchSnapshot();
  });
});

describe("Rows of each pinned server page", () => {
  test.each(pageGoldens)("%s", (page, view) => {
    const data = readPinned(view);
    const { columnDefs } = buildTableView(data, makeContext(data, []));
    expect(plain(rowsFromPage(columnDefs, readPinned(page)))).toMatchSnapshot();
  });
});

describe("Distinct values of each pinned response", () => {
  test.each(distinctGoldens)("%s", (name) => {
    expect(
      plain(distinctValuesFromResponse(readPinned(name))),
    ).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to see it record.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts`.
      Expected: all pass, "Snapshots 32 written" (26 `table_*`, 4 pages, 2
      distinct).

- [ ] **Step 3: Read the snapshot by eye.** It records today's behaviour, so
      check it says what today's IDE does. In the `.snap` file:
  - `table_mem_table`: a `#` link column with tooltip
    `Double click to view this row in a separate component` and created nodes
    `operator1.get_row 0` … `operator1.get_row 2`; four columns with value-type
    header tooltips and a `Range` metric; `rowCount: 3`, `showRowCount: true`;
    `flags.bottomStatusBarRequested: true`, `createNodeEnabled: true`.
  - `table_mem_column`: created nodes `operator1.at 0` …;
    `createNodeEnabled: false`.
  - `table_dictionary`: a `key` link column, tooltip "… this value …", nodes
    `operator1.at "a"`, `operator1.at "b"`.
  - `table_row`: a `column` link column, nodes `operator1.at "x"` …
  - `table_xml_document`: nodes `operator1.get_child_element "@id"`,
    `operator1.get_child_element 0`, `operator1.get_child_element 1`.
  - `table_connection`: a `Table` link column, tooltip "… this table …", nodes
    `operator1.query "pinned"`, `operator1.query "pinned_geo"`;
    `showRowCount: false`.
  - `table_vector`: `isTruncated: true` (3 rows, 2 sent).
  - `table_mem_server_table`: `rowData: 'unchanged (server-side rows)'`,
    `flags.isSSRM: true`.
  - `table_db_read_error`: no columns, no rows (today's bug).
  - `ssrm_rows_sorted`: `#` values `2, 1, 0`. If any line disagrees, stop: the
    extraction changed behaviour (fix B0.2, not the snapshot).

- [ ] **Step 4: Run all the GUI checks again** (`vitest run` of the
      `visualizations` folder, `typecheck`, `lint`). Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations/__tests__
git commit -m "GUI tests: snapshot the table view of every pinned golden"
```

### Task B0.4: Benchmark the table view

**Files:**

- Create: `test/Visualization_Tests/src/Table_View_Benchmark_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`

**Interfaces:**

- Produces: `BENCH|<case>|<mode>|<median ms>|<p90 ms>` lines; B1.7 compares its
  run with the one recorded here.

- [ ] **Step 1: Write the spec.**

```enso
from Standard.Base import all

from Standard.Table import Table
import Standard.Table.In_Memory_Column.In_Memory_Column
import Standard.Database.Connection.Database
import Standard.Database.Extensions.Upload_Table
from Standard.SQLite import SQLite

import Standard.Visualization.Table.Visualization

from Standard.Test import all

## Times the table view (`prepare_visualization`) for the cases of the spec B
   performance spike. Not a CI gate: it is pending unless `ENSO_VIZ_BENCH=1`.
   Run it on `develop` and on the branch and compare the printed lines,
   `BENCH|<case>|<mode>|<median ms>|<p90 ms>`.
   - `first`: a new table for each call (its metrics awaited, untimed).
   - `repeat`: the same table for each call (a view shown before).
   `c2_1x2500` thrashes Java's 1000-entry caches on both sides: noisy.

make_table (rows : Integer) (cols : Integer) -> Table =
    ints = (0.up_to rows).map r-> r * 3
    floats = (0.up_to rows).map r-> if r % 10 == 7 then Nothing else r * 0.5 + 0.25
    texts_small = (0.up_to 97).map r-> "text " + r.to_text
    texts = (0.up_to rows).map r-> if r % 13 == 5 then Nothing else texts_small.at (r % 97)
    dates_small = (0.up_to 365).map r-> (Date.new 2020 1 1) + (Period.new days=r)
    dates = (0.up_to rows).map r-> dates_small.at (r % 365)
    columns = (0.up_to cols).map i-> case i % 4 of
        0 -> ["i" + i.to_text, ints]
        1 -> ["f" + i.to_text, floats]
        2 -> ["t" + i.to_text, texts]
        _ -> ["d" + i.to_text, dates]
    table = Table.new columns
    table.columns.each c-> (c:In_Memory_Column).await_metrics
    table

time_ms (input : Any) -> Float =
    start = System.nano_time
    result = Visualization.prepare_visualization input 1000
    elapsed = System.nano_time - start
    if result.length < 0 then Panic.throw "unreachable"
    elapsed / 1000000.0

## Times `prepare_visualization` on `prepare` (evaluated afresh, untimed, for
   each call): 10 warm-ups, then 30 timed calls.
bench (name : Text) ~prepare =
    times = (0.up_to 40).map _-> time_ms prepare
    sorted = times.drop 10 . sort
    median = sorted.at (sorted.length.div 2)
    p90 = sorted.at ((sorted.length * 9).div 10)
    IO.println ("BENCH|" + name + "|" + median.to_text + "|" + p90.to_text)

add_specs suite_builder =
    pending = if Environment.get "ENSO_VIZ_BENCH" == "1" then Nothing else "Set ENSO_VIZ_BENCH=1 to time the table view."
    suite_builder.group "Table view timings" group_builder->
        group_builder.specify "prints the timings" pending=pending <|
            [["a_50x50", 50, 50], ["c1_10x1000", 10, 1000], ["c2_1x2500", 1, 2500]].each c->
                bench (c.at 0 + "|first") (make_table (c.at 1) (c.at 2))
                table = make_table (c.at 1) (c.at 2)
                bench (c.at 0 + "|repeat") table
            big = make_table 1000000 20
            bench "b_1Mx20|repeat" big
            connection = Database.connect SQLite.In_Memory
            db_table = (make_table 1000 50).select_into_database_table connection "bench" temporary=True
            bench "d_1000x50_db|repeat" db_table
```

- [ ] **Step 2: Register it.** In `Main.enso` add
      `import project.Table_View_Benchmark_Spec` (sorted with the others) and
      `Table_View_Benchmark_Spec.add_specs suite_builder` after
      `Table_Spec.add_specs suite_builder`.

- [ ] **Step 3: Run it pending, then for real.** Sync and build, run
      `Visualization_Tests` filtered to `Table view timings`. Expected: 1
      pending. Then run it with `ENSO_VIZ_BENCH=1` prefixed. Expected: 9
      `BENCH|` lines. Save them for the PR (they are `develop`'s numbers: B0
      changes no library code).

- [ ] **Step 4: Lint and commit.** `-Werror` lint on `test/Visualization_Tests`
      (expected: no warnings), then:

```bash
git add test/Visualization_Tests
git commit -m "Visualization tests: time the table view (not a CI gate)"
```

### Task B0.5: Open PR B0

- [ ] **Step 1: Push and open.** Push `viz/table-format-b0`; open the PR against
      `develop` ("GUI: snapshot today's table views (spec B, B0)") with the spec
      link, the four commits, the `BENCH|` lines under "Baseline timings
      (develop)", and a test plan (vitest snapshot, typecheck, lint, Playwright
      table specs, `Visualization_Tests`). Label `CI: No changelog needed`.
      Merge on green.

---

## PR B1 — The switch

Every task below is on `viz/table-format-b1`. Until B1.5, the GUI snapshot test
fails from B1.3 on (the goldens change format first); that is expected.

### Task B1.1: One cell encoding in Java

**Files:**

- Modify:
  `std-bits/table/src/main/java/org/enso/table/data/column/operation/unary/JsonOperation.java`
- Modify:
  `std-bits/table/src/main/java/org/enso/table/data/column/operation/TableVizOperation.java:140`
- Modify:
  `std-bits/table/src/main/java/org/enso/table/data/column/DataQualityMetrics.java:216`
- Modify: `test/Visualization_Tests/src/Table_Spec.enso` (a new group)
- Regenerate: `test/Visualization_Tests/data/pinned/table_mem_table.json`,
  `ssrm_rows.json`, `ssrm_rows_sorted.json`, `ssrm_rows_filtered.json`,
  `data_mem_table.json`

**Interfaces:**

- Produces: `JsonOperation.toJson(long value, boolean includeDisplayText)`
  (public); `JsonOperation.WITH_DISPLAY_TEXT` (public static). With display
  text, every object cell starts with `_display_text_`: dates, times and
  date-times (moved first), decimals and integers beyond 2^53 (added).

- [ ] **Step 1: Write the failing tests.** In `Table_Spec.enso`, before `main`,
      add a group inside `add_specs` (after the "Table Visualization" group):

```enso
    suite_builder.group "Table view cells" group_builder->
        cells = Table.new [["when", [Date.new 2020 1 2]], ["d", [Decimal.new "1.50"]], ["big", [9007199254740993]]]
        cells.column_info

        group_builder.specify "put the display text first" <|
            page = Visualization.get_rows_for_table cells 0
            page.contains '{"_display_text_":"2020-01-02","type":"Date","constructor":"new","day":2,"month":1,"year":2020}' . should_be_true

        group_builder.specify "give a decimal and a big integer a display text" <|
            page = Visualization.get_rows_for_table cells 0
            page.contains '{"_display_text_":"1.50","type":"Decimal","value":"1.50","scale":2,"precision":3}' . should_be_true
            page.contains '{"_display_text_":"9007199254740993","type":"Integer","value":"9007199254740993"}' . should_be_true

        group_builder.specify "give distinct values a display text" <|
            distinct = Visualization.get_distinct_values_for_column cells 0
            distinct.contains '"_display_text_":"2020-01-02"' . should_be_true
```

- [ ] **Step 2: Run them to see them fail.** Sync (`ide-viz-b1`,
      `viz/table-format-b1`), build, run `Visualization_Tests` filtered to
      `Table view cells`. Expected: 3 failures (display text is third, absent,
      absent).

- [ ] **Step 3: Reorder and extend `JsonOperation`.** Add after `INSTANCE`:

```java
  /** Writes native values as a table view cell: an object cell starts with its display text. */
  public static JsonOperation WITH_DISPLAY_TEXT =
      new JsonOperation("Standard.Base.Data.Json", "Json", "stringify", true);
```

In `objectToJson` change three cases:

```java
      case Long l -> toJson(l, includeDisplayText);
      case BigInteger bi -> toJson(bi, includeDisplayText);
      case BigDecimal bd -> toJson(bd, includeDisplayText);
```

Replace `toJson(long)`, `toJson(BigInteger)` and `toJson(BigDecimal)` with:

```java
  public static String toJson(long value) {
    return toJson(value, false);
  }

  /**
   * A long as JSON: a number, or beyond JavaScript's safe integers an object (with its display text
   * first when asked).
   */
  public static String toJson(long value, boolean includeDisplayText) {
    if (value < -MAX_JSON_LONG || value > MAX_JSON_LONG) {
      return bigIntegerJson(String.valueOf(value), includeDisplayText);
    }
    return String.valueOf(value);
  }

  private static String bigIntegerJson(String digits, boolean includeDisplayText) {
    var displayText = includeDisplayText ? "\"_display_text_\":\"" + digits + "\"," : "";
    return "{" + displayText + "\"type\":\"Integer\",\"value\":\"" + digits + "\"}";
  }

  private static String toJson(BigInteger value, boolean includeDisplayText) {
    if (value.abs().compareTo(MAX_JSON_LONG_BIGINT) > 0) {
      return bigIntegerJson(value.toString(), includeDisplayText);
    }
    return value.toString();
  }

  private static String toJson(BigDecimal value, boolean includeDisplayText) {
    var displayText = includeDisplayText ? "\"_display_text_\":\"" + value + "\"," : "";
    return "{"
        + displayText
        + "\"type\":\"Decimal\",\"value\":\""
        + value
        + "\",\"scale\":"
        + value.scale()
        + ",\"precision\":"
        + value.precision()
        + "}";
  }
```

In `toJson(LocalDate, …)` change the return to start
`return "{" + displayText + "\"type\":\"Date\",\"constructor\":\"new\",\"day\":"`;
in `toJson(LocalTime, …)` to
`return "{" + displayText + "\"type\":\"Time_Of_Day\",\"constructor\":\"new\",\"hour\":"`;
in `toJson(ZonedDateTime, …)` to
`return "{" + displayText + "\"type\":\"Date_Time\",\"constructor\":\"new\",\"year\":"`
(each keeps the rest of its concatenation; only `displayText` moves to the
front).

- [ ] **Step 4: Use them.** In `TableVizOperation.createIntegerJson` (line 140)
      change `JsonOperation.toJson(longStorage.getItemAsLong(i))` to
      `JsonOperation.toJson(longStorage.getItemAsLong(i), true)`. In
      `DataQualityMetrics` line 216 change `JsonOperation.INSTANCE` to
      `JsonOperation.WITH_DISPLAY_TEXT`.

- [ ] **Step 5: Run the tests, regenerate the goldens.** Sync, build, run
      `Table view cells`. Expected: 3 pass. Run `Visualization_Tests` with
      `ENSO_UPDATE_PINNED=1` and filter `Pinned`, copy the regenerated files
      back, run `Visualization_Tests` without a filter. Expected: all pass, and
      `git status` shows exactly `table_mem_table.json`, `ssrm_rows.json`,
      `ssrm_rows_sorted.json`, `ssrm_rows_filtered.json`, `data_mem_table.json`
      changed, each only by `"_display_text_":"…",` moving to the front of its
      date objects (`git diff --word-diff` shows nothing else). Run the GUI
      snapshot test: it still passes (it sorts keys). Run `Table_Tests` (JSON
      functions use `INSTANCE`, unchanged). Expected: pass.

- [ ] **Step 6: Commit.**

```bash
git add std-bits/table test/Visualization_Tests
git commit -m "Table: one cell encoding, display text first"
```

### Task B1.2: The writer's API

**Files:**

- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Json.enso`
  (drop `private`; add the API below)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Table.enso`
  (two capability methods)
- Create: `test/Visualization_Tests/src/View_Json_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`

**Interfaces:**

- Produces, in module `Standard.Visualization.Internal.View_Json`:
  - `max_inline_cells` (2500), `missing_cell` (`{"_missing_":true}`)
  - `type View_Link` —
    `Value (action : Text) (label : Text | Nothing = Nothing)`,
    `to_json_text -> Text`
  - `type View_Column` —
    `Value (name : Text) (link : View_Link | Nothing = Nothing) (number_format : Boolean | Nothing = Nothing)`,
    `to_json_text -> Text`
  - `type Table_View` —
    `Value (index_action : Text) (row_count : Integer) (version_hash : Text | Nothing) (options : Vector Text) (allow_server : Boolean)`
  - `grid_json (columns : Vector Text) (data : Vector Text | Nothing) (row_count : Integer | Nothing = Nothing) (index : View_Link | Nothing = Nothing) (version_hash : Text | Nothing = Nothing) (server : Boolean = False) (options : Vector Text = []) -> Text`
  - `cells_json (values : Vector) -> Text`
  - `table_view (viz : Viz_Table) (view : Table_View) -> Text`
  - `value_json value -> Text`, `error_json (message : Text) -> Text`
  - `rows_page_json (row_count : Integer) (index : Text) (data : Vector Text) -> Text`
  - `distinct_json (values : Text | Nothing) -> Text`
- Produces on `Viz_Table`: capability `"view_pieces"` with
  `column_cells_json (name : Text) (start : Integer) (count : Integer) -> Text`
  and `column_metrics_json -> Vector Text`.

- [ ] **Step 1: Write the failing tests.** Create `View_Json_Spec.enso`:

```enso
from Standard.Base import all

from Standard.Visualization.Internal.View_Json import all
import Standard.Visualization.Internal.View_Json
import Standard.Visualization.Viz_Table.Viz_Table

from Standard.Test import all

## A source with the `"view_pieces"` capability and nothing else.
type Pieces_Source
    Value rows

    column_names self = ["a", "b"]
    row_count self = self.rows
    supported_operations self = ["view_pieces"]
    column_metrics_json self = ['"value_type":{"constructor":"Integer","display_text":"Integer (64 bits)"},"metrics":[],"multi_filter":false,"number_format":false', '"metrics":[]']
    column_cells_json self name start count = '["' + name + '",' + start.to_text + ',' + count.to_text + ']'

add_specs suite_builder =
    suite_builder.group "The table view writer" group_builder->
        group_builder.specify "writes a grid with links, a row count, an index and options" <|
            columns = [View_Column.Value "key" (View_Link.Value "at {{#key}}" "value"), View_Column.Value "value" number_format=False]
            text = grid_json (columns.map .to_json_text) ['["a"]', '[1]'] 1 (View_Link.Value "at {{#index}}") options=["disable_sort_when_partial"]
            text . should_equal '{"kind":"grid","row_count":1,"columns":[{"name":"key","link":{"action":"at {{#key}}","label":"value"}},{"name":"value","number_format":false}],"index":{"action":"at {{#index}}"},"data":[["a"],[1]],"options":{"disable_sort_when_partial":true}}'

        group_builder.specify "writes a minimal grid" <|
            grid_json [(View_Column.Value "x").to_json_text] ['[]'] . should_equal '{"kind":"grid","columns":[{"name":"x"}],"data":[[]]}'

        group_builder.specify "renders cells with Viz_Cell" <|
            cells_json [1, "a", Nothing, Date.new 2020 1 2] . should_equal '[1,"a",null,{"_display_text_":"2020-01-02","type":"Date","constructor":"new","day":2,"month":1,"year":2020}]'

        group_builder.specify "writes a value, an error, a page and distinct values" <|
            value_json "hello" . should_equal '{"kind":"value","value":"hello"}'
            error_json 'a "b"' . should_equal '{"kind":"error","error":"a \\"b\\""}'
            rows_page_json 3 "[2,1]" ['["c","b"]'] . should_equal '{"row_count":3,"index":[2,1],"data":[["c","b"]]}'
            distinct_json '["a"]' . should_equal '{"values":["a"]}'
            distinct_json Nothing . should_equal '{"values":null}'

        group_builder.specify "writes a source's table view from its pieces" <|
            view = Table_View.Value "get_row {{#index}}" 3 "v1" ["status_bar"] True
            table_view (Viz_Table.from_source (Pieces_Source.Value 3)) view . should_equal '{"kind":"grid","row_count":3,"columns":[{"name":"a","value_type":{"constructor":"Integer","display_text":"Integer (64 bits)"},"metrics":[],"multi_filter":false,"number_format":false},{"name":"b","metrics":[]}],"index":{"action":"get_row {{#index}}","label":"row"},"data":[["a",0,3],["b",0,3]],"version_hash":"v1","options":{"status_bar":true}}'

        group_builder.specify "lets the server page a large table" <|
            view = Table_View.Value "get_row {{#index}}" 2000 "v1" [] True
            text = table_view (Viz_Table.from_source (Pieces_Source.Value 2000)) view
            text.contains '"data":null' . should_be_true
            text.contains '"server":true' . should_be_true

        group_builder.specify "never pages when the server is not allowed" <|
            view = Table_View.Value "at {{#index}}" 2000 Nothing [] False
            text = table_view (Viz_Table.from_source (Pieces_Source.Value 2000)) view
            text.contains '"server"' . should_be_false
            text.contains '"version_hash"' . should_be_false

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

Register it in `Main.enso` (import and `View_Json_Spec.add_specs suite_builder`,
in alphabetical position).

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` filtered to `The table view writer`. Expected: a
      compile error: `View_Json` is private and has none of these names.

- [ ] **Step 3: Make the module public and add the API.** Delete the first line
      (`private`) of `Internal/View_Json.enso`. Add
      `import project.Viz_Table.Viz_Table` to its imports. Append:

```enso
## ---
   private: true
   ---
   The most cells a table view sends inline; above it the server sorts,
   filters and pages the rows.
max_inline_cells = 2500

## ---
   private: true
   ---
   A cell its row does not have (a short row of a vector of vectors, a
   `Nothing` row, a record without that field). The IDE shows it empty, unlike
   `Nothing`.
missing_cell = JS_Object.from_pairs [["_missing_", True]]

## ---
   private: true
   ---
   A link: double-clicking a cell creates a node from `action`, a template in
   which `{{#field}}` is the row's value of `field` (a number when it reads as
   one), `{{@field}}` the value as it is, and `{{#index}}` the row number.
   `label` names what the new node holds in the tooltip ("value" when
   `Nothing`).
type View_Link
    ## ---
       private: true
       ---
    Value (action : Text) (label : Text | Nothing = Nothing)

    ## ---
       private: true
       ---
    to_json_text self -> Text =
        label = if self.label.is_nothing then "" else ',"label":' + self.label.to_json
        '{"action":' + self.action.to_json + label + '}'

## ---
   private: true
   ---
   A column of a grid view. `number_format` says whether the IDE groups the
   column's digits; `Nothing` lets it decide from the values.
type View_Column
    ## ---
       private: true
       ---
    Value (name : Text) (link : View_Link | Nothing = Nothing) (number_format : Boolean | Nothing = Nothing)

    ## ---
       private: true
       ---
    to_json_text self -> Text =
        link = if self.link.is_nothing then "" else ',"link":' + self.link.to_json_text
        format = if self.number_format.is_nothing then "" else ',"number_format":' + self.number_format.to_json
        '{"name":' + self.name.to_json + link + format + '}'

## ---
   private: true
   ---
   How a source with the `"view_pieces"` capability is shown.
   - `index_action`: the row-number column's link template.
   - `row_count`: the rows the value has (a database table's, which can be
     more than the rows read).
   - `version_hash`: the table's version, or `Nothing` (a database table).
   - `options`: as in `grid_json`.
   - `allow_server`: whether the server may sort, filter and page the rows
     (above `max_inline_cells` cells).
type Table_View
    ## ---
       private: true
       ---
    Value (index_action : Text) (row_count : Integer) (version_hash : Text | Nothing) (options : Vector Text) (allow_server : Boolean)

## ---
   private: true
   ---
   The view message of a grid.
   - `columns`: one JSON object per column (`View_Column.to_json_text`, or a
     source's fragments).
   - `data`: one JSON array per column, or `Nothing` when the server pages.
   - `row_count`: the rows the value has; `Nothing` shows no row count.
   - `index`: the row-number column's link, or `Nothing` for none.
   - `version_hash`: the table's version, or `Nothing`.
   - `server`: whether the server sorts, filters and pages the rows.
   - `options`: the options that are on, among `"status_bar"` (the row counts
     below the grid), `"create_node"` (the toolbar's create-node button) and
     `"disable_sort_when_partial"` (no sorting or filtering when fewer rows are
     sent than the value has).
grid_json (columns : Vector Text) (data : Vector Text | Nothing) (row_count : Integer | Nothing = Nothing) (index : View_Link | Nothing = Nothing) (version_hash : Text | Nothing = Nothing) (server : Boolean = False) (options : Vector Text = []) -> Text =
    count_part = if row_count.is_nothing then "" else ',"row_count":' + row_count.to_text
    index_part = if index.is_nothing then "" else ',"index":' + index.to_json_text
    data_part = if data.is_nothing then ',"data":null' else ',"data":[' + (data.join ",") + ']'
    version_part = if version_hash.is_nothing then "" else ',"version_hash":' + version_hash.to_json
    server_part = if server then ',"server":true' else ""
    options_part = if options.is_empty then "" else ',"options":{' + (options.map (o-> o.to_json + ':true') . join ",") + '}'
    '{"kind":"grid"' + count_part + ',"columns":[' + (columns.join ",") + ']' + index_part + data_part + version_part + server_part + options_part + '}'

## ---
   private: true
   ---
   One column's cells as a JSON array, each rendered by `Viz_Cell.render_value`.
cells_json (values : Vector) -> Text = (values.map Viz_Cell.render_value) . to_json

## ---
   private: true
   ---
   The view of a source with the `"view_pieces"` capability: one loop over
   the columns, the cells and per-column details from the source.
table_view (viz : Viz_Table) (view : Table_View) -> Text =
    names = viz.column_names
    details = viz.column_metrics_json
    columns = names.zip details (name-> fields-> '{"name":' + name.to_json + ',' + fields + '}')
    server = view.allow_server && (view.row_count * names.length > max_inline_cells)
    rows = viz.row_count
    data = if server then Nothing else names.map (name-> viz.column_cells_json name 0 rows)
    grid_json columns data view.row_count (View_Link.Value view.index_action "row") view.version_hash server view.options

## ---
   private: true
   ---
   The view of one value: its JSON in one cell.
value_json value -> Text = '{"kind":"value","value":' + value.to_json + '}'

## ---
   private: true
   ---
   The view of an error.
error_json (message : Text) -> Text = '{"kind":"error","error":' + message.to_json + '}'

## ---
   private: true
   ---
   A page of the server-side rows: `index` holds each row's number (in the
   table before sorting and filtering), `data` one JSON array per column.
rows_page_json (row_count : Integer) (index : Text) (data : Vector Text) -> Text =
    '{"row_count":' + row_count.to_text + ',"index":' + index + ',"data":[' + (data.join ",") + ']}'

## ---
   private: true
   ---
   A column's distinct values, a JSON array, or `Nothing` when there are too
   many to list.
distinct_json (values : Text | Nothing) -> Text = '{"values":' + (values.if_nothing "null") + '}'
```

- [ ] **Step 4: The capability on `Viz_Table`.** In `Viz_Table.enso` add after
      `distinct_values_json`:

```enso
    ## ---
       private: true
       ---
       One column's cells from `start`, at most `count`, as a JSON array.
    column_cells_json self (name : Text) (start : Integer) (count : Integer) -> Text =
        self.require "view_pieces" <| self.source.column_cells_json name start count

    ## ---
       private: true
       ---
       Each column's view details as JSON object fields: its `value_type`,
       `metrics`, `multi_filter` and `number_format`.
    column_metrics_json self -> Vector Text =
        self.require "view_pieces" <| self.source.column_metrics_json
```

and extend the `supported_operations` doc comment to
`any of "rows", "server_rows", "spatial", "view_pieces"`.

- [ ] **Step 5: Run the tests.** Sync, build, run `Visualization_Tests` (no
      filter). Expected: all pass, the new group 7 of 7. `-Werror` lint on
      Visualization and `test/Visualization_Tests`. Expected: no warnings.

- [ ] **Step 6: Commit.**

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: the table view writer's API"
```

### Task B1.3: Tables, columns and database tables on the writer

**Files:**

- Modify:
  `std-bits/table/src/main/java/org/enso/table/data/column/operation/TableVizOperation.java`
  (add `viewColumnsJson`, `metricsIncomplete`; delete `makeJSON` and its
  helpers)
- Modify: `std-bits/table/src/main/java/org/enso/table/data/table/Table.java`
  (delete `tableVizJSON`), `.../table/Column.java` (delete `tableVizJSON`)
- Modify:
  `std-bits/table/src/main/java/org/enso/table/util/TableValueCache.java` (add
  `get`, `put`)
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Viz_Source.enso`,
  `src/In_Memory_Table.enso:36-43`, `src/In_Memory_Column.enso:37-43`
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Viz_Source.enso`
- Modify: `test/Visualization_Tests/src/Table_Spec.enso` (`make_json` and the
  table cases), `src/Pinned.enso` (normalise), `src/Pinned_Spec.enso` (the
  distinct-values case), `src/Table_Visualisation_Integration_Spec.enso`
- Regenerate: `table_mem_table`, `table_mem_column`, `table_mem_1col_table`,
  `table_mem_1x1_table`, `table_mem_server_table`, `table_db_table`,
  `table_db_column`, `table_db_read_error`, `table_cells`, `ssrm_rows`,
  `ssrm_rows_column`, `ssrm_rows_sorted`, `ssrm_rows_filtered`, `ssrm_distinct`,
  `ssrm_distinct_nothing`; and
  `app/gui/integration-test/project-view/table-vis-json/singleColumn{Dates,Datetimes,Times}.json`

**Interfaces:**

- Consumes: B1.2's `View_Json.table_view`, `Table_View`, `rows_page_json`,
  `distinct_json`, `error_json`; B1.1's cell encoding.
- Produces:
  - Java
    `TableVizOperation.viewColumnsJson(List<Column> columns, List<String> valueTypeDisplay, boolean withMetrics) -> String[]`
    and `TableVizOperation.metricsIncomplete(List<Column> columns) -> boolean`;
    `TableValueCache.get(String) -> Value` (null when absent),
    `TableValueCache.put(String, Value)`.
  - `In_Memory_Viz_Source.Value table column (db_row_count : Integer | Nothing = Nothing)`
    with the `"view_pieces"` capability.
  - `In_Memory_Table.to_table_viz_json (db_row_count : Integer | Nothing = Nothing) -> Text`,
    same on `In_Memory_Column` (the database path).
  - The new messages for these values. Expected `table_db_table.json`:

```json
{
  "kind": "grid",
  "row_count": 3,
  "columns": [
    {
      "name": "x",
      "value_type": {
        "constructor": "Integer",
        "display_text": "Integer (64 bits)"
      },
      "metrics": [],
      "multi_filter": false,
      "number_format": false
    },
    {
      "name": "y",
      "value_type": {
        "constructor": "Float",
        "display_text": "Float (64 bits)"
      },
      "metrics": [],
      "multi_filter": false,
      "number_format": false
    },
    {
      "name": "label",
      "value_type": {
        "constructor": "Char",
        "display_text": "Char (variable length, max_size=unlimited)"
      },
      "metrics": [],
      "multi_filter": false,
      "number_format": false
    }
  ],
  "index": { "action": "get_row {{#index}}", "label": "row" },
  "data": [
    [1, 2],
    [4.5, 5.5],
    ["a", "b"]
  ],
  "options": { "create_node": true }
}
```

(on one line in the file). An in-memory table adds
`"version_hash":"<hash>","options":{"status_bar":true,"create_node":true}` and
its metrics, e.g. `{"name":"Range","value":"1 - 3","type":"Text"}`; a column's
index action is `at {{#index}}` and it has no `create_node`.

- [ ] **Step 1: Rewrite `Table_Spec`'s expectation helper (the failing tests).**
      Replace `make_json` (Table_Spec lines 51-78) with a helper of the same
      arguments that builds the new message as a `JS_Object`:

```enso
    make_json header data all_rows value_type has_index_col get_child_node is_ssrm range=Nothing number_of_distinct=Nothing number_of_nothing=Nothing number_of_empty=Nothing number_of_empty_sampled=Nothing number_of_untrimmed_whitespace=Nothing number_of_untrimmed_whitespace_sampled=Nothing number_non_trivial_ws=Nothing number_non_trivial_ws_sampled=Nothing requires_number_format table_version_hash=Nothing use_bottom_status_bar=True enable_create_node=True is_using_multi_filter =
        _ = has_index_col
        metric name values type = if values.is_nothing then Nothing else [name, values, type]
        all_metrics = [metric "Range" range "Text", metric "Number of distinct" number_of_distinct "Count", metric "% nothing" number_of_nothing "Percentage", metric "% empty" number_of_empty "Percentage", metric "% empty (sampled)" number_of_empty_sampled "Percentage", metric "% untrimmed" number_of_untrimmed_whitespace "Percentage", metric "% untrimmed (sampled)" number_of_untrimmed_whitespace_sampled "Percentage", metric "% with odd whitespace" number_non_trivial_ws "Percentage", metric "% with odd whitespace (sampled)" number_non_trivial_ws_sampled "Percentage"]
        metrics = all_metrics.filter (m-> m.is_nothing.not)
        columns = header.map_with_index i-> name->
            column_metrics = metrics.map m-> JS_Object.from_pairs [["name", m.at 0], ["value", m.at 1 . at i], ["type", m.at 2]]
            JS_Object.from_pairs [["name", name], ["value_type", value_type.at i], ["metrics", column_metrics], ["multi_filter", is_using_multi_filter.at i], ["number_format", requires_number_format.at i]]
        options = (if use_bottom_status_bar then [["status_bar", True]] else []) + (if enable_create_node then [["create_node", True]] else [])
        index = JS_Object.from_pairs [["action", get_child_node + " {{#index}}"], ["label", "row"]]
        version = if table_version_hash.is_nothing then [] else [["version_hash", table_version_hash]]
        server = if is_ssrm then [["server", True]] else []
        options_pair = if options.is_empty then [] else [["options", JS_Object.from_pairs options]]
        JS_Object.from_pairs ([["kind", "grid"], ["row_count", all_rows], ["columns", columns], ["index", index], ["data", data]] + version + server + options_pair)
```

In every table and column case of the "Table Visualization" group ("should
visualize database tables" through "should set required numeric formatting…")
change `vis . should_equal json` to `vis.parse_json . should_equal json` (and
`vis2 . should_equal json2` to `vis2.parse_json . should_equal json2`). The
arguments stay as they are.

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` filtered to `Table Visualization`. Expected: the
      table and column cases fail (the old format arrives).

- [ ] **Step 3: Java: the per-column piece.** In `TableVizOperation.java` delete
      `makeJSON`, `appendProperty`, `makeDataQualityMetrics`, the old
      `addMetric`, `addRange`, `hasMetric`, `appendMetric`, `dataToJson`,
      `_tableVizCache`/`tableVizCache()`, `MAX_CELLS_FOR_INLINE` and `LOGGER`,
      and add:

```java
  /**
   * The table view's details of each column, as JSON object fields without the column's name: its
   * value type, its data quality metrics, and whether it uses the multi-value filter and digit
   * grouping, e.g. {@code "value_type":{…},"metrics":[…],"multi_filter":true,"number_format":false}.
   *
   * @param columns the columns
   * @param valueTypeDisplay each column's value type as the user sees it
   * @param withMetrics false for the first rows of a database table, which have no metrics
   */
  public static String[] viewColumnsJson(
      List<Column> columns, List<String> valueTypeDisplay, boolean withMetrics) {
    var metrics = new ArrayList<Map<String, Object>>(columns.size());
    for (Column column : columns) {
      metrics.add(withMetrics ? DataQualityMetrics.get(column) : Map.of());
    }
    var entries = metricEntries(metrics);
    var result = new String[columns.size()];
    for (int i = 0; i < columns.size(); i++) {
      var builder = new StringBuilder();
      builder
          .append("\"value_type\":{\"constructor\":")
          .append(JSON_OPERATION.objectToJson(columns.get(i).getStorageType().ensoConstructorName()))
          .append(",\"display_text\":")
          .append(JSON_OPERATION.objectToJson(valueTypeDisplay.get(i)))
          .append("},\"metrics\":[");
      for (int m = 0; m < entries.size(); m++) {
        var entry = entries.get(m);
        if (m > 0) {
          builder.append(",");
        }
        builder
            .append("{\"name\":")
            .append(JSON_OPERATION.objectToJson(entry.name()))
            .append(",\"value\":")
            .append(entry.values().get(i))
            .append(",\"type\":\"")
            .append(entry.type())
            .append("\"}");
      }
      var columnMetrics = metrics.get(i);
      builder
          .append("],\"multi_filter\":")
          .append(
              JSON_OPERATION.objectToJson(
                  columnMetrics.getOrDefault(DataQualityMetrics.USE_MULTI_FILTER, false)))
          .append(",\"number_format\":")
          .append(
              JSON_OPERATION.objectToJson(
                  columnMetrics.getOrDefault(DataQualityMetrics.NEEDS_FORMATTING, false)));
      result[i] = builder.toString();
    }
    return result;
  }

  /** Whether any column's data quality metrics are still being computed. */
  public static boolean metricsIncomplete(List<Column> columns) {
    return columns.stream()
        .anyMatch(c -> DataQualityMetrics.get(c).get(DataQualityMetrics.IS_INCOMPLETE) != null);
  }

  /** A metric the view shows: its name, its kind, and each column's value as JSON. */
  private record MetricEntry(String name, String type, List<String> values) {}

  /**
   * The metrics a table view shows, in order: those at least one column has, each with every
   * column's value (the default for a column without it).
   */
  private static List<MetricEntry> metricEntries(List<Map<String, Object>> metrics) {
    var entries = new ArrayList<MetricEntry>();
    addMetric(entries, metrics, "", DataQualityMetrics.IS_INCOMPLETE_TEXT, "Text", "");
    addRange(entries, metrics);
    addMetric(
        entries, metrics, "Number of distinct", DataQualityMetrics.DISTINCT_COUNT, "Count", 0);
    addMetric(
        entries, metrics, "% nothing", DataQualityMetrics.NOTHING_COUNT, "Percentage", null);
    addMetric(entries, metrics, "", DataQualityMetrics.TYPE_RECORD, "Text", null);
    var sampled =
        metrics.stream().anyMatch(m -> Boolean.TRUE.equals(m.get(DataQualityMetrics.SAMPLED)));
    var suffix = sampled ? " (sampled)" : "";
    addMetric(
        entries,
        metrics,
        "% empty" + suffix,
        DataQualityMetrics.EMPTY_COUNT,
        "Percentage",
        null);
    addMetric(
        entries,
        metrics,
        "% untrimmed" + suffix,
        DataQualityMetrics.UNTRIMMED_COUNT,
        "Percentage",
        null);
    addMetric(
        entries,
        metrics,
        "% with odd whitespace" + suffix,
        DataQualityMetrics.ODD_SPACE_COUNT,
        "Percentage",
        null);
    return entries;
  }

  private static void addMetric(
      List<MetricEntry> entries,
      List<Map<String, Object>> metrics,
      String name,
      String field,
      String type,
      Object defaultValue) {
    if (metrics.stream().noneMatch(m -> m.get(field) != null)) {
      return;
    }
    var values = new ArrayList<String>(metrics.size());
    for (var metric : metrics) {
      values.add(JSON_OPERATION.objectToJson(metric.getOrDefault(field, defaultValue)));
    }
    entries.add(new MetricEntry(name, type, values));
  }

  private static void addRange(List<MetricEntry> entries, List<Map<String, Object>> metrics) {
    boolean hasRange = false;
    var values = new ArrayList<String>(metrics.size());
    for (var metric : metrics) {
      var min = metric.get(DataQualityMetrics.MINIMUM);
      if (min == null) {
        values.add("null");
        continue;
      }
      hasRange = true;
      String range =
          Boolean.TRUE.equals(metric.get(DataQualityMetrics.SINGLE_VALUE))
              ? toDisplayText(min)
              : toDisplayText(min) + " - " + toDisplayText(metric.get(DataQualityMetrics.MAXIMUM));
      values.add(JSON_OPERATION.objectToJson(range));
    }
    if (hasRange) {
      entries.add(new MetricEntry("Range", "Text", values));
    }
  }
```

Keep `DATE_TIME_FORMATTER`, `TIME_FORMATTER` and `toDisplayText` (now used by
`addRange`). Remove the imports nothing uses any more (`Arrays`, `Collectors`,
`Logger`), keeping `List`, `ArrayList`, `Map`. Delete `tableVizJSON` from
`Table.java` (lines 671-675) and `Column.java` (lines 230-239), and their
now-unused imports.

In `TableValueCache.java` add:

```java
  /** The value cached under `key`, or null when there is none. */
  public static Value get(String key) {
    return cache().get(key);
  }

  /** Caches `value` under `key`. */
  public static void put(String key, Value value) {
    cache().put(key, value);
  }
```

- [ ] **Step 4: The in-memory source.** Replace `In_Memory_Viz_Source.enso`'s
      imports, type header and `table_view_json` (lines 1-21), keeping the other
      methods, with:

```enso
private

from Standard.Base import all

import Standard.Visualization.Internal.View_Json
import Standard.Visualization.Viz_Table.Viz_Table
from Standard.Visualization.Internal.View_Json import Table_View

import project.In_Memory_Column.In_Memory_Column
import project.Internal.Viz_Helpers
import project.Sort_Column.Sort_Column
import project.Table.Table

polyglot java import org.enso.table.data.column.operation.TableVizOperation
polyglot java import org.enso.table.util.TableValueCache

## The `Viz_Table` source of an in-memory table or column. `column` is the
   original column when the value was a column (its table view differs), else
   `Nothing`; `table` is the table operations act on. `db_row_count` is
   `Nothing`, or the row count of the database table whose first rows `table`
   holds: that view has no metrics, version, status bar or server paging.
type In_Memory_Viz_Source
    Value table column (db_row_count : Integer | Nothing = Nothing)

    ## The view is cached by table version, above the display types (the
       costly part of a wide table), and only once every column's metrics are
       complete.
    table_view_json self _ -> Text = case self.db_row_count of
        Nothing ->
            key = "table_view:" + self.version_hash
            cached = TableValueCache.get key
            if Nothing != cached then cached else
                complete = (TableVizOperation.metricsIncomplete self.java_columns).not
                text = View_Json.table_view (Viz_Table.from_source self) self.view_settings
                if complete then TableValueCache.put key text
                text
        _ -> View_Json.table_view (Viz_Table.from_source self) self.view_settings

    version_hash self -> Text = case self.column of
        Nothing -> self.table.table_version_hash
        column -> column.table_version_hash

    view_settings self -> Table_View =
        is_table = Nothing == self.column
        index_action = if is_table then "get_row {{#index}}" else "at {{#index}}"
        create_node = if is_table then ["create_node"] else []
        case self.db_row_count of
            Nothing -> Table_View.Value index_action self.table.row_count self.version_hash (["status_bar"] + create_node) True
            n -> Table_View.Value index_action n Nothing create_node False

    java_columns self -> Vector = self.table.columns.map c-> (c:In_Memory_Column).java_column

    column_metrics_json self -> Vector Text =
        display = self.table.columns.map c-> c.value_type.to_display_text
        (TableVizOperation.viewColumnsJson self.java_columns display (Nothing == self.db_row_count)).to_vector

    column_cells_json self (name : Text) (start : Integer) (count : Integer) -> Text =
        column = self.table.at name
        (column:In_Memory_Column).to_json_data start count
```

Change `supported_operations` to `["rows", "server_rows", "view_pieces"]`. In
`server_rows_json` replace the last line with:

```enso
        View_Json.rows_page_json filtered_table.row_count sliced_json.first (sliced_json.drop 1)
```

and in `distinct_values_json` replace its last two lines with:

```enso
        View_Json.distinct_json filtered_column.distinct_values_json
```

The block above drops `import project.In_Memory_Table.In_Memory_Table` (only the
old `table_view_json` used it); if
`git grep -n In_Memory_Table -- distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Viz_Source.enso`
finds another use, restore the import.

- [ ] **Step 5: The database path.** In `In_Memory_Table.enso` replace
      `to_table_viz_json` (lines 36-43, with its doc comment) with:

```enso
    ## ---
       private: true
       ---
       The table view of the first rows of a database table with
       `db_row_count` rows, or (`Nothing`) of this table.
    to_table_viz_json self (db_row_count : Integer | Nothing = Nothing) -> Text =
        (In_Memory_Viz_Source.Value (self:Table) Nothing db_row_count).table_view_json 0
```

and add `import project.Internal.In_Memory_Viz_Source.In_Memory_Viz_Source`. In
`In_Memory_Column.enso` replace its `to_table_viz_json` likewise:

```enso
    ## ---
       private: true
       ---
       The table view of the first rows of a database column with
       `db_row_count` rows, or (`Nothing`) of this column.
    to_table_viz_json self (db_row_count : Integer | Nothing = Nothing) -> Text =
        column = self:Column
        (In_Memory_Viz_Source.Value column.to_table column db_row_count).table_view_json 0
```

with the same import. In `DB_Viz_Source.enso` add
`import Standard.Visualization.Internal.View_Json` and change the end of
`_db_table_view_json` to:

```enso
            in_memory.to_table_viz_json db_row_count=all_rows_count
        True ->
            View_Json.error_json ('Error querying the database:\n' + dataframe.catch.to_display_text)
```

- [ ] **Step 6: Goldens' normalisation and the integration spec.** In
      `test/Visualization_Tests/src/Pinned.enso` change the regex to
      `'"version_hash":"[^"]*"'` and the replacement to
      `'"version_hash":"<hash>"'` (and the comment to name `version_hash`). In
      `Pinned_Spec.enso`'s "distinct values are valid JSON" case change
      `json.get "distinct_vals"` to `json.get "values"`. In
      `Table_Visualisation_Integration_Spec.enso` change both
      `"table_version_hash"` to `"version_hash"`.

- [ ] **Step 7: Regenerate the goldens.** Sync, build, run `Table Visualization`
      and `The table view writer`. Expected: pass. Run with
      `ENSO_UPDATE_PINNED=1` and filter `Pinned`; copy back. Expected changed
      set: exactly the 15 golden files listed under **Files** (`git status`).
      Check by eye: `table_db_read_error.json` is
      `{"kind":"error","error":"Error querying the database:\n…"}`;
      `ssrm_rows_sorted.json` has `"index":[2,1,0]`; `ssrm_distinct.json` is
      `{"values":["a","b","c"]}`; `table_mem_server_table.json` has
      `"data":null` and `"server":true`.

- [ ] **Step 8: Regenerate the integration fixtures.** The spec writes them into
      the clone's `app/`, which the sync does not copy. In
      `Table_Visualisation_Integration_Spec.enso` un-comment the `vis.write …`
      line, sync, run `Visualization_Tests` filtered to
      `Table Visualization Integration` (it fails: the fixtures are old), then
      copy them back and format them:

```bash
wsl -e bash -lc 'cp ~/vizwork2/app/gui/integration-test/project-view/table-vis-json/*.json /mnt/c/Repos/Enso/ide-viz-b1/app/gui/integration-test/project-view/table-vis-json/'
corepack pnpm exec prettier --write app/gui/integration-test/project-view/table-vis-json
```

Comment the `vis.write …` line out again. Check by eye: each fixture has
`"kind": "grid"`, one column `Value` with its `value_type`, and
`"version_hash"`.

- [ ] **Step 9: Commit.**

```bash
git add std-bits/table distribution/lib/Standard test/Visualization_Tests app/gui/integration-test/project-view/table-vis-json
git commit -m "Table: tables and columns write the one table view format"
```

- [ ] **Step 10: Run everything touched.** Sync (the clone now has the committed
      fixtures), build, run `Visualization_Tests` (no filter), `Table_Tests`,
      `SQLite_Tests`. Expected: pass, including the 3 integration cases.
      `-Werror` lint on Table, Database, Visualization and
      `test/Visualization_Tests`. Expected: no warnings. Fix anything here with
      `git commit --amend`.

### Task B1.4: Every other producer on the writer

**Files:**

- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Json.enso`
  (replace `make_json_for_*` with the views below),
  `src/Internal/Columns_Source.enso`, `src/Viz_Table.enso:183-219`,
  `src/Table/Visualization.enso:28-38`
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Viz_Helpers.enso:56-67`
- Modify: `distribution/lib/Standard/XML/0.0.0-dev/src/XML.enso:972-1019`
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/Common/Connections_Helpers.enso:8`,
  `distribution/lib/Standard/Excel/0.0.0-dev/src/Excel_Workbook.enso:514`,
  `distribution/lib/Standard/Google/0.0.0-dev/src/Google_Sheets_Workbook.enso:190`
- Modify: `test/Visualization_Tests/src/Table_Spec.enso` (vector, array, other
  datatypes, links, value types), `src/Viz_Table_Spec.enso:13-18`,
  `test/XML_Tests/src/Visualization_Spec.enso`
- Regenerate: every remaining `table_*.json`

**Interfaces:**

- Consumes: B1.2's API.
- Produces, in `View_Json`:
  `vector_view (vector : Vector) (max_rows : Integer) -> Text`,
  `dictionary_view`, `hashset_view`, `js_object_view` (each
  `(value) (max_items : Integer) -> Text`), `value_view (x : Any) -> Text`.
  Deleted: `make_json_for_error`, `make_json_for_vector`,
  `make_json_for_matrix`, `make_json_for_object_matrix`,
  `make_json_for_dictionary`, `make_json_for_hashset`,
  `make_json_for_js_object`, `make_json_for_other`. The link templates each view
  writes (read off `getAstPattern`'s completion of today's bare actions):

  | View                          | Link column / index | Template                     | Label       |
  | ----------------------------- | ------------------- | ---------------------------- | ----------- |
  | Vector, matrix, object matrix | index               | `at {{#index}}`              | (value)     |
  | Dictionary                    | `key`               | `at {{#key}}`                | `value`     |
  | Row                           | `column`            | `at {{@column}}`             | (value)     |
  | XML document                  | `key`               | `get_child_element {{#key}}` | (value)     |
  | XML element                   | `key`               | `get {{#key}}`               | (value)     |
  | Connection (generic)          | `Table`             | `query {{@Table}}`           | `table`     |
  | Excel and Google workbooks    | `worksheets`        | `read {{@worksheets}}`       | `worksheet` |
  | In-memory / database table    | index               | `get_row {{#index}}`         | `row`       |
  | In-memory / database column   | index               | `at {{#index}}`              | `row`       |

  (`{{@field}}` equals today's completion of a bare action: the link column's
  value, a number only when it is one; the other libraries' templates are
  already explicit and unchanged.)

- [ ] **Step 1: Write the failing tests.** In `Table_Spec.enso` replace "should
      handle Vectors", "should handle Arrays", "should handle other datatypes",
      "should handle datatypes with links" and "should visualize value type
      info" with:

```enso
        group_builder.specify "should handle Vectors" <|
            vis = Visualization.prepare_visualization [1, 2, 3] 2
            vis.parse_json . should_equal <| Json.parse '{"kind":"grid","row_count":3,"columns":[{"name":"Value","number_format":false}],"index":{"action":"at {{#index}}"},"data":[[1,2]],"options":{"disable_sort_when_partial":true}}'

            vis2 = Visualization.prepare_visualization [[1, 2], [3, 4]] 2
            vis2.parse_json . should_equal <| Json.parse '{"kind":"grid","row_count":2,"columns":[{"name":"0"},{"name":"1"}],"index":{"action":"at {{#index}}"},"data":[[1,3],[2,4]],"options":{"disable_sort_when_partial":true}}'

        group_builder.specify "should mark the cells a short or Nothing row lacks" <|
            vis = Visualization.prepare_visualization [[1, 2], Nothing, [3]]
            vis.parse_json.get "data" . should_equal <| Json.parse '[[1,{"_missing_":true},3],[2,{"_missing_":true},{"_missing_":true}]]'

        group_builder.specify "should order record fields as the IDE always has" <|
            vis = Visualization.prepare_visualization [JS_Object.from_pairs [["b", 1], ["10", 2], ["2", 3]], JS_Object.from_pairs [["a", 4]]]
            vis.parse_json.get "columns" . map (c-> c.get "name") . should_equal ["2", "10", "b", "a"]

        group_builder.specify "should handle Arrays" <|
            vis = Visualization.prepare_visualization ([1, 2, 3] . to_array) 2
            vis.parse_json . should_equal <| Json.parse '{"kind":"grid","row_count":3,"columns":[{"name":"Value","number_format":false}],"index":{"action":"at {{#index}}"},"data":[[1,2]],"options":{"disable_sort_when_partial":true}}'

        group_builder.specify "should handle other datatypes" <|
            vis = Visualization.prepare_visualization (Foo.Value 42) 2
            vis.parse_json . should_equal <| JS_Object.from_pairs [["kind", "value"], ["value", JS_Object.from_pairs [["_display_text_", (Foo.Value 42).to_display_text], ["x", 42]]]]

        group_builder.specify "should show a value's links as one of its fields" <|
            example = Foo_Link.Value "test-value"
            vis = Visualization.prepare_visualization example
            vis.parse_json . should_equal <| JS_Object.from_pairs [["kind", "value"], ["value", JS_Object.from_pairs [["_display_text_", example.to_display_text], ["x", "test-value"], ["links", "[a, b, c]"]]]]

        group_builder.specify "should visualize value type info" <|
            make_json vt =
                js_object = vt.to_js_object
                pairs = [["_display_text_", vt.to_display_text]] + vt.to_js_object.field_names.map f-> [f, js_object.get f]
                JS_Object.from_pairs [["kind", "value"], ["value", JS_Object.from_pairs pairs]]

            Visualization.prepare_visualization Value_Type.Boolean . parse_json . should_equal (make_json Value_Type.Boolean)
            Visualization.prepare_visualization Value_Type.Float . parse_json . should_equal (make_json Value_Type.Float)
            Visualization.prepare_visualization Value_Type.Decimal . parse_json . should_equal (make_json Value_Type.Decimal)
            Visualization.prepare_visualization Value_Type.Char . parse_json . should_equal (make_json Value_Type.Char)
            Visualization.prepare_visualization Value_Type.Unsupported_Data_Type . parse_json . should_equal (make_json Value_Type.Unsupported_Data_Type)
```

In `Viz_Table_Spec.enso` replace "renders the Generic_Grid table view" with:

```enso
        group_builder.specify "renders a grid of its columns, links included" <|
            json = grid.table_view_json . parse_json
            json.get "kind" . should_equal "grid"
            json.get "data" . should_equal [["a", "b", "c"], [1, 2, 3]]
            json.get "columns" . at 0 . get "link" . should_equal (JS_Object.from_pairs [["action", "query"], ["label", "table"]])
            json.get "columns" . at 1 . get "name" . should_equal "Rows"
            json.contains_key "row_count" . should_be_false
```

In `test/XML_Tests/src/Visualization_Spec.enso` replace the three
`json.get "type" …`/`get_child_node_action` assertions and the
`"all_rows_count"` reads:

```enso
        group_builder.specify "An XML_Document shows its root element's attributes and children" <|
            json = Visualization.prepare_visualization doc . parse_json
            json.get "columns" . at 0 . get "link" . get "action" . should_equal "get_child_element {{#key}}"
            json.get "row_count" . should_equal 3
            json.get "data" . should_equal [["@id", "0", "1"], ["Attribute", "Element", "Text"], ["10", "<bar>hello</bar>", "text"]]
```

and in the other two cases `default_json.get "all_rows_count"` →
`default_json.get "row_count"`, `json.get "type" . should_equal "XML_Element"` →
delete, `json.get "get_child_node_action" . should_equal "get {{#key}}"` →
`json.get "columns" . at 0 . get "link" . get "action" . should_equal "get {{#key}}"`.

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` filtered to `Table Visualization` and
      `Viz_Table from columns`, and `XML_Tests`. Expected: the new cases fail
      (old shapes).

- [ ] **Step 3: The views in `View_Json.enso`.** Delete `make_json_for_error`
      through `make_json_for_other` (everything between `max_columns` and the
      B1.2 API). Insert after `max_columns`:

```enso
## ---
   private: true
   ---
   The view of a vector: a grid with a row-number column. A vector of vectors
   has one column per item (at most `max_columns`), a vector of records one
   per field, any other vector one `Value` column.
vector_view (vector : Vector) (max_rows : Integer) -> Text =
    truncated = vector.take max_rows
    some_values = truncated.any (v-> Nothing!=v)
    if some_values.not then _values_view truncated vector.length else
        matrix = _matrix_rows (Builder.new truncated.length) truncated
        if matrix.is_nothing.not then _matrix_view matrix vector.length else
            records = _record_rows (Builder.new truncated.length) truncated
            if records.is_nothing.not then _record_view records vector.length else
                _values_view truncated vector.length

private _values_view (values : Vector) (row_count : Integer) -> Text =
    column = View_Column.Value "Value" number_format=False
    grid_json [column.to_json_text] [cells_json values] row_count (View_Link.Value "at {{#index}}") options=["disable_sort_when_partial"]

## Each row's rendered cells, at most `max_columns` (`Nothing` for a `Nothing`
   row); `Nothing` when some row is not a vector or an array.
private _matrix_rows (current : Builder) (vector : Vector) (idx : Integer = 0) -> Vector | Nothing = if idx == vector.length then current.to_vector else
    row = vector.at idx
    to_append = case row of
        Nothing -> Nothing
        _ : Vector -> row.take max_columns . map Viz_Cell.render_value
        _ : Array -> row.to_vector.take max_columns . map Viz_Cell.render_value
        _ -> False
    if to_append == False then Nothing else
        current.append to_append
        @Tail_Call _matrix_rows current vector idx+1

private _matrix_view (rows : Vector) (row_count : Integer) -> Text =
    column_count = rows.fold 0 c-> r-> if r.is_nothing then c else c.max r.length
    indices = 0.up_to column_count . to_vector
    columns = indices.map i-> (View_Column.Value i.to_text).to_json_text
    data = indices.map i->
        (rows.map r-> if r.is_nothing || (i >= r.length) then missing_cell else r.at i) . to_json
    grid_json columns data row_count (View_Link.Value "at {{#index}}") options=["disable_sort_when_partial"]

## Each row as a `JS_Object` of rendered fields (`Nothing` for a `Nothing`
   row): a Dictionary's entries, a record's `Viz_Cell` pairs, or an atom's
   `to_js_object`; `Nothing` when some row is none of these (dates and times
   included).
private _record_rows (current : Builder) (vector : Vector) (idx : Integer = 0) -> Vector | Nothing = if idx == vector.length then current.to_vector else
    row = vector.at idx
    to_append = case row of
        Nothing -> Nothing
        _ : Date -> False
        _ : Time_Of_Day -> False
        _ : Date_Time -> False
        _ : Duration -> False
        _ : Period -> False
        _ : Dictionary ->
            pairs = row.keys.map k-> [k.to_text, Viz_Cell.render_value (row.get k)]
            JS_Object.from_pairs pairs
        _ ->
            record = (Viz_Cell.from row).pairs
            if record.is_nothing.not then JS_Object.from_pairs (record.map p-> [p.first, Viz_Cell.render_value p.second]) else
                js_object = row.to_js_object
                if js_object.is_a JS_Object . not then False else
                    if js_object.field_names.sort == ["constructor", "type"] then False else
                        pairs = js_object.field_names.map f-> [f, Viz_Cell.render_value (js_object.get f)]
                        JS_Object.from_pairs pairs
    if to_append == False then Nothing else
        current.append to_append
        @Tail_Call _record_rows current vector idx+1

private _record_view (rows : Vector) (row_count : Integer) -> Text =
    names = _record_columns rows
    columns = names.map n-> (View_Column.Value n number_format=False).to_json_text
    data = names.map n->
        (rows.map r-> if r.is_nothing then missing_cell else (if r.contains_key n then r.get n else missing_cell)) . to_json
    grid_json columns data row_count (View_Link.Value "at {{#index}}") options=["disable_sort_when_partial"]

## The columns of a vector of records: each record's fields in the order the
   IDE has always shown them (`JSON.parse` puts integer-like names first, in
   ascending order), a name not seen before appended.
private _record_columns (rows : Vector) -> Vector Text =
    rows.fold [] seen-> r-> if r.is_nothing then seen else
        names = _browser_order r.field_names
        seen + (names.filter (n-> (seen.contains n).not))

private _browser_order (names : Vector Text) -> Vector Text =
    is_index n = n.match "0|[1-9][0-9]{0,8}"
    indices = names.filter is_index . sort on=(n-> Integer.parse n)
    indices + (names.filter (n-> (is_index n).not))

## ---
   private: true
   ---
   The view of a Dictionary: a `key` column that links to the entry, and a
   `value` column.
dictionary_view (dict : Dictionary) (max_items : Integer) -> Text =
    pairs = Warning.clear (dict.to_vector.take max_items)
    columns = [View_Column.Value "key" (View_Link.Value "at {{#key}}" "value"), View_Column.Value "value"]
    data = [(pairs.map p-> p.first.to_text) . to_json, cells_json (pairs.map .second)]
    grid_json (columns.map .to_json_text) data dict.size

## ---
   private: true
   ---
   The view of a Hashset: one `key` column.
hashset_view (hashset : Hashset) (max_items : Integer) -> Text =
    items = Warning.clear (hashset.to_vector.take max_items)
    grid_json [(View_Column.Value "key").to_json_text] [cells_json items] hashset.size

## ---
   private: true
   ---
   The view of a JS_Object: `key` and `value` columns.
js_object_view (js_object : JS_Object) (max_items : Integer) -> Text =
    fields = js_object.field_names
    shown = Warning.clear (fields.take max_items)
    columns = [View_Column.Value "key", View_Column.Value "value"]
    grid_json (columns.map .to_json_text) [shown.to_json, cells_json (shown.map f-> js_object.get f)] fields.length

## ---
   private: true
   ---
   The view of any other value: its `to_js_object` with its display text
   first and its fields rendered, or its display text and the error when
   `to_js_object` fails.
value_view (x : Any) -> Text =
    js_value = Panic.recover Any x.to_js_object
    value = case js_value.is_error of
        False -> if js_value.is_a JS_Object . not then js_value else
            pairs = [['_display_text_', x.to_display_text]] + js_value.field_names.map f-> [f, Viz_Cell.render_value (js_value.get f)]
            JS_Object.from_pairs pairs
        True -> JS_Object.from_pairs [["_display_text_", x.to_display_text], ["_to_js_object_error_", js_value.catch.to_display_text]]
    value_json value
```

- [ ] **Step 4: Point the conversions at the views.** In `Viz_Table.enso`:

```enso
Viz_Table.from (that:Any) = Viz_Table.from_view (_-> View_Json.value_view that)
```

```enso
Viz_Table.from (that:Vector) = Viz_Table.from_view (max_rows-> View_Json.vector_view that max_rows)
```

```enso
Viz_Table.from (that:Dictionary) = Viz_Table.from_view (max_rows-> View_Json.dictionary_view that max_rows)
```

```enso
Viz_Table.from (that:Hashset) = Viz_Table.from_view (max_rows-> View_Json.hashset_view that max_rows)
```

```enso
Viz_Table.from (that:JS_Object) = Viz_Table.from_view (max_rows-> View_Json.js_object_view that max_rows)
```

```enso
Viz_Table.from (that:Number) = Viz_Table.from_view (_-> View_Json.value_json (Viz_Cell.render_value that))
```

In `Table/Visualization.enso` replace the body of `prepare_visualization`'s
block with:

```enso
    if y.is_error then View_Json.error_json y.catch.to_display_text else
        x = Warning.set y []
        case x of
            f : Function -> View_Json.value_json (JS_Object.from_pairs [['_display_text_', '[Function '+f.to_text+']']])
            _ -> (Viz_Table.from x).table_view_json max_rows
```

In `Columns_Source.enso` add `import project.Internal.View_Json` and
`from project.Internal.View_Json import View_Column, View_Link`, and replace
`table_view_json` with:

```enso
    ## A grid of the columns; no row count and no row numbers, as before.
    table_view_json self _ -> Text =
        column_json header = case header of
            Viz_Header.Label name -> View_Column.Value name number_format=False
            Viz_Header.Link name tooltip action -> View_Column.Value name (View_Link.Value action tooltip) number_format=False
        View_Json.grid_json (self.headers.map h-> (column_json h).to_json_text) (self.columns.map View_Json.cells_json)
```

and update its type comment ("the table view is a grid of the columns").

- [ ] **Step 5: Row and XML.** In `Viz_Helpers.enso` add
      `import Standard.Visualization.Internal.View_Json` and
      `from Standard.Visualization.Internal.View_Json import View_Column, View_Link`,
      and replace `row_table_view_json`:

```enso
## ---
   private: true
   ---
   The table view of a single row: a `column` column that links to the value,
   and a `value` column.
row_table_view_json row -> Text =
    values = (0.up_to row.length).map idx-> Viz_Cell.render_value (row.get idx)
    columns = [View_Column.Value "column" (View_Link.Value "at {{@column}}"), View_Column.Value "value"]
    View_Json.grid_json (columns.map .to_json_text) [row.column_names.to_json, values.to_json] row.length
```

In `XML.enso` add `import Standard.Visualization.Internal.View_Json` and
`from Standard.Visualization.Internal.View_Json import View_Column, View_Link`;
change the two conversions to
`Viz_Table.from_view (max_rows-> _table_view that "get {{#key}}" max_rows)` and
`Viz_Table.from_view (max_rows-> _table_view that.root_element "get_child_element {{#key}}" max_rows)`;
rename `_table_viz_json` to `_table_view` with signature
`private _table_view xml_element:XML_Element action:Text max_items:Integer -> Text =`;
keep its body from `all_attributes = …` to `map_vector = …`, replacing the
`header = …` and `all_rows = …` lines with
`row_count = all_attributes.length + (Dom.child_count xml_element.java_element)`
(after `all_attributes`), and replace its last four lines (`data = …` to the
`JS_Object.from_pairs` line) with:

```enso
    columns = [View_Column.Value "key" (View_Link.Value action), View_Column.Value "type", View_Column.Value "value"]
    data = [(map_vector.map .first).to_json, (map_vector.map .second).to_json, (map_vector.map (i-> i.at 2)).to_json]
    View_Json.grid_json (columns.map .to_json_text) data row_count
```

Update the two conversions' doc comments' references accordingly.

- [ ] **Step 6: Explicit templates in three libraries.** In
      `Connections_Helpers.enso` change `"query"` to `"query {{@Table}}"`; in
      `Excel_Workbook.enso:514` and `Google_Sheets_Workbook.enso:190` change
      `"read"` to `"read {{@worksheets}}"`.

- [ ] **Step 7: Run the tests and regenerate the goldens.** Sync, build, run the
      tests of Step 2. Expected: pass. Run with `ENSO_UPDATE_PINNED=1` and
      filter `Pinned table view JSON`; copy back. Expected changed set: every
      remaining `table_*.json` (`git status`), e.g. `table_dictionary.json` =
      `{"kind":"grid","row_count":2,"columns":[{"name":"key","link":{"action":"at {{#key}}","label":"value"}},{"name":"value"}],"data":[["a","b"],[1,"[1, 2]"]]}`,
      `table_row.json` starting
      `{"kind":"grid","row_count":4,"columns":[{"name":"column","link":{"action":"at {{@column}}"}},{"name":"value"}],`,
      `table_connection.json` =
      `{"kind":"grid","columns":[{"name":"Table","link":{"action":"query {{@Table}}","label":"table"},"number_format":false}],"data":[["pinned","pinned_geo"]]}`,
      `table_error.json` = `{"kind":"error","error":"Illegal Argument: boom"}`,
      `table_number.json` = `{"kind":"value","value":42}`. Run
      `git grep -n "\"type\":\"\(Matrix\|Object_Matrix\|Vector\|Map\|Generic_Grid\|EnsoTableOrColumn\|Error\)\"\|all_rows_count\|get_child_node" -- test/Visualization_Tests/data/pinned`.
      Expected: no output.

- [ ] **Step 8: Run everything touched.** `Visualization_Tests`, `XML_Tests`,
      `Table_Tests`, `SQLite_Tests`, `Excel_Tests`. Expected: pass. `-Werror`
      lint on Visualization, Table, Database, XML, Excel, Google,
      `test/Visualization_Tests`, `test/XML_Tests`. Expected: no warnings.

- [ ] **Step 9: Commit.**

```bash
git add distribution/lib/Standard test/Visualization_Tests test/XML_Tests
git commit -m "Visualization: every value writes the one table view format"
```

### Task B1.5: The GUI reads the one format (the gate)

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`
  (replace the B0 internals)
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`
- Modify:
  `app/gui/src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts`
  (the two marked lines only)
- Modify:
  `app/gui/src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts`
- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/tableViewMessage.test.ts`
- Update (one entry): `__tests__/__snapshots__/tableViewSnapshot.test.ts.snap`
  (`table_db_read_error`)

**Interfaces:**

- Consumes: the goldens of B1.3 and B1.4.
- Produces: the same exported names as B0.2, except that `TableViewContext`
  loses `previousRowData` and `initialData`, `TableView.isTruncated` is
  `boolean`, `Data` is gone, and
  `computeBottomStatusBar(requested: boolean, total: number | undefined, filtered: number | null)`.

- [ ] **Step 1: Write the failing tests.** Create `tableViewMessage.test.ts`:

```ts
// The messages below are the engine's table view format, whose field names are snake_case
// (`row_count`, `number_format`, …); renaming them would stop them being that format.
/* eslint-disable camelcase */
import { Ast } from "@/util/ast";
import type { CellDoubleClickedEvent } from "ag-grid-community";
import { describe, expect, test } from "vitest";
import {
  buildTableView,
  distinctValuesFromResponse,
  rowsFromPage,
  tableViewFlags,
  type TableViewContext,
} from "../TableVisualization/tableView";

function context(created: string[] = []): TableViewContext {
  return {
    isSSRM: false,
    getFilterValues: async () => {},
    createNode: (pattern) =>
      created.push(
        pattern.instantiateCopied([Ast.parseExpression("operator1")!]).code(),
      ),
  };
}

describe("The table view message", () => {
  test("an error shows in one Error cell", () => {
    const view = buildTableView(
      { kind: "error", error: "Error querying the database:\nboom" },
      context(),
    );
    expect(view.columnDefs.map((col) => col.field)).toEqual(["Error"]);
    expect(view.rowData).toEqual([
      { Error: "Error querying the database:\nboom" },
    ]);
  });

  test("a message that fails the schema shows why", () => {
    const view = buildTableView(
      { kind: "grid", columns: "x", data: [] },
      context(),
    );
    expect(view.columnDefs.map((col) => col.field)).toEqual(["Error"]);
    expect(view.rowData?.[0]?.Error).toMatch(
      /^Invalid table visualization data: columns: /,
    );
  });

  test("an object of another visualisation shows an empty grid", () => {
    const view = buildTableView({ a: 1 }, context());
    expect(view.columnDefs).toEqual([]);
    expect(view.rowData).toEqual([]);
  });

  test("a value that is not an object shows as one value", () => {
    expect(buildTableView(42, context()).rowData).toEqual([{ Value: 42 }]);
  });

  test("a missing cell is empty, unlike Nothing", () => {
    const view = buildTableView(
      {
        kind: "grid",
        row_count: 2,
        columns: [{ name: "0" }, { name: "1" }],
        index: { action: "at {{#index}}" },
        data: [
          [1, null],
          [2, { _missing_: true }],
        ],
      },
      context(),
    );
    expect(view.rowData?.[1]).toEqual({ "#": 1, "0": null });
    expect(
      "1" in view.rowData![1]! && view.rowData![1]!["1"] === undefined,
    ).toBe(true);
  });

  test("{{#index}} is the row number", () => {
    const created: string[] = [];
    const view = buildTableView(
      {
        kind: "grid",
        row_count: 1,
        columns: [{ name: "index" }],
        index: { action: "get_row {{#index}}" },
        data: [["x"]],
      },
      context(created),
    );
    view.columnDefs[0]!.onCellDoubleClicked!({
      data: view.rowData![0],
    } as CellDoubleClickedEvent);
    expect(created[0]).toMatch(/\.get_row 0$/);
  });

  test("a server page numbers its rows from its index", () => {
    const view = buildTableView(
      {
        kind: "grid",
        row_count: 5000,
        columns: [{ name: "x" }],
        index: { action: "get_row {{#index}}" },
        data: null,
        server: true,
      },
      context(),
    );
    expect(view.rowData).toBeUndefined();
    const page = rowsFromPage(view.columnDefs, {
      row_count: 2,
      index: [7, 3],
      data: [["a", "b"]],
    });
    expect(page).toEqual({
      rows: [
        { "#": 7, x: "a" },
        { "#": 3, x: "b" },
      ],
      rowCount: 2,
    });
  });

  test("distinct values pass through, null included", () => {
    expect(distinctValuesFromResponse({ values: ["a", "b"] })).toEqual([
      "a",
      "b",
    ]);
    expect(distinctValuesFromResponse({ values: null })).toBeNull();
  });

  test("the flags come from the grid", () => {
    const flags = tableViewFlags({
      kind: "grid",
      row_count: 3,
      columns: [
        {
          name: "x",
          value_type: { constructor: "Integer", display_text: "Integer" },
        },
      ],
      data: [[1, 2, 3]],
      version_hash: "v",
      options: { status_bar: true, create_node: true },
    });
    expect(flags).toEqual({
      allRowCount: 3,
      versionHash: "v",
      isSSRM: false,
      bottomStatusBarRequested: true,
      createNodeEnabled: true,
      columnNames: ["x"],
      columnTypes: new Map([["x", "Integer"]]),
    });
  });
});
```

Rewrite `TableVisualization.statusBar.test.ts` for the new signature:

```ts
import { describe, expect, test } from "vitest";
import { computeBottomStatusBar } from "../TableVisualization.vue";

describe("computeBottomStatusBar", () => {
  test("shows the row counts when the view asks for a bottom status bar", () => {
    expect(computeBottomStatusBar(true, 42, null)).toEqual({
      total: 42,
      filtered: null,
      showFiltered: false,
    });
  });

  test("is absent when the view did not ask for one", () => {
    expect(computeBottomStatusBar(false, 42, null)).toBeUndefined();
  });

  test("shows the filtered count only when it differs from the total", () => {
    expect(computeBottomStatusBar(true, 42, 7)?.showFiltered).toBe(true);
    expect(computeBottomStatusBar(true, 42, 42)?.showFiltered).toBe(false);
    expect(computeBottomStatusBar(true, 42, null)?.showFiltered).toBe(false);
  });
});
```

In `tableViewSnapshot.test.ts` delete the two lines marked `B0 only` (nothing
else in that file changes).

- [ ] **Step 2: Run them to see them fail.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__`.
      Expected: the new tests and the status-bar test fail; the snapshot test
      fails on every `table_*` and `ssrm_*` case (new goldens, old parser).

- [ ] **Step 3: Replace `tableView.ts`'s internals.** Keep the file's doc
      comment, `INDEX_FIELD_NAME`, `DataQualityMetricValue`, `getSvgTemplate`,
      `getValueTypeIcon`, `ParsedActionTemplate`, `isNumber`, `LinkFieldOptions`
      and the `TableViewFlags` interface. Delete `Data`, `Matrix`,
      `ObjectMatrix`, `EnsoTableOrColumn`, the `DataQualityMetric*` types,
      `defaultData`, `addRowIndex`, `createRowsForTable`, `columnTypes`,
      `createNode` and the imports of `TableVisualisationTypes`. Add at the top,
      after the doc comment:

```ts
/* eslint-disable camelcase */
// The schema spells the wire format's snake_case field names (`row_count`, `value_type`, …).
```

and `import { z } from 'zod'`. Then replace the rest with:

```ts
const linkSchema = z.object({
  action: z.string(),
  label: z.string().optional(),
});

const columnSchema = z.object({
  name: z.string(),
  value_type: z
    .object({ constructor: z.string(), display_text: z.string() })
    .optional(),
  link: linkSchema.optional(),
  metrics: z
    .array(
      z.object({
        name: z.string(),
        value: z.union([z.string(), z.number(), z.null()]),
        type: z.enum(["Text", "Count", "Percentage"]),
      }),
    )
    .optional(),
  multi_filter: z.boolean().optional(),
  number_format: z.boolean().optional(),
});

const gridSchema = z.object({
  kind: z.literal("grid"),
  row_count: z.number().optional(),
  columns: z.array(columnSchema),
  index: linkSchema.optional(),
  data: z.array(z.array(z.unknown())).nullable(),
  version_hash: z.string().optional(),
  server: z.boolean().optional(),
  options: z
    .object({
      status_bar: z.boolean().optional(),
      create_node: z.boolean().optional(),
      disable_sort_when_partial: z.boolean().optional(),
    })
    .optional(),
});

/** The table view message (`Standard.Visualization.Internal.View_Json`). */
const viewMessageSchema = z.discriminatedUnion("kind", [
  gridSchema,
  z.object({ kind: z.literal("value"), value: z.unknown() }),
  z.object({ kind: z.literal("error"), error: z.string() }),
]);

/** A server-side page (`get_rows_for_table`). */
const rowsPageSchema = z.object({
  row_count: z.number(),
  index: z.array(z.unknown()),
  data: z.array(z.array(z.unknown())),
});

/** A column's distinct values (`get_distinct_values_for_column`). */
const distinctValuesSchema = z.object({
  values: z.array(z.unknown()).nullable(),
});

type ViewMessage = z.infer<typeof viewMessageSchema>;
type GridMessage = z.infer<typeof gridSchema>;
type ViewColumn = z.infer<typeof columnSchema>;

/** What `buildTableView` needs from the component. */
export interface TableViewContext {
  /** Whether the server sorts, filters and pages the rows. */
  isSSRM: boolean;
  /** Fetches a set filter's values from the server. */
  getFilterValues: (
    params: SetFilterValuesFuncParams<any, string>,
  ) => Promise<void>;
  /** Creates a node from a link's pattern; the pattern is applied to the visualised node. */
  createNode: (pattern: Pattern<Ast.Expression>) => void;
}

/** What a refresh gives AG Grid and the status bar. */
export interface TableView {
  columnDefs: ColDef[];
  /** `undefined`: the server pages the rows. */
  rowData: Record<string, any>[] | undefined;
  isTruncated: boolean;
  /** Per column: whether its numbers group their digits. */
  dataGrouping: Map<string, boolean>;
  rowCount: number;
  showRowCount: boolean;
}

const parsedMessages = new WeakMap<object, ViewMessage | undefined>();

/**
 * The message `data` holds. A value that is not an object is shown as one value. An object
 * without a `kind` is another visualisation's data, received briefly while the visualisation is
 * switched: `undefined`, an empty grid. A message that fails the schema becomes an error saying
 * why. Parsed once per object (the flags and the refresh both ask).
 */
function parseViewMessage(data: unknown): ViewMessage | undefined {
  if (typeof data !== "object" || data === null)
    return { kind: "value", value: data };
  if (parsedMessages.has(data)) return parsedMessages.get(data);
  let message: ViewMessage | undefined = undefined;
  if ("kind" in data) {
    const parsed = viewMessageSchema.safeParse(data);
    message = parsed.success
      ? parsed.data
      : {
          kind: "error",
          error: `Invalid table visualization data: ${describeIssues(parsed.error)}`,
        };
  }
  parsedMessages.set(data, message);
  return message;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(message)"}: ${issue.message}`)
    .join("; ");
}

interface FieldOptions {
  valueType?: ValueType | undefined;
  metrics?: ViewColumn["metrics"];
  multiFilter?: boolean | undefined;
  total: number | undefined;
}
```

Then `toField`, adapted from B0's (which came verbatim from the component):
signature
`function toField(name: string, options: FieldOptions, ctx: TableViewContext): ColDef`;
its first lines become

```ts
const { valueType, metrics, multiFilter = false, total } = options;

const displayValue = valueType ? valueType.display_text : null;
const icon = valueType ? getValueTypeIcon(valueType.constructor) : null;
const cellValueType = valueType
  ? getCellDataType(valueType.constructor)
  : false;

const filterType = valueType
  ? getFilterType(valueType.constructor, multiFilter)
  : null;

const filterParams = getFilterParams(
  ctx.isSSRM,
  valueType,
  ctx.getFilterValues,
);

const dataQualityMetrics = (metrics ?? []).flatMap(
  (metric): DataQualityMetricValue[] => {
    if (metric.value === null) return [];
    const result: DataQualityMetricValue =
      metric.type === "Text"
        ? {
            name: metric.name,
            value: (metric.value as string) || "",
            displayType: "Text",
          }
        : {
            name: metric.name,
            displayType: metric.type,
            value: (metric.value as number) || 0,
          };
    return result.displayType === "Percentage" && result.value === 0
      ? []
      : [result];
  },
);
```

and `tooltipComponentParams.total` becomes `total`; the rest of `toField`
(template, `colDef`, the date comparator) is unchanged.

`parseActionTemplate` loses its default selector (every template is explicit),
and `getAstPattern` reads `index` as the row number:

```ts
function parseActionTemplate(input: string): ParsedActionTemplate {
  const selectors: { name: string; numeric: boolean }[] = [];
  const pattern =
    "__." +
    input.replace(/{{([#@]?)(\w+)}}/g, (_, flag, key) => {
      selectors.push({ name: key, numeric: flag === "#" });
      return "__";
    });
  return { pattern, selectors };
}

/**
 * The node a link creates from a row: `action` with `{{#field}}` replaced by the row's value of
 * `field` (a number when it reads as one), `{{@field}}` by the value as it is, and `{{#index}}`
 * by the row number.
 */
function getAstPattern(params: CellDoubleClickedEvent, action: string) {
  const parsedAction = parseActionTemplate(action);

  return Pattern.new<Ast.Expression>((ast) => {
    const mappedExpressions = parsedAction.selectors.map(
      ({ name, numeric }) => {
        const value =
          name === "index" ? params.data[INDEX_FIELD_NAME] : params.data[name];
        const castedValue =
          numeric && !isNaN(Number(value)) ? Number(value) : value;
        return isNumber(castedValue)
          ? Ast.tryNumberToEnso(castedValue, ast.module)!
          : Ast.TextLiteral.new(castedValue, ast.module);
      },
    );

    const templatePattern = Pattern.parseExpression(parsedAction.pattern);
    return templatePattern.instantiateCopied([ast, ...mappedExpressions]);
  });
}
```

`toLinkField(fieldName, options, ctx)` keeps its body except
`onCellDoubleClicked: (params) => ctx.createNode(getAstPattern(params, getChildAction)),`.
Then:

```ts
function isMissing(cell: unknown): boolean {
  return (
    typeof cell === "object" &&
    cell !== null &&
    (cell as Record<string, unknown>)._missing_ === true
  );
}

/**
 * Rows from column-major `data`, one array per column after the index column. The index column
 * holds `index[i]` when given (a server page), else the row number. A missing cell becomes
 * `undefined` (an empty cell).
 */
function createRows(
  columnDefs: ColDef[],
  data: unknown[][],
  index?: readonly unknown[],
): Record<string, any>[] {
  const rows = index ? index.length : (data[0]?.length ?? 0);
  const shift = columnDefs[0]?.field === INDEX_FIELD_NAME ? 1 : 0;
  return Array.from({ length: rows }, (_, i) =>
    Object.fromEntries(
      columnDefs.map((col, j) => {
        if (col.field === INDEX_FIELD_NAME)
          return [col.field, index ? index[i] : i];
        const cell = data[j - shift]?.[i];
        return [col.field, isMissing(cell) ? undefined : cell];
      }),
    ),
  );
}

/** Whether a column's values call for digit grouping (beyond ±999999). */
function needsGrouping(rows: Record<string, any>[], field: string): boolean {
  return rows.some((row) => {
    const value =
      row[field] && typeof row[field] === "object"
        ? row[field].value
        : row[field];
    return value > 999999 || value < -999999;
  });
}

function buildGrid(message: GridMessage, ctx: TableViewContext): TableView {
  const total = message.row_count;
  const columnDefs: ColDef[] = [];
  if (message.index) {
    columnDefs.push(
      toLinkField(
        INDEX_FIELD_NAME,
        {
          tooltipValue: message.index.label,
          getChildAction: message.index.action,
        },
        ctx,
      ),
    );
  }
  for (const column of message.columns) {
    columnDefs.push(
      column.link
        ? toLinkField(
            column.name,
            {
              tooltipValue: column.link.label,
              getChildAction: column.link.action,
            },
            ctx,
          )
        : toField(
            column.name,
            {
              valueType: column.value_type,
              metrics: column.metrics,
              multiFilter: column.multi_filter,
              total,
            },
            ctx,
          ),
    );
  }
  const rowData =
    message.data == null ? undefined : createRows(columnDefs, message.data);
  const rowsSent = message.data?.[0]?.length ?? 0;
  const dataGrouping = new Map<string, boolean>();
  if (message.index) dataGrouping.set(INDEX_FIELD_NAME, false);
  for (const column of message.columns) {
    dataGrouping.set(
      column.name,
      column.number_format ?? needsGrouping(rowData ?? [], column.name),
    );
  }
  return {
    columnDefs,
    rowData,
    isTruncated:
      message.options?.disable_sort_when_partial === true &&
      total != null &&
      total !== rowsSent,
    dataGrouping,
    rowCount: total ?? 1,
    showRowCount: total != null,
  };
}

/** The view of `data`, the message `prepare_visualization` sent. */
export function buildTableView(
  data: unknown,
  ctx: TableViewContext,
): TableView {
  const message = parseViewMessage(data);
  if (message === undefined) {
    return {
      columnDefs: [],
      rowData: [],
      isTruncated: false,
      dataGrouping: new Map(),
      rowCount: 1,
      showRowCount: false,
    };
  }
  switch (message.kind) {
    case "error":
      return {
        columnDefs: [
          { field: "Error", cellStyle: { "white-space": "normal" } },
        ],
        rowData: [{ Error: message.error }],
        isTruncated: false,
        dataGrouping: new Map([["Error", false]]),
        rowCount: 1,
        showRowCount: false,
      };
    case "value":
      return {
        columnDefs: [toField("Value", { total: undefined }, ctx)],
        rowData: [{ Value: message.value }],
        isTruncated: false,
        dataGrouping: new Map([["Value", false]]),
        rowCount: 1,
        showRowCount: false,
      };
    case "grid":
      return buildGrid(message, ctx);
  }
}

/** What the component reads from `data` outside a refresh. */
export function tableViewFlags(data: unknown): TableViewFlags {
  const message = parseViewMessage(data);
  if (message?.kind !== "grid") {
    return {
      allRowCount: 0,
      versionHash: null,
      isSSRM: false,
      bottomStatusBarRequested: false,
      createNodeEnabled: false,
      columnNames: [],
      columnTypes: new Map(),
    };
  }
  return {
    allRowCount: message.row_count ?? 0,
    versionHash: message.version_hash ?? null,
    isSSRM: message.server === true,
    bottomStatusBarRequested: message.options?.status_bar === true,
    createNodeEnabled: message.options?.create_node === true,
    columnNames: message.columns.map((column) => column.name),
    columnTypes: new Map<string, string>(
      message.columns.flatMap((column) =>
        column.value_type
          ? [[column.name, column.value_type.constructor] as const]
          : [],
      ),
    ),
  };
}

/** The rows of a server-side page, for the view's `columnDefs`. Throws when it is malformed. */
export function rowsFromPage(
  columnDefs: ColDef[],
  page: unknown,
): { rows: Record<string, any>[]; rowCount: number } {
  const parsed = rowsPageSchema.parse(page);
  return {
    rows: createRows(columnDefs, parsed.data, parsed.index),
    rowCount: parsed.row_count,
  };
}

/** A column's distinct values, for its set filter; `null` when there are too many to list. */
export function distinctValuesFromResponse(response: unknown): any {
  return distinctValuesSchema.parse(response).values;
}
```

Change the `TableViewFlags.versionHash` type to `string | null`. Remove imports
nothing uses any more.

- [ ] **Step 4: The component.** In `TableVisualization.vue`: drop `type Data`
      from the `tableView` import; change `defineProps<{ data: Data }>()` to
      `defineProps<{ data: unknown }>()`; replace `computeBottomStatusBar` with

```ts
export function computeBottomStatusBar(
  requested: boolean,
  total: number | undefined,
  filtered: number | null,
):
  | {
      total: number | undefined;
      filtered: number | null;
      showFiltered: boolean;
    }
  | undefined {
  if (!requested) return undefined;
  return {
    total,
    filtered,
    showFiltered: filtered != null && filtered !== total,
  };
}
```

(keep its doc comment, with "when the backend did not ask" → "when the view did
not ask"); change the `bottomStatusBar` computed's first argument from
`props.data` to `viewFlags.value.bottomStatusBarRequested`; in `refresh()`
delete the `previousRowData` and `initialData` lines and the
`const initialData = props.data` declaration with its comment, and change
`if (view.isTruncated !== undefined) isTruncated.value = view.isTruncated` to
`isTruncated.value = view.isTruncated`. Keep
`if (view.rowData !== undefined) rowData.value = view.rowData` (a paged view
keeps its rows out of `rowData`).

- [ ] **Step 5: Run the gate.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__`.
      Expected: everything passes except exactly one snapshot,
      `Table view of each pinned golden > table_db_read_error 1`, whose
      difference is: columns go from none to one `Error` column, rows from none
      to `[{ "Error": "Error querying the database:\n…" }]`. Any other failing
      snapshot is a visible change: find which producer or parser step differs
      and fix it (never update that snapshot). Then update the one entry:
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts -t "table_db_read_error" -u`,
      and check `git diff -- '*.snap'` changes only the `table_db_read_error 1`
      block.

- [ ] **Step 6: Run the GUI checks.** `vitest run` of the `visualizations`
      folder, `typecheck`, `lint`; the `.vue` prettier check from WSL. Expected:
      pass.

- [ ] **Step 7: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: the table visualisation reads the one view format"
```

### Task B1.6: The Playwright mocks in the new format

**Files:**

- Create: `app/gui/integration-test/mock/tableView.ts`
- Modify: `app/gui/integration-test/mock/lsHandler.ts:213-219`
- Modify: `app/gui/integration-test/project-view/tableVisualisation.spec.ts`
  (lines 52-59, 180-345)
- Modify: `app/gui/integration-test/project-view/codeFont.spec.ts:441-451`

**Interfaces:**

- Produces: `matrixView(rows: string[][])` — the message a vector of vectors of
  text gives.

- [ ] **Step 1: The helper.**

```ts
// The table view format's field names are snake_case (`row_count`, …).
/* eslint-disable camelcase */

/** The table visualisation's message for a vector of vectors of text: one column per item, row numbers. */
export function matrixView(rows: string[][]) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return {
    kind: "grid",
    row_count: rows.length,
    columns: Array.from({ length: columnCount }, (_, j) => ({
      name: String(j),
    })),
    index: { action: "at {{#index}}" },
    data: Array.from({ length: columnCount }, (_, j) =>
      rows.map((row) => row[j]),
    ),
    options: { disable_sort_when_partial: true },
  };
}
```

- [ ] **Step 2: Use it.** In `lsHandler.ts` add
      `import { matrixView } from './tableView'` and make the
      `prepare_visualization` entry:

```ts
    'Standard.Visualization.Table.Visualization.prepare_visualization': encodeJSON(
      matrixView(Array.from({ length: 10 }, (_, i) => Array.from({ length: 5 }, (_, j) => `${i},${j}`))),
    ),
```

In `tableVisualisation.spec.ts` add
`import { matrixView } from 'integration-test/mock/tableView'`; in "Column size
can be set and is retained" make the update's data:

```ts
    matrixView(Array.from({ length: 10 }, (_, i) => Array.from({ length: 5 }, (_, j) => `${i},${j}b`))),
```

Rename the two tests `get_child_node_action temmplate Test as number` /
`as text` to `Link template Test as number` / `as text`, and replace the other
mocks with (keeping each test's assertions):

- Generic grid, one link column (`read`):
  `{ kind: 'grid', columns: [{ name: 'table', link: { action: 'read {{@table}}', label: 'table' }, number_format: false }], data: [['Sheet1', 'Sheet2', 'Sheet3']] }`
- Error: `{ kind: 'error', error: 'This is an error message.' }`
- Template as number:
  `{ kind: 'grid', columns: [{ name: 'table', link: { action: 'read {{#table}}', label: 'table' }, number_format: false }], data: [['1', '2', '3']] }`
- Template as text: the same with `'read {{@table}}'`.
- No links:
  `{ kind: 'grid', columns: [{ name: 'table', number_format: false }], data: [['Sheet1', 'Sheet2', 'Sheet3']] }`
- Two columns:
  `{ kind: 'grid', columns: [{ name: 'table', number_format: false }, { name: 'number', link: { action: 'read {{#number}} {{@table}}' }, number_format: false }], data: [['SheetA', 'SheetB', 'SheetC'], ['1', '2', '3']] }`

Replace each `/* eslint-disable camelcase */ … /* eslint-enable camelcase */`
pair around them as needed (the new mocks have only `number_format` in
snake_case). In `codeFont.spec.ts` add the import and replace the update object
with `matrixView(TABLE_SAMPLE)`.

- [ ] **Step 3: Run the specs.** `corepack pnpm -r compile`, then
      `corepack pnpm --filter enso-gui run test:integration -- integration-test/project-view/tableVisualisation.spec.ts integration-test/project-view/codeFont.spec.ts`
      three times. Expected: pass each time (the date/time fixtures from B1.3
      sort and copy as before). Then the whole Playwright suite once (other
      specs open the table visualisation through the `lsHandler` mock).
      Expected: pass. `typecheck` and `lint`. Expected: pass.

- [ ] **Step 4: Commit.**

```bash
git add app/gui/integration-test
git commit -m "GUI tests: the table visualisation mocks in the one view format"
```

### Task B1.7: Timings, documentation, changelog, PR

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/CLAUDE.md`
- Regenerate: `docs/api` of Visualization, Table, Database, XML
- Modify: `CHANGELOG.md` (after the PR has a number)

- [ ] **Step 1: Time it.** Sync, build, run `Visualization_Tests` filtered to
      `Table view timings` with `ENSO_VIZ_BENCH=1`. Compare each `BENCH|` line's
      median with B0's (the PR description). Expected: each within 10% of
      `develop` or faster (`repeat` should be much faster: the version cache
      sits above the display types). Run twice if a case is within noise
      (`c2_1x2500` is noisy on both sides). If a case is slower, stop and
      profile: the spike's rules (one Java call for the metrics, one loop per
      column, `Vector.join`) are what keep it at Java's speed.

- [ ] **Step 2: Visualization's `CLAUDE.md`.** Under "Layout" replace the
      `Internal/View_Json.enso` mention with:

```markdown
- `src/Internal/View_Json.enso` — the one writer of the table view's three
  messages (the view, a server row page, a column's distinct values). Public:
  Table, Database and XML build their views with `grid_json`, `View_Column`,
  `View_Link`, `value_json`, `error_json`, `table_view`. The GUI reads them with
  the zod schema in
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`.
```

Under the `Viz_Table` source contract add the capability:

```markdown
- Capability `"view_pieces"`: `column_cells_json name start count` (a JSON array
  of cells) and `column_metrics_json` (per column, the `value_type`, `metrics`,
  `multi_filter` and `number_format` fields), which `View_Json.table_view`
  assembles. The in-memory source implements them in Java.
```

and a section:

```markdown
## Table view message

`{"kind":"grid"|"value"|"error", …}`. A grid has `columns` (`name`, optional
`link` `{action, label}`, `value_type`, `metrics`, `multi_filter`,
`number_format`), column-major `data` (or `null` when `server` is true),
optional `row_count`, `index` (the row-number column's link), `version_hash` and
`options` (`status_bar`, `create_node`, `disable_sort_when_partial`). A link
action is an explicit template: `{{#field}}` (a number when it reads as one),
`{{@field}}` (as it is), `{{#index}}` (the row number). A cell is `null`, a
boolean, a finite number, text, or an object starting with `_display_text_`;
`{"_missing_":true}` is a cell its row lacks. A row page is
`{"row_count","index","data"}`; distinct values `{"values"}`. Changing it means
regenerating the goldens and keeping the GUI snapshot
(`__tests__/tableViewSnapshot.test.ts`) unchanged.
```

In the GUI's `TableVisualization/CLAUDE.md` add: "`tableView.ts` parses the
message with zod (`viewMessageSchema`); the format is described in
`distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`, 'Table view
message'."

- [ ] **Step 3: API docs.** Regenerate `docs/api` for Visualization, Table,
      Database and XML. Check the diff: Visualization gains
      `Internal/View_Json.md` and the two `Viz_Table` methods; Table's
      `In_Memory_Table.md`/`In_Memory_Column.md` show the new
      `to_table_viz_json` signature.

- [ ] **Step 4: Grep for the old format.** Run
      `git grep -n "EnsoTableOrColumn\|Generic_Grid\|Object_Matrix\|get_child_node_action\|get_child_node_link_name\|has_index_col\|is_using_server_sort_and_filter\|distinct_vals\|tableVizJSON\|make_json_for_\|table_version_hash\"" -- distribution app/gui/src app/gui/integration-test std-bits test ':!**/docs/api/**'`.
      Expected: only `TableVisualization/TableVisualisationTypes.ts` (deleted in
      B2), plus `Viz_Table.enso`'s doc comment of `from_columns` ("shown as a
      `Generic_Grid`"): change that comment now to "shown as a grid of its
      columns". (`child_label` and `visualization_header` stay in
      `Excel_Workbook.to_js_object`: that is the JSON view's data, not the table
      view's.)

- [ ] **Step 5: Commit, push, open PR B1.** Commit ("Docs: the one table view
      format"), push `viz/table-format-b1`, open the PR against `develop`
      ("Visualization: one data format for the table view (spec B, B1)") with
      the spec link, the task commits, "Spec gaps resolved while planning"
      copied in, the B0 and B1 `BENCH|` lines side by side, the snapshot diff
      (only `table_db_read_error`), and a test plan. Then add the changelog
      entry under `# Next Release` → `#### Enso IDE` as the first item, with the
      link definition next to the others:

```markdown
- [A database table whose rows cannot be read shows the database's error in the
  table visualization instead of an empty table.][NNN]
```

```markdown
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

Commit ("Changelog: database read errors show in the table view") and push.

- [ ] **Step 6: Merge gate.** CI green (including `stdlib-api-check`, the GUI
      checks and Playwright), then the owner's installer check: an in-memory
      table (paged and not), a database table, a Dictionary, a Row, a vector of
      vectors, an XML document, a connection and an Excel workbook look and
      behave as before (links, sort, filter, distinct values, create node), and
      a database table whose read fails shows the error. Merge after the owner's
      OK.

---

## PR B2 — Delete the dead parts

### Task B2.1: GUI leftovers

**Files:**

- Delete:
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVisualisationTypes.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue:72-73`

- [ ] **Step 1: Check nothing uses them.** Run
      `git grep -n "TableVisualisationTypes\|isGenericGrid\|isError(" -- app/gui/src`.
      Expected: no output (B1.5 removed the last import).

- [ ] **Step 2: Delete.** Delete `TableVisualisationTypes.ts`. In
      `TableVisualization.vue` remove `| Standard.Base.Data.Map.Map` from
      `inputType` (no such type exists any more).

- [ ] **Step 3: Run the GUI checks.** `vitest run` of the `visualizations`
      folder, `typecheck`, `lint`. Expected: pass, the snapshot unchanged.

- [ ] **Step 4: Commit.**

```bash
git add -A app/gui/src/project-view/components/visualizations
git commit -m "GUI: delete the old table view types"
```

### Task B2.2: Enso and Java leftovers

**Files:**

- Delete: `test/Visualization_Tests/src/Default_Visualizations_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`
- Modify (only if Step 2 finds callers gone):
  `std-bits/table/src/main/java/org/enso/table/data/column/operation/unary/JsonOperation.java`

- [ ] **Step 1: The dead spec.** Delete `Default_Visualizations_Spec.enso` (it
      guards a JavaScript file removed long ago) and remove its import and
      `add_specs` line from `Main.enso`.

- [ ] **Step 2: Unused Java.** Run, one at a time:
      `git grep -n "toJson(" -- std-bits ':!**/JsonOperation.java'`,
      `git grep -n "makeJSONForRow\|makeJSONForColumn\|metricsIncomplete\|viewColumnsJson" -- distribution std-bits`.
      Expected: `toJson(` calls only with two arguments
      (`TableVizOperation.createIntegerJson`, `toJson(…, true)`), the latter
      four each used. If the one-argument `JsonOperation.toJson(long)` has no
      caller outside `JsonOperation` and `objectToJson` no longer calls it,
      delete it. Run
      `git grep -n "import" -- std-bits/table/src/main/java/org/enso/table/data/column/operation/TableVizOperation.java`
      and remove any import whose class the file no longer names.

- [ ] **Step 3: Run the tests.** Sync (`ide-viz-b2`, `viz/table-format-b2`),
      build, run `Visualization_Tests` and `Table_Tests`. Expected: pass, no
      golden changed. `-Werror` lint on `test/Visualization_Tests`. Expected: no
      warnings.

- [ ] **Step 4: Commit, push, open PR B2.** Commit ("Visualization tests: delete
      the dead default-visualisation type check"), push, open the PR against
      `develop` ("Visualization: delete what the one table view format left
      unused (spec B, B2)"), label `CI: No changelog needed`. Merge on green.

---

## Spec coverage

| Spec                                                                | Task                                        |
| ------------------------------------------------------------------- | ------------------------------------------- |
| §1 the view message, mapping of every shape, explicit templates     | B1.2 (writer), B1.3, B1.4 (producers)       |
| §2 one cell encoding; Java order; `Generic_Grid` via `Viz_Cell`     | B1.1, B1.4 (Columns_Source)                 |
| §3 row page and distinct values                                     | B1.2, B1.3 (gap 1, gap 13)                  |
| §4 one writer; optional bulk pieces; performance rules; cache       | B1.2, B1.3                                  |
| §4 Java: `makeJSON` deleted, metrics piece added                    | B1.3                                        |
| §4 every producer on the writer                                     | B1.3, B1.4                                  |
| §5 one zod schema, error state with the zod message                 | B1.5 (gap 16)                               |
| §5 Playwright mocks rewritten, assertions kept                      | B1.6                                        |
| §6.1 snapshot of today's goldens through today's `refresh()` logic  | B0.1, B0.2, B0.3                            |
| §6.2 identical snapshots after the change                           | B1.5 Step 5                                 |
| Delivery B0 / B1 / B2                                               | B0.5, B1.7, B2.2                            |
| Verification: goldens, performance, lint, API check, GUI, installer | B1.3, B1.4, B0.4 + B1.7, B1.7 Step 6        |
| B2: old TS interfaces, `Default_Visualizations_Spec`, `Map`, Java   | B2.1, B2.2 (B1.5 removes the in-file types) |
