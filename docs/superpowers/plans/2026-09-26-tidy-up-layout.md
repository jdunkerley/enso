# Tidy Up (Automatic Graph Layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Tidy up" action that lays out the whole graph, or the selected
components, as a clean top-to-bottom flow. Each chain of components sits in one
straight column, and separate streams sit side by side.

**Architecture:** there are three parts.

- A pure, dependency-free layout function, `streamLayout`, builds a forest of
  streams by following each component's `self` input. It assigns one column per
  chain, packs the rows compactly, reorders columns only where that strictly
  reduces edge crossings, and anchors the result at the original top-left.
- An adapter builds the layout model from `GraphDb` and writes the positions in
  one undoable batched edit.
- The action sits with the existing align tools, has a new `tidy_up` icon, and
  is bound to `Mod+Shift+L`.

**Tech Stack:** TypeScript and Vue 3 (`app/gui`), vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-tidy-up-layout-design.md`

## Global Constraints

- **No new npm dependency.** The layout is custom code.
- **Only position metadata changes.** Code lines and expressions are never
  touched.
- **One undo step.** All positions are written inside a single
  `module.batchEdits(...)` with the default user origin.
- **Stable order.**
  - Independent streams and branch columns keep their current left-to-right
    order unless swapping strictly reduces edge crossings.
  - The child whose centre x is closest to its parent's continues the parent's
    column; ties go to code order.
  - Tidy up is idempotent: running it on its own output changes nothing.
- **Compact columns.**
  - A component's top is the vertical gap plus the lowest bottom among all its
    in-scope inputs.
  - Roots start at the top.
  - No rows are shared across columns.
- **Anchoring.** The result's bounding-box top-left equals the top-left of the
  in-scope components' current bounding box.
- **Spacing** comes from `theme.node.vertical_gap` and
  `theme.node.horizontal_gap` (both 40, in `project-view/util/theme.json`).
- **Scope.** With more than one component selected, only those are tidied.
  Otherwise the whole graph is tidied.
- **Icons.** Only `<symbol>` ids in `project-view/assets/icons.svg` are valid.
  Regenerate `util/iconMetadata/iconName.ts` with
  `corepack pnpm --filter enso-gui run generate-icons`, and never hand-edit it.
- Use `corepack pnpm`, never bare pnpm or npm. Playwright cannot run on native
  Windows: run it in WSL.
- **Never use `git stash`.** The stash list is shared with the user's other
  work. To test old code, use a scratch commit or `git worktree add`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HtSCMjmJWC1DPtGWKF9UEx
  ```
- Branch: `feature/tidy-up` in `C:\Repos\Enso\ide`, created from develop. The
  spec is already committed on it.

---

