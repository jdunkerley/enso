# AG Grid Community Fallback — Context Menu + Column Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `AG_GRID_ENTERPRISE_AVAILABLE` is `false`, render the cell
context menu and the column ("main") menu with a small custom popup instead of
AG Grid Enterprise's native menu renderer, reusing the exact same item lists
(`getContextMenuItems`, `ColDef.contextMenuItems`, `ColDef.mainMenuItems`) the
licensed path already produces. When licensed, behavior is completely unchanged
— the native Enterprise menus still render exactly as today.

**Architecture:** A new generic floating popup component, `GridPopupMenu.vue`,
renders a flat list of `{name, icon?, action}` entries plus separators,
positioned at a point via `@floating-ui/vue` (mirroring the existing
`ContextMenu.vue` pattern) and dismissed on outside-click (mirroring
`endOnClickOutside`/`injectInteractionHandler`, also from `ContextMenu.vue`). A
resolver module, `gridPopupMenuItems.ts`, normalizes AG Grid's native item-list
vocabulary — a mix of custom `MenuItemDef`/`MenuItem` objects and
AG-Grid-interpreted string tokens (`'separator'`, `'autoSizeThis'`,
`'autoSizeAll'`, `'export'`) — into that flat shape, since those string tokens
are meaningless without AG Grid's own renderer to interpret them. Two trigger
points swap to the popup when unlicensed: `AgGridTableView.vue` listens for the
Community-native `cellContextMenu` grid event (fires without any Enterprise
module — only the built-in menu _renderer_ is Enterprise-gated) instead of
relying on the `getContextMenuItems` grid option ever being invoked by AG Grid
itself; `TableHeader.vue`'s existing right-click handler calls `GridPopupMenu`
instead of `showColumnMenuAfterMouseClick`.

**Tech Stack:** Vue 3 SFCs, `@floating-ui/vue` (already used by
`ContextMenu.vue`), TypeScript, `ag-grid-community`/`ag-grid-enterprise`
(type-only imports), Vitest.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`,
section "6. Context Menu + Column Menu" (lines 198-222).

**Sequencing:** This is one of the two highest-uncertainty pieces per the design
spec (the other is Selection + Clipboard) — implement it after the Foundation,
Status Bar, Row Model, and Filters plans are done and merged.

## Global Constraints

- Licensed behavior (`AG_GRID_ENTERPRISE_AVAILABLE === true`) must not change at
  all — every new code path in this plan is gated behind
  `!AG_GRID_ENTERPRISE_AVAILABLE`, imported from
  `@/components/shared/AgGridTableView/agGridLicense` (added by
  `docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md`; treat
  that plan as already merged).
- `subMenu` (nested menus) is out of scope: verified by search that nothing in
  this codebase's item lists (`commonContextMenuActions`,
  `TableVisualization.vue`'s `getContextMenuItems`, `tableInputArgument.ts`'s
  `mainMenuItems`/`contextMenuItems`) uses it.
- Excel export is explicitly out of scope per the design spec's non-goals. The
  `'export'` built-in token is mapped only to CSV export
  (`api.exportDataAsCsv()`, a Community-available API), never Excel.
- Both consumers keep producing their own item lists exactly as today (spec:
  "Both consumers keep producing their own item lists exactly as today; only the
  rendering/positioning mechanism swaps when unlicensed") — this plan does not
  touch `commonContextMenuActions` (`AgGridTableView.vue`),
  `getContextMenuItems` (`TableVisualization.vue`), or
  `mainMenuItems`/`contextMenuItems` (`tableInputArgument.ts`) except to change
  _how they're invoked_, never their contents.
- `.env.testing` (vitest) has no AG Grid license key configured, so
  `AG_GRID_ENTERPRISE_AVAILABLE` is deterministically `false` under unit tests —
  the new fallback code paths in this plan are exactly the ones vitest naturally
  exercises.
- Path aliases: `@/` → `app/gui/src/project-view/`, `$/` → `app/gui/src/`.
- Test/typecheck commands:
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`.

## ⚠️ Cross-plan coordination note (read before starting Task 3)

