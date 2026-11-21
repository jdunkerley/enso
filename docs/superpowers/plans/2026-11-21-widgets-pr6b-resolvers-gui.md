# Widgets PR 6b: Resolvers in the GUI — Re-query on Dependencies, Fallbacks, Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GUI asks the engine for a node's widgets again only when something
the widgets declared they depend on changes: the call's subject, a named
argument a resolver reads, or the text typed in a searchable argument. A method
whose widgets are all static is asked once per session. When a dependency is an
error, the argument falls back to its type default with a note ("choices
unavailable: right has an error"). When a resolver is slower than 2 s, the
argument shows its fallback with a loading marker until the answer arrives.
Database table-name pickers search as you type (debounced 250 ms, latest wins);
every other dropdown keeps filtering locally. Group C arguments whose type is
exactly the group C type lose their annotation and take the resolver type
default.

**Architecture:** PR 6a's answer tells the GUI, per argument,
`resolver: {dependencies, searchable}` and `unavailable`; `resolve_call` takes
`search`, `type_defaults` and `revision`, and echoes `search` and `revision`. A
pure module, `widgetQueryPlan.ts`, turns the latest answer and the call's
argument expression ids into what the next query sends: the ids of the declared
dependencies only, a `revision` stamp built from those dependencies' computed
values, and whether the answer is static (no `resolver` anywhere, no `columns`).
Static answers go into a per-project `StaticAnswerCache` keyed by the method and
argument names, and the node's query is detached while the cache answers. A
second, per-argument search query (`useWidgetSearch`) runs only for a searchable
argument with text typed in its dropdown. `functionCallFromAnswer` also returns
per-argument notes (`unavailable`, `loading`), which a new marker widget,
`WidgetQueryNote.vue`, draws beside the fallback the call tree already falls to
(a `null` widget means "use the type default").

**Tech Stack:** TypeScript + Vue 3 + zod (GUI), vitest, Playwright; Enso (Table,
Google, DuckDB annotations only).

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md (§3
"It re-runs exactly when…", "A dependency that is an error…", "`search`"; §6
levels table, "Argument values", "Time limits"; Testing: Playwright "`join`'s
`on` updating when `right` changes; search-as-you-type; a failing resolver
showing its error with a usable fallback and one Logs-panel entry"; PR table row
6, split by owner decision 1).

**Depends on:** PR 6a
(`docs/superpowers/plans/2026-11-21-widgets-pr6a-resolvers.md`) merged. **Start
after 6a merges**, from `origin/develop` at or after its merge commit. 6a is
backward compatible with today's GUI (6a's "The 6a / 6b question"), so nothing
here is urgent after 6a.

## Owner decisions

**Decided 2026-11-21 (owner)**, shared with PR 6a (same numbers; the full text
is in the 6a plan):

1. **Split:** 6a engine and libraries; **6b GUI**: re-query only when a declared
   dependency or `search` changes; a dependency that is an error falls back to
   the type default with a note; the 2 s time-box with a loading marker; the
   `search` box. _6a is backward compatible, so the two merge independently_
   (recommended in 6a; the owner confirms there).
2. **`search`:** one real user, the database table-name pickers (DuckDB first;
   through the shared Database helpers every JDBC connection and Redshift get
   it, 6a decision E). Debounce 250 ms, latest wins. A resolver without `search`
   returns its full list and the GUI filters locally.
3. **Slow resolvers:** time-boxed at 2 s: then the fallback (the type default)
   with a loading marker; the result replaces it when it arrives; the run is not
   cancelled. (Over 10 s is logged at Warning by the engine, 6a.)
4. **The resolver rule** is enforced in the standard library build (6a). In the
   GUI, a violation is an ordinary widget error (`step: "resolver"`), drawn by
   `WidgetQueryError` as today.

**Further decisions (owner), decided 2026-11-21: every recommendation below is
taken** (6a's A–E are about the engine; these continue the letters):

- **F. Static answers.** The spec's levels table caches a static annotation
  "once per method". _Recommended:_ an answer is static when no argument has
  `resolver` and it has no `columns`; the GUI keeps it per (method, argument
  names) for the session in an LRU of 256 per opened project and detaches the
  node's query while the cache holds it. Dropped when the method's module or a
  library reloads, exactly when `TypeDefaults` drops its entries (the same
  hook). Alternative: keep each node's query attached and only skip parsing
  (saves no engine time).
- **G. What shows during a re-query.** _Recommended:_ the previous answer's
  widget stays for up to 2 s; then, if the answer has not arrived, the type
  default with the loading marker. The first query of a node shows `Pending` for
  2 s, as today, then the same. Alternative: the fallback at once on every
  re-query (flickers on each edit of `right`).
- **H. Where the typed text comes from.** _Recommended:_ the text being edited
  in the argument's dropdown (`WidgetSelection`'s `editedValue`, which already
  drives the local filter), so "the search box" is the field users already type
  into; no new input element. Alternative: a dedicated search field at the top
  of a searchable dropdown.