### Task 1: The core stream layout

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/tidy/streamLayout.ts`
- Create:
  `app/gui/src/project-view/components/GraphEditor/tidy/__tests__/streamLayout.test.ts`

**Interfaces:**

- Produces:
  - `interface LayoutComponent<Id> { id: Id; size: Vec2; position: Vec2; selfSource?: Id | undefined; inputs: readonly Id[]; order: number }`
  - `interface LayoutSpacing { horizontal: number; vertical: number }`
  - `function streamLayout<Id>(components: readonly LayoutComponent<Id>[], spacing: LayoutSpacing): Map<Id, Vec2>`,
    which returns the new top-left positions.
  - `function countCrossings<Id>(components: readonly LayoutComponent<Id>[], positions: ReadonlyMap<Id, Vec2>): number`,
    exported for tests and for Task 2.
- `inputs` holds only in-scope ids, in argument order, and may include
  `selfSource`. `order` is the code order, used for tie-breaks.

This task implements steps 1–3 and 5 of the spec's algorithm: the forest,
columns, rows and anchoring. The crossing pass (step 4) is Task 2. This task
still exports `countCrossings`, because Task 2 builds on it.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  countCrossings,
  streamLayout,
  type LayoutComponent,
} from "../streamLayout";
import { Vec2 } from "@/util/data/vec2";
import { describe, expect, test } from "vitest";

const SPACING = { horizontal: 40, vertical: 40 };
const SIZE = new Vec2(100, 32);

/** A component at `(x, y)` with the default size, fed by `inputs` (the first one is its self input unless `self` says otherwise). */
function comp(
  id: string,
  x: number,
  y: number,
  inputs: string[] = [],
  opts: { self?: string | null; size?: Vec2; order?: number } = {},
): LayoutComponent<string> {
  const self = opts.self === null ? undefined : (opts.self ?? inputs[0]);
  return {
    id,
    position: new Vec2(x, y),
    size: opts.size ?? SIZE,
    inputs,
    selfSource: self,
    order: opts.order ?? 0,
  };
}

function withOrder(components: LayoutComponent<string>[]) {
  return components.map((c, i) => ({ ...c, order: i }));
}

function centreX(pos: Map<string, Vec2>, id: string, width = SIZE.x) {
  return pos.get(id)!.x + width / 2;
}

describe("streamLayout", () => {
  test("a straight chain forms one column, packed with the vertical gap", () => {
    const pos = streamLayout(
      withOrder([
        comp("a", 0, 0),
        comp("b", 300, 500, ["a"]),
        comp("c", 80, 90, ["b"]),
      ]),
      SPACING,
    );
    expect(pos.get("a")).toEqual(new Vec2(0, 0));
    expect(pos.get("b")).toEqual(new Vec2(0, 72));
    expect(pos.get("c")).toEqual(new Vec2(0, 144));
  });

  test("on a split the closest child continues the column; others open columns to the right in current order", () => {
    const pos = streamLayout(
      withOrder([
        comp("p", 0, 0),
        comp("far", 400, 80, ["p"]),
        comp("below", 10, 80, ["p"]),
        comp("mid", 200, 80, ["p"]),
      ]),
      SPACING,
    );
    expect(centreX(pos, "below")).toBe(centreX(pos, "p"));
    expect(centreX(pos, "mid")).toBeGreaterThan(centreX(pos, "below"));
    expect(centreX(pos, "far")).toBeGreaterThan(centreX(pos, "mid"));
    expect(pos.get("mid")!.x - pos.get("below")!.x).toBe(
      SIZE.x + SPACING.horizontal,
    );
  });

  test("a merge sits below every input and in its self input’s column", () => {
    const pos = streamLayout(
      withOrder([
        comp("left", 0, 0),
        comp("right", 200, 0),
        comp("r2", 200, 80, ["right"]),
        comp("r3", 200, 160, ["r2"]),
        comp("join", 0, 100, ["left", "r3"]),
      ]),
      SPACING,
    );
    expect(centreX(pos, "join")).toBe(centreX(pos, "left"));
    const r3Bottom = pos.get("r3")!.y + SIZE.y;
    expect(pos.get("join")!.y).toBe(r3Bottom + SPACING.vertical);
  });

  test("without a self input a component follows its first input", () => {
    const pos = streamLayout(
      withOrder([
        comp("a", 0, 0),
        comp("b", 300, 0),
        comp("f", 250, 90, ["b", "a"], { self: null }),
      ]),
      SPACING,
    );
    expect(centreX(pos, "f")).toBe(centreX(pos, "b"));
  });

  test("independent streams keep their left-to-right order", () => {
    const pos = streamLayout(
      withOrder([
        comp("right", 500, 0),
        comp("left", 0, 0),
        comp("mid", 250, 0),
      ]),
      SPACING,
    );
    expect(pos.get("left")!.x).toBeLessThan(pos.get("mid")!.x);
    expect(pos.get("mid")!.x).toBeLessThan(pos.get("right")!.x);
  });

  test("columns are as wide as their widest component and components are centred", () => {
    const wide = new Vec2(300, 32);
    const pos = streamLayout(
      withOrder([
        comp("a", 0, 0),
        comp("b", 0, 80, ["a"], { size: wide }),
        comp("other", 900, 0),
      ]),
      SPACING,
    );
    expect(pos.get("b")!.x).toBe(0);
    expect(pos.get("a")!.x).toBe((300 - SIZE.x) / 2);
    expect(pos.get("other")!.x).toBe(300 + SPACING.horizontal);
  });

  test("a tall component pushes only its own column down", () => {
    const tall = new Vec2(100, 400);
    const pos = streamLayout(
      withOrder([
        comp("a", 0, 0, [], { size: tall }),
        comp("a2", 0, 450, ["a"]),
        comp("b", 200, 0),
        comp("b2", 200, 80, ["b"]),
      ]),
      SPACING,
    );
    expect(pos.get("a2")!.y).toBe(400 + SPACING.vertical);
    expect(pos.get("b2")!.y).toBe(SIZE.y + SPACING.vertical);
  });

  test("the result is anchored at the original top-left", () => {
    const pos = streamLayout(
      withOrder([comp("a", 1000, 2000), comp("b", 1400, 2300, ["a"])]),
      SPACING,
    );
    expect(pos.get("a")).toEqual(new Vec2(1000, 2000));
    expect(pos.get("b")).toEqual(new Vec2(1000, 2072));
  });

  test("tidying a tidied layout changes nothing", () => {
    const input = withOrder([
      comp("d", 0, 0),
      comp("n1", 300, 0),
      comp("n3", 320, 80, ["n1"]),
      comp("j", 10, 200, ["d", "n3"]),
      comp("s", 0, 300, ["j"]),
      comp("br", 200, 300, ["j"]),
    ]);
    const once = streamLayout(input, SPACING);
    const again = streamLayout(
      input.map((c) => ({ ...c, position: once.get(c.id)! })),
      SPACING,
    );
    expect(again).toEqual(once);
  });

  test("a cycle does not hang and drops the later-in-code-order edge", () => {
    const pos = streamLayout(
      withOrder([comp("a", 0, 0, ["b"]), comp("b", 0, 80, ["a"])]),
      SPACING,
    );
    expect(pos.get("a")!.y).toBeLessThan(pos.get("b")!.y);
  });

  test("countCrossings counts a crossing pair of edges", () => {
    // a→d and b→c cross: a (left top) → d (right bottom), b (right top) → c (left bottom).
    const cs = withOrder([
      comp("a", 0, 0),
      comp("b", 200, 0),
      comp("c", 0, 200, ["b"]),
      comp("d", 200, 200, ["a"]),
    ]);
    const pos = new Map(cs.map((c) => [c.id, c.position]));
    expect(countCrossings(cs, pos)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/GraphEditor/tidy/__tests__/streamLayout.test.ts`

Expected: FAIL. The `../streamLayout` module can't be resolved.

- [ ] **Step 3: Implement**

Create `streamLayout.ts`:

