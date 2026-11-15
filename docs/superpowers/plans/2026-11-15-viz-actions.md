# Visualisation Actions Described by Enso (Piece 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every node a visualisation creates is made from a template that Enso
sends with the value (`Viz_Actions`), through one GUI builder, so that no
visualisation's TypeScript names an Enso method; then a right-click menu in the
table and tree visualisations offers the actions that apply to the clicked cell,
row or entry.

**Architecture:** PR 3.0 freezes today's behaviour: it moves the remaining
node-building code out of the Vue components into pure modules and snapshots the
exact expression text every gesture creates (`vizNodeTextSnapshot.test.ts`),
beside spec B's table snapshot, which already pins every link's node. PR 3.1
adds `Viz_Action`, `Viz_Action_Kind` and `Viz_Actions` to
`Standard.Visualization`, the conversions (Vector, Array; Table and Column in
`Standard.Table`), and an `actions` field at the front of the JSON of the table,
scatter-plot, tree and warnings preprocessors. PR 3.2 adds the GUI builder
(`vizActions.ts`) and the plain-action toolbar, moves every visualisation onto
them, and deletes the `create_node` option and `get_row_method`; both snapshots
stay unchanged. PR 3.3 replaces the table's fixed right-click menu with the
value's actions and adds one to the tree.

**Tech Stack:** Enso standard library (`distribution/lib/Standard/*`), the Enso
test framework and golden files (`expect_pinned`), TypeScript/Vue 3 with zod 3
and AG Grid Community in `app/gui`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-viz-actions-design.md` (approved by
the owner), within the parent design
`docs/superpowers/specs/2026-11-13-visualization-depends-on-base-design.md`.
Read the spec first, then "Owner decisions" and "Spec gaps resolved while
planning" below: the spec was written against `develop` at 7ccf3be658, before
spec B (#769, #776, #780) and piece 2 (#768, #771) merged, and the plan departs
from its text where today's code requires it.

## Owner decisions

Asked while planning; the owner chose the recommendation on all four
(2026-11-15), and the plan is written to them: the links stay in the view, the
tree keeps its per-child `expr`, filter and sort arguments stay in the GUI, and
the tree's menu offers Get Value and Get All Loaded Values Here. The questions
and their reasoning follow.

1. **Do the table's links stay in the view, or become references to an
   `open_child` action?** The spec says spec B's per-column `link` and the
   grid's `index` become a reference to an `open_child` action of the value.
   Today eleven producers write a link template next to the column it reads:
   `In_Memory_Viz_Source` (`get_row {{#index}}`, `at {{#index}}`), the vector
   views (`at {{#index}}`), Dictionary (`at {{#key}}`), Row (`at {{@column}}`),
   XML (`get {{#key}}`, `get_child_element {{#key}}`), the database connections
   (`query {{@Table}}`, DuckDB and SQL Server
   `query (..Table_Name {{@Table}} {{@Schema}})`), Excel and Google workbooks
   (`read {{@worksheets}}`), Snowflake (`set_schema {{@Schema}}` or
   `query {{@Name}}`, depending on the connection's state) and Hyper files
   (`read {{@Table}}`, `read {{@Table}} {{@Schema}}`, depending on the data).
   Each is already described by Enso, beside the column names its placeholders
   read; moving them would add a `Viz_Actions.from` to nine more types that has
   to repeat the view's own condition (Snowflake, Hyper) and column names, and
   would rewrite every `table_*` golden. **Recommendation: keep the links in the
   view.** The GUI turns a link into a `Chain` action and makes its node with
   the same builder as every other action (Task 3.2.3), so the spec's intent
   (one model, no method name in the GUI) holds. _If the owner chooses
   references:_ add a task to 3.1 giving each of the eleven producers' types a
   `Viz_Actions.from` with an `open_child` action, change `View_Link` to
   `{"action_id":"open_child"}`, regenerate the `table_*` goldens, and change
   `toLinkField` in Task 3.2.3 to look the template up in the actions.
2. **Does the tree keep each child's `"expr"`?** The spec's "JSON: projections
   of selected `JS_Object` keys" no longer exists: piece 2 replaced the JSON
   view with a lazy tree in which Enso sends, with each child, the step that
   reaches it (`.get 'name'`, `.at 3`, `.rows`, `.row_count`, `.at '@id'`), and
   the GUI chains the steps from the root. The steps are per child and change
   with each level's type (a table's summary entries, a row's columns, an XML
   element's attributes), so one template on the root value cannot describe
   them, and they already come from Enso. **Recommendation: keep `"expr"`**; the
   chain is built by the shared builder as literal steps (Task 3.2.5).
3. **Filter conditions, sort specs and typed literals stay in the GUI.** The
   table toolbar's gesture builds `Filter_Condition` and `Sort_Column` values
   (`..Equal 3`, `..Between 1 5`, `..Is_In [...]`, `..Is_Nothing`,
   `..Name "a" ..Ascending`) and typed cell literals (`Date.new 2024 1 2`,
   `Time_Of_Day.parse "…"`). These are constructors of `Standard.Base` types
   that the grid's filter state maps onto one-to-one, not methods of the
   visualised value. **Recommendation:** the methods (`sort`, `filter`,
   `remove_columns`, `reorder_columns`, `get_row`, `at`, `get_value`,
   `remove_warnings`) move into Enso templates; the condition and literal
   builders stay as the gesture's values, inserted through the bare `{{x}}`
   placeholder (gap 5). Moving them too would need a template per filter
   operator, which nothing asks for.
4. **What does the tree's right-click menu offer?** The tree has no cell or row
   actions of its own; an entry's action is its chain. **Recommendation:** two
   items on an entry with a chain: "Get Value" (the double-click) and "Get All
   Loaded Values Here" (the Shift+double-click); nothing on an entry without one
   (Task 3.3.2).

## Global Constraints

- **Layering (owner rule):** `Standard.Base` knows nothing about visualisation.
  `Standard.Visualization` imports only `Standard.Base`. A library converts its
  own values to Visualization's types (`Viz_Actions.from (that:Table)` lives in
  `Standard.Table`), never the reverse.
- **Conversions only on public types** (`Table`, `Column`, `Row`, …),
  dispatching through `that.implementation` only where the implementations
  differ (as `Viz_Table.from (that:Table)` and `Id.from (that:Table)` do). The
  table actions are the same in memory and in a database, so the conversion
  needs no dispatch.
- **No new Vectors in Enso where avoidable (owner rule):** range maps over
  existing values, lazy bindings, direct lookups; no `to_vector`, `take`,
  `slice` copies, no building a page to search it. A small fixed vector (a
  handful of actions) is fine.
- **Node text is unchanged by 3.1 and 3.2.** The gates:
  `app/gui/src/project-view/components/visualizations/__tests__/__snapshots__/vizNodeTextSnapshot.test.ts.snap`
  (3.0) and spec B's `__tests__/__snapshots__/tableViewSnapshot.test.ts.snap`
  are unchanged by 3.1 and 3.2. Only the drivers block of
  `vizNodeTextSnapshot.test.ts` may change (3.2.7, 3.3.1). 3.3 may change the
  snapshot only in the entries listed in Task 3.3.1.
- **Template syntax** (both sides): `{{#x}}` the value of `x`, a number when it
  reads as one, else text; `{{@x}}` the value as it is (a number stays a number,
  anything else is text); `{{x}}` an Enso expression the gesture supplies; `*`
  after the name (`{{@x*}}`, `{{x*}}`, `{{#x*}}`) a vector of such values;
  `{{node}}` the visualised node, only in a `New_Node` template. A template
  whose value is missing gives no node (the action is disabled or omitted),
  never a broken one.
- **Performance:** the `actions` field must not slow the table view: each case
  of spec B's `Table_View_Benchmark_Spec` (`ENSO_VIZ_BENCH=1`) within 10% of
  `develop` or faster (Task 3.1.3).
- Every entity added in a **non-private** module carries `## ---` /
  `private: true` / `---` doc metadata. An unused argument is silenced with
  `_ = that` on its own line.
- No unused imports: the `-Werror` static-analysis lint fails on them. After
  moving or deleting code, remove each import the file no longer uses (Enso and
  TypeScript: `lint` fails on both).
- A public signature change regenerates the library's committed `docs/api`.
- Goldens: written with `expect_pinned` and `ENSO_UPDATE_PINNED=1`, which
  rewrites **every** golden the run reaches. Copy back only the files the task
  names; `git status` must show no other golden changed.
- Never run pnpm from WSL inside a Windows checkout. Linux GUI checks run in the
  WSL clone `~/vizwork2`. Playwright runs with
  `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" <files>`
  from `app/gui` (never `test:integration -- <files>`, which runs everything).
- Changelog: 3.0, 3.1 and 3.2 take the `CI: No changelog needed` label (3.2's
  only visible differences are fixes, gaps 7 and 8). 3.3 adds one entry under
  `#### Enso IDE`.
- Merge gates: 3.0, 3.1, 3.2 merge on green. 3.3 is a feature: screenshots
  before/after on the orphan `pr-screenshots` branch, then it waits for the
  owner's OK after an installer test.
- Never `git stash`.

## Spec gaps resolved while planning

Each was found by reading `develop` at f7e78e70fd against the spec. Record them
in the description of the PR that implements the resolution.

1. **The JSON projections are gone** (spec "Facts"). Piece 2's tree sends a node
   expression per child (`Viz_Tree_Child.node_expression`, `"expr"` on the wire)
   and the GUI chains them (`treeExpression.ts`, `lazyTree.ts`). Open question
   2: the expressions stay; 3.2.5 builds the chain with the shared builder.
2. **Links stay in the view** (spec Design §1, "Delivery"). Open question 1. The
   view's link templates (spec B) are the `Chain` actions of their view; the
   GUI's `getAstPattern` (`tableView.ts`) is replaced by the shared builder.
3. **The table already has a right-click menu.** `TableVisualization.vue`'s
   `getContextMenuItems` offers Get Column (`at "col"`), Get Row (`get_row n`)
   and Get Value (`get_value "col" n`) on every grid, with the method names in
   TypeScript. It creates broken nodes on anything but a table (a vector has no
   `get_row`, a column no `get_value`) and uses AG Grid's display row index, so
   after a client-side sort it gets the wrong row. 3.0 snapshots it; 3.2 leaves
   it as it is (moving it would change which items show, a visible change); 3.3
   replaces it with the value's `open_column`, `open_row` and `open_cell`
   actions filled from the row's `#` number.
4. **Action ids.** The spec's `open_child` becomes `open_row` (a row or item by
   number: the scatter plot's point, the menu's Get Row), `open_column` and
   `open_cell` (the menu). `create_from_selection` is not an action: it is the
   table toolbar's button, which writes up to four nodes, from `sort`, `filter`,
   `remove_columns` and `reorder_columns` (today's button also writes
   `remove_columns` and `reorder_columns` nodes, which the spec does not list).
   `brush_filter` and `remove_warnings` are as in the spec.
5. **Template syntax.** The spec says `{{#x}}` inserts a value raw; spec B (now
   merged) made it "a number when it reads as one, else text", and every link
   relies on that, so it stays. `{{@x}}` keeps spec B's meaning too: today's
   link code turns a number cell into a number literal even under `@`
   (`isNumber(castedValue)` in `getAstPattern`). Added: a bare `{{x}}` is an
   Enso expression the gesture builds (a filter condition, a sort spec), which
   the toolbar needs; `*` works with all three. No producer uses a bare
   placeholder today (all links use `#` or `@`).
6. **Constructors stay in the gesture.** Open question 3.
7. **The scatter plot's point already has an Enso-described action**,
   `get_row_method` (`"get_row"`, or `"at"` for a vector), but a column sends
   `"get_row"` and `Column` has no `get_row`. It moves onto `open_row`, which a
   column offers as `at {{#index}}`: double-clicking a column's point now makes
   a working node. `get_row_method` is deleted in 3.2.6.
8. **The scatter brush is broken on anything but a table.** On a column it
   writes `filter "Index" …` (no such column filter); on a vector the axis is
   `null` and the button's handler throws. Only `Table` offers `brush_filter`,
   so 3.2 hides the button for other values. A visible fix, in an otherwise
   invisible PR; recorded in its description.
9. **`remove_warnings` cannot come from a conversion.** `prepare_visualization`
   strips a value's warnings before converting it, and a conversion cannot see
   warnings. The Warnings preprocessor sends the action itself, always (it is a
   no-op on a value without warnings), and the visualisation keeps today's rule
   for disabling it (no warnings listed, or the value is an error). Its message
   becomes `{"warnings":[…],"actions":[…]}`.
10. **No keyed Base conversions.** The spec lists Dictionary `at {{@key}}` and
    JS_Object `get {{@key}}`. Nothing would use them: the dictionary's link
    stays in its view as `at {{#key}}` (`@` would change node text: `at 1`
    becomes `at "1"` for an integer key), and the tree uses `"expr"`. YAGNI:
    only Vector and Array convert in Visualization.
11. **`enable_create_node` is now spec B's `options.create_node`.** Table offers
    `sort`, `filter`, `remove_columns` and `reorder_columns`; the GUI shows the
    toolbar button when the value offers any of them, and 3.2.6 deletes
    `create_node` from the writer, the goldens and the GUI. Column offers none
    of them: today's column view has no such button (`create_node` only for a
    table), though the spec lists `sort` and `filter` under Column.
12. **Where `actions` goes.** One field, first in the JSON object, added by
    `Viz_Actions.add_to_json` in each entry point (`prepare_visualization`,
    `Scatter_Plot.process_to_json_text`, `Tree.prepare`,
    `Warnings.process_to_json_text`). It is absent when the value offers none,
    so the goldens of such values do not change, and never added to an error
    message, a row page or a distinct-values answer. The table's zod schemas do
    not strip unknown keys into errors, so spec B's snapshot is unchanged.
13. **Cost.** The in-memory view is cached by table version; the field is added
    after the cache, so each call builds the table's eight actions (a fixed
    vector) and concatenates. 3.1.3 measures it; if a case is over 10%, the
    table's actions JSON is cached once in `TableValueCache` (code in 3.1.3).
14. **Spacing of created nodes.** Today the table's filter node is written with
    a spaced dot from the source (`operator1 . filter "a" (..Equal 3)`), while
    the scatter brush and the tree start unspaced (`operator1.filter …`,
    `data.get 'tags' . at 1`). The builder's chains take `firstSpaced`, so each
    keeps its text.
15. **A link on an empty cell.** Today a `{{#x}}` link on a `null` cell makes
    `… 0` (`Number(null)` is 0). After 3.2 it makes no node. No golden has one;
    if spec B's snapshot shows a difference here, it is this, and it is listed
    in the 3.2 description.
16. **No new toolbar buttons in 3.2.** The plain-action toolbar shows actions
    without gesture placeholders. Of today's set only `remove_warnings` is
    plain, and only the Warnings preprocessor sends it, so no visualisation
    gains a button.
17. **Spec B's B2 (#779)** may still be open when 3.0 starts. 3.0 branches from
    `develop` after it merges, or rebases onto it before opening.

## Working environment

- Windows worktrees, one per PR, each from `origin/develop` once the previous PR
  has merged: 3.0 in `C:\Repos\Enso\ide-viz-a0` (branch `viz/actions-gate`), 3.1
  in `C:\Repos\Enso\ide-viz-a1` (`viz/actions-enso`), 3.2 in
  `C:\Repos\Enso\ide-viz-a2` (`viz/actions-gui`), 3.3 in
  `C:\Repos\Enso\ide-viz-a3` (`viz/actions-menu`). 3.1 may start while 3.0 is in
  CI (it touches no GUI file); 3.2 needs both merged.
- Enso builds and tests run in the WSL clone `~/vizwork2`. First time only:

  ```bash
  wsl -e bash -lc 'git clone /mnt/c/Repos/Enso/ide ~/vizwork2'
  ```

  Before each build, sync the worktree into it (replace `<wt>` with the worktree
  folder name and `<branch>` with its branch). The clone's `origin` is the
  Windows checkout, whose local `develop` is stale, so fetch the branch ref
  itself, never `origin/develop`:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork2 && git fetch -q /mnt/c/Repos/Enso/ide refs/heads/<branch> && git checkout -qf FETCH_HEAD && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/std-bits/ std-bits/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/distribution/lib/ distribution/lib/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/test/ test/ && \
    rsync -a /mnt/c/Repos/Enso/<wt>/tools/ci/ tools/ci/ && \
    sbt buildEngineDistribution'
  ```

- Run an Enso test project in `~/vizwork2`. `FILTER` is optional, and **a filter
  that matches nothing still exits 0**, so check the printed test count:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork2/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" FILTER'
  ```

  To (re)write golden files, prefix the command with `ENSO_UPDATE_PINNED=1`
  (each regenerated case then **fails** on purpose), copy only the files the
  task names from `~/vizwork2/test/Visualization_Tests/data/pinned/` back to the
  worktree, and run again without it.

- `-Werror` lint, one directory per run (no `-ea`), in `~/vizwork2`:

  ```bash
  built-distribution/enso-engine-*/enso-*/bin/enso --enable-static-analysis --hide-progress -Werror --compile <dir>
  ```

- API docs: regenerate one library's committed `docs/api` in `~/vizwork2`, then
  copy the library's `docs/api/` folder back to the worktree:

  ```bash
  sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/<Lib>/0.0.0-dev"
  ```

  The local `stdlib-api-check` gives false differences on rsync'd files; CI runs
  it.

- GUI (Windows worktree, after `corepack pnpm install --frozen-lockfile` and
  `corepack pnpm -r compile`):
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`,
  `corepack pnpm --filter enso-gui run lint`. Playwright, from `app/gui`:
  `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" <files>`
  (timing-sensitive: `--repeat-each=3` before reading a pass or a failure).
