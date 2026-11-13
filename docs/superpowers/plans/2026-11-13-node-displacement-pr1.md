# Nodes Make Room (PR 1: the rule, and visualizations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Showing, hiding or resizing a node's visualization pushes the nodes in
the way, remembers where they were in the project file, and puts them back, all
in the action's own undo step.

**Architecture:** A pure function (`nodeDisplacement.ts`) takes every node's
rectangle and saved `displaced` field plus the nodes that changed, and returns
the positions and fields to write. A small adapter in the graph store
(`displacement.ts`) builds its input from node metadata and each node's measured
widget size, and the store's setters call it inside the same edit that writes
the size change. The old watcher-driven algorithm (`nodesDisplacing.ts`) is
removed.

**Tech Stack:** TypeScript, Vue 3, Yjs (`Y.UndoManager`), zod (file schema),
vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-node-displacement-design.md`. Read
it first; this plan implements its first pull request. The node height handle,
the table-editor widget and saving a node's height are the second pull request
and get their own plan.

## Global Constraints

- Use `corepack pnpm`, never bare `pnpm` or `npm`.
- In a fresh worktree run `corepack pnpm install` then
  `corepack pnpm -r compile` before any test: the GUI's vitest config imports
  the built `dist/` of sibling packages, and a stale or missing one fails at
  start-up with an error that looks unrelated
  (`does not provide an export named …`).
- Path aliases in `app/gui`: `@/` is `src/project-view/`, `$/` is `src/`.
- Run GUI unit tests with
  `corepack pnpm --filter enso-gui exec vitest run <path>`; ydoc-server's with
  `corepack pnpm --filter ydoc-server exec vitest run <path>`.
- Format every touched file with `corepack pnpm exec prettier --write <file>`
  before committing. The pre-commit hook formats staged files; do not skip it.
- The code blocks in this plan carry Prettier's Markdown formatting (double
  quotes, semicolons), which is not the repository's TypeScript style. Paste
  them as they are and let Prettier format the real file.
- The gap is at most 32px. Positions within 1px on each axis are the same
  position.
- Nothing is pushed up or left. Input nodes and nodes with no position or no
  measured size are never moved.
- The pushes are written with the default user-action origin, inside the edit of
  the action that caused them. Never `local:autoLayout`.
- A new metadata key goes last in `nodeMetadataToFile`: key order is part of the
  file format.
- This is a feature: the PR needs a `CHANGELOG.md` entry and before/after
  screenshots, and waits for the owner's OK before merging.
- Commit messages end with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File Structure

| File                                                                                                             | Change | Responsibility                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `app/ydoc-shared/src/ast/tree.ts`                                                                                | modify | The `displaced` metadata field and its type                                       |
| `app/ydoc-server/src/fileFormat.ts`                                                                              | modify | The field's file schema                                                           |
| `app/ydoc-server/src/edits.ts`                                                                                   | modify | Writing the field to the file and reading it back                                 |
| `app/gui/src/providers/openedProjects/module/carryOver.ts`                                                       | modify | The field survives a session replacement                                          |
| `app/gui/src/project-view/components/GraphEditor/graphClipboard.ts`                                              | modify | The field is not copied                                                           |
| `app/gui/src/project-view/components/GraphEditor/nodeDisplacement.ts`                                            | create | The pure layout rule                                                              |
| `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationSize.ts`                        | create | The visualization's size formula, shared by the component and the store           |
| `app/gui/src/providers/openedProjects/graph/displacement.ts`                                                     | create | Builds the rule's input from the graph and writes its output                      |
| `app/gui/src/providers/openedProjects/graph/graph.ts`                                                            | modify | Measured widget sizes; setters that call the rule                                 |
| `app/gui/src/providers/openedProjects/module/undoHold.ts`                                                        | create | Holding one undo step open                                                        |
| `app/gui/src/providers/openedProjects/module/module.ts`                                                          | modify | `undoManager.holdStep()`                                                          |
| `app/gui/src/project-view/components/resizeHandles.ts`                                                           | modify | One callback with the whole new bounds                                            |
| `GraphVisualization.vue`, `GraphNode/nodeVisualization.ts`, `GraphNode.vue`, `GraphNodes.vue`, `GraphEditor.vue` | modify | Wiring: one resize event, the held undo step, the measured size; the watcher goes |
| `nodesDragging.ts`, `selectionAlignment.ts`, `tidy/useGraphTidy.ts`, `aiNode.ts`, `stores/ongoingAiPrompts.ts`   | modify | Moves by hand and removals tell the store                                         |
| `nodesDisplacing.ts`, `__tests__/displacing.test.ts`                                                             | delete | The old algorithm                                                                 |
| `app/gui/integration-test/project-view/nodesMakeRoom.spec.ts`                                                    | create | End-to-end checks                                                                 |

---

### Task 1: The `displaced` field is saved and loaded

**Files:**

- Modify: `app/ydoc-shared/src/ast/tree.ts` (near `NodeMetadataFields`, line
  ~145)
- Modify: `app/ydoc-server/src/fileFormat.ts` (near `nodeMetadata`, line ~30)
- Modify: `app/ydoc-server/src/edits.ts` (`nodeMetadataToFile`,
  `applyNodeMetadataFromFile`, lines ~125-163)
- Test: `app/ydoc-server/src/__tests__/nodeMetadata.test.ts`

**Interfaces:**

- Produces: `NodeDisplacementMetadata` exported from `ydoc-shared/ast`;
  `NodeMetadataFields.displaced?: NodeDisplacementMetadata | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `app/ydoc-server/src/__tests__/nodeMetadata.test.ts`:

```ts
test("displaced survives a save and a load", () => {
  const displaced: Ast.NodeDisplacementMetadata = {
    home: { x: 10, y: 52 },
    at: { x: 10, y: 202 },
    by: [{ id: NODE_A as ExternalId, gap: 20, dir: "down" }],
    under: [NODE_B as ExternalId],
  };
  const saved = expression();
  saved.mutableNodeMetadata().set("position", { x: 10, y: 202 });
  saved.mutableNodeMetadata().set("displaced", displaced);
  const file = nodeMetadataToFile(saved.nodeMetadata);
  // The file's y axis points up, as for `position`.
  expect(file?.displaced).toEqual({
    home: [10, -52],
    at: [10, -202],
    by: [{ id: NODE_A, gap: 20, dir: "down" }],
    under: [NODE_B],
  });
  const parsed = parseIde({
    node: { [NODE_A]: JSON.parse(JSON.stringify(file)) },
  }).node[NODE_A]!;
  const loaded = expression();
  applyNodeMetadataFromFile(loaded.mutableNodeMetadata(), parsed);
  expect(loaded.nodeMetadata.get("displaced")).toEqual(displaced);
});

test("a node without displaced saves no such key", () => {
  const saved = expression();
  saved.mutableNodeMetadata().set("position", { x: 1, y: 2 });
  expect(
    JSON.parse(JSON.stringify(nodeMetadataToFile(saved.nodeMetadata))),
  ).toEqual({
    position: { vector: [1, -2] },
  });
});

test("a malformed displaced drops only that field", () => {
  const ide = parseIde({
    node: {
      [NODE_A]: {
        position: { vector: [1, 2] },
        colorOverride: "#ff0000",
        displaced: { home: "x" },
      },
    },
  });
  expect(ide.node[NODE_A]).toEqual({
    position: { vector: [1, 2] },
    colorOverride: "#ff0000",
  });
});

test("loading a file without displaced clears a field the document had", () => {
  const ast = expression();
  ast.mutableNodeMetadata().set("displaced", {
    home: { x: 0, y: 0 },
    at: { x: 0, y: 10 },
    by: [],
  });
  applyNodeMetadataFromFile(
    ast.mutableNodeMetadata(),
    parseIde({ node: { [NODE_A]: { position: { vector: [0, -10] } } } }).node[
      NODE_A
    ]!,
  );
  expect(ast.nodeMetadata.get("displaced")).toBeUndefined();
});
```

Add `import type { ExternalId } from 'ydoc-shared/yjsModel'` to the file's
imports.

- [ ] **Step 2: Run them and see them fail**

Run:
`corepack pnpm --filter ydoc-server exec vitest run src/__tests__/nodeMetadata.test.ts`
Expected: type errors or failures naming `displaced` /
`NodeDisplacementMetadata`.

- [ ] **Step 3: Add the field to the metadata model**

In `app/ydoc-shared/src/ast/tree.ts`, above `NodeMetadataFields`:

```ts
/**
 * Where a node was before a neighbour's size change pushed it, and what is pushing it. See
 * `docs/superpowers/specs/2026-11-13-node-displacement-design.md`.
 */
export interface NodeDisplacementMetadata {
  /** The node's position before the first push. */
  home: { x: number; y: number };
  /** The position the push gave it. A node found anywhere else was moved by something else. */
  at: { x: number; y: number };
  /** The nodes whose rectangles reach it. */
  by: { id: ExternalId; gap: number; dir: "down" | "right" }[];
  /** The nodes it overlapped at home. They do not count as taking its home. */
  under?: ExternalId[] | undefined;
}
```

Add to `NodeMetadataFields`:

```ts
  displaced?: NodeDisplacementMetadata | undefined
```

and to `nodeMetadataKeys`:

```ts
  displaced: null,
```

- [ ] **Step 4: Add the file schema**

In `app/ydoc-server/src/fileFormat.ts`, above `nodeMetadata`:

```ts
const displaced = z.object({
  home: vector,
  at: vector,
  by: z.array(
    z.object({
      id: z.string().uuid(),
      gap: z.number(),
      dir: z.enum(["down", "right"]),
    }),
  ),
  under: z.array(z.string().uuid()).optional(),
});
```

and as the last key of the `nodeMetadata` object, after `cachedAppearance`:

```ts
    // Layout state: a malformed value drops only this field, never the whole node record.
    displaced: displaced.optional().catch(() => undefined),
```

- [ ] **Step 5: Write and read it**

In `app/ydoc-server/src/edits.ts`, add above `nodeMetadataToFile`:

```ts
type FileDisplaced = NonNullable<fileFormat.NodeMetadata["displaced"]>;

function displacedToFile(
  d: Ast.NodeDisplacementMetadata | undefined,
): FileDisplaced | undefined {
  if (!d) return undefined;
  return {
    home: [Math.round(d.home.x), Math.round(-d.home.y)],
    at: [Math.round(d.at.x), Math.round(-d.at.y)],
    by: d.by.map(({ id, gap, dir }) => ({ id, gap, dir })),
    ...(d.under?.length ? { under: [...d.under] } : {}),
  };
}

function displacedFromFile(
  d: FileDisplaced | undefined,
): Ast.NodeDisplacementMetadata | undefined {
  if (!d) return undefined;
  return {
    home: { x: d.home[0], y: -d.home[1] },
    at: { x: d.at[0], y: -d.at[1] },
    by: d.by.map(({ id, gap, dir }) => ({ id: id as ExternalId, gap, dir })),
    ...(d.under?.length ? { under: d.under as ExternalId[] } : {}),
  };
}
```

