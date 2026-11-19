# Widgets PR 3b: The GUI Takes Type Defaults From the Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GUI stops choosing widgets by an argument's declared type. Every
argument without an annotation gets its type's default widget from the standard
library (`Widget.from (that : X.type)`, asked once per type per session through
`Widget_Query.resolve_type` and cached). The types the GUI recognised in its own
code (Boolean, numbers, Text, Date, Date_Time, Time_Of_Day, File, Writable_File,
Enso_Secret) get conversions too, with new `Date_Input`, `Date_Time_Input` and
`Time_Input` constructors, so a date or time picker can be asked for anywhere,
including in a nested call. Annotations that only repeat the type default are
deleted.

**Architecture:** Engine side, group D conversions live in `Metadata.enso`
(`Widget`'s module). GUI side, a project-scoped `TypeDefaults` cache knows from
the suggestion database's existing `conversionSources` index which types have a
default, asks `resolve_type` in a node's frame the first time a type is needed,
and hands the parsed configuration to the call tree as the argument's
`dynamicConfig` when no annotation or inherited configuration applies. Widgets
then score on the configuration's `kind` instead of the declared type; literal
detection (`True`, a text or number literal, whole-node `Date.new …` shapes) and
`tagValues` stay.

**Tech Stack:** Enso (Base), TypeScript + Vue 3 + zod (GUI), vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§1
precedence, §2 group D, §4 interim, §6 "Type default" level; PR table row 3,
split into 3a and 3b by the owner on 2026-11-19).

**Depends on:** PR 3a (`Widget.from` for 24 types, `Widget_Query.resolve_type`).
Start from `origin/develop` after 3a merges.

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr3b`, branch
  `widgets/pr3b-gui-type-defaults`, from `origin/develop`. Linux clone
  `~/enso-widgets-pr3b` on WSL `Ubuntu-24.04` for engine builds, stdlib suites
  and the Playwright suite (baselines and CI are Linux). Delete both when the PR
  merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree. Use `corepack pnpm`.
- Precedence for an argument (spec §1), first that applies wins: its
  annotation's widget (the `resolve_call` answer) or an inherited configuration
  (a choice's `parameters`); then its type default (`TypeDefaults`); then the
  GUI's literal detection and `tagValues`.
- **Owner decisions 2026-11-19:**
  - The GUI fetches a type default **once per type per session** and caches it.
  - **Unions use their first member's default** until PR 4's kind picker:
    `Integer | Nothing` → Integer's. `Nothing` itself has no default, so a union
    starting with `Nothing` uses the next member.
  - Group C types keep `default_widget` until PR 6; nothing here touches them.
- Transitional rule (until PR 4): `WidgetFileBrowser` keeps matching a declared
  type that _contains_ `File`, `Writable_File` or `Enso_Secret`
  (`reprType.includes`), so `Text | File` arguments keep their file browser,
  which the first-member rule would otherwise replace with a text input. Mark it
  in code:
  `// Until PR 4's kind picker: a union containing a browsable type keeps the browser.`
- A bare `Vector`/`Array` stays with the GUI (spec §4): `WidgetVector`'s
  `expectedType.startsWith('Standard.Base.Data.Vector.Vector')` score stays.