```ts
/**
 * @file Tidy up: a stream-based automatic layout for the graph editor.
 *
 * Each component hangs below the component feeding its `self` argument (or, lacking one, its
 * first input), which turns the graph into a forest of streams. Every chain of components is one
 * straight column; rows are packed per column. See
 * `docs/superpowers/specs/2026-09-26-tidy-up-layout-design.md`.
 */
import { Vec2 } from "@/util/data/vec2";

/** One component as the layout sees it. */
export interface LayoutComponent<Id> {
  readonly id: Id;
  /** Rendered size, including an open visualization. */
  readonly size: Vec2;
  /** Current top-left position. */
  readonly position: Vec2;
  /** The in-scope component feeding this one's `self` argument, if any. */
  readonly selfSource?: Id | undefined;
  /** In-scope components feeding this one, in argument order. */
  readonly inputs: readonly Id[];
  /** Code order, for tie-breaks. */
  readonly order: number;
}

/** Gaps between components. */
export interface LayoutSpacing {
  readonly horizontal: number;
  readonly vertical: number;
}

/** The column order the layout is computed from; the crossing pass permutes these lists. */
export interface ColumnOrder<Id> {
  /** Roots of independent streams, left to right. */
  readonly roots: Id[];
  /** For each component, its branch children (all children but the column-continuing one), left to right. */
  readonly branches: Map<Id, Id[]>;
}

/** The acyclic stream structure derived from the components. */
export interface StreamForest<Id> {
  readonly byId: ReadonlyMap<Id, LayoutComponent<Id>>;
  /** Inputs actually used, after breaking any cycle. */
  readonly inputs: ReadonlyMap<Id, readonly Id[]>;
  /** The child continuing each component's column, if it has children. */
  readonly mainChild: ReadonlyMap<Id, Id>;
  /** Components in dependency order. */
  readonly topological: readonly Id[];
  /** The initial column order, taken from the current positions. */
  readonly initialOrder: ColumnOrder<Id>;
}

const centreX = <Id>(c: LayoutComponent<Id>) => c.position.x + c.size.x / 2;
const byPosition = <Id>(a: LayoutComponent<Id>, b: LayoutComponent<Id>) =>
  centreX(a) - centreX(b) || a.order - b.order;

/** Kahn's algorithm; returns undefined if `inputs` contains a cycle. */
function topologicalOrder<Id>(
  components: readonly LayoutComponent<Id>[],
  inputs: ReadonlyMap<Id, readonly Id[]>,
): Id[] | undefined {
  const remaining = new Map(
    components.map((c) => [c.id, inputs.get(c.id)!.length]),
  );
  const dependents = new Map<Id, Id[]>(components.map((c) => [c.id, []]));
  for (const c of components)
    for (const i of inputs.get(c.id)!) dependents.get(i)!.push(c.id);
  const byOrder = [...components].sort((a, b) => a.order - b.order);
  const ready = byOrder
    .filter((c) => remaining.get(c.id) === 0)
    .map((c) => c.id);
  const result: Id[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    result.push(id);
    for (const d of dependents.get(id)!) {
      const left = remaining.get(d)! - 1;
      remaining.set(d, left);
      if (left === 0) ready.push(d);
    }
  }
  return result.length === components.length ? result : undefined;
}

/** Build the stream forest: acyclic inputs, parents, the column-continuing child, and initial order. */
export function buildForest<Id>(
  components: readonly LayoutComponent<Id>[],
): StreamForest<Id> {
  const byId = new Map(components.map((c) => [c.id, c]));
  let inputs = new Map(
    components.map((c) => [
      c.id,
      [...new Set(c.inputs)].filter((i) => byId.has(i) && i !== c.id),
    ]),
  );
  let topological = topologicalOrder(components, inputs);
  if (topological == null) {
    // A cycle (only possible in broken code): drop every edge from a later-in-code-order source.
    inputs = new Map(
      components.map((c) => [
        c.id,
        inputs.get(c.id)!.filter((i) => byId.get(i)!.order < c.order),
      ]),
    );
    topological = topologicalOrder(components, inputs)!;
  }

  const parent = new Map<Id, Id>();
  for (const c of components) {
    const own = inputs.get(c.id)!;
    const p =
      c.selfSource != null && own.includes(c.selfSource)
        ? c.selfSource
        : own[0];
    if (p != null) parent.set(c.id, p);
  }
  const children = new Map<Id, LayoutComponent<Id>[]>();
  for (const [child, p] of parent) {
    const list = children.get(p) ?? [];
    list.push(byId.get(child)!);
    children.set(p, list);
  }

  const mainChild = new Map<Id, Id>();
  const branches = new Map<Id, Id[]>();
  for (const [p, kids] of children) {
    const px = centreX(byId.get(p)!);
    const main = [...kids].sort(
      (a, b) =>
        Math.abs(centreX(a) - px) - Math.abs(centreX(b) - px) ||
        a.order - b.order,
    )[0]!;
    mainChild.set(p, main.id);
    branches.set(
      p,
      kids
        .filter((k) => k.id !== main.id)
        .sort(byPosition)
        .map((k) => k.id),
    );
  }
  const roots = components
    .filter((c) => !parent.has(c.id))
    .sort(byPosition)
    .map((c) => c.id);

  return {
    byId,
    inputs,
    mainChild,
    topological,
    initialOrder: { roots, branches },
  };
}

/** Positions for a given column order, before anchoring (top-left of the result is (0, 0)). */
export function placeColumns<Id>(
  forest: StreamForest<Id>,
  order: ColumnOrder<Id>,
  spacing: LayoutSpacing,
): Map<Id, Vec2> {
  const column = new Map<Id, number>();
  let nextColumn = 0;
  const assign = (id: Id, col: number) => {
    column.set(id, col);
    const branchCols = (order.branches.get(id) ?? []).map(() => nextColumn++);
    const main = forest.mainChild.get(id);
    if (main != null) assign(main, col);
    (order.branches.get(id) ?? []).forEach((b, i) => assign(b, branchCols[i]!));
  };
  for (const root of order.roots) assign(root, nextColumn++);

  const widths = Array.from({ length: nextColumn }, () => 0);
  for (const [id, col] of column)
    widths[col] = Math.max(widths[col]!, forest.byId.get(id)!.size.x);
  const columnX: number[] = [];
  let x = 0;
  for (const w of widths) {
    columnX.push(x);
    x += w + spacing.horizontal;
  }

  const top = new Map<Id, number>();
  for (const id of forest.topological) {
    const ins = forest.inputs.get(id)!;
    top.set(
      id,
      ins.length === 0
        ? 0
        : Math.max(
            ...ins.map((i) => top.get(i)! + forest.byId.get(i)!.size.y),
          ) + spacing.vertical,
    );
  }

  const result = new Map<Id, Vec2>();
  for (const [id, col] of column) {
    const c = forest.byId.get(id)!;
    result.set(
      id,
      new Vec2(columnX[col]! + (widths[col]! - c.size.x) / 2, top.get(id)!),
    );
  }
  return result;
}

/** Number of pairs of edges that cross, modelling each edge as a segment from the source's bottom centre to the target's top centre. */
export function countCrossings<Id>(
  components: readonly LayoutComponent<Id>[],
  positions: ReadonlyMap<Id, Vec2>,
): number {
  const byId = new Map(components.map((c) => [c.id, c]));
  type Segment = {
    from: Id;
    to: Id;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  const segments: Segment[] = [];
  for (const c of components) {
    const tp = positions.get(c.id);
    if (tp == null) continue;
    for (const i of c.inputs) {
      const src = byId.get(i);
      const sp = positions.get(i);
      if (src == null || sp == null) continue;
      segments.push({
        from: i,
        to: c.id,
        x1: sp.x + src.size.x / 2,
        y1: sp.y + src.size.y,
        x2: tp.x + c.size.x / 2,
        y2: tp.y,
      });
    }
  }
  const orient = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const s = segments[i]!;
      const t = segments[j]!;
      if (
        s.from === t.from ||
        s.from === t.to ||
        s.to === t.from ||
        s.to === t.to
      )
        continue;
      const d1 = orient(s.x1, s.y1, s.x2, s.y2, t.x1, t.y1);
      const d2 = orient(s.x1, s.y1, s.x2, s.y2, t.x2, t.y2);
      const d3 = orient(t.x1, t.y1, t.x2, t.y2, s.x1, s.y1);
      const d4 = orient(t.x1, t.y1, t.x2, t.y2, s.x2, s.y2);
      if (d1 * d2 < 0 && d3 * d4 < 0) crossings++;
    }
  }
  return crossings;
}

/** Shift `positions` so their top-left equals the components' current top-left. */
function anchor<Id>(
  components: readonly LayoutComponent<Id>[],
  positions: Map<Id, Vec2>,
): Map<Id, Vec2> {
  const originX = Math.min(...components.map((c) => c.position.x));
  const originY = Math.min(...components.map((c) => c.position.y));
  const minX = Math.min(...[...positions.values()].map((p) => p.x));
  const minY = Math.min(...[...positions.values()].map((p) => p.y));
  const result = new Map<Id, Vec2>();
  for (const [id, p] of positions)
    result.set(id, new Vec2(p.x - minX + originX, p.y - minY + originY));
  return result;
}

/** Lay out `components` as a top-to-bottom flow of straight columns; returns new top-left positions. */
export function streamLayout<Id>(
  components: readonly LayoutComponent<Id>[],
  spacing: LayoutSpacing,
): Map<Id, Vec2> {
  if (components.length === 0) return new Map();
  const forest = buildForest(components);
  return anchor(components, placeColumns(forest, forest.initialOrder, spacing));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run the same command. Expected: PASS, all 11 tests.

If an expected coordinate in the tests is off because of a real arithmetic
mistake in the _test_, fix the test and say so in the report. For example: the
split test's column spacing is `SIZE.x + horizontal = 140`, and the chain's row
step is `32 + 40 = 72`. Never weaken an assertion to make it pass.

- [ ] **Step 5: Lint and typecheck, then commit**

Run:

```bash
cd app/gui && corepack pnpm exec eslint src/project-view/components/GraphEditor/tidy && corepack pnpm run typecheck
```

Expected: both clean. Then commit:

```bash
git add app/gui/src/project-view/components/GraphEditor/tidy
git commit -m "Tidy up: stream layout (forest, columns, compact rows, anchoring)"
```

---

### Task 2: The crossing pass

**Files:**

- Modify: `app/gui/src/project-view/components/GraphEditor/tidy/streamLayout.ts`
  (`streamLayout` only)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/tidy/__tests__/streamLayout.test.ts`