`commonContextMenuActions`
(`app/gui/src/project-view/components/shared/AgGridTableView.vue:44-77`) defines
`cut`/`copy`/`copyWithHeaders`/`paste` menu items whose `action({ api })`
callbacks call `api.cutToClipboard()` / `api.copyToClipboard()` /
`api.pasteFromClipboard()` directly. Those are Enterprise/clipboard-module-gated
`GridApi` methods — under `ag-grid-community` alone they do not exist (verified:
`require('ag-grid-community')` has no clipboard-module registration by default).
This plan's `GridPopupMenu` passes the _real_ `gridApi` through to these actions
unchanged (matching "both consumers keep producing their own item lists exactly
as today").

**Confirmed resolution:** the Selection + Clipboard plan
(`docs/superpowers/plans/2026-09-16-ag-grid-community-selection-clipboard.md`,
design spec section 5) monkey-patches
`copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` directly onto the real
`gridApi` instance, in its `gridReady` handler, when
`!AG_GRID_ENTERPRISE_AVAILABLE` — delegating to its own
`performCopy`/`performCut`/`performPaste` functions. Once that plan is merged,
`commonContextMenuActions`'s existing bodies (and this plan's `GridPopupMenu`,
which passes the real `gridApi` through unchanged) work correctly with **zero
changes needed in this plan**. This is a settled, concrete dependency, not an
open design question — only the merge order between the two plans is
undetermined. **Do not silently work around this in Task 3** — implement the
menu wiring as designed. If this plan is implemented before the Selection +
Clipboard plan lands, check whether `gridApi.copyToClipboard` has already been
monkey-patched (its presence/absence is a simple runtime check, e.g. log
`typeof gridApi.copyToClipboard` during the manual smoke check) rather than
assuming it's still broken, and note in the Task 3 commit / PR description
whichever is true at merge time.

## ⚠️ Open risk carried into Task 4 (flagged, not resolved, by this plan)

`TableHeader.vue`'s custom header template replaces AG Grid's header _label_
area, but AG Grid may still render its own default header menu icon/button (a
separate DOM element it manages, controlled by `ColDef.suppressHeaderMenuButton`
and related column-menu-visibility options) alongside it. Whether that native
icon (a) appears at all under `ag-grid-community` without the Enterprise
column-menu module, and (b) if it does, whether it does anything harmful (e.g.
try to open a menu and silently no-op, vs. throw) when unlicensed, could not be
determined by reading source alone — it depends on AG Grid's runtime header-cell
chrome, which isn't practical to verify without mounting a real grid in a
browser. **Task 4 includes a manual verification step for this**; if the native
icon does appear and misbehaves, the fix is to set
`suppressHeaderMenuButton: true` on `defaultColDef` (in `TableVisualization.vue`
and `tableInputArgument.ts`) when `!AG_GRID_ENTERPRISE_AVAILABLE`, which is one
line in each file but is _not_ written into this plan since it's unconfirmed to
be necessary.

---

## File Structure

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/gridPopupMenuItems.ts`
  — normalizes AG Grid item lists (objects + built-in string tokens) into a flat
  renderable shape.
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts`
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/GridPopupMenu.vue`
  — the floating popup itself, reusing `MenuPanel.vue`/`MenuButton.vue` and the
  `@floating-ui/vue` positioning pattern from `ContextMenu.vue`.
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue` — new
  `cellContextMenu` handler + `GridPopupMenu` mount, gated on
  `AG_GRID_ENTERPRISE_AVAILABLE`.
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/TableHeader.vue`
  — `onMouseRightClick` branches to `GridPopupMenu` when unlicensed.
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts`
  (new file — none exists today for this component)

No changes to `TableVisualization.vue`'s `getContextMenuItems` or
`tableInputArgument.ts`'s `mainMenuItems`/`contextMenuItems` — both are consumed
as-is (Global Constraints).

---

### Task 1: `GridPopupMenu.vue` — generic floating item-list popup

