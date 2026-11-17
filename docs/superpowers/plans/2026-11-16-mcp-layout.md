# MCP layout, visualization size and graph picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent connected over MCP can see where nodes are, move and arrange
them, read and set a visualization's size, and take a picture of the graph.

**Architecture:** The window does the work with the functions the user's own
commands call: `graph.setNodePositions` for moves, `useGraphTidy` and the
selection-alignment handlers for arranging, `graph.setNodeVisualization` for
size. Each is one edit through the `EditSession`. The graph picture reuses the
capture path of `get_visualization`: the window frames the nodes and reports the
viewport rectangle, Electron main captures it.

**Tech Stack:** TypeScript, Vue 3, Electron, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`, section
"Amendment, 2026-11-16". The owner's requests (2026-11-16): "we should also add
the ability for the ai to resize the viz and get the current size and then set
it back to a small size", and "Agent needs to be able to layout nodes as well.
Let's add some APIs for that".

## Global Constraints

- `corepack pnpm` only. Work in `C:\Repos\Enso\ide-mcp`, branch
  `feature/mcp-layout` (stacked on `feature/mcp-docs-and-tabs`, pull request
  #825).
- Tool argument names are snake_case on the wire.
- The Write button is never reachable from MCP. These tools add no way to run
  code: they must not call `evaluate`, `executeExpression`, `updatePreprocessor`
  or any `recompute`.
- Every change to the module (positions and visualization metadata are module
  metadata) goes through the `EditSession`: refused in Live mode, part of the
  caller's undo step, a version saved first.
- `graph.setNodePositions` and `graph.setNodesVisualization` are each called at
  most once per edit, with every node in the one call (their doc comments in
  `providers/openedProjects/graph/graph.ts` say why).
- Tools answer only for the project tab on screen.
- A tool result is JSON text made with `jsonResult`; errors are plain sentences
  made with `toolError`, saying what the agent can do next.
- Coordinates are scene units (pixels at 100% zoom), x to the right, y down,
  rounded to whole numbers in results.
- Every exported symbol has a doc comment. No `as unknown as` on Electron or SDK
  types.
- Each commit message ends with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- One writer in the worktree at a time.

---

### Task 1: Positions in `get_graph`, and `move_nodes`

**Files:**

- Modify: `app/gui/src/project-view/mcp/graphTools.ts` and its test
- Create: `app/gui/src/project-view/mcp/layoutTools.ts` and
  `__tests__/layoutTools.test.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts`
- Modify: `app/electron-client/src/mcp/projectTools.ts`
- Create: `app/gui/integration-test/project-view/mcpLayout.spec.ts`

**Behaviour:**

- `get_graph` gains an optional `layout: boolean` (default false, so the default
  answer stays small). With it, each node gains `position: { x, y }` (the node's
  stored position, its top-left) and `area: { x, y, width, height }` (the room
  the node takes with its visualization, `graph.visibleArea(id)`; omitted for a
  node not yet drawn), and the result gains
  `view: { x, y, width, height, scale }`, the part of the scene on screen.
- `move_nodes { moves }`: `moves` is 1 to 200 of `{ node_id, x, y }` (finite
  numbers within ±1,000,000). All are applied in one edit with one
  `setNodePositions` call. An unknown node, or the same node twice, refuses the
  whole call with nothing moved. It answers
  `{ moved: [{ id, position }], settled: true }` with the positions as stored
  afterwards. The description says: positions are of the node's top-left in
  scene units; read them with `get_graph { layout: true }`; a node's `area`
  shows the room it needs, so leave a gap; nodes the moved ones were pushing
  return to their places; prefer `arrange_nodes` for a tidy result.
- Nothing is computed again by a move: follow how `set_visualization` settles.

**Tests (failing first):** unit tests for each bullet (pure functions over a
deps object, as `editTools.test.ts`); integration: `get_graph { layout: true }`
positions match the nodes' DOM positions (through the navigator's transform:
compare relative offsets between two nodes, not absolute pixels); `move_nodes`
moves a node on screen; one Ctrl+Z moves it back; refused in Live. Run with
`--repeat-each=3`.

- [ ] Tests, implementation, typecheck, commit
      `MCP: node positions in get_graph, and move_nodes`.

---

### Task 2: `arrange_nodes`

**Files:**

- Modify: `layoutTools.ts` and its test, `useProjectMcpTools.ts`,
  `GraphEditor.vue` (the editor passes its tidy and alignment functions in
  `McpEditorDeps`), `projectTools.ts`, `mcpLayout.spec.ts`

**Behaviour:**

- `arrange_nodes { action, node_ids? }`, the user's own layout commands:
  - `tidy`: `useGraphTidy(graphStore).tidy(ids)`. Without `node_ids`, or with
    fewer than two, the whole graph is laid out; with two or more, only those.
  - `align_left`, `align_right`, `align_center`, `align_top`, `align_bottom`,
    and `space`, `space_tight`, `space_wide`, `space_none` (the Spacing menu's
    default, tight, wide and zero): the handlers of
    `createSelectionAlignmentHandlers` in `selectionAlignment.ts`, given the
    nodes of `node_ids`. These need at least two `node_ids`; fewer is refused
    with a sentence saying so.
- At most 500 `node_ids`; an unknown or repeated node refuses the call.
- One edit through the `EditSession`. The handlers each end in one
  `setNodePositions`; confirm that holds when called inside the session's run
  and that the selection and the panel focus are not needed or changed (the
  menu's `action()` wrapper checks focus; do not go through it).
- It answers
  `{ action, arranged: <count of nodes whose position changed>, settled: true }`.
  Nothing to do (already tidy) answers `arranged: 0`.
- The view does not move and the selection does not change.

**Tests (failing first):** unit tests with fake tidy/alignment functions for
routing, the two-node rule, refusals; integration: after `move_nodes` scatters
three nodes, `arrange_nodes { action: "align_left", node_ids }` gives them one
x; `tidy` changes positions and one Ctrl+Z restores them; the selection is
unchanged; refused in Live.

- [ ] Tests, implementation, typecheck, commit
      `MCP: arrange_nodes runs Tidy up, Align and Spacing`.

---

### Task 3: Visualization size

**Files:**

- Modify: `app/gui/src/project-view/mcp/editTools.ts` (`setVisualization`,
  `EditToolDeps.setVisualization`), `visualizationTools.ts`,
  `visualizationRegistry.ts` if the entry needs to report its size,
  `useProjectMcpTools.ts`, their tests
- Modify: `app/electron-client/src/mcp/projectTools.ts`, `visualizationTool.ts`
  (schema passes the new fields through), their tests
- Modify: `mcpVisualization.spec.ts`

**Behaviour:**

- `set_visualization` gains optional `width` and `height`: a number of scene
  units (100 to 2,000), or `null` for the default size (the small one: the
  node's width or 200, and 150 high). Omitted leaves that dimension as it is.
  Written in the same single edit as `visible`
  (`setNodeVisualization(id, { visible, width?, height? })`). The view enforces
  its own minimums (`visualizationSize.ts`); the result reports the size as
  drawn.
- A size is reported wherever a visualization is described, as
  `size: { width, height, default_width, default_height }`, where `width` and
  `height` are the size as drawn (the content area, as `visualizationSize`
  computes it from the stored size and the node's width) and the `default_*`
  flags say whether that dimension is the default (stored as null):
  - the `set_visualization` result;
  - `list_visualizations`;
  - both formats of `get_visualization`.
- Descriptions: `set_visualization` says a larger visualization pushes
  neighbouring nodes away and they return when it shrinks, that the size stays
  as set (part of the undo step), and to pass `null` for both to put it back to
  the small default when the user did not ask for a large one.
  `get_visualization` says the picture is of the visualization at its current
  size, so make it larger first to see more of a table or chart.

**Tests (failing first):** unit tests for the passes, the null reset, the range,
`size` in each result; integration: set 600×400, the panel's box in the DOM is
that size at 100% zoom (within 2 px), `get_visualization_data` reports it,
`null` for both returns it to the default and reports the default flags, one
Ctrl+Z after a resize restores the previous size, refused in Live.

- [ ] Tests, implementation, typecheck, commit
      `MCP: read and set a visualization's size`.

