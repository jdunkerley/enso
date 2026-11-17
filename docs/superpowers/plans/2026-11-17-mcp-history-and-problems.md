# MCP undo, versions, problems and refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent connected over MCP can take back and re-apply its own edits,
save a version, read every error and warning of the method on screen in one
call, and refresh the project's values, without any of these being able to cause
a write.

**Architecture:** Five tools that run in the window: `undo`, `redo`,
`save_version`, `get_problems`, `refresh`. Undo, redo and refresh go through the
`EditSession` queue on a new path that holds no undo step and saves no version.
The session keeps track of which undo steps are the agent's own, so an agent
never undoes the user's work.

**Tech Stack:** TypeScript, Vue 3, Electron, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`, section
"Amendment, 2026-11-16". The owner approved the follow-on list (2026-11-16):
undo and redo, save a version, errors and warnings in one call, and "let's do
refresh but not run as that would trigger the write tools. I want the user to
have to do that themselves".

## Global Constraints

- `corepack pnpm` only. Work in `C:\Repos\Enso\ide-mcp`, branch
  `feature/mcp-history-and-problems` (stacked on `feature/mcp-layout`, pull
  request #831, until that merges).
- Tool argument names and result fields are snake_case on the wire.
- **The Write button is never reachable from MCP.** Concretely here:
  - `refresh` calls `executionContext.recompute('all')` with **no** environment
    argument and no per-expression configs. It never passes `'Live'`, and never
    calls `recomputeOnce`. It is refused in Live mode, and refused when the
    module on screen contains code that enables output (see Task 5).
  - `undo` and `redo` only ever move through steps made by agents, and never
    through one that would bring back a node with Write on (see Task 1).
- `undo`, `redo` and `refresh` are refused in Live mode with `LIVE_EDIT_ERROR`
  (refresh with its own sentence). `get_problems` and `save_version` work in
  Live: neither changes the module.
- Tools answer only for the project tab on screen.
- A tool result is JSON text made with `jsonResult`; errors are plain sentences
  made with `toolError`, saying what the agent can do next.
- Every exported symbol has a doc comment. No `as unknown as` on Electron or SDK
  types.
- Each commit message ends with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- One writer in the worktree at a time.
- Do not grow `useProjectMcpTools.ts` beyond wiring: each tool's logic lives in
  its own file under `app/gui/src/project-view/mcp/` as pure functions over a
  deps interface, with a unit test next to the others in `__tests__/`.

## Background the implementer needs

- `app/gui/src/project-view/mcp/editSession.ts`: `EditSession.run` queues an
  edit, refuses it in Live or off screen, saves a version before a caller's
  first edit of a step, holds one undo step per caller, marks the edit as the
  session's own (`inEdit`), then waits for the graph update and for execution to
  settle. `onForeignEdit` fires before every module transaction made by the user
  **or by the undo manager** (`projectEvents.ts`, `isUserTransaction`) while
  `inEdit` is false.
- `app/gui/src/providers/openedProjects/module/module.ts`: `undoManager` proxy
  (`undo`, `redo`, `undoStackBoundary`, `holdStep`, `canUndo`, `canRedo`) over
  the module's `Y.UndoManager`.
- A node with Write on has `node.prefixes.enableRecording != null`
  (`editTools.ts`, `structureTools.ts` already refuse to edit or collapse one).
- `app/gui/src/project-view/mcp/writeGuard.ts`: `writeRefusal(ast)` answers a
  refusal sentence when the code names anything that can enable the output
  context.
- Error text: a panic's message is `info.payload.message`; a dataflow error's is
  `projectStore.dataflowErrors.lookup(externalId)?.value?.message`, which starts
  a small visualization on first lookup and is undefined until its data arrives;
  a value's first warning is `info.payload.warnings.value` with
  `info.payload.warnings.count`
  (`components/GraphEditor/GraphNode/nodeMessage.ts` shows all three).
  `projectStore.diagnostics` holds the module's compile diagnostics
  (`components/CodeEditor/diagnostics.ts` shows how they are read).
- Tool definitions live in main (`app/electron-client/src/mcp/projectTools.ts`,
  zod schemas, descriptions, timeouts) and forward to the window handler
  registered in `useProjectMcpTools.ts`. Follow `move_nodes` (an edit) and
  `get_documentation` (a read) as models, including their tests in
  `app/electron-client/src/mcp/__tests__/` and the tool-name lists.

---

### Task 1: The session's unstepped path and own-history tracking

**Files:**

- Modify: `app/gui/src/providers/openedProjects/module/module.ts` (expose
  `undoDepth` and `redoDepth` on the `undoManager` proxy: the lengths of the
  `Y.UndoManager`'s `undoStack` and `redoStack`, read at call time, 0 with no
  manager)
- Modify: `app/gui/src/project-view/mcp/editSession.ts` and
  `__tests__/editSession.test.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts` (the new deps)

**Interfaces:**

```ts
export interface EditSessionDeps {
  // …existing…
  /** How many steps the module's undo stack and redo stack hold now. */
  readonly historyDepth: () => { undo: number; redo: number };
  /** Undoes, or redoes, the top step of the module's undo manager. */
  readonly undo: () => void;
  readonly redo: () => void;
}