**Files:**

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/gridPopupMenuItems.ts`
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts`
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/GridPopupMenu.vue`

**Interfaces:**

- Produces:
  `export type GridMenuItem = { type: 'separator' } | { type: 'item'; name: string; icon?: string; disabled?: boolean; shortcut?: string; action: () => void }`,
  `export interface GridMenuContext { api: GridApi; column: Column | null; node: IRowNode | null }`,
  `export function resolveGridMenuItems(rawItems: (string | MenuItemDef)[], ctx: GridMenuContext): GridMenuItem[]`
  — all consumed by Task 2 and Task 3 (this plan) and reusable by any future
  menu-producing consumer. `GridPopupMenu.vue` props:
  `{ items: GridMenuItem[]; point: { x: number; y: number } }`, emits
  `close: []`.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts
import { expect, test, vi } from "vitest";
import {
  resolveGridMenuItems,
  type GridMenuContext,
} from "../gridPopupMenuItems";

function makeContext(
  overrides: Partial<GridMenuContext> = {},
): GridMenuContext {
  return {
    api: {
      autoSizeColumns: vi.fn(),
      autoSizeAllColumns: vi.fn(),
      exportDataAsCsv: vi.fn(),
    } as any,
    column: { getColId: () => "colA" } as any,
    node: { data: { value: 1 } } as any,
    ...overrides,
  };
}

test("passes through a custom menu item, binding its action to {node, api}", () => {
  const action = vi.fn();
  const ctx = makeContext();
  const [item] = resolveGridMenuItems(
    [{ name: "Do Thing", icon: "<svg/>", action }],
    ctx,
  );

  expect(item).toMatchObject({
    type: "item",
    name: "Do Thing",
    icon: "<svg/>",
  });
  if (item?.type !== "item") throw new Error("expected an item");
  item.action();
  expect(action).toHaveBeenCalledWith({ node: ctx.node, api: ctx.api });
});

test("'separator' becomes a divider", () => {
  const [item] = resolveGridMenuItems(["separator"], makeContext());
  expect(item).toEqual({ type: "separator" });
});

test("'autoSizeThis' calls api.autoSizeColumns with the clicked column's id", () => {
  const ctx = makeContext();
  const [item] = resolveGridMenuItems(["autoSizeThis"], ctx);
  if (item?.type !== "item") throw new Error("expected an item");
  item.action();
  expect(ctx.api.autoSizeColumns).toHaveBeenCalledWith(["colA"]);
});

test("'autoSizeThis' is dropped when there is no column in context", () => {
  const items = resolveGridMenuItems(
    ["autoSizeThis"],
    makeContext({ column: null }),
  );
  expect(items).toEqual([]);
});

test("'autoSizeAll' calls api.autoSizeAllColumns", () => {
  const ctx = makeContext();
  const [item] = resolveGridMenuItems(["autoSizeAll"], ctx);
  if (item?.type !== "item") throw new Error("expected an item");
  item.action();
  expect(ctx.api.autoSizeAllColumns).toHaveBeenCalled();
});

test("'export' maps to CSV export only (Excel export is out of scope)", () => {
  const ctx = makeContext();
  const [item] = resolveGridMenuItems(["export"], ctx);
  expect(item?.name).toBe("Export to CSV");
  if (item?.type !== "item") throw new Error("expected an item");
  item.action();
  expect(ctx.api.exportDataAsCsv).toHaveBeenCalled();
});

test("an unrecognized built-in token is dropped with a warning, not thrown", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const items = resolveGridMenuItems(["someFutureAgGridToken"], makeContext());
  expect(items).toEqual([]);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("a non-string icon (DOM Element) is dropped rather than rendered, since nothing in this codebase produces one", () => {
  const el = document.createElement("span");
  const [item] = resolveGridMenuItems(
    [{ name: "X", icon: el, action: vi.fn() }],
    makeContext(),
  );
  if (item?.type !== "item") throw new Error("expected an item");
  expect(item.icon).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts`
