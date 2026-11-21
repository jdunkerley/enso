# Widgets PR 4: Unions and the Kind Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An argument whose declared type is a union (`Integer | Nothing`,
`Text | Regex`, `Text | Enso_Secret`, `Locale | Nothing`) shows a small type
icon in front of the value of the kind it has. On a selected node the icon
becomes a button that opens a list of the kinds; choosing one writes that kind's
default value (`Nothing` included) as one undoable edit. A member that another
member converts from is not a kind of its own (`Text | File` is File alone, with
its file browser). When every member is a plain dropdown, the members' choices
merge into one dropdown instead, with `Nothing` as an entry. `Vector T` items
get T's widget, with an icon each when T is a union. `Regex` gets a type
default, `Widget.Regex_Input`, so `Text | Regex` offers both. Engine side,
`Widget.Union` lets a type default or an annotation produce the same picker.

**Architecture:** The GUI composes a union's widget itself from the per-type
defaults PR 3b caches (`TypeDefaults`) and the conversions the suggestion
database already indexes (`conversionSources`), so a union costs no engine query
beyond its members' once-per-type `resolve_type`. A pure module
(`unionKinds.ts`) splits the declared type into members, drops members without a
widget and members another member converts from, collapses equal widgets, and
returns one of: nothing, a single kind's widget, a merged `Single_Choice`, or a
`Union` configuration. A new composite widget, `WidgetKindPicker.vue` (priority
44), draws the kind's icon (a button with an arrow on a selected node) and hands
the chosen kind's configuration to the next widget on the same port, exactly as
`WidgetSelection` hands `singleChoiceConfiguration` to its inner widget. The
chosen kind is always derived from the code (`matchKind`), never stored. A new
`WidgetRegex.vue` edits a `regex '…'` value's pattern. PR 3b's two interim rules
(the first non-`Nothing` member's default, and `WidgetFileBrowser`'s
`reprType.includes` rule) are deleted.

**Tech Stack:** Enso (Base), TypeScript + Vue 3 + zod (GUI), vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§1
precedence, §4 "Unions and vectors: the kind picker"; Testing: "kind picker
(initial kind from the value; switching is one undoable edit)", Playwright
"`Text | Nothing` choosing Nothing"; PR table row 4; Non-goals). This PR amends
§4 and the Non-goals (see "Spec amendment" below; the plans PR makes the edit).

**Depends on:** PR 3b
(`docs/superpowers/plans/2026-11-19-widgets-pr3b-gui-type-defaults.md`), which
is being implemented in parallel. **Start after 3b merges**, from
`origin/develop` at or after its merge commit. Inputs this plan takes from 3b,
by name (check each exists before Task 4; if 3b renamed one, use its name and
note it in the PR body):

- `app/gui/src/providers/openedProjects/widgetRegistry/typeDefaults.ts`:
  `TypeDefaults` (`lookup(reprType, frame)`), `defaultSourceType(reprType)`,
  `RESOLVE_TYPE_EXPRESSION`, `WIDGET_TYPE`, and the production `hasDefault`
  wiring over `suggestionDb.conversionSources` (keys built with
  `parseAbsoluteProjectPathRaw(…).value.key()`).
- `configuration.ts` kinds `Date_Input`, `Date_Time_Input`, `Time_Input`;
  `File_Browse.action?: 'Open' | 'Save'`.
- `callTree.ts`: `ArgumentFactory`'s `typeDefault` callback and
  `dynamicConfig(name)` =
  `widgetCfg?.parameters.get(name) ?? this.typeDefault?.(argInfo?.reprType)`.
- `WidgetVector/elementType.ts`:
  `vectorItemConfig(itemEditor, elementType, typeDefault)`.
- Widgets score on `dynamicConfig.kind` (`Boolean_Input`, `Numeric_Input`,
  `Text_Input`, `Date_Input`, `Time_Input`, `Date_Time_Input`, `File_Browse`,
  `Secret_Browse`).
- The transitional rule in `WidgetFileBrowser.vue`'s score, marked
  `// Until PR 4's kind picker: a union containing a browsable type keeps the browser.`