export interface EditRunOptions<T> {
  // …existing…
  /**
   * Whether the edit, by its value, removed a node with Write on. Undoing it
   * would bring that node back and run it, so the step is closed at once and
   * becomes the floor below which the agents' undo does not go.
   */
  readonly sealsHistory?: (value: T) => boolean;
}

class EditSession {
  /**
   * Runs `action` in the queue outside any undo step: the same refusals as
   * `run` (disposed, off screen, Live, too close to the deadline), then the
   * held step is released, no version is saved and no step is held; `action`
   * runs marked as the session's own; then the same graph-update and settle
   * waits as `run`.
   */
  runUnstepped<T>(caller, action, options?): Promise<Result<EditOutcome<T>>>;
  /** Takes back the top step if it is an agent's own. */
  undo(
    caller,
    options?: { deadline?: number },
  ): Promise<Result<EditOutcome<HistoryState>>>;
  /** Re-applies the step the last `undo` took back. */
  redo(
    caller,
    options?: { deadline?: number },
  ): Promise<Result<EditOutcome<HistoryState>>>;
}

export interface HistoryState {
  /** Whether a further `undo` / `redo` by an agent would do something. */
  can_undo: boolean;
  can_redo: boolean;
}
```

**Own-history rules** (state: `ownFloor: number | undefined`, `ownRedo: number`,
`stepBase: number`):

- When `run` acquires a step (`holdUndoStep` returned), `stepBase` is
  `historyDepth().undo`, read after the hold (whose boundary closed anything
  before it).
- When a `run`'s edit succeeds and is not `unchanged`: if `ownFloor` is
  undefined it becomes `stepBase`; `ownRedo` becomes 0.
- When that edit `sealsHistory`: after the waits are set up as usual, the step
  is released (`releaseStep()`), `ownFloor` becomes `historyDepth().undo`, and
  `ownRedo` becomes 0. Release before reading the depth.
- A foreign edit (the existing listener, `inEdit` false) sets `ownFloor` to
  undefined and `ownRedo` to 0, besides releasing the step. The user's own
  Ctrl+Z is a foreign edit, so after it the agent can undo nothing.
- `undo`: through `runUnstepped`. At its turn, after the step is released:
  refused with `NOTHING_TO_UNDO_ERROR` unless `ownFloor != null` and
  `historyDepth().undo > ownFloor`. Otherwise `deps.undo()`, `ownRedo++`.
- `redo`: through `runUnstepped`. Refused with `NOTHING_TO_REDO_ERROR` unless
  `ownRedo > 0` and `historyDepth().redo > 0`. Otherwise `deps.redo()`,
  `ownRedo--`.
- `can_undo` is `ownFloor != null && depth.undo > ownFloor`; `can_redo` is
  `ownRedo > 0 && depth.redo > 0`, both read after the action.
- `runUnstepped` leaves `ownFloor` and `ownRedo` alone (refresh must not reset
  them).

Error sentences:

- `NOTHING_TO_UNDO_ERROR`: "There is nothing of yours to undo. undo takes back
  only edits made by agents since the user last changed the project. To change
  anything else, edit or remove the nodes."
- `NOTHING_TO_REDO_ERROR`: "There is nothing to redo. redo re-applies only what
  undo took back, and only until the next edit."

Why this is safe for Write (put this in the file comment): every step above
`ownFloor` holds only transactions made inside a session run, because any other
transaction resets the floor. A session run never adds the Write prefix
(`writeGuard`), never edits or collapses a Write-on node, and the one edit that
removes one seals the history above itself. So neither undoing nor redoing such
a step can make a node with Write on appear.

- [ ] **Step 1:** Write failing unit tests in `editSession.test.ts` (fake deps
      with a counter-backed history: a changed edit in a new step adds one to
      `undo` depth; `undo()` moves one from undo to redo): undo with no edits is
      refused; edit then undo calls `deps.undo` once and reports
      `can_undo: false, can_redo: true`; two steps (idle timer between) undo
      twice then refuse; a foreign edit after an agent edit makes undo refuse; a
      foreign edit after an undo makes redo refuse; an own edit after an undo
      makes redo refuse; a sealing edit makes undo refuse though later edits can
      be undone down to the seal; undo and redo are refused in Live, off screen
      and after dispose, with nothing called; undo releases the held step before
      undoing (order of calls); `runUnstepped` saves no version and holds no
      step; an `unchanged` edit does not set the floor.
- [ ] **Step 2:** Run them:
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp/__tests__/editSession.test.ts`.
      Expect the new tests to fail.
