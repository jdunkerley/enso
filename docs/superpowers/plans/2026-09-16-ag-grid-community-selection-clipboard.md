# AG Grid Community Fallback — Selection + Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `AG_GRID_ENTERPRISE_AVAILABLE` is `false`, replace AG Grid
Enterprise's cell-range selection, copy/cut, and paste-triggering with a small
Community-native implementation, so multi-cell select + copy/cut/paste keeps
working without loading `ag-grid-enterprise`'s
`RangeSelectionModule`/`ClipboardModule`.

**Architecture:** A pure, DOM-free composable (`useCommunityCellRange`) tracks
one `{anchor, focus}` rectangle from Community-native grid events
(`cellMouseDown`, `cellMouseOver`, keyboard extension) and exposes a
`cellClassRules`-compatible predicate for the highlight. `AgGridTableView.vue`
wires that composable's event handlers onto the grid only when unlicensed. For
copy/cut/paste, rather than changing every call site that triggers them (the
`grid.cutCells`/`grid.copyCells`/`grid.pasteCells` keybindings, and — per the
sibling Context Menu + Column Menu plan — a popup menu that calls
`commonContextMenuActions`'s unmodified `cut`/`copy`/`copyWithHeaders`/`paste`
items), `onGridReady` monkey-patches
`copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` directly onto the real
`gridApi` instance whenever unlicensed (`installCommunityClipboardPatch`),
delegating to new `performCopy`/`performCut`/`performPaste` functions. Licensed:
the patch is a no-op, the real
`gridApi.cutToClipboard()`/`copyToClipboard()`/`pasteFromClipboard()` are left
exactly as AG Grid installed them. Unlicensed: those functions read the tracked
rectangle's cell values directly and reuse the _existing_,
already-framework-agnostic
`sendToClipboard`/`rowsToTsv`/`parseTsvData`/`processCellForClipboard` functions
already defined in `AgGridTableView.vue` and `tableParsing.ts` — none of that
logic is AG Grid-specific and none of it changes. Every caller of
`gridApi.copyToClipboard()` etc. — keybindings, `commonContextMenuActions`, the
sibling plan's popup — stays unaware of which implementation it's actually
calling.