(`ExternalId` comes from `ydoc-shared/yjsModel`; add it to the existing import
if it is not there.) In `nodeMetadataToFile`, after the `cachedAppearance` line:

```ts
    displaced: displacedToFile(metadata.get('displaced')),
```

At the end of `applyNodeMetadataFromFile`:

```ts
const oldDisplaced = metadata.get("displaced");
const newDisplaced = displacedFromFile(meta.displaced);
if (
  JSON.stringify(oldDisplaced ?? null) !== JSON.stringify(newDisplaced ?? null)
)
  metadata.set("displaced", newDisplaced);
```

- [ ] **Step 6: Run the tests and see them pass**

Run:
`corepack pnpm --filter ydoc-shared run compile && corepack pnpm --filter ydoc-server exec vitest run src/__tests__/nodeMetadata.test.ts`
Expected: PASS. If `-0` appears in a failure for a zero coordinate, wrap the
rounded values in `+ 0`.

- [ ] **Step 7: Run both packages' suites and commit**

Run:
`corepack pnpm --filter ydoc-shared run test:unit && corepack pnpm --filter ydoc-server run test:unit`
Expected: PASS.

```bash
git add app/ydoc-shared/src/ast/tree.ts app/ydoc-server/src
git commit -m "Node metadata: the displaced field, saved to and read from the file"
```

---

### Task 2: The field survives a session replacement and is not copied

**Files:**

- Modify: `app/gui/src/providers/openedProjects/module/carryOver.ts:13-21`
- Modify: `app/gui/src/project-view/components/GraphEditor/graphClipboard.ts`
  (`nodeStructuredData`, line ~166)
- Test:
  `app/gui/src/project-view/components/GraphEditor/__tests__/clipboard.test.ts`

**Interfaces:**

- Produces: `copiedNodeMetadata(metadata)` exported from `graphClipboard.ts`.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/clipboard.test.ts` (add `copiedNodeMetadata` to the
existing import from `@/components/GraphEditor/graphClipboard`):

```ts
test("a copied node does not carry the place it was pushed from", () => {
  const metadata = {
    position: { x: 0, y: 202 },
    colorOverride: "#ff0000",
    displaced: { home: { x: 0, y: 52 }, at: { x: 0, y: 202 }, by: [] },
  };
  expect(copiedNodeMetadata(metadata)).toEqual({
    position: { x: 0, y: 202 },
    colorOverride: "#ff0000",
  });
  expect(metadata.displaced).toBeDefined();
});
```

- [ ] **Step 2: Run it and see it fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/__tests__/clipboard.test.ts`
Expected: FAIL, `copiedNodeMetadata` is not exported.

- [ ] **Step 3: Implement**

In `graphClipboard.ts`, above `nodeStructuredData`:

```ts
/**
 * The metadata a copy of a node gets. Where a node was pushed from belongs to the original: the
 * copy is placed afresh and has no home to return to.
 */
export function copiedNodeMetadata<T extends { displaced?: unknown }>(
  metadata: T,
): Omit<T, "displaced"> {
  const copy = { ...metadata };
  delete copy.displaced;
  return copy;
}
```

and in `nodeStructuredData` replace
`metadata: node.rootExpr.serializeMetadata(),` with:

```ts
        metadata: copiedNodeMetadata(node.rootExpr.serializeMetadata()),
```

In `carryOver.ts`, add `'displaced'` to both lists:

```ts
export type CarriedNodeMetadata = Pick<
  NodeMetadataFields,
  "position" | "visualization" | "colorOverride" | "displayMode" | "displaced"
>;
const CARRIED_METADATA_KEYS = [
  "position",
  "visualization",
  "colorOverride",
  "displayMode",
  "displaced",
] as const satisfies readonly (keyof CarriedNodeMetadata)[];
```

and extend the comment above the type: "…what the user set on a node, and where
a pushed node came from (it travels with the position it explains)."

- [ ] **Step 4: Run the tests and see them pass**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/__tests__/clipboard.test.ts src/providers/openedProjects/module`
Expected: PASS. If a carry-over test compares a snapshot's metadata with an
exact object, add `displaced: undefined` handling there only if it fails.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/providers/openedProjects/module/carryOver.ts app/gui/src/project-view/components/GraphEditor
git commit -m "The displaced field is carried over a session replacement and not copied"
```

---

### Task 3: The layout rule

The whole behaviour of the feature lives here. The code below was run as written
against the tests below (20 tests, including 300 random layouts) before this
plan was committed.

Three things in it are easy to "simplify" into bugs. Leave them:

- **Which side a node is on, its gap, and whether a pusher is in line with it
  are judged at home positions; only how far a pusher reaches is read from its
  current position.** Judged on current positions, two nodes pushed in one pass
  each find the other in their way and push each other without end.
- **`under`** records the nodes a node overlapped at home, so that nodes which
  overlapped before a push return onto each other instead of dodging.
- **A pusher that vanished is treated differently from one the user removed**:
  only a removal (the pusher is named in `changes` and absent from `nodes`)
  sends its nodes home.

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/nodeDisplacement.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/__tests__/nodeDisplacement.test.ts`

**Interfaces:**

- Produces (all exported from `nodeDisplacement.ts`):
  - `MAX_GAP = 32`, `POSITION_TOLERANCE = 1`
  - `interface Point { x: number; y: number }`
  - `interface Box { left: number; top: number; right: number; bottom: number }`
  - `interface Displaced { home: Point; at: Point; by: Pusher[]; under?: string[] }`
  - `interface LayoutNode { id: string; pos: Point; size: Point; displaced?: Displaced | undefined; fixed?: boolean | undefined }`
  - `interface Change { id: string; old: Box; adds: boolean }`
  - `interface Placement { pos: Point; displaced: Displaced | undefined }`
  - `boxAt(pos: Point, size: Point): Box`
  - `relayout(nodes: readonly LayoutNode[], changes: readonly Change[], stats?: { capped: boolean }): Map<string, Placement>`

  `nodes` is every node **after** the change (a removed node is absent). A
  change gives the rectangle the node had **before**. `adds: false` means the
  node was moved by hand: the nodes it pushes are recomputed, and nothing new is
  pushed.

- [ ] **Step 1: Write the failing tests**

Create
`app/gui/src/project-view/components/GraphEditor/__tests__/nodeDisplacement.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  boxAt,
  relayout,
  type Displaced,
  type LayoutNode,
} from "../nodeDisplacement";

function node(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 32,
  extra: Partial<LayoutNode> = {},
): LayoutNode {
  return { id, pos: { x, y }, size: { x: w, y: h }, ...extra };
}

/** Resize node `id` to `size`, lay out, and return the graph with the result applied. */
function resize(
  nodes: LayoutNode[],
  id: string,
  size: { x: number; y: number },
): LayoutNode[] {
  const target = nodes.find((n) => n.id === id)!;
  const old = boxAt(target.pos, target.size);
  const next = nodes.map((n) => (n.id === id ? { ...n, size } : n));
  return apply(next, relayout(next, [{ id, old, adds: true }]));
}

function apply(
  nodes: LayoutNode[],
  placements: ReturnType<typeof relayout>,
): LayoutNode[] {
  return nodes.map((n) => {
    const p = placements.get(n.id);
    return p ? { ...n, pos: p.pos, displaced: p.displaced } : n;
  });
}

function pos(nodes: LayoutNode[], id: string) {
  return nodes.find((n) => n.id === id)!.pos;
}
function field(nodes: LayoutNode[], id: string): Displaced | undefined {
  return nodes.find((n) => n.id === id)!.displaced;
}

const OPEN = { x: 200, y: 182 };
const CLOSED = { x: 100, y: 32 };

test("a node in the way moves down and keeps the gap it had", () => {
  const after = resize([node("A", 0, 0), node("B", 0, 52)], "A", OPEN);
  expect(pos(after, "B")).toEqual({ x: 0, y: 202 });
  expect(field(after, "B")).toEqual({
    home: { x: 0, y: 52 },
    at: { x: 0, y: 202 },
    by: [{ id: "A", gap: 20, dir: "down" }],
  });
});

test("closing returns it to its exact position and removes the field", () => {
  const open = resize([node("A", 0, 0), node("B", 0, 52)], "A", OPEN);
  const closed = resize(open, "A", CLOSED);
  expect(pos(closed, "B")).toEqual({ x: 0, y: 52 });
  expect(field(closed, "B")).toBeUndefined();
});

test("the gap is at most 32", () => {
  const after = resize([node("A", 0, 0), node("B", 0, 132)], "A", OPEN);
  expect(pos(after, "B")).toEqual({ x: 0, y: 214 });
});

test("a node that is not reached does not move", () => {
  const nodes = [node("A", 0, 0), node("B", 0, 300), node("C", 300, 52)];
  const A = nodes[0]!;
  const next = nodes.map((n) => (n.id === "A" ? { ...n, size: OPEN } : n));
  expect(
    relayout(next, [{ id: "A", old: boxAt(A.pos, A.size), adds: true }]).size,
  ).toBe(0);
});

test("a pushed node pushes the node below it", () => {
  const start = [node("A", 0, 0), node("B", 0, 52), node("C", 0, 104)];
  const open = resize(start, "A", OPEN);
  expect(pos(open, "B")).toEqual({ x: 0, y: 202 });
  expect(pos(open, "C")).toEqual({ x: 0, y: 254 });
  // The visualization would reach C by itself, so C lists it too; the push from B is the larger.
  expect(field(open, "C")?.by).toEqual([
    { id: "A", gap: 32, dir: "down" },
    { id: "B", gap: 20, dir: "down" },
  ]);
  const closed = resize(open, "A", CLOSED);
  expect(closed).toEqual(start);
});

test("growing in steps ends where growing at once does, and shrinking follows", () => {
  const start = [node("A", 0, 0), node("B", 0, 52)];
  const stepped = resize(resize(start, "A", { x: 200, y: 100 }), "A", OPEN);
  expect(pos(stepped, "B")).toEqual({ x: 0, y: 202 });
  const smaller = resize(stepped, "A", { x: 200, y: 100 });
  expect(pos(smaller, "B")).toEqual({ x: 0, y: 120 });
});

test("a node beside the row moves right when the row widens", () => {
  const after = resize([node("A", 0, 0), node("D", 120, 0)], "A", {
    x: 300,
    y: 32,
  });
  expect(pos(after, "D")).toEqual({ x: 320, y: 0 });
  expect(field(after, "D")?.by).toEqual([{ id: "A", gap: 20, dir: "right" }]);
});

test("a diagonal node moves down", () => {
  const after = resize([node("A", 0, 0), node("E", 150, 60)], "A", OPEN);
  expect(pos(after, "E")).toEqual({ x: 150, y: 210 });
});