Expected: FAIL — `Cannot find module '../gridPopupMenuItems'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/gridPopupMenuItems.ts
import type {
  Column,
  GridApi,
  IRowNode,
  MenuItemDef,
} from "ag-grid-enterprise";

/** A single entry `GridPopupMenu.vue` renders, or a visual divider between entries. */
export type GridMenuItem =
  | { type: "separator" }
  | {
      type: "item";
      name: string;
      icon?: string;
      disabled?: boolean;
      shortcut?: string;
      action: () => void;
    };

/** What's needed to resolve AG Grid's built-in string menu-item tokens into concrete actions. */
export interface GridMenuContext {
  api: GridApi;
  column: Column | null;
  node: IRowNode | null;
}

type RawMenuItem =
  | string
  | (MenuItemDef & {
      action?: (params: { node: IRowNode | null; api: GridApi }) => void;
    });

const KNOWN_BUILTIN_ITEMS: Record<
  string,
  (ctx: GridMenuContext) => GridMenuItem | undefined
> = {
  separator: () => ({ type: "separator" }),
  autoSizeThis: (ctx) =>
    ctx.column == null
      ? undefined
      : {
          type: "item",
          name: "Autosize This Column",
          action: () => ctx.api.autoSizeColumns([ctx.column!.getColId()]),
        },
  autoSizeAll: (ctx) => ({
    type: "item",
    name: "Autosize All Columns",
    action: () => ctx.api.autoSizeAllColumns(),
  }),
  // Excel export is explicitly out of scope for the Community fallback (see the design spec's
  // non-goals) — this built-in token only offers CSV export, which ag-grid-community supports.
  export: () => ({
    type: "item",
    name: "Export to CSV",
    action: () => undefined as void, // placeholder, replaced below with real ctx access
  }),
};
// `export` needs `ctx`, unlike the object literal above allows cleanly — define it referencing ctx:
KNOWN_BUILTIN_ITEMS.export = (ctx) => ({
  type: "item",
  name: "Export to CSV",
  action: () => ctx.api.exportDataAsCsv(),
});

function resolveOne(
  rawItem: RawMenuItem,
  ctx: GridMenuContext,
): GridMenuItem | undefined {
  if (typeof rawItem === "string") {
    const resolver = KNOWN_BUILTIN_ITEMS[rawItem];
    if (!resolver) {
      console.warn(
        `GridPopupMenu: unsupported built-in AG Grid menu item "${rawItem}" — dropped.`,
      );
      return undefined;
    }
    return resolver(ctx);
  }
  return {
    type: "item",
    name: rawItem.name,
    // DOM-Element icons aren't supported: nothing in this codebase produces one today (verified by
    // search — every `icon` in `commonContextMenuActions`/`TableVisualization.vue` is an HTML string).
    icon: typeof rawItem.icon === "string" ? rawItem.icon : undefined,
    disabled: rawItem.disabled,
    shortcut: rawItem.shortcut,
    action: () => rawItem.action?.({ node: ctx.node, api: ctx.api }),
  };
}

/**
 * Normalize an AG Grid `(MenuItemDef | string)[]` item list — as produced by
 * `getContextMenuItems`, `ColDef.contextMenuItems`, or `ColDef.mainMenuItems` — into the flat
 * shape `GridPopupMenu.vue` renders. Built-in AG Grid string tokens are interpreted here because
 * AG Grid's own renderer — the thing that normally understands them — isn't present when running
 * on `ag-grid-community`. `subMenu` is not supported: nothing in this codebase uses it today.
 */
export function resolveGridMenuItems(
  rawItems: RawMenuItem[],
  ctx: GridMenuContext,
): GridMenuItem[] {
  const resolved: GridMenuItem[] = [];
  for (const rawItem of rawItems) {
    const item = resolveOne(rawItem, ctx);
    if (item) resolved.push(item);
  }
  return resolved;
}
```

Clean up the placeholder `export` entry in `KNOWN_BUILTIN_ITEMS` — the object
literal above is only there to keep the initial object shape valid; delete the
first `export: () => (...)` entry and keep only the
`KNOWN_BUILTIN_ITEMS.export = (ctx) => (...)` assignment. (Written this way here
only to show the reasoning; when actually writing the file, just write `export`
directly as an arrow function taking `ctx` in the initial object literal, same
as `autoSizeThis`/`autoSizeAll` — there is no real need for the two-step
assignment.) Final `KNOWN_BUILTIN_ITEMS` should be:

```ts
const KNOWN_BUILTIN_ITEMS: Record<
  string,
  (ctx: GridMenuContext) => GridMenuItem | undefined
> = {
  separator: () => ({ type: "separator" }),
  autoSizeThis: (ctx) =>
    ctx.column == null
      ? undefined
      : {
          type: "item",
          name: "Autosize This Column",
          action: () => ctx.api.autoSizeColumns([ctx.column!.getColId()]),
        },
  autoSizeAll: (ctx) => ({
    type: "item",
    name: "Autosize All Columns",
    action: () => ctx.api.autoSizeAllColumns(),
  }),
  // Excel export is explicitly out of scope for the Community fallback (see the design spec's
  // non-goals) — this built-in token only offers CSV export, which ag-grid-community supports.
  export: (ctx) => ({
    type: "item",
    name: "Export to CSV",
    action: () => ctx.api.exportDataAsCsv(),
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write `GridPopupMenu.vue`**

```vue
<!-- app/gui/src/project-view/components/shared/AgGridTableView/GridPopupMenu.vue -->
<script setup lang="ts">
/**
 * A small floating popup rendering a flat `GridMenuItem[]` list — the Community-fallback
 * replacement for AG Grid Enterprise's native context/column menu renderer. Positioning and
 * dismissal mirror `@/components/ContextMenu.vue`.
 */
