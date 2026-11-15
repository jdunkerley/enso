# MCP edit and app tools (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An external agent can build in the IDE: create or open a project, add,
edit, remove and group nodes, comment them, show visualizations, and navigate,
with its changes undoable in one step and a version saved first.

**Architecture:** Tool definitions are added to the main-process registry and
forwarded to the window as in PR 1. In the window, project edit tools run
through one edit session (a queue, the Live refusal, an undo hold, the version
save, and waiting for execution to settle) and are pure functions over injected
dependencies that `GraphEditor.vue` supplies. App tools (projects and files) are
handlers registered by the app shell, which is always mounted.

**Tech Stack:** TypeScript, Electron main (`app/electron-client`), Vue 3
(`app/gui`), Yjs undo manager, `@modelcontextprotocol/sdk` 1.30, Zod 3, Vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`

**Builds on:** PR 1 (#782,
`docs/superpowers/plans/2026-11-15-mcp-read-tools-pr1.md`). Read
`app/electron-client/src/mcp/CLAUDE.md` and
`app/gui/src/project-view/mcp/CLAUDE.md` first.

## Changes from the spec, decided with the owner or by the controller

- `create_project`, `open_project`, `close_project`, `list_projects`,
  `list_files` and `get_app_state` are in this PR (the owner's first session
  needed a new project and had to write one to disk).
- The activity feed moves to the chat-panel PR, where its panel is.
- App tools run in the window, not in main: only the window knows the Drive's
  root directory and can open a project tab.
- `create_project` takes no template: the dashboard's create path has none.

## Global Constraints

- The existing AI agent (`app/electron-client/src/ai/`, the GUI's AI mode) is
  not changed.
- No tool sets the execution environment, triggers Write, deletes a project or
  file, or touches settings or secrets.
- Every edit tool is refused while the project is in Live mode, with exactly:
  `The project is in Live mode. Edits by an agent are refused there. Ask the user to switch the project back to Design.`
  Read tools and navigation tools still work.
- Edits by one caller share one undo step until 10 s pass without an edit call
  from that caller or the user edits (`EDIT_STEP_IDLE_MS = 10_000`). The hold is
  released on every way the session can end (idle, user edit, project
  deactivated or disposed).
- Before the first edit of a step, `saveIfEnabled(projectId, comment)` runs; if
  it rejects, the edit is refused with the rejection's message and nothing
  changes.
- Edits change a node's visualization or position only through the graph store's
  setters, at most one layout setter call per outer transaction
  (`app/gui/src/project-view/CLAUDE.md`, "Nodes make room").
- An agent's edits do not move the viewport or change the selection; only
  `select_nodes` and `open_method` do.
- After an edit, wait for execution to settle, at most
  `EDIT_SETTLE_MS = 20_000`, then return the affected nodes' summaries
  (`summarizeNode` from PR 1) and `settled: boolean`.
- The project tab on screen answers project tools (PR 1's rule).
- Every text an agent receives is bounded with PR 1's `truncate`.
- Paths given to app tools must be inside the Drive's root directory or a saved
  local directory; anything else is refused.
- Use `corepack pnpm`. Cast third-party APIs with `as T`, never
  `as unknown as T`. User-facing strings go in
  `app/common/src/text/english.json`. Commit messages end with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Never `git stash`.
  Work only in this worktree.

## File structure

| File                                                               | Responsibility                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `app/electron-client/src/mcp/projectTools.ts`                      | + edit and navigation tool definitions                                            |
| `app/electron-client/src/mcp/appTools.ts`                          | App tool definitions (forwarded to the window)                                    |
| `app/electron-client/src/mcp/toolRegistry.ts`, `windowBridge.ts`   | Per-tool timeout                                                                  |
| `app/electron-client/src/mcp/guides/*.md`                          | How to build; what an edit returns                                                |
| `app/gui/src/project-view/mcp/editSession.ts`                      | Queue, Live refusal, undo hold, version save, settle                              |
| `app/gui/src/project-view/mcp/editTools.ts`                        | `add_nodes`, `edit_node`, `remove_nodes`, `set_node_comment`, `set_visualization` |
| `app/gui/src/project-view/mcp/structureTools.ts`                   | `collapse_nodes`, `add_function`                                                  |
| `app/gui/src/project-view/mcp/viewTools.ts`                        | `select_nodes`, `open_method`                                                     |
| `app/gui/src/project-view/components/GraphEditor/collapseNodes.ts` | The collapse action, moved out of `GraphEditor.vue`                               |
| `app/gui/src/mcp/appTools.ts`                                      | Window side of the app tools                                                      |

---

### Task 1: Tool definitions, per-tool timeout, guides (main)

**Files:**

- Modify: `app/electron-client/src/mcp/toolRegistry.ts`, `windowBridge.ts`,
  `projectTools.ts`, `electron.ts` (register `appTools`)
- Create: `app/electron-client/src/mcp/appTools.ts`
- Modify: `app/electron-client/src/mcp/guides/overview.md`, `instructions.md`
- Test: `tests/headless/mcpWindowBridge.test.ts`, `mcpToolRegistry.test.ts`,
  `mcpGuides.test.ts`, new `mcpAppTools.test.ts`

**Interfaces:**

- Produces:
  `WindowBridge.call(tool, args, caller, timeoutMs = WINDOW_TOOL_TIMEOUT_MS)`;
  `export const EDIT_TOOL_TIMEOUT_MS = 60_000`,
  `OPEN_TOOL_TIMEOUT_MS = 120_000`; `export const EDIT_TOOL_NAMES`,
  `VIEW_TOOL_NAMES`, `APP_TOOL_NAMES`; `appTools(bridge): ToolDefinition[]`.

Tool schemas (snake_case keys are the wire contract):

| Tool                | Input                                                                                                                                                        | Timeout |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| `add_nodes`         | `{ statements: z.array(z.string().min(1).max(20_000)).min(1).max(50), after_node: id.optional(), imports: z.array(z.string().max(500)).max(20).optional() }` | 60 s    |
| `edit_node`         | `{ node_id: id, expression: z.string().min(1).max(20_000) }`                                                                                                 | 60 s    |
| `remove_nodes`      | `{ node_ids: z.array(id).min(1).max(200) }`                                                                                                                  | 60 s    |
| `collapse_nodes`    | `{ node_ids: z.array(id).min(1).max(200), name: z.string().max(100).optional() }`                                                                            | 60 s    |
| `add_function`      | `{ source: z.string().min(1).max(100_000) }`                                                                                                                 | 60 s    |
| `set_node_comment`  | `{ node_id: id, text: z.string().max(5_000) }`                                                                                                               | 60 s    |
| `set_visualization` | `{ node_id: id, visible: z.boolean() }`                                                                                                                      | 60 s    |
| `select_nodes`      | `{ node_ids: z.array(id).max(200) }`                                                                                                                         | 30 s    |
| `open_method`       | `{ node_id: id.optional() }` (absent: go back to the caller)                                                                                                 | 30 s    |
| `get_app_state`     | `{}`                                                                                                                                                         | 30 s    |
| `list_projects`     | `{ directory: path.optional() }`                                                                                                                             | 30 s    |
| `list_files`        | `{ directory: path.optional() }`                                                                                                                             | 30 s    |
| `create_project`    | `{ name: z.string().min(1).max(100), directory: path.optional() }`                                                                                           | 120 s   |
| `open_project`      | `{ path: path }`                                                                                                                                             | 120 s   |
| `close_project`     | `{}` (closes the project on screen)                                                                                                                          | 30 s    |

`id` = `z.string().max(200)`, `path` = `z.string().max(1_000)`.

Descriptions must say, for an agent: what the tool does, what it returns, and
the rule that matters. For `add_nodes`: each statement is one Enso statement,
`name = expression` (the name becomes the node's name) or a bare expression (a
name is generated); later statements may use earlier names; `imports` are whole
import lines; the result lists each new node with its id, type and any error, so
check it. For every edit tool: refused in Live; undo is the user's. For
`add_function`: `source` is one top-level function definition; call it from a
node as `Main.<name> args` (or the form the project's module uses: verify with
`aiNode.ts`). For `open_project` / `create_project`: returns when the graph is
ready.

Guides: rewrite `overview.md`'s workflow for building (read with `get_graph`;
look components up; add a few nodes at a time; read the returned types and
errors; fix with `edit_node`; group with `collapse_nodes`; never assume a write
happened: the user clicks Write). Replace `instructions.md`'s "none of these
tools edits the project" sentence with one that says edits are made as ordinary
nodes the user can undo. Keep it under 120 words.

- [ ] **Step 1:** Failing tests: `call(..., timeoutMs)` times out at the given
      value (fake timers: not at 30 s, yes at 60 s); every new definition is
      registered with its name and forwards `(name, args, caller, timeout)`;
      `appTools` names in order; schema rejects 51 statements, an empty
      `node_ids`, a 300-character id; guides mention `add_nodes` and no longer
      say the tools cannot edit.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso exec vitest run tests/headless/mcp`; expected
      FAIL. Implement. Expected PASS.
- [ ] **Step 3:**
      `corepack pnpm --filter enso run typecheck && corepack pnpm --filter enso run lint`.
- [ ] **Step 4:** Commit: `MCP: edit and app tool definitions`.

---

### Task 2: The edit session (window)

**Files:**

- Create: `app/gui/src/project-view/mcp/editSession.ts`
- Test: `app/gui/src/project-view/mcp/__tests__/editSession.test.ts`

**Interfaces:**

```ts
export const EDIT_STEP_IDLE_MS = 10_000;
export const EDIT_SETTLE_MS = 20_000;
export const LIVE_EDIT_ERROR =
  "The project is in Live mode. Edits by an agent are refused there. Ask the user to switch the project back to Design.";

export interface EditSessionDeps {
  readonly isLive: () => boolean;
  /** Starts holding one undo step; returns the release function (idempotent). */
  readonly holdUndoStep: () => () => void;
  /** Calls `listener` before any module edit that the session did not make; returns unsubscribe. */
  readonly onForeignEdit: (listener: () => void) => () => void;
  /** Rejects when the version cannot be saved. Resolves without doing anything when versions are off. */
  readonly saveVersion: (comment: string) => Promise<void>;
  /** Resolves when the node database reflects the last edit. */
  readonly afterGraphUpdate: () => Promise<void>;
  /** Resolves true when the next execution completes or fails, false after `timeoutMs`. */
  readonly executionSettled: (timeoutMs: number) => Promise<boolean>;
  readonly setTimeout: (f: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface EditOutcome<T> {
  readonly value: T;
  readonly settled: boolean;
}

export class EditSession {
  constructor(deps: EditSessionDeps);
  /**
   * Runs one edit: queued behind earlier ones; refused in Live; joins or starts the caller's undo
   * step (saving a version before the first edit of a step); runs `edit` marked as the session's
   * own; waits for the graph update and for execution to settle.
   * `edit` returns Err to refuse without changing anything.
   */
  run<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
  ): Promise<Result<EditOutcome<T>>>;
  /** Releases any held step and stops listening. Safe to call twice. */
  dispose(): void;
}
```

Behaviour:

- One edit at a time: a second `run` waits for the first to finish, including
  its settle wait.
- Step: keyed by caller (`chat`, or `external:<name>`). A `run` by a caller with
  no open step, or by a different caller than the open step's, releases the open
  step (if any), calls `saveVersion('Before changes by <label>')` (label:
  `the chat`, or the external name), then `holdUndoStep()`. A rejected
  `saveVersion` → `Err(<its message>)`, no hold taken, `edit` not called.
- Each `run` re-arms an idle timer of `EDIT_STEP_IDLE_MS`; when it fires the
  step is released.
- A foreign edit (the user typing, dragging, undoing) releases the step
  immediately, before that edit is applied. While `edit` runs, the session's own
  module edits are not foreign: set a flag around the call.
- `edit` returning `Err` leaves the step as it was (still open if it was).
- After `Ok`, `await afterGraphUpdate()`, then
  `settled = await executionSettled(EDIT_SETTLE_MS)`.
- `edit` throwing → `Err(message)`; the queue continues.

- [ ] **Step 1: Failing tests** with fake deps and a manual timer:
  - Live → `Err(LIVE_EDIT_ERROR)`; `edit`, `saveVersion`, `holdUndoStep` not
    called.
  - First run: `saveVersion('Before changes by claude-code')` then
    `holdUndoStep` then `edit`, in that order.
  - Second run by the same caller within 10 s: no second save, no second hold.
  - Timer fires → release called once; the next run saves and holds again.
  - A different caller → the first step is released, a new save and hold.
  - Foreign edit → release called; a foreign-edit signal raised from inside
    `edit` does not release.
  - `saveVersion` rejects with `Error('The repository is blocked')` →
    `Err('The repository is blocked')`; `edit` not called.
  - Two `run`s started together execute strictly one after the other (the second
    `edit` starts only after the first's `executionSettled` resolved).
  - `executionSettled` false → `Ok` with `settled: false`.
  - `edit` throws → `Err`; a following run still works.
  - `dispose()` releases a held step and unsubscribes; calling it twice is safe.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp/__tests__/editSession.test.ts`;
      FAIL → implement → PASS.
