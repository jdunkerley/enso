# AG Grid Community Fallback — Row Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the backend requests a server-driven row model
(`is_using_server_sort_and_filter`) but no AG Grid Enterprise license is
configured, use AG Grid Community's **Infinite Row Model** instead of
Enterprise's **Server-Side Row Model (SSRM)**, so paging/sorting/filtering of
large tables keeps working without Enterprise.

**Architecture:** `rowModelType` (already computed in `AgGridTableView.vue`)
becomes a 3-way choice — `clientSide` / `serverSide` (licensed) / `infinite`
(unlicensed) — driven by the existing `isServerSideModel` prop combined with
`AG_GRID_ENTERPRISE_AVAILABLE`. `TableVisualization.vue` gains a second
datasource factory, `createInfiniteDatasource()`, that implements AG Grid
Community's `IDatasource` (`getRows(params)` →
`params.successCallback(rows, lastRow)`) alongside the existing
`createServerSideDatasource()` (Enterprise's `IServerSideDatasource`,
`getRows(params)` → `params.success({rowData, rowCount})`). Both call the same
`createServer().getData()` / `convertSortModel()` / `convertFilterModel()`
request-building pipeline — only the response hand-off differs. Which factory
runs is decided once, alongside `AG_GRID_ENTERPRISE_AVAILABLE`, in the
`TableVisualization.vue` computed that used to be called `ssrmDatasource`.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript,
`ag-grid-community`/`ag-grid-enterprise` types (`^32.3.3`), Vitest.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`,
section "3. Row Model: SSRM → Infinite Row Model" (lines 105-125).

## Global Constraints

- Depends on the Foundation plan
  (`docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md`), which
  already added
  `app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts`
  exporting `AG_GRID_ENTERPRISE_AVAILABLE: boolean`. This plan imports it — it
  does not recreate it.
- No grouping/pivot/tree-data is used anywhere in this codebase's table
  visualizations (confirmed in the design spec's inventory), so the Infinite Row
  Model's lack of grouping/pivot support is an accepted, irrelevant gap — do not
  add any workaround for it.
- No duplication of request-building logic between the two datasource adapters:
  both must go through the same `createServer().getData()` →
  `convertSortModel()`/`convertFilterModel()` pipeline in
  `TableVizDataSourceUtils.ts`. Only the response hand-off
  (`params.success(...)` vs `params.successCallback(...)`) differs between
  adapters.
- `SortModelItem` has the exact same shape (`{ colId, sort }`) in both
  `IServerSideGetRowsRequest.sortModel` and `IGetRowsParams.sortModel` (both
  come from `@ag-grid-community/core`) — no adaptation needed for sorting.
- `rowCount` is passed as an `AgGridTableView`/`AgGridTableViewProps` prop but
  is **not** a real AG Grid grid option (verified: absent from
  `ComponentUtil.ALL_PROPERTIES` at runtime) — it is pre-existing dead wiring,
  out of scope to fix here, and irrelevant to this plan's row-count reporting
  (which goes through each datasource's own response, as today).
- Path aliases: `@/` → `app/gui/src/project-view/`, `$/` → `app/gui/src/`.
- Test/typecheck commands:
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`.
- `.env.testing` (vitest) has no AG Grid license key configured, so
  `AG_GRID_ENTERPRISE_AVAILABLE` is `false` under vitest;
  `.env.staging`/`.env.development` (Playwright/dev) do configure one.

---

## File Structure

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVizDataSourceUtils.ts`
  — narrow `convertSortModel`'s request parameter type so it's satisfied by both
  SSRM's and Infinite Row Model's differently-shaped params.
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue` —
  add `createInfiniteDatasource()`, pick the right adapter by license flag,
  narrow `createServer().getData()`'s parameter type.
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue` —
  3-way `rowModelType`, widened `datasource` prop type, split
  `serverSideDatasource`/`datasource` grid-option bindings.
- Test:
  `app/gui/src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts`
  (new — this file has no existing test; `tableVizUtilsTests.spec.ts` in the
  same directory tests the neighboring `tableVizUtils.ts` and sets the house
  style: flat `test()` calls, no `describe`).

**Explicitly not touched:** `createServerSideDatasource()`, `createServer()`'s
`getSetFilterValues`, and `createRowsForTable()` keep their current
signatures/bodies (only `getData`'s parameter _type_ narrows — its body is
unchanged). Full behavioral verification of a mounted grid under both row models
(large-table paging, sort, filter) is Playwright-suite work per the design
spec's Testing section, not this plan — `TableVisualization.vue` has no existing
unit-test scaffolding (checked: only the small `tableVizUtils.ts` has one) and
mounting the 1289-line component blind, without established fixtures for
`useVisualizationConfig`/`config.executeExpression`, would be a novel, high-risk
addition out of proportion to this plan's scope.

---

### Task 1: Narrow the shared request-building logic to accept either row model's request shape

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVizDataSourceUtils.ts`
- Test:
  `app/gui/src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts`