import MenuButton from "@/components/MenuButton.vue";
import MenuPanel from "@/components/MenuPanel.vue";
import { useResizeObserver } from "@/composables/events";
import { injectInteractionHandler } from "@/providers/interactionHandler";
import { endOnClickOutside } from "@/util/autoBlur";
import { autoUpdate, flip, shift, useFloating } from "@floating-ui/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { GridMenuItem } from "./gridPopupMenuItems";

const { items, point } = defineProps<{
  items: GridMenuItem[];
  /** Location to display the menu near, in client coordinates. */
  point: { x: number; y: number };
}>();
const emit = defineEmits<{ close: [] }>();

const menu = ref<HTMLElement>();
const interaction = injectInteractionHandler();

const virtualEl = computed(() => {
  const { x, y } = point;
  return {
    getBoundingClientRect() {
      return {
        width: 0,
        height: 0,
        x,
        y,
        top: y,
        left: x,
        right: x,
        bottom: y,
      };
    },
  };
});
const { floatingStyles, update } = useFloating(virtualEl, menu, {
  placement: "bottom-start",
  middleware: [flip(), shift({ crossAxis: true })],
  whileElementsMounted: autoUpdate,
});

const menuSize = useResizeObserver(menu);
watch(menuSize, update);

function activate(item: Extract<GridMenuItem, { type: "item" }>) {
  if (item.disabled) return;
  item.action();
  emit("close");
}

onMounted(() => {
  const menuInteraction = endOnClickOutside(menu, {
    cancel: () => emit("close"),
    end: () => emit("close"),
  });
  interaction.setCurrent(menuInteraction);
});
</script>

<template>
  <Teleport to="#floatingLayer">
    <MenuPanel
      ref="menu"
      class="GridPopupMenu"
      :style="floatingStyles"
      data-testid="gridPopupMenu"
      @contextmenu.stop.prevent="emit('close')"
    >
      <template v-for="(item, index) in items" :key="index">
        <div v-if="item.type === 'separator'" class="separator" />
        <MenuButton
          v-else
          :disabled="item.disabled"
          class="entry"
          @activate="activate(item)"
        >
          <span v-if="item.icon" class="icon" v-html="item.icon" />
          <span class="name" v-text="item.name" />
          <span v-if="item.shortcut" class="shortcut" v-text="item.shortcut" />
        </MenuButton>
      </template>
    </MenuPanel>
  </Teleport>
</template>

<style scoped>
.GridPopupMenu {
  position: absolute;
  top: 0;
  left: 0;
  height: fit-content;
  width: fit-content;
  min-width: 160px;
}
.entry {
  display: flex;
  align-items: center;
  justify-content: left;
  padding-left: 8px;
  padding-right: 8px;
  width: 100%;
}
.icon {
  display: inline-flex;
  margin-right: 8px;
}
.name {
  flex: 1;
}
.shortcut {
  margin-left: auto;
  padding-left: 2em;
  opacity: 0.8;
}
.separator {
  height: 1px;
  margin: 4px 0;
  background: var(--color-menu-entry-hover-bg);
}
</style>
```

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/gridPopupMenuItems.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/gridPopupMenuItems.test.ts app/gui/src/project-view/components/shared/AgGridTableView/GridPopupMenu.vue
git commit -m "Add GridPopupMenu, the Community-fallback context/column menu renderer"
```

---

### Task 2: Context menu fallback trigger in `AgGridTableView.vue`

**Files:**