## Interfaces assumed from earlier PRs

| From                   | Interface                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PR 1b (merged)         | `widgetQuery.ts`: `resolveCallArguments(target, argumentNames, uuids, subjectIsType)`, `widgetQueryConfiguration(…)`; `widgetFunctionCallInfo.ts` (`visualizationConfig`, `parsedAnswer`, `widgetConfiguration`); `functionCallFromAnswer(answer, inherited)` → `FunctionCall` with `errors`; `WidgetQueryError.vue` (priority 2) and `WidgetQueryErrorKey` (`callTree.ts:704`); `reportWidgetTiming`. |
| PR 3b (merged)         | `TypeDefaults` (`typeDefaults.ts`: `lookup(reprType, frame)`, its `answerSchema`, `dispose`, created in `projectStates.ts:209`); the call tree's `typeDefault` fallback: `dynamicConfig(name) = widgetCfg?.parameters.get(name) ?? typeDefault(reprType)` — so a `null` widget already shows the type default.                                                                                         |
| PR 5b plan, Tasks 1–3  | `widgetQueryAnswerSchema` with `columns`; `functionCallFromAnswer(answer, inherited?, cache?: SchemaCache)`; `SchemaCache` created beside `TypeDefaults`.                                                                                                                                                                                                                                              |
| PR 4 plan, Tasks 4–5   | (if merged) `TypeDefaults` also composes unions; nothing here changes that. A union whose member's default is a resolver is not composed (it has no static widget): the kind is offered without a widget, as a member without a default is.                                                                                                                                                            |
| PR 6a plan, "The JSON" | Per argument `{"widget"…}`, `,"resolver":{"dependencies":[…],"searchable":…}`, `,"unavailable":{"dependency","message"}`, `{"error":{step:"resolver"…}}`; `resolve_type` `{"widget":null,"resolver":{…}}`; `resolve_call … search type_defaults revision` (positions 8–10 after the subject's seven); echo `"search"`, `"revision"`; 6a's `resolverAnswerCompat.test.ts`.                              |

## Shared files

| File                                                         | 6b                                                                        | Avoiding conflicts                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `widgetRegistry/configuration.ts`                            | answer schema; `functionCallFromAnswer` returns `notes` and `resolvers`   | 5b and 4 are merged by then; append after their entries.      |
| `widgetRegistry/__tests__/resolverAnswerCompat.test.ts` (6a) | deleted; its cases move to `widgetQueryAnswer.test.ts` with the new shape | —                                                             |
| `integration-test/mock/lsHandler.ts`                         | `resolve_call` answers per method and search; a query counter             | A new region after the `resolve_type` mocks.                  |
| `integration-test/project-view/widgets.spec.ts`              | `test.describe('Resolvers', …)` at the end                                | Own describe.                                                 |
| `W/CLAUDE.md`, `CHANGELOG.md`                                | section, entry                                                            | Separate section; adjacent changelog lines, rebase keeps all. |

(`W` = `app/gui/src/project-view/components/GraphEditor/widgets`; `R` =
`app/gui/src/providers/openedProjects/widgetRegistry`.)

## Global Constraints

- Implementation worktree `C:\Repos\Enso\ide-widgets-pr6b`, branch
  `widgets/pr6b-resolvers-gui`, from `origin/develop` after 6a merges. Linux
  clone `~/enso-widgets-pr6b` on WSL `Ubuntu-24.04` (source
  `~/.enso-toolchain.sh`), helper `~/pr6b.sh` (`~/pr1b.sh` with
  `WIN=/mnt/c/Repos/Enso/ide-widgets-pr6b`, `LNX=$HOME/enso-widgets-pr6b`,
  `--exclude=.git`). Check `df -h ~` and `E:` first; delete worktree, clone and
  script after the merge.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is in
  a worktree. `corepack pnpm`. Every commit ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Re-query rule (spec §3):** a node's query re-runs exactly when the subject
  is recomputed and some argument depends on `self`, when a declared
  dependency's expression or computed value changes, or when a searchable
  argument's text changes. An unrelated argument changing does not re-run it.
  Pinned by unit tests on `widgetQueryPlan.ts` and by a Playwright query count.
- **Debounce 250 ms, latest wins; time-box 2 s.** Constants in one place
  (`widgetQueryPlan.ts`: `SEARCH_DEBOUNCE_MS = 250`,
  `RESOLVER_TIME_BOX_MS = 2000`), tested with fake timers.
- The fallback is always the call tree's existing one (type default, then
  literals and `tagValues`); this PR adds no new fallback logic, only notes.
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`: "Widgets
  that depend on other arguments (join conditions, filter values, column
  formats) update only when those arguments change, show a loading marker when
  slow, and fall back to the type's own widget when an input has an error.
  Database table-name pickers search the database as you type." (`[NNN]`: open
  as draft first.)
- **Screenshots** before/after on the `pr-screenshots` branch under `pr-<NNN>/`
  (Linux Playwright mock): the unavailable note on `join`'s `on` with an
  erroring `right`; the loading marker; a table-name dropdown filtered by a
  search; `set`'s `value` (Simple_Expression) unchanged.
- Playwright: `--workers=2`, the touched specs **3 runs** in the Linux clone,
  and develop the same way for comparison of any failure.
- `english.json` gains the note texts; recompile `enso-common` before Playwright
  (`app/gui/integration-test/CLAUDE.md`).
- **Stop at green CI; do not merge.** Then build a Windows installer for the
  owner's test (Task 10).

## File Structure

- Create `R/widgetQueryPlan.ts` (pure: dependencies, revision stamp, static
  test, constants) and `R/staticAnswerCache.ts`; tests in `R/__tests__/`.
- Modify `R/configuration.ts` (schema; `functionCallFromAnswer` → `notes`,
  `resolvers`), `R/typeDefaults.ts` (a resolver default; the reload hook
  exported for the static cache).
- Modify `W/WidgetFunction/widgetQuery.ts` (`resolveCallArguments` with
  `search`, `typeDefaults`, `revision`),
  `W/WidgetFunction/widgetFunctionCallInfo.ts` (the plan, the static cache, the
  time-box, the search query).
- Create `W/WidgetFunction/widgetSearch.ts` (`useWidgetSearch`).
- Modify `app/gui/src/project-view/util/callTree.ts` (`WidgetQueryNoteKey`,
  `WidgetSearchKey` on the input, beside `WidgetQueryErrorKey`).
- Create `W/WidgetQueryNote.vue` (priority 3).
- Modify `W/WidgetSelection.vue` (report the edited text through
  `WidgetSearchKey`).
- Modify `app/gui/src/providers/openedProjects/projectStates.ts` (create the
  `StaticAnswerCache` beside `TypeDefaults`).
- Modify `app/common/src/text/english.json` (note texts).
- Enso: `distribution/lib/Standard/Google/0.0.0-dev/src/Google_Analytics.enso`,
  `DuckDB/…/DuckDB_Connection.enso`, `Table/…/Table.enso` (group C annotations
  that repeat the type default, Task 7).
- Playwright: `app/gui/integration-test/mock/lsHandler.ts`,
  `app/gui/integration-test/project-view/widgets.spec.ts`.
- Docs: `W/CLAUDE.md` ("Widget queries"), `R/` has no CLAUDE.md: create one
  (project-structure skill) covering `configuration.ts`, `typeDefaults.ts`,
  `columnPickers.ts`, `widgetQueryPlan.ts`, `staticAnswerCache.ts`.

---

## Task 1: Schema — resolvers, notes, resolver defaults

**Files:**

- Modify: `R/configuration.ts` (`argumentResultSchema`,
  `widgetQueryAnswerSchema`, `functionCallFromAnswer`, `FunctionCall`)
- Modify: `R/typeDefaults.ts` (`answerSchema`, the cache's states)
- Delete: `R/__tests__/resolverAnswerCompat.test.ts` (6a)
- Test: `R/__tests__/widgetQueryAnswer.test.ts`,
  `R/__tests__/typeDefaults.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ResolverInfo {
  dependencies: string[]; // 'self' first when the subject counts
  searchable: boolean;
}
export type WidgetQueryNote =
  | { kind: "unavailable"; dependency: string; message: string }
  | { kind: "loading" };
