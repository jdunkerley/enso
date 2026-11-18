# Widgets PR 1b: GUI Widget Queries by Method Pointer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every widget query the IDE makes goes to PR 1a's
`Standard.Base.Metadata.Widget_Query.resolve_call`, by method pointer. A failed
widget shows its error on the argument, which stays editable. An answer the GUI
cannot read reaches the Logs panel, and the GUI's parse and render time is
logged under the performance-timings setting. `Standard.Visualization.Widgets`
is deleted, and new projects and the samples no longer import
`Standard.Visualization`.

**Architecture:** The GUI attaches `resolve_call` as a method-pointer
visualization whose arguments are all literals, so nothing compiles in the
user's module. It reads the per-argument answer with a new zod schema; errors
travel on `FunctionCall.errors` to a wrapper widget that draws a marker and the
usual fallback. Expressions the GUI must still evaluate in a node's frame (the
dropped-file query, the JSON tree's pages, the table view's server rows and
distinct values, the component browser's preview) reach libraries through PR
1a's `Standard.Base.Meta.call_module_method`. A user's module can always name
that function, so it needs no import of the library. A new shim route lets the
GUI add lines to the Logs panel.

**Tech Stack:** TypeScript + Vue 3 + zod (GUI), vitest, Playwright (GUI mock
suite, Electron end-to-end), Node (project-manager shim, ydoc-server), Enso
(deleting `Standard.Visualization.Widgets`), sbt (distribution builds).

**Spec:** docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md

**Depends on:** PR 1a (`2026-11-18-widgets-pr1a-query-entry-point.md`), merged
into `develop`. Start the branch from that `develop`.

## Global Constraints

- Implementation worktree: `C:\Repos\Enso\ide-widgets-pr1b`, branch
  `widgets/pr1b-gui-method-pointers`, from `develop` **after PR 1a is merged**.
- Linux clone for every build and run: `~/enso-widgets-pr1b` on WSL
  `Ubuntu-24.04` (helper script `~/pr1b.sh`, below). Delete it when the PR is
  merged.
- Never `git stash`; never `gh pr merge --delete-branch` while the branch is
  checked out in a worktree.
- Consumes from PR 1a (exact names):
  - `Standard.Base.Metadata.Widget_Query.resolve_call value module_name type_name method_name argument_names uuids="{}" subject_is_type=False`,
    whose answer is
    `{"arguments":[[<name>,{"widget":<Widget JSON or null>}|{"error":{"step":"lookup"|"annotation","message":<text>}}],…]}`;
  - `Standard.Base.Meta.call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value`;
  - the engine's failure log (logger `Standard.Base.Metadata.Widget_Query`) and
    timing (`Progress` handle `Widget_Query.<type>.<method>`), which need
    nothing from the GUI.
- GUI method pointer:
  `{ module: Standard.Base.Metadata.Widget_Query, definedOnType: Standard.Base.Metadata.Widget_Query, name: resolve_call }`,
  `visualizationModule: 'Standard.Base.Metadata.Widget_Query'`.
- In-frame route to a library:
  `Standard.Base.Meta.call_module_method '<module>' '<method>' [<arguments>] _ <| <value>`
  (the wildcard, as today's in-frame expressions have, lets `Ast.analyzeAppLike`
  see the value).
- GUI log lines: `POST /api/engine-logs/append`; schema mismatch on logger
  `enso.gui.Widgets` (WARN, Engine source); timing on `enso.gui.performance`
  (DEBUG, Performance source, only while the setting is on).
- Package filters: `enso-gui`, `enso-common`, `project-manager-shim`, `enso`
  (Electron), `ydoc-server`, `build-scripts`.
- **Changelog: an entry** under `# Next Release` → `#### Enso IDE`, in the
  `- [Description][NNN]` form with a link definition (`NNN` is this PR's number;
  open the PR as a draft first to get it). Not the `CI: No changelog needed`
  label. The error marker is visible, so the PR gets before/after screenshots.
- Every commit message ends with a blank line and then
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Decisions and the evidence for them

These were checked in the code. Implementers do not need to re-derive them, but
should know why. The engine-side ones (why `resolve_call` is a module method,
how the exact lookup works, why `Meta.Type.find` is avoided) are in PR 1a's
plan.

1. **`visualizationModule` is the entry point's own module.** Every positional
   argument is now a literal (three texts, a vector of texts, a JSON text, a
   Boolean), so nothing compiles in the user's module. The default-visualization
   query already runs with `visualizationModule: 'Standard.Visualization.Id'` on
   a user node (`visualizationData.ts:78`), so a module other than the node's is
   an established pattern. The user-module invalidation in
   `EnsureCompiledJob.invalidateCaches` (`getVisualizations(module)`,
   `getInvalidatedVisualizations`) concerns a visualization's own expression
   ids, and the widget query has none. The method is looked up on every run, so
   editing an annotation is still picked up when the node re-runs.