**Interfaces:**

- Produces:
  `export interface RowsRequestParams { startRow: number | undefined; sortModel: SortModelItem[]; filterModel: any }`
  — consumed by Task 2 (`TableVisualization.vue`'s `createServer().getData()`,
  called by both `createServerSideDatasource()` and the new
  `createInfiniteDatasource()`).
- Changes:
  `convertSortModel(request: RowsRequestParams, columnHeaders: string[])` (was
  `request: IServerSideGetRowsRequest`). Body is unchanged — only reads
  `request.sortModel`, which is identically typed (`SortModelItem[]`) on both
  `IServerSideGetRowsRequest` and AG Grid Community's `IGetRowsParams`.

Currently (`TableVizDataSourceUtils.ts:1-11, 108-120`):

```ts
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import type { IServerSideGetRowsRequest } from 'ag-grid-enterprise'
import {
  actionMap,
  type FilterAction,
  getFilterValue,
  type GridFilterModel,
} from './tableVizFilterUtils'
import { getCellValueType } from './tableVizUtils'
...
export const convertSortModel = (request: IServerSideGetRowsRequest, columnHeaders: string[]) => {
  const sortColIndexesMap = request.sortModel.map((sortCol) => {
    return `${columnHeaders.findIndex((h: string) => sortCol.colId === h)}`
  })
  const sortColIndexes = sortColIndexesMap.length ? sortColIndexesMap : 'Nothing'
  const sortDirections =
    sortColIndexesMap.length ?
      request.sortModel.map((sortCol) => {
        return sortDirectionMap[sortCol.sort as SortDirection]
      })
    : 'Nothing'
  return { sortColIndexes, sortDirections }
}
```

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts
import { expect, test } from "vitest";
import {
  convertSortModel,
  type RowsRequestParams,
} from "../TableVisualization/TableVizDataSourceUtils";

test("convertSortModel reads a Server-Side Row Model-shaped request (startRow may be undefined)", () => {
  const request: RowsRequestParams = {
    startRow: undefined,
    sortModel: [{ colId: "b", sort: "desc" }],
    filterModel: null,
  };
  expect(convertSortModel(request, ["a", "b", "c"])).toEqual({
    sortColIndexes: ["1"],
    sortDirections: ["-1"],
  });
});

test("convertSortModel reads an Infinite Row Model-shaped request (startRow always a number)", () => {
  const request: RowsRequestParams = {
    startRow: 0,
    sortModel: [{ colId: "a", sort: "asc" }],
    filterModel: {},
  };
  expect(convertSortModel(request, ["a", "b", "c"])).toEqual({
    sortColIndexes: ["0"],
    sortDirections: ["1"],
  });
});