export interface WidgetQueryAnswer {
  arguments: [string, ArgumentResult][];
  columns?: Record<string, WidgetColumns>;
  search?: string;
  revision?: string;
}
// FunctionCall gains:
//   resolvers?: Map<string, ResolverInfo>
//   notes?: Map<string, WidgetQueryNote>
// TypeDefaults.lookup keeps its signature; a resolver default is cached as
//   { state: 'resolver', resolver: ResolverInfo } and lookup returns undefined for it;
//   TypeDefaults.resolverDefault(reprType): ResolverInfo | undefined is new.
```

- [ ] **Step 1: Failing tests** (`widgetQueryAnswer.test.ts`; move 6a's three
      compatibility cases here with the new expectations):

```ts
test("a resolver answer keeps its widget and its dependencies", () => {
  const answer = widgetQueryAnswerSchema.parse({
    arguments: [
      [
        "on",
        {
          widget: { type: "Widget", constructor: "Text_Input" },
          resolver: { dependencies: ["self", "right"], searchable: false },
        },
      ],
    ],
    revision: "3",
  });
  const call = functionCallFromAnswer(answer);
  expect(call.parameters.get("on")).toMatchObject({ kind: "Text_Input" });
  expect(call.resolvers?.get("on")).toEqual({
    dependencies: ["self", "right"],
    searchable: false,
  });
  expect(answer.revision).toBe("3");
});

