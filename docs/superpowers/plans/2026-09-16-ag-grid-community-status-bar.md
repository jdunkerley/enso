# AG Grid Community Fallback — Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `TableVisualization.vue`'s bottom Status Bar (an AG Grid
Enterprise-only tool panel) only ever activate when
`AG_GRID_ENTERPRISE_AVAILABLE` is true. When it's unavailable, the grid must
fall back to the row-count line it already shows today — no new UI, no new AG
Grid module.

**Architecture:** The Community fallback already exists in the template today:
`v-if="!useBottomStatusBar"` renders a plain top row-count line whenever
`useBottomStatusBar` is falsy. The only change is what makes
`useBottomStatusBar` true — today it's driven purely by the backend's
`use_bottom_status_bar` data flag; after this change it's
`AG_GRID_ENTERPRISE_AVAILABLE && <that same backend flag>`. The gating
expression is extracted into a small exported pure function
(`computeUseBottomStatusBar`) in `TableVisualization.vue`'s plain (non-`setup`)
`<script>` block, mirroring how that same block already exports
`commonContextMenuActions` from the sibling `AgGridTableView.vue` — this makes
the new logic unit-testable via
`import { computeUseBottomStatusBar } from '.../TableVisualization.vue'` without
mounting the full 1289-line component (which has no existing test harness and
depends on `useVisualizationConfig()`/Yjs providers not available in isolation).

**Tech Stack:** Vue 3 (`<script>` + `<script setup>` SFC), TypeScript, Vitest.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`
(section "7. Status Bar").

**Depends on:**
`docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md` (must be
implemented first) — this plan imports `AG_GRID_ENTERPRISE_AVAILABLE` from
`app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts`,
which that plan creates.

## Global Constraints

- Zero new UI/behavior beyond the gating condition (spec: "Zero new code beyond
  the gating condition"). Do not touch `TableVizStatusBar.ts` or the row-count
  fallback template branch (`TableVisualization.vue:1188-1211`) — both are
  already correct.
- Only "is a key configured" gates this, via `AG_GRID_ENTERPRISE_AVAILABLE` — no
  separate/duplicate check.
- When licensed, behavior must be unchanged: `useBottomStatusBar` must still
  equal today's `data.use_bottom_status_bar` value exactly.
- `.env.testing` (used by `vitest`) does not set a license key, so
  `AG_GRID_ENTERPRISE_AVAILABLE` is deterministically `false` under unit tests
  (see the foundation plan's Global Constraints) — tests here assert both the
  licensed and unlicensed cases by passing the flag as an explicit parameter to
  the pure function rather than by trying to flip global state.

---

## File Structure

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`:
  - Plain `<script lang="ts">` block (top of file): add one import, one exported
    pure function.
  - `<script setup lang="ts">` block: change the `useBottomStatusBar` computed
    to call that function.
- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts`

No other files. `TableVizStatusBar.ts` (the status-panel renderer itself) needs
no changes — it has no AG Grid import and only renders whatever
`statusPanelParams` it's given.

---

### Task 1: Gate the Status Bar behind `AG_GRID_ENTERPRISE_AVAILABLE`

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue:2`
  (imports), `:150` (end of plain `<script>` block — add function here),
  `:281-286` (the `useBottomStatusBar` computed)
- Test:
  `app/gui/src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts`

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from
  `@/components/shared/AgGridTableView/agGridLicense` (produced by the
  foundation plan's Task 1).
- Produces:
  `export function computeUseBottomStatusBar(data: Data, enterpriseAvailable: boolean): boolean`,
  exported from `TableVisualization.vue`'s plain `<script>` block (same pattern
  as `commonContextMenuActions` in `AgGridTableView.vue`). Used only by this
  file's own `useBottomStatusBar` computed; no other consumers.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts
import { describe, expect, test } from "vitest";
import { computeUseBottomStatusBar } from "../TableVisualization.vue";

const baseEnsoTableData = {
  type: "EnsoTableOrColumn" as const,
  json: null,
  header: undefined,
  data: undefined,
  value_type: [],
  has_index_col: undefined,
  links: undefined,
  get_child_node_action: "",
  get_child_node_link_name: "",
  child_label: "",
  visualization_header: "",
  is_using_server_sort_and_filter: false,
  enable_create_node: false,
  requires_number_format: [],
  is_using_multi_filter: [],
};