**Interfaces:**

- Consumes: `buildForest`, `placeColumns`, `countCrossings` and `ColumnOrder`
  from Task 1.
- Produces: `streamLayout` with the crossing pass. Its signature is unchanged.
  Also `export const MAX_CROSSING_ROUNDS = 4`.

- [ ] **Step 1: Write the failing tests** (append these to the test file)

```ts
describe("crossing pass", () => {
  test("swaps independent streams when that removes a crossing", () => {
    // Roots A, B, C left to right. m (in C's column, self = C) also takes A as an input, so the
    // edge A→m spans column B and crosses B→b2. Swapping A and B removes the crossing.
    // Hand-checked: before, A→m runs (50,32)→(330,72) and meets B→b2 (x=190, y 32..72) at y≈52.
    const input = withOrder([
      comp("A", 0, 0),
      comp("B", 300, 0),
      comp("b2", 300, 80, ["B"]),
      comp("C", 600, 0),
      comp("m", 600, 300, ["C", "A"]),
    ]);
    const forest = buildForest(input);
    expect(
      countCrossings(input, placeColumns(forest, forest.initialOrder, SPACING)),
    ).toBe(1);
    const pos = streamLayout(input, SPACING);
    expect(countCrossings(input, pos)).toBe(0);
  });

  test("keeps the current order when swapping does not strictly reduce crossings", () => {
    const input = withOrder([
      comp("A", 0, 0),
      comp("B", 300, 0),
      comp("C", 600, 0),
    ]);
    const pos = streamLayout(input, SPACING);
    expect(pos.get("A")!.x).toBeLessThan(pos.get("B")!.x);
    expect(pos.get("B")!.x).toBeLessThan(pos.get("C")!.x);
  });

  test("reorders branch columns of one parent to remove a crossing", () => {
    // p splits into b1 (left) and b2 (right) besides its main child m. b1 feeds a component that
    // sits right of b2's column... construct so the current branch order crosses.
    const input = withOrder([
      comp("p", 0, 0),
      comp("m", 0, 80, ["p"]),
      comp("b1", 200, 80, ["p"]),
      comp("b2", 400, 80, ["p"]),
      comp("z", 200, 300, ["b2", "m"]),
      comp("w", 400, 300, ["b1"]),
    ]);
    const before = (() => {
      const f = buildForest(input);
      return countCrossings(input, placeColumns(f, f.initialOrder, SPACING));
    })();
    const pos = streamLayout(input, SPACING);
    expect(countCrossings(input, pos)).toBeLessThan(before);
  });
});
```