2. **Dropping the import needed more than the widget queries.** A fully
   qualified name of a library that the module does not import does not compile:
   `FullyQualifiedNames.resolveQualName`
   (`runtime-compiler/.../FullyQualifiedNames.scala:360-400`) gives
   `MissingLibraryImportInFQNError` unless the library's `Main` has IR. No
   standard library imports `Standard.Visualization` itself, only its
   submodules. Visualization's `Main` exports exactly the modules the GUI names
   in text (`Tree`, `Table.Visualization`, `Widgets`, `Preprocessor`). The GUI
   evaluates four more expressions in a node's frame, and each names
   `Standard.Visualization.*`:
   - the JSON tree's pages (`treeExpression.ts`);
   - the table view's server rows and distinct values
     (`TableVizDataSourceUtils.ts`);
   - the component browser's preview (`visualizationData.ts`,
     `dataSource.type === 'expression'`);
   - today's dropped-file query.

   This is the error `samples.test.ts` records ("logged for Excel_Format and
   database values": database tables page their rows from the engine). All of
   them now go through `Standard.Base.Meta.call_module_method`. Base's `Main`
   exports `Meta` (`Main.enso:157`) and is always compiled, so the name always
   resolves. The library must be loaded, which it is once anything imports Table
   or any visualization has run.

3. **The dropped-file query stays in-frame, through `call_module_method`.** A
   method-pointer visualization needs an expression whose value is computed. A
   dropped file has no node, and the method body block's id
   (`formatForPath.ts`'s context) is not guaranteed a value. The in-frame call
   of the same entry point by its Base name needs no import and no node. This
   deviates from the spec's "by method pointer" for this one query, for that
   reason.
4. **The GUI cannot write to the Logs panel today.** The panel tails the
   session's log file and the engine's stderr
   (`app/project-manager-shim/src/engineLogs/channel.ts`); the stream route is
   GET only. The minimal route is a shim endpoint,
   `POST /api/engine-logs/append`, which adds `source: 'gui'` lines to the
   project's channel. Those lines are live only: they are not in the session
   file, so Download and the session log tab do not show them. Both hosts route
   it (`app/electron-client/src/server.ts`,
   `app/gui/project-manager-shim-middleware/index.ts`).
5. **The template's id map is shifted, not regenerated from scratch.**
   `UPDATE_TEMPLATE_ID_MAP=1` keeps the ids whose spans still match
   (`languageServerSession.test.ts:647`). After a line is removed, every span
   below it is off by 30, so the welcome node `fcf199e6…` would get a new id.
   The metadata `snapshot` is the deflated code, and the id map resolves against
   it whenever it differs from the file (#482). So a script removes the line,
   drops the entries inside it, shifts the ones after it by −30, shrinks the
   root (0/197 → 0/167) and re-deflates the snapshot. The regeneration run must
   then change nothing. The samples have no snapshot (checked), so the same
   script just shifts their spans and keeps their stored layout.

## Working environment

Create the worktree and the Linux clone once (check free space on `E:` first;
agent clones filled it before):

```powershell
git -C C:\Repos\Enso\ide worktree add -b widgets/pr1b-gui-method-pointers C:\Repos\Enso\ide-widgets-pr1b origin/develop
wsl -d Ubuntu-24.04 -e bash -lc 'df -h ~ && git clone /mnt/c/Repos/Enso/ide-widgets-pr1b ~/enso-widgets-pr1b && cd ~/enso-widgets-pr1b && git checkout widgets/pr1b-gui-method-pointers'
```

Create `~/pr1b.sh` in WSL (`chmod +x ~/pr1b.sh`; it is not part of the
repository). It mirrors the Windows worktree, uncommitted edits included, into
the clone before each run:

```bash
#!/usr/bin/env bash
# Widgets PR 1b helpers: pr1b.sh <function> [args...]
set -euo pipefail
. ~/.enso-toolchain.sh
WIN=/mnt/c/Repos/Enso/ide-widgets-pr1b
LNX=$HOME/enso-widgets-pr1b
export CARGO_TARGET_DIR=$HOME/enso-target
sync() {
  rsync -a --delete --exclude=.git/ --exclude=node_modules/ --exclude=target/ \
    --exclude=built-distribution/ --exclude=dist/ --exclude=.enso/ --exclude=.bloop/ \
    --exclude=.bsp/ --exclude=.metals/ --exclude='*.tsbuildinfo' --exclude=.eslintcache \
    "$WIN/" "$LNX/"
}
dist() { sync; (cd "$LNX" && sbt buildEngineDistributionNoIndex); }
sbt_run() { sync; (cd "$LNX" && sbt "$@"); }
# enso_test <Suite> [filter]: run from test/, the project's parent (root CLAUDE.md trap 1).
enso_test() {
  (cd "$LNX/test" && JAVA_TOOL_OPTIONS="-enableassertions -da:com.oracle.truffle.host.HostExecuteNode -da:com.oracle.graal.python.runtime.ExecutionContext" \
    ../built-distribution/enso-engine-*/enso-*/bin/enso --no-ir-caches --run "$PWD/$1" ${2:+"$2"})
}
pnpm_ready() { sync; (cd "$LNX" && corepack pnpm install --frozen-lockfile && corepack pnpm -r --if-present run compile); }
pnpm_run() { sync; (cd "$LNX" && corepack pnpm "$@"); }
"$@"
```

Every Enso run is checked for its count line, because a filter that matches
nothing still exits 0 (root CLAUDE.md trap 2). Each step names the
`N tests succeeded.` it expects.

## File Structure

**GUI**

- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/consts.ts`:
  the entry point's constants.
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetQuery.ts`:
  the query's configuration and arguments.
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`.
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/formatForPath.ts`.
- Modify `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`:
  answer schema, errors on `FunctionCall`.
- Modify `app/gui/src/project-view/util/callTree.ts`: `WidgetQueryErrorKey`.
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetQueryError.vue`:
  the marker.
- Create `app/gui/src/project-view/util/moduleCall.ts`:
  `Standard.Base.Meta.call_module_method` expressions.
- Modify
  `app/gui/src/project-view/components/visualizations/JSONVisualization/treeExpression.ts`,
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVizDataSourceUtils.ts`,
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/visualizationData.ts`.
- Create
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/previewExpression.ts`.
- Modify `app/gui/src/project-view/composables/tableColumns.ts`: new
  `column_names_json` path.
- Create `app/gui/src/providers/engineLogAppend.ts`: GUI lines for the Logs
  panel.
- Modify `app/gui/src/project-view/components/EngineLogs/engineLogModel.ts`:
  `enso.gui.performance` is Performance.
- Modify `app/common/src/services/engineLogs.ts`,
  `app/common/src/text/english.json`, `app/common/src/text.ts`.
- Tests beside each (`__tests__/`).

**Standard library (deleting the old query)**

- Delete `distribution/lib/Standard/Visualization/0.0.0-dev/src/Widgets.enso`
  and `docs/api/Widgets.md`; drop `export project.Widgets` from
  `Visualization/src/Main.enso`.
- Modify
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Table/Visualization.enso`:
  gains `column_names_json`.
- Delete `test/Visualization_Tests/src/Widgets_Spec.enso` (PR 1a's one old-shape
  test); modify `test/Visualization_Tests/src/Main.enso`.
- Regenerate `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/`.

**Shim and hosts**

- Modify `app/project-manager-shim/src/engineLogs/channel.ts`
  (`appendGuiLines`), `app/project-manager-shim/src/handler/engineLogs.ts`
  (`handleEngineLogAppend`), `app/electron-client/src/server.ts`,
  `app/gui/project-manager-shim-middleware/index.ts`.

**Playwright**

- Modify `app/gui/integration-test/mock/lsHandler.ts`,
  `app/gui/integration-test/mock/localApi.ts`,
  `app/gui/integration-test/project-view/widgets.spec.ts`.
- Modify `app/electron-client/tests/gettingStarted.spec.ts`.

**Template and samples**

- Modify `lib/scala/pkg/src/main/resources/default/src/Main.enso`, the five
  `app/electron-client/samples/*/src/Main.enso`,
  `app/electron-client/tests/headless/samples.test.ts` and
  `app/electron-client/globalSetup.ts`.

**Docs**

- `CHANGELOG.md` (one entry).
- CLAUDE.md updates:
  `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`,
  `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`,
  `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`,
  `app/gui/src/project-view/stores/visualization/CLAUDE.md`,
  `app/project-manager-shim/CLAUDE.md`, `app/electron-client/samples/CLAUDE.md`,
  `app/electron-client/CLAUDE.md`, `lib/scala/pkg/CLAUDE.md`.

---

## Task 1: GUI — the answer's schema, with errors

**Files:**

- Modify `app/gui/src/providers/openedProjects/widgetRegistry/configuration.ts`
  (after line 283; `FunctionCall` at 201)
- Create
  `app/gui/src/providers/openedProjects/widgetRegistry/__tests__/widgetQueryAnswer.test.ts`

**Interfaces:**

- Consumes (PR 1a): the answer of
  `Standard.Base.Metadata.Widget_Query.resolve_call`,
  `{"arguments":[[<name>,{"widget":<json|null>}|{"error":{"step","message"}}],…]}`
  (Enso `Argument_Result.to_json`, `Widget_Failure.to_json`).
- Produces `widgetQueryErrorSchema`,
  `type WidgetQueryError = { step: string; message: string }`.
- Produces `widgetQueryAnswerSchema`,
  `type WidgetQueryAnswer = { arguments: [string, { widget: (WidgetConfiguration & WithDisplay) | null } | { error: WidgetQueryError }][] }`.
- Produces
  `functionCallFromAnswer(answer: WidgetQueryAnswer, inherited?: FunctionCall): FunctionCall`.
- `FunctionCall` gains `errors?: Map<string, WidgetQueryError> | undefined`.
- `argsWidgetConfigurationSchema` stays: a `Choice`'s nested `parameters` keep
  the `[name, widget | null]` form.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  DisplayMode,
  functionCallFromAnswer,
  type FunctionCall,
  widgetQueryAnswerSchema,
} from "../configuration";

const textInput = {
  type: "Widget",
  constructor: "Text_Input",
  display: { type: "Display", constructor: "Always" },
};

describe("widgetQueryAnswerSchema", () => {
  test("reads widgets, nulls and errors, in order", () => {
    const parsed = widgetQueryAnswerSchema.parse({
      arguments: [
        ["a", { widget: textInput }],
        ["b", { widget: null }],
        ["c", { error: { step: "annotation", message: "boom" } }],
      ],
    });
    expect(parsed.arguments.map(([name]) => name)).toEqual(["a", "b", "c"]);
    expect(parsed.arguments[0]![1]).toMatchObject({
      widget: { kind: "Text_Input", display: DisplayMode.Always },
    });
    expect(parsed.arguments[1]![1]).toEqual({ widget: null });
    expect(parsed.arguments[2]![1]).toEqual({
      error: { step: "annotation", message: "boom" },
    });
  });

  test("rejects the old answer, a bare array of pairs", () => {
    expect(widgetQueryAnswerSchema.safeParse([["a", textInput]]).success).toBe(
      false,
    );
  });
});

describe("functionCallFromAnswer", () => {
  test("keeps the errors apart from the widgets", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [
        ["a", { widget: textInput }],
        ["c", { error: { step: "lookup", message: "gone" } }],
      ],
    });
    const call = functionCallFromAnswer(answer);
    expect([...call.parameters.keys()]).toEqual(["a"]);
    expect(call.errors?.get("c")).toEqual({ step: "lookup", message: "gone" });
  });

  test("has no errors when nothing failed", () => {
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [["a", { widget: null }]],
    });
    expect(functionCallFromAnswer(answer).errors).toBeUndefined();
  });

  test("lets an inherited parameter win, as before", () => {
    const inherited: FunctionCall = {
      kind: "FunctionCall",
      parameters: new Map([
        ["a", { kind: "Boolean_Input", display: DisplayMode.Always }],
      ]),
    };
    const answer = widgetQueryAnswerSchema.parse({
      arguments: [["a", { widget: textInput }]],
    });
    expect(
      functionCallFromAnswer(answer, inherited).parameters.get("a")?.kind,
    ).toBe("Boolean_Input");
  });
});
```

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/providers/openedProjects/widgetRegistry/__tests__/widgetQueryAnswer.test.ts
```

Expected: FAIL (`widgetQueryAnswerSchema` is not exported).

- [ ] **Step 3: Implement.** In `FunctionCall`:

```ts
export interface FunctionCall {
  kind: "FunctionCall";
  parameters: Map<string, (WidgetConfiguration & WithDisplay) | null>;
  /** Why the engine has no widget for these arguments (`Widget_Query.resolve_call`'s errors). */
  errors?: Map<string, WidgetQueryError> | undefined;
}
```

After `argsWidgetConfigurationSchema`:

```ts
/** Why the engine could not resolve an argument's widget (Enso `Widget_Failure.to_json`). */
export const widgetQueryErrorSchema = z.object({
  step: z.string(),
  message: z.string(),
});
export type WidgetQueryError = z.infer<typeof widgetQueryErrorSchema>;

const argumentResultSchema = z.union([
  z.object({ widget: widgetConfigurationSchema.nullable() }),
  z.object({ error: widgetQueryErrorSchema }),
]);

/**
 * The answer of `Standard.Base.Metadata.Widget_Query.resolve_call`: for each argument asked
 * for, in order, its widget (`null`: none) or why it has none. An object, so that later fields (a
 * column list sent once, PR 5) can join `arguments`.
 */
export const widgetQueryAnswerSchema = z.object({
  arguments: z.array(z.tuple([argNameSchema, argumentResultSchema])),
});
export type WidgetQueryAnswer = z.infer<typeof widgetQueryAnswerSchema>;

/** {@link functionCallConfiguration} of an answer: its widgets as parameters, its errors apart. */
export function functionCallFromAnswer(
  answer: WidgetQueryAnswer,
  inherited?: FunctionCall,
): FunctionCall {
  const parameters: ArgumentWidgetConfiguration[] = [];
  const errors = new Map<string, WidgetQueryError>();
  for (const [name, result] of answer.arguments) {
    if ("error" in result) errors.set(name, result.error);
    else parameters.push([name, result.widget]);
  }
  const call = functionCallConfiguration(parameters, inherited);
  return errors.size > 0 ? { ...call, errors } : call;
}
```

- [ ] **Step 4: Pass** (same command): `6 passed`.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/src/providers/openedProjects/widgetRegistry
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "GUI: read the widget query's answer, with errors per argument

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: GUI — every widget query by method pointer

**Files:**

- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/consts.ts`
  (whole file)
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetQuery.ts`
  (~50 lines)
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`
  (lines 44-51 signature, 117-165 `visualizationConfig`, 195-215
  `widgetConfiguration`)
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetQuery.test.ts`
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`

**Interfaces:**

- Consumes (PR 1a):
  `Standard.Base.Metadata.Widget_Query.resolve_call (value : Any) (module_name : Text) (type_name : Text) (method_name : Text) (argument_names : Vector Text) (uuids : Text = "{}") (subject_is_type : Boolean = False) -> Text`,
  a module method, so the method pointer's `definedOnType` is the module.
- `consts.ts` produces:
  - `WIDGET_QUERY_MODULE = 'Standard.Base.Metadata.Widget_Query'`;
  - `WIDGET_QUERY_PATH: ProjectPath`;
  - `RESOLVE_CALL = 'resolve_call' as Identifier`;
  - `RESOLVE_CALL_POINTER: MethodPointer`.

  It removes `WIDGETS_ENSO_MODULE`, `GET_WIDGETS_METHOD` and
  `WIDGETS_ENSO_PATH`.

- `widgetQuery.ts` produces:
  - `interface WidgetQueryTarget { module: string; definedOnType: string; name: string }`,
    the method pointer as the engine names it;
  - `resolveCallArguments(target, argumentNames, uuids, subjectIsType): string[]`;
  - `widgetQueryConfiguration(expressionId, target, argumentNames, uuids, subjectIsType): NodeVisualizationConfiguration`.
- `useWidgetFunctionCallInfo`'s `project` picks
  `'useVisualizationData' | 'moduleProjectPath' | 'assetId'` (`assetId` is used
  in Task 7).

- [ ] **Step 1: Failing tests.** `widgetQuery.test.ts`:

```ts
import {
  RESOLVE_CALL_POINTER,
  WIDGET_QUERY_MODULE,
} from "@/components/GraphEditor/widgets/WidgetFunction/consts";
import {
  resolveCallArguments,
  widgetQueryConfiguration,
} from "@/components/GraphEditor/widgets/WidgetFunction/widgetQuery";
import { expect, test } from "vitest";
import type { ExternalId } from "ydoc-shared/yjsModel";

const target = {
  module: "Standard.Table.Table",
  definedOnType: "Standard.Table.Table.Table",
  name: "join",
};

test("the arguments are literals only, so they compile in any module", () => {
  expect(
    resolveCallArguments(target, ["on", "right"], { right: "id-1" }, false),
  ).toEqual([
    "'Standard.Table.Table'",
    "'Standard.Table.Table.Table'",
    "'join'",
    "['on', 'right']",
    `'{"right":"id-1"}'`,
    "False",
  ]);
});

test("a call with no subject expression asks for the type as the subject", () => {
  expect(resolveCallArguments(target, ["on"], {}, true).at(-1)).toBe("True");
});

test("the query is a method pointer to Widget_Query.resolve_call, evaluated in its own module", () => {
  const config = widgetQueryConfiguration(
    "id-0" as ExternalId,
    target,
    ["on"],
    {},
    false,
  );
  expect(config.expressionId).toBe("id-0");
  expect(config.visualizationModule).toBe(WIDGET_QUERY_MODULE);
  expect(config.expression).toEqual(RESOLVE_CALL_POINTER);
});
```

In `widgetFunctionCallInfo.test.ts`:

- replace the `GET_WIDGETS_METHOD, WIDGETS_ENSO_MODULE` import with
  `RESOLVE_CALL_POINTER, WIDGET_QUERY_MODULE`;
- add `assetId: 'project-id'` to the project mock;
- replace the assertion block after `const visConfigValue = …` with:

```ts
const pointer = entryMethodPointer(callSuggestion)!;
expect(visConfigValue.visualizationModule).toBe(WIDGET_QUERY_MODULE);
expect(visConfigValue.expression).toEqual(RESOLVE_CALL_POINTER);
expect(visConfigValue.expressionId).toBe(
  attachedSpan == null ? eid("entireFunction") : eid("attached"),
);
const args = visConfigValue.positionalArgumentsExpressions!;
expect(args.slice(0, 4)).toEqual([
  Ast.TextLiteral.new(
    projectNames.serializeProjectPathForBackend(pointer.module),
  ).code(),
  Ast.TextLiteral.new(
    projectNames.serializeProjectPathForBackend(pointer.definedOnType),
  ).code(),
  Ast.TextLiteral.new(methodName).code(),
  "['arg']",
]);
expect(args[5]).toBe(attachedSpan == null ? "True" : "False");
```

and change the `methodName` column values from `'.method'` style to the bare
name (`'method'`, `'static_method'`, `'Con'`, `'module_method'`). The test title
becomes `'Widget query for $code'`.

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetQuery.test.ts src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts
```

Expected: FAIL (missing module and exports).

- [ ] **Step 3: Implement.** `consts.ts`:

```ts
import type { MethodPointer } from "@/util/methodPointer";
import { ProjectPath } from "@/util/projectPath";
import type { QualifiedName } from "@/util/qualifiedName";
import type { Identifier } from "ydoc-shared/ast";

/** The module of the IDE's widget query (`Standard.Base.Metadata.Widget_Query`). */
export const WIDGET_QUERY_MODULE = "Standard.Base.Metadata.Widget_Query";
export const WIDGET_QUERY_PATH = ProjectPath.create(
  "Standard.Base" as QualifiedName,
  "Metadata.Widget_Query" as QualifiedName,
);
/** The widget query of a call: `resolve_call`. */
export const RESOLVE_CALL = "resolve_call" as Identifier;
export const RESOLVE_CALL_POINTER: MethodPointer = {
  module: WIDGET_QUERY_PATH,
  definedOnType: WIDGET_QUERY_PATH,
  name: RESOLVE_CALL,
};
```

`widgetQuery.ts`:

```ts
/**
 * @file The widget query of a call: `Standard.Base.Metadata.Widget_Query.resolve_call`, attached
 * as a method-pointer visualization to the call's subject. Its arguments are literals, so nothing is
 * compiled in the user's module and the user's module needs no import.
 */
import type { NodeVisualizationConfiguration } from "$/providers/openedProjects/project/executionContext";
import { Ast } from "@/util/ast";
import type { ExternalId } from "ydoc-shared/yjsModel";
import { RESOLVE_CALL_POINTER, WIDGET_QUERY_MODULE } from "./consts";

/** The called method, exactly: its method pointer, with the names the engine uses. */
export interface WidgetQueryTarget {
  readonly module: string;
  readonly definedOnType: string;
  readonly name: string;
}

/**
 * `resolve_call`'s arguments after the subject: the method's module, type and name, the arguments
 * to resolve, the expression ids of the call's arguments (for annotations taking `cache`), and
 * whether the annotations' subject is the type rather than the visualized value.
 */
export function resolveCallArguments(
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
): string[] {
  return [
    Ast.TextLiteral.new(target.module).code(),
    Ast.TextLiteral.new(target.definedOnType).code(),
    Ast.TextLiteral.new(target.name).code(),
    Ast.Vector.build(argumentNames, Ast.TextLiteral.new).code(),
    Ast.TextLiteral.new(JSON.stringify(uuids)).code(),
    subjectIsType ? "True" : "False",
  ];
}

/** The visualization that asks for the widgets of `argumentNames` of `target`'s call. */
export function widgetQueryConfiguration(
  expressionId: ExternalId,
  target: WidgetQueryTarget,
  argumentNames: readonly string[],
  uuids: Readonly<Record<string, string>>,
  subjectIsType: boolean,
): NodeVisualizationConfiguration {
  return {
    expressionId,
    visualizationModule: WIDGET_QUERY_MODULE,
    expression: RESOLVE_CALL_POINTER,
    positionalArgumentsExpressions: resolveCallArguments(
      target,
      argumentNames,
      uuids,
      subjectIsType,
    ),
  };
}
```

(If `Ast.Vector.build` wants a mutable array, spread `[...argumentNames]`.)

`widgetFunctionCallInfo.ts`: the `project` parameter type becomes
`ToValue<Pick<ProjectStore, 'useVisualizationData' | 'moduleProjectPath' | 'assetId'>>`,
and `visualizationConfig` becomes:

```ts
const visualizationConfig = computed<Opt<NodeVisualizationConfiguration>>(
  () => {
    const info = methodCallInfo.value;
    if (!info) return null;
    if (!entryIsAnnotatable(info.suggestion)) return null;
    const annotatedArgs = annotatedArguments.value;
    if (!annotatedArgs?.length) return null;
    const names = toValue(projectNames);
    const pointer = info.methodCall.methodPointer;
    // No subject expression (an autoscoped constructor, a static call with no subject): the query
    // hangs on the call itself, and annotations see the method's type, as before.
    const subjectId = widgetQuerySubjectExpressionId.value;
    return widgetQueryConfiguration(
      subjectId ?? toValue(input).value.externalId,
      {
        module: names.serializeProjectPathForBackend(pointer.module),
        definedOnType: names.serializeProjectPathForBackend(
          pointer.definedOnType,
        ),
        name: pointer.name,
      },
      annotatedArgs,
      ArgumentApplication.collectArgumentNamesAndUuids(interpreted.value, info),
      subjectId == null,
    );
  },
);
```

`widgetConfiguration` reads the new answer (Task 7 adds the report and the
timing):

```ts
const widgetConfiguration = computed(() => {
  const data = visualizationData.value;
  if (data?.ok) {
    const parsed = widgetQueryAnswerSchema.safeParse(data.value);
    if (parsed.success)
      return functionCallFromAnswer(parsed.data, inheritedConfig.value);
    console.error("Unable to parse widget configuration.", data, parsed.error);
  } else if (data != null && !data.ok) {
    data.error.log("Cannot load dynamic configuration");
  }
  // … the pending fallback below is unchanged …
});
```

Remove the now-unused imports (`ProjectPath`, `WIDGETS_ENSO_*`,
`argsWidgetConfigurationSchema`, `functionCallConfiguration`). Add
`widgetQueryAnswerSchema`, `functionCallFromAnswer` and
`widgetQueryConfiguration`.

(`tableColumns.ts` keeps calling
`Standard.Visualization.Widgets.column_names_json` until Task 5 moves it.)

- [ ] **Step 4: Pass and typecheck**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetFunction
corepack pnpm --filter enso-gui run typecheck
```

Expected: all `WidgetFunction` tests pass except `formatForPath.test.ts`'s
answer fixture (Task 4); typecheck clean apart from `formatForPath.ts`,
`GraphEditor.vue` and `lsHandler.ts`, which still import the removed constants
(fixed in Tasks 4 and 8). If that blocks the commit hook, do Task 4 Step 3's
`formatForPath.ts` change in this task.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "GUI: every widget query calls Widget_Query.resolve_call by method pointer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: GUI — the error marker on the argument

**Files:**

- Modify `app/gui/src/project-view/util/callTree.ts` (`ArgumentFactory`,
  `Argument.toWidgetInput`, the symbol beside `ArgumentInfoKey` at line 652)
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetQueryError.vue`
  (~70 lines)
- Modify `app/common/src/text/english.json` (beside the other widget strings)
  and `app/common/src/text.ts` (`Replacements`, beside `libraryNotInEdition`)
- Modify `app/gui/src/project-view/util/__tests__/callTree.test.ts` (one test)
- Create
  `app/gui/src/project-view/components/GraphEditor/widgets/__tests__/widgetQueryError.test.ts`

**Interfaces:**

- Produces `WidgetQueryErrorKey: unique symbol`
  (`Symbol.for('WidgetInput:WidgetQueryError')`), with
  `WidgetInput[WidgetQueryErrorKey]?: WidgetQueryError`. It is set only on an
  argument whose query failed: the registry's symbol matcher tests
  `key in input`.
- Produces the widget `WidgetQueryError`: priority 2, `Score.Perfect`. It sits
  after `WidgetPort` (0) and `WidgetIcon` (1), so the port stays connectable,
  and before everything that draws the value. It renders a `warning` icon with a
  tooltip, then `<NodeWidget :input>`. The registry adds it to `alreadyUsed`, so
  the fallback widget is chosen exactly as if the query had given nothing
  (`dynamicConfig` stays `undefined`).
- Text: `"widgetQueryError": "No widget: $0"`,
  `widgetQueryError: [message: string]`.

- [ ] **Step 1: Failing tests.** In `callTree.test.ts`:

```ts
test("an argument whose widget query failed carries the error, the others do not", () => {
  const ast = Ast.parseExpression("a.func x y")!;
  const call = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: prefixFixture.mockSuggestion,
    widgetCfg: {
      kind: "FunctionCall",
      parameters: new Map(),
      errors: new Map([["b", { step: "annotation", message: "boom" }]]),
    },
    subjectAsSelf: true,
  });
  assert(call instanceof ArgumentApplication);
  const inputs = new Map(
    [...call.iterApplications()].map((app) => [
      app.argument.argInfo?.name,
      app.argument.toWidgetInput(),
    ]),
  );
  expect(inputs.get("b")?.[WidgetQueryErrorKey]).toEqual({
    step: "annotation",
    message: "boom",
  });
  expect(WidgetQueryErrorKey in inputs.get("a")!).toBe(false);
});
```

(import `WidgetQueryErrorKey` from `@/util/callTree`; `b` is a placeholder here,
`a` an AST argument, so both kinds are covered).

`widgetQueryError.test.ts`:

```ts
import { WidgetInput } from "$/providers/openedProjects/widgetRegistry";
import { widgetDefinition as iconWidget } from "@/components/GraphEditor/widgets/WidgetIcon.vue";
import { widgetDefinition as portWidget } from "@/components/GraphEditor/widgets/WidgetPort.vue";
import { widgetDefinition as errorWidget } from "@/components/GraphEditor/widgets/WidgetQueryError.vue";
import { widgetDefinition as selectionWidget } from "@/components/GraphEditor/widgets/WidgetSelection.vue";
import { Ast } from "@/util/ast";
import { WidgetQueryErrorKey } from "@/util/callTree";
import { expect, test } from "vitest";