- GUI on Linux: sync the branch into `~/vizwork2` with the same
  `git fetch … refs/heads/<branch> && git checkout -qf FETCH_HEAD`, then
  `corepack pnpm install --frozen-lockfile && corepack pnpm -r compile` (a
  reused clone has stale `dist`), and run `lint` and the Playwright command
  there. Prettier's import organiser has corrupted Vue SFCs only on Linux:
  `git status` must be clean after `lint`.
- When 3.3 has merged, delete the clone (`rm -rf ~/vizwork2`): agent clones have
  filled the WSL disk before.

---

## File structure

| File (under `app/gui/src/project-view/components/visualizations/` unless rooted) | PR       | Responsibility                                                                                   |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `TableVisualization/columnValueToEnso.ts`                                        | 3.0      | A cell's text as an Enso value of its column's type (moved from the component).                  |
| `TableVisualization/tableContextMenu.ts`                                         | 3.0, 3.3 | The right-click menu's nodes: today's three (3.0), the value's actions (3.3).                    |
| `ScatterplotVisualization/scatterNodes.ts`                                       | 3.0, 3.2 | The scatter plot's brush filter and point nodes (moved, then onto the builder).                  |
| `warningsNodes.ts`                                                               | 3.0      | The remove-warnings node (moved); deleted in 3.2.                                                |
| `__tests__/vizNodeTextSnapshot.test.ts` (+ `.snap`)                              | 3.0      | The gate: the expression text of every gesture's node.                                           |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Action_Kind.enso`     | 3.1      | `Chain` or `New_Node`.                                                                           |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Action.enso`          | 3.1      | One action: id, label, icon, kind, template; its JSON.                                           |
| `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Actions.enso`         | 3.1      | A value's actions, `add_to_json`, `for`, `remove_warnings_action`, the Vector/Array conversions. |
| `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Viz_Helpers.enso`        | 3.1      | `table_actions`, `column_actions`.                                                               |
| `test/Visualization_Tests/src/Viz_Actions_Spec.enso`                             | 3.1      | The conversions, the JSON, the entry points' field.                                              |
| `vizActions.ts` (+ `__tests__/vizActions.test.ts`)                               | 3.2      | The builder: parse actions, fill a template, make a pattern; the plain-action toolbar.           |
| `TableVisualization/tableVizToolbar.ts`                                          | 3.2      | The sort/filter button on `sort`, `filter`, `remove_columns`, `reorder_columns`.                 |
| `TableVisualization/tableView.ts`                                                | 3.2, 3.3 | Links through the builder; `createNodeEnabled` from the actions; `viewLink` (3.3).               |
| `JSONVisualization/treeExpression.ts`, `JSONVisualization.vue`, `TreeRow.vue`    | 3.2, 3.3 | The chain on the builder (3.2); the right-click menu (3.3).                                      |

---

## PR 3.0 — Snapshot the node text of every gesture (invisible)

Worktree `C:\Repos\Enso\ide-viz-a0`, branch `viz/actions-gate` from
`origin/develop`.

### Task 3.0.1: Move the node-building code out of the components

A pure move: no behaviour changes. Each function is moved verbatim except where
its dependency on component state becomes a parameter.

**Files:**

- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/columnValueToEnso.ts`
- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableContextMenu.ts`
- Create:
  `app/gui/src/project-view/components/visualizations/ScatterplotVisualization/scatterNodes.ts`
- Create: `app/gui/src/project-view/components/visualizations/warningsNodes.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`
  (`getColumnValueToEnso`, `getFormattedValueForCell`, `createDateTimeValue`,
  `createDateValue`, `getAstValuePattern`, `getAstGetValuePattern`,
  `createValueNode`)
- Modify:
  `app/gui/src/project-view/components/visualizations/ScatterplotVisualization.vue`
  (`filterPattern`, `makeFilterPattern`, `getAstPatternFilterAndSort`,
  `getAstPattern`, `createNewFilterNode`, `createNode`)
- Modify:
  `app/gui/src/project-view/components/visualizations/WarningsVisualization.vue`
  (`removeWarnings`)
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/CLAUDE.md`

**Interfaces:**

- Produces (3.0.2 and 3.2 rely on these names):
  - `columnValueToEnso(columnTypes: ReadonlyMap<string, string>): (columnName: string) => (item: string, module: Ast.MutableModule) => Ast.Owned<Ast.MutableExpression>`
  - `type ValueNodeAction = 'at' | 'get_row' | 'get_value'`;
    `valueNodePattern(columnId: string | null | undefined, rowIndex: number | null | undefined, action: ValueNodeAction): Pattern | undefined`
  - `brushFilterPattern(series: string[], xColName: string, minX: number, maxX: number, minY: number, maxY: number): Pattern`;
    `rowPattern(selector: number | undefined, action: string | undefined): Pattern | undefined`
  - `removeWarningsPattern(): Pattern`

- [ ] **Step 1: Create `columnValueToEnso.ts`.**

```ts
/** @file How the table toolbar writes a cell's text as an Enso value of its column's type. */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";
import { getCellValueType, isNumericType } from "./tableVizUtils";

const createDateTimeValue = (
  patternString: string,
  item: string,
  module: Ast.MutableModule,
) => {
  const pattern = Pattern.parseExpression(patternString)!;
  return pattern.instantiateCopied([Ast.TextLiteral.new(item, module)]);
};

const createDateValue = (item: string, module: Ast.MutableModule) => {
  const dateOrTimePattern = Pattern.parseExpression("(Date.new __ __ __)");
  const dateTimeParts = item
    .match(/\d+/g)!
    .filter((part, i) => i < 3)
    .map((part) => Ast.tryNumberToEnso(Number(part), module)!);
  return dateOrTimePattern.instantiateCopied([...dateTimeParts]);
};

const getFormattedValueForCell = (
  item: string,
  module: Ast.MutableModule,
  cellType: string,
) => {
  if (isNumericType(cellType)) {
    return Ast.tryNumberToEnso(Number(item), module)!;
  }
  if (cellType === "Date") {
    return createDateValue(item, module);
  }
  if (cellType === "Time") {
    return createDateTimeValue("Time_Of_Day.parse (__)", item, module);
  }
  if (cellType === "Date_Time") {
    return createDateTimeValue("Date_Time.parse (__)", item, module);
  }
  return Ast.TextLiteral.new(item);
};

/**
 * For a column, the function writing one of its cells' text as an Enso value of the column's
 * type (`columnTypes` maps each column to its value type's constructor).
 */
export function columnValueToEnso(columnTypes: ReadonlyMap<string, string>) {
  return (columnName: string) => {
    const columnType = columnTypes.get(columnName) ?? "";
    if (isNumericType(columnType)) {
      return (item: string, module: Ast.MutableModule) =>
        Ast.tryNumberToEnso(Number(item), module)!;
    }
    if (columnType === "Date") {
      return (item: string, module: Ast.MutableModule) =>
        createDateValue(item, module);
    }
    if (columnType === "Time") {
      return (item: string, module: Ast.MutableModule) =>
        createDateTimeValue("Time_Of_Day.parse (__)", item, module);
    }
    if (columnType === "Date_Time") {
      return (item: string, module: Ast.MutableModule) =>
        createDateTimeValue("Date_Time.parse (__)", item, module);
    }
    if (columnType === "Mixed") {
      return (item: string, module: Ast.MutableModule) => {
        const parsedCellType = getCellValueType(item);
        return getFormattedValueForCell(item, module, parsedCellType);
      };
    }
    if (columnType === "Boolean") {
      return (item: string, module: Ast.MutableModule) => {
        return item === "false"
          ? Ast.Ident.new(module, Ast.identifier("False")!)
          : Ast.Ident.new(module, Ast.identifier("True")!);
      };
    }
    return (item: string) => Ast.TextLiteral.new(item);
  };
}
```

In `TableVisualization.vue`, delete `getColumnValueToEnso`,
`getFormattedValueForCell`, `createDateTimeValue` and `createDateValue`, import
`columnValueToEnso` from `./TableVisualization/columnValueToEnso`, and add in
their place:

```ts
const getColumnValueToEnso = (columnName: string) =>
  columnValueToEnso(colTypeMap.value)(columnName);
```

- [ ] **Step 2: Create `tableContextMenu.ts`.**

```ts
/**
 * @file The nodes the table's right-click menu creates: Get Column, Get Row and Get Value.
 * Snapshotted by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";

export type ValueNodeAction = "at" | "get_row" | "get_value";

function getAstValuePattern(value?: string | number, action?: string) {
  if (action && value != null) {
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier(action)!),
        typeof value === "number"
          ? Ast.tryNumberToEnso(value, ast.module)!
          : Ast.TextLiteral.new(value, ast.module),
      ),
    );
  }
}

function getAstGetValuePattern(
  columnId?: string,
  rowIndex?: number,
  action?: string,
) {
  if (action && columnId && rowIndex != undefined) {
    const pattern = Pattern.parseExpression("__ __");
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier("get_value")!),
        pattern.instantiateCopied([
          Ast.TextLiteral.new(columnId as string, ast.module),
          Ast.tryNumberToEnso(rowIndex as number, ast.module)!,
        ]),
      ),
    );
  }
}

/** The node a menu item creates, or `undefined` when the click lacks what the item needs. */
export function valueNodePattern(
  columnId: string | null | undefined,
  rowIndex: number | null | undefined,
  action: ValueNodeAction,
): Pattern | undefined {
  if (action === "at" && columnId != null)
    return getAstValuePattern(columnId, action);
  if (action === "get_row" && rowIndex != null)
    return getAstValuePattern(rowIndex, action);
  if (action === "get_value" && columnId != null && rowIndex != null)
    return getAstGetValuePattern(columnId, rowIndex, action);
  return undefined;
}
```

In `TableVisualization.vue`, delete `getAstValuePattern` and
`getAstGetValuePattern`, and replace `createValueNode` with:

```ts
function createValueNode(
  columnId: string | null | undefined,
  rowIndex: number | null | undefined,
  action: ValueNodeAction,
) {
  const pattern = valueNodePattern(columnId, rowIndex, action);
  if (pattern) config.createNodes({ content: pattern, commit: true });
}
```

In `getContextMenuItems`, type the `actions` array's `action` fields with
`as const` (`action: 'at' as const`, …) so they are `ValueNodeAction`s.

- [ ] **Step 3: Create `ScatterplotVisualization/scatterNodes.ts`.**

```ts
/**
 * @file The nodes the scatter plot creates: a filter to the brushed ranges, and a point's row.
 * Snapshotted by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";

const makeFilterPattern = (
  module: Ast.MutableModule,
  columnName: string,
  min: number,
  max: number,
) => {
  return Pattern.parseExpression("__ (..Between __ __)").instantiateCopied([
    Ast.TextLiteral.new(columnName),
    Ast.tryNumberToEnso(min, module)!,
    Ast.tryNumberToEnso(max, module)!,
  ]);
};

/** The node filtering the x column to `minX..maxX` and each series to `minY..maxY`. */
export function brushFilterPattern(
  series: string[],
  xColName: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
) {
  return Pattern.new<Ast.Expression>((ast) =>
    series.reduce<Ast.Owned<Ast.MutableExpression>>(
      (pattern, s) =>
        Ast.OprApp.new(
          ast.module,
          pattern,
          ".",
          Ast.App.positional(
            Ast.Ident.new(ast.module, Ast.identifier("filter")!),
            makeFilterPattern(ast.module, s!, minY, maxY),
          ),
        ),
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier("filter")!),
        makeFilterPattern(ast.module, xColName, minX, maxX),
      ),
    ),
  );
}

/** The node of one point's row: `action` applied to its row number. */
export function rowPattern(selector?: number, action?: string) {
  if (action && selector != null) {
    return Pattern.new<Ast.Expression>((ast) =>
      Ast.App.positional(
        Ast.PropertyAccess.new(ast.module, ast, Ast.identifier(action)!),
        Ast.tryNumberToEnso(selector, ast.module)!,
      ),
    );
  }
}
```

In `ScatterplotVisualization.vue`, delete `filterPattern`, `makeFilterPattern`,
`getAstPatternFilterAndSort` and `getAstPattern`; import `brushFilterPattern`
and `rowPattern` from `./ScatterplotVisualization/scatterNodes`; in
`createNewFilterNode` call
`brushFilterPattern(seriesLabels, xColName, minX, maxX, minY, maxY)` and in
`createNode` call `rowPattern(rowNumber, selector)`.

- [ ] **Step 4: Create `warningsNodes.ts`.**

```ts
/** @file The node the Warnings visualisation creates. Snapshotted by `__tests__/vizNodeTextSnapshot.test.ts`. */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";

