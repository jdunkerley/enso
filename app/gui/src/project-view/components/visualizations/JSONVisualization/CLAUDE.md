# JSONVisualization

The JSON visualization: a lazy tree over any value (spec
`docs/superpowers/specs/2026-11-14-viz-lazy-tree-design.md`).

- Its preprocessor is `Standard.Visualization.Tree.prepare` (the root and the
  first page of 100 children); expanding a branch or "Show more" calls
  `Tree.children` through `config.executeExpression`. The JSON of both is in
  `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`; `treeWire.ts`
  reads it.
- `lazyTree.ts` holds the state (pages per path, open branches) and turns it
  into rows; it has no Vue component, so the unit tests drive it directly. Open
  branches stay open across a new payload and are fetched again.
- The rows are a virtual list (`useVirtualList`, fixed 20px rows): a long text
  leaf is one line, cut with an ellipsis, with the whole text in its tooltip.
- Double-click on an entry creates a node from the chain of node expressions
  from the root (`treeExpression.ts`: the steps are literal steps of the shared
  builder's `chainPattern`, `../vizActions.ts`, joined with the spaced dot);
  Shift adds one node per loaded sibling. An entry under one with no expression
  has none. The root value's plain actions (`"actions"` in `Tree.prepare`'s
  JSON) are toolbar buttons.
- Right-click on an entry opens a menu of the same two actions, **Get Value**
  and **Get All Loaded Values Here** (`entryMenu` in `lazyTree.ts`, shown with
  the grids' `GridPopupMenu`). An item is offered only if a node comes of it, so
  an entry no expression reaches gets no menu. The row stops the `contextmenu`
  event (prevent and stop), so the browser's and the graph's menus stay away.
  The menu closes on a click away, on Escape, when the tree scrolls and when a
  new payload arrives (the popup keeps its click point and its chains).