- [ ] **Step 3:** Commit:
      `MCP: edit session (queue, undo step, version, settle)`.

---

### Task 3: Node edit tools (window)

**Files:**

- Create: `app/gui/src/project-view/mcp/editTools.ts`
- Create: `app/gui/src/project-view/mcp/importLines.ts`
- Test: `__tests__/editTools.test.ts`, `__tests__/importLines.test.ts`

**Interfaces:**

```ts
// importLines.ts
/** Parses whole import lines (`from Standard.Excel import all`, `import Standard.Base.Data.Text`). Err names the first line that is not an import. */
export function parseImportLines(
  lines: readonly string[],
): Result<Ast.Owned<Ast.MutableStatement>[]>;
/** Adds the lines that the module does not already have (compared by normalised code), after the existing imports. Returns how many were added. */
export function addImportLines(
  edit: Ast.MutableModule,
  lines: readonly string[],
): Result<number>;

// editTools.ts
export interface ParsedStatement {
  readonly binding: string | undefined;
  readonly expression: string;
}
/** `name = expr` → binding and expression; a bare expression → no binding. Err for anything that is not one statement (a function definition, an import, a syntax error, an empty line). */
export function parseNodeStatement(statement: string): Result<ParsedStatement>;

export interface EditToolDeps extends GraphToolDeps {
  readonly session: EditSession;
  readonly caller: McpCaller;
  /** Creates the nodes in one module edit, placed without overlapping each other or existing nodes, near `after` when given; resolves with their ids in order. Does not select or pan. */
  readonly createNodes: (
    nodes: readonly { binding: string | undefined; expression: string }[],
    after: NodeId | undefined,
    importLines: readonly string[],
  ) => Promise<Result<NodeId[]>>;
  readonly setNodeContent: (id: NodeId, expression: string) => Result<void>;
  readonly deleteNodes: (ids: readonly NodeId[]) => Promise<Result<void>>;
  readonly setNodeComment: (id: NodeId, text: string) => Result<void>;
  readonly setVisualization: (id: NodeId, visible: boolean) => Result<void>;
}
export function addNodes(
  deps: EditToolDeps,
  args: { statements: string[]; after_node?: string; imports?: string[] },
): Promise<McpToolResult>;
export function editNode(
  deps: EditToolDeps,
  args: { node_id: string; expression: string },
): Promise<McpToolResult>;
export function removeNodes(
  deps: EditToolDeps,
  args: { node_ids: string[] },
): Promise<McpToolResult>;
export function setNodeComment(
  deps: EditToolDeps,
  args: { node_id: string; text: string },
): Promise<McpToolResult>;
export function setVisualization(
  deps: EditToolDeps,
  args: { node_id: string; visible: boolean },
): Promise<McpToolResult>;
```

