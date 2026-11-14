# One Lazy Tree for JSON and Objects (Piece 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSON visualisation's whole-JSON rendering with a lazy tree
that loads each branch's children a page at a time from Enso, explores any
value, and creates a node for a child on double-click.

**Architecture:** In `Standard.Visualization`, a `Viz_Tree` type describes a
value as leaves and branches whose children are read a page at a time; Base
types convert to it in its own module, Table and XML for their public types in
theirs, and a user type in its own module. `Standard.Visualization.Tree` has the
two IDE entry points, `prepare` (the JSON visualisation's preprocessor) and
`children` (one page, called through `config.executeExpression` as the table
view's server-side rows are). The GUI keeps the JSON visualisation's name, icon
and default for `JS_Object`, and renders the tree as a virtualised list
(`useVirtualList` from `@vueuse/core`, already a dependency).

**Tech Stack:** Enso standard library (`distribution/lib/Standard/*`), the Enso
test framework (`test/Visualization_Tests`), golden files (`expect_pinned`),
TypeScript/Vue in `app/gui`, zod, `@vueuse/core`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-viz-lazy-tree-design.md` (read it
first). It builds on spec A,
`docs/superpowers/specs/2026-11-14-viz-id-conversion-and-viz-json-design.md` (PR
#763: `Viz_Json` and its conversions), which must have merged before Task 1
starts.

## Global Constraints

- Visualization imports only `Standard.Base`. Libraries import Visualization,
  never the reverse.
- Every conversion is on a **public** type (`Table`, `Column`, `Row`,
  `XML_Document`, `XML_Element`, or a Base type), never on `In_Memory_Table`,
  `DB_Table` or another implementation type.
- Every entity added in a **non-private** module carries `## ---` /
  `private: true` / `---` doc metadata.
- An unused argument is silenced with the repo idiom `_ = that` on its own line.
- No unused imports: the `-Werror` lint fails on them.
- Pages are 100 entries (`page_size` in Enso, `PAGE_SIZE` in the GUI). Nothing
  is cut off: no 100-item or 5-level limit anywhere in the tree.
- Text leaves are cut at 2000 characters plus `…`, exactly as `Viz_Json`.
- `Viz_Json` and `default_preprocessor` stay unchanged: the Image visualisation
  and custom visualisations without a preprocessor still use them. Every
  existing `data_*`, `default_*` and `table_*` golden must pass **unchanged**.
- The wire format below is the contract between Tasks 2 and 5; goldens pin it.
- PR 2.1 (Tasks 1–4) is invisible: label `CI: No changelog needed`, merges on
  green. PR 2.2 (Tasks 5–9) is a feature: changelog entry under `#### Enso IDE`,
  before/after screenshots on the PR, and it waits for the owner's OK after an
  installer test.

## Wire format (`Tree.prepare` and `Tree.children`)

Both return JSON text. Field order is fixed (goldens compare text).

- **Node** — a leaf: `{"kind":"leaf","value":<the leaf's JSON>}`; a branch:
  `{"kind":"object"|"array","size":<Integer>,"label":<Text>}`.
- **Entry** — a child: `"key"` first, then the node's fields, then `"expr"`:
  `{"key":<Text|Integer>,"kind":…,…,"expr":<Text|null>}`. `expr` is the node
  expression relative to the parent (`.at 3`, `.get 'name'`, `.name`), `null`
  when none reaches the child.
- **Page** —
  `{"start":<Integer>,"size":<the branch's size>,"entries":[Entry…]}`. `entries`
  holds the children from `start`, at most `count`; a start at or past the end
  gives `[]`.
- **`Tree.prepare value`** — `{"root":Node}` for a leaf root;
  `{"root":Node,"children":Page}` for a branch root, the page being
  `start 0, count 100`.
- **`Tree.children value path start count`** — a Page, or `{"error":<Text>}`
  when `path` does not lead to a branch or the page fails. `path` is a vector of
  keys (`Text`) and indices (`Integer`) from the root: an array's child is found
  by index, an object's by looking through its pages for the key.

Example, for
`v = Json.parse '{"name":"John","tags":["a","b"],"address":{"city":"Leeds"}}'`
(this is the golden `tree_prepare_js_object.json`; `Text.pretty` quotes with
single quotes; the file is this one line, with no spaces outside strings):

```text
{"root":{"kind":"object","size":3,"label":"{3 keys}"},"children":{"start":0,"size":3,"entries":[{"key":"name","kind":"leaf","value":"John","expr":".get 'name'"},{"key":"tags","kind":"array","size":2,"label":"[2 items]","expr":".get 'tags'"},{"key":"address","kind":"object","size":1,"label":"{1 key}","expr":".get 'address'"}]}}
```

`Tree.children v ["tags"] 1 100` gives
`{"start":1,"size":2,"entries":[{"key":1,"kind":"leaf","value":"b","expr":".at 1"}]}`,
and `Tree.children v ["nope"] 0 100` gives
`{"error":"Illegal Argument: No child has the key 'nope'."}` (the golden pins
the exact message).

The GUI chains a child's `expr` after its ancestors' with the spaced dot:
`.get 'tags'` then `.at 1` on node `data` makes `data.get 'tags' . at 1`. If an
ancestor's `expr` is `null`, the child has no expression either.

## Decisions taken while planning

The spec leaves these open; the plan settles them as follows.

- **The entry carries the expression text, not a flag.** The spec has `prepare`
  send "whether it has a node expression"; a double-click needs the text, so
  every entry carries `expr` (`null` = none).
- **Path walking by key.** `children start count` has no lookup, so an array's
  child is read by index (`children key 1`) and an object's by scanning its
  pages (`Viz_Tree.child`). A missing key is an `Illegal_Argument` naming the
  key.
- **Errors are data.** `Tree.children` turns a dataflow error into
  `{"error": …}`; a panic still fails the evaluation, which the GUI shows the
  same way.
- **Dates and times are leaves of their display text** (`"2020-01-02"`).
- **Dictionary keys** that are neither text nor integers show as their display
  text and are reached with `.at (<pretty key>)`.
- **A database table's `rows` has no node expression** (`.rows` reads the whole
  table), so neither do its rows; its pages still read only the rows asked for.
- **XML:** a document is an object of one key (the root's tag, `.root_element`);
  an element's keys are `@attribute` names then child indices, each reached with
  `.at`.
- **The root is a row** showing its label (or its value, for a leaf); its
  children start one level in.
- **Rows are one line.** The virtual list needs a fixed row height, so a long
  text leaf is cut with an ellipsis and shown whole in its tooltip (today's view
  wraps it). Colours stay as today (keys blue, values dark green).
- **Projections become double-clicks.** Today a click on a `JS_Object` key makes
  a `.get` node and Shift-click one per sibling. Now a double-click makes the
  entry's node and Shift+double-click one per loaded sibling with an expression,
  for any value whose tree supplies expressions (array items now use `.at`).
- **A re-fetch may ask for more than a page.** An open branch that showed 300
  entries is fetched again with `count` 300 after a new payload.
- **`export project.Tree`** in Visualization's `Main.enso`, as
  `Table.Visualization` is, because the GUI calls it by its full name inside the
  node's frame.

## Working environment

- Windows worktrees: PR 2.1 in `C:\Repos\Enso\ide-viz-tree-enso` (branch
  `viz/viz-tree` from `origin/develop`, after #763 has merged); PR 2.2 in
  `C:\Repos\Enso\ide-viz-tree-gui` (branch `viz/tree-gui` from `origin/develop`
  after PR 2.1 has merged; if it starts earlier, branch from `viz/viz-tree` and
  `git rebase --onto origin/develop viz/viz-tree` once PR 2.1 has merged). Never
  `git stash`.
- Enso builds and tests run in the WSL clone `~/vizwork3`. First time only:

  ```bash
  wsl -e bash -lc 'df -h ~ && git clone /mnt/c/Repos/Enso/ide ~/vizwork3'
  ```

  Before each build, commit in the worktree, then sync it into the clone. The
  clone's `origin` is the Windows checkout, whose local `develop` is stale, so
  fetch the branch ref itself, never `origin/develop`:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork3 && git fetch -q /mnt/c/Repos/Enso/ide refs/heads/viz/viz-tree && git checkout -qf FETCH_HEAD && \
    rsync -a --delete /mnt/c/Repos/Enso/ide-viz-tree-enso/std-bits/ std-bits/ && \
    rsync -a --delete /mnt/c/Repos/Enso/ide-viz-tree-enso/distribution/lib/ distribution/lib/ && \
    rsync -a --delete /mnt/c/Repos/Enso/ide-viz-tree-enso/test/ test/ && \
    rsync -a /mnt/c/Repos/Enso/ide-viz-tree-enso/tools/ci/ tools/ci/ && \
    sbt buildEngineDistribution'
  ```

- Run an Enso test project in `~/vizwork3`. `FILTER` is optional, and **a filter
  that matches nothing still exits 0**, so check the printed test count:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork3/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" FILTER'
  ```

  To (re)write golden files, prefix the command with `ENSO_UPDATE_PINNED=1`
  (each regenerated case then **fails** on purpose), copy the new files from
  `~/vizwork3/test/Visualization_Tests/data/pinned/` back to the worktree, and
  run again without it.

- `-Werror` lint, one directory per run (no `-ea`), in `~/vizwork3`:

  ```bash
  built-distribution/enso-engine-*/enso-*/bin/enso --enable-static-analysis --hide-progress -Werror --compile <dir>
  ```

- API docs: regenerate one library's committed `docs/api` in `~/vizwork3`, then
  copy the library's `docs/api/` folder back to the worktree:

  ```bash
  sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/<Lib>/0.0.0-dev"
  ```

  The local `stdlib-api-check` gives false differences on rsync'd files; CI runs
  it.

- GUI (Windows worktree, after `corepack pnpm install` and
  `corepack pnpm -r compile`):
  `corepack pnpm --filter enso-gui exec vitest run <path>`,
  `corepack pnpm --filter enso-gui run typecheck`,
  `corepack pnpm --filter enso-gui run lint`. Playwright, from `app/gui`:
  `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" <spec>`.
- GUI on Linux (Task 9): sync `viz/tree-gui` into `~/vizwork3` with the same
  `git fetch … refs/heads/viz/tree-gui && git checkout -qf FETCH_HEAD`, then
  `corepack pnpm install --frozen-lockfile && corepack pnpm -r compile` (a
  reused clone has stale `dist`), and run the lint and Playwright commands
  there.
- When PR 2.2 has merged, delete the clone (`rm -rf ~/vizwork3`): agent clones
  have filled the WSL disk before.

---

## PR 2.1 — Enso: `Viz_Tree`, its conversions, `Tree.prepare`/`children`

### Task 1: `Viz_Tree` and the Base conversions

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Tree.enso`
- Create: `test/Visualization_Tests/src/Tree_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso` (register `Tree_Spec`)

**Interfaces:**

- Produces, in module `Standard.Visualization.Viz_Tree`:
  - `type Viz_Tree` with constructors `Leaf (json_text : Text)` and
    `Branch (kind : Text) (size : Integer) (label : Text) (children : Integer -> Integer -> Vector)`
    (`children start count` returns a `Vector Viz_Tree_Child`).
  - Static methods `Viz_Tree.paged kind size label page_of -> Viz_Tree`
    (`page_of start end`, `0 <= start < end <= size`),
    `Viz_Tree.count_text n singular plural -> Text` (`1,234 rows`),
    `Viz_Tree.keys_label n` (`{12 keys}`), `Viz_Tree.items_label n`
    (`[1,234 items]`).
  - Methods `tree.child key -> Viz_Tree_Child ! Illegal_Argument`,
    `tree.without_node_expressions -> Viz_Tree`.
  - `type Viz_Tree_Child` with constructor
    `Value (key : Text | Integer) (tree : Viz_Tree) (node_expression : Text | Nothing)`.
  - Module constant `page_size = 100`.
  - Conversions `Viz_Tree.from` for `Any`, `Nothing`, `Text`, `Number`,
    `Boolean`, `Date`, `Date_Time`, `Time_Of_Day`, `JS_Object`, `Vector`,
    `Array`, `Dictionary`.

- [ ] **Step 1: Write the failing tests.** Create `Tree_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument

import Standard.Visualization.Viz_Tree.Viz_Tree
import Standard.Visualization.Viz_Tree.Viz_Tree_Child

from Standard.Test import all

type Atom
    Value x y

type Bad
    Value

    to_js_object self = Panic.throw "no JSON"

## The keys of one page of `tree`.
keys_of tree start=0 count=100 = tree.children start count . map .key

## The node expressions of one page of `tree`.
exprs_of tree start=0 count=100 = tree.children start count . map .node_expression

## The tree of the child of `tree` with `key`.
child_tree tree key = (tree.child key).tree

add_specs suite_builder =
    suite_builder.group "Viz_Tree of Base values" group_builder->
        group_builder.specify "scalars are leaves holding their JSON" <|
            (Viz_Tree.from 42).json_text . should_equal "42"
            (Viz_Tree.from 1.5).json_text . should_equal "1.5"
            (Viz_Tree.from True).json_text . should_equal "true"
            (Viz_Tree.from Nothing).json_text . should_equal "null"
            (Viz_Tree.from "hi").json_text . should_equal '"hi"'

        group_builder.specify "dates and times are leaves holding their display text" <|
            (Viz_Tree.from (Date.new 2020 1 2)).json_text . should_equal '"2020-01-02"'
            (Viz_Tree.from (Time_Of_Day.new 10 30)).json_text . should_equal (Time_Of_Day.new 10 30).to_display_text.to_json

        group_builder.specify "text over 2000 characters is cut, as Viz_Json cuts it" <|
            long = 0.up_to 2500 . map (_-> "a") . join ""
            expected = (0.up_to 2000 . map (_-> "a") . join "") + "…"
            (Viz_Tree.from long).json_text . should_equal expected.to_json

        group_builder.specify "a JS_Object is an object of its keys, reached with .get" <|
            tree = Viz_Tree.from (Json.parse '{"a":1,"b":[1,2]}')
            tree.kind . should_equal "object"
            tree.size . should_equal 2
            tree.label . should_equal "{2 keys}"
            keys_of tree . should_equal ["a", "b"]
            exprs_of tree . should_equal [".get " + "a".pretty, ".get " + "b".pretty]
            (child_tree tree "b").label . should_equal "[2 items]"
            exprs_of (child_tree tree "b") . should_equal [".at 0", ".at 1"]

        group_builder.specify "a Vector and an Array are arrays of their indices, reached with .at" <|
            tree = Viz_Tree.from [10, 20, 30]
            tree.kind . should_equal "array"
            tree.label . should_equal "[3 items]"
            keys_of tree . should_equal [0, 1, 2]
            exprs_of tree . should_equal [".at 0", ".at 1", ".at 2"]
            (child_tree tree 1).json_text . should_equal "20"
            keys_of (Viz_Tree.from [10, 20].to_array) . should_equal [0, 1]

        group_builder.specify "a Dictionary is an object of its keys, reached with .at" <|
            by_text = Viz_Tree.from (Dictionary.from_vector [["k", 1]])
            by_text.kind . should_equal "object"
            keys_of by_text . should_equal ["k"]
            exprs_of by_text . should_equal [".at " + "k".pretty]
            by_number = Viz_Tree.from (Dictionary.from_vector [[2, "two"]])
            keys_of by_number . should_equal [2]
            exprs_of by_number . should_equal [".at 2"]
            by_date = Viz_Tree.from (Dictionary.from_vector [[Date.new 2020 1 2, 1]])
            keys_of by_date . should_equal ["2020-01-02"]
            exprs_of by_date . should_equal [".at (" + (Date.new 2020 1 2).pretty + ")"]

        group_builder.specify "labels count with a thousands separator and a singular" <|
            (Viz_Tree.from [1]).label . should_equal "[1 item]"
            (Viz_Tree.from (Vector.fill 1234 0)).label . should_equal "[1,234 items]"
            (Viz_Tree.from (Json.parse '{"a":1}')).label . should_equal "{1 key}"

        group_builder.specify "any other value is its to_js_object, with no node expressions at any depth" <|
            tree = Viz_Tree.from (Atom.Value 1 [2, 3])
            tree.kind . should_equal "object"
            keys_of tree . should_equal ["type", "constructor", "x", "y"]
            exprs_of tree . should_equal [Nothing, Nothing, Nothing, Nothing]
            exprs_of (child_tree tree "y") . should_equal [Nothing, Nothing]

        group_builder.specify "a value whose to_js_object panics shows its text and the error" <|
            keys_of (Viz_Tree.from Bad.Value) . should_equal ["value", "_to_js_object_error_"]

        group_builder.specify "an error inside a vector is the error's JSON, with no node expressions" <|
            tree = Viz_Tree.from [1, Error.throw (Illegal_Argument.Error "boom")]
            item = child_tree tree 1
            keys_of item . should_equal ["type", "content", "message"]
            exprs_of item . should_equal [Nothing, Nothing, Nothing]

    suite_builder.group "Viz_Tree paging and keys" group_builder->
        tree = Viz_Tree.from (0.up_to 250 . to_vector)
        group_builder.specify "the first page" <|
            keys_of tree 0 100 . should_equal (0.up_to 100 . to_vector)

        group_builder.specify "the last page is short" <|
            keys_of tree 200 100 . should_equal (200.up_to 250 . to_vector)

        group_builder.specify "a start at or past the end gives no children" <|
            keys_of tree 250 100 . should_equal []
            keys_of tree 300 100 . should_equal []

        group_builder.specify "a negative start or count is an Illegal_Argument" <|
            (tree.children (-1) 10) . should_fail_with Illegal_Argument
            (tree.children 0 (-1)) . should_fail_with Illegal_Argument

        group_builder.specify "child finds an array's child by index and an object's by key" <|
            (child_tree tree 249).json_text . should_equal "249"
            object = Viz_Tree.from (JS_Object.from_pairs (0.up_to 150 . map i-> ["k" + i.to_text, i]))
            (child_tree object "k140").json_text . should_equal "140"

        group_builder.specify "child of a missing key or of a leaf is an Illegal_Argument" <|
            (tree.child 250) . should_fail_with Illegal_Argument
            (tree.child "x") . should_fail_with Illegal_Argument
            ((Viz_Tree.from 1).child 0) . should_fail_with Illegal_Argument

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

In `test/Visualization_Tests/src/Main.enso` add `import project.Tree_Spec` after
`import project.Table_Visualisation_Integration_Spec`, and
`Tree_Spec.add_specs suite_builder` after
`Table_Visualisation_Integration_Spec.add_specs suite_builder`.

- [ ] **Step 2: Run them to see them fail.** Sync and build (Working
      environment), then run `Visualization_Tests` with filter `Viz_Tree`.
      Expected: a compile error, `Standard.Visualization.Viz_Tree` does not
      exist.

- [ ] **Step 3: Create `Viz_Tree.enso`.**

```enso
from Standard.Base import all
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument

import project.Viz_Json.Viz_Json

## ---
   private: true
   ---
   A value as a tree that the JSON visualization loads a page at a time. Base
   values are converted here; a library or a user type describes its own with
   `Viz_Tree.from (that:Its_Type)` in its own module.
type Viz_Tree
    ## ---
       private: true
       ---
       A scalar. `json_text` is its JSON: a number, boolean, `null` or text.
    Leaf (json_text : Text)

    ## ---
       private: true
       ---
       An object (`kind` is `"object"`) or an array (`"array"`).
       - `size`: how many children it has.
       - `label`: the text of its row, such as `{12 keys}` or `[1,234 items]`.
       - `children start count`: its `Viz_Tree_Child`ren from `start`, at most
         `count` of them; none past the end. A child's tree is computed only
         when its page is asked for.
    Branch (kind : Text) (size : Integer) (label : Text) (children : Integer -> Integer -> Vector)

    ## ---
       private: true
       ---
       A branch whose children `page_of start end` reads, for
       `0 <= start < end <= size`. A start at or past the end gives no
       children; a negative start or count is an `Illegal_Argument`.
    paged (kind : Text) (size : Integer) (label : Text) (page_of : Integer -> Integer -> Vector) -> Viz_Tree =
        Viz_Tree.Branch kind size label start-> count->
            if start < 0 || count < 0 then Error.throw (Illegal_Argument.Error "A page's start and count must not be negative.") else
                end = (start + count).min size
                if start >= end then [] else page_of start end

    ## ---
       private: true
       ---
       A count with a thousands separator: `1 row`, `1,234 rows`.
    count_text (n : Integer) (singular : Text) (plural : Text) -> Text =
        (n.format "#,##0" Locale.us) + " " + (if n == 1 then singular else plural)

    ## ---
       private: true
       ---
       The label of an object of `n` keys: `{1 key}`, `{12 keys}`.
    keys_label (n : Integer) -> Text = "{" + (Viz_Tree.count_text n "key" "keys") + "}"

    ## ---
       private: true
       ---
       The label of an array of `n` items: `[1 item]`, `[1,234 items]`.
    items_label (n : Integer) -> Text = "[" + (Viz_Tree.count_text n "item" "items") + "]"

    ## ---
       private: true
       ---
       The child with `key`: an array's by its index, an object's by looking
       through its pages. `Illegal_Argument` if there is none.
    child self (key : Text | Integer) -> Viz_Tree_Child ! Illegal_Argument =
        missing = Illegal_Argument.Error ("No child has the key " + key.pretty + ".")
        case self of
            Viz_Tree.Leaf _ -> Error.throw missing
            Viz_Tree.Branch kind size _ children -> case kind == "array" && (key.is_a Integer) of
                True ->
                    page = if key < 0 then [] else children key 1
                    if page.is_empty then Error.throw missing else page.first
                False -> find_child children size key 0 . if_nothing (Error.throw missing)

    ## ---
       private: true
       ---
       The same tree with no node expressions at any depth, for a value whose
       children come from its JSON: no expression reaches them.
    without_node_expressions self -> Viz_Tree = case self of
        Viz_Tree.Leaf _ -> self
        Viz_Tree.Branch kind size label children ->
            Viz_Tree.Branch kind size label start-> count->
                children start count . map c->
                    Viz_Tree_Child.Value c.key c.tree.without_node_expressions Nothing

## ---
   private: true
   ---
   One child of a `Viz_Tree.Branch`.
type Viz_Tree_Child
    ## ---
       private: true
       ---
       - `key`: its object key or array index.
       - `tree`: its tree.
       - `node_expression`: what a double-click appends to its parent's
         expression to reach it (`.at 3`, `.get 'name'`, `.name`), or
         `Nothing` when no expression reaches it.
    Value (key : Text | Integer) (tree : Viz_Tree) (node_expression : Text | Nothing)

## ---
   private: true
   ---
   How many children one page of the JSON visualization holds.
page_size = 100

## ---
   private: true
   ---
   Any value: the tree of its `to_js_object`, with no node expressions. If
   `to_js_object` fails, its display text and the error.
Viz_Tree.from (that:Any) =
    js = Panic.recover Any that.to_js_object . catch Any err->
        JS_Object.from_pairs [["value", that.to_display_text], ["_to_js_object_error_", err.to_display_text]]
    tree = case js of
        _ : JS_Object -> Viz_Tree.from js
        _ : Vector -> Viz_Tree.from js
        _ : Text -> Viz_Tree.from js
        _ : Number -> Viz_Tree.from js
        _ : Boolean -> Viz_Tree.from js
        Nothing -> Viz_Tree.Leaf "null"
        _ -> Viz_Tree.Leaf that.to_display_text.to_json
    tree.without_node_expressions

## ---
   private: true
   ---
Viz_Tree.from (that:Nothing) =
    _ = that
    Viz_Tree.Leaf "null"

## ---
   private: true
   ---
   Text over 2000 characters is cut, plus `…`, as `Viz_Json` cuts it.
Viz_Tree.from (that:Text) = Viz_Tree.Leaf (Viz_Json.from that).json_text

## ---
   private: true
   ---
Viz_Tree.from (that:Number) = Viz_Tree.Leaf that.to_json

## ---
   private: true
   ---
Viz_Tree.from (that:Boolean) = Viz_Tree.Leaf that.to_json

## ---
   private: true
   ---
   A date is a leaf of its display text.
Viz_Tree.from (that:Date) = Viz_Tree.Leaf that.to_display_text.to_json

## ---
   private: true
   ---
   A date-time is a leaf of its display text.
Viz_Tree.from (that:Date_Time) = Viz_Tree.Leaf that.to_display_text.to_json

## ---
   private: true
   ---
   A time of day is a leaf of its display text.
Viz_Tree.from (that:Time_Of_Day) = Viz_Tree.Leaf that.to_display_text.to_json

## ---
   private: true
   ---
   Its keys, each reached with `.get key`.
Viz_Tree.from (that:JS_Object) =
    names = that.field_names
    Viz_Tree.paged "object" names.length (Viz_Tree.keys_label names.length) start-> end->
        names.slice start end . map name->
            Viz_Tree_Child.Value name (Viz_Tree.from (that.get name)) (".get " + name.pretty)

## ---
   private: true
   ---
   Its indices, each reached with `.at index`. An error item is its JSON.
Viz_Tree.from (that:Vector) =
    Viz_Tree.paged "array" that.length (Viz_Tree.items_label that.length) start-> end->
        that.slice start end . map_with_index i-> item->
            index = start + i
            Viz_Tree_Child.Value index (element_tree item) (".at " + index.to_text)

## ---
   private: true
   ---
Viz_Tree.from (that:Array) = Viz_Tree.from (Vector.from_polyglot_array that)

## ---
   private: true
   ---
   Its keys, each reached with `.at key`. A key that is neither text nor an
   integer shows as its display text.
Viz_Tree.from (that:Dictionary) =
    pairs = that.to_vector
    Viz_Tree.paged "object" pairs.length (Viz_Tree.keys_label pairs.length) start-> end->
        pairs.slice start end . map pair->
            key = pair.at 0
            Viz_Tree_Child.Value (shown_key key) (Viz_Tree.from (pair.at 1)) (".at " + (key_argument key))

## The first child with `key` in the pages from `start` on, or `Nothing`.
private find_child children size key start =
    if start >= size then Nothing else
        found = children start page_size . find (c-> c.key == key) if_missing=Nothing
        if found.is_nothing.not then found else
            @Tail_Call find_child children size key (start + page_size)

## A vector's item: a dataflow error shows as its JSON.
private element_tree item =
    if item.is_error then (Viz_Tree.from item.to_js_object).without_node_expressions else Viz_Tree.from item

## A dictionary key as a child's key.
private shown_key key = if key.is_a Text || key.is_a Integer then key else key.to_display_text

## A dictionary key as the argument of `.at`.
private key_argument key = if key.is_a Text || key.is_a Number then key.pretty else "(" + key.pretty + ")"
```

- [ ] **Step 4: Run the tests.** Sync, build, run `Visualization_Tests` with
      filter `Viz_Tree`. Expected: both groups pass (16 tests; check the count).
      If `Locale` is reported unresolved, add
      `import Standard.Base.Data.Locale.Locale` to the imports.

- [ ] **Step 5: Lint.** Run the `-Werror` lint on
      `distribution/lib/Standard/Visualization/0.0.0-dev` and
      `test/Visualization_Tests`. Expected: no warnings.

- [ ] **Step 6: Commit.**

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: Viz_Tree, a value as a tree read a page at a time"
```

### Task 2: `Tree.prepare` and `Tree.children`, with goldens

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Tree.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Main.enso`
  (`export project.Tree`)
- Modify: `test/Visualization_Tests/src/Tree_Spec.enso`,
  `test/Visualization_Tests/src/Pinned_Spec.enso`
- Create (generated):
  `test/Visualization_Tests/data/pinned/tree_prepare_js_object.json`,
  `tree_children_js_object_address.json`, `tree_prepare_vector_deep.json`,
  `tree_children_vector_deep_bottom.json`, `tree_children_vector_page.json`,
  `tree_prepare_atom.json`, `tree_children_atom.json`,
  `tree_prepare_error.json`, `tree_children_missing.json`

**Interfaces:**

- Consumes: everything Task 1 produces.
- Produces, in module `Standard.Visualization.Tree`: `prepare value -> Text` and
  `children value (path : Vector) (start : Integer) (count : Integer) -> Text`,
  both in the wire format above.

- [ ] **Step 1: Write the failing tests.** In `Tree_Spec.enso` add
      `import Standard.Visualization.Tree` to the imports, this type and
      conversion after `type Bad`:

```enso
type Person
    Value name age

## A user type describes its own tree in its own module.
Viz_Tree.from (that:Person) =
    fields = [Viz_Tree_Child.Value "name" (Viz_Tree.from that.name) ".name", Viz_Tree_Child.Value "age" (Viz_Tree.from that.age) ".age"]
    Viz_Tree.paged "object" fields.length ("Person " + that.name) start-> end-> fields.slice start end
```

and this group at the end of `add_specs`:

```enso
    suite_builder.group "Tree.prepare and Tree.children" group_builder->
        value = Json.parse '{"name":"John","tags":["a","b"],"address":{"city":"Leeds"}}'
        keys_in json = json.get "entries" . map (e-> e.get "key")
        values_in json = json.get "entries" . map (e-> e.get "value")

        group_builder.specify "prepare sends the root and its first page" <|
            json = Json.parse (Tree.prepare value)
            json.get "root" . get "kind" . should_equal "object"
            json.get "root" . get "label" . should_equal "{3 keys}"
            keys_in (json.get "children") . should_equal ["name", "tags", "address"]

        group_builder.specify "prepare of a scalar is a leaf with no children" <|
            json = Json.parse (Tree.prepare 42)
            json.get "root" . get "value" . should_equal 42
            json.contains_key "children" . should_be_false

        group_builder.specify "prepare sends at most one page" <|
            json = Json.parse (Tree.prepare (0.up_to 1000 . to_vector))
            json.get "root" . get "size" . should_equal 1000
            (json.get "children" . get "entries").length . should_equal 100

        group_builder.specify "children walks a path of keys and indices" <|
            page = Json.parse (Tree.children value ["tags"] 1 100)
            page.get "start" . should_equal 1
            page.get "size" . should_equal 2
            values_in page . should_equal ["b"]
            values_in (Json.parse (Tree.children [[1, [2, 3]]] [0, 1] 0 100)) . should_equal [2, 3]

        group_builder.specify "children walks through a Dictionary" <|
            values_in (Json.parse (Tree.children (Dictionary.from_vector [["k", [7, 8]]]) ["k"] 0 100)) . should_equal [7, 8]

        group_builder.specify "a start past the end is an empty page" <|
            page = Json.parse (Tree.children value ["tags"] 5 100)
            page.get "entries" . should_equal []

        group_builder.specify "a missing key, a leaf, or a negative start is an error message" <|
            (Json.parse (Tree.children value ["nope"] 0 100)).get "error" . should_contain "nope"
            (Json.parse (Tree.children value ["name"] 0 100)).get "error" . should_contain "leaf"
            (Json.parse (Tree.children value ["name", 0] 0 100)).get "error" . should_contain "0"
            (Json.parse (Tree.children value ["tags"] (-1) 100)).get "error" . should_contain "negative"

        group_builder.specify "a dataflow error shows its payload" <|
            json = Json.parse (Tree.prepare (Error.throw (Illegal_Argument.Error "boom")))
            keys_in (json.get "children") . should_contain "message"

        group_builder.specify "a user type's own conversion picks its children, label and node expressions" <|
            tree = Viz_Tree.from (Person.Value "Ann" 41)
            tree.label . should_equal "Person Ann"
            keys_of tree . should_equal ["name", "age"]
            exprs_of tree . should_equal [".name", ".age"]
            page = Json.parse (Tree.children [Person.Value "Ann" 41] [0] 0 100)
            page.get "entries" . map (e-> e.get "expr") . should_equal [".name", ".age"]
```

In `Pinned_Spec.enso` add `import Standard.Visualization.Tree` to the imports
and, after the "Pinned default preprocessor JSON" group:

```enso
    suite_builder.group "Pinned tree JSON" group_builder->
        tree_prepare name ~value =
            group_builder.specify ("prepare " + name) <|
                expect_pinned ("tree_prepare_" + name) (Tree.prepare value)
        tree_children name ~value path start count =
            group_builder.specify ("children " + name) <|
                expect_pinned ("tree_children_" + name) (Tree.children value path start count)
        js = Json.parse '{"name":"John","tags":["a","b"],"address":{"city":"Leeds"}}'
        ## Eight levels of nesting, then 150 items.
        deep = [[[[[[[[[1]]]]]]]], (0.up_to 150 . to_vector)]
        tree_prepare "js_object" js
        tree_children "js_object_address" js ["address"] 0 100
        tree_prepare "vector_deep" deep
        ## Eight steps in: the innermost `[1]`.
        tree_children "vector_deep_bottom" deep [0, 0, 0, 0, 0, 0, 0, 0] 0 100
        tree_children "vector_page" deep [1] 100 100
        tree_prepare "atom" (Atom.Value 1 [2, 3])
        tree_children "atom" (Atom.Value 1 [2, 3]) ["y"] 0 100
        tree_prepare "error" (Error.throw (Illegal_Argument.Error "boom"))
        tree_children "missing" js ["nope"] 0 100
```

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` with filter `Tree.prepare`. Expected: a compile
      error, `Standard.Visualization.Tree` does not exist.

- [ ] **Step 3: Create `Tree.enso`.**

```enso
from Standard.Base import all
import Standard.Base.Errors.Illegal_Argument.Illegal_Argument

import project.Helpers
from project.Helpers import time_visualization, short_display
from project.Viz_Tree import page_size, Viz_Tree, Viz_Tree_Child

## ---
   private: true
   ---
   IDE entry of the JSON visualization: the root of the value's tree and the
   first page of its children, as JSON text (the format is in this library's
   CLAUDE.md). A dataflow error shows its payload.
prepare value = time_visualization Tree ("Tree.prepare: " + (short_display value)) <|
    tree = Viz_Tree.from (if value.is_error then value.catch else value)
    json = case tree of
        Viz_Tree.Leaf json_text -> '{"root":' + (leaf_json json_text) + '}'
        Viz_Tree.Branch _ _ _ _ -> '{"root":' + (branch_json tree) + ',"children":' + (page_json tree 0 page_size) + '}'
    if json.is_error.not then json else
        '{"root":' + (leaf_json (Helpers.truncate value.to_display_text . to_json)) + '}'

## ---
   private: true
   ---
   IDE entry of the JSON visualization: one page of the children of the
   branch that `path` (keys and indices from the root) leads to, as JSON
   text. A missing key, a leaf or a failed page gives `{"error": message}`.
children value (path : Vector) (start : Integer) (count : Integer) = time_visualization Tree ("Tree.children: " + (short_display value)) <|
    root = Viz_Tree.from (if value.is_error then value.catch else value)
    tree = path.fold root (t-> key-> (t.child key).tree)
    page_json tree start count . catch Any err->
        JS_Object.from_pairs [["error", err.to_display_text]] . to_json

## A page: `{"start":…,"size":…,"entries":[…]}`.
private page_json (tree : Viz_Tree) (start : Integer) (count : Integer) -> Text = case tree of
    Viz_Tree.Leaf _ -> Error.throw (Illegal_Argument.Error "A leaf has no children.")
    Viz_Tree.Branch _ size _ children ->
        entries = children start count . map entry_json
        '{"start":' + start.to_text + ',"size":' + size.to_text + ',"entries":[' + (entries.join ",") + ']}'

## A child: its key, its node's fields and its node expression.
private entry_json (child : Viz_Tree_Child) -> Text =
    node = case child.tree of
        Viz_Tree.Leaf json_text -> '"kind":"leaf","value":' + json_text
        Viz_Tree.Branch kind size label _ -> '"kind":' + kind.to_json + ',"size":' + size.to_text + ',"label":' + label.to_json
    '{"key":' + child.key.to_json + ',' + node + ',"expr":' + child.node_expression.to_json + '}'

## A leaf node.
private leaf_json (json_text : Text) -> Text = '{"kind":"leaf","value":' + json_text + '}'

## A branch node.
private branch_json (tree : Viz_Tree) -> Text =
    '{"kind":' + tree.kind.to_json + ',"size":' + tree.size.to_text + ',"label":' + tree.label.to_json + '}'
```

In `Main.enso` add `export project.Tree` after
`export project.Table.Visualization` (the GUI calls
`Standard.Visualization.Tree.children` inside the node's frame, as it calls
`Standard.Visualization.Table.Visualization.get_rows_for_table`, which is
exported the same way).

- [ ] **Step 4: Run the tests.** Sync, build, run `Visualization_Tests` with
      filter `Tree.prepare`. Expected: the group passes (9 tests).

- [ ] **Step 5: Generate the goldens.** Run `Visualization_Tests` with
      `ENSO_UPDATE_PINNED=1` and filter `Pinned tree` (each case fails on
      purpose), copy the nine `tree_*.json` files back, and run again without
      it. Expected: all pass. Check by eye:
  - `tree_prepare_js_object.json` is exactly the example in "Wire format".
  - `tree_children_vector_deep_bottom.json` is
    `{"start":0,"size":1,"entries":[{"key":0,"kind":"leaf","value":1,"expr":".at 0"}]}`.
  - `tree_children_vector_page.json` has `"start":100,"size":150` and 50
    entries, keys 100 to 149.
  - `tree_prepare_vector_deep.json` has no `[...]` anywhere.
  - `tree_prepare_atom.json` and `tree_children_atom.json` have only
    `"expr":null`.
  - `tree_children_missing.json` is `{"error":"…nope…"}`.

- [ ] **Step 6: Lint and commit.** Run the `-Werror` lint on Visualization and
      `test/Visualization_Tests` (expected: no warnings), then:

```bash
git add distribution/lib/Standard/Visualization test/Visualization_Tests
git commit -m "Visualization: Tree.prepare and Tree.children, the JSON view's entry points"
```

### Task 3: Table, Column, Row and XML conversions

**Files:**

- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso` (imports;
  conversion after `Viz_Json.from (that:Table)`)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Column.enso` (imports;
  after `Viz_Json.from (that:Column)`)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Row.enso` (imports;
  after `Viz_Json.from (that:Row)`)
- Modify: `distribution/lib/Standard/XML/0.0.0-dev/src/XML.enso` (import; after
  `Viz_Json.from (that:XML_Element)`)
- Modify: `test/Visualization_Tests/src/Tree_Spec.enso`,
  `test/Visualization_Tests/src/Pinned_Spec.enso`
- Create (generated):
  `test/Visualization_Tests/data/pinned/tree_prepare_mem_table.json`,
  `tree_children_mem_table_rows.json`

**Interfaces:**

- Consumes: `Viz_Tree.paged`, `Viz_Tree.count_text`, `Viz_Tree_Child.Value`
  (Task 1); `Tree.prepare`, `Tree.children` (Task 2).
- Produces: `Viz_Tree.from` for `Table` (an object `row_count`, `columns`,
  `rows`), `Column` (an array of its values), `Row` (an object of its column
  names), `XML_Document` (an object of its root element), `XML_Element` (an
  object of `@attribute` keys and child indices).

- [ ] **Step 1: Write the failing tests.** In `Tree_Spec.enso` add to the
      imports:

```enso
from Standard.Table import Table
import Standard.Database.Connection.Database
import Standard.Database.Extensions.Upload_Table
from Standard.SQLite import SQLite
from Standard.XML import XML_Document
```

and this group at the end of `add_specs`:

```enso
    suite_builder.group "Viz_Tree of Table, Column, Row and XML" group_builder->
        table = Table.new [["x", [1, 2, 3]], ["label", ["a", "b", "c"]]]

        group_builder.specify "a Table is a summary of its row count, columns and rows" <|
            tree = Viz_Tree.from table
            tree.label . should_equal "Table (3 rows, 2 columns)"
            keys_of tree . should_equal ["row_count", "columns", "rows"]
            exprs_of tree . should_equal [".row_count", ".columns", ".rows"]
            (child_tree tree "row_count").json_text . should_equal "3"
            (child_tree tree "columns").label . should_equal "[2 columns]"
            exprs_of (child_tree tree "columns") . should_equal [".at 0", ".at 1"]

        group_builder.specify "a Table's rows are read a page at a time" <|
            rows = child_tree (Viz_Tree.from table) "rows"
            rows.label . should_equal "[3 rows]"
            page = rows.children 1 100
            page.map .key . should_equal [1, 2]
            page.map .node_expression . should_equal [".at 1", ".at 2"]
            row = page.first.tree
            row.label . should_equal "Row (2 values)"
            keys_of row . should_equal ["x", "label"]
            exprs_of row . should_equal [".at " + "x".pretty, ".at " + "label".pretty]
            (child_tree row "x").json_text . should_equal "2"

        group_builder.specify "a Column is an array of its values" <|
            tree = Viz_Tree.from (table.at "label")
            tree.label . should_equal 'Column "label" (3 rows)'
            keys_of tree 1 100 . should_equal [1, 2]
            exprs_of tree 1 100 . should_equal [".at 1", ".at 2"]
            (child_tree tree 2).json_text . should_equal '"c"'

        group_builder.specify "a database table reads only the page of rows asked for, and has no .rows expression" <|
            connection = Database.connect SQLite.In_Memory
            db_table = table.select_into_database_table connection "tree_rows" temporary=True
            tree = Viz_Tree.from db_table
            tree.label . should_equal "Table (3 rows, 2 columns)"
            exprs_of tree . should_equal [".row_count", ".columns", Nothing]
            keys_of (child_tree tree "rows") 2 100 . should_equal [2]
            keys_of (child_tree (child_tree tree "columns") 0) . should_equal [0, 1, 2]
            connection.close

        group_builder.specify "children walks into a Table's rows" <|
            page = Json.parse (Tree.children table ["rows", 0] 0 100)
            page.get "entries" . map (e-> e.get "value") . should_equal [1, "a"]

        group_builder.specify "an XML document is its root element; an element is its attributes and children" <|
            doc = XML_Document.parse '<foo id="10"><bar>hello</bar>text</foo>'
            tree = Viz_Tree.from doc
            tree.label . should_equal "XML_Document (<foo>)"
            keys_of tree . should_equal ["foo"]
            exprs_of tree . should_equal [".root_element"]
            root = child_tree tree "foo"
            root.label . should_equal "<foo> (1 attribute, 2 children)"
            keys_of root . should_equal ["@id", 0, 1]
            exprs_of root . should_equal [".at " + "@id".pretty, ".at 0", ".at 1"]
            (child_tree root "@id").json_text . should_equal '"10"'
            (child_tree root 1).json_text . should_equal '"text"'
            keys_of root 1 100 . should_equal [0, 1]
            keys_of root 2 1 . should_equal [1]
            (child_tree root 0).label . should_equal "<bar> (0 attributes, 1 child)"
```

In `Pinned_Spec.enso`, in the "Pinned tree JSON" group, add:

```enso
        tree_prepare "mem_table" data.mem_table
        tree_children "mem_table_rows" data.mem_table ["rows"] 0 100
```

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` with filter `Viz_Tree of Table`. Expected: failures:
      a Table, Column and Row go through the `Any` conversion (keys from
      `to_js_object`, labels differ).

- [ ] **Step 3: Table.** In `Table.enso` add after
      `import Standard.Visualization.Viz_Table.Viz_Table`:

```enso
import Standard.Visualization.Viz_Tree.Viz_Tree
import Standard.Visualization.Viz_Tree.Viz_Tree_Child
```

and after the `Viz_Json.from (that:Table)` conversion:

```enso
## ---
   private: true
   ---
   A summary for the JSON visualization: the row count, the columns and the
   rows. Rows are read a page at a time from the table itself, so a database
   table reads only that page; its `rows` have no node expression, since
   `.rows` would read the whole table.
Viz_Tree.from (that:Table) =
    row_count = that.row_count
    columns = that.columns
    rows_text = Viz_Tree.count_text row_count "row" "rows"
    columns_text = Viz_Tree.count_text columns.length "column" "columns"
    columns_tree = Viz_Tree.paged "array" columns.length ("[" + columns_text + "]") start-> end->
        columns.slice start end . map_with_index i-> column->
            index = start + i
            Viz_Tree_Child.Value index (Viz_Tree.from column) (".at " + index.to_text)
    rows_tree = Viz_Tree.paged "array" row_count ("[" + rows_text + "]") start-> end->
        (that.take (start.up_to end)).rows.to_vector.map_with_index i-> row->
            index = start + i
            Viz_Tree_Child.Value index (Viz_Tree.from row) (".at " + index.to_text)
    rows_expression = if that.is_a In_Memory_Table then ".rows" else Nothing
    summary = [Viz_Tree_Child.Value "row_count" (Viz_Tree.from row_count) ".row_count", Viz_Tree_Child.Value "columns" columns_tree ".columns", Viz_Tree_Child.Value "rows" rows_tree rows_expression]
    Viz_Tree.paged "object" summary.length ("Table (" + rows_text + ", " + columns_text + ")") start-> end->
        summary.slice start end
```

- [ ] **Step 4: Column and Row.** In `Column.enso` and `Row.enso` add the same
      two imports after `import Standard.Visualization.Viz_Table.Viz_Table`. In
      `Column.enso`, after `Viz_Json.from (that:Column)`:

```enso
## ---
   private: true
   ---
   The column's values for the JSON visualization, read a page at a time (a
   database column reads only that page), each reached with `.at index`.
Viz_Tree.from (that:Column) =
    size = that.row_count
    label = "Column " + that.name.to_json + " (" + (Viz_Tree.count_text size "row" "rows") + ")"
    Viz_Tree.paged "array" size label start-> end->
        (that.take (start.up_to end)).to_vector.map_with_index i-> value->
            index = start + i
            Viz_Tree_Child.Value index (Viz_Tree.from value) (".at " + index.to_text)
```

In `Row.enso`, after `Viz_Json.from (that:Row)`:

```enso
## ---
   private: true
   ---
   The row's values by column name, each reached with `.at name`.
Viz_Tree.from (that:Row) =
    names = that.column_names
    label = "Row (" + (Viz_Tree.count_text names.length "value" "values") + ")"
    Viz_Tree.paged "object" names.length label start-> end->
        names.slice start end . map name->
            Viz_Tree_Child.Value name (Viz_Tree.from (that.get name)) (".at " + name.pretty)
```

- [ ] **Step 5: XML.** In `XML.enso` add
      `from Standard.Visualization.Viz_Tree import Viz_Tree, Viz_Tree_Child`
      after the `Viz_Table` import, and after
      `Viz_Json.from (that:XML_Element)`:

```enso
## ---
   private: true
   ---
   A document is an object of its root element, reached with `.root_element`.
Viz_Tree.from (that:XML_Document) =
    root = that.root_element
    entry = Viz_Tree_Child.Value root.name (Viz_Tree.from root) ".root_element"
    Viz_Tree.paged "object" 1 ("XML_Document (<" + root.name + ">)") start-> end->
        [entry].slice start end

## ---
   private: true
   ---
   An element is an object of its attributes (`@name`) and then its children
   (by index), each reached with `.at`.
Viz_Tree.from (that:XML_Element) =
    attributes = that.attribute_names.map name->
        Viz_Tree_Child.Value ("@" + name) (Viz_Tree.from (that.attribute name)) (".at " + ("@" + name).pretty)
    nodes = that.children
    size = attributes.length + nodes.length
    label = "<" + that.name + "> (" + (Viz_Tree.count_text attributes.length "attribute" "attributes") + ", " + (Viz_Tree.count_text nodes.length "child" "children") + ")"
    page_of start end =
        from_attributes = attributes.slice (start.min attributes.length) (end.min attributes.length)
        first_node = (start - attributes.length).max 0
        last_node = end - attributes.length
        from_nodes = if last_node <= first_node then [] else
            nodes.slice first_node last_node . map_with_index i-> node->
                index = first_node + i
                Viz_Tree_Child.Value index (Viz_Tree.from node) (".at " + index.to_text)
        from_attributes + from_nodes
    Viz_Tree.paged "object" size label page_of
```

- [ ] **Step 6: Run the tests and generate the table goldens.** Sync, build, run
      `Visualization_Tests` with filter `Viz_Tree of Table` (expected: 6 pass).
      Then run with `ENSO_UPDATE_PINNED=1` and filter `mem_table` (only the two
      new `tree_*` cases are regenerated; any other `mem_table` case that fails
      means an existing golden changed: stop and investigate), copy
      `tree_prepare_mem_table.json` and `tree_children_mem_table_rows.json`
      back, and run again without it. Check by eye: the root label is
      `Table (3 rows, 4 columns)`; the rows page has keys 0–2, each
      `"kind":"object"`, `"label":"Row (4 values)"`, `"expr":".at <i>"`.

- [ ] **Step 7: Lint and commit.** Run the `-Werror` lint on Table, XML and
      `test/Visualization_Tests` (expected: no warnings), then:

```bash
git add distribution/lib/Standard/Table distribution/lib/Standard/XML test/Visualization_Tests
git commit -m "Table, XML: Viz_Tree conversions for the JSON view's tree"
```

### Task 4: Docs, full runs and PR 2.1

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`
- Modify: each library `CLAUDE.md` that mentions `Viz_Json` (find them in
  Step 1)
- Regenerate: `docs/api` of Visualization, Table, XML

- [ ] **Step 1: CLAUDE.md.** In `Visualization/0.0.0-dev/CLAUDE.md`, under "Main
      entry points" add:

```markdown
- `Tree.prepare value` and `Tree.children value path start count` — IDE entries
  of the JSON visualization: the root of `Viz_Tree.from value` with its first
  page of 100 children, and one page of the branch that `path` (keys and
  indices) leads to. Both return JSON text:
  - a node is `{"kind":"leaf","value":…}` or
    `{"kind":"object"|"array","size":…,"label":…}`; an entry is
    `{"key":…,<node fields>,"expr":<node expression or null>}`;
  - a page is `{"start":…,"size":…,"entries":[…]}`; `prepare` returns
    `{"root":…}` or `{"root":…,"children":<page>}`; `children` returns a page or
    `{"error":…}`. The goldens `test/Visualization_Tests/data/pinned/tree_*` pin
    it.
```

under "Layout" add `- \`src/Tree.enso\` — the JSON visualization's entry points
over \`Viz_Tree\`.`, and under "Data types", after `Viz_Json`:

```markdown
- `Viz_Tree` (`src/Viz_Tree.enso`) - a value as the JSON visualization's lazy
  tree: a `Leaf` (scalar JSON) or a `Branch` (kind, size, label and
  `children start count`, one page of `Viz_Tree_Child` with key, tree and node
  expression). Build branches with `Viz_Tree.paged`. Base values convert here
  (any value: its `to_js_object`, with no node expressions); a library or a user
  type describes its own with `Viz_Tree.from (that:Its_Public_Type)` (Table: row
  count, columns and rows read a page at a time; Column, Row; XML: attributes
  and children).
```

Then run
`git grep -n "Viz_Json" -- 'distribution/lib/Standard/*/0.0.0-dev/CLAUDE.md'`
and, in each other library's `CLAUDE.md` listed, add `Viz_Tree` beside each
`Viz_Json` conversion it names (one clause: "and `Viz_Tree` (the JSON view's
tree)").

- [ ] **Step 2: API docs.** Regenerate `docs/api` for Visualization, Table and
      XML and copy them back. Check the diff: `Viz_Tree.md` and `Tree.md`
      appear; `Main.md` gains the `Tree` export; `Table.md`, `Column.md`,
      `Row.md`, `XML.md` gain one `Viz_Tree.from` each; nothing else changes.

- [ ] **Step 3: Full runs.** Sync, build, run `Visualization_Tests` and
      `XML_Tests` without a filter (Table's and XML's new conversions are
      exercised by `Tree_Spec`, which imports both). Expected: all pass, and
      `git status` shows no change to any existing `data_*`, `default_*`,
      `table_*`, `ssrm_*`, `scatter_*`, `geo_*` or `sql_*` golden.

- [ ] **Step 4: Commit, push, open PR 2.1.**

```bash
git add -A distribution/lib/Standard
git commit -m "Visualization: document Viz_Tree and the tree's wire format"
git push -u origin viz/viz-tree
gh pr create --base develop --title "Visualization: Viz_Tree and the tree entry points (piece 2, Enso)" --label "CI: No changelog needed" --body-file pr-body.md
```

Write `pr-body.md` in your scratch folder first (not in the worktree). The body
links the spec and this plan, summarises Tasks 1–3, repeats the wire format
example, and says that the GUI (PR 2.2) uses it. It ends with the attribution
line. PR 2.1 merges on green.

---

## PR 2.2 — GUI: the tree replaces the JSON visualisation's rendering

All paths below are under
`app/gui/src/project-view/components/visualizations/JSONVisualization/` unless
they start with `app/`.

### Task 5: Wire types and expressions

**Files:**

- Create: `treeWire.ts`, `treeExpression.ts`
- Test: `__tests__/treeWire.test.ts`, `__tests__/treeExpression.test.ts`

**Interfaces:**

- Produces (`treeWire.ts`): types `TreeKey`, `TreeNode`, `TreeEntry`,
  `TreePage`, `Prepared`, `PageResult`; functions
  `parsePrepared(data: unknown): Prepared | undefined` and
  `parsePageResult(data: unknown): PageResult`.
- Produces (`treeExpression.ts`): `TREE_MODULE`,
  `childrenExpression(path, start, count): (nodeId: string) => Ast.Owned<Ast.MutableOprApp>`,
  `isNodeExpression(expr: string): boolean`,
  `nodeExpressionPattern(chain: readonly string[]): Pattern | undefined`.

- [ ] **Step 1: Write the failing tests.** `__tests__/treeWire.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parsePageResult, parsePrepared } from "../treeWire";

describe("parsePrepared", () => {
  test("reads a branch root with its first page", () => {
    const data = {
      root: { kind: "object", size: 1, label: "{1 key}" },
      children: {
        start: 0,
        size: 1,
        entries: [{ key: "a", kind: "leaf", value: 1, expr: ".get 'a'" }],
      },
    };
    expect(parsePrepared(data)).toEqual(data);
  });

  test("reads a leaf root", () => {
    expect(parsePrepared({ root: { kind: "leaf", value: null } })).toEqual({
      root: { kind: "leaf", value: null },
    });
  });

  test("rejects anything else", () => {
    expect(parsePrepared({ axis: {} })).toBeUndefined();
    expect(
      parsePrepared({ root: { kind: "object", size: 1, label: "{1 key}" } }),
    ).toBeUndefined();
    expect(parsePrepared("text")).toBeUndefined();
  });
});

describe("parsePageResult", () => {
  test("reads a page", () => {
    const page = {
      start: 100,
      size: 250,
      entries: [
        { key: 100, kind: "array", size: 2, label: "[2 items]", expr: null },
      ],
    };
    expect(parsePageResult(page)).toEqual({ ok: true, page });
  });

  test("reads an error", () => {
    expect(parsePageResult({ error: "No child has the key x." })).toEqual({
      ok: false,
      message: "No child has the key x.",
    });
  });

  test("reports unexpected data", () => {
    expect(parsePageResult(42)).toEqual({
      ok: false,
      message: "unexpected data",
    });
  });
});
```

`__tests__/treeExpression.test.ts`:

```ts
import { Ast } from "@/util/ast";
import { expect, test } from "vitest";
import {
  childrenExpression,
  isNodeExpression,
  nodeExpressionPattern,
  TREE_MODULE,
} from "../treeExpression";

test("childrenExpression calls Tree.children on the node with a path, start and count", () => {
  const ast = childrenExpression(["a", 3], 100, 50)("node1");
  const { func, args } = Ast.analyzeAppLike(ast);
  expect(func.code()).toBe(`${TREE_MODULE}.children`);
  expect(args.map((arg) => arg.code().replace(/\s/g, ""))).toEqual([
    "node1",
    "['a',3]",
    "100",
    "50",
  ]);
});

test("childrenExpression of the root passes an empty path", () => {
  const { args } = Ast.analyzeAppLike(childrenExpression([], 0, 100)("node1"));
  expect(args[1]!.code().replace(/\s/g, "")).toBe("[]");
});

test("isNodeExpression accepts a method call and nothing else", () => {
  expect(isNodeExpression(".at 3")).toBe(true);
  expect(isNodeExpression(".get 'name'")).toBe(true);
  expect(isNodeExpression(".name")).toBe(true);
  expect(isNodeExpression("at 3")).toBe(false);
  expect(isNodeExpression(". at 3")).toBe(false);
  expect(isNodeExpression("")).toBe(false);
});

test("nodeExpressionPattern chains steps with the spaced dot", () => {
  const pattern = nodeExpressionPattern([".get 'tags'", ".at 3", ".name"]);
  const source = Ast.parseExpression("data")!;
  expect(pattern?.instantiateCopied([source]).code()).toBe(
    "data.get 'tags' . at 3 . name",
  );
});

test("nodeExpressionPattern of one step", () => {
  const pattern = nodeExpressionPattern([".at 0"]);
  expect(
    pattern?.instantiateCopied([Ast.parseExpression("data")!]).code(),
  ).toBe("data.at 0");
});

test("nodeExpressionPattern refuses an empty chain, a bad step or invalid code", () => {
  expect(nodeExpressionPattern([])).toBeUndefined();
  expect(nodeExpressionPattern(["at 3"])).toBeUndefined();
  expect(nodeExpressionPattern([".at ("])).toBeUndefined();
});
```

- [ ] **Step 2: Run them to see them fail.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/JSONVisualization`.
      Expected: both files fail to import (`treeWire`, `treeExpression` do not
      exist).

- [ ] **Step 3: Create `treeWire.ts`.**

```ts
/**
 * @file The JSON of `Standard.Visualization.Tree`'s `prepare` and `children`. The format is
 * described in `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md` and pinned by the
 * `tree_*` goldens in `test/Visualization_Tests/data/pinned/`.
 */
import * as z from "zod";

const TreeKey = z.union([z.string(), z.number().int()]);
/** An object key or an array index. */
export type TreeKey = z.infer<typeof TreeKey>;

const LeafNode = z.object({ kind: z.literal("leaf"), value: z.unknown() });
const BranchNode = z.object({
  kind: z.enum(["object", "array"]),
  size: z.number().int().nonnegative(),
  label: z.string(),
});
const TreeNode = z.discriminatedUnion("kind", [LeafNode, BranchNode]);
/** A leaf (its JSON value) or a branch (its kind, size and label). */
export type TreeNode = z.infer<typeof TreeNode>;

const entryFields = { key: TreeKey, expr: z.string().nullable() };
const TreeEntry = z.discriminatedUnion("kind", [
  LeafNode.extend(entryFields),
  BranchNode.extend(entryFields),
]);
/** A child: its key, its node, and the node expression that reaches it from its parent. */
export type TreeEntry = z.infer<typeof TreeEntry>;

const TreePage = z.object({
  start: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  entries: z.array(TreeEntry),
});
/** The children of a branch from `start`; `size` is the branch's whole size. */
export type TreePage = z.infer<typeof TreePage>;

const Prepared = z.union([
  z.object({ root: BranchNode, children: TreePage }),
  z.object({ root: LeafNode }),
]);
/** What `Tree.prepare` sends: the root, and the first page when it is a branch. */
export type Prepared = z.infer<typeof Prepared>;

/** A page, or why it could not be loaded. */
export type PageResult =
  { ok: true; page: TreePage } | { ok: false; message: string };

/** Read the visualization's data, or `undefined` when it is not `Tree.prepare`'s JSON. */
export function parsePrepared(data: unknown): Prepared | undefined {
  const parsed = Prepared.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/** Read `Tree.children`'s JSON. */
export function parsePageResult(data: unknown): PageResult {
  const page = TreePage.safeParse(data);
  if (page.success) return { ok: true, page: page.data };
  const error = z.object({ error: z.string() }).safeParse(data);
  return {
    ok: false,
    message: error.success ? error.data.error : "unexpected data",
  };
}
```

- [ ] **Step 4: Create `treeExpression.ts`.**

```ts
/** @file The Enso expressions the tree visualization evaluates, and those it creates nodes from. */
import { Ast } from "@/util/ast";
import { Pattern } from "@/util/ast/match";
import type { TreeKey } from "./treeWire";

/** The module of the tree's Enso entry points. */
export const TREE_MODULE = "Standard.Visualization.Tree";

/**
 * The expression asking for one page of the children of the branch at `path`, to apply to a
 * node: `Standard.Visualization.Tree.children _ ([…]) start count <| node`. It goes to
 * `config.executeExpression`, as the table view's server-side rows do.
 */
export function childrenExpression(
  path: readonly TreeKey[],
  start: number,
  count: number,
) {
  const module = Ast.MutableModule.Transient();
  const children = Ast.PropertyAccess.new(
    module,
    Ast.parseExpression(TREE_MODULE, module)!,
    Ast.identifier("children")!,
  );
  const keys = path.map((key) =>
    typeof key === "number"
      ? Ast.tryNumberToEnso(key, module)!
      : Ast.TextLiteral.new(key, module),
  );
  const call = Ast.App.PositionalSequence(children, [
    Ast.Wildcard.new(module),
    Ast.Group.new(module, Ast.Vector.new(module, keys)),
    Ast.tryNumberToEnso(start, module)!,
    Ast.tryNumberToEnso(count, module)!,
  ]);
  return (nodeId: string) =>
    Ast.OprApp.new(module, call, "<|", Ast.parseExpression(nodeId, module)!);
}

/** Whether `expr` is a step a node expression can chain: a method call such as `.at 3`. */
export function isNodeExpression(expr: string): boolean {
  return /^\.[A-Za-z_]/.test(expr);
}

/**
 * The node a double-click creates: each step of `chain` applied to the source in turn, joined by
 * the spaced dot so that arguments stay with their method (`__.get 'tags' . at 3`). `undefined`
 * when a step is not a method call or the result does not parse.
 */
export function nodeExpressionPattern(
  chain: readonly string[],
): Pattern | undefined {
  const [first, ...rest] = chain;
  if (first == null || !chain.every(isNodeExpression)) return undefined;
  const code =
    "__" + first + rest.map((step) => " . " + step.slice(1)).join("");
  try {
    return Pattern.parseExpression(code);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 5: Run the tests.** Same command as Step 2. Expected: all pass. If
      `Ast.Vector.new` prints the vector differently, the test strips
      whitespace, so only a real difference (quotes, order) fails.

- [ ] **Step 6: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations/JSONVisualization
git commit -m "JSON view: the tree's wire types and expressions"
```

### Task 6: The lazy tree's state

**Files:**

- Create: `lazyTree.ts`
- Test: `__tests__/lazyTree.test.ts`

**Interfaces:**

- Consumes: `TreeKey`, `TreeNode`, `TreeEntry`, `Prepared`, `PageResult` (Task
  5), `isNodeExpression` (Task 5).
- Produces: `PAGE_SIZE = 100`; type `FetchPage`; type `TreeRow` (kinds `root`,
  `entry`, `more`, `loading`, `error`; an `entry` has `entry`, `expanded` and
  `chain: readonly string[] | null`); `pathKey(path)`;
  `siblingChains(rows, row)`;
  `useLazyTree(fetchPage) -> { rows, setRoot, toggle, showMore, retry }`.

- [ ] **Step 1: Write the failing tests.** `__tests__/lazyTree.test.ts`:

```ts
import { flushPromises } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import {
  PAGE_SIZE,
  siblingChains,
  useLazyTree,
  type FetchPage,
  type TreeRow,
} from "../lazyTree";
import type { PageResult, Prepared, TreeEntry } from "../treeWire";

function leaf(
  key: string | number,
  value: unknown,
  expr: string | null = null,
): TreeEntry {
  return { key, kind: "leaf", value, expr };
}

function items(start: number, end: number): TreeEntry[] {
  return Array.from({ length: end - start }, (_, i) =>
    leaf(start + i, start + i, `.at ${start + i}`),
  );
}

const prepared: Prepared = {
  root: { kind: "object", size: 4, label: "{4 keys}" },
  children: {
    start: 0,
    size: 4,
    entries: [
      leaf("name", "John", ".get 'name'"),
      {
        key: "items",
        kind: "array",
        size: 250,
        label: "[250 items]",
        expr: ".get 'items'",
      },
      { key: "raw", kind: "array", size: 1, label: "[1 item]", expr: null },
      {
        key: "broken",
        kind: "object",
        size: 1,
        label: "{1 key}",
        expr: ".get 'broken'",
      },
    ],
  },
};

/** Answers 250 items under `items` and `raw`, and fails under anything else. */
function fakeFetch() {
  return vi.fn<FetchPage>(async (path, start, count) =>
    path[0] === "items" || path[0] === "raw"
      ? {
          ok: true,
          page: {
            start,
            size: 250,
            entries: items(start, Math.min(250, start + count)),
          },
        }
      : { ok: false, message: "boom" },
  );
}

function summary(row: TreeRow): string {
  switch (row.kind) {
    case "root":
      return `root ${row.node.kind === "leaf" ? JSON.stringify(row.node.value) : row.node.label}`;
    case "entry": {
      const shown =
        row.entry.kind === "leaf"
          ? JSON.stringify(row.entry.value)
          : row.entry.label;
      return `${row.depth} ${row.entry.key}: ${shown}${row.expanded ? " (open)" : ""}`;
    }
    case "more":
      return `${row.depth} more ${row.shown}/${row.total}`;
    case "loading":
      return `${row.depth} loading`;
    case "error":
      return `${row.depth} error ${row.message}`;
  }
}

function summaries(rows: readonly TreeRow[]) {
  return rows.map(summary);
}

describe("useLazyTree", () => {
  test("shows the root and its first page", () => {
    const tree = useLazyTree(fakeFetch());
    tree.setRoot(prepared);
    expect(summaries(tree.rows.value)).toEqual([
      "root {4 keys}",
      '1 name: "John"',
      "1 items: [250 items]",
      "1 raw: [1 item]",
      "1 broken: {1 key}",
    ]);
  });

  test("shows a leaf root as one row", () => {
    const tree = useLazyTree(fakeFetch());
    tree.setRoot({ root: { kind: "leaf", value: 42 } });
    expect(summaries(tree.rows.value)).toEqual(["root 42"]);
  });

  test("shows nothing for data that is not a tree", () => {
    const tree = useLazyTree(fakeFetch());
    tree.setRoot(undefined);
    expect(tree.rows.value).toEqual([]);
  });

  test("expanding a branch loads its first page and offers more", async () => {
    const fetchPage = fakeFetch();
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    expect(fetchPage).toHaveBeenCalledWith(["items"], 0, PAGE_SIZE);
    expect(summaries(tree.rows.value).slice(2, 4)).toEqual([
      "1 items: [250 items] (open)",
      "2 loading",
    ]);
    await flushPromises();
    const rows = summaries(tree.rows.value);
    expect(rows[3]).toBe("2 0: 0");
    expect(rows[102]).toBe("2 99: 99");
    expect(rows[103]).toBe("2 more 100/250");
    expect(rows[104]).toBe("1 raw: [1 item]");
  });

  test("show more appends the next page until the branch is complete", async () => {
    const fetchPage = fakeFetch();
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    await flushPromises();
    tree.showMore(["items"]);
    expect(fetchPage).toHaveBeenLastCalledWith(["items"], 100, PAGE_SIZE);
    await flushPromises();
    expect(summaries(tree.rows.value)).toContain("2 more 200/250");
    tree.showMore(["items"]);
    await flushPromises();
    const rows = summaries(tree.rows.value);
    expect(rows).toContain("2 249: 249");
    expect(rows.some((row) => row.includes("more"))).toBe(false);
  });

  test("collapsing hides the children and expanding again reuses them", async () => {
    const fetchPage = fakeFetch();
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    await flushPromises();
    tree.toggle(["items"]);
    expect(tree.rows.value).toHaveLength(5);
    tree.toggle(["items"]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(tree.rows.value).toHaveLength(5 + 101);
  });

  test("a new payload fetches the open branches again, as many entries as were shown", async () => {
    const fetchPage = fakeFetch();
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    await flushPromises();
    tree.showMore(["items"]);
    await flushPromises();
    tree.setRoot(prepared);
    expect(fetchPage).toHaveBeenLastCalledWith(["items"], 0, 200);
    await flushPromises();
    const rows = summaries(tree.rows.value);
    expect(rows).toContain("1 items: [250 items] (open)");
    expect(rows).toContain("2 199: 199");
    expect(rows).toContain("2 more 200/250");
  });

  test("a page that arrives after a new payload is ignored", async () => {
    const resolvers: ((result: PageResult) => void)[] = [];
    const fetchPage = vi.fn<FetchPage>(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    tree.setRoot(prepared);
    expect(resolvers).toHaveLength(2);
    resolvers[0]!({
      ok: true,
      page: { start: 0, size: 250, entries: items(0, 1) },
    });
    await flushPromises();
    expect(summaries(tree.rows.value)).toContain("2 loading");
    resolvers[1]!({
      ok: true,
      page: { start: 0, size: 250, entries: items(0, 2) },
    });
    await flushPromises();
    expect(summaries(tree.rows.value)).toContain("2 1: 1");
  });

  test("a failed page shows its message, and retry asks again", async () => {
    const fetchPage = fakeFetch();
    const tree = useLazyTree(fetchPage);
    tree.setRoot(prepared);
    tree.toggle(["broken"]);
    await flushPromises();
    expect(summaries(tree.rows.value)).toContain("2 error boom");
    expect(summaries(tree.rows.value)).toContain('1 name: "John"');
    tree.retry(["broken"]);
    expect(fetchPage).toHaveBeenLastCalledWith(["broken"], 0, PAGE_SIZE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  test("node expressions chain from the root and stop under an entry with none", async () => {
    const tree = useLazyTree(fakeFetch());
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    tree.toggle(["raw"]);
    await flushPromises();
    const chainOf = (path: (string | number)[]) =>
      tree.rows.value.find(
        (row) =>
          row.kind === "entry" &&
          JSON.stringify(row.path) === JSON.stringify(path),
      );
    const item = chainOf(["items", 3]);
    const raw = chainOf(["raw", 3]);
    expect(item?.kind === "entry" && item.chain).toEqual([
      ".get 'items'",
      ".at 3",
    ]);
    expect(raw?.kind === "entry" && raw.chain).toBeNull();
  });

  test("siblingChains gives the chains of every loaded entry beside a row", async () => {
    const tree = useLazyTree(fakeFetch());
    tree.setRoot(prepared);
    tree.toggle(["items"]);
    await flushPromises();
    const row = tree.rows.value.find(
      (r) => r.kind === "entry" && r.path[1] === 5,
    )!;
    const chains = siblingChains(tree.rows.value, row);
    expect(chains).toHaveLength(100);
    expect(chains[0]).toEqual([".get 'items'", ".at 0"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations/JSONVisualization/__tests__/lazyTree.test.ts`.
      Expected: fails to import `../lazyTree`.

- [ ] **Step 3: Create `lazyTree.ts`.**

```ts
/** @file The lazy tree's state: the loaded pages, the open branches, and the rows they show. */
import { computed, shallowReactive, shallowRef } from "vue";
import { isNodeExpression } from "./treeExpression";
import type {
  PageResult,
  Prepared,
  TreeEntry,
  TreeKey,
  TreeNode,
} from "./treeWire";

/** How many entries one `children` call, and one "Show more", asks for. */
export const PAGE_SIZE = 100;

/** Fetches up to `count` children of the branch at `path`, from `start`. */
export type FetchPage = (
  path: readonly TreeKey[],
  start: number,
  count: number,
) => Promise<PageResult>;

/** One row of the rendered tree. `path` is the entry's own path, or the branch a row ends. */
export type TreeRow =
  | { kind: "root"; path: readonly TreeKey[]; depth: number; node: TreeNode }
  | {
      kind: "entry";
      path: readonly TreeKey[];
      depth: number;
      entry: TreeEntry;
      expanded: boolean;
      /** The node expressions from the root to this entry, or `null` if one is missing. */
      chain: readonly string[] | null;
    }
  | {
      kind: "more";
      path: readonly TreeKey[];
      depth: number;
      shown: number;
      total: number;
    }
  | { kind: "loading"; path: readonly TreeKey[]; depth: number }
  | { kind: "error"; path: readonly TreeKey[]; depth: number; message: string };

interface PageState {
  readonly size: number;
  readonly entries: readonly TreeEntry[];
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly failed:
    { readonly start: number; readonly count: number } | undefined;
}

/** A path's key in the state maps. `JSON.stringify` keeps the key `"1"` apart from index `1`. */
export function pathKey(path: readonly TreeKey[]): string {
  return JSON.stringify(path);
}

/** The chains of the entries beside `row` (its siblings and itself) that have one. */
export function siblingChains(
  rows: readonly TreeRow[],
  row: TreeRow,
): (readonly string[])[] {
  if (row.kind !== "entry") return [];
  const parent = pathKey(row.path.slice(0, -1));
  return rows.flatMap((other) =>
    other.kind === "entry" &&
    other.chain != null &&
    pathKey(other.path.slice(0, -1)) === parent
      ? [other.chain]
      : [],
  );
}

/**
 * The state of one tree visualization. `setRoot` takes each new payload of `Tree.prepare`; open
 * branches stay open across payloads, and are fetched again with as many entries as they showed.
 */
export function useLazyTree(fetchPage: FetchPage) {
  const root = shallowRef<TreeNode>();
  const pages = shallowReactive(new Map<string, PageState>());
  const expanded = shallowReactive(new Map<string, readonly TreeKey[]>());
  /** Bumped by each payload, so that a page asked for under an older one is dropped. */
  let generation = 0;

  async function load(path: readonly TreeKey[], start: number, count: number) {
    const key = pathKey(path);
    const before = pages.get(key);
    if (before?.loading) return;
    const asked = generation;
    pages.set(key, {
      size: before?.size ?? 0,
      entries: before?.entries ?? [],
      loading: true,
      error: undefined,
      failed: undefined,
    });
    const result = await fetchPage(path, start, count);
    const current = pages.get(key);
    if (asked !== generation || current == null) return;
    if (!result.ok) {
      pages.set(key, {
        ...current,
        loading: false,
        error: result.message,
        failed: { start, count },
      });
      return;
    }
    pages.set(key, {
      size: result.page.size,
      entries: [...current.entries.slice(0, start), ...result.page.entries],
      loading: false,
      error: undefined,
      failed: undefined,
    });
  }

  function setRoot(prepared: Prepared | undefined) {
    generation += 1;
    const shown = new Map(
      Array.from(pages, ([key, page]) => [key, page.entries.length]),
    );
    pages.clear();
    root.value = prepared?.root;
    if (prepared == null || !("children" in prepared)) {
      expanded.clear();
      return;
    }
    const first = prepared.children;
    pages.set(pathKey([]), {
      size: first.size,
      entries: first.entries,
      loading: false,
      error: undefined,
      failed: undefined,
    });
    const rootShown = shown.get(pathKey([])) ?? 0;
    if (rootShown > first.entries.length && first.entries.length < first.size)
      void load([], first.entries.length, rootShown - first.entries.length);
    for (const [key, path] of expanded)
      void load(path, 0, Math.max(PAGE_SIZE, shown.get(key) ?? 0));
  }

  function toggle(path: readonly TreeKey[]) {
    const key = pathKey(path);
    if (expanded.delete(key)) return;
    expanded.set(key, path);
    const page = pages.get(key);
    if (page == null || (page.entries.length === 0 && page.error != null))
      void load(path, 0, PAGE_SIZE);
  }

  function showMore(path: readonly TreeKey[]) {
    const page = pages.get(pathKey(path));
    if (page == null || page.loading) return;
    void load(path, page.entries.length, PAGE_SIZE);
  }

  function retry(path: readonly TreeKey[]) {
    const failed = pages.get(pathKey(path))?.failed;
    if (failed != null) void load(path, failed.start, failed.count);
  }

  function pushPage(
    rows: TreeRow[],
    path: readonly TreeKey[],
    depth: number,
    chain: readonly string[] | null,
  ) {
    const page = pages.get(pathKey(path));
    if (page == null) return;
    for (const entry of page.entries) {
      const entryPath = [...path, entry.key];
      const entryChain =
        chain != null && entry.expr != null && isNodeExpression(entry.expr)
          ? [...chain, entry.expr]
          : null;
      const open = entry.kind !== "leaf" && expanded.has(pathKey(entryPath));
      rows.push({
        kind: "entry",
        path: entryPath,
        depth,
        entry,
        expanded: open,
        chain: entryChain,
      });
      if (open) pushPage(rows, entryPath, depth + 1, entryChain);
    }
    if (page.loading) rows.push({ kind: "loading", path, depth });
    else if (page.error != null)
      rows.push({ kind: "error", path, depth, message: page.error });
    else if (page.entries.length < page.size)
      rows.push({
        kind: "more",
        path,
        depth,
        shown: page.entries.length,
        total: page.size,
      });
  }

  const rows = computed<TreeRow[]>(() => {
    const node = root.value;
    if (node == null) return [];
    const result: TreeRow[] = [{ kind: "root", path: [], depth: 0, node }];
    if (node.kind !== "leaf") pushPage(result, [], 1, []);
    return result;
  });

  return { rows, setRoot, toggle, showMore, retry };
}
```

- [ ] **Step 4: Run the tests.** Same command as Step 2. Expected: 11 pass.

- [ ] **Step 5: Commit.**

```bash
git add app/gui/src/project-view/components/visualizations/JSONVisualization
git commit -m "JSON view: the lazy tree's pages, open branches and rows"
```

### Task 7: The tree replaces the JSON visualisation's rendering

**Files:**

- Create: `TreeRow.vue`, `CLAUDE.md`
- Modify (rewrite): `JSONVisualization.vue`
- Delete: `JsonArrayWidget.vue`, `JsonErrorWidget.vue`, `JsonObjectWidget.vue`,
  `JsonPrimitiveWidget.vue`, `JsonValueWidget.vue`, `types.ts`
- Modify: `app/gui/src/project-view/CLAUDE.md` ("Visualizations")

**Interfaces:**

- Consumes: `useLazyTree`, `siblingChains`, `PAGE_SIZE`, `TreeRow` (Task 6);
  `childrenExpression`, `nodeExpressionPattern` (Task 5); `parsePrepared`,
  `parsePageResult` (Task 5); `config.executeExpression`, `config.createNodes`
  (`@/providers/visualizationConfig`).
- Produces: the builtin visualisation module `JSON` with
  `defaultPreprocessor = ['Standard.Visualization.Tree', 'prepare']`; DOM hooks
  for Task 8: root `.JSONVisualization`, scroller `[data-testid=tree-scroller]`,
  rows `.TreeRow` with classes `root`, `entry`, `more`, `loading`, `error`; an
  entry's text is in `.content` as `<key>: <value or label>`; buttons `.arrow`
  (aria-label `Expand`/`Collapse`), `.more`, `.retry`.

- [ ] **Step 1: Create `TreeRow.vue`.**

```vue
<script setup lang="ts">
import SvgIcon from "@/components/SvgIcon.vue";
import {
  PAGE_SIZE,
  type TreeRow,
} from "@/components/visualizations/JSONVisualization/lazyTree";
import { computed } from "vue";

const { row } = defineProps<{ row: TreeRow }>();
const emit = defineEmits<{
  toggle: [];
  more: [];
  retry: [];
  activate: [all: boolean];
}>();

/** Indentation per level, in pixels. */
const INDENT_PX = 16;

const node = computed(() =>
  row.kind === "root" ? row.node : row.kind === "entry" ? row.entry : undefined,
);
const leafText = computed(() =>
  node.value?.kind === "leaf" ? JSON.stringify(node.value.value) : undefined,
);
const label = computed(() =>
  node.value?.kind !== "leaf" ? node.value?.label : undefined,
);
const leafClass = computed(() => {
  if (node.value?.kind !== "leaf") return undefined;
  const value = node.value.value;
  if (value === null) return "null";
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? typeof value
    : "other";
});
const title = computed(() => {
  if (row.kind !== "entry") return leafText.value ?? "";
  const action =
    row.chain != null
      ? "Double-click to add a component for this entry; Shift+double-click adds one for each entry beside it."
      : "No expression reaches this entry, so double-clicking it adds nothing.";
  return leafText.value != null ? `${leafText.value}\n\n${action}` : action;
});
const moreText = computed(() =>
  row.kind === "more"
    ? `Show ${Math.min(PAGE_SIZE, row.total - row.shown)} more (of ${row.total.toLocaleString("en-US")})`
    : "",
);
</script>

<template>
  <div
    class="TreeRow"
    :class="row.kind"
    :style="{ paddingLeft: `${row.depth * INDENT_PX}px` }"
  >
    <template v-if="row.kind === 'root' || row.kind === 'entry'">
      <button
        v-if="row.kind === 'entry' && row.entry.kind !== 'leaf'"
        class="arrow"
        :class="{ open: row.expanded }"
        :aria-label="row.expanded ? 'Collapse' : 'Expand'"
        :aria-expanded="row.expanded"
        @click.stop="emit('toggle')"
      >
        <SvgIcon name="chevron_right" />
      </button>
      <span v-else class="arrow" />
      <span
        class="content"
        :title="title"
        @dblclick.stop="emit('activate', $event.shiftKey)"
      >
        <!-- Vue drops the whitespace between these spans (it holds a newline), so the text reads
             `key: value` exactly; the Playwright spec matches it. -->
        <span
          v-if="row.kind === 'entry'"
          class="key"
          v-text="String(row.entry.key)"
        />
        <span v-if="row.kind === 'entry'" class="sep" v-text="': '" />
        <span
          v-if="leafText != null"
          class="value"
          :class="leafClass"
          v-text="leafText"
        />
        <span v-else class="label" v-text="label" />
      </span>
    </template>
    <button
      v-else-if="row.kind === 'more'"
      class="more"
      @click.stop="emit('more')"
      v-text="moreText"
    />
    <span v-else-if="row.kind === 'loading'" class="loading">Loading…</span>
    <span v-else class="error">
      <span v-text="`couldn't load: ${row.message}`" />
      <button class="retry" @click.stop="emit('retry')">Retry</button>
    </span>
  </div>
</template>

<style scoped>
.TreeRow {
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  overflow: hidden;
  font-family: var(--font-mono);
}

.arrow {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: none;
  --icon-size: 12px;
}

button.arrow {
  cursor: pointer;
}

.arrow.open {
  --icon-transform: rotate(90deg);
}

.content {
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: text;
}

.key {
  color: blue;
}

.value {
  color: darkgreen;
}

.label,
.loading {
  color: #666;
}

.more,
.retry {
  padding: 0;
  border: none;
  background: none;
  color: blue;
  cursor: pointer;
  font: inherit;
}

.error {
  display: flex;
  gap: 8px;
  color: #b00020;
}
</style>
```

- [ ] **Step 2: Rewrite `JSONVisualization.vue`.**

```vue
<script lang="ts">
export const name = "JSON";
export const icon = "braces";
export const inputType = "Standard.Base.Any.Any";
export const defaultPreprocessor = [
  "Standard.Visualization.Tree",
  "prepare",
] as const;
</script>

<script setup lang="ts">
import type { NodeCreationOptions } from "@/components/GraphEditor/nodeCreation";
import {
  siblingChains,
  useLazyTree,
  type TreeRow,
} from "@/components/visualizations/JSONVisualization/lazyTree";
import {
  childrenExpression,
  nodeExpressionPattern,
} from "@/components/visualizations/JSONVisualization/treeExpression";
import {
  parsePageResult,
  parsePrepared,
  type PageResult,
  type TreeKey,
} from "@/components/visualizations/JSONVisualization/treeWire";
import TreeRowView from "@/components/visualizations/JSONVisualization/TreeRow.vue";
import { stopCopy } from "@/util/shortcuts";
import { useVisualizationConfig } from "@/util/visualizationBuiltins";
import { useVirtualList } from "@vueuse/core";
import { computed, watch } from "vue";

const { data } = defineProps<{ data: unknown }>();
const config = useVisualizationConfig();

/** A row's height in pixels: the virtual list needs it fixed. */
const ROW_HEIGHT_PX = 20;

async function fetchPage(
  path: readonly TreeKey[],
  start: number,
  count: number,
): Promise<PageResult> {
  const response = await config.executeExpression(
    childrenExpression(path, start, count),
  );
  // `null` while the visualization subdoc syncs; `undefined` when there is no node to evaluate on
  // (a component browser preview).
  if (response == null)
    return { ok: false, message: "the value is not available here" };
  if (!response.ok)
    return { ok: false, message: String(response.error.payload) };
  return parsePageResult(response.value);
}

const prepared = computed(() => parsePrepared(data));
const tree = useLazyTree(fetchPage);
watch(prepared, (value) => tree.setRoot(value), { immediate: true });

const { list, containerProps, wrapperProps } = useVirtualList(tree.rows, {
  itemHeight: ROW_HEIGHT_PX,
  overscan: 10,
});

function activate(row: TreeRow, all: boolean) {
  if (row.kind !== "entry" || row.chain == null) return;
  const chains = all ? siblingChains(tree.rows.value, row) : [row.chain];
  const patterns = chains.flatMap(
    (chain) => nodeExpressionPattern(chain) ?? [],
  );
  if (patterns.length === 0) return;
  config.createNodes(
    ...patterns.map(
      (content) => ({ content, commit: true }) satisfies NodeCreationOptions,
    ),
  );
}

function rowKey(row: TreeRow) {
  return `${row.kind}:${JSON.stringify(row.path)}`;
}
</script>

<template>
  <div
    class="JSONVisualization"
    tabindex="-1"
    @wheel.stop.passive
    @keydown="stopCopy"
  >
    <pre
      v-if="prepared == null"
      class="raw"
      v-text="JSON.stringify(data, null, 2)"
    />
    <div
      v-else
      v-bind="containerProps"
      class="scroller"
      data-testid="tree-scroller"
    >
      <div v-bind="wrapperProps">
        <TreeRowView
          v-for="{ data: row } in list"
          :key="rowKey(row)"
          :row="row"
          :style="{ height: `${ROW_HEIGHT_PX}px` }"
          @toggle="tree.toggle(row.path)"
          @more="tree.showMore(row.path)"
          @retry="tree.retry(row.path)"
          @activate="activate(row, $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.JSONVisualization {
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
  user-select: text;
}

.scroller {
  height: 100%;
}

.raw {
  margin: 0;
  white-space: pre-wrap;
}
</style>
```

- [ ] **Step 3: Delete the old widgets.** Delete `JsonArrayWidget.vue`,
      `JsonErrorWidget.vue`, `JsonObjectWidget.vue`, `JsonPrimitiveWidget.vue`,
      `JsonValueWidget.vue` and `types.ts`, then run
      `git grep -n "JsonValueWidget\|JsonArrayWidget\|JsonObjectWidget\|JsonPrimitiveWidget\|JsonErrorWidget\|JSONVisualization/types" -- app/gui`.
      Expected: no output.

- [ ] **Step 4: CLAUDE.md files.** Create `JSONVisualization/CLAUDE.md`:

```markdown
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
  from the root (`treeExpression.ts`, joined with the spaced dot); Shift adds
  one node per loaded sibling. An entry under one with no expression has none.
```

In `app/gui/src/project-view/CLAUDE.md`, at the end of the "Visualizations"
section, add: "The JSON visualization is a lazy tree whose pages Enso sends on
demand (`components/visualizations/JSONVisualization/CLAUDE.md`)."

- [ ] **Step 5: Check.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/visualizations`,
      then `corepack pnpm --filter enso-gui run typecheck` and
      `corepack pnpm --filter enso-gui run lint`. Expected: all pass. A `TS6307`
      from `tsconfig.node.json` is not expected (no integration test imports
      these files yet).

- [ ] **Step 6: Commit.**

```bash
git add -A app/gui/src/project-view
git commit -m "JSON view: render the value as a lazy tree, a page at a time"
```

### Task 8: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/lsHandler.ts` (`mockVizPreprocessors`)
- Create: `app/gui/integration-test/project-view/jsonTreeVisualisation.spec.ts`
- Modify:
  `app/gui/integration-test/project-view/graphNodeVisualization.spec.ts`,
  `fullscreenVisualisation.spec.ts`, `componentBrowser.spec.ts`

**Interfaces:**

- Consumes: the DOM hooks of Task 7 and the wire format.
- Produces: mocks `Standard.Visualization.Tree.prepare` (a root of four keys:
  `visualizedExpr`, `items` of 150, `nested`, `broken`) and
  `Standard.Visualization.Tree.children` (pages of `items` and `nested`;
  `{"error":"boom"}` for anything else).

- [ ] **Step 1: Mock the two entry points.** In `lsHandler.ts`, before
      `const mockVizPreprocessors`, add:

```ts
/** The 150 items of the mocked tree's `items` branch. */
const treeItems = Array.from({ length: 150 }, (_, i) => ({
  key: i,
  kind: "leaf",
  value: i,
  expr: `.at ${i}`,
}));

/** `Tree.prepare`: `visualizedExpr` echoes the expression it was applied to, as the JSON mock does. */
const treePrepare = (params: string[]) =>
  encodeJSON({
    root: { kind: "object", size: 4, label: "{4 keys}" },
    children: {
      start: 0,
      size: 4,
      entries: [
        {
          key: "visualizedExpr",
          kind: "leaf",
          value: params[0] ?? "node",
          expr: null,
        },
        {
          key: "items",
          kind: "array",
          size: 150,
          label: "[150 items]",
          expr: ".get 'items'",
        },
        {
          key: "nested",
          kind: "object",
          size: 1,
          label: "{1 key}",
          expr: ".get 'nested'",
        },
        {
          key: "broken",
          kind: "object",
          size: 1,
          label: "{1 key}",
          expr: ".get 'broken'",
        },
      ],
    },
  });

/** `Tree.children _ (path) start count <| node`: its arguments are `[node, path, start, count]`. */
const treeChildren = (params: string[]) => {
  const path = JSON.parse((params[1] ?? "[]").replaceAll("'", '"')) as (
    string | number
  )[];
  const start = Number(params[2]);
  const count = Number(params[3]);
  if (path.length === 1 && path[0] === "items")
    return encodeJSON({
      start,
      size: 150,
      entries: treeItems.slice(start, start + count),
    });
  if (path.length === 1 && path[0] === "nested")
    return encodeJSON({
      start,
      size: 1,
      entries: [
        { key: "deep", kind: "leaf", value: true, expr: ".get 'deep'" },
      ].slice(start, start + count),
    });
  return encodeJSON({ error: "boom" });
};
```

and in `mockVizPreprocessors`, after the
`'Standard.Visualization.Preprocessor.default_preprocessor'` line:

```ts
    'Standard.Visualization.Tree.prepare': treePrepare,
    'Standard.Visualization.Tree.children': treeChildren,
```

- [ ] **Step 2: Write the new spec.**
      `app/gui/integration-test/project-view/jsonTreeVisualisation.spec.ts`:

```ts
/** @file The JSON visualization's lazy tree: expand, show more, double-click, a failed page. */
import { expect, test, type Locator, type Page } from "integration-test/base";
import * as actions from "./actions";
import * as locate from "./locate";

/** Open the JSON visualization on the `aggregated` node (`actions.openVisualization` picks it). */
async function openTree(page: Page) {
  await actions.openVisualization(page, "JSON");
  const vis = locate.jsonVisualization(page);
  await expect(vis).toExist();
  return vis;
}

function entry(vis: Locator, text: string) {
  return vis.locator(".TreeRow.entry").filter({ hasText: text });
}

async function scrollToBottom(vis: Locator) {
  await vis
    .getByTestId("tree-scroller")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
}

test("Expanding a branch loads its first page, and Show more the next", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const vis = await openTree(page);
  await expect(vis).toContainText("items: [150 items]");
  await entry(vis, "items: [150 items]")
    .getByRole("button", { name: "Expand" })
    .click();
  await expect(vis).toContainText("0: 0");
  await scrollToBottom(vis);
  const more = vis.getByRole("button", { name: "Show 50 more (of 150)" });
  await expect(more).toBeVisible();
  await more.click();
  await scrollToBottom(vis);
  await expect(vis).toContainText("149: 149");
  await expect(vis.locator(".TreeRow.more")).toHaveCount(0);
});

test("Double-click on an entry creates a node for it", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const vis = await openTree(page);
  await entry(vis, "items: [150 items]")
    .getByRole("button", { name: "Expand" })
    .click();
  const nodeCount = await locate.graphNode(page).count();
  await vis
    .locator(".TreeRow.entry .content")
    .filter({ hasText: /^3: 3$/ })
    .dblclick();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1);
  await page.keyboard.press("ControlOrMeta+`");
  await expect(page.locator(".CodeEditor")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__codeEditorApi.textContent()),
    )
    .toContain("aggregated.get 'items' . at 3");
});

test("An entry with no expression creates nothing", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const vis = await openTree(page);
  const nodeCount = await locate.graphNode(page).count();
  await vis
    .locator(".TreeRow.entry .content")
    .filter({ hasText: /^visualizedExpr:/ })
    .dblclick();
  await expect(locate.graphNode(page)).toHaveCount(nodeCount);
});

test("A failed page shows its message and a retry, and the rest stays usable", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const vis = await openTree(page);
  await entry(vis, "broken: {1 key}")
    .getByRole("button", { name: "Expand" })
    .click();
  await expect(vis).toContainText("couldn't load: boom");
  await expect(vis.getByRole("button", { name: "Retry" })).toBeVisible();
  await entry(vis, "nested: {1 key}")
    .getByRole("button", { name: "Expand" })
    .click();
  await expect(vis).toContainText("deep: true");
});
```

- [ ] **Step 3: Update the specs that parsed the old JSON.** In
      `graphNodeVisualization.spec.ts` ("Node can open and load visualization"),
      replace the lines from
      `// The default JSON viz data     contains an object.` to
      `expect(typeof jsonContent).toBe('object')` with:

```ts
// The JSON visualization is the tree of `Tree.prepare`'s mock.
await expect(vis).toContainText("items: [150 items]");
```

In `fullscreenVisualisation.spec.ts`, replace the lines from
`const element = await vis.elementHandle()` to the end of the
`expect(jsonContent).toEqual({ … })` call with:

```ts
await expect(vis).toContainText("items: [150 items]");
await expect(vis).toContainText("nested: {1 key}");
```

In `componentBrowser.spec.ts` ("Visualization preview: user visualization
selection"), change `toContainText('"visualizedExpr": "4"')` to
`toContainText('visualizedExpr: "4"')`. Remove the imports (`assert`,
`computedContent`) that a file no longer uses.

- [ ] **Step 4: Run them.** From `app/gui`:
      `corepack pnpm exec cross-env NODE_ENV=production playwright test --project="Integration Tests" integration-test/project-view/jsonTreeVisualisation.spec.ts integration-test/project-view/graphNodeVisualization.spec.ts integration-test/project-view/fullscreenVisualisation.spec.ts integration-test/project-view/componentBrowser.spec.ts`.
      Expected: all pass. Run `jsonTreeVisualisation.spec.ts` three times
      (`--repeat-each=3`); the integration tests are timing-sensitive, and a
      single green run is not evidence. Then `typecheck` and `lint` (they cover
      `integration-test/`).

- [ ] **Step 5: Commit.**

```bash
git add app/gui/integration-test
git commit -m "JSON view: Playwright for expanding, paging, double-click and a failed page"
```

### Task 9: Linux check, changelog, screenshots and PR 2.2

**Files:**

- Modify: `CHANGELOG.md` (after the PR has a number)

- [ ] **Step 1: Linux.** Sync `viz/tree-gui` into `~/vizwork3` (Working
      environment), then in `~/vizwork3`:
      `corepack pnpm --filter enso-gui run lint` and, from `app/gui`, the
      Playwright command of Task 8 Step 4. Expected: pass, and lint leaves the
      `.vue` files unchanged (`git status` clean): Prettier's import sorting has
      corrupted Vue files only on Linux before.

- [ ] **Step 2: Push and open PR 2.2.** Push `viz/tree-gui` and open the PR
      against `develop` (PR 2.1 has merged). The body links the spec and this
      plan, lists what changed for the user (no 100-item or 5-level limit; any
      value can be explored; double-click), the test plan, and the installer
      check below. It ends with the attribution line.

- [ ] **Step 3: Changelog.** Add, as the first item under `# Next Release` →
      `#### Enso IDE`, with the link definition next to the others:

```markdown
- [The JSON visualization is a tree that loads each branch when you open it, a
  page at a time, with no limit on size or depth. It explores any value, and
  double-clicking an entry adds a component for it.][NNN]
```

```markdown
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

Commit ("Changelog: the JSON visualization is a lazy tree") and push.

- [ ] **Step 4: Screenshots.** Before (develop) and after (this branch), in the
      dev build or an installer: a `JS_Object` node with the JSON visualization
      open, and the same with a branch expanded and the "Show more" row in view.
      Commit the PNGs to the orphan branch `pr-screenshots` under `pr-<NNN>/`
      (never to `viz/tree-gui`) and embed them in the PR body with
      `![after](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-<NNN>/<file>.png)`.

- [ ] **Step 5: Hand over for the installer test.** The PR waits for the owner's
      OK. Build an installer (`ide-local`) and give the owner this check list: a
      `JS_Object` with a 1,000-item array (expand, Show more to the end); a
      vector 8 levels deep (expand to the bottom, no `[...]`); a Table (summary,
      a page of rows, a row's values); a user atom (keys from its JSON,
      double-click does nothing, tooltip says so); double-click on a `JS_Object`
      key, an array item and a table row, each making a node with the right
      expression; a re-evaluated node keeps its open branches.

---

## Final verification (both PRs)

- [ ] `git grep -n "default_preprocessor" -- app/gui/src` still shows the
      default configuration in `stores/visualization/index.ts` (custom
      visualisations and Image use it); the JSON visualization uses
      `Tree.prepare`.
- [ ] CI green on both PRs, including `stdlib-api-check`, Workflow Lint, the GUI
      checks and IDE packaging on PR 2.2.
- [ ] After PR 2.2 merges: `rm -rf ~/vizwork3`.
