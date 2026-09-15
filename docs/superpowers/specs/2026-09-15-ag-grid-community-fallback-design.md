# AG Grid Enterprise → Community Fallback — Design

**Date:** 2026-09-15 **Status:** Approved for planning

## Motivation

The IDE currently bundles and always runs `ag-grid-enterprise`. When no
`AG_GRID_LICENSE_KEY` is configured, the grid still loads and executes
Enterprise-only features unlicensed — it just shows a watermark and a console
warning. This is a licensing-correctness problem, not merely a cosmetic one:
unlicensed builds (e.g. OSS/community contributors, or any deployment without a
configured key) should genuinely run on AG Grid Community's feature set, not on
Enterprise code running without a valid license.

**Goal:** when no license key is configured, the grid falls back to a
Community-only implementation with equivalent (or explicitly scoped-down)
behavior, and the Enterprise runtime is not loaded at all (no watermark, no
unlicensed Enterprise execution). When a valid key _is_ configured, behavior is
unchanged from today.

**Explicit non-goals:**

- Detecting an _invalid/expired_ key and falling back at runtime. Only "is a key
  configured at all" is checked, matching today's check.
- Bundle-size reduction for its own sake (a side effect of the `AgGridVue.ts`
  fix below, but not a design driver).
- Any of the Enterprise features this codebase doesn't use (Row Grouping,
  Pivoting, Master/Detail, Excel Export, Rich Select editor,
  Sparklines/Integrated Charts, Side Bar tool panel, Advanced Filter) —
  confirmed unused, out of scope entirely.

## Current enterprise feature inventory

Traced from every `ag-grid-enterprise` import and grid option across
`app/gui/src/project-view`:

| Feature                                                                            | Where                                                                         | Community equivalent?                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-Side Row Model (SSRM)                                                       | `TableVisualization.vue` (`isSSRM`, `createServerSideDatasource`)             | No direct equivalent; **Infinite Row Model** (Community) covers the same use case (no grouping/pivot is used here)                                                                    |
| Set Filter (`agSetColumnFilter`)                                                   | `tableVizFilterSetUpUtils.ts`, default filter for Boolean / catch-all columns | No; needs a custom `IFilterComp`                                                                                                                                                      |
| Multi Filter (`agMultiColumnFilter`)                                               | Same file, for `Char` columns with `is_using_multi_filter`                    | No; folds into the same custom filter component                                                                                                                                       |
| Cell/Range Selection (`cellSelection: true`)                                       | `AgGridTableView.vue`                                                         | No; needs custom range tracking                                                                                                                                                       |
| Clipboard range copy/cut (`copyToClipboard`/`cutToClipboard`/`pasteFromClipboard`) | `AgGridTableView.vue`                                                         | Partially — TSV formatting and paste-into-AST logic are already plain Enso code, not AG Grid APIs. Only "what's selected" and the `gridApi.*Clipboard()` methods are Enterprise-gated |
| Custom Context Menu (`getContextMenuItems`)                                        | `AgGridTableView.vue`, `TableVisualization.vue`                               | No; needs a custom popup, but item lists are already framework-agnostic data                                                                                                          |
| Column Menu customization (`mainMenuItems`)                                        | `WidgetTableEditor/tableInputArgument.ts`                                     | No; same custom popup as context menu                                                                                                                                                 |
| Status Bar (`statusBar` grid option)                                               | `TableVisualization.vue` + `TableVizStatusBar.ts`                             | Yes — the non-status-bar fallback path (`useBottomStatusBar === false`) already exists and is used today for the default case                                                         |

**Confirmed not in use** (verified by search, nothing to design for): Row
Grouping, Pivoting, Master/Detail, Excel Export, Rich Select editor,
Sparklines/Integrated Charts, Side Bar tool panel, Advanced Filter, fill handle
(`enableFillHandle` is never set), multi-range selection.

## Approach

**License-gated dual implementation.** A single runtime flag decides, per
feature area, whether to use today's Enterprise-backed code (unchanged) or a new
Community-only implementation. The Enterprise path is never modified by this
work — all new code is additive and only exercised when unlicensed. This was
chosen over unifying on the Community implementation everywhere (simpler
long-term, but replaces proven production behavior for licensed users with new,
riskier code for no licensing benefit).

Implementation should sequence the low-risk pieces first (Status Bar, Row Model,
Filters) and the two genuinely novel pieces (Selection+Clipboard, Context/Column
Menu) last, since they carry the most uncertainty.

## Design

### 1. License flag

New small module (e.g.
`app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts`)
exporting:

```ts
export const AG_GRID_ENTERPRISE_AVAILABLE =
  typeof $config.AG_GRID_LICENSE_KEY === "string";
```

