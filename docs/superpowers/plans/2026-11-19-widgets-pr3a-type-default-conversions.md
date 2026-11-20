# Widgets PR 3a: Type Defaults as Conversions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every type's default widget is a conversion,
`Widget.from (that : X.type)`, instead of a static `X.default_widget` method,
and Base gains `Widget_Query.resolve_type`, the entry point PR 3b's GUI will
call once per type. Nothing a user sees changes.

**Architecture:** For 24 types (spec groups A and B, less the two unused ones)
the body of `default_widget` moves unchanged into a module-level conversion; its
extra parameters (group B) become extra defaulted arguments of the conversion.
Every call site is rewritten mechanically (`X.default_widget` →
`(Widget.from X)`), so every annotation keeps giving the same widget and the
GUI, which still queries only annotated arguments, sees identical answers.
`resolve_type` evaluates `Widget.from` on a type object and answers in the shape
`resolve_call` uses for one argument.

**Tech Stack:** Enso (standard libraries, test suites), Java (engine tests only
if a conversion fails to resolve), Node (one-off rewrite script).

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§1,
§2 "Type defaults by conversion", §6 "Entry points"; PR table row 3, split into
3a and 3b by the owner on 2026-11-19).

**Depends on:** PR 0 (#887, `X.type` conversions), PR 1a (#889, `Widget_Query`),
PR 2 (#896, merged 46e2324cd0). Start from `origin/develop` at or after
46e2324cd0. #897's fix PR (broken annotations, incl.
`Index_Sub_Range.default_options` and the Excel `default.widget` typo) may land
first or after; if after, rebase and re-run Task 3's rewrite on the files it
touched.

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr3a`, branch
  `widgets/pr3a-type-default-conversions`, from `origin/develop`. Linux clone
  for builds and stdlib runs: `~/enso-widgets-pr3a` on WSL `Ubuntu-24.04`
  (source `~/.enso-toolchain.sh` first). Delete both when the PR merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree.
- **Behaviour-preserving.** Every annotation gives exactly the JSON it gave
  before. No GUI file changes in this PR.
- **Changelog: none.** Open the PR with the `CI: No changelog needed` label.
- Conversion form, exactly: a module-level
  `Widget.from (that : X.type) <extra args…> -> Widget = …` in the module that
  defines `X`. No `Widget.from (that : Any)` anywhere (it would catch every
  type, spec §2).
- Call-site form: `(Widget.from X)`, or `(Widget.from X name=value …)` with
  named extra arguments. Inside a lambda:
  `(self-> Widget.from Index_Sub_Range count=self.length)`.
- **Group C keeps `default_widget` until PR 6** (owner decision 2026-11-19):
  `Simple_Expression`, `Generate_Rows_Range`, `Google_Analytics_Account_Filter`,
  `Google_Analytics_Property`, and also `DuckDB_GeoFormat` (it reads a
  connection, so it is group C too). Do not touch them or their call sites, nor
  `make_fill_nothing_default_widget` (`Table.enso`).
- `lintEnso` runs with `-Werror`: `sbt "all lintEnso"` must stay green.
- Stdlib suites are only valid against a full distribution
  (`ciBuildEngineDistribution` then the stdlib test runner); a NoIndex
  distribution lacks the test-helper jars and gives ~238 false failures.
- Avoid `Vector` allocation in new Enso code where a direct lookup works (owner
  rule).

## The 24 types

Paths are relative to `distribution/lib/Standard/`; line numbers are those of
`default_widget` on 46e2324cd0.

| #   | Type               | File:line                                                      | Extra arguments                                                                                                                                     |
| --- | ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Locale             | `Base/0.0.0-dev/src/Data/Locale.enso:593`                      | —                                                                                                                                                   |
| 2   | Return_As          | `Base/0.0.0-dev/src/Data/Read/Return_As.enso:69`               | —                                                                                                                                                   |
| 3   | Case               | `Base/0.0.0-dev/src/Data/Text/Case.enso:50`                    | —                                                                                                                                                   |
| 4   | Encoding           | `Base/0.0.0-dev/src/Data/Text/Encoding.enso:25`                | —                                                                                                                                                   |
| 5   | Text_Sub_Range     | `Base/0.0.0-dev/src/Data/Text/Text_Sub_Range.enso:73`          | —                                                                                                                                                   |
| 6   | Duration           | `Base/0.0.0-dev/src/Data/Time/Duration.enso:113`               | —                                                                                                                                                   |
| 7   | Time_Zone          | `Base/0.0.0-dev/src/Data/Time/Time_Zone.enso:214`              | —                                                                                                                                                   |
| 8   | Email_Address      | `Base/0.0.0-dev/src/Network/Email/Email_Address.enso:21`       | —                                                                                                                                                   |
| 9   | Email_Attachment   | `Base/0.0.0-dev/src/Network/Email/Email_Attachment.enso:19`    | —                                                                                                                                                   |
| 10  | Email_Provider     | `Base/0.0.0-dev/src/Network/Email/Email_Provider.enso:28`      | —                                                                                                                                                   |
| 11  | Header             | `Base/0.0.0-dev/src/Network/HTTP/Header.enso:296`              | — (returns a `Vector_Editor`)                                                                                                                       |
| 12  | File_Format        | `Base/0.0.0-dev/src/System/File_Format.enso:188`               | —                                                                                                                                                   |
| 13  | Connection_Options | `Database/0.0.0-dev/src/Connection/Connection_Options.enso:30` | — (returns a `Vector_Editor`)                                                                                                                       |
| 14  | Google_Credential  | `Google/0.0.0-dev/src/Google_Credential.enso:69`               | —                                                                                                                                                   |
| 15  | Azure_Blob_Storage | `Microsoft/0.0.0-dev/src/Azure_Storage.enso:64`                | — (the spec's "Azure_Storage")                                                                                                                      |
| 16  | AWS_Region         | `AWS/0.0.0-dev/src/AWS_Region.enso:35`                         | —                                                                                                                                                   |
| 17  | Columns_To_Add     | `Table/0.0.0-dev/src/Columns_To_Add.enso:17`                   | —                                                                                                                                                   |
| 18  | Columns_To_Keep    | `Table/0.0.0-dev/src/Columns_To_Keep.enso:33`                  | —                                                                                                                                                   |
| 19  | Join_Kind          | `Table/0.0.0-dev/src/Join_Kind.enso:45`                        | —                                                                                                                                                   |
| 20  | Rows_To_Read       | `Table/0.0.0-dev/src/Rows_To_Read.enso:26`                     | —                                                                                                                                                   |
| 21  | Filter_Condition   | `Base/0.0.0-dev/src/Data/Filter_Condition.enso:302`            | `include_comparable include_text include_boolean include_nullable include_numeric include_date include_time include_date_time` (all `Boolean=True`) |
| 22  | Index_Sub_Range    | `Base/0.0.0-dev/src/Data/Index_Sub_Range.enso:108`             | `count:(Integer\|Nothing)=Nothing`                                                                                                                  |
| 23  | AWS_Credential     | `AWS/0.0.0-dev/src/AWS_Credential.enso:133`                    | `add_user_password:Boolean=False`                                                                                                                   |
| 24  | Credentials        | `Database/0.0.0-dev/src/Connection/Credentials.enso:27`        | `include_nothing:Boolean=True`                                                                                                                      |

Also in this PR:

- `Date.default_widget` (`Base/…/Data/Time/Date.enso:1169`) and
  `Time_Of_Day.default_widget` (`Base/…/Data/Time/Time_Of_Day.enso:577`) have
  **no call sites**: delete them. Their type defaults arrive in PR 3b as
  `Date_Input` / `Time_Input` (the spec lists them in both group B and group D;
  group D wins, and the unused `include_today` / `include_now` options go).
- `Spatial_Join_Condition.default_widget` (`Table/…/Spatial_Table.enso:620`) is
  not a type default (it returns a `Choice.Option`, takes selectors, and is
  called only from `Table/…/Internal/Widget_Helpers.enso:246`): rename it to
  `widget_option` (still private) and update that one call.
- `Locale.enso:610`'s reflective `methods_to_remove` list names
  `"default_widget"`: remove that entry (otherwise `predefined_locale_fields` is
  unaffected; the conversion is not a method of `Locale`).

---

## Task 1: `Widget_Query.resolve_type`

**Files:**

- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata/Widget_Query.enso`
- Test: `test/Base_Tests/src/Widget_Query_Spec.enso`
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md` (widget section,
  lines ~67-98)

**Interfaces:**

- Produces: `Widget_Query.resolve_type (type_name : Text) -> Text`. Answer:
  `{"widget":<widget JSON>}`, `{"widget":null}` (no conversion: the type has no
  default), or `{"error":{"step":"lookup"|"type_default","message":…}}`. PR 3b
  calls it in a node's frame as
  `Standard.Base.Meta.call_module_method 'Standard.Base.Metadata.Widget_Query' 'resolve_type' [] '<qualified type name>'`
  (the type name is the value, so `call_module_method` passes it first).

- [ ] **Step 1: Write the failing tests.** In `Widget_Query_Spec.enso`, add a
      test-local type with a conversion, one without, and a failing one, next to
      `Sample`:

```enso
type Has_Default
    Value

Widget.from (that : Has_Default.type) (with_extra : Boolean = False) -> Widget =
    Widget.Single_Choice values=(if with_extra then [Option "A" "a", Option "B" "b"] else [Option "A" "a"])

type No_Default
    Value

type Broken_Default
    Value

Widget.from (that : Broken_Default.type) -> Widget = Error.throw (Illegal_State.Error "broken on purpose")
```

and a group:

```enso
    suite_builder.group "Widget_Query.resolve_type" group_builder->
        group_builder.specify "answers a type's default widget" <|
            expected = '{"widget":' + (Widget.from Has_Default).to_json + '}'
            Widget_Query.resolve_type spec_module+".Has_Default" . should_equal expected
        group_builder.specify "answers null for a type without a default" <|
            Widget_Query.resolve_type spec_module+".No_Default" . should_equal '{"widget":null}'
        group_builder.specify "answers a lookup error for an unknown type" <|
            json = Widget_Query.resolve_type spec_module+".Nope" . parse_json
            json.get "error" . get "step" . should_equal "lookup"
        group_builder.specify "answers a type_default error when the conversion fails" <|
            json = Widget_Query.resolve_type spec_module+".Broken_Default" . parse_json
            json.get "error" . get "step" . should_equal "type_default"
            json.get "error" . get "message" . should_contain "broken on purpose"
        group_builder.specify "a failing type default's log entry names the type" <|
            method = Widget_Method.Value spec_module+".Broken_Default" spec_module+".Broken_Default" "from"
            result = Widget_Query.resolve_type_argument method spec_module+".Broken_Default"
            result.failure.step . should_equal "type_default"
            result.failure.log_text . should_contain "The default widget of "+spec_module+".Broken_Default"
            inputs = "test inputs " + Random.uuid
            Widget_Query.log_failure result.failure inputs . should_be_true
            Widget_Query.log_failure result.failure inputs . should_be_false
```

      (`resolve_type_argument` is defined in Step 3, exposed like
      `resolve_argument` for the existing log tests. Add
      `from Standard.Base.Metadata.Choice import Option` if not already
      imported.)

- [ ] **Step 2: Run, verify they fail** (`resolve_type` does not exist). In the
      Linux clone: build the distribution, then run `Base_Tests` filtered to
      `"Widget_Query.resolve_type"`. Compare the log length with an unfiltered
      run: a filter that matches nothing exits 0.

- [ ] **Step 3: Implement.** In `Widget_Query.enso`, after `resolve_call`:

```enso
## ---
   private: true
   ---
   The IDE's query for a type's default widget: the `Widget.from` conversion
   of the type object, evaluated with every extra argument at its default.
   The IDE asks it once per type per session and caches the answer.

   ## Arguments
    - `type_name`: The type's qualified name.

   ## Returns
   `{"widget":<widget or null>}` (`null`: the type has no default) or
   `{"error":{"step":"lookup"|"type_default","message":…}}`. Failures are
   logged once, as `resolve_call`'s are.
resolve_type (type_name : Text) -> Text =
    method = Widget_Method.Value type_name type_name "from"
    Progress.run label=type_name up_to=1 handle_name="Widget_Query.resolve_type "+type_name action=_->
        result = resolve_type_argument method type_name
        _ = case result of
            Argument_Result.Failed failure -> log_failure failure "type"
            _ -> False
        result.to_json

## ---
   private: true
   ---
   `resolve_type`'s result before it is logged (exposed for the tests).
resolve_type_argument (method : Widget_Method) (type_name : Text) -> Argument_Result =
    Panic.catch Any handler=(caught-> Argument_Result.Failed (_failure_from_panic method "" caught step="type_default")) <|
        typ = Meta.find_type_or_module type_name
        if typ.is_error then Argument_Result.Failed (_failure_from_error method "" "lookup" typ) else
            widget = Widget.from typ
            if widget.is_error && (widget.catch . is_a No_Such_Conversion) then Argument_Result.Resolved Nothing "null" else
                _as_result method "" widget step="type_default"
```

      Implementation notes for this step:
      - `_as_result` and `_failure_from_panic` label failures `"annotation"`;
        give each a trailing `(step : Text = "annotation")` parameter and use it
        in place of the literal, so `resolve_call` is unchanged.
      - `Widget_Failure.log_text` says "The widget of `<argument>` of
        <qualified_name>": for `resolve_type` (argument `""`) make it say
        "The default widget of <type_name>" instead. Keep one `log_text`; branch
        on `self.argument == ""`.
      - Import `No_Such_Conversion` (`project.Errors.Common.No_Such_Conversion`).
      - The Widget's `to_json` already exists; a type default that returns a
        non-`Widget` is a `type_default` failure, as in `_as_result`.

- [ ] **Step 4: Run, verify they pass**, then the whole `Widget_Query_Spec`.

- [ ] **Step 5: Docs.** In Base's `CLAUDE.md` widget section, add a paragraph
      "Type defaults": a type's default widget is
      `Widget.from (that : X.type) …` in `X`'s module; extra defaulted arguments
      are tweaks (`Widget.from Filter_Condition include_text=False`);
      `resolve_type` answers it for the GUI; group C types keep `default_widget`
      until PR 6.

- [ ] **Step 6: Commit**
      `Widget_Query.resolve_type: a type's default widget by conversion`.

## Task 2: Convert the 24 types

**Files:** the 24 files in the table above, plus `Date.enso`,
`Time_Of_Day.enso`, `Spatial_Table.enso`,
`Table/…/Internal/Widget_Helpers.enso`, `Locale.enso` (the `methods_to_remove`
entry).

**Test:** `test/Base_Tests/src/Type_Default_Spec.enso` (create; register in
`test/Base_Tests/src/Main.enso` next to `Widget_Query_Spec`), and a group in
`test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso` for the four Table
types.

**Interfaces:**

- Consumes: Task 1's `resolve_type`.
- Produces: `Widget.from X` for the 24 types; Task 3 rewrites call sites to it.

- [ ] **Step 1: Capture the old widgets.** Before editing any type, in the Linux
      clone on the branch's starting commit, run a scratch Enso program (in the
      scratchpad, not committed) that prints `X.default_widget.to_json` for each
      of the 24 (group B with defaults, plus
      `Filter_Condition.default_widget include_text=False include_boolean=False`,
      `Index_Sub_Range.default_widget 10`,
      `AWS_Credential.default_widget add_user_password=True`,
      `Credentials.default_widget include_nothing=False`) to one file,
      `before.txt`, one `<label>\t<json>` line each. SPI-driven types
      (`Return_As`, `Email_Provider`, `File_Format`) depend on the loaded
      libraries: import `Standard.Table`, `Standard.Database`, `Standard.AWS`,
      `Standard.Google`, `Standard.Microsoft` in the program so the lists are
      complete, and keep the same imports for Step 6.