test('convertSortModel returns "Nothing" when there is no sort', () => {
  const request: RowsRequestParams = {
    startRow: 0,
    sortModel: [],
    filterModel: null,
  };
  expect(convertSortModel(request, ["a", "b"])).toEqual({
    sortColIndexes: "Nothing",
    sortDirections: "Nothing",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts`
Expected: FAIL — `RowsRequestParams` is not exported from
`TableVizDataSourceUtils.ts` yet.

- [ ] **Step 3: Write minimal implementation**

In `TableVizDataSourceUtils.ts`, replace the top import block and
`convertSortModel`:

```ts
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";
import type { SortModelItem } from "ag-grid-community";
import {
  actionMap,
  type FilterAction,
  getFilterValue,
  type GridFilterModel,
} from "./tableVizFilterUtils";
import { getCellValueType } from "./tableVizUtils";
```

(replacing the old
`import type { IServerSideGetRowsRequest } from 'ag-grid-enterprise'` line —
nothing else in this file uses `IServerSideGetRowsRequest`, confirmed by
search.)

Add, near the top of the file (after the existing type aliases, before
`parseFilterValues`):

```ts
/**
 * The subset of a row-fetch request that request-building logic here needs. Satisfied by both
 * `IServerSideGetRowsRequest` (AG Grid Enterprise's Server-Side Row Model) and `IGetRowsParams`
 * (AG Grid Community's Infinite Row Model) — see `TableVisualization.vue`'s two datasource
 * factories, which both build one of these and pass it to `createServer().getData()`.
 */
export interface RowsRequestParams {
  startRow: number | undefined;
  sortModel: SortModelItem[];
  filterModel: any;
}
```

Change the `convertSortModel` signature only (body unchanged):

```ts
export const convertSortModel = (request: RowsRequestParams, columnHeaders: string[]) => {
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/visualizations/TableVisualization/TableVizDataSourceUtils.ts app/gui/src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts
git commit -m "Narrow convertSortModel's request type to fit both row models"
```

---

### Task 2: Add the Infinite Row Model datasource adapter in `TableVisualization.vue`

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from
  `@/components/shared/AgGridTableView/agGridLicense` (Foundation plan).
  `RowsRequestParams` from `./TableVisualization/TableVizDataSourceUtils` (Task
  1).
- Produces: a renamed `datasource` computed (was `ssrmDatasource`) of type
  `IServerSideDatasource | IDatasource | false`, consumed by Task 3's widened
  `AgGridTableView.vue` `datasource` prop.

This task has no isolated unit test of its own:
`createInfiniteDatasource()`/`createServerSideDatasource()` are unexported
closures over component reactive state (`ssrmServer`, `filteredRowCount`,
`columnDefs`), exactly like the existing, never-unit-tested
`createServerSideDatasource()` they sit beside — introducing a testability bar
for the new code that the adjacent existing code doesn't meet would mean
inventing a parameterized/exported version of both, which is a larger, riskier
refactor than this plan's scope (see File Structure's "Explicitly not touched"
note). Task 1's test already covers the shared request-building logic both
adapters delegate to. Verify this task via Step 3 (typecheck) and Step 4 (manual
smoke check).

- [ ] **Step 1: Locate the current code**

In `TableVisualization.vue`, the current type import block (lines 12-27) is:

```ts
import type {
  CellClassParams,
  CellDoubleClickedEvent,
  ColDef,
  ColumnMovedEvent,
  ColumnVisibleEvent,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  ICellRendererParams,
  IServerSideDatasource,
  IServerSideGetRowsRequest,
  ITooltipParams,
  MenuItemDef,
  SetFilterValuesFuncParams,
  SortChangedEvent,
} from "ag-grid-enterprise";
```

The current `ssrmDatasource` computed (line 299-303) and `createServer()`'s
`getData` method (lines 493-539) and `createServerSideDatasource()` (lines
548-565) are:

```ts
const refreshDataSource = ref(0);
const ssrmDatasource = computed(() => {
  const value = refreshDataSource.value;
  return isSSRM.value && createServerSideDatasource();
});
```

```ts
    getData: async (request: IServerSideGetRowsRequest) => {
      const columnHeaders =
        typeof props.data === 'object' && 'header' in props.data ? (props.data.header ?? []) : []

      const { sortColIndexes, sortDirections } = convertSortModel(request, columnHeaders)
      const gridFilterModelList: Array<GridFilterModel> =
        request.filterModel ? makeFilterModelList(request.filterModel) : []
      const { filterColumnIndexList, filterActions, valueList } = convertFilterModel(
        gridFilterModelList,
        columnHeaders,
        colTypeMap.value,
      )

      const expressionFunction = createExpressionRowTemplate(
        'Standard.Visualization.Table.Visualization',
        'get_rows_for_table',
        //the index of the next bucket of rows to get
        `${request.startRow}`,
        //column indexes that require a sort
        sortColIndexes as string[] | 'Nothing',
        //direction (Ascending/Descending) for the sorts
        sortDirections as string[] | 'Nothing',
        //column indexes that require a filter
        filterColumnIndexList as string[] | 'Nothing',
        //column actions i.e Greater Than, Between...
        filterActions as string[] | 'Nothing',
        //values to filter on
        valueList as string[] | 'Nothing',
      )

      try {
        const response = await config.executeExpression(expressionFunction)
        filteredRowCount.value = response.value.row_count
        return {
          success: true,
          data: response.value.rows,
          rowCount: response.value.row_count,
        }
      } catch (error) {
        console.warn('Error loading rows for table.', error)
        return {
          success: false,
          data: null,
          rowCount: undefined,
        }
      }
    },
```

```ts
interface Response {
  data: unknown[][];
  success: boolean;
  rowCount: number;
}
function createServerSideDatasource(): IServerSideDatasource {
  return {
    getRows: async (params) => {
      const server = ssrmServer.value;
      if (server) {
        const serverResponse = await server.getData(params.request);
        const response: Response = serverResponse
          ? serverResponse
          : { data: [], success: false, rowCount: 0 };
        if (response.success) {
          const rows = createRowsForTable(response.data, 0, true);
          params.success({ rowData: rows, rowCount: response.rowCount });
        } else {
          params.fail();
        }
      }
    },
  };
}
```

- [ ] **Step 2: Make the changes**

Add `IDatasource` and `IGetRowsParams` to the type import, drop
`IServerSideGetRowsRequest` (no longer used directly in this file —
`createServer().getData()` now takes the shared `RowsRequestParams`):

```ts
import type {
  CellClassParams,
  CellDoubleClickedEvent,
  ColDef,
  ColumnMovedEvent,
  ColumnVisibleEvent,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  ICellRendererParams,
  IDatasource,
  IGetRowsParams,
  IServerSideDatasource,
  ITooltipParams,
  MenuItemDef,
  SetFilterValuesFuncParams,
  SortChangedEvent,
} from "ag-grid-enterprise";
```

Add to the existing import from `./TableVisualization/TableVizDataSourceUtils`
(line 46-53):

```ts
import {
  convertFilterModel,
  convertSortModel,
  createDistinctExpressionTemplate,
  createExpressionRowTemplate,
  type RowsRequestParams,
  type ValueTypeArgumentChild,
  type ValueTypes,
} from "./TableVisualization/TableVizDataSourceUtils";
```

Add a new import for the license flag, next to the other
`@/components/shared/AgGridTableView` import:

```ts
import { AG_GRID_ENTERPRISE_AVAILABLE } from "@/components/shared/AgGridTableView/agGridLicense";
```

Rename `ssrmDatasource` and pick the adapter by license flag:

```ts
const refreshDataSource = ref(0);
const datasource = computed(() => {
  const value = refreshDataSource.value;
  if (!isSSRM.value) return false;
  return AG_GRID_ENTERPRISE_AVAILABLE
    ? createServerSideDatasource()
    : createInfiniteDatasource();
});
```

Change `getData`'s parameter type only (body unchanged):

```ts
    getData: async (request: RowsRequestParams) => {
```

Add `createInfiniteDatasource()` right after `createServerSideDatasource()`:

```ts
function createInfiniteDatasource(): IDatasource {
  return {
    getRows: async (params: IGetRowsParams) => {
      const server = ssrmServer.value;
      if (server) {
        const serverResponse = await server.getData(params);
        const response: Response = serverResponse
          ? serverResponse
          : { data: [], success: false, rowCount: 0 };
        if (response.success) {
          const rows = createRowsForTable(response.data, 0, true);
          params.successCallback(rows, response.rowCount);
        } else {
          params.failCallback();
        }
      }
    },
  };
}
```

(`params: IGetRowsParams` structurally satisfies `RowsRequestParams` — it has
`startRow: number`, `sortModel: SortModelItem[]`, `filterModel: any`, plus extra
fields `endRow`/`successCallback`/`failCallback`/`context` that `getData` simply
doesn't read.)

Update the template binding (was `:datasource="ssrmDatasource"`):

```html
<AgGridTableView
  ref="grid"
  class="scrollable grid"
  :columnDefs="columnDefs"
  :rowData="rowData"
  :defaultColDef="defaultColDef"
  :textFormatOption="textFormatterSelected"
  :datasource="datasource"
  :rowCount="allRowCount"
  :isServerSideModel="isSSRM"
  :statusBar="statusBar"
  :gridIdHash="tableVersionHash"
  :getContextMenuItems="getContextMenuItems"
  @sortOrFilterUpdated="checkSortAndFilter"
  @columnVisibleChanged="onColumnStateChange"
  @columnMoved="onColumnStateChange"
/>
```

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS. If
`params: IGetRowsParams` fails to structurally satisfy `RowsRequestParams` at
the `server.getData(params)` call site, double check
`IGetRowsParams.filterModel`'s actual declared type against Task 1's
`RowsRequestParams.filterModel: any` (it should be trivially assignable since
`any` accepts anything) — do not change `getData`'s body to work around a type
error; the fix belongs in the type declarations from Task 1.

- [ ] **Step 4: Manual smoke check**

Run the dev server (`corepack pnpm --filter enso-gui run dev:vite`, which loads
a real license key from `.dev-env/.env.development`) and open a project with a
large table that sets `is_using_server_sort_and_filter`. Confirm
sorting/filtering/paging still work exactly as before (this exercises
`createServerSideDatasource()`, unchanged). A no-key run exercising
`createInfiniteDatasource()` end-to-end is Playwright-suite work (design spec
Testing section) — out of scope here, but note it explicitly as follow-up when
handing this plan off.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/visualizations/TableVisualization.vue
git commit -m "Add Infinite Row Model datasource for unlicensed AG Grid"
```

---

### Task 3: Widen `AgGridTableView.vue`'s row model and datasource prop

**Files:**

- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue`

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from
  `./AgGridTableView/agGridLicense`. `datasource` prop now typed
  `IServerSideDatasource | IDatasource | boolean` (was
  `IServerSideDatasource | boolean`).
- Produces: `rowModelType` computed now yields
  `'clientSide' | 'serverSide' | 'infinite'` (was `'clientSide' | 'serverSide'`)
  — already bound to `<AgGridVue :rowModelType="rowModelType">` today, no
  template change needed for that binding itself.

Currently (`AgGridTableView.vue:2-21` — the exported props type):

```ts
export type AgGridTableViewProps<TData, TValue> = {
  rowData: TData[];
  columnDefs: (ColDef<TData, TValue> | ColGroupDef<TData>)[] | null;
  defaultColDef: ColDef<TData>;
  getRowId?: GetRowIdFunc<TData>;
  components?: Record<string, Component>;
  singleClickEdit?: boolean;
  stopEditingWhenCellsLoseFocus?: boolean;
  suppressDragLeaveHidesColumns?: boolean;
  suppressMoveWhenColumnDragging?: boolean;
  textFormatOption?: TextFormatOptions;
  processDataFromClipboard?: (
    params: ProcessDataFromClipboardParams<TData>,
  ) => string[][] | null;
  datasource?: IServerSideDatasource | boolean;
  rowCount?: number;
  isServerSideModel?: boolean;
  gridIdHash?: string | null;
  getContextMenuItems?: (
    params: GetContextMenuItemsParams,
  ) => (MenuItemDef | string)[] | GetContextMenuItems;
};
```

And (`AgGridTableView.vue:161-168`):

```ts
function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api;
  if (rowModelType.value === "serverSide") {
    gridApi.value.retryServerSideLoads();
  }
}

const rowModelType = computed(() =>
  props.isServerSideModel ? "serverSide" : "clientSide",
);
```

And the template's datasource binding (`AgGridTableView.vue:387`):

```html
:serverSideDatasource="datasource"
```

- [ ] **Step 1: Make the changes**

Widen the `datasource` field in `AgGridTableViewProps` (add `IDatasource` to the
type union):

```ts
  datasource?: IServerSideDatasource | IDatasource | boolean
```

Add `IDatasource` to the existing type-only `ag-grid-enterprise` import (the big
`import type {...} from 'ag-grid-enterprise'` block at line 94-127 of the
`<script setup>` section):

```ts
import type {
  CellEditingStartedEvent,
  CellEditingStoppedEvent,
  ColDef,
  ColGroupDef,
  ColumnMovedEvent,
  ColumnResizedEvent,
  ColumnVisibleEvent,
  FirstDataRenderedEvent,
  GetContextMenuItems,
  GetContextMenuItemsParams,
  GetRowIdFunc,
  GridApi,
  GridReadyEvent,
  ICellEditorComp,
  IDatasource,
  IHeaderComp,
  IHeaderParams,
  IServerSideDatasource,
  MenuItemDef,
  ProcessDataFromClipboardParams,
  RowDataUpdatedEvent,
  RowEditingStartedEvent,
  RowEditingStoppedEvent,
  RowHeightParams,
  SortChangedEvent,
} from "ag-grid-enterprise";
```

Import the license flag (near the other
`@/components/shared/AgGridTableView/...`-relative imports — this file already
imports from `@/components/shared/AgGridTableView/tableViewStyle.css` via
`<style src>`, so add a sibling TS import):

```ts
import { AG_GRID_ENTERPRISE_AVAILABLE } from "./AgGridTableView/agGridLicense";
```

Widen `rowModelType`:

```ts
const rowModelType = computed(() => {
  if (!props.isServerSideModel) return "clientSide";
  return AG_GRID_ENTERPRISE_AVAILABLE ? "serverSide" : "infinite";
});
```

Add two computeds selecting which grid-option binding gets the datasource
(`onGridReady`'s `rowModelType.value === 'serverSide'` check is unchanged —
Infinite Row Model has no `retryServerSideLoads()` equivalent/need):

```ts
const serverSideDatasourceValue = computed(() =>
  rowModelType.value === "serverSide"
    ? (props.datasource as IServerSideDatasource)
    : undefined,
);
const infiniteDatasourceValue = computed(() =>
  rowModelType.value === "infinite"
    ? (props.datasource as IDatasource)
    : undefined,
);
```

Update the template (replacing the single `:serverSideDatasource="datasource"`
line):

```html
:serverSideDatasource="serverSideDatasourceValue"
:datasource="infiniteDatasourceValue"
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 3: Run the existing WidgetTableEditor/visualizations unit suites to
      check for regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTableEditor src/project-view/components/visualizations src/project-view/components/shared/AgGridTableView`
Expected: PASS. `WidgetTableEditor.vue` never sets
`isServerSideModel`/`datasource` (confirmed by search before writing this plan)
so `rowModelType` stays `'clientSide'` for it — this change should be invisible
there.

- [ ] **Step 4: Manual smoke check**

With the dev server running (real license key from `.dev-env/.env.development`),
confirm a server-side-sorted/filtered table visualization still works (exercises
`rowModelType === 'serverSide'`, unchanged behavior). Confirm
`WidgetTableEditor`'s table input widget still works (exercises
`rowModelType === 'clientSide'`, unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView.vue
git commit -m "Add Infinite Row Model option to AgGridTableView's row model"
```

---

## Self-Review Notes

- **Spec coverage:** Design spec section 3's three points — 3-way
  `rowModelType`, the new `IDatasource` adapter alongside the existing
  `IServerSideDatasource` one sharing request-building logic, and the widened
  `datasource` prop type — map to Task 2 (adapter + selection), Task 1 (shared
  request-building logic narrowing), and Task 3 (prop widening + grid-option
  binding split) respectively. The "known accepted gap" (no
  grouping/pivot/tree-data) is called out in Global Constraints as deliberately
  unaddressed.
- **Type consistency:** `RowsRequestParams` (Task 1) is imported and used with
  the same name/shape by `TableVisualization.vue`'s `getData` (Task 2).
  `createInfiniteDatasource(): IDatasource` (Task 2) is consumed by name
  (`datasource` computed) by Task 3's widened prop — no other file references
  these names, confirmed by search before writing this plan.
  `AG_GRID_ENTERPRISE_AVAILABLE` is imported with the same name/path convention
  in both Task 2 and Task 3, matching the Foundation plan's export.
- **No placeholders:** every step has full, copy-pasteable code (transcribed
  from the actual current files, read in full before writing this plan) or exact
  commands.
- **Scope check:** `createServerSideDatasource()`, `getSetFilterValues`,
  `createRowsForTable()`, and `WidgetTableEditor.vue` (which never uses
  row-model props) are explicitly left untouched — verified by reading/searching
  before writing this plan, not assumed.