test("an unavailable dependency is no widget and a note", () => {
  const answer = widgetQueryAnswerSchema.parse({
    arguments: [
      [
        "on",
        {
          widget: null,
          resolver: { dependencies: ["self", "right"], searchable: false },
          unavailable: { dependency: "right", message: "bad" },
        },
      ],
    ],
  });
  const call = functionCallFromAnswer(answer);
  expect(call.parameters.get("on")).toBeNull();
  expect(call.notes?.get("on")).toEqual({
    kind: "unavailable",
    dependency: "right",
    message: "bad",
  });
});

test("a resolver's error stays an error and keeps its dependencies", () => {
  const answer = widgetQueryAnswerSchema.parse({
    arguments: [
      [
        "on",
        {
          error: { step: "resolver", message: "x" },
          resolver: { dependencies: ["self"], searchable: false },
        },
      ],
    ],
  });
  const call = functionCallFromAnswer(answer);
  expect(call.errors?.get("on")?.step).toBe("resolver");
  expect(call.resolvers?.get("on")?.dependencies).toEqual(["self"]);
});

test("a static answer has no resolvers", () => {
  const answer = widgetQueryAnswerSchema.parse({
    arguments: [
      ["arg", { widget: { type: "Widget", constructor: "Boolean_Input" } }],
    ],
  });
  expect(functionCallFromAnswer(answer).resolvers).toBeUndefined();
});
```

      `typeDefaults.test.ts`: an answer `{"widget":null,"resolver":{…}}` makes
      `lookup` return `undefined` (no static default) and `resolverDefault`
      return the info; no schema-mismatch report.

- [ ] **Step 2: Run, verify they fail**

```bash
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry
```

- [ ] **Step 3: Implement.** `resolverInfoSchema`, `unavailableSchema`; each
      branch of `argumentResultSchema` gains
      `resolver: resolverInfoSchema.optional()`, the widget branch
      `unavailable: unavailableSchema.optional()`; the answer gains `search` and
      `revision` (optional strings). `functionCallFromAnswer` fills `resolvers`
      and `notes` only when non-empty (so a static answer's `FunctionCall` is
      unchanged). Update the answer's doc comment.
- [ ] **Step 4: Run, verify they pass** (whole `widgetRegistry` folder).
- [ ] **Step 5: Commit**
      `GUI: read resolver dependencies, unavailable notes and resolver type defaults`.

## Task 2: `widgetQueryPlan.ts` and `StaticAnswerCache`

**Files:**

- Create: `R/widgetQueryPlan.ts`, `R/staticAnswerCache.ts`
- Test: `R/__tests__/widgetQueryPlan.test.ts`,
  `R/__tests__/staticAnswerCache.test.ts`

**Interfaces:**

```ts
export const SEARCH_DEBOUNCE_MS = 250;
export const RESOLVER_TIME_BOX_MS = 2000;

/** Whether an answer can be kept per method: no resolver, no column list. */
export function isStaticAnswer(answer: WidgetQueryAnswer): boolean;

/** The named dependencies of every resolver in `call`, without `'self'`, in first-seen order. */
export function namedDependencies(
  resolvers: ReadonlyMap<string, ResolverInfo> | undefined,
): string[];

/**
 * The expression ids the query sends: all of the call's (the first query, `resolvers` unknown),
 * otherwise only the named dependencies'.
 */
export function queryUuids(
  allUuids: Readonly<Record<string, string>>,
  resolvers: ReadonlyMap<string, ResolverInfo> | undefined,
): Record<string, string>;

/**
 * The revision stamp: changes exactly when one of `dependencyValues` (a dependency's computed
 * value, by identity) changes. `''` with no named dependency.
 */
export function revisionStamp(
  dependencyValues: readonly unknown[],
  ids: WeakMap<object, number>,
): string;