test("with two pushers the node returns part of the way, then home, in either order", () => {
  const start = [node("P1", 0, 0), node("P2", 110, 0), node("X", 50, 52, 110)];
  const one = resize(start, "P1", { x: 100, y: 182 });
  expect(pos(one, "X")).toEqual({ x: 50, y: 202 });
  const both = resize(one, "P2", { x: 100, y: 232 });
  expect(pos(both, "X")).toEqual({ x: 50, y: 252 });
  expect(field(both, "X")?.by.map((e) => e.id)).toEqual(["P1", "P2"]);

  const p2Closed = resize(both, "P2", CLOSED);
  expect(pos(p2Closed, "X")).toEqual({ x: 50, y: 202 });
  expect(resize(p2Closed, "P1", CLOSED)).toEqual(start);

  const p1Closed = resize(both, "P1", CLOSED);
  expect(pos(p1Closed, "X")).toEqual({ x: 50, y: 252 });
  expect(resize(p1Closed, "P2", CLOSED)).toEqual(start);
});

test("a node moved by hand stays where it was put and loses its home", () => {
  const open = resize([node("A", 0, 0), node("B", 0, 52)], "A", OPEN);
  const dragged = open.map((n) =>
    n.id === "B" ? { ...n, pos: { x: 300, y: 300 } } : n,
  );
  const closed = resize(dragged, "A", CLOSED);
  expect(pos(closed, "B")).toEqual({ x: 300, y: 300 });
  expect(field(closed, "B")).toBeUndefined();
});

test("a position within a pixel of the saved one is not a move by hand", () => {
  const open = resize([node("A", 0, 0), node("B", 0, 52)], "A", OPEN);
  const rounded = open.map((n) =>
    n.id === "B" ? { ...n, pos: { x: 0.4, y: 202 } } : n,
  );
  expect(pos(resize(rounded, "A", CLOSED), "B")).toEqual({ x: 0, y: 52 });
});

test("removing the pusher returns the nodes it pushed", () => {
  const open = resize(
    [node("A", 0, 0), node("B", 0, 52), node("C", 0, 104)],
    "A",
    OPEN,
  );
  const A = open.find((n) => n.id === "A")!;
  const without = open.filter((n) => n.id !== "A");
  const after = apply(
    without,
    relayout(without, [{ id: "A", old: boxAt(A.pos, A.size), adds: false }]),
  );
  expect(after).toEqual([node("B", 0, 52), node("C", 0, 104)]);
});

test("a pusher that vanished without a removal leaves the node where it is", () => {
  const stranded = node("B", 0, 202, 100, 32, {
    displaced: {
      home: { x: 0, y: 52 },
      at: { x: 0, y: 202 },
      by: [{ id: "gone", gap: 20, dir: "down" }],
    },
  });
  const nodes = [node("A", 500, 0), stranded];
  const after = apply(
    nodes,
    relayout(nodes, [
      { id: "A", old: boxAt({ x: 500, y: 0 }, CLOSED), adds: true },
    ]),
  );
  expect(pos(after, "B")).toEqual({ x: 0, y: 202 });
  expect(field(after, "B")).toBeUndefined();
});

test("input nodes and unplaced nodes are never moved", () => {
  const nodes = [
    node("A", 0, 0),
    node("I", 0, 52, 100, 32, { fixed: true }),
    node("U", Infinity, Infinity),
    node("Z", 0, 60, 0, 0),
  ];
  expect(resize(nodes, "A", OPEN)).toEqual(
    nodes.map((n) => (n.id === "A" ? { ...n, size: OPEN } : n)),
  );
});

test("a node that already overlapped the pusher is not pushed", () => {
  const nodes = [node("A", 0, 0), node("B", 0, 10)];
  expect(pos(resize(nodes, "A", OPEN), "B")).toEqual({ x: 0, y: 10 });
});

test("home taken: the node returns as far as it can and forgets its home", () => {
  const open = resize([node("A", 0, 0), node("B", 0, 52)], "A", OPEN);
  const withNew = [...open, node("Z", 0, 52)];
  const closed = resize(withNew, "A", CLOSED);
  expect(pos(closed, "B")).toEqual({ x: 0, y: 116 });
  expect(field(closed, "B")).toBeUndefined();
});

test("nodes that overlapped at home return onto each other", () => {
  const start = [node("A", 0, 0), node("B", 0, 52), node("B2", 0, 52)];
  const open = resize(start, "A", OPEN);
  expect(pos(open, "B")).toEqual({ x: 0, y: 202 });
  expect(pos(open, "B2")).toEqual({ x: 0, y: 202 });
  expect(resize(open, "A", CLOSED)).toEqual(start);
});

test("a pusher moved by hand releases its nodes and pushes nothing at its new place", () => {
  const open = resize(
    [node("A", 0, 0), node("B", 0, 52), node("Q", 500, 52)],
    "A",
    OPEN,
  );
  const A = open.find((n) => n.id === "A")!;
  const moved = open.map((n) =>
    n.id === "A" ? { ...n, pos: { x: 500, y: 0 } } : n,
  );
  const after = apply(
    moved,
    relayout(moved, [{ id: "A", old: boxAt(A.pos, A.size), adds: false }]),
  );
  expect(pos(after, "B")).toEqual({ x: 0, y: 52 });
  expect(field(after, "B")).toBeUndefined();
  expect(pos(after, "Q")).toEqual({ x: 500, y: 52 });
});

test("several nodes changing at once are laid out in the order given", () => {
  const start = [node("A", 0, 0), node("B", 0, 52), node("C", 0, 104)];
  const next = start.map((n) =>
    n.id === "C" ? n : { ...n, size: { x: 100, y: 182 } },
  );
  const after = apply(
    next,
    relayout(next, [
      { id: "A", old: boxAt({ x: 0, y: 0 }, CLOSED), adds: true },
      { id: "B", old: boxAt({ x: 0, y: 52 }, CLOSED), adds: true },
    ]),
  );
  expect(pos(after, "B")).toEqual({ x: 0, y: 202 });
  expect(pos(after, "C")).toEqual({ x: 0, y: 404 });
});

/** A small seeded generator, so a failure can be reproduced. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("random layouts: growing nodes and shrinking them back restores every position", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = mulberry32(seed);
    const int = (max: number) => Math.floor(random() * max);
    const start: LayoutNode[] = Array.from({ length: 2 + int(10) }, (_, i) =>
      node(
        `n${i}`,
        int(8) * 60,
        int(10) * 40,
        60 + int(4) * 40,
        32 + int(2) * 32,
      ),
    );
    const growers = [...start].sort(() => random() - 0.5).slice(0, 1 + int(3));
    let nodes = start;
    const stats = { capped: false };
    const change = (id: string, size: { x: number; y: number }) => {
      const target = nodes.find((n) => n.id === id)!;
      const old = boxAt(target.pos, target.size);
      const next = nodes.map((n) => (n.id === id ? { ...n, size } : n));
      nodes = apply(next, relayout(next, [{ id, old, adds: true }], stats));
    };
    for (const g of growers)
      change(g.id, {
        x: g.size.x + int(5) * 50,
        y: g.size.y + 20 + int(5) * 60,
      });
    for (const g of [...growers].sort(() => random() - 0.5))
      change(g.id, g.size);
    expect(stats.capped, `seed ${seed}`).toBe(false);
    expect(nodes, `seed ${seed}`).toEqual(start);
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/__tests__/nodeDisplacement.test.ts`
Expected: FAIL, cannot resolve `../nodeDisplacement`.

- [ ] **Step 3: Implement**

Create `app/gui/src/project-view/components/GraphEditor/nodeDisplacement.ts`:

```ts
/** @file The layout rule for nodes making room: which nodes move, and where, when a node changes size. */

/** The largest gap kept between a pusher and the node it pushes. */
export const MAX_GAP = 32;
/** Positions closer than this are the same position: the project file rounds them. */
export const POSITION_TOLERANCE = 1;
const EPS = 1e-6;

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type PushDirection = "down" | "right";
export interface Pusher {
  id: string;
  gap: number;
  dir: PushDirection;
}
export interface Displaced {
  home: Point;
  at: Point;
  by: Pusher[];
  /** Nodes this one overlapped at home. They do not count as taking its home. */
  under?: string[];
}
export interface LayoutNode {
  id: string;
  /** Top-left corner, after the change being laid out. */
  pos: Point;
  /** Full size, open visualization included, after the change. */
  size: Point;
  displaced?: Displaced | undefined;
  /** Never moved (input nodes). */
  fixed?: boolean | undefined;
}
export interface Change {
  id: string;
  /** The node's rectangle before the change. */
  old: Box;
  /** Whether nodes newly reached are pushed. False for a node moved by hand. */
  adds: boolean;
}
export interface Placement {
  pos: Point;
  displaced: Displaced | undefined;
}

/** The rectangle of a node at `pos` with `size`. */
export function boxAt(pos: Point, size: Point): Box {
  return {
    left: pos.x,
    top: pos.y,
    right: pos.x + size.x,
    bottom: pos.y + size.y,
  };
}

function near(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) <= POSITION_TOLERANCE &&
    Math.abs(a.y - b.y) <= POSITION_TOLERANCE
  );
}
function overlapsX(a: Box, b: Box): boolean {
  return a.left < b.right - EPS && b.left < a.right - EPS;
}
function overlapsY(a: Box, b: Box): boolean {
  return a.top < b.bottom - EPS && b.top < a.bottom - EPS;
}
function overlaps(a: Box, b: Box): boolean {
  return overlapsX(a, b) && overlapsY(a, b);
}

/**
 * The push a node gets when a pusher grows to `now`, if it is reached. Which side the node is on,
 * and the gap it keeps, are judged where both nodes were before anything was pushed (`old` and
 * `node` are home rectangles): judged on current positions, two nodes pushed in one pass could each
 * find the other in its way.
 */
function firstContact(
  old: Box,
  now: Box,
  nowAtHome: Box,
  node: Box,
): Omit<Pusher, "id"> | undefined {
  const below = node.top - old.bottom;
  if (below >= -EPS) {
    const gap = Math.min(MAX_GAP, Math.max(0, below));
    return overlapsX(nowAtHome, node) && node.top < now.bottom + gap - EPS
      ? { gap, dir: "down" }
      : undefined;
  }
  const rightOf = node.left - old.right;
  if (rightOf >= -EPS) {
    const gap = Math.min(MAX_GAP, Math.max(0, rightOf));
    return overlapsY(nowAtHome, node) && node.left < now.right + gap - EPS
      ? { gap, dir: "right" }
      : undefined;
  }
  return undefined;
}

interface State {
  id: string;
  pos: Point;
  size: Point;
  displaced: Displaced | undefined;
  fixed: boolean;
  /** Has a position and a measured size. */
  placed: boolean;
}

/**
 * Lay out the nodes after `changes`. `nodes` is every node of the graph as it is after the change
 * (a removed node is absent); each change names a node whose rectangle changed and gives the
 * rectangle it had. Returns the nodes whose position or `displaced` field must be written.
 */