test("takes only an input whose widget query failed", () => {
  const input = WidgetInput.FromAst(Ast.parseExpression("x")!);
  expect(errorWidget.match(input)).toBe(false);
  expect(
    errorWidget.match({
      ...input,
      [WidgetQueryErrorKey]: { step: "annotation", message: "boom" },
    }),
  ).toBe(true);
});

test("wraps the argument inside its port and outside the widgets that draw it", () => {
  expect(errorWidget.priority).toBeGreaterThan(portWidget.priority);
  expect(errorWidget.priority).toBeGreaterThan(iconWidget.priority);
  expect(errorWidget.priority).toBeLessThan(selectionWidget.priority);
});
```

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/util/__tests__/callTree.test.ts src/project-view/components/GraphEditor/widgets/__tests__/widgetQueryError.test.ts
```

Expected: FAIL (no `WidgetQueryErrorKey`, no `WidgetQueryError.vue`).

- [ ] **Step 3: Implement.** `callTree.ts`. In `ArgumentFactory`, set the error
      on both kinds of argument:

```ts
  placeholder(index: number, info: SuggestionEntryArgument, insertAsNamed: boolean) {
    const argument = new ArgumentPlaceholder(
      this.callId,
      this.kind,
      this.dynamicConfig(info.name),
      index,
      info,
      insertAsNamed,
    )
    argument.queryError = this.queryError(info.name)
    return argument
  }

  argument(ast: Ast.Expression, index: number | undefined, info: SuggestionEntryArgument | undefined) {
    const argument = new ArgumentAst(
      this.callId,
      this.kind,
      info && this.dynamicConfig(info.name),
      index,
      info,
      ast,
    )
    argument.queryError = info && this.queryError(info.name)
    return argument
  }

  private queryError(name: string) {
    return this.widgetCfg?.errors?.get(name)
  }
```

In `Argument`:

```ts
  /** Why the engine has no widget for this argument, if its widget query failed. */
  queryError: widgetCfg.WidgetQueryError | undefined = undefined

  toWidgetInput(): WidgetInput {
    return {
      portId: this.portId,
      value: this.value,
      expectedType: this.argInfo?.reprType,
      [ArgumentInfoKey]: { info: this.argInfo, appKind: this.kind, argId: this.argId },
      dynamicConfig: this.dynamicConfig,
      // Only when it failed: the widget registry matches the key's presence.
      ...(this.queryError ? { [WidgetQueryErrorKey]: this.queryError } : {}),
    }
  }
```

Beside `ArgumentInfoKey`:

```ts
/** Set on an argument whose widget query failed: `WidgetQueryError.vue` shows it. */
export const WidgetQueryErrorKey: unique symbol = Symbol.for(
  "WidgetInput:WidgetQueryError",
);
```

Add `[WidgetQueryErrorKey]?: widgetCfg.WidgetQueryError` to the same
`declare module` block.

`WidgetQueryError.vue`:

```vue
<script setup lang="ts">
import { useText } from "$/providers/text";
import {
  Score,
  defineWidget,
  widgetProps,
} from "$/providers/openedProjects/widgetRegistry";
import NodeWidget from "@/components/GraphEditor/NodeWidget.vue";
import SvgIcon from "@/components/SvgIcon.vue";
import TooltipTrigger from "@/components/TooltipTrigger.vue";
import { WidgetQueryErrorKey } from "@/util/callTree";
import { computed } from "vue";

const props = defineProps(widgetProps(widgetDefinition));
const { getText } = useText();
const title = computed(() =>
  getText("widgetQueryError", props.input[WidgetQueryErrorKey].message),
);
</script>

<script lang="ts">
/**
 * An argument whose widget query failed (`Widget_Query.resolve_call` answered an error): a warning
 * marker whose tooltip is the error, then the argument as it would be drawn without a widget. The
 * engine logged the error, with its cause and stack, in the Logs panel.
 */
export const widgetDefinition = defineWidget(
  WidgetQueryErrorKey,
  { priority: 2, score: Score.Perfect },
  import.meta.hot,
);
</script>

<template>
  <div class="WidgetQueryError widgetParent">
    <TooltipTrigger>
      <template #default="triggerProps">
        <SvgIcon
          v-bind="triggerProps"
          class="marker"
          name="warning"
          role="img"
          :aria-label="title"
          data-testid="widget-query-error"
        />
      </template>
      <template #tooltip>{{ title }}</template>
    </TooltipTrigger>
    <NodeWidget :input="props.input" />
  </div>
</template>

<style scoped>
.WidgetQueryError {
  gap: var(--widget-token-pad-unit);
}
.marker {
  color: var(--color-warning);
  flex-shrink: 0;
}
</style>
```

`english.json`: `"widgetQueryError": "No widget: $0",`. `text.ts`
`Replacements`: `readonly widgetQueryError: [message: string]`.

- [ ] **Step 4: Pass, then lint and typecheck**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/util/__tests__/callTree.test.ts src/project-view/components/GraphEditor/widgets/__tests__/widgetQueryError.test.ts
corepack pnpm --filter enso-gui run lint
```

Expected: PASS; lint clean. The icon name `warning` is a `<symbol id="warning">`
in `src/project-view/assets/icons.svg` (line 1011).

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/src/project-view/util app/gui/src/project-view/components/GraphEditor/widgets/WidgetQueryError.vue app/gui/src/project-view/components/GraphEditor/widgets/__tests__ app/common/src/text/english.json app/common/src/text.ts
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "GUI: show a failed widget query on its argument, which stays editable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: GUI — in-frame expressions reach libraries through `Standard.Base.Meta.call_module_method`

**Files:**

- Create `app/gui/src/project-view/util/moduleCall.ts` (~35 lines) and
  `app/gui/src/project-view/util/__tests__/moduleCall.test.ts`
- Modify
  `app/gui/src/project-view/components/visualizations/JSONVisualization/treeExpression.ts`
  (`childrenExpression`) and its test
- Modify
  `app/gui/src/project-view/components/visualizations/TableVisualization/TableVizDataSourceUtils.ts`
  (`createDistinctExpressionTemplate`, `createExpressionRowTemplate`, lines
  197-290) and
  `app/gui/src/project-view/components/visualizations/__tests__/tableVizDataSourceUtilsTests.spec.ts`
- Create
  `app/gui/src/project-view/components/GraphEditor/GraphVisualization/previewExpression.ts`
  and its test; modify `visualizationData.ts` (lines 180-211)
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/formatForPath.ts`
  (lines 196-221) and `__tests__/formatForPath.test.ts` (the fixture at line
  ~340)

**Interfaces:**

- Consumes (PR 1a):
  `Standard.Base.Meta.call_module_method (module_name : Text) (method_name : Text) (arguments : Vector) value -> Any`,
  and `resolve_call` (for the dropped-file query, called with `value = Nothing`
  and its defaults).
- Produces `MODULE_CALL = 'Standard.Base.Meta.call_module_method'`.
- Produces
  `moduleCall(module: Ast.MutableModule, moduleName: string, methodName: string, args: readonly Ast.Owned<Ast.MutableExpression>[]): Ast.Owned<Ast.MutableExpression>`,
  which builds `MODULE_CALL '<module>' '<method>' [<args>] _`.
- Produces
  `previewExpression(preprocessor: { visualizationModule: string; expression: string; positionalArgumentsExpressions?: string[] | undefined }, code: string): string`.
- `DATA_READ_FORMAT_WIDGET_QUERY` becomes
  `"Standard.Base.Meta.call_module_method 'Standard.Base.Metadata.Widget_Query' 'resolve_call' ['Standard.Base.Data', 'Standard.Base.Data', 'read', ['format']] Nothing"`.
- `formatTypeForDroppedFile(fileName, answer)` reads `widgetQueryAnswerSchema`.

- [ ] **Step 1: Failing tests.** `moduleCall.test.ts`:

```ts
import { Ast } from "@/util/ast";
import { MODULE_CALL, moduleCall } from "@/util/moduleCall";
import { expect, test } from "vitest";

test("names only Standard.Base, so it compiles in a module that imports no other library", () => {
  const module = Ast.MutableModule.Transient();
  const call = moduleCall(module, "Standard.Visualization.Tree", "children", [
    Ast.parseExpression("['a', 3]", module)!,
    Ast.parseExpression("100", module)!,
  ]);
  const code = Ast.OprApp.new(
    module,
    call,
    "<|",
    Ast.parseExpression("node1", module)!,
  ).code();
  expect(code).toBe(
    "Standard.Base.Meta.call_module_method 'Standard.Visualization.Tree' 'children' [['a', 3], 100] _ <| node1",
  );
  const { func, args } = Ast.analyzeAppLike(Ast.parseExpression(code)!);
  expect(func.code()).toBe(MODULE_CALL);
  expect(args.at(-1)?.code()).toBe("node1");
});
```