describe("computeUseBottomStatusBar", () => {
  test("is false when the backend requests it but no AG Grid Enterprise license is configured", () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true };
    expect(computeUseBottomStatusBar(data, false)).toBe(false);
  });

  test("is true when the backend requests it and a license is configured", () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: true };
    expect(computeUseBottomStatusBar(data, true)).toBe(true);
  });

  test("is false when the backend does not request it, even when licensed", () => {
    const data = { ...baseEnsoTableData, use_bottom_status_bar: false };
    expect(computeUseBottomStatusBar(data, true)).toBe(false);
  });

  test("is false for data shapes without a use_bottom_status_bar field, regardless of license", () => {
    expect(computeUseBottomStatusBar("a plain string value", true)).toBe(false);
    expect(computeUseBottomStatusBar("a plain string value", false)).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts`
Expected: FAIL — `computeUseBottomStatusBar` is not exported from
`TableVisualization.vue` yet.

- [ ] **Step 3: Write minimal implementation**

In `TableVisualization.vue`, add the import next to the existing
`AgGridTableView.vue` import at line 2:

```ts
import AgGridTableView, {
  commonContextMenuActions,
} from "@/components/shared/AgGridTableView.vue";
import { AG_GRID_ENTERPRISE_AVAILABLE } from "@/components/shared/AgGridTableView/agGridLicense";
```

Add the exported function at the end of the plain `<script lang="ts">` block,
right after `export type TextFormatOptions = 'full' | 'partial' | 'off'`
(currently the last line before `</script>` at line 151):

```ts
export type TextFormatOptions = "full" | "partial" | "off";

/**
 * Whether to show the AG Grid Enterprise bottom Status Bar tool panel instead of the plain
 * Community-safe top row-count line. The Status Bar is Enterprise-only, so this is `false`
 * whenever no AG Grid Enterprise license is configured, regardless of what the backend requests.
 */
export function computeUseBottomStatusBar(
  data: Data,
  enterpriseAvailable: boolean,
): boolean {
  return (
    enterpriseAvailable &&
    typeof data === "object" &&
    "use_bottom_status_bar" in data &&
    Boolean(data.use_bottom_status_bar)
  );
}
```

In the `<script setup lang="ts">` block, replace the existing
`useBottomStatusBar` computed (currently):

```ts
const useBottomStatusBar = computed(
  () =>
    typeof props.data === "object" &&
    "use_bottom_status_bar" in props.data &&
    props.data.use_bottom_status_bar,
);
```

with:

```ts
const useBottomStatusBar = computed(() =>
  computeUseBottomStatusBar(props.data, AG_GRID_ENTERPRISE_AVAILABLE),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.
`data.use_bottom_status_bar` is only declared on the `EnsoTableOrColumn` variant
of `Data` — the `'use_bottom_status_bar' in data` check must still narrow
correctly inside `computeUseBottomStatusBar` exactly as it did inline before
extraction; if `vue-tsc` complains about the narrowing on a bare `data: Data`
parameter (as opposed to the previous `props.data` access), keep the exact same
`typeof data === 'object' && 'use_bottom_status_bar' in data` shape — do not
rewrite it as a type guard, since that's what the original code relied on.

- [ ] **Step 6: Run the broader visualization unit test suite for regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations`
Expected: PASS.

- [ ] **Step 7: Manual smoke check**

With the foundation plan's changes in place, run the dev server twice:

1. With a real license key configured (`.dev-env/.env.development`, the
   default): open a table visualization whose backend data has
   `use_bottom_status_bar: true` (e.g. a large/paginated table) — confirm the
   bottom Status Bar still renders exactly as before.
2. With `ENSO_IDE_AG_GRID_LICENSE_KEY` unset (temporarily blank it in your local
   env file, don't commit that change): open the same visualization — confirm
   the top row-count line renders instead, no console error, no attempt to
   render the Enterprise Status Bar.

This is out of scope for automated coverage in this plan (no existing Playwright
spec covers the status bar today —
`integration-test/project-view/tableVisualisation.spec.ts` has no status-bar
assertions — and adding a "no license key" Playwright run configuration is
shared infrastructure spanning every AG Grid Community fallback plan, not
specific to this one).

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/visualizations/TableVisualization.vue app/gui/src/project-view/components/visualizations/__tests__/TableVisualization.statusBar.test.ts
git commit -m "Only show the AG Grid Enterprise status bar when licensed"
```

---

## Self-Review Notes

- **Spec coverage:** Section 7 ("Status Bar") is fully covered by the single
  task — the spec explicitly scopes this to "Zero new code beyond the gating
  condition," and the only addition beyond the gating expression itself is
  making that expression a named, unit-testable function rather than an inline
  arrow body, which changes nothing about runtime behavior.
- **Placeholder scan:** none — every step has real code taken from the actual
  current file contents (read at plan-writing time) or exact shell commands.
- **Type consistency:**
  `computeUseBottomStatusBar(data: Data, enterpriseAvailable: boolean): boolean`
  is defined once (Step 3) and called once with matching argument order (Step
  3's `<script setup>` edit) and in the test (Step 1). `Data` is the file's
  existing local type (`TableVisualization.vue:78`), not re-declared.
- **Out of scope, tracked elsewhere:** the design spec's Testing section calls
  for a Playwright "no license key" run configuration across _all_ fallback
  plans (row model, filters, selection/clipboard, menus, status bar) — that's
  shared CI/test-config infrastructure, not particular to the Status Bar, and
  isn't part of this plan's File Structure.