- `reprType` keeps being read for behaviour beyond choosing a widget (the file
  browser's write / raw-path / secret-as-text logic in `browsableTypes.ts`).
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`, e.g. "Date,
  time and number pickers and other widgets now come from the argument's type in
  the standard library, so they also appear inside nested calls and for optional
  arguments such as `Integer | Nothing`." (`[NNN]` = the PR number; open as
  draft first to learn it.)
- **Screenshots** before/after on the orphan `pr-screenshots` branch under
  `pr-<NNN>/`, one per group D type (spec Risks: "PR 3 compares screenshots of
  every group D type before and after"), plus a nested date picker and an
  `Integer | Nothing` argument.
- **Owner installer test before merge** (Windows installer; feature merge gate).

## Group D defaults

| Type (qualified)                                                    | Default                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `Standard.Base.Data.Boolean.Boolean`                                | `Widget.Boolean_Input`                                 |
| `Standard.Base.Data.Numbers.Integer`                                | `Widget.Numeric_Input`                                 |
| `Standard.Base.Data.Numbers.Float`                                  | `Widget.Numeric_Input`                                 |
| `Standard.Base.Data.Numbers.Number`                                 | `Widget.Numeric_Input`                                 |
| `Standard.Base.Data.Text.Text`                                      | `Widget.Text_Input`                                    |
| `Standard.Base.Data.Time.Date.Date`                                 | `Widget.Date_Input` (new)                              |
| `Standard.Base.Data.Time.Date_Time.Date_Time`                       | `Widget.Date_Time_Input` (new)                         |
| `Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day`                   | `Widget.Time_Input` (new)                              |
| `Standard.Base.System.File.File`                                    | `Widget.File_Browse`                                   |
| `Standard.Base.System.File.Writable_File` (check the path)          | `Widget.File_Browse existing_only=False action=..Save` |
| `Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret` (check the path) | `Widget.Secret_Browse`                                 |

The spec's `decimal_places` 0 for Integer is left out: `WidgetNumber` does not
read `decimal_places` (it is not even serialised), so setting it would change
nothing; Integer, Float and Number get the same `Numeric_Input`.

Today's GUI behaviour for each, which the defaults must reproduce: Boolean → the
`True`/`False` dropdown (`WidgetSelection`, `booleanExpressionTags`) and the
checkbox for a literal (`WidgetBoolean`); numbers → `WidgetNumber`; Text →
`WidgetText`; Date / Time_Of_Day / Date_Time → their pickers; File /
Writable_File / Enso_Secret → `WidgetFileBrowser` (write mode for Writable_File
via `existing_only: false`).

---

## Task 1: Engine — new constructors and group D conversions

**Files:**

- Modify: `distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso`
  (`type Widget` at line ~70, `to_json` at ~138)
- Test: `test/Base_Tests/src/Type_Default_Spec.enso` (from 3a)
- Regenerate: `distribution/lib/Standard/Base/0.0.0-dev/docs/api/Metadata.md`

**Interfaces:**

- Produces: constructors `Widget.Date_Input`, `Widget.Date_Time_Input`,
  `Widget.Time_Input` (no fields), JSON `{"constructor":"Date_Input"}` etc.;
  `File_Browse`'s JSON gains `"action":"Open"|"Save"`. `resolve_type` answers
  the table above for the eleven types.

- [ ] **Step 1: Failing tests** in `Type_Default_Spec.enso`:

```enso
    suite_builder.group "Group D type defaults" group_builder->
        group_builder.specify "Boolean" <| (Widget.from Boolean).to_json . should_equal '{"constructor":"Boolean_Input"}'
        group_builder.specify "Integer, Float and Number" <|
            [Integer, Float, Number].each t-> (Widget.from t).to_json . should_equal '{"constructor":"Numeric_Input"}'
        group_builder.specify "Text" <| (Widget.from Text).to_json . should_equal '{"constructor":"Text_Input"}'
        group_builder.specify "Date" <| (Widget.from Date).to_json . should_equal '{"constructor":"Date_Input"}'
        group_builder.specify "Date_Time" <| (Widget.from Date_Time).to_json . should_equal '{"constructor":"Date_Time_Input"}'
        group_builder.specify "Time_Of_Day" <| (Widget.from Time_Of_Day).to_json . should_equal '{"constructor":"Time_Input"}'
        group_builder.specify "File" <|
            json = (Widget.from File).to_json . parse_json
            json.get "constructor" . should_equal "File_Browse"
            json.get "existing_only" . should_be_true
            json.get "action" . should_equal "Open"
        group_builder.specify "Writable_File" <|
            json = (Widget.from Writable_File).to_json . parse_json
            json.get "existing_only" . should_be_false
            json.get "action" . should_equal "Save"
        group_builder.specify "Enso_Secret" <| (Widget.from Enso_Secret).to_json . should_equal '{"constructor":"Secret_Browse"}'
        group_builder.specify "through resolve_type" <|
            Widget_Query.resolve_type "Standard.Base.Data.Time.Date.Date" . should_equal '{"widget":{"constructor":"Date_Input"}}'
```

      Replace 3a's `"Date and Time_Of_Day have no default until PR 3b"` test
      (now false), and change 3a's `Widget.from Text . should_fail_with`
      check to a type that still has none (`Widget.from Vector . should_fail_with No_Such_Conversion`:
      a bare `Vector` stays with the GUI).

- [ ] **Step 2: Run, verify they fail.**

- [ ] **Step 3: Implement.** In `type Widget`, after `Secret_Browse`, with doc
      comments in the style of the neighbours:

```enso
    ## ---
       private: true
       ---
       The date picker.
    Date_Input

    ## ---
       private: true
       ---
       The date-and-time picker.
    Date_Time_Input

    ## ---
       private: true
       ---
       The time-of-day picker.
    Time_Input
```

      In `to_json`:

```enso
        Widget.File_Browse existing_only action file_types ->
            action_json = case action of
                File_Action.Save -> '"Save"'
                _ -> '"Open"'
            '{"constructor":"File_Browse","existing_only":' + (if existing_only then "true" else "false") + ',"action":' + action_json + ',"file_types":' + file_types.to_json + '}'
        Widget.Date_Input -> '{"constructor":"Date_Input"}'
        Widget.Date_Time_Input -> '{"constructor":"Date_Time_Input"}'
        Widget.Time_Input -> '{"constructor":"Time_Input"}'
```

      Module-level conversions at the end of `Metadata.enso`, each with
      `private: true` front matter and a one-line doc ("The default widget for
      arguments of type `Boolean`."):

```enso
Widget.from (that : Boolean.type) -> Widget = Widget.Boolean_Input
Widget.from (that : Integer.type) -> Widget = Widget.Numeric_Input
Widget.from (that : Float.type) -> Widget = Widget.Numeric_Input
Widget.from (that : Number.type) -> Widget = Widget.Numeric_Input
Widget.from (that : Text.type) -> Widget = Widget.Text_Input
Widget.from (that : Date.type) -> Widget = Widget.Date_Input
Widget.from (that : Date_Time.type) -> Widget = Widget.Date_Time_Input
Widget.from (that : Time_Of_Day.type) -> Widget = Widget.Time_Input
Widget.from (that : File.type) -> Widget = Widget.File_Browse
Widget.from (that : Writable_File.type) -> Widget = Widget.File_Browse existing_only=False action=..Save
Widget.from (that : Enso_Secret.type) -> Widget = Widget.Secret_Browse
```

      If an import of `File`, `Writable_File`, `Enso_Secret`, `Date_Time` or
      `Time_Of_Day` into `Metadata.enso` creates an import cycle the compiler
      rejects, put that conversion in the type's own module instead (a
      conversion may live in the source type's module); say which in the report.

- [ ] **Step 4: Run, verify they pass**; run all of `Base_Tests` (the
      `File_Browse` JSON change touches `Data_Read_Widgets_Spec` and any test
      that compares a whole `File_Browse` JSON: update the expected text, not
      the behaviour). `sbt "all lintEnso"`.

- [ ] **Step 5: Regenerate Base's API docs**
      (`bin/enso --docs api --in-project distribution/lib/Standard/Base/0.0.0-dev`)
      and run `corepack pnpm --filter build-scripts run stdlib-api-check`.

- [ ] **Step 6: Commit**
      `Group D type defaults and the date/time input widgets`.

## Task 2: GUI schema for the new kinds

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (`widgetConfigurationSchema` ~203-232, the `File_Browse` entry)
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/configuration.test.ts`,
  `__tests__/widgetQueryAnswer.test.ts`

**Interfaces:**

- Produces: `WidgetConfiguration` kinds
  `'Date_Input' | 'Date_Time_Input' | 'Time_Input'` (no fields); `File_Browse`
  gains `action?: 'Open' | 'Save'`.

- [ ] **Step 1: Failing tests** — `widgetConfigurationSchema` parses
      `{"constructor":"Date_Input"}` to `{ kind: 'Date_Input' }` (same for the
      other two) and `File_Browse` with `"action":"Save"`; an old `File_Browse`
      without `action` still parses.

```ts
test.each(["Date_Input", "Date_Time_Input", "Time_Input"] as const)(
  "parses %s",
  (kind) => {
    const parsed = widgetConfigurationSchema.parse({ constructor: kind });
    expect(parsed).toEqual({ kind });
  },
);

test("parses File_Browse with an action", () => {
  const parsed = widgetConfigurationSchema.parse({
    constructor: "File_Browse",
    existing_only: false,
    action: "Save",
    file_types: [],
  });
  expect(parsed).toMatchObject({
    kind: "File_Browse",
    existing_only: false,
    action: "Save",
  });
});
```

      (Match the file's existing helper for the `constructor` → `kind` rename
      if the schema is wrapped.)

- [ ] **Step 2: Run**
      `corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry`
      — fails.

- [ ] **Step 3: Implement** — three
      `z.object({ kind: z.literal('Date_Input') })` entries (or the file's
      equivalent form) and `action: z.enum(['Open', 'Save']).optional()` on
      `File_Browse`; extend the TS `WidgetConfiguration` union if it is declared
      separately.

- [ ] **Step 4: Run — pass. Commit**
      `GUI: parse Date_Input, Date_Time_Input, Time_Input`.

## Task 3: `TypeDefaults` — once per type per session

**Files:**

- Create: `app/gui/src/providers/openedProjects/widgetRegistry/typeDefaults.ts`
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/typeDefaults.test.ts`
- Modify: the project-scoped provider that owns the suggestion database and
  `executeExpression` (`src/providers/openedProjects/project/project.ts` or the
  widget registry's provider — put the instance where `widgetRegistry` is
  created, so it lives exactly as long as the opened project)

**Interfaces:**

- Consumes: `SuggestionDb.conversionSources` (`suggestionDatabase/index.ts:70`;
  target key → source keys, a source key built with
  `parseAbsoluteProjectPathRaw(reprType).value.key()`);
  `widgetConfigurationSchema` and `reportWidgetSchemaMismatch`
  (`src/providers/engineLogAppend.ts:31-46`);
  `queuedExecuteExpression(expressionId, code, timeoutMs)`
  (`project.ts:288-310`).
- Produces:

```ts
export const WIDGET_TYPE = "Standard.Base.Metadata.Widget";
export const RESOLVE_TYPE_EXPRESSION = (typeName: string) =>
  `${MODULE_CALL} 'Standard.Base.Metadata.Widget_Query' 'resolve_type' [] '${typeName}'`;

/** The type whose default an argument of declared type `reprType` takes (spec §4 interim: the first member that is not `Nothing`). */
export function defaultSourceType(
  reprType: string | undefined,
): string | undefined;

export class TypeDefaults {
  constructor(
    hasDefault: (typeName: string) => boolean,
    query: (frame: ExternalId, code: string) => Promise<Result<unknown> | null>,
  );
  /** The type's default widget: `undefined` while unknown or when it has none. Reactive. */
  lookup(
    reprType: string | undefined,
    frame: ExternalId,
  ): WidgetConfiguration | undefined;
}
```

- [ ] **Step 1: Failing tests** (`typeDefaults.test.ts`):

```ts
test.each([
  ["Standard.Base.Data.Numbers.Integer", "Standard.Base.Data.Numbers.Integer"],
  [
    "Standard.Base.Data.Numbers.Integer | Standard.Base.Nothing.Nothing",
    "Standard.Base.Data.Numbers.Integer",
  ],
  [
    "Standard.Base.Nothing.Nothing | Standard.Base.Data.Text.Text",
    "Standard.Base.Data.Text.Text",
  ],
  ["Standard.Base.Nothing.Nothing", undefined],
  [undefined, undefined],
])("defaultSourceType(%s)", (repr, expected) => {
  expect(defaultSourceType(repr)).toBe(expected);
});

test("asks once per type and caches the answer", async () => {
  const query = vi.fn(async () =>
    Ok({ widget: { constructor: "Date_Input" } }),
  );
  const defaults = new TypeDefaults(() => true, query);
  expect(defaults.lookup(DATE, frameA)).toBeUndefined(); // pending
  await flushPromises();
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: "Date_Input" });
  expect(defaults.lookup(DATE, frameB)).toEqual({ kind: "Date_Input" });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(frameA, RESOLVE_TYPE_EXPRESSION(DATE));
});