- Modify: `app/gui/src/project-view/components/shared/AgGridTableView.vue`
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts`

**Interfaces:**

- Consumes: `resolveGridMenuItems`, `GridMenuContext` from
  `./AgGridTableView/gridPopupMenuItems` (Task 1); `GridPopupMenu` from
  `./AgGridTableView/GridPopupMenu.vue` (Task 1); `AG_GRID_ENTERPRISE_AVAILABLE`
  from `./AgGridTableView/agGridLicense` (Foundation plan). Consumes the
  existing `props.getContextMenuItems` (`AgGridTableView.vue:18-20`) unchanged.
- Produces: nothing new consumed elsewhere in this plan — this is the terminal
  wiring for the context-menu half.

AG Grid's `cellContextMenu` event (`@ag-grid-community/core`'s `events.d.ts:68`,
`CellContextMenuEvent` at line 751) is a plain Community grid event — it fires
on right-click of a cell with no Enterprise module involved, carrying
`{ event: MouseEvent | null; node: IRowNode; column: Column; value: any; api: GridApi; context: any }`.
This is what makes the fallback possible without hand-rolled DOM hit-testing.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts
import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import AgGridTableView from "../../AgGridTableView.vue";

// Prevent the real AgGridVue from mounting a real grid — this test only exercises the Vue-level
// cellContextMenu handler wiring, not AG Grid's own DOM rendering (see the Foundation plan's
// AgGridVue.test.ts for why a real grid mount is out of scope for unit tests here).
vi.mock("../AgGridTableView/AgGridVue", () => ({
  AgGridVue: {
    name: "StubAgGridVue",
    props: ["getContextMenuItems"],
    emits: ["cellContextMenu"],
    template: "<div />",
  },
}));

describe("AgGridTableView context menu fallback (no AG Grid Enterprise license configured)", () => {
  test("opens GridPopupMenu from a cellContextMenu event, using the column-level contextMenuItems when present", async () => {
    const wrapper = mount(AgGridTableView, {
      props: {
        rowData: [{ value: 1 }],
        columnDefs: [
          {
            field: "value",
            colId: "value",
            contextMenuItems: ["autoSizeThis"],
          },
        ],
        defaultColDef: {},
      },
      attachTo: document.body,
    });
    await wrapper.vm.$nextTick();

    const stub = wrapper.findComponent({ name: "StubAgGridVue" });
    const api = { autoSizeColumns: vi.fn() };
    stub.vm.$emit("cellContextMenu", {
      event: new MouseEvent("contextmenu", { clientX: 10, clientY: 20 }),
      column: {
        getColId: () => "value",
        getColDef: () => ({ contextMenuItems: ["autoSizeThis"] }),
      },
      node: { data: { value: 1 } },
      value: 1,
      api,
      context: undefined,
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent({ name: "GridPopupMenu" }).exists()).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts`
Expected: FAIL — no `cellContextMenu` listener exists yet, so `GridPopupMenu`
never mounts.

- [ ] **Step 3: Write minimal implementation**

In `app/gui/src/project-view/components/shared/AgGridTableView.vue`, add to the
`<script setup>` block (near `stopIfPrevented`, after the existing
keybind/clipboard handlers, before `const { AgGridVue } = await import(...)`):

```ts
import { AG_GRID_ENTERPRISE_AVAILABLE } from "./AgGridTableView/agGridLicense";
import GridPopupMenu from "./AgGridTableView/GridPopupMenu.vue";
import {
  resolveGridMenuItems,
  type GridMenuItem,
} from "./AgGridTableView/gridPopupMenuItems";
import type {
  CellContextMenuEvent,
  Column,
  MenuItemDef,
} from "ag-grid-enterprise";
```

(add these alongside the existing imports;
`CellContextMenuEvent`/`Column`/`MenuItemDef` join the existing
`import type {...} from 'ag-grid-enterprise'` block at line 102-127 rather than
a second statement)

```ts
// === Context menu fallback (no AG Grid Enterprise license) ===

const contextMenuState = ref<{
  point: { x: number; y: number };
  items: GridMenuItem[];
} | null>(undefined);

function resolveColumnOrGridContextMenuItems(
  event: CellContextMenuEvent<TData>,
): (string | MenuItemDef)[] {
  const colDef = event.column?.getColDef();
  const columnItems = colDef?.contextMenuItems;
  if (columnItems != null) {
    return typeof columnItems === "function"
      ? columnItems({
          api: event.api,
          context: event.context,
          column: event.column as Column,
          node: event.node ?? null,
          value: event.value,
          defaultItems: undefined,
        })
      : columnItems;
  }
  const gridItems = props.getContextMenuItems?.({
    api: event.api,
    context: event.context,
    column: event.column ?? null,
    node: event.node ?? null,
    value: event.value,
    defaultItems: undefined,
  });
  if (gridItems == null) return [];
  return typeof gridItems === "function"
    ? gridItems({
        api: event.api,
        context: event.context,
        column: event.column ?? null,
        node: event.node ?? null,
        value: event.value,
        defaultItems: undefined,
      })
    : gridItems;
}

function onCellContextMenu(event: CellContextMenuEvent<TData>) {
  if (AG_GRID_ENTERPRISE_AVAILABLE) return; // native Enterprise context menu handles this instead
  const domEvent = event.event;
  if (!(domEvent instanceof MouseEvent)) return;
  const rawItems = resolveColumnOrGridContextMenuItems(event);
  if (!rawItems.length) return;
  domEvent.preventDefault();
  contextMenuState.value = {
    point: { x: domEvent.clientX, y: domEvent.clientY },
    items: resolveGridMenuItems(rawItems, {
      api: event.api,
      column: event.column ?? null,
      node: event.node ?? null,
    }),
  };
}

function closeContextMenu() {
  contextMenuState.value = null;
}
```