export function relayout(
  nodes: readonly LayoutNode[],
  changes: readonly Change[],
  stats?: { capped: boolean },
): Map<string, Placement> {
  const state = new Map<string, State>();
  for (const n of nodes) {
    const placed =
      Number.isFinite(n.pos.x) &&
      Number.isFinite(n.pos.y) &&
      n.size.x > 0 &&
      n.size.y > 0;
    state.set(n.id, {
      id: n.id,
      pos: { ...n.pos },
      size: n.size,
      displaced: n.displaced,
      fixed: n.fixed ?? false,
      placed,
    });
  }
  const removed = new Set(
    changes.filter((c) => !state.has(c.id)).map((c) => c.id),
  );
  const box = (id: string): Box | undefined => {
    const s = state.get(id);
    return s?.placed ? boxAt(s.pos, s.size) : undefined;
  };
  const homeBox = (s: State): Box => boxAt(s.displaced?.home ?? s.pos, s.size);

  /** Nodes that moved back towards home, with the direction to step aside in. */
  const returned = new Map<string, PushDirection>();

  /** Set the node's position from its field. Returns whether it moved. */
  function recompute(s: State): boolean {
    const d = s.displaced;
    if (!d) return false;
    const dodge = d.by[0]?.dir ?? "down";
    let dx = 0;
    let dy = 0;
    const kept: Pusher[] = [];
    // How far a pusher reaches is read from where it is now. Whether it is in line with this node
    // is read from where both were at home, so two nodes pushed together stay in line.
    const home = boxAt(d.home, s.size);
    const pusherAtHome = (id: string) => homeBox(state.get(id)!);
    for (const e of d.by) {
      if (e.dir !== "right") continue;
      const pusher = box(e.id);
      if (!pusher) continue;
      const need = pusher.right + e.gap - home.left;
      if (need > EPS && overlapsY(pusherAtHome(e.id), home)) {
        dx = Math.max(dx, need);
        kept.push(e);
      }
    }
    for (const e of d.by) {
      if (e.dir !== "down") continue;
      const pusher = box(e.id);
      if (!pusher) continue;
      const need = pusher.bottom + e.gap - home.top;
      if (need > EPS && overlapsX(pusherAtHome(e.id), home)) {
        dy = Math.max(dy, need);
        kept.push(e);
      }
    }
    const pos = { x: d.home.x + dx, y: d.home.y + dy };
    const moved = pos.x !== s.pos.x || pos.y !== s.pos.y;
    if (pos.x < s.pos.x - EPS || pos.y < s.pos.y - EPS)
      returned.set(s.id, dodge);
    s.pos = pos;
    s.displaced = kept.length > 0 ? { ...d, at: pos, by: kept } : undefined;
    if (!s.displaced) homes.set(s.id, d);
    return moved;
  }
  /** The field a node had before it went home in this pass. */
  const homes = new Map<string, Displaced>();

  const queue: Change[] = changes.filter((c) => state.has(c.id));

  // Check the saved fields.
  for (const s of state.values()) {
    const d = s.displaced;
    if (!d) continue;
    if (!near(d.at, s.pos)) {
      // Moved by something else: it stays where it was put.
      s.displaced = undefined;
      continue;
    }
    const live = d.by.filter((e) => state.has(e.id));
    if (live.length === d.by.length) continue;
    const pusherRemoved = d.by.some((e) => removed.has(e.id));
    if (live.length === 0 && !pusherRemoved) {
      // Its pushers vanished without a removal by the user: it stays where it is.
      s.displaced = undefined;
      continue;
    }
    s.displaced = { ...d, by: live };
    if (pusherRemoved) {
      const old = boxAt(s.pos, s.size);
      if (recompute(s)) queue.push({ id: s.id, old, adds: false });
    }
  }

  const cap = (state.size + 1) * (state.size + 1) * 4;
  let steps = 0;
  while (queue.length > 0) {
    if (steps++ >= cap) {
      if (stats) stats.capped = true;
      break;
    }
    const item = queue.shift()!;
    const now = box(item.id);
    if (!now) continue;
    const grew =
      now.bottom > item.old.bottom + EPS || now.right > item.old.right + EPS;
    const pusherHome = state.get(item.id)!.displaced?.home ?? {
      x: item.old.left,
      y: item.old.top,
    };
    const oldAtHome = boxAt(pusherHome, {
      x: item.old.right - item.old.left,
      y: item.old.bottom - item.old.top,
    });
    for (const s of state.values()) {
      if (s.id === item.id || s.fixed || !s.placed) continue;
      const before = boxAt(s.pos, s.size);
      let moved = false;
      if (s.displaced?.by.some((e) => e.id === item.id)) {
        moved = recompute(s);
      } else if (item.adds && grew) {
        const atHome = homeBox(s);
        const contact = firstContact(
          oldAtHome,
          now,
          homeBox(state.get(item.id)!),
          atHome,
        );
        if (contact) {
          if (!s.displaced) {
            const under = [...state.values()]
              .filter(
                (o) =>
                  o.id !== s.id &&
                  o.id !== item.id &&
                  o.placed &&
                  overlaps(homeBox(o), atHome),
              )
              .map((o) => o.id);
            s.displaced = {
              home: { ...s.pos },
              at: { ...s.pos },
              by: [],
              ...(under.length > 0 ? { under } : {}),
            };
          }
          s.displaced = {
            ...s.displaced,
            by: [...s.displaced.by, { id: item.id, ...contact }],
          };
          moved = recompute(s);
        }
      }
      if (moved) queue.push({ id: s.id, old: before, adds: item.adds });
    }
  }

  // Home taken: a node that came back onto a node that was not there before steps clear of it and
  // forgets its home.
  for (const [id, dir] of returned) {
    const s = state.get(id)!;
    const field = s.displaced ?? homes.get(id);
    const allowed = new Set([
      ...(field?.under ?? []),
      ...(field?.by.map((e) => e.id) ?? []),
    ]);
    for (let guard = 0; guard <= state.size; guard++) {
      const mine = boxAt(s.pos, s.size);
      const blocker = [...state.values()].find(
        (o) =>
          o.id !== id &&
          o.placed &&
          !allowed.has(o.id) &&
          overlaps(mine, boxAt(o.pos, o.size)),
      );
      if (!blocker) break;
      const theirs = boxAt(blocker.pos, blocker.size);
      s.pos =
        dir === "down"
          ? { x: s.pos.x, y: theirs.bottom + MAX_GAP }
          : { x: theirs.right + MAX_GAP, y: s.pos.y };
      s.displaced = undefined;
    }
  }

  const result = new Map<string, Placement>();
  for (const n of nodes) {
    const s = state.get(n.id)!;
    const samePos = s.pos.x === n.pos.x && s.pos.y === n.pos.y;
    const sameField =
      JSON.stringify(s.displaced ?? null) ===
      JSON.stringify(n.displaced ?? null);
    if (!samePos || !sameField)
      result.set(n.id, { pos: s.pos, displaced: s.displaced });
  }
  return result;
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run the command from step 2. Expected: 20 passed.

- [ ] **Step 5: Commit**

```bash
corepack pnpm exec prettier --write app/gui/src/project-view/components/GraphEditor/nodeDisplacement.ts app/gui/src/project-view/components/GraphEditor/__tests__/nodeDisplacement.test.ts
git add app/gui/src/project-view/components/GraphEditor/nodeDisplacement.ts app/gui/src/project-view/components/GraphEditor/__tests__/nodeDisplacement.test.ts
git commit -m "The layout rule for nodes making room"
```

---

### Task 4: The visualization's size as a shared function

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationSize.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization.vue:19-26,151-155`
- Test:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/__tests__/visualizationSize.test.ts`

**Interfaces:**

- Produces:
  `visualizationSize(width: Opt<number>, height: Opt<number>, nodeWidth: number): Vec2`;
  `interface VisualizationResize { width?: number; height?: number; position?: Vec2 }`.

- [ ] **Step 1: Write the failing test**

```ts
import { visualizationSize } from "@/components/GraphEditor/GraphVisualization/visualizationSize";
import { Vec2 } from "@/util/data/vec2";
import { expect, test } from "vitest";

test.each([
  {
    name: "defaults",
    width: null,
    height: null,
    node: 120,
    expected: new Vec2(200, 150),
  },
  {
    name: "saved size",
    width: 500,
    height: 300,
    node: 120,
    expected: new Vec2(500, 300),
  },
  {
    name: "never narrower than the node",
    width: 250,
    height: null,
    node: 400,
    expected: new Vec2(400, 150),
  },
  {
    name: "never below the minimum",
    width: 50,
    height: 10,
    node: 120,
    expected: new Vec2(200, 32),
  },
])("visualizationSize: $name", ({ width, height, node, expected }) => {
  expect(visualizationSize(width, height, node)).toEqual(expected);
});
```

- [ ] **Step 2: Run it and see it fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/GraphVisualization/__tests__/visualizationSize.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement**

Create `visualizationSize.ts`:

```ts
/** @file The size a node's visualization is drawn at. */
import type { Opt } from "@/util/data/opt";
import { Vec2 } from "@/util/data/vec2";

/**
 * The minimum width must be at least the total width of:
 * - both of toolbars that are always visible (32px + 60px), and
 * - the 4px flex gap between the toolbars.
 */
export const MIN_WIDTH_PX = 200;
export const MIN_CONTENT_HEIGHT_PX = 32;
export const DEFAULT_CONTENT_HEIGHT_PX = 150;

/**
 * The size of a visualization with the given saved `width` and `height`, under a node whose
 * widgets are `nodeWidth` wide. The graph store uses this to know a visualization's rectangle
 * before it is drawn, so the component must not size itself any other way.
 */
export function visualizationSize(
  width: Opt<number>,
  height: Opt<number>,
  nodeWidth: number,
): Vec2 {
  return new Vec2(
    Math.max(width ?? 0, nodeWidth, MIN_WIDTH_PX),
    Math.max(height ?? DEFAULT_CONTENT_HEIGHT_PX, MIN_CONTENT_HEIGHT_PX),
  );
}

/** A change made with a visualization's resize handles. `position` is set by the left handle. */
export interface VisualizationResize {
  width?: number;
  height?: number;
  position?: Vec2;
}
```

In `GraphVisualization.vue`, delete the three constants and their comment (lines
19-26), import
`import { visualizationSize } from '@/components/GraphEditor/GraphVisualization/visualizationSize'`,
and replace the `vizWidth`/`vizHeight`/`vizSize` computeds (lines 151-155) with:

```ts
const vizSize = computed<Vec2>(() =>
  visualizationSize(props.width, props.height, props.nodeSize.x),
);
const vizWidth = computed<number>(() => vizSize.value.x);
const vizHeight = computed<number>(() => vizSize.value.y);
```

- [ ] **Step 4: Run the test and the type check**

Run the command from step 2, then
`corepack pnpm --filter enso-gui run typecheck`. Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/components/GraphEditor
git commit -m "The visualization's size formula is a shared function"
```

---

### Task 5: The graph store lays out around a change

**Files:**

- Create: `app/gui/src/providers/openedProjects/graph/displacement.ts`
- Modify: `app/gui/src/providers/openedProjects/graph/graph.ts` (`nodeState`
  line ~143, `deleteNodes` line ~334, `setNodeVisualization` line ~418, the
  returned object line ~702)
- Test:
  `app/gui/src/providers/openedProjects/graph/__tests__/displacement.test.ts`

**Interfaces:**

- Consumes: `relayout`, `boxAt`, `Box`, `Change`, `LayoutNode` (Task 3);
  `visualizationSize` (Task 4); `NodeDisplacementMetadata` (Task 1).
- Produces, from `displacement.ts`:
  - `nodeBox(position: Vec2, bare: Vec2, vis: Opt<VisualizationMetadata>): Box`
  - `interface NodeChange { vis?: Opt<VisualizationMetadata>; position?: Vec2 }`
  - `createDisplacement(deps: DisplacementDeps): { afterChange(updates: ReadonlyMap<NodeId, NodeChange>, adds: boolean, edit?: MutableModule): void; afterRemoval(ids: Iterable<NodeId>, edit?: MutableModule): void }`
- Produces, on the graph store:
  - `nodeBareSizes: Map<NodeId, Vec2>` (a node's size without its visualization)
  - `setNodeVisualization(nodeId: NodeId, update: Partial<VisualizationMetadata>, position?: Vec2): void`
  - `setNodesVisualization(updates: Iterable<readonly [NodeId, Partial<VisualizationMetadata>]>, positions?: ReadonlyMap<NodeId, Vec2>): void`
  - `setNodePositions(moves: Iterable<readonly [NodeId, Vec2]>): void` (a move
    by hand: releases what the moved nodes were pushing)
  - `releasePushedBy(ids: Iterable<NodeId>, edit?: MutableModule): void`

**The one ordering rule in this task:** lay out **before** writing the change.
The node database is updated after the edit commits, so inside the edit it still
describes the graph as it was; the adapter is given the change as overrides and
reads everything else from the database.

- [ ] **Step 1: Write the failing tests**

Create
`app/gui/src/providers/openedProjects/graph/__tests__/displacement.test.ts`:

```ts
import {
  createDisplacement,
  nodeBox,
  type NodeChange,
} from "$/providers/openedProjects/graph/displacement";
import type { NodeId } from "$/providers/openedProjects/graph/graphDatabase";
import { Vec2 } from "@/util/data/vec2";
import { expect, test } from "vitest";
import type { NodeDisplacementMetadata } from "ydoc-shared/ast";
import type { VisualizationMetadata } from "ydoc-shared/yjsModel";

const SHOWN: VisualizationMetadata = {
  identifier: null,
  visible: true,
  width: null,
  height: null,
};

interface Spec {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  vis?: VisualizationMetadata;
  fixed?: boolean;
}

function graph(specs: Spec[]) {
  const nodes = new Map(
    specs.map((s) => [
      s.id as NodeId,
      {
        id: s.id as NodeId,
        position: new Vec2(s.x, s.y),
        vis: s.vis,
        fixed: s.fixed ?? false,
      },
    ]),
  );
  const bare = new Map(
    specs.map((s) => [s.id as NodeId, new Vec2(s.w ?? 100, s.h ?? 32)]),
  );
  const displaced = new Map<NodeId, NodeDisplacementMetadata>();
  const displacement = createDisplacement({
    nodes: () => nodes.values(),
    bareSize: (id) => bare.get(id),
    readDisplaced: (id) => displaced.get(id),
    write: (id, placement) => {
      nodes.get(id)!.position = placement.position;
      if (placement.displaced) displaced.set(id, placement.displaced);
      else displaced.delete(id);
    },
  });
  /** What the store does: lay out, then write the change itself. */
  function change(id: string, update: NodeChange, adds = true) {
    displacement.afterChange(new Map([[id as NodeId, update]]), adds);
    const node = nodes.get(id as NodeId)!;
    if ("vis" in update) node.vis = update.vis ?? undefined;
    if (update.position) node.position = update.position;
  }
  const y = (id: string) => nodes.get(id as NodeId)!.position.y;
  const x = (id: string) => nodes.get(id as NodeId)!.position.x;
  return { nodes, displaced, displacement, change, x, y };
}

test("nodeBox: the visualization sits under the node and may be wider", () => {
  expect(nodeBox(new Vec2(10, 20), new Vec2(100, 32), undefined)).toEqual({
    left: 10,
    top: 20,
    right: 110,
    bottom: 52,
  });
  expect(nodeBox(new Vec2(10, 20), new Vec2(100, 32), SHOWN)).toEqual({
    left: 10,
    top: 20,
    right: 210,
    bottom: 202,
  });
  expect(
    nodeBox(new Vec2(0, 0), new Vec2(100, 32), { ...SHOWN, visible: false }),
  ).toEqual({
    left: 0,
    top: 0,
    right: 100,
    bottom: 32,
  });
});

test("showing a visualization pushes the node below, hiding it puts it back", () => {
  const g = graph([
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 0, y: 52 },
  ]);
  g.change("A", { vis: SHOWN });
  expect(g.y("B")).toBe(202);
  expect(g.displaced.get("B" as NodeId)?.home).toEqual({ x: 0, y: 52 });
  g.change("A", { vis: undefined });
  expect(g.y("B")).toBe(52);
  expect(g.displaced.size).toBe(0);
});