test("does not ask for a type without a Widget conversion", () => {
  const query = vi.fn();
  const defaults = new TypeDefaults(() => false, query);
  expect(defaults.lookup("My.Type", frameA)).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});

test.each([
  ["an error", { error: { step: "type_default", message: "boom" } }],
  ["a null widget", { widget: null }],
  ["an unreadable widget", { widget: { constructor: "Nope" } }],
])("%s gives no default and is not asked again", async (_name, answer) => {
  const query = vi.fn(async () => Ok(answer));
  const defaults = new TypeDefaults(() => true, query);
  defaults.lookup(DATE, frameA);
  await flushPromises();
  expect(defaults.lookup(DATE, frameA)).toBeUndefined();
  expect(query).toHaveBeenCalledTimes(1);
});

test("an unreadable widget is reported once", async () => {
  const report = vi.spyOn(engineLogAppend, "reportWidgetSchemaMismatch");
  const defaults = new TypeDefaults(
    () => true,
    async () => Ok({ widget: { constructor: "Nope" } }),
  );
  defaults.lookup(DATE, frameA);
  await flushPromises();
  defaults.lookup(DATE, frameA);
  expect(report).toHaveBeenCalledTimes(1);
});

test("a failed query (no result yet) is retried on the next lookup", async () => {
  const query = vi
    .fn<(frame: ExternalId, code: string) => Promise<Result<unknown> | null>>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(Ok({ widget: { constructor: "Date_Input" } }));
  const defaults = new TypeDefaults(() => true, query);
  defaults.lookup(DATE, frameA);
  await flushPromises();
  expect(defaults.lookup(DATE, frameA)).toBeUndefined(); // asks again
  await flushPromises();
  expect(defaults.lookup(DATE, frameA)).toEqual({ kind: "Date_Input" });
  expect(query).toHaveBeenCalledTimes(2);
});
```

      `DATE = 'Standard.Base.Data.Time.Date.Date'`; `frameA`/`frameB` are two
      `ExternalId`s; `flushPromises` from `@vue/test-utils` (or the helper the
      neighbouring tests use); `Ok` from `ydoc-shared/util/data/result` (check
      the import path the widget-registry tests use). If
      `reportWidgetSchemaMismatch` is not spy-able as a module export, give
      `TypeDefaults` a third constructor argument `report` defaulting to it and
      pass a `vi.fn()`.

- [ ] **Step 2: Run**
      `corepack pnpm --filter enso-gui exec vitest run typeDefaults` — fails.

- [ ] **Step 3: Implement.**
  - `defaultSourceType`: split on `|`, trim, drop
    `Standard.Base.Nothing.Nothing`, return the first; `undefined` for none.
  - `TypeDefaults` holds a `reactive(new Map<string, CacheEntry>())` keyed by
    type name, where `CacheEntry` is
    `{ state: 'pending' } | { state: 'done', config: WidgetConfiguration | undefined }`.
  - `lookup`: `const type = defaultSourceType(reprType)`; unknown or
    `!hasDefault(type)` → `undefined`. No entry → set pending, start the query
    (not awaited), return `undefined`. Pending → `undefined`. Done → its
    `config`.
  - The query parses the answer with a small zod schema
    `z.union([z.object({ widget: widgetConfigurationSchema.nullable() }), z.object({ error: z.object({ step: z.string(), message: z.string() }) })])`.
    A `widget` → done with it (`null` → `undefined`); `error` → done with
    `undefined` (the engine already logged it); a schema failure → done with
    `undefined` and `reportWidgetSchemaMismatch(type, …)`; a `null` result or a
    rejected promise (no frame yet, timeout) → delete the entry, so the next
    lookup retries.
  - `hasDefault(type)` in production:
    `suggestionDb.conversionSources.lookup(widgetKey)?.has(sourceKeyOf(type + '.type'))`,
    with both keys built exactly as `conversionSources` builds them
    (`parseAbsoluteProjectPathRaw(…).value.key()`). Cover this wiring with one
    test that builds a `SuggestionDb` with a `Widget.from` entry whose first
    argument's `reprType` is `Standard.Base.Data.Time.Date.Date.type` (copy how
    `conversionSources.test.ts` builds its entries).
  - `query` in production:
    `(frame, code) => project.queuedExecuteExpression(frame, code, 5000)`.
  - Session lifetime: the instance is created with the opened project and
    dropped with it. A type defined in the user's project caches its default for
    the session too (known limitation: editing a project's own `Widget.from`
    takes effect on reopen; no standard-library type is affected).

- [ ] **Step 4: Run — pass. Commit**
      `GUI: TypeDefaults, a type's default widget once per session`.

