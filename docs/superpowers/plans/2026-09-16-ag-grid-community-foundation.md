# AG Grid Community Fallback — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `AG_GRID_ENTERPRISE_AVAILABLE` license flag and make
`AgGridVue.ts`/`Utils.ts` load `ag-grid-community` instead of
`ag-grid-enterprise` at runtime when no license key is configured, so the
Enterprise runtime is never loaded unlicensed. This is the prerequisite for
every other AG Grid Community fallback plan — none of the feature-level
fallbacks (row model, filters, selection/clipboard, menus, status bar) can be
verified end-to-end without it, because today importing `ag-grid-enterprise` at
all self-registers Enterprise regardless of grid options.

**Architecture:** Extract the existing inline
`typeof $config.AG_GRID_LICENSE_KEY === 'string'` check (currently duplicated
implicitly wherever the code assumes Enterprise) into one exported constant.
`AgGridVue.ts` and `Utils.ts` stop doing static
`import {...} from 'ag-grid-enterprise'` for runtime values and instead resolve
a single dynamically-imported module object (`ag-grid-enterprise` or
`ag-grid-community`, chosen by the flag) once, at module top-level, via
top-level `await`. Every value that used to come from the static import
(`createGrid`, `ComponentUtil`, `_processOnChange`, `_warnOnce`,
`ALWAYS_SYNC_GLOBAL_EVENTS`, `_combineAttributesAndGridOptions`) is destructured
from that resolved module instead. `LicenseManager` (Enterprise-only;
`ag-grid-community` does not export it) is only ever accessed inside the
`AG_GRID_ENTERPRISE_AVAILABLE` branch. Top-level `await` is safe here because
`AgGridVue.ts` is already only ever consumed via a dynamic `import()` in
`AgGridTableView.vue:369`
(`const { AgGridVue } = await import('./AgGridTableView/AgGridVue')`), so making
its own module evaluation async doesn't change how or when it's loaded.

**Tech Stack:** Vue 3 (`defineComponent`), TypeScript, `ag-grid-community` /
`ag-grid-enterprise` (both already declared dependencies, pinned to `^32.3.3`,
in `app/gui/package.json`), Vitest + `@vue/test-utils`.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`
(sections "1. License flag" and "2. `AgGridVue.ts` runtime-import fix").

## Global Constraints

- Only "is `$config.AG_GRID_LICENSE_KEY` a string" is checked — never
  validity/expiry of the key. This must stay a single, simple `typeof` check
  (spec: "Explicit non-goals").
- When a valid key IS configured, behavior must be byte-for-byte unchanged from
  today (spec Goal). The Enterprise code path in `AgGridVue.ts`/`Utils.ts` must
  not be modified, only reached via a different (dynamic, not static) import.
- When no key is configured, `ag-grid-enterprise` must not be imported anywhere
  in the runtime path — no watermark, no unlicensed Enterprise execution (spec
  Goal).
- `ag-grid-community` and `ag-grid-enterprise` are already both dependencies
  (`app/gui/package.json:82-83`) — no dependency changes needed.
- `.env.testing` (loaded by `vitest.config.ts` via
  `loadEnv('testing', '../gui', 'ENSO_IDE_')`) does **not** set
  `ENSO_IDE_AG_GRID_LICENSE_KEY`, so `AG_GRID_ENTERPRISE_AVAILABLE` is
  deterministically `false` under `vitest`. `.env.staging`/`.env.development`
  (used by Playwright/dev) do set a real key. Unit tests in this plan rely on
  and assert this.
- `$config` is a true global (`declare global { const $config: $Config }` in
  `app/gui/env.d.ts`), not something files `import` — match the existing
  convention (`AgGridVue.ts` already references it unimported).

---

## File Structure

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts`
  — the one-line license flag.
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts`
- Modify: `app/gui/src/project-view/components/shared/AgGridTableView/Utils.ts`
  — `getAgGridProperties` takes the resolved AG Grid module instead of importing
  `ComponentUtil`/`_processOnChange` statically.
- Modify:
  `app/gui/src/project-view/components/shared/AgGridTableView/AgGridVue.ts` —
  dynamic import driven by the flag; everything else (component `data`,
  `methods`, `mounted`, `unmounted`) is unchanged.
- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts`

