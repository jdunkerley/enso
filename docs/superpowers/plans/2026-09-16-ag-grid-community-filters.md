# AG Grid Community Fallback — Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When no AG Grid Enterprise license is configured, replace the
Enterprise-only Set Filter (`agSetColumnFilter`) and Multi Filter
(`agMultiColumnFilter`) with a single custom Community `IFilterComp` — a search
box that narrows a checkbox list of distinct column values — so filtering keeps
working exactly as it does today, without loading any Enterprise filter code.

**Architecture:** A new plain (non-Vue) class, `CommunitySetFilter`, implements
AG Grid's `IFilterComp` directly — no Vue wrapping needed, matching the existing
precedent of `TableVisualisationTooltip.ts` (a plain class implementing
`ITooltipComp`, referenced directly by class reference in a `colDef`, not
through the Vue-component `mappedComponents` registry in `AgGridTableView.vue`).
It reuses the existing `getFilterValues` callback (`TableVisualization.vue`) to
source the checkbox list, exactly as the real Set Filter does today via its
`values` filter param. Its `getModel()`/`setModel()` produce/consume the same
`{ filterType: 'set', values: string[] }` shape AG Grid's own Set Filter model
uses, so `tableVizFilterUtils.ts`'s existing
`makeFilterModelList`/`convertFilterModel`/`getFilterValue` parsing (which
already special-cases `filterType === 'set'`, see
`tableVizFilterUtils.ts:140-141`) needs no changes at all.
`tableVizFilterSetUpUtils.ts`'s `getFilterType`/`getFilterParams` branch on
`AG_GRID_ENTERPRISE_AVAILABLE`: licensed keeps returning the
`'agSetColumnFilter'`/`'agMultiColumnFilter'` strings unchanged; unlicensed
returns the `CommunitySetFilter` class reference instead of a string (AG Grid's
`IFilterType` is `string | { new(): IFilterComp } | boolean` — a direct class
reference is valid, confirmed against `@ag-grid-community/core`'s
`iFilter.d.ts`).

**Scope simplification (already decided by the design spec, not revisited
here):** the Enterprise Multi Filter's two independently-tabbed sub-filters (a
Text "contains" tab and a Set "pick from list" tab) collapse into one component.
This plan interprets "always shows both the search box and the value checklist"
as: the search box narrows _which checkboxes are currently shown_ (the same
live-narrowing behavior the real Set Filter's own built-in mini-filter search
box already has) — it is not a second, independent filter condition. This keeps
the component's model a single `{ filterType: 'set', values: string[] }`,
matching the real Set Filter's model 1:1 and requiring zero changes to
filter-model parsing.

