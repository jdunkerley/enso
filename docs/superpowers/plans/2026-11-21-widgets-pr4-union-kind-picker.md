# Widgets PR 4: Unions and the Kind Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An argument whose declared type is a union
(`Text | Integer | Nothing`, `Locale | Nothing`, `Text | File | Nothing`) gets a
small kind picker in front of the widget of the kind its value has:
`[Integer ▾] [ 42 ]`. Choosing a kind writes that kind's default value
(`Nothing` included) as one undoable edit. When every member is a plain
dropdown, the members' choices merge into one dropdown instead, with `Nothing`
as an entry. `Vector T` items get T's widget, with a picker each when T is a
union. Engine side, `Widget.Union` lets a type default or an annotation produce
the same picker.

**Architecture:** The GUI composes a union's widget itself from the per-type
defaults PR 3b caches (`TypeDefaults`), so a union costs no engine query beyond
its members' once-per-type `resolve_type`. A pure module (`unionKinds.ts`)
splits the declared type into members, drops members without a widget, merges
equal widgets and the `Text` member a browser makes redundant, and returns one
of: nothing, a single kind's widget, a merged `Single_Choice`, or a `Union`
configuration. A new composite widget, `WidgetKindPicker.vue` (priority 44),
renders the kind dropdown and hands the chosen kind's configuration to the next
widget on the same port, exactly as `WidgetSelection` hands
`singleChoiceConfiguration` to its inner widget. The chosen kind is always
derived from the code (`matchKind`), never stored. PR 3b's two interim rules
(the first non-`Nothing` member's default, and `WidgetFileBrowser`'s
`reprType.includes` rule) are deleted.

**Tech Stack:** Enso (Base), TypeScript + Vue 3 + zod (GUI), vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§1
precedence, §4 "Unions and vectors: the kind picker"; Testing: "kind picker
(initial kind from the value; switching is one undoable edit)", Playwright
"`Text | Nothing` choosing Nothing"; PR table row 4). This PR amends §4 (see
"Spec amendment" below).

**Depends on:** PR 3b
(`docs/superpowers/plans/2026-11-19-widgets-pr3b-gui-type-defaults.md`), which
is being implemented in parallel. **Start after 3b merges**, from
`origin/develop` at or after its merge commit. Inputs this plan takes from 3b,
by name (check each exists before Task 3; if 3b renamed one, use its name and
note it in the PR body):

- `app/gui/src/providers/openedProjects/widgetRegistry/typeDefaults.ts`:
  `TypeDefaults` (`lookup(reprType, frame)`), `defaultSourceType(reprType)`,
  `RESOLVE_TYPE_EXPRESSION`, `WIDGET_TYPE`.
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
- The integration mock's `initialMockTypeDefaults` / `updateMockTypeDefault`
  (`app/gui/integration-test/mock/lsHandler.ts`) and the group D `Widget.from`
  entries in `mockSuggestions.json`.

## Owner decisions needed

The spec leaves these open. Each has a recommendation; the plan is written to
the recommendation, and the task named in brackets changes if the owner decides
otherwise.