In the `<template>`, add the `@cellContextMenu` listener to `<AgGridVue>`
(alongside the existing `@contextmenu="stopIfPrevented"`):

```html
@contextmenu="stopIfPrevented" @cellContextMenu="onCellContextMenu"
```

and mount the popup after `<VueComponentHost :host="vueHost" />`:

```html
<GridPopupMenu
  v-if="contextMenuState"
  :items="contextMenuState.items"
  :point="contextMenuState.point"
  @close="closeContextMenu"
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full shared/AgGridTableView + visualizations suites to
      check for regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView src/project-view/components/visualizations`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 7: Manual smoke check**

With no license key configured (`.env` has `ENSO_IDE_AG_GRID_LICENSE_KEY=`
empty), run the dev server, open a table visualization, right-click a cell:
confirm the custom popup appears with the expected items (Copy, Copy with
Headers, separator, Export to CSV, plus the "Get Column"/"Get Row"/"Get Value"
actions) at the click position, and dismisses on outside-click or Escape. Per
the coordination note above, Copy/Copy-with-Headers correctness depends on the
Selection + Clipboard plan's
`gridApi.copyToClipboard`/`cutToClipboard`/`pasteFromClipboard` monkey-patch: if
that plan hasn't landed yet, these items are expected to be inert (confirm they
at least don't throw); if it has, confirm copy/copy-with-headers actually
populate the clipboard correctly. Then repeat with a real license key configured
(`.env.development`) and confirm the native Enterprise menu still appears
exactly as before (this plan must not change that path).

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView.vue app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridTableView.contextMenu.test.ts
git commit -m "Fall back to GridPopupMenu for the cell context menu when unlicensed"
```

---

### Task 3: Column menu fallback trigger in `TableHeader.vue`

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/TableHeader.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts`

**Interfaces:**

- Consumes: `resolveGridMenuItems` from
  `@/components/shared/AgGridTableView/gridPopupMenuItems`, `GridPopupMenu` from
  `@/components/shared/AgGridTableView/GridPopupMenu.vue`,
  `AG_GRID_ENTERPRISE_AVAILABLE` from
  `@/components/shared/AgGridTableView/agGridLicense` (all from Task
  1/Foundation). Consumes `props.column.getColDef().mainMenuItems` (already
  defined per-column in `tableInputArgument.ts:329,343,419` — unchanged by this
  plan) and the existing
  `props.showColumnMenuAfterMouseClick`/`props.api`/`props.context` from
  `IHeaderParams`.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts
import { mount } from "@vue/test-utils";
import { expect, test, vi } from "vitest";
import TableHeader from "../TableHeader.vue";

function baseProps() {
  return {
    column: {
      getColId: () => "a",
      getColDef: () => ({ mainMenuItems: ["autoSizeThis"] }),
    },
    api: { autoSizeColumns: vi.fn() },
    context: undefined,
    displayName: "A",
    showColumnMenuAfterMouseClick: vi.fn(),
    columnParams: { type: "rowIndexColumn" as const },
    onHeaderEditingStarted: vi.fn(),
    onHeaderEditingStopped: vi.fn(),
  };
}

