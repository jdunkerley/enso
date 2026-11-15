# TableVisualization

The table visualisation (`../TableVisualization.vue`) and its helpers.

- `tableView.ts`: the pure view model. It turns the JSON `prepare_visualization`
  sends into AG Grid's column definitions and rows, the digit grouping, the row
  counts and the flags the component reads; it also reads a server row page and
  a column's distinct values. The component owns state, AG Grid and the server
  calls and passes the rest in (`TableViewContext`).
- `../__tests__/tableViewSnapshot.test.ts`: the gate on that model. It runs
  every pinned golden of `test/Visualization_Tests/data/pinned` (`table_*`,
  `ssrm_*`) through `tableView.ts` and snapshots the result, including each
  link's tooltip and the node it creates. A change to the wire format must leave
  the snapshot unchanged (regenerate the goldens, not the snapshot); a change to
  the snapshot is a visible change.
- `TableVizDataSourceUtils.ts`: the server-side requests (sort, filter, page).
- `tableVizFilterSetUpUtils.ts`, `tableVizFilterUtils.ts`,
  `CommunitySetFilter.ts`: the filters. `TableVisualisationTooltip.ts`: the
  header tooltip with the data quality metrics. `tableVizToolbar.ts`: the
  toolbar.