No other files in this plan. `AgGridTableView.vue`, `TableVisualization.vue`,
etc. consume `AG_GRID_ENTERPRISE_AVAILABLE` in later plans — this plan only
produces the flag and makes the wrapper component itself safe.

---

### Task 1: License flag module

**Files:**

- Create:
  `app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts`
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts`

**Interfaces:**

- Produces: `export const AG_GRID_ENTERPRISE_AVAILABLE: boolean` — consumed by
  Task 2 in this plan, and by every other AG Grid Community fallback plan (row
  model, filters, selection/clipboard, menus, status bar).

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts
import { $config } from "$/config";
import { describe, expect, test } from "vitest";
import { AG_GRID_ENTERPRISE_AVAILABLE } from "../agGridLicense";

describe("AG_GRID_ENTERPRISE_AVAILABLE", () => {
  test("is false when no AG Grid license key is configured (the default under vitest — see .env.testing)", () => {
    expect($config.AG_GRID_LICENSE_KEY).toBeUndefined();
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(false);
  });

  test("mirrors a direct typeof check against $config.AG_GRID_LICENSE_KEY", () => {
    expect(AG_GRID_ENTERPRISE_AVAILABLE).toBe(
      typeof $config.AG_GRID_LICENSE_KEY === "string",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts`
Expected: FAIL — `Cannot find module '../agGridLicense'` (or similar resolution
error).

- [ ] **Step 3: Write minimal implementation**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts
/**
 * Whether a real AG Grid Enterprise license key is configured. When `false`, no code in this
 * codebase may import `ag-grid-enterprise` at runtime — merely importing that package
 * self-registers Enterprise and triggers its watermark/unlicensed execution regardless of grid
 * options. Only "is a key configured at all" is checked; an invalid/expired key is out of scope
 * (see docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md).
 */
export const AG_GRID_ENTERPRISE_AVAILABLE =
  typeof $config.AG_GRID_LICENSE_KEY === "string";
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/agGridLicense.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/agGridLicense.test.ts
git commit -m "Add AG_GRID_ENTERPRISE_AVAILABLE license flag"
```

---

### Task 2: Dynamic Enterprise/Community loading in `AgGridVue.ts` and `Utils.ts`

**Files:**

- Modify: `app/gui/src/project-view/components/shared/AgGridTableView/Utils.ts`
  (whole file — see below)
- Modify:
  `app/gui/src/project-view/components/shared/AgGridTableView/AgGridVue.ts`
  (whole file — see below)
- Test:
  `app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts`

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from `./agGridLicense` (Task 1).
- Produces:
  `getAgGridProperties(agGrid: AgGridModule): [Properties, Properties, Properties]`
  (changed signature — used only by `AgGridVue.ts`, no other consumers exist
  today). `AgGridVue` component export is unchanged in shape/behavior for
  callers (`AgGridTableView.vue`) — only its internal loading mechanism changes.

**A note on the DEV-mode watermark-suppression hack:** the spec says the
license-setting call and "the existing DEV-mode watermark suppression hack stay
inside the enterprise branch only." Implementing that literally is not possible:
the hack patches `LicenseManager.prototype.validateLicense`, and
`LicenseManager` does not exist on `ag-grid-community` at all (verified:
`require('ag-grid-community').LicenseManager` is `undefined`). The hack's
original trigger condition was "no key configured" — under this design, "no key
configured" now means we import `ag-grid-community`, which never shows a
watermark or logs a validation error in the first place, so there is nothing
left to suppress. The hack is therefore dropped entirely rather than moved; a
plain `console.warn` (matching today's) is kept for the no-key case for parity
with current logs. This is a deliberate, documented deviation from the literal
spec text — flag it in review.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts
import { describe, expect, test, vi } from "vitest";

const { communityImported, enterpriseImported } = vi.hoisted(() => ({
  communityImported: vi.fn(),
  enterpriseImported: vi.fn(),
}));

vi.mock("ag-grid-community", async (importOriginal) => {
  communityImported();
  return importOriginal();
});
vi.mock("ag-grid-enterprise", async (importOriginal) => {
  enterpriseImported();
  return importOriginal();
});

describe("AgGridVue module loading (no AG Grid Enterprise license configured)", () => {
  test("resolves its AG Grid dependency from ag-grid-community, never importing ag-grid-enterprise", async () => {
    const { AgGridVue } = await import("../AgGridVue");

    expect(communityImported).toHaveBeenCalled();
    expect(enterpriseImported).not.toHaveBeenCalled();
    // Sanity check that Utils.ts's getAgGridProperties() still ran and populated props.
    expect(AgGridVue.props).toHaveProperty("rowData");
    expect(AgGridVue.props).toHaveProperty("columnDefs");
  });
});
```