**Correction (post-implementation whole-branch review):** the paragraph
originally justified this by claiming the alternative reading (search box = a
separate always-on text-contains condition, ANDed with the checklist selection)
"would require inventing a new composite model shape that
`tableVizFilterUtils.ts` cannot parse without changes." That claim is false —
`tableVizFilterUtils.ts`'s `makeFilterModelList` already parses the Enterprise
Multi Filter's own composite `{ filterType: 'multi', filterModels: [...] }`
shape today, so the parser was never the blocking constraint. The interpretation
above is still correct, but for a different, real reason: the backend only ever
requests the multi-filter (`is_using_multi_filter`) for columns with ≤100
distinct values (`DataQualityMetrics.java`'s `DISTINCT_THRESHOLD`), where a
search-narrowed checklist is behaviorally equivalent to a contains-search —
high-cardinality Char columns already get the Community-native
`agTextColumnFilter` and are untouched by this change.

**Task order note:** the design spec's own build order suggests
filter-type/params selection before the component. This plan builds the
component first (Task 1) and wires it into `tableVizFilterSetUpUtils.ts` second
(Task 2), because the wiring task's code (`getFilterType`/`getFilterParams`)
directly references the `CommunitySetFilter` class — building it in the other
order would leave Task 1 referencing a module that doesn't exist yet, which
can't compile or pass tests on its own (violates "each task ends with an
independently testable deliverable").

**Tech Stack:** TypeScript, `ag-grid-community` (`@ag-grid-community/core`
types, already a dependency), Vitest.

**Spec:**
`docs/superpowers/specs/2026-09-15-ag-grid-community-fallback-design.md`
(section "4. Filters: Set / Multi Filter → custom filter component").

## Global Constraints

- Only "is `$config.AG_GRID_LICENSE_KEY` a string" is checked
  (`AG_GRID_ENTERPRISE_AVAILABLE`, from
  `docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md`) — this
  plan consumes that flag, does not redefine it.
- Licensed behavior must be byte-for-byte unchanged:
  `getFilterType`/`getFilterParams` must keep returning exactly
  `'agSetColumnFilter'` / `'agMultiColumnFilter'` (as strings, unchanged params
  shape) whenever `AG_GRID_ENTERPRISE_AVAILABLE` is `true`.
- The existing `getFilterValues` callback in `TableVisualization.vue`
  (`TableVisualization.vue:416-442`) is reused unchanged — this plan does not
  modify `TableVisualization.vue`, `TableVizDataSourceUtils.ts`, or
  `tableVizFilterUtils.ts`.
- `.env.testing` (used by `vitest`) does not set `ENSO_IDE_AG_GRID_LICENSE_KEY`;
  `.env.staging`/`.env.development` (Playwright/dev) do. Rather than depend on
  that indirectly, tests in this plan mock `AG_GRID_ENTERPRISE_AVAILABLE`
  directly via
  `vi.mock('@/components/shared/AgGridTableView/agGridLicense', ...)` so both
  the licensed and unlicensed branches are exercised deterministically
  regardless of environment.
- Path aliases: `@/` → `app/gui/src/project-view/`, `$/` → `app/gui/src/`.

---

## File Structure

- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/CommunitySetFilter.ts`
  — the custom `IFilterComp`.
- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableVizFilterSetUpUtils.ts`
  — `getFilterType`/`getFilterParams` branch on `AG_GRID_ENTERPRISE_AVAILABLE`.
- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts`

No changes to `TableVisualization.vue`, `TableVizDataSourceUtils.ts`, or
`tableVizFilterUtils.ts` — see Architecture above for why none are needed.

---

### Task 1: `CommunitySetFilter` — the custom `IFilterComp`

**Files:**

- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/CommunitySetFilter.ts`
- Test:
  `app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts`

**Interfaces:**

- Produces: `export class CommunitySetFilter implements IFilterComp` and
  `export interface CommunitySetFilterParams extends IFilterParams { values: (params: SetFilterValuesFuncParams) => void }`
  — consumed by Task 2 (`tableVizFilterSetUpUtils.ts`, as a direct class
  reference in `colDef.filter` / a comparison target, and as the `filterParams`
  shape `getFilterParams` already builds via its existing
  `values: isSSRM ? getFilterValues : null` field).

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts
import type { IDoesFilterPassParams } from "@ag-grid-community/core";
import { describe, expect, test, vi } from "vitest";
import {
  CommunitySetFilter,
  type CommunitySetFilterParams,
} from "../CommunitySetFilter";

function makeFilter(values: string[]) {
  const filterChangedCallback = vi.fn();
  const filter = new CommunitySetFilter();
  const dataByValue = new Map(values.map((value) => [value, { col: value }]));
  filter.init({
    colDef: { field: "col" },
    column: {},
    api: {},
    context: undefined,
    getValue: (node: { data: { col: string } }) => node.data.col,
    filterChangedCallback,
    filterModifiedCallback: vi.fn(),
    doesRowPassOtherFilter: () => true,
    rowModel: {},
    values: (params: { success: (values: string[]) => void }) =>
      params.success(values),
  } as unknown as CommunitySetFilterParams);
  return { filter, filterChangedCallback, dataByValue };
}

describe("CommunitySetFilter", () => {
  test("starts with every value selected and the filter inactive", () => {
    const { filter } = makeFilter(["a", "b", "c"]);
    expect(filter.isFilterActive()).toBe(false);
    expect(filter.getModel()).toBeNull();
  });

  test("unchecking a value narrows the model, marks the filter active, and notifies the grid", () => {
    const { filter, filterChangedCallback } = makeFilter(["a", "b", "c"]);
    const checkboxes = filter
      .getGui()
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    checkboxes[0]!.checked = false;
    checkboxes[0]!.dispatchEvent(new Event("change"));

    expect(filter.isFilterActive()).toBe(true);
    expect(filter.getModel()).toEqual({
      filterType: "set",
      values: ["b", "c"],
    });
    expect(filterChangedCallback).toHaveBeenCalledTimes(1);
  });

  test("setModel round-trips a selection and re-renders the checkboxes", () => {
    const { filter } = makeFilter(["a", "b", "c"]);
    filter.setModel({ filterType: "set", values: ["b"] });

    expect(filter.getModel()).toEqual({ filterType: "set", values: ["b"] });
    const checked = Array.from(
      filter
        .getGui()
        .querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ).length;
    expect(checked).toBe(1);
  });

  test("setModel(null) re-activates every value (de-activates the filter)", () => {
    const { filter } = makeFilter(["a", "b", "c"]);
    filter.setModel({ filterType: "set", values: ["b"] });
    filter.setModel(null);

    expect(filter.isFilterActive()).toBe(false);
    expect(filter.getModel()).toBeNull();
  });

  test("the search box narrows which checkboxes are rendered without changing the selection", () => {
    const { filter } = makeFilter(["apple", "banana", "cherry"]);
    const search = filter
      .getGui()
      .querySelector<HTMLInputElement>(".community-set-filter-search")!;
    search.value = "an";
    search.dispatchEvent(new Event("input"));

    const labels = Array.from(
      filter.getGui().querySelectorAll(".community-set-filter-option"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["banana"]);
    // Narrowing the visible list must not itself change which values are selected.
    expect(filter.isFilterActive()).toBe(false);
  });

  test("doesFilterPass compares the cell value against the current selection", () => {
    const { filter } = makeFilter(["a", "b", "c"]);
    filter.setModel({ filterType: "set", values: ["b"] });

    const passParams = (value: string) =>
      ({ node: { data: { col: value } } }) as unknown as IDoesFilterPassParams;

    expect(filter.doesFilterPass(passParams("b"))).toBe(true);
    expect(filter.doesFilterPass(passParams("a"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts`
Expected: FAIL — `Cannot find module '../CommunitySetFilter'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/gui/src/project-view/components/visualizations/TableVisualization/CommunitySetFilter.ts
import type {
  IDoesFilterPassParams,
  IFilterComp,
  IFilterParams,
  SetFilterValuesFuncParams,
} from "@ag-grid-community/core";

/** `filterParams` shape this filter expects, in addition to the standard `IFilterParams`. */
export interface CommunitySetFilterParams extends IFilterParams {
  /** Same shape as `ISetFilterParams.values` when given a function: sources the distinct values
   * to show in the checkbox list. Reused unchanged from the existing Set Filter wiring — see
   * `getFilterValues` in `TableVisualization.vue`. */
  values: (params: SetFilterValuesFuncParams) => void;
}

interface CommunitySetFilterModel {
  filterType: "set";
  values: string[];
}

/**
 * Community-only replacement for AG Grid Enterprise's Set Filter / Multi Filter, used when no AG
 * Grid Enterprise license is configured (see `AG_GRID_ENTERPRISE_AVAILABLE` in
 * `components/shared/AgGridTableView/agGridLicense.ts`). Shows a search box that narrows a
 * checkbox list of distinct column values — the search box only narrows which checkboxes are
 * shown, it is not a separate filter condition — and produces the same
 * `{ filterType: 'set', values: string[] }` model AG Grid's own Set Filter produces, so existing
 * filter-model parsing (`tableVizFilterUtils.ts`) needs no changes.
 */
export class CommunitySetFilter implements IFilterComp {
  private params!: CommunitySetFilterParams;
  private eGui!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLElement;
  private allValues: string[] = [];
  private selected = new Set<string>();

  init(params: CommunitySetFilterParams) {
    this.params = params;
    this.eGui = document.createElement("div");
    Object.assign(this.eGui.style, { padding: "8px", minWidth: "200px" });

    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Search values...";
    this.searchInput.className = "community-set-filter-search";
    Object.assign(this.searchInput.style, {
      width: "100%",
      marginBottom: "6px",
    });
    this.searchInput.addEventListener("input", () => this.renderList());

    this.listEl = document.createElement("div");
    this.listEl.className = "community-set-filter-list";
    Object.assign(this.listEl.style, { maxHeight: "200px", overflowY: "auto" });

    this.eGui.append(this.searchInput, this.listEl);

    this.params.values({
      colDef: this.params.colDef,
      column: this.params.column,
      api: this.params.api,
      context: this.params.context,
      success: (values: (string | null)[]) => {
        this.allValues = values.filter(
          (value): value is string => value != null,
        );
        this.selected = new Set(this.allValues);
        this.renderList();
      },
    } as SetFilterValuesFuncParams);
  }

  private renderList() {
    const search = this.searchInput.value.trim().toLowerCase();
    const visibleValues = search
      ? this.allValues.filter((value) => value.toLowerCase().includes(search))
      : this.allValues;

    this.listEl.replaceChildren(
      ...visibleValues.map((value) => {
        const label = document.createElement("label");
        label.className = "community-set-filter-option";
        Object.assign(label.style, { display: "block" });

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = this.selected.has(value);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) this.selected.add(value);
          else this.selected.delete(value);
          this.params.filterChangedCallback();
        });

        label.append(checkbox, document.createTextNode(` ${value}`));
        return label;
      }),
    );
  }

  getGui() {
    return this.eGui;
  }

  doesFilterPass(params: IDoesFilterPassParams) {
    // Filtering itself is always performed server-side (Infinite Row Model) in this application —
    // this only matters if the filter is ever paired with a client-side row model, so it mirrors
    // the real Set Filter's own semantics for parity rather than being unreachable dead code.
    const value = this.params.getValue(params.node);
    return this.selected.has(String(value));
  }

  isFilterActive() {
    return this.selected.size !== this.allValues.length;
  }

  getModel(): CommunitySetFilterModel | null {
    if (!this.isFilterActive()) return null;
    return { filterType: "set", values: Array.from(this.selected) };
  }

  setModel(model: CommunitySetFilterModel | null) {
    this.selected = model ? new Set(model.values) : new Set(this.allValues);
    this.renderList();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/gui/src/project-view/components/visualizations/TableVisualization/CommunitySetFilter.ts app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/CommunitySetFilter.test.ts
git commit -m "Add CommunitySetFilter, a Community replacement for the AG Grid Set/Multi Filter"
```

---

### Task 2: Wire `AG_GRID_ENTERPRISE_AVAILABLE` into `tableVizFilterSetUpUtils.ts`

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableVizFilterSetUpUtils.ts`
- Test:
  `app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts`

**Interfaces:**

- Consumes: `AG_GRID_ENTERPRISE_AVAILABLE` from
  `@/components/shared/AgGridTableView/agGridLicense` (from
  `docs/superpowers/plans/2026-09-16-ag-grid-community-foundation.md`);
  `CommunitySetFilter` from `./CommunitySetFilter` (Task 1).
- Produces:
  `getFilterType(valueType: string, usingMultiFilter: boolean): string | typeof CommunitySetFilter | null`
  (return type widened — was `string | null`) and `getFilterParams(...)`
  unchanged in signature (its `filterType` parameter's type widens the same
  way). Both are called only from `TableVisualization.vue`'s `toField()`
  (`TableVisualization.vue:659,661`), which assigns the result straight to
  `colDef.filter`/`colDef.filterParams` — both fields accept a class reference
  already (`IFilterType = string | { new(): IFilterComp } | boolean`), so no
  caller changes are needed.

- [ ] **Step 1: Write the failing test**

```ts
// app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts
import { describe, expect, test, vi } from "vitest";

const { AG_GRID_ENTERPRISE_AVAILABLE } = vi.hoisted(() => ({
  AG_GRID_ENTERPRISE_AVAILABLE: false,
}));
vi.mock("@/components/shared/AgGridTableView/agGridLicense", () => ({
  AG_GRID_ENTERPRISE_AVAILABLE,
}));

const { CommunitySetFilter } = await import("../CommunitySetFilter");
const { getFilterParams, getFilterType } =
  await import("../tableVizFilterSetUpUtils");

describe("getFilterType (no AG Grid Enterprise license configured)", () => {
  test("a Char column using the multi-filter gets CommunitySetFilter instead of agMultiColumnFilter", () => {
    expect(getFilterType("Char", true)).toBe(CommunitySetFilter);
  });

  test("a Char column not using the multi-filter is unaffected (agTextColumnFilter is Community-native)", () => {
    expect(getFilterType("Char", false)).toBe("agTextColumnFilter");
  });

  test("any other set-filter column gets CommunitySetFilter instead of agSetColumnFilter", () => {
    expect(getFilterType("Boolean", false)).toBe(CommunitySetFilter);
  });

  test("numeric and date columns are unaffected (their filters are Community-native)", () => {
    expect(getFilterType("Integer", false)).toBe("agNumberColumnFilter");
    expect(getFilterType("Date", false)).toBe("agDateColumnFilter");
  });
});

describe("getFilterParams with CommunitySetFilter", () => {
  test("returns the plain (non-multi) filter params shape, reusing the values callback unchanged", () => {
    const getFilterValues = vi.fn();
    const params = getFilterParams(
      true,
      null,
      CommunitySetFilter,
      getFilterValues,
    );
    expect(params).toEqual({
      maxNumConditions: 1,
      values: getFilterValues,
      filterOptions: null,
      buttons: null,
      refreshValuesOnOpen: true,
    });
  });
});
```

```ts
// app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.enterprise.test.ts
import { describe, expect, test } from "vitest";

vi.mock("@/components/shared/AgGridTableView/agGridLicense", () => ({
  AG_GRID_ENTERPRISE_AVAILABLE: true,
}));

const { getFilterType } = await import("../tableVizFilterSetUpUtils");

describe("getFilterType (AG Grid Enterprise license configured — must stay unchanged)", () => {
  test("a Char column using the multi-filter still gets agMultiColumnFilter", () => {
    expect(getFilterType("Char", true)).toBe("agMultiColumnFilter");
  });

  test("any other set-filter column still gets agSetColumnFilter", () => {
    expect(getFilterType("Boolean", false)).toBe("agSetColumnFilter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.enterprise.test.ts`
Expected: FAIL on the community-flag test file — `getFilterType('Char', true)`
currently returns `'agMultiColumnFilter'`, not `CommunitySetFilter`. The
enterprise-flag file passes already (today's unconditional behavior matches it)
— that's expected; it exists to catch a future regression, not to currently be
red.

- [ ] **Step 3: Write minimal implementation**

Replace the whole contents of `tableVizFilterSetUpUtils.ts`:

```ts
// app/gui/src/project-view/components/visualizations/TableVisualization/tableVizFilterSetUpUtils.ts
import { AG_GRID_ENTERPRISE_AVAILABLE } from "@/components/shared/AgGridTableView/agGridLicense";
import type { SetFilterValuesFuncParams } from "ag-grid-community";
import { CommunitySetFilter } from "./CommunitySetFilter";
import { isNumericType, type ValueType } from "./tableVizUtils";

export const getFilterParams = (
  isSSRM: boolean,
  valueType: ValueType | null | undefined,
  filterType: string | typeof CommunitySetFilter | null,
  getFilterValues: (
    params: SetFilterValuesFuncParams<any, string>,
  ) => Promise<void>,
) => {
  const filterOptions = valueType
    ? getFilterOptions(valueType.constructor)
    : null;
  const filterButtons = valueType
    ? getFilterButtons(valueType.constructor)
    : null;

  const defaultFilter = {
    maxNumConditions: 1,
    values: isSSRM ? getFilterValues : null,
    filterOptions: filterOptions,
    buttons: filterButtons,
    refreshValuesOnOpen: true,
  };

  return filterType != "agMultiColumnFilter"
    ? defaultFilter
    : {
        filters: [
          {
            filter: "agTextColumnFilter",
            filterParams: {
              ...defaultFilter,
            },
          },
          {
            filter: "agSetColumnFilter",
            filterParams: {
              ...defaultFilter,
            },
          },
        ],
      };
};

export const getFilterType = (valueType: string, usingMultiFilter: boolean) => {
  if (valueType === "Date") {
    return "agDateColumnFilter";
  } else if (isNumericType(valueType)) {
    return "agNumberColumnFilter";
  } else if (valueType === "Char") {
    if (!usingMultiFilter) return "agTextColumnFilter";
    return AG_GRID_ENTERPRISE_AVAILABLE
      ? "agMultiColumnFilter"
      : CommunitySetFilter;
  } else if (
    valueType === "Date_Time" ||
    valueType === "Time_Of_Day" ||
    valueType === "Mixed"
  ) {
    return null;
  } else {
    return AG_GRID_ENTERPRISE_AVAILABLE
      ? "agSetColumnFilter"
      : CommunitySetFilter;
  }
};

export const getCellDataType = (valueType: string) => {
  if (valueType === "Date") {
    return "date";
  } else if (isNumericType(valueType)) {
    return "number";
  } else if (valueType === "Char") {
    return "text";
  } else if (valueType === "Boolean") {
    return "boolean";
  } else {
    return false;
  }
};

function getFilterOptions(valueType: string) {
  if (valueType === "Date") {
    return [
      "equals",
      "notEqual",
      "greaterThan",
      "lessThan",
      "inRange",
      "blank",
      "notBlank",
    ];
  } else if (isNumericType(valueType)) {
    return [
      "equals",
      "notEqual",
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "inRange",
      "blank",
      "notBlank",
    ];
  } else if (valueType === "Char") {
    return [
      "equals",
      "notEqual",
      "contains",
      "startsWith",
      "endsWith",
      "blank",
      "notBlank",
    ];
  } else {
    return null;
  }
}
function getFilterButtons(valueType: string) {
  if (valueType === "Date") {
    return ["apply", "clear"];
  } else {
    return ["clear"];
  }
}
```

(Only `getFilterParams`'s type annotation and `getFilterType`'s body changed
from the original file — `getCellDataType`, `getFilterOptions`,
`getFilterButtons` are reproduced unchanged for a complete file replacement, not
because they need edits.)

- [ ] **Step 4: Run test to verify it passes**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.enterprise.test.ts`
Expected: PASS (6 tests total).

- [ ] **Step 5: Run the full TableVisualization unit test suite to check for
      regressions**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm --filter enso-gui run typecheck` Expected: PASS.
`TableVisualization.vue:659,661` calls `getFilterType`/`getFilterParams` and
assigns their results to `colDef.filter`/`colDef.filterParams` (both typed `any`
on `IFilterDef`, per `@ag-grid-community/core`'s `iFilter.d.ts`) — the widened
return type should not produce a type error there, but if it does, fix it at the
`TableVisualization.vue` call site (e.g. an explicit cast), not by narrowing
`getFilterType`'s real return type.

- [ ] **Step 7: Manual smoke check**

Run the dev server without a license key (temporarily blank
`ENSO_IDE_AG_GRID_LICENSE_KEY` in `.dev-env/.env.development`, or use a build
that omits it) and open a table visualization. Confirm: a Boolean or other
set-eligible column's filter icon opens the new search-box-plus-checkbox-list
UI, selecting/deselecting values updates the grid's rows (via the existing
server-side filtering path), and a Char column configured for the multi-filter
shows the same UI. This is the one behavior Task 1/2's unit tests deliberately
don't cover (they test the filter component and the selection logic in
isolation, not a real grid popup).

- [ ] **Step 8: Commit**

```bash
git add app/gui/src/project-view/components/visualizations/TableVisualization/tableVizFilterSetUpUtils.ts app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.test.ts app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableVizFilterSetUpUtils.enterprise.test.ts
git commit -m "Use CommunitySetFilter for Set/Multi Filter columns when unlicensed"
```

---

## Self-Review Notes

- **Spec coverage:** Design spec section 4 fully covered — custom `IFilterComp`
  (Task 1), `getFilterType`/`getFilterParams` branching (Task 2), reuse of
  `getFilterValues` unchanged (Architecture + Global Constraints, verified no
  changes to `TableVisualization.vue`), reuse of existing filter-model parsing
  unchanged (Architecture, verified `CommunitySetFilter`'s model shape matches
  `SetFilterModel`), Multi Filter scope simplification (Architecture note, with
  the interpretation made explicit since the spec text alone was ambiguous).
- **Type consistency:** `CommunitySetFilter` (Task 1) is imported by exact name
  into Task 2 and compared/returned as a class reference, never a string,
  consistently. `getFilterType`'s widened return type
  (`string | typeof CommunitySetFilter | null`) matches what Task 2's tests
  assert (`toBe(CommunitySetFilter)` vs `toBe('agSetColumnFilter')` etc.) and
  what `getFilterParams`'s `filterType` parameter now accepts.
- **No placeholders:** every step has full file contents or exact commands; no
  "add error handling" or "similar to Task N" shorthand.
- **Deviation flagged for review:** the "search box = narrows checklist, not a
  second filter condition" interpretation (Architecture section) and the task
  ordering swap (component before wiring, opposite of the spec's suggested build
  order) are both explicitly called out for reviewer attention rather than
  silently assumed.