Behaviour:

- Each tool validates before entering the session (unknown node ids → PR 1's "No
  node with id …" error; every statement must parse; imports must parse; a
  binding that already names a node in the method → `Err` naming it; duplicate
  bindings within the call → `Err`), so a refused call changes nothing.
- Result JSON: `{ nodes: NodeSummary[], settled: boolean }` for `add_nodes` (the
  new nodes, in order) and `edit_node` (the edited node);
  `{ removed: string[], settled }` for `remove_nodes`; `{ node: NodeSummary }`
  for the other two. When `settled` is false, add
  `note: 'Execution has not finished. Call get_node later for the types and values.'`
- `add_nodes` output never includes previews (types and errors only).
- All statements of one call are created in one module edit, so they are one
  transaction; an `Err` from `createNodes` means nothing was added.

- [ ] **Step 1: Failing tests** (`parseNodeStatement`): `a = 1 + 2` → binding
      `a`, expression `1 + 2`; `Data.read "x"` → no binding; `f x = x + 1` (a
      function) → Err; `import Standard.Base` → Err; `a = ` → Err; two lines →
      Err. (`importLines`): both import forms parse; a non-import line → Err
      naming it; `addImportLines` on a transient module
      (`Ast.MutableModule.Transient()` + `Ast.parseModule`, as
      `GraphEditor/__tests__/aiNode.test.ts` builds one) adds a missing line
      after the existing imports and skips one already present.