Add `buildForest` and `placeColumns` to the file's import from
`'../streamLayout'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/GraphEditor/tidy/__tests__/streamLayout.test.ts`

Expected: FAIL. The first and third new tests fail on their final assertion,
because there is no crossing pass yet. The second passes.

If the third test's fixture happens to have no crossing to begin with
(`before === 0`), adjust the fixture's positions until it does, and explain the
change in the report. It must start with at least one crossing.

- [ ] **Step 3: Implement the pass**

In `streamLayout.ts`, add `export const MAX_CROSSING_ROUNDS = 4`, and replace
the body of `streamLayout` with:

```ts
if (components.length === 0) return new Map();
const forest = buildForest(components);
const order: ColumnOrder<Id> = {
  roots: [...forest.initialOrder.roots],
  branches: new Map(
    [...forest.initialOrder.branches].map(([k, v]) => [k, [...v]]),
  ),
};
const groups: Id[][] = [order.roots, ...order.branches.values()].filter(
  (g) => g.length > 1,
);
let best = countCrossings(components, placeColumns(forest, order, spacing));
// One optimisation pass over column order only: keep an adjacent swap iff it strictly reduces
// crossings, so ties keep the user's order and a tidied graph stays unchanged.
for (let round = 0; round < MAX_CROSSING_ROUNDS && best > 0; round++) {
  let improved = false;
  for (const group of groups) {
    for (let i = 0; i + 1 < group.length; i++) {
      [group[i], group[i + 1]] = [group[i + 1]!, group[i]!];
      const crossings = countCrossings(
        components,
        placeColumns(forest, order, spacing),
      );
      if (crossings < best) {
        best = crossings;
        improved = true;
      } else {
        [group[i], group[i + 1]] = [group[i + 1]!, group[i]!];
      }
    }
  }
  if (!improved) break;
}
return anchor(components, placeColumns(forest, order, spacing));
```

- [ ] **Step 4: Run all the layout tests**

Run the same command. Expected: PASS, including every Task 1 test. Idempotence
must still hold. The crossing pass only swaps on strict improvement, so a tidied
layout, being a local optimum, stays unchanged.

- [ ] **Step 5: Lint, typecheck, commit**

Run the same commands as in Task 1, Step 5. Then commit:

```bash
git add app/gui/src/project-view/components/GraphEditor/tidy
git commit -m "Tidy up: one crossing-minimisation pass over column order"
```

---

