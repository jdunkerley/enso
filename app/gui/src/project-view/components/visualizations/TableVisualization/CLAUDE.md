# TableVisualization

The table visualisation (`../TableVisualization.vue`) and its helpers.

- `tableView.ts`: the pure view model. It turns the JSON `prepare_visualization`
  sends into AG Grid's column definitions and rows, the digit grouping, the row
  counts and the flags the component reads; it also reads a server row page and
  a column's distinct values. The component owns state, AG Grid and the server
  calls and passes the rest in (`TableViewContext`). It parses the message with
  zod (`viewMessageSchema`); the format is described in
  `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`, "Table view
  message".
- `../__tests__/tableViewSnapshot.test.ts`: the gate on that model. It runs
  every pinned golden of `test/Visualization_Tests/data/pinned` (`table_*`,
  `ssrm_*`) through `tableView.ts` and snapshots the result, including each
  link's tooltip and the node it creates. A change to the wire format must leave
  the snapshot unchanged (regenerate the goldens, not the snapshot); a change to
  the snapshot is a visible change.
- `TableVizDataSourceUtils.ts`: the server-side requests (sort, filter, page).
  The component (`../TableVisualization.vue`, `getData`) requests a row page
  with no timeout (`executeExpression(…, null)`): a busy engine answers late,
  and a page settled empty showed "No Rows To Show" (#777, Note [Row Pages Wait
  For The Engine]). A column filter's list of distinct values
  (`getSetFilterValues`) waits the same way, so a late answer still fills it
  (#781).
- `tableVizFilterSetUpUtils.ts`, `tableVizFilterUtils.ts`,
  `CommunitySetFilter.ts`: the filters. A set filter's values are what the
  engine listed, so a Boolean column's are JSON Booleans, not text
  (`TableVizDataSourceUtils.ts`, `setValue`: `True`/`False`; one picked is
  `..Equal`, several `..Is_In`). The engine lists a column's distinct values for
  fewer than 100 of them but sets `multi_filter` for 100 too, so `tableView.ts`
  offers a Text column's set filter only below 100 (#778).
  `TableVisualisationTooltip.ts`: the header tooltip with the data quality
  metrics. `tableVizToolbar.ts`: the toolbar. Its "create components" button,
  and the links' nodes in `tableView.ts`, are built by `../vizActions.ts` from
  the `actions` Enso sends with the value; the button is there when the value
  offers `sort`, `filter`, `remove_columns` or `reorder_columns`
  (`TABLE_TOOLBAR_ACTIONS`).
- `columnValueToEnso.ts`: a cell's text as an Enso value of its column's type
  (the toolbar's filters). `tableContextMenu.ts`: the right-click menu, from the
  value's `open_column`, `open_row` and `open_cell` actions (or the view's link
  when it has no row action) filled from the clicked cell; the row is its `#`
  number, which survives sorting. Both, the scatter plot's `scatterNodes.ts` and
  the Warnings visualisation's node are pinned by
  `../__tests__/vizNodeTextSnapshot.test.ts`: a change to the text of a created
  node is a visible change.
