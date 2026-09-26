# Tidy Up (Automatic Graph Layout) — Design

**Date:** 2026-09-26 **Status:** Draft, for review

## Motivation

The graph editor already has selection tools that align components (left, right,
top, bottom, centre) and space them vertically
(`components/GraphEditor/selectionAlignment.ts`). They are manual and
one-dimensional. Tidying a messy graph into a readable top-to-bottom flow still
means dragging every component.

**Goal:** one action, **Tidy up**, that lays out the whole graph, or the
selected components, as a clean top-to-bottom flow:

- each chain of components sits in one straight vertical column;
- where data splits or merges, separate streams sit in their own columns side by
  side.

**Decisions taken with the maintainer (2026-09-26):**

- **Scope:** with nothing or a single component selected, Tidy up lays out the
  whole graph of the current function. With several selected, it lays out only
  those and leaves everything else where it is.
- **Stability:** keep the user's relative order. Streams keep their
  left-to-right order and components their top-to-bottom order. The tidy
  straightens columns and fixes spacing and overlaps. It is anchored at the
  current top-left, so the view doesn't jump.
- **Streams follow the `self` input:** a component sits directly below the
  component that feeds its self argument. That is how Enso pipelines read.
- **Compact columns:** each stream is packed tightly with the standard vertical
  gap. Rows are not shared across columns, so one tall component (e.g. with a
  visualization open) doesn't open gaps elsewhere.
- **Approach A:** a custom Enso-specific stream layout with **no new
  dependency**, plus **one crossing-minimisation pass**. The alternatives
  researched are recorded below.
- **Name, place, icon and binding:** "Tidy up", shown **with the align tools**,
  with a **new icon**, bound to `Mod+Shift+L`, which is free in
  `project-view/bindings.ts`.

**Explicit non-goals:**

- Automatic re-layout after edits. Tidy up only runs when invoked.
- Pinning individual components.
- Shared rows across columns, i.e. a classic layered layout.
- Reordering code lines or changing any expression. Only position metadata
  changes.
- Routing or bending edges. Edges keep their existing rendering.

## Alternatives considered (research, 2026-09-26)