test("widening by the right handle pushes right; by the left handle pushes nothing", () => {
  const start: Spec[] = [
    { id: "A", x: 0, y: 0, vis: SHOWN },
    { id: "C", x: 220, y: 40 },
  ];
  const right = graph(start);
  right.change("A", { vis: { ...SHOWN, width: 300 } });
  expect(right.x("C")).toBe(320);

  const left = graph(start);
  left.change("A", {
    vis: { ...SHOWN, width: 300 },
    position: new Vec2(-100, 0),
  });
  expect(left.x("C")).toBe(220);
  expect(left.displaced.size).toBe(0);
});

test("several nodes changing at once are handled top to bottom, whatever the order given", () => {
  const g = graph([
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 0, y: 52 },
    { id: "C", x: 0, y: 104 },
  ]);
  g.displacement.afterChange(
    new Map([
      ["B" as NodeId, { vis: SHOWN }],
      ["A" as NodeId, { vis: SHOWN }],
    ]),
    true,
  );
  expect(g.y("B")).toBe(202);
  expect(g.y("C")).toBe(404);
});

test("a pusher moved by hand releases its nodes and pushes nothing new", () => {
  const g = graph([
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 0, y: 52 },
    { id: "Q", x: 500, y: 52 },
  ]);
  g.change("A", { vis: SHOWN });
  g.change("A", { position: new Vec2(500, 0) }, false);
  expect(g.y("B")).toBe(52);
  expect(g.y("Q")).toBe(52);
});

test("a pushed node moved by hand loses its home at the next layout", () => {
  const g = graph([
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 0, y: 52 },
  ]);
  g.change("A", { vis: SHOWN });
  g.change("B", { position: new Vec2(300, 300) }, false);
  expect(g.displaced.size).toBe(0);
  g.change("A", { vis: undefined });
  expect(g.nodes.get("B" as NodeId)!.position).toEqual(new Vec2(300, 300));
});

test("removing a pusher returns the nodes it pushed", () => {
  const g = graph([
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 0, y: 52 },
  ]);
  g.change("A", { vis: SHOWN });
  g.displacement.afterRemoval(["A" as NodeId]);
  expect(g.y("B")).toBe(52);
});

test("a node with no measured size neither moves nor pushes", () => {
  const g = graph([
    { id: "A", x: 0, y: 0, w: 0, h: 0 },
    { id: "B", x: 0, y: 52 },
  ]);
  g.change("A", { vis: SHOWN });
  expect(g.y("B")).toBe(52);
});
```

- [ ] **Step 2: Run them and see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/graph/__tests__/displacement.test.ts`
Expected: FAIL, cannot resolve `displacement`.

- [ ] **Step 3: Implement the adapter**

Create `app/gui/src/providers/openedProjects/graph/displacement.ts`:

```ts
/** @file Lays the graph out around a node that changed size: the graph store's side of `nodeDisplacement`. */
import type { NodeId } from "$/providers/openedProjects/graph/graphDatabase";
import { visualizationSize } from "@/components/GraphEditor/GraphVisualization/visualizationSize";
import {
  boxAt,
  relayout,
  type Box,
  type Change,
  type LayoutNode,
} from "@/components/GraphEditor/nodeDisplacement";
import type { Opt } from "@/util/data/opt";
import { Vec2 } from "@/util/data/vec2";
import type { MutableModule, NodeDisplacementMetadata } from "ydoc-shared/ast";
import type { VisualizationMetadata } from "ydoc-shared/yjsModel";

/** A node as the layout sees it. */
export interface DisplacementNode {
  id: NodeId;
  position: Vec2;
  vis: Opt<VisualizationMetadata>;
  /** Never moved: an input node. */
  fixed: boolean;
}

/** What a change sets on a node. An absent key leaves that part as it is. */
export interface NodeChange {
  vis?: Opt<VisualizationMetadata>;
  position?: Vec2;
}

export interface DisplacementDeps {
  /** Every node of the current graph, as it is before the change being laid out. */
  nodes(): Iterable<DisplacementNode>;
  /** The node's measured size without its visualization. */
  bareSize(id: NodeId): Vec2 | undefined;
  readDisplaced(id: NodeId): NodeDisplacementMetadata | undefined;
  write(
    id: NodeId,
    placement: {
      position: Vec2;
      displaced: NodeDisplacementMetadata | undefined;
    },
    edit?: MutableModule,
  ): void;
}

/**
 * A node's rectangle, computed, not measured: the measured rectangles lag the metadata by a frame
 * and include a previewed visualization. The visualization sits below the node's widgets and is at
 * least as wide as them.
 */
export function nodeBox(
  position: Vec2,
  bare: Vec2,
  vis: Opt<VisualizationMetadata>,
): Box {
  if (!vis?.visible) return boxAt(position, bare);
  const viz = visualizationSize(vis.width, vis.height, bare.x);
  return boxAt(position, { x: Math.max(bare.x, viz.x), y: bare.y + viz.y });
}

const NO_BOX: Box = { left: 0, top: 0, right: 0, bottom: 0 };

/** The layout of the graph around nodes that change. */
export function createDisplacement(deps: DisplacementDeps) {
  function layoutNodes(
    updates: ReadonlyMap<NodeId, NodeChange>,
    without: ReadonlySet<NodeId>,
  ): { nodes: LayoutNode[]; oldBoxes: Map<NodeId, Box> } {
    const nodes: LayoutNode[] = [];
    const oldBoxes = new Map<NodeId, Box>();
    for (const node of deps.nodes()) {
      const bare = deps.bareSize(node.id);
      const measured = bare != null && bare.x > 0 && bare.y > 0;
      if (measured)
        oldBoxes.set(node.id, nodeBox(node.position, bare, node.vis));
      if (without.has(node.id)) continue;
      const update = updates.get(node.id);
      const position = update?.position ?? node.position;
      const vis = update && "vis" in update ? update.vis : node.vis;
      const box = measured ? nodeBox(position, bare, vis) : undefined;
      nodes.push({
        id: node.id,
        pos: { x: position.x, y: position.y },
        size: box
          ? { x: box.right - box.left, y: box.bottom - box.top }
          : { x: 0, y: 0 },
        displaced: deps.readDisplaced(node.id),
        fixed: node.fixed,
      });
    }
    return { nodes, oldBoxes };
  }

  function apply(nodes: LayoutNode[], changes: Change[], edit?: MutableModule) {
    for (const [id, placement] of relayout(nodes, changes)) {
      deps.write(
        id as NodeId,
        {
          position: new Vec2(placement.pos.x, placement.pos.y),
          displaced: placement.displaced as
            NodeDisplacementMetadata | undefined,
        },
        edit,
      );
    }
  }

  return {
    /**
     * Lay out around nodes that are about to change. Call this before writing the change. With
     * `adds` false the nodes were moved by hand: what they pushed is released and nothing new is
     * pushed.
     */
    afterChange(
      updates: ReadonlyMap<NodeId, NodeChange>,
      adds: boolean,
      edit?: MutableModule,
    ) {
      const { nodes, oldBoxes } = layoutNodes(updates, new Set());
      const changes = [...updates.keys()]
        .flatMap((id): Change[] => {
          const old = oldBoxes.get(id);
          return old ? [{ id, old, adds }] : [];
        })
        // Top to bottom, so the result does not depend on the order of a selection.
        .sort((a, b) => a.old.top - b.old.top);
      apply(nodes, changes, edit);
    },
    /** Lay out after the user removed nodes: what they pushed returns. */
    afterRemoval(ids: Iterable<NodeId>, edit?: MutableModule) {
      const without = new Set(ids);
      const { nodes, oldBoxes } = layoutNodes(new Map(), without);
      const changes = [...without].map((id): Change => ({
        id,
        old: oldBoxes.get(id) ?? NO_BOX,
        adds: false,
      }));
      apply(nodes, changes, edit);
    },
  };
}
```