1. **Who builds a declared union's picker: the GUI or the engine?**
   _Recommended: the GUI_, from the members' type defaults it already caches
   (once per type per session, PR 3b). An engine
   `resolve_type "A | B | Nothing"` would cost one query per distinct union and
   duplicate the composition rules in Enso. `Widget.Union` still exists for
   annotations and type defaults that want a picker (spec §4 "so a type default
   or resolver can produce one too"); its JSON parses into the same
   configuration. [Tasks 3–4]
2. **How `Widget.Union` carries `Nothing`.** The spec's
   `kinds:(Vector (Pair Text Widget))` has no widget for `Nothing`.
   _Recommended: a second field,
   `Widget.Union kinds:(Vector (Pair Text Widget)) include_nothing:Boolean=False`_
   (spec amendment), so `Nothing` is never a fake widget. Alternative: a
   sentinel pair `["Nothing", Widget.Text_Input]` the GUI special-cases by
   label. [Tasks 1–2]
3. **`Text` beside a browser.** In `Text | File` (`Data.read`'s `path`,
   `Text | URI | File`) a text literal is both a Text and a File path, so the
   picker could never show File for a typed path, and the file browser that
   argument has today would be lost. _Recommended: when a union has a
   `File_Browse`, `Folder_Browse` or `Secret_Browse` kind, its `Text` member is
   dropped_ (the browser edits text itself), so `Text | URI | File` has one kind
   and shows the browser exactly as today, and `Text | File | Nothing` gets
   `[File ▾]` with File and Nothing. [Task 3]
4. **Members with equal widgets** (`Integer | Float`, `Number | Integer`).
   _Recommended: they collapse into the first_ (deep-equal configurations), so
   `Integer | Float` has one kind and no picker. [Task 3]
5. **What switching to each kind writes** (spec: "the new kind's default
   value"). _Recommended table_ (one place, `kindDefaultCode`, Task 5):

   | Kind's widget                                   | Writes                                                         |
   | ----------------------------------------------- | -------------------------------------------------------------- |
   | `Nothing`                                       | `Nothing`                                                      |
   | `Text_Input`                                    | `''`                                                           |
   | `Numeric_Input`                                 | `minimum` if set and positive, else `0`                        |
   | `Boolean_Input`                                 | `False`                                                        |
   | `Date_Input`                                    | `Date.today` (with the `Date` import, as `WidgetDate` adds it) |
   | `Time_Input`                                    | `Time_Of_Day.now` (import likewise)                            |
   | `Date_Time_Input`                               | `Date_Time.now` (import likewise)                              |
   | `Single_Choice`                                 | its first option's `value` (and that option's `requires`)      |
   | `Multiple_Choice`, `Vector_Editor`              | `[]`                                                           |
   | `File_Browse`, `Folder_Browse`, `Secret_Browse` | `''` (the browser then opens on the empty path)                |
   | anything else                                   | not offered as a kind (no sensible value to write)             |

   The date/time defaults are those `WidgetVector/elementType.ts`'s
   `DEFAULT_ITEMS` already use for new list items.

6. **A value that matches no kind** (a variable, `x + 1`, a call). The spec says
   "otherwise the first member", which would put a text input over `x`.
   _Recommended: the picker steps aside_ (`Score.Mismatch`) for a set value that
   matches no kind, and the argument is drawn as any expression; "the first
   member" applies to an unset argument (placeholder). [Task 5–6]
7. **`Regex`.** The spec's example `Text | Regex → [Regex ▾]` needs a `Regex`
   type default, which no PR has added (3a's 24 types and 3b's group D do not
   include it). _Recommended: leave it out of PR 4_: `Regex` has no widget, so
   `Text | Regex` has one kind (Text) and no picker; file a follow-up ticket for
   a `Regex` default (a regex-syntax text input writing `regex '…'`). The
   alternative adds that default and a `regex '…'` matcher here (+1 task).
8. **`Vector T` new-item value when T's widget is not a dropdown.** The spec
   says "otherwise blank"; a blank (`_`) item turns the list into a function
   (`WidgetVector/elementType.ts`'s comment). _Recommended: the first kind's
   default value from decision 5_ (`''`, `0`, `Date.today` …) (spec amendment).
   [Task 4]
9. **Any standard-library use of `Widget.Union` in this PR.** _Recommended:
   none_. Declared unions are composed by the GUI (decision 1); the constructor
   is tested and documented, and the first library use arrives with a resolver
   in PR 6.
10. **The picker's look.** _Recommended:_ a compact chip with the kind's label
    and the `SelectionArrow`, in front of the kind's widget on the same row,
    opening the existing `DropdownWidget` with one entry per kind (labels: the
    member's short type name, `Nothing` last). No new design tokens.

## Spec amendment (in the plans PR)

§4 gains, after "**Engine side**":

> **Decided 2026-11-21 (plan for PR 4, owner decisions pending):** the GUI
> composes a declared union's picker from its members' cached type defaults;
> `Widget.Union` has a second field `include_nothing:Boolean=False`. In a union
> with a browser kind (`File_Browse`, `Folder_Browse`, `Secret_Browse`) the
> `Text` member is dropped; members with equal widgets collapse. A set value
> that matches no kind gets no picker. A `Vector T` item's default is the first
> option of a dropdown, otherwise the first kind's default value.

(Amend the wording if the owner decides otherwise.)

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
  the current value (`matchKind`); no state remembers a choice.
- Switching kind is **one** `module.edit` → one `updateCallback` (one undo
  step), imports included.
- A bare `Vector`/`Array` stays with the GUI (spec §4): `WidgetVector`'s
  `expectedType.startsWith('Standard.Base.Data.Vector.Vector')` score stays.
- `lintEnso` runs with `-Werror`: `sbt "all lintEnso"` stays green. Regenerate
  the API docs of every changed library
  (`bin/enso --docs api --in-project <lib>`) and run
  `corepack pnpm --filter build-scripts run stdlib-api-check`.
- Stdlib suites only against a full distribution (`buildEngineDistribution`, not
  NoIndex, which lacks the test-helper jars). Check each run's
  `N tests succeeded.` line: a filter that matches nothing exits 0.
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`: "Arguments
  that accept several types, such as text or a number or `Nothing`, show a
  picker for the kind of value, and switching it writes a value of that kind."
  (`[NNN]` = the PR number; open the PR as draft first to learn it.)
- **Screenshots** before/after on the orphan `pr-screenshots` branch under
  `pr-<NNN>/` (Linux Playwright mock): `Integer | Nothing` with the picker open,
  `Text | File | Nothing`, `Locale | Nothing` (merged dropdown with `Nothing`),
  `Data.read`'s `path` (unchanged), a `Vector (Text | Integer)` list.
- **Owner installer test before merge** (Windows installer; feature merge gate).
  Do not merge without the owner's OK.

## File Structure

**Engine (Base)**

- Modify `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`:
  `Widget.Union` and its `to_json`.
- Modify `test/Base_Tests/src/Metadata_Spec.enso`: its JSON.
- Regenerate `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md`.

**GUI** (`W/` = `app/gui/src/project-view/components/GraphEditor/widgets/`,
`REG/` = `app/gui/src/providers/openedProjects/widgetRegistry/`)

- Modify `REG/configuration.ts`: the `Union` kind.
- Create `REG/unionKinds.ts`: members of a declared type, the composition rules
  (pure).
- Modify `REG/typeDefaults.ts` (3b): unions through `unionKinds.ts`;
  `defaultSourceType` deleted.
- Create `W/WidgetKindPicker/kindMatch.ts`: `matchKind`, `kindDefaultCode`
  (pure).
- Create `W/WidgetKindPicker.vue`: the composite widget.
- Modify `W/WidgetVector.vue`, `W/WidgetVector/elementType.ts`: union elements,
  item default.
- Modify `W/WidgetFileBrowser.vue`: delete the transitional rule.
- Modify `app/gui/integration-test/mock/data/mockSuggestions.json`,
  `app/gui/integration-test/mock/lsHandler.ts`,
  `app/gui/integration-test/project-view/widgets.spec.ts`.
- Modify `W/CLAUDE.md`, `CHANGELOG.md`.
- Tests: `REG/__tests__/configuration.test.ts`, new
  `REG/__tests__/unionKinds.test.ts`, `REG/__tests__/typeDefaults.test.ts`
  (3b's), new `W/WidgetKindPicker/__tests__/kindMatch.test.ts`, new
  `W/WidgetKindPicker/__tests__/widgetKindPicker.score.test.ts`,
  `W/WidgetVector/__tests__/elementType.test.ts`.

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

- [ ] **Step 5: Regenerate Base's API docs** and check:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '. ~/.enso-toolchain.sh && cd ~/enso-widgets-pr4 && built-distribution/enso-engine-*/enso-*/bin/enso --docs api --in-project distribution/lib/Standard/Base/0.0.0-dev && corepack pnpm --filter build-scripts run stdlib-api-check'
```

Copy `docs/api/Metadata.md` back to the Windows worktree (rsync the one file).

- [ ] **Step 6: Commit**

```bash
git add distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md test/Base_Tests/src/Metadata_Spec.enso
git commit -m "Widget.Union: one of several kinds of value, with or without Nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 2: GUI schema for `Union`

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
```

(Compare with how the file's existing tests write the expected `kind` objects;
if `withKindSchema` leaves `constructor`/`type` on the parsed object, use
`toMatchObject` as they do.)

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts
```

Expected: FAIL (`Invalid discriminator value`).

- [ ] **Step 3: Implement.** Add `UnionKind`, `UnionConfig` and `| UnionConfig`
      to `WidgetConfiguration`. In the discriminated union, after
      `Any_To_Target`:

```ts
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

- [ ] **Step 5: Commit** `GUI: parse Widget.Union` (with the `Co-Authored-By`
      trailer, as in Task 1).

## Task 3: `unionKinds.ts` — composing a declared union

**Files:**

- Create: `app/gui/src/providers/openedProjects/widgetRegistry/unionKinds.ts`
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/unionKinds.test.ts`

**Interfaces:**

- Consumes: `WidgetConfiguration`, `UnionConfig`, `SingleChoice`, `Choice` (Task
  2 / existing).
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

/**
 * The widget of a union from its members' widgets (spec §4 and this plan's owner decisions 3 and 4):
 * - `'pending'` while any member is pending;
 * - members without a widget are dropped; `Nothing` is a kind of its own;
 * - members with deep-equal widgets collapse into the first;
 * - with a browser kind (`File_Browse`, `Folder_Browse`, `Secret_Browse`) the `Text_Input` kind is dropped;
 * - every remaining non-Nothing kind a `Single_Choice` → one merged `Single_Choice` (`Nothing` an option);
 * - one kind (Nothing not counted unless present) → that kind's widget alone, `undefined` if it is only Nothing;
 * - otherwise a `Union` (`Nothing` last).
 */
export function composeUnion(
  members: MemberWidget[],
): WidgetConfiguration | undefined | "pending";

/** The label a kind is listed under: the member's last path segment, applied types kept (`Vector Text`). */
export function kindLabel(typeName: string): string;
```

- [ ] **Step 1: Failing tests** (`unionKinds.test.ts`):

```ts
import { expect, test } from "vitest";
import {
  composeUnion,
  kindLabel,
  NOTHING_TYPE,
  unionMembers,
  type MemberWidget,
} from "../unionKinds";

const TEXT = "Standard.Base.Data.Text.Text";
const INTEGER = "Standard.Base.Data.Numbers.Integer";
const FLOAT = "Standard.Base.Data.Numbers.Float";
const FILE = "Standard.Base.System.File.File";
const URI = "Standard.Base.Network.URI.URI";
const LOCALE = "Standard.Base.Data.Locale.Locale";
const CASE = "Standard.Base.Data.Text.Case.Case";
const textInput = { kind: "Text_Input" } as const;
const numeric = { kind: "Numeric_Input" } as const;
const file = {
  kind: "File_Browse",
  existing_only: true,
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
    composeUnion([m(TEXT, textInput), m(INTEGER, numeric), nothing]),
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
  const result = composeUnion([m(INTEGER, numeric), nothing]);
  expect(result).toMatchObject({
    kind: "Union",
    kinds: [{ label: "Integer" }, { label: "Nothing" }],
  });
});

test("a member without a widget is not a kind", () => {
  expect(composeUnion([m(URI, undefined), m(TEXT, textInput)])).toEqual(
    textInput,
  );
});

test("equal widgets collapse into the first member", () => {
  expect(composeUnion([m(INTEGER, numeric), m(FLOAT, numeric)])).toEqual(
    numeric,
  );
});

test("a browser drops the Text member: Text | URI | File is the file browser alone", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(URI, undefined), m(FILE, file)]),
  ).toEqual(file);
});

test("Text | File | Nothing is File and Nothing", () => {
  expect(
    composeUnion([m(TEXT, textInput), m(FILE, file), nothing]),
  ).toMatchObject({
    kind: "Union",
    kinds: [
      { label: "File", config: file },
      { label: "Nothing", config: null },
    ],
  });
});

test("dropdowns merge into one dropdown, Nothing an option", () => {
  expect(composeUnion([m(LOCALE, locales), m(CASE, cases), nothing])).toEqual({
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
  expect(composeUnion([m(LOCALE, locales), nothing])).toEqual({
    kind: "Single_Choice",
    values: [
      choice("..Default"),
      { value: "Nothing", label: "Nothing", parameters: [] },
    ],
  });
});

test("merged dropdowns drop repeated values", () => {
  expect(composeUnion([m(LOCALE, locales), m(LOCALE + "2", locales)])).toEqual(
    locales,
  );
});

test("pending while any member is pending", () => {
  expect(composeUnion([m(TEXT, textInput), m(INTEGER, "pending")])).toBe(
    "pending",
  );
});

test("Nothing alone has no widget", () => {
  expect(composeUnion([nothing])).toBeUndefined();
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
  - `composeUnion`: return `'pending'` if any member is pending. Walk members in
    order, building `kinds: UnionKind[]` and `hasNothing`: `NOTHING_TYPE` →
    `hasNothing = true`; `undefined` config → skip; a config deep-equal (use
    `isEqual` from `lib0/function` or the comparison the GUI already uses for
    configurations — search `equalFlat`/`isEqual` in `app/gui/src/util`; else a
    small `JSON.stringify` comparison, configurations are plain JSON) to an
    earlier kind's → skip. If any kind is a browser, drop `Text_Input` kinds. If
    `kinds.length > 0` and every kind is `Single_Choice`, return one
    `Single_Choice` whose `values` are the concatenation, without values whose
    `value` (a string) repeats, plus
    `{ value: 'Nothing', label: 'Nothing', parameters: [] }` when `hasNothing`.
    If `kinds.length === 0` → `undefined`. If
    `kinds.length === 1 && !hasNothing` → `kinds[0].config`. Otherwise
    `{ kind: 'Union', kinds: [...kinds, ...(hasNothing ? [{ label: 'Nothing', config: null }] : [])] }`.

- [ ] **Step 4: Run, verify they pass.**

- [ ] **Step 5: Commit**
      `GUI: compose a union's widget from its members' widgets`.

## Task 4: `TypeDefaults` and vectors use the composition

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/typeDefaults.ts`
  (3b): `lookup`; delete `defaultSourceType`.
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

- Consumes: `unionMembers`, `composeUnion` (Task 3); `kindDefaultCode` (Task 5 —
  do Task 5 Step 3's `kindDefaultCode` first if executing out of order; it is a
  pure function).
- Produces: `TypeDefaults.lookup(reprType, frame)` returns the composed widget
  for a union (`undefined` while pending); `vectorElementType` returns a union
  element type (`Vector (Text | Integer)` → `"Text | Integer"` in full names);
  `vectorItemDefault(itemConfig): string | undefined`.

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
```

(`TEXT`, `INTEGER` constants as in Task 3; `frameA`, `frameB`, `Ok`,
`flushPromises` as 3b's tests import them.)

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
    `composeUnion(members.map(t => ({ typeName: t, config: t === NOTHING_TYPE ? undefined : lookupType(t, frame) })))`
    with `'pending'` mapped to `undefined`. Delete `defaultSourceType` and its
    export; grep `app/gui` for other users and replace them with `lookup`.
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
    `Union` configuration and therefore a picker each (Task 6).

- [ ] **Step 4: Run, verify they pass**, plus `callTree` and the widget
      registry:

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry src/project-view/util/__tests__/callTree.test.ts src/project-view/components/GraphEditor/widgets/WidgetVector
```

- [ ] **Step 5: Commit**
      `GUI: union-typed arguments and list items take their union's widget`.

## Task 5: `kindMatch.ts` — which kind the code is, what a kind writes

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/kindMatch.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/__tests__/kindMatch.test.ts`

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
/** The index in `kinds` of the kind `value` is, or `undefined` if it is none of them. An unset argument is kind 0. */
export function matchKind(
  kinds: readonly UnionKind[],
  value: Ast.Expression | undefined,
): number | undefined;

/** The code switching to a kind writes (owner decision 5), or `undefined` if the kind cannot be offered. */
export function kindDefaultCode(
  config: WidgetConfiguration | null,
): string | undefined;
```

Matching, per kind, in `kinds` order, first match wins:

| Kind's widget                                   | Matches                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `null` (Nothing)                                | the identifier `Nothing` or `Standard.Base.Nothing.Nothing`                                     |
| `Text_Input`                                    | a text literal                                                                                  |
| `Numeric_Input`                                 | a number literal, or `-` applied to one                                                         |
| `Boolean_Input`                                 | `True`, `False`, `Boolean.True`, `Boolean.False`                                                |
| `Date_Input` / `Time_Input` / `Date_Time_Input` | the whole-node shapes the date / time / date-time widgets recognise                             |
| `Single_Choice`                                 | code equal to a flattened option's `value`, or an application whose head is (`..Equals that=1`) |
| `Multiple_Choice`, `Vector_Editor`              | a vector literal                                                                                |
| `File_Browse`, `Folder_Browse`                  | a text literal, or `File.new …`                                                                 |
| `Secret_Browse`                                 | a text literal, or `Enso_Secret.get …`                                                          |

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
  [{ kind: "Any_To_Target" }, undefined],
] as const)("kindDefaultCode(%o)", (config, expected) => {
  expect(kindDefaultCode(config as never)).toBe(expected);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetKindPicker
```

- [ ] **Step 3: Implement** both functions per the tables (`Ast.TextLiteral`,
      `Ast.NumericLiteral`, `Ast.NegationApp`, `Ast.Ident`, `Ast.Vector`,
      `Ast.App`/`Ast.PropertyAccess` heads; compare a `Single_Choice` value with
      `value.code()` after stripping parentheses, and an application by its
      head's code). Move the date/time `bare`/`applied` lists as described in
      Interfaces and import them in the three widgets too (no behaviour change
      there).

- [ ] **Step 4: Run, verify they pass**, plus the date/time widget tests
      (`W/WidgetDate`, `W/WidgetTimeOfDay`, `W/WidgetDateTime` `__tests__`).

- [ ] **Step 5: Commit**
      `GUI: which kind a value is, and what each kind writes`.

## Task 6: `WidgetKindPicker.vue`

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetKindPicker/__tests__/widgetKindPicker.score.test.ts`

**Interfaces:**

- Consumes: `matchKind`, `kindDefaultCode` (Task 5); `UnionConfig` (Task 2);
  `defineWidget`, `Score`, `WidgetInput`, `widgetProps`
  (`app/gui/src/providers/openedProjects/widgetRegistry.ts` L420, L167, L142,
  L316); `DropdownWidget.vue`
  (`app/gui/src/project-view/components/widgets/DropdownWidget.vue`) and
  `SelectionArrow` as `WidgetSelection.vue` uses them; `NodeWidget`.
- Produces: `widgetDefinition` (priority 44 — before `WidgetAnyToTarget` 45,
  `WidgetFileBrowser` 49 and `WidgetSelection` 50, so the picker wraps them);
  `export function kindPickerScore(input: WidgetInput): Score`.

Behaviour:

- Score: `Perfect` when `input.dynamicConfig?.kind === 'Union'` and
  `matchKind(kinds, valueAst)` is defined (`valueAst` is `input.value` when it
  is an `Ast.Expression`, `undefined` for a placeholder); otherwise `Mismatch`.
- Renders a chip (the kind's `label` + `SelectionArrow`) and, beside it,
  `<NodeWidget :input="innerInput" />` where `innerInput` is
  `{ ...props.input, dynamicConfig: chosen.config ?? undefined }`. For the
  `Nothing` kind the inner widget draws the `Nothing` identifier as any token
  (`dynamicConfig` undefined). The registry's same-port exclusion keeps the
  picker from selecting itself again (widgets `CLAUDE.md`, "re-running the
  registry").
- Clicking the chip opens `DropdownWidget` with one entry per kind whose
  `kindDefaultCode` is defined; the current kind is selected.
- Choosing a different kind:

```ts
function switchTo(kind: UnionKind) {
  const code = kindDefaultCode(kind.config);
  if (code == null) return;
  module.value.edit((edit) => {
    addKindImports(edit, kind.config); // Date/Time_Of_Day/Date_Time imports, or a Single_Choice option's `requires`
    return props.updateCallback({
      edit,
      portUpdate: { origin: props.input.portId, value: code },
      directInteraction: true,
    });
  });
}
```

`addKindImports` uses `module.value.addMissingImports(edit, …)` exactly as
`WidgetDate.vue` lines 41-48 does for `Date`, and the `requires` path
`WidgetSelection`'s `tag.resolveExpression(edit, module)` takes for an option.
Choosing `Nothing` writes `Nothing` even when it is the argument's default (spec
§4).

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
const input = (code: string | undefined, dynamicConfig?: unknown) =>
  ({
    portId: "p",
    value: code == null ? undefined : Ast.parseExpression(code)!,
    dynamicConfig,
  }) as never;

test("a Union and a value of one of its kinds", () => {
  expect(kindPickerScore(input("42", union))).toBe(Score.Perfect);
  expect(kindPickerScore(input("Nothing", union))).toBe(Score.Perfect);
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
      the chip, dropdown and `switchTo`), styled with the chip styles
      `WidgetSelection` uses (`activityDropdownStyles` / `pickerMenuStyles` in
      `W/WidgetSelection/styles.ts`).

- [ ] **Step 4: Run** the score tests, the whole GUI unit suite and typecheck:

```bash
corepack pnpm --filter enso-gui exec vitest run
corepack pnpm --filter enso-gui run typecheck
```

(If typecheck fails on an icon name:
`corepack pnpm --filter enso-gui run generate-icons`.)

- [ ] **Step 5: Commit** `GUI: WidgetKindPicker, a picker of a union's kinds`.

## Task 7: Delete PR 3b's interim rules

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
      behaviour, not for choosing the widget). Grep `app/gui/src` for
      `defaultSourceType` and `Until PR 4` — both must be gone.
- [ ] **Step 4: Run** the GUI unit suite. **Commit**
      `GUI: drop PR 3b's interim union rules`.

## Task 8: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/data/mockSuggestions.json` (add
  `Widget.from` entries for `Locale` (its group A default) if 3b did not; the
  union arguments already there: `locale` `Locale | Nothing` ~L638, `Data.read`
  `path` `Text | URI | File` ~L819, `Text | File` ~L903)
- Modify: `app/gui/integration-test/mock/lsHandler.ts` (3b's
  `initialMockTypeDefaults`: add `Standard.Base.Data.Locale.Locale`'s
  `Single_Choice` answer)
- Modify/Test: `app/gui/integration-test/project-view/widgets.spec.ts` — a new
  `test.describe('Kind picker', …)` after the 'Date widget' describe (L1183),
  using `editorPage.mockSuggestion` / `mockMethodCallInfo` and `setMockMainFile`
  as that describe does.

- [ ] **Step 1: Tests** (each mocks a method whose argument has the given
      `reprType`, no annotation):
  - "`Integer | Nothing`: the picker shows Integer for `42`, and choosing
    Nothing writes `Nothing`" — open the chip, click `Nothing`, the module code
    has `Nothing` in that argument; the chip now reads `Nothing`.
  - "`Text | Nothing` choosing Nothing" (the spec's Testing line), from an unset
    argument whose default is `Nothing`: the code gets an explicit `Nothing`.
  - "switching kind is one undo step": `Text | Integer` at `'a'`, choose Integer
    (code `0`), `ControlOrMeta+Z` restores `'a'` (copy the pattern of "one
    choice is one undo step", L1440).
  - "`Locale | Nothing` is one dropdown with a Nothing entry" (no chip).
  - "`Data.read`'s path keeps the file browser" (no chip; the
    `Text | URI | File` case of owner decision 3).
  - "`Text | File | Nothing`: File and Nothing" — chip reads `File`, the browser
    is beside it.
  - "an annotation wins": the same `Integer | Nothing` argument with an
    annotation answer `Single_Choice` shows the dropdown and no chip.
  - "`Vector (Text | Integer)` items each have a picker", and `+` adds `''`.
- [ ] **Step 2: Run** in the Linux clone (rebuild workspace packages first in a
      reused clone):

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh pnpm_ready && cd ~/enso-widgets-pr4/app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/widgets.spec.ts integration-test/project-view/argumentAccess.spec.ts integration-test/project-view/dataReadImports.spec.ts --workers=2 --repeat-each=3'
```

Expected: all pass three times; for any failure, run the same spec on
`origin/develop` the same way before blaming this branch (timing-sensitive).

- [ ] **Step 3: Commit** `Playwright: the kind picker`.

## Task 9: Docs, screenshots, changelog, PR, installer

**Files:** `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`,
`distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`, `CHANGELOG.md`.

- [ ] **Step 1: Docs.** Widgets `CLAUDE.md`: a "Kind picker" section — how a
      declared union's widget is composed (`unionKinds.ts`, the rules), the
      picker's priority 44 and why, `matchKind` / `kindDefaultCode` as the
      single place to teach a new widget kind its value shape; remove 3b's
      "interim first-member rule" and "transitional union rule" text. Base
      `CLAUDE.md`: `Widget.Union` and when a library should use it (an
      annotation or type default that wants a picker; declared unions need
      nothing).
- [ ] **Step 2: Screenshots** before (develop) and after (branch), Linux
      Playwright mock, on the `pr-screenshots` orphan branch under `pr-<NNN>/`
      (the list in Global Constraints); worktree for that branch as in the PR 1b
      plan, Task "Screenshots".
- [ ] **Step 3: Changelog** entry (Global Constraints); open the PR as draft to
      learn its number, put it in the entry, push.
- [ ] **Step 4: Full verification** before marking ready:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh pnpm_ready && cd ~/enso-widgets-pr4 && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && find . -name ".eslintcache" -not -path "*/node_modules/*" -delete && corepack pnpm --filter enso-gui run typecheck && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run test:unit'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr4.sh dist && for s in Base_Tests Table_Tests; do echo "== $s"; ~/pr4.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done'
corepack pnpm exec prettier --check CHANGELOG.md app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md
```

- [ ] **Step 5: PR body**: what changed; the composition rules; the decisions
      the owner took; what users will notice (optional arguments get a `Nothing`
      choice; `Text | File` unchanged); screenshots; "Closes" lines for any
      tickets this finishes. Mark ready.
- [ ] **Step 6: CI green; Windows installer** (IDE Packaging artifact or
      `ide-local`) to `C:\Users\jdunk\Downloads\enso-pr<NNN>\`. Installer
      checklist for the owner: an `Integer | Nothing` argument (e.g.
      `Table.take`'s `count`-style optional numbers), `Locale | Nothing`
      (`Text.to_case`-style `locale`), `Data.read` path, a
      `Text | File |     Nothing` argument, switching kind and undoing it, an
      annotated union (selector `columns`) unchanged.
- [ ] **Step 7: On the owner's OK, merge** (`gh pr merge --squash`, no
      `--delete-branch`); then remove the worktree, branch, Linux clone,
      `~/pr4.sh` and the installer folder.
