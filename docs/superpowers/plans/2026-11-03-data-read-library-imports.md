# Data.read Library Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Picking a file format in `Data.read`'s `format` dropdown adds the
import of the library that provides the format, and with `format` left on
`Auto_Detect`, choosing or typing a path adds the import of the library whose
format reads that file. The inserted code stays the short `..X` form, imports
are only ever added, and one undo removes the change and its import together
(issue #489).

**Architecture:** Three tasks, each its own PR against `develop` from its own
worktree and branch. Task 1 (standard library) gives `Choice.Option` two
optional fields, `requires` and `patterns`, emitted in its JSON only when set,
and fills them for every registered format through one new helper,
`File_Format.dropdown_options`, which all three format dropdowns use
(`File_Format.default_widget` for `Data.read`, `Data.read_many`, `File.read` and
`Enso_File.read`; `Data_Read_Helpers.format_widget_with_raw_response` for
`Data.fetch`, `Data.post`, `Data.fetch_many`, `Data.fetch_pages`, `URI.fetch`
and `URI.post`; `decode_format_selector` for `Response.decode`). Task 2 (GUI)
parses the fields, resolves a `requires` type name to a `RequiredImport`
(`requiredImportsForTypeName` in `module/imports.ts`), attaches it to the
dropdown's `ExpressionTag` so the existing `resolveExpression` adds it in the
choice's edit, and adds a path hook to `WidgetFunction.handleArgUpdate`, the one
handler that sees every argument's update and every sibling's widget
configuration. Task 3 adds the Playwright tests, the before/after screenshots
and the changelog entry.

**Tech Stack:** Enso (`distribution/lib/Standard/Base`; `test/Base_Tests`,
`test/Base_Internal_Tests`, `test/Visualization_Tests`), TypeScript and Vue
(`app/gui`: zod, vitest, Playwright with the mock language server).

**Spec:**
`docs/superpowers/specs/2026-11-03-data-read-library-imports-design.md`
(binding; its decisions are the owner's). "Rulings made while planning" below
records where the code differs from it.

## Global Constraints

- The spec's decisions stand: the format's library is enough (no import by a
  node's result type); a format pick adds its library's import and the code
  stays `..X`; with `Auto_Detect` a path adds the import of the one library
  whose format reads it; imports are only ever added, never removed.
- Verify on Linux (WSL; source `~/.enso-toolchain.sh` first, and give cargo its
  own `CARGO_TARGET_DIR`) as well as on Windows, as the root `CLAUDE.md` says.
- Unset the credential environment variables before any test run:
  `for v in $(env | cut -d= -f1 | grep -E '^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS)'); do unset "$v"; done`.
- Never run `git stash` in any form, `git reset --hard`, a force-push or
  `--no-verify`; leave `.claude/settings.local.json` out of commits.
- PR bodies are written with the Write tool to a file and passed with
  `gh pr create --body-file <file>`, and end with the session's attribution.
- Commit messages end with exactly these two lines:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01W2j2Zioa1Myqz64zpZjcvN
  ```

- The changelog entry goes on Task 3 only, the final, visible task; Tasks 1 and
  2 take the `CI: No changelog needed` label when their PR is opened.
- TypeScript changes pass `corepack pnpm --filter enso-gui run typecheck`,
  `run lint` and `run test:unit`, and `corepack pnpm exec prettier --check` on
  the changed files. Delete `*.tsbuildinfo` and `.eslintcache` first (root
  `CLAUDE.md`).
- An Enso test run starts in `test/` with `-enableassertions` and checks that
  the filter ran tests (a filter that matches nothing exits 0 with
  `0 tests failed.`).
- Each task's worktree is deleted when its PR has merged; a WSL clone made for
  verification is deleted when the task's checks are done (agent clones once
  filled the disk).

## Rulings made while planning

- **Three PRs; Task 1 merges on green, Tasks 2 and 3 are stacked and merge after
  the owner's OK.** Task 2 is testable without Task 1: its vitest cases feed the
  JSON the GUI parses, and Task 3's Playwright runs against the mock language
  server, not the engine. Task 1 alone changes nothing users see: the GUI parses
  choices with a plain `z.object` (`configuration.ts:46`), which strips unknown
  keys, so the two new keys are dropped until Task 2. Task 2 is where behaviour
  changes, so it does not merge alone: Task 3 branches from Task 2, and when the
  owner approves, Task 3's PR is retargeted to `develop` before Task 2 merges,
  then Task 3 merges (the stacked-PR order the project uses). Task 2 takes the
  label; Task 3 carries the entry.
- **The spec names the wrong widget for `Data.read`.** `Data.read` and
  `File.read` use `File_Format.default_widget` (`System/File_Format.enso:178`;
  `@format` at `Data.enso:103`, `:173` for `read_many`, `System/File.enso:315`,
  `Enso_Cloud/Enso_File.enso:494`). `format_widget_with_raw_response`
  (`Internal/Data_Read_Helpers.enso:64`) serves the lines the spec lists, which
  are `Data.fetch` (`Data.enso:357`), `Data.post` (`:496`), `Data.fetch_many`
  (`:587`), `Data.fetch_pages` (`:670`), `URI.fetch` and `URI.post`
  (`Network/Extensions.enso:52`, `:101`). Task 1 fills the fields in one helper,
  `File_Format.dropdown_options (fixed) (registered = File_Format_SPI.get_types)`,
  and makes `default_widget`, `format_widget_with_raw_response` and
  `decode_format_selector` (`Network/HTTP/Response_Body.enso:226`, the same
  dropdown for `Response.decode`) all use it, so every format dropdown behaves
  the same. Only `Data.read` (and `Data.read`-like calls, below) gets the path
  half.
- **`Auto_Detect` does not read files by `get_name_patterns`.** It asks each
  format's `for_read` (`System/File_Format.enso:74`), which looks at the content
  type, the extension through `File_Format_Metadata.guess_extension` (which
  lower-cases it, `System/File_Format_Metadata.enso:63`) and, for SQLite, the
  file's magic header. The patterns (`*.db`, `*.sqlite`, …) feed
  `name_filter_widget` for `File.list`, and for every shipped format they list
  the same extensions `for_read` checks. They are still the right data for the
  IDE, which cannot read the file; the risk is a third-party format whose
  patterns and `for_read` disagree, and the spec's "adds nothing" fallback
  covers it.
- **Pattern semantics: `*` any run of characters, `?` one character, everything
  else literal, case ignored, matched against the file name only.**
  `File_Name_Pattern` patterns follow `File.list`'s `name_filter`, which is
  Java's `PathMatcher` `glob:` (`File_Utils.matchPath`): case-sensitive on Linux
  and not on Windows. The IDE follows `Auto_Detect` instead, which ignores case
  on every platform, as the spec's risk section asks ("case-insensitive on
  extensions"). No shipped pattern uses `[…]`, `{…}` or `**`
  (`_combine_patterns` forbids `{` and `,`), so those are matched literally. The
  file name is the text after the last `/` or `\`, with a URL's `?query` and
  `#fragment` removed.
- **"Exactly one option matches" means exactly one distinct `requires`.** One
  format type can give several options: Excel gives `..Workbook`, `..Sheet` and
  `..Range` (`Table/…/Excel/Excel_Format.enso:112`), Tableau gives two
  (`Tableau_Format.enso:73`). Each carries the same `requires` and `patterns`,
  so `Sales.xlsx` matches three options and one library. Counting options would
  make every Excel file "ambiguous"; counting types is what the spec means by
  "the library whose format would read that file".
- **The sibling configuration needs no new plumbing.** `WidgetFunction`'s
  `application` is an `ArgumentApplication` whose every argument carries its own
  `dynamicConfig`, taken from the call's whole widget configuration
  (`ArgumentFactory.dynamicConfig`, `util/callTree.ts:63`, reading
  `widgetCfg.parameters.get(name)`). `Data.read` annotates both `path` and
  `format` (`@path`, `@format`), so one widget query returns both, and every
  update from inside the call passes through `WidgetFunction.handleArgUpdate`
  (`WidgetFunction.vue:106`) on its way up. The path hook lives there, in a new
  pure module `WidgetFunction/formatForPath.ts`, and needs nothing from
  `WidgetFileBrowser.vue`.
- **The path argument is the argument named `path`, the format the one named
  `format`.** That is `Data.read`'s signature. `Data.fetch`'s `uri` and
  `read_many`'s `paths` are out of the path half: the spec's decision names the
  path of `Data.read`, and a URL rarely ends in a file name. `File.read` has no
  path argument (the file is `self`).
- **Three ways a path changes, all handled by `formatTypeForPathUpdate`.** (1)
  The file browser sets a placeholder or replaces the argument
  (`browsableTypes.ts` `widgetUpdate`, a `portUpdate` whose origin is the path's
  port). (2) It replaces the text literal inside `File.new '…'` (a `portUpdate`
  whose origin is inside the argument). (3) Typing into an existing literal
  edits it in place and sends `{ edit }` with no `portUpdate`
  (`WidgetText.vue:32-36`): the spec's "or typing" is only caught by comparing
  the argument's text before and in `edit`. An update whose new text equals the
  old adds nothing, so changing `on_problems` never adds an import.
- **`format` counts as `Auto_Detect` when absent or when its code is
  `..Auto_Detect` or a name whose last segment is `Auto_Detect`.** The
  dropdown's own `Auto Detect` option inserts the qualified
  `Standard.Base.System.File_Format.Auto_Detect` (`System/File_Format.enso:92`).
- **Resolving `requires`: the suggestion database first, then the declared
  public types, else nothing and a `console.debug`.** Catalogue entries are
  suggestion entries (`fromCatalogue`, `suggestionDatabase/entry.ts:54`), so one
  `getEntryByProjectPath` covers both the loaded and the catalogued case, and
  `requiredImports` turns a type entry into `from <reexport> import <Name>`. A
  library that is installed but neither loaded nor catalogued is still known by
  its `package.yaml` `public-types:` (`suggestionDb.libraryPublicTypes`, the
  data the unresolved-name detector already uses): `SQLite_Format` is declared
  by `Standard.SQLite`. That fallback only counts the library named in the
  qualified name. The resolver is `requiredImportsForTypeName` in
  `module/imports.ts`, beside `requiredImports` and
  `requiredImportsByProjectPath`.
- **`requires` only fills in imports that the tag does not already have.** An
  option whose value is a qualified name with a suggestion entry (XML's is
  `Standard.Base.Data.XML.XML_Format.XML_Format`, not `..XML` as the spec says)
  already gets that entry's imports from `ExpressionTag.FromEntry`. `requires`
  is used when the tag has none, which is the `..X` case; when `requires`
  resolves to nothing the tag keeps `requiredImports` undefined, so
  `resolveExpression` still runs the name detector as today.
- **Base formats get the fields too.** `Plain_Text_Format`, `Bytes`,
  `JSON_Format`, `JSON_Lines_Format` and `XML_Format` are registered formats, so
  they get `requires` like any other. A module that has
  `from Standard.Base import all` (every template does) already covers them, so
  `addMissingImports` adds nothing.
- **`Database.connect` is left alone.** Its options insert qualified names that
  the detector already finds (spec section 1).
- **Where the Enso tests go.** `Choice.Option`'s JSON and
  `File_Format.dropdown_options` on a Base format go in a new
  `test/Base_Tests/src/Metadata_Spec.enso`. The SQLite and Delimited cases (the
  spec's "SQLite is a good case") go in
  `test/Visualization_Tests/src/Widgets/File_Format_Widgets_Spec.enso`, which
  already asserts the serialised `Data.read` format widget through
  `Widgets.get_widget_json` (the exact JSON the IDE receives) and already
  expects SQLite in it.
- **Adding fields breaks one positional pattern.** `Option locale_name _ _ _`
  (`test/Base_Internal_Tests/src/Data/Locale_Spec.enso:70`) matches the
  four-field constructor; Enso rejects a pattern with fewer fields than the
  constructor. Task 1 widens it to six. No other pattern on `Choice.Option`
  exists in `distribution/` or `test/`.

## Merge order

Task 1 first; it merges on green CI (invisible, see the first ruling). Task 2
branches from `develop` after Task 1 merged, and Task 3 branches from Task 2.
Tasks 2 and 3 merge after the owner's OK, usually after an installer test: first
retarget Task 3's PR to `develop`, then merge Task 2, then Task 3 (rebased if
GitHub asks).

---

### Task 1: The standard library names each format's type and file patterns

No change visible to users: `CI: No changelog needed`. Branch
`feat/489-format-option-requires` from `origin/develop`, in its own worktree.

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`
  (`Choice.Option`, `Choice.to_json`)
- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/System/File_Format.enso`
  (`File_Format.dropdown_options`, `File_Format.default_widget`)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Data_Read_Helpers.enso`
  (`format_widget_with_raw_response`)
- Modify:
  `distribution/lib/Standard/Base/0.0.0-dev/src/Network/HTTP/Response_Body.enso`
  (`decode_format_selector`)
- Create: `test/Base_Tests/src/Metadata_Spec.enso`
- Modify: `test/Base_Tests/src/Main.enso` (register `Metadata_Spec`)
- Modify: `test/Base_Internal_Tests/src/Data/Locale_Spec.enso` (line 70)
- Modify: `test/Visualization_Tests/src/Widgets/File_Format_Widgets_Spec.enso`
- Modify: `distribution/lib/Standard/CLAUDE.md` (the SPI section)

**Interfaces:**

- Produces:
  `Choice.Option label value=label parameters=[] icon="" requires="" patterns=[]`;
  `Choice.to_json` adds `,"requires":<text>` when `requires` is not `""` and
  `,"patterns":[…]` when `patterns` is not empty, after `"icon"`.
- Produces:
  `File_Format.dropdown_options (fixed : Vector) (registered : Vector = File_Format_SPI.get_types) -> Vector Option`:
  the options of `fixed` unchanged, then each registered type's options with
  `requires = Meta.meta typ . qualified_name` and
  `patterns = typ.get_name_patterns . flat_map .patterns . distinct`.
- Consumed by Task 2: the JSON keys `requires` (a fully qualified type name) and
  `patterns` (an array of `File_Name_Pattern` patterns) on a choice.

- [ ] **Step 1: Write the failing Base tests**

Create `test/Base_Tests/src/Metadata_Spec.enso`:

```enso
from Standard.Base import all
import Standard.Base.Metadata.Choice
import Standard.Base.System.File_Format.Auto_Detect
import Standard.Base.System.File_Format.File_Format
from Standard.Base.Data import Raw_Response

from Standard.Test import all

add_specs suite_builder =
    suite_builder.group "Choice.Option to_json" group_builder->
        group_builder.specify "is unchanged for an option without requires or patterns" <|
            Choice.Option "SQLite" "..SQLite" . to_json . should_equal '{"label":"SQLite","value":"..SQLite","parameters":[],"icon":""}'

        group_builder.specify "emits requires and patterns when both are set" <|
            option = Choice.Option "SQLite" "..SQLite" requires="Standard.SQLite.SQLite_Format.SQLite_Format" patterns=["*.sqlite", "*.db"]
            option.to_json . should_equal '{"label":"SQLite","value":"..SQLite","parameters":[],"icon":"","requires":"Standard.SQLite.SQLite_Format.SQLite_Format","patterns":["*.sqlite","*.db"]}'

        group_builder.specify "emits only the field that is set" <|
            Choice.Option "X" "..X" requires="A.B.C" . to_json . should_equal '{"label":"X","value":"..X","parameters":[],"icon":"","requires":"A.B.C"}'
            Choice.Option "X" "..X" patterns=["*.x"] . to_json . should_equal '{"label":"X","value":"..X","parameters":[],"icon":"","patterns":["*.x"]}'

    suite_builder.group "File_Format.dropdown_options" group_builder->
        group_builder.specify "names a registered format's type and file patterns" <|
            options = File_Format.dropdown_options [Auto_Detect]
            json = options.find o-> o.label == "JSON"
            json.value . should_equal "Standard.Base.System.File_Format.JSON_Format"
            json.requires . should_equal "Standard.Base.System.File_Format.JSON_Format"
            json.patterns . should_equal ["*.json", "*.geojson"]

        group_builder.specify "leaves Auto_Detect and Raw_Response without them" <|
            options = File_Format.dropdown_options [Auto_Detect, Raw_Response]
            options.first.label . should_equal "Auto Detect"
            options.first.requires . should_equal ""
            options.first.patterns . should_equal []
            raw = options.find o-> o.label == "Raw HTTP Response"
            raw.requires . should_equal ""
            raw.patterns . should_equal []

        group_builder.specify "uses the registered types it is given" <|
            options = File_Format.dropdown_options [Auto_Detect] []
            options.map .label . should_equal ["Auto Detect"]

main filter=Nothing =
    suite = Test.build suite_builder->
        add_specs suite_builder
    suite.run_with_filter filter
```

In `test/Base_Tests/src/Main.enso`, add `import project.Metadata_Spec` after
`import project.Random_Spec`, and `Metadata_Spec.add_specs suite_builder` after
`Random_Spec.add_specs suite_builder`.

- [ ] **Step 2: Write the failing widget JSON tests**

In `test/Visualization_Tests/src/Widgets/File_Format_Widgets_Spec.enso`, add
these specs to the group `"Widgets for Data.read"`, after
`"should provide a list of loaded file formats"`:

```enso
        group_builder.specify "should name each registered format's type and file patterns" <|
            result = Widgets.get_widget_json Data .read ["format"]
            result.should_contain '"label":"SQLite","value":"..SQLite","parameters":[],"icon":"","requires":"Standard.SQLite.SQLite_Format.SQLite_Format","patterns":["*.sqlite","*.db"]}'
            result.should_contain '"label":"Delimited","value":"..Delimited","parameters":[],"icon":"","requires":"Standard.Table.Delimited.Delimited_Format.Delimited_Format","patterns":["*.csv","*.tsv","*.tab"]}'
            result.should_contain '"label":"Excel Sheet","value":"..Sheet","parameters":[],"icon":"","requires":"Standard.Table.Excel.Excel_Format.Excel_Format"'

        group_builder.specify "should give Auto Detect neither field" <|
            result = Widgets.get_widget_json Data .read ["format"]
            result.should_contain '{"label":"Auto Detect","value":"Standard.Base.System.File_Format.Auto_Detect","parameters":[],"icon":""}'

        group_builder.specify "should fill the fields in Data.fetch's formats, and not in Raw Response" <|
            result = Widgets.get_widget_json Data .fetch ["format"]
            result.should_contain '"requires":"Standard.SQLite.SQLite_Format.SQLite_Format"'
            result.should_contain '{"label":"Raw HTTP Response","value":"Standard.Base.Data.Raw_Response","parameters":[],"icon":""}'
```

- [ ] **Step 3: Run the tests and see them fail (RED)**

Build the distribution and run both filters, on WSL (from a Linux clone of the
branch, `~/enso-489-t1`, for speed) and on Windows (the worktree,
`bin/enso.exe`):

```bash
wsl -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-489-t1 \
  && for v in $(env | cut -d= -f1 | grep -E "^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS)"); do unset "$v"; done \
  && export CARGO_TARGET_DIR=$HOME/enso-target && sbt buildEngineDistribution \
  && cd test && JAVA_TOOL_OPTIONS=-enableassertions ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" "Choice.Option to_json" \
  ; JAVA_TOOL_OPTIONS=-enableassertions ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Tests" "File_Format.dropdown_options" \
  ; JAVA_TOOL_OPTIONS=-enableassertions ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Visualization_Tests" "Widgets for Data.read"'
```

Expected: `Metadata_Spec` does not compile (`requires` is not an argument of
`Option`; `dropdown_options` does not exist), and the new Visualization specs
fail on `should_contain`. The first Visualization spec,
`"should provide a list of loaded file formats"`, passes.

- [ ] **Step 4: Give `Choice.Option` the two fields**

In `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`, replace the
`Choice` type's documentation arguments, constructor and `to_json` with:

```enso
type Choice
    ## Describes an entry in a Single_Choice or Multiple_Choice widget.

       ## Arguments
        - `label`: The text to display for the entry.
        - `value`: The code to insert for the entry. By default, the `label` is
          used.
        - `parameters`: A list of parameters for the arguments for the `value`.
          This provides the structure needed for nested widgets.
        - `icon`: The icon to display for the entry. By default, no icon is used.
        - `requires`: The fully qualified name of a type whose library the entry
          needs, e.g. `"Standard.SQLite.SQLite_Format.SQLite_Format"`. Choosing
          the entry adds that library's import. By default, none.
        - `patterns`: The file name patterns (e.g. `*.db`) of the files the
          entry reads. When a path argument of the same call changes, a single
          matching entry adds the import of its `requires`. By default, none.
    Option label:Text value:(Text | Vector Choice)=label parameters:(Vector (Pair Text Widget))=[] icon:Text="" requires:Text="" patterns:(Vector Text)=[]

    ## ---
       private: true
       ---
       In-lined JSON representation of the Choice. `requires` and `patterns`
       appear only when set, so an option without them serialises as before.
    to_json self -> Text =
        parameter_json = if self.parameters.length == 0 then '[]' else
            '[' + ((self.parameters.map p-> '[' + p.first.to_json + ',' + p.second.to_json + ']').join ',') + ']'
        requires_json = if self.requires == "" then "" else ',"requires":' + self.requires.to_json
        patterns_json = if self.patterns.is_empty then "" else ',"patterns":' + self.patterns.to_json
        '{"label":' + self.label.to_json + ',"value":' + self.value.to_json + ',"parameters":' + parameter_json + ',"icon":' + self.icon.to_json + requires_json + patterns_json + '}'
```

In `test/Base_Internal_Tests/src/Data/Locale_Spec.enso`, line 70, widen the
pattern to the constructor's six fields:

```enso
        locale_names = Locale.widget_options.map x-> case x of Option locale_name _ _ _ _ _ -> locale_name
```

- [ ] **Step 5: Fill the fields in one helper, used by every format dropdown**

In `distribution/lib/Standard/Base/0.0.0-dev/src/System/File_Format.enso`,
replace `default_widget` (line 178) with the helper and the new
`default_widget`:

```enso
    ## ---
       private: true
       ---
       The dropdown options of a format argument: those of `fixed` (such as
       `Auto_Detect` and `Raw_Response`) as they are, then those of each
       `registered` format type, each naming that type (`requires`) and the
       file name patterns it reads (`patterns`), so that the IDE can add the
       import of the format's library
       (`docs/superpowers/specs/2026-11-03-data-read-library-imports-design.md`).
    dropdown_options (fixed : Vector) (registered : Vector = File_Format_SPI.get_types) -> Vector Option =
        with_library typ =
            requires = Meta.meta typ . qualified_name
            patterns = typ.get_name_patterns . flat_map .patterns . distinct
            typ.get_dropdown_options . map option->
                Option option.label option.value option.parameters option.icon requires patterns
        (fixed.flat_map .get_dropdown_options) + (registered.flat_map with_library)

    ## ---
       private: true
       ---
    default_widget display:Display=..When_Modified -> Widget =
        Single_Choice display=display values=(File_Format.dropdown_options [Auto_Detect])
```

In
`distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Data_Read_Helpers.enso`,
change the import on line 23 to

```enso
from project.System.File_Format import Auto_Detect, File_Format
```

(`File_Format_SPI` is no longer used there) and the widget to

```enso
format_widget_with_raw_response -> Widget =
    Single_Choice display=Display.When_Modified values=(File_Format.dropdown_options [Auto_Detect, Raw_Response])
```

In
`distribution/lib/Standard/Base/0.0.0-dev/src/Network/HTTP/Response_Body.enso`,
change `decode_format_selector` to

```enso
decode_format_selector =
    options = File_Format.dropdown_options [Auto_Detect] (File_Format_SPI.get_types.filter can_decode)
    Single_Choice display=Display.Always values=options
```

(`File_Format`, `Auto_Detect` and `File_Format_SPI` are already imported there,
lines 20, 22 and 31.)

- [ ] **Step 6: Run the tests and see them pass (GREEN)**

Rebuild the distribution and rerun Step 3's three commands on both hosts, plus
the widened Locale spec:

```bash
cd test && JAVA_TOOL_OPTIONS=-enableassertions ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Base_Internal_Tests" "auto-discover static Locales"
```

Expected: every spec passes, and each log reports a non-zero number of tests.
Then run the whole of `Base_Tests` (`http-test-helper` running, per its
`README.md`), `Base_Internal_Tests` and `Visualization_Tests` unfiltered once on
Linux, and `Table_Tests`' `Widget_Helpers_Spec`
(`--run "$PWD/Table_Tests" "Widget"`), since every format dropdown changed.

- [ ] **Step 7: Document the helper**

In `distribution/lib/Standard/CLAUDE.md`, at the end of "Service Provider
Interfaces (SPI)", add:

```markdown
A format dropdown builds its options with `File_Format.dropdown_options`, which
gives each registered format's options `requires` (the format type's qualified
name) and `patterns` (its `get_name_patterns`). The IDE adds the format's
library import from them when the user picks the format, or picks a file the
format reads (#489). `Choice.Option` emits both in its JSON only when set.
```

- [ ] **Step 8: Commit, push, open the PR**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso \
  distribution/lib/Standard/Base/0.0.0-dev/src/System/File_Format.enso \
  distribution/lib/Standard/Base/0.0.0-dev/src/Internal/Data_Read_Helpers.enso \
  distribution/lib/Standard/Base/0.0.0-dev/src/Network/HTTP/Response_Body.enso \
  distribution/lib/Standard/CLAUDE.md test/Base_Tests/src/Metadata_Spec.enso \
  test/Base_Tests/src/Main.enso test/Base_Internal_Tests/src/Data/Locale_Spec.enso \
  test/Visualization_Tests/src/Widgets/File_Format_Widgets_Spec.enso
git commit -F <message file>
```

Message: `Format dropdowns name each option's format type and file patterns`, a
body saying the GUI ignores the two keys until the next PR of #489, and the two
trailer lines. Push, write the PR body to a file (what changed, the corrected
widget list from the rulings, the test runs on both hosts, "Part of #489"), and
open it with `gh pr create --base develop --body-file <file>` and the label
`CI: No changelog needed`. Merge on green.

---

### Task 2: The GUI adds the format's import on a pick and on a matching path

Changes behaviour, takes `CI: No changelog needed` (Task 3 carries the entry),
and merges after the owner's OK together with Task 3 (see "Merge order"). Branch
`feat/489-format-imports-gui` from `origin/develop` after Task 1 merged.

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (`choiceSchema`, `Choice`, `FlattenedChoice`)
- Modify: `app/gui/src/providers/openedProjects/module/imports.ts`
  (`requiredImportsForTypeName`)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/tags.ts`
  (`DynamicConfigTagsOptions.libraryPublicTypes`, `useExpressionTags`)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection.vue`,
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetMultiSelection.vue`
  (pass `libraryPublicTypes`)
- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/formatForPath.ts`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction.vue`
  (`handleArgUpdate`, the old body renamed `applyArgUpdate`)
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts`
- Test:
  `app/gui/src/providers/openedProjects/module/__tests__/requiredImportsForType.test.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/dropdownTags.test.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/formatForPath.test.ts`
- Modify: `app/gui/src/providers/openedProjects/module/CLAUDE.md`,
  `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`

**Interfaces:**

- Consumes: Task 1's `requires` and `patterns` keys.
- Produces: `Choice.requires?: string | undefined`,
  `Choice.patterns?: string[] | undefined` (and the same on `FlattenedChoice`).
- Produces:
  `requiredImportsForTypeName(db: SuggestionDb, projectNames: ProjectNameStore, libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]>, typeName: string): RequiredImport[] | undefined`.
- Produces:
  `DynamicConfigTagsOptions.libraryPublicTypes?: ToValue<Opt<ReadonlyMap<string, readonly ProjectPath[]>>>`.
- Produces, in `formatForPath.ts`: `PATH_ARGUMENT`, `FORMAT_ARGUMENT`,
  `fileNameOf(path: string): string`,
  `matchesNamePattern(pattern: string, fileName: string): boolean`,
  `formatTypeForPath(path: string, formatConfig: WidgetConfiguration | undefined): string | undefined`,
  `isAutoDetect(code: string): boolean`,
  `pathTextOf(value: Ast.Ast | string | undefined): string | undefined`,
  `formatTypeForPathUpdate(app: ArgumentApplication, update: WidgetUpdate): string | undefined`.
  Task 3's Playwright drives them through the real widgets.

- [ ] **Step 1: Write the failing schema test**

Append to
`app/gui/src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts`
(add `flattenChoice` and `widgetConfigurationSchema` to its import from
`'../configuration'`, and `assert` to the `vitest` import):

```ts
test("a choice keeps the type it requires and its file name patterns", () => {
  const parsed = widgetConfigurationSchema.parse({
    type: "Widget",
    constructor: "Single_Choice",
    label: null,
    values: [
      {
        label: "Auto Detect",
        value: "Standard.Base.System.File_Format.Auto_Detect",
        parameters: [],
        icon: "",
      },
      {
        label: "SQLite",
        value: "..SQLite",
        parameters: [],
        icon: "",
        requires: "Standard.SQLite.SQLite_Format.SQLite_Format",
        patterns: ["*.sqlite", "*.db"],
      },
    ],
    display: { type: "Display", constructor: "When_Modified" },
  });
  assert(parsed.kind === "Single_Choice");
  expect(parsed.values[0]).not.toHaveProperty("requires");
  expect(parsed.values[0]).not.toHaveProperty("patterns");
  const flattened = parsed.values.flatMap(flattenChoice);
  expect(flattened[1]).toMatchObject({
    value: "..SQLite",
    requires: "Standard.SQLite.SQLite_Format.SQLite_Format",
    patterns: ["*.sqlite", "*.db"],
  });
});
```

- [ ] **Step 2: Write the failing resolver tests**

Create
`app/gui/src/providers/openedProjects/module/__tests__/requiredImportsForType.test.ts`:

```ts
/** @file Resolving a widget option's `requires` type name to the imports it needs (#489). */
import {
  requiredImportsForTypeName,
  type RequiredImport,
} from "$/providers/openedProjects/module/imports";
import { mockProjectNameStore } from "$/providers/openedProjects/projectNames";
import { SuggestionDb } from "$/providers/openedProjects/suggestionDatabase";
import { makeType } from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import type { ProjectPath } from "@/util/projectPath";
import { tryQualifiedName, type Identifier } from "@/util/qualifiedName";
import { unwrap } from "enso-common/src/utilities/data/result";
import { expect, test } from "vitest";

const projectNames = mockProjectNameStore();
const projectPath = (path: string) =>
  unwrap(projectNames.parseProjectPath(unwrap(tryQualifiedName(path))));
const unqualified = (from: string, name: string): RequiredImport => ({
  kind: "Unqualified",
  from: projectPath(from),
  import: name as Identifier,
});

const SQLITE_FORMAT_QN = "Standard.SQLite.SQLite_Format.SQLite_Format";
const sqliteFormat = () =>
  makeType(SQLITE_FORMAT_QN, { reexport: "Standard.SQLite" });
const noTypes = new Map<string, readonly ProjectPath[]>();

test("a type in the suggestion database gives its entry’s import", () => {
  const db = SuggestionDb.createMock([sqliteFormat()]);
  expect(
    requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN),
  ).toEqual([unqualified("Standard.SQLite", "SQLite_Format")]);
});

test("a catalogue entry counts like any other", () => {
  const entry = sqliteFormat();
  entry.fromCatalogue = true;
  const db = SuggestionDb.createMock([entry]);
  expect(
    requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN),
  ).toEqual([unqualified("Standard.SQLite", "SQLite_Format")]);
});

test("a type only its library declares gives the import from that library", () => {
  const declared = new Map([
    ["SQLite_Format", [projectPath("Standard.SQLite")]],
  ]);
  const db = SuggestionDb.createMock([]);
  expect(
    requiredImportsForTypeName(db, projectNames, declared, SQLITE_FORMAT_QN),
  ).toEqual([unqualified("Standard.SQLite", "SQLite_Format")]);
});

test("the same name declared by another library does not count", () => {
  const declared = new Map([
    ["SQLite_Format", [projectPath("Standard.Other")]],
  ]);
  const db = SuggestionDb.createMock([]);
  expect(
    requiredImportsForTypeName(db, projectNames, declared, SQLITE_FORMAT_QN),
  ).toBeUndefined();
});

test("an unknown type gives nothing", () => {
  const db = SuggestionDb.createMock([]);
  expect(
    requiredImportsForTypeName(db, projectNames, noTypes, SQLITE_FORMAT_QN),
  ).toBeUndefined();
});

test("a value that is not a qualified name gives nothing", () => {
  const db = SuggestionDb.createMock([sqliteFormat()]);
  expect(
    requiredImportsForTypeName(db, projectNames, noTypes, "..SQLite"),
  ).toBeUndefined();
});
```

- [ ] **Step 3: Write the failing dropdown tag tests**

Append to
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/dropdownTags.test.ts`,
and extend its imports to:

```ts
import { mockProjectNameStore } from "$/providers/openedProjects/projectNames";
import { SuggestionDb } from "$/providers/openedProjects/suggestionDatabase";
import { makeType } from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import type { SingleChoice } from "$/providers/openedProjects/widgetRegistry/configuration";
import { tryQualifiedName, type Identifier } from "@/util/qualifiedName";
import { unwrap } from "enso-common/src/utilities/data/result";
import { assert, expect, test } from "vitest";
import { shallowRef } from "vue";
import { ExpressionTag, NestedChoiceTag, useExpressionTags } from "../tags";
```

```ts
const projectNames = mockProjectNameStore();
const SQLITE_FORMAT_QN = "Standard.SQLite.SQLite_Format.SQLite_Format";

function formatTags(db: SuggestionDb) {
  const config: SingleChoice = {
    kind: "Single_Choice",
    label: null,
    values: [
      {
        label: "SQLite",
        value: "..SQLite",
        parameters: [],
        requires: SQLITE_FORMAT_QN,
      },
    ],
  };
  return useExpressionTags({
    dynamicConfig: config,
    staticTags: null,
    suggestionDb: db,
    projectNames: shallowRef(projectNames),
    libraryPublicTypes: new Map(),
  }).value;
}

test("an option that requires a type imports it when picked, and keeps its short value", () => {
  const db = SuggestionDb.createMock([
    makeType(SQLITE_FORMAT_QN, { reexport: "Standard.SQLite" }),
  ]);
  const [tag] = formatTags(db);
  assert(tag instanceof ExpressionTag);
  expect(tag.expression).toBe("..SQLite");
  expect(tag.label).toBe("SQLite");
  expect(tag.requiredImports).toEqual([
    {
      kind: "Unqualified",
      from: unwrap(
        projectNames.parseProjectPath(
          unwrap(tryQualifiedName("Standard.SQLite")),
        ),
      ),
      import: "SQLite_Format" as Identifier,
    },
  ]);
});

test("an option whose type is unknown keeps detecting imports from its code", () => {
  const [tag] = formatTags(SuggestionDb.createMock([]));
  assert(tag instanceof ExpressionTag);
  expect(tag.requiredImports).toBeUndefined();
});
```

- [ ] **Step 4: Write the failing path tests**

Create
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/formatForPath.test.ts`:

```ts
/** @file Which format library a path needs, for `Data.read` with format on `Auto_Detect` (#489). */
import {
  makeArgument,
  makeMethod,
} from "$/providers/openedProjects/suggestionDatabase/mockSuggestion";
import {
  DisplayMode,
  type WidgetConfiguration,
  type WithDisplay,
} from "$/providers/openedProjects/widgetRegistry/configuration";
import { Ast } from "@/util/ast";
import {
  ArgumentApplication,
  ArgumentAst,
  interpretCall,
} from "@/util/callTree";
import { assert, describe, expect, test } from "vitest";
import { assertDefined } from "ydoc-shared/util/assert";
import {
  fileNameOf,
  formatTypeForPath,
  formatTypeForPathUpdate,
  isAutoDetect,
  matchesNamePattern,
  pathTextOf,
} from "../formatForPath";

const SQLITE = "Standard.SQLite.SQLite_Format.SQLite_Format";
const TABLE_EXCEL = "Standard.Table.Excel.Excel_Format.Excel_Format";
const TABLE_DELIMITED =
  "Standard.Table.Delimited.Delimited_Format.Delimited_Format";

const option = (
  label: string,
  value: string,
  requires?: string,
  patterns?: string[],
) => ({
  label,
  value,
  parameters: [],
  ...(requires ? { requires } : {}),
  ...(patterns ? { patterns } : {}),
});

const FORMAT_CONFIG: WidgetConfiguration & WithDisplay = {
  kind: "Single_Choice",
  label: null,
  display: DisplayMode.WhenModified,
  values: [
    option("Auto Detect", "Standard.Base.System.File_Format.Auto_Detect"),
    option("SQLite", "..SQLite", SQLITE, ["*.sqlite", "*.db"]),
    option("Delimited", "..Delimited", TABLE_DELIMITED, [
      "*.csv",
      "*.tsv",
      "*.tab",
    ]),
    option("Excel Workbook", "..Workbook", TABLE_EXCEL, ["*.xls", "*.xlsx"]),
    option("Excel Sheet", "..Sheet", TABLE_EXCEL, ["*.xls", "*.xlsx"]),
  ],
};

describe("matchesNamePattern", () => {
  // Every pattern a shipped format's `get_name_patterns` gives, with a file it must read.
  test.each([
    ["*.txt", "a.txt"],
    ["*.log", "a.log"],
    ["*.dat", "a.dat"],
    ["*.json", "a.json"],
    ["*.geojson", "a.geojson"],
    ["*.jsonl", "a.jsonl"],
    ["*.xml", "a.xml"],
    ["*.parquet", "a.parquet"],
    ["*.png", "a.png"],
    ["*.tiff", "a.tiff"],
    ["*.sqlite", "a.sqlite"],
    ["*.db", "a.db"],
    ["*.csv", "a.csv"],
    ["*.tsv", "a.tsv"],
    ["*.tab", "a.tab"],
    ["*.xls", "a.xls"],
    ["*.xlsx", "a.xlsx"],
    ["*.xlsm", "a.xlsm"],
    ["*.xlt", "a.xlt"],
    ["*.xlsb", "a.xlsb"],
    ["*.edi", "a.edi"],
    ["*.822", "a.822"],
    ["*.yxdb", "a.yxdb"],
    ["*.hyper", "a.hyper"],
  ])("%s matches %s", (pattern, fileName) => {
    expect(matchesNamePattern(pattern, fileName)).toBe(true);
  });
  test("case is ignored, as Auto_Detect ignores it", () => {
    expect(matchesNamePattern("*.db", "Sales.DB")).toBe(true);
  });
  test("the whole name must match", () => {
    expect(matchesNamePattern("*.json", "a.jsonl")).toBe(false);
    expect(matchesNamePattern("*.xls", "a.xlsx")).toBe(false);
    expect(matchesNamePattern("*.db", "db")).toBe(false);
  });
  test("? is one character and everything else is literal", () => {
    expect(matchesNamePattern("data?.csv", "data1.csv")).toBe(true);
    expect(matchesNamePattern("data?.csv", "data12.csv")).toBe(false);
    expect(matchesNamePattern("*.c+v", "a.ccv")).toBe(false);
  });
});

describe("fileNameOf", () => {
  test.each([
    ["/home/user/Sales.db", "Sales.db"],
    ["C:\\Users\\me\\Sales.db", "Sales.db"],
    ["Sales.db", "Sales.db"],
    ["https://example.com/files/sales.csv?raw=1#top", "sales.csv"],
    ["/home/user/", ""],
  ])("%s is %s", (path, name) => expect(fileNameOf(path)).toBe(name));
});

describe("formatTypeForPath", () => {
  test("a .db file needs SQLite", () => {
    expect(formatTypeForPath("/data/Sales.db", FORMAT_CONFIG)).toBe(SQLITE);
  });
  test("an extension no format claims needs nothing", () => {
    expect(formatTypeForPath("/data/notes.xyz", FORMAT_CONFIG)).toBeUndefined();
  });
  test("several options of one format type count once", () => {
    expect(formatTypeForPath("/data/Sales.xlsx", FORMAT_CONFIG)).toBe(
      TABLE_EXCEL,
    );
  });
  test("options of two format types matching is ambiguous, so nothing", () => {
    const ambiguous: WidgetConfiguration = {
      ...FORMAT_CONFIG,
      kind: "Single_Choice",
      values: [
        option("SQLite", "..SQLite", SQLITE, ["*.db"]),
        option("Other", "..Other", "Standard.Other.Other_Format.Other_Format", [
          "*.db",
        ]),
      ],
    };
    expect(formatTypeForPath("/data/Sales.db", ambiguous)).toBeUndefined();
  });
  test("without a choice configuration, nothing", () => {
    expect(formatTypeForPath("/data/Sales.db", undefined)).toBeUndefined();
    expect(
      formatTypeForPath("/data/Sales.db", {
        kind: "Text_Input",
        display: DisplayMode.Always,
      }),
    ).toBeUndefined();
  });
});

describe("isAutoDetect", () => {
  test.each([
    ["Auto_Detect", true],
    ["..Auto_Detect", true],
    ["Standard.Base.System.File_Format.Auto_Detect", true],
    ["..SQLite", false],
    ['(Delimited_Format.Delimited ",")', false],
  ])("%s is %s", (code, expected) => expect(isAutoDetect(code)).toBe(expected));
});

describe("pathTextOf", () => {
  test("of a text literal, a string, or File.new", () => {
    expect(pathTextOf(Ast.TextLiteral.new("/a/b.db"))).toBe("/a/b.db");
    expect(pathTextOf("'/a/b.db'")).toBe("/a/b.db");
    expect(pathTextOf(Ast.parseExpression("(File.new '/a/b.db')"))).toBe(
      "/a/b.db",
    );
  });
  test("of something without text, undefined", () => {
    expect(pathTextOf(Ast.parseExpression("x"))).toBeUndefined();
    expect(pathTextOf(undefined)).toBeUndefined();
  });
});

const DATA_READ = makeMethod("Standard.Base.Data.read", {
  module: "Standard.Base.Data",
  isStatic: true,
  args: [
    makeArgument("path"),
    makeArgument("format"),
    makeArgument("on_problems"),
  ],
});

function dataRead(code: string): ArgumentApplication {
  const ast = Ast.parseExpression(code);
  assertDefined(ast);
  const app = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: DATA_READ,
    widgetCfg: {
      kind: "FunctionCall",
      parameters: new Map([["format", FORMAT_CONFIG]]),
    },
  });
  assert(app instanceof ArgumentApplication);
  return app;
}

function argument(app: ArgumentApplication, name: string) {
  const arg = [...app.iterApplications()]
    .map((a) => a.argument)
    .find((a) => a.argInfo?.name === name);
  assertDefined(arg);
  return arg;
}

describe("formatTypeForPathUpdate", () => {
  test("a path set on the placeholder (the file browser, or typing)", () => {
    const app = dataRead("Data.read");
    const update = {
      portUpdate: {
        origin: argument(app, "path").portId,
        value: Ast.TextLiteral.new("/d/S.db"),
      },
    };
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE);
  });
  test("a path literal replaced", () => {
    const app = dataRead("Data.read '/d/notes.txt'");
    const update = {
      portUpdate: {
        origin: argument(app, "path").portId,
        value: Ast.TextLiteral.new("/d/S.db"),
      },
    };
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE);
  });
  test("the literal inside File.new replaced", () => {
    const app = dataRead("Data.read (File.new '/d/notes.txt')");
    const path = argument(app, "path");
    assert(path instanceof ArgumentAst);
    let literal: Ast.Ast | undefined;
    Ast.visitRecursive(path.ast, (node) => {
      if (node instanceof Ast.TextLiteral) literal = node;
      return literal == null;
    });
    assertDefined(literal);
    const update = {
      portUpdate: { origin: literal.id, value: Ast.TextLiteral.new("/d/S.db") },
    };
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE);
  });
  test("a path literal edited in place (typing into it)", () => {
    const app = dataRead("Data.read '/d/notes.txt'");
    const path = argument(app, "path");
    assert(path instanceof ArgumentAst && path.ast instanceof Ast.TextLiteral);
    const edit = path.ast.module.edit();
    edit.getVersion(path.ast).setRawTextContent("/d/S.db");
    expect(formatTypeForPathUpdate(app, { edit })).toBe(SQLITE);
  });
  test("an edit that leaves the path as it was adds nothing", () => {
    const app = dataRead("Data.read '/d/S.db'");
    const path = argument(app, "path");
    assert(path instanceof ArgumentAst);
    expect(
      formatTypeForPathUpdate(app, { edit: path.ast.module.edit() }),
    ).toBeUndefined();
  });
  test("an explicit format other than Auto_Detect adds nothing from the path", () => {
    const app = dataRead("Data.read '/d/notes.txt' ..Delimited");
    const update = {
      portUpdate: {
        origin: argument(app, "path").portId,
        value: Ast.TextLiteral.new("/d/S.db"),
      },
    };
    expect(formatTypeForPathUpdate(app, update)).toBeUndefined();
  });
  test("an explicit Auto_Detect still counts", () => {
    const app = dataRead("Data.read '/d/notes.txt' ..Auto_Detect");
    const update = {
      portUpdate: {
        origin: argument(app, "path").portId,
        value: Ast.TextLiteral.new("/d/S.db"),
      },
    };
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE);
  });
  test("an update of another argument adds nothing", () => {
    const app = dataRead("Data.read '/d/S.db'");
    const update = {
      portUpdate: {
        origin: argument(app, "on_problems").portId,
        value: "..Report_Error",
      },
    };
    expect(formatTypeForPathUpdate(app, update)).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the tests and see them fail (RED)**

```bash
cd app/gui && corepack pnpm exec vitest run \
  src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts \
  src/providers/openedProjects/module/__tests__/requiredImportsForType.test.ts \
  src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/dropdownTags.test.ts \
  src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/formatForPath.test.ts
```

Expected: the schema test fails (`requires` stripped by `z.object`); the other
three files fail to import (`requiredImportsForTypeName`, the
`libraryPublicTypes` option and `formatForPath.ts` do not exist).

- [ ] **Step 6: Parse the two fields**

In `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`,
replace `choiceSchema`, `Choice` and `FlattenedChoice` with:

```ts
/** A choosable item in SingleChoice and MultipleChoice widgets. */
const choiceSchema: z.ZodType<Choice> = z.object({
  value: choiceValueSchema,
  label: z.string().nullable(),
  parameters: z.lazy(() => z.array(argumentSchema)),
  icon: z.string().nullable().optional(),
  requires: z.string().optional(),
  patterns: z.array(z.string()).optional(),
});
/**
 * `requires` is the fully qualified name of a type whose library the choice needs: picking the
 * choice adds that library's import. `patterns` are the file name patterns (`*.db`) of the files
 * the choice reads: with format on `Auto_Detect`, a path that only one type's patterns match adds
 * its import (`WidgetFunction/formatForPath.ts`).
 */
export type Choice = {
  value: ChoiceValue;
  label: string | null;
  parameters: ArgsWidgetConfiguration;
  icon?: string | null | undefined;
  requires?: string | undefined;
  patterns?: string[] | undefined;
};
export type FlattenedChoice = {
  value: string;
  label: string | null;
  parameters: ArgsWidgetConfiguration;
  icon?: string | null | undefined;
  requires?: string | undefined;
  patterns?: string[] | undefined;
};
```

`flattenChoice` needs no change: a leaf choice is returned whole, fields
included, and a nested choice's leaves carry their own.

- [ ] **Step 7: Resolve a type name to its imports**

In `app/gui/src/providers/openedProjects/module/imports.ts`, after
`requiredImportsByProjectPath`, add:

```ts
/**
 * The imports that a widget option's `requires` needs: `typeName` is a type's fully qualified name
 * (`Standard.SQLite.SQLite_Format.SQLite_Format`). It is looked up among the suggestion entries,
 * where a catalogue entry counts like any other, and failing that among the types its own library
 * declares (`libraryPublicTypes`). `undefined` when it is neither, for example when the library
 * is not installed: the caller then adds nothing
 * (`docs/superpowers/specs/2026-11-03-data-read-library-imports-design.md`, section 3).
 */
export function requiredImportsForTypeName(
  db: SuggestionDb,
  projectNames: ProjectNameStore,
  libraryPublicTypes: ReadonlyMap<string, readonly ProjectPath[]>,
  typeName: string,
): RequiredImport[] | undefined {
  const path = projectNames.parseProjectPathRaw(typeName);
  if (path.ok) {
    const entry = db.getEntryByProjectPath(path.value);
    if (entry?.kind === SuggestionKind.Type) return requiredImports(db, entry);
    const name = path.value.path && qnLastSegment(path.value.path);
    const library =
      name &&
      libraryPublicTypes
        .get(name)
        ?.find((lib) => lib.project === path.value.project);
    if (name && library) {
      return [
        {
          kind: "Unqualified",
          from: library.normalized(),
          import: name as Identifier,
        },
      ];
    }
  }
  console.debug(
    "No suggestion entry or declared type for a widget option’s type:",
    typeName,
  );
  return undefined;
}
```

- [ ] **Step 8: Attach the imports to the dropdown's tag**

In
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/tags.ts`,
add `requiredImportsForTypeName` to the import from
`'$/providers/openedProjects/module/imports'`, and replace
`DynamicConfigTagsOptions` and the `dynamicTags` computed of `useExpressionTags`
with:

```ts
export interface DynamicConfigTagsOptions {
  dynamicConfig: ToValue<Opt<WidgetConfiguration>>;
  staticTags: ToValue<Opt<string[]>>;
  suggestionDb: ToValue<SuggestionDb>;
  projectNames: Readonly<Ref<ProjectNameStore>>;
  /** The types the installed libraries declare, for a choice's `requires` (#489). */
  libraryPublicTypes?: ToValue<
    Opt<ReadonlyMap<string, readonly ProjectPath[]>>
  >;
}
```

```ts
const dynamicTags = computed((): (ExpressionTag | NestedChoiceTag)[] | null => {
  const config = toValue(dynamicConfig);
  if (config?.kind !== "Single_Choice" && config?.kind !== "Multiple_Choice")
    return null;

  // A choice that names the type it requires gets that type's imports, unless its value
  // already resolved to a suggestion entry with imports of its own.
  const withRequiredType = (
    tag: ExpressionTag,
    requires: string,
  ): ExpressionTag => {
    if (tag.requiredImports) return tag;
    const imports = requiredImportsForTypeName(
      toValue(suggestionDb),
      projectNames.value,
      toValue(libraryPublicTypes) ?? new Map(),
      requires,
    );
    return imports
      ? new ExpressionTag(tag.expression, tag.explicitLabel, tag.icon, imports)
      : tag;
  };

  const choiceToTag = (choice: Choice): ExpressionTag | NestedChoiceTag => {
    if (Array.isArray(choice.value)) {
      return new NestedChoiceTag(
        choice.label ?? "…",
        choice.value.map(choiceToTag),
      );
    }
    const tag = ExpressionTag.FromExpression(
      toValue(suggestionDb),
      projectNames.value,
      choice.value,
      choice.label,
      choice.icon,
    );
    return choice.requires ? withRequiredType(tag, choice.requires) : tag;
  };

  return config.values.map(choiceToTag);
});
```

and add `libraryPublicTypes` to the destructured parameters of
`useExpressionTags`. `ProjectPath` is already imported in `tags.ts`.

In `WidgetSelection.vue` (line 91) and `WidgetMultiSelection.vue` (line 48),
pass the declared types to `useExpressionTags`:

```ts
const expressionTags = useExpressionTags({
  dynamicConfig: () => props.input.dynamicConfig,
  staticTags: () => props.input[ArgumentInfoKey]?.info?.tagValues,
  suggestionDb: () => suggestionDbStore.value.entries,
  projectNames,
  libraryPublicTypes: () => suggestionDbStore.value.libraryPublicTypes,
});
```

(`WidgetMultiSelection.vue` keeps its `suggestionDbStore.value?.entries` and
uses `suggestionDbStore.value?.libraryPublicTypes`.) `expressionTagClicked`
already calls `tag.resolveExpression(edit, module.value)` in the edit that
applies the choice (`WidgetSelection.vue:212`), so the import and the choice are
one undo step with no further change.

- [ ] **Step 9: The path matching**

Create
`app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/formatForPath.ts`:

```ts
/**
 * @file With `format` on `Auto_Detect`, which format type's library the file a call's `path`
 * argument names needs: the one whose format options' file name patterns match it (#489,
 * `docs/superpowers/specs/2026-11-03-data-read-library-imports-design.md`, section 3).
 */
import type { WidgetUpdate } from "$/providers/openedProjects/widgetRegistry";
import {
  flattenChoice,
  type WidgetConfiguration,
} from "$/providers/openedProjects/widgetRegistry/configuration";
import { Ast } from "@/util/ast";
import type { AstId } from "@/util/ast/abstract";
import {
  ArgumentAst,
  type ArgumentApplication,
  type ArgumentPlaceholder,
} from "@/util/callTree";
import { qnLastSegment, tryQualifiedName } from "@/util/qualifiedName";

/** The argument whose value is the file to read (`Data.read`'s). */
export const PATH_ARGUMENT = "path";
/** The argument whose widget lists the formats and their file name patterns. */
export const FORMAT_ARGUMENT = "format";

/** The file name at the end of `path`: after the last `/` or `\`, without a URL's query or fragment. */
export function fileNameOf(path: string): string {
  const withoutQuery = path.replace(/[?#].*$/s, "");
  const lastSeparator = Math.max(
    withoutQuery.lastIndexOf("/"),
    withoutQuery.lastIndexOf("\\"),
  );
  return withoutQuery.slice(lastSeparator + 1);
}

/**
 * Whether `fileName` matches a `File_Name_Pattern` pattern: `*` is any run of characters, `?` one
 * character, anything else literal. Case is ignored, as `Auto_Detect` ignores it
 * (`File_Format_Metadata.guess_extension` lower-cases the extension).
 */
export function matchesNamePattern(pattern: string, fileName: string): boolean {
  const source = Array.from(pattern, (c) =>
    c === "*"
      ? ".*"
      : c === "?"
        ? "."
        : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("");
  return new RegExp(`^${source}$`, "is").test(fileName);
}

/**
 * The type whose library reads `path`, when the patterns of exactly one format type in
 * `formatConfig` match its file name. Several options of one type (Excel's Workbook, Sheet and
 * Range) count once.
 */
export function formatTypeForPath(
  path: string,
  formatConfig: WidgetConfiguration | undefined,
): string | undefined {
  if (formatConfig?.kind !== "Single_Choice") return undefined;
  const fileName = fileNameOf(path);
  if (fileName === "") return undefined;
  const types = new Set<string>();
  for (const choice of formatConfig.values.flatMap(flattenChoice)) {
    if (
      choice.requires &&
      choice.patterns?.some((p) => matchesNamePattern(p, fileName))
    ) {
      types.add(choice.requires);
    }
  }
  return types.size === 1 ? [...types][0] : undefined;
}

/** Whether a `format` argument's code is `Auto_Detect`, in any form the IDE inserts. */
export function isAutoDetect(code: string): boolean {
  if (code === "..Auto_Detect") return true;
  const qn = tryQualifiedName(code);
  return qn.ok && qnLastSegment(qn.value) === "Auto_Detect";
}

/** The text of the first text literal in `value`: a path, or the path in `File.new '…'`. */
export function pathTextOf(
  value: Ast.Ast | string | undefined,
): string | undefined {
  const ast = typeof value === "string" ? Ast.parseExpression(value) : value;
  if (ast == null) return undefined;
  let text: string | undefined;
  Ast.visitRecursive(ast, (node) => {
    if (text != null) return false;
    if (node instanceof Ast.TextLiteral) {
      text = node.rawTextContent;
      return false;
    }
    return true;
  });
  return text;
}

function contains(ast: Ast.Ast, id: AstId): boolean {
  let found = false;
  Ast.visitRecursive(ast, (node) => {
    if (node.id === id) found = true;
    return !found;
  });
  return found;
}

/**
 * The path's text after `update`, when the update changes the `path` argument: a value set on its
 * port or inside it (the file browser, or typing into a placeholder), or its literal edited in
 * place (typing into it, which sends only `edit`).
 */
function newPathText(
  path: ArgumentAst | ArgumentPlaceholder,
  update: WidgetUpdate,
): string | undefined {
  const portUpdate = update.portUpdate;
  if (portUpdate && "value" in portUpdate) {
    const { origin, value } = portUpdate;
    const inPath =
      origin === path.portId ||
      (path instanceof ArgumentAst &&
        Ast.isAstId(origin) &&
        contains(path.ast, origin));
    return inPath ? pathTextOf(value) : undefined;
  }
  if (update.edit && path instanceof ArgumentAst) {
    return pathTextOf(update.edit.tryGet(path.ast.id));
  }
  return undefined;
}

/**
 * The format type whose library the path that `update` sets needs, when the call has `path` and
 * `format` arguments, `format` is absent or `Auto_Detect`, the path's text changes, and exactly
 * one format type's patterns match it.
 */
export function formatTypeForPathUpdate(
  app: ArgumentApplication,
  update: WidgetUpdate,
): string | undefined {
  const args = [...app.iterApplications()].map((a) => a.argument);
  const path = args.find((a) => a.argInfo?.name === PATH_ARGUMENT);
  const format = args.find((a) => a.argInfo?.name === FORMAT_ARGUMENT);
  if (path == null || format == null) return undefined;
  if (format instanceof ArgumentAst && !isAutoDetect(format.ast.code()))
    return undefined;
  const before = path instanceof ArgumentAst ? pathTextOf(path.ast) : undefined;
  const after = newPathText(path, update);
  if (after == null || after === before) return undefined;
  return formatTypeForPath(after, format.dynamicConfig);
}
```

- [ ] **Step 10: Hook it into the call's update handler**

In `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction.vue`,
rename the existing `handleArgUpdate` to `applyArgUpdate` (its body and doc
comment unchanged), add the imports

```ts
import { requiredImportsForTypeName } from "$/providers/openedProjects/module/imports";
import { formatTypeForPathUpdate } from "@/components/GraphEditor/widgets/WidgetFunction/formatForPath";
```

and add, above it, the new `handleArgUpdate` (the template's
`:updateCallback="handleArgUpdate"` stays):

```ts
/**
 * With `format` on `Auto_Detect`, a change of the `path` argument also adds the import of the
 * library whose format reads that file (`WidgetFunction/formatForPath.ts`), in the same edit, so
 * that one undo removes both. Then the update is processed as before.
 */
function handleArgUpdate(update: WidgetUpdate): HandledUpdate {
  const app = application.value;
  const formatType =
    app instanceof ArgumentApplication
      ? formatTypeForPathUpdate(app, update)
      : undefined;
  const imports = formatType
    ? requiredImportsForTypeName(
        suggestionDb.value.entries,
        projectNames.value,
        suggestionDb.value.libraryPublicTypes,
        formatType,
      )
    : undefined;
  if (!imports?.length) return applyArgUpdate(update);
  const withImports = (edit: Ast.MutableModule) => {
    module.value.addMissingImports(edit, imports);
    return applyArgUpdate({ ...update, edit });
  };
  return update.edit
    ? withImports(update.edit)
    : module.value.edit(withImports);
}
```

`applyArgUpdate` already applies an update that carries `edit` inside that edit
(`if (update.edit) return applyInEdit(update.edit)`), and passes it on with
`edit` in every branch, so the import and the path change are one transaction.
`addMissingImports` skips an import that is already present.

- [ ] **Step 11: Run the tests and see them pass (GREEN)**

Rerun Step 5's command. Expected: all four files pass. Then, after deleting the
caches (Global Constraints):

```bash
corepack pnpm --filter enso-gui run typecheck
corepack pnpm --filter enso-gui run lint
corepack pnpm --filter enso-gui run test:unit
corepack pnpm exec prettier --check app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts \
  app/gui/src/providers/openedProjects/module/imports.ts \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/tags.ts \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection.vue \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetMultiSelection.vue \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction.vue \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/formatForPath.ts \
  app/gui/src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts \
  app/gui/src/providers/openedProjects/module/__tests__/requiredImportsForType.test.ts \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetSelection/__tests__/dropdownTags.test.ts \
  app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/formatForPath.test.ts
```

Run the same on Linux from a WSL clone of the branch (`~/enso-489-t2`, after
`corepack pnpm install`; the organize-imports plugin misbehaves only there), and
the existing Playwright specs that drive these widgets on both hosts:

```bash
corepack pnpm --filter enso-gui run test:integration -- \
  integration-test/project-view/widgets.spec.ts \
  integration-test/project-view/autoImports.spec.ts \
  integration-test/project-view/localDatalinkWidget.spec.ts --repeat-each=3
```

Expected: no failures beyond those `develop` shows on the same run (compare
before blaming the change).

- [ ] **Step 12: Document it**

In `app/gui/src/providers/openedProjects/module/CLAUDE.md`, after the
`requiredImports` bullet, add:

```markdown
- `requiredImportsForTypeName` turns a widget option's `requires` (a type's
  qualified name, from the format dropdowns since #489) into the imports it
  needs: the suggestion entry (a catalogue entry counts), else the type its own
  library declares, else nothing (logged at debug level).
```

In `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`, at the
end of "File layout", add:

```markdown
- `WidgetFunction/formatForPath.ts` — with `format` on `Auto_Detect`, which
  format library a call's new `path` needs: the one format type whose options'
  `patterns` match the file name (case ignored). `WidgetFunction.vue`'s
  `handleArgUpdate` adds its import in the update's edit; it is the one handler
  that sees every argument's update and every sibling's widget configuration
  (#489). A dropdown option's own `requires` is applied by
  `WidgetSelection/tags.ts`.
```

- [ ] **Step 13: Commit, push, open the PR**

Commit the files of this task's list with the message
`GUI: picking a format, or a file it reads, adds the format's library import`
and the two trailer lines. Push, write the PR body to a file (the behaviour, the
rulings on matching and ambiguity, the test runs on both hosts, "Part of #489;
Task 3 stacks on this PR"), and open it with
`gh pr create --base develop --body-file <file>` and the label
`CI: No changelog needed`. Do not merge: it waits for Task 3 and the owner's OK.

---

### Task 3: End-to-end tests, screenshots and the changelog entry

Carries the changelog entry and merges after the owner's OK. Branch
`feat/489-format-imports-e2e` from Task 2's branch.

**Files:**

- Create: `app/gui/integration-test/project-view/dataReadImports.spec.ts`
- Modify: `CHANGELOG.md`
- Not committed:
  `app/gui/integration-test/project-view/dataReadImports.shots.spec.ts` (the
  screenshot run, deleted after use)

**Interfaces:**

- Consumes: Task 2's behaviour through the real widgets, with the mock language
  server's `setMockMainFile`, `setMockPublicTypes`, `updateVisualizationData`,
  `restoreMockMainFile` and `restoreMockWidgetConfigurations`
  (`integration-test/mock/lsHandler.ts`) and `mockMethodCallInfo`
  (`integration-test/project-view/expressionUpdates.ts`).

- [ ] **Step 1: Write the Playwright tests**

Create `app/gui/integration-test/project-view/dataReadImports.spec.ts`:

```ts
/** @file Data.read adds the import of the library that reads the file (#489). */
import { expect, test, type Page } from "integration-test/base";
import {
  restoreMockMainFile,
  restoreMockWidgetConfigurations,
  setMockMainFile,
  setMockPublicTypes,
  updateVisualizationData,
} from "integration-test/mock/lsHandler";
import { mockMethodCallInfo } from "./expressionUpdates";
import * as locate from "./locate";

const MAIN =
  "from Standard.Base import all\n\n## A project for the format imports.\nmain =\n    data = Data.read\n";
const SQLITE_IMPORT = "from Standard.SQLite import SQLite_Format";
const DB_FILE = "/home/user/enso/data/Sales.db";
const UNKNOWN_FILE = "/home/user/enso/data/notes.xyz";

// What `File_Format.default_widget` sends for these formats since #489.
const FORMAT_CONFIG = [
  [
    "format",
    {
      type: "Widget",
      constructor: "Single_Choice",
      label: null,
      values: [
        {
          label: "Auto Detect",
          value: "Standard.Base.System.File_Format.Auto_Detect",
          parameters: [],
          icon: "",
        },
        {
          label: "SQLite",
          value: "..SQLite",
          parameters: [],
          icon: "",
          requires: "Standard.SQLite.SQLite_Format.SQLite_Format",
          patterns: ["*.sqlite", "*.db"],
        },
      ],
      display: { type: "Display", constructor: "When_Modified" },
    },
  ],
];

/** The module's code, with the code editor open. */
async function moduleCode(page: Page): Promise<string> {
  const editor = page.locator(".CodeEditor");
  if (!(await editor.isVisible())) await page.keyboard.press("ControlOrMeta+`");
  await expect(editor).toBeVisible();
  return page.evaluate(() => (window as any).__codeEditorApi.textContent());
}

async function dataReadNode(page: Page) {
  updateVisualizationData(".read", FORMAT_CONFIG);
  await mockMethodCallInfo(page, "data", {
    methodPointer: {
      module: "Standard.Base.Data",
      definedOnType: "Standard.Base.Data",
      name: "read",
    },
    notAppliedArguments: [0, 1, 2],
  });
  return locate.graphNodeByBinding(page, "data");
}

async function chooseFile(page: Page, file: string) {
  await page.evaluate((file) => {
    Object.assign(window.api!.fileBrowser, {
      openFileBrowser: async () => [file],
    });
  }, file);
  const node = await dataReadNode(page);
  const pathArg = node
    .locator(".WidgetTopLevelArgument")
    .filter({ hasText: "path" });
  await pathArg.click();
  await page.getByText("Choose file…").click();
  await expect(pathArg.getByTestId("widget-text-content")).toHaveText(file);
}

test.use({
  setupApi: {
    local: () => {
      setMockMainFile(MAIN);
      // `Standard.SQLite` is not loaded: only its declaration knows `SQLite_Format`.
      setMockPublicTypes([
        { name: "SQLite_Format", library: "Standard.SQLite" },
      ]);
    },
  },
});
test.afterEach(restoreMockMainFile);
test.afterEach(restoreMockWidgetConfigurations);

test("choosing SQLite in the format dropdown adds its import; one undo removes both", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  const node = await dataReadNode(page);
  await node.click();
  const formatArg = node
    .locator(".WidgetTopLevelArgument")
    .filter({ has: page.getByText("format") });
  await formatArg.click();
  await page
    .locator(".DropdownWidget:not([data-transitioning]) .item")
    .filter({ hasText: "SQLite" })
    .click();
  await expect(node).toContainText("SQLite");
  await expect.poll(() => moduleCode(page)).toContain(SQLITE_IMPORT);
  // The code keeps the short form: no qualified name is inserted.
  expect(await moduleCode(page)).toContain("..SQLite");
  expect(await moduleCode(page)).not.toContain("SQLite_Format.SQLite");

  await page.getByTestId("action:graph.undo").click();
  await expect.poll(() => moduleCode(page)).not.toContain(SQLITE_IMPORT);
  expect(await moduleCode(page)).not.toContain("..SQLite");
});

test("choosing a .db file with format on Auto_Detect adds the SQLite import; one undo removes both", async ({
  editorPage,
  page,
}) => {
  await editorPage;
  await chooseFile(page, DB_FILE);
  await expect.poll(() => moduleCode(page)).toContain(SQLITE_IMPORT);

  await page.getByTestId("action:graph.undo").click();
  await expect.poll(() => moduleCode(page)).not.toContain(SQLITE_IMPORT);
  expect(await moduleCode(page)).not.toContain("Sales.db");
});

test("a file no format claims adds no import", async ({ editorPage, page }) => {
  await editorPage;
  await chooseFile(page, UNKNOWN_FILE);
  await expect.poll(() => moduleCode(page)).toContain("notes.xyz");
  expect(await moduleCode(page)).not.toContain("Standard.SQLite");
});
```

- [ ] **Step 2: Run it on develop and see it fail (RED), then on the branch
      (GREEN)**

Copy the spec into a `develop` worktree and run it there, then run it on this
branch, on Windows and in a WSL clone (rebuild the workspace packages first in a
reused clone: `corepack pnpm -r compile`):

```bash
for v in $(env | cut -d= -f1 | grep -E '^(ENSO_|AWS_|SNOWFLAKE|GOOGLE_|AZURE_|GCP_|DATABRICKS)'); do unset "$v"; done
corepack pnpm --filter enso-gui run test:integration -- \
  integration-test/project-view/dataReadImports.spec.ts --repeat-each=3
```

Expected on `develop`: the first two tests fail on `SQLITE_IMPORT`, the third
passes. On the branch: all three pass in every repeat, with `--workers=2` too.

- [ ] **Step 3: Before and after screenshots**

Create, uncommitted,
`app/gui/integration-test/project-view/dataReadImports.shots.spec.ts`, which
repeats the two flows without assertions on the import and saves the code
editor:

```ts
/** @file Not committed: the before/after screenshots for #489. */
import { expect, test, type Page } from "integration-test/base";
import {
  restoreMockMainFile,
  restoreMockWidgetConfigurations,
  setMockMainFile,
  setMockPublicTypes,
  updateVisualizationData,
} from "integration-test/mock/lsHandler";
import { mockMethodCallInfo } from "./expressionUpdates";
import * as locate from "./locate";

const OUT = process.env.SHOTS_DIR!;
const MAIN =
  "from Standard.Base import all\n\n## A project for the format imports.\nmain =\n    data = Data.read\n";
const FORMAT_CONFIG = [
  [
    "format",
    {
      type: "Widget",
      constructor: "Single_Choice",
      label: null,
      values: [
        {
          label: "Auto Detect",
          value: "Standard.Base.System.File_Format.Auto_Detect",
          parameters: [],
          icon: "",
        },
        {
          label: "SQLite",
          value: "..SQLite",
          parameters: [],
          icon: "",
          requires: "Standard.SQLite.SQLite_Format.SQLite_Format",
          patterns: ["*.sqlite", "*.db"],
        },
      ],
      display: { type: "Display", constructor: "When_Modified" },
    },
  ],
];

async function node(page: Page) {
  updateVisualizationData(".read", FORMAT_CONFIG);
  await mockMethodCallInfo(page, "data", {
    methodPointer: {
      module: "Standard.Base.Data",
      definedOnType: "Standard.Base.Data",
      name: "read",
    },
    notAppliedArguments: [0, 1, 2],
  });
  return locate.graphNodeByBinding(page, "data");
}

async function shootCode(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.keyboard.press("ControlOrMeta+`");
  await expect(page.locator(".CodeEditor")).toBeVisible();
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test.use({
  setupApi: {
    local: () => {
      setMockMainFile(MAIN);
      setMockPublicTypes([
        { name: "SQLite_Format", library: "Standard.SQLite" },
      ]);
    },
  },
});
test.afterEach(restoreMockMainFile);
test.afterEach(restoreMockWidgetConfigurations);

test("format pick", async ({ editorPage, page }) => {
  await editorPage;
  const n = await node(page);
  await n.click();
  await n
    .locator(".WidgetTopLevelArgument")
    .filter({ has: page.getByText("format") })
    .click();
  await page
    .locator(".DropdownWidget:not([data-transitioning]) .item")
    .filter({ hasText: "SQLite" })
    .click();
  await shootCode(page, "format-pick");
});

test("file pick", async ({ editorPage, page }) => {
  await editorPage;
  await page.evaluate(() => {
    Object.assign(window.api!.fileBrowser, {
      openFileBrowser: async () => ["/home/user/enso/data/Sales.db"],
    });
  });
  const n = await node(page);
  await n
    .locator(".WidgetTopLevelArgument")
    .filter({ hasText: "path" })
    .click();
  await page.getByText("Choose file…").click();
  await shootCode(page, "file-pick");
});
```

Run it on Linux (WSL, where the screenshot baselines live) in the `develop`
worktree with `SHOTS_DIR=<scratch>/489-shots/before` and on this branch with
`SHOTS_DIR=<scratch>/489-shots/after`, both with
`corepack pnpm --filter enso-gui run test:integration -- integration-test/project-view/dataReadImports.shots.spec.ts`,
then delete the file from both worktrees. Check each image shows the code editor
with `data = Data.read …`, and that only the "after" images show
`from Standard.SQLite import SQLite_Format`.

- [ ] **Step 4: The changelog entry, the commit, the PR**

Open the PR first to learn its number `N`
(`gh pr create --base <Task 2's branch> --draft --body-file <file>`), then under
`# Next Release` › `#### Enso IDE` in `CHANGELOG.md` add, first:

```markdown
- [Choosing a file format, or a file, in Data.read adds the import of the
  library that reads it.][N]
```

with `[N]: https://github.com/jdunkerley/enso/pull/N` among the link
definitions. Commit `dataReadImports.spec.ts` and `CHANGELOG.md` with the
message `Data.read imports: end-to-end tests and changelog` and the two trailer
lines, and push.

Push the screenshots to the orphan `pr-screenshots` branch (never to this
branch), from a scratch worktree:

```bash
git fetch origin pr-screenshots
git worktree add "<scratch>/pr-shots" origin/pr-screenshots --detach
mkdir -p "<scratch>/pr-shots/pr-N"
cp <scratch>/489-shots/before/format-pick.png "<scratch>/pr-shots/pr-N/format-pick-before.png"
cp <scratch>/489-shots/after/format-pick.png "<scratch>/pr-shots/pr-N/format-pick-after.png"
cp <scratch>/489-shots/before/file-pick.png "<scratch>/pr-shots/pr-N/file-pick-before.png"
cp <scratch>/489-shots/after/file-pick.png "<scratch>/pr-shots/pr-N/file-pick-after.png"
git -C "<scratch>/pr-shots" add pr-N
git -C "<scratch>/pr-shots" commit -F <message file>
git -C "<scratch>/pr-shots" push origin HEAD:pr-screenshots
git worktree remove "<scratch>/pr-shots"
```

(the message `Screenshots for PR N` with the two trailer lines). Rewrite the PR
body file with the four images embedded as
`![format pick, after](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-N/format-pick-after.png)`
(and the other three), the Playwright runs on both hosts and `develop`'s RED
run, "Closes #489", and update the PR with `gh pr edit N --body-file <file>`;
mark it ready. Wait for the owner's OK, then follow "Merge order".

---

## Self-review

- **Spec coverage.** Section 1 (`requires`, JSON only when set): Task 1 Steps 4
  and 1. Section 2 (`requires` and `patterns` from `File_Format_SPI.get_types`,
  `get_name_patterns`; neither on `Auto_Detect` and `Raw_Response`; every
  caller): Task 1 Steps 5, 1 and 2, with the caller list corrected (rulings).
  Section 3 (schema; imports on a pick in the choice's edit; the path hook on
  the file browser and typing, `format` absent or `Auto_Detect`, the same glob
  semantics, exactly one match, nothing on none or several; existing imports
  left alone; unknown type adds nothing and logs at debug level): Task 2 Steps
  6–10, tested in Steps 1–4. Section 4 (out of scope): nothing imports by result
  type, nothing removes an import, hand-written `..X` stays undetected. Testing:
  Base_Tests and Visualization_Tests (Task 1), vitest for parsing, the pick, the
  path matching, ambiguity, explicit format, and case (Task 2), Playwright for
  the pick, the `.db` file and one undo (Task 3), screenshots (Task 3 Step 3).
  Changelog: Task 3 Step 4, with the spec's wording. Risks: each shipped pattern
  is in `matchesNamePattern`'s table (Task 2 Step 4).
- **Placeholders.** None in code. `N` (Task 3's PR number) and `<scratch>` (the
  session scratchpad) are values known when the step runs; `<file>` and
  `<message file>` are the files the Global Constraints ask for.
- **Names.** `Choice.Option`'s `requires`/`patterns`,
  `File_Format.dropdown_options`, `requiredImportsForTypeName`,
  `libraryPublicTypes`, `formatForPath.ts`'s six exports,
  `handleArgUpdate`/`applyArgUpdate` are spelled the same in every task, test
  and document.
- **Paths checked against the code:** every modified file exists; every created
  file is created in its task before a later step uses it.