**Tech Stack:** Vue 3 Composition API, TypeScript, `ag-grid-community`
(Community-native events: `cellMouseDown`, `cellMouseOver`, `cellClassRules`,
`api.getFocusedCell()`, `api.getDisplayedRowAtIndex()`, `api.getValue()`,
`api.refreshCells()` — all confirmed Community-available, see "Verified API
surface" below), Vitest + `@vue/test-utils`.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`,
section "5. Selection + Clipboard" (lines 153-196). **This plan corrects one
factual gap found in that section while implementing it — see "Correction to the
spec" below.**

## Correction to the spec

The spec states paste "needs no change" because the downstream data-application
logic (`WidgetTableEditor.vue`'s `processDataFromClipboard`,
`tableInputArgument.ts`'s `pasteFromClipboard`) is already framework-agnostic.
That half is confirmed true by reading the code (see Task 4). But the spec's
Enterprise-gated inventory ("What's actually Enterprise-gated is narrower: 1.
selection tracking, 2. the `gridApi.copyToClipboard()`/`cutToClipboard()`
methods") **omits `gridApi.pasteFromClipboard()`**, which is called today from
`AgGridTableView.vue`'s `grid.pasteCells` keybinding handler and from
`commonContextMenuActions.paste.action`. Verified directly against the installed
`ag-grid-community@32.3.3`/`ag-grid-enterprise@32.3.3` packages:

```
node -e "console.log('ClipboardModule' in require('ag-grid-community'))"   // false
node -e "console.log('ClipboardModule' in require('ag-grid-enterprise'))"  // true
```

`copyToClipboard`, `cutToClipboard`, and `pasteFromClipboard` are all part of AG
Grid's `_ClipboardGridApi` interface
(`@ag-grid-community/core/dist/types/src/api/gridApi.d.ts:869-881`), all three
implemented only by the Enterprise-only `ClipboardModule`. So the **programmatic
paste trigger** (keybinding + the future context-menu "Paste" item) needs a
Community replacement exactly like copy/cut do — Task 4 below covers it. Flag
this correction in review; the spec doc itself should probably be updated to
list `pasteFromClipboard()` alongside the other two.

## Global Constraints

- Fill handle isn't implemented today (`enableFillHandle` is never set anywhere
  in the codebase) — nothing to replicate.
- Multi-range selection (ctrl+click for disjoint ranges) isn't used today — the
  Community replacement supports exactly one contiguous rectangle, matching
  current usage.
- `.env.testing` (used by `vitest`) does not set `ENSO_IDE_AG_GRID_LICENSE_KEY`,
  so `AG_GRID_ENTERPRISE_AVAILABLE` (from
  `docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md`, already
  merged as a prerequisite of this plan) is deterministically `false` under
  `vitest`. `.env.staging`/`.env.development` set a real key.
- Full behavioral verification of drag-select and real clipboard I/O needs a
  real browser (jsdom has no layout engine and a stubbed Clipboard API) — this
  plan's automated tests cover the pure range-tracking logic and the
  branch-selection logic (which function gets called under which flag) in
  isolation; end-to-end drag-select-then-copy behavior is a manual smoke check
  here and a Playwright spec as noted in the design's Testing section
  (follow-up, not part of this plan).
- Path aliases: `@/` → `app/gui/src/project-view/`, `$/` → `app/gui/src/`.
- Test/typecheck commands:
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`.

## Verified API surface (checked against installed `ag-grid-community@32.3.3`)

Community-available (safe to call unconditionally): `api.getFocusedCell()`,
`api.getDisplayedRowAtIndex(rowIndex)`, `api.getValue(colKey, rowNode)`,
`api.getAllDisplayedColumns()`, `api.refreshCells(params)`, `cellClassRules`
grid option, `cellMouseDown`/`cellMouseOver` grid events. Enterprise-only (must
be gated by `AG_GRID_ENTERPRISE_AVAILABLE`): `cellSelection` grid option
(`RangeSelectionModule`), `api.getCellRanges()`/`api.addCellRange()`,
`api.copyToClipboard()`/`cutToClipboard()`/`pasteFromClipboard()`
(`ClipboardModule`).

---

## File Structure

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/communityCellRange.ts`
  — pure range-tracking composable + `cellClassRules` predicate. No AG Grid
  value imports; only types.
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts`
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts`
  — `performCopy`/`performCut`/`performPaste`, each branching on
  `AG_GRID_ENTERPRISE_AVAILABLE`.
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue` —
  wire the composable's event handlers + `cellClassRules` onto the grid (gated),
  and patch `copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` onto the
  real `gridApi` in `onGridReady` when unlicensed
  (`installCommunityClipboardPatch`) — the keybinding handlers and
  `commonContextMenuActions` themselves are not modified.
- Modify:
  `app/gui/src/project-view/components/shared/AgGridTableView/tableViewStyle.css`
  — add the range-highlight CSS class.

**Not modified by this plan** (confirmed by grep):
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/tableInputArgument.ts`,
`app/gui/src/project-view/components/visualizations/TableVisualization.vue`,
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/editHandler.ts`
(paste target — confirmed unaffected, see Task 4 notes), and — resolved
differently than originally planned, see below — `commonContextMenuActions`
itself (`AgGridTableView.vue:44-77`) also stays untouched. **Cross-plan note
(resolved):** the sibling Context Menu + Column Menu plan's `GridPopupMenu`
hands the real `gridApi` straight through to `commonContextMenuActions`'s
unmodified `cut`/`copy`/`copyWithHeaders`/`paste` items, which call
`api.cutToClipboard()`/`api.copyToClipboard()`/`api.pasteFromClipboard()`
directly — that plan's own Global Constraints forbid changing those action
bodies. Rather than making every caller (keybindings today, the popup menu in
the sibling plan) know about `performCopy`/`performCut`/`performPaste`, Task 3/4
below monkey-patch those three methods directly onto the real `gridApi` instance
in `onGridReady`, once, whenever unlicensed — see
`installCommunityClipboardPatch`. After that patch, `gridApi.copyToClipboard()`
etc. is safe to call from anywhere (keybindings, `commonContextMenuActions`, the
sibling plan's popup) without that caller needing to know whether AG Grid
Enterprise is loaded. This also means the keybinding handlers (`actionHandlers`,
lines 284-294) and `commonContextMenuActions` need **zero changes** — see Task 3
Step 5.

---

### Task 1: Range-tracking composable (prototype-first, per spec's explicit risk callout)

The spec marks this section as the highest-uncertainty part of the whole design
and asks for "a small throwaway prototype of just the range-tracking + highlight
before wiring it into copy/cut." This task **is** that prototype, built
test-first so its risk is retired before Task 2 wires it into the real grid and
Task 3 builds copy/cut on top of it. It has zero AG Grid runtime dependency — it
only needs `{rowIndex: number, colId: string}` pairs, so it can be fully
unit-tested without mounting a grid.

**Files:**

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/communityCellRange.ts`
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts`

**Interfaces:**

- Produces: `interface CellCoord { rowIndex: number; colId: string }`;
  `useCommunityCellRange(displayedColumnIds: () => string[])` returning
  `{ range: Ref<{anchor: CellCoord; focus: CellCoord} | undefined>, startAt(coord: CellCoord): void, extendTo(coord: CellCoord): void, clear(): void, isInRange(coord: CellCoord): boolean, rectangle(): { rowIndices: number[]; colIds: string[] } | undefined }`.
  Consumed by Task 2 (wiring), Task 3 (copy/cut reads `rectangle()`).

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts
import { describe, expect, test } from "vitest";
import { useCommunityCellRange } from "../communityCellRange";

const columnIds = () => ["a", "b", "c", "d"];

describe("useCommunityCellRange", () => {
  test("has no range until startAt is called", () => {
    const { range, isInRange } = useCommunityCellRange(columnIds);
    expect(range.value).toBeUndefined();
    expect(isInRange({ rowIndex: 0, colId: "a" })).toBe(false);
  });

  test("startAt sets a single-cell range", () => {
    const { rectangle, startAt, isInRange } = useCommunityCellRange(columnIds);
    startAt({ rowIndex: 2, colId: "b" });
    expect(rectangle()).toEqual({ rowIndices: [2], colIds: ["b"] });
    expect(isInRange({ rowIndex: 2, colId: "b" })).toBe(true);
    expect(isInRange({ rowIndex: 2, colId: "c" })).toBe(false);
  });

  test("extendTo grows the rectangle regardless of drag direction", () => {
    const { rectangle, startAt, extendTo, isInRange } =
      useCommunityCellRange(columnIds);
    startAt({ rowIndex: 3, colId: "c" });
    extendTo({ rowIndex: 1, colId: "a" });
    expect(rectangle()).toEqual({
      rowIndices: [1, 2, 3],
      colIds: ["a", "b", "c"],
    });
    expect(isInRange({ rowIndex: 1, colId: "a" })).toBe(true);
    expect(isInRange({ rowIndex: 3, colId: "c" })).toBe(true);
    expect(isInRange({ rowIndex: 0, colId: "a" })).toBe(false);
    expect(isInRange({ rowIndex: 1, colId: "d" })).toBe(false);
  });

  test("extendTo without a prior startAt is a no-op", () => {
    const { rectangle, extendTo } = useCommunityCellRange(columnIds);
    extendTo({ rowIndex: 1, colId: "a" });
    expect(rectangle()).toBeUndefined();
  });

  test("clear removes the range", () => {
    const { rectangle, startAt, extendTo, clear } =
      useCommunityCellRange(columnIds);
    startAt({ rowIndex: 0, colId: "a" });
    extendTo({ rowIndex: 1, colId: "b" });
    clear();
    expect(rectangle()).toBeUndefined();
  });

  test("a second startAt replaces the previous range rather than extending it", () => {
    const { rectangle, startAt } = useCommunityCellRange(columnIds);
    startAt({ rowIndex: 0, colId: "a" });
    startAt({ rowIndex: 5, colId: "d" });
    expect(rectangle()).toEqual({ rowIndices: [5], colIds: ["d"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts`
Expected: FAIL — `Cannot find module '../communityCellRange'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/communityCellRange.ts
import { ref, type Ref } from "vue";

/** A single grid cell, identified the same way AG Grid identifies cells in its own events. */
export interface CellCoord {
  rowIndex: number;
  colId: string;
}

interface Range {
  anchor: CellCoord;
  focus: CellCoord;
}

/**
 * Tracks one contiguous rectangular cell selection from Community-native inputs (mouse
 * down/drag, keyboard extension), replacing AG Grid Enterprise's `cellSelection` for the
 * unlicensed fallback. Deliberately supports only a single rectangle — multi-range (ctrl+click)
 * selection isn't used anywhere in this codebase today.
 */
export function useCommunityCellRange(displayedColumnIds: () => string[]) {
  const range: Ref<Range | undefined> = ref(undefined);

  function startAt(coord: CellCoord) {
    range.value = { anchor: coord, focus: coord };
  }

  function extendTo(coord: CellCoord) {
    if (range.value == null) return;
    range.value = { anchor: range.value.anchor, focus: coord };
  }

  function clear() {
    range.value = undefined;
  }

  function rectangle(): { rowIndices: number[]; colIds: string[] } | undefined {
    const current = range.value;
    if (current == null) return undefined;
    const columnIds = displayedColumnIds();
    const anchorColIndex = columnIds.indexOf(current.anchor.colId);
    const focusColIndex = columnIds.indexOf(current.focus.colId);
    if (anchorColIndex === -1 || focusColIndex === -1) return undefined;

    const minRow = Math.min(current.anchor.rowIndex, current.focus.rowIndex);
    const maxRow = Math.max(current.anchor.rowIndex, current.focus.rowIndex);
    const minCol = Math.min(anchorColIndex, focusColIndex);
    const maxCol = Math.max(anchorColIndex, focusColIndex);

    const rowIndices = Array.from(
      { length: maxRow - minRow + 1 },
      (_, i) => minRow + i,
    );
    const colIds = columnIds.slice(minCol, maxCol + 1);
    return { rowIndices, colIds };
  }

  function isInRange(coord: CellCoord): boolean {
    const rect = rectangle();
    if (rect == null) return false;
    return (
      rect.rowIndices.includes(coord.rowIndex) &&
      rect.colIds.includes(coord.colId)
    );
  }

  return { range, startAt, extendTo, clear, isInRange, rectangle };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/communityCellRange.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts
git commit -m "Add Community cell-range tracking composable"
```

---

### Task 2: Wire the range composable into AgGridTableView.vue (gated)

**Files:**

- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue`
- Modify:
  `app/gui/src/project-view/components/shared/AgGridTableView/tableViewStyle.css`
- Test: extend
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityCellRange.test.ts`
  is NOT touched here; this task's test lives inline below as a new test file
  targeting the grid-option-building logic extracted into a small pure function
  (see Step 1) rather than a full component mount, for the same
  jsdom/ResizeObserver reasons documented in the foundation plan.

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from
  `./AgGridTableView/agGridLicense` (foundation plan); `useCommunityCellRange`,
  `CellCoord` from `./AgGridTableView/communityCellRange` (Task 1).
- Produces: an exported, unit-testable
  `buildSelectionGridOptions(enterpriseAvailable: boolean)` pure function (see
  below) that later tasks and reviewers can check without mounting AG Grid.

- [ ] **Step 1: Write the failing test**

Extract the "which grid options do we pass for selection" decision into one
small, pure, exported function so it's unit-testable without a live grid — this
is the part of the wiring that actually carries risk of a typo silently keeping
Enterprise-only options active.

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/selectionGridOptions.test.ts
import { describe, expect, test } from "vitest";
import { buildSelectionGridOptions } from "../AgGridTableView.vue";

describe("buildSelectionGridOptions", () => {
  test("licensed: enables native cellSelection, no custom cellClassRules", () => {
    const options = buildSelectionGridOptions(true);
    expect(options.cellSelection).toBe(true);
    expect(options.cellClassRules).toBeUndefined();
  });

  test("unlicensed: disables native cellSelection, adds a custom cellClassRules entry", () => {
    const options = buildSelectionGridOptions(false);
    expect(options.cellSelection).toBeUndefined();
    expect(options.cellClassRules).toBeDefined();
    expect(Object.keys(options.cellClassRules!)).toContain(
      "communityCellRangeSelected",
    );
  });
});
```

(This imports from the `.vue` file's `<script lang="ts">` module block, matching
the existing pattern where `commonContextMenuActions`/`MenuItem` are already
exported from that same block and imported by
`tableInputArgument.ts`/`TableVisualization.vue`.)

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/selectionGridOptions.test.ts`
Expected: FAIL — `buildSelectionGridOptions` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

In `AgGridTableView.vue`'s top `<script lang="ts">` block (the module block,
alongside `commonContextMenuActions` at line 44), add:

```ts
/**
 * Grid options controlling cell selection. Licensed builds use AG Grid Enterprise's native
 * `cellSelection`; unlicensed builds disable it and rely on `communityCellRangeSelected`
 * (applied via `cellClassRules` in the template) for the visual highlight instead — see
 * `communityCellRange.ts` for the range-tracking logic driving that class.
 */
export function buildSelectionGridOptions(enterpriseAvailable: boolean) {
  return enterpriseAvailable
    ? { cellSelection: true as const, cellClassRules: undefined }
    : {
        cellSelection: undefined,
        cellClassRules: {
          communityCellRangeSelected: (params: {
            node: { rowIndex: number | null };
            colDef: { colId?: string };
          }) =>
            params.node.rowIndex != null &&
            params.colDef.colId != null &&
            isInCommunityRange({
              rowIndex: params.node.rowIndex,
              colId: params.colDef.colId,
            }),
        },
      };
}
```

This references `isInCommunityRange`, a module-level indirection layer added in
the `<script setup>` block below so the (per-instance) range state can be read
from a (module-level) `cellClassRules` predicate — AG Grid's `cellClassRules`
predicates are plain functions with no access to component instance state, so
the predicate must close over a ref assigned from setup. Add to
`<script setup>`, right after `const popupParent = document.body` (line 158):

```ts
const {
  range: communityRange,
  startAt,
  extendTo,
  clear,
  isInRange,
  rectangle,
} = useCommunityCellRange(
  () => gridApi.value?.getAllDisplayedColumns().map((c) => c.getColId()) ?? [],
);

// `cellClassRules` predicates are plain functions AG Grid calls with no closure over component
// state, so route them through this module-level indirection, reassigned per active grid.
isInCommunityRangeRef = isInRange;
onUnmounted(() => {
  if (isInCommunityRangeRef === isInRange) isInCommunityRangeRef = () => false;
});
```

And in the module `<script lang="ts">` block, alongside
`buildSelectionGridOptions`:

```ts
let isInCommunityRangeRef: (coord: CellCoord) => boolean = () => false;
function isInCommunityRange(coord: CellCoord) {
  return isInCommunityRangeRef(coord);
}
```

Add the imports (module block, near the top of `<script lang="ts">`):

```ts
import { AG_GRID_ENTERPRISE_AVAILABLE } from "./AgGridTableView/agGridLicense";
import {
  type CellCoord,
  useCommunityCellRange,
} from "./AgGridTableView/communityCellRange";
```

And `onUnmounted` to the `<script setup>` Vue import list (line 130-139).

Wire mouse/keyboard events in `<script setup>`, near `suppressCopy` (after line
312's `stopIfPrevented`):

```ts
function onCellMouseDown(event: {
  rowIndex: number | null;
  column: { getColId(): string };
}) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || event.rowIndex == null) return;
  startAt({ rowIndex: event.rowIndex, colId: event.column.getColId() });
  gridApi.value?.refreshCells({ force: true });
}

function onCellMouseOver(
  event: { rowIndex: number | null; column: { getColId(): string } },
  mouseButtonDown: boolean,
) {
  if (
    AG_GRID_ENTERPRISE_AVAILABLE ||
    event.rowIndex == null ||
    !mouseButtonDown
  )
    return;
  extendTo({ rowIndex: event.rowIndex, colId: event.column.getColId() });
  gridApi.value?.refreshCells({ force: true });
}

let mouseButtonDown = false;
function onWrapperMouseDown() {
  mouseButtonDown = true;
}
function onWrapperMouseUp() {
  mouseButtonDown = false;
}

function extendRangeByKeyboard(event: KeyboardEvent) {
  if (AG_GRID_ENTERPRISE_AVAILABLE || !event.shiftKey) return;
  const delta =
    event.key === "ArrowDown"
      ? { rowIndex: 1, colIndex: 0 }
      : event.key === "ArrowUp"
        ? { rowIndex: -1, colIndex: 0 }
        : event.key === "ArrowLeft"
          ? { rowIndex: 0, colIndex: -1 }
          : event.key === "ArrowRight"
            ? { rowIndex: 0, colIndex: 1 }
            : undefined;
  const focused = gridApi.value?.getFocusedCell();
  if (delta == null || focused == null) return;
  const columnIds =
    gridApi.value?.getAllDisplayedColumns().map((c) => c.getColId()) ?? [];
  const currentColIndex = columnIds.indexOf(focused.column.getColId());
  const current = communityRange.value ?? {
    anchor: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
    focus: { rowIndex: focused.rowIndex, colId: focused.column.getColId() },
  };
  const nextColId =
    columnIds[currentColIndex + delta.colIndex] ?? current.focus.colId;
  if (communityRange.value == null) startAt(current.anchor);
  extendTo({
    rowIndex: Math.max(0, current.focus.rowIndex + delta.rowIndex),
    colId: nextColId,
  });
  gridApi.value?.refreshCells({ force: true });
  event.preventDefault();
}
```

Add `@mousedown.capture="onWrapperMouseDown"` and
`@mouseup.capture="onWrapperMouseUp"` to the wrapper `<div>` (template line
373-379), and extend the existing `@keydown` handler to also call
`extendRangeByKeyboard`:

```html
@keydown="(handler($event) || stopIfPrevented($event),
extendRangeByKeyboard($event))"
```

On the `<AgGridVue>` element (template, alongside the existing
`:cellSelection="true"` at line 396), replace that single line with:

```html
v-bind="buildSelectionGridOptions(AG_GRID_ENTERPRISE_AVAILABLE)"
@cellMouseDown="onCellMouseDown" @cellMouseOver="onCellMouseOver($event,
mouseButtonDown)"
```

(`v-bind` with an object spreads `cellSelection`/`cellClassRules` as individual
bound props — Vue's standard object-binding form, same mechanism already used
for `v-bind="$attrs"` one line above it.)

Add the highlight CSS to `tableViewStyle.css`:

```css
.ag-theme-alpine .communityCellRangeSelected {
  background-color: var(
    --ag-range-selection-background-color,
    rgba(0, 89, 255, 0.1)
  );
}
```

(`--ag-range-selection-background-color` is a standard `ag-theme-alpine` CSS
variable already defined by the theme regardless of which modules are
registered, since it's a pure CSS custom property, not a module-gated feature —
safe to reference under Community.)

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/selectionGridOptions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS. If
`cellClassRules`'s param types don't structurally match AG Grid's
`CellClassRules<TData>` type, narrow the inline parameter type to match exactly
what AG Grid expects (check `@ag-grid-community/core`'s `CellClassParams` type)
rather than using `any`.

- [ ] **Step 6: Manual smoke check**

Run the dev server, open a table visualization, and (a) confirm licensed
behavior (real key from `.env.development`) is pixel-identical to before —
native AG Grid range highlight, no `communityCellRangeSelected` class ever
applied; (b) temporarily blank `ENSO_IDE_AG_GRID_LICENSE_KEY` in
`.dev-env/.env.development` (don't commit this), reload, and confirm: click-drag
across cells highlights a rectangle with the new CSS class, Shift+Arrow extends
it, releasing the mouse outside the grid doesn't leave `mouseButtonDown` stuck
`true` (click once more inside the grid afterward to confirm drag-extend still
starts a _new_ range rather than resuming a stuck one).

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView.vue app/gui/src/project-view/components/shared/AgGridTableView/tableViewStyle.css app/gui/src/project-view/components/shared/AgGridTableView/__tests__/selectionGridOptions.test.ts
git commit -m "Wire Community cell-range tracking into AgGridTableView"
```

---

### Task 3: Copy/Cut using the tracked range (unlicensed)

**Files:**

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts`
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue`
  (patch `copyToClipboard`/`cutToClipboard` onto the real `gridApi` in
  `onGridReady`, lines 161-166 — not the keybinding handlers themselves, see
  Step 5)

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE`; `rectangle()`/`CellCoord` shape from
  Task 1's composable (passed in as already-computed
  `{ rowIndices: number[]; colIds: string[] }`, not re-imported — keeps this
  module decoupled from Vue reactivity).
- Produces: `performCopy(deps: ClipboardDeps, withHeaders: boolean): void`,
  `performCut(deps: ClipboardDeps): void`, and
  `installCommunityClipboardPatch(...)` (see Step 5), which is what actually
  makes this task's logic reachable from both the keybindings and the sibling
  Context Menu plan's popup — see File Structure's "Cross-plan note (resolved)"
  above.

```ts
export interface ClipboardDeps {
  enterpriseAvailable: boolean;
  gridApi: {
    cutToClipboard?(): void;
    copyToClipboard?(): void;
    getDisplayedRowAtIndex(rowIndex: number): { data: unknown } | undefined;
    getValue(colId: string, rowNode: { data: unknown }): unknown;
    getColumn(
      colId: string,
    ): {
      getColDef(): {
        headerName?: string;
        valueSetter?: (params: unknown) => boolean;
      };
    } | null;
  };
  rectangle: () => { rowIndices: number[]; colIds: string[] } | undefined;
  processCellForClipboard: (params: {
    value: unknown;
    formatValue: (v: unknown) => string;
  }) => string;
  sendToClipboard: (params: { data: string }) => void;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts
import { describe, expect, test, vi } from "vitest";
import {
  installCommunityClipboardPatch,
  performCopy,
  performCut,
  type ClipboardDeps,
} from "../communityClipboard";

function makeDeps(overrides: Partial<ClipboardDeps> = {}): ClipboardDeps {
  const rows: Record<number, Record<string, string>> = {
    0: { a: "x1", b: "y1" },
    1: { a: "x2", b: "y2" },
  };
  const valueSetters: Record<string, ReturnType<typeof vi.fn>> = {
    a: vi.fn(() => true),
    b: vi.fn(() => true),
  };
  return {
    enterpriseAvailable: false,
    gridApi: {
      cutToClipboard: vi.fn(),
      copyToClipboard: vi.fn(),
      getDisplayedRowAtIndex: (rowIndex: number) => ({ data: rows[rowIndex] }),
      getValue: (colId: string, rowNode: { data: unknown }) =>
        (rowNode.data as Record<string, string>)[colId],
      getColumn: (colId: string) => ({
        getColDef: () => ({
          headerName: colId.toUpperCase(),
          valueSetter: valueSetters[colId],
        }),
      }),
    },
    rectangle: () => ({ rowIndices: [0, 1], colIds: ["a", "b"] }),
    processCellForClipboard: ({ value }) => String(value),
    sendToClipboard: vi.fn(),
    ...overrides,
  };
}

describe("performCopy", () => {
  test("licensed: delegates to the real AG Grid API", () => {
    const deps = makeDeps({ enterpriseAvailable: true });
    performCopy(deps, false);
    expect(deps.gridApi.copyToClipboard).toHaveBeenCalled();
    expect(deps.sendToClipboard).not.toHaveBeenCalled();
  });

  test("unlicensed: builds a TSV (headers row always first) from the tracked rectangle", () => {
    const deps = makeDeps();
    performCopy(deps, false);
    expect(deps.gridApi.copyToClipboard).not.toHaveBeenCalled();
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: "A\tB\nx1\ty1\nx2\ty2",
    });
  });

  test("unlicensed: no-ops when there is no tracked rectangle", () => {
    const deps = makeDeps({ rectangle: () => undefined });
    performCopy(deps, false);
    expect(deps.sendToClipboard).not.toHaveBeenCalled();
  });
});

describe("performCut", () => {
  test("licensed: delegates to the real AG Grid API", () => {
    const deps = makeDeps({ enterpriseAvailable: true });
    performCut(deps);
    expect(deps.gridApi.cutToClipboard).toHaveBeenCalled();
  });

  test("unlicensed: copies the rectangle then clears every cell via its valueSetter", () => {
    const deps = makeDeps();
    performCut(deps);
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: "A\tB\nx1\ty1\nx2\ty2",
    });
    const colA = deps.gridApi.getColumn("a")!.getColDef();
    const colB = deps.gridApi.getColumn("b")!.getColDef();
    expect(colA.valueSetter).toHaveBeenCalledTimes(2);
    expect(colB.valueSetter).toHaveBeenCalledTimes(2);
  });

  test("unlicensed: skips columns with no valueSetter (read-only columns) without throwing", () => {
    const deps = makeDeps();
    (deps.gridApi.getColumn("a")!.getColDef().valueSetter as unknown) =
      undefined;
    expect(() => performCut(deps)).not.toThrow();
  });
});

describe("installCommunityClipboardPatch", () => {
  test("licensed: leaves the real copyToClipboard/cutToClipboard untouched", () => {
    const realCopy = vi.fn();
    const realCut = vi.fn();
    const api = { copyToClipboard: realCopy, cutToClipboard: realCut };
    installCommunityClipboardPatch(
      api,
      true,
      () => makeDeps(),
      () => false,
    );
    expect(api.copyToClipboard).toBe(realCopy);
    expect(api.cutToClipboard).toBe(realCut);
  });

  test("unlicensed: replaces copyToClipboard/cutToClipboard with Community-backed implementations", () => {
    const api: { copyToClipboard?(): void; cutToClipboard?(): void } = {
      copyToClipboard: vi.fn(),
      cutToClipboard: vi.fn(),
    };
    const deps = makeDeps();
    installCommunityClipboardPatch(
      api,
      false,
      () => deps,
      () => false,
    );
    api.copyToClipboard!();
    expect(deps.sendToClipboard).toHaveBeenCalledWith({
      data: "A\tB\nx1\ty1\nx2\ty2",
    });
  });
});
```

(This last `describe` block is why `commonContextMenuActions`'s unmodified
`cut`/`copy`/`copyWithHeaders`/`paste` items — and the sibling Context Menu +
Column Menu plan's `GridPopupMenu`, which calls them with the real `gridApi` —
keep working unlicensed without either of them knowing about
`communityClipboard.ts`: `onGridReady`, Step 5 below, patches the real `gridApi`
instance directly.)

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
Expected: FAIL — `Cannot find module '../communityClipboard'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts
/**
 * Community (unlicensed) replacements for the three AG Grid Enterprise `ClipboardModule` API
 * methods (`copyToClipboard`/`cutToClipboard`/`pasteFromClipboard`) used by keybindings and
 * (once the Context Menu + Column Menu plan wires it in) the custom context menu. Reuses the
 * same TSV-building and Enso-expression-clipboard logic already used by the licensed path —
 * that logic was never AG Grid-specific, only the *trigger* was.
 */
export interface ClipboardDeps {
  enterpriseAvailable: boolean;
  gridApi: {
    cutToClipboard?(): void;
    copyToClipboard?(): void;
    getDisplayedRowAtIndex(rowIndex: number): { data: unknown } | undefined;
    getValue(colId: string, rowNode: { data: unknown }): unknown;
    getColumn(
      colId: string,
    ): {
      getColDef(): {
        headerName?: string;
        valueSetter?: (params: unknown) => boolean;
      };
    } | null;
  };
  rectangle: () => { rowIndices: number[]; colIds: string[] } | undefined;
  processCellForClipboard: (params: {
    value: unknown;
    formatValue: (v: unknown) => string;
  }) => string;
  sendToClipboard: (params: { data: string }) => void;
}

function tsvEscape(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function buildTsv(deps: ClipboardDeps): string | undefined {
  const rect = deps.rectangle();
  if (rect == null) return undefined;
  const headerRow = rect.colIds.map(
    (colId) => deps.gridApi.getColumn(colId)?.getColDef().headerName ?? colId,
  );
  const dataRows = rect.rowIndices.map((rowIndex) => {
    const rowNode = deps.gridApi.getDisplayedRowAtIndex(rowIndex);
    return rect.colIds.map((colId) => {
      const value = rowNode ? deps.gridApi.getValue(colId, rowNode) : undefined;
      return tsvEscape(
        deps.processCellForClipboard({
          value,
          formatValue: (v) => (v == null ? "" : String(v)),
        }),
      );
    });
  });
  return [headerRow.map(tsvEscape), ...dataRows]
    .map((row) => row.join("\t"))
    .join("\n");
}

/** Copy the tracked rectangle. `withHeaders` is accepted for interface parity with the licensed
 * path's `copyWithHeaders` toggle; the TSV always includes a header row (matching
 * `copyHeadersToClipboard: true`'s behavior today) — `sendToClipboard` itself decides whether the
 * header row makes it into the final `text/plain` clipboard write. */
export function performCopy(deps: ClipboardDeps, _withHeaders: boolean): void {
  if (deps.enterpriseAvailable) {
    deps.gridApi.copyToClipboard?.();
    return;
  }
  const data = buildTsv(deps);
  if (data != null) deps.sendToClipboard({ data });
}

/** Copy the tracked rectangle, then clear every selected cell via its column's `valueSetter` —
 * matching how AG Grid Enterprise's own `cutToClipboard()` clears cells after copying them. Only
 * meaningful for editable columns (the Table Input widget); read-only columns have no
 * `valueSetter` and are silently skipped, matching how `cutToClipboard` is a harmless no-op on
 * read-only cells today. */
export function performCut(deps: ClipboardDeps): void {
  if (deps.enterpriseAvailable) {
    deps.gridApi.cutToClipboard?.();
    return;
  }
  const rect = deps.rectangle();
  const data = buildTsv(deps);
  if (data != null) deps.sendToClipboard({ data });
  if (rect == null) return;
  for (const rowIndex of rect.rowIndices) {
    const rowNode = deps.gridApi.getDisplayedRowAtIndex(rowIndex);
    if (rowNode == null) continue;
    for (const colId of rect.colIds) {
      const valueSetter = deps.gridApi
        .getColumn(colId)
        ?.getColDef().valueSetter;
      valueSetter?.({ data: rowNode.data, newValue: "", node: rowNode });
    }
  }
}

/**
 * Monkey-patches `copyToClipboard`/`cutToClipboard` directly onto a real AG Grid `gridApi`
 * instance when unlicensed, delegating to `performCopy`/`performCut` above. This is what lets
 * every existing caller of `gridApi.copyToClipboard()`/`cutToClipboard()` — the `grid.cutCells`/
 * `grid.copyCells` keybindings, and `commonContextMenuActions`'s `cut`/`copy`/`copyWithHeaders`
 * items (`AgGridTableView.vue:44-77`, consumed unchanged by the sibling Context Menu + Column
 * Menu plan's popup) — keep working without any of them branching on
 * `AG_GRID_ENTERPRISE_AVAILABLE` themselves. Licensed: a no-op, the real Enterprise methods are
 * left exactly as AG Grid installed them. Call once, from `onGridReady`, on the fresh `gridApi`
 * each time the grid is (re)created (see Task 2's `gridKey`-driven grid recreation).
 */
export function installCommunityClipboardPatch(
  api: { copyToClipboard?(): void; cutToClipboard?(): void },
  enterpriseAvailable: boolean,
  clipboardDeps: () => ClipboardDeps,
  copyWithHeaders: () => boolean,
): void {
  if (enterpriseAvailable) return;
  Object.assign(api, {
    copyToClipboard: () => performCopy(clipboardDeps(), copyWithHeaders()),
    cutToClipboard: () => performCut(clipboardDeps()),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
Expected: PASS (8 tests: 3 `performCopy` + 3 `performCut` + 2
`installCommunityClipboardPatch`).

- [ ] **Step 5: Patch the real `gridApi` in `onGridReady`, instead of changing
      every call site**

Re-read the actual current handler before editing — it's `onGridReady` at
`AgGridTableView.vue:161-166`:

```ts
function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api;
  if (rowModelType.value === "serverSide") {
    gridApi.value.retryServerSideLoads();
  }
}
```

Replace it with:

```ts
function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api;
  if (rowModelType.value === "serverSide") {
    gridApi.value.retryServerSideLoads();
  }
  installCommunityClipboardPatch(
    event.api,
    AG_GRID_ENTERPRISE_AVAILABLE,
    clipboardDeps,
    () => copyWithHeaders.value,
  );
}

function clipboardDeps(): ClipboardDeps {
  return {
    enterpriseAvailable: AG_GRID_ENTERPRISE_AVAILABLE,
    gridApi: gridApi.value as unknown as ClipboardDeps["gridApi"],
    rectangle,
    processCellForClipboard,
    sendToClipboard,
  };
}
```

`clipboardDeps` reads `gridApi.value` (assigned just above, on the same event)
rather than closing over `event.api` directly, so it stays correct if called
again later (e.g. from Task 4's paste patch, or if the grid API reference is
ever refreshed).

**Nothing else in this file changes.** `actionHandlers` (lines 284-294) already
reads:

```ts
const actionHandlers = registerHandlers({
  "grid.cutCells": gridAction(() => {
    copyWithHeaders.value = false;
    gridApi.value?.cutToClipboard();
  }),
  "grid.copyCells": gridAction(() => {
    copyWithHeaders.value = false;
    gridApi.value?.copyToClipboard();
  }),
  "grid.pasteCells": gridAction(() => gridApi.value?.pasteFromClipboard()),
});
```

— this already calls `gridApi.value.copyToClipboard()`/`cutToClipboard()`
exactly as needed; it doesn't need to know or care whether those are the real
Enterprise methods or the ones `installCommunityClipboardPatch` just installed.
Same for `commonContextMenuActions` (lines 44-77) — untouched, and (per the
sibling Context Menu + Column Menu plan) reused unchanged by its
`GridPopupMenu`. (`grid.pasteCells` isn't patched until Task 4, where
`pasteFromClipboard` joins the patch — until Task 4 lands, paste stays on the
real Enterprise-only method, i.e. this task's commit alone doesn't yet fix
paste. That's fine: Task 3 and Task 4 are meant to land together before this
plan is considered done, and this task's own tests/typecheck stay green either
way since nothing here references `performPaste`.)

Add `installCommunityClipboardPatch`, `performCopy`, `performCut`,
`type ClipboardDeps` to the `<script setup>` import from
`./AgGridTableView/communityClipboard` (new import line, alongside the Task 2
imports).

- [ ] **Step 6: Run full test suite for this directory**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView`
Expected: PASS — all tests from Tasks 1-3.

- [ ] **Step 7: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts app/gui/src/project-view/components/shared/AgGridTableView.vue
git commit -m "Add Community copy/cut for the tracked cell range"
```

---

### Task 4: Paste trigger (unlicensed) — the spec correction

**Files:**

- Modify:
  `app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts`
  (add `PasteDeps`/`performPaste`; extend `installCommunityClipboardPatch` from
  Task 3 to also patch `pasteFromClipboard`)
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue`
  (extend the `installCommunityClipboardPatch` call added in Task 3's
  `onGridReady` with paste deps — no other wiring needed, see below)
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
  (extend)

**Why this is needed despite the spec saying paste needs no change:** confirmed
by reading `WidgetTableEditor.vue:125-145` —
`processDataFromClipboard({ data, api })` calls `api.getFocusedCell()`
(Community-safe) and hands the already-parsed `data: string[][]` to
`tableInputArgument.ts`'s `pasteFromClipboard(data, focusedCell)`, which does
100% of the actual mutation itself (editing the AST directly) and the callback
always `return []`s — meaning AG Grid's own cell-application step is never used.
**That part is genuinely unaffected and needs no change.** What breaks under
Community is only how `data`/`{data, api}` gets produced in the first place:
today it comes from `gridApi.pasteFromClipboard()`, implemented by the
Enterprise-only `ClipboardModule` (verified absent from `ag-grid-community`'s
module exports; see "Correction to the spec" above) and called from exactly two
places — the `grid.pasteCells` keybinding (`Mod+V`, already the sole path by
which this codebase handles paste; there is no separate native browser-paste
listener to worry about, see note below) and, per the sibling Context Menu plan,
`commonContextMenuActions.paste.action`. Both go through
`gridApi.pasteFromClipboard()`, so — exactly like copy/cut in Task 3 — patching
that one method onto the real `gridApi` covers both callers with zero changes to
either.

**Note on native OS paste:** `AgGridTableView.vue`'s wrapper already intercepts
`Mod+V` itself, before it would ever reach AG Grid internals —
`@keydown="handler($event) || ..."` (template, wrapper `<div>`) runs
`gridBindings.handler(...)`, which dispatches to
`actionHandlers['grid.pasteCells']`, and `suppressCopy` (lines 300-312)
explicitly stops AG Grid's own copy/cut/paste keydown handling for
`Mod+X`/`Mod+C`/`Mod+V` so it doesn't double-handle the event. So there is no
scenario where a native "paste" DOM/browser event reaches AG Grid's (absent,
when unlicensed) `ClipboardModule` directly — every paste in this codebase
already funnels through `gridApi.pasteFromClipboard()`. This plan originally
assumed a separate native `paste` event listener was also needed; re-reading the
keydown-interception code during this task shows that's unnecessary scope —
patching `pasteFromClipboard()` alone is sufficient.