/** The visualised node with its warnings removed. */
export function removeWarningsPattern() {
  return Pattern.new<Ast.Expression>((ast) =>
    Ast.PropertyAccess.new(ast.module, ast, Ast.identifier("remove_warnings")!),
  );
}
```

In `WarningsVisualization.vue`, replace the body of the `removeWarnings`
computed with `removeWarningsPattern()` (import it from `./warningsNodes`) and
drop the `Ast` and `Pattern` imports.

- [ ] **Step 5: Note the new modules.** In `TableVisualization/CLAUDE.md` add,
      after the `tableVizToolbar.ts` sentence:

```markdown
- `columnValueToEnso.ts`: a cell's text as an Enso value of its column's type
  (the toolbar's filters). `tableContextMenu.ts`: the right-click menu's nodes.
  Both, the scatter plot's `scatterNodes.ts` and the Warnings visualisation's
  node are pinned by `../__tests__/vizNodeTextSnapshot.test.ts`: a change to the
  text of a created node is a visible change.
```

- [ ] **Step 6: Check.**
      `vitest run src/project-view/components/visualizations`, `typecheck`,
      `lint`. Expected: pass, no unused import left (lint names any). Commit:

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: move the visualisations' node-building code into pure modules"
```

### Task 3.0.2: Snapshot the node text of every gesture

**Files:**

- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/vizNodeTextSnapshot.test.ts`
- Create (generated):
  `app/gui/src/project-view/components/visualizations/__tests__/__snapshots__/vizNodeTextSnapshot.test.ts.snap`

**Interfaces:**

- Consumes: `useTableVizToolbar` (`tableVizToolbar.ts`), `columnValueToEnso`,
  `valueNodePattern`, `brushFilterPattern`, `rowPattern`,
  `removeWarningsPattern` (3.0.1), `nodeExpressionPattern`
  (`JSONVisualization/treeExpression.ts`).
- Produces: the snapshot, the gate of 3.2 and 3.3. Later PRs change only the
  block between the `DRIVERS` markers.

- [ ] **Step 1: Write the test.**

```ts
import type { NodeCreationOptions } from "@/components/GraphEditor/nodeCreation";
import { removeWarningsPattern } from "@/components/visualizations/warningsNodes";
import { Ast } from "@/util/ast";
import type { Pattern } from "@/util/ast/match";
import { describe, expect, test } from "vitest";
import { ref } from "vue";
import { nodeExpressionPattern } from "../JSONVisualization/treeExpression";
import {
  brushFilterPattern,
  rowPattern,
} from "../ScatterplotVisualization/scatterNodes";
import { columnValueToEnso } from "../TableVisualization/columnValueToEnso";
import {
  valueNodePattern,
  type ValueNodeAction,
} from "../TableVisualization/tableContextMenu";
import type { GridFilterModel } from "../TableVisualization/tableVizFilterUtils";
import {
  useTableVizToolbar,
  type SortModel,
} from "../TableVisualization/tableVizToolbar";
import { isActionButton } from "../toolbar";

// The gate of piece 3 (docs/superpowers/specs/2026-11-14-viz-actions-design.md, "Verification"):
// the exact text of the node each visualisation gesture creates. The table's links are pinned by
// `tableViewSnapshot.test.ts`. Moving the gestures onto Enso-described actions must leave this
// snapshot unchanged; only the DRIVERS block below changes when the code paths do.

/** The node the visualised value comes from. */
const SOURCE_NODE = "operator1";

function text(pattern: Pattern | undefined): string | undefined {
  return pattern?.instantiateCopied([Ast.parseExpression(SOURCE_NODE)!]).code();
}

/** The column types of the table the toolbar cases filter. */
const COLUMN_TYPES = new Map<string, string>([
  ["a", "Integer"],
  ["f", "Float"],
  ["b", "Char"],
  ["d", "Date"],
  ["t", "Time"],
  ["dt", "Date_Time"],
  ["m", "Mixed"],
  ["bo", "Boolean"],
]);

interface ToolbarCase {
  sorts?: SortModel[];
  filters?: GridFilterModel[];
  hidden?: string[];
  order?: string[] | null;
}

const filter = (
  f: Partial<GridFilterModel> &
    Pick<GridFilterModel, "columnName" | "filterType">,
) => f as GridFilterModel;

const TOOLBAR_CASES: Record<string, ToolbarCase> = {
  "sort by one column": {
    sorts: [{ columnName: "a", sortDirection: "asc", sortIndex: 0 }],
  },
  "sort by two columns": {
    sorts: [
      { columnName: "b", sortDirection: "desc", sortIndex: 1 },
      { columnName: "a", sortDirection: "asc", sortIndex: 0 },
    ],
  },
  "number equals": {
    filters: [
      filter({
        columnName: "a",
        filterType: "number",
        filterAction: "equals",
        filter: "3",
      }),
    ],
  },
  "number in range": {
    filters: [
      filter({
        columnName: "a",
        filterType: "number",
        filterAction: "inRange",
        filter: "1",
        filterTo: "5",
      }),
    ],
  },
  "float greater than": {
    filters: [
      filter({
        columnName: "f",
        filterType: "number",
        filterAction: "greaterThan",
        filter: "2.5",
      }),
    ],
  },
  "set of one": {
    filters: [filter({ columnName: "b", filterType: "set", values: ["x"] })],
  },
  "set of two": {
    filters: [
      filter({ columnName: "b", filterType: "set", values: ["x", "y"] }),
    ],
  },
  "set of dates": {
    filters: [
      filter({
        columnName: "d",
        filterType: "set",
        values: ["2024-01-02", "2024-02-03"],
      }),
    ],
  },
  "set of a time": {
    filters: [
      filter({ columnName: "t", filterType: "set", values: ["10:30:00"] }),
    ],
  },
  "set of a date-time": {
    filters: [
      filter({
        columnName: "dt",
        filterType: "set",
        values: ["2024-01-02 10:30:00", "2024-01-03 11:00:00"],
      }),
    ],
  },
  "set of a mixed value": {
    filters: [filter({ columnName: "m", filterType: "set", values: ["12"] })],
  },
  "set of a boolean": {
    filters: [
      filter({ columnName: "bo", filterType: "set", values: ["false"] }),
    ],
  },
  "text contains": {
    filters: [
      filter({
        columnName: "b",
        filterType: "text",
        filterAction: "contains",
        filter: "ab",
      }),
    ],
  },
  blank: {
    filters: [
      filter({ columnName: "b", filterType: "text", filterAction: "blank" }),
    ],
  },
  "not blank": {
    filters: [
      filter({ columnName: "b", filterType: "text", filterAction: "notBlank" }),
    ],
  },
  "date equals": {
    filters: [
      filter({
        columnName: "d",
        filterType: "date",
        filterAction: "equals",
        dateFrom: "2024-01-02 00:00:00",
      }),
    ],
  },
  "two filters in one node": {
    filters: [
      filter({
        columnName: "a",
        filterType: "number",
        filterAction: "greaterThan",
        filter: "1",
      }),
      filter({
        columnName: "b",
        filterType: "text",
        filterAction: "contains",
        filter: "x",
      }),
    ],
  },
  "hidden columns": { hidden: ["b", "d"] },
  "reordered columns": { order: ["b", "a", "d"] },
  "everything at once": {
    sorts: [{ columnName: "a", sortDirection: "desc", sortIndex: 0 }],
    filters: [
      filter({
        columnName: "a",
        filterType: "number",
        filterAction: "lessThan",
        filter: "10",
      }),
      filter({ columnName: "b", filterType: "set", values: ["x", "y"] }),
    ],
    hidden: ["d"],
    order: ["b", "a"],
  },
};

/** Collects the text of each node `createNodes` is asked for. */
function capture(created: string[]) {
  return (...options: NodeCreationOptions[]) => {
    for (const option of options) created.push(text(option.content)!);
  };
}

// ---- DRIVERS: how the code makes each gesture's node. PRs 3.2 and 3.3 replace this block. ----

/** The nodes the table toolbar's "create components" button makes. */
function toolbarNodes(c: ToolbarCase): string[] {
  const created: string[] = [];
  const items = useTableVizToolbar({
    textFormatterSelected: ref("partial"),
    filterModel: c.filters ?? [],
    sortModel: c.sorts ?? [],
    tableFilteredOrSorted: true,
    isCreateNewNodeEnabled: true,
    createNodes: capture(created),
    getColumnValueToEnso: columnValueToEnso(COLUMN_TYPES),
    hiddenColumns: c.hidden ?? [],
    vizColumnOrder: c.order ?? null,
    refreshGrid: () => {},
  });
  const button = items.value.find(
    (item) => isActionButton(item) && item.icon === "add_to_graph_editor",
  );
  if (button == null || !isActionButton(button))
    throw new Error("no create-components button");
  button.onClick();
  return created;
}

/** The node of a table right-click menu item, on a table with the clicked cell at `column`, `row`. */
function menuNode(
  column: string | null,
  row: number | null,
  item: "Get Column" | "Get Row" | "Get Value",
) {
  const action: ValueNodeAction =
    item === "Get Column" ? "at" : item === "Get Row" ? "get_row" : "get_value";
  return text(valueNodePattern(column, row, action));
}

/** The scatter plot's "create component of selected points" node on a table. */
function brushNode(
  series: string[],
  x: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
) {
  return text(brushFilterPattern(series, x, minX, maxX, minY, maxY));
}

/** A double-clicked scatter point's node, on a table (`table`) or a vector (`vector`). */
function pointNode(row: number, value: "table" | "vector") {
  return text(rowPattern(row, value === "table" ? "get_row" : "at"));
}

/** The Warnings visualisation's "remove warnings" node. */
function removeWarningsNode() {
  return text(removeWarningsPattern());
}

/** A tree entry's node, from its chain of node expressions. */
function treeNode(chain: string[]) {
  return text(nodeExpressionPattern(chain));
}

// ---- end of DRIVERS ----

describe("Table toolbar: create components", () => {
  test.each(Object.entries(TOOLBAR_CASES))("%s", (_, c) => {
    expect(toolbarNodes(c)).toMatchSnapshot();
  });
});

describe("Table right-click menu, on a table", () => {
  test.each([
    ["Get Column", "b", 2],
    ["Get Row", "b", 2],
    ["Get Value", "b", 2],
    ["Get Column on the row-number column", null, 2],
    ["Get Value on the row-number column", null, 2],
  ] as const)("%s", (item, column, row) => {
    const name = item.startsWith("Get Column")
      ? "Get Column"
      : item.startsWith("Get Row")
        ? "Get Row"
        : "Get Value";
    expect(menuNode(column, row, name)).toMatchSnapshot();
  });
});

describe("Scatter plot", () => {
  test("brush, one series", () => {
    expect(brushNode(["y"], "x", 0, 10, -1.5, 3)).toMatchSnapshot();
  });
  test("brush, two series", () => {
    expect(brushNode(["y", "z"], "x", 1, 2, 3, 4)).toMatchSnapshot();
  });
  test("point of a table", () => {
    expect(pointNode(3, "table")).toMatchSnapshot();
  });
  test("point of a vector", () => {
    expect(pointNode(3, "vector")).toMatchSnapshot();
  });
});

describe("Warnings", () => {
  test("remove warnings", () => {
    expect(removeWarningsNode()).toMatchSnapshot();
  });
});

describe("Tree", () => {
  test.each([
    ["a key", [".get 'tags'"]],
    ["a key then an index", [".get 'tags'", ".at 1"]],
    ["a table row value", [".rows", ".at 0", ".at 'x'"]],
    ["a table summary entry", [".row_count"]],
    ["an XML attribute", [".at '@id'"]],
  ] as const)("%s", (_, chain) => {
    expect(treeNode([...chain])).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Record it.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/__tests__/vizNodeTextSnapshot.test.ts`.
      Expected: all pass, "Snapshots 35 written" (20 toolbar, 5 menu, 4 scatter,
      1 warnings, 5 tree).

- [ ] **Step 3: Read the snapshot by eye.** It records today's behaviour, read
      from the code; check it says so. Expected entries (from reading the code,
      not yet run):
  - `sort by one column`: `["operator1.sort [(..Name \"a\" ..Ascending )]"]`;
    `sort by two columns` lists `a` first (by `sortIndex`), then `b`
    `..Descending`.
  - `number equals`: `["operator1 . filter \"a\" (..Equal 3)"]` — note the
    spaced dot after the source (gap 14).
  - `number in range`: `… (..Between 1 5)`; `set of two`:
    `… (..Is_In [\"x\", \"y\"])`; `set of dates`:
    `(..Is_In [(Date.new 2024 1 2), (Date.new 2024 2 3)])`; `blank`:
    `… filter \"b\" ..Is_Nothing`.
  - `two filters in one node`: one string,
    `operator1 . filter \"a\" (..Greater 1) . filter \"b\" (..Contains \"x\")`.
  - `hidden columns`: `["operator1.remove_columns [\"b\", \"d\"]"]`;
    `reordered columns`: `operator1.reorder_columns [...]`.
  - `everything at once`: four strings in this order: the filter node, the sort
    node, `remove_columns`, `reorder_columns`.
  - Menu: `operator1.at \"b\"`, `operator1.get_row 2`,
    `operator1.get_value \"b\" 2`, and the two row-number-column cases
    `undefined`.
  - Scatter:
    `operator1.filter \"x\" (..Between 0 10) . filter \"y\" (..Between -1.5 3)`
    (the joint's spacing is whatever `OprApp.new` prints: record it);
    `operator1.get_row 3`, `operator1.at 3`.
  - Warnings: `operator1.remove_warnings`.
  - Tree: `operator1.get 'tags' . at 1`, `operator1.rows . at 0 . at 'x'`.

  Where an entry differs from these predictions, the snapshot (today's code) is
  right and the prediction wrong: note the actual text in the PR description,
  since 3.2's builder must reproduce it. Where an entry is an error or
  `undefined` unexpectedly, stop: the move in 3.0.1 changed behaviour.

- [ ] **Step 4: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations/__tests__
git commit -m "GUI tests: snapshot the node text of every visualisation gesture"
```

### Task 3.0.3: Playwright for the gestures that have none

`graphNodeVisualization.spec.ts` covers remove-warnings and
`jsonTreeVisualisation.spec.ts` the tree's double-click; spec B's
`tableVisualisation.spec.ts` covers the links. The sort/filter button and the
scatter brush have no end-to-end test.

**Files:**

- Modify: `app/gui/integration-test/project-view/tableVisualisation.spec.ts`
- Create:
  `app/gui/integration-test/project-view/scatterplotVisualisation.spec.ts`

**Interfaces:**

- Produces: two tests that 3.2.7 runs unchanged except for the mocked message
  (which then carries `actions`).

- [ ] **Step 1: The table's sort button.** Append to
      `tableVisualisation.spec.ts`:

```ts
/** The toolbar button that turns the grid's sort and filter state into components. */
const CREATE_COMPONENTS =
  "Create new component(s) with the current grid's state applied to the workflow";

/** A table view of two columns, as `prepare_visualization` sends it for a table. */
const SORTABLE_TABLE = {
  kind: "grid",
  row_count: 3,
  columns: [
    {
      name: "a",
      value_type: { constructor: "Integer", display_text: "Integer (64 bits)" },
    },
    { name: "b", value_type: { constructor: "Char", display_text: "Char" } },
  ],
  index: { action: "get_row {{#index}}", label: "row" },
  data: [
    [3, 1, 2],
    ["c", "a", "b"],
  ],
  options: { create_node: true },
};

test("Sorting a table and creating components makes a sort node", async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage);
  const aggregatedNode = graphNodeByBinding(page, "aggregated");
  await aggregatedNode.click();
  await editorPage.press("Space");
  const tableVisualization = locate.tableVisualization(page);
  await expect(tableVisualization).toExist();
  await localApi.updateVisualization(
    "Standard.Visualization.Table.Visualization.prepare_visualization",
    SORTABLE_TABLE,
  );
  await expect(tableVisualization).toContainText("c");
  await tableVisualization
    .locator(".ag-header-cell-text", { hasText: /^a$/ })
    .click();
  const nodeCount = await locate.graphNode(page).count();
  await page.getByTitle(CREATE_COMPONENTS).click();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
  await expect(locate.graphNode(page).last()).toContainText("sort");
});
```

- [ ] **Step 2: The scatter brush.** Create `scatterplotVisualisation.spec.ts`:

```ts
import { expect, test } from "integration-test/base";
import * as actions from "./actions";
import * as locate from "./locate";
import { graphNodeByBinding } from "./locate";

/** What `Scatter_Plot.process_to_json_text` sends for a table with columns `x` and `y`. */
const SCATTER_DATA = {
  data: [
    { x: 0, y: 3, row_number: 0 },
    { x: 1, y: 1, row_number: 1 },
    { x: 2, y: 2, row_number: 2 },
  ],
  axis: { x: { label: "x" }, y: { label: "y" } },
  is_multi_series: false,
  get_row_method: "get_row",
  x_value_type: "Integer",
  error_message: null,
};

test("A brushed selection makes a filter node", async ({
  editorPage,
  page,
  localApi,
}) => {
  await editorPage.mockExpressionUpdate("aggregated", {
    type: ["Standard.Table.Table.Table"],
  });
  await graphNodeByBinding(page, "aggregated").click();
  await actions.openVisualization(page, "Scatter Plot");
  const scatter = locate.scatterplotVisualization(page);
  await expect(scatter).toExist();
  await localApi.updateVisualization(
    "Standard.Visualization.Scatter_Plot.process_to_json_text",
    SCATTER_DATA,
  );
  await page.getByTitle("Enable Selection").click();
  const box = (await scatter.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, {
    steps: 5,
  });
  await page.mouse.up();
  const nodeCount = await locate.graphNode(page).count();
  await page.getByTitle("Create component of selected points").click();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
  await expect(locate.graphNode(page).last()).toContainText("filter");
});
```

- [ ] **Step 3: Run them.** From `app/gui`:
      `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/project-view/tableVisualisation.spec.ts integration-test/project-view/scatterplotVisualisation.spec.ts integration-test/project-view/graphNodeVisualization.spec.ts integration-test/project-view/jsonTreeVisualisation.spec.ts --repeat-each=3`.
      Expected: all pass. If the brush drag does not register, check
      `actions.openVisualization`'s name for the scatter plot (`'Scatter Plot'`
      is its `name` export) and whether the brush layer needs the drag to start
      inside `.ScatterplotVisualization svg`; adjust the locator, not the
      component. Then `typecheck` and `lint`.

- [ ] **Step 4: Commit.**

```bash
git add app/gui/integration-test
git commit -m "GUI tests: Playwright for the table's sort button and the scatter brush"
```

### Task 3.0.4: Open PR 3.0

- [ ] **Step 1: Linux.** Sync `viz/actions-gate` into `~/vizwork2` (Working
      environment), then `lint` and the Playwright command of 3.0.3 Step 3.
      Expected: pass, `git status` clean.
- [ ] **Step 2: Push and open** "GUI: snapshot the node text of every
      visualisation gesture (piece 3, 3.0)" against `develop`, with the spec and
      plan links, the snapshot's notable texts (any that differed from the
      predictions in 3.0.2 Step 3), and the test plan. Label
      `CI: No changelog needed`. Merge on green.

---

## PR 3.1 — Enso: `Viz_Action`, the conversions and the `actions` field (invisible)

Worktree `C:\Repos\Enso\ide-viz-a1`, branch `viz/actions-enso` from
`origin/develop`.

### Task 3.1.1: `Viz_Action`, `Viz_Action_Kind`, `Viz_Actions` and the Base conversions

**Files:**

- Create:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Action_Kind.enso`
- Create:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Action.enso`
- Create:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Actions.enso`
- Create: `test/Visualization_Tests/src/Viz_Actions_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`

**Interfaces:**

- Produces:
  - `Viz_Action_Kind.Chain`, `Viz_Action_Kind.New_Node`,
    `Viz_Action_Kind.wire_name self -> Text` (`"chain"`, `"new_node"`).
  - `Viz_Action.Value (id : Text) (label : Text) (icon : Text) (kind : Viz_Action_Kind) (template : Text)`;
    `Viz_Action.chain id label icon template -> Viz_Action`;
    `Viz_Action.new_node id label icon template -> Viz_Action`;
    `Viz_Action.to_json_text self -> Text`
    (`{"id":…,"label":…,"icon":…,"kind":"chain"|"new_node","template":…}`).
  - `Viz_Actions.Value (actions : Vector Viz_Action)`, `Viz_Actions.none`,
    `Viz_Actions.to_json_text self -> Text`,
    `Viz_Actions.add_to_json self (json_text : Text) -> Text`,
    `Viz_Actions.for value -> Viz_Actions`; module method
    `remove_warnings_action -> Viz_Action`; conversions
    `Viz_Actions.from (that:Any)` (none), `(that:Vector)`, `(that:Array)`
    (`open_row`, "Get Item", `select_row`, `at {{#index}}`).

- [ ] **Step 1: Write the failing spec.** Create `Viz_Actions_Spec.enso`:

```enso
from Standard.Base import all

import Standard.Visualization.Viz_Action.Viz_Action
import Standard.Visualization.Viz_Actions.Viz_Actions
from Standard.Visualization.Viz_Actions import remove_warnings_action

from Standard.Test import all

type Thing
    Value name

## A user type offers its own actions in its own module: here one that
   creates a standalone node from a static call taking the node.
Viz_Actions.from (that:Thing) =
    _ = that
    Viz_Actions.Value [Viz_Action.new_node "describe" "Describe" "" "Thing.describe {{node}}"]

## The ids of a value's actions.
ids_of value = (Viz_Actions.from value).actions.map .id

add_specs suite_builder =
    suite_builder.group "Viz_Actions" group_builder->
        group_builder.specify "an action is written as one JSON object" <|
            action = Viz_Action.chain "open_row" "Get Item" "select_row" "at {{#index}}"
            action.to_json_text . should_equal '{"id":"open_row","label":"Get Item","icon":"select_row","kind":"chain","template":"at {{#index}}"}'

        group_builder.specify "a value no conversion describes offers none" <|
            (Viz_Actions.from 42).actions . should_equal []
            (Viz_Actions.from "text").to_json_text . should_equal "[]"
            (Viz_Actions.from Nothing).actions . should_equal []

        group_builder.specify "a vector or an array offers its items by number" <|
            json = '[{"id":"open_row","label":"Get Item","icon":"select_row","kind":"chain","template":"at {{#index}}"}]'
            (Viz_Actions.from [1, 2, 3]).to_json_text . should_equal json
            (Viz_Actions.from [1, 2, 3].to_array).to_json_text . should_equal json

        group_builder.specify "a user type offers its own, a standalone node among them" <|
            (Viz_Actions.from (Thing.Value "a")).to_json_text . should_equal '[{"id":"describe","label":"Describe","icon":"","kind":"new_node","template":"Thing.describe {{node}}"}]'

        group_builder.specify "a dataflow error offers none" <|
            (Viz_Actions.for (Error.throw "boom")).actions . should_equal []
            (Viz_Actions.for [1]).actions.length . should_equal 1

        group_builder.specify "the field goes first in a message, and only when there are actions" <|
            actions = Viz_Actions.from [1]
            actions.add_to_json '{"kind":"grid","columns":[]}' . should_equal ('{"actions":' + actions.to_json_text + ',"kind":"grid","columns":[]}')
            Viz_Actions.none.add_to_json '{"kind":"grid"}' . should_equal '{"kind":"grid"}'

        group_builder.specify "an error message never carries it" <|
            (Viz_Actions.from [1]).add_to_json '{"kind":"error","error":"x"}' . should_equal '{"kind":"error","error":"x"}'

        group_builder.specify "remove warnings is a plain chain" <|
            remove_warnings_action.to_json_text . should_equal '{"id":"remove_warnings","label":"Remove Warnings","icon":"not_exclamation","kind":"chain","template":"remove_warnings"}'

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

Register it in `Main.enso`: `import project.Viz_Actions_Spec` after
`import project.Viz_Cell_Spec` (alphabetical), and
`Viz_Actions_Spec.add_specs suite_builder` after
`Viz_Cell_Spec.add_specs suite_builder`.

- [ ] **Step 2: Run it to see it fail.** Sync (`<wt>` `ide-viz-a1`, `<branch>`
      `viz/actions-enso`), build, run `Visualization_Tests` with filter
      `Viz_Actions`. Expected: compile error (no module `Viz_Action`).

- [ ] **Step 3: Write `Viz_Action_Kind.enso`.**

```enso
from Standard.Base import all

## ---
   private: true
   ---
   How a visualisation action makes its node.
type Viz_Action_Kind
    ## ---
       private: true
       ---
       The node is the visualised node, a dot and the template: `sort {{columns*}}`
       on node `data` makes `data.sort [...]`.
    Chain

    ## ---
       private: true
       ---
       The template is the whole expression, and `{{node}}` names the
       visualised node: a static call can take it as an argument.
    New_Node

    ## ---
       private: true
       ---
       The kind's name in the IDE's JSON.
    wire_name self -> Text = case self of
        Viz_Action_Kind.Chain -> "chain"
        Viz_Action_Kind.New_Node -> "new_node"
```

- [ ] **Step 4: Write `Viz_Action.enso`.**

```enso
from Standard.Base import all

import project.Viz_Action_Kind.Viz_Action_Kind

## ---
   private: true
   ---
   A node a visualisation can create from the visualised value. A
   visualisation finds the actions it understands by `id` and fills in the
   values the template asks for:
   - `{{#x}}`: the value of `x`, a number when it reads as one, else text;
   - `{{@x}}`: the value as it is (a number stays a number, else text);
   - `{{x}}`: an Enso expression the visualisation builds (a filter
     condition, a sort column);
   - `{{#x*}}`, `{{@x*}}`, `{{x*}}`: a vector of such values;
   - `{{node}}`: the visualised node, in a `New_Node` template only.
   An action whose template has no placeholder (other than `{{node}}`) is a
   plain action: a visualisation shows it as a toolbar button.
type Viz_Action
    ## ---
       private: true
       ---
       - `id`: the name a visualisation looks for (`open_row`, `sort`, ...).
       - `label`: what a menu or a button's tooltip says.
       - `icon`: an icon of the IDE, or empty.
       - `kind`: whether the node chains on the visualised node.
       - `template`: the expression, with placeholders.
    Value (id : Text) (label : Text) (icon : Text) (kind : Viz_Action_Kind) (template : Text)

    ## ---
       private: true
       ---
       An action that chains on the visualised node.
    chain (id : Text) (label : Text) (icon : Text) (template : Text) -> Viz_Action =
        Viz_Action.Value id label icon Viz_Action_Kind.Chain template

    ## ---
       private: true
       ---
       An action whose template is a whole expression naming the node with
       `{{node}}`.
    new_node (id : Text) (label : Text) (icon : Text) (template : Text) -> Viz_Action =
        Viz_Action.Value id label icon Viz_Action_Kind.New_Node template

    ## ---
       private: true
       ---
       The action as the IDE reads it.
    to_json_text self -> Text =
        '{"id":' + self.id.to_json + ',"label":' + self.label.to_json + ',"icon":' + self.icon.to_json + ',"kind":' + self.kind.wire_name.to_json + ',"template":' + self.template.to_json + '}'
```

- [ ] **Step 5: Write `Viz_Actions.enso`.**

```enso
from Standard.Base import all

import project.Viz_Action.Viz_Action

## ---
   private: true
   ---
   The node actions a value offers its visualisations. Base values are
   converted here; a library or a user type offers its own with
   `Viz_Actions.from (that:Its_Public_Type)` in its own module.
type Viz_Actions
    ## ---
       private: true
       ---
    Value (actions : Vector Viz_Action)

    ## ---
       private: true
       ---
       No actions.
    none -> Viz_Actions = Viz_Actions.Value []

    ## ---
       private: true
       ---
       The actions of `value`; none for a dataflow error.
    for value -> Viz_Actions = if value.is_error then Viz_Actions.none else Viz_Actions.from value

    ## ---
       private: true
       ---
       The actions as the IDE reads them: a JSON array.
    to_json_text self -> Text =
        ## A handful of actions: the texts are joined, so they are built once.
        '[' + (self.actions.map .to_json_text . join ",") + ']'

    ## ---
       private: true
       ---
       `json_text`, the JSON object a visualisation receives, with an
       `"actions"` field first. Unchanged when there are no actions, and for
       an error message (`{"kind":"error",…}`).
    add_to_json self (json_text : Text) -> Text =
        if self.actions.is_empty || (json_text.starts_with '{"kind":"error"') then json_text else
            '{"actions":' + self.to_json_text + ',' + (json_text.drop 1)

## ---
   private: true
   ---
   Removes the visualised node's warnings. Sent by the Warnings visualisation's
   preprocessor: a conversion cannot see a value's warnings.
remove_warnings_action -> Viz_Action =
    Viz_Action.chain "remove_warnings" "Remove Warnings" "not_exclamation" "remove_warnings"

## ---
   private: true
   ---
   Any other value offers no actions.
Viz_Actions.from (that:Any) =
    _ = that
    Viz_Actions.none

## ---
   private: true
   ---
   A vector's items, by number.
Viz_Actions.from (that:Vector) =
    _ = that
    Viz_Actions.Value [_item_action]

## ---
   private: true
   ---
   An array's items, by number.
Viz_Actions.from (that:Array) =
    _ = that
    Viz_Actions.Value [_item_action]

private _item_action = Viz_Action.chain "open_row" "Get Item" "select_row" "at {{#index}}"
```

- [ ] **Step 6: Run it to see it pass.** Sync, build, run with filter
      `Viz_Actions`. Expected: 8 passed (check the count). Then the `-Werror`
      lint on `distribution/lib/Standard/Visualization/0.0.0-dev` and on
      `test/Visualization_Tests`. Expected: no warnings.

- [ ] **Step 7: Commit.**

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: Viz_Action and Viz_Actions, with the vector and array actions"
```

### Task 3.1.2: Table and Column actions

**Files:**

- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Viz_Helpers.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso` (imports; a
  conversion after `Id.from (that:Table)`)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Column.enso` (imports;
  a conversion after `Viz_Tree.from (that:Column)`)
- Modify: `test/Visualization_Tests/src/Viz_Actions_Spec.enso`

**Interfaces:**

- Consumes: `Viz_Action.chain`, `Viz_Actions.Value` (3.1.1).
- Produces: `Viz_Helpers.table_actions -> Viz_Actions` with, in this order,
  `open_row` (`get_row {{#index}}`, "Get Row", `select_row`), `open_column`
  (`at {{@column}}`, "Get Column", `select_column`), `open_cell`
  (`get_value {{@column}} {{#index}}`, "Get Value", `select_cell`), `sort`
  (`sort {{columns*}}`), `filter` (`filter {{@column}} {{condition}}`),
  `remove_columns` (`remove_columns {{@columns*}}`), `reorder_columns`
  (`reorder_columns {{@columns*}}`), `brush_filter`
  (`filter {{@column}} (..Between {{#min}} {{#max}})`);
  `Viz_Helpers.column_actions -> Viz_Actions` with `open_row` (`at {{#index}}`,
  "Get Value", `select_cell`). The GUI (3.2, 3.3) relies on these ids and
  placeholder names.

- [ ] **Step 1: Write the failing tests.** In `Viz_Actions_Spec.enso` add the
      imports

```enso
from Standard.Table import Table
import Standard.Database.Connection.Database
import Standard.Database.Extensions.Upload_Table
from Standard.SQLite import SQLite
```

and the group (inside `add_specs`, after the first group):

```enso
    suite_builder.group "Table actions" group_builder->
        mem_table = Table.new [["x", [1, 2]], ["y", ["a", "b"]]]
        connection = Database.connect SQLite.In_Memory
        db_table = mem_table.select_into_database_table connection "actions" temporary=True

        group_builder.specify "a table offers its rows, columns and cells, and the toolbar's and brush's actions" <|
            ids_of mem_table . should_equal ["open_row", "open_column", "open_cell", "sort", "filter", "remove_columns", "reorder_columns", "brush_filter"]
            templates = (Viz_Actions.from mem_table).actions.map .template
            templates . should_equal ["get_row {{#index}}", "at {{@column}}", "get_value {{@column}} {{#index}}", "sort {{columns*}}", "filter {{@column}} {{condition}}", "remove_columns {{@columns*}}", "reorder_columns {{@columns*}}", "filter {{@column}} (..Between {{#min}} {{#max}})"]

        group_builder.specify "a database table offers the same templates" <|
            (Viz_Actions.from db_table).to_json_text . should_equal (Viz_Actions.from mem_table).to_json_text

        group_builder.specify "a column offers its values by number, in memory and in a database" <|
            (Viz_Actions.from (mem_table.at "x")).to_json_text . should_equal '[{"id":"open_row","label":"Get Value","icon":"select_cell","kind":"chain","template":"at {{#index}}"}]'
            (Viz_Actions.from (db_table.at "x")).to_json_text . should_equal (Viz_Actions.from (mem_table.at "x")).to_json_text
```

- [ ] **Step 2: Run them to see them fail.** Sync, build, run with filter
      `Table actions`. Expected: 3 failures (`ids_of mem_table` is `[]`).

- [ ] **Step 3: Write the actions.** In `Viz_Helpers.enso` add the imports

```enso
import Standard.Visualization.Viz_Action.Viz_Action
import Standard.Visualization.Viz_Actions.Viz_Actions
```

and at the end:

```enso
## ---
   private: true
   ---
   The node actions of a table, in memory or in a database: a row, a column,
   a cell, the table toolbar's sort, filter and column changes, and the
   scatter plot's brush. A small fixed vector.
table_actions -> Viz_Actions = Viz_Actions.Value <|
    open_row = Viz_Action.chain "open_row" "Get Row" "select_row" "get_row {{#index}}"
    open_column = Viz_Action.chain "open_column" "Get Column" "select_column" "at {{@column}}"
    open_cell = Viz_Action.chain "open_cell" "Get Value" "select_cell" "get_value {{@column}} {{#index}}"
    sort = Viz_Action.chain "sort" "Sort" "" "sort {{columns*}}"
    filter = Viz_Action.chain "filter" "Filter" "" "filter {{@column}} {{condition}}"
    remove_columns = Viz_Action.chain "remove_columns" "Remove Columns" "" "remove_columns {{@columns*}}"
    reorder_columns = Viz_Action.chain "reorder_columns" "Reorder Columns" "" "reorder_columns {{@columns*}}"
    brush_filter = Viz_Action.chain "brush_filter" "Filter To Selection" "" "filter {{@column}} (..Between {{#min}} {{#max}})"
    [open_row, open_column, open_cell, sort, filter, remove_columns, reorder_columns, brush_filter]

## ---
   private: true
   ---
   The node actions of a column, in memory or in a database: a value by
   number.
column_actions -> Viz_Actions =
    Viz_Actions.Value [Viz_Action.chain "open_row" "Get Value" "select_cell" "at {{#index}}"]
```

In `Table.enso`, add `import Standard.Visualization.Viz_Actions.Viz_Actions` to
the `Standard.Visualization` imports (alphabetical, after `Viz_Json`), and after
`Id.from (that:Table)`:

```enso
## ---
   private: true
   ---
   The same actions for an in-memory and a database table.
Viz_Actions.from (that:Table) =
    _ = that
    Viz_Helpers.table_actions
```

In `Column.enso`, the same import, and after `Viz_Tree.from (that:Column)`:

```enso
## ---
   private: true
   ---
   The same actions for an in-memory and a database column.
Viz_Actions.from (that:Column) =
    _ = that
    Viz_Helpers.column_actions
```

(`Column.enso` already imports `project.Internal.Viz_Helpers`; check, and add it
if not.)

- [ ] **Step 4: Run them to see them pass.** Sync, build, run with filter
      `Table actions`. Expected: 3 passed. Lint
      `distribution/lib/Standard/Table/0.0.0-dev` and
      `test/Visualization_Tests`.

- [ ] **Step 5: Commit.**

```bash
git add distribution/lib/Standard/Table test/Visualization_Tests
git commit -m "Table: the actions of a table and a column for the visualisations"
```

### Task 3.1.3: The `actions` field in each preprocessor, the goldens and the timings

**Files:**

- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Table/Visualization.enso`
  (`prepare_visualization`)
- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Scatter_Plot.enso`
  (`process_to_json_text`)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Tree.enso`
  (`prepare`)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Warnings.enso`
  (`process_to_json_text`)
- Modify: `test/Visualization_Tests/src/Viz_Actions_Spec.enso`,
  `test/Visualization_Tests/src/Helpers.enso`,
  `test/Visualization_Tests/src/Table_Spec.enso` (and any other spec the full
  run shows comparing a whole message)
- Regenerate: `test/Visualization_Tests/data/pinned/` — exactly
  `table_mem_table`, `table_mem_column`, `table_mem_1col_table`,
  `table_mem_1x1_table`, `table_db_table`, `table_db_column`, `table_cells`,
  `table_mem_server_table`, `table_vector`, `table_array`, `table_matrix`,
  `table_object_matrix`, `table_rows_matrix`, `table_cells_vector`, all 15
  `scatter_*`, `tree_prepare_vector_deep`, `tree_prepare_mem_table`
  (`table_db_read_error` is an error message: unchanged)

**Interfaces:**

- Consumes: `Viz_Actions.for`, `add_to_json`, `remove_warnings_action`.
- Produces (3.2 reads these): the table view, scatter-plot and tree-prepare
  messages start with `"actions":[…]` when the value offers any; the Warnings
  message is `{"warnings":[…],"actions":[<remove_warnings>]}`.

- [ ] **Step 1: Record `develop`'s timings.** Before changing any code, run
      `Visualization_Tests` filtered to `Table view timings` with
      `ENSO_VIZ_BENCH=1` prefixed (this branch has no library change yet, so
      these are `develop`'s numbers). Save the nine `BENCH|` lines.

- [ ] **Step 2: Write the failing tests.** In `Viz_Actions_Spec.enso` add the
      imports

```enso
import Standard.Visualization.Scatter_Plot
import Standard.Visualization.Table.Visualization
import Standard.Visualization.Tree
import Standard.Visualization.Warnings
```

and the group:

```enso
    suite_builder.group "The actions field" group_builder->
        table = Table.new [["x", [1, 2]], ["y", [3, 4]]]
        table_actions = (Viz_Actions.from table).to_json_text

        group_builder.specify "the table view of a table starts with its actions" <|
            Visualization.prepare_visualization table . should_start_with ('{"actions":' + table_actions + ',"kind":"grid"')

        group_builder.specify "a value without actions is unchanged" <|
            Visualization.prepare_visualization 42 . should_start_with '{"kind":"value"'

        group_builder.specify "an error has no actions" <|
            Visualization.prepare_visualization (Error.throw "boom") . should_start_with '{"kind":"error"'

        group_builder.specify "the scatter plot of a table carries them" <|
            Scatter_Plot.process_to_json_text table . should_start_with ('{"actions":' + table_actions + ',"data":')

        group_builder.specify "the tree of a vector carries them" <|
            Tree.prepare [1, 2] . should_start_with '{"actions":[{"id":"open_row"'

        group_builder.specify "the warnings message lists the warnings and offers to remove them" <|
            value = Warning.attach "Uh oh" 42
            Warnings.process_to_json_text value . should_equal ('{"warnings":["Uh oh"],"actions":[' + remove_warnings_action.to_json_text + ']}')
            Warnings.process_to_json_text 42 . should_equal ('{"warnings":[],"actions":[' + remove_warnings_action.to_json_text + ']}')
```

Run with filter `The actions field`. Expected: 4 failures (the two "unchanged"
cases pass already).

- [ ] **Step 3: Add the field.** In `Table/Visualization.enso` import
      `project.Viz_Actions.Viz_Actions` and change the last branch of
      `prepare_visualization` to:

```enso
            _ -> (Viz_Actions.for x).add_to_json ((Viz_Table.from x).table_view_json max_rows)
```

In `Scatter_Plot.enso` import `project.Viz_Actions.Viz_Actions` and wrap the
body of `process_to_json_text` (inside `time_visualization … <|`):

```enso
process_to_json_text value bounds=Nothing limit=Nothing = time_visualization Scatter_Plot ("process_to_json_text: " + (short_display value)) <|
    json = case value of
        _ : Vector -> json_from_vector value bounds limit
        _ : Array -> json_from_vector value bounds limit
        _ ->
            vt = Viz_Table.from value
            if vt.column_names.is_empty then
                ## A value with no columns is charted through its `to_vector`; one without it, or with nothing in it, shows the empty state.
                as_vector = Panic.catch Any (value.to_vector.catch Any _->Nothing) _->Nothing
                if as_vector.is_nothing || as_vector.is_empty then no_numeric_json else json_from_vector as_vector bounds limit
            else
                ## A database reads at most `limit` rows (15000 when there is no limit) before anything else, as before.
                rows = Chart_Limits.local_rows vt (limit.if_nothing Chart_Limits.chart_row_bound)
                ## A source made of columns only (a connection, a workbook) cannot work on rows: show the chart's empty state.
                if rows.supports "rows" then json_from_viz_table rows bounds limit else no_numeric_json
    (Viz_Actions.for value).add_to_json json
```

In `Tree.enso` import `project.Viz_Actions.Viz_Actions` and change `prepare` so
that both its results carry the field:

```enso
prepare value = time_visualization Tree ("Tree.prepare: " + (short_display value)) <|
    shown = if value.is_error then value.catch else value
    tree = Viz_Tree.from shown
    json = case tree of
        Viz_Tree.Leaf json_text -> '{"root":' + (leaf_json json_text) + '}'
        Viz_Tree.Branch _ _ _ _ _ -> '{"root":' + (branch_json tree) + ',"children":' + (page_json tree 0 page_size) + '}'
    result = if json.is_error.not then json else
        '{"root":' + (leaf_json (Helpers.truncate value.to_display_text . to_json)) + '}'
    (Viz_Actions.for value).add_to_json result
```

(`Viz_Actions.for` of a dataflow error is none, so an error's tree carries no
actions; the payload's actions would act on the error, not its value.)

In `Warnings.enso` import
`from project.Viz_Actions import remove_warnings_action` and end
`process_to_json_text` with:

```enso
    '{"warnings":' + vec.to_json + ',"actions":[' + remove_warnings_action.to_json_text + ']}'
```

- [ ] **Step 4: Run the new group.** Expected: 6 passed.

- [ ] **Step 5: Regenerate the goldens.** Run `Visualization_Tests` filtered to
      `Pinned` with `ENSO_UPDATE_PINNED=1`. Copy back **only** the files listed
      under Files above; run again without it. Expected: all pass. `git status`
      shows exactly those goldens changed. Check by eye: each starts with
      `{"actions":[`; `table_mem_table.json`'s actions are the eight table
      actions; `scatter_mem_column.json`'s the one column action;
      `table_dictionary.json`, `table_row.json`, `table_connection.json`,
      `tree_prepare_js_object.json` and `tree_prepare_error.json` unchanged.

- [ ] **Step 6: Fix whole-message comparisons.** Run all of
      `Visualization_Tests`. Specs that parse a whole `prepare_visualization` or
      scatter message of a table, column or vector and compare it with
      `should_equal` now fail on the extra field (`Table_Spec.enso` does, with
      `make_json`). Add to `Helpers.enso`:

```enso
## The message `json` without its `"actions"` field (checked by
   `Viz_Actions_Spec`), for specs that compare the rest of a message.
without_actions (json : JS_Object) -> JS_Object =
    JS_Object.from_pairs (json.field_names.filter (n-> n != "actions") . map n-> [n, json.get n])
```

and in each failing comparison replace `vis.parse_json` with
`without_actions vis.parse_json` (importing
`from project.Helpers import without_actions`). Run `XML_Tests` too
(`test/XML_Tests/src/Visualization_Spec.enso` calls `prepare_visualization` on
XML, which offers no actions: expected unchanged and passing). Expected: all
pass.

- [ ] **Step 7: Time it.** Run `Table view timings` with `ENSO_VIZ_BENCH=1`.
      Compare each of the nine `BENCH|` lines with Step 1's. Expected: every
      median within 10% of `develop` or faster. If a case is slower than that,
      cache the table's actions text, in `Viz_Helpers.enso` (add
      `polyglot java import org.enso.table.util.TableValueCache`):

```enso
## ---
   private: true
   ---
   `table_actions` as JSON, computed once per engine: the same for every table.
table_actions_json -> Text =
    cached = TableValueCache.get "viz_actions:table"
    if Nothing != cached then cached else
        text = table_actions.to_json_text
        TableValueCache.put "viz_actions:table" text
        text
```

      and give `Viz_Actions` a precomputed form instead of rebuilding: add to
      `Viz_Actions` the constructor
      `Json (json_text : Text) (actions : Vector Viz_Action)`, make
      `to_json_text` return `json_text` for it
      (`case self of Viz_Actions.Json t _ -> t; _ -> …`), and return
      `Viz_Actions.Json Viz_Helpers.table_actions_json Viz_Helpers.table_actions.actions`
      from `Viz_Actions.from (that:Table)` — but **only** if the timings call
      for it; time again after. Put the `BENCH|` lines of both runs in the PR
      description.

- [ ] **Step 8: Lint and commit.** Lint the Visualization and Table libraries
      and `test/Visualization_Tests`. Then:

```bash
git add distribution/lib/Standard test/Visualization_Tests
git commit -m "Visualization: each preprocessor sends the value's actions"
```

### Task 3.1.4: Documentation, API docs and PR 3.1

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`
- Regenerate: `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/`,
  `distribution/lib/Standard/Table/0.0.0-dev/docs/api/`

- [ ] **Step 1: Document.** In the Visualization `CLAUDE.md`, under "Data
      types", after the `Viz_Tree` bullet, add:

```markdown
- `Viz_Actions` (`src/Viz_Actions.enso`, with `Viz_Action` and
  `Viz_Action_Kind`) - the nodes a value's visualisations can create. Each
  `Viz_Action` has an `id` a visualisation looks for, a label, an icon, a kind
  (`Chain` on the node, or `New_Node`, whose template names the node with
  `{{node}}`) and a template: `{{#x}}` a value (a number when it reads as one),
  `{{@x}}` a value as it is, `{{x}}` an expression the visualisation builds, `*`
  for a vector of them. Base: a vector or array offers `open_row`
  (`at {{#index}}`); any other value none. Table: `open_row`, `open_column`,
  `open_cell`, `sort`, `filter`, `remove_columns`, `reorder_columns`,
  `brush_filter`; Column: `open_row`. A user type offers its own with
  `Viz_Actions.from (that:My_Type)`. The table view, scatter plot and tree
  preprocessors send them as an `"actions"` array first in their JSON
  (`Viz_Actions.add_to_json`; absent when there are none, never on an error);
  the Warnings preprocessor sends
  `{"warnings":[…],"actions":[remove_warnings]}`. The links of the table view
  stay in the view (its `link` and `index`): they are the view's own `Chain`
  actions.
```

and in "Main entry points", change the Tree bullet's "`prepare` returns
`{"root":…}` or `{"root":…,"children":<page>}`" to add "(both with `"actions"`
first when the value offers any)".

- [ ] **Step 2: API docs.** Regenerate `docs/api` for Visualization and Table
      (Working environment) and copy both folders back. Expected: new
      `Viz_Action.md`, `Viz_Action_Kind.md`, `Viz_Actions.md`; `Table.md` and
      `Column.md` gain the conversion line; nothing else changes.

- [ ] **Step 3: Commit, push, open PR.**

```bash
git add distribution/lib/Standard
git commit -m "Visualization: document Viz_Actions; regenerate the API docs"
```

Push `viz/actions-enso`; open "Visualization: actions described by Enso (piece
3, 3.1)" against `develop`, with the spec and plan links, gaps 4, 9, 10, 11, 12,
13 resolved here, both `BENCH|` runs, and the test plan. Label
`CI: No changelog needed`. Merge on green. (The GUI ignores the new field until
3.2; spec B's snapshot does not read it.)

---

## PR 3.2 — GUI: one builder for every action (invisible)

Worktree `C:\Repos\Enso\ide-viz-a2`, branch `viz/actions-gui` from
`origin/develop` after 3.0 and 3.1 have merged.

### Task 3.2.1: The builder

**Files:**

- Create: `app/gui/src/project-view/components/visualizations/vizActions.ts`
- Create:
  `app/gui/src/project-view/components/visualizations/__tests__/vizActions.test.ts`

**Interfaces:**

- Produces (every later task uses these):
  - `vizActionSchema`,
    `type VizAction = { id: string; label: string; icon: string; kind: 'chain' | 'new_node'; template: string }`
  - `parseVizActions(data: unknown): VizAction[]` (the `actions` field of a
    message; `[]` when absent; malformed entries dropped)
  - `findAction(actions: readonly VizAction[], id: string): VizAction | undefined`
  - `type ExpressionBuilder = (module: Ast.MutableModule) => Ast.Owned<Ast.MutableExpression>`,
    `type ActionScalar = string | number | ExpressionBuilder`,
    `type ActionValue = ActionScalar | readonly ActionScalar[]`,
    `type ActionValues = Readonly<Record<string, ActionValue | null | undefined>>`
  - `placeholderNames(template: string): string[]`
  - `actionPattern(action: Pick<VizAction, 'kind' | 'template'>, values?: ActionValues): Pattern | undefined`
  - `type ChainStep = { template: string; values?: ActionValues } | { code: string }`;
    `chainPattern(steps: readonly ChainStep[], options?: { firstSpaced?: boolean }): Pattern | undefined`
  - `isPlainAction(action: VizAction): boolean`

- [ ] **Step 1: Write the failing tests.**

```ts
import { Ast } from "@/util/ast";
import type { Pattern } from "@/util/ast/match";
import { describe, expect, test } from "vitest";
import {
  actionPattern,
  chainPattern,
  isPlainAction,
  parseVizActions,
  placeholderNames,
  type VizAction,
} from "../vizActions";

function text(pattern: Pattern | undefined) {
  return pattern?.instantiateCopied([Ast.parseExpression("operator1")!]).code();
}

const chain = (template: string): VizAction => ({
  id: "x",
  label: "X",
  icon: "",
  kind: "chain",
  template,
});

describe("parseVizActions", () => {
  test("reads the actions field and drops malformed entries", () => {
    const data = {
      actions: [
        {
          id: "a",
          label: "A",
          icon: "",
          kind: "chain",
          template: "at {{#index}}",
        },
        { id: "b" },
      ],
      kind: "grid",
    };
    expect(parseVizActions(data).map((a) => a.id)).toEqual(["a"]);
  });
  test("no field, a non-object or a malformed field gives none", () => {
    expect(parseVizActions({ kind: "grid" })).toEqual([]);
    expect(parseVizActions([1, 2])).toEqual([]);
    expect(parseVizActions({ actions: "no" })).toEqual([]);
  });
});

describe("templates", () => {
  test("placeholder names, in order", () => {
    expect(placeholderNames("get_value {{@column}} {{#index}}")).toEqual([
      "column",
      "index",
    ]);
  });
  test("# makes a number of a numeric value, text of any other", () => {
    expect(text(actionPattern(chain("at {{#index}}"), { index: "3" }))).toBe(
      "operator1.at 3",
    );
    expect(text(actionPattern(chain("at {{#key}}"), { key: "a" }))).toBe(
      'operator1.at "a"',
    );
  });
  test("@ keeps a number a number and text text", () => {
    expect(text(actionPattern(chain("read {{@t}}"), { t: "2" }))).toBe(
      'operator1.read "2"',
    );
    expect(text(actionPattern(chain("read {{@t}}"), { t: 2 }))).toBe(
      "operator1.read 2",
    );
  });
  test("a bare placeholder takes an expression", () => {
    const pattern = actionPattern(chain("filter {{@column}} {{condition}}"), {
      column: "a",
      condition: (module) => Ast.parseExpression("(..Equal 3)", module)!,
    });
    expect(text(pattern)).toBe('operator1.filter "a" (..Equal 3)');
  });
  test("* makes a vector", () => {
    expect(
      text(
        actionPattern(chain("remove_columns {{@columns*}}"), {
          columns: ["b", "d"],
        }),
      ),
    ).toBe('operator1.remove_columns ["b", "d"]');
  });
  test("a missing value gives no pattern", () => {
    expect(
      actionPattern(chain("get_value {{@column}} {{#index}}"), { index: 2 }),
    ).toBeUndefined();
    expect(
      actionPattern(chain("at {{#index}}"), { index: null }),
    ).toBeUndefined();
    expect(
      actionPattern(chain("remove_columns {{@columns*}}"), { columns: "b" }),
    ).toBeUndefined();
  });
  test("a new node names the node with {{node}}", () => {
    const action: VizAction = {
      ...chain("Thing.describe {{node}} {{#n}}"),
      kind: "new_node",
    };
    expect(text(actionPattern(action, { n: 1 }))).toBe(
      "Thing.describe operator1 1",
    );
  });
  test("a new node without {{node}}, or a chain with it, gives no pattern", () => {
    expect(
      actionPattern({ kind: "new_node", template: "Date.today" }),
    ).toBeUndefined();
    expect(actionPattern(chain("f {{node}}"))).toBeUndefined();
  });
  test("a template that does not parse gives no pattern", () => {
    expect(actionPattern(chain("at (("), {})).toBeUndefined();
  });
});

describe("chains", () => {
  test("steps joined by the spaced dot, the first unspaced by default", () => {
    expect(text(chainPattern([{ code: "get 'tags'" }, { code: "at 1" }]))).toBe(
      "operator1.get 'tags' . at 1",
    );
  });
  test("firstSpaced spaces the first dot too", () => {
    const step = { template: "filter {{@column}} {{condition}}" };
    const pattern = chainPattern(
      [
        {
          ...step,
          values: {
            column: "a",
            condition: (m) => Ast.parseExpression("(..Greater 1)", m)!,
          },
        },
        {
          ...step,
          values: {
            column: "b",
            condition: (m) => Ast.parseExpression("..Is_Nothing", m)!,
          },
        },
      ],
      { firstSpaced: true },
    );
    expect(text(pattern)).toBe(
      'operator1 . filter "a" (..Greater 1) . filter "b" ..Is_Nothing',
    );
  });
  test("a literal step is not read for placeholders", () => {
    expect(text(chainPattern([{ code: "get '{{a}}'" }]))).toBe(
      "operator1.get '{{a}}'",
    );
  });
  test("no steps give no pattern", () => {
    expect(chainPattern([])).toBeUndefined();
  });
});

describe("plain actions", () => {
  test("a chain with no placeholder, or a new node with only {{node}}", () => {
    expect(isPlainAction(chain("remove_warnings"))).toBe(true);
    expect(
      isPlainAction({ ...chain("Thing.describe {{node}}"), kind: "new_node" }),
    ).toBe(true);
    expect(isPlainAction(chain("at {{#index}}"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**
      `vitest run src/project-view/components/visualizations/__tests__/vizActions.test.ts`.
      Expected: FAIL, cannot resolve `../vizActions`.

- [ ] **Step 3: Write `vizActions.ts`.**

```ts
/**
 * @file The node actions Enso describes for a visualised value (`Standard.Visualization.Viz_Actions`,
 * the `actions` field of a visualisation's message), and the one builder that turns an action's
 * template and a gesture's values into a node pattern. A visualisation owns its gestures and fills
 * in the values a template names; it never writes an Enso method name.
 *
 * Templates: `{{#x}}` the value of `x`, a number when it reads as one, else text; `{{@x}}` the
 * value as it is (a number stays a number, anything else is text); `{{x}}` an Enso expression the
 * gesture builds; a `*` after the name, a vector of such values; `{{node}}` the visualised node, in
 * a `new_node` template only. A missing value gives no pattern, never a broken node.
 */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";
import { z } from "zod";

export const vizActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  kind: z.enum(["chain", "new_node"]),
  template: z.string(),
});
export type VizAction = z.infer<typeof vizActionSchema>;

/** The `actions` of a visualisation's message: none when it has none; a malformed entry is dropped. */
export function parseVizActions(data: unknown): VizAction[] {
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return [];
  const list = z
    .array(z.unknown())
    .safeParse((data as { actions?: unknown }).actions);
  if (!list.success) return [];
  return list.data.flatMap((item) => {
    const action = vizActionSchema.safeParse(item);
    return action.success ? [action.data] : [];
  });
}

/** The action with `id`, if the value offers it. */
export function findAction(
  actions: readonly VizAction[],
  id: string,
): VizAction | undefined {
  return actions.find((action) => action.id === id);
}

export type ExpressionBuilder = (
  module: Ast.MutableModule,
) => Ast.Owned<Ast.MutableExpression>;
export type ActionScalar = string | number | ExpressionBuilder;
export type ActionValue = ActionScalar | readonly ActionScalar[];
export type ActionValues = Readonly<
  Record<string, ActionValue | null | undefined>
>;

interface Slot {
  name: string;
  flag: "" | "#" | "@";
  many: boolean;
}

const PLACEHOLDER = /\{\{([#@]?)(\w+)(\*?)\}\}/g;
const NODE = "node";

function parseTemplate(template: string): { code: string; slots: Slot[] } {
  const slots: Slot[] = [];
  const code = template.replace(
    PLACEHOLDER,
    (_match, flag: string, name: string, star: string) => {
      slots.push({ name, flag: flag as Slot["flag"], many: star === "*" });
      return "__";
    },
  );
  return { code, slots };
}

const isNodeSlot = (slot: Slot) =>
  slot.name === NODE && slot.flag === "" && !slot.many;

/** The names of a template's placeholders, in order. */
export function placeholderNames(template: string): string[] {
  return parseTemplate(template).slots.map((slot) => slot.name);
}

/** Whether a template's values are all there, each a vector exactly where `*` asks for one. */
function filled(slots: readonly Slot[], values: ActionValues): boolean {
  return slots.every((slot) => {
    if (isNodeSlot(slot)) return true;
    const value = values[slot.name];
    return value != null && Array.isArray(value) === slot.many;
  });
}

function scalarAst(
  value: ActionScalar,
  flag: Slot["flag"],
  module: Ast.MutableModule,
): Ast.Owned<Ast.MutableExpression> {
  if (typeof value === "function") return value(module);
  if (flag === "") {
    return typeof value === "number"
      ? Ast.tryNumberToEnso(value, module)!
      : Ast.parseExpression(value, module)!;
  }
  const cast = flag === "#" && !isNaN(Number(value)) ? Number(value) : value;
  return typeof cast === "number" && !isNaN(cast)
    ? Ast.tryNumberToEnso(cast, module)!
    : Ast.TextLiteral.new(String(cast), module);
}

function valueAst(
  value: ActionValue,
  slot: Slot,
  module: Ast.MutableModule,
): Ast.Owned<Ast.MutableExpression> {
  if (Array.isArray(value)) {
    return Ast.Vector.build(
      value as readonly ActionScalar[],
      (element, elementModule) => scalarAst(element, slot.flag, elementModule),
      module,
    );
  }
  return scalarAst(value as ActionScalar, slot.flag, module);
}

type Fill = { node: true } | { node: false; slot: Slot; value: ActionValue };

/** A pattern of `code`, each `__` filled in order: the node where `fill.node`, else the value. */
function fillPattern(
  code: string,
  fills: readonly Fill[],
): Pattern | undefined {
  let template: Pattern;
  try {
    template = Pattern.parseExpression(code);
  } catch {
    return undefined;
  }
  return Pattern.new<Ast.Expression>((ast) =>
    template.instantiateCopied(
      fills.map((fill) =>
        fill.node ? ast : valueAst(fill.value, fill.slot, ast.module),
      ),
    ),
  );
}

export type ChainStep =
  { template: string; values?: ActionValues } | { code: string };

/**
 * One node of `steps` applied to the visualised node in turn, joined by the spaced dot
 * (`node.get 'tags' . at 1`); `firstSpaced` spaces the first dot too (`node . filter …`), as the
 * table toolbar's filter node is written. A `code` step is used as it is (a tree's node
 * expression); a `template` step is filled from its values.
 */
export function chainPattern(
  steps: readonly ChainStep[],
  options: { firstSpaced?: boolean } = {},
): Pattern | undefined {
  if (steps.length === 0) return undefined;
  const parts: string[] = [];
  const fills: Fill[] = [{ node: true }];
  for (const step of steps) {
    if ("code" in step) {
      parts.push(step.code);
      continue;
    }
    const { code, slots } = parseTemplate(step.template);
    const values = step.values ?? {};
    if (slots.some((slot) => slot.name === NODE) || !filled(slots, values))
      return undefined;
    parts.push(code);
    for (const slot of slots)
      fills.push({ node: false, slot, value: values[slot.name]! });
  }
  const [first, ...rest] = parts;
  const code =
    "__" +
    (options.firstSpaced ? " . " : ".") +
    first +
    rest.map((part) => " . " + part).join("");
  return fillPattern(code, fills);
}

/** The node of one action, filled from `values`; `undefined` when a value it needs is missing. */
export function actionPattern(
  action: Pick<VizAction, "kind" | "template">,
  values: ActionValues = {},
): Pattern | undefined {
  if (action.kind === "chain")
    return chainPattern([{ template: action.template, values }]);
  const { code, slots } = parseTemplate(action.template);
  if (!slots.some(isNodeSlot) || !filled(slots, values)) return undefined;
  return fillPattern(
    code,
    slots.map((slot) =>
      isNodeSlot(slot)
        ? { node: true }
        : { node: false, slot, value: values[slot.name]! },
    ),
  );
}

/** Whether an action needs no gesture: a chain without placeholders, a new node with only `{{node}}`. */
export function isPlainAction(action: VizAction): boolean {
  const { slots } = parseTemplate(action.template);
  return action.kind === "chain"
    ? slots.length === 0
    : slots.length > 0 && slots.every(isNodeSlot);
}
```

- [ ] **Step 4: Run it to see it pass.** Expected: all pass. If the
      `firstSpaced` or literal-step tests print differently from the
      expectations, compare with 3.0's snapshot entries for the same shapes: the
      builder must print what today's code prints. Then `typecheck`, `lint`.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: one builder for the node actions Enso describes"
```

### Task 3.2.2: The plain-action toolbar and the Warnings visualisation

**Files:**

- Modify: `app/gui/src/project-view/components/visualizations/vizActions.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/__tests__/vizActions.test.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/WarningsVisualization.vue`
- Modify: `app/gui/integration-test/mock/lsHandler.ts` (the Warnings
  preprocessor's mocked result)
- Delete: `app/gui/src/project-view/components/visualizations/warningsNodes.ts`

**Interfaces:**

- Produces:
  `plainActionToolbar(actions: readonly VizAction[], createNodes: (...options: NodeCreationOptions[]) => void, disabled?: (action: VizAction) => ToValue<boolean>): ToolbarItem[]`
  — one button per plain action, `title` its label, `icon` its icon,
  `dataTestid` its id with `-` for `_` plus `-button`
  (`remove-warnings-button`).

- [ ] **Step 1: Write the failing test.** Append to `vizActions.test.ts` (import
      `plainActionToolbar` too, and `isActionButton` from `'../toolbar'`,
      `NodeCreationOptions` as a type from
      `'@/components/GraphEditor/nodeCreation'`):

```ts
describe("plainActionToolbar", () => {
  test("a button per plain action, creating its node", () => {
    const actions: VizAction[] = [
      {
        id: "remove_warnings",
        label: "Remove Warnings",
        icon: "not_exclamation",
        kind: "chain",
        template: "remove_warnings",
      },
      {
        id: "open_row",
        label: "Get Row",
        icon: "select_row",
        kind: "chain",
        template: "get_row {{#index}}",
      },
    ];
    const created: string[] = [];
    const items = plainActionToolbar(
      actions,
      (...options: NodeCreationOptions[]) =>
        options.forEach((option) => created.push(text(option.content)!)),
    );
    expect(items).toHaveLength(1);
    const [button] = items;
    if (button == null || !isActionButton(button))
      throw new Error("not a button");
    expect(button.title).toBe("Remove Warnings");
    expect(button.dataTestid).toBe("remove-warnings-button");
    button.onClick();
    expect(created).toEqual(["operator1.remove_warnings"]);
  });
});
```

Run it. Expected: FAIL (`plainActionToolbar` is not exported).

- [ ] **Step 2: Write it.** Append to `vizActions.ts` (and add the imports
      `import type { ToValue } from '$/utils/reactivity'`,
      `import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'`,
      `import type { ActionButton, ToolbarItem } from '@/components/visualizations/toolbar'`,
      `import type { AnyIcon } from '@/util/icons'`):

```ts
/** A toolbar button for each plain action the value offers. */
export function plainActionToolbar(
  actions: readonly VizAction[],
  createNodes: (...options: NodeCreationOptions[]) => void,
  disabled: (action: VizAction) => ToValue<boolean> = () => false,
): ToolbarItem[] {
  return actions.filter(isPlainAction).flatMap((action) => {
    const content = actionPattern(action);
    if (content == null) return [];
    const button: ActionButton = {
      icon: (action.icon || undefined) as AnyIcon | undefined,
      title: action.label,
      disabled: disabled(action),
      onClick: () => createNodes({ content, commit: true }),
      dataTestid: `${action.id.replaceAll("_", "-")}-button`,
    };
    return [button];
  });
}
```

Run the test. Expected: pass.

- [ ] **Step 3: The Warnings visualisation on it.** In
      `WarningsVisualization.vue`, delete the `removeWarnings` computed and its
      import; make `Data` accept the new message:

```ts
type Message = { warnings: Warning; actions?: unknown };

type Data = Error | Warning | Message;
```

then:

```ts
const messages = computed(() => {
  const data = props.data;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null && "warnings" in data)
    return data.warnings;
  if (typeof data === "object" && data !== null && "message" in data)
    return [data.message];
  return [];
});

const isRemoveWarningsDisabled = computed(
  () =>
    messages.value.length === 0 ||
    (typeof props.data === "object" &&
      props.data !== null &&
      "message" in props.data),
);

config.setToolbar(
  computed(() =>
    plainActionToolbar(
      parseVizActions(props.data),
      config.createNodes,
      (action) =>
        action.id === "remove_warnings" ? isRemoveWarningsDisabled : false,
    ),
  ),
);
```

(`isRemoveWarningsDisabled` is today's rule written for the three shapes: an
array or `warnings` list that is empty, or an error.) Delete `warningsNodes.ts`.
In `integration-test/mock/lsHandler.ts`, give
`'Standard.Visualization.Warnings.process_to_json_text'` the new shape, so that
`graphNodeVisualization.spec.ts` still finds the button:

```ts
    'Standard.Visualization.Warnings.process_to_json_text': encodeJSON({
      warnings: ['warning 1', "warning 2!!&<>;'\x22"],
      actions: [
        {
          id: 'remove_warnings',
          label: 'Remove Warnings',
          icon: 'not_exclamation',
          kind: 'chain',
          template: 'remove_warnings',
        },
      ],
    }),
```

- [ ] **Step 4: Check.** `vitest run src/project-view/components/visualizations`
      — expected: `vizNodeTextSnapshot.test.ts` **fails to compile** (it imports
      `warningsNodes`); that is fixed in 3.2.7 with the other drivers, so for
      now run with `--exclude '**/vizNodeTextSnapshot.test.ts'` and expect the
      rest to pass. `typecheck` will report the same file: expected, and only
      it.

- [ ] **Step 5: Commit.**

```bash
git add -A app/gui/src/project-view/components/visualizations
git commit -m "GUI: the Warnings visualisation's button is its remove_warnings action"
```

### Task 3.2.3: The table's links and toolbar on the builder

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`
  (`parseActionTemplate`, `isNumber`, `getAstPattern`, `toLinkField`,
  `gridSchema.options`, `tableViewFlags`)
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableVizToolbar.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`
  (toolbar wiring)

**Interfaces:**

- Consumes: `actionPattern`, `chainPattern`, `findAction`, `parseVizActions`,
  `placeholderNames`, `plainActionToolbar` (3.2.1, 3.2.2).
- Produces:
  - `TABLE_TOOLBAR_ACTIONS = ['sort', 'filter', 'remove_columns', 'reorder_columns'] as const`
    (exported from `tableVizToolbar.ts`).
  - `SortFilterNodesButtonOptions.actions: ToValue<readonly VizAction[]>`,
    replacing `isCreateNewNodeEnabled` (and in `ColumnNodeButton`).
  - `tableViewFlags(data).createNodeEnabled`: whether the value offers any of
    `TABLE_TOOLBAR_ACTIONS` (same values as today's `create_node` for every
    golden).

- [ ] **Step 1: Links.** In `tableView.ts`, delete `ParsedActionTemplate`,
      `parseActionTemplate`, `isNumber` and `getAstPattern`; import
      `actionPattern` and `placeholderNames` from `'../vizActions'`; add:

```ts
/**
 * The node a link creates from a row: its template filled from the row, `{{#index}}` from the row
 * number. A link is the view's own `chain` action (Enso writes it beside the columns it reads).
 */
function linkPattern(row: Record<string, unknown>, template: string) {
  const values = Object.fromEntries(
    placeholderNames(template).map((name) => [
      name,
      (name === "index" ? row[INDEX_FIELD_NAME] : row[name]) as
        string | number | null | undefined,
    ]),
  );
  return actionPattern({ kind: "chain", template }, values);
}
```

and in `toLinkField` make the double-click

```ts
    onCellDoubleClicked: (params) => {
      const pattern = linkPattern(params.data, getChildAction)
      if (pattern) ctx.createNode(pattern)
    },
```

Remove the `Pattern` import if nothing else uses it (keep the `Pattern` type in
`TableViewContext.createNode`'s signature: import it `type`-only).

- [ ] **Step 2: Run spec B's gate.**
      `vitest run src/project-view/components/visualizations/__tests__/tableViewSnapshot.test.ts`.
      Expected: pass, snapshot unchanged (every link's `createdNodes`). A
      difference here is gap 15 (a link on an empty cell) or a builder bug: only
      the former may stay, listed in the PR.

- [ ] **Step 3: The toolbar on the actions.** Rewrite `useSortFilterNodesButton`
      in `tableVizToolbar.ts`. Replace
      `isCreateNewNodeEnabled: ToValue<boolean>` with
      `actions: ToValue<readonly VizAction[]>` in `SortFilterNodesButtonOptions`
      and `ColumnNodeButton`, and the function with:

```ts
/** The actions the toolbar's "create components" button understands. */
export const TABLE_TOOLBAR_ACTIONS = [
  "sort",
  "filter",
  "remove_columns",
  "reorder_columns",
] as const;

function useSortFilterNodesButton({
  filterModel,
  sortModel,
  tableFilteredOrSorted,
  actions,
  createNodes,
  getColumnValueToEnso,
  hiddenColumns,
  vizColumnOrder,
}: NewNodeOptions): ComputedRef<ToolbarItem | undefined> {
  const sortSpecPattern = Pattern.parseExpression("(..Name __ __ )")!;
  const conditionPattern = Pattern.parseExpression("(__ __)")!;
  const betweenPattern = Pattern.parseExpression("(..Between __ __)")!;

  const sortDirection = { asc: "..Ascending", desc: "..Descending" };

  /** The filter condition of one grid filter, as the gesture's value (`(..Equal 3)`, `..Is_Nothing`). */
  function conditionBuilder(
    columnName: string,
    filterType: FilterType,
    filterAction: FilterAction | undefined,
    value?: string[] | string | FilterValueRange,
  ) {
    const valueFormatter = getColumnValueToEnso(columnName);
    return (module: Ast.MutableModule): Ast.Owned<Ast.MutableExpression> => {
      if (filterAction === "blank" || filterAction === "notBlank") {
        return Ast.parseExpression(actionMap[filterAction], module)!;
      }
      if (filterType === "set") {
        if (Array.isArray(value) && value.length === 1) {
          return conditionPattern.instantiateCopied([
            Ast.parseExpression("..Equal")!,
            valueFormatter(value[0]!, module) as Expression | MutableExpression,
          ]);
        }
        return conditionPattern.instantiateCopied([
          Ast.parseExpression("..Is_In")!,
          Ast.Vector.build(
            value as string[],
            (element, tempModule) => valueFormatter(element, tempModule),
            module,
          ),
        ]);
      }
      if (
        filterType === "number" &&
        filterAction === "inRange" &&
        typeof value === "object"
      ) {
        const { fromValue, toValue } = value as FilterValueRange;
        return betweenPattern.instantiateCopied([
          valueFormatter(fromValue, module) as Expression | MutableExpression,
          valueFormatter(toValue, module) as Expression | MutableExpression,
        ]);
      }
      return conditionPattern.instantiateCopied([
        Ast.parseExpression(actionMap[filterAction!])!,
        valueFormatter(value as string, module) as
          Expression | MutableExpression,
      ]);
    };
  }

  function createNewNodes() {
    const offered = toValue(actions);
    const filters = toValue(filterModel);
    const sorts = toValue(sortModel);
    const patterns: Pattern[] = [];

    const filterAction = findAction(offered, "filter");
    const filterNode =
      filterAction && filters.length
        ? chainPattern(
            filters.map((filter) => ({
              template: filterAction.template,
              values: {
                column: filter.columnName,
                condition: conditionBuilder(
                  filter.columnName,
                  filter.filterType,
                  filter.filterAction,
                  getFilterValue(filter),
                ),
              },
            })),
            { firstSpaced: true },
          )
        : undefined;

    const sortAction = findAction(offered, "sort");
    if (sortAction && sorts.length > 0) {
      const columns = sorts
        .filter((s) => s?.columnName)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map(
          (sort) => (module: Ast.MutableModule) =>
            sortSpecPattern.instantiateCopied(
              [
                Ast.TextLiteral.new(sort.columnName),
                Ast.parseExpression(
                  sortDirection[sort.sortDirection as SortDirection],
                )!,
              ],
              module,
            ),
        );
      const pattern = actionPattern(sortAction, { columns });
      if (pattern) patterns.push(pattern);
    }

    const removeAction = findAction(offered, "remove_columns");
    const columnsToRemove = toValue(hiddenColumns);
    if (removeAction && columnsToRemove.length) {
      const pattern = actionPattern(removeAction, { columns: columnsToRemove });
      if (pattern) patterns.push(pattern);
    }

    const reorderAction = findAction(offered, "reorder_columns");
    const columnOrder = toValue(vizColumnOrder);
    if (reorderAction && columnOrder?.length) {
      const pattern = actionPattern(reorderAction, { columns: columnOrder });
      if (pattern) patterns.push(pattern);
    }

    createNodes(
      ...(filterNode ? [filterNode] : []).map(
        (content) => ({ content, commit: true }) satisfies NodeCreationOptions,
      ),
    );
    createNodes(
      ...patterns.map(
        (content) => ({ content, commit: true }) satisfies NodeCreationOptions,
      ),
    );
  }

  const createNodesButton: ToolbarItem = {
    icon: "add_to_graph_editor",
    title:
      "Create new component(s) with the current grid's state applied to the workflow",
    disabled: computed(() => !toValue(tableFilteredOrSorted)),
    onClick: createNewNodes,
  };

  return computed(() =>
    TABLE_TOOLBAR_ACTIONS.some((id) => findAction(toValue(actions), id))
      ? createNodesButton
      : undefined,
  );
}
```

Notes for the implementer:

- The filter's condition is built exactly as `buildFilterExpression` built it,
  minus the column (which the template now supplies as `{{@column}}`): the
  `'__ (__ __)'` pattern becomes `'(__ __)'`, `'__ (..Between __ __)'` becomes
  `'(..Between __ __)'`, and the blank case's `'__ __'` becomes the bare
  constructor. Today's `projector`/`buildPattern` passed `filterType` and
  `filterAction` swapped twice (they cancel); pass them straight.
- `getFilterValue` is imported from `./tableVizFilterUtils` as before. A set
  filter has no `filterAction` (`undefined`), as today; only the last branch
  reads it, which a set filter never reaches.
- Delete `createSimpleAstCall`, `createFilterCall`, `buildFilterExpression`,
  `buildPattern`, `makeSortPattern`, `getAstPatternSort`, `projector` and
  `ConstructivePattern`, and the imports nothing uses afterwards (lint names
  them). Add
  `import { actionPattern, chainPattern, findAction, type VizAction } from '../vizActions'`.

- [ ] **Step 4: Flags and the component.** In `tableView.ts`: delete
      `create_node` from `gridSchema.options`; import `parseVizActions` and
      `findAction` from `'../vizActions'` and `TABLE_TOOLBAR_ACTIONS` from
      `'./tableVizToolbar'`; in `tableViewFlags` set

```ts
    createNodeEnabled: TABLE_TOOLBAR_ACTIONS.some((id) => findAction(parseVizActions(data), id)),
```

(and `createNodeEnabled: false` stays in the non-grid branch). In
`TableVisualization.vue`: add
`const vizActions = computed(() => parseVizActions(props.data))`; delete
`isCreateNewNodeEnabled`; pass `actions: vizActions` instead of
`isCreateNewNodeEnabled` to `useTableVizToolbar`; and make the toolbar include
the plain actions:

```ts
const tableToolbar = useTableVizToolbar({
  textFormatterSelected,
  filterModel,
  sortModel,
  tableFilteredOrSorted: isTableFilteredOrSorted,
  actions: vizActions,
  createNodes: config.createNodes,
  getColumnValueToEnso,
  hiddenColumns,
  vizColumnOrder,
  refreshGrid,
});
config.setToolbar(
  computed(() => [
    ...tableToolbar.value,
    ...plainActionToolbar(vizActions.value, config.createNodes),
  ]),
);
```

- [ ] **Step 5: Check.** `vitest run` of the `visualizations` folder excluding
      `vizNodeTextSnapshot.test.ts` (3.2.7): pass, spec B's snapshot unchanged
      (`createNodeEnabled` true exactly for the table goldens, from their
      `actions` now). `tableViewMessage.test.ts` cases that set
      `options: { create_node: true }` and assert `createNodeEnabled`: change
      them to give
      `actions: [{ id: 'sort', label: 'Sort', icon: '', kind: 'chain', template: 'sort {{columns*}}' }]`
      instead. `typecheck` (only the snapshot test's errors remain), `lint`.

- [ ] **Step 6: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: the table's links and toolbar make nodes from the value's actions"
```

### Task 3.2.4: The scatter plot on the builder

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/ScatterplotVisualization/scatterNodes.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/ScatterplotVisualization.vue`
  (`Data`, the data parser, `createNewFilterNode`, `createNode`, the toolbar)

**Interfaces:**

- Consumes: `actionPattern`, `chainPattern`, `findAction`, `parseVizActions`,
  `plainActionToolbar`, `type VizAction`.
- Produces (replacing 3.0.1's functions):
  - `brushFilterPattern(action: VizAction, series: string[], xColName: string, minX: number, maxX: number, minY: number, maxY: number): Pattern | undefined`
  - `rowPattern(action: VizAction, rowNumber: number): Pattern | undefined`

- [ ] **Step 1: Rewrite `scatterNodes.ts`.**

```ts
/**
 * @file The nodes the scatter plot creates, from the value's actions: a filter to the brushed
 * ranges (`brush_filter`, once per axis column, chained in one node) and a point's row
 * (`open_row`). Snapshotted by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import type { Pattern } from "@/util/ast/match";
import { actionPattern, chainPattern, type VizAction } from "../vizActions";

/** The node filtering the x column to `minX..maxX` and each series to `minY..maxY`. */
export function brushFilterPattern(
  action: VizAction,
  series: string[],
  xColName: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): Pattern | undefined {
  return chainPattern([
    {
      template: action.template,
      values: { column: xColName, min: minX, max: maxX },
    },
    ...series.map((column) => ({
      template: action.template,
      values: { column, min: minY, max: maxY },
    })),
  ]);
}

/** The node of one point's row. */
export function rowPattern(
  action: VizAction,
  rowNumber: number,
): Pattern | undefined {
  return actionPattern(action, { index: rowNumber });
}
```

- [ ] **Step 2: The component.** In `ScatterplotVisualization.vue`: delete
      `get_row_method` from `Data` and from the parser (the two lines around
      `rawData.get_row_method`); add
      `const vizActions = computed(() => parseVizActions(props.data))`,
      `const brushAction = computed(() => findAction(vizActions.value, 'brush_filter'))`,
      `const rowAction = computed(() => findAction(vizActions.value, 'open_row'))`;
      in `createNewFilterNode`, after computing the bounds:

```ts
const action = brushAction.value;
if (action == null) return;
const pattern = brushFilterPattern(
  action,
  seriesLabels,
  xColName,
  minX,
  maxX,
  minY,
  maxY,
);
if (pattern) config.createNodes({ content: pattern, commit: true });
```

and `createNode`:

```ts
function createNode(rowNumber: number) {
  const action = rowAction.value;
  const pattern = action && rowPattern(action, rowNumber);
  if (pattern) config.createNodes({ content: pattern, commit: true });
}
```

In `useScatterplotVizToolbar`, include the "Create component of selected points"
button only when `brushAction.value != null` (gap 8), and append
`...plainActionToolbar(vizActions.value, config.createNodes)` to the list
(`props` is the component's existing `defineProps` result, line ~125).

- [ ] **Step 3: Check.** `typecheck` (only the snapshot test), `lint`, and the
      `visualizations` vitest run excluding the snapshot test. Expected: pass.

- [ ] **Step 4: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: the scatter plot's brush and points make nodes from the value's actions"
```

### Task 3.2.5: The tree's chain on the builder

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/treeExpression.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/JSONVisualization.vue`
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/CLAUDE.md`

**Interfaces:**

- Consumes: `chainPattern`, `parseVizActions`, `plainActionToolbar`.
- Produces:
  `nodeExpressionPattern(chain: readonly string[]): Pattern | undefined` keeps
  its signature and results.

- [ ] **Step 1: The chain.** In `treeExpression.ts`, replace the body of
      `nodeExpressionPattern`:

```ts
export function nodeExpressionPattern(
  chain: readonly string[],
): Pattern | undefined {
  if (chain.length === 0 || !chain.every(isNodeExpression)) return undefined;
  return chainPattern(chain.map((step) => ({ code: step.slice(1) })));
}
```

import `chainPattern` from `'../vizActions'` and keep `Pattern` as a type-only
import. `treeExpression.test.ts` must pass unchanged.

- [ ] **Step 2: Plain actions in the tree's toolbar.** In
      `JSONVisualization.vue` add (with the imports):

```ts
config.setToolbar(
  computed(() => plainActionToolbar(parseVizActions(data), config.createNodes)),
);
```

(`parsePrepared` ignores the new `actions` field: zod objects strip unknown
keys.)

- [ ] **Step 3: Document.** In `JSONVisualization/CLAUDE.md`, change the
      double-click bullet's "(`treeExpression.ts`, joined with the spaced dot)"
      to "(`treeExpression.ts`: the steps are literal steps of the shared
      builder's `chainPattern`, `../vizActions.ts`, joined with the spaced
      dot)", and add: "The root value's plain actions (`"actions"` in
      `Tree.prepare`'s JSON) are toolbar buttons."

- [ ] **Step 4: Check and commit.**
      `vitest run src/project-view/components/visualizations/JSONVisualization`,
      `typecheck`, `lint`.

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "GUI: the tree's node expressions chain through the shared builder"
```

### Task 3.2.6: Delete `create_node` and `get_row_method`

**Files:**

- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/In_Memory_Viz_Source.enso`
  (`view_settings`)
- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Internal/View_Json.enso`
  (`grid_json` doc)
- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Scatter_Plot.enso`
  (`no_numeric_json`, `json_from_viz_table`, `json_from_vector`)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`
- Modify: `test/Visualization_Tests/src/Table_Spec.enso` (`make_json`, its
  callers)
- Modify:
  `app/gui/integration-test/project-view/table-vis-json/singleColumnDates.json`,
  `singleColumnDatetimes.json`, `singleColumnTimes.json`
- Regenerate: the six goldens with `"create_node"` (`table_cells`,
  `table_db_table`, `table_mem_1col_table`, `table_mem_1x1_table`,
  `table_mem_server_table`, `table_mem_table`) and all 15 `scatter_*`

- [ ] **Step 1: Enso.** In `In_Memory_Viz_Source.view_settings` delete the
      `create_node` binding and use `["status_bar"]` and `[]` for the options:

```enso
    view_settings self -> Table_View =
        is_table = Nothing == self.column
        index_action = if is_table then "get_row {{#index}}" else "at {{#index}}"
        case self.db_row_count of
            Nothing -> Table_View.Value index_action self.table.row_count self.version_hash ["status_bar"] True
            n -> Table_View.Value index_action n Nothing [] False
```

In `View_Json.grid_json`'s doc, drop "`"create_node"` (the toolbar's create-node
button)" from the options list. In `Scatter_Plot.enso` delete
`,"get_row_method":"get_row"` (twice) and `,"get_row_method":"at"` (once) from
the JSON texts. In the Visualization `CLAUDE.md`, "Table view message": drop
`create_node` from `options`.

- [ ] **Step 2: Tests and goldens.** In `Table_Spec.enso`'s `make_json`, delete
      the `enable_create_node` parameter and its `["create_node", True]` pair,
      and `enable_create_node=…` from every call. Sync, build, regenerate with
      `ENSO_UPDATE_PINNED=1` filtered to `Pinned`, copy back only the 21 files
      named above, run `Visualization_Tests` in full. Expected: all pass;
      `git status` shows only those goldens among `data/pinned`.

- [ ] **Step 3: GUI fixtures.** Remove `"create_node": true` from the three
      `table-vis-json` files and from `SORTABLE_TABLE` in
      `tableVisualisation.spec.ts`; give `SORTABLE_TABLE` the table's actions
      instead, copied from `table_mem_table.json`'s `actions` array (the eight
      objects). Run spec B's snapshot test: unchanged.

- [ ] **Step 4: Lint and commit.** Enso lint on the Visualization and Table
      libraries and `test/Visualization_Tests`; GUI `lint`.

```bash
git add distribution/lib/Standard test/Visualization_Tests app/gui/integration-test
git commit -m "Visualization: drop the create_node option and get_row_method (the actions replace them)"
```

### Task 3.2.7: The gate, Playwright, Linux and PR 3.2

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/__tests__/vizNodeTextSnapshot.test.ts`
  (the DRIVERS block and its imports only)
- Modify:
  `app/gui/integration-test/project-view/scatterplotVisualisation.spec.ts`
  (`SCATTER_DATA`)

- [ ] **Step 1: New drivers.** Delete the `removeWarningsPattern` import (its
      module is gone), keep the others, and add `import * as fs from 'node:fs'`,
      `import * as path from 'node:path'`,
      `import { findAction, parseVizActions, plainActionToolbar, type VizAction } from '../vizActions'`,
      and replace the block between the `DRIVERS` markers with:

```ts
// ---- DRIVERS: how the code makes each gesture's node. PRs 3.2 and 3.3 replace this block. ----

const pinnedDir = path.resolve(
  __dirname,
  "../../../../../../../test/Visualization_Tests/data/pinned",
);

/** The actions Enso sends for a value, read from its pinned table view. */
function pinnedActions(golden: string): VizAction[] {
  return parseVizActions(
    JSON.parse(
      fs.readFileSync(path.join(pinnedDir, `${golden}.json`), "utf-8"),
    ),
  );
}

const TABLE_ACTIONS = pinnedActions("table_mem_table");
const VECTOR_ACTIONS = pinnedActions("table_vector");

function action(actions: readonly VizAction[], id: string): VizAction {
  const found = findAction(actions, id);
  if (found == null) throw new Error(`no ${id} action`);
  return found;
}

/** The nodes the table toolbar's "create components" button makes. */
function toolbarNodes(c: ToolbarCase): string[] {
  const created: string[] = [];
  const items = useTableVizToolbar({
    textFormatterSelected: ref("partial"),
    filterModel: c.filters ?? [],
    sortModel: c.sorts ?? [],
    tableFilteredOrSorted: true,
    actions: TABLE_ACTIONS,
    createNodes: capture(created),
    getColumnValueToEnso: columnValueToEnso(COLUMN_TYPES),
    hiddenColumns: c.hidden ?? [],
    vizColumnOrder: c.order ?? null,
    refreshGrid: () => {},
  });
  const button = items.value.find(
    (item) => isActionButton(item) && item.icon === "add_to_graph_editor",
  );
  if (button == null || !isActionButton(button))
    throw new Error("no create-components button");
  button.onClick();
  return created;
}

/** The node of a table right-click menu item, on a table with the clicked cell at `column`, `row`. */
function menuNode(
  column: string | null,
  row: number | null,
  item: "Get Column" | "Get Row" | "Get Value",
) {
  const valueAction: ValueNodeAction =
    item === "Get Column" ? "at" : item === "Get Row" ? "get_row" : "get_value";
  return text(valueNodePattern(column, row, valueAction));
}

/** The scatter plot's "create component of selected points" node on a table. */
function brushNode(
  series: string[],
  x: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
) {
  return text(
    brushFilterPattern(
      action(TABLE_ACTIONS, "brush_filter"),
      series,
      x,
      minX,
      maxX,
      minY,
      maxY,
    ),
  );
}

/** A double-clicked scatter point's node, on a table (`table`) or a vector (`vector`). */
function pointNode(row: number, value: "table" | "vector") {
  return text(
    rowPattern(
      action(value === "table" ? TABLE_ACTIONS : VECTOR_ACTIONS, "open_row"),
      row,
    ),
  );
}

/** The Warnings visualisation's "remove warnings" node. */
function removeWarningsNode() {
  const created: string[] = [];
  const actions = parseVizActions({
    actions: [
      {
        id: "remove_warnings",
        label: "Remove Warnings",
        icon: "not_exclamation",
        kind: "chain",
        template: "remove_warnings",
      },
    ],
  });
  const [button] = plainActionToolbar(actions, capture(created));
  if (button == null || !isActionButton(button))
    throw new Error("no remove-warnings button");
  button.onClick();
  return created[0];
}

/** A tree entry's node, from its chain of node expressions. */
function treeNode(chain: string[]) {
  return text(nodeExpressionPattern(chain));
}

// ---- end of DRIVERS ----
```

(`menuNode` is unchanged in 3.2: the menu is 3.3's.) The remove-warnings action
here is the one `Viz_Actions_Spec` pins for the Warnings preprocessor.

- [ ] **Step 2: Run the gate.**
      `vitest run src/project-view/components/visualizations`. Expected: all
      pass, **both snapshots unchanged** (`git status` shows no `.snap` change).
      A difference is a builder bug: fix the builder or the gesture, never the
      snapshot. The one allowed exception is gap 15 in spec B's snapshot, listed
      in the PR.

- [ ] **Step 3: Playwright.** In `scatterplotVisualisation.spec.ts`, delete
      `get_row_method` from `SCATTER_DATA` and add the table's eight actions
      (copied from `table_mem_table.json`) as `actions`. Then, from `app/gui`:
      `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/project-view/tableVisualisation.spec.ts integration-test/project-view/scatterplotVisualisation.spec.ts integration-test/project-view/graphNodeVisualization.spec.ts integration-test/project-view/jsonTreeVisualisation.spec.ts --repeat-each=3`.
      Expected: all pass (the warnings test reads the mock changed in 3.2.2).
      `typecheck` and `lint`: pass.

- [ ] **Step 4: Linux.** Sync `viz/actions-gui` into `~/vizwork2`, `lint` and
      the Playwright command. Expected: pass, `git status` clean.

- [ ] **Step 5: Commit, push, PR.**

```bash
git add app/gui
git commit -m "GUI tests: the node-text gate drives the actions"
```

Push `viz/actions-gui`; open "GUI: every visualisation makes nodes from the
actions Enso describes (piece 3, 3.2)" with the spec and plan links, gaps 2, 5,
7, 8, 11, 14, 15, 16 and the two fixes users can see (a column's scatter point
makes a working node; the brush button is hidden where it would make a broken
one), the test plan, and "both snapshots unchanged". Label
`CI: No changelog needed` (bug fixes only). Merge on green.

---

## PR 3.3 — Right-click menu in the table and tree (feature)

Worktree `C:\Repos\Enso\ide-viz-a3`, branch `viz/actions-menu` from
`origin/develop` after 3.2 has merged.

### Task 3.3.1: The table's menu from the value's actions

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableContextMenu.ts`
- Create:
  `app/gui/src/project-view/components/visualizations/TableVisualization/__tests__/tableContextMenu.test.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization/tableView.ts`
  (`viewLink`)
- Modify:
  `app/gui/src/project-view/components/visualizations/TableVisualization.vue`
  (`getContextMenuItems`, `createValueNode`)
- Modify:
  `app/gui/src/project-view/components/visualizations/__tests__/vizNodeTextSnapshot.test.ts`
  (`menuNode` only)

**Interfaces:**

- Consumes: `actionPattern`, `findAction`, `type VizAction` (3.2.1); spec B's
  `INDEX_FIELD_NAME`.
- Produces:
  - `interface TableMenuEntry { name: string; icon: string; pattern: Pattern }`
  - `tableMenuEntries(actions: readonly VizAction[], link: { action: string; label?: string | undefined } | undefined, column: string | null, row: Record<string, unknown> | null): TableMenuEntry[]`
  - `viewLink(data: unknown): { action: string; label?: string | undefined } | undefined`
    (`tableView.ts`: the grid's `index` link, else its first column `link`).

- [ ] **Step 1: Write the failing test.**

```ts
import { Ast } from "@/util/ast";
import { describe, expect, test } from "vitest";
import type { VizAction } from "../../vizActions";
import { tableMenuEntries } from "../tableContextMenu";

const chain = (
  id: string,
  label: string,
  icon: string,
  template: string,
): VizAction => ({
  id,
  label,
  icon,
  kind: "chain",
  template,
});

const TABLE = [
  chain("open_row", "Get Row", "select_row", "get_row {{#index}}"),
  chain("open_column", "Get Column", "select_column", "at {{@column}}"),
  chain(
    "open_cell",
    "Get Value",
    "select_cell",
    "get_value {{@column}} {{#index}}",
  ),
  chain("sort", "Sort", "", "sort {{columns*}}"),
];

function texts(entries: ReturnType<typeof tableMenuEntries>) {
  return entries.map(
    (e) =>
      `${e.name}: ${e.pattern.instantiateCopied([Ast.parseExpression("operator1")!]).code()}`,
  );
}

describe("tableMenuEntries", () => {
  test("a table cell: column, row and value, by the row number", () => {
    // Display row 0 after a sort holds the table's row 2: the menu uses `#`, not the display index.
    expect(
      texts(
        tableMenuEntries(TABLE, { action: "get_row {{#index}}" }, "b", {
          "#": 2,
          b: "x",
        }),
      ),
    ).toEqual([
      'Get Column: operator1.at "b"',
      "Get Row: operator1.get_row 2",
      'Get Value: operator1.get_value "b" 2',
    ]);
  });
  test("the row-number column offers only the row", () => {
    expect(texts(tableMenuEntries(TABLE, undefined, "#", { "#": 2 }))).toEqual([
      "Get Row: operator1.get_row 2",
    ]);
  });
  test("a vector offers its item", () => {
    const vector = [
      chain("open_row", "Get Item", "select_row", "at {{#index}}"),
    ];
    expect(
      texts(
        tableMenuEntries(vector, { action: "at {{#index}}" }, "0", {
          "#": 1,
          "0": 5,
        }),
      ),
    ).toEqual(["Get Item: operator1.at 1"]);
  });
  test("a value with only a link offers the link", () => {
    expect(
      texts(
        tableMenuEntries(
          [],
          { action: "query {{@Table}}", label: "table" },
          "Table",
          { "#": 0, Table: "pinned" },
        ),
      ),
    ).toEqual(['Open This Table: operator1.query "pinned"']);
  });
  test("nothing applies: no entries", () => {
    expect(tableMenuEntries([], undefined, "b", { "#": 0, b: 1 })).toEqual([]);
  });
});
```

Run it. Expected: FAIL (`tableMenuEntries` is not exported).

- [ ] **Step 2: Write it.** Replace `tableContextMenu.ts` with:

```ts
/**
 * @file The table's right-click menu: the value's `open_column`, `open_row` and `open_cell`
 * actions, filled from the clicked cell (its column, and its row's `#` number, which survives
 * sorting), or the view's link when the value offers no row action. Snapshotted, through
 * `menuNode`, by `../__tests__/vizNodeTextSnapshot.test.ts`.
 */
import type { Pattern } from "@/util/ast/match";
import {
  actionPattern,
  findAction,
  placeholderNames,
  type VizAction,
} from "../vizActions";
import { INDEX_FIELD_NAME } from "./tableView";

export interface TableMenuEntry {
  name: string;
  icon: string;
  pattern: Pattern;
}

const MENU_ACTIONS = ["open_column", "open_row", "open_cell"] as const;

/** The entries of the menu of the cell at `column` in `row`; an entry missing a value is left out. */
export function tableMenuEntries(
  actions: readonly VizAction[],
  link: { action: string; label?: string | undefined } | undefined,
  column: string | null,
  row: Record<string, unknown> | null,
): TableMenuEntry[] {
  const index = row?.[INDEX_FIELD_NAME] as number | undefined;
  const dataColumn = column === INDEX_FIELD_NAME ? null : column;
  const entries = MENU_ACTIONS.flatMap((id) => {
    const action = findAction(actions, id);
    const pattern =
      action && actionPattern(action, { column: dataColumn, index });
    return action && pattern
      ? [{ name: action.label, icon: action.icon, pattern }]
      : [];
  });
  if (findAction(actions, "open_row") == null && link != null && row != null) {
    const values = Object.fromEntries(
      placeholderNames(link.action).map((name) => [
        name,
        (name === "index" ? index : row[name]) as
          string | number | null | undefined,
      ]),
    );
    const pattern = actionPattern(
      { kind: "chain", template: link.action },
      values,
    );
    const label = link.label ?? "value";
    if (pattern) {
      entries.push({
        name: `Open This ${label.charAt(0).toUpperCase()}${label.slice(1)}`,
        icon: "select_row",
        pattern,
      });
    }
  }
  return entries;
}
```

In `tableView.ts` add:

```ts
/** The view's link: its row-number column's, else its first link column's. */
export function viewLink(
  data: unknown,
): { action: string; label?: string | undefined } | undefined {
  const message = parseViewMessage(data);
  if (message?.kind !== "grid") return undefined;
  return (
    message.index ?? message.columns.find((column) => column.link != null)?.link
  );
}
```

(`parseViewMessage` is the module's existing parser.) Run the test. Expected:
pass.

- [ ] **Step 3: The component.** In `TableVisualization.vue` replace
      `getContextMenuItems` and `createValueNode` with:

```ts
const getContextMenuItems = (
  params: GetContextMenuItemsParams,
): (MenuItemDef | DefaultMenuItem)[] => {
  const column = params.column ? params.column.getColId() : null;
  const row =
    (params.node?.data as Record<string, unknown> | undefined) ?? null;
  const entries = tableMenuEntries(
    vizActions.value,
    viewLink(props.data),
    column,
    row,
  );
  return [
    commonContextMenuActions.copy,
    commonContextMenuActions.copyWithHeaders,
    "separator",
    "export",
    ...entries.map((entry) => ({
      name: entry.name,
      action: () =>
        config.createNodes({ content: entry.pattern, commit: true }),
      icon: getSvgTemplate(entry.icon),
    })),
  ];
};
```

with the imports (`tableMenuEntries`, `viewLink`), and drop the
`ValueNodeAction`/`valueNodePattern` imports.

- [ ] **Step 4: The gate's menu driver.** In `vizNodeTextSnapshot.test.ts`,
      replace `menuNode` (and drop the `valueNodePattern`/`ValueNodeAction`
      import; add `tableMenuEntries`) with:

```ts
/** The node of a table right-click menu item, on a table with the clicked cell at `column`, `row`. */
function menuNode(
  column: string | null,
  row: number | null,
  item: "Get Column" | "Get Row" | "Get Value",
) {
  const entries = tableMenuEntries(
    TABLE_ACTIONS,
    { action: "get_row {{#index}}", label: "row" },
    column ?? "#",
    row == null ? null : { "#": row, b: "x" },
  );
  return text(entries.find((entry) => entry.name === item)?.pattern);
}
```

Run the gate. Expected: the snapshot is unchanged — the five menu entries make
the same text (`Get Column`/`Get Value` on the row-number column stay
`undefined`). Any other difference is a bug.

- [ ] **Step 5: Check and commit.** `vitest run` of the `visualizations` folder,
      `typecheck`, `lint`.

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "Table view: the right-click menu offers the value's actions for the clicked cell"
```

### Task 3.3.2: The tree's right-click menu

**Files:**

- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/TreeRow.vue`
  (a `menu` emit)
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/JSONVisualization.vue`
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/lazyTree.ts`
  (`entryMenu`)
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/__tests__/lazyTree.test.ts`
- Modify:
  `app/gui/src/project-view/components/visualizations/JSONVisualization/CLAUDE.md`

**Interfaces:**

- Consumes: `siblingChains`, `nodeExpressionPattern`, `GridPopupMenu`
  (`@/components/GridPopupMenu.vue`), `menuIconHtml`
  (`@/components/shared/AgGridTableView/gridPopupMenuItems`).
- Produces:
  `entryMenu(rows: readonly TreeRow[], row: TreeRow): { name: string; icon: string; chains: (readonly string[])[] }[]`
  (`lazyTree.ts`).

- [ ] **Step 1: Write the failing test.** In `lazyTree.test.ts` (with
      `entryMenu` imported; build `rows` the way the file's existing
      `siblingChains` test does, then):

```ts
test("entryMenu offers the entry and its loaded siblings, nothing without a chain", () => {
  const entry = rows.find((r) => r.kind === "entry" && r.chain != null)!;
  const menu = entryMenu(rows, entry);
  expect(menu.map((m) => m.name)).toEqual([
    "Get Value",
    "Get All Loaded Values Here",
  ]);
  expect(menu[0]!.chains).toEqual([
    (entry as { chain: readonly string[] }).chain,
  ]);
  expect(menu[1]!.chains).toEqual(siblingChains(rows, entry));
  const without = { ...entry, chain: null } as TreeRow;
  expect(entryMenu(rows, without)).toEqual([]);
});
```

Run it. Expected: FAIL.

- [ ] **Step 2: Write `entryMenu`.** In `lazyTree.ts`:

```ts
/**
 * The tree's right-click menu on `row`: the node of the entry (as a double-click) and of each
 * loaded entry beside it (as Shift+double-click). None for an entry no expression reaches.
 */
export function entryMenu(
  rows: readonly TreeRow[],
  row: TreeRow,
): { name: string; icon: string; chains: (readonly string[])[] }[] {
  if (row.kind !== "entry" || row.chain == null) return [];
  return [
    { name: "Get Value", icon: "select_cell", chains: [row.chain] },
    {
      name: "Get All Loaded Values Here",
      icon: "select_row",
      chains: siblingChains(rows, row),
    },
  ];
}
```

Run the test. Expected: pass.

- [ ] **Step 3: Wire it.** In `TreeRow.vue` add `menu: [event: MouseEvent]` to
      the emits and `@contextmenu.prevent.stop="emit('menu', $event)"` on the
      same element that has `@dblclick`. In `JSONVisualization.vue`:

```ts
const menu = shallowRef<{
  point: { x: number; y: number };
  items: GridMenuItem[];
}>();

function openMenu(row: TreeRow, event: MouseEvent) {
  const entries = entryMenu(tree.rows.value, row);
  if (entries.length === 0) return;
  menu.value = {
    point: { x: event.clientX, y: event.clientY },
    items: entries.map((entry) => ({
      type: "item",
      name: entry.name,
      icon: menuIconHtml(entry.icon),
      action: () => {
        const patterns = entry.chains.flatMap(
          (chain) => nodeExpressionPattern(chain) ?? [],
        );
        if (patterns.length)
          config.createNodes(
            ...patterns.map(
              (content) =>
                ({ content, commit: true }) satisfies NodeCreationOptions,
            ),
          );
      },
    })),
  };
}
```

with `@menu="openMenu(row, $event)"` on `TreeRowView`, and in the template:

```vue
<GridPopupMenu
  v-if="menu"
  :items="menu.items"
  :point="menu.point"
  @close="menu = undefined"
/>
```

(imports: `GridPopupMenu` from `@/components/GridPopupMenu.vue`, `menuIconHtml`
and `type GridMenuItem` from
`@/components/shared/AgGridTableView/gridPopupMenuItems`, `entryMenu`,
`shallowRef`). `activate` stays as it is.

- [ ] **Step 4: Document.** In `JSONVisualization/CLAUDE.md` add: "Right-click
      on an entry with a chain opens a menu with the same two actions (Get
      Value, Get All Loaded Values Here; `entryMenu` in `lazyTree.ts`, shown
      with the grids' `GridPopupMenu`)."

- [ ] **Step 5: Check and commit.** `vitest run` of the `JSONVisualization`
      folder, `typecheck`, `lint`.

```bash
git add app/gui/src/project-view/components/visualizations
git commit -m "JSON view: a right-click menu on a tree entry"
```

### Task 3.3.3: Playwright for the menus

**Files:**

- Modify: `app/gui/integration-test/project-view/tableVisualisation.spec.ts`
- Modify: `app/gui/integration-test/project-view/jsonTreeVisualisation.spec.ts`

- [ ] **Step 1: The table's menu.** Append to `tableVisualisation.spec.ts`:

```ts
test("Right-click on a sorted table row gets that row", async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage);
  await graphNodeByBinding(page, "aggregated").click();
  await editorPage.press("Space");
  const tableVisualization = locate.tableVisualization(page);
  await expect(tableVisualization).toExist();
  await localApi.updateVisualization(
    "Standard.Visualization.Table.Visualization.prepare_visualization",
    SORTABLE_TABLE,
  );
  // Sort by `a`: the first displayed row is the table's row 1 (a = 1).
  await tableVisualization
    .locator(".ag-header-cell-text", { hasText: /^a$/ })
    .click();
  await tableVisualization
    .getByText("a", { exact: true })
    .first()
    .click({ button: "right" });
  const nodeCount = await locate.graphNode(page).count();
  await page.getByTestId("gridPopupMenu").getByText("Get Row").click();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
  await expect(locate.graphNode(page).last()).toContainText("get_row");
  await expect(
    locate.graphNode(page).last().locator(".WidgetNumber"),
  ).toHaveValue("1");
});

test("Right-click on a link offers the link", async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage);
  await graphNodeByBinding(page, "aggregated").click();
  await editorPage.press("Space");
  const tableVisualization = locate.tableVisualization(page);
  await expect(tableVisualization).toExist();
  await localApi.updateVisualization(
    "Standard.Visualization.Table.Visualization.prepare_visualization",
    {
      kind: "grid",
      columns: [
        { name: "Table", link: { action: "query {{@Table}}", label: "table" } },
      ],
      data: [["pinned"]],
    },
  );
  await tableVisualization.getByText("pinned").click({ button: "right" });
  await page.getByTestId("gridPopupMenu").getByText("Open This Table").click();
  await expect(locate.graphNode(page).last()).toContainText("query");
});
```

(The cell clicked in the first test is in column `b` of the first displayed row,
whose `b` is `'a'`; `'a'` also names a column header, hence `.first()` on the
cells only: if the locator picks the header, use
`tableVisualization.locator('.ag-cell', { hasText: /^a$/ })` instead.)

- [ ] **Step 2: The tree's menu.** Append to `jsonTreeVisualisation.spec.ts`,
      following its double-click test (same setup helper and entry locator):

```ts
test("Right-click on an entry offers to get it", async ({
  editorPage,
  page,
}) => {
  const vis = await openTree(editorPage, page);
  const nodeCount = await locate.graphNode(page).count();
  await entry(vis, "3: 3").click({ button: "right" });
  await page
    .getByTestId("gridPopupMenu")
    .getByText("Get Value", { exact: true })
    .click();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
});
```

(`openTree` and `entry` stand for the file's existing setup and entry-locator
helpers: use their names as the double-click test does.)

- [ ] **Step 3: Run.** From `app/gui`, the Playwright command with
      `tableVisualisation.spec.ts jsonTreeVisualisation.spec.ts --repeat-each=3`.
      Expected: all pass. `typecheck`, `lint`.

- [ ] **Step 4: Commit.**

```bash
git add app/gui/integration-test
git commit -m "GUI tests: Playwright for the table and tree right-click menus"
```

### Task 3.3.4: Linux, changelog, screenshots, installer and PR 3.3

**Files:**

- Modify: `CHANGELOG.md` (after the PR has a number)

- [ ] **Step 1: Linux.** Sync `viz/actions-menu` into `~/vizwork2`, `lint` and
      the Playwright command of 3.3.3. Expected: pass, `git status` clean.
- [ ] **Step 2: Push and open PR 3.3** "Right-click in the table and tree offers
      the components the value describes (piece 3, 3.3)", with the spec and plan
      links, gap 3 (the old menu's broken items and wrong row), open questions
      1–4 as decided, the test plan and the installer check list below. It ends
      with the attribution line.
- [ ] **Step 3: Changelog.** First item under `# Next Release` →
      `#### Enso IDE`, and the link definition beside the others:

```markdown
- [Right-clicking a table cell offers the components that the value's library
  describes for it (its row, column or value, or the table or sheet it links
  to), and right-clicking an entry of the JSON tree adds a component for it or
  for every entry beside it.][NNN]
```

```markdown
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

Commit ("Changelog: right-click menus in the table and tree") and push.

- [ ] **Step 4: Screenshots.** Before (develop) and after, from the dev build or
      an installer: the right-click menu on an in-memory table cell, on a
      vector, on a connection's table list, and on a JSON tree entry. Commit the
      PNGs to the orphan branch `pr-screenshots` under `pr-<NNN>/` (never to
      `viz/actions-menu`) and embed them in the PR body with
      `![after](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-<NNN>/<file>.png)`.
- [ ] **Step 5: Hand over for the installer test.** Build an installer
      (`ide-local`). The PR waits for the owner's OK. Check list: on an
      in-memory table, sort a column, then right-click a cell and use Get Row,
      Get Column and Get Value (each node gets the clicked row, not the
      displayed position); the same on a database table row; right-click on a
      vector item (Get Item) and on a connection's table name (Open This Table);
      right-click on a JSON key and on an array item, and Get All Loaded Values
      Here; the table toolbar's sort and filter button; the scatter brush and a
      point's double-click on a table and a column; Remove Warnings.

---

## Spec coverage

| Spec requirement                                                  | Where                                    |
| ----------------------------------------------------------------- | ---------------------------------------- |
| `Viz_Action` (id, label, icon, kind, template), `Viz_Action_Kind` | 3.1.1                                    |
| `Viz_Actions` and its JSON                                        | 3.1.1                                    |
| Template syntax `{{#x}}`, `{{@x}}`, `{{x*}}`, `{{node}}`          | 3.1.1 (doc), 3.2.1 (builder); gap 5      |
| Base conversions (Vector, Array; warnings)                        | 3.1.1, 3.1.3; gaps 9, 10                 |
| Table and Column conversions, same in memory and in a database    | 3.1.2; gap 11                            |
| XML, Row, key/value views' `open_child`                           | Open question 1 (links stay in the view) |
| A user type's own conversion, a `New_Node` with `{{node}}`        | 3.1.1 (`Thing`), 3.2.1 tests             |
| `actions` beside each visualisation's data                        | 3.1.3; gap 12                            |
| Links and per-child expressions as references                     | Open questions 1, 2; 3.2.3, 3.2.5        |
| One shared builder; missing value disables                        | 3.2.1                                    |
| Builder replaces toolbar, scatter, JSON, Warnings and link code   | 3.2.2–3.2.5 (the table menu: 3.3.1)      |
| Shared toolbar of plain actions                                   | 3.2.2 (Warnings, table, scatter, tree)   |
| Gesture ids replace `enable_create_node`                          | 3.2.3, 3.2.6; gap 11                     |
| Right-click menu in table and tree                                | 3.3.1, 3.3.2                             |
| Node-text snapshot before 3.2, identical after                    | 3.0.2, 3.2.7                             |
| Playwright: sort/filter, scatter brush, warnings, right-click     | 3.0.3, 3.2.7, 3.3.3                      |
| Installer check                                                   | 3.3.4                                    |
| Delivery: 3.1 and 3.2 invisible on green; 3.3 feature with OK     | Global Constraints                       |
| Performance of the field                                          | 3.1.3 Step 7; gap 13                     |