- [ ] **Step 4: Run the adapter's tests and see them pass**

Run the command from step 2. Expected: PASS.

- [ ] **Step 5: Wire it into the store**

In `graph.ts`:

1. Add to `nodeState` (line ~143), and document it:

```ts
    /** Each node's measured size without its visualization, reported by `GraphNode`. */
    nodeBareSizes: useAssociatedValue<NodeId, Vec2>({ onCleanup }),
```

2. After `setNodePosition` is defined, create the adapter:

```ts
const displacement = createDisplacement({
  nodes: function* () {
    for (const [id, node] of db.nodeIdToNode.entries())
      yield {
        id,
        position: node.position,
        vis: node.vis,
        fixed: node.type === "input",
      };
  },
  bareSize: (id) => nodeState.nodeBareSizes.get(id),
  readDisplaced: (id) =>
    module.mutableNodeMetadata(db.idFromExternal(id))?.get("displaced"),
  write: (id, { position, displaced }, edit) => {
    const metadata = module.mutableNodeMetadata(db.idFromExternal(id), edit);
    if (!metadata) return;
    const oldPos = metadata.get("position");
    if (oldPos?.x !== position.x || oldPos?.y !== position.y)
      metadata.set(
        "position",
        normalizePosition({ ...oldPos, ...position.xy() }),
      );
    metadata.set("displaced", displaced);
  },
});
```

3. Replace `setNodeVisualization` with:

```ts
/**
 * Set nodes' visualization metadata, making room for a visualization that grows and letting the
 * neighbours back when it shrinks, in the same edit. `positions` moves nodes in that edit too:
 * the left resize handle changes a width and a position together.
 */
function setNodesVisualization(
  updates: Iterable<readonly [NodeId, Partial<VisualizationMetadata>]>,
  positions?: ReadonlyMap<NodeId, Vec2>,
) {
  module.batchEdits(() => {
    const changes = new Map<
      NodeId,
      { vis: VisualizationMetadata | undefined; position?: Vec2 }
    >();
    for (const [nodeId, update] of updates) {
      const metadata = module.mutableNodeMetadata(db.idFromExternal(nodeId));
      if (!metadata) continue;
      const data = Object.assign(
        { ...VIS_METADATA_DEFAULTS },
        metadata.get("visualization"),
        update,
      );
      const vis = visMetadataEquals(data, VIS_METADATA_DEFAULTS)
        ? undefined
        : data;
      const position = positions?.get(nodeId);
      changes.set(nodeId, { vis, ...(position ? { position } : {}) });
    }
    // Lay out first: until this edit commits, the node database describes the graph as it was.
    displacement.afterChange(changes, true);
    for (const [nodeId, { vis, position }] of changes) {
      module
        .mutableNodeMetadata(db.idFromExternal(nodeId))
        ?.set("visualization", vis);
      if (position) setNodePosition(nodeId, position);
    }
  });
}

function setNodeVisualization(
  nodeId: NodeId,
  update: Partial<VisualizationMetadata>,
  position?: Vec2,
) {
  setNodesVisualization(
    [[nodeId, update]],
    position && new Map([[nodeId, position]]),
  );
}

/**
 * Move nodes by hand (a finished drag, Align, Spacing, Tidy up). The nodes they were pushing
 * return, and a moved node forgets the place it was pushed from.
 */
function setNodePositions(moves: Iterable<readonly [NodeId, Vec2]>) {
  const positions = new Map(moves);
  if (positions.size === 0) return;
  module.batchEdits(() => {
    displacement.afterChange(
      new Map(Array.from(positions, ([id, position]) => [id, { position }])),
      false,
    );
    for (const [id, position] of positions) setNodePosition(id, position);
  });
}

/** The user removed these nodes: the nodes they were pushing return, in `edit` when given. */
function releasePushedBy(ids: Iterable<NodeId>, edit?: Ast.MutableModule) {
  displacement.afterRemoval(ids, edit);
}
```

(Use whatever name the file already imports the AST namespace under for
`MutableModule`; `deleteNodes` in the same file receives one as `edit`.)

4. In `deleteNodes`, immediately before its `return Ok()`:

```ts
displacement.afterRemoval(deletedNodes, edit);
```

5. Add `setNodesVisualization`, `setNodePositions` and `releasePushedBy` to the
   returned object beside `setNodeVisualization`. `nodeBareSizes` is exported by
   the existing `...nodeState` spread.

6. Imports: `createDisplacement` from
   `'$/providers/openedProjects/graph/displacement'`.

- [ ] **Step 6: Type-check and run the graph tests**

Run:
`corepack pnpm --filter enso-gui run typecheck && corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/graph`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/gui/src/providers/openedProjects/graph
git commit -m "Graph store: lay out around a visualization change, a move by hand and a removal"
```

---

### Task 6: Holding one undo step open

**Files:**

- Create: `app/gui/src/providers/openedProjects/module/undoHold.ts`
- Modify: `app/gui/src/providers/openedProjects/module/module.ts:210-222` (the
  `undoManager` wrapper)
- Test: `app/gui/src/providers/openedProjects/module/__tests__/undoHold.test.ts`

**Interfaces:**

- Produces: `holdUndoStep(manager: Y.UndoManager): () => void`;
  `module.undoManager.holdStep(): () => void`.

Background: `Y.UndoManager` merges a change into the previous undo step when it
arrives within `captureTimeout` (500ms by default) of the last one, and
`stopCapturing()` forces the next change to start a new step. A handle drag
writes on every frame, so a pause of half a second mid-drag splits it.

- [ ] **Step 1: Write the failing tests**

```ts
import { holdUndoStep } from "$/providers/openedProjects/module/undoHold";
import { expect, test } from "vitest";
import * as Y from "yjs";

function setup() {
  const doc = new Y.Doc();
  const map = doc.getMap<number>("m");
  // A zero timeout makes every change its own step, as a pause longer than the default would.
  const manager = new Y.UndoManager([map], { captureTimeout: 0 });
  return { map, manager };
}

test("changes made while a step is held undo together, and apart from their neighbours", () => {
  const { map, manager } = setup();
  map.set("before", 1);
  const release = holdUndoStep(manager);
  map.set("drag1", 1);
  map.set("drag2", 1);
  release();
  map.set("after", 1);

  manager.undo();
  expect([...map.keys()].sort()).toEqual(["before", "drag1", "drag2"]);
  manager.undo();
  expect([...map.keys()]).toEqual(["before"]);
  manager.undo();
  expect([...map.keys()]).toEqual([]);
});

test("releasing restores the timeout, and a second release does nothing", () => {
  const { manager } = setup();
  const release = holdUndoStep(manager);
  expect(manager.captureTimeout).toBe(Number.POSITIVE_INFINITY);
  release();
  expect(manager.captureTimeout).toBe(0);
  manager.captureTimeout = 500;
  release();
  expect(manager.captureTimeout).toBe(500);
});
```

- [ ] **Step 2: Run them and see them fail**

Run:
`corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/module/__tests__/undoHold.test.ts`
Expected: FAIL, cannot resolve `undoHold`.

- [ ] **Step 3: Implement**

Create `undoHold.ts`:

```ts
/** @file Keeping a run of edits in one undo step. */
import type * as Y from "yjs";

/**
 * Make every change from now until the returned function is called one undo step, however long
 * the gaps between them: a resize drag writes on every frame, and a pause in it must not split
 * the undo. The step is separate from the changes before and after it.
 *
 * The returned function must be called, or every later change joins the step. Calling it again
 * does nothing.
 */
export function holdUndoStep(manager: Y.UndoManager): () => void {
  manager.stopCapturing();
  const timeout = manager.captureTimeout;
  manager.captureTimeout = Number.POSITIVE_INFINITY;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    manager.captureTimeout = timeout;
    manager.stopCapturing();
  };
}
```

In `module.ts`, add to the `undoManager` object, after `undoStackBoundary`:

```ts
      /** Keep the changes from now until the returned function is called in one undo step. */
      holdStep(): () => void {
        const manager = moduleModel.value?.undoManager
        return manager ? holdUndoStep(manager) : () => {}
      },
```

and import `holdUndoStep` from `'$/providers/openedProjects/module/undoHold'`.

- [ ] **Step 4: Run the tests and see them pass**

Run the command from step 2. Expected: PASS. If the first test fails at the
first `undo()` with all five keys still present, the Yjs version in use merges a
change after `stopCapturing()` when the timeout is infinite: check
`UndoManager.js` for the `this.lastChange > 0` guard (present in 13.6.32) and
stop to report it rather than working around it.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/providers/openedProjects/module
git commit -m "Undo: hold one step open across a run of edits"
```

---