### Task 3: The adapter from the graph store

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/tidy/useGraphTidy.ts`
- Create:
  `app/gui/src/project-view/components/GraphEditor/tidy/__tests__/useGraphTidy.test.ts`

**Interfaces:**

- Consumes: `streamLayout` and `LayoutComponent` (Tasks 1–2).
- Consumes from `GraphDb` (`providers/openedProjects/graph/graphDatabase.ts`):
  - `nodeIdToNode` (a `ReactiveDb<NodeId, Node>`, iterated in code order);
  - `iterateConnections()`, which yields
    `{ targetExprId, targetNode, nodeWithSource, ... }`;
  - `node.primaryApplication.selfArgument` (an `AstId | null`: the argument
    expression in the self position);
  - `node.innerExpr` (an Ast, to visit for argument order).
- Consumes from the graph store:
  - `graphStore.visibleArea(nodeId): Rect | undefined`, whose size includes an
    open visualization;
  - `graphStore.setNodePosition(nodeId, Vec2)`.
- Produces:
  - `function buildTidyModel(db: GraphDb, scope: ReadonlySet<NodeId> | undefined, sizeOf: (id: NodeId) => Vec2 | undefined, defaultSize: Vec2): LayoutComponent<NodeId>[]`;
  - `function useGraphTidy(graphStore: GraphStore, module: Ref<ModuleStore>): { tidy(selection?: readonly NodeId[]): void }`.

- [ ] **Step 1: Write the failing test**

Build a real `GraphDb` from code. Follow the pattern in
`providers/openedProjects/graph/__tests__/graphDatabase.test.ts`, whose
`parseWithSpans` helper parses code into `db.updateExternalIds`,
`db.updateNodes` and `db.updateBindings`. Export it if needed, or copy it. The
fixture:

```
main =
    data = Data.read
    other = Data.read
    filtered = data.filter
    joined = filtered.join other
    lonely = 42
```

Assertions on
`buildTidyModel(db, undefined, () => new Vec2(100, 32), new Vec2(100, 32))`:

- There is one component per node, and `order` follows code order: data 0, other
  1, filtered 2, joined 3, lonely 4.
- `filtered.selfSource === data`, and `filtered.inputs` is `[data]`.
- `joined.selfSource === filtered`, and `joined.inputs` is `[filtered, other]`,
  in argument order.
- `data`, `other` and `lonely` have no inputs.
- With `scope = {filtered, joined}`, the model has only those two. `joined`'s
  inputs are `[filtered]`, because `other` is out of scope. `filtered` has no
  inputs, because `data` is out of scope.
- If `sizeOf` returns `undefined` for a component, it gets `defaultSize`.

Look up a node's id by its binding with `db.getIdentDefiningNode('filtered')`.

- [ ] **Step 2: Run the test to verify it fails**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/GraphEditor/tidy/__tests__/useGraphTidy.test.ts`

Expected: FAIL. The module can't be resolved.

- [ ] **Step 3: Implement**

```ts
import type { GraphStore, NodeId } from "$/providers/openedProjects/graph";
import type { GraphDb } from "$/providers/openedProjects/graph/graphDatabase";
import type { ModuleStore } from "$/providers/openedProjects/module/module";
import { Ast } from "@/util/ast";
import { Vec2 } from "@/util/data/vec2";
import theme from "@/util/theme";
import type { Ref } from "vue";
import { streamLayout, type LayoutComponent } from "./streamLayout";

/** Build the layout model for the components in `scope` (the whole graph when undefined). */
export function buildTidyModel(
  db: GraphDb,
  scope: ReadonlySet<NodeId> | undefined,
  sizeOf: (id: NodeId) => Vec2 | undefined,
  defaultSize: Vec2,
): LayoutComponent<NodeId>[] {
  const ids = [...db.nodeIdToNode.keys()].filter(
    (id) => scope == null || scope.has(id),
  );
  const inScope = new Set(ids);
  const inputs = new Map<NodeId, { source: NodeId; argIndex: number }[]>(
    ids.map((id) => [id, []]),
  );
  const selfSource = new Map<NodeId, NodeId>();
  const argIndex = new Map<NodeId, Map<Ast.AstId, number>>();
  for (const id of ids) {
    const exprs = new Map<Ast.AstId, number>();
    Ast.visitRecursive(
      db.nodeIdToNode.get(id)!.innerExpr,
      (ast) => void exprs.set(ast.id, exprs.size),
    );
    argIndex.set(id, exprs);
  }
  for (const {
    targetExprId,
    targetNode,
    nodeWithSource,
  } of db.iterateConnections()) {
    if (targetNode == null || nodeWithSource == null) continue;
    if (
      !inScope.has(targetNode) ||
      !inScope.has(nodeWithSource) ||
      targetNode === nodeWithSource
    )
      continue;
    const index =
      argIndex.get(targetNode)!.get(targetExprId) ?? Number.MAX_SAFE_INTEGER;
    inputs.get(targetNode)!.push({ source: nodeWithSource, argIndex: index });
    if (
      db.nodeIdToNode.get(targetNode)!.primaryApplication.selfArgument ===
      targetExprId
    )
      selfSource.set(targetNode, nodeWithSource);
  }
  return ids.map((id, order) => ({
    id,
    order,
    size: sizeOf(id) ?? defaultSize,
    position: db.nodeIdToNode.get(id)!.position,
    selfSource: selfSource.get(id),
    inputs: [
      ...new Set(
        inputs
          .get(id)!
          .sort((a, b) => a.argIndex - b.argIndex)
          .map((i) => i.source),
      ),
    ],
  }));
}

/** Tidy up: lay out the whole graph, or the given selection, and write positions as one undoable edit. */
export function useGraphTidy(graphStore: GraphStore, module: Ref<ModuleStore>) {
  const defaultSize = new Vec2(theme.node.height * 4, theme.node.height);
  function tidy(selection?: readonly NodeId[]) {
    const scope =
      selection != null && selection.length > 1
        ? new Set(selection)
        : undefined;
    const model = buildTidyModel(
      graphStore.db,
      scope,
      (id) => graphStore.visibleArea(id)?.size,
      defaultSize,
    ).filter(
      (c) => Number.isFinite(c.position.x) && Number.isFinite(c.position.y),
    );
    if (model.length < 2) return;
    const positions = streamLayout(model, {
      horizontal: theme.node.horizontal_gap,
      vertical: theme.node.vertical_gap,
    });
    module.value.batchEdits(() => {
      for (const [id, position] of positions)
        graphStore.setNodePosition(id, position);
    });
  }
  return { tidy };
}
```

