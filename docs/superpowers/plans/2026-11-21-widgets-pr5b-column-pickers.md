# Widgets PR 5b: Column Pickers Expanded in the GUI, Libraries Migrated — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every column picker in the standard libraries (Table, Database,
DuckDB, Geo, XML, YXDB) becomes a declarative `Widget.Column_Name` /
`Column_Names` / `Column_Vector` / `Order_By` reference, and the GUI expands
each reference locally from the column list the answer carries once. A widget
answer for a 500-column table drops from up to 1.6 MB to under 50 KB, and a
recomputed table or a database table reuses the GUI's expansion instead of
rebuilding it.

**Architecture:** PR 5a made the engine send `{"arguments":…,"columns":{…}}`.
Here the GUI's answer schema reads `columns`, and a pure module
(`columnPickers.ts`) replaces every picker reference, at any depth
(`Choice.parameters`, nested choices, `Vector_Editor.item_editor`, `Union`
kinds), by the `Single_Choice` / `Multiple_Choice` / `Vector_Editor` the library
builds today, so every downstream widget is unchanged. Expansions are memoised
on the schema (the source's `Widget_Columns` JSON) — the spec's schema-keyed
cache. In the libraries, the builders in `Table/Internal/Widget_Helpers.enso`
emit references instead of copying names (composite ones — aggregate, filter,
join, rename, fill, `Simple_Expression` — keep their structure and only their
nested pickers change), and every plain picker annotation becomes a static
`Widget.…` value. The checked-in widget benchmark is extended and run before and
after.

**Tech Stack:** TypeScript + Vue 3 + zod (GUI), vitest, Playwright; Enso (Table,
Database, Geo, XML, YXDB); the Enso benchmark harness.

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§5
"The column list is sent once per answer", "The builders … are rewritten over
`Widget_Columns`"; §6 "Schema-keyed cache", "Targets"; Testing "column-reference
expansion", "Performance"; PR table row 5).

**Depends on:** PR 5a
(`docs/superpowers/plans/2026-11-21-widgets-pr5a-column-pickers.md`) merged.
Independent of PRs 3b and 4 (see "Shared files").

## Owner decisions

**Decided 2026-11-21 (owner):** the recommendations of 8, 9, 10, 12, 13 and 14
are taken (10: `type_names` parsed and kept, not shown; 14: size asserted, time
reported). **Decision 11 is the alternative: kind filters are added now** (Task
5b below). Decisions 1–7 (PR 5a plan) all take their recommendation.

Decisions 1–7 are in the PR 5a plan (split; database types never queried;
`Other` always offered; `Widget.Column_Name` spelling; the flag set; no engine
cache; module names). These are 5b's:

8. **The schema-keyed cache lives in the GUI.** The engine's remaining work per
   query is one `Widget_Columns.from` per source (measured in Task 7). The
   expensive part was building and parsing copies, which references remove.
   _Recommended:_ the GUI memoises each expansion on (source schema JSON, picker
   JSON), in a small LRU (64 schemas) per opened project; a recomputed in-memory
   table and a database table with the same columns hit. No new engine cache.
9. **`_with_table_cache` in this PR.** _Recommended:_ removed from every helper
   this PR rewrites (their output no longer depends on the column list, so
   caching it buys nothing); kept, with `_table_key`, `TableValueCache`'s widget
   use and `With_JSON_Cache`, on the three that do not read columns
   (`parse_type_selector`, `make_format_chooser_for_type`,
   `make_fill_nothing_default_widget` at `Table.enso:4103`) until PR 6 deletes
   them all, as the spec's PR table says.
10. **`type_names` in the GUI.** _Recommended: parsed and kept, not shown_ in PR
    5 (no visible change to the dropdowns); a later change can show a type
    beside each name. Alternative: a dimmed type suffix in each entry now.
11. **Kind filters beyond today's.** _Recommended: one-to-one_ — only the
    pickers that filter by type today get `kinds`: Geo's four `Float` pickers
    (`kinds=[Column_Kind.Numeric]`, which now also offers Integer columns), the
    `Char` fill pickers (`Textual`), and `filter`'s value pickers (from the
    column's type). Adding kinds to numeric- or date-only methods is a follow-up
    ticket.
12. **`Simple_Expression` (`set`, group C).** It keeps `default_widget` until PR
    6, but its body builds pickers through `make_column_ref_by_name_selector`,
    which this PR rewrites. _Recommended: included_ — `set` is the baseline's
    worst case (1.6 MB). Its references name the subject (`from` unset), which
    is right because `Simple_Expression.default_widget` is only called with the
    call's subject table (`@value Simple_Expression.default_widget` at
    `Table.enso:2717`).