export class StaticAnswerCache {
  constructor(maxEntries?: number); // default 256, LRU
  key(method: string, argumentNames: readonly string[]): string;
  get(key: string): WidgetQueryAnswer | undefined;
  set(key: string, answer: WidgetQueryAnswer): void;
  clear(): void;
}
```

- [ ] **Step 1: Failing tests** (`widgetQueryPlan.test.ts`):

```ts
import { describe, expect, test } from "vitest";
import {
  isStaticAnswer,
  namedDependencies,
  queryUuids,
  revisionStamp,
} from "../widgetQueryPlan";

const all = { right: "id-right", on: "id-on", join_kind: "id-kind" };

describe("queryUuids", () => {
  test("the first query sends every argument", () => {
    expect(queryUuids(all, undefined)).toEqual(all);
  });
  test("afterwards only declared dependencies", () => {
    const resolvers = new Map([
      ["on", { dependencies: ["self", "right"], searchable: false }],
    ]);
    expect(queryUuids(all, resolvers)).toEqual({ right: "id-right" });
  });
  test("an unrelated argument changing leaves the sent ids equal", () => {
    const resolvers = new Map([
      ["on", { dependencies: ["self", "right"], searchable: false }],
    ]);
    expect(queryUuids({ ...all, join_kind: "id-kind-2" }, resolvers)).toEqual(
      queryUuids(all, resolvers),
    );
  });
});

test("namedDependencies drops self and repeats", () => {
  const resolvers = new Map([
    ["a", { dependencies: ["self", "x"], searchable: false }],
    ["b", { dependencies: ["x", "y"], searchable: true }],
  ]);
  expect(namedDependencies(resolvers)).toEqual(["x", "y"]);
});

test("revisionStamp follows the values by identity", () => {
  const ids = new WeakMap<object, number>();
  const v1 = {};
  const v2 = {};
  const first = revisionStamp([v1], ids);
  expect(revisionStamp([v1], ids)).toBe(first);
  expect(revisionStamp([v2], ids)).not.toBe(first);
  expect(revisionStamp([], ids)).toBe("");
});

