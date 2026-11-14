# One lazy tree for JSON and objects (piece 2)

Piece 2 of the visualisation layering work
(`2026-11-13-visualization-depends-on-base-design.md`). It builds on spec A
(`2026-11-14-viz-id-conversion-and-viz-json-design.md`), which made the JSON
visualisation's data a conversion (`Viz_Json`). The owner's principle: the JSON
visualisation and an object explorer share one lazy tree.

## Intent

- The JSON visualisation becomes a tree that loads a node's children when it is
  expanded, a page at a time. Nothing is cut off: no 100-item or 5-level limit.
- The same tree explores any Enso value. By default a value's children come from
  its JSON (`to_js_object`); a type can describe its own node, children and the
  expression a double-click creates, by a conversion in its own module (owner
  decision, 2026-11-14).
- Double-click on a child creates a node for it, as the table view's links do.

## Facts (2026-11-14)

- The JSON visualisation (`components/visualizations/JSONVisualization/`, about
  340 lines) renders the whole JSON from `default_preprocessor` with nested
  components; it is the default for a `JS_Object` (`Id.from`, spec A) and
  available for any value. Projections: selecting `JS_Object` keys creates
  `.get` nodes (`JSONVisualization.vue`).
- After spec A, `default_preprocessor x` is `(Viz_Json.from x).json_text`:
  bounded text (vectors 100 items, 5 levels; text 2000 characters; tables 10
  rows). A vector deeper than 5 levels is cut with an unquoted `[...]`, which is
  not valid JSON, so the JSON visualisation cannot parse it today.
- The table view already loads data on demand: its server-side rows call an Enso
  function through `config.executeExpression` (`TableVizDataSourceUtils.ts`).

## Design

### 1. Enso: `Viz_Tree`

In `Standard.Visualization`:

```
type Viz_Tree
    Leaf (json_text : Text)
    Branch (kind : Text) (size : Integer) (label : Text) (children : Integer -> Integer -> Vector Viz_Tree_Child)

type Viz_Tree_Child
    Value (key : Text | Integer) (tree : Viz_Tree) (node_expression : Text | Nothing)
```

- `Leaf` is a scalar's JSON: number, boolean, `null`, text (cut at 2000
  characters with `…`, as `Viz_Json`).
- `Branch` is an object (`kind` `"object"`) or array (`"array"`) with its
  `size`, a `label` for its row (`{12 keys}`, `[1,234 items]`,
  `Table (3 rows, 4 columns)`), and `children start count`, which returns one
  page. A child's tree is computed only when asked for.
- `node_expression` is the expression a double-click creates for that child,
  relative to its parent (e.g. `.at 3`, `.get "name"`, `.name`), or `Nothing`.
- Conversions, in the target module for Base types:
  - `Any`: from `to_js_object` (keys become children; no node expression unless
    the value is a `JS_Object`).
  - `JS_Object`: its keys, node expression `.get "key"`.
  - `Vector`, `Array`: indices, `.at i`. `Dictionary`: keys, `.at key`.
  - `Text`, `Number`, `Boolean`, `Nothing`, dates: leaves.
  - A dataflow error: the payload's tree (as `Viz_Json`).
- Libraries, in their own modules on public types: Table a summary branch
  (`row_count`, `columns`, then `rows` paged from the table itself, never an
  object per row of the whole table); Column and Row similarly; XML the element
  tree.
- A user type: `Viz_Tree.from (that:My_Type)` in its own module, choosing its
  children, labels and node expressions.

IDE entry points, in a new module `Standard.Visualization.Tree`:

- `prepare value` (the viz's preprocessor): the root and its first page of
  children, each child with its kind, size, label and whether it has a node
  expression.
- `children value path start count`: walks `path` (keys and indices) through the
  `Viz_Tree` nodes from the root and returns one page. Pages are 100 entries.

`Viz_Json` (spec A) stays: it is still the data of `default_preprocessor`, which
the Image visualisation and custom visualisations without a preprocessor use.

### 2. GUI: the tree visualisation

- The JSON visualisation keeps its name ("JSON"), icon and default for
  `JS_Object`, and becomes the tree, with its own preprocessor (`Tree.prepare`).
- Rendering: a virtualised, indented list (a branch of 10,000 children does not
  build 10,000 DOM nodes). Rows show `key: value`; a branch shows its label and
  an expand arrow; a branch with more than one page ends in "Show 100 more (of
  1,234)". Leaves render as today's JSON visualisation does.
- Loading: an expand or "show more" calls `children` through
  `executeExpression`. Expanded state is kept per path, so a re-evaluated node
  fetches the same open branches again instead of collapsing.
- Double-click on a child: the child's node expression, chained from the
  parent's; none: nothing happens and the tooltip says so.
- Projections (several `JS_Object` keys to `.get` nodes) carry over for
  `JS_Object` paths.
- A failed page shows an inline "couldn't load: <message>" row under its branch,
  with a retry; the rest of the tree stays usable.

## Delivery

After spec A merges.

1. **2.1 Enso**: `Viz_Tree`, its conversions (Base, Table, XML), `Tree.prepare`
   and `Tree.children`. Invisible on its own; `CI: No changelog needed`; merges
   on green.
2. **2.2 GUI**: the tree visualisation replaces the JSON visualisation's
   rendering. A feature: changelog entry; waits for the owner's OK after an
   installer test.

## Verification

- Enso (`Tree_Spec` and goldens): Base conversions; paging (first and last page,
  a start past the end); paths through objects, vectors, dictionaries and a
  Table summary; a user type's own conversion and node expressions; errors.
  Goldens pin `prepare` and `children` for a `JS_Object`, a deep vector, a Table
  and an atom.
- GUI unit tests: the visible rows from a tree, paging and "show more", expanded
  state across a new payload, the node expression a double-click makes, a failed
  page.
- Playwright: expand, show more and double-click with a mocked `children`.
- Installer check: a `JS_Object` with a 1,000-item array, a vector 8 levels
  deep, a Table, a user atom, double-click on each.

## Non-goals

- Raw constructor fields (a debugger view). A type that wants them provides a
  `Viz_Tree` conversion.
- Editing values in the tree.
- The actions model (piece 3): the node expression becomes a reference to an
  Enso-described action there.