**Interfaces:**

- Consumes: `parseTsvData` from
  `@/components/GraphEditor/widgets/WidgetTableEditor/tableParsing` (already
  imported in `AgGridTableView.vue:88-92`); `props.processDataFromClipboard`
  (existing prop, `AgGridTableViewProps.processDataFromClipboard`, line 13);
  Task 3's `installCommunityClipboardPatch`, `clipboardDeps`.
- Produces: `performPaste(deps: PasteDeps): Promise<void>`; the extended
  `installCommunityClipboardPatch(api, enterpriseAvailable, clipboardDeps, pasteDeps, copyWithHeaders)`
  signature (one new parameter vs. Task 3).

- [ ] **Step 1: Write the failing test**

Add to `communityClipboard.test.ts`, alongside the Task 3 tests:

```ts
import { performPaste, type PasteDeps } from "../communityClipboard";

function makePasteDeps(overrides: Partial<PasteDeps> = {}): PasteDeps {
  return {
    enterpriseAvailable: false,
    gridApi: {
      pasteFromClipboard: vi.fn(),
      getFocusedCell: () => ({ rowIndex: 1, column: { getColId: () => "a" } }),
    },
    readClipboardText: vi.fn(async () => "x\ty\n1\t2"),
    processDataFromClipboard: vi.fn(),
    parseTsvData: (text) => text.split("\n").map((row) => row.split("\t")),
    ...overrides,
  };
}

describe("performPaste", () => {
  test("licensed: delegates to the real AG Grid API", async () => {
    const deps = makePasteDeps({ enterpriseAvailable: true });
    await performPaste(deps);
    expect(deps.gridApi.pasteFromClipboard).toHaveBeenCalled();
    expect(deps.readClipboardText).not.toHaveBeenCalled();
  });

  test("unlicensed: reads the clipboard, parses TSV, and forwards it with the focused cell", async () => {
    const deps = makePasteDeps();
    await performPaste(deps);
    expect(deps.processDataFromClipboard).toHaveBeenCalledWith({
      data: [
        ["x", "y"],
        ["1", "2"],
      ],
      api: deps.gridApi,
    });
  });

  test("unlicensed: no-ops if no cell is focused", async () => {
    const deps = makePasteDeps({
      gridApi: { pasteFromClipboard: vi.fn(), getFocusedCell: () => null },
    });
    await performPaste(deps);
    expect(deps.processDataFromClipboard).not.toHaveBeenCalled();
  });
});
```