A plain module-level constant, not a Vue ref — the key is fixed per session,
nothing to react to. Every other section imports this directly where needed; no
prop-drilling. `AgGridVue.ts` uses it in place of its current inline check.

### 2. `AgGridVue.ts` runtime-import fix (prerequisite for everything else)

Configuring Community-flavored grid _options_ is not sufficient to avoid the
watermark: AG Grid shows it whenever the Enterprise runtime is loaded at all,
regardless of which specific features are configured. Today, `AgGridVue.ts` does
a static `import {...} from 'ag-grid-enterprise'` for real runtime values
(`createGrid`, `LicenseManager`, `ComponentUtil`, `_processOnChange`,
`_warnOnce`, `ALWAYS_SYNC_GLOBAL_EVENTS`) — merely importing that package
self-registers the Enterprise core and triggers the watermark/console error
independent of grid options. `AgGridTableView/Utils.ts` has the same issue for
`ComponentUtil` and `_processOnChange`.

(Other files' `import {...} from 'ag-grid-enterprise'` statements are type-only
in practice and are elided by Vite/esbuild — they don't cause the Enterprise
runtime to load and don't need to change.)

**Fix:** these two files switch their value imports to
`await import(AG_GRID_ENTERPRISE_AVAILABLE ? 'ag-grid-enterprise' : 'ag-grid-community')`.
The license-key-setting call and the existing DEV-mode watermark suppression
hack stay inside the enterprise branch only.

### 3. Row Model: SSRM → Infinite Row Model

Files: `TableVisualization.vue`,
`TableVisualization/TableVizDataSourceUtils.ts`, `AgGridTableView.vue`.

`rowModelType` becomes a 3-way choice: `clientSide` / `serverSide` (licensed) /
`infinite` (unlicensed), still driven by the backend's
`is_using_server_sort_and_filter` flag combined with
`AG_GRID_ENTERPRISE_AVAILABLE`.

A new adapter builds an `IDatasource` (`getRows(params: IGetRowsParams)`,
success via `params.successCallback(rows, lastRowIndex?)`) alongside the
existing `IServerSideDatasource` (`getData`, success via
`params.success({ rowData, rowCount })`). Both read `sortModel`/
`filterModel`/paging bounds from slightly different param shapes but call the
same backend request-building logic in `TableVizDataSourceUtils.ts` and reshape
the same response — no duplication of the actual request/response logic, just
two thin adapters.

Known, accepted gap: Infinite Row Model has no grouping/pivot/tree-data support
— irrelevant since none of that is used here.

`AgGridTableView.vue`'s `datasource` prop type widens to accept either
datasource shape.

### 4. Filters: Set / Multi Filter → custom filter component

Files: `tableVizFilterSetUpUtils.ts`, a new custom filter component (e.g.
`TableVisualization/CommunitySetFilter.ts`), `TableVisualization.vue` (existing
`getFilterValues` wiring is reused unchanged).

A single custom `IFilterComp` implementing a "pick from distinct values" UI — a
checkbox list, plus a text search box when replacing the multi-filter case —
wrapped the same way `AgGridTableView.vue` already wraps custom cell/header
components via `mappedComponents`. It reuses the existing `getFilterValues`
callback (already built for the SSRM Set Filter's `values` param) to populate
the list, and round-trips its model through the existing filter-model parsing in
`TableVizDataSourceUtils.ts`.

`getFilterType`/`getFilterParams` branch on `AG_GRID_ENTERPRISE_AVAILABLE`:
licensed keeps `'agSetColumnFilter'`/`'agMultiColumnFilter'`; unlicensed returns
the custom component's registered name.

Scope simplification: the Multi Filter's "Text OR Set" duality (two
independently-tabbed filter UIs) collapses into one component that always shows
both the search box and the value checklist — behaviorally equivalent, simpler
to build than reproducing AG Grid's actual Multi Filter UI.

### 5. Selection + Clipboard

Files: `AgGridTableView.vue`, `WidgetTableEditor/tableInputArgument.ts` /
`editHandler.ts` (paste target, unchanged).

Finding that narrows scope: TSV formatting and clipboard I/O (`writeClipboard`,
`parseTsvData`, `rowsToTsv`, `tableToEnsoExpression`, `sendToClipboard`,
`processCellForClipboard`) are already plain Enso utility functions, not AG Grid
APIs. Paste already targets a single focused/anchor cell and reads pasted
rows/columns from there — it needs **no change**. What's actually
Enterprise-gated is narrower:

1. Knowing which cells are currently selected (a multi-cell rectangle) — needed
   for Copy/Cut and the visual highlight.
2. The `gridApi.copyToClipboard()`/`cutToClipboard()` methods themselves, which
   only exist when the Clipboard+Range-Selection modules are registered.

**Community replacement:** a small custom range-selection layer.

- Track `{anchor, focus}` cell coordinates in a reactive model, updated from
  Community-native events: `cellMouseDown` (start), `cellMouseOver` while the
  mouse button is down (drag-extend), and the existing keydown interception
  point (alongside `suppressCopy`) for `Shift+Click` and `Shift+Arrow`
  extension.
- Visual highlight via `cellClassRules` (Community-supported), recomputed with
  `api.refreshCells({ force: true })` on range change.
- Copy/Cut (unlicensed): read the rectangle's values directly
  (`getDisplayedRowAtIndex` + `getValue`) instead of calling
  `gridApi.copyToClipboard()`, build the TSV with the same
  `rowsToTsv`/`sendToClipboard` used today. Cut additionally clears the
  rectangle's values (only meaningful in the editable Table Input widget).
- Paste: unchanged, as established above.

**Explicit scope carve-outs:** fill handle isn't implemented today
(`enableFillHandle` is never set) — nothing to replicate. Multi-range
(ctrl+click for disjoint ranges) isn't used either — the custom version supports
exactly one contiguous rectangle, covering everything the current code
exercises.

**Risk:** this is the highest-uncertainty section of the design —
`cellClassRules` refresh performance at scale, keyboard-event ordering against
the existing `WidgetEditHandler`, and drag-selection edge cases all need
hands-on validation. The implementation plan should front-load a small throwaway
prototype of just the range-tracking + highlight before wiring it into copy/cut.

### 6. Context Menu + Column Menu

Files: `AgGridTableView.vue`, `TableVisualization.vue`,
`WidgetTableEditor/tableInputArgument.ts`, `WidgetTableEditor/TableHeader.vue`;
new shared component (e.g. `shared/AgGridTableView/GridPopupMenu.vue`).

Both are native AG Grid Enterprise UI (menu rendering + positioning); the item
lists are already framework-agnostic data (`commonContextMenuActions`, the
per-consumer extra items in `TableVisualization.vue`'s `getContextMenuItems`,
and `mainMenuItems` in `tableInputArgument.ts`). The fallback doesn't reproduce
AG Grid's menu system — it renders the same item lists with a new, small custom
popup component, reused for both menus:

- **Context menu:** trigger off the cell `contextmenu` DOM event (fires natively
  even without the Enterprise menu registered — the event itself is
  Community-available; only the built-in menu _renderer_ is Enterprise).
  `event.preventDefault()`, compute items via the existing `getContextMenuItems`
  function, open `GridPopupMenu` there instead of AG Grid's native menu.
- **Column menu:** `TableHeader.vue` already calls
  `props.showColumnMenuAfterMouseClick(event)` from its own header icon click
  handler — when unlicensed, repoint that trigger to open `GridPopupMenu` with
  the column's `mainMenuItems` instead of invoking AG Grid's native column menu.

Both consumers keep producing their own item lists exactly as today; only the
rendering/positioning mechanism swaps when unlicensed.

### 7. Status Bar

File: `TableVisualization.vue`.

The Community fallback already exists: the `v-if="!useBottomStatusBar"` template
branch shows the default top row-count line. Change: `useBottomStatusBar` (and
the `statusBar` grid-option computed feeding `TableVizStatusBar`) is only ever
true when `AG_GRID_ENTERPRISE_AVAILABLE`. Zero new code beyond the gating
condition.

## Error handling

- An invalid/expired configured key is out of scope —
  `AG_GRID_ENTERPRISE_AVAILABLE` only checks "is a key configured," matching
  today's behavior. AG Grid's own watermark/console error still fires for an
  invalid key, unchanged from today.
- A failure in the `AgGridVue.ts` dynamic `import()` gets the same
  unhandled-rejection visibility as any other top-level dynamic import in the
  codebase — no bespoke retry/fallback.

## Testing

- **Unit (vitest):** `tableVizFilterSetUpUtils.ts` filter-type/params selection
  under both flag states; the Infinite Row Model datasource adapter's
  request/response mapping; the custom filter component's model get/set
  round-trip.
- **Component/integration (Playwright):** existing `TableVisualization`/
  `WidgetTableEditor` suites need a second run configuration with no license key
  configured (today's dev/test env always sets one — see `.dev-env/.env.staging`
  and CI config) so the fallback path is actually exercised. New specs: custom
  filter popup (Boolean column), custom context menu
  (copy/cut/paste/copy-with-headers), custom column menu
  (autosize/remove-column), multi-cell drag-select + copy, and Infinite Row
  Model paging on a large table.
- **Manual smoke checklist** (in the PR description): load both surfaces with no
  key configured — confirm no watermark, and each replaced feature behaves
  equivalently to its licensed counterpart.
