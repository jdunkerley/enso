# project-view/

The **ProjectView feature** subtree: graph editor, code editor, visualizations,
component browser, markdown/plain-text editors, circular menus, documentation
panes. Everything that's specific to viewing and editing an open Enso project
lives here. Import via the `@/` path alias.

This is **not** "the Vue half" — Vue is the main framework of the entire GUI.
This directory is a feature subtree, as `src/dashboard/` is another.

## What belongs here (and what doesn't)

- **Belongs**: code whose meaning depends on an open project — graph rendering,
  AST editing, component browser, per-node widgets, the Yjs session glue,
  visualization hosts.
- **Doesn't belong**: general-purpose UI primitives, cross-feature utilities,
  framework-level infrastructure. Those are _commons_ and should live at `src/`
  directly (`src/components/`, `src/composables/`, `src/providers/`,
  `src/util/`, …) so both ProjectView and other features can share them.

Historically, many commons ended up inside this directory because it was the
only Vue location. The plan is to progressively **move commons out of
`project-view/` into proper places under `src/`**. When you add something here,
ask first: is this ProjectView-specific, or would another feature want it too?

## Structure

- `components/` — Vue SFCs specific to ProjectView. Large-feature components get
  their own sub-folder (e.g. `GraphEditor/`, `CodeEditor/`, `ComponentBrowser/`,
  `DocumentationEditor/`, `MarkdownEditor/`). Truly shared components should
  move to `src/components/`.
- `composables/` — Vue composables (`useX()`). ProjectView-specific composables
  only; share-worthy ones belong at `src/composables/`.
- `stores/` — App-wide reactive state for the ProjectView session. These are
  **plain Vue composables that `provide()` a reactive shape**
  (`createContextStore` pairs), and the GUI has no Pinia dependency. A
  `provideXxx()` is paired with a `useXxx()`/`injectXxx()`.
- `providers/` — Pure `inject`/`provide` keys, no logic. Use when a single typed
  slot is enough and a full store is overkill.
- `assets/` — Static SVGs/images used inside ProjectView.
- `util/` — Pure TS utilities (no Vue imports in most files). Move to
  `src/util/` when something stops being ProjectView-specific.
- `bindings.ts` — Keyboard shortcuts for ProjectView (see `app/gui/shortcuts.md`
  for the user-facing list). The graph editor's (`graphBindings`) are
  user-rebindable: defined in `$/configurations/graphInputBindings`, they follow
  the window's store, `$/providers/inputBindings` (#170). Every other namespace
  there is fixed, with the reason noted above it.

## Interop with the Dashboard subtree

Cross-subtree wiring with the Dashboard (`src/dashboard/`) should go through
`src/providers/` (the `$/providers/` alias), not by reaching into the other
subtree's internals.

## Graph editor

`GraphEditor.vue` is the heart of ProjectView. It renders an SVG scene plus
positioned Vue components per node, talks to Yjs (via `ydoc-shared`) for
collaborative edits, and uses `y-protocols` for awareness (cursors, selections).
New interactions typically become composables in `components/GraphEditor/` or
`composables/`.

When the project's ydoc session is replaced, the view is unmounted with the old
stores and mounted again with new ones (`reconnectProject`). `GraphEditor.vue`
registers a capture of its own state with `registerViewCarryOver` and takes it
back on mount (`takeViewCarryOver`): the selection (external ids), whether the
bottom dock is open, and an open component browser with its input
(`components/GraphEditor/viewCarryOver.ts`; the browser's `restoredInput` prop,
`input.capture`/`restore`). The right panel, the dock's tab and the viewport
outlive the view already. State added to the view that a user would miss after a
reconnect belongs there too (#604).

## Nodes make room

Showing, hiding or resizing a node's visualization moves the nodes in its way
and puts them back afterwards. The rule is the pure function
`components/GraphEditor/nodeDisplacement.ts`; the graph store's side is
`$/providers/openedProjects/graph/displacement.ts`. A pushed node's home is
saved in its metadata (`displaced`). Four things to keep:

- **Change a node's visualization or position through the store's setters**
  (`setNodeVisualization`, `setNodesVisualization`, `setNodePositions` for a
  move by hand, `releasePushedBy` for a removal inside an edit, and
  `repointPushedBy` when a node is replaced in place, as an AI node is, so it
  keeps what it pushes). They lay out before they write, in one edit, so the
  pushes share the action's undo step. `setNodePosition` alone is for a drag's
  frames. `setNodePositions` makes every node it is given forget its home, moved
  or not (Tidy up over the whole graph clears every home), so a finished drag
  passes only the nodes that actually moved: a click is not a move.
- **Call a layout setter at most once per outer transaction**, passing every
  node in that one call: the node database it lays out against is updated only
  when the transaction commits, so a second call in the same `batchEdits` or
  edit sees the graph as it was before the first.
- **Rectangles are computed, not measured**: from metadata and
  `graph.nodeBareSizes`. `graph.nodeRects` lags by a frame and includes a
  Ctrl-hover preview. A change to how a visualization sizes itself goes in
  `visualizationSize`, which the store shares with the component.
- **A drag holds one undo step** (`module.undoManager.holdStep`): a
  visualization handle drag, and a node drag by pointer or arrow keys
  (`nodesDragging.ts`, so a pause before the release does not split it). It must
  release the step on every way a drag can end: finish, cancel, the handles or
  the dragged node unmounting, the editor going. Overlapping holds make one step
  that ends with the last release; `stopCapturing()` from anything else (the
  deselect-all boundary) still ends it.

The design is `docs/superpowers/specs/2026-11-13-node-displacement-design.md`.

## Visualizations

Each visualization in `components/visualizations/` is compiled as a **custom
element** (see `customElement` matcher in `app/gui/vite.config.ts`). That means
they run in the Shadow DOM and must not rely on global Tailwind classes bleeding
in. Tags start with `enso-`.

## Reactivity rules

Follow Vue 3 conventions: prefer `ref` over `reactive` for primitives, and use
`shallowRef` when storing large external objects (Yjs docs, CodeMirror
`EditorState`) that have their own reactivity or where deep proxying would be
wasteful.