(This test intentionally does not mount the component / call `createGrid` — that
requires a real layout engine AG Grid doesn't get from jsdom, and isn't this
task's concern. Full behavioral verification of a mounted grid happens via the
Playwright suites referenced in the design spec's Testing section, in a later
plan.)

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts`
Expected: FAIL — `enterpriseImported` was called (today's `AgGridVue.ts`
statically imports `ag-grid-enterprise` unconditionally).

- [ ] **Step 3: Write minimal implementation**

Replace the whole contents of `Utils.ts`:

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/Utils.ts
/**
 * @file Copy of https://github.com/ag-grid/ag-grid/blob/v32.3.3/packages/ag-grid-vue3/src/Utils.ts
 * Used by our version of AgGridVue.ts.
 *
 * Original file licenced under The MIT License:
 *
 * Copyright (c) 2015-2024 AG GRID LTD
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { markRaw, toRaw } from "vue";

export const kebabProperty = (property: string) => {
  return property.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
};

export const kebabNameToAttrEventName = (kebabName: string) => {
  // grid-ready for example would become onGrid-ready in Vue
  return `on${kebabName.charAt(0).toUpperCase()}${kebabName.substring(1, kebabName.length)}`;
};

export const convertToRaw = (value: any) =>
  value ? (Object.isFrozen(value) ? value : markRaw(toRaw(value))) : value;

export interface Properties {
  [propertyName: string]: any;
}

/**
 * The subset of the `ag-grid-community` / `ag-grid-enterprise` module surface this file needs.
 * Identical between both packages (both re-export from `@ag-grid-community/core`) except
 * `LicenseManager`, which is Enterprise-only and resolved separately by callers.
 */
export interface AgGridModule {
  ComponentUtil: (typeof import("ag-grid-community"))["ComponentUtil"];
  _processOnChange: (typeof import("ag-grid-community"))["_processOnChange"];
}

export const getAgGridProperties = (
  agGrid: AgGridModule,
): [Properties, Properties, Properties] => {
  const { ComponentUtil, _processOnChange } = agGrid;
  const props: Properties = {};

  // for example, 'grid-ready' would become 'onGrid-ready': undefined
  // without this emitting events results in a warning
  // and adding 'grid-ready' (and variations of this to the emits option in AgGridVue doesn't help either)
  const eventNameAsProps = ComponentUtil.PUBLIC_EVENTS.map(
    (eventName: string) => kebabNameToAttrEventName(kebabProperty(eventName)),
  );
  eventNameAsProps.forEach(
    (eventName: string) => (props[eventName] = undefined),
  );

  const computed: Properties = {};

  const watch: Properties = {
    modelValue: {
      handler(currentValue: any, previousValue: any) {
        if (!this.gridCreated || !this.api) {
          return;
        }

        /*
         * Prevents an infinite loop when using v-model for the rowData
         */
        if (currentValue === previousValue) {
          return;
        }
        if (currentValue && previousValue) {
          if (currentValue.length === previousValue.length) {
            if (
              currentValue.every(
                (item: any, index: number) => item === previousValue[index],
              )
            ) {
              return;
            }
          }
        }

        _processOnChange({ rowData: currentValue }, this.api);
      },
      deep: true,
    },
  };

  ComponentUtil.ALL_PROPERTIES.filter(
    (propertyName: string) => propertyName != "gridOptions",
  ) // dealt with in AgGridVue itself
    .forEach((propertyName: string) => {
      props[propertyName] = {
        default: ComponentUtil.VUE_OMITTED_PROPERTY,
      };

      watch[propertyName] = {
        handler(currentValue: any, _previousValue: any) {
          let currValue = currentValue;

          if (
            propertyName === "rowData" &&
            currentValue != ComponentUtil.VUE_OMITTED_PROPERTY
          ) {
            // Prevent the grids internal edits from being reactive
            currValue = convertToRaw(currentValue);
          }

          this.batchChanges[propertyName] =
            currValue === ComponentUtil.VUE_OMITTED_PROPERTY
              ? undefined
              : currValue;
          if (this.batchTimeout == null) {
            this.batchTimeout = setTimeout(() => {
              // Clear the timeout before processing the changes in case processChanges triggers another change.
              this.batchTimeout = null;
              _processOnChange(this.batchChanges, this.api);
              this.batchChanges = markRaw({});
            }, 0);
          }
        },
        deep: true,
      };
    });

  return [props, computed, watch];
};
```