test("opens GridPopupMenu with the column mainMenuItems on right-click when unlicensed", async () => {
  const props = baseProps();
  const wrapper = mount(TableHeader, { props, attachTo: document.body });

  await wrapper
    .find(".ag-cell-label-container")
    .trigger("contextmenu", { clientX: 5, clientY: 6 });
  await wrapper.vm.$nextTick();

  expect(props.showColumnMenuAfterMouseClick).not.toHaveBeenCalled();
  expect(wrapper.findComponent({ name: "GridPopupMenu" }).exists()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts`
Expected: FAIL — today `onMouseRightClick` always calls
`showColumnMenuAfterMouseClick`, so the stub `GridPopupMenu` never mounts and
the mock IS called (assertion inverted from current behavior).

- [ ] **Step 3: Write minimal implementation**

In `TableHeader.vue`'s `<script setup lang="ts">` block, add:

```ts
import GridPopupMenu from "@/components/shared/AgGridTableView/GridPopupMenu.vue";
import { AG_GRID_ENTERPRISE_AVAILABLE } from "@/components/shared/AgGridTableView/agGridLicense";
import {
  resolveGridMenuItems,
  type GridMenuItem,
} from "@/components/shared/AgGridTableView/gridPopupMenuItems";
```

Replace `onMouseRightClick` with:

```ts
const columnMenuState = ref<{
  point: { x: number; y: number };
  items: GridMenuItem[];
} | null>(null);

function closeColumnMenu() {
  columnMenuState.value = null;
}

function onMouseRightClick(event: MouseEvent) {
  if (editing.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (AG_GRID_ENTERPRISE_AVAILABLE) {
    props.showColumnMenuAfterMouseClick(event);
    return;
  }
  const colDef = props.column.getColDef();
  const rawMainMenuItems = colDef.mainMenuItems;
  const rawItems =
    typeof rawMainMenuItems === "function"
      ? rawMainMenuItems({
          api: props.api,
          context: props.context,
          column: props.column,
          defaultItems: [],
        })
      : (rawMainMenuItems ?? []);
  if (!rawItems.length) return;
  columnMenuState.value = {
    point: { x: event.clientX, y: event.clientY },
    items: resolveGridMenuItems(rawItems, {
      api: props.api,
      column: props.column,
      node: null,
    }),
  };
}
```

(`ref` needs to be added to the existing
`import { computed, ref, watch } from 'vue'` — it's already imported at line 4,
so no change needed there.)

In the `<template>`, add after the closing `</div>` of the `v-else` branch
(still inside the component's root — Vue 3 allows multiple root nodes via
fragments):

```html
<GridPopupMenu
  v-if="columnMenuState"
  :items="columnMenuState.items"
  :point="columnMenuState.point"
  @close="closeColumnMenu"
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full WidgetTableEditor suite to check for regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTableEditor`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 7: Manual smoke check (the flagged open risk)**

With no license key configured, open a Table Input widget, right-click a column
header: confirm the custom popup appears with "Autosize This Column"/"Autosize
All Columns"/"Remove Column" and that autosize/remove actually work.
**Specifically check whether AG Grid renders its own native header menu
icon/button** (see "Open risk carried into Task 4" above) — click it if present
and confirm it doesn't throw or show a broken/empty native menu. If it does
misbehave, add `suppressHeaderMenuButton: true` to `defaultColDef` in
`tableInputArgument.ts` (and, separately, `TableVisualization.vue` if the same
issue reproduces there) gated on `!AG_GRID_ENTERPRISE_AVAILABLE`, as a follow-up
commit within this task. Then repeat with a real license key configured and
confirm the native Enterprise column menu still appears exactly as before.

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/TableHeader.vue app/gui/src/project-view/components/GraphEditor/widgets/WidgetTableEditor/__tests__/TableHeader.test.ts
git commit -m "Fall back to GridPopupMenu for the column menu when unlicensed"
```

---

## Self-Review Notes

- **Spec coverage:** Design spec section 6's context-menu bullet → Task 2;
  column-menu bullet → Task 3; the shared "small custom popup component...
  reused for both menus" → Task 1 (`GridPopupMenu.vue`, mounted from both
  `AgGridTableView.vue` and `TableHeader.vue`). The spec's claim that "the item
  lists are already framework-agnostic data" is only partially true in the real
  code — `'separator'`/`'autoSizeThis'`/`'autoSizeAll'`/`'export'` are
  AG-Grid-interpreted string sentinels, not framework-agnostic data, and Task
  1's `resolveGridMenuItems` exists specifically to bridge that gap. This is
  flagged explicitly rather than silently "discovered" mid-implementation.
- **Type consistency:** `GridMenuItem`/`GridMenuContext`/`resolveGridMenuItems`
  (Task 1) are imported with identical names/shapes in Task 2 and Task 3.
  `GridPopupMenu.vue`'s prop contract (`items: GridMenuItem[]`, `point: {x,y}`,
  emits `close`) is identical across both mount sites — verified by
  construction, since both tasks call it with the same prop shape built from
  `resolveGridMenuItems`'s return type.
- **No placeholders:** every step has full, copy-pasteable code or exact
  commands. The one intentionally-not-written line
  (`suppressHeaderMenuButton: true`) is explicitly called out as conditional on
  a manual-verification outcome, not left as a vague TODO — it's fully specified
  (which files, which flag, which value) in case it turns out to be needed.
- **Two explicit, load-bearing open items carried forward** (not silently
  resolved by guessing): the clipboard-actions cross-plan dependency (Task 2)
  and the native header-menu-icon uncertainty (Task 3). Both have concrete,
  specified fixes ready to apply once verified, rather than speculative code
  written against an unconfirmed assumption.