`treeExpression.test.ts`: the first test becomes:

```ts
test("childrenExpression calls Tree.children through Standard.Base, on the node", () => {
  const ast = childrenExpression(["a", 3], 100, 50)("node1");
  const { func, args } = Ast.analyzeAppLike(ast);
  expect(func.code()).toBe(MODULE_CALL);
  expect(args.map((arg) => arg.code().replace(/\s/g, ""))).toEqual([
    `'${TREE_MODULE}'`,
    "'children'",
    "[['a',3],100,50]",
    "node1",
  ]);
});

test("childrenExpression of the root passes an empty path", () => {
  const { args } = Ast.analyzeAppLike(childrenExpression([], 0, 100)("node1"));
  expect(args[2]!.code().replace(/\s/g, "")).toBe("[[],0,100]");
});
```

`tableVizDataSourceUtilsTests.spec.ts`: the filters are now elements of the
argument vector, so `([${filter}])` becomes `[${filter}]` and
`"([(..Is_In ['a', 'b'])])"` becomes `"[(..Is_In ['a', 'b'])]"`. Add:

```ts
test("asks for the rows through Standard.Base", () => {
  const request = rowsRequest({ name: { filterType: "set", values: ["a"] } }, [
    ["name", "Char"],
  ]);
  expect(request).toMatch(
    /^Standard\.Base\.Meta\.call_module_method 'Standard\.Visualization\.Table\.Visualization' 'get_rows_for_table' \[0, Nothing, Nothing, /,
  );
});
```

`previewExpression.test.ts`:

```ts
import { previewExpression } from "@/components/GraphEditor/GraphVisualization/previewExpression";
import { expect, test } from "vitest";

test("the preview applies the preprocessor to the typed expression through Standard.Base", () => {
  expect(
    previewExpression(
      {
        visualizationModule: "Standard.Visualization.Table.Visualization",
        expression: "prepare_visualization",
        positionalArgumentsExpressions: ["1000"],
      },
      "data.filter 1",
    ),
  ).toBe(
    "Standard.Base.Meta.call_module_method 'Standard.Visualization.Table.Visualization' 'prepare_visualization' [1000] _ <| data.filter 1",
  );
});
```

`formatForPath.test.ts`: the fixture "What the `get_widget_json` query for
`Data.read`'s `format` returns" becomes
`{ arguments: [['format', { widget: <the same widget object> }]] }`. Add:

```ts
test("the dropped-file query names only Standard.Base", () => {
  const { func, args } = Ast.analyzeAppLike(
    Ast.parseExpression(DATA_READ_FORMAT_WIDGET_QUERY)!,
  );
  expect(func.code()).toBe(MODULE_CALL);
  expect(args[1]!.code()).toBe("'resolve_call'");
});
```

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/util/__tests__/moduleCall.test.ts src/project-view/components/visualizations src/project-view/components/GraphEditor/GraphVisualization src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/formatForPath.test.ts
```

Expected: FAIL (new module missing; old expected strings).

- [ ] **Step 3: Implement.** `moduleCall.ts`:

```ts
/**
 * @file Expressions the IDE evaluates in a node's frame (in the user's module) that call a
 * library's IDE entry point. A fully qualified name of a library the module does not import does
 * not compile (`FullyQualifiedNames`, "an import statement for it is missing"), so they go through
 * `Standard.Base.Meta.call_module_method`: `Standard.Base` is always compiled, and the library
 * needs only to be loaded.
 */
import { Ast } from "@/util/ast";

export const MODULE_CALL = "Standard.Base.Meta.call_module_method";

/**
 * `Standard.Base.Meta.call_module_method '<moduleName>' '<methodName>' [<args>] _`: apply it to
 * the value with `<|`, as `F _ <| node` (the method gets the value first, then `args`).
 */
export function moduleCall(
  module: Ast.MutableModule,
  moduleName: string,
  methodName: string,
  args: readonly Ast.Owned<Ast.MutableExpression>[],
): Ast.Owned<Ast.MutableExpression> {
  return Ast.App.PositionalSequence(Ast.parseExpression(MODULE_CALL, module)!, [
    Ast.TextLiteral.new(moduleName, module),
    Ast.TextLiteral.new(methodName, module),
    Ast.Vector.new(module, [...args]),
    Ast.Wildcard.new(module),
  ]);
}
```

`treeExpression.ts`, `childrenExpression`:

```ts
export function childrenExpression(
  path: readonly TreeKey[],
  start: number,
  count: number,
) {
  const module = Ast.MutableModule.Transient();
  const keys = path.map((key) =>
    typeof key === "number"
      ? Ast.tryNumberToEnso(key, module)!
      : Ast.TextLiteral.new(key, module),
  );
  const call = moduleCall(module, TREE_MODULE, "children", [
    Ast.Vector.new(module, keys),
    Ast.tryNumberToEnso(start, module)!,
    Ast.tryNumberToEnso(count, module)!,
  ]);
  return (nodeId: string) =>
    Ast.OprApp.new(module, call, "<|", Ast.parseExpression(nodeId, module)!);
}
```

`TableVizDataSourceUtils.ts`: in both templates, replace the
`preprocessorModule` / `preprocessorQn` / `preprocessorInvocation` lines with:

```ts
const preprocessorInvocation = moduleCall(
  tempModule,
  visulizationModule,
  expressionString,
  positionalArgumentsExpressions,
);
```

(`positionalArgumentsExpressions` is already an array of `Owned` ASTs; drop the
`Ast.Group.new` wrapping, since vector elements need none.)

`previewExpression.ts`:

```ts
/** @file The component browser's preview: the preprocessor applied to the typed expression, in frame. */
import { Ast } from "@/util/ast";
import { moduleCall } from "@/util/moduleCall";

/** The code evaluated, in the method's frame, to preview `code` with `preprocessor`. */
export function previewExpression(
  preprocessor: {
    readonly visualizationModule: string;
    readonly expression: string;
    readonly positionalArgumentsExpressions?: readonly string[] | undefined;
  },
  code: string,
): string {
  const module = Ast.MutableModule.Transient();
  const args = (preprocessor.positionalArgumentsExpressions ?? []).map((arg) =>
    Ast.parseExpression(arg, module)!,
  );
  const call = moduleCall(
    module,
    preprocessor.visualizationModule,
    preprocessor.expression,
    args,
  );
  return Ast.OprApp.new(
    module,
    call,
    "<|",
    Ast.parseExpression(code, module)!,
  ).code();
}
```

`visualizationData.ts`, `expressionVisualizationData`: keep the
`isIdentifier(preprocessor.expression)` guard, and replace the AST building
(lines ~185-210) with:

```ts
return projectStore.executeExpression(
  dataSourceValue.contextId,
  previewExpression(
    {
      visualizationModule: preprocessor.visualizationModule,
      expression: preprocessor.expression,
      positionalArgumentsExpressions:
        preprocessor.positionalArgumentsExpressions,
    },
    dataSourceValue.expression,
  ),
);
```

`formatForPath.ts`:

```ts
/**
 * The query for `Data.read`'s `format` widget, as the `format` argument's own query asks it
 * (`widgetQuery.ts`), but in the current method's frame: a file dropped on the graph has no node to
 * hang a method-pointer visualization on. It names only `Standard.Base`, so the module needs no
 * import.
 */
export const DATA_READ_FORMAT_WIDGET_QUERY =
  "Standard.Base.Meta.call_module_method 'Standard.Base.Metadata.Widget_Query' 'resolve_call' ['Standard.Base.Data', 'Standard.Base.Data', 'read', ['format']] Nothing";

export function formatTypeForDroppedFile(
  fileName: string,
  answer: unknown,
): string | undefined {
  const parsed = widgetQueryAnswerSchema.safeParse(answer);
  if (!parsed.success) return undefined;
  const format = parsed.data.arguments.find(
    ([name]) => name === FORMAT_ARGUMENT,
  )?.[1];
  const widget = format && "widget" in format ? format.widget : undefined;
  return formatTypeForPath(fileName, widget ?? undefined);
}
```

- [ ] **Step 4: Pass**, same command as Step 2. Expected: PASS. Then
      `corepack pnpm --filter enso-gui run typecheck`: only `lsHandler.ts`
      should still fail (Task 8).

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/src/project-view/util/moduleCall.ts app/gui/src/project-view/util/__tests__/moduleCall.test.ts app/gui/src/project-view/components/visualizations app/gui/src/project-view/components/GraphEditor/GraphVisualization app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "GUI: in-frame queries reach libraries through Standard.Base.Meta.call_module_method

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Delete `Standard.Visualization.Widgets`; `column_names_json` moves

Nothing calls `get_widget_json` any more (Tasks 2 and 4), so PR 1a's kept module
and its one old-shape test go. The table expression editor's `column_names_json`
is the module's only other function; it moves beside the table view's entry
points.

**Files:**

- Delete `distribution/lib/Standard/Visualization/0.0.0-dev/src/Widgets.enso`
  and `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/Widgets.md`
- Modify `distribution/lib/Standard/Visualization/0.0.0-dev/src/Main.enso` (drop
  `export project.Widgets`)
- Modify
  `distribution/lib/Standard/Visualization/0.0.0-dev/src/Table/Visualization.enso`
  (add `column_names_json`)
- Delete `test/Visualization_Tests/src/Widgets_Spec.enso`; modify
  `test/Visualization_Tests/src/Main.enso` (drop its import and `add_specs`
  lines)
- Modify `app/gui/src/project-view/composables/tableColumns.ts` (lines 66-77)
- Create `app/gui/src/project-view/composables/__tests__/tableColumns.test.ts`
- Regenerate `distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/`

**Interfaces:**

- Removes `Standard.Visualization.Widgets.get_widget_json` and
  `Standard.Visualization.Widgets.column_names_json`.
- Produces
  `Standard.Visualization.Table.Visualization.column_names_json table -> Text`
  (same body).
- `useTableColumns` asks for it by method pointer
  `{ module: Standard.Visualization.Table.Visualization, definedOnType: Standard.Visualization.Table.Visualization, name: column_names_json }`.

- [ ] **Step 1: Failing GUI test.** `tableColumns.test.ts`; export the pointer
      from `tableColumns.ts` as `COLUMNS_METHOD` to test it:

```ts
import { COLUMNS_METHOD } from "@/composables/tableColumns";
import { expect, test } from "vitest";

test("the column names come from the table view's module, not Widgets", () => {
  expect(COLUMNS_METHOD.module.path).toBe("Table.Visualization");
  expect(COLUMNS_METHOD.definedOnType.path).toBe("Table.Visualization");
  expect(COLUMNS_METHOD.name).toBe("column_names_json");
});
```

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/composables/__tests__/tableColumns.test.ts
```

Expected: FAIL (`COLUMNS_METHOD` is not exported; its path is `Widgets`).

- [ ] **Step 2: Implement.** `tableColumns.ts`, lines 66-77:

```ts
const GET_COLUMNS_METHOD = "column_names_json" as Ast.Identifier;
const TABLE_VISUALIZATION_PATH = ProjectPath.create(
  "Standard.Visualization" as QualifiedName,
  "Table.Visualization" as QualifiedName,
);
/** `Standard.Visualization.Table.Visualization.column_names_json`. Exported for tests. */
export const COLUMNS_METHOD = {
  module: TABLE_VISUALIZATION_PATH,
  definedOnType: TABLE_VISUALIZATION_PATH,
  name: GET_COLUMNS_METHOD,
};
```

Its `visualizationModule: currentModule.value` stays. The query has no
positional arguments, so nothing compiles there, and a method-pointer
visualization loads `Standard.Visualization` itself
(`UpsertVisualizationJob.findModule` → `ensureModuleIsLoaded`).

At the end of `Visualization/src/Table/Visualization.enso`:

```enso
## ---
   private: true
   ---
   The names of a table's columns, as JSON: the table expression editor's
   column completions (`app/gui/src/project-view/composables/tableColumns.ts`).
column_names_json table = table.column_names.to_json
```

Then delete the module and its test, and drop the export and the spec's
registration:

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b rm distribution/lib/Standard/Visualization/0.0.0-dev/src/Widgets.enso distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/Widgets.md test/Visualization_Tests/src/Widgets_Spec.enso
```

- [ ] **Step 3: Pass.** The GUI test (Step 1's command) passes. Then the Enso
      side, with the API signatures regenerated:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh dist && ~/pr1b.sh enso_test Visualization_Tests 2>&1 | grep -E "tests (succeeded|failed)"; cd ~/enso-widgets-pr1b && corepack pnpm --filter build-scripts run stdlib-api-check; rsync -a --delete built-distribution/enso-engine-*/enso-*/lib/Standard/Visualization/0.0.0-dev/docs/api/ /mnt/c/Repos/Enso/ide-widgets-pr1b/distribution/lib/Standard/Visualization/0.0.0-dev/docs/api/; ~/pr1b.sh sync && corepack pnpm --filter build-scripts run stdlib-api-check && node tools/ci/check-workflows.mjs'
```

Expected:

- `Visualization_Tests`: `0 tests failed.`, one test fewer than on `develop`;
- the first API check fails on Visualization, the second passes, and
  `git status` shows only `Main.md`, `Table/Visualization.md` and the
  `Widgets.md` deletion under Visualization's `docs/api`;
- no `stdlib-test-map` error. `Visualization_Tests` still imports Visualization
  elsewhere.

Also grep that nothing still names the module:

```powershell
git -C C:\Repos\Enso\ide-widgets-pr1b grep -n "Visualization.Widgets\|get_widget_json" -- ':!docs/superpowers'
```

Expected: only `integration-test/mock/lsHandler.ts` (Task 8 rewrites it).

- [ ] **Step 4: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add -A distribution/lib/Standard/Visualization test/Visualization_Tests app/gui/src/project-view/composables
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "Delete Standard.Visualization.Widgets; column_names_json joins the table view's entry points

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Shim and GUI — GUI lines in the Logs panel

**Files:**

