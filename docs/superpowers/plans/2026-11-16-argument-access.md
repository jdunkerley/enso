# Argument access (the `…` menu and Pop out) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every call on a node gets a `…` menu that adds the parameters it is
not showing, and dragging an argument's value off a node pops it out into a new
node wired back by an edge.

**Architecture:** Pop out is a pure code transformation (`popOut/autoscope.ts`,
`popOut/expectedTypes.ts`) plus one module edit that creates the node and
replaces the argument with a reference, done through a new same-edit hook on
`createNodes`. The drag is routed in `GraphNode.vue`: a drag that starts inside
a port marked `data-pop-out-port` (set by `WidgetPort.vue`) pops out instead of
moving the node. The `…` menu is a small component rendered by
`WidgetFunction.vue` after each call, listing the call's hidden
`ArgumentPlaceholder`s and inserting a picked one through the existing
`applyArgUpdate`.

**Tech Stack:** Vue 3, TypeScript, Vitest, Playwright; the GUI's `Ast` module
(`@/util/ast`), call tree (`@/util/callTree`), widget registry.

**Spec:**
`docs/superpowers/specs/2026-11-16-argument-access-and-time-widgets-design.md`
(part A).

## Global Constraints

- Pop out is **only** a drag: no menu entry anywhere. Dragging an argument does
  nothing else (it no longer moves the node). Dragging an edge's end is
  unchanged.
- Eligible arguments: an argument (`ArgumentInfoKey` set) whose value is an AST
  expression that is not a placeholder, not a plain identifier (`Ast.Ident`,
  e.g. a reference to another node or `self`), and not a wildcard `_`.
- Dropping back on the node, or pressing Escape during the drag, cancels it.
- The new node is `<name> = <expression>` at the drop position; `<name>` comes
  from `generateLocallyUniqueIdent` with the argument's name as prefix (`end` →
  `end1`).
- Node creation and the argument's replacement are **one** module edit (one undo
  step).
- Every auto-scoped constructor in the expression (`..Month`) is written as
  `<Type>.<Constructor>` (`Date_Period.Month`) using the expected type at its
  position; if any cannot be resolved, nothing is changed and a toast says which
  one.
- Imports the new node needs are added (`addDetectedImports`, already called by
  `createNodes`).
- The `…` shows only when the call has at least one hidden parameter
  (`ArgumentPlaceholder` with `hideByDefault`) and the node is not showing all
  arguments (`tree.showDetails` false). Picking one inserts it **named** with
  its default value's code.
- The menu follows the dropdown style used by the pickers
  (`activityDropdownStyles`, teleported to `popoverRoot`, as in
  `WidgetPicker/PickerShell.vue`).
- Repo rules: `corepack pnpm`; stage explicit paths only; never `git stash`,
  `git add -A`, `--no-verify`. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A `CHANGELOG.md` entry under `#### Enso IDE` (visible feature).

## File map

| File (under `app/gui/src/project-view/`)                              | Responsibility                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `composables/nodeCreation.ts`                                         | `createNodes(options, inSameEdit?)`: optional hook run inside the same edit    |
| `components/GraphEditor/popOut/autoscope.ts`                          | `qualifyAutoscoped`: rewrite `..X` to `Type.X` given expected types            |
| `components/GraphEditor/popOut/expectedTypes.ts`                      | `expectedTypesIn`: the expected type of each argument inside an expression     |
| `components/GraphEditor/popOut/popOut.ts`                             | `popOutCode` (pure) and `usePopOut` (the edit, the toast)                      |
| `components/GraphEditor/popOut/CLAUDE.md`                             | what pop out does and where the pieces are                                     |
| `components/GraphEditor/widgets/WidgetPort.vue`                       | mark eligible ports with `data-pop-out-port`                                   |
| `components/GraphEditor/GraphNode.vue`                                | route a drag from a marked port to pop out; ghost; Escape; drop-on-node cancel |
| `components/GraphEditor/GraphNodes.vue`, `components/GraphEditor.vue` | pass the `popOut` event up and call `usePopOut`                                |
| `components/GraphEditor/widgets/WidgetFunction/hiddenParameters.ts`   | `hiddenParameters(application)`: the list for the `…` menu                     |
| `components/GraphEditor/widgets/WidgetFunction/ParameterMenu.vue`     | the `…` button and its menu                                                    |
| `components/GraphEditor/widgets/WidgetFunction.vue`                   | render `ParameterMenu`, insert the picked parameter                            |
| `components/GraphEditor/widgets/CLAUDE.md`                            | document the `…` menu and the pop-out port marker                              |
| `app/gui/integration-test/project-view/argumentAccess.spec.ts`        | Playwright: the `…` menu, Pop out                                              |
| `CHANGELOG.md`                                                        | entry                                                                          |