- [ ] **Step 2: Failing tests** (tools) with `GraphDb.Mock`, a fake session
      whose `run` calls the edit and returns `settled: true`, and `vi.fn()`
      deps: `add_nodes` passes parsed nodes, `after`, and imports to
      `createNodes` and returns the new nodes' summaries in order; an unknown
      `after_node` → error and `createNodes` not called; a taken binding →
      error; in Live (real `EditSession` with `isLive: () => true`) →
      `LIVE_EDIT_ERROR`; `edit_node` calls `setNodeContent`; `remove_nodes` with
      one unknown id removes nothing; `settled: false` adds the note.
- [ ] **Step 3:** FAIL → implement → PASS for
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp`.
- [ ] **Step 4:** Commit: `MCP: node edit tools`.

---

### Task 4: collapse_nodes and add_function (window)

**Files:**

- Create: `app/gui/src/project-view/components/GraphEditor/collapseNodes.ts`
- Modify: `app/gui/src/project-view/components/GraphEditor/collapsing.ts`
  (optional base name), `GraphEditor.vue` (use the moved function)
- Create: `app/gui/src/project-view/mcp/structureTools.ts`
- Test: `GraphEditor/__tests__/collapsing.test.ts` (name), new
  `mcp/__tests__/structureTools.test.ts`

**Interfaces:**

```ts
// collapsing.ts: performCollapse(info, topLevel, graphDb, currentMethodName, baseName?: Identifier)
//   → generateUniqueName(baseName ?? COLLAPSED_FUNCTION_NAME, topLevel)