Check two things while implementing:

- **`Rect` has a `.size` getter.** If it doesn't, use
  `new Vec2(rect.width, rect.height)`.
- **`GraphStore` and `ModuleStore` exports.** Match the import paths used in
  `selectionAlignment.ts`.

If `iterateConnections` yields function-argument sources with `nodeWithSource`
undefined, that is correct: they are not components.

- [ ] **Step 4: Run the adapter test and the layout tests**

Run:
`cd app/gui && corepack pnpm exec vitest run src/project-view/components/GraphEditor/tidy`

Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

Run the same commands as in Task 1, Step 5. Then commit:

```bash
git add app/gui/src/project-view/components/GraphEditor/tidy app/gui/src/providers/openedProjects/graph/__tests__
git commit -m "Tidy up: build the layout model from the graph and write positions as one edit"
```

---

### Task 4: Icon, action, menus and shortcut

**Files:**

- Modify: `app/gui/src/project-view/assets/icons.svg`, adding a `tidy_up` symbol
  after `align_top`.
- Regenerate: `app/gui/src/project-view/util/iconMetadata/iconName.ts`.
- Modify: `app/gui/src/project-view/bindings.ts`, in `graphBindings`.
- Modify: `app/gui/src/project-view/providers/action.ts`, in
  `displayableActions`, next to `components.alignCenter`.
- Modify: `app/gui/src/project-view/components/GraphEditor.vue`: the
  `registerHandlers` block and `contextMenuActions`.
- Modify: `app/gui/src/project-view/components/SelectionMenu.vue`, in the align
  dropdown.
- Modify: `app/gui/src/project-view/components/GraphEditor/GraphNode.vue`, in
  `alignmentMenuActions`.

**Interfaces:**

- Consumes: `useGraphTidy(graphStore, module).tidy(selection?)` (Task 3).
- Produces: the displayable action `components.tidyUp`, with icon `tidy_up`,
  description `'Tidy Up'`, and binding `Mod+Shift+L`.

- [ ] **Step 1: Add the icon.** Insert this into `icons.svg`, keeping the file's
      indentation:

```xml
  <symbol id="tidy_up" viewBox="0 0 16 16" width="16" height="16" fill="none">
    <rect x="1.75" y="1.75" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.5"></rect>
    <rect x="1.75" y="11.25" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.5"></rect>
    <rect x="9.75" y="6.5" width="4.5" height="3" rx="1" stroke="currentColor" stroke-width="1.5"></rect>
    <path d="M4 4.75V11.25M6.25 3.25H10C11.1046 3.25 12 4.14543 12 5.25V6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
  </symbol>
```

Then run `corepack pnpm --filter enso-gui run generate-icons`. Confirm that
`'tidy_up'` is now in `iconName.ts`, and that the diff there only adds that
name.

- [ ] **Step 2: Add the binding, action and handler.**
  - In `bindings.ts`, `graphBindings`, add
    `'components.tidyUp': ['Mod+Shift+L'],` after `'components.pickColorMulti'`.
  - In `action.ts`, add this after `'components.alignCenter'`:

```ts
  'components.tidyUp': {
    icon: 'tidy_up',
    description: 'Tidy Up',
    shortcut: graphBindings.bindings['components.tidyUp'],
  },
```

- In `GraphEditor.vue`:
  - Import `useGraphTidy` from `@/components/GraphEditor/tidy/useGraphTidy`.
  - Create `const graphTidy = useGraphTidy(graphStore, module)` near the other
    handler setup.
  - Add this to the `registerHandlers({...})` object, e.g. after
    `'graph.fitAll'`:

```ts
  'components.tidyUp': {
    enabled: () => graphStore.db.nodeIdToNode.size >= 2,
    action: () => graphTidy.tidy([...nodeSelection.selected]),
  },
```

    - Add `'components.tidyUp'` to `contextMenuActions`, after `'graph.fitAll'`.

`tidy()` already treats a selection of one or fewer as the whole graph, so the
handler needs no scope logic.

- [ ] **Step 3: Put it with the align tools.**
  - In `SelectionMenu.vue`'s align dropdown `MenuPanel`, add a third row after
    the vertical row:

```vue
<div class="alignmentMenuRow tidy">
            <ActionButton action="components.tidyUp" @click="alignmentMenuOpen = false" />
          </div>
```

    Check the component's `<style>` for the `alignmentMenuRow` styles. The new
    row should look like the others.

- In `GraphNode.vue`, append `'components.tidyUp'` to `alignmentMenuActions`.
  GraphNode registers no align handlers of its own, so its menu resolves align
  actions to GraphEditor's handlers. Confirm this by tracing how
  `components.alignLeft` from that menu reaches `selectionActionHandlers`.

- [ ] **Step 4: Verify.**

Run:

```bash
cd app/gui && corepack pnpm exec vitest run && corepack pnpm run typecheck && corepack pnpm run lint
```

Expected: all clean. Delete `*.tsbuildinfo` and `.eslintcache` first.