---

### Task 4: `get_graph_image`

**Files:**

- Create: `app/electron-client/src/mcp/graphImageTool.ts` and
  `tests/headless/mcpGraphImageTool.test.ts`; modify `electron.ts`
- Modify: `visualizationTool.ts` only to export the stable-capture and PNG-cap
  helpers for reuse, behaviour unchanged
- Modify: `app/gui/src/project-view/mcp/viewTools.ts` (window handler
  `prepare_graph_image`, not an MCP tool), `useProjectMcpTools.ts`,
  `GraphEditor.vue`, tests

**Behaviour:**

- `get_graph_image { node_ids? }` returns a PNG of the graph editor's viewport
  framed on the nodes: all nodes of the method on screen, or the given ones (at
  most 500; an unknown node refuses). The window pans and zooms without
  animation so that their bounding area (`visibleArea` of each, with a margin of
  40 scene units) fits the viewport, at a scale between 10% and 100% (never
  above 100%); waits until the view has stopped moving and two frames have
  passed; and answers the viewport's client rectangle and the scale. Main then
  captures it exactly as `get_visualization` does (capture until stable, at most
  1200 px on the long side) and answers the image with
  `{ scale, width, height, nodes: <count framed> }`.
- An empty method (no nodes) is an error saying so.
- It moves the view and does not move it back; the description says so, and that
  at a low `scale` text is not legible, so frame fewer nodes with `node_ids` to
  read them. It works in Live mode (it edits nothing).