- [ ] **Step 3:** Implement. Share the refusal checks and the waits between
      `execute` and the unstepped path instead of copying them.
- [ ] **Step 4:** Add `undoDepth` / `redoDepth` to the module's `undoManager`
      and wire `historyDepth`, `undo`, `redo` in `useProjectMcpTools.ts`.
- [ ] **Step 5:** Run the session tests and
      `corepack pnpm --filter enso-gui run typecheck`. Expect both to pass.
- [ ] **Step 6:** Commit: "MCP: the edit session tracks the agents' own undo
      steps".

### Task 2: `undo` and `redo` tools

**Files:**

- Create: `app/gui/src/project-view/mcp/historyTools.ts` and
  `__tests__/historyTools.test.ts`
- Modify: `app/gui/src/project-view/mcp/structureTools.ts` (or wherever
  `remove_nodes` lives): its `session.run` passes `sealsHistory` true when any
  removed node had `prefixes.enableRecording != null` (read before removal)
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts`,
  `app/electron-client/src/mcp/projectTools.ts` and its tests

**Tools:** `undo` and `redo`, no arguments, timeout `EDIT_TOOL_TIMEOUT_MS`.
Result: `{ "undone": true, "can_undo": …, "can_redo": …, "settled": … }` (or
`"redone": true`). The descriptions say: takes back (re-applies) one step of
edits made by agents; a step is every edit an agent made without a 10 second
pause; it never undoes the user's work; refused in Live; call `get_graph`
afterwards to see the graph, since node ids of re-created nodes are the ones
they had before.

- [ ] **Step 1:** Failing unit tests for `historyTools.ts` (session faked): the
      result shapes, the two refusals passed through as errors, the deadline
      passed on.
- [ ] **Step 2:** Failing unit test for `remove_nodes`: removing a Write-on node
      reports `sealsHistory`; removing others does not.
- [ ] **Step 3:** Implement, register in the window and in main (zod schema with
      no properties), add the names to the tool-name lists and their tests.
- [ ] **Step 4:** Run the GUI unit tests for `mcp/` and the electron-client unit
      tests (`corepack pnpm --filter enso exec vitest run src/mcp`). Expect all
      to pass.
- [ ] **Step 5:** Add an integration test
      `app/gui/integration-test/project-view/mcpHistory.spec.ts`, modelled on
      `mcpVisualization.spec.ts`: an agent adds a node, `undo` removes it,
      `redo` brings it back; after a user edit (type a comment on a node),
      `undo` is refused and the user's edit is intact; in Live both are refused.
      Run it three times.
- [ ] **Step 6:** Commit: "MCP: undo and redo for the agents' own edits".

### Task 3: `save_version`

**Files:**

- Modify: `app/gui/src/providers/localVersioning.ts` and its tests: `save`
  resolves to its outcome (it resolves to nothing now) without changing what it
  shows the user:

  ```ts
  export type SaveVersionOutcome =
    | { kind: "saved" }
    | { kind: "nothingToSave" }
    | { kind: "failed"; reason: string };
  ```

- Create: `app/gui/src/project-view/mcp/versionTools.ts` and
  `__tests__/versionTools.test.ts`
- Modify: `useProjectMcpTools.ts`, `projectTools.ts` and tests

**Tool:** `save_version`, argument `comment` (optional string, at most 500
characters, one line: refuse a newline). Timeout `EDIT_TOOL_TIMEOUT_MS`. Without
a comment the version's comment is `Saved by <caller label>`.

Behaviour, in this order:

1. Refused off screen (`NOT_ON_SCREEN_ERROR`).
2. Read the project's versioning status the way `canSave` does. No git, or
   versions not kept for this project: "Versions are not kept for this project.
   The user can turn them on with Save a version." The agent never turns
   versioning on (`save` on a project without it would; do not call it then).
3. Blocked: "Versions cannot be saved now: <reason>."
4. Otherwise `save(projectId, comment)` and map the outcome:
   `{ "saved": true }`, or
   `{ "saved": false, "reason": "nothing has changed since the last version" }`,
   or an error with the reason.

Works in Live. It does not go through the `EditSession` (it changes no module),
and it does not end the agent's undo step.

- [ ] **Step 1:** Failing tests for the `save` outcome in the store's tests and
      for `versionTools.ts` (each branch above).
- [ ] **Step 2:** Implement and register. Run the store tests, `mcp/` tests,
      electron-client `src/mcp` tests and the typecheck.
- [ ] **Step 3:** Commit: "MCP: save_version".

### Task 4: `get_problems`

**Files:**

- Create: `app/gui/src/project-view/mcp/problemTools.ts` and
  `__tests__/problemTools.test.ts`
- Modify: `useProjectMcpTools.ts`, `projectTools.ts` and tests (add to
  `VIEW_TOOL_NAMES`)

**Tool:** `get_problems`, no arguments, timeout `WINDOW_TOOL_TIMEOUT_MS`.
Result:

```json
{
  "method": "Main.main",
  "nodes": [
    {
      "id": "…",
      "name": "table1",
      "state": "error",
      "message": "The column 'x' was not found.",
      "origin": true
    },
    {
      "id": "…",
      "name": "sum1",
      "state": "error",
      "message": "…",
      "origin": false
    },
    {
      "id": "…",
      "name": "read1",
      "state": "warning",
      "message": "…",
      "warnings": 3
    }
  ],
  "diagnostics": [{ "kind": "error", "message": "…", "line": 12 }],
  "errors": 2,
  "warnings": 1,
  "pending": 0,
  "truncated": false
}
```

Rules:

- The nodes of the method on screen, in the order `get_graph` lists them, that
  are a panic, a dataflow error, or a value with warnings. `state` is `panic`,
  `error` or `warning`.
- `message`: the panic message; the dataflow error text with the trailing
  ` (at …` location cut as `nodeMessage.ts` does; the first warning's text. Cut
  to `GRAPH_NODE_TEXT_CHARS`.
- A dataflow error's text loads on first lookup. Look every error node up first,
  then wait until each has a message, at most `PROBLEM_TEXT_WAIT_MS` (5000) from
  the first lookup, using a Vue `watch` over the lookups. A node whose text did
  not arrive has `"message": null` and the result says `"messages_pending": n`.
- `origin` (errors and panics only): false when a node this one takes input from
  has the same full message (the comparison `nodeMessage.ts` makes for
  `alwaysShow`), true otherwise. The description tells the agent to fix the
  `origin: true` nodes first.
- `warnings`: the count, on warning nodes. The description says the rest of a
  node's warnings are in its `Warnings` visualization (`get_visualization` with
  that name).
- `diagnostics`: the module's compile diagnostics that lie inside the method on
  screen or have no position, with `kind`, `message` and 1-based `line` of the
  module when known. At most 50.
- `pending`: how many nodes of the method are still computing; when it is not 0
  the description says to call again.
- At most 100 nodes; `truncated` true when there were more, errors and panics
  kept before warnings.
- Reads only: no evaluation, no edit, works in Live. It does keep the small
  error visualizations alive that the editor itself opens for nodes it draws.

- [ ] **Step 1:** Failing unit tests over a fake `db`, value registry and
      `dataflowErrors` map: each state, the cut of ` (at`, `origin` for a chain
      of three nodes, the wait (text arriving late, text never arriving),
      warnings count, the 100-node cap and its order, diagnostics filtered to
      the method.
- [ ] **Step 2:** Implement and register. Run the `mcp/` tests, electron-client
      `src/mcp` tests and the typecheck.
- [ ] **Step 3:** Integration test in
      `app/gui/integration-test/project-view/mcpProblems.spec.ts` if the mock
      project can produce a dataflow error and a panic through the existing mock
      helpers; if it cannot without new mock plumbing, say so in the report and
      leave the coverage to the packaged spec (Task 6).
- [ ] **Step 4:** Commit: "MCP: get_problems lists every error and warning".

### Task 5: `refresh`

**Files:**

- Create: `app/gui/src/project-view/mcp/refreshTool.ts` and
  `__tests__/refreshTool.test.ts`
- Modify: `useProjectMcpTools.ts`, `projectTools.ts` and tests

**Tool:** `refresh`, no arguments, timeout `EDIT_TOOL_TIMEOUT_MS`. The same as
the user's Refresh button: computes every node again in Design, reading files
and data sources again. Result: `{ "refreshed": true, "settled": … }`.

Behaviour, through `session.runUnstepped`:

1. Refused in Live with `LIVE_REFRESH_ERROR`: "The project is in Live mode,
   where a refresh writes outputs. Ask the user to refresh, or to switch the
   project back to Design."
2. Refused when the module would write on a refresh: `writeRefusal(moduleRoot)`
   is not undefined, or any node of the method on screen has
   `prefixes.enableRecording != null`. Sentence (`WRITE_ON_REFRESH_ERROR`):
   "This project has a node with Write on, or code that enables output, and a
   refresh would run it and write again. Ask the user to refresh."
3. `executionContext.recompute('all')`: exactly that call, no second or third
   argument. A unit test asserts the arguments.
4. Settled when every node of the method on screen has reported `Pending` and
   then a value since the call: return every node's external id as
   `affected.changed`. Check in the packaged app that a recompute of `'all'`
   does report `Pending` for a node whose value does not change; if it does not,
   settle on the first `executionComplete` after the call instead, and write
   down in `CLAUDE.md` which it is.

The description says: use it after the user changed a file or a table outside
the IDE; it never turns Write on; nodes the user has switched Write on for make
it refuse.

- [ ] **Step 1:** Failing unit tests: Live refusal, each Write refusal (a
      Write-on node; `with_enabled_context` in another function of the module),
      the exact `recompute` arguments, the affected ids, nothing called on a
      refusal.
- [ ] **Step 2:** Implement and register. Run the tests and the typecheck.
- [ ] **Step 3:** Commit: "MCP: refresh recomputes in Design and never writes".

### Task 6: Guides, documentation, changelog and the packaged proof

**Files:**

- Modify: `app/electron-client/src/mcp/guides/overview.md` (item 11 says "There
  is no undo tool": replace; add the five tools to the tool list and to item 9's
  Live list), `instructions.md` if it lists tools, and the guide tests
- Modify: `app/electron-client/src/mcp/CLAUDE.md`,
  `app/gui/src/project-view/mcp/CLAUDE.md`
- Modify: `app/electron-client/tests/mcp.spec.ts`
- Modify: `CHANGELOG.md` (one entry under `#### Enso IDE`, numbered after the
  pull request)
- Modify: the amendment section of
  `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md` (the five tools
  and the own-steps rule, in a few lines)

- [ ] **Step 1:** Update the guides and both `CLAUDE.md` files. State the
      own-steps rule and the two refresh refusals plainly.
- [ ] **Step 2:** Extend `mcp.spec.ts`: add a node that is a dataflow error and
      read it with `get_problems` (message present, `origin: true`); `undo`
      takes the node away, `redo` brings it back; `save_version` answers saved
      or nothing-to-save; `refresh` answers `refreshed: true` and
      `settled:     true`; put a node in Write on through the UI's own button,
      then `refresh` is refused and no file is written.
- [ ] **Step 3:** Build with `ide-local` (the recipe in memory:
      `local-windows-installer-build`) and run the packaged spec. Never run the
      installer.
- [ ] **Step 4:** Run `corepack pnpm exec prettier --check` on every changed
      file, the GUI unit tests, the electron-client unit tests, lint and
      typecheck for both packages.
- [ ] **Step 5:** Commit: "MCP: guides and packaged test for undo, versions,
      problems and refresh".

## Verification before the pull request

- GUI unit tests, headless tests and the Playwright suite on Linux from a fresh
  WSL clone (`corepack pnpm -r compile` first; delete the clone afterwards).
- The packaged spec on Windows.
- A whole-branch review, with the Write constraint as its first question: can
  any of the five tools, alone or in sequence with the existing ones, cause a
  write the user did not click for?