If there is a test that snapshots menus or bindings (e.g. a shortcut-uniqueness
test), update it and say which one.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/project-view
git commit -m "Tidy up: action with the align tools, new icon, Mod+Shift+L"
```

---

### Task 5: Playwright end-to-end test (in WSL)

**Files:**

- Create: `app/gui/integration-test/project-view/tidyUp.spec.ts`

**Interfaces:**

- Consumes:
  - the `editorPage` fixture (`integration-test/base`);
  - `locate` helpers: `graphNode(page)`, `graphNodeByBinding(page, name)` and
    `graphNodeIcon(node)`;
  - the `Mod+Shift+L` binding;
  - the align dropdown (title `Align`).
- The mock `main` (in `integration-test/mock/lsHandler.ts`) contains
  `data = Data.read`, `filtered = data.filter` and
  `aggregated = data.aggregate`. These form a split under `data`.

- [ ] **Step 1: Write the spec.**

```ts
import { expect, test, type Page } from "integration-test/base";
import * as locate from "./locate";

async function boxes(page: Page) {
  const nodes = locate.graphNode(page);
  const count = await nodes.count();
  const result = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (let i = 0; i < count; i++) {
    const node = nodes.nth(i);
    const name =
      (await node.locator(".binding").first().textContent())?.trim() ?? `#${i}`;
    const box = await node.boundingBox();
    if (box) result.set(name, box);
  }
  return result;
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: typeof a,
) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test("Tidy up lays out the graph in columns without overlaps, and undo restores it", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const before = await boxes(page);
  await page.keyboard.press("ControlOrMeta+Shift+L");
  await expect
    .poll(async () => JSON.stringify(await boxes(page)))
    .not.toBe(JSON.stringify(before));
  const after = await boxes(page);

  // `filtered = data.filter` continues `data`'s column (same centre x).
  const data = after.get("data")!;
  const filtered = after.get("filtered")!;
  expect(
    Math.abs(filtered.x + filtered.width / 2 - (data.x + data.width / 2)),
  ).toBeLessThan(2);
  expect(filtered.y).toBeGreaterThan(data.y + data.height);

  const list = [...after.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      expect(overlaps(list[i]!, list[j]!)).toBe(false);

  await page.keyboard.press("ControlOrMeta+Z");
  await expect
    .poll(async () => JSON.stringify(await boxes(page)))
    .toBe(JSON.stringify(before));
});

test("with a selection only the selected components move; the button sits in the Align menu", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const before = await boxes(page);
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, "five")).click();
  await locate
    .graphNodeIcon(locate.graphNodeByBinding(page, "sum"))
    .click({ modifiers: ["Shift"] });
  await page.getByTitle("Align").click();
  const tidyButton = page.getByRole("button", { name: "Tidy Up" });
  await expect(tidyButton).toBeVisible();
  await tidyButton.click();
  await expect
    .poll(async () => JSON.stringify((await boxes(page)).get("sum")))
    .not.toBe(JSON.stringify(before.get("sum")));
  const after = await boxes(page);
  for (const [name, box] of before) {
    if (name === "five" || name === "sum") continue;
    expect(after.get(name)).toEqual(box);
  }
});
```

Adapt the selectors to the real DOM:

- how the binding text is read;
- how `ActionButton` exposes its name (title or aria-label: check
  `ActionButton.vue`);
- whether the Align dropdown's trigger has the title `Align`.

Use the existing `coloringNodes.spec.ts` as the model for selecting nodes and
opening the selection menu. If `sum` happens not to move (it is already tidy
relative to `five`), pick two components that the tidy does move.

- [ ] **Step 2: Commit, then run in WSL.**

```bash
git add app/gui/integration-test/project-view/tidyUp.spec.ts
git commit -m "Integration test: Tidy up"
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-b4 && git fetch /mnt/c/Repos/Enso/ide feature/tidy-up && git checkout -f FETCH_HEAD && corepack pnpm install --frozen-lockfile && cd app/gui && corepack pnpm run test:integration integration-test/project-view/tidyUp.spec.ts'
```

Expected: 2 passed. `~/enso-b4` is a scratch clone, and resetting it is
approved.

- [ ] **Step 3: Mutation check and loop.**
  - **Mutation check:** in the WSL clone only, make `tidy()` return immediately.
    The first test must fail. Then restore it with `git checkout -- .`.
  - **Loop:** run `tidyUp.spec.ts`, `coloringNodes.spec.ts` and
    `undoRedo.spec.ts` 3 times. All must pass.
  - If you fixed selectors, commit on Windows first and re-fetch.

---

### Task 6: Final verification, changelog, PR (controller)

The controller does this task at the finishing stage.

- [ ] **Run the full checks on the final tree.**
  - Windows: vitest, typecheck and lint for `app/gui`.
  - WSL: a prettier check of the changed `.vue` files. The Linux-only
    organize-imports issue (#19) makes this necessary.
- [ ] **Open the PR.**
  - Push and open it against `develop`. The body summarises the spec and the
    testing.
  - Add a `#### Enso IDE` CHANGELOG entry with the PR number, e.g. "[Tidy up
    lays out the graph, or the selected components, as a clean top-to-bottom
    flow][NNN], with each chain in its own column."
  - Request a Copilot review.
- [ ] **Do not merge.** This is a **feature**, so the user tests it first
      (`merge-gate-features`). Build a local installer with the recipe in
      memory, `local-windows-installer-build`, and hand it over.