### Task 7: The components use the store, and the old algorithm goes

After this task the feature works end to end for showing, hiding and resizing a
visualization.

**Files:**

- Modify: `app/gui/src/project-view/components/resizeHandles.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization.vue`
  (emits lines 50-61, handles lines 160-195)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphNode/nodeVisualization.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor/GraphNode.vue` (emits
  line ~66, lines ~102-123, ~203-222, template line ~524)
- Modify: `app/gui/src/project-view/components/GraphEditor/GraphNodes.vue:83-85`
- Modify: `app/gui/src/project-view/components/GraphEditor.vue:361-375`
- Delete: `app/gui/src/project-view/components/GraphEditor/nodesDisplacing.ts`,
  `app/gui/src/project-view/components/GraphEditor/__tests__/displacing.test.ts`

**Interfaces:**

- Consumes: `VisualizationResize` (Task 4); `graph.setNodeVisualization`,
  `graph.setNodesVisualization`, `graph.nodeBareSizes` (Task 5);
  `module.undoManager.holdStep` (Task 6).
- Produces: `GraphVisualization` emits `resize: [change: VisualizationResize]`
  and no longer emits `update:width`, `update:height`, `update:nodePosition`;
  `GraphNode` emits `resizeVisualization: [change: VisualizationResize]` and no
  longer emits `update:visualizationWidth`, `update:visualizationHeight`.

- [ ] **Step 1: One callback with the whole new bounds**

In `resizeHandles.ts`, add to `ResizeHandlesEventRegistry`:

```ts
  /** The bounds after each step of a drag, and the sides being dragged. */
  onBoundsChange: (callback: (bounds: Rect, resizing: BoundsSet) => void) => void
```

beside the other registries:

```ts
const onBoundsChange = useCallbackRegistry<[Rect, BoundsSet]>();
```

in `'update:movement'`, directly after `bounds` is computed and before
`onResize.run(bounds.size)`:

```ts
onBoundsChange.run(bounds, resizing);
```

and in the `registry` object:

```ts
    onBoundsChange: onBoundsChange.register,
```

- [ ] **Step 2: `GraphVisualization.vue` reports a resize as one event**

In `defineEmits`, remove `'update:width'`, `'update:height'` and
`'update:nodePosition'`, and add:

```ts
  /** A step of a handle drag. The left handle changes the width and the position together. */
  resize: [change: VisualizationResize]
```

(import `type VisualizationResize` from the `visualizationSize` module). Replace
the three registrations

```ts
resizeHandles.onResizeWidth((value) => emit("update:width", value));
resizeHandles.onResizeHeight((value) => emit("update:height", value));
resizeHandles.onMove((position) => emit("update:nodePosition", position));
```

with:

```ts
resizeHandles.onBoundsChange((bounds, sides) =>
  emit("resize", {
    ...(sides.left || sides.right ? { width: bounds.width } : {}),
    ...(sides.top || sides.bottom ? { height: bounds.height } : {}),
    ...(sides.left || sides.top ? { position: bounds.pos } : {}),
  }),
);
```

Delete the `isClosedOrOpening` ref, its `watch` and its `watchEffect`, and
replace

```ts
const isResizing = computed(
  () => handlesResizing.value || isClosedOrOpening.value,
);
watch(isResizing, (resizing) => emit("update:resizing", resizing), {
  immediate: true,
});
```

with:

```ts
// Only a handle drag counts: the graph makes room for a visualization that opens when its
// metadata is written, not when it is drawn.
watch(handlesResizing, (resizing) => emit("update:resizing", resizing));
```

Then `grep -n "isResizing\|isClosedOrOpening" GraphVisualization.vue`: any
remaining use of `isResizing` becomes `handlesResizing`. Remove imports the
deletions leave unused (`watchEffect`, `toRef`, `nextTick` only if no longer
referenced).

`ComponentBrowser.vue` also mounts `GraphVisualization`, with
`:isResizable="false"` and none of the removed events, so it needs no change.

- [ ] **Step 3: `nodeVisualization.ts` loses the watcher**

- In `interface Emit`, replace the `update:visualizationWidth` and
  `update:visualizationHeight` signatures with:

```ts
  (event: 'resizeVisualization', change: VisualizationResize): void
```

- In `NodeVisualizationOptions`, replace `onResize?: …` with:

```ts
  /** A handle drag on the visualization started or ended. */
  onResizingChange?: (resizing: boolean) => void
```

and rename the destructured `onResize` to `onResizingChange`.

- `visualizationWidth` becomes read-only:

```ts
const visualizationWidth = computed<number | null>(
  () => metadata.value?.width ?? null,
);
```

- Delete `visibleSize`, `let resizing = false` and the `watch(visibleSize, …)`
  block (lines 108-123), and the `Rect` import.
- In the `visualization` computed, replace the `'onUpdate:height'`,
  `'onUpdate:width'` and `'onUpdate:resizing'` entries with:

```ts
      onResize: (event) => emit('resizeVisualization', event),
      'onUpdate:resizing': (event) => onResizingChange?.(event),
```

- [ ] **Step 4: `GraphNode.vue`**

- In `defineEmits`, remove `'update:visualizationWidth'` and
  `'update:visualizationHeight'`; add
  `resizeVisualization: [change: VisualizationResize]`.
- Remove the `useNodesDisplacing` import and
  `const { displaceNodesForResize } = useNodesDisplacing()`.
- Report the measured size, after `nodeDomSize` is defined:

```ts
// The graph store computes this node's rectangle from its metadata and this size: see
// `displacement.ts`.
watch(
  nodeDomSize,
  (size) => {
    if (!widgetsDomSize.value.isZero())
      graph.nodeBareSizes.set(nodeId.value, size);
  },
  { immediate: true },
);
```

- Hold the undo step for a handle drag, before `useNodeVisualization`:

```ts
// A resize drag is one undo step, the nodes it pushes included.
let releaseUndoStep: (() => void) | undefined;
function setVisualizationResizing(resizing: boolean) {
  releaseUndoStep?.();
  releaseUndoStep = resizing ? module.value.undoManager.holdStep() : undefined;
}
// A drag that never reports its end (the window loses focus, the node goes) must not hold the
// step open: every later edit would join it.
useEvent(window, "blur", () => setVisualizationResizing(false));
onUnmounted(() => setVisualizationResizing(false));
```

(`useEvent` is in `@/composables/events`.)

- In the `useNodeVisualization({ … })` call, replace the `onResize: …` line with
  `onResizingChange: setVisualizationResizing,`.
- In the template, delete
  `@update:nodePosition="graph.setNodePosition(nodeId, $event)"` from
  `<GraphVisualization>`.

- [ ] **Step 5: `GraphNodes.vue` and the shortcut**

In `GraphNodes.vue`, add to the script:

```ts
function resizeVisualization(
  id: NodeId,
  { width, height, position }: VisualizationResize,
) {
  graph.value.setNodeVisualization(
    id,
    {
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    },
    position,
  );
}
```

(import `type VisualizationResize`), and in the template replace

```html
@update:visualizationWidth="graph.setNodeVisualization(id, { width: $event })"
@update:visualizationHeight="graph.setNodeVisualization(id, { height: $event })"
```

with:

```html
@resizeVisualization="resizeVisualization(id, $event)"
```

In `GraphEditor.vue`, in `'graph.toggleVisualization'`, replace the
`module.value.batchEdits(() => { … })` block with:

```ts
graphStore.setNodesVisualization(
  Array.from(selected, (id) => [id, { visible: !allVisible }] as const),
);
```

- [ ] **Step 6: Delete the old algorithm**

```bash
git rm app/gui/src/project-view/components/GraphEditor/nodesDisplacing.ts app/gui/src/project-view/components/GraphEditor/__tests__/displacing.test.ts
grep -rn "nodesDisplacing\|displaceNodesForResize" app/gui
```

Expected: the grep prints nothing. If a `tsconfig*.json` names
`nodesDisplacing.ts`, remove that entry.

- [ ] **Step 7: Verify**

```bash
corepack pnpm --filter enso-gui run typecheck
corepack pnpm --filter enso-gui run lint
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor src/providers/openedProjects
```

Expected: all pass. Then run the app
(`corepack pnpm --filter enso-gui run dev:vite`), open a project and check by
hand: showing a visualization above another node moves that node down; hiding it
moves it back; one Ctrl+Z after showing hides it and restores the node; dragging
the bottom handle slowly, with a pause, then one Ctrl+Z restores the size and
the neighbours; dragging the left handle moves nothing else; Ctrl-hover over a
node with others below moves nothing.

- [ ] **Step 8: Commit**

```bash
git add -A app/gui/src
git commit -m "Visualizations make room through the graph store; the watcher-driven algorithm is removed"
```

---

### Task 8: Moves by hand and removals tell the store

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/nodesDragging.ts:183-187`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/selectionAlignment.ts:125-132`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/tidy/useGraphTidy.ts:106-108`
- Modify: `app/gui/src/project-view/components/GraphEditor.vue`
  (`deleteAndConnectAround` line ~401, `collapseNodes` line ~789)
- Modify: `app/gui/src/project-view/components/GraphEditor/aiNode.ts:234-240`
- Modify: `app/gui/src/project-view/stores/ongoingAiPrompts.ts:427-433`
- Test:
  `app/gui/src/project-view/components/GraphEditor/tidy/__tests__/useGraphTidy.test.ts`

**Interfaces:**

- Consumes: `graph.setNodePositions`, `graph.releasePushedBy` (Task 5).

- [ ] **Step 1: A finished drag**

A drag writes positions on every frame with `setNodePosition`; only its end is a
move by hand as far as the layout is concerned. In `nodesDragging.ts`:

```ts
    /** Finish dragging and set nodes' positions */
    finishDragging(): void {
      this.stopPositionUpdate()
      this.updateNodesPosition()
      // The drag is over: the nodes the dragged ones were pushing return, and a dragged node
      // forgets the place it was pushed from. `updateNodesPosition` has dropped any node that
      // something else moved meanwhile.
      graph.value.setNodePositions(
        Array.from(this.draggedNodes, ([id, dragged]) => [id, dragged.currentPos] as const),
      )
    }
```

Arrow-key moves end through the same `finishDrag`, so they are covered.
`cancelDragging` is left alone: the nodes go back where they were.

- [ ] **Step 2: Align and Spacing**

In `selectionAlignment.ts`, replace the body of `batchUpdatePositions`:

```ts
function batchUpdatePositions(updates: Array<{ node: Node; position: Vec2 }>) {
  graphStore.setNodePositions(
    updates.map(({ node, position }) => [nodeId(node), position] as const),
  );
}
```

If `module` is then unused in the file, leave the parameter (callers pass it)
and prefix it with an underscore only if lint requires.

- [ ] **Step 3: Tidy up**

In `useGraphTidy.ts`, replace

```ts
module.value.batchEdits(() => {
  for (const [id, position] of positions)
    graphStore.setNodePosition(id, position);
});
```

with:

```ts
// A move by hand: the tidied layout is the new home of every node it places.
graphStore.setNodePositions(positions);
```

In `tidy/__tests__/useGraphTidy.test.ts`, find the fake graph store
(`grep -n "setNodePosition" useGraphTidy.test.ts`) and give it the new method in
terms of the old one, so the existing assertions keep reading `setNodePosition`
calls:

```ts
    setNodePositions: (moves: Iterable<readonly [NodeId, Vec2]>) => {
      for (const [id, position] of moves) setNodePosition(id, position)
    },
```

where `setNodePosition` is the fake's existing spy. If a test asserts that
`module.batchEdits` was called once, change it to assert `setNodePositions` was
called once.

- [ ] **Step 4: The other ways the user removes a node**

`graphStore.deleteNodes` already releases (Task 5). Three more paths:

In `GraphEditor.vue`, `deleteAndConnectAround`, immediately before its
`return Ok()`:

```ts
graphStore.releasePushedBy(nodes.map(nodeId), edit);
```

In `collapseNodes`, inside `module.value.edit((edit) => {`, immediately before
its `return Ok()`:

```ts
// The collapsed nodes leave this graph: what they were pushing returns.
graphStore.releasePushedBy(selected, edit);
```

In `stores/ongoingAiPrompts.ts`, inside the `module.value.edit((edit) => {` that
calls `updateAiNode`, as its first statement:

```ts
// The node is replaced by one with a new id: what the old one was pushing returns.
graphStore.releasePushedBy([entry.editTarget.nodeId], edit);
```

In `aiNode.ts`, add to the `newCallAst.setNodeMetadata({ … })` object, so the
replaced node keeps its own home:

```ts
    displaced: oldNodeMeta.get('displaced'),
```

- [ ] **Step 5: Verify**

```bash
corepack pnpm --filter enso-gui run typecheck
corepack pnpm --filter enso-gui run lint
corepack pnpm --filter enso-gui exec vitest run src/project-view
```

Expected: all pass. By hand in the app: show a visualization so a node below is
pushed; drag the pushed node aside, hide the visualization, the dragged node
stays. Show it again, drag the node _with_ the visualization away: the pushed
node returns at the drop. Show it again, delete the node with the visualization:
the pushed node returns, and one Ctrl+Z brings both back.

- [ ] **Step 6: Commit**

```bash
git add -A app/gui/src
git commit -m "Moves by hand and removals release the nodes a node was pushing"
```

---

### Task 9: End-to-end checks, the changelog and the notes

**Files:**

- Create: `app/gui/integration-test/project-view/nodesMakeRoom.spec.ts`
- Modify: `CHANGELOG.md` (`# Next Release` → `#### Enso IDE`)
- Modify: `app/gui/src/project-view/CLAUDE.md` (a section after "Graph editor")

- [ ] **Step 1: Write the Playwright spec**

The mock project's `main` has the nodes `five`, `ten`, `twenty`, `sum`, `prod`,
`final`, `list`, `text` (`integration-test/mock/lsHandler.ts`). The checks do
not assume a layout: they compare every node's position before and after.

```ts
import { type Page } from "@playwright/test";
import { expect, test } from "integration-test/base";
import * as locate from "./locate";

const BINDINGS = [
  "five",
  "ten",
  "twenty",
  "sum",
  "prod",
  "final",
  "list",
  "text",
];
const OPENED = "sum";

type Positions = Record<string, { x: number; y: number }>;

async function positions(page: Page): Promise<Positions> {
  const result: Positions = {};
  for (const binding of BINDINGS) {
    const box = await locate.graphNodeByBinding(page, binding).boundingBox();
    if (box) result[binding] = { x: Math.round(box.x), y: Math.round(box.y) };
  }
  return result;
}

async function toggleVisualization(page: Page, binding: string) {
  await locate
    .graphNodeByBinding(page, binding)
    .click({ position: { x: 8, y: 8 } });
  await expect(locate.componentMenu(page)).toExist();
  await locate.toggleVisualizationButton(page).click();
}

function moved(before: Positions, after: Positions): string[] {
  return BINDINGS.filter(
    (b) =>
      before[b] &&
      after[b] &&
      (before[b].x !== after[b].x || before[b].y !== after[b].y),
  );
}

test("Showing a visualization makes room, and hiding it restores the layout", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const before = await positions(page);
  await toggleVisualization(page, OPENED);
  const vis = locate.anyVisualization(page);
  await expect(vis).toExist();
  await expect
    .poll(async () => moved(before, await positions(page)).length)
    .toBeGreaterThan(0);

  // No other node is left under the visualization.
  const visBox = (await vis.boundingBox())!;
  for (const binding of BINDINGS.filter((b) => b !== OPENED)) {
    const box = (await locate.graphNodeByBinding(page, binding).boundingBox())!;
    const overlaps =
      box.x < visBox.x + visBox.width &&
      visBox.x < box.x + box.width &&
      box.y < visBox.y + visBox.height &&
      visBox.y < box.y + box.height;
    expect(overlaps, `${binding} is under the visualization`).toBe(false);
  }

  await toggleVisualization(page, OPENED);
  await expect(vis).toBeHidden();
  await expect.poll(() => positions(page)).toEqual(before);
});

test("One undo hides the visualization and puts the neighbours back", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const before = await positions(page);
  await toggleVisualization(page, OPENED);
  await expect(locate.anyVisualization(page)).toExist();
  await expect
    .poll(async () => moved(before, await positions(page)).length)
    .toBeGreaterThan(0);
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(locate.anyVisualization(page)).toBeHidden();
  await expect.poll(() => positions(page)).toEqual(before);
});

test("A pushed node that is dragged away stays where it was put", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const before = await positions(page);
  await toggleVisualization(page, OPENED);
  await expect(locate.anyVisualization(page)).toExist();
  await expect
    .poll(async () => moved(before, await positions(page)).length)
    .toBeGreaterThan(0);
  const pushed = moved(before, await positions(page))[0]!;

  const box = (await locate.graphNodeByBinding(page, pushed).boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 408, box.y + 8, { steps: 8 });
  await page.mouse.up();
  const dropped = (await positions(page))[pushed]!;
  expect(dropped.x).toBeGreaterThan(box.x + 300);

  await toggleVisualization(page, OPENED);
  await expect(locate.anyVisualization(page)).toBeHidden();
  await expect
    .poll(async () => (await positions(page))[pushed])
    .toEqual(dropped);
});
```

There is no Playwright check for Ctrl-hover: the existing preview test in
`graphNodeVisualization.spec.ts` is skipped as inconsistent, and the preview
cannot push by construction, since it never writes metadata and the watcher that
reacted to it is gone.

- [ ] **Step 2: Run it**

Run:
`corepack pnpm --filter enso-gui exec playwright test integration-test/project-view/nodesMakeRoom.spec.ts`
Expected: 3 passed. If the first `expect.poll` times out, no node sits under
`sum`'s visualization in the mock layout: change `OPENED` to the binding of a
node that has another directly below it (look at the page with `--headed`) and
rerun. If `locate.componentMenu` or `locate.anyVisualization` is named
differently, use the names `graphNodeVisualization.spec.ts` uses.

- [ ] **Step 3: Run the specs that could be disturbed, several times**

These toggle a visualization or move nodes and then act by coordinates. One run
is not evidence either way: run each three times, and compare any failure with
the same spec on `develop`.

```bash
corepack pnpm --filter enso-gui exec playwright test --repeat-each=3 \
  integration-test/project-view/graphNodeVisualization.spec.ts \
  integration-test/project-view/tableVisualisation.spec.ts \
  integration-test/project-view/undoRedo.spec.ts \
  integration-test/project-view/aligningNodes.spec.ts \
  integration-test/project-view/spacingNodes.spec.ts \
  integration-test/project-view/tidyUp.spec.ts \
  integration-test/project-view/removingNodes.spec.ts \
  integration-test/project-view/nodeClipboard.spec.ts \
  integration-test/project-view/collapsingAndEntering.spec.ts \
  integration-test/project-view/sessionReplacement.spec.ts
```

Expected: the same results as on `develop`. A spec that now fails because a node
it clicks was pushed out of the way is fixed in the spec (locate the node, do
not hard-code its coordinates), not by weakening the feature.

- [ ] **Step 4: The changelog and the notes**

In `CHANGELOG.md`, under `# Next Release` → `#### Enso IDE`, with the PR's
number for `NNN` and a matching link definition where the others are:

```markdown
- [Showing or resizing a visualization moves the components in its way, and
  hiding it puts them back where they were. The moves are part of the same undo
  step.][NNN]
```

In `app/gui/src/project-view/CLAUDE.md`, after the "Graph editor" section:

```markdown
## Nodes make room

Showing, hiding or resizing a node's visualization moves the nodes in its way
and puts them back afterwards. The rule is the pure function
`components/GraphEditor/nodeDisplacement.ts`; the graph store's side is
`$/providers/openedProjects/graph/displacement.ts`. A pushed node's home is
saved in its metadata (`displaced`). Three things to keep:

- **Change a node's visualization or position through the store's setters**
  (`setNodeVisualization`, `setNodesVisualization`, `setNodePositions` for a
  move by hand, `releasePushedBy` for a removal inside an edit). They lay out
  before they write, in one edit, so the pushes share the action's undo step.
  `setNodePosition` alone is for a drag's frames.
- **Rectangles are computed, not measured**: from metadata and
  `graph.nodeBareSizes`. `graph.nodeRects` lags by a frame and includes a
  Ctrl-hover preview. A change to how a visualization sizes itself goes in
  `visualizationSize`, which the store shares with the component.
- **A handle drag holds one undo step** (`module.undoManager.holdStep`), and
  must release it on every way a drag can end.

The design is `docs/superpowers/specs/2026-11-13-node-displacement-design.md`.
```

- [ ] **Step 5: The full checks, on both hosts**

```bash
corepack pnpm --filter enso-gui run typecheck
corepack pnpm --filter enso-gui run lint
corepack pnpm --filter enso-gui run test:unit
corepack pnpm --filter ydoc-server run test:unit
corepack pnpm --filter ydoc-shared run test:unit
corepack pnpm exec prettier --check CHANGELOG.md app/gui/src/project-view/CLAUDE.md
```

Then the unit tests and the new spec once more on Linux through WSL (source
`~/.enso-toolchain.sh` first, set `ENSO_REPO` to the worktree). Expected: all
pass on both.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "Nodes make room: end-to-end checks, changelog and notes"
```

Open the PR against `develop`. In its description: what changes for the user,
the three behaviours that differ from today (the Ctrl-hover preview and the left
handle no longer push; only nodes in the way move), and what was not verified.
Attach before/after screenshots of a visualization opening over a node, through
the `pr-screenshots` branch. Do not merge: a feature waits for the owner's OK
after an installer test.

---

## Not in this plan

The second pull request, planned separately once this one has merged: the node's
height handle, the table-editor widget, and saving a node's height to the
project file.