`installCommunityClipboardPatch` gains a `pasteDeps` parameter in this task
(Step 3) — update the Task 3 `installCommunityClipboardPatch` describe block to
match its new signature and add paste coverage. Replace that whole block with:

```ts
describe("installCommunityClipboardPatch", () => {
  test("licensed: leaves the real copyToClipboard/cutToClipboard/pasteFromClipboard untouched", () => {
    const realCopy = vi.fn();
    const realCut = vi.fn();
    const realPaste = vi.fn();
    const api = {
      copyToClipboard: realCopy,
      cutToClipboard: realCut,
      pasteFromClipboard: realPaste,
    };
    installCommunityClipboardPatch(
      api,
      true,
      () => makeDeps(),
      () => makePasteDeps(),
      () => false,
    );
    expect(api.copyToClipboard).toBe(realCopy);
    expect(api.cutToClipboard).toBe(realCut);
    expect(api.pasteFromClipboard).toBe(realPaste);
  });

  test("unlicensed: replaces copyToClipboard/cutToClipboard/pasteFromClipboard with Community-backed implementations", () => {
    const api: {
      copyToClipboard?(): void;
      cutToClipboard?(): void;
      pasteFromClipboard?(): void;
    } = {
      copyToClipboard: vi.fn(),
      cutToClipboard: vi.fn(),
      pasteFromClipboard: vi.fn(),
    };
    const clipboardDeps = makeDeps();
    const pasteDeps = makePasteDeps();
    installCommunityClipboardPatch(
      api,
      false,
      () => clipboardDeps,
      () => pasteDeps,
      () => false,
    );
    api.copyToClipboard!();
    expect(clipboardDeps.sendToClipboard).toHaveBeenCalledWith({
      data: "A\tB\nx1\ty1\nx2\ty2",
    });
    api.pasteFromClipboard!();
    expect(pasteDeps.readClipboardText).toHaveBeenCalled();
  });
});
```