- Like `add_image`'s capture: main passes nothing to the window after the
  capture, so no project check is needed.

**Tests (failing first):** headless tests of the main half with fakes (rect
captured, cap applied, the window's refusal passed through, no capture); window
unit tests of the framing arithmetic (bounding area, margin, scale clamped to
[0.1, 1]); integration: `prepare_graph_image` leaves every node's box inside the
viewport and answers the viewport's `boundingBox()` within 1 px; with `node_ids`
of one node the scale is 1.

- [ ] Tests, implementation, typecheck, commit
      `MCP: get_graph_image takes a picture of the graph`.

---

### Task 5: Packaged proof, guide and documentation

**Files:** `app/electron-client/tests/mcp.spec.ts`, `guides/overview.md`, the
three `mcp/CLAUDE.md` files, `CHANGELOG.md`.

- [ ] Packaged spec: `move_nodes`, `arrange_nodes` and `get_graph_image` in the
      expected tool list. In the test that builds a project:
      `get_graph { layout: true }` gives positions; `move_nodes` then
      `get_graph` shows the new position; `arrange_nodes { action: "tidy" }`
      answers; `set_visualization` with 600×400 on the `[1, 2, 3]` node then
      `get_visualization` returns a picture whose width is larger than the
      default-size picture's and `size` says 600×400; `null` for both puts it
      back and the next picture has the first picture's dimensions;
      `get_graph_image` returns a PNG that is not blank (attach it, look at it,
      and say what it shows). Rebuild with `ide-local`; run the spec 3 times.
      Never run the installer.
- [ ] Guide: a short item on layout (read positions, prefer `arrange_nodes`,
      then `move_nodes`), the size arguments beside `set_visualization`, and
      `get_graph_image` beside `get_visualization`.
- [ ] `CLAUDE.md` files and a changelog entry with the placeholder `NNN`:
      "Agents connected over MCP can arrange and move nodes, resize a
      visualization, and take a picture of the graph."
- [ ] Focused unit suites, both typechecks, prettier and eslint on changed
      files, the GUI integration specs with `--repeat-each=3`. Commit
      `MCP: layout, visualization size and graph picture in the guide and the packaged test`.

## Not in this PR

- Undo and redo, saving a version, problems across the graph, refresh: the next
  PR.
- Resizing nodes themselves, colours, grouping by position.
- Moving the view back after a graph picture.
