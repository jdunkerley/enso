# Default Visualisation by Conversion, and `Viz_Json` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `default_visualization` and
`to_default_visualization_data` extension methods with conversions to
Visualization's `Id` and a new `Viz_Json` type, without changing any JSON the
IDE receives except for long text.

**Architecture:** `Id.from` and `Viz_Json.from` conversions for Base types live
in their target modules in `Standard.Visualization`. Table, Database, XML and
Image define conversions for their own **public** types in their own modules
(conversion lookup tries the source type's module first). The IDE asks for
`Id.from a`, and `default_preprocessor` returns `(Viz_Json.from a).json_text`.

**Tech Stack:** Enso standard library (`distribution/lib/Standard/*`), the Enso
test framework (`test/*_Tests`), golden files (`expect_pinned`), Scala engine
test (`RuntimeVisualizationsTest`), TypeScript/Vue in `app/gui`, vitest.

**Spec:**
`docs/superpowers/specs/2026-11-14-viz-id-conversion-and-viz-json-design.md`
(read it first, including "Changed while planning" at its end).

## Global Constraints

- Visualization imports only `Standard.Base`. Libraries import Visualization,
  never the reverse.
- Every conversion is on a **public** type (`Table`, `Column`, `Row`, `Image`,
  `XML_Document`, `XML_Element`, or a Base type), never on `In_Memory_Table`,
  `DB_Table` or another implementation type.
- Every entity added in a **non-private** module carries `## ---` /
  `private: true` / `---` doc metadata.
- An unused argument is silenced with the repo idiom `_ = that` on its own line
  (not a `_` parameter name).
- No unused imports: the `-Werror` lint fails on them. After deleting code,
  remove each import the file no longer uses.
- The `Id` JSON keeps its shape `{"library":null,"name":"<name>"}`; the GUI
  parser is unchanged.
- The existing `default_*` and `data_*` goldens in
  `test/Visualization_Tests/data/pinned/` must pass **unchanged**. The one
  intended output change is text longer than 2000 characters (cut to 2000
  characters plus `…`).
- PR 1 gets a changelog entry; PR 2 gets the `CI: No changelog needed` label.
- PR 1 is a feature: it waits for the owner's OK after an installer test. PR 2
  is invisible plus a fix: it merges on green once PR 1 has merged.

## Working environment

- Windows worktrees: PR 1 in `C:\Repos\Enso\ide-viz-id` (branch
  `viz/id-conversion` from `origin/develop`); PR 2 in
  `C:\Repos\Enso\ide-viz-json` (branch `viz/viz-json` from `viz/id-conversion`).
  Never `git stash`.
- Enso builds and tests run in the WSL clone `~/vizwork`. Before each build,
  sync the worktree into it (replace `<wt>` with the worktree folder name):

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork && git fetch -q origin && git checkout -qf origin/develop && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/distribution/lib/ distribution/lib/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/test/ test/ && \
    rsync -a --delete /mnt/c/Repos/Enso/<wt>/engine/runtime-integration-tests/ engine/runtime-integration-tests/ && \
    rsync -a /mnt/c/Repos/Enso/<wt>/tools/ci/ tools/ci/ && \
    sbt buildEngineDistribution'
  ```

- Run an Enso test project in `~/vizwork`. `FILTER` is optional, and **a filter
  that matches nothing still exits 0**, so check the printed test count:

  ```bash
  wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork/test && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" FILTER'
  ```

  To (re)write golden files, prefix the command with `ENSO_UPDATE_PINNED=1`
  (each regenerated case then **fails** on purpose), copy the new files from
  `~/vizwork/test/Visualization_Tests/data/pinned/` back to the worktree, and
  run again without it.

- `-Werror` lint, one directory per run (no `-ea`), in `~/vizwork`:

  ```bash
  built-distribution/enso-engine-*/enso-*/bin/enso --enable-static-analysis --hide-progress -Werror --compile <dir>
  ```

- API docs: regenerate one library's committed `docs/api` in `~/vizwork`, then
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
  `corepack pnpm --filter enso-gui run lint`.

---

## PR 1 — `Id.from` replaces `default_visualization`

### Task 1.1: `Id.from` conversions in the libraries

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Id.enso` (drop
  `Library`, `from_module`; add two conversions)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Helpers.enso`
  (delete the four `default_visualization` methods and `import project.Id.Id`)
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso:4089-4093`,
  `src/Column.enso:2696-2699`, `src/Row.enso:153-156`,
  `src/Internal/In_Memory_Table_Implementation.enso:111-113`
- Modify:
  `distribution/lib/Standard/Database/0.0.0-dev/src/Internal/DB_Table_Implementation.enso:99-101`
- Modify: `distribution/lib/Standard/Image/0.0.0-dev/src/Image.enso` (import and
  conversion at the end)
- Modify: `tools/ci/stdlib-test-map.yaml:32` (Image `dependsOn`)
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`,
  `distribution/lib/Standard/Image/0.0.0-dev/CLAUDE.md`
- Regenerate: `docs/api` of Visualization, Table, Database, Image
- Test: `test/Visualization_Tests/src/Id_Spec.enso`,
  `test/Visualization_Tests/src/Pinned_Spec.enso`,
  `test/Visualization_Tests/src/Table_Conversions_Spec.enso`, new golden
  `test/Visualization_Tests/data/pinned/default_image.json`

**Interfaces:**

- Produces: `Id.from (that:Any) -> Id` (`Id.table`), `Id.from (that:JS_Object)`
  (`Id.json`), `Id.from (that:Table)` (`Id.table` in memory, `Id.sql_query` in a
  database), `Id.from (that:Image)` (`Id.image`). The implementations' method is
  renamed `default_viz_id (this_table : Table & <Impl>) -> Id`.
- Removed: `Any/JS_Object/Vector/Array/Table/Column/Row.default_visualization`,
  `Id.Library`, `Id.from_module`.

- [ ] **Step 1: Write the failing tests.** Replace the body of `Id_Spec.enso`
      after the imports with the following, and add
      `from Standard.Image import Image` and
      `import Standard.Visualization.Id.Id` to its imports (keep
      `import Standard.Visualization`; drop `import Standard.Base` if nothing
      else uses it):

```enso
type My_Type
    Value my_field

type My_Json_Type
    Value my_field

## A user type picks its default visualisation in its own module.
Id.from (that:My_Json_Type) =
    _ = that
    Id.json

add_specs suite_builder = suite_builder.group "Serializable Visualization Identifiers" group_builder->
    group_builder.specify "serializes builtin visualizations in the correct format" <|
        json_for_name n = JS_Object.from_pairs [["library", Nothing], ["name", n]] . to_text
        Visualization.Id.json.to_json . should_equal (json_for_name "JSON")
        Visualization.Id.scatter_plot.to_json . should_equal (json_for_name "Scatter Plot")
        Visualization.Id.table.to_json . should_equal (json_for_name "Table")
        Visualization.Id.sql_query.to_json . should_equal (json_for_name "SQL Query")
        Visualization.Id.geo_map.to_json . should_equal (json_for_name "Geo Map")
        Visualization.Id.image.to_json . should_equal (json_for_name "Image")

    group_builder.specify "converts any value to the Table visualization" <|
        Id.from (My_Type.Value 30) . should_equal Id.table
        Id.from "foobar" . should_equal Id.table
        Id.from True . should_equal Id.table
        Id.from 42 . should_equal Id.table
        Id.from Nothing . should_equal Id.table

    group_builder.specify "converts a JS_Object to the JSON visualization" <|
        Id.from (Json.parse '{"name":"John","age":25,"email":"john@example.com"}') . should_equal Id.json

    group_builder.specify "converts a Vector and an Array to the Table visualization" <|
        Id.from [1,2,3] . should_equal Id.table
        Id.from [1,2,3].to_array . should_equal Id.table

    group_builder.specify "converts an in-memory Table, Column and Row to the Table visualization" <|
        t = Table.new [['latitude', [5,2,5]], ['Y', [2,4,2]], ['name', ["foo", "bar", "baz"]]]
        Id.from t . should_equal Id.table
        Id.from (t.at "Y") . should_equal Id.table
        Id.from (t.rows.at 0) . should_equal Id.table

    group_builder.specify "converts an Image to the Image visualization" <|
        Id.from (Image.from_vector [0, 0, 0, 0] rows=2 channels=1) . should_equal Id.image

    group_builder.specify "lets a user type pick its visualization by a conversion" <|
        Id.from (My_Json_Type.Value 1) . should_equal Id.json

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

In `Pinned_Spec.enso`, add `import Standard.Visualization.Id.Id` and
`from Standard.Image import Image` to the imports. In the "Pinned default
visualisation" group, change the helper and add the image case:

```enso
        default name ~value =
            group_builder.specify name <|
                expect_pinned ("default_" + name) (Id.from value).to_js_object.to_json
```

```enso
        default "image" (Image.from_vector [0, 0, 0, 0] rows=2 channels=1)
```

In `Table_Conversions_Spec.enso`, replace the last case shown here (line 63-64)
with:

```enso
        group_builder.specify "the default visualisation of a database table is the SQL view" <|
            Id.from dt . should_equal Id.sql_query
```

- [ ] **Step 2: Run the tests to see them fail.** Sync and build (Working
      environment), then run `Visualization_Tests`. Expected: the new `Id_Spec`
      cases, every `Pinned default visualisation` case and the SQL-view case
      fail with `No_Such_Conversion` (no `Id.from` exists yet), and
      `default_image` fails because its golden file is missing.

- [ ] **Step 3: Rewrite `Id.enso`.** Delete the `Library project name`
      constructor and `from_module`. Replace `to_js_object` and add the
      conversions after the type:

```enso
    ## ---
       private: true
       ---
       Serializes this ID to a JSON format understandable by the graphical
       interface. `library` is always `null`: only builtin visualisations exist.
    to_js_object : JS_Object
    to_js_object self =
        JS_Object.from_pairs [["library", Nothing], ["name", self.name]]
```

```enso
## ---
   private: true
   ---
   Any value opens in the Table visualization, unless its type picks another
   one with a conversion `Id.from (that:Its_Type)` in its own module.
Id.from (that:Any) =
    _ = that
    Id.table

## ---
   private: true
   ---
   A JS_Object opens in the JSON visualization.
Id.from (that:JS_Object) =
    _ = that
    Id.json
```

- [ ] **Step 4: Delete the old methods.** In Visualization `Helpers.enso` delete
      `Any.default_visualization`, `JS_Object.default_visualization`,
      `Vector.default_visualization`, `Array.default_visualization` with their
      doc comments, and `import project.Id.Id`. In `Column.enso` delete
      `Column.default_visualization` (lines 2696-2699 with its comment); in
      `Row.enso` delete `Row.default_visualization` (lines 153-156). Then run
      `git grep -n "\bId\b" -- <file>` on `Column.enso` and `Row.enso` and
      delete `import Standard.Visualization.Id.Id` from each file that no longer
      uses `Id`.

- [ ] **Step 5: Table and Database.** In `Table.enso` replace lines 4089-4093
      (`Table.default_visualization ...` and its comment) with:

```enso
## ---
   private: true
   ---
   An in-memory table opens in the Table visualization, a database table in
   the SQL Query visualization.
Id.from (that:Table) = that.implementation.default_viz_id that.underlying
```

In `In_Memory_Table_Implementation.enso` and `DB_Table_Implementation.enso`,
rename the method `default_visualization` to `default_viz_id` (body unchanged:
`_ = this_table` then `Id.table` / `Id.sql_query`).

- [ ] **Step 6: Image.** In `Image.enso` add
      `import Standard.Visualization.Id.Id` after the `Standard.Base` imports,
      and at the end of the file:

```enso
## ---
   private: true
   ---
   An image opens in the Image visualization.
Id.from (that:Image) =
    _ = that
    Id.image
```

In `tools/ci/stdlib-test-map.yaml` change line 32 to
`Image: { stdBits: [image], dependsOn: [Base, Visualization] }` and run
`node tools/ci/check-workflows.mjs` (expected: no errors).

- [ ] **Step 7: Generate the image golden.** Sync, build, run
      `Visualization_Tests` with `ENSO_UPDATE_PINNED=1` and filter
      `default_image` (it fails on purpose). Copy
      `data/pinned/default_image.json` back; its whole content must be
      `{"library":null,"name":"Image"}`. Run again without it.

- [ ] **Step 8: Run the tests.** Run `Visualization_Tests` (no filter).
      Expected: all pass, and `git status` shows no change to any existing
      `default_*.json`. Run `Image_Tests`, `Table_Tests` filtered to `Id` or
      `visuali` (check the count), and `SQLite_Tests`. Expected: pass.

- [ ] **Step 9: Lint.** Run the `-Werror` lint on
      `distribution/lib/Standard/Visualization/0.0.0-dev`, `.../Table/...`,
      `.../Database/...`, `.../Image/...` and `test/Visualization_Tests`.
      Expected: no warnings.

- [ ] **Step 10: Docs.** Regenerate `docs/api` for Visualization, Table,
      Database and Image. Check the diff: `Id.md` loses `from_module` and
      `Library`; `Helpers.md`, `Table.md`, `Column.md`, `Row.md` lose
      `default_visualization`; `Image.md` gains the conversion. In
      `Visualization/0.0.0-dev/CLAUDE.md` under "Data types" add:

```markdown
- `Id` (`src/Id.enso`) - which visualisation a node opens with. `Id.from`
  answers it: any value gives `Id.table`, a `JS_Object` `Id.json`; a library
  picks another for its type with `Id.from (that:Its_Public_Type)` (Table: SQL
  Query for a database table; Image: Image).
```

In `Image/0.0.0-dev/CLAUDE.md` add one line: Image imports
`Standard.Visualization` only for `Id.from (that:Image) = Id.image`.

- [ ] **Step 11: Commit.**

```bash
git add -A distribution/lib/Standard tools/ci/stdlib-test-map.yaml test/Visualization_Tests
git commit -m "Visualization: a value's default visualisation is an Id conversion"
```

### Task 1.2: The IDE and the engine test ask for `Id.from`

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts:75-77`
- Modify:
  `app/gui/src/project-view/components/ComponentBrowser/filtering.ts:364-368`,
  `app/gui/src/project-view/components/ComponentBrowser/__tests__/filtering.test.ts:47-60`
- Modify:
  `engine/runtime-integration-tests/src/test/scala/org/enso/interpreter/test/instrument/RuntimeVisualizationsTest.scala:2022-2029`
- Modify: `CHANGELOG.md` (after the PR has a number)

**Interfaces:**

- Consumes: `Id.from (that:Any) -> Id` in module `Standard.Visualization.Id`
  (Task 1.1).

- [ ] **Step 1: GUI expression.** In `visualizationData.ts` change the config
      to:

```ts
        visualizationModule: 'Standard.Visualization.Id',
        expression: 'a -> (Id.from a).to_js_object.to_json',
```

The module is `Standard.Visualization.Id` because `Id` is in scope there;
`Helpers` no longer imports it.

- [ ] **Step 2: Filtering comment and test.** In `filtering.ts` replace the
      sentence "They also add methods to other types (`default_visualization`),
      so these are hidden even when a self type is known." with "They may also
      add methods to other types, so these are hidden even when a self type is
      known." In `filtering.test.ts` rename the sample entry
      `Standard.Visualization.Helpers.Any.default_visualization` to
      `Standard.Visualization.Helpers.Any.ide_only_method` and the pattern
      `'default_visualization'` to `'ide_only_method'`.

- [ ] **Step 3: Run the GUI checks.** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/ComponentBrowser src/project-view/components/GraphEditor/GraphVisualization`,
      then `typecheck` and `lint`. Expected: pass.

- [ ] **Step 4: Engine test.** In `RuntimeVisualizationsTest.scala` ("be able to
      use external libraries if they are needed by the visualization") change
      the expression and both module names:

```scala
              Api.VisualizationExpression.Text(
                "Standard.Visualization.Id",
                "x -> (Id.from x).to_text",
                Vector()
              ),
              "Standard.Visualization.Id"
```

The expected data stays `"(Builtin 'Table')"`. Run it in `~/vizwork` (after a
sync):

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/vizwork && sbt "runtime-integration-tests/testOnly *RuntimeVisualizationsTest -- -z \"external libraries\""'
```

Expected: 1 test, passed.

- [ ] **Step 5: Grep.** Run
      `git grep -n "default_visualization\|from_module\|Id.Library" -- distribution app/gui/src engine test ':!**/docs/api/**'`.
      Expected: no output.

- [ ] **Step 6: Commit, push, open PR 1.** Commit ("IDE: ask for a value's
      default visualisation with Id.from"), push `viz/id-conversion`, and open
      the PR against `develop` with the spec link, the summary and a test plan.
      Then add the changelog entry under `# Next Release` → `#### Enso IDE` as
      the first item, with the link definition next to the others:

```markdown
- [A component whose value is an image opens in the Image visualization.][NNN]
```

```markdown
[NNN]: https://github.com/jdunkerley/enso/pull/NNN
```

Commit ("Changelog: Image opens in the Image visualization") and push.

---

## PR 2 — `Viz_Json` replaces `to_default_visualization_data`

### Task 2.1: Pin today's preprocessor output first

**Files:**

- Modify: `test/Visualization_Tests/src/Pinned_Spec.enso` (the "Pinned default
  preprocessor JSON" group)
- Create: `test/Visualization_Tests/data/pinned/data_nothing.json`,
  `data_error.json`, `data_xml_document.json`, `data_xml_element.json`,
  `data_vector_deep.json`, `data_array.json`

**Interfaces:**

- Produces: golden files of today's (`viz/id-conversion`) output that Task 2.2
  must reproduce.

- [ ] **Step 1: Add the cases.** In the "Pinned default preprocessor JSON" group
      add (`Illegal_Argument` and `XML_Document` are already imported):

```enso
        default_data "nothing" Nothing
        default_data "error" (Error.throw (Illegal_Argument.Error "boom"))
        default_data "xml_document" (XML_Document.parse '<foo id="10"><bar a="1">hello<baz>deep</baz></bar>text</foo>')
        default_data "xml_element" (XML_Document.parse '<foo id="10"><bar>hello</bar>text</foo>' . root_element)
        default_data "vector_deep" [[[[[[[1]]]]]], (0.up_to 150 . to_vector)]
        default_data "array" [1, [2, 3]].to_array
```

- [ ] **Step 2: Generate on today's code.** Sync (this branch has no library
      change yet), build, run with `ENSO_UPDATE_PINNED=1` and filter
      `Pinned default preprocessor`, copy the six new files back, and run again
      without it. Expected: all pass. Check by eye that `data_vector_deep.json`
      contains `"[...]"` at depth 5 and only 100 items of the second vector, and
      `data_error.json` is the error's payload JSON
      (`"type":"Illegal_Argument"`).

- [ ] **Step 3: Commit.**

```bash
git add test/Visualization_Tests
git commit -m "Visualization tests: pin the default preprocessor for more values"
```

### Task 2.2: `Viz_Json` and its conversions

**Files:**

- Create: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Viz_Json.enso`
- Modify:
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Preprocessor.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`,
  `src/Column.enso`, `src/Row.enso`
- Modify: `distribution/lib/Standard/XML/0.0.0-dev/src/XML.enso`
- Test: `test/Visualization_Tests/src/Helpers_Spec.enso`,
  `test/Visualization_Tests/src/Pinned_Spec.enso`, new golden
  `data_long_text.json`

**Interfaces:**

- Consumes: Task 2.1's goldens.
- Produces: `type Viz_Json` with constructor `Value (json_text : Text)` in
  `Standard.Visualization.Viz_Json`; conversions `Viz_Json.from` for `Any`,
  `Nothing`, `JS_Object`, `Vector`, `Array`, `Text` (Visualization), `Table`,
  `Column`, `Row` (Table), `XML_Document`, `XML_Element` (XML).
  `Preprocessor.default_preprocessor x -> Text` keeps its name and module.

- [ ] **Step 1: Write the failing tests.** Replace `Helpers_Spec.enso`'s imports
      of `Standard.Visualization.Helpers` with
      `from Standard.Visualization.Viz_Json import Viz_Json`, and its groups
      with:

```enso
add_specs suite_builder =
    json_of value = (Viz_Json.from value).json_text

    suite_builder.group "Table.rows" group_builder->
        table = Table.new [["X", [1, 2, 3, 4]], ["Y", [5, 6, 7, 8]], ["Z", ["A", "B", "C", "D"]]]
        group_builder.specify "should visualize nicely" <|
            Json.parse (json_of table.rows) . should_equal <|
                Json.parse '[[1,5,"A"],[2,6,"B"],[3,7,"C"],[4,8,"D"]]'

            # At most 100 rows.
            t2 = Table.new [["X", 0.up_to 200 . to_vector]]
            json_of t2.rows . should_equal (json_of (0.up_to 100 . map (x -> [x])))

    suite_builder.group "Vector and Arrays" group_builder->
        ## Returns an array with the same contents as the given vector, surely backed by
           a Java array.
        make_java_array vector =
            builder = LinkedHashSet.new
            vector.each x->
                builder.add x
            builder.toArray

        group_builder.specify "should be able to be efficiently visualise a Vector" <|
            Json.parse (json_of (Vector.fill 1000 0)) . should_equal <| Vector.fill 100 0

        group_builder.specify "should be able to visualize an Enso Array" <|
            Json.parse (json_of (Vector.fill 1000 0 . to_array)) . should_equal <| Vector.fill 100 0

        group_builder.specify "should be able to visualize a Polyglot Array" pending="`Viz_Json.from` does not work for polyglot arrays" <|
            Json.parse (json_of (make_java_array (Vector.fill 1000 0))) . should_equal <| Vector.fill 100 0

    suite_builder.group "Text" group_builder->
        group_builder.specify "short text is its JSON" <|
            json_of "hello" . should_equal '"hello"'

        group_builder.specify "text over 2000 characters is cut, with an ellipsis" <|
            long = 0.up_to 2500 . map (_-> "a") . join ""
            expected = (0.up_to 2000 . map (_-> "a") . join "") + "…"
            json_of long . should_equal expected.to_json

    suite_builder.group "Dataflow Error Visualization" group_builder->
        group_builder.specify "should be able to be shown in the default visualization" <|
            json = Preprocessor.default_preprocessor (Error.throw <| My_Type.Value "aaa")
            Json.parse json . should_equal <|
                JS_Object.from_pairs [["type", "My_Type"], ["constructor", "Value"], ["foo", "aaa"]]

        group_builder.specify "should be able to be shown in the default vector visualization" <|
            vec = [My_Type.Value "bar", Error.throw (My_Type.Value 42)]
            Json.parse (json_of vec) . should_equal <|
                expected_json = '''
                    [
                      {
                        "type":"My_Type",
                        "constructor":"Value",
                        "foo":"bar"
                      },
                      {
                        "type":"Error",
                        "content":{ "type":"My_Type", "constructor":"Value", "foo":42 },
                        "message":"My_Type.Value"
                      }
                    ]
                Json.parse expected_json
```

Add `import Standard.Visualization.Preprocessor` to its imports. In
`Pinned_Spec.enso` add to the preprocessor group:

```enso
        default_data "long_text" (0.up_to 2500 . map (_-> "a") . join "")
```

- [ ] **Step 2: Run them to see them fail.** Sync, build, run
      `Visualization_Tests` filtered to `Helpers_Spec`'s groups (`Table.rows`,
      `Vector and Arrays`, `Text`, `Dataflow`). Expected: compile failure or
      failures: `Viz_Json` does not exist.

- [ ] **Step 3: Create `Viz_Json.enso`.**

```enso
from Standard.Base import all
import Standard.Base.Data.Array_Proxy.Array_Proxy
from Standard.Base.Data.Json import render

## ---
   private: true
   ---
   The JSON the JSON visualization receives for a value. It must be small and
   quick to compute: a library converts a large value of its own type to a
   preview with `Viz_Json.from (that:Its_Public_Type)` in its own module.
type Viz_Json
    ## ---
       private: true
       ---
       - `json_text`: the JSON, as text.
    Value (json_text : Text)

## ---
   private: true
   ---
   The JSON of the value; if its `to_js_object` panics, its display text and
   the error.
Viz_Json.from (that:Any) =
    text = Panic.recover Any that.to_json . catch Any err->
        (JS_Object.from_pairs [["value", that.to_display_text], ["_to_js_object_error_", err.to_display_text]]).to_json
    Viz_Json.Value text

## ---
   private: true
   ---
Viz_Json.from (that:Nothing) =
    _ = that
    Viz_Json.Value '{"type": "Nothing"}'

## ---
   private: true
   ---
Viz_Json.from (that:JS_Object) = Viz_Json.Value (render that)

## ---
   private: true
   ---
   At most 100 items per level and 5 levels.
Viz_Json.from (that:Vector) = Viz_Json.Value (render_vector that)

## ---
   private: true
   ---
   At most 100 items per level and 5 levels.
Viz_Json.from (that:Array) = Viz_Json.Value (render_vector (Vector.from_polyglot_array that))

## ---
   private: true
   ---
   Text over `max_text_length` characters is cut to that length, plus `…`.
Viz_Json.from (that:Text) =
    shown = if that.length <= max_text_length then that else (that.take max_text_length) + "…"
    Viz_Json.Value shown.to_json

## ---
   private: true
   ---
   The longest text the JSON visualization receives whole.
max_text_length = 2000

## The JSON of a vector: at most `max_length` items per level; deeper than
   `max_depth` levels it is `"[...]"`.
private render_vector object depth=0 max_depth=5 max_length=100 =
    case object of
        _ : Vector -> if depth == max_depth then "[...]" else
            result = object.take max_length . map (elem-> if elem.is_error then elem.to_json else render_vector elem (depth+1) max_depth max_length)
            "[" + result.join ", " + "]"
        _ : Array ->
            proxy = Array_Proxy.new object.length object.at
            @Tail_Call render_vector (Vector.from_polyglot_array proxy) depth max_depth max_length
        _ : JS_Object -> render object depth max_depth max_length
        _ -> (Viz_Json.from object).json_text
```

- [ ] **Step 4: Switch the preprocessor.** In `Preprocessor.enso` add
      `import project.Viz_Json.Viz_Json` and change `default_preprocessor` to:

```enso
default_preprocessor x = time_visualization Preprocessor ("default_preprocessor: " + (short_display x)) <|
    ## A dataflow error shows its payload.
    value = if x.is_error then x.catch else x
    result = (Viz_Json.from value).json_text
    case result.is_error of
        True -> Helpers.truncate x.to_display_text . to_json
        False -> result
```

- [ ] **Step 5: Table, Column, Row.** In `Table.enso` add
      `import Standard.Visualization.Viz_Json.Viz_Json` and, after the
      `Viz_Cell.from (that:Table)` conversion:

```enso
## ---
   private: true
   ---
   The row count and the first 10 values of each column. A database table
   reads 10 rows first.
Viz_Json.from (that:Table) = case that.is_a In_Memory_Table of
    True ->
        text = Widget_Helpers._with_table_cache that "viz_json" <|
            max_size = 10
            cols = that.columns.map c->
                name = c.name.to_json
                items = c.to_json_data 0 max_size
                '{"name":'+name+',"data":' + items + '}'
            '{"number_of_rows":' + that.row_count.to_text + ',"columns":[' + (cols.join ",") + ']}'
        Viz_Json.Value text
    False -> Viz_Json.from (that.read 10)
```

In `Column.enso` add the import and, after `Viz_Cell.from (that:Column)`:

```enso
## ---
   private: true
   ---
   The column's length, name and first 100 values (also read from a database).
Viz_Json.from (that:Column) =
    size = ['length', that.row_count]
    name = ['name', that.name]
    data = ['data', that.read (..First 100) . to_vector]
    Viz_Json.Value (JS_Object.from_pairs [size, name, data] . to_text)
```

In `Row.enso` add the import and, after `Viz_Cell.from (that:Row)`:

```enso
## ---
   private: true
   ---
   The row's values, as a vector.
Viz_Json.from (that:Row) = Viz_Json.from that.to_vector
```

- [ ] **Step 6: XML.** In `XML.enso` add
      `from Standard.Visualization.Viz_Json import Viz_Json` next to the
      `Viz_Table` import, and at the end of the file:

```enso
## ---
   private: true
   ---
Viz_Json.from (that:XML_Document) =
    pairs = [["type", "XML_Document"], ["root_element", _element_js that.root_element False]]
    Viz_Json.Value (JS_Object.from_pairs pairs . to_json)

## ---
   private: true
   ---
Viz_Json.from (that:XML_Element) = Viz_Json.Value (_element_js that False . to_json)

## The JSON of an element: its tag, attributes and at most 50 children. A
   nested element's children are shown by their display text.
private _element_js (element : XML_Element) (nested : Boolean) -> JS_Object =
    vec = Vector.build initial_capacity=4 builder->
        builder.append ["type", "XML_Element"]
        builder.append ["tag", element.name]
        if element.attributes.length > 0 then builder.append ["attributes", element.attributes.to_js_object]
        if element.children_cache.length > 0 then
            inner_render = if nested then _.to_display_text else
                c-> case c of
                    _ : XML_Element -> _element_js c True
                    _ -> c
            builder.append ["children", element.children_cache.take 50 . map inner_render + (if element.children_cache.length > 50 then ["..."] else [])]
            builder.append ["children_count", element.children_cache.length]
    JS_Object.from_pairs vec
```

- [ ] **Step 7: Generate the long-text golden and run the tests.** Sync, build,
      run with `ENSO_UPDATE_PINNED=1` filtered to `long_text`, copy
      `data_long_text.json` back (it must be `"` + 2000 `a` + `…"`), then run
      `Visualization_Tests` and `XML_Tests` without a filter. Expected: all
      pass, and `git status` shows no change to any existing `data_*.json`
      (including Task 2.1's).

- [ ] **Step 8: Commit.**

```bash
git add -A distribution/lib/Standard test/Visualization_Tests
git commit -m "Visualization: the JSON view's data is a Viz_Json conversion"
```

### Task 2.3: Delete the old path

**Files:**

- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Helpers.enso`,
  `src/Preprocessor.enso`
- Delete: `distribution/lib/Standard/Visualization/0.0.0-dev/src/Text.enso`,
  `docs/api/Text.md`, `test/Visualization_Tests/src/Lazy_Text_Spec.enso`
- Modify: `test/Visualization_Tests/src/Main.enso`
- Modify: `distribution/lib/Standard/Table/0.0.0-dev/src/Table.enso`,
  `src/Column.enso`, `src/Row.enso`,
  `distribution/lib/Standard/XML/0.0.0-dev/src/XML.enso`
- Modify: `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`
- Regenerate: `docs/api` of Visualization, Table, XML

**Interfaces:**

- Removed: every `to_default_visualization_data`, `to_lazy_visualization_data`,
  `make_lazy_visualization_data`, `Helpers.render_vector`,
  `Preprocessor.lazy_preprocessor`, module `Standard.Visualization.Text`.

- [ ] **Step 1: Delete in Visualization.** In `Helpers.enso` delete
      `JS_Object.to_default_visualization_data`,
      `Any.to_default_visualization_data`,
      `Nothing.to_default_visualization_data`,
      `Error.to_default_visualization_data`,
      `Vector.to_default_visualization_data`, `render_vector`,
      `Array.to_default_visualization_data`, `make_lazy_visualization_data`,
      `Any.to_lazy_visualization_data`, `Text.to_default_visualization_data`,
      `Text.to_lazy_visualization_data` (with their doc comments), and the
      imports they alone used: `Array_Proxy`,
      `from Standard.Base.Data.Json import render`,
      `from project.Text import get_lazy_visualization_text_window`. Keep
      `truncate`, `short_display`, `time_visualization` and the profiling
      helpers. In `Preprocessor.enso` delete `lazy_preprocessor`. Delete
      `src/Text.enso`, `docs/api/Text.md` and `Lazy_Text_Spec.enso`, and remove
      `Lazy_Text_Spec` from `test/Visualization_Tests/src/Main.enso` (import and
      `add_specs` line).

- [ ] **Step 2: Delete in Table and XML.** In `Table.enso` delete the
      `to_default_visualization_data` method inside `type Table` (lines
      3977-3996, including the dead `JS_Object.from_pairs ... . to_text`
      statement). In `Column.enso` delete
      `Column.to_default_visualization_data`; in `Row.enso` delete
      `Row.to_default_visualization_data` and then
      `import Standard.Visualization.Helpers` if unused. In `XML.enso` delete
      `XML_Document.to_default_visualization_data` and
      `XML_Element.to_default_visualization_data`.

- [ ] **Step 3: Grep.** Run
      `git grep -n "to_default_visualization_data\|lazy_visualization\|lazy_preprocessor\|render_vector\|Visualization.Text\b" -- distribution app/gui/src engine test ':!**/docs/api/**'`.
      Expected: only `render_vector` inside `Viz_Json.enso`.

- [ ] **Step 4: Run the tests and lint.** Sync, build, run
      `Visualization_Tests`, `XML_Tests`, `Table_Tests` and `SQLite_Tests`.
      Expected: all pass, no golden changed. Run the `-Werror` lint on
      Visualization, Table, XML, Database and `test/Visualization_Tests`.
      Expected: no warnings.

- [ ] **Step 5: Docs.** Regenerate `docs/api` for Visualization, Table and XML
      (check: `Viz_Json.md` appears; `Text.md` is gone; no
      `to_default_visualization_data` in any `docs/api`). In
      `Visualization/0.0.0-dev/CLAUDE.md`: under "Data types" add

```markdown
- `Viz_Json` (`src/Viz_Json.enso`) - the JSON the JSON visualization receives,
  kept small: Base values here (text over 2000 characters is cut, vectors to 100
  items and 5 levels), a library's large types by
  `Viz_Json.from (that:Its_Public_Type)` (Table: 10 rows; Column: 100 values;
  XML: the element tree).
```

and under "Main entry points" change the `default_preprocessor` line to say it
returns `(Viz_Json.from value).json_text`.

- [ ] **Step 6: Commit, push, open PR 2.** Commit ("Visualization: delete
      to_default_visualization_data and the lazy-text path"), push
      `viz/viz-json`, and open the PR against `viz/id-conversion` (retarget it
      to `develop` before PR 1 merges, then rebase with
      `git rebase --onto origin/develop <PR 1's last commit>`). Label
      `CI: No changelog needed`.

---

## Final verification (both PRs)

- [ ] Layering grep on PR 2's branch:
      `git grep -n "default_visualization\|to_default_visualization_data" -- distribution app/gui/src engine`
      → no output.
- [ ] CI green on both PRs, including `stdlib-api-check`, Workflow Lint and the
      GUI checks on PR 1.
- [ ] Installer for PR 1 (owner): an Image node (`Image.read` of a PNG) opens in
      the Image visualization; an in-memory table opens in Table, a SQLite table
      in SQL Query, a `JS_Object` in JSON, a number in Table.