- Modify `app/common/src/services/engineLogs.ts` (`EngineLogSource`; new
  constants, types and functions after `PERFORMANCE_LOGGER`) and
  `app/common/src/services/__tests__/engineLogs.test.ts`
- Modify `app/project-manager-shim/src/engineLogs/channel.ts` (after `notice`,
  line ~133) and `src/engineLogs/__tests__/channel.test.ts`
- Modify `app/project-manager-shim/src/handler/engineLogs.ts` (new exports;
  `sendText`'s response type widened to
  `Pick<EventStreamResponse, 'writeHead' | 'end'>`) and
  `src/handler/__tests__/engineLogs.test.ts`
- Modify `app/electron-client/src/server.ts` (after the stream branch, line
  ~370) and `app/gui/project-manager-shim-middleware/index.ts` (after line 148)
- Create `app/gui/src/providers/engineLogAppend.ts` and
  `app/gui/src/providers/__tests__/engineLogAppend.test.ts`
- Modify `app/gui/src/project-view/components/EngineLogs/engineLogModel.ts`
  (`logOrigin`, line 209) and `__tests__/logOrigin.test.ts`

**Interfaces:**

- `enso-common` produces:
  - `EngineLogSource = 'file' | 'stderr' | 'gui'`;
  - `ENGINE_LOG_APPEND_PATH = '/api/engine-logs/append'`;
  - `GUI_WIDGETS_LOGGER = 'enso.gui.Widgets'`;
  - `GUI_PERFORMANCE_LOGGER = 'enso.gui.performance'`;
  - `type EngineLogAppendLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'`;
  - `interface EngineLogAppendBody { project: string; level: EngineLogAppendLevel; logger: string; message: string }`;
  - `parseEngineLogAppendBody(json: unknown): EngineLogAppendBody | undefined`;
  - `formatAppendedLines(body: EngineLogAppendBody, now: Date): string[]`.
- The shim produces
  `EngineLogChannel.appendGuiLines(lines: readonly string[]): void`,
  `isEngineLogAppendRequest(url: string): boolean` and
  `handleEngineLogAppend(request, response, hub, headers, now?): Promise<void>`.
  The route answers 204, or 400 (bad body), 404 (project not open), 405 (not
  POST) or 413 (over 64 KB).
- The GUI produces:
  - `appendToEngineLog(body: EngineLogAppendBody): void`;
  - `reportWidgetSchemaMismatch(project: string, method: string, issues: readonly { path: readonly (string | number)[]; message: string }[]): void`,
    deduplicated per (project, method, issues) for the window's life;
  - `reportWidgetTiming(project: string, method: string, parseMs: number, parseAndRenderMs: number): void`,
    which does nothing unless `performanceTimings` is on.
- `logOrigin('enso.gui.performance…')` is `'performance'`; `enso.gui.Widgets`
  stays `'engine'` (under `enso`).

- [ ] **Step 1: Failing tests**

`app/common/src/services/__tests__/engineLogs.test.ts`:

```ts
describe("appended GUI lines", () => {
  test("format as an entry the Logs panel parses, continuation lines raw", () => {
    const lines = formatAppendedLines(
      {
        project: "p",
        level: "WARN",
        logger: GUI_WIDGETS_LOGGER,
        message: "first\n  second",
      },
      new Date("2026-11-18T10:00:00.000Z"),
    );
    expect(lines).toEqual([
      "[WARN] [2026-11-18T10:00:00.000Z] [enso.gui.Widgets] first",
      "  second",
    ]);
  });

  test("accept only a complete body with a known level", () => {
    const body = { project: "p", level: "DEBUG", logger: "l", message: "m" };
    expect(parseEngineLogAppendBody(body)).toEqual(body);
    expect(
      parseEngineLogAppendBody({ ...body, level: "TRACE" }),
    ).toBeUndefined();
    expect(parseEngineLogAppendBody({ ...body, message: 3 })).toBeUndefined();
    expect(parseEngineLogAppendBody(null)).toBeUndefined();
  });
});
```

`channel.test.ts`:

```ts
test("appendGuiLines emits gui lines with the current session", () => {
  const log = collect();
  channel.appendGuiLines(["[WARN] [t] [enso.gui.Widgets] a", "b"]);
  expect(log.events.filter((e) => e.type === "line")).toEqual([
    expect.objectContaining({
      source: "gui",
      text: "[WARN] [t] [enso.gui.Widgets] a",
      sessionId: null,
    }),
    expect.objectContaining({ source: "gui", text: "b" }),
  ]);
});
```