| Option                                                                                                                                                                                 | Why not                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **elkjs** (ELK layered). EPL-2.0 OR GPL-3.0-or-later; usable under AGPL via the GPL leg, though upstream has not confirmed this (kieler/elkjs#312). 433 KB gzip, runs in a Web Worker. | The best general engine: crossing minimisation, model order, port sides, component packing. But it produces **shared rows** (rejected above), it has no notion of `self` inputs (only approximated via ordering hints), and it is heavy and adds a licensing footnote. |
| **@dagrejs/dagre**. MIT, 16 KB.                                                                                                                                                        | Also row-layered. No port sides. Disconnected components can overlap. No model-order control.                                                                                                                                                                          |
| d3-dag, @msagl/core, WebCola, graphology, cytoscape adapters                                                                                                                           | Weaker control over alignment and order, unmaintained (WebCola), or not layered at all.                                                                                                                                                                                |

A custom layout expresses the maintainer's rules directly: self-input streams,
compact columns and stable order. It stays small and fully unit-testable, and
adds nothing to the bundle.

## Design

### 1. Architecture

Three pieces, in `app/gui/src/project-view/components/GraphEditor/tidy/`:

1. **`streamLayout.ts`: a pure function.** It has no Vue, store or Yjs
   dependencies.
   - The action handler itself lives in `GraphEditor.vue`, not in a selection
     component: Tidy up is both whole-graph and selection-scoped, and
     `GraphEditor.vue` is the one place that sees both the graph store and the
     current selection.
   - **Input:**
     - `components`: each has an `id`, a `size` (`Vec2`: width × height), a
       current `position` (`Vec2`, top-left), a `selfSource?` (the id of the
       component feeding its self argument, if it is in scope), and `inputs`
       (the ids of every in-scope component feeding it, in argument order);
     - `spacing`: `{ horizontal, vertical }`.
   - **Output:** `Map<id, Vec2>` of new top-left positions.
2. **`useGraphTidy`: the adapter.** It builds the model from the graph store,
   runs the layout, and writes all positions in one `module.batchEdits(…)` with
   the default user origin, so one Ctrl+Z undoes it. This mirrors
   `selectionAlignment.ts`.
   - **Components in scope:** the whole graph (`db.nodeIdToNode`), or the
     selected ones.
   - **Edges:** from `db.connections`, keeping only edges whose source and
     target are both in scope.
   - **`selfSource`:** the node that defines the identifier in
     `primaryApplication.selfArgument`.
   - **Sizes:** `graphStore.visibleArea(id)`, which includes an open
     visualization. An unmeasured component falls back to the theme's default
     node size.
3. **The `components.tidyUp` action.** It sits **with the align tools**:
   - **Align dropdown in `SelectionMenu.vue`:** a new third row, below the
     horizontal and vertical align rows, containing the Tidy up button
     (selection scope).
   - **`alignmentMenuActions` in `GraphNode.vue`:** the component context menu's
     align group, so it is reachable wherever the align tools are.
   - **Graph (background) context menu in `GraphEditor.vue`** (whole-graph
     scope). The align dropdown only shows for a multi-selection, so this and
     the shortcut are how the whole graph is tidied.
   - **The `Mod+Shift+L` binding:** tidies the selection if several components
     are selected, otherwise the whole graph.

   It is enabled whenever the graph has at least two components.

4. **A new icon, `tidy_up`.** Add a new 16×16 `<symbol id="tidy_up">` to
   `project-view/assets/icons.svg`. Draw it in the same style as the align
   icons: `viewBox="0 0 16 16"`, `fill="none"`, a `currentColor` stroke of width
   2, round caps and joins. The motif is a tiny top-to-bottom flow: two short
   columns of small rounded boxes joined by a connector, so it reads as "arrange
   into columns", distinct from `align_*` and `space_*`. Then regenerate
   `util/iconMetadata/iconName.ts` with
   `corepack pnpm --filter enso-gui run generate-icons`. Do not hand-edit that
   file (see `app/gui/CLAUDE.md`, "Icons").

### 2. Algorithm

1. **Stream parent (a forest).** Each component has at most one stream parent:
   its `selfSource` if in scope; otherwise its first in-scope input in argument
   order; otherwise none, which makes it a **root**. `Data.read …`, literals and
   function-argument input nodes are roots.
2. **Columns.** Walk each tree from its root.
   - Of a component's children, the one whose current x is closest to the
     parent's current x continues the parent's column. Ties go to code order.
   - Every other child starts a new column to the right, in the children's
     current left-to-right order.
   - Each subtree's columns stay **contiguous**. A branch gets its column only
     after the main child's whole subtree has been assigned, so a split within a
     split nests inside its own stream and never interleaves with a sibling's
     columns. A plain tree (no merges) therefore has no crossing edges.
   - Independent trees are placed side by side in the current left-to-right
     order of their roots.
   - Each column is as wide as its widest component, plus the horizontal gap.
     Components are centred in their column.
3. **Rows (compact).** Visit components in dependency order. Each component's
   top is `max(bottom of every in-scope input) + vertical gap`, so a merge
   always sits below all the streams feeding it. Roots start at the top.
4. **Crossing pass (one optimisation).** Only the **order of columns** may
   change, never which column a component belongs to. The permutable groups are
   the new columns branching from one parent, and the independent trees.
   - Starting from the current order, try each adjacent swap within a group.
     Recompute the positions, and **keep the swap only if the number of crossing
     edges strictly decreases**.
   - An edge is modelled as a straight segment from the source's bottom centre
     to the target's top centre.
   - Repeat until a full round finds no improving swap. There is no round cap.
     The pass always terminates, because the crossing count is a non-negative
     integer that strictly drops in every improving round. A cap could stop it
     before it reaches a local optimum, and then a second Tidy up would move
     things again.
   - Ties keep the user's order. So an already-tidy graph is unchanged, and Tidy
     up is **idempotent**.
5. **Anchoring.** Translate the result so its bounding box's top-left equals the
   top-left of the in-scope components' current bounding box.

### 3. Edge cases

- **Partial selection:** a selected component whose parent is outside the
  selection becomes a root of this tidy. Unselected components never move, so
  they may overlap the tidied block, as with the existing align tools. Only a
  whole-graph tidy guarantees no overlaps.
- **Input and output nodes:** input (argument) nodes are roots, so they sit at
  the top. The output node follows its input like any other component.
- **Cycles:** dataflow within a function is acyclic. If a cycle ever appeared
  (e.g. in broken code), the layout breaks it by treating the
  later-in-code-order edge as absent, rather than looping.
- **Performance:** layout is linear. Counting crossings is the expensive part,
  since pairs of edges are compared on every swap tried. It is pruned so that
  only edges whose vertical extents overlap are compared, or only edges touched
  by the swap are recounted. The target is under 200 ms for 300 components and
  about 400 edges, checked with a vitest bench. It runs synchronously.
  - **Time budget.** The crossing-minimisation pass carries a wall-clock budget
    (`CROSSING_PASS_BUDGET_MS`, 300 ms, using `performance.now()`, injectable
    for tests). On realistic graphs this never matters — they finish in
    milliseconds. On a pathological graph (e.g. an adversarial, uniformly random
    parent assignment rather than the local structure real code has), the pass
    can otherwise run for seconds; past the budget it stops and keeps the best
    order found so far, which is always a valid, non-overlapping layout, and
    warns once via `console.warn`. Idempotence — see "Stable order" above — can
    be lost only in that case; a second Tidy up may move things further.
- **Crossings count the layout's own edges:** the same de-duplicated, cycle-free
  inputs the layout uses.
- **Undo and collaboration:** one batched user edit, synced like any position
  change.

## Testing

**Unit tests for `streamLayout.ts`:**

- a straight chain forms one column;
- a split: the closest child continues the column, the others open columns to
  the right in their current order;
- a merge: the component sits below every input;
- a component with no self input falls back to its first input;
- roots with no inputs;
- independent trees keep their left-to-right order;
- the crossing pass removes a crossing, and keeps the user's order on a tie;
- idempotence: a tidied layout run again is unchanged;
- anchoring;
- mixed component sizes, including a tall one;
- a cycle does not hang.

**Adapter tests:** the model is built correctly from a `GraphDb`, covering
self-argument detection, edge filtering by scope, and the size fallback.

**Playwright** (`app/gui/integration-test/project-view/`; run in WSL). Tidy up
on the mock graph:

- a chain's components share one x;
- no two components overlap;
- Ctrl+Z restores the original positions;
- with a selection, only selected components move;
- the Tidy up button is in the selection's align dropdown, with the `tidy_up`
  icon.

## Files expected to change

- **New:**
  - `project-view/components/GraphEditor/tidy/streamLayout.ts`, plus tests;
  - `project-view/components/GraphEditor/tidy/useGraphTidy.ts`, plus tests.
- **Changed:**
  - `project-view/assets/icons.svg` (new `tidy_up` symbol) and the regenerated
    `util/iconMetadata/iconName.ts`;
  - `project-view/components/SelectionMenu.vue` (align dropdown row) and the
    `alignmentMenuActions` in `GraphNode.vue`;
  - the action registry and selection actions
    (`project-view/components/GraphEditor/selectionActions.ts`,
    `project-view/providers/action.ts`);
  - `project-view/bindings.ts`;
  - the graph context menu in `GraphEditor.vue`;
  - i18n text for the label and description;
  - a new Playwright spec;
  - `CHANGELOG.md` (`#### Enso IDE`).

## Risks and open points

- **Dense cross-linked graphs** may still have crossings, because only column
  order is optimised. A later pass could reuse a column vertically when chains
  don't overlap, to narrow wide graphs.
- **"Closest child continues the column"** depends on the current positions. In
  a very messy graph the choice may look arbitrary the first time. After one
  tidy it is stable.
- **Wide graphs:** each branch gets its own column, so a component with many
  consumers fans out wide. That is acceptable for now; column reuse (above) is
  the follow-up if it becomes a problem.