Run unit tests from `app/gui`: `corepack pnpm exec vitest run <path>`.
Typecheck: `corepack pnpm run typecheck`. Lint:
`corepack pnpm exec eslint <paths>`. In a fresh worktree run
`corepack pnpm install` then `corepack pnpm -r compile` first (stale workspace
packages break Vitest's config load).

---

### Task 1: `createNodes` runs an optional hook in the same edit

**Files:**

- Modify: `app/gui/src/project-view/composables/nodeCreation.ts` (`createNodes`,
  ~line 119)
- Test: `app/gui/src/project-view/composables/__tests__/nodeCreation.test.ts`

**Interfaces:**

- Produces:
  `createNodes(nodesOptions: Iterable<NodeCreationOptions>, inSameEdit?: (edit: Ast.MutableModule, identifiers: readonly Ast.Identifier[]) => void): Set<NodeId>`
  — `identifiers` are the created nodes' names, in the order of `nodesOptions`.
  `provideNodeCreation`/`injectNodeCreation` expose it unchanged (same
  function).

- [ ] **Step 1: Write the failing test**

Read `nodeCreation.test.ts` first and reuse its setup (how it builds the module
store, graph store and calls `useNodeCreation`). Add:

```ts
test("createNodes runs inSameEdit inside the same edit, with the new identifiers", () => {
  // (setup as the file's existing createNodes tests)
  const seen: Ast.Identifier[][] = [];
  let edits = 0;
  // wrap the mock module store's `edit` so the test counts calls
  const { createNodes } = useNodeCreation(
    countingModuleStore(() => edits++),
    graphStore,
    viewport,
    mousePos,
    () => {},
  );
  createNodes(
    [
      {
        placement: { type: "fixed", position: Vec2.Zero },
        expression: "Date.new 2020 1 15",
        binding: "end",
      },
    ],
    (_edit, identifiers) => seen.push([...identifiers]),
  );
  expect(edits).toBe(1);
  expect(seen).toEqual([["end1"]]);
});
```

(`countingModuleStore` is a small helper in the test file wrapping the existing
mock's `edit` and incrementing a counter; write it next to the test.)

- [ ] **Step 2: Run it, expect FAIL** (the hook is never called):
      `corepack pnpm exec vitest run src/project-view/composables/__tests__/nodeCreation.test.ts`

- [ ] **Step 3: Implement**

In `createNodes`: collect the identifiers as they are created
(`const identifiers: Ast.Identifier[] = []`, push `ident` after
`getIdentifier`), and after `insertNodeStatements(...)` and before
`return Ok()`, call `inSameEdit?.(edit, identifiers)`. Add the parameter with a
doc comment: "Runs inside the edit that creates the nodes, after they are
inserted, so a caller's own change is the same undo step."

- [ ] **Step 4: Run it, expect PASS**; also the whole file.

- [ ] **Step 5: Commit**

```bash
git add app/gui/src/project-view/composables/nodeCreation.ts app/gui/src/project-view/composables/__tests__/nodeCreation.test.ts
git commit -m "GUI: createNodes can run a caller's change in the same edit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Qualify auto-scoped constructors

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/popOut/autoscope.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/popOut/__tests__/autoscope.test.ts`

**Interfaces:**

- Produces:

```ts
/** What `qualifyAutoscoped` needs to know: does `typeQn` (fully qualified) have a constructor `name`? */
export type HasConstructor = (typeQn: string, name: string) => boolean;

/**
 * The expression's code with each auto-scoped constructor (`..Month`, including the head of an
 * application such as `..Week Day_Of_Week.Sunday`) written as `<Type>.<Constructor>`, where
 * `<Type>` is the last segment of the type expected at that position. `expectedTypes` maps an
 * AST id to the expected type there (as the language server reports it, e.g.
 * `Standard.Base.Data.Time.Date_Period.Date_Period`, or a union `A | B`); the type of an
 * auto-scoped name is looked up at the name itself, then at its enclosing application.
 * For a union, the member that `hasConstructor` confirms is used.
 * Returns `Err(name)` naming the first constructor whose type cannot be determined.
 */
export function qualifyAutoscoped(
  expr: Ast.Expression,
  expectedTypes: ReadonlyMap<Ast.AstId, string>,
  hasConstructor: HasConstructor,
): Result<string, string>;
```

(`Result`, `Ok`, `Err` from `enso-common/src/utilities/data/result`.)

- [ ] **Step 1: Write the failing tests**

```ts
import { Ast } from "@/util/ast";
import { describe, expect, test } from "vitest";
import { qualifyAutoscoped } from "../autoscope";

const DATE_PERIOD = "Standard.Base.Data.Time.Date_Period.Date_Period";
const PERIOD = "Standard.Base.Data.Time.Period.Period";
const ctors: Record<string, string[]> = {
  [DATE_PERIOD]: ["Year", "Month", "Week", "Day"],
  [PERIOD]: ["Value"],
};
const has = (t: string, n: string) => ctors[t]?.includes(n) ?? false;

function parse(code: string) {
  const expr = Ast.parseExpression(code)!;
  return expr;
}

describe("qualifyAutoscoped", () => {
  test("a bare auto-scoped value", () => {
    const e = parse("..Month");
    expect(qualifyAutoscoped(e, new Map([[e.id, DATE_PERIOD]]), has)).toEqual(
      Ok("Date_Period.Month"),
    );
  });
  test("the head of an application, typed at the application", () => {
    const e = parse("..Week Day_Of_Week.Sunday");
    expect(qualifyAutoscoped(e, new Map([[e.id, DATE_PERIOD]]), has)).toEqual(
      Ok("Date_Period.Week Day_Of_Week.Sunday"),
    );
  });
  test("a union picks the member with the constructor", () => {
    const e = parse("..Month");
    expect(
      qualifyAutoscoped(
        e,
        new Map([[e.id, `${PERIOD} | ${DATE_PERIOD}`]]),
        has,
      ),
    ).toEqual(Ok("Date_Period.Month"));
  });
  test("nested, typed by the argument it sits in", () => {
    const e = parse("d.up_to e step=..Month");
    let id: Ast.AstId | undefined;
    Ast.visitRecursive(e, (a) => {
      if (a instanceof Ast.AutoscopedIdentifier) id = a.id;
      return true;
    });
    expect(qualifyAutoscoped(e, new Map([[id!, DATE_PERIOD]]), has)).toEqual(
      Ok("d.up_to e step=Date_Period.Month"),
    );
  });
  test("no expected type: Err with the name", () => {
    const e = parse("..Month");
    expect(qualifyAutoscoped(e, new Map(), has)).toEqual(Err("..Month"));
  });
  test("no auto-scoped names: the code unchanged", () => {
    const e = parse("Date.new 2020 1 15");
    expect(qualifyAutoscoped(e, new Map(), has)).toEqual(
      Ok("Date.new 2020 1 15"),
    );
  });
});
```

(Import `Ok`/`Err` from `enso-common/src/utilities/data/result`.)

- [ ] **Step 2: Run, expect FAIL** (module missing):
      `corepack pnpm exec vitest run src/project-view/components/GraphEditor/popOut`

- [ ] **Step 3: Implement**

Copy the expression into a new module (`Ast.copyIntoNewModule(expr)`), collect
its `Ast.AutoscopedIdentifier`s with `Ast.visitRecursive`, and for each:

1. The type: `expectedTypes.get(original id)`, else the expected type of its
   parent when the parent is an `Ast.App` whose `function` is this identifier.
   Keep a map from the copy's ids to the original's (walk both trees in
   parallel, or look types up on the original before copying: collect
   `(identifierCode position, type)` first, then rewrite the copy in the same
   visit order — choose whichever is simpler; the copy keeps the same shape).
2. Split the type on `|`, trim each member, and choose the first member for
   which `hasConstructor(member, name)` is true; a single type is used as is (no
   `hasConstructor` check needed).
3. Replace the identifier with `Ast.parseExpression('<last segment>.<name>')`
   (`qnLastSegment` from `@/util/qualifiedName` for the last segment).

Return `Ok(copy.code())`, or `Err('..' + name)` at the first failure.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**
      `git add app/gui/src/project-view/components/GraphEditor/popOut/autoscope.ts app/gui/src/project-view/components/GraphEditor/popOut/__tests__/autoscope.test.ts`
      — message "GUI: write auto-scoped constructors in full for a given
      expected type".

---

### Task 3: The expected type of each argument inside an expression

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/popOut/expectedTypes.ts`
- Test:
  `app/gui/src/project-view/components/GraphEditor/popOut/__tests__/expectedTypes.test.ts`

**Interfaces:**

- Consumes: `interpretCall`, `ArgumentApplication`, `ArgumentAst`,
  `getMethodCallInfoRecursively` from `@/util/callTree`.
- Produces:

```ts
/**
 * The expected type at `root` (`rootType`, the dragged argument's own) and at every argument
 * of every call inside it whose method call info the graph database has, keyed by the
 * argument value's AST id.
 */
export function expectedTypesIn(
  root: Ast.Expression,
  rootType: string | undefined,
  graphDb: { getMethodCallInfo(id: Ast.AstId): MethodCallInfo | undefined },
): Map<Ast.AstId, string>;
```

- [ ] **Step 1: Write the failing test**

Use `mockSuggestion.ts`
(`app/gui/src/providers/openedProjects/suggestionDatabase/mockSuggestion.ts`) to
build a method entry with two arguments (`end : Date`, `step : Date_Period`),
and a fake `graphDb` whose `getMethodCallInfo` returns
`{ methodCall: { methodPointer, notAppliedArguments: [] }, suggestion }` for the
call's AST id. Read `callTree`'s existing tests
(`app/gui/src/project-view/util/__tests__/callTree.test.ts`) for how they
construct `MethodCallInfo` and copy that.

```ts
test("the root and each argument of a known call", () => {
  const e = Ast.parseExpression("d.up_to e step=..Month")!;
  const types = expectedTypesIn(
    e,
    "Root_Type",
    fakeDb(e /* the App root */, upToEntry),
  );
  expect(types.get(e.id)).toBe("Root_Type");
  const stepValue = findAutoscoped(e);
  expect(types.get(stepValue.id)).toBe(
    "Standard.Base.Data.Time.Date_Period.Date_Period",
  );
});

test("calls without info contribute nothing", () => {
  const e = Ast.parseExpression("foo ..Month")!;
  const types = expectedTypesIn(e, undefined, {
    getMethodCallInfo: () => undefined,
  });
  expect(types.size).toBe(0);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

Start the map with `root.id → rootType` when defined. Visit `root` with
`Ast.visitRecursive`; for each `Ast.App` or `Ast.OprApp` node that is the top of
its application chain (its parent is not an `Ast.App` whose `function` is this
node), get `getMethodCallInfoRecursively(node, graphDb)`; if present, build
`ArgumentApplication.FromInterpretedWithInfo(interpretCall(node), { suggestion: info.suggestion, notAppliedArguments: info.methodCall.notAppliedArguments })`,
and if that is an `ArgumentApplication`, for each application in
`iterApplications()` whose `argument` is an `ArgumentAst` with
`argInfo.reprType`, set `argument.ast.id → argInfo.reprType`. (Read
`ArgumentAst` in `callTree.ts` for the field holding the argument's AST.)

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** both files — "GUI: the
      expected type of each argument inside an expression".

---

### Task 4: The pop-out edit

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/popOut/popOut.ts`
- Create: `app/gui/src/project-view/components/GraphEditor/popOut/CLAUDE.md`
- Test:
  `app/gui/src/project-view/components/GraphEditor/popOut/__tests__/popOut.test.ts`

**Interfaces:**

- Consumes: Task 1's `createNodes(options, inSameEdit)`, Task 2's
  `qualifyAutoscoped`, Task 3's `expectedTypesIn`.
- Produces:

```ts
/** Whether a widget input is an argument that can be popped out (Global Constraints). */
export function canPopOut(input: WidgetInput): boolean;

/** The code of the node a popped-out argument becomes, or Err with the unresolved name. */
export function popOutCode(
  arg: Ast.Expression,
  argType: string | undefined,
  graphDb: { getMethodCallInfo(id: Ast.AstId): MethodCallInfo | undefined },
  hasConstructor: HasConstructor,
): Result<string, string>;

/** The pop-out action: `popOut(portId, scenePosition)`; shows a toast on failure. */
export function usePopOut(deps: {
  module: ToValue<ModuleStore>;
  graph: ToValue<GraphStore>;
  suggestionDb: ToValue<SuggestionDb>;
  createNodes: NodeCreation["createNodes"];
}): {
  popOut(
    portId: Ast.AstId,
    argName: string,
    argType: string | undefined,
    position: Vec2,
  ): void;
};
```

- [ ] **Step 1: Write the failing tests** for `canPopOut` and `popOutCode`:

```ts
test.each([
  ["Date.new 2020 1 15", true],
  ["..Month", true],
  ["42", true],
  ["date1", false], // a reference
  ["_", false],
])("canPopOut(%s) is %s", (code, expected) => {
  const ast = Ast.parseExpression(code)!;
  const input = {
    ...WidgetInput.FromAst(ast),
    [ArgumentInfoKey]: { info: argInfo("end"), appKind: 0 },
  };
  expect(canPopOut(input as WidgetInput)).toBe(expected);
});

test("canPopOut is false for a placeholder and for a non-argument", () => {
  expect(
    canPopOut(WidgetInput.FromAst(Ast.parseExpression("Date.today")!)),
  ).toBe(false);
  // a placeholder input: WidgetInput.isPlaceholder → false
});

test("popOutCode qualifies the root", () => {
  const e = Ast.parseExpression("..Month")!;
  expect(popOutCode(e, DATE_PERIOD, noInfo, has)).toEqual(
    Ok("Date_Period.Month"),
  );
});
```

(Read `ArgumentInfoKey`'s value type in `callTree.ts` to build a valid fake;
`argInfo` builds a `SuggestionEntryArgument` as `mockSuggestion.ts` does.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

- `canPopOut`:
  `input[ArgumentInfoKey] != null && !WidgetInput.isPlaceholder(input) && input.value instanceof Ast.Ast && !(input.value instanceof Ast.Ident) && !(input.value instanceof Ast.Wildcard)`.
- `popOutCode`:
  `qualifyAutoscoped(arg, expectedTypesIn(arg, argType, graphDb), hasConstructor)`.
- `usePopOut().popOut`: look the argument up (`module.ast?.get(portId)`, must be
  an expression); `hasConstructor` = the suggestion database has an entry at
  `<typeQn>.<name>` of kind constructor (read
  `SuggestionDb.getEntryByProjectPath` and `ProjectPath` in `@/util/projectPath`
  for building the path from a qualified name). On `Err(name)`: show a toast
  "Can't pop out: the type of `<name>` is not known." (use the GraphEditor
  toasts, `components/GraphEditor/toasts.ts`, read how other actions raise one).
  On `Ok(code)`:
  `createNodes([{ placement: { type: 'fixed', position }, expression: code, binding: argName }], (edit, [ident]) => edit.getVersion(arg).replace(Ast.Ident.new(edit, ident)))`.
  `createNodes` adds the needed imports (`addDetectedImports`).

Write `popOut/CLAUDE.md`: one paragraph on what Pop out does (spec link), the
three files and their one-line responsibilities, and that the drag is routed in
`GraphNode.vue` from ports marked `data-pop-out-port`.

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** the three files — "GUI:
      popping an argument out into a node".

---

### Task 5: The drag

**Files:**

- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetPort.vue`
- Modify: `app/gui/src/project-view/components/GraphEditor/GraphNode.vue`
  (`useClickableDraggable` at ~line 254; the `.content` div at ~line 565)
- Modify: `app/gui/src/project-view/components/GraphEditor/GraphNodes.vue`,
  `app/gui/src/project-view/components/GraphEditor.vue` (wire the event to
  `usePopOut`)

**Interfaces:**

- Consumes: Task 4's `canPopOut`, `usePopOut().popOut`.
- Produces: `WidgetPort` root gets `data-pop-out-port="<portId>"`,
  `data-pop-out-name="<argument name>"` and `data-pop-out-type="<reprType>"`
  when `canPopOut(props.input)`; `GraphNode` emits
  `popOut: [portId: Ast.AstId, argName: string, argType: string | undefined, scenePosition: Vec2]`.

- [ ] **Step 1: Mark eligible ports.** In `WidgetPort.vue`, compute
      `const popOut = computed(() => canPopOut(props.input) ? { port: props.input.portId, name: props.input[ArgumentInfoKey]!.info.name, type: props.input.expectedType } : undefined)`
      and bind `:data-pop-out-port="popOut?.port"`,
      `:data-pop-out-name="popOut?.name"`, `:data-pop-out-type="popOut?.type"`
      on the root div (Vue drops attributes bound to `undefined`).

- [ ] **Step 2: Route the drag in `GraphNode.vue`.**
  - On `pointerdown` of the `.content` div (add a handler before
    `v-on="pointerEvents"` runs, e.g. `@pointerdown.capture`), record
    `popOutSource = (event.target as Element).closest<HTMLElement>('[data-pop-out-port]')?.dataset`
    (port, name, type) or `undefined`.
  - In `useClickableDraggable`'s `dragMove`: if `popOutSource`, update a
    `popOutGhostOffset` ref with the offset and do **not** emit `dragging`.
  - `dragCommit`: if `popOutSource`, compute the drop's scene position (node
    position + the last offset + the pointer's offset inside the port; the
    navigator's `sceneMousePos` is simpler:
    `injectGraphNavigator().sceneMousePos`). If that position is inside this
    node's rect (`graph.nodeRects.get(nodeId)`), do nothing; else emit
    `popOut(port, name, type, position)`. Clear `popOutSource`. Otherwise keep
    the existing `draggingCommited`.
  - `dragCancel` and Escape (a `keydown` listener on `window` while
    `popOutSource` is set, removed on end): clear `popOutSource` and the ghost;
    Escape must also stop the drag from committing (set a `cancelled` flag that
    `dragCommit` checks).
  - Click behaviour is unchanged: `useClickableDraggable` still sends `click`
    when there was no significant move, so selecting a node by clicking an
    argument and the widgets' own clicks still work.
  - The ghost: while `popOutSource` and the move is significant, render a small
    absolutely-positioned element in the node (class `popOutGhost`) showing the
    argument's code (`module.ast.get(port)?.code()`, truncated to 40 chars),
    translated by `popOutGhostOffset`, with the node's colours and
    `pointer-events: none`.

- [ ] **Step 3: Wire up.** `GraphNodes.vue` forwards `popOut` with the node id
      as it forwards `createNodes`; `GraphEditor.vue` creates
      `const { popOut } = usePopOut({ module, graph: graphStore, suggestionDb, createNodes })`
      next to `provideNodeCreation` (~line 265) and handles the event.

- [ ] **Step 4: Typecheck and lint** (`corepack pnpm run typecheck`; eslint on
      the changed files). Expected: clean.

- [ ] **Step 5: Commit** the four files — "GUI: dragging an argument off a node
      pops it out".

(The drag is covered by Playwright in Task 7; the logic it calls is unit-tested
in Tasks 2–4.)

---

### Task 6: The `…` menu

**Files:**

- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/hiddenParameters.ts`
- Create:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/ParameterMenu.vue`
- Modify:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction.vue`
- Test:
  `app/gui/src/project-view/components/GraphEditor/widgets/WidgetFunction/__tests__/hiddenParameters.test.ts`

**Interfaces:**

- Produces:

```ts
export interface HiddenParameter {
  /** The placeholder's port, the `origin` of the update that inserts it. */
  portId: PortId;
  name: string;
  /** The short type: the last segment of each union member, joined with ` | `. */
  type: string | undefined;
  /** The code inserted: the default value's code. */
  defaultCode: string;
}

/** The call's parameters that are not shown: placeholders hidden by default, in parameter order. */
export function hiddenParameters(
  application: ArgumentApplication | Ast.Expression,
): HiddenParameter[];
```

- [ ] **Step 1: Write the failing test** — build an `ArgumentApplication` for
      `Date_Time.new 2020 1 15` with a suggestion entry whose arguments are
      `year month day hour minute second zone` (`hour`…`zone` with defaults;
      copy how `callTree.test.ts` builds applications with placeholders) and
      expect the hidden list `['hour', 'minute', 'second', 'zone']` with types
      `Integer`…`Time_Zone` and `defaultCode` `0`…`Time_Zone.system`. Also: an
      `Ast.Expression` (not an application) gives `[]`; an argument with
      `display: Always` dynamic config is not listed (it is not hidden).

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `hiddenParameters`**: for an `ArgumentApplication`,
      iterate `iterApplications()`, keep
      `argument instanceof ArgumentPlaceholder && argument.hideByDefault && argument.argInfo.defaultValue != null`,
      map to `HiddenParameter`, and reverse to parameter order (the iteration
      runs from the outermost application inwards).

- [ ] **Step 4: `ParameterMenu.vue`**: props
      `{ parameters: HiddenParameter[] }`, emits `pick: [HiddenParameter]`. A
      `…` button (class `parameterMenuButton`, `aria-label="More parameters"`,
      `@pointerdown.stop` so it neither drags nor selects the node) toggles a
      menu teleported to `popoverRoot`, positioned with `activityDropdownStyles`
      (copy the setup from `WidgetPicker/PickerShell.vue` lines 26–60 and
      127–131). Each entry is a `button` with the name and, right-aligned and
      dimmed, the short type. Picking emits `pick` and closes; Escape and a
      click outside close. Style the button like the pickers' chips
      (`--color-widget` background, the node's text colour, rounded).

- [ ] **Step 5: Use it in `WidgetFunction.vue`**: compute
      `const hidden = computed(() => tree.showDetails ? [] : hiddenParameters(application.value))`
      (`injectWidgetTree` if not already injected), render
      `<ParameterMenu v-if="hidden.length" :parameters="hidden" @pick="insertParameter" />`
      after the `NodeWidget` in the template (wrap both in a `widgetParent` span
      if the template has a single root), and:

```ts
function insertParameter(p: HiddenParameter) {
  applyArgUpdate({
    portUpdate: { origin: p.portId, value: p.defaultCode },
    directInteraction: true,
  });
}
```

`applyArgUpdate` already inserts a placeholder's value, named when
`insertAsNamed` (check in the Playwright test of Task 7 that a parameter after
an unset one comes out named; if not, set the name explicitly for hidden
parameters in `applyArgUpdate`'s placeholder branch).

- [ ] **Step 6: Run the unit test, typecheck, lint.** Expected: PASS, clean.

- [ ] **Step 7: Commit** the four files — "GUI: a … menu adds the parameters a
      call is not showing".

---

### Task 7: Playwright, docs, changelog, screenshots, PR

**Files:**

- Create: `app/gui/integration-test/project-view/argumentAccess.spec.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor/widgets/CLAUDE.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Playwright.** Read `widgets.spec.ts` and
      `actions.ts`/`locate.ts` in `app/gui/integration-test/project-view/` for
      the mock project, how a node is placed (`mockMethodCallInfo`,
      `expressionUpdates.ts`) and how code is asserted. Tests:
  1. `…` adds a parameter: a node calling a mocked method with a hidden
     defaulted argument shows `…`; clicking it and the entry adds the argument
     (the node's code ends with `name=<default>`), and the `…` disappears when
     none are left.
  2. Pop out: a node `days = date1.days_until (Date.new 2020 1 15)` (mock the
     call info so `end` is an argument); drag the `Date.new …` value 200px down
     and drop; expect a new node `end1 = Date.new 2020 1 15`, the first node's
     code `date1.days_until end1`, and an edge between them; one `Ctrl+Z`
     restores the original code.
  3. Escape cancels: start the same drag, press Escape, release: the code is
     unchanged and the node did not move.
  4. Clicking an argument (no drag) still selects the node.
  5. Dragging the function name still moves the node.

     Run:
     `corepack pnpm exec playwright test integration-test/project-view/argumentAccess.spec.ts`
     (from `app/gui`); run it three times (timing-sensitive suite, root
     `CLAUDE.md`). Expected: all pass every time.

- [ ] **Step 2: Docs.** In `widgets/CLAUDE.md`, add a short "Argument access"
      section: the `…` menu (`WidgetFunction/ParameterMenu.vue`,
      `hiddenParameters.ts`) and the pop-out marker on `WidgetPort`
      (`data-pop-out-port`), pointing at `popOut/CLAUDE.md`.

- [ ] **Step 3: Changelog** under `# Next Release` → `#### Enso IDE`:

```
- [Drag an argument's value off a node to turn it into a node of its own,
  connected back by an edge. A … after a component's arguments adds any of the
  parameters it is not showing.][NNN]
```

with a link definition; `NNN` is replaced with the PR number after opening.

- [ ] **Step 4: Verify everything:** the unit tests of Tasks 1–6; the GUI's full
      Vitest (`corepack pnpm exec vitest run`) once; typecheck; lint on the
      changed files; the Playwright spec; and on Linux (WSL, per root
      `CLAUDE.md`) the unit tests and `prettier --check` of the changed files.

- [ ] **Step 5: Screenshots** (standing rule): before/after images of a node
      with the `…` menu open and of a popped-out node with its edge, pushed to
      the orphan `pr-screenshots` branch and linked in the PR.

- [ ] **Step 6: Commit and open the PR** against `develop`, title "Argument
      access: drag a value out to a node, and a … menu for hidden parameters";
      body: what, the spec link, tests run where, screenshots. Replace `NNN`.
      Build installers (IDE Packaging dispatch, `macos=true`) for the owner's
      test; merge only after the owner's OK.