// collapseNodes.ts — the body of GraphEditor.vue's collapseNodes, with its dependencies injected
export interface CollapseDeps {
  /* module, graphStore, the two placement functions, releasePushedBy */
}
export function collapseNodes(
  deps: CollapseDeps,
  nodeIds: Iterable<NodeId>,
  options?: { name?: Identifier },
): Result<{ name: Identifier; callNode: NodeId | undefined }>;

// structureTools.ts
export function collapseNodesTool(
  deps,
  args: { node_ids: string[]; name?: string },
): Promise<McpToolResult>;
export function addFunction(
  deps,
  args: { source: string },
): Promise<McpToolResult>;
```

Behaviour:

- `GraphEditor.vue`'s shortcut handler keeps its behaviour exactly (toast on
  failure, the rename hint via `renameSchedule`); only the body moves.
- `collapse_nodes`: `name` must be a valid Enso identifier (lower snake case;
  use the existing identifier check) → else Err. Result
  `{ name, node: NodeSummary | null, settled }` where `node` is the new call
  node.
- `add_function`: `source` must parse as exactly one top-level function
  definition (`Ast.parseModuleStatement` → `Ast.FunctionDef`); a name already
  defined at top level → Err naming it; inserted before the current method (as
  `aiNode.ts` does), then `addDetectedImports`. Result `{ name, settled }`.
- Both run through the edit session.

- [ ] **Step 1:** Failing tests: `performCollapseImpl` with a base name gives
      that name (and `name_1` when taken); existing collapsing tests still pass.
      `add_function` on a transient module: a valid definition is inserted
      before `main`; two definitions, a plain expression, and a duplicate name
      are each refused. `collapse_nodes` with an invalid name is refused before
      the session.
- [ ] **Step 2:** FAIL → implement → PASS; then
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/components/GraphEditor src/project-view/mcp`.
- [ ] **Step 3:** Typecheck and lint. Commit:
      `MCP: collapse_nodes and add_function`.

---

### Task 5: View tools and wiring (window)

**Files:**