test("isStaticAnswer", () => {
  expect(isStaticAnswer({ arguments: [["a", { widget: null }]] })).toBe(true);
  expect(
    isStaticAnswer({
      arguments: [
        [
          "a",
          {
            widget: null,
            resolver: { dependencies: ["self"], searchable: false },
          },
        ],
      ],
    }),
  ).toBe(false);
  expect(
    isStaticAnswer({
      arguments: [["a", { widget: null }]],
      columns: { "": { names: [], kinds: [], type_names: [] } },
    }),
  ).toBe(false);
});
```

      `staticAnswerCache.test.ts`: key order-independence is **not** wanted
      (argument names are sent in method order; `key('T.m', ['a','b'])` ≠
      `key('T.m', ['b','a'])` is fine but `key` must include every name); LRU
      drops the oldest past `maxEntries`; `clear` empties.

- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement.** `revisionStamp`: for each value, an object gets a
      number from `ids` (assign the next on first sight); a primitive or
      `undefined` stringifies; join with `.`. `StaticAnswerCache`: the existing
      `LruCache` (`app/gui/src/utils/`) if it fits, else a `Map` with re-insert
      on `get`.
- [ ] **Step 4: Run, verify they pass.**
- [ ] **Step 5: Commit**
      `GUI: the widget query plan — declared dependencies, revision, static answers`.

## Task 3: The node's query follows the plan

**Files:**

- Modify: `W/WidgetFunction/widgetQuery.ts` (`resolveCallArguments`,
  `widgetQueryConfiguration`: three new trailing arguments, emitted only when
  any is non-default so a query without them is today's)
- Modify: `W/WidgetFunction/widgetFunctionCallInfo.ts` (`visualizationConfig`
  ~112-136, `parsedAnswer` ~172-182, `widgetConfiguration` ~206-219)
- Modify: `R/typeDefaults.ts` (expose the reload hook: whatever 3b uses to drop
  entries on module or library reload — find it by reading `typeDefaults.ts` and
  `projectStates.ts`; if 3b drops entries only by session, add
  `onInvalidate(cb)` called from the same place), `projectStates.ts` (create
  `StaticAnswerCache`, clear it on that hook, pass it like `TypeDefaults`)
- Test: `W/WidgetFunction/__tests__/widgetQuery.test.ts`,
  `W/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`

**Interfaces:**

- Consumes: Task 1, Task 2.
- Produces:
  `useWidgetFunctionCallInfo(…, typeDefaults?, staticAnswers?: ToValue<StaticAnswerCache | undefined>)`.
  Behaviour:
  1. Cache hit for (method, annotated argument names) → no visualization
     (`visualizationConfig` is `null`), configuration from the cached answer.
  2. Otherwise the query sends `queryUuids(allUuids, lastResolvers)` and
     `revision = revisionStamp(values of namedDependencies)`, where a
     dependency's value is `graphDb.getExpressionInfo(uuid)` (a new object on
     every `expressionUpdate`; check this in `computedValueRegistry.ts` and, if
     it is mutated in place, use its `payload` object or an update counter
     instead).
  3. An answer whose `revision` echo is not the current stamp is ignored (latest
     wins); an answer that is static goes into the cache.
  4. `self` dependencies need nothing: the engine re-evaluates the visualization
     when the subject is recomputed.

- [ ] **Step 1: Failing tests.** `widgetQuery.test.ts`:
      `resolveCallArguments(target, names, uuids, false)` is unchanged (seven
      items, no trailing defaults); with `{ search: 'ab', revision: '3' }` it
      appends `'ab'`, `'{}'`, `'3'` as Enso literals. In
      `widgetFunctionCallInfo.test.ts` (with its `setUpCallInfo` helper and a
      fake `StaticAnswerCache`):
  - "a static answer is cached and the next node of the method sends no query";
  - "after an answer declaring `right`, the query sends only `right`'s id";
  - "changing `join_kind` does not change the query configuration" (deep-equal
    configs before and after);
  - "a new computed value of `right` changes `revision`";
  - "an answer with a stale revision is ignored".
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement.** Keep `lastResolvers` as a `shallowRef` updated from
      the last accepted answer; the configuration's `uuids` and `revision` are
      `computed`s of it, so Vue sees an unchanged config (same JSON) when
      nothing relevant changed. Compare configurations by value before handing
      them to `useVisualizationData` (it re-attaches on any new object;
      `visualizationConfigPreprocessorEqual` decides only the id).
- [ ] **Step 4: Run** the `widgetRegistry` and `WidgetFunction` folders;
      `corepack pnpm --filter enso-gui run typecheck`.
- [ ] **Step 5: Commit**
      `GUI: widget queries re-run only on a declared dependency; static answers once per method`.

## Task 4: Notes — an unavailable dependency, a slow resolver

**Files:**

- Create: `W/WidgetQueryNote.vue`
- Modify: `app/gui/src/project-view/util/callTree.ts` (`WidgetQueryNoteKey`
  beside `WidgetQueryErrorKey` line 704; `Argument.queryNote`, set like
  `queryError` lines 52, 69-86, 116)
- Modify: `W/WidgetFunction/widgetFunctionCallInfo.ts` (the time-box)
- Modify: `app/common/src/text/english.json`
- Test: `W/__tests__/WidgetQueryNote.test.ts`,
  `W/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`

**Interfaces:**

- `WidgetQueryNote.vue`: matcher `WidgetQueryNoteKey` present; priority 3,
  `Score.Perfect`; renders a small marker (`SvgIcon` — `info` for `unavailable`,
  a spinner for `loading`; check `iconName.ts` for existing names before adding)
  with the text as its tooltip, then
  `<NodeWidget :input="…without the key…" />`, exactly as `WidgetQueryError`
  does.
- Texts: `widgetQueryUnavailable`: "Choices unavailable: $0 has an error.";
  `widgetQueryLoading`: "Loading choices…".
- The time-box (decision G): per argument, when the query for it was sent and no
  accepted answer has come for `RESOLVER_TIME_BOX_MS`, its configuration becomes
  `null` (so the call tree falls to the type default) and its note
  `{kind: 'loading'}`; before that the previous answer's widget (or `Pending` on
  the first query) stays. An answer clears both.

- [ ] **Step 1: Failing tests.** `widgetFunctionCallInfo.test.ts` with
      `vi.useFakeTimers()`: no answer for 1999 ms → the argument is `Pending`
      and has no note; at 2000 ms → `null` and the loading note; the answer
      arrives → its widget, no note. A re-query after a dependency change: the
      previous widget stays until 2000 ms. `WidgetQueryNote.test.ts`
      (`mountWithProviders`): the unavailable note's tooltip contains `right`;
      the inner widget is rendered.
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the folders; typecheck; lint.
- [ ] **Step 5: Commit**
      `GUI: a widget whose input has an error, or whose resolver is slow, falls back with a note`.

## Task 5: Search as you type

**Files:**

- Create: `W/WidgetFunction/widgetSearch.ts`
- Modify: `app/gui/src/project-view/util/callTree.ts` (`WidgetSearchKey`: a
  callback set on the input of a searchable argument)
- Modify: `W/WidgetSelection.vue` (call it when `editedValue`'s text changes,
  lines ~185-190, and with `''` on `start`/end)
- Modify: `W/WidgetFunction/widgetFunctionCallInfo.ts` (merge the search
  answer's widget for that argument)
- Test: `W/WidgetFunction/__tests__/widgetSearch.test.ts`,
  `W/WidgetSelection/__tests__/` (one test that typing calls the callback)

**Interfaces:**

```ts
/**
 * The search query of one searchable argument: a second `resolve_call` visualization for that
 * argument only, with `search` = the debounced text. Latest wins: an answer whose `search` echo is
 * not the current text is ignored. Empty text: no query (the node's own answer is the full list).
 */
