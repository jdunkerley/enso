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
- `TableVizDataSourceUtils.ts`: the server-side requests (sort, filter, page). A
  row page is requested with no timeout (`executeExpression(…, null)`): a busy
  engine answers late, and a page settled empty showed "No Rows To Show" (#777,
  Note [Row Pages Wait For The Engine] in `../TableVisualization.vue`).
- `tableVizFilterSetUpUtils.ts`, `tableVizFilterUtils.ts`,
  `CommunitySetFilter.ts`: the filters. `TableVisualisationTooltip.ts`: the
  header tooltip with the data quality metrics. `tableVizToolbar.ts`: the
  toolbar.