- Create: `app/gui/src/project-view/mcp/viewTools.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts`, `graphTools.ts`
  (`selection` in `get_graph`), `GraphEditor.vue`,
  `app/gui/src/project-view/mcp/CLAUDE.md`
- Test: `mcp/__tests__/viewTools.test.ts`, `graphTools.test.ts`

**Behaviour:**

- `select_nodes`: unknown id → error; sets the selection and pans to the nodes
  (the same functions the editor uses after creating a node). `[]` clears it.
  Result `{ selected: string[] }`.
- `open_method`: with `node_id`, enter that node if `nodeCanBeEntered`, else Err
  "That node is not a component defined in this project."; without it, leave the
  current method, or Err "Already at the top level." Result `{ method: string }`
  once the graph shows the new method (wait with the graph-update hook, at most
  5 s).
- `get_graph` gains `selection: string[]` (the selected node ids).
- `useProjectMcpTools` now takes the dependencies `GraphEditor.vue` builds
  (`useProjectMcpTools(deps)`), and is called after the navigator, stack
  navigator, selection and node-creation objects exist. It builds one
  `EditSession` per mounted editor, disposes it on scope dispose, and releases
  its step on `onDeactivated`. Real wiring of the session's deps: `holdUndoStep`
  = `module.undoManager.holdStep`; `onForeignEdit` from the module store's
  `onBeforeEdit`/`observe` (use whichever sees every local transaction,
  including undo and node drags; if neither can, say so and fall back to the
  idle timer alone); `saveVersion` =
  `localVersioning.saveIfEnabled(projectStore.assetId, comment)`;
  `afterGraphUpdate` = a promise around `graphStore.doAfterUpdate`;
  `executionSettled` =
  `executionContext.once('executionComplete' | 'executionFailed')` raced with
  the timeout, removing both listeners afterwards.
- `createNodes` for MCP is a second `useNodeCreation(...)` instance whose
  `onCreated` resolves the pending promise with the ids and does NOT select or
  pan; placement `{ type: 'source', node: after }` when `after` is given, else
  relative to the last node of the method; new nodes must not overlap each
  other.