export function useWidgetSearch(
  project: …, // as useWidgetFunctionCallInfo's
  base: ToValue<Opt<NodeVisualizationConfiguration>>, // the node's query, to copy target and uuids
  argument: ToValue<string | undefined>, // the searchable argument being edited
  text: ToValue<string>,
): { configuration: ComputedRef<WidgetConfiguration | undefined> }
```

- `widgetFunctionCallInfo` keeps one `searchText` per call (only one dropdown is
  edited at a time) and the argument it belongs to; while the search answer
  exists, it replaces that argument's widget. The local filter in
  `WidgetSelection` (`makeExpressionFilter`) still applies on top.

- [ ] **Step 1: Failing tests** (`widgetSearch.test.ts`, fake timers, a fake
      `useVisualizationData` that records configurations):
  - typing `s`, `sa`, `sal` within 250 ms sends one query, with `"sal"`;
  - a slow answer for `"sa"` arriving after the user typed `"sal"` is ignored;
  - empty text sends nothing and clears the override;
  - a non-searchable argument never gets `WidgetSearchKey` (so `WidgetSelection`
    filters locally, as today).
- [ ] **Step 2: Run, verify they fail.**
- [ ] **Step 3: Implement** (`useDebounceFn` from `@vueuse/core`, as elsewhere
      in the GUI, or a `setTimeout` with the constant).
- [ ] **Step 4: Run** the folders; typecheck; lint.
- [ ] **Step 5: Commit** `GUI: searchable widgets ask the engine as you type`.

## Task 6: Resolver type defaults reach the query

**Files:**

- Modify: `W/WidgetFunction/widgetFunctionCallInfo.ts` (`annotatedArguments`
  ~105: add the arguments without an annotation whose declared type has a
  resolver default, from `typeDefaults.resolverDefault(reprType)`; send them in
  `type_defaults`)
- Test: `W/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`

- [ ] **Step 1: Failing test:** a method with an unannotated argument `format`
      of type `…DuckDB_GeoFormat` whose type default is a resolver → the query's
      `argument_names` include `format` and `type_defaults` is
      `{"format":"Standard.DuckDB.DuckDB_GeoFormat.DuckDB_GeoFormat"}`.
- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement.** A union-typed argument is not added (PR 4's
      composition owns unions; decision noted in "Interfaces assumed").
- [ ] **Step 4: Run**; typecheck.
- [ ] **Step 5: Commit**
      `GUI: arguments whose type default is a resolver are resolved per node`.

## Task 7: Group C annotations that repeat the type default go

**Files:**
`distribution/lib/Standard/Google/0.0.0-dev/src/Google_Analytics.enso`
(`@property (Widget.from Google_Analytics_Property)` ×3, `@account …`),
`DuckDB/…/DuckDB_Connection.enso` (`@format (Widget.from DuckDB_GeoFormat)`),
`Table/…/Table.enso` (`@value`, `@over`) — **only** where the argument's
declared type is exactly that type (check each signature; `set`'s `value` is a
union and keeps its annotation).

- [ ] **Step 1: Test first.** In the DuckDB widgets spec and Google's offline
      group: `Widget_Query.resolve_call` for the method with `type_defaults`
      naming the argument gives the same widget JSON as before the change (pin
      it first, with the annotation, then delete it).
- [ ] **Step 2: Delete** the annotations; run `DuckDB_Tests`, `Google_Api_Test`
      (offline), `Table_Tests`; `sbt "all lintEnso"`; regenerate API docs;
      `stdlib-api-check`.
- [ ] **Step 3: Commit**
      `Libraries: group C arguments take their resolver type default`.

## Task 8: Playwright

**Files:**

- Modify: `app/gui/integration-test/mock/lsHandler.ts` — answers for
  `resolve_call` that depend on the sent `uuids`, `search` and `revision` (read
  them from `lastWidgetQueries`, `widgetQueryKey` ~L844, which already keeps the
  arguments), and a per-method query counter (`widgetQueryCount(method)`), as
  `resolve_type` has one (~L580)
- Modify/Test: `app/gui/integration-test/project-view/widgets.spec.ts`, new
  `test.describe('Resolvers', …)` at the end

- [ ] **Step 1: Tests** (mocked answers; the mock project already has tables and
      a `join`-like node, else add one with `setMockMainFile`):
  - "join's `on` updates when `right` changes": answer depends on the `right`
    uuid; change the `right` argument's connection; the `on` dropdown lists the
    new right columns;
  - "an unrelated argument does not re-query": record
    `widgetQueryCount('.join')`, change `join_kind`, wait for the node to
    settle, the count is unchanged;
  - "a static method is asked once": two nodes calling the same static-widget
    method → one query;
  - "an input with an error falls back with a note": the answer carries
    `unavailable`; the argument shows its type default widget and the note's
    tooltip names the dependency; one Logs-panel entry (the engine's Info log is
    mocked by `addEngineLogLine`, or assert the panel has no new error);
  - "a slow resolver shows a loading marker, then its widget": delay the mock
    answer 3 s; the loading marker is visible at ~2.1 s; it is replaced by the
    widget after the answer;
  - "a table-name dropdown searches as you type": type `sal` in `query`'s
    dropdown; exactly one query with `search` `"sal"` after the debounce; the
    list shows the mock's matches.
- [ ] **Step 2: Run** in the Linux clone, three times, `--workers=2`
      (`widgets.spec.ts`, `tableVisualisation.spec.ts`,
      `dataReadImports.spec.ts`); compare any failure with develop run the same
      way.
- [ ] **Step 3: Commit**
      `Playwright: resolvers re-query on dependencies, fall back, search`.

## Task 9: Measure the re-queries and the timings

The engine side of the benchmark is 6a's (Task 12 there; nothing in 6b changes
engine time). Here, what 6b changes: how often the engine is asked and the GUI's
parse-and-render time.

- [ ] **Step 1:** With the performance-timings setting on (#342), in the dev
      server against a real engine (Linux clone, `corepack pnpm dev:vite` with
      the built distribution), a project with a 500-column table and `filter`,
      `join` (with `right`), `set`, `aggregate`, `select_columns` nodes: make
      the same 10 edits (change `join_kind`, change `right`, edit an unrelated
      node upstream, type in a filter value…) on develop and on the branch;
      count the widget queries (Logs panel → Engine → widget timing lines) and
      record the parse-and-render times.
- [ ] **Step 2:** Put the table in the PR body (queries per edit, before →
      after; parse+render ms against the §6 20 ms target, which 6a's engine
      numbers complement). No commit.

## Task 10: Docs, screenshots, changelog, PR, installer

- [ ] **Step 1: Docs.** `W/CLAUDE.md` "Widget queries": the plan (declared
      dependencies only, revision, static cache), the notes and
      `WidgetQueryNote`, the time-box, search (`WidgetSearchKey`, debounce,
      latest wins). Create `R/CLAUDE.md` (project-structure skill).
- [ ] **Step 2: Screenshots** (Global Constraints) before/after.
- [ ] **Step 3: Changelog** entry; PR as draft for its number.
- [ ] **Step 4: Full verification:**

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6b.sh pnpm_ready && cd ~/enso-widgets-pr6b && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && find . -name ".eslintcache" -not -path "*/node_modules/*" -delete && corepack pnpm --filter enso-gui run typecheck && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run test:unit'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr6b.sh dist && for s in Table_Tests DuckDB_Tests Google_Api_Test; do echo "== $s"; ~/pr6b.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done; ~/pr6b.sh sbt_run "all lintEnso"'
```

      and the unit tests on Windows.

- [ ] **Step 5: PR body**: what re-queries now and what does not; the notes and
      the time-box; search; Task 9's table; decisions taken (F–H); screenshots;
      follow-ups (Hyper search, 6a decision E; a searchable picker for other
      long lists). Mark ready. **Stop at green CI; do not merge.**
- [ ] **Step 6: Windows installer** to `C:\Users\jdunk\Downloads\enso-pr<NNN>\`
      (`ide-local`, see the local installer memory). Installer checklist for the
      owner: `join` with `right` set, then changed — `on` updates; changing
      `join_kind` does not flicker `on`; a `right` that is an error → `on` shows
      a text input with the note; a DuckDB `query` dropdown: type part of a
      table name, the list narrows; `filter` on a 300-column CSV table, change
      `column`, the value picker follows; `set`'s expression widget as before.