Replace the whole contents of `AgGridVue.ts`:

```ts
// app/gui/src/project-view/components/shared/AgGridTableView/AgGridVue.ts
/**
 * @file Copy of https://github.com/ag-grid/ag-grid/blob/v32.3.3/packages/ag-grid-vue3/src/AgGridVue.ts
 * with our modifications:
 * - special overrides for Vue components removed; we handle them in a better way,
 * - added license key registration,
 * - loads `ag-grid-enterprise` only when a license key is configured (AG_GRID_ENTERPRISE_AVAILABLE);
 *   otherwise loads `ag-grid-community`, so Enterprise code never runs unlicensed.
 *
 * Original file licenced under The MIT License:
 *
 * Copyright (c) 2015-2024 AG GRID LTD
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// This is not our code, so I just blocked failing lints.
/* eslint-disable vue/require-default-prop */
/* eslint-disable vue/require-prop-types */
/* eslint-disable vue/order-in-components */

import { AG_GRID_LOCALE_EN } from "@ag-grid-community/locale";
import type {
  AgEventType,
  GridApi,
  GridOptions,
  IRowNode,
  Module,
} from "ag-grid-enterprise";
import {
  defineComponent,
  getCurrentInstance,
  h,
  markRaw,
  toRaw,
  type PropType,
} from "vue";
import { AG_GRID_ENTERPRISE_AVAILABLE } from "./agGridLicense";
import { convertToRaw, getAgGridProperties, type Properties } from "./Utils";

// === Loading AGGrid and its license ===

const agGrid = AG_GRID_ENTERPRISE_AVAILABLE
  ? await import("ag-grid-enterprise")
  : await import("ag-grid-community");

const {
  _combineAttributesAndGridOptions,
  _processOnChange,
  _warnOnce,
  ALWAYS_SYNC_GLOBAL_EVENTS,
  ComponentUtil,
  createGrid,
} = agGrid;

if (AG_GRID_ENTERPRISE_AVAILABLE) {
  (agGrid as typeof import("ag-grid-enterprise")).LicenseManager.setLicenseKey(
    $config.AG_GRID_LICENSE_KEY as string,
  );
} else {
  console.warn(
    "The AG_GRID_LICENSE_KEY is not defined; using AG Grid Community.",
  );
}

const ROW_DATA_EVENTS: Set<string> = new Set([
  "rowDataUpdated",
  "cellValueChanged",
  "rowValueChanged",
]);
const DATA_MODEL_ATTR_NAME = "onUpdate:modelValue"; // emit name would be update:ModelValue
const DATA_MODEL_EMIT_NAME = "update:modelValue";

const [props, computed, watch] = getAgGridProperties(agGrid);

const customLocale = {
  ...AG_GRID_LOCALE_EN,
  // Add any customizations to the locale here
  loadingError: "Error fetching data - close and reopen visualization to retry",
};

export const AgGridVue = defineComponent({
  render() {
    return h("div");
  },
  props: {
    gridOptions: {
      type: Object as PropType<GridOptions>,
      default: () => ({}) as GridOptions,
    },
    componentDependencies: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    plugins: [],
    modules: {
      type: Array as PropType<Module[]>,
      default: () => [],
    },
    modelValue: {
      type: Array,
      default: undefined,
      required: false,
    },
    ...props,
  },
  data(): {
    api: GridApi | undefined;
    gridCreated: boolean;
    isDestroyed: boolean;
    gridReadyFired: boolean;
    emitRowModel?: (() => void | null) | undefined;
    batchTimeout: number | null;
    batchChanges: { [key: string]: any };
  } {
    return {
      api: undefined,
      gridCreated: false,
      isDestroyed: false,
      gridReadyFired: false,
      emitRowModel: undefined,
      batchTimeout: null,
      batchChanges: markRaw({}),
    };
  },
  computed,
  watch,
  methods: {
    globalEventListenerFactory(restrictToSyncOnly?: boolean) {
      return (eventType: AgEventType) => {
        if (this.isDestroyed) {
          return;
        }

        if (eventType === "gridReady") {
          this.gridReadyFired = true;
        }

        const alwaysSync = ALWAYS_SYNC_GLOBAL_EVENTS.has(eventType);
        if (
          (alwaysSync && !restrictToSyncOnly) ||
          (!alwaysSync && restrictToSyncOnly)
        ) {
          return;
        }

        this.updateModelIfUsed(eventType);
      };
    },
    processChanges(
      propertyName: string,
      currentValue: any,
      previousValue: any,
    ) {
      if (this.gridCreated) {
        if (this.skipChange(propertyName, currentValue, previousValue)) {
          return;
        }

        const options: Properties = {
          [propertyName]:
            propertyName === "rowData"
              ? Object.isFrozen(currentValue)
                ? currentValue
                : markRaw(toRaw(currentValue))
              : currentValue,
        };
        // decouple the row data - if we don't when the grid changes row data directly that'll trigger this component to react to rowData changes,
        // which can reset grid state (ie row selection)
        _processOnChange(options, this.api as any);
      }
    },
    checkForBindingConflicts() {
      const thisAsAny = this as any;
      if (
        ((thisAsAny.rowData &&
          thisAsAny.rowData !== "AG-VUE-OMITTED-PROPERTY") ||
          this.gridOptions.rowData) &&
        thisAsAny.modelValue
      ) {
        _warnOnce("Using both rowData and v-model. rowData will be ignored.");
      }
    },
    getRowData(): any[] {
      const rowData: any[] = [];
      this.api?.forEachNode((rowNode: IRowNode) => {
        rowData.push(rowNode.data);
      });
      return rowData;
    },
    updateModelIfUsed(eventType: string) {
      if (
        this.gridReadyFired &&
        this.$attrs[DATA_MODEL_ATTR_NAME] &&
        ROW_DATA_EVENTS.has(eventType)
      ) {
        if (this.emitRowModel) {
          this.emitRowModel();
        }
      }
    },
    getRowDataBasedOnBindings() {
      const thisAsAny = this as any;

      const rowData = thisAsAny.modelValue;
      return rowData
        ? rowData
        : thisAsAny.rowData
          ? thisAsAny.rowData
          : thisAsAny.gridOptions.rowData;
    },
    getProvides() {
      let instance = getCurrentInstance() as any;
      let provides = {};

      while (instance) {
        if (instance && instance.provides) {
          provides = { ...provides, ...instance.provides };
        }

        instance = instance.parent;
      }

      return provides;
    },
    /*
     * Prevents an infinite loop when using v-model for the rowData
     */
    skipChange(propertyName: string, currentValue: any, previousValue: any) {
      if (
        this.gridReadyFired &&
        propertyName === "rowData" &&
        this.$attrs[DATA_MODEL_ATTR_NAME]
      ) {
        if (currentValue === previousValue) {
          return true;
        }

        if (currentValue && previousValue) {
          const currentRowData = currentValue as any[];
          const previousRowData = previousValue as any[];
          if (currentRowData.length === previousRowData.length) {
            for (let i = 0; i < currentRowData.length; i++) {
              if (currentRowData[i] !== previousRowData[i]) {
                return false;
              }
            }
            return true;
          }
        }
      }

      return false;
    },
    debounce(func: () => void, delay: number) {
      let timeout: number;
      return () => {
        const later = function () {
          func();
        };
        window.clearTimeout(timeout);
        timeout = window.setTimeout(later, delay);
      };
    },
  },
  mounted() {
    // we debounce the model update to prevent a flood of updates in the event there are many individual
    // cell/row updates
    this.emitRowModel = this.debounce(() => {
      this.$emit(DATA_MODEL_EMIT_NAME, Object.freeze(this.getRowData()));
    }, 20);

    // the gridOptions we pass to the grid don't need to be reactive (and shouldn't be - it'll cause issues
    // with mergeDeep for example
    const gridOptions = markRaw(
      _combineAttributesAndGridOptions(toRaw(this.gridOptions), this),
    );

    this.checkForBindingConflicts();

    const rowData = this.getRowDataBasedOnBindings();
    if (rowData !== ComponentUtil.VUE_OMITTED_PROPERTY) {
      gridOptions.rowData = convertToRaw(rowData);
    }

    const gridParams = {
      globalEventListener: this.globalEventListenerFactory().bind(this),
      globalSyncEventListener: this.globalEventListenerFactory(true).bind(this),
      modules: this.modules,
    };

    // Set the localeText to improve ERR
    gridOptions.localeText = customLocale;

    this.api = createGrid(this.$el as HTMLElement, gridOptions, gridParams);
    this.gridCreated = true;
  },
  unmounted() {
    if (this.gridCreated) {
      this.api?.destroy();
      this.isDestroyed = true;
    }
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full existing AG Grid / WidgetTableEditor unit test
      suites to check for regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetTableEditor src/project-view/components/shared/AgGridTableView src/project-view/components/visualizations`