(This replaces, rather than adds alongside, the `installCommunityClipboardPatch`
block Task 3 wrote — same test file, same `describe` name, extended coverage and
matching call signature.)

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
Expected: FAIL — `performPaste`/`PasteDeps` not exported yet, and the updated
`installCommunityClipboardPatch` calls don't match its still-4-argument Task 3
signature.

- [ ] **Step 3: Write the implementation**

In `communityClipboard.ts`, add `PasteDeps`/`performPaste` and extend
`installCommunityClipboardPatch` (both defined in Task 3) to also cover
`pasteFromClipboard`:

```ts
export interface PasteDeps {
  enterpriseAvailable: boolean;
  gridApi: {
    pasteFromClipboard?(): void;
    getFocusedCell(): {
      rowIndex: number;
      column: { getColId(): string };
    } | null;
  };
  /** Reads clipboard text; separated out so tests don't need a real Clipboard API. Production
   * call site passes `() => navigator.clipboard.readText()`. */
  readClipboardText: () => Promise<string>;
  processDataFromClipboard: (params: {
    data: string[][];
    api: PasteDeps["gridApi"];
  }) => void;
  parseTsvData: (text: string) => string[][] | undefined;
}

export async function performPaste(deps: PasteDeps): Promise<void> {
  if (deps.enterpriseAvailable) {
    deps.gridApi.pasteFromClipboard?.();
    return;
  }
  if (deps.gridApi.getFocusedCell() == null) return;
  const text = await deps.readClipboardText();
  const data = deps.parseTsvData(text);
  if (data == null) return;
  deps.processDataFromClipboard({ data, api: deps.gridApi });
}
```