## Task 4: Arguments take their type default

**Files:**

- Modify: `app/gui/src/project-view/util/callTree.ts`
  (`ArgumentFactory.dynamicConfig` ~73-75, `toWidgetInput` ~102-112)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`
  (where the `ArgumentFactory` / call tree is built for a call; thread the
  lookup in)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetVector.vue`
  (~143-151, item inputs)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunctionDef/ArgumentRow.vue`
  (~120-124)
- Test: `app/gui/src/project-view/util/__tests__/callTree.test.ts`,
  `W/WidgetVector/__tests__/` (new `itemConfig.test.ts`),
  `widgetFunctionCallInfo.test.ts`

**Interfaces:**

- Consumes: `TypeDefaults.lookup(reprType, frame)` (Task 3).
- Produces: an argument's `dynamicConfig` is
  `annotationOrInherited ?? typeDefaults.lookup(argInfo.reprType, callExternalId)`;
  a vector item's is
  `item_editor ?? typeDefaults.lookup(elementType, vectorExternalId)`.

- [ ] **Step 1: Failing tests.**
  - `callTree.test.ts`: an argument with
    `reprType: 'Standard.Base.Data.Time.Date.Date'`, no annotation, and a
    `typeDefault` stub returning `{ kind: 'Date_Input' }` → its
    `WidgetInput.dynamicConfig` is `{ kind: 'Date_Input' }`; with an annotation
    answer `{ kind: 'Single_Choice', … }` the annotation wins; with an inherited
    configuration the inherited one wins.
  - `itemConfig.test.ts`: extract the item-config choice into a pure function
    `vectorItemConfig(itemEditor, elementType, typeDefault)` in
    `W/WidgetVector/elementType.ts` and test: `item_editor` wins; otherwise the
    element type's default; `Vector Date` → `Date_Input`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement.** Give `ArgumentFactory` an optional
      `typeDefault: (reprType: string | undefined) => WidgetConfiguration | undefined`
      (the call site binds the frame: the call's own `externalId`, which always
      exists). `dynamicConfig(name)` returns
      `widgetCfg?.parameters.get(name) ?? this.typeDefault?.(argInfo?.reprType)`.
      `widgetFunctionCallInfo.ts` builds it from the injected `TypeDefaults`
      (inject it the way `widgetRegistry` is injected). Do **not** turn a type
      default into `pending()`: while it is unknown the argument behaves as
      today without a configuration (literal detection), and Vue reactivity
      swaps in the default when it arrives. `WidgetVector` uses
      `vectorItemConfig`; `ArgumentRow` passes
      `typeDefaults.lookup(expectedType, <the definition's externalId>)` as the
      row's `dynamicConfig` when it has none.

- [ ] **Step 4: Run — pass**, plus the whole widget-registry and callTree
      suites. **Commit**
      `GUI: arguments without an annotation take their type's default widget`.

## Task 5: Widgets score on the configuration, not the declared type

**Files** (every declared-type check, from the research on 46e2324cd0; `W/` =
`app/gui/src/project-view/components/GraphEditor/widgets/`):

- `W/WidgetBoolean/booleanValue.ts:57-67` (`isBooleanArgument`, line 61 is the
  type check)
- `W/WidgetSelection.vue:236-266` (`selectionScore`: the Boolean branch requires
  `dynamicConfig == null`), `:101-105` (`expressionTags` for Boolean)
- `W/WidgetNumber.vue:67-87` (lines 78-86: `expectedType` → `Score.Good`)
- `W/WidgetText.vue:105-117` (lines 111-112)
- `W/WidgetDate.vue:67-97` (`isDateTyped`), `W/WidgetTimeOfDay.vue:65-92`
  (`isTimeTyped`), `W/WidgetDateTime.vue:69-100`
- `W/WidgetFileBrowser.vue:102-117` (keeps its `includes` rule — Global
  Constraints)
- Tests: `W/WidgetBoolean/__tests__/widgetBoolean.score.test.ts`,
  `booleanValue.test.ts`, `W/WidgetSelection/__tests__/booleanDropdown.test.ts`,
  `W/WidgetDate/__tests__/widgetDate.score.test.ts`,
  `W/WidgetTimeOfDay/__tests__/widgetTimeOfDay.score.test.ts`,
  `W/WidgetDateTime/__tests__/widgetDateTime.score.test.ts`; new
  `W/__tests__/widgetNumber.score.test.ts`,
  `W/__tests__/widgetText.score.test.ts`.

**Interfaces:**

- Consumes: Task 2's kinds; Task 4 puts them in `dynamicConfig`.

The mapping, each replacing the declared-type check (the literal / whole-node /
`tagValues` checks stay as they are):

| Widget                          | Before (declared type)                                         | After (configuration)                                                                             |
| ------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `isBooleanArgument`             | `reprType === BOOLEAN_TYPE \|\| expectedType === BOOLEAN_TYPE` | `dynamicConfig?.kind === 'Boolean_Input'`                                                         |
| `selectionScore` Boolean branch | `isBooleanArgument(input) && dynamicConfig == null`            | `isBooleanArgument(input) && (dynamicConfig == null \|\| dynamicConfig.kind === 'Boolean_Input')` |
| `WidgetNumber`                  | `expectedType` is Number/Integer/Float → `Good`                | (deleted; `Numeric_Input` already → `Perfect`)                                                    |
| `WidgetText`                    | `expectedType === Text` → `Good`                               | (deleted; `Text_Input` already → `Perfect`)                                                       |
| `WidgetDate`                    | `isDateTyped` (`=== DATE_TYPE`)                                | `dynamicConfig?.kind === 'Date_Input'`                                                            |
| `WidgetTimeOfDay`               | `isTimeTyped`                                                  | `dynamicConfig?.kind === 'Time_Input'`                                                            |
| `WidgetDateTime`                | `=== DATE_TIME_TYPE`                                           | `dynamicConfig?.kind === 'Date_Time_Input'`                                                       |

- [ ] **Step 1: Rewrite the score tests first.** Each existing test that gives a
      declared type and expects a match now gives the configuration instead
      (`dynamicConfig: { kind: 'Date_Input' }`) and expects the same score; add
      one test per widget that a declared type **without** a configuration no
      longer matches (e.g. `expectedType: DATE_TYPE`, no config → `Mismatch`
      unless it is a whole-node `Date.new …`). For `WidgetNumber` and
      `WidgetText` (no score tests today) add: config → `Perfect`, literal →
      `Perfect`, declared type alone → `Mismatch`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** the table. Delete the now-unused type constants only
      where nothing else reads them (`DATE_TYPE` etc. are also used by the
      expression helpers — keep those). In `WidgetFileBrowser.vue` add the
      transitional comment from Global Constraints next to the `includes` rule.

- [ ] **Step 4: Run** the whole GUI unit suite
      (`corepack pnpm --filter enso-gui exec vitest run`) and typecheck
      (`corepack pnpm --filter enso-gui run typecheck`; if it fails on an icon
      name, regenerate icons first:
      `corepack pnpm --filter enso-gui run generate-icons`). **Commit**
      `GUI: widgets score on their configuration, not the declared type`.

## Task 6: Delete annotations that repeat the type default

**Files:** standard library sources with `@arg (Widget.from X)` (no extra
arguments) where `arg`'s declared type's first member (Task 3's rule) is `X`.

**Interfaces:**

- Consumes: 3a's rewritten call sites; Task 4's fallback.

- [ ] **Step 1: Script** (scratchpad, Node): for each `@<arg> (Widget.from <X>)`
      annotation, find the method it annotates and `<arg>`'s ascription in the
      signature; if the ascription's first non-`Nothing` member is `<X>` (by
      simple name, resolved through the module's imports), delete the annotation
      line. Report three lists: deleted; kept because of extra arguments
      (`Widget.from Filter_Condition include_text=False`, the
      `count=self.length` lambdas, `add_user_password=True` — these are real
      tweaks); kept because the ascription differs or is missing (these stay and
      are listed in the PR body).

- [ ] **Step 2: Run it; `sbt "all lintEnso"`** (removing the last use of an
      import makes it unused: delete the import).

- [ ] **Step 3: Check the suggestion database.** A method whose annotations all
      went now has `annotations: []`, so the GUI sends no widget query for it.
      Pick three deleted annotations from Step 1's list, one each typed
      `Locale`, `Encoding` and `Rows_To_Read`, and add them to the installer
      checklist (Task 8 Step 5): each argument still gets its dropdown.

- [ ] **Step 4: Regenerate API docs** for every changed library and run
      `stdlib-api-check`. Run `Base_Tests`, `Table_Tests`, `SQLite_Tests`,
      `Format_Discovery_Tests`, `Geo_Tests` against the full distribution (tests
      that call `resolve_call` for a deleted annotation now get
      `{"widget":null}`: change them to `resolve_type` of the argument's type,
      which is where the widget now comes from).

- [ ] **Step 5: Commit**
      `Standard library: drop annotations that repeat the type default`.

## Task 7: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/lsHandler.ts` (`slotPreprocessorKey`
  ~789-811; add a `resolve_type` route)
- Modify: `app/gui/integration-test/mock/data/mockSuggestions.json` (add
  `Widget.from` conversion entries for the group D types)
- Modify/Test: `app/gui/integration-test/project-view/widgets.spec.ts`

**Interfaces:**

- Consumes: `RESOLVE_TYPE_EXPRESSION` (Task 3), Task 1's JSON.

- [ ] **Step 1: Mock.** In `slotPreprocessorKey`, route an in-frame
      `call_module_method` whose method is `resolve_type` to the key
      `resolve_type:<type name>` (the value argument, `call.args[0]`, unquoted).
      Add `initialMockTypeDefaults: Record<string, unknown>` with the eleven
      group D answers (`{ widget: { constructor: 'Date_Input' } }` …) and answer
      from it (`{ widget: null }` for others); add
      `updateMockTypeDefault(type, answer)` next to
      `updateMockWidgetConfiguration`. In `mockSuggestions.json`, add one
      `Widget.from` method entry per group D type, `selfType`
      `Standard.Base.Metadata.Widget`, first argument `that` with `reprType`
      `<type>.type` (copy the shape of an existing conversion entry in the file,
      or of `conversionSources.test.ts`).

- [ ] **Step 2: Existing specs.** The Date, Time_Of_Day and Boolean describes
      (`widgets.spec.ts` ~1183, ~1476, ~2056) mock un-annotated typed arguments
      and passed through type scoring; with the mock above they must pass
      unchanged. Run them; fix only the mock if they fail.

- [ ] **Step 3: New tests** in `widgets.spec.ts`:
  - "A type's default widget is asked once": two nodes with `Date`-typed
    un-annotated arguments both show the date picker; the mock saw one
    `resolve_type:Standard.Base.Data.Time.Date.Date` request.
  - "Optional arguments take their first member's widget": an argument typed
    `Standard.Base.Data.Numbers.Integer | Standard.Base.Nothing.Nothing` shows
    the number widget.
  - "A nested call's date argument gets the picker": a constructor argument
    inside a choice (`..Equals that=`-style) typed `Date` shows the date picker.
  - "An annotation still wins over the type default": a `Text`-typed argument
    with an annotation answer `Single_Choice` shows the dropdown, not the text
    input.

- [ ] **Step 4: Run** the full `widgets.spec.ts`, `argumentAccess.spec.ts`,
      `dataReadImports.spec.ts`, `localDatalinkWidget.spec.ts` in the Linux
      clone, three times each with `--workers=2`, and the same on develop for
      any failure (timing-sensitive suite). Rebuild workspace packages first in
      a reused clone (`corepack pnpm -r compile`). **Commit**
      `Playwright: type defaults from the library`.

## Task 8: Docs, screenshots, changelog, PR, installer

**Files:** `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`,
`distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md`, `CHANGELOG.md`.

- [ ] **Step 1: Docs.** Widgets `CLAUDE.md`: how a widget is chosen now
      (annotation / inherited → type default from `TypeDefaults` → literals and
      `tagValues`); widgets score on `dynamicConfig.kind`, never on
      `expectedType`/`reprType` (except the file browser's transitional union
      rule and its behaviour logic); the interim first-member rule until PR 4.
      Base `CLAUDE.md`: group D conversions in `Metadata.enso`; "annotate only
      to override a type default".

- [ ] **Step 2: Screenshots** before (develop) and after (branch), on the
      `pr-screenshots` orphan branch under `pr-<NNN>/`: one node per group D
      type with an un-annotated argument, plus `Integer | Nothing`, plus a
      nested date picker. Take them from the Playwright mock (Linux), as PR 2
      did.

- [ ] **Step 3: Changelog** entry (Global Constraints). Open the PR as draft,
      put its number in the entry, push.

- [ ] **Step 4: PR body**: what changed, the group D table, the precedence, the
      transitional file-browser rule, Task 6's three lists, visible changes for
      the owner to check (optional arguments now get widgets; nested pickers),
      screenshots. Mark ready.

- [ ] **Step 5: CI green; Windows installer** (IDE Packaging artifact or
      `ide-local`) to `C:\Users\jdunk\Downloads\enso-pr<NNN>\`; installer
      checklist for the owner: Boolean dropdown/checkbox, a number, a text, the
      three pickers (also inside a `Filter_Condition` choice), a file path and a
      secret, `Integer | Nothing`, `Table.read` / `Data.read` unchanged.

- [ ] **Step 6: On the owner's OK, merge** (`gh pr merge --squash`, no
      `--delete-branch`); then remove the worktree, branch, Linux clone and
      installer folder.