- `test/Base_Tests/src/Type_Default_Spec.enso` (3a, extended by 3b) and the
  module-level `Widget.from (that : X.type)` conversions at the end of
  `Metadata.enso` (3b; some may live in their type's module if an import cycle
  forced it — 3b's report says which).
- The integration mock's `initialMockTypeDefaults` / `updateMockTypeDefault`
  (`app/gui/integration-test/mock/lsHandler.ts`) and the group D `Widget.from`
  entries in `mockSuggestions.json`.

## Owner decisions (2026-11-21)

The spec left these open; the owner decided them on 2026-11-21. The task named
in brackets carries each.

1. **The GUI builds a declared union's picker** from the members' type defaults
   it already caches (once per type per session, PR 3b). An engine
   `resolve_type "A | B | Nothing"` would cost one query per distinct union and
   duplicate the composition rules in Enso. `Widget.Union` still exists for
   annotations and type defaults that want a picker (spec §4 "so a type default
   or resolver can produce one too"); its JSON parses into the same
   configuration. [Tasks 4–5]
2. **`Widget.Union` carries `Nothing` in a second field**,
   `Widget.Union kinds:(Vector (Pair Text Widget)) include_nothing:Boolean=False`
   (spec amendment), so `Nothing` is never a fake widget. [Tasks 1, 3]
3. **The conversion rule** (replaces the recommended "drop `Text` beside a
   browser"). A union member A is not a kind when another member B of the same
   union **that has a widget** has a conversion `B.from (that : A)`: B absorbs
   A, and B's widget edits A's literals. The GUI reads conversions from the
   suggestion database's `conversionSources` index (target key → source keys),
   the index 3b's `hasDefault` already uses. [Tasks 4–5] Researched on `develop`
   (2026-11-21):
   - `File.from (that:Text) = File.new that`
     (`distribution/lib/Standard/Base/0.0.0-dev/src/System/File.enso:1184`), so
     `Text | File` is File alone, `Text | File | Nothing` is File and Nothing,
     and `Data.read`'s `path` (`Text | URI | File`) keeps its file browser
     exactly as today. `Writable_File.from (that : Text)` and
     `Writable_File.from (that : File)` likewise make `Text | Writable_File` the
     save browser alone.
   - `URI.from (that:Text) = URI.parse that` (`Network/URI.enso:393`). `URI` has
     no widget, so it absorbs nothing (a member without a widget is never an
     absorber) and is not a kind itself: no visible effect.
   - **No `Enso_Secret.from (that : Text)` exists**, in any spelling. The only
     conversion _to_ `Enso_Secret` in the standard libraries is
     `Enso_Secret.from that:Generated_Key_Pair` (Snowflake
     `Connection/Key_Pair_Credentials.enso:163`). So `Text | Enso_Secret` keeps
     **both** kinds, as the owner intends: a text literal is a plain password
     (Text), `Enso_Secret.get '…'` is Secret.
   - `Derived_Secret_Value.from (that : Text)` and
     `Derived_Secret_Value.from (that : Enso_Secret)` exist
     (`Enso_Cloud/Enso_Secret.enso:398,403`), and `Header`'s value arguments are
     `Text | Enso_Secret | Derived_Secret_Value` (`Network/HTTP/Header.enso`).
     `Derived_Secret_Value` has no widget, so it absorbs nothing and those
     arguments keep Text and Secret. **If a later PR gives
     `Derived_Secret_Value` a widget, it would absorb both** and the picker
     would disappear from `Header` — a test pins today's behaviour (Task 4) so
     that change is noticed.
   - No `Regex.from (that : Text)` exists (only
     `Regex.from (that:Named_Pattern)`, and no union lists `Named_Pattern`), so
     `Text | Regex` keeps both kinds.
   - `Float.from (that:Integer)` exists, so `Integer | Float` is Float alone
     (previously the equal-widget rule kept Integer; the result is the same
     widget, only the label and icon of `Integer | Float | Nothing`'s first kind
     become Float's).
   - Other conversions from a widget type to a type that may get a widget later
     (`Decimal.from` Integer/Float/Text, `Positive_Integer.from Integer`,
     `Date_Time_Formatter.from Text`, `Email_Attachment.from` File/Text, …)
     follow the same rule automatically.
   - **`Nothing` is exempt**: it is never absorbed
     (`Row_Limit.from (that:Nothing)` and `Rows_To_Read.from (that:Nothing)`
     exist; `Nothing` stays the explicit choice the spec wants) and never
     absorbs.
   - Mutual conversions (A → B and B → A) keep the earlier member; if a cycle
     would drop every member, the first is kept.
   - **How the secret widget reads values (checked):**
     `WidgetFileBrowser/browsableTypes.ts`'s `useBrowserTypeInfo` gives
     `Secret_Browse` `rawPath: null`, and `useCurrentPath` reads a secret only
     from `Enso_Secret.get '…'`, never from a bare text literal. So `matchKind`
     matches `Secret_Browse` only on `Enso_Secret.get …` and a text literal in
     `Text | Enso_Secret` is Text — consistent with the rule. For `File_Browse`
     the inner widget keeps the argument's full `reprType`, so `rawPath` still
     comes from the declared `Text | File` and a typed path stays a raw path.
4. **Members with equal widgets collapse into the first** (deep-equal
   configurations), after the conversion rule. [Task 4]
5. **What switching to each kind writes** (one place, `kindDefaultCode`, Task
   6):

   | Kind's widget                      | Writes                                                                  |
   | ---------------------------------- | ----------------------------------------------------------------------- |
   | `Nothing`                          | `Nothing`                                                               |
   | `Text_Input`                       | `''`                                                                    |
   | `Numeric_Input`                    | `minimum` if set and positive, else `0`                                 |
   | `Boolean_Input`                    | `False`                                                                 |
   | `Date_Input`                       | `Date.today` (with the `Date` import, as `WidgetDate` adds it)          |
   | `Time_Input`                       | `Time_Of_Day.now` (import likewise)                                     |
   | `Date_Time_Input`                  | `Date_Time.now` (import likewise)                                       |
   | `Regex_Input`                      | `regex '.*'` (an empty pattern is an error: `Regex.compile` rejects '') |
   | `Single_Choice`                    | its first option's `value` (and that option's `requires`)               |
   | `Multiple_Choice`, `Vector_Editor` | `[]`                                                                    |
   | `File_Browse`, `Folder_Browse`     | `''` (the browser then opens on the empty path)                         |
   | `Secret_Browse`                    | `Enso_Secret.get ''` (with the `Enso_Secret` import) — see below        |
   | anything else                      | not offered as a kind (no sensible value to write)                      |

   The date/time defaults are those `WidgetVector/elementType.ts`'s
   `DEFAULT_ITEMS` already use for new list items. **`Secret_Browse` differs
   from the recommendation (`''`)** as a consequence of decision 3: with Text
   kept beside Secret, `''` would read back as Text and the picker would
   contradict the choice just made. Writing the secret constructor keeps the
   kind, and the browser opens on the empty path.

6. **A value that matches no kind** (a variable, `x + 1`, a call): the picker
   steps aside (`Score.Mismatch`) and the argument is drawn as any expression;
   "the first member" applies to an unset argument (placeholder). [Tasks 6, 9]
7. **`Regex` is in PR 4** (flipped). A new `Widget.Regex_Input` constructor
   (JSON `{"constructor":"Regex_Input"}`), `Widget.from (that : Regex.type)`, a
   GUI zod kind and `WidgetRegex.vue`, which edits the pattern's text and writes
   `regex '…'`. The standard library spells a regex as the function
   `regex : Text -> Regex` (`Data/Text/Regex.enso:594`, exported from
   `Standard.Base`; 51 uses in the libraries' sources) or
   `Regex.compile expression`. `matchKind`: `regex '…'` / `regex "…"` /
   `Regex.compile …` → Regex; a plain text literal → Text. So `Text | Regex`
   (`Text.replace`'s `term`) and `Regex | Text` (`Text.find`'s `pattern`,
   `Regex.compile`'s `expression`) show a picker. [Tasks 2, 3, 6, 8]
8. **`Vector T` new-item value when T's widget is not a dropdown: the first
   kind's default value** from decision 5 (`''`, `0`, `Date.today` …), not a
   blank `_`, which would make the list a function (spec amendment). [Task 5]
9. **No standard-library use of `Widget.Union` in this PR.** Declared unions are
   composed by the GUI (decision 1); the constructor is tested and documented,
   and the first library use arrives with a resolver in PR 6.
10. **The look: the "Compact" mockup** (owner-approved; the mockup HTML was
    `C:\Users\jdunk\AppData\Local\Temp\claude\e9eef8f2aeadec5d\181ebb77-e185-4d9e-84a5-e3842119fd4c\scratchpad\Compact-mockup.html`,
    a temporary file, so its sizes, colours and draft icon paths are copied
    here). [Tasks 7, 9]
    - **Node not selected:** a faint 14 px type icon in front of the value
      (`color: rgba(255,255,255,.9)`, box 18 px high, padding `0 4px`). No
      arrow; not clickable (clicks go to the node as today).
    - **Node selected** (`injectWidgetTree().showDetails`, the signal
      the ＋ uses): the icon becomes a `<button>`: dark translucent pill
      (`background: rgba(0,0,0,.22)`, `:hover` `rgba(0,0,0,.34)`, height 18 px,
      `border-radius: 9px`, padding `0 3px 0 4px`, gap 1 px, white), holding the
      icon and a small down arrow (the sprite's `arrow_right_head_only` rotated
      90°, ~9 px, opacity .9, as `SelectionArrow.vue` draws it; `SelectionArrow`
      itself is an absolutely-positioned teleport below a widget and does not
      fit inline). Clicking it opens the existing `DropdownWidget` with every
      kind as icon + member short name (`DropdownEntry.icon`), the current one
      selected, `Nothing` last with no icon. It is reachable by keyboard (a real
      button: Enter/Space open, Escape closes, the dropdown's own arrow-key
      handling) and has `aria-label="<Kind>, change kind"`,
      `aria-haspopup="listbox"` and `aria-expanded`.
    - **`Nothing` chosen:** no icon and no second `Nothing`: the single
      `Nothing` value is the picker. Selected: a `Nothing ▼` button (the same
      pill, padding `0 6px 0 8px`, bold value font,
      `aria-label="Nothing, change kind"`). Not selected: plain `Nothing`, drawn
      as the node draws the identifier today.
    - **Icons** (house sprite `app/gui/src/project-view/assets/icons.svg`): Text
      → `text_input`; Integer → `input_number`; Float / Number → NEW
      `input_decimal` ("1.5" in the field frame); Boolean → NEW `toggle` (a
      switch); Date → `calendar`; Time_Of_Day → `time`; Date_Time → `datetime`;
      File (and Writable_File) → `document`; Folder (`Folder_Browse`) →
      `folder`; Enso_Secret → `key`; Regex → NEW `regex` (".\*" in a box);
      Vector → `array_new`. A kind with no mapped icon (a dropdown type,
      `Multiple_Choice`, …) shows its short name as text in the chip instead.
      The icon is chosen by a small GUI map, `kindIcon` (Task 7): widget kind
      first (the browsers, `Vector_Editor`, `Regex_Input`, the inputs), then,
      for `Numeric_Input`, the member: a label ending in `Integer` →
      `input_number`, else `input_decimal`. **Libraries defining icons for their
      own types is a later idea, not PR 4.**
    - **Lists** (`Vector (A | B)`): each item gets the same icon chip.

11. **The node stays close to the code (owner, 2026-11-21; a design principle to
    keep).** The icon is the only thing the picker adds. Beside it the node
    still shows the code itself, drawn by the chosen kind's existing widget as
    it is today: `Date.new 2026 11 21`, `File.new 'sales.csv'`,
    `Enso_Secret.get 'db-password'`, `regex 'a.*c'`, never a formatted stand-in
    (`2026-11-21`, `db-password`) that the code does not hold. An unselected
    `Nothing` is plain `Nothing`, as the node draws the identifier today (not a
    pill). Switching kind writes real code (decision 5's table, with Enso_Secret
    writing `Enso_Secret.get ''`, since a bare `''` reads back as Text).
    Playwright asserts the node's text still contains the written code after a
    switch.
12. **Follow-up answers (owner, 2026-11-21):** `Nothing` is exempt from the
    conversion rule (`Rows_To_Read`, `Row_Limit` convert from it) and stays the
    explicit choice; `Derived_Secret_Value` (HTTP `Header`) has no widget, so it
    absorbs nothing and the test pinning that stays; `Integer | Float | Nothing`
    is labelled Float (`Float.from Integer` exists).

## Spec amendment (made in the plans PR, #911)

§4's "Plan for PR 4" note became:

> **Decided 2026-11-21 (owner; plan for PR 4):** the GUI composes a declared
> union's picker from its members' cached type defaults; `Widget.Union` has a
> second field `include_nothing:Boolean=False`. A member A is not a kind when
> another member B with a widget has a conversion `B.from (that : A)` (B's
> widget edits A's literals): `Text | File` is File alone, while
> `Text | Enso_Secret` and `Text | Regex` keep both kinds. `Nothing` is never
> absorbed. Members with equal widgets collapse. A set value that matches no
> kind gets no picker. A `Vector T` item's default is the first option of a
> dropdown, otherwise the first kind's default value. `Regex` gets a type
> default, `Widget.Regex_Input`, which writes `regex '…'`. The picker is a 14 px
> type icon in front of the value, which becomes a button with an arrow when the
> node is selected; with `Nothing` chosen, the `Nothing` value itself is the
> picker.

and the Non-goals' "New widget kinds beyond `Widget.Union` and the three
date/time inputs" became "beyond `Widget.Union`, `Widget.Regex_Input` and the
three date/time inputs"; the PR table's row 4 reads "Unions: `Widget.Union` +
kind picker; `Regex` type default (`Widget.Regex_Input`)".

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr4`, branch
  `widgets/pr4-union-kind-picker`, from `origin/develop` **after PR 3b merges**.
  Linux clone `~/enso-widgets-pr4` on WSL `Ubuntu-24.04` (source
  `~/.enso-toolchain.sh` first) for the engine build, the stdlib suites and
  Playwright (baselines and CI are Linux). Helper script `~/pr4.sh`: copy
  `~/pr1b.sh` from the PR 1b plan
  (`docs/superpowers/plans/2026-11-18-widgets-pr1b-gui-method-pointers.md`,
  "Working environment") with `WIN=/mnt/c/Repos/Enso/ide-widgets-pr4`,
  `LNX=$HOME/enso-widgets-pr4`, and the rsync exclude `--exclude=.git` (a
  worktree's `.git` is a file). Check `df -h ~` and `E:` first; delete the
  worktree, the clone and `~/pr4.sh` when the PR merges.
- Never `git stash` (the stash is shared with other sessions); never
  `gh pr merge --delete-branch` while the branch is in a worktree. Use
  `corepack pnpm`.
- Precedence (spec §1) is unchanged: annotation or inherited configuration, then
  type default, then literal detection and `tagValues`. A union's composed
  configuration is a type default: **no picker when an annotation applies**.
- The picker never contradicts the code: the shown kind is always computed from
  the current value (`matchKind`); no state remembers a choice. Every kind's
  `kindDefaultCode` must match back to that kind (a test checks it, Task 6).
- Switching kind is **one** `module.edit` → one `updateCallback` (one undo
  step), imports included.
- A bare `Vector`/`Array` stays with the GUI (spec §4): `WidgetVector`'s
  `expectedType.startsWith('Standard.Base.Data.Vector.Vector')` score stays.
- New icons follow the sprite's style rules
  (`https://github.com/jdunkerley/enso/wiki/Style-Guide-Icons`: 16×16 viewBox,
  `currentColor`, the 0.3-opacity + solid two-tone, no transforms, at most two
  decimals); `src/project-view/assets/__tests__/iconStyle.test.ts` must pass
  without new entries in `iconStyleKnownViolations.ts`.
- `lintEnso` runs with `-Werror`: `sbt "all lintEnso"` stays green. Regenerate
  the API docs of every changed library
  (`bin/enso --docs api --in-project <lib>`) and run
  `corepack pnpm --filter build-scripts run stdlib-api-check`.
- Stdlib suites only against a full distribution (`buildEngineDistribution`, not
  NoIndex, which lacks the test-helper jars). Check each run's
  `N tests succeeded.` line: a filter that matches nothing exits 0.
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`: "Arguments
  that accept several types of value, such as a number or `Nothing`, show a
  small icon for the kind of value; on a selected node it opens a list of the
  kinds, and choosing one writes a value of that kind. Regular-expression
  arguments get their own input." (`[NNN]` = the PR number; open the PR as draft
  first to learn it.)
- **Screenshots** before/after on the orphan `pr-screenshots` branch under
  `pr-<NNN>/` (Linux Playwright mock): `Integer | Nothing` unselected, selected
  and with the list open; `Nothing` chosen (selected and not); `Text | Regex`;
  `Text | Enso_Secret`; `Data.read`'s `path` (unchanged); a
  `Vector (Text | Integer)` list; the icon gallery (a mocked union of every
  kind, selected, list open).
- **Owner installer test before merge** (Windows installer; feature merge gate).
  Do not merge without the owner's OK.

## File Structure

**Engine (Base)**

- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`:
  `Widget.Union`, `Widget.Regex_Input`, their `to_json`, and
  `Widget.from (that : Regex.type)` (or in `Data/Text/Regex.enso` if the import
  cycles; Task 2).
- Modify `test/Base_Tests/src/Metadata_Spec.enso` (Union JSON),
  `test/Base_Tests/src/Type_Default_Spec.enso` (Regex default).
- Regenerate `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md`
  (and `Data/Text/Regex.md` if the conversion lands there).

**GUI** (`W/` = `app/gui/src/project-view/components/GraphEditor/widgets/`,
`REG/` = `app/gui/src/providers/openedProjects/widgetRegistry/`)

- Modify `REG/configuration.ts`: the `Union` and `Regex_Input` kinds.
- Create `REG/unionKinds.ts`: members of a declared type, the composition rules
  (pure).
- Modify `REG/typeDefaults.ts` (3b): unions through `unionKinds.ts`, a
  `converts` dependency; `defaultSourceType` deleted. Modify the place that
  constructs `TypeDefaults` in production (3b's wiring) to pass `converts`.
- Create `W/WidgetKindPicker/kindMatch.ts`: `matchKind`, `kindDefaultCode`
  (pure).
- Create `W/WidgetKindPicker/kindIcon.ts`: `kindIcon` (pure).
- Create `W/WidgetKindPicker.vue`: the composite widget.
- Create `W/WidgetRegex.vue` and `W/WidgetRegex/regexExpression.ts`.
- Modify `app/gui/src/project-view/assets/icons.svg` (three symbols) and the
  generated `app/gui/src/project-view/util/iconMetadata/iconName.ts`.
- Modify `W/WidgetVector.vue`, `W/WidgetVector/elementType.ts`: union elements,
  item default.
- Modify `W/WidgetFileBrowser.vue`, `W/WidgetFileBrowser/browsableTypes.ts`:
  delete the transitional rule.
- Modify `app/gui/integration-test/mock/data/mockSuggestions.json`,
  `app/gui/integration-test/mock/lsHandler.ts`,
  `app/gui/integration-test/project-view/widgets.spec.ts`.
- Modify `W/CLAUDE.md`, `CHANGELOG.md`.
- Tests: `REG/__tests__/configuration.test.ts`, new
  `REG/__tests__/unionKinds.test.ts`, `REG/__tests__/typeDefaults.test.ts`
  (3b's), new `W/WidgetKindPicker/__tests__/kindMatch.test.ts`, new
  `W/WidgetKindPicker/__tests__/kindIcon.test.ts`, new
  `W/WidgetKindPicker/__tests__/widgetKindPicker.score.test.ts`, new
  `W/WidgetRegex/__tests__/regexExpression.test.ts`,
  `W/WidgetVector/__tests__/elementType.test.ts`, new
  `W/WidgetFileBrowser/__tests__/widgetFileBrowser.score.test.ts`.

---

## Task 1: Engine — `Widget.Union`

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`
  (`type Widget` at line 70; add the constructor after `Any_To_Target`, line
  121, **not** after `Secret_Browse` where 3b added its three constructors, to
  keep the diff apart; `to_json` at line 138)
- Test: `test/Base_Tests/src/Metadata_Spec.enso` (group `"Widget to_json"`,
  line 20)
- Regenerate: `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md`

**Interfaces:**

- Produces:
  `Widget.Union kinds:(Vector (Pair Text Widget)) include_nothing:Boolean=False`.
  JSON:
  `{"constructor":"Union","kinds":[["Text",{"constructor":"Text_Input"}],["Integer",{"constructor":"Numeric_Input"}]],"include_nothing":true}`
  (`include_nothing` always written).

- [ ] **Step 1: Failing tests** — append to the `"Widget to_json"` group:

```enso
        group_builder.specify "a Union lists its kinds in order, each with its widget" <|
            union = Widget.Union [Pair.new "Text" Widget.Text_Input, Pair.new "Integer" Widget.Numeric_Input] include_nothing=True
            union.to_json . should_equal '{"constructor":"Union","kinds":[["Text",{"constructor":"Text_Input"}],["Integer",{"constructor":"Numeric_Input"}]],"include_nothing":true}'

        group_builder.specify "a Union without Nothing says so" <|
            union = Widget.Union [Pair.new "Locale" (Widget.Single_Choice [Choice.Option "A" "'A'"])]
            json = union.to_json . parse_json
            json.get "include_nothing" . should_be_false
            json.get "kinds" . first . first . should_equal "Locale"

        group_builder.specify "a Union nests inside a Vector_Editor" <|
            union = Widget.Union [Pair.new "Text" Widget.Text_Input] include_nothing=True
            editor = Widget.Vector_Editor item_editor=union item_default="''"
            editor.to_json . should_contain '"item_editor":{"constructor":"Union"'
```

(`Pair` comes from `from Standard.Base import all`; add
`import Standard.Base.Metadata.Choice` only if the file lacks it — it has it.)

- [ ] **Step 2: Run, verify they fail**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh dist && ~/pr4.sh enso_test Base_Tests "Widget to_json" 2>&1 | tail -20'
```

Expected: the three new specs fail (`Union` is not a constructor of `Widget`).

- [ ] **Step 3: Implement.** In `type Widget`, after `Any_To_Target`:

```enso
    ## Describes an argument that takes one of several kinds of value: the IDE
       shows a picker of the kinds in front of the chosen kind's widget.

       ## Arguments
        - `kinds`: The kinds, in the order the picker lists them: a label and
          the widget for a value of that kind.
        - `include_nothing`: Whether `Nothing` is a kind too (listed last).
    Union kinds:(Vector (Pair Text Widget)) include_nothing:Boolean=False
```

In `to_json`, before the `Widget.With_JSON_Cache` branch:

```enso
        Widget.Union kinds include_nothing ->
            kinds_json = '[' + (kinds.map p-> '[' + p.first.to_json + ',' + p.second.to_json + ']').join ',' + ']'
            '{"constructor":"Union","kinds":' + kinds_json + ',"include_nothing":' + (if include_nothing then "true" else "false") + '}'
```

- [ ] **Step 4: Run, verify they pass**; then all of `Base_Tests` and
      `sbt "all lintEnso"`:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh enso_test Base_Tests 2>&1 | grep -E "tests (succeeded|failed)"; ~/pr4.sh sbt_run "all lintEnso"'
```

Expected: `0 tests failed`, lint clean.

- [ ] **Step 5: Commit** (API docs are regenerated once, in Task 2 Step 5)

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso test/Base_Tests/src/Metadata_Spec.enso
git commit -m "Widget.Union: one of several kinds of value, with or without Nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: Engine — `Widget.Regex_Input` and the `Regex` type default

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso` (the
  constructor after `Union`; `to_json`; the conversion beside 3b's module-level
  `Widget.from` conversions)
- Test: `test/Base_Tests/src/Type_Default_Spec.enso` (3a/3b),
  `test/Base_Tests/src/Metadata_Spec.enso`
- Regenerate: `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md`
  (and `docs/api/Data/Text/Regex.md` if the conversion moves there)

**Interfaces:**

- Produces: `Widget.Regex_Input` (no fields), JSON
  `{"constructor":"Regex_Input"}`;
  `Widget.from (that : Regex.type) -> Widget = Widget.Regex_Input`;
  `Widget_Query.resolve_type "Standard.Base.Data.Text.Regex.Regex"` answers
  `{"widget":{"constructor":"Regex_Input"}}`.

- [ ] **Step 1: Failing tests.** In `Type_Default_Spec.enso`, a group in the
      style of 3b's "Group D type defaults":

```enso
    suite_builder.group "Regex type default" group_builder->
        group_builder.specify "Regex" <| (Widget.from Regex).to_json . should_equal '{"constructor":"Regex_Input"}'
        group_builder.specify "through resolve_type" <|
            Widget_Query.resolve_type "Standard.Base.Data.Text.Regex.Regex" . should_equal '{"widget":{"constructor":"Regex_Input"}}'
        group_builder.specify "Text still answers Text_Input" <|
            (Widget.from Text).to_json . should_equal '{"constructor":"Text_Input"}'
```

      In `Metadata_Spec.enso`'s `"Widget to_json"` group:

```enso
        group_builder.specify "a Regex_Input" <| Widget.Regex_Input.to_json . should_equal '{"constructor":"Regex_Input"}'
```

(`Regex` comes from `from Standard.Base import all`.)

- [ ] **Step 2: Run, verify they fail** (as Task 1 Step 2, filter
      `"Regex type default"` and `"Widget to_json"`).

- [ ] **Step 3: Implement.** In `type Widget`, after `Union`:

```enso
    ## ---
       private: true
       ---
       A regular-expression input: the IDE edits the pattern's text and writes
       `regex '…'`.
    Regex_Input
```

      In `to_json`: `Widget.Regex_Input -> '{"constructor":"Regex_Input"}'`.
      At the end of `Metadata.enso`, beside 3b's conversions, with the same
      `private: true` front matter and one-line doc ("The default widget for
      arguments of type `Regex`."):

```enso
Widget.from (that : Regex.type) -> Widget = Widget.Regex_Input
```

      with `import project.Data.Text.Regex.Regex`. `Metadata.enso` already
      imports `project.Data.Text.Extensions`, which imports `Regex`, and
      `Regex.enso` does not import `Metadata`, so no cycle is expected. If the
      compiler reports one anyway, put the conversion at the end of
      `Data/Text/Regex.enso` (importing `project.Metadata.Widget`), as 3b allowed
      for its types, and say so in the PR body.

- [ ] **Step 4: Run, verify they pass**; all of `Base_Tests`;
      `sbt "all lintEnso"` (commands as Task 1 Step 4).

- [ ] **Step 5: Regenerate Base's API docs** and check:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-widgets-pr4 && built-distribution/enso-engine-*/enso-*/bin/enso --docs api --in-project distribution/lib/Standard/Base/0.0.0-dev && corepack pnpm --filter build-scripts run stdlib-api-check'
```

Copy the changed `docs/api/*.md` back to the Windows worktree (rsync the files).

- [ ] **Step 6: Commit** `Widget.Regex_Input: Regex arguments get a regex input`
      (with the `Co-Authored-By` trailer, as in Task 1), including the
      regenerated API docs.

## Task 3: GUI schema for `Union` and `Regex_Input`

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (the TS union `WidgetConfiguration` lines 93-107; `widgetConfigurationSchema`
  lines 203-231)
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts`

**Interfaces:**

- Produces:

```ts
/** One kind of a union: its label and the widget of a value of that kind (`null`: `Nothing`). */
export interface UnionKind {
  label: string;
  config: WidgetConfiguration | null;
}
export interface UnionConfig {
  kind: "Union";
  /** In picker order; `Nothing`, when included, is the last entry with `config: null`. */
  kinds: UnionKind[];
}
export interface RegexInput {
  kind: "Regex_Input";
}
```

The schema maps `kinds: [label, widget][]` + `include_nothing` to `kinds`
(appending `{ label: 'Nothing', config: null }` when `include_nothing`), so the
rest of the GUI sees one shape whether the engine or `unionKinds.ts` built it.

- [ ] **Step 1: Failing tests** (append to `configuration.test.ts`):

```ts
test("parses a Union, Nothing last", () => {
  const parsed = widgetConfigurationSchema.parse({
    type: "Widget",
    constructor: "Union",
    kinds: [
      ["Text", { type: "Widget", constructor: "Text_Input" }],
      ["Integer", { type: "Widget", constructor: "Numeric_Input" }],
    ],
    include_nothing: true,
  });
  expect(parsed).toEqual({
    kind: "Union",
    kinds: [
      { label: "Text", config: { kind: "Text_Input" } },
      { label: "Integer", config: { kind: "Numeric_Input" } },
      { label: "Nothing", config: null },
    ],
  });
});

test("parses a Union without Nothing", () => {
  const parsed = widgetConfigurationSchema.parse({
    constructor: "Union",
    kinds: [["Text", { constructor: "Text_Input" }]],
    include_nothing: false,
  });
  expect(parsed).toEqual({
    kind: "Union",
    kinds: [{ label: "Text", config: { kind: "Text_Input" } }],
  });
});

test("a Union as a Vector_Editor's item editor", () => {
  const parsed = widgetConfigurationSchema.parse({
    constructor: "Vector_Editor",
    item_default: "''",
    item_editor: {
      constructor: "Union",
      kinds: [["Text", { constructor: "Text_Input" }]],
      include_nothing: true,
    },
  });
  assert(parsed.kind === "Vector_Editor");
  expect(parsed.item_editor.kind).toBe("Union");
});

test("parses a Regex_Input", () => {
  expect(
    widgetConfigurationSchema.parse({ constructor: "Regex_Input" }),
  ).toEqual({
    kind: "Regex_Input",
  });
});
```

(Compare with how the file's existing tests write the expected `kind` objects;
if `withKindSchema` leaves `constructor`/`type` on the parsed object, use
`toMatchObject` as they do.)

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts
```

Expected: FAIL (`Invalid discriminator value`).

- [ ] **Step 3: Implement.** Add `UnionKind`, `UnionConfig`, `RegexInput` and
      `| UnionConfig | RegexInput` to `WidgetConfiguration`. In the
      discriminated union, after `Any_To_Target`:

```ts
      z.object({ kind: z.literal('Regex_Input') }),
      z
        .object({
          kind: z.literal('Union'),
          kinds: z.array(z.tuple([z.string(), z.lazy(() => widgetConfigurationSchema)])),
          include_nothing: z.boolean().optional(),
        })
        .transform(
          ({ kinds, include_nothing }): UnionConfig => ({
            kind: 'Union',
            kinds: [
              ...kinds.map(([label, config]) => ({ label, config })),
              ...(include_nothing ? [{ label: 'Nothing', config: null }] : []),
            ],
          }),
        ),
```

If `z.discriminatedUnion` rejects a member with `.transform` (zod 3 requires
`ZodObject` members), move the transform out: keep the plain `z.object` in the
union and apply the mapping in a `.transform` on the whole
`widgetConfigurationSchema` pipe
(`(cfg) => cfg.kind === 'Union' ? toUnionConfig(cfg) : cfg`), typing the raw
member as `RawUnion`.

- [ ] **Step 4: Run, verify they pass**, plus the folder:

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry
```

- [ ] **Step 5: Commit** `GUI: parse Widget.Union and Widget.Regex_Input` (with
      the `Co-Authored-By` trailer, as in Task 1).

## Task 4: `unionKinds.ts` — composing a declared union

**Files:**

- Create: `app/gui/src/providers/openedProjects/widgetRegistry/unionKinds.ts`
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/unionKinds.test.ts`

**Interfaces:**

- Consumes: `WidgetConfiguration`, `UnionConfig`, `SingleChoice`, `Choice` (Task
  3 / existing).
- Produces:

```ts
export const NOTHING_TYPE = "Standard.Base.Nothing.Nothing";

/**
 * The members of a declared type, split on top-level `|` only (`Vector Header | (Pair Text Text)` has
 * two), outer parentheses removed. A type that is not a union gives one member.
 */
export function unionMembers(reprType: string): string[];

/** A member and what is known of its widget: `'pending'` while its type default is being asked. */
export type MemberWidget = {
  typeName: string;
  config: WidgetConfiguration | undefined | "pending";
};

/** Whether `target.from (that : source)` exists (both fully qualified type names). */
export type Converts = (source: string, target: string) => boolean;

/**
 * The widget of a union from its members' widgets (spec §4 and this plan's owner decisions 3 and 4):
 * - `'pending'` while any member is pending;
 * - `Nothing` is a kind of its own, never absorbed and never absorbing;
 * - members without a widget are dropped (and absorb nothing);
 * - a member A is dropped when another member B with a widget has `converts(A, B)`; of two members
 *   converting to each other the earlier stays; if every member would go, the first stays;
 * - members with deep-equal widgets collapse into the first;
 * - every remaining non-Nothing kind a `Single_Choice` → one merged `Single_Choice` (`Nothing` an option);
 * - one kind (Nothing not counted unless present) → that kind's widget alone, `undefined` if it is only Nothing;
 * - otherwise a `Union` (`Nothing` last).
 */
export function composeUnion(
  members: MemberWidget[],
  converts: Converts,
): WidgetConfiguration | undefined | "pending";

/** The label a kind is listed under: the member's last path segment, applied types kept (`Vector Text`). */
export function kindLabel(typeName: string): string;
```

- [ ] **Step 1: Failing tests** (`unionKinds.test.ts`). The conversion table
      mirrors the standard library (decision 3):

```ts
import { expect, test } from "vitest";
import {
  composeUnion,
  kindLabel,
  NOTHING_TYPE,
  unionMembers,
  type Converts,
  type MemberWidget,
} from "../unionKinds";

const TEXT = "Standard.Base.Data.Text.Text";
const INTEGER = "Standard.Base.Data.Numbers.Integer";
const FLOAT = "Standard.Base.Data.Numbers.Float";
const FILE = "Standard.Base.System.File.File";
const WRITABLE = "Standard.Base.System.File.Writable_File.Writable_File";
const URI = "Standard.Base.Network.URI.URI";
const SECRET = "Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret";
const DERIVED = "Standard.Base.Enso_Cloud.Enso_Secret.Derived_Secret_Value";
const REGEX = "Standard.Base.Data.Text.Regex.Regex";
const LOCALE = "Standard.Base.Data.Locale.Locale";
const CASE = "Standard.Base.Data.Text.Case.Case";
const ROWS = "Standard.Table.Rows_To_Read.Rows_To_Read";

/** Conversions as in the standard library: target ← sources. */
const CONVERSIONS: Record<string, string[]> = {
  [FILE]: [TEXT],
  [WRITABLE]: [TEXT, FILE],
  [URI]: [TEXT],
  [FLOAT]: [INTEGER],
  [DERIVED]: [TEXT, SECRET],
  [ROWS]: [INTEGER, NOTHING_TYPE],
};
const converts: Converts = (source, target) =>
  CONVERSIONS[target]?.includes(source) ?? false;
const none: Converts = () => false;

const textInput = { kind: "Text_Input" } as const;
const numeric = { kind: "Numeric_Input" } as const;
const regex = { kind: "Regex_Input" } as const;
const secret = { kind: "Secret_Browse" } as const;
const file = {
  kind: "File_Browse",
  existing_only: true,
  file_types: [],
} as const;
const save = {
  kind: "File_Browse",
  existing_only: false,
  file_types: [],
} as const;
const choice = (v: string) => ({ value: v, label: v, parameters: [] });
const locales = {
  kind: "Single_Choice",
  values: [choice("..Default")],
} as const;
const cases = {
  kind: "Single_Choice",
  values: [choice("..Upper"), choice("..Lower")],
} as const;
const rows = {
  kind: "Single_Choice",
  values: [choice("..All_Rows")],
} as const;
const m = (typeName: string, config: MemberWidget["config"]): MemberWidget => ({
  typeName,
  config,
});
const nothing = m(NOTHING_TYPE, undefined);

test.each([
  [TEXT, [TEXT]],
  [`${TEXT} | ${INTEGER} | ${NOTHING_TYPE}`, [TEXT, INTEGER, NOTHING_TYPE]],
  [`(${TEXT} | ${FILE})`, [TEXT, FILE]],
  [
    "Standard.Base.Data.Vector.Vector Standard.Network.HTTP.Header.Header | (Standard.Base.Data.Pair.Pair Standard.Base.Data.Text.Text Standard.Base.Data.Text.Text)",
    [
      "Standard.Base.Data.Vector.Vector Standard.Network.HTTP.Header.Header",
      "Standard.Base.Data.Pair.Pair Standard.Base.Data.Text.Text Standard.Base.Data.Text.Text",
    ],
  ],
])("unionMembers(%s)", (repr, expected) => {
  expect(unionMembers(repr)).toEqual(expected);
});

test("kindLabel", () => {
  expect(kindLabel(TEXT)).toBe("Text");
  expect(kindLabel(NOTHING_TYPE)).toBe("Nothing");
  expect(
    kindLabel("Standard.Base.Data.Vector.Vector Standard.Base.Data.Text.Text"),
  ).toBe("Vector Text");
});

test("Text | Integer | Nothing is a Union with Nothing last", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(INTEGER, numeric), nothing], converts),
  ).toEqual({
    kind: "Union",
    kinds: [
      { label: "Text", config: textInput },
      { label: "Integer", config: numeric },
      { label: "Nothing", config: null },
    ],
  });
});

test("Integer | Nothing is a Union of two kinds (Nothing counts)", () => {
  expect(composeUnion([m(INTEGER, numeric), nothing], converts)).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Integer" }, { label: "Nothing" }],
  });
});

test("a member without a widget is not a kind", () => {
  expect(composeUnion([m(URI, undefined), m(TEXT, textInput)], none)).toEqual(
    textInput,
  );
});

// The conversion rule (owner decision 3).
test("File absorbs Text: Text | URI | File is the file browser alone (Data.read)", () => {
  expect(
    composeUnion(
      [m(TEXT, textInput), m(URI, undefined), m(FILE, file)],
      converts,
    ),
  ).toEqual(file);
});

test("Text | File | Nothing is File and Nothing", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(FILE, file), nothing], converts),
  ).toMatchObject({
    kind: "Union",
    kinds: [
      { label: "File", config: file },
      { label: "Nothing", config: null },
    ],
  });
});

test("absorption chains: Text | File | Writable_File is Writable_File alone", () => {
  expect(
    composeUnion(
      [m(TEXT, textInput), m(FILE, file), m(WRITABLE, save)],
      converts,
    ),
  ).toEqual(save);
});

test("a member without a widget absorbs nothing: URI does not take Text", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(URI, undefined)], converts),
  ).toEqual(textInput);
});

test("Text | Enso_Secret keeps both kinds (no Enso_Secret.from Text)", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(SECRET, secret)], converts),
  ).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Text" }, { label: "Enso_Secret" }],
  });
});

test("Header's Text | Enso_Secret | Derived_Secret_Value keeps Text and Secret while Derived_Secret_Value has no widget", () => {
  expect(
    composeUnion(
      [m(TEXT, textInput), m(SECRET, secret), m(DERIVED, undefined)],
      converts,
    ),
  ).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Text" }, { label: "Enso_Secret" }],
  });
});

test("Text | Regex keeps both kinds", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(REGEX, regex)], converts),
  ).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Text" }, { label: "Regex" }],
  });
});

test("Float absorbs Integer", () => {
  expect(
    composeUnion([m(INTEGER, numeric), m(FLOAT, numeric), nothing], converts),
  ).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Float" }, { label: "Nothing" }],
  });
});

test("Nothing is never absorbed", () => {
  expect(composeUnion([m(ROWS, rows), nothing], converts)).toEqual({
    kind: "Single_Choice",
    values: [
      choice("..All_Rows"),
      { value: "Nothing", label: "Nothing", parameters: [] },
    ],
  });
});

test("mutual conversions keep the earlier member", () => {
  const both: Converts = () => true;
  expect(composeUnion([m(TEXT, textInput), m(REGEX, regex)], both)).toEqual(
    textInput,
  );
});

test("equal widgets collapse into the first member", () => {
  expect(composeUnion([m(INTEGER, numeric), m(FLOAT, numeric)], none)).toEqual(
    numeric,
  );
});

test("dropdowns merge into one dropdown, Nothing an option", () => {
  expect(
    composeUnion([m(LOCALE, locales), m(CASE, cases), nothing], converts),
  ).toEqual({
    kind: "Single_Choice",
    values: [
      choice("..Default"),
      choice("..Upper"),
      choice("..Lower"),
      { value: "Nothing", label: "Nothing", parameters: [] },
    ],
  });
});

test("Locale | Nothing is the Locale dropdown with a Nothing option", () => {
  expect(composeUnion([m(LOCALE, locales), nothing], converts)).toEqual({
    kind: "Single_Choice",
    values: [
      choice("..Default"),
      { value: "Nothing", label: "Nothing", parameters: [] },
    ],
  });
});

test("merged dropdowns drop repeated values", () => {
  expect(
    composeUnion([m(LOCALE, locales), m(LOCALE + "2", locales)], converts),
  ).toEqual(locales);
});

test("pending while any member is pending", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(INTEGER, "pending")], converts),
  ).toBe("pending");
});

test("Nothing alone has no widget", () => {
  expect(composeUnion([nothing], converts)).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/unionKinds.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**
  - `unionMembers`: strip balanced outer parentheses (the loop
    `vectorElementType` uses), scan with a depth counter, split at `|` at depth
    0, trim, strip each member's outer parentheses.
  - `kindLabel`: for each space-separated part of the member, take the segment
    after the last `.`; join with a space.
  - `composeUnion(members, converts)`: return `'pending'` if any member is
    pending. `hasNothing` = some member is `NOTHING_TYPE`. `withWidget` = the
    other members whose config is defined, in order. **Absorption:** member `a`
    at index `i` is dropped when some `b` at index `j ≠ i` in `withWidget` has
    `converts(a.typeName, b.typeName)` and not
    (`converts(b.typeName, a.typeName)` and `j > i`); if that drops every
    member, keep `withWidget[0]`. **Collapse:** walk the survivors, building
    `kinds: UnionKind[]` (`label: kindLabel(typeName)`), skipping a config
    deep-equal to an earlier kind's (use `isEqual` from `lib0/function` or the
    comparison the GUI already uses for configurations — search
    `equalFlat`/`isEqual` in `app/gui/src/util`; else a small `JSON.stringify`
    comparison, configurations are plain JSON). If `kinds.length > 0` and every
    kind is `Single_Choice`, return one `Single_Choice` whose `values` are the
    concatenation, without values whose `value` (a string) repeats, plus
    `{ value: 'Nothing', label: 'Nothing', parameters: [] }` when `hasNothing`.
    If `kinds.length === 0` → `undefined`. If
    `kinds.length === 1 && !hasNothing` → `kinds[0].config`. Otherwise
    `{ kind: 'Union', kinds: [...kinds, ...(hasNothing ? [{ label: 'Nothing', config: null }] : [])] }`.

- [ ] **Step 4: Run, verify they pass.**

- [ ] **Step 5: Commit**
      `GUI: compose a union's widget from its members' widgets and conversions`.

## Task 5: `TypeDefaults` and vectors use the composition

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/typeDefaults.ts`
  (3b): `lookup`, a `converts` constructor argument; delete `defaultSourceType`.
- Modify: where 3b constructs `TypeDefaults` in production (search
  `new TypeDefaults(`): pass `converts` built on `conversionSources`.
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector/elementType.ts`
  (`vectorElementType` lines 29-36; 3b's `vectorItemConfig`; `defaultItemCode`
  line 17)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector.vue`
  (`defaultItem`, lines 54-59)
- Test: `REG/__tests__/typeDefaults.test.ts` (3b),
  `W/WidgetVector/__tests__/elementType.test.ts`

**Interfaces:**

- Consumes: `unionMembers`, `composeUnion`, `Converts` (Task 4);
  `kindDefaultCode` (Task 6 — do Task 6 Step 3's `kindDefaultCode` first if
  executing out of order; it is a pure function);
  `SuggestionDb.conversionSources` (`suggestionDatabase/index.ts:70`: the target
  type's key → its source types' keys, from every `Target.from (that:X)` method
  entry).
- Produces:
  `new TypeDefaults(hasDefault, query, converts: Converts = () => false)` (the
  third argument optional so 3b's tests keep compiling);
  `TypeDefaults.lookup(reprType, frame)` returns the composed widget for a union
  (`undefined` while pending); `vectorElementType` returns a union element type
  (`Vector (Text | Integer)` → `"Text | Integer"` in full names);
  `vectorItemDefault(itemConfig): string | undefined`.
- Production `converts(source, target)`:
  `suggestionDb.conversionSources.lookup(keyOf(target))?.has(keyOf(source)) ?? false`,
  with `keyOf(t) = parseAbsoluteProjectPathRaw(t).value.key()` (and `false` when
  parsing fails) — the same key construction as 3b's `hasDefault`, but with the
  member types themselves, not `….type`.

- [ ] **Step 1: Failing tests.** In `typeDefaults.test.ts`, delete the
      `defaultSourceType` `test.each` (the interim rule goes) and add:

```ts
test("a union asks each member once and composes them", async () => {
  const answers: Record<string, unknown> = {
    [TEXT]: { widget: { constructor: "Text_Input" } },
    [INTEGER]: { widget: { constructor: "Numeric_Input" } },
  };
  const query = vi.fn(async (_frame: ExternalId, code: string) =>
    Ok(answers[Object.keys(answers).find((t) => code.includes(`'${t}'`))!]),
  );
  const defaults = new TypeDefaults(() => true, query);
  const union = `${TEXT} | ${INTEGER} | Standard.Base.Nothing.Nothing`;
  expect(defaults.lookup(union, frameA)).toBeUndefined(); // pending
  await flushPromises();
  expect(defaults.lookup(union, frameA)).toMatchObject({
    kind: "Union",
    kinds: [
      { label: "Text" },
      { label: "Integer" },
      { label: "Nothing", config: null },
    ],
  });
  expect(query).toHaveBeenCalledTimes(2); // Nothing is never asked
  defaults.lookup(TEXT, frameB);
  expect(query).toHaveBeenCalledTimes(2); // members are cached as types
});

test("a member without a Widget conversion is not asked and not a kind", async () => {
  const query = vi.fn(async () =>
    Ok({ widget: { constructor: "Text_Input" } }),
  );
  const defaults = new TypeDefaults((t) => t === TEXT, query);
  defaults.lookup(`${TEXT} | Standard.Base.Network.URI.URI`, frameA);
  await flushPromises();
  expect(
    defaults.lookup(`${TEXT} | Standard.Base.Network.URI.URI`, frameA),
  ).toEqual({
    kind: "Text_Input",
  });
  expect(query).toHaveBeenCalledTimes(1);
});

test("Integer | Nothing is no longer just Integer's widget", async () => {
  const defaults = new TypeDefaults(
    () => true,
    async () => Ok({ widget: { constructor: "Numeric_Input" } }),
  );
  const repr = `${INTEGER} | Standard.Base.Nothing.Nothing`;
  defaults.lookup(repr, frameA);
  await flushPromises();
  expect(defaults.lookup(repr, frameA)?.kind).toBe("Union");
});

test("a conversion between members drops the absorbed one", async () => {
  const answers: Record<string, unknown> = {
    [TEXT]: { widget: { constructor: "Text_Input" } },
    [FILE]: {
      widget: {
        constructor: "File_Browse",
        existing_only: true,
        action: "Open",
        file_types: [],
      },
    },
  };
  const defaults = new TypeDefaults(
    () => true,
    async (_frame, code) =>
      Ok(answers[Object.keys(answers).find((t) => code.includes(`'${t}'`))!]),
    (source, target) => source === TEXT && target === FILE,
  );
  defaults.lookup(`${TEXT} | ${FILE}`, frameA);
  await flushPromises();
  expect(defaults.lookup(`${TEXT} | ${FILE}`, frameA)?.kind).toBe(
    "File_Browse",
  );
});
```

(`TEXT`, `INTEGER`, `FILE` constants as in Task 4; `frameA`, `frameB`, `Ok`,
`flushPromises` as 3b's tests import them.) Add one wiring test for the
production `converts`, next to 3b's `hasDefault` wiring test: a `SuggestionDb`
with a `File.from` method entry (`selfType` File, first argument `reprType`
`Standard.Base.Data.Text.Text`; copy how `conversionSources.test.ts` builds its
entries) gives `converts(TEXT, FILE) === true` and
`converts(FILE, TEXT) === false`.

In `elementType.test.ts` add:

```ts
test("a union element type", () => {
  expect(
    vectorElementType(
      "Standard.Base.Data.Vector.Vector (Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer)",
    ),
  ).toBe("Standard.Base.Data.Text.Text | Standard.Base.Data.Numbers.Integer");
});

test.each([
  [
    {
      kind: "Single_Choice",
      values: [{ value: "..A", label: "A", parameters: [] }],
    },
    "..A",
  ],
  [
    {
      kind: "Union",
      kinds: [
        { label: "Text", config: { kind: "Text_Input" } },
        { label: "Nothing", config: null },
      ],
    },
    "''",
  ],
  [{ kind: "Numeric_Input" }, "0"],
  [{ kind: "Date_Input" }, "Date.today"],
  [{ kind: "Regex_Input" }, "regex '.*'"],
  [undefined, undefined],
] as const)("vectorItemDefault(%o)", (config, expected) => {
  expect(vectorItemDefault(config as never)).toBe(expected);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/typeDefaults.test.ts src/project-view/components/GraphEditor/widgets/WidgetVector
```

- [ ] **Step 3: Implement.**
  - `typeDefaults.ts`: split the existing per-type logic into a private
    `lookupType(type, frame): WidgetConfiguration | undefined | 'pending'` (the
    cache entry states 3b defined; `!hasDefault(type)` → `undefined`).
    `lookup(reprType, frame)`: `undefined` for no `reprType`;
    `const members = unionMembers(reprType)`; one member → `lookupType` with
    `'pending'` mapped to `undefined`; otherwise
    `composeUnion(members.map(t => ({ typeName: t, config: t === NOTHING_TYPE ? undefined : lookupType(t, frame) })), this.converts)`
    with `'pending'` mapped to `undefined`. Delete `defaultSourceType` and its
    export; grep `app/gui` for other users and replace them with `lookup`.
  - Production wiring: pass `converts` as in Interfaces. `conversionSources` is
    a `ReactiveIndex`, so a union re-composes when the suggestion database
    learns a conversion.
  - `elementType.ts`: `vectorElementType` accepts an element in parentheses that
    `unionMembers` splits into more than one member (return the inner text,
    trimmed); keep rejecting nested applications. Add
    `vectorItemDefault(config)`: `Single_Choice` → first flattened option's
    `value`; `Union` → `kindDefaultCode(kinds[0].config)`; anything else →
    `kindDefaultCode(config)`; `undefined` config → `undefined`.
  - `WidgetVector.vue` `defaultItem`: after the `Vector_Editor` branch, try
    `vectorItemDefault(itemConfig.value)`, then `defaultItemCode(itemType)`,
    then `DEFAULT_ITEM`.
  - 3b's `vectorItemConfig` already asks `typeDefault(elementType)`; with
    `lookup` handling unions, a `Vector (Text | Integer)` item now gets the
    `Union` configuration and therefore an icon chip each (Task 9).

- [ ] **Step 4: Run, verify they pass**, plus `callTree` and the widget
      registry:

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry src/project-view/util/__tests__/callTree.test.ts src/project-view/components/GraphEditor/widgets/WidgetVector
```

- [ ] **Step 5: Commit**
      `GUI: union-typed arguments and list items take their union's widget`.

## Task 6: `kindMatch.ts` — which kind the code is, what a kind writes

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/kindMatch.ts`
- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetRegex/regexExpression.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/__tests__/kindMatch.test.ts`,
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetRegex/__tests__/regexExpression.test.ts`

**Interfaces:**

- Consumes: `UnionKind`, `WidgetConfiguration`, `flattenChoice`
  (`configuration.ts`); the whole-node recognisers the date widgets use
  (`isWholeNodeCall` with the `bare`/`applied` lists in `W/WidgetDate.vue`
  ~lines 70-76, `W/WidgetTimeOfDay.vue`, `W/WidgetDateTime.vue` — move each list
  into its `…Expression.ts` module (`WidgetDate/dateExpression.ts` etc.) as an
  exported constant so `kindMatch.ts` can import it without importing a `.vue`
  file).
- Produces:

```ts
// kindMatch.ts
/** The index in `kinds` of the kind `value` is, or `undefined` if it is none of them. An unset argument is kind 0. */
export function matchKind(
  kinds: readonly UnionKind[],
  value: Ast.Expression | undefined,
): number | undefined;

/** The code switching to a kind writes (owner decision 5), or `undefined` if the kind cannot be offered. */
export function kindDefaultCode(
  config: WidgetConfiguration | null,
): string | undefined;

// regexExpression.ts
/** The pattern literal of `regex '…'`, `regex "…"`, `Regex.compile '…'` (qualified heads too), else `undefined`. */
export function regexPattern(
  value: Ast.Expression | undefined,
): Ast.TextLiteral | undefined;
```

Matching, per kind, in `kinds` order, first match wins:

| Kind's widget                                   | Matches                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `null` (Nothing)                                | the identifier `Nothing` or `Standard.Base.Nothing.Nothing`                                      |
| `Text_Input`                                    | a text literal                                                                                   |
| `Regex_Input`                                   | `regexPattern(value)` is defined (`regex '…'`, `regex "…"`, `Regex.compile …`)                   |
| `Numeric_Input`                                 | a number literal, or `-` applied to one                                                          |
| `Boolean_Input`                                 | `True`, `False`, `Boolean.True`, `Boolean.False`                                                 |
| `Date_Input` / `Time_Input` / `Date_Time_Input` | the whole-node shapes the date / time / date-time widgets recognise                              |
| `Single_Choice`                                 | code equal to a flattened option's `value`, or an application whose head is (`..Equals that=1`)  |
| `Multiple_Choice`, `Vector_Editor`              | a vector literal                                                                                 |
| `File_Browse`, `Folder_Browse`                  | a text literal, or `File.new …`                                                                  |
| `Secret_Browse`                                 | `Enso_Secret.get …` only — never a bare text literal (`browsableTypes.ts` reads it the same way) |

- [ ] **Step 1: Failing tests** (`kindMatch.test.ts`):

```ts
import { Ast } from "@/util/ast";
import { expect, test } from "vitest";
import { kindDefaultCode, matchKind } from "../kindMatch";

const text = { label: "Text", config: { kind: "Text_Input" } } as const;
const integer = {
  label: "Integer",
  config: { kind: "Numeric_Input" },
} as const;
const nothing = { label: "Nothing", config: null } as const;
const date = { label: "Date", config: { kind: "Date_Input" } } as const;
const regex = { label: "Regex", config: { kind: "Regex_Input" } } as const;
const secret = {
  label: "Enso_Secret",
  config: { kind: "Secret_Browse" },
} as const;
const file = {
  label: "File",
  config: { kind: "File_Browse", file_types: [] },
} as const;
const kase = {
  label: "Case",
  config: {
    kind: "Single_Choice",
    values: [
      { value: "..Upper", label: "Upper", parameters: [] },
      { value: "..Lower", label: "Lower", parameters: [] },
    ],
  },
} as const;
const parse = (code: string) => Ast.parseExpression(code)!;

test.each([
  ["'hello'", [text, integer, nothing], 0],
  ["42", [text, integer, nothing], 1],
  ["-3", [text, integer, nothing], 1],
  ["Nothing", [text, integer, nothing], 2],
  ["Date.new 2020 1 15", [date, nothing], 0],
  ["Date.today", [date, nothing], 0],
  ["..Lower", [kase, nothing], 0],
  ["'data.csv'", [file, nothing], 0],
  // Text | Regex
  ["'a.*c'", [text, regex], 0],
  ["regex 'a.*c'", [text, regex], 1],
  ['regex "a.*c"', [text, regex], 1],
  ["Regex.compile 'a.*c'", [text, regex], 1],
  ["'a.*c'", [regex, text], 1], // Regex | Text (Text.find): a text literal is still Text
  // Text | Enso_Secret
  ["'my password'", [text, secret], 0],
  ["Enso_Secret.get 'db-password'", [text, secret], 1],
  ["'db-password'", [secret, nothing], undefined], // a bare text is no secret
  ["x", [text, integer, nothing], undefined],
  ["foo 1", [text, integer, nothing], undefined],
] as const)("matchKind(%s)", (code, kinds, expected) => {
  expect(matchKind(kinds, parse(code))).toBe(expected);
});

test("an unset argument is the first kind", () => {
  expect(matchKind([integer, nothing], undefined)).toBe(0);
});

test.each([
  [null, "Nothing"],
  [{ kind: "Text_Input" }, "''"],
  [{ kind: "Numeric_Input" }, "0"],
  [{ kind: "Numeric_Input", minimum: 1 }, "1"],
  [{ kind: "Boolean_Input" }, "False"],
  [{ kind: "Date_Input" }, "Date.today"],
  [{ kind: "Time_Input" }, "Time_Of_Day.now"],
  [{ kind: "Date_Time_Input" }, "Date_Time.now"],
  [{ kind: "Regex_Input" }, "regex '.*'"],
  [kase.config, "..Upper"],
  [
    {
      kind: "Vector_Editor",
      item_editor: { kind: "Text_Input" },
      item_default: "''",
    },
    "[]",
  ],
  [{ kind: "File_Browse", file_types: [] }, "''"],
  [{ kind: "Secret_Browse" }, "Enso_Secret.get ''"],
  [{ kind: "Any_To_Target" }, undefined],
] as const)("kindDefaultCode(%o)", (config, expected) => {
  expect(kindDefaultCode(config as never)).toBe(expected);
});

test("every kind's default value reads back as that kind", () => {
  const kinds = [text, regex, integer, date, kase, file, secret, nothing];
  kinds.forEach((kind) => {
    const code = kindDefaultCode(kind.config)!;
    // Text precedes File only in a union without a conversion; File's '' is checked without Text.
    const others = kind === file ? kinds.filter((k) => k !== text) : kinds;
    expect(matchKind(others, parse(code))).toBe(others.indexOf(kind));
  });
});
```

`regexExpression.test.ts`: `regexPattern` of `regex 'a'`, `regex "a"`,
`Regex.compile 'a'`, `Standard.Base.Data.Text.Regex.regex 'a'` → the literal
(`.rawTextContent === 'a'`); of `'a'`, `regex x`, `regex 'a' 'b'`, `foo 'a'` →
`undefined`.

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetKindPicker src/project-view/components/GraphEditor/widgets/WidgetRegex
```

- [ ] **Step 3: Implement** both modules per the tables (`Ast.TextLiteral`,
      `Ast.NumericLiteral`, `Ast.NegationApp`, `Ast.Ident`, `Ast.Vector`,
      `Ast.App`/`Ast.PropertyAccess` heads; compare a `Single_Choice` value with
      `value.code()` after stripping parentheses, and an application by its
      head's code). `regexPattern`: an `Ast.App` with one positional argument
      that is an `Ast.TextLiteral` and a head whose code is `regex`,
      `Regex.compile`, or ends in `.Regex.regex` / `.Regex.Regex.compile`. The
      `Secret_Browse` match reuses the `Enso_Secret.get` shape
      `browsableTypes.ts` recognises (by code here: head `Enso_Secret.get` or
      its qualified form — `kindMatch` has no method-pointer lookup). Move the
      date/time `bare`/`applied` lists as described in Interfaces and import
      them in the three widgets too (no behaviour change there).
      `kindDefaultCode`'s `Secret_Browse` code needs the `Enso_Secret` import
      when written — that is `addKindImports`' job (Task 9).

- [ ] **Step 4: Run, verify they pass**, plus the date/time widget tests
      (`W/WidgetDate`, `W/WidgetTimeOfDay`, `W/WidgetDateTime` `__tests__`).

- [ ] **Step 5: Commit**
      `GUI: which kind a value is, and what each kind writes`.

## Task 7: Kind icons — three new sprite icons and `kindIcon`

**Files:**

- Modify: `app/gui/src/project-view/assets/icons.svg` (three symbols, beside
  `input_number` at ~line 517)
- Regenerate: `app/gui/src/project-view/util/iconMetadata/iconName.ts`
  (`corepack pnpm --filter enso-gui run generate-icons`)
- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/kindIcon.ts`
- Test: `src/project-view/assets/__tests__/iconStyle.test.ts` (existing, must
  stay green), new `W/WidgetKindPicker/__tests__/kindIcon.test.ts`

**Interfaces:**

- Produces: icons `input_decimal`, `toggle`, `regex`;

```ts
/** The sprite icon for a kind of a union, or `undefined` (the chip then shows the label). Nothing has none. */
export function kindIcon(kind: UnionKind): Icon | undefined;
```

| Kind's widget                | Icon                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `null` (Nothing)             | none                                                                   |
| `File_Browse`                | `document`                                                             |
| `Folder_Browse`              | `folder`                                                               |
| `Secret_Browse`              | `key`                                                                  |
| `Vector_Editor`              | `array_new`                                                            |
| `Regex_Input`                | `regex` (new)                                                          |
| `Text_Input`                 | `text_input`                                                           |
| `Boolean_Input`              | `toggle` (new)                                                         |
| `Date_Input`                 | `calendar`                                                             |
| `Time_Input`                 | `time`                                                                 |
| `Date_Time_Input`            | `datetime`                                                             |
| `Numeric_Input`              | label ending in `Integer` → `input_number`, else `input_decimal` (new) |
| anything else (dropdowns, …) | none                                                                   |

- [ ] **Step 1: Failing test** (`kindIcon.test.ts`): a `test.each` over the
      table, including `{ label: 'Integer', Numeric_Input }` → `input_number`,
      `{ label: 'Float' }` and `{ label: 'Number' }` → `input_decimal`,
      `{ label: 'Positive_Integer' }` → `input_number`,
      `{ label: 'Writable_File', File_Browse }` → `document`, a `Single_Choice`
      → `undefined`, Nothing → `undefined`. Also assert each returned name is in
      `iconNames` (generated list), so a typo or a missing symbol fails here,
      not at run time.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Draw the icons.** Start from the owner-approved mockup's drafts
      and fit them to the style rules (two-tone: an `opacity="0.3"` frame or
      background shape plus solid `currentColor` marks; 16×16; no transforms; at
      most two decimals; snake_case id):

```svg
  <symbol id="input_decimal" viewBox="0 0 16 16" width="16" height="16" fill="none">
    <rect opacity="0.3" x="1" y="2" width="14" height="12" rx="2" fill="currentColor"/>
    <path d="M4.2 5h1.3v6H4.2V6.5l-.9.5-.4-1.1ZM7.3 9.6h1.4V11H7.3ZM10.6 5h2.6v1.1h-1.7l-.1 1c.2-.1.5-.1.7-.1 1 0 1.6.6 1.6 1.5 0 1-.8 1.6-1.8 1.6-.6 0-1.1-.2-1.5-.5l.4-.9c.3.2.6.3 1 .3.4 0 .7-.2.7-.5s-.3-.5-.8-.5c-.3 0-.6.1-.9.2l-.4-.2Z" fill="currentColor"/>
  </symbol>
  <symbol id="toggle" viewBox="0 0 16 16" width="16" height="16" fill="none">
    <path opacity="0.3" d="M5 4h6a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8Z" fill="currentColor"/>
    <path d="M11 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" fill="currentColor"/>
  </symbol>
  <symbol id="regex" viewBox="0 0 16 16" width="16" height="16" fill="none">
    <rect opacity="0.3" x="1" y="2" width="14" height="12" rx="2" fill="currentColor"/>
    <path d="M4.5 9.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM9.4 4h1.2v6H9.4ZM7.4 5.6l.6-1.04 4.6 2.66-.6 1.04ZM7.4 8.4l4.6-2.66.6 1.04-4.6 2.66Z" fill="currentColor"/>
  </symbol>
```

      (`1.04` has two decimals; if the geometry rule still objects, round.)
      Look at each at 14 px on the node colour (the Task 11 icon-gallery
      screenshot) before committing; adjust strokes there, not in the plan.
      Run `corepack pnpm --filter enso-gui run generate-icons`.

- [ ] **Step 4: Implement `kindIcon`** per the table; run the new test and
      `iconStyle.test.ts`:

```bash
corepack pnpm --filter enso-gui exec vitest run src/project-view/assets src/project-view/components/GraphEditor/widgets/WidgetKindPicker
```

- [ ] **Step 5: Commit**
      `GUI: icons for decimal, toggle and regex; a kind's icon`.

## Task 8: `WidgetRegex.vue`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetRegex.vue`
- Test: `W/WidgetRegex/__tests__/widgetRegex.score.test.ts`

**Interfaces:**

- Consumes: `regexPattern` (Task 6); `RegexInput` (Task 3); `WidgetText.vue` as
  the editor of a text literal port; `NodeWidget`, `WidgetInput.FromAst`.
- Produces: `widgetDefinition` (priority 48 — after the kind picker 44 and
  `WidgetAnyToTarget` 45, before `WidgetFileBrowser` 49 and `WidgetFunction` 200
  — smaller wins — so a `regex '…'` application is drawn as the regex input, not
  as a call); `export function regexScore(input: WidgetInput): Score`.

Behaviour:

- Score: `Perfect` when `input.dynamicConfig?.kind === 'Regex_Input'` and the
  value is unset or `regexPattern(value)` is defined; otherwise `Mismatch` (a
  plain text under a `Regex_Input` annotation is left to `WidgetText`, which
  edits it as text — Enso's `Regex.compile` takes `Regex | Text`).
- With `regex '…'`: draws only the pattern literal's own port,
  `<NodeWidget :input="WidgetInput.FromAst(pattern)" />`, so `WidgetText` edits
  the pattern in place (no new editing code; the `regex` head is not drawn — the
  kind chip already says Regex). Monospace, as a code-like value.
- Unset (placeholder): an empty text input with the placeholder `.*`; on commit
  it writes `regex '<text>'` with the text escaped by `Ast.TextLiteral.new` (one
  `module.edit`, one `updateCallback`). An empty commit writes nothing.

- [ ] **Step 1: Failing score tests:** `Regex_Input` + `regex 'a'` →
      `Perfect`; + `Regex.compile 'a'` → `Perfect`; + unset → `Perfect`; + `'a'`
      → `Mismatch`; no config + `regex 'a'` → `Mismatch`.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** (a `<script lang="ts">` block with `regexScore` and
      `widgetDefinition`, a `<script setup>` block; reuse `WidgetText`'s
      `AutoSizedInput` for the placeholder case).
- [ ] **Step 4: Run** the widget tests and typecheck:

```bash
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets
corepack pnpm --filter enso-gui run typecheck
```

- [ ] **Step 5: Commit** `GUI: WidgetRegex edits a regex's pattern`.

## Task 9: `WidgetKindPicker.vue`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/__tests__/widgetKindPicker.score.test.ts`

**Interfaces:**

- Consumes: `matchKind`, `kindDefaultCode` (Task 6); `kindIcon` (Task 7);
  `UnionConfig` (Task 3); `defineWidget`, `Score`, `WidgetInput`, `widgetProps`
  (`app/gui/src/providers/openedProjects/widgetRegistry.ts` L420, L167, L142,
  L316); `DropdownWidget.vue` and its `DropdownEntry` (`icon`, `label`)
  (`app/gui/src/project-view/components/widgets/DropdownWidget.vue`) as
  `WidgetSelection.vue` uses it; `SvgIcon`; `injectWidgetTree().showDetails`
  (`app/gui/src/project-view/providers/widgetTree.ts`); `NodeWidget`.
- Produces: `widgetDefinition` (priority 44 — before `WidgetAnyToTarget` 45,
  `WidgetRegex` 48, `WidgetFileBrowser` 49 and `WidgetSelection` 50, so the
  picker wraps them);
  `export function kindPickerScore(input: WidgetInput): Score`.

Behaviour (owner decision 10):

- Score: `Perfect` when `input.dynamicConfig?.kind === 'Union'` and
  `matchKind(kinds, valueAst)` is defined (`valueAst` is `input.value` when it
  is an `Ast.Expression`, `undefined` for a placeholder); otherwise `Mismatch`.
- `chosen = kinds[matchKind(…)]`; `selected = tree.showDetails`;
  `icon = kindIcon(chosen)`.
- **A non-Nothing kind:** the chip, then `<NodeWidget :input="innerInput" />`
  with `innerInput = { ...props.input, dynamicConfig: chosen.config }`. The chip
  is, not selected, `<span class="kindIcon" :title="chosen.label">` holding
  `<SvgIcon :name="icon" />` at 14 px (or the label as text when `icon` is
  undefined); selected,
  `<button class="kindButton" :aria-label="`${chosen.label}, change
  kind`" aria-haspopup="listbox" :aria-expanded="open">` holding the same icon
  (or label) and the arrow
  (`<SvgIcon name="arrow_right_head_only" class="kindArrow" />`, rotated 90°, ~9
  px, opacity .9). The registry's same-port exclusion keeps the picker from
  selecting itself again (widgets `CLAUDE.md`, "re-running the registry").
- **`Nothing` chosen:** no chip and no inner widget when selected — the
  `Nothing ▼` button (`class="kindButton nothingButton"`,
  `aria-label="Nothing, change kind"`) replaces the value; when not selected,
  only `<NodeWidget :input="{ ...props.input, dynamicConfig: undefined }" />`,
  which draws the `Nothing` identifier as today.
- **Styles** (from the mockup; prefer an existing CSS variable where the widgets
  already have one with the same value): `.kindIcon` `display: inline-flex`,
  `height: 18px`, `padding: 0 4px`, `color: rgba(255 255 255 / 0.9)`,
  `pointer-events: none`; `.kindButton` `height: 18px`, `padding: 0 3px 0 4px`,
  `gap: 1px`, `border: 0`, `border-radius: 9px`,
  `background: rgba(0 0 0 / 0.22)`, `color: white`, `:hover`
  `rgba(0 0 0 / 0.34)`; `.nothingButton` `padding: 0 6px 0 8px`, the value font,
  bold; icons `width/height: 14px`.
- **Clicks and keys:** the button exists only on a selected node, so its click
  is the picker's: `@click.stop` toggles the list, `@pointerdown.stop` keeps the
  node from starting a drag (as `PickerShell`'s root rule does). Enter/Space
  open it (native button), Escape closes it and returns focus to the button;
  arrow keys move in the list as `DropdownWidget` already handles. Deselecting
  the node closes the list.
- The list: `DropdownWidget` with one entry per kind whose `kindDefaultCode` is
  defined, `{ value: String(index), label: kind.label, icon: kindIcon(kind) }`,
  `Nothing` last with no icon; the current kind selected.
- Choosing a different kind:

```ts
function switchTo(kind: UnionKind) {
  const code = kindDefaultCode(kind.config);
  if (code == null) return;
  module.value.edit((edit) => {
    addKindImports(edit, kind.config); // Date/Time_Of_Day/Date_Time/Enso_Secret imports, or a Single_Choice option's `requires`
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value: code },
      directInteraction: true,
    });
  });
}
```

`addKindImports` uses `module.value.addMissingImports(edit, …)` exactly as
`WidgetDate.vue` lines 41-48 does for `Date` (for `Secret_Browse`, the
`Enso_Secret` type's import, as `browsableTypes.ts`' `useSetPath` adds it when
it writes `Enso_Secret.get`), and the `requires` path `WidgetSelection`'s
`tag.resolveExpression(edit, module)` takes for an option. `regex` needs no
import beyond `Standard.Base` (it is exported from it). Choosing `Nothing`
writes `Nothing` even when it is the argument's default (spec §4).

- [ ] **Step 1: Failing score tests** (pattern of 3b's
      `W/WidgetDate/__tests__/widgetDate.score.test.ts`):

```ts
import { Score } from "$/providers/openedProjects/widgetRegistry";
import { Ast } from "@/util/ast";
import { expect, test } from "vitest";
import { kindPickerScore } from "../../WidgetKindPicker.vue";

const union = {
  kind: "Union",
  kinds: [
    { label: "Integer", config: { kind: "Numeric_Input" } },
    { label: "Nothing", config: null },
  ],
} as const;
const textOrRegex = {
  kind: "Union",
  kinds: [
    { label: "Text", config: { kind: "Text_Input" } },
    { label: "Regex", config: { kind: "Regex_Input" } },
  ],
} as const;
const input = (code: string | undefined, dynamicConfig?: unknown) =>
  ({
    portId: "p",
    value: code == null ? undefined : Ast.parseExpression(code)!,
    dynamicConfig,
  }) as never;

test("a Union and a value of one of its kinds", () => {
  expect(kindPickerScore(input("42", union))).toBe(Score.Perfect);
  expect(kindPickerScore(input("Nothing", union))).toBe(Score.Perfect);
  expect(kindPickerScore(input("regex 'a'", textOrRegex))).toBe(Score.Perfect);
});
test("an unset union argument", () => {
  expect(kindPickerScore(input(undefined, union))).toBe(Score.Perfect);
});
test("a value of no kind steps aside", () => {
  expect(kindPickerScore(input("x", union))).toBe(Score.Mismatch);
});
test("no Union, no picker (an annotation applies)", () => {
  expect(kindPickerScore(input("42", { kind: "Numeric_Input" }))).toBe(
    Score.Mismatch,
  );
  expect(kindPickerScore(input("42"))).toBe(Score.Mismatch);
});
```

(Match how existing score tests build a placeholder input — 3b's tests use
`WidgetInput.FromAst` / a placeholder helper; reuse it.)

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement** the component (a `<script lang="ts">` block with
      `kindPickerScore` and `widgetDefinition`, a `<script setup>` block with
      the chip, the button, the dropdown and `switchTo`). Positioning of the
      dropdown below the chip as `WidgetSelection` positions its
      `DropdownWidget` (`pickerMenuStyles` in `W/WidgetSelection/styles.ts`).

- [ ] **Step 4: Run** the score tests, the whole GUI unit suite and typecheck:

```bash
corepack pnpm --filter enso-gui exec vitest run
corepack pnpm --filter enso-gui run typecheck
```

- [ ] **Step 5: Commit** `GUI: WidgetKindPicker, a union's kind as an icon`.

## Task 10: Delete PR 3b's interim rules

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFileBrowser.vue`
  (score at lines ~102-117: the
  `reprType && SUPPORTED_TYPES.some((type) => reprType.includes(type))` disjunct
  and 3b's "Until PR 4's kind picker" comment)
- Modify: `W/WidgetFileBrowser/browsableTypes.ts` (`SUPPORTED_TYPES`, line 58 —
  delete if nothing else reads it)
- Test: a new `W/WidgetFileBrowser/__tests__/widgetFileBrowser.score.test.ts`

- [ ] **Step 1: Failing test**: an input with
      `[ArgumentInfoKey]: { info: { reprType: 'Standard.Base.Data.Text.Text | Standard.Base.System.File.File' } }`
      and no `dynamicConfig` → `Score.Mismatch`; with
      `dynamicConfig: { kind: 'File_Browse', file_types: [] }` → `Perfect`.
- [ ] **Step 2: Run, verify the first fails** (the `includes` rule still
      matches).
- [ ] **Step 3: Delete the rule** (and `SUPPORTED_TYPES` if unused; keep the
      `BrowserTypeInfo` write/raw-path/secret logic, which reads `reprType` for
      behaviour, not for choosing the widget — `rawPath` for `Text | File` still
      comes from the declared type, decision 3). Grep `app/gui/src` for
      `defaultSourceType` and `Until PR 4` — both must be gone.
- [ ] **Step 4: Run** the GUI unit suite. **Commit**
      `GUI: drop PR 3b's interim union rules`.

## Task 11: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/data/mockSuggestions.json`:
  `Widget.from` entries for `Locale` (its group A default) and `Regex` if 3b's
  mock lacks them; the conversion entries the rule needs — `File.from`
  (that:`Text`), `Float.from` (that:`Integer`) — as method suggestions shaped
  like the existing conversion entries (so the mock's `conversionSources` has
  them); the union arguments already there: `locale` `Locale | Nothing` ~L638,
  `Data.read` `path` `Text | URI | File` ~L819, `Text | File` ~L903.
- Modify: `app/gui/integration-test/mock/lsHandler.ts` (3b's
  `initialMockTypeDefaults`: add `Standard.Base.Data.Locale.Locale`'s
  `Single_Choice` answer and `Standard.Base.Data.Text.Regex.Regex`'s
  `Regex_Input`)
- Modify/Test: `app/gui/integration-test/project-view/widgets.spec.ts` — a new
  `test.describe('Kind picker', …)` after the 'Date widget' describe (L1183),
  using `editorPage.mockSuggestion` / `mockMethodCallInfo` and `setMockMainFile`
  as that describe does. Locate the button by role and name
  (`getByRole('button', { name: 'Integer, change kind' })`).

- [ ] **Step 1: Tests** (each mocks a method whose argument has the given
      `reprType`, no annotation):
  - "`Integer | Nothing`: unselected shows only the icon" — the node not
    selected: the icon is visible, no `… change kind` button exists, clicking
    the icon selects the node (no list).
  - "`Integer | Nothing`: selected, the icon is a button; choosing Nothing
    writes `Nothing`" — select the node, click `Integer, change kind`, the list
    shows Integer (with icon) and Nothing; click `Nothing`; the code has
    `Nothing` in that argument; no icon remains and the `Nothing, change kind`
    button is shown; deselect: plain `Nothing`, no button.
  - "keyboard": focus `Integer, change kind`, Enter opens, ArrowDown + Enter
    picks Nothing, Escape on a reopened list closes it.
  - "`Text | Nothing` choosing Nothing" (the spec's Testing line), from an unset
    argument whose default is `Nothing`: the code gets an explicit `Nothing`.
  - "switching kind is one undo step": `Text | Integer` at `'a'`, choose Integer
    (code `0`), `ControlOrMeta+Z` restores `'a'` (copy the pattern of "one
    choice is one undo step", L1440).
  - "`Text | Regex`": `'a.*c'` shows the Text icon; choose Regex → the code is
    `regex '.*'` and the regex input shows `.*`; editing it to `a+` writes
    `regex 'a+'`.
  - "`Text | Enso_Secret`": `'pw'` is Text; choose Enso_Secret → the code is
    `Enso_Secret.get ''` and the secret browser is beside the key icon.
  - "`Locale | Nothing` is one dropdown with a Nothing entry" (no chip).
  - "`Data.read`'s path keeps the file browser" (no chip; the
    `Text | URI | File` case of decision 3).
  - "`Text | File | Nothing`: File and Nothing" — the document icon, the browser
    beside it.
  - "an annotation wins": the same `Integer | Nothing` argument with an
    annotation answer `Single_Choice` shows the dropdown and no chip.
  - "`Vector (Text | Integer)` items each have an icon", and `+` adds `''`.
- [ ] **Step 2: Run** in the Linux clone (rebuild workspace packages first in a
      reused clone):

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh pnpm_ready && cd ~/enso-widgets-pr4/app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/widgets.spec.ts integration-test/project-view/argumentAccess.spec.ts integration-test/project-view/dataReadImports.spec.ts --workers=2 --repeat-each=3'
```

Expected: all pass three times; for any failure, run the same spec on
`origin/develop` the same way before blaming this branch (timing-sensitive).

- [ ] **Step 3: Commit** `Playwright: the kind picker`.

## Task 12: Docs, screenshots, changelog, PR, installer

**Files:** `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`,
`distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`, `CHANGELOG.md`.

- [ ] **Step 1: Docs.** Widgets `CLAUDE.md`: a "Kind picker" section — how a
      declared union's widget is composed (`unionKinds.ts`, the rules, the
      conversion rule and its `conversionSources` source), the picker's priority
      44 and why, the look (icon / button on selection / Nothing as the picker),
      `kindIcon` as the one place to give a kind an icon, `matchKind` /
      `kindDefaultCode` as the single place to teach a new widget kind its value
      shape; `WidgetRegex` (priority 48); remove 3b's "interim first-member
      rule" and "transitional union rule" text. Base `CLAUDE.md`: `Widget.Union`
      and when a library should use it (an annotation or type default that wants
      a picker; declared unions need nothing), `Widget.Regex_Input`, and that a
      conversion `B.from (that : A)` makes A no kind of its own in a union with
      B.
- [ ] **Step 2: Screenshots** before (develop) and after (branch), Linux
      Playwright mock, on the `pr-screenshots` orphan branch under `pr-<NNN>/`
      (the list in Global Constraints); worktree for that branch as in the PR 1b
      plan, Task "Screenshots". The icon gallery is a mocked argument whose
      annotation answer is a `Widget.Union` of every kind (Text, Integer, Float,
      Boolean, Date, Time_Of_Day, Date_Time, File, Folder (`Folder_Browse`,
      which only an annotation or a `Widget.Union` can produce), Enso_Secret,
      Regex, Vector, Nothing), node selected, list open — it also exercises the
      engine-built `Union` path.
- [ ] **Step 3: Changelog** entry (Global Constraints); open the PR as draft to
      learn its number, put it in the entry, push.
- [ ] **Step 4: Full verification** before marking ready:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh pnpm_ready && cd ~/enso-widgets-pr4 && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && find . -name ".eslintcache" -not -path "*/node_modules/*" -delete && corepack pnpm --filter enso-gui run typecheck && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run test:unit'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh dist && for s in Base_Tests Table_Tests; do echo "== $s"; ~/pr4.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done'
corepack pnpm exec prettier --check CHANGELOG.md app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md
```

- [ ] **Step 5: PR body**: what changed; the composition rules (conversion rule
      with the File/URI/Enso_Secret/Regex findings); the decisions the owner
      took; what users will notice (optional arguments get a `Nothing` choice; a
      type icon in front of union values; `Text | File` unchanged; regex
      arguments get their own input); screenshots; "Closes" lines for any
      tickets this finishes. Mark ready.
- [ ] **Step 6: CI green; Windows installer** (IDE Packaging artifact or
      `ide-local`) to `C:\Users\jdunk\Downloads\enso-pr<NNN>\`. Installer
      checklist for the owner: an `Integer | Nothing` argument unselected and
      selected (e.g. `Table.take`'s `count`-style optional numbers), choosing
      Nothing and back, `Locale | Nothing` (`Text.to_case`-style `locale`),
      `Data.read` path, a `Text | File | Nothing` argument, `Text.replace`'s
      `term` (`Text | Regex`), an HTTP `Header` value (`Text | Enso_Secret`),
      switching kind and undoing it, the keyboard path, an annotated union
      (selector `columns`) unchanged.
- [ ] **Step 7: On the owner's OK, merge** (`gh pr merge --squash`, no
      `--delete-branch`); then remove the worktree, branch, Linux clone,
      `~/pr4.sh` and the installer folder.

## Self-review

- **Decisions → tasks:** 1 → Tasks 4–5; 2 → Tasks 1, 3; 3 (conversion rule) →
  Tasks 4–5 (+ the secret matcher in Task 6, the raw-path note in Task 10); 4 →
  Task 4; 5 → Task 6 (`Secret_Browse` writes `Enso_Secret.get ''`, a consequence
  of 3, called out); 6 → Tasks 6, 9; 7 (Regex) → Tasks 2, 3, 6, 8; 8 → Task 5; 9
  → no task (none by design); 10 (look) → Tasks 7, 9, 11, 12.
- **The picker never contradicts the code:** Task 6's read-back test covers
  every kind's default, including Regex (`regex '.*'`) and Secret.
- **Priorities:** picker 44 < `WidgetAnyToTarget` 45 < `WidgetRegex` 48 <
  `WidgetFileBrowser` 49 < `WidgetSelection` 50; the date widgets (53) and the
  generic ones come after.
- **Names used across tasks:** `UnionKind`, `UnionConfig`, `RegexInput` (Task
  3); `unionMembers`, `composeUnion`, `Converts`, `kindLabel`, `NOTHING_TYPE`
  (Task 4); `vectorItemDefault` (Task 5); `matchKind`, `kindDefaultCode`,
  `regexPattern` (Task 6); `kindIcon`, icons `input_decimal`, `toggle`, `regex`
  (Task 7); `regexScore` (Task 8); `kindPickerScore`, `addKindImports` (Task 9).
- **Out of scope:** icons supplied by libraries for their own types (later);
  `Widget.Union` in the standard library (PR 6); a widget for
  `Derived_Secret_Value` (would change `Header`'s picker; Task 4 pins today's).