- [ ] **Step 2: Write the failing tests.** `Type_Default_Spec.enso`, one test
      per Base type; for each, the conversion gives a `Widget` and
      `resolve_type` answers it:

```enso
from Standard.Base import all
import Standard.Base.Metadata.Widget
import Standard.Base.Metadata.Widget_Query

from Standard.Test import all

check_default typ =
    widget = Widget.from typ
    widget.should_be_a Widget
    type_name = Meta.meta typ . qualified_name
    Widget_Query.resolve_type type_name . should_equal '{"widget":' + widget.to_json + '}'

add_specs suite_builder =
    suite_builder.group "Type defaults by conversion" group_builder->
        group_builder.specify "Locale" <| check_default Locale
        group_builder.specify "Return_As" <| check_default Return_As
        group_builder.specify "Case" <| check_default Case
        group_builder.specify "Encoding" <| check_default Encoding
        group_builder.specify "Text_Sub_Range" <| check_default Text_Sub_Range
        group_builder.specify "Duration" <| check_default Duration
        group_builder.specify "Time_Zone" <| check_default Time_Zone
        group_builder.specify "Email_Address" <| check_default Email_Address
        group_builder.specify "Email_Attachment" <| check_default Email_Attachment
        group_builder.specify "Email_Provider" <| check_default Email_Provider
        group_builder.specify "Header" <| check_default Header
        group_builder.specify "File_Format" <| check_default File_Format
        group_builder.specify "Filter_Condition" <| check_default Filter_Condition
        group_builder.specify "Index_Sub_Range" <| check_default Index_Sub_Range
        group_builder.specify "Filter_Condition takes its options as extra arguments" <|
            all = Widget.from Filter_Condition
            fewer = Widget.from Filter_Condition include_text=False include_boolean=False
            (fewer.values.length < all.values.length) . should_be_true
        group_builder.specify "Index_Sub_Range takes count" <|
            (Widget.from Index_Sub_Range count=10).to_json . should_not_equal (Widget.from Index_Sub_Range).to_json
        group_builder.specify "Date and Time_Of_Day have no default until PR 3b" <|
            Widget_Query.resolve_type "Standard.Base.Data.Time.Date.Date" . should_equal '{"widget":null}'
        group_builder.specify "a group C type has no conversion" <|
            Widget.from Text . should_fail_with No_Such_Conversion

main filter=Nothing =
    suite = Test.build suite_builder-> add_specs suite_builder
    suite.run_with_filter filter
```

      Import each type the spec names that `from Standard.Base import all`
      does not export (e.g. `Return_As`, `Email_*`, `Header`, `Text_Sub_Range`,
      `Index_Sub_Range`) by its module path. The `Text` check pins
      that there is no `Widget.from (that : Any)`; when PR 3b adds group D it
      changes that line to a group C type (`Simple_Expression`, in Table).
      In `Table_Widgets_Spec.enso` add the same `check_default` for
      `Columns_To_Add`, `Columns_To_Keep`, `Join_Kind`, `Rows_To_Read`. Database,
      Google, Microsoft and AWS types are covered by Step 6's comparison and by
      their call sites (Task 3); add a `check_default` to an existing widget
      spec of that library only if one exists (`SQLite_Tests/src/Widgets_Spec.enso`
      for `Connection_Options` and `Credentials`).