Expected: PASS — no existing test imports `AgGridVue.ts`/`Utils.ts` directly
today (confirmed by search before writing this plan), so this mainly guards
against an accidental typo breaking a sibling import.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS. The
`agGrid` dynamic-import result is typed as a union of
`typeof import('ag-grid-enterprise')` and `typeof import('ag-grid-community')`;
if destructuring or the `getAgGridProperties(agGrid)` call site reports a type
error because of that union, narrow it with an explicit intersection/cast at the
destructuring site (e.g.
`const agGrid = (await (...)) as typeof import('ag-grid-community')` — safe
because the two packages export identical shapes for every symbol used here
except `LicenseManager`, which is handled separately) rather than changing the
runtime logic.

- [ ] **Step 7: Manual smoke check (licensed path still works)**

Run the dev server (`corepack pnpm --filter enso-gui run dev:vite`, which loads
`.dev-env/.env.development` and therefore a real license key) and open a project
with a table visualization. Confirm: no new console errors, no AG Grid
watermark, table renders and sorts/filters as before. This is the one behavior
this plan must not regress and that automated tests in this task deliberately
don't cover (mounting a real grid in jsdom is out of scope — see Task 2 Step 1
note).

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/shared/AgGridTableView/Utils.ts app/gui/src/project-view/components/shared/AgGridTableView/AgGridVue.ts app/gui/src/project-view/components/shared/AgGridTableView/__tests__/AgGridVue.test.ts
git commit -m "Load AG Grid Community instead of Enterprise when unlicensed"
```

---

## Self-Review Notes

- **Spec coverage:** Section 1 (license flag) → Task 1. Section 2
  (`AgGridVue.ts` runtime-import fix, including the note that other files'
  `ag-grid-enterprise` imports are type-only and don't need to change) → Task 2.
  The DEV-hack deviation is called out explicitly in Task 2 rather than silently
  dropped.
- **Type consistency:** `AG_GRID_ENTERPRISE_AVAILABLE` (Task 1) is imported and
  used with the same name/type (`boolean`) in Task 2. `getAgGridProperties`'s
  new signature
  (`(agGrid: AgGridModule) => [Properties, Properties, Properties]`) is defined
  and called with matching arity in the same task — no other file in the repo
  calls it today (verified by search).
- **No placeholders:** every step has full, copy-pasteable file contents or
  exact commands.