- Handlers read stores at call time (PR 1's rule).

- [ ] **Step 1:** Failing tests for `viewTools` and `selection` in `get_graph`
      with fake deps. FAIL → implement → PASS.
- [ ] **Step 2:** Wire `GraphEditor.vue`. Typecheck, lint, and the whole GUI
      unit suite once (`corepack pnpm --filter enso-gui run test:unit`).
- [ ] **Step 3:** Update `mcp/CLAUDE.md`: the session's rules, where each
      dependency comes from, the constants.
- [ ] **Step 4:** Commit: `MCP: view tools and editor wiring`.

---

### Task 6: App tools (window)

**Files:**

- Create: `app/gui/src/mcp/appTools.ts`
- Modify: `app/gui/src/components/AppContainer/AppContainer.vue` (register),
  `app/gui/src/mcp/toolDispatcher.ts` only if app handlers need a separate
  registration from project handlers
- Test: `app/gui/src/mcp/__tests__/appTools.test.ts`

**Interfaces:**

```ts
export interface AppToolDeps {
  readonly rootDirectory: () => string;
  readonly savedDirectories: () => readonly string[];
  readonly listDirectory: (path: string) => Promise<
    readonly {
      name: string;
      path: string;
      kind: "file" | "folder" | "project";
      bytes?: number;
      open?: boolean;
    }[]
  >;
  readonly createProject: (
    name: string,
    directory: string,
  ) => Promise<{ name: string; path: string }>;
  /** Opens the project's tab; resolves when its graph is ready, rejects with the open error. */
  readonly openProject: (path: string, name: string) => Promise<void>;
  readonly closeCurrentProject: () => Promise<boolean>;
  readonly state: () => {
    page: "dashboard" | "project" | "settings";
    project: { name: string; path: string } | null;
    openProjects: { name: string; path: string }[];
  };
}
export function isAllowedPath(path: string, roots: readonly string[]): boolean;
```

Behaviour:

- `isAllowedPath`: the normalised path equals a root or is inside it; `..`
  segments, a different drive, and prefix look-alikes (`C:\Drive2` against
  `C:\Drive`) are refused. Windows comparison is case-insensitive.
- A path outside the roots → `ok: false`, "That folder is outside the Drive. Use
  a path under <root> (or a saved local folder)."
- `list_projects`: projects in the directory (default: the root), each
  `{ name, path, open }`. `list_files`: every entry,
  `{ name, path, kind, bytes? }`, at most 500 entries, with `truncated: true`
  beyond that.
- `create_project`: creates in the directory (default: root), opens it, and
  resolves when the graph is ready: `{ name, path }`. `open_project`: the path
  must be a project found by `listDirectory` of its parent → else Err "No
  project at that path."; already open → switches to its tab. Both wait for the
  project's handlers to be registered (the project tools answer) before
  returning, so the agent's next call is `get_graph`.
- `close_project`: closes the project on screen without the repository offer
  (`offer: false`); nothing on screen → Err.
- `get_app_state`: `{ page, project, open_projects, drive_root }`.
- App handlers are registered once by `AppContainer.vue` and stay registered
  whatever page shows.

- [ ] **Step 1:** Failing tests: `isAllowedPath` cases above; each tool with
      fake deps, including the refusals and the 500-entry cap.
- [ ] **Step 2:** FAIL → implement → PASS. Wire the real deps in
      `AppContainer.vue` from the backend, the container store and
      `openedProjects` (see `useNewProject` in
      `dashboard/layouts/Drive/driveActions.ts` and `openProjectLocally` in
      `providers/container.ts`).
- [ ] **Step 3:** Typecheck (both tsconfigs), lint. Commit: `MCP: app tools`.

---

### Task 7: End-to-end tests, documentation, changelog

**Files:**

- Modify: `app/electron-client/tests/mcp.spec.ts`
- Modify: `app/gui/integration-test/mock/registerMocks.ts` and a new
  `app/gui/integration-test/project-view/mcpEdit.spec.ts`
- Modify: `app/electron-client/src/mcp/CLAUDE.md`,
  `app/electron-client/CLAUDE.md`, `app/gui/CLAUDE.md`, `CHANGELOG.md`

**Steps:**

- [ ] **Step 1: GUI Playwright.** Extend the `mcp` mock so a spec can deliver a
      tool call to the page and read the reply
      (`window.__mcpCall(tool, args): Promise<McpToolResult>`, keeping the
      handler `onToolCall` registered). Spec: open the mock project; `add_nodes`
      two statements → two new nodes are visible with the given names; the
      viewport did not move and the selection did not change; one `Mod+Z`
      removes both; `remove_nodes` then `Mod+Z` restores; `select_nodes`
      selects. Run it three times.
- [ ] **Step 2: Packaged app.** Extend `tests/mcp.spec.ts`: `create_project` →
      `get_app_state` shows it; `add_nodes` (`numbers = [1, 2, 3]`,
      `total = numbers.fold 0 (+)`) → the result has two nodes, `total`'s type
      is an integer and `settled` is true; `get_node` on `total` previews `6`;
      `edit_node` to `numbers.fold 10 (+)` → `16`; `set_node_comment`;
      `collapse_nodes` with a name → `get_graph` shows the call; `remove_nodes`;
      `list_files` on the Drive root; `open_project` with a path outside the
      Drive is refused; `close_project`. Rebuild the packaged app as PR 1's
      final fix report describes (GUI build, then `ide-build` on the existing
      `dist/backend`) and run the spec three times.
- [ ] **Step 3: Docs.** Update the three `CLAUDE.md` files for the edit session,
      the app tools and their path rule. Changelog entry under `#### Enso IDE`
      (placeholder PR number, to be corrected):
      `Agents connected over MCP can create and open projects and add, edit, remove and group nodes; each run of changes is one undo step.`
- [ ] **Step 4: Gate.** `corepack pnpm run ci:typecheck`, `ci:lint`,
      `ci:unit-test`, `prettier --check` on changed files (use
      `--ignore-unknown`).
- [ ] **Step 5:** Commit in pieces (`MCP: edit tools end-to-end tests`,
      `MCP: documentation and changelog for the edit tools`).

The Linux pass, the whole-branch review, push and PR are the controller's.

## What this plan does not verify

- Real Claude Code, Codex and Copilot sessions building a project.
- Undo grouping against a real second user edit made during an agent's run
  (unit-tested through the session's `onForeignEdit`).
- macOS.