(the `lines` helper's `source` parameter type widens to `EngineLogSource`).

`handler/__tests__/engineLogs.test.ts`:

```ts
class FakePostRequest implements AppendRequest {
  constructor(
    readonly url: string,
    private readonly body: string,
    readonly method = "POST",
  ) {}
  async *[Symbol.asyncIterator]() {
    yield Buffer.from(this.body);
  }
}

describe("handleEngineLogAppend", () => {
  test("adds the formatted lines to the open project and answers 204", async () => {
    const response = new FakeResponse();
    const body = JSON.stringify({
      project: projectId,
      level: "WARN",
      logger: "enso.gui.Widgets",
      message: "m",
    });
    const events: string[] = [];
    channel.subscribe({
      event: (e) => e.type === "line" && events.push(e.text),
      end: () => {},
    });
    await handleEngineLogAppend(
      new FakePostRequest(ENGINE_LOG_APPEND_PATH, body),
      response,
      hub,
      {},
      () => new Date("2026-11-18T10:00:00.000Z"),
    );
    expect(response.status).toBe(204);
    expect(events).toEqual([
      "[WARN] [2026-11-18T10:00:00.000Z] [enso.gui.Widgets] m",
    ]);
  });

  test("refuses a bad body, a closed project and GET", async () => {
    const bad = new FakeResponse();
    await handleEngineLogAppend(
      new FakePostRequest(ENGINE_LOG_APPEND_PATH, "{"),
      bad,
      hub,
      {},
    );
    expect(bad.status).toBe(400);
    const closed = new FakeResponse();
    const other = JSON.stringify({
      project: otherProjectId,
      level: "WARN",
      logger: "l",
      message: "m",
    });
    await handleEngineLogAppend(
      new FakePostRequest(ENGINE_LOG_APPEND_PATH, other),
      closed,
      hub,
      {},
    );
    expect(closed.status).toBe(404);
    const get = new FakeResponse();
    await handleEngineLogAppend(
      new FakePostRequest(ENGINE_LOG_APPEND_PATH, "", "GET"),
      get,
      hub,
      {},
    );
    expect(get.status).toBe(405);
  });
});
```

(`projectId`, `otherProjectId`, `hub` and `channel`: reuse the file's existing
stream-test setup, which opens a channel for a project directory and builds its
GUI id. Read the top of the file and use its names.)

`app/gui/src/providers/__tests__/engineLogAppend.test.ts`:

```ts
import {
  reportWidgetSchemaMismatch,
  reportWidgetTiming,
} from "$/providers/engineLogAppend";
import { setEngineLogSettings } from "$/providers/engineLogSettings";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  setEngineLogSettings({ performanceTimings: false });
});

const sentBodies = () =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));

test("a schema mismatch is appended once, on the GUI widgets logger", () => {
  const issues = [{ path: ["arguments", 0, 1], message: "Invalid input" }];
  reportWidgetSchemaMismatch(
    "project-1",
    "Standard.Table.Table.Table.join",
    issues,
  );
  reportWidgetSchemaMismatch(
    "project-1",
    "Standard.Table.Table.Table.join",
    issues,
  );
  expect(sentBodies()).toEqual([
    expect.objectContaining({
      project: "project-1",
      level: "WARN",
      logger: "enso.gui.Widgets",
    }),
  ]);
  expect(sentBodies()[0].message).toContain("arguments.0.1: Invalid input");
});

test("timings are appended only while the performance setting is on", () => {
  reportWidgetTiming("project-1", "T.m", 1.23, 4.56);
  expect(fetchMock).not.toHaveBeenCalled();
  setEngineLogSettings({ performanceTimings: true });
  reportWidgetTiming("project-1", "T.m", 1.23, 4.56);
  expect(sentBodies()).toEqual([
    expect.objectContaining({
      level: "DEBUG",
      logger: "enso.gui.performance",
      message: "Widget_Query.T.m parse~1.2ms parse+render~4.6ms",
    }),
  ]);
});
```

`logOrigin.test.ts`: add
`expect(logOrigin('enso.gui.performance')).toBe('performance')` and
`expect(logOrigin('enso.gui.Widgets')).toBe('engine')`.

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-common exec vitest run src/services/__tests__/engineLogs.test.ts
corepack pnpm --filter project-manager-shim exec vitest run src/engineLogs/__tests__/channel.test.ts src/handler/__tests__/engineLogs.test.ts
corepack pnpm --filter enso-gui exec vitest run src/providers/__tests__/engineLogAppend.test.ts src/project-view/components/EngineLogs/__tests__/logOrigin.test.ts
```

Expected: FAIL (missing exports).

- [ ] **Step 3: Implement.** `engineLogs.ts` (enso-common):

```ts
/** Where a line came from: the session's log file, the engine's stderr, or the IDE itself. */
export type EngineLogSource = "file" | "stderr" | "gui";

/** `POST`: a line of the IDE's for the open project's Logs panel (live only, not in the file). */
export const ENGINE_LOG_APPEND_PATH = "/api/engine-logs/append";
/** The IDE's widget problems (Engine source). */
export const GUI_WIDGETS_LOGGER = "enso.gui.Widgets";
/** The IDE's own timings (Performance source). */
export const GUI_PERFORMANCE_LOGGER = "enso.gui.performance";

export type EngineLogAppendLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";
const APPEND_LEVELS: readonly string[] = ["ERROR", "WARN", "INFO", "DEBUG"];

/** The body of {@link ENGINE_LOG_APPEND_PATH}. `project` is the GUI's project id. */
export interface EngineLogAppendBody {
  readonly project: string;
  readonly level: EngineLogAppendLevel;
  readonly logger: string;
  readonly message: string;
}

/** `json` as an append body, or `undefined` when it is not one. */
export function parseEngineLogAppendBody(
  json: unknown,
): EngineLogAppendBody | undefined {
  if (typeof json !== "object" || json == null) return undefined;
  const { project, level, logger, message } = json as Record<string, unknown>;
  if (
    typeof project !== "string" ||
    typeof logger !== "string" ||
    typeof message !== "string"
  )
    return undefined;
  if (typeof level !== "string" || !APPEND_LEVELS.includes(level))
    return undefined;
  return { project, level: level as EngineLogAppendLevel, logger, message };
}

/**
 * The lines an append adds: the first starts an entry, `[LEVEL] [time] [logger] text`, as the
 * engine's file lines do (`logEntry.ts`); the rest continue it.
 */
export function formatAppendedLines(
  body: EngineLogAppendBody,
  now: Date,
): string[] {
  const [first = "", ...rest] = body.message.split(/\r?\n/);
  return [
    `[${body.level}] [${now.toISOString()}] [${body.logger}] ${first}`,
    ...rest,
  ];
}
```

`channel.ts`, after `notice`:

```ts
  /** Lines the IDE adds (`POST /api/engine-logs/append`), tagged with the session found so far. */
  appendGuiLines(lines: readonly string[]): void {
    if (this.state !== 'open') return
    this.emitLines('gui', [...lines], this.sessionId)
  }
```

`handler/engineLogs.ts`:

```ts
const HTTP_STATUS_NO_CONTENT = 204;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;
/** The largest append body: a widget error with its issues is a few KB. */
const MAX_APPEND_BYTES = 64 * 1024;

/** Whether a request URL (or path) is the append route. */
export function isEngineLogAppendRequest(url: string): boolean {
  return new URL(url, "http://localhost").pathname === ENGINE_LOG_APPEND_PATH;
}

/** The slice of `http.IncomingMessage` the append route uses: its body is read as a stream. */
export interface AppendRequest extends AsyncIterable<Buffer | string> {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
}

/**
 * Serve `POST /api/engine-logs/append`: add the IDE's line to the open project's engine log, as
 * `gui` lines of the stream (live only: the session's file does not have them).
 */
export async function handleEngineLogAppend(
  request: AppendRequest,
  response: Pick<EventStreamResponse, "writeHead" | "end">,
  hub: EngineLogHub | undefined,
  headers: Readonly<Record<string, string>>,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (request.method !== "POST") {
    sendText(
      response,
      HTTP_STATUS_METHOD_NOT_ALLOWED,
      headers,
      "Only POST is allowed.",
      {
        Allow: "POST",
      },
    );
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_APPEND_BYTES) {
      sendText(
        response,
        HTTP_STATUS_PAYLOAD_TOO_LARGE,
        headers,
        "The line is too long.",
      );
      return;
    }
    chunks.push(buffer);
  }
  let body: EngineLogAppendBody | undefined;
  try {
    body = parseEngineLogAppendBody(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    body = undefined;
  }
  const projectPath = body && projectPathOf(body.project);
  if (body == null || projectPath == null) {
    sendText(
      response,
      HTTP_STATUS_BAD_REQUEST,
      headers,
      "Expected {project, level, logger, message}.",
    );
    return;
  }
  const channel = hub?.get(projectPath);
  if (channel == null) {
    sendText(
      response,
      HTTP_STATUS_NOT_FOUND,
      headers,
      "The project is not open.",
    );
    return;
  }
  channel.appendGuiLines(formatAppendedLines(body, now()));
  response.writeHead(HTTP_STATUS_NO_CONTENT, { ...headers });
  response.end();
}
```

Host wiring. In `electron-client/src/server.ts`, after the stream branch:

```ts
    } else if (isEngineLogAppendRequest(requestUrl)) {
      void handleEngineLogAppend(
        request,
        response,
        this.projectService.engineLogs,
        Object.fromEntries(COOP_COEP_CORP_HEADERS),
      )
```

In `project-manager-shim-middleware/index.ts`, after the stream branch:

```ts
    } else if (isEngineLogAppendRequest(requestPath)) {
      void handleEngineLogAppend(request, response, this.projectService?.engineLogs, COMMON_HEADERS)
```

(export both names from the shim's package entry next to
`handleEngineLogStream`, as the stream's are).

`app/gui/src/providers/engineLogAppend.ts`:

```ts
/**
 * @file Lines the IDE adds to an open project's engine log, shown in the Logs panel
 * (`POST /api/engine-logs/append`, served by the project-manager shim). Live only: the session's
 * log file does not get them. A failure to send is only a console warning.
 */
import { engineLogSettingsStore } from "$/providers/engineLogSettings";
import {
  ENGINE_LOG_APPEND_PATH,
  GUI_PERFORMANCE_LOGGER,
  GUI_WIDGETS_LOGGER,
  type EngineLogAppendBody,
} from "enso-common/src/services/engineLogs";

/** Send one entry. */
export function appendToEngineLog(body: EngineLogAppendBody): void {
  void fetch(ENGINE_LOG_APPEND_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((response) => {
      if (!response.ok)
        console.warn("The engine log refused a line.", response.status);
    })
    .catch((error) =>
      console.warn("Could not add a line to the engine log.", error),
    );
}

const reportedMismatches = new Set<string>();

/**
 * The engine answered a widget query the IDE cannot read (a schema mismatch between
 * `Widget_Query.resolve_call` and `widgetQueryAnswerSchema`): console and Logs panel, once per
 * project, method and issues.
 */
export function reportWidgetSchemaMismatch(
  project: string,
  method: string,
  issues: readonly {
    readonly path: readonly (string | number)[];
    readonly message: string;
  }[],
): void {
  const described = issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  const key = [project, method, ...described].join("|");
  if (reportedMismatches.has(key)) return;
  reportedMismatches.add(key);
  console.error("Unable to parse widget configuration.", method, issues);
  appendToEngineLog({
    project,
    level: "WARN",
    logger: GUI_WIDGETS_LOGGER,
    message: [
      `The IDE could not read the widget configuration of ${method}:`,
      ...described.map((d) => `    ${d}`),
    ].join("\n"),
  });
}

/** How long the IDE took to read and draw a widget answer, while performance timings are on. */
export function reportWidgetTiming(
  project: string,
  method: string,
  parseMs: number,
  parseAndRenderMs: number,
): void {
  if (!engineLogSettingsStore.getState().performanceTimings) return;
  appendToEngineLog({
    project,
    level: "DEBUG",
    logger: GUI_PERFORMANCE_LOGGER,
    message: `Widget_Query.${method} parse~${parseMs.toFixed(1)}ms parse+render~${parseAndRenderMs.toFixed(1)}ms`,
  });
}
```

`engineLogModel.ts` `logOrigin`, after the `PERFORMANCE_LOGGER` line:

```ts
if (underRoot(loggerName, GUI_PERFORMANCE_LOGGER)) return "performance";
```

- [ ] **Step 4: Pass** (same three commands), then typecheck all three packages:

```powershell
corepack pnpm --filter enso-common --filter project-manager-shim --filter enso-gui --filter enso run typecheck
```

Expected: PASS. If a `switch` over `EngineLogSource` somewhere is now
non-exhaustive, typecheck names it: treat `'gui'` like `'file'`.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/common/src/services app/project-manager-shim/src app/electron-client/src/server.ts app/gui/project-manager-shim-middleware/index.ts app/gui/src/providers/engineLogAppend.ts app/gui/src/providers/__tests__/engineLogAppend.test.ts app/gui/src/project-view/components/EngineLogs
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "Logs panel: the IDE can add lines (POST /api/engine-logs/append)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: GUI — report schema mismatches and time the parse and render

**Files:**

- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/widgetFunctionCallInfo.ts`
  (`widgetConfiguration`, from Task 2)
- Modify
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts`
  (two tests)

**Interfaces:**

- Consumes `reportWidgetSchemaMismatch` and `reportWidgetTiming` (Task 6).
- Internal:
  `parsedAnswer: ComputedRef<{ kind: 'answer'; answer: WidgetQueryAnswer; startedAt: number; parseMs: number } | { kind: 'mismatch'; issues: ZodIssue[] } | { kind: 'failed'; error: ResultError } | undefined>`.
- The method is described as `<definedOnType>.<name>`, from the method pointer.

**Hook.** The answer is parsed when `widgetConfiguration` is first read, which
is when the node re-renders after the answer arrives. A `flush: 'post'` watcher
on the parsed answer runs after that render has updated the DOM, so
`performance.now() - startedAt` is the parse and the render together.

- [ ] **Step 1: Failing tests** (in `widgetFunctionCallInfo.test.ts`)

```ts
vi.mock("$/providers/engineLogAppend", () => ({
  reportWidgetSchemaMismatch: vi.fn(),
  reportWidgetTiming: vi.fn(),
}));

test("an answer the IDE cannot read is reported once, and the call keeps its pending widgets", async () => {
  const { reportWidgetSchemaMismatch } =
    await import("$/providers/engineLogAppend");
  const data = ref<Result<unknown> | null>(Ok([["arg", "not the new shape"]]));
  const info = setUpCallInfo(
    "local.Project.Type.method val1 val2",
    method,
    data,
  ); // helper below
  expect(info.widgetConfiguration().parameters.get("arg")?.kind).toBe(
    "Pending",
  );
  await nextTick();
  expect(reportWidgetSchemaMismatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(reportWidgetSchemaMismatch).mock.calls[0]![1]).toBe(
    "local.Project.Type.method",
  );
});

test("a readable answer is timed after it renders", async () => {
  const { reportWidgetTiming } = await import("$/providers/engineLogAppend");
  const data = ref<Result<unknown> | null>(
    Ok({ arguments: [["arg", { widget: null }]] }),
  );
  const info = setUpCallInfo(
    "local.Project.Type.method val1 val2",
    method,
    data,
  );
  info.widgetConfiguration();
  await nextTick();
  expect(reportWidgetTiming).toHaveBeenCalledWith(
    "project-id",
    "local.Project.Type.method",
    expect.any(Number),
    expect.any(Number),
  );
});
```

`setUpCallInfo` factors out the existing test's setup: the `parseWithSpans`
call, the `GraphDb` stub, a project stub whose `useVisualizationData` returns
`data` and whose `assetId` is `'project-id'`, and `projectNames`. It returns
`{ widgetConfiguration: () => application.value?.widgetCfg … }`. If
`useWidgetFunctionCallInfo` does not return the configuration, return it: add
`widgetConfiguration` to its return object (WidgetFunction.vue ignores it). Run
it inside `effectScope().run(...)` so the watchers are collected.

- [ ] **Step 2: Fail**

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/widgetFunctionCallInfo.test.ts
```

Expected: FAIL (`reportWidgetSchemaMismatch` not called).

- [ ] **Step 3: Implement** in `useWidgetFunctionCallInfo`:

```ts
const queryMethod = computed(() => {
  const pointer = methodCallInfo.value?.methodCall.methodPointer;
  if (!pointer) return "";
  return `${toValue(projectNames).serializeProjectPathForBackend(pointer.definedOnType)}.${pointer.name}`;
});

const parsedAnswer = computed(() => {
  const data = visualizationData.value;
  if (data == null) return undefined;
  if (!data.ok) return { kind: "failed" as const, error: data.error };
  const startedAt = performance.now();
  const parsed = widgetQueryAnswerSchema.safeParse(data.value);
  const parseMs = performance.now() - startedAt;
  return parsed.success
    ? { kind: "answer" as const, answer: parsed.data, startedAt, parseMs }
    : { kind: "mismatch" as const, issues: parsed.error.issues };
});

// Side effects of an answer, outside the computed: the reports, and the timing once the
// node has rendered it (`flush: 'post'` runs after the DOM update).
watch(
  parsedAnswer,
  (parsed) => {
    const projectId = toValue(project).assetId;
    if (parsed?.kind === "failed")
      parsed.error.log("Cannot load dynamic configuration");
    else if (parsed?.kind === "mismatch")
      reportWidgetSchemaMismatch(projectId, queryMethod.value, parsed.issues);
    else if (parsed?.kind === "answer")
      reportWidgetTiming(
        projectId,
        queryMethod.value,
        parsed.parseMs,
        performance.now() - parsed.startedAt,
      );
  },
  { flush: "post" },
);

const widgetConfiguration = computed(() => {
  const parsed = parsedAnswer.value;
  if (parsed?.kind === "answer")
    return functionCallFromAnswer(parsed.answer, inheritedConfig.value);
  const parameters: FunctionCall["parameters"] = new Map(
    inheritedConfig.value?.parameters ?? [],
  );
  annotatedArguments.value?.forEach((name) => {
    if (parameters.get(name) == null) parameters.set(name, pending());
  });
  return { kind: "FunctionCall", parameters } satisfies FunctionCall;
});
```

Add `watch` to the `vue` import, and the two reporters from
`$/providers/engineLogAppend`.

- [ ] **Step 4: Pass** (same command), then
      `corepack pnpm --filter enso-gui run typecheck`.

- [ ] **Step 5: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "GUI: log unreadable widget answers and time their parse and render

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Playwright — mocks and the new specs

**Files:**

- Modify `app/gui/integration-test/mock/lsHandler.ts`:
  - imports (lines 1-10);
  - `mockVizPreprocessors` (drop
    `Standard.Visualization.Widgets.get_widget_json`; rename the
    `column_names_json` key to
    `Standard.Visualization.Table.Visualization.column_names_json`);
  - `slotPreprocessorKey` and `slotPositionalArgs` (lines ~767-812);
  - `maybeRespondToSlot` (~880).
- Modify `app/gui/integration-test/mock/localApi.ts`: `engineLogAppends` call
  tracking and route (beside the stream route, line ~995).
- Modify `app/gui/integration-test/project-view/widgets.spec.ts`: three tests in
  `Dynamic configuration updates`, one assertion in `Autoscoped constructors`.

**Interfaces:**

- The mock routes widget queries by method name, as before (`.read`,
  `.Group_By`). It reads the name from `resolve_call`'s third argument, in both
  forms: the method pointer, and the in-frame `call_module_method`.
- It wraps an old-shape configuration (an array of pairs, as specs push today)
  into `{"arguments":[[name,{"widget":w}]]}`, so existing specs need no change.
  A spec that wants an error pushes the new shape itself.
- Exports `lastWidgetQueryArguments(method: string): string[] | undefined`, the
  positional arguments of the last query for `.name`.

- [ ] **Step 1: Mock changes** (`lsHandler.ts`)

```ts
import {
  RESOLVE_CALL,
  WIDGET_QUERY_MODULE,
} from "@/components/GraphEditor/widgets/WidgetFunction/consts";
import { MODULE_CALL } from "@/util/moduleCall";

/** The text of an Enso text literal's code, or `undefined`. */
function textOf(code: string | undefined): string | undefined {
  const ast = code != null ? Ast.parseExpression(code) : undefined;
  return ast instanceof Ast.TextLiteral ? ast.rawTextContent : undefined;
}

/** `call_module_method '<module>' '<method>' [args…] <value>`: its parts, with the value first. */
function moduleCallParts(
  inFrame: string,
): { module: string; method: string; args: string[] } | undefined {
  const exprAst = Ast.parseExpression(inFrame);
  if (!exprAst) return undefined;
  const { func, args } = Ast.analyzeAppLike(exprAst);
  if (func.code() !== MODULE_CALL) return undefined;
  const module = textOf(args[0]?.code());
  const method = textOf(args[1]?.code());
  const vector = args[2];
  if (module == null || method == null || !(vector instanceof Ast.Vector))
    return undefined;
  const value = args[3]?.code() ?? "_";
  return {
    module,
    method,
    args: [value, ...[...vector.values()].map((v) => v.code())],
  };
}

const lastWidgetQueries = new Map<string, string[]>();
/** Test entry point: the arguments of the last widget query for `.name` (after the subject). */
export function lastWidgetQueryArguments(method: string): string[] | undefined {
  return lastWidgetQueries.get(method);
}

/** The widget query's key, `.name`, from `resolve_call`'s arguments after the subject. */
function widgetQueryKey(args: readonly string[]): string | null {
  const name = textOf(args[2]);
  if (name == null) return null;
  lastWidgetQueries.set(`.${name}`, [...args]);
  return `.${name}`;
}

function slotPreprocessorKey(request: VisRequestPreprocessor): string | null {
  const expression = request.expression;
  if (typeof expression === "string")
    return `${request.visualizationModule}.${expression}`;
  if ("inFrame" in expression) {
    const call = moduleCallParts(expression.inFrame);
    if (call) {
      if (call.module === WIDGET_QUERY_MODULE && call.method === RESOLVE_CALL)
        return widgetQueryKey(call.args.slice(1));
      return `${call.module}.${call.method}`;
    }
    const exprAst = Ast.parseExpression(expression.inFrame);
    if (!exprAst) return null;
    const { func } = Ast.analyzeAppLike(exprAst);
    if (!(func instanceof Ast.PropertyAccess && func.lhs)) return null;
    return `${func.lhs.code()}.${func.rhs.code()}`;
  }
  if (
    expression.module === WIDGET_QUERY_MODULE &&
    expression.name === RESOLVE_CALL
  )
    return widgetQueryKey(request.positionalArgumentsExpressions ?? []);
  return `${expression.definedOnType}.${expression.name}`;
}

function slotPositionalArgs(request: VisRequestPreprocessor): string[] {
  if (
    typeof request.expression === "object" &&
    "inFrame" in request.expression
  ) {
    const call = moduleCallParts(request.expression.inFrame);
    if (call) return call.args;
    const exprAst = Ast.parseExpression(request.expression.inFrame);
    if (!exprAst) return [];
    return Ast.analyzeAppLike(exprAst).args.map((ast) => ast.code());
  }
  return request.positionalArgumentsExpressions ?? [];
}

/** Whether a request is a widget query (either form). */
function isWidgetQuery(request: VisRequestPreprocessor): boolean {
  const expression = request.expression;
  if (typeof expression === "object" && "inFrame" in expression)
    return expression.inFrame.includes(`'${RESOLVE_CALL}'`);
  return typeof expression === "object" && expression.name === RESOLVE_CALL;
}

/** An old-shape widget configuration (`[[name, widget]]`) as the new answer; anything else as is. */
function asWidgetAnswer(bytes: Uint8Array): Uint8Array {
  const json = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(json)) return bytes;
  return encodeJSON({
    arguments: json.map(([name, widget]) => [name, { widget }]),
  });
}
```

In `maybeRespondToSlot`, the direct-query guard becomes
`isWidgetQuery(request) && 'inFrame' in request.expression && !isMethodBodyId(…)`
(written with the `typeof … === 'object'` narrowing as before), and the answer
becomes:

```ts
const bytes = responseBytesFor(key, slotPositionalArgs(request));
if (bytes)
  writeSlotResponse(
    slot,
    isWidgetQuery(request) ? asWidgetAnswer(bytes) : bytes,
  );
```

In `updateVisualizationData`'s rewrite of existing slots, apply `asWidgetAnswer`
the same way for widget-query slots. `treeChildren` keeps reading
`params[1..3]`: `moduleCallParts` gives `[node, path, start, count]`, as
`analyzeAppLike` did.

`localApi.ts`: add `engineLogAppends: array<EngineLogAppendBody>()` to
`INITIAL_CALLS_OBJECT`, and the route:

```ts
await page.route(ENGINE_LOG_APPEND_PATH, async (route, request) => {
  const body = parseEngineLogAppendBody(request.postDataJSON());
  if (body) called("engineLogAppends", body);
  return route.fulfill({ status: body ? 204 : 400 });
});
```

- [ ] **Step 2: The new tests** (in `widgets.spec.ts`, inside
      `test.describe('Dynamic configuration updates', …)`)

```ts
test("A widget whose query failed shows the error and stays editable", async ({
  page,
  localApi,
  editorPage,
}) => {
  const node = await dataReadNodeWithMethodCallInfo(editorPage);
  await node.click();
  await localApi.updateVisualization(".read", {
    arguments: [
      [
        "format",
        { error: { step: "annotation", message: "No formats today" } },
      ],
    ],
  });
  const formatArg = node
    .locator(".WidgetTopLevelArgument")
    .filter({ has: page.getByText("format") });
  const marker = formatArg.getByTestId("widget-query-error");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute(
    "aria-label",
    "No widget: No formats today",
  );
  // Still editable: the format's static tags give the fallback dropdown.
  const dropdown = new DropDownLocator(formatArg);
  await formatArg.click();
  await dropdown.expectVisible();
  await expect(dropdown.items.first()).toBeVisible();
});

test("An answer the IDE cannot read reaches the Logs panel", async ({
  page,
  localApi,
  editorPage,
}) => {
  const calls = localApi.trackCalls();
  const node = await dataReadNodeWithMethodCallInfo(editorPage);
  await node.click();
  await localApi.updateVisualization(".read", { arguments: "not a list" });
  await expect
    .poll(() => calls.engineLogAppends.map((entry) => entry.logger))
    .toContain("enso.gui.Widgets");
  await expect(page.locator(".WidgetTopLevelArgument")).toHaveCount(3);
});
```

In `Autoscoped constructors`, after the existing checks:

```ts
// The nested autoscoped constructor's widgets are asked for by method pointer, with the
// constructor's type as the subject.
expect(lastWidgetQueryArguments(".Group_By")).toEqual([
  "'Standard.Table.Aggregate_Column'",
  "'Standard.Table.Aggregate_Column.Aggregate_Column'",
  "'Group_By'",
  expect.any(String),
  expect.any(String),
  "True",
]);
```

(`Group_By` must have an annotated argument in the mock suggestions for the
query to be made. If `lastWidgetQueryArguments('.Group_By')` is `undefined`, use
the `aggregate` node's `.aggregate` query, a static call through `Table`, and
assert its module, type and `'False'`. Say which one in the commit.)

The dropped-file case is `dataReadImports.spec.ts` as it stands: it pushes
`.read` and drops a file. It passes only if the mock routes the new in-frame
query, so run it unchanged.

- [ ] **Step 3: Run on Linux**, in the Linux clone (pnpm never runs in WSL on
      the Windows worktree)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh pnpm_ready && cd ~/enso-widgets-pr1b/app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/widgets.spec.ts integration-test/project-view/dataReadImports.spec.ts integration-test/project-view/tableVisualisation.spec.ts integration-test/project-view/engineLogs.spec.ts --workers=2 --repeat-each=3'
```

Expected: all pass, 3 of 3 runs. A timing-sensitive failure is judged against
develop with the same command in `~/enso` (root CLAUDE.md), not by one run. Then
the whole project-view suite once:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'cd ~/enso-widgets-pr1b/app/gui && corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view --workers=2'
```

Expected: same failures as develop (compare with `~/enso`), no new ones. Any
screenshot diff is from the marker only if a mocked answer has an error. None
does outside the new test, so expect none.

- [ ] **Step 4: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/gui/integration-test
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "Playwright: widget queries by method pointer, a failing widget, an unreadable answer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: The template, the samples and `samples.test.ts` drop `import Standard.Visualization`

**Files:**

- Modify `lib/scala/pkg/src/main/resources/default/src/Main.enso` (line 5, the
  id map and the snapshot)
- Modify
  `app/electron-client/samples/{Getting_Started,Local_Database,Orders_And_Customers,Sales_Overview,Text_Cleaning}/src/Main.enso`
- Modify `app/electron-client/tests/headless/samples.test.ts` (the import test,
  ~line 95)
- Modify `app/electron-client/globalSetup.ts` (`TEMPLATE_MAIN`, line 33)
- Scratch (not committed): `<scratchpad>/remove-line.mjs`

**Interfaces:** Consumes Task 4 (nothing in a frame names
`Standard.Visualization`). Produces files whose ids and stored layout are
unchanged.

What does not change, with the evidence:

- `imports.test.ts` uses `Standard.Visualization` only as an arbitrary library
  name in the import-editing tests.
- `tableColumns.ts` keeps `visualizationModule: currentModule`, but its query
  has no positional arguments.
- The default-visualization query evaluates in `Standard.Visualization.Id`
  (`visualizationData.ts:78`).
- `perf/projectTemplates.ts`'s image project and the GUI mock project are test
  fixtures, not templates.
- `classifyTemplate` (`perf/openTimeReport.ts:779`) still classifies the
  template as `core`, since `CORE_LIBRARIES` is "may import".

- [ ] **Step 1: Flip the sample test**

```ts
// Since the widget queries and the in-frame visualization queries name only `Standard.Base`
// (#<PR>), a sample needs no import of the IDE-only `Standard.Visualization`.
test.each(samples)(
  "%s imports Standard.Base and Standard.Table, and not Standard.Visualization",
  (sample) => {
    const main = code(sample);
    expect(main).toMatch(/^from Standard\.Base import all$/m);
    expect(main).toMatch(/^from Standard\.Table import all$/m);
    expect(main).not.toMatch(/^import Standard\.Visualization$/m);
  },
);
```

```powershell
corepack pnpm --filter enso exec vitest run tests/headless/samples.test.ts
```

Expected: FAIL for all five samples.

- [ ] **Step 2: The line-removing script** (scratch:
      `C:\Users\jdunk\AppData\Local\Temp\claude\e9eef8f2aeadec5d\6a1eae2e-0e79-4c7e-8418-77de21fcd343\scratchpad\remove-line.mjs`)

```js
// Remove one line from the code of an Enso file with a `#### METADATA ####` trailer, keeping
// every other AST's id: entries inside the line go, entries after it move up, an entry spanning it
// shrinks, and a `snapshot` (the deflated code, #482) is rewritten.
import fs from "node:fs";
import zlib from "node:zlib";

const META_TAG = "\n\n\n#### METADATA ####";
const [file, line] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");
const split = text.lastIndexOf(META_TAG);
if (split < 0) throw new Error(`${file}: no metadata`);
const code = text.slice(0, split);
const [idMapJson, metadataJson] = text
  .slice(split + META_TAG.length)
  .trim()
  .split("\n");
const removed = `${line}\n`;
const start = code.indexOf(removed);
if (start < 0 || code.indexOf(removed, start + 1) >= 0)
  throw new Error(`${file}: line not found once`);
const end = start + removed.length;
const shift = removed.length;
const idMap = JSON.parse(idMapJson)
  .filter(([span]) => span.index.value < start || span.index.value >= end)
  .map(([span, id]) => {
    const index = span.index.value;
    const size = span.size.value;
    if (index >= end)
      return [{ index: { value: index - shift }, size: { value: size } }, id];
    if (index + size > start)
      return [{ index: { value: index }, size: { value: size - shift } }, id];
    return [span, id];
  });
const metadata = JSON.parse(metadataJson);
const newCode = code.slice(0, start) + code.slice(end);
if (metadata.ide?.snapshot != null)
  metadata.ide.snapshot = zlib
    .deflateSync(Buffer.from(newCode, "utf8"))
    .toString("base64");
fs.writeFileSync(
  file,
  `${newCode}${META_TAG}\n${JSON.stringify(idMap)}\n${JSON.stringify(metadata)}`,
);
console.log(`${file}: removed at ${start}, ${shift} characters`);
```

- [ ] **Step 3: Apply it**

```powershell
$s = 'C:\Users\jdunk\AppData\Local\Temp\claude\e9eef8f2aeadec5d\6a1eae2e-0e79-4c7e-8418-77de21fcd343\scratchpad\remove-line.mjs'
cd C:\Repos\Enso\ide-widgets-pr1b
node $s lib/scala/pkg/src/main/resources/default/src/Main.enso 'import Standard.Visualization'
foreach ($p in 'Getting_Started','Local_Database','Orders_And_Customers','Sales_Overview','Text_Cleaning') { node $s "app/electron-client/samples/$p/src/Main.enso" 'import Standard.Visualization' }
```

Expected: the template reports `removed at 120, 30 characters`; each sample
reports its offset (61, 127, 61, 61, 61). `git diff --stat` shows six
`Main.enso` files changed.

- [ ] **Step 4: Prove the template's id map is canonical and its welcome node
      keeps its id.** The regeneration run must change nothing:

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh pnpm_ready && cd ~/enso-widgets-pr1b && UPDATE_TEMPLATE_ID_MAP=1 corepack pnpm --filter ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts -t "full id map" && git diff --quiet -- lib/scala/pkg/src/main/resources/default/src/Main.enso && echo UNCHANGED; corepack pnpm --filter ydoc-server exec vitest run src/__tests__/languageServerSession.test.ts -t "new-project template"'
```

Expected: `UNCHANGED` (the clone has the edited file from `sync`; `git diff`
there compares with the clone's HEAD, so first commit or compare by hash against
the Windows copy: `sha256sum` of both must match). Then the two template tests
pass:

- "opens with the welcome node's id and its visualization shown";
- "opens without an edit to the Language Server".

If the regeneration changed the map, an id was lost. Read the diff: an entry the
script should have shifted.

- [ ] **Step 5: Keep `globalSetup.ts` in step with the template** (its comment
      says so): drop `import Standard.Visualization` from `TEMPLATE_MAIN` and
      from the comment's list (line 6).

- [ ] **Step 6: Samples still run and open without an edit**

```powershell
corepack pnpm --filter enso exec vitest run tests/headless/samples.test.ts
```

Expected: PASS (all sample tests). Then run each sample on the engine, per
`samples/CLAUDE.md` ("Checking a sample runs"):

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh dist && rm -rf /tmp/samples && mkdir -p /tmp/samples/projects && cp -r ~/enso-widgets-pr1b/app/electron-client/samples /tmp/samples/projects/Samples && cd /tmp/samples/projects/Samples && for s in Getting_Started Local_Database Orders_And_Customers Sales_Overview Text_Cleaning; do echo "== $s"; ENSO_DATA_DIRECTORY=/tmp/samples/enso-data ~/enso-widgets-pr1b/built-distribution/enso-engine-*/enso-*/bin/enso --run "$PWD/$s" 2>&1 | tail -3; done'
```

Expected: each prints its result, no compile error (no sample's code names
`Standard.Visualization`).

- [ ] **Step 7: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add lib/scala/pkg/src/main/resources/default/src/Main.enso app/electron-client/samples app/electron-client/tests/headless/samples.test.ts app/electron-client/globalSetup.ts
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "New projects and samples no longer import Standard.Visualization

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: End to end — a new project's widgets work without the import

**Files:**

- Modify `app/electron-client/tests/gettingStarted.spec.ts` (start of
  `Exercise 1`)

**Interfaces:** Consumes the packaged IDE built from the branch. The exercises
exercise:

- `Data.read`'s widgets;
- the Excel workbook's table view (rows paged from the engine) and its sheet
  link;
- `set`'s `Simple_Expression` dropdown (a function-of-`self` annotation);
- `filter`'s column dropdowns.

All of them run in a new project without the import, so they cover the real
engine.

- [ ] **Step 1: The assertion** (after `await createNewProject(page)` in
      Objective 1)

```ts
// A new project imports only the core libraries: not the IDE-only Standard.Visualization,
// which the widget and visualization queries no longer need (#<PR>).
const projectMain = await newProjectMain(projectsDir);
expect(projectMain).not.toMatch(/^import Standard\.Visualization$/m);
expect(projectMain).toMatch(/^from Standard\.Base import all$/m);
```

with, at the top of the file:

```ts
/** The `Main.enso` of the one project created in `projectsDir` (the samples aside). */
async function newProjectMain(projectsDir: string): Promise<string> {
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const project = entries.find(
    (entry) => entry.isDirectory() && entry.name !== "Samples",
  );
  if (!project) throw new Error(`No new project in ${projectsDir}`);
  return fs.readFile(
    path.join(projectsDir, project.name, "src", "Main.enso"),
    "utf8",
  );
}
```

(`import fs from 'node:fs/promises'`, `import path from 'node:path'`.)

- [ ] **Step 2: Run on Linux** (a packaged IDE from the Linux clone; `ide-local`
      builds the engine, the GUI and the package)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh sync && cd ~/enso-widgets-pr1b && corepack pnpm --filter build-scripts run ide-local && corepack pnpm --filter enso ide-integration-test tests/gettingStarted.spec.ts tests/samples.spec.ts'
```

Expected: all pass (`Exercise 1`, `Exercise 2`, the fresh-install test, and the
sample-open tests). A failure that mentions
`Fully qualified name references a library Standard.Visualization` names an
in-frame expression Task 4 missed. Grep `app/gui/src` for
`'Standard.Visualization.` in strings built into in-frame code.

- [ ] **Step 3: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add app/electron-client/tests/gettingStarted.spec.ts
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "Getting Started: a new project has no Visualization import and its widgets work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: CLAUDE.md updates

**Files and content** (each a short paragraph in the file's existing style):

- `distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md` (written by PR 1a):
  change "The GUI moves to it in PR 1b" to say the GUI calls `resolve_call` by
  method pointer, and the in-frame queries go through `call_module_method`.
- `distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md`:
  - remove `src/Widgets.enso` from "supporting IDE utilities";
  - `Table/Visualization.enso` also has `column_names_json`;
  - say that the GUI calls Visualization's entry points by method pointer, or in
    frame through `Standard.Base.Meta.call_module_method`, never by a fully
    qualified name, so no user module needs the import.
- `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`:
  - new bullet "Widget queries": `WidgetFunction/widgetQuery.ts` (method
    pointer, literal arguments, `subjectIsType`), the answer schema,
    `functionCallFromAnswer`, `FunctionCall.errors`;
  - `WidgetQueryError.vue` (priority 2, the `WidgetQueryErrorKey` set only on
    failure, the fallback chosen as with no answer), the mismatch report and the
    timing hook (Task 7);
  - update `formatForPath.ts`'s paragraph: `DATA_READ_FORMAT_WIDGET_QUERY` is
    now the in-frame `call_module_method` of `resolve_call`.
- `app/gui/src/project-view/components/EngineLogs/CLAUDE.md`:
  - the `gui` source: live only, not in the file nor in Download;
  - `enso.gui.Widgets` is Engine; `enso.gui.performance` is Performance.
- `app/gui/src/project-view/stores/visualization/CLAUDE.md`: an expression a
  visualization evaluates in frame (`executeExpression`) must reach its library
  through `moduleCall` (`@/util/moduleCall`), never by fully qualified name.
  This applies to library-shipped visualizations too.
- `app/project-manager-shim/CLAUDE.md`, "Engine logs": the append route, its
  limits and statuses, both hosts.
- `app/electron-client/samples/CLAUDE.md`, "House style":
  - imports are `from Standard.Base import all`,
    `from Standard.Table import all` and what the sample needs; **not**
    `Standard.Visualization`;
  - and how to remove a line without losing the layout (the shifting script's
    rule, since there is no snapshot).
- `app/electron-client/CLAUDE.md`: the sentence #597 added (samples must import
  Visualization) is removed.
- `lib/scala/pkg/CLAUDE.md`, the template gotcha: after removing or inserting
  lines, shift the id map's spans and re-deflate the `snapshot` first (Decision
  5), then run `UPDATE_TEMPLATE_ID_MAP=1`, which must then change nothing.

- [ ] **Step 1: Write them**, then format:

```powershell
corepack pnpm exec prettier --write distribution/lib/Standard/Base/0.0.0-dev/CLAUDE.md distribution/lib/Standard/Visualization/0.0.0-dev/CLAUDE.md app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md app/gui/src/project-view/components/EngineLogs/CLAUDE.md app/gui/src/project-view/stores/visualization/CLAUDE.md app/project-manager-shim/CLAUDE.md app/electron-client/samples/CLAUDE.md app/electron-client/CLAUDE.md lib/scala/pkg/CLAUDE.md
```

- [ ] **Step 2: Commit**

```bash
git -C C:\Repos\Enso\ide-widgets-pr1b add -- '*CLAUDE.md'
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "CLAUDE.md: widget queries, in-frame calls through Base, GUI log lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Verify everything, open the PR, attach screenshots

- [ ] **Step 1: Whole checks, on Linux** (caches cleared, per root CLAUDE.md)

```bash
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh pnpm_ready && cd ~/enso-widgets-pr1b && find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete && find . -name ".eslintcache" -not -path "*/node_modules/*" -delete && corepack pnpm -r --filter enso-gui --filter enso-common --filter project-manager-shim --filter enso --filter ydoc-server run typecheck && corepack pnpm --filter enso-gui run lint && corepack pnpm --filter enso-gui run test:unit && corepack pnpm --filter enso-common --filter project-manager-shim --filter enso --filter ydoc-server exec vitest run'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh sbt_run "scalafmtCheckAll; javafmtCheckAll; scalafmtSbtCheck" "runtime-integration-tests/testOnly org.enso.interpreter.test.MethodLookupTest org.enso.interpreter.test.AnyOrStaticTest org.enso.interpreter.test.ExtensionMethodResolutionTest"'
wsl -d Ubuntu-24.04 -e bash -lc '~/pr1b.sh dist && for s in Base_Tests Table_Tests SQLite_Tests Geo_Tests Format_Discovery_Tests Visualization_Tests Examples_Tests; do echo "== $s"; ~/pr1b.sh enso_test $s 2>&1 | grep -E "tests (succeeded|failed)"; done && cd ~/enso-widgets-pr1b && corepack pnpm --filter build-scripts run stdlib-api-check && node tools/ci/check-workflows.mjs'
```

Expected: all green; each suite `0 tests failed.`, with the counts on `develop`
(after PR 1a), less the one `Visualization_Tests` test Task 5 deleted.

Then on Windows, to catch path or Vue-SFC differences between the hosts:

```powershell
corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor/widgets src/providers
```

State in the PR what was **not** run:

- the Postgres-backed parts of `Postgres_Tests` (only the discovery spec);
- `gatherLicenses` (no dependency changed);

- [ ] **Step 2: Open the PR as a draft, to get its number `<N>`** (the changelog
      entry and the screenshots need it). Write `pr1b-body.md` (Step 5) first.

```powershell
git -C C:\Repos\Enso\ide-widgets-pr1b push -u origin widgets/pr1b-gui-method-pointers
gh pr create --repo jdunkerley/enso --draft --base develop --head widgets/pr1b-gui-method-pointers --title "Widgets PR 1b: widget queries by method pointer, errors shown, no Visualization import" --body-file <scratchpad>/pr1b-body.md
```

No `CI: No changelog needed` label: this PR has a changelog entry (Step 3).

- [ ] **Step 3: The changelog entry.** The error marker is something users see,
      so the PR takes an entry, not the label (root CLAUDE.md). In
      `CHANGELOG.md`, under `# Next Release` → `#### Enso IDE`, add the first
      bullet, in the existing `- [Description][NNN]` form, written for someone
      reading release notes:

```markdown
- [Widgets show why they could not load, instead of disappearing: a warning
  marker on the argument gives the reason, the argument stays editable, and the
  Logs panel has the details. New projects no longer import
  `Standard.Visualization`.][<N>]
```

and its link definition as the first line of the link block after the IDE
bullets (above `[822]: https://github.com/jdunkerley/enso/pull/822` today):

```markdown
[<N>]: https://github.com/jdunkerley/enso/pull/<N>
```

```powershell
corepack pnpm exec prettier --write CHANGELOG.md
git -C C:\Repos\Enso\ide-widgets-pr1b add CHANGELOG.md
git -C C:\Repos\Enso\ide-widgets-pr1b commit -m "Changelog: widgets show why they could not load

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C C:\Repos\Enso\ide-widgets-pr1b push
```

Expected: the `Changelog` check passes on the next run (the entry names `<N>`).

- [ ] **Step 4: Screenshots** (the marker is visible; repo rule: before/after on
      the orphan `pr-screenshots` branch). Write a throwaway spec in scratch,
      not committed: `<scratchpad>/capture.spec.ts`, a copy of the "A widget
      whose query failed…" test that ends with
      `await node.screenshot({ path: process.env.SHOT! })`. Run it in `~/enso`
      (develop, where the answer's error is unreadable, so the argument shows no
      marker and no widget) and in `~/enso-widgets-pr1b`:

```bash
wsl -d Ubuntu-24.04 -e bash -lc 'for c in enso enso-widgets-pr1b; do cp /mnt/c/Users/jdunk/AppData/Local/Temp/claude/e9eef8f2aeadec5d/6a1eae2e-0e79-4c7e-8418-77de21fcd343/scratchpad/capture.spec.ts ~/$c/app/gui/integration-test/project-view/zz-capture.spec.ts && (cd ~/$c/app/gui && SHOT=/tmp/$c.png corepack pnpm exec playwright test --project="Integration Tests" integration-test/project-view/zz-capture.spec.ts); rm ~/$c/app/gui/integration-test/project-view/zz-capture.spec.ts; done'
```

Then, with the draft's number `<N>`:

```powershell
git -C C:\Repos\Enso\ide fetch origin pr-screenshots
git -C C:\Repos\Enso\ide worktree add C:\Repos\Enso\ide-pr-screenshots pr-screenshots
New-Item -ItemType Directory -Force C:\Repos\Enso\ide-pr-screenshots\pr-<N>
wsl -d Ubuntu-24.04 -e bash -lc 'cp /tmp/enso.png /mnt/c/Repos/Enso/ide-pr-screenshots/pr-<N>/before.png && cp /tmp/enso-widgets-pr1b.png /mnt/c/Repos/Enso/ide-pr-screenshots/pr-<N>/after.png'
git -C C:\Repos\Enso\ide-pr-screenshots add pr-<N>
git -C C:\Repos\Enso\ide-pr-screenshots commit -m "Screenshots for #<N>"
git -C C:\Repos\Enso\ide-pr-screenshots push origin pr-screenshots
git -C C:\Repos\Enso\ide worktree remove C:\Repos\Enso\ide-pr-screenshots
```

- [ ] **Step 5: The PR body, then mark it ready.** `pr1b-body.md`:

```markdown
PR 1b of
[Widgets by conversion](docs/superpowers/specs/2026-11-18-widgets-by-conversion-design.md),
on top of PR 1a (`Standard.Base.Metadata.Widget_Query.resolve_call`,
`Standard.Base.Meta.call_module_method`).

## What changes

- **Every widget query calls PR 1a's `Widget_Query.resolve_call` by method
  pointer**: the normal path, static calls, nested autoscoped constructors
  (which compiled text before). Its arguments are literals, so nothing is
  compiled in the user's module. The dropped-file `format` query calls it in the
  method's frame through `Standard.Base.Meta.call_module_method`, because there
  is no node to attach to.
- **Errors are shown.** A warning marker with the message sits on the argument,
  which still offers the fallback widget. The engine already logs each failure
  once (PR 1a). An answer the GUI cannot read is logged to the Logs panel
  (Engine) through a new shim route, `POST /api/engine-logs/append`.
- **GUI timing** under Settings → Local → Engine logs → Performance timings: the
  parse and render time of each widget answer.
- **No `import Standard.Visualization`** in new projects or samples. The JSON
  tree's pages, the table view's server rows and distinct values, and the
  component browser's preview also named Visualization by fully qualified name
  in the user's frame. They now go through
  `Standard.Base.Meta.call_module_method`.
- `Standard.Visualization.Widgets` is deleted, with PR 1a's test of its old
  shape. `column_names_json` moved to
  `Standard.Visualization.Table.Visualization`.
- Changelog entry under Enso IDE.

## Screenshots

| Before (develop)                                                                              | After                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ![before](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-<N>/before.png) | ![after](https://raw.githubusercontent.com/jdunkerley/enso/pr-screenshots/pr-<N>/after.png) |

## Evidence

- Playwright runs (Task 8): `widgets.spec.ts`, `dataReadImports.spec.ts`,
  `tableVisualisation.spec.ts`, `engineLogs.spec.ts`, 3 of 3.
- Electron Getting Started and samples (Task 10) on a packaged IDE, with a new
  project that has no Visualization import.
- The template's id-map regeneration left the file unchanged (Task 9 Step 4).

## Not verified

- The Postgres-backed parts of `Postgres_Tests`.
- `gatherLicenses` (no dependency changed).

## Out of scope

`Widget.resolve_type` (PR 3, needs PR 0's `X.type` conversions); resolvers,
`search` and the removal of `cache` (PR 6).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Fill in `<N>` and the screenshots, then mark the draft ready:

```powershell
gh pr edit <N> --repo jdunkerley/enso --body-file <scratchpad>/pr1b-body.md
gh pr ready <N> --repo jdunkerley/enso
```

- [ ] **Step 6: After merge**: remove the worktree (not with
      `gh pr merge --delete-branch` while it is checked out) and
      `rm -rf ~/enso-widgets-pr1b` in WSL.

---

## Self-review: every PR 1b requirement and its task

| Requirement                                                                      | Task              |
| -------------------------------------------------------------------------------- | ----------------- |
| Consumes PR 1a's `resolve_call` answer; zod schema                               | 1                 |
| Normal path, static/autoscoped fallback, nested autoscoped by method pointer     | 2, 8              |
| `visualizationModule` decided                                                    | 2; Decision 1     |
| GUI shows the error on the argument, fallback still offered                      | 3, 8              |
| In-frame queries need no import (tree, table rows, preview, dropped file)        | 4; Decisions 2, 3 |
| `Standard.Visualization.Widgets` (wrapper and its test) deleted                  | 5                 |
| GUI schema mismatch reaches the Logs panel (route proposed and built)            | 6, 7; Decision 4  |
| GUI parse (and render) timing                                                    | 7                 |
| Playwright: failing widget, static/autoscoped call, file drop, unreadable answer | 8                 |
| Template (id map, snapshot), samples, `samples.test.ts` flipped                  | 9; Decision 5     |
| Other Visualization dependencies checked with evidence                           | 4, 9; Decision 2  |
| New project has no import and its widgets work (real engine)                     | 10                |
| CLAUDE.md                                                                        | 11                |
| Changelog entry (draft PR first for the number), screenshots, PR                 | 12                |
