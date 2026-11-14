# Visualisation actions described by Enso (piece 3)

Piece 3 of the visualisation layering work
(`2026-11-13-visualization-depends-on-base-design.md`). It follows spec B
(`2026-11-14-table-viz-one-format-design.md`) and piece 2
(`2026-11-14-viz-lazy-tree-design.md`), and rewires their links and node
expressions onto one model. The owner's principle: a visualisation's node
actions come mostly from Enso (chains, static calls); gestures stay in the
visualisation.

## Intent

- Enso describes the actions available for a value: what they are called and the
  expression each creates. A library offers its own for its types; a user type
  can too.
- Each visualisation owns its gestures (a link, sort and filter state, a brush)
  and only fills in the values a template asks for. No visualisation code
  contains an Enso method name.
- Plain actions appear as toolbar buttons in any visualisation, and every action
  that applies to a clicked cell, row or key appears in a right-click menu in
  the table and tree visualisations (owner decision, 2026-11-14).
- Actions can chain on the node or create a standalone node, such as a static
  call taking the node as an argument (owner decision).

## Facts (2026-11-14, `develop` at 7ccf3be658)

Every node-creating action today is built in TypeScript:

- Table: link columns and the index column (`get_row`, `at`, `at {{#key}}`,
  `get_child_element {{#key}}`; a bare action is completed by quoting the link
  value, `getAstPattern` in `TableVisualization.vue`); a toolbar button that
  turns the grid's sort and filter state into `.sort` and `.filter` chain nodes
  (`tableVizToolbar.ts`), shown when `enable_create_node` is set.
- Scatter Plot: a brush selection becomes `.filter` chains with bounds, and an
  action button (`ScatterplotVisualization.vue:610-695`).
- JSON: projections of selected `JS_Object` keys into `.get` nodes.
- Warnings: a "remove warnings" button writing `.remove_warnings`
  (`WarningsVisualization.vue`).

Only the link templates come from Enso. Everything else hard-codes method names,
so a database table or another library cannot offer a different expression.

## Design

### 1. Enso: `Viz_Action`

In `Standard.Visualization`:

```
type Viz_Action
    Value (id : Text) (label : Text) (icon : Text) (kind : Viz_Action_Kind) (template : Text)

type Viz_Action_Kind
    Chain      # the node becomes `node.<template>`
    New_Node   # the template is a whole expression; `{{node}}` names the node

type Viz_Actions
    Value (actions : Vector Viz_Action)
```

- `id` is a stable name a visualisation looks for: `open_child`, `sort`,
  `filter`, `create_from_selection`, `brush_filter`, `remove_warnings`, and any
  id a library adds for a plain action.
- Templates use the link syntax spec B fixes: `{{#x}}` inserts a value raw,
  `{{@x}}` as quoted text, `{{x*}}` a vector of values, `{{node}}` the source
  node (for `New_Node`).
- Conversions:
  - Base, in Visualization: Vector and Array `open_child` `at {{#index}}`;
    Dictionary `at {{@key}}`; JS_Object `get {{@key}}`; any value with warnings
    `remove_warnings`.
  - Table, on the public `Table` and `Column` (in-memory and database alike):
    `open_child` (`get_row {{#index}}`, `at {{#index}}`), `sort`, `filter`,
    `create_from_selection`, `brush_filter`. A library can offer different
    templates for its own types.
  - XML, Row and the key/value views: their `open_child` templates (today's link
    actions, written out).
  - A user type: `Viz_Actions.from (that:My_Type)` in its own module.
- Delivery: each visualisation's data carries an `actions` field, the serialised
  `Viz_Actions` of the value. Spec B's per-column `link` and the index action
  become a reference to an `open_child` action (with the column whose value
  fills it); piece 2's per-child node expression likewise.

### 2. GUI

- One shared builder fills a template from a record of values, parses it, and
  creates the node: chained on the source node (`Chain`) or standalone with
  `{{node}}` replaced by the node's identifier (`New_Node`). A template whose
  value is missing gives a disabled action, never a broken node.
- The builder replaces the hand-built AST code in `tableVizToolbar.ts`, the
  Scatter Plot's filter and action buttons, the JSON projections, the Warnings
  visualisation's button and the table's link handling (`getAstPattern`,
  `createNode`).
- A shared toolbar component renders the value's plain actions (those with no
  gesture parameters) in any visualisation; the Warnings visualisation's button
  becomes one of them.
- Right-click menu in the table and tree visualisations: the actions that apply
  to the clicked cell, row or key, filled in from it.
- A visualisation declares the gesture ids it understands; a gesture whose
  action the value does not offer is hidden. This replaces `enable_create_node`
  and similar flags.

## Delivery

After spec B's switch (B1) and piece 2's GUI (2.2) merge.

1. **3.1 Enso**: `Viz_Action`, its conversions, and the `actions` field beside
   each visualisation's data. Invisible; `CI: No changelog needed`; merges on
   green.
2. **3.2 GUI**: the shared builder and toolbar, every visualisation moved onto
   them. The created nodes are unchanged (gated by the node-text snapshot
   below): invisible, merges on green.
3. **3.3 Right-click menu**: a feature; changelog entry; waits for the owner's
   OK after an installer test.

## Verification

- Enso (`Viz_Actions_Spec`): each conversion; Table's templates the same for
  in-memory and database tables; warnings; a user type's own conversion; a
  `New_Node` action with `{{node}}`.
- GUI unit tests: template filling (raw, quoted, vectors, `{{node}}`, a missing
  value disabling the action). A node-text snapshot: before 3.2, every action
  today's visualisations create (each link kind, sort and filter, the brush, the
  projections, remove warnings) is recorded as the expression text it makes;
  after 3.2 the same gestures must make identical text.
- Playwright: table sort and filter to nodes, scatter brush to a filter, remove
  warnings, right-click on a table row and on a tree key (3.3).
- Installer check (3.3): each action above, plus a right-click on a database
  table row and on a JSON key.

## Non-goals

- Actions outside visualisations (the component browser, node menus).
- Undo grouping beyond what node creation already does.
- New actions for existing types beyond today's set, except where a template is
  needed to replace hard-coded code.