- [ ] **Step 3: Run, verify they fail** with `No_Such_Conversion`.

- [ ] **Step 4: Convert.** For each type, move the body of `default_widget` out
      of the `type` block into a module-level conversion directly after the
      type, keeping its doc comment (reworded: "The default widget for arguments
      of type X."), with `private: true` front matter as before. Example,
      `Join_Kind.enso`:

```enso
## ---
   private: true
   ---
   The default widget for arguments of type `Join_Kind`.
Widget.from (that : Join_Kind.type) -> Widget =
    make_single_choice [...same list as before...]
```

      Group B keeps its parameters, in the same order, with the same types and
      defaults, after `that`:

```enso
Widget.from (that : Index_Sub_Range.type) (count : Integer | Nothing = Nothing) -> Widget =
    Widget.Single_Choice (Index_Sub_Range.default_options count)
```

      References *inside* bodies change too: `Header`'s nested
      `["encoding", Encoding.default_widget]` (line 304) becomes
      `["encoding", Widget.from Encoding]`; `Text_Sub_Range`'s body keeps
      calling `Index_Sub_Range.default_options` (not a widget). Delete
      `Date.default_widget`, `Time_Of_Day.default_widget`; rename
      `Spatial_Join_Condition.default_widget` → `widget_option` and its caller;
      drop `"default_widget"` from `Locale.enso`'s `methods_to_remove`. Each
      module must import `Widget` (most already do, for the return type).

- [ ] **Step 5: Run, verify the tests pass.** If a conversion on a type from
      another library (e.g. `Join_Kind`) is not found from Base's
      `resolve_type`, stop: PR 0's resolution should find conversions in the
      source type's module once it is loaded. Reproduce in an engine test next
      to `EigentypeConversionTest.java` before changing anything.

- [ ] **Step 6: Compare old and new.** Re-run Step 1's program with each line
      changed from `X.default_widget …` to `Widget.from X …` into `after.txt`;
      `diff before.txt after.txt` must be empty. Record the result in the task
      report.

- [ ] **Step 7: Commit** `Type defaults: Widget.from conversions for 24 types`
      (the call sites still say `default_widget` and fail to compile only at
      evaluation; Task 3 follows in the same PR).

## Task 3: Rewrite every call site

**Files:** every file `rg -l 'default_widget' distribution/lib/Standard test`
lists, except group C's and `make_fill_nothing_default_widget`'s (about 230
sites across Base, Table, Database, AWS, Google, Microsoft, DuckDB, Postgres,
Snowflake, SQLite, Tableau, XML, Excel/Table). Also
`test/Base_Tests/src/Base_Widgets_Spec.enso:10` and the comment at
`app/gui/integration-test/project-view/dataReadImports.spec.ts:20` (comment
only: `File_Format.default_widget` → `Widget.from File_Format`).

**Interfaces:**

- Consumes: Task 2's conversions.

- [ ] **Step 1: Write the rewrite script** (scratchpad, Node, not committed).
      For the 24 type names only, rewrite these forms (the research list on
      46e2324cd0 is exhaustive; the script must report any `default_widget` it
      does not match, and there must be none outside group C):

| Before                                                          | After                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@arg X.default_widget`                                         | `@arg (Widget.from X)`                                             |
| `@arg (X.default_widget)`                                       | `@arg (Widget.from X)`                                             |
| `@arg X.default_widget a=b c=d`                                 | `@arg (Widget.from X a=b c=d)`                                     |
| `@range (self-> Index_Sub_Range.default_widget self.length)`    | `@range (self-> Widget.from Index_Sub_Range count=self.length)`    |
| `@range (self-> Index_Sub_Range.default_widget self.row_count)` | `@range (self-> Widget.from Index_Sub_Range count=self.row_count)` |
| `Vector_Editor X.default_widget item_default=…`                 | `Vector_Editor (Widget.from X) item_default=…`                     |
| `["locale", Locale.default_widget]`                             | `["locale", Widget.from Locale]`                                   |
| `Text_Sub_Range.default_widget.to_json` (test)                  | `(Widget.from Text_Sub_Range).to_json`                             |

      Where a rewritten module does not import `Widget`, add
      `import Standard.Base.Metadata.Widget` (inside Base:
      `import project.Metadata.Widget`), sorted with the other imports as the
      module sorts them.

- [ ] **Step 2: Run it**, then
      `rg -n 'default_widget' distribution test app/gui` — the only hits left
      are group C (`Simple_Expression`, `Generate_Rows_Range`,
      `Google_Analytics_Account_Filter`, `Google_Analytics_Property`,
      `DuckDB_GeoFormat`), their call sites, and
      `make_fill_nothing_default_widget`. Paste the output in the task report.

- [ ] **Step 3: Lint.** `sbt "all lintEnso"` (green; unused-import warnings are
      errors, so a now-unused import of a type whose only use was
      `X.default_widget` must go).

- [ ] **Step 4: Behaviour check through the query.** Build the distribution and
      run, for every rewritten annotation, the GUI's own query on develop's
      distribution and on the branch's, and diff. Generate the Enso program from
      the script's site list: one
      `Widget_Query.resolve_call <subject> <module> <type> <method> [<arg>] subject_is_type=True`
      per site (subject: the type, `Meta.find_type_or_module`), printing
      `<site>\t<json>`. Lambda sites (`self-> … self.length`) need a value: use
      `[1, 2, 3]` for Vector/Array, `(Table.new [["a", [1, 2]]])` and its
      `.at "a"` for Table/Column. Expected: identical output, except that sites
      #897 fixed differ only if #897 merged between the two builds (then build
      "before" from develop including #897). Paste the diff (empty) in the
      report.

- [ ] **Step 5: Run the suites** in the Linux clone against the full
      distribution: `Base_Tests`, `Table_Tests`, `SQLite_Tests`,
      `Format_Discovery_Tests`, `Geo_Tests`, `DuckDB_Tests`, plus the
      widget-related engine test
      `runtime-integration-tests/testOnly *EigentypeConversionTest*`. Compare
      any failure with develop before attributing it.

- [ ] **Step 6: Commit** `Type defaults: call sites use Widget.from`.

## Task 4: Generated API docs and the PR

**Files:** `distribution/lib/Standard/*/0.0.0-dev/docs/api/**/*.md` (31 files
list `default_widget` on 46e2324cd0), `docs/superpowers/specs/…` untouched.

- [ ] **Step 1: Regenerate** the API docs of every library that changed:
      `built-distribution/enso-engine-*/enso-*/bin/enso --docs api --in-project distribution/lib/Standard/<Lib>/0.0.0-dev`
      (as `tools/build-scripts` `stdlib-api-check` does), then
      `corepack pnpm --filter build-scripts run stdlib-api-check` — green.
      Conversions appear in the API docs; check the diff shows each
      `default_widget` line replaced by a `Widget.from` conversion line and
      nothing else.

- [ ] **Step 2: Final checks.** `sbt "all lintEnso"`; `rg default_widget` as in
      Task 3 Step 2; `git diff --stat origin/develop` lists no `app/gui/src`
      file.

- [ ] **Step 3: Commit, push, open the PR** against `develop`, title "Widgets PR
      3a: type defaults are `Widget.from` conversions", label
      `CI: No changelog needed`, body: what moved, the 24 types, the five group
      C types kept for PR 6, the two deleted unused methods, the renamed
      `Spatial_Join_Condition` helper, and Task 2 Step 6 / Task 3 Step 4
      comparisons (empty diffs). No screenshots: no UI change (state so).

- [ ] **Step 4: CI green → merge** (an invisible change merges on green;
      `gh pr merge --squash`, no `--delete-branch`), then remove the worktree,
      the branch and `~/enso-widgets-pr3a`.
