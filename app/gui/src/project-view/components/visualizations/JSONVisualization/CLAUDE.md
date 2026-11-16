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
- **Keyboard** (#813). The scroller is `role="tree"`; entries, "Show more" and
  "couldn't load" rows are `treeitem`s (`aria-level` = depth, `aria-expanded` on
  branches) with a roving `tabindex`: one tab stop (`tabStopKey`: the row last
  focused, else the first one the virtual list shows); the chevron, Show more
  and Retry buttons are `tabindex=-1`. The keys are in `treeKeys.ts` (pure, so
  the tests drive it): Up/Down move through the visible rows, Right opens a
  branch and then steps into it, Left closes it and then steps out to its entry,
  Enter does what a double-click does (Shift: every loaded sibling; on "Show
  more" and error rows: load more / retry), and the context-menu key or
  Shift+F10 opens the entry menu under the entry's text with the focus on its
  first item (`GridPopupMenu`'s `focusFirst`; its arrows, Home/End, Escape and
  Tab; Enter and Space stop at the menu). Escape, a chosen item, a scroll and a
  new payload close a keyboard-opened menu through `closeMenu`, which gives the
  focus back to the entry; a click away (`close` with `'pointer'`) does not. A
  chosen item that makes a node loses the focus anyway: the graph's `clearFocus`
  runs once the node exists. The menu key's `contextmenu`, which Windows fires
  on key up at the menu's first item, is ignored by a keyboard-opened
  `GridPopupMenu` unless a pointer press on it came first. "Show more" and Retry
  (`loadFrom`) keep the focus on the entry above while the page loads, then move
  it to the first entry it brought (or the row, if it failed again); a
  visualization is in a shadow root, so the check reads the root's
  `activeElement`, not the document's. A key the tree handles is stopped
  (`stopPropagation`), so the graph editor's window handlers (Enter opens the
  component browser, the arrows, Escape deselects) never see it; Tab, typing and
  anything with Ctrl/Alt/Meta pass. The focus ring is the engine-log list's
  (`2px solid var(--color-primary)`, `:focus-visible`).