13. **A picker whose source is absent** (join's `right` not set yet, YXDB's
    `table`). _Recommended:_ a `Column_Name` with no extras and no expression
    expands to `Text_Input` (today's join and YXDB behaviour); one with extras
    to a `Single_Choice` of the extras; `Column_Names` to a `Multiple_Choice` of
    its regex/by-type extras, or `Text_Input` with none; `Column_Vector` and
    `Order_By` to a `Vector_Editor` of `Text_Input` with item default `''`.
14. **The benchmark gate.** _Recommended:_ the size target (< 50 KB at 500
    columns) is asserted by a test for every baseline method on in-memory and
    SQLite; the time target (< 20 ms engine time) is measured with
    `Widget_Query_Report` before and after and reported in the PR body, not
    asserted (timing tests are flaky here). A method over 20 ms is listed with
    its cause; the owner decides whether it blocks (the composite resolvers move
    again in PR 6).

## Shared files (parallel with PRs 3b and 4)

| File                                                                   | 3b                                  | 4                                   | 5b                                                                | Avoiding conflicts                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts` | 3 kinds, `File_Browse.action`       | `Union` kind + transform            | 4 picker kinds; `columns` on the answer; `functionCallFromAnswer` | Each adds its own discriminated-union entries and TS interfaces; append yours after the last existing entry and rebase keeping all. `functionCallFromAnswer` is touched only by 5b. |
| `app/gui/integration-test/mock/lsHandler.ts`                           | `resolve_type` route, type defaults | Locale type default                 | column mock data (L371, L417) as references                       | Different regions of the file.                                                                                                                                                      |
| `app/gui/integration-test/project-view/widgets.spec.ts`                | new tests                           | `Kind picker` describe              | `Column pickers` describe                                         | Each adds its own `test.describe` at the end of the file.                                                                                                                           |
| `W/CLAUDE.md`, `CHANGELOG.md`                                          | sections / entry                    | sections / entry                    | section / entry                                                   | Separate sections; the changelog entries are adjacent lines — rebase keeps all.                                                                                                     |
| `columnPickers.ts` (5b) and `unionKinds.ts` (4)                        | —                                   | a `Union`'s kinds can hold a picker | recurses into `Union.kinds` **if** PR 4 is in                     | If 5b merges first, PR 4 adds the `Union` case to `expandColumnPickers` (one `case` and one test); if PR 4 merges first, 5b adds it. Whoever is second does it.                     |

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr5b`, branch
  `widgets/pr5b-column-pickers-gui`, from `origin/develop` after PR 5a merges.
  Linux clone `~/enso-widgets-pr5b` on WSL `Ubuntu-24.04` (source
  `~/.enso-toolchain.sh`), helper `~/pr5b.sh` (`~/pr1b.sh` from the PR 1b plan
  with `WIN=/mnt/c/Repos/Enso/ide-widgets-pr5b`, `LNX=$HOME/enso-widgets-pr5b`,
  `--exclude=.git`). Check `df -h ~` and `E:` first; delete worktree, clone and
  script when the PR merges.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree. `corepack pnpm`.
- **The expanded widgets equal today's.** For every migrated picker, the GUI's
  expansion of the reference is the configuration the old helper produced
  (labels, values — `n.pretty`, `(..Name 'n')`, `(expr '[first]')` — order and
  item defaults), except the deliberate kind changes of owner decision 11. Task
  2's tests pin this with the column names of `Table_Widgets_Spec`'s mock table
  (`A`, `B C`, `D "E"`, `F.G/H\I`).
- Every migrated method keeps its annotation (so the suggestion database still
  lists it and the GUI still queries it): `@columns (Widget.Column_Names …)`,
  never a deleted annotation.
- `sbt "all lintEnso"` green; API docs regenerated for every changed library;
  `stdlib-api-check`. Stdlib suites against a full distribution only; check the
  `N tests succeeded.` line.
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`: "Column
  pickers on wide tables are much faster: the column list is sent once per node
  rather than once per dropdown, and database tables and recomputed tables reuse
  it." (`[NNN]`: open as draft first.)
- **Screenshots** before/after on `pr-screenshots` under `pr-<NNN>/` (Linux
  Playwright mock): `select_columns`'s multi-picker, `sort`'s order-by list,
  `aggregate`'s nested column picker, `filter`'s value picker, `join`'s `on`
  with and without `right` — they should look identical.
- **Owner installer test before merge.**

## Migration map

Paths relative to `distribution/lib/Standard/`; line numbers on `origin/develop`
fdd873fe8b (re-find them after 5a). `WH` = `Widget_Helpers` (Table's
`Internal/Widget_Helpers.enso`).

| Today                                                                      | Becomes                                                                                                                            | Sites                                                                                                                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WH.make_column_name_selector`                                             | `(Widget.Column_Name)`                                                                                                             | `Table/…/Table.enso` 400, 447, 474, 2071, 2134, 2167, 2228, 3567, 3928; `XML/…/Table_Extensions.enso` 67                                                   |
| `… add_expression=True`                                                    | `(Widget.Column_Name expression=True)`                                                                                             | `Table.enso` 2354; `Table/…/Spatial_Table.enso` 85, 86, 423, 464, 482                                                                                      |
| `(self -> WH.make_column_name_selector self)` on `Row`                     | `(Widget.Column_Name)`                                                                                                             | `Table/…/Row.enso` 59, 74                                                                                                                                  |
| `WH.make_column_name_vector_selector`                                      | `(Widget.Column_Vector)`                                                                                                           | `Database/…/Extensions/Upload_Table.enso` 60, 128, 188; `XML/…/Table_Extensions.enso` 65, 66                                                               |
| `WH.make_column_name_multi_selector`                                       | `(Widget.Column_Names)`                                                                                                            | `Table.enso` 1351, 1536, 1570, 2527, 3137, 3926; `Spatial_Table.enso` 126, 166                                                                             |
| `… add_regex=True add_by_type=True`                                        | `(Widget.Column_Names regex=True by_type=True)`                                                                                    | `Table.enso` 662, 785, 1009, 1831, 1844, 1911, 1965, 2014, 2048, 2105, 2187, 2747, 3221, 3499, 3566, 3719, 3751, 3805, 3864, 3990                          |
| `… add_regex=True`                                                         | `(Widget.Column_Names regex=True)`                                                                                                 | `Table.enso` 1708, 1726, 3992                                                                                                                              |
| `WH.make_order_by_selector`                                                | `(Widget.Order_By)`                                                                                                                | `Table.enso` 1450, 1462, 2528, 3927, 3993; `Spatial_Table.enso` 127, 167                                                                                   |
| `WH.make_column_ref_by_name_selector_for_type value_type=Value_Type.Float` | `(Widget.Column_Name kinds=[Column_Kind.Numeric] reference=True expression=True extra=(make_any_selector add_number=True).values)` | `Geo/…/Table_Extensions.enso` 27-30                                                                                                                        |
| `WH.make_column_ref_by_name_selector add_…`                                | unchanged call; the helper now returns a `Column_Name` (Task 4)                                                                    | `Table.enso` 3806, 3807; `Generate_Rows_Range.enso` 70, 72; `Simple_Expression.enso` 89, 90, 113, 170, 171, 262, 344, 345, 402                             |
| YXDB `_column_widget` (reads `cache "table"`)                              | `@column (Widget.Column_Name from="table")`; `_column_widget` deleted                                                              | `YXDB/…/YXDB_Format.enso` 63, 163-167                                                                                                                      |
| composite helpers                                                          | rewritten inside (Task 4); call sites unchanged                                                                                    | aggregate 1352, 3568; grouping 2636; filter 2355 (+ `Simple_Expression.enso` 91); join 3025; rename 1204; fill `Column.enso` 1149, 1176, `Table.enso` 3752 |

`Database/DB_Table.enso:23` and `Internal/DB_Table_Implementation.enso:41`
import `Widget_Helpers` without using it: remove those imports. DuckDB,
Snowflake, Microsoft, Google, AWS and Tableau call no column helper (their
widgets list databases, schemas and tables, not columns): nothing to migrate;
DuckDB tables are `DB_Table`s and get `Widget_Columns` from 5a.

---

## Task 1: GUI schema — picker references and the answer's columns

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (TS union lines 93-107; `widgetConfigurationSchema` lines 203-231;
  `widgetQueryAnswerSchema` lines 257-260)
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/widgetQueryAnswer.test.ts`,
  `__tests__/configuration.test.ts`

**Interfaces:**

- Produces:

```ts
export type ColumnKind =
  | "Numeric"
  | "Textual"
  | "Logical"
  | "Date_Only"
  | "Date_And_Time"
  | "Time_Only"
  | "Other";
export interface WidgetColumns {
  names: string[];
  kinds: ColumnKind[];
  type_names: string[];
}
export interface ColumnNamePicker {
  kind: "Column_Name";
  kinds: ColumnKind[];
  from: string | null;
  expression: boolean;
  reference: boolean;
  extra: Choice[];
  columns_first: boolean;
}
export interface ColumnNamesPicker {
  kind: "Column_Names";
  kinds: ColumnKind[];
  from: string | null;
  regex: boolean;
  by_type: boolean;
}
export interface ColumnVectorPicker {
  kind: "Column_Vector";
  kinds: ColumnKind[];
  from: string | null;
}
export interface OrderByPicker {
  kind: "Order_By";
  from: string | null;
  name_only: boolean;
}
export type ColumnPicker =
  ColumnNamePicker | ColumnNamesPicker | ColumnVectorPicker | OrderByPicker;
// WidgetConfiguration gains `| ColumnPicker`; WidgetQueryAnswer gains `columns?: Record<string, WidgetColumns>`.
```

- [ ] **Step 1: Failing tests** (`widgetQueryAnswer.test.ts`):

```ts
test("an answer with pickers and its columns", () => {
  const answer = widgetQueryAnswerSchema.parse({
    arguments: [
      [
        "columns",
        {
          widget: {
            type: "Widget",
            constructor: "Column_Names",
            kinds: [],
            from: null,
            regex: true,
            by_type: false,
          },
        },
      ],
      [
        "on",
        {
          widget: {
            constructor: "Column_Name",
            kinds: ["Numeric"],
            from: "right",
            expression: false,
            reference: false,
            extra: [],
            columns_first: false,
          },
        },
      ],
    ],
    columns: { "": { names: ["A"], kinds: ["Textual"], type_names: ["Char"] } },
  });
  expect(answer.columns?.[""]?.names).toEqual(["A"]);
  expect(answer.arguments[0]![1]).toEqual({
    widget: {
      kind: "Column_Names",
      kinds: [],
      from: null,
      regex: true,
      by_type: false,
    },
  });
});

test("an answer without columns still parses", () => {
  expect(
    widgetQueryAnswerSchema.parse({ arguments: [] }).columns,
  ).toBeUndefined();
});

test("an unknown column kind is a schema mismatch", () => {
  expect(
    widgetQueryAnswerSchema.safeParse({
      arguments: [],
      columns: { "": { names: ["A"], kinds: ["Weird"], type_names: [""] } },
    }).success,
  ).toBe(false);
});
```

(Use `toMatchObject` if `withKindSchema` keeps `type`/`constructor` keys, as the
neighbouring tests do.)

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/widgetQueryAnswer.test.ts
```

- [ ] **Step 3: Implement**: `columnKindSchema = z.enum([...])`,
      `widgetColumnsSchema`, four `z.object` entries in the discriminated union
      (`extra: z.array(choiceSchema)`, `from: z.string().nullable()`), and
      `columns: z.record(z.string(), widgetColumnsSchema).optional()` on the
      answer. Update the answer's doc comment (it already anticipates "a column
      list sent once, PR 5").

- [ ] **Step 4: Run, verify they pass** (the whole `widgetRegistry` folder).

- [ ] **Step 5: Commit**
      `GUI: parse column picker references and the answer's column lists`
      (trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` on
      every commit).

## Task 2: `columnPickers.ts` — expanding references, memoised on the schema

**Files:**

- Create: `app/gui/src/providers/openedProjects/widgetRegistry/columnPickers.ts`
- Test:
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/columnPickers.test.ts`

**Interfaces:**

- Consumes: Task 1's types; `Choice`, `WidgetConfiguration`.
- Produces:

```ts
/** Enso's `Text.pretty` of a name: a single-quoted text literal with `\` and `'` escaped. */
export function prettyText(name: string): string;

/** The configuration a picker stands for, given its source's columns (`undefined`: the source is absent). */
export function expandPicker(
  picker: ColumnPicker,
  columns: WidgetColumns | undefined,
): WidgetConfiguration;

/**
 * `config` with every picker reference, at any depth, replaced by its expansion. Memoised per
 * (source schema, picker); `cache` is per opened project.
 */
export function expandColumnPickers(
  config: WidgetConfiguration,
  columns: Readonly<Record<string, WidgetColumns>> | undefined,
  cache?: SchemaCache,
): WidgetConfiguration;

export class SchemaCache {
  constructor(maxSchemas?: number); // default 64, least recently used dropped
  get(
    schemaKey: string,
    pickerKey: string,
    compute: () => WidgetConfiguration,
  ): WidgetConfiguration;
}
```

Expansion rules (each mirrors the helper it replaces in
`Table/…/Internal/Widget_Helpers.enso`; `names` below are the source's names
filtered by `kinds` with owner decision 3's rule — empty `kinds`, a listed kind,
or `Other`; `first` is the source's **unfiltered** first name, as
`table.column_names.first` is today):

| Picker                         | Expansion                                                                                                                                                                                                                                                                     | Today                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Column_Name`                  | `Single_Choice`: `extra`, then `<Expression>` → `(expr '[first]')` if `expression`, then one option per name (label the name; value `prettyText(n)`, or `(..Name ${prettyText(n)})` if `reference`); with `columns_first`, the names first, then `extra`, then the expression | `make_column_name_selector` L90-95, `make_column_ref_by_name_selector` L121-127, `…_for_type` L133-154 |
| `Column_Names`                 | `Multiple_Choice`: `<Regular Expression>` → `regex` if `regex`, `<By Type>` → `(..By_Type ..Integer)` if `by_type`, then names (value `prettyText(n)`)                                                                                                                        | `make_column_name_multi_selector` L110-115                                                             |
| `Column_Vector`                | `Vector_Editor` of the `Column_Name` expansion (no flags), `item_default` = the first offered name's `prettyText`                                                                                                                                                             | `make_column_name_vector_selector` L101-103                                                            |
| `Order_By` (`name_only` false) | `Vector_Editor` of `Single_Choice` [`Name` → `..Name` with parameter `name` = `Column_Name` expansion, `Index` → `..Index` with parameter `index` = `Numeric_Input` min 0 max count−1], `item_default` `(..Name ${prettyText(first)})`                                        | `make_order_by_selector` L270-277                                                                      |
| `Order_By` (`name_only`)       | `Vector_Editor` of `Single_Choice` of `(..Name ${prettyText(n)})` per name, same `item_default`                                                                                                                                                                               | idem, `name_only=True`                                                                                 |
| absent source                  | owner decision 13                                                                                                                                                                                                                                                             | join L238, YXDB L165                                                                                   |

- [ ] **Step 1: Failing tests** (`columnPickers.test.ts`):

```ts
import { expect, test } from "vitest";
import {
  expandColumnPickers,
  expandPicker,
  prettyText,
  SchemaCache,
} from "../columnPickers";

const cols = {
  names: ["A", "B C", 'D "E"', "F.G/H\\I"],
  kinds: ["Numeric", "Textual", "Other", "Date_Only"],
  type_names: ["Integer", "Char", "Mixed", "Date"],
} as const;
const opt = (label: string, value: string, parameters: unknown[] = []) => ({
  label,
  value,
  parameters,
});
const base = { kinds: [], from: null } as const;
const name = {
  kind: "Column_Name",
  ...base,
  expression: false,
  reference: false,
  extra: [],
  columns_first: false,
} as const;

test("prettyText matches Enso's Text.pretty", () => {
  expect(prettyText("A")).toBe("'A'");
  expect(prettyText('D "E"')).toBe("'D \"E\"'");
  expect(prettyText("F.G/H\\I")).toBe("'F.G/H\\\\I'");
  expect(prettyText("it's")).toBe("'it\\'s'");
});

test("Column_Name: one option per column, values pretty", () => {
  expect(expandPicker(name, cols)).toEqual({
    kind: "Single_Choice",
    values: [
      opt("A", "'A'"),
      opt("B C", "'B C'"),
      opt('D "E"', "'D \"E\"'"),
      opt("F.G/H\\I", "'F.G/H\\\\I'"),
    ],
  });
});

test("Column_Name with an expression option first (filter's column)", () => {
  const result = expandPicker({ ...name, expression: true }, cols);
  expect(result.kind === "Single_Choice" && result.values[0]).toEqual(
    opt("<Expression>", "(expr '[A]')"),
  );
});

test("kinds filter, Other always offered", () => {
  const result = expandPicker({ ...name, kinds: ["Numeric"] }, cols);
  expect(
    result.kind === "Single_Choice" && result.values.map((v) => v.label),
  ).toEqual(["A", 'D "E"']);
});

test("reference wraps values as ..Name, extras first unless columns_first", () => {
  const extra = [opt("<Text Value>", "''")];
  const ref = expandPicker(
    { ...name, reference: true, extra },
    { ...cols, names: ["A"], kinds: ["Numeric"], type_names: [""] },
  );
  expect(ref).toEqual({
    kind: "Single_Choice",
    values: [opt("<Text Value>", "''"), opt("A", "(..Name 'A')")],
  });
  const first = expandPicker(
    { ...name, reference: true, extra, columns_first: true },
    { names: ["A"], kinds: ["Numeric"], type_names: [""] },
  );
  expect(
    first.kind === "Single_Choice" && first.values.map((v) => v.label),
  ).toEqual(["A", "<Text Value>"]);
});

test("Column_Names with regex and by-type options", () => {
  expect(
    expandPicker(
      { kind: "Column_Names", ...base, regex: true, by_type: true },
      { names: ["A"], kinds: ["Numeric"], type_names: [""] },
    ),
  ).toEqual({
    kind: "Multiple_Choice",
    values: [
      opt("<Regular Expression>", "regex"),
      opt("<By Type>", "(..By_Type ..Integer)"),
      opt("A", "'A'"),
    ],
  });
});

test("Column_Vector and Order_By", () => {
  const two = {
    names: ["A", "B"],
    kinds: ["Numeric", "Numeric"],
    type_names: ["", ""],
  } as const;
  expect(expandPicker({ kind: "Column_Vector", ...base }, two)).toMatchObject({
    kind: "Vector_Editor",
    item_default: "'A'",
    item_editor: { kind: "Single_Choice" },
  });
  expect(
    expandPicker({ kind: "Order_By", from: null, name_only: false }, two),
  ).toEqual({
    kind: "Vector_Editor",
    item_default: "(..Name 'A')",
    item_editor: {
      kind: "Single_Choice",
      values: [
        opt("Name", "..Name", [
          [
            "name",
            {
              kind: "Single_Choice",
              values: [opt("A", "'A'"), opt("B", "'B'")],
            },
          ],
        ]),
        opt("Index", "..Index", [
          ["index", { kind: "Numeric_Input", minimum: 0, maximum: 1 }],
        ]),
      ],
    },
  });
});

test("an absent source (owner decision 13)", () => {
  expect(expandPicker(name, undefined)).toEqual({ kind: "Text_Input" });
  expect(expandPicker({ ...name, extra: [opt("x", "1")] }, undefined)).toEqual({
    kind: "Single_Choice",
    values: [opt("x", "1")],
  });
  expect(
    expandPicker({ kind: "Order_By", from: null, name_only: false }, undefined),
  ).toEqual({
    kind: "Vector_Editor",
    item_editor: { kind: "Text_Input" },
    item_default: "''",
  });
});

test("references at any depth, each from its own source", () => {
  const join = {
    kind: "Vector_Editor",
    item_default: "_",
    item_editor: {
      kind: "Single_Choice",
      values: [
        opt("Equals", "..Equals", [
          ["left", name],
          ["right", { ...name, from: "right" }],
        ]),
      ],
    },
  } as const;
  const right = { names: ["X"], kinds: ["Numeric"], type_names: [""] } as const;
  const expanded = expandColumnPickers(join as never, { "": cols, right });
  const params = (expanded as any).item_editor.values[0].parameters;
  expect(params[0][1].values).toHaveLength(4);
  expect(params[1][1]).toEqual({
    kind: "Single_Choice",
    values: [opt("X", "'X'")],
  });
});

test("the same schema hits the cache; a different one does not", () => {
  const cache = new SchemaCache();
  let computed = 0;
  const compute = () => (computed++, { kind: "Text_Input" }) as const;
  cache.get("s1", "p", compute);
  cache.get("s1", "p", compute);
  cache.get("s2", "p", compute);
  expect(computed).toBe(2);
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/columnPickers.test.ts
```

- [ ] **Step 3: Implement** per the table. `expandColumnPickers` recurses
      through `Single_Choice`/`Multiple_Choice` values (a choice's `parameters`
      and a nested `value` array), `Vector_Editor.item_editor`, and `Union`
      kinds if PR 4 is merged (Shared files). It returns the same object when
      nothing changed (so Vue sees no new configuration). The schema key is
      `JSON.stringify` of the source's `{names, kinds}` (type names do not
      change an expansion), the picker key `JSON.stringify(picker)`. Check
      `prettyText` against Enso by running `IO.println 'F.G/H\I'.pretty` once in
      the Linux clone, and note the output in a comment.

- [ ] **Step 4: Run, verify they pass.**

- [ ] **Step 5: Commit**
      `GUI: expand column picker references, memoised on the schema`.

## Task 3: The answer's pickers are expanded where it is read

**Files:**

- Modify: `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (`functionCallFromAnswer`, lines 263-275)
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`
  (`widgetConfiguration`, lines 200-212: pass the project's `SchemaCache`)
- Modify: the provider where 3b put `TypeDefaults` (it lives exactly as long as
  the opened project) — create the `SchemaCache` there too; if 3b has not
  merged, `src/providers/openedProjects/project/project.ts` next to
  `widgetRegistry`.
- Test: `__tests__/widgetQueryAnswer.test.ts`,
  `W/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`

**Interfaces:**

- Produces:
  `functionCallFromAnswer(answer, inherited?, cache?: SchemaCache): FunctionCall`
  — every argument's widget passed through
  `expandColumnPickers(widget, answer.columns, cache)`.

- [ ] **Step 1: Failing tests.** `widgetQueryAnswer.test.ts`: an answer whose
      `select_columns` argument is a `Column_Names` reference with `columns`
      gives `parameters.get('columns')` of kind `Multiple_Choice` with the
      names. `widgetFunctionCallInfo.test.ts`: feed
      `data.value = Ok({ arguments: [['arg', { widget: { constructor: 'Column_Name', kinds: [], from: null, expression: false, reference: false, extra: [], columns_first: false } }]], columns: { '': { names: ['A'], kinds: ['Textual'], type_names: ['Char'] } } })`
      (the helper `setUpCallInfo` at the top of the file) and expect the
      argument's configuration to be `Single_Choice` with one option `'A'`.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** (inherited configurations — a choice's parameters —
      are already expanded, since they come from an expanded parent).
- [ ] **Step 4: Run** the `widgetRegistry` and `WidgetFunction` folders and
      typecheck (`corepack pnpm --filter enso-gui run typecheck`).
- [ ] **Step 5: Commit** `GUI: widget answers expand their column pickers`.

## Task 4: Table's builders emit references

**Files:**

- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Internal/Widget_Helpers.enso`
  (whole file; line numbers in the research above)
- Modify:
  `distribution/lib/Standard/Table/0.0.0-dev/src/Simple_Expression.enso`,
  `Generate_Rows_Range.enso` only if a call needs a new argument (they should
  not: they call `make_column_ref_by_name_selector`, whose signature stays)
- Test: `test/Table_Tests/src/Internal/Widget_Helpers_Spec.enso`,
  `test/Table_Tests/src/In_Memory/Table_Widgets_Spec.enso`,
  `test/SQLite_Tests/src/Widgets_Spec.enso`

**Interfaces:**

- Consumes: PR 5a's `Widget.Column_Name …`, `Column_Kind`,
  `Column_Kinds.of_value_type`.
- Produces: the same helper names and signatures (call sites unchanged), now:

| Helper                                             | Returns                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make_column_name_selector t add_expression`       | `Widget.Column_Name expression=add_expression`                                                                                                                                                                                                                         |
| `make_column_name_vector_selector t`               | `Widget.Column_Vector`                                                                                                                                                                                                                                                 |
| `make_column_name_multi_selector t r b`            | `Widget.Column_Names regex=r by_type=b`                                                                                                                                                                                                                                |
| `make_order_by_selector t name_only`               | `Widget.Order_By name_only=name_only`                                                                                                                                                                                                                                  |
| `make_column_ref_by_name_selector t …`             | `t` Nothing → `Single_Choice` of the constants (as today); else `Widget.Column_Name reference=True expression=True extra=constants columns_first=columns_first`                                                                                                        |
| `make_column_ref_by_name_selector_for_type t vt …` | as above with `kinds=(_kinds_for vt include_all_numeric)` (`[]` for Mixed/unsupported; numeric types → `[Numeric]`; text → `[Textual]`, …)                                                                                                                             |
| `make_fill_default_value_selector src …`           | unchanged shape; `src` a table → its `Column_Name` reference with the kinds of `value_types`; the `Table.enso:3752` call passes `self` with `value_types=Value_Type.Char` instead of `self.select_columns (..By_Type ..Char)` (the kind does the selecting)            |
| aggregate, grouping, filter, join, rename          | same structure; every nested `make_column_name_selector table` / multi / order-by call becomes the reference; join's right selector `Widget.Column_Name from="right"`; rename's names list `Widget.Column_Name extra=[Option "<Regular Expression>" "(regex '^.*$')"]` |

`_with_table_cache` is removed from all of these (owner decision 9); it stays on
`parse_type_selector`, `make_format_chooser_for_type` and
`make_fill_nothing_default_widget`.

- [ ] **Step 1: Rewrite the tests first.** `Widget_Helpers_Spec.enso` compares
      `w.to_text`; change each expectation to the reference (e.g.
      `make_column_name_multi_selector t add_regex=True . should_equal (Widget.Column_Names regex=True)`).
      `Table_Widgets_Spec.enso` "works for `get` and `at`" expects
      `answer "selector" Widget.Column_Name` **plus** the `columns` block:
      change its `answer` helper to take an optional columns JSON and build the
      expectation from `Widget_Columns.from mock_table . to_json`. The `join`
      test (lines 40-71, which unwraps `With_JSON_Cache`) now expects no
      `With_JSON_Cache` and a `Column_Name from="right"` in the `right`
      parameter. Same for `SQLite_Tests/src/Widgets_Spec.enso`'s column-name
      groups.
- [ ] **Step 2: Run, verify they fail** (`Table_Tests "Widget"`,
      `SQLite_Tests "Widget"`).
- [ ] **Step 3: Implement** per the table. Keep reading
      `table.column_names.first` where an item default needs it (join's
      `(..Equals 'A')`, rename's first unused name) — one name, not a list.
- [ ] **Step 4: Run** `Table_Tests`, `SQLite_Tests` in full; lint.
- [ ] **Step 5: Commit** `Table: widget builders emit column picker references`.

## Task 5: Annotations migrate (Table, Database, Geo, XML, YXDB)

**Files:** every site in the Migration map; tests
`test/Geo_Tests/src/Geo_Widgets_Spec.enso`, `test/XML_Tests` (its widget checks,
if any), `test/YXDB_Tests`, `test/Table_Tests/src/Widgets_Spec.enso`.

- [ ] **Step 1: Script** (scratchpad, Node, not committed): for each row of the
      Migration map, replace the annotation's expression exactly
      (`@columns (Widget_Helpers.make_column_name_multi_selector add_regex=True add_by_type=True)`
      → `@columns (Widget.Column_Names regex=True by_type=True)`, and the
      `(self -> …)` / bare-function forms), add
      `import Standard.Base.Metadata.Widget` and, where kinds are used,
      `import Standard.Base.Metadata.Column_Kind.Column_Kind`; remove
      `Widget_Helpers` imports left unused. It prints the sites it did not
      recognise; there must be none outside the "unchanged call" and composite
      rows.
- [ ] **Step 2: YXDB** by hand: `@column (Widget.Column_Name from="table")`,
      delete `_column_widget` (lines 163-167) and its imports.
- [ ] **Step 3: A test per library** that the migrated annotation resolves with
      its columns. Geo (`Geo_Widgets_Spec.enso`):

```enso
        group_builder.specify "geo_distance's latitude offers numeric columns by reference" <|
            t = Table.new [["lat", [1.5]], ["name", ["a"]], ["n", [1]]]
            json = Widget_Query.resolve_call t "Standard.Geo.Table_Extensions" "Standard.Table.Table.Table" "geo_distance" ["lat1"] . parse_json
            widget = json.get "arguments" . first . second . get "widget"
            widget.get "constructor" . should_equal "Column_Name"
            widget.get "kinds" . should_equal ["Numeric"]
            widget.get "reference" . should_be_true
            json.get "columns" . get "" . get "names" . should_equal ["lat", "name", "n"]
```

      The same shape for XML (`Table.to_xml` `element_columns` → `Column_Vector`),
      Database (`Table.update_rows`-style `key_columns` → `Column_Vector`, in
      `SQLite_Tests`), YXDB (`column` → `Column_Name from="table"`, `columns`
      absent when `table` is not given), and `Row` (`Row.get`'s `column` →
      `Column_Name`, `columns` from the row).

- [ ] **Step 4: Run** `Table_Tests`, `SQLite_Tests`, `Geo_Tests`, `XML_Tests`,
      `YXDB_Tests`, `Format_Discovery_Tests`, `Visualization_Tests` in full;
      `sbt "all lintEnso"`; regenerate API docs (Table, Database, Geo, XML,
      YXDB) and `stdlib-api-check`.
- [ ] **Step 5: Commit** `Standard libraries: column pickers are declarative`.

## Task 5b: Kind filters on type-restricted column arguments (owner decision 11)

The owner chose to add `kinds` beyond today's one-to-one set: a column picker
offers only the columns its method can accept.

**The rule (objective, so the inventory is checkable):** a column argument gets
`kinds` when the method, given a column of any other kind, fails with
`Invalid_Value_Type` (or an equivalent type error) before doing any work, that
is, its implementation checks the type (`check_value_type`,
`Value_Type_Helpers.*`, an `is_numeric` / `is_text` guard, a
`case value_type of` with an error branch, or a backend's
`Unsupported_Database_Operation` for the type). A method that merely returns
`Nothing` or a warning for other kinds is **not** restricted. Columns of kind
`Other` are still offered everywhere (decision 3).

**Files:** Table, Database, DuckDB and Geo sources found by the inventory;
`Widget_Helpers.enso` only if a builder needs a `kinds` argument; the libraries'
widget specs; a GUI unit test beside `columnPickers.ts`.

- [ ] **Step 1: Inventory** (a sonnet subagent, read-only): every column
      argument with a picker after Task 5 (`Column_Name` / `Column_Names` /
      `Column_Vector` / `Order_By`, top-level or nested in a choice such as
      aggregate's `..Sum` / `..Average` / `..Median` / `..Percentile` /
      `..Standard_Deviation`, `..Shortest` / `..Longest`, `..Concatenate`), and
      for each the kinds its implementation accepts, with the `file:line` of the
      check that proves it. Write the table to the ledger. Arguments that accept
      every kind are listed too (one line each), so the review can see nothing
      was skipped.
- [ ] **Step 2: Tests first.** One `Widget_Query.resolve_call` assertion per
      changed argument family (e.g. aggregate `..Sum`'s `column` gives
      `kinds == ["Numeric"]`; a text-only method `["Textual"]`; a date method
      the date and time kinds) in `Table_Widgets_Spec.enso` and the SQLite
      widgets spec; plus a GUI unit test that a `kinds=[Numeric]` picker over a
      `Textual` / `Numeric` / `Other` schema lists only the numeric and `Other`
      columns.
- [ ] **Step 3: Run, verify they fail.**
- [ ] **Step 4: Implement:** add `kinds=[…]` to each reference found. Where the
      kind is decided by another argument (e.g. `filter`'s value picker from the
      column's type), keep today's mechanism.
- [ ] **Step 5: Run** `Table_Tests`, `SQLite_Tests`, `Geo_Tests` in full; lint;
      regenerate API docs; `stdlib-api-check`.
- [ ] **Step 6: Commit**
      `Standard libraries: column pickers filter by the kinds a method accepts`.
      List every argument that gained `kinds` in the PR body, and add an
      installer-checklist line: "aggregate `..Sum` on a table with text and
      number columns offers only the number columns (and Mixed ones)".

## Task 6: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/lsHandler.ts` (the `'Column A'` /
  `'Column B'` mock answers at ~L371 and ~L417 → references plus a `columns`
  block; `asWidgetAnswer` (L834-839) passes an object answer through, so give
  the new shape directly)
- Modify/Test: `app/gui/integration-test/project-view/widgets.spec.ts` — the
  existing "Multi-selection widget" describe (L123-255) must pass **unchanged**
  against the reference-shaped mock; a new `test.describe('Column pickers', …)`
  at the end of the file.

- [ ] **Step 1: Mock** the `select_columns` answer as
      `{ arguments: [['columns', { widget: { type: 'Widget', constructor: 'Column_Names', kinds: [], from: null, regex: false, by_type: false } }]], columns: { '': { names: ['Column A', 'Column B'], kinds: ['Textual', 'Textual'], type_names: ['Char', 'Char'] } } }`,
      and likewise the aggregate (`Group_By` `column`, L551-615) mock.
- [ ] **Step 2: New tests:** "a nested column picker inside an aggregate choice
      expands" (choose `..Sum`, its `column` dropdown lists the mock columns);
      "join's right columns appear once right is set"
      (`localApi.updateVisualization` with a second answer that adds
      `columns.right`); "a column picker with no source is a text input".
- [ ] **Step 3: Run** in the Linux clone, three times, `--workers=2`
      (`widgets.spec.ts`, `tableVisualisation.spec.ts`,
      `dataReadImports.spec.ts`); compare any failure with develop run the same
      way.
- [ ] **Step 4: Commit** `Playwright: column pickers from references`.

## Task 7: The benchmark against the §6 targets

**Files:**

- Modify: `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso` (`queries` at
  line 29; `backends` at ~line 52)
- Create: `test/Table_Tests/src/In_Memory/Widget_Size_Spec.enso` (+ register in
  `test/Table_Tests/src/Main.enso`)
- Create: the same group in `test/SQLite_Tests/src/Widgets_Spec.enso`

- [ ] **Step 1: Record the "before".** On `origin/develop` (the 5a merge
      commit), build the distribution and run the report in the Linux clone:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr5b.sh dist && cd ~/enso-widgets-pr5b/test && ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/Benchmarks/src/Widgets/Widget_Query_Report.enso" | tee ~/pr5b-before.tsv'
```

      (Check out the 5a merge commit in a second clone, or run before Task 4 is
      synced; keep the TSV.)

- [ ] **Step 2: Extend the benchmark.** `queries` gains `["sort", ["columns"]]`,
      `["get", ["selector"]]`, `["cross_tab", ["group_by", "names", "values"]]`
      (the baseline's rows); a fourth backend `In_Memory_Recomputed` whose table
      is `memory.set (memory.at "c0" + 1) as="c0"` (same schema, new version
      hash). Run it once to see every row is not `ERROR`.
- [ ] **Step 3: Failing size test** (`Widget_Size_Spec.enso`):

```enso
from Standard.Base import all
import Standard.Base.Metadata.Widget_Query
from Standard.Table import Table
from Standard.Test import all

## `make_table` is copied from `test/Benchmarks/src/Widgets/Widget_Query_Bench.enso`
   (a test project cannot import the Benchmarks project).

add_specs suite_builder =
    suite_builder.group "Widget answers for 500 columns stay under 50 KB" group_builder->
        table = make_table 500
        [["select_columns", ["columns"]], ["sort", ["columns"]], ["get", ["selector"]], ["filter", ["column", "filter"]], ["set", ["value"]], ["aggregate", ["group_by", "columns"]], ["cross_tab", ["group_by", "names", "values"]], ["join", ["on", "join_kind"]]].each query->
            group_builder.specify query.first <|
                answer = Widget_Query.resolve_call table "Standard.Table.Table" "Standard.Table.Table.Table" query.first query.second
                answer.should_not_contain '"error"'
                (answer.length < 50*1024) . should_be_true
```

      Run it on the branch **before** Task 4 is applied (or on develop) to see
      `filter`, `set`, `aggregate`, `cross_tab`, `join` fail; then on the branch
      to see all pass. The SQLite group is the same over
      `select_into_database_table`.

- [ ] **Step 4: Record the "after"** (`~/pr5b-after.tsv`, same command) and put
      both tables in the PR body: per backend and method, cold/warm ms and KB,
      before → after, with the 20 ms / 50 KB targets marked. Any row over 20 ms
      warm: name its cause (profile with the performance-timings setting or
      `Progress` logs) — owner decision 14.
- [ ] **Step 5: Commit**
      `Widget benchmark: the baseline's methods, a recomputed table, and a size test`.

## Task 8: Docs, screenshots, changelog, PR, installer

- [ ] **Step 1: Docs.** Widgets `CLAUDE.md`: "Column pickers" — references,
      `columnPickers.ts`, the schema cache, the absent-source rule; how to add a
      picker flag (Enso constructor + `to_json` + zod + expansion + test). Table
      `CLAUDE.md`: annotate with `Widget.Column_Name …`, never copy column names
      into a widget; composite builders nest references.
- [ ] **Step 2: Screenshots** (Global Constraints) before/after.
- [ ] **Step 3: Changelog** entry; PR as draft for its number.
- [ ] **Step 4: Full verification**:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr5b.sh pnpm_ready && cd ~/enso-widgets-pr5b && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && find . -name ".eslintcache" -not -path "*/node_modules/*" -delete && corepack pnpm --filter enso-gui run typecheck && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run test:unit'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr5b.sh dist && for s in Base_Tests Table_Tests SQLite_Tests Geo_Tests XML_Tests YXDB_Tests Format_Discovery_Tests Visualization_Tests Examples_Tests; do echo "== $s"; ~/pr5b.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done; ~/pr5b.sh sbt_run "all lintEnso"; cd ~/enso-widgets-pr5b && corepack pnpm --filter build-scripts run stdlib-api-check'
```

- [ ] **Step 5: PR body**: the before/after benchmark tables; the migration
      counts; owner decisions taken; screenshots; follow-up tickets (kinds on
      more methods; showing type names). Mark ready.
- [ ] **Step 6: CI green; Windows installer** to
      `C:\Users\jdunk\Downloads\enso-pr<NNN>\`. Installer checklist: on a wide
      table (e.g. 300 columns from a CSV), `select_columns`, `sort`, `filter`
      (column and value), `aggregate` (a nested column), `join` (before and
      after setting `right`), `set`, a database table (SQLite or DuckDB)
      `filter` and `select_columns`, Geo `geo_distance`, and that recomputing
      the table (editing an upstream node) does not empty a dropdown.
- [ ] **Step 7: On the owner's OK, merge** (`gh pr merge --squash`, no
      `--delete-branch`); remove worktree, branch, clone, `~/pr5b.sh`,
      `~/pr5b-*.tsv`, installer folder.