Replace Task 3's `installCommunityClipboardPatch` with this extended version
(same function, one new parameter, one new patched method):

```ts
export function installCommunityClipboardPatch(
  api: {
    copyToClipboard?(): void;
    cutToClipboard?(): void;
    pasteFromClipboard?(): void;
  },
  enterpriseAvailable: boolean,
  clipboardDeps: () => ClipboardDeps,
  pasteDeps: () => PasteDeps,
  copyWithHeaders: () => boolean,
): void {
  if (enterpriseAvailable) return;
  Object.assign(api, {
    copyToClipboard: () => performCopy(clipboardDeps(), copyWithHeaders()),
    cutToClipboard: () => performCut(clipboardDeps()),
    pasteFromClipboard: () => {
      void performPaste(pasteDeps());
    },
  });
}
```

(`pasteFromClipboard`'s real signature is `(): void`, but `performPaste` is
async — `void performPaste(...)` fires it and intentionally doesn't await,
matching how `gridAction`'s `action: () => void` in `AgGridTableView.vue`
already doesn't await either.)

In `AgGridTableView.vue`, add `pasteClipboardDeps()` alongside Task 3's
`clipboardDeps()`, and update the `onGridReady` call site to pass it:

```ts
function onGridReady(event: GridReadyEvent<TData>) {
  gridApi.value = event.api;
  if (rowModelType.value === "serverSide") {
    gridApi.value.retryServerSideLoads();
  }
  installCommunityClipboardPatch(
    event.api,
    AG_GRID_ENTERPRISE_AVAILABLE,
    clipboardDeps,
    pasteClipboardDeps,
    () => copyWithHeaders.value,
  );
}

function pasteClipboardDeps(): PasteDeps {
  return {
    enterpriseAvailable: AG_GRID_ENTERPRISE_AVAILABLE,
    gridApi: gridApi.value as unknown as PasteDeps["gridApi"],
    readClipboardText: () => navigator.clipboard.readText(),
    processDataFromClipboard: (params) =>
      props.processDataFromClipboard?.(params as any),
    parseTsvData,
  };
}
```

No other file changes — per the "Note on native OS paste" above, the existing,
untouched `grid.pasteCells` keybinding handler
(`gridApi.value?.pasteFromClipboard()`) now reaches the patched implementation
automatically, and so does `commonContextMenuActions.paste.action` for the
sibling Context Menu plan's popup.

Add `performPaste`, `type PasteDeps` to the existing `<script setup>` import
from `./AgGridTableView/communityClipboard` (Task 3 already added the import
line; extend it).

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts`
Expected: PASS (11 tests total across the file: 3 `performCopy` + 3
`performCut` + 2 `installCommunityClipboardPatch` + 3 `performPaste`).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 6: Manual smoke check**

With no license key configured (dev server, per Task 2 Step 6's temporary env
edit): focus a cell in the editable Table Input widget, copy a 2x2 block from a
spreadsheet app, press Ctrl+V, confirm the pasted values land at the focused
cell exactly as they do today with a license key configured. Confirm the
browser's clipboard-read permission prompt (if any) doesn't block the grid or
throw an unhandled rejection — `navigator.clipboard.readText()` requires a user
gesture and (in some browsers) a permission grant; if a prompt appears
repeatedly or paste silently fails, note it in the PR description as a known UX
gap for a follow-up (async clipboard permissions are a genuine,
not-fully-solvable-here browser constraint — this plan's job is behavioral
parity for the happy path, not new permission UX).

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/communityClipboard.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/communityClipboard.test.ts app/gui/src/project-view/components/shared/AgGridTableView.vue
git commit -m "Add Community paste trigger via the gridApi clipboard patch"
```

---

## Self-Review Notes

- **Spec coverage:** range tracking + highlight → Task 1-2. Copy/Cut → Task 3.
  Paste trigger → Task 4 (spec said "no change"; corrected with evidence, see
  top of document). Fill-handle/multi-range carve-outs → explicitly called out
  in Global Constraints, no task implements them (intentional).
- **Cross-plan reconciliation (re-reviewed after the coordinator flagged it):**
  the sibling Context Menu + Column Menu plan's `GridPopupMenu` passes the real
  `gridApi` straight through to `commonContextMenuActions`'s unmodified
  `cut`/`copy`/`copyWithHeaders`/`paste` items, and that plan's Global
  Constraints forbid changing those action bodies. Originally this plan required
  every caller (including that popup) to import and call
  `performCopy`/`performCut`/`performPaste` directly, which the sibling plan
  couldn't do without violating its own constraint. Fixed by moving the branch
  point to a single `installCommunityClipboardPatch(...)` call in `onGridReady`
  (Task 3 Step 5, extended in Task 4 Step 3), which monkey-patches
  `copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` directly onto the real
  `gridApi` instance when unlicensed. Consequence, verified by re-reading the
  actual current code rather than assumed: `actionHandlers`
  (`AgGridTableView.vue:284-294`) and `commonContextMenuActions`
  (`AgGridTableView.vue:44-77`) now need **zero changes** in this plan — both
  already call
  `gridApi.value.copyToClipboard()`/`cutToClipboard()`/`pasteFromClipboard()`/`api.copyToClipboard()`
  etc., which is exactly what the patch intercepts. This also let Task 4 drop a
  redundant native `paste` DOM-event listener from the original draft —
  re-reading `AgGridTableView.vue`'s existing keydown interception
  (`suppressCopy`, lines 300-312) showed `Mod+V` already funnels exclusively
  through `gridApi.pasteFromClipboard()`, so patching that one method is
  sufficient; no second trigger path exists to cover.
- **Placeholder scan:** none remaining. (The earlier draft's `performPaste` stub
  — needed only because Task 3's `actionHandlers` rewrite referenced it before
  Task 4 existed — is gone now that Task 3 no longer touches `actionHandlers` at
  all.)
- **Type consistency:** `CellCoord` (Task 1) is reused by name in Task 2's event
  handlers. `rectangle()`'s return shape
  (`{ rowIndices: number[]; colIds: string[] }`) is defined once in Task 1 and
  consumed identically in `ClipboardDeps.rectangle` (Task 3) and nowhere
  redefined differently. `ClipboardDeps`/`PasteDeps` in Tasks 3-4 both name
  `gridApi` narrowly (only the methods actually used), consistent with the
  existing `MenuItem<TData>` narrowing convention already in
  `AgGridTableView.vue:27-32`. `installCommunityClipboardPatch`'s signature is
  defined once in Task 3 (4 params) and Task 4 explicitly shows the full
  replacement (5 params, `pasteDeps` inserted before `copyWithHeaders`) rather
  than describing a partial diff — every call site shown after Task 4 (test
  file, `onGridReady`) uses the 5-param form consistently.
- **Risk flagged for the parent/user, not resolved here (all confirmed against
  real code during this plan's research, not assumed):**
  1. The spec's paste correction (above) — worth fixing in the spec doc itself.
  2. Task 2's `cellClassRules` module-level indirection
     (`isInCommunityRangeRef`) is the one part of this plan with real
     architectural awkwardness — AG Grid's `cellClassRules` predicates have no
     access to component-instance state, so a module-level mutable binding is
     the least-bad option found; if `AgGridTableView.vue` is ever used with
     multiple simultaneously-mounted grid instances on screen at once (it
     doesn't appear to be today — each visualization/widget instance gets its
     own component instance, but this wasn't exhaustively verified across all
     call sites), this indirection would leak the _last-mounted_ grid's range
     predicate to earlier ones. Worth a reviewer's explicit sign-off.
  3. Header-label sourcing in `communityClipboard.ts`'s `buildTsv` uses
     `colDef.headerName`; `TableHeader.vue` (the custom header component used by
     the Table Input widget) may derive its _displayed_ header text from
     somewhere other than `headerName` (out of this plan's read scope). Task
     2/3's manual smoke check should specifically confirm copied header text
     matches what's visually shown, not just what compiles.
  4. `installCommunityClipboardPatch` runs once per `gridReady` event.
     `AgGridTableView.vue`'s `:key="gridKey"` (template) forces AG Grid to fully
     recreate the grid (and re-fire `gridReady`) on certain state changes (see
     `forceGridRefresh`/`gridKeyIncrement`), so the patch is re-applied each
     time — checked, this is not a one-shot gap. If a future change ever obtains
     a `gridApi` reference through a path other than `onGridReady` (none exists
     today), that path would bypass the patch.
