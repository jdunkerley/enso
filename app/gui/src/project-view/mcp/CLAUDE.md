# project-view/mcp/

The window side of the MCP project tools: those that read the open project,
those that edit it, and the two that navigate the editor. External agent apps
call the IDE's MCP server in Electron main; main forwards a project tool call to
the window over IPC, `$/mcp/toolDispatcher.ts` (mounted by `App.vue`) routes it
to the handler registered for the tool, and replies.

**A tool needs both halves.** Its name, description and argument schema are in
`app/electron-client/src/mcp/projectTools.ts`; its handler is here. Add or
rename one on both sides, and keep the description in step with what the handler
returns (`app/electron-client/src/mcp/guides/overview.md` describes the tools
too).

- **The project on screen answers.** Every open project's `GraphEditor.vue`
  stays mounted (the tabs in `MiddlePanel.vue` are under `<KeepAlive>`), so each
  registers its own handlers, with its project's id (which the app tools'
  `open_project` waits on). `useProjectMcpTools.ts` registers them on setup,
  puts them first on `onActivated`, and removes them on `onDeactivated` and on
  scope dispose. The dispatcher answers with the most recently registered or
  activated set, falling back to the next most recent when one is removed. While
  the dashboard (or any page that is not a project) is showing, no set is
  registered and the dispatcher answers `NO_PROJECT_ERROR`: a hidden project
  never answers. It narrows the arguments, which arrive as `unknown` (main has
  validated them already), and builds the dependencies from the current
  project's stores **at call time**: a handler never keeps a store or a snapshot
  of the graph between calls.
- `graphTools.ts` (`get_graph`, `get_node`) and `evaluate.ts`
  (`evaluate_expression`) are pure functions over `GraphToolDeps`, which is what
  makes them testable with `GraphDb.Mock()`. Results are JSON text
  (`JSON.stringify(value, null, 1)`).
- Value previews are `<name>.to_display_text` (5 s) for each node with a value
  in `get_graph`, at most `GRAPH_PREVIEW_CHARS` (2,000) characters each, and
  `<name>.to_text` (10 s) in `get_node`, at most `NODE_PREVIEW_CHARS` (20,000).
  A longer text is cut and ends with `…`; a failed preview is left out. Previews
  do not interrupt the execution context on timeout; `evaluate_expression` does
  (25 s budget, as `aiToolHandler.ts`).
- **Nothing else limits the evaluations**: `queuedExecuteExpressionRaw` starts
  each one at once, and main does not cap a tool's result. So `get_graph` runs
  at most `GRAPH_PREVIEW_CONCURRENCY` (8) previews at a time and starts none
  after `GRAPH_PREVIEW_DEADLINE_MS` (15 s from the first); the value nodes it
  did not start are counted in the result's `previews_skipped` (present only
  when non-zero). It also starts none once the previews collected reach
  `GRAPH_PREVIEW_TOTAL_CHARS` (40,000 characters); those nodes count in
  `previews_skipped` too. The clock is `GraphToolDeps.now`, injected in tests.
- `get_graph` caps its other texts as well: the method's `source` at
  `GRAPH_SOURCE_CHARS` (50,000), and each node's `code`, `comment` and panic
  `message` at `GRAPH_NODE_TEXT_CHARS` (2,000). `get_node` gives one node in
  full (its preview and error at 20,000). A preview evaluation that rejects or
  throws leaves its node without a preview; the tool still answers.
- Every text that comes from an evaluation is bounded, through the one
  `truncate` helper in `graphTools.ts`: `get_node`'s `error` to 20,000
  characters; `evaluate_expression`'s result to `EVALUATE_RESULT_CHARS` (20,000)
  followed by a line `… [truncated: <N> characters in total. …]`, and its error
  text to `EVALUATE_ERROR_CHARS` (2,000) with `…`.
- `evaluate_expression` is refused while the project is in Live mode
  (`LIVE_MODE_ERROR`), before anything is evaluated: an evaluation runs in the
  execution context's environment, and in Live an expression's writes are real.
  `useProjectMcpTools` reads the mode (and the context's environment) at call
  time. The `get_graph` and `get_node` previews still run in Live: they are
  fixed expressions (`to_display_text`, `to_text`, `catch_primitive`).
- Expressions on a node run at the node's statement (`outerAst.externalId`),
  where its own binding is in scope; without a node, in the method body. A node
  id is the right-hand side's id, where the node's own name is still
  uninitialized (wiki: Infrastructure-Ydoc, "Scope semantics of
  `nodeExternalId`").
- `catalogueTools.ts` (`search_components`, `get_component_docs`) searches the
  suggestion database as the Component Browser does (`Filtering`,
  `makeComponentLists`, the module's imported libraries): methods only; without
  `self_type` the static ones, with it the methods of that type (its `SelfArg`
  built as `ComponentBrowser/input.ts` builds it for a source node). Names are
  printed with the project's `Main` module elided (`ProjectPath.normalized`, not
  `printProjectPath`, whose pattern also cuts a `Main_…` module's name); a name
  or `self_type` is looked up as given, then in the project's `Main` module, so
  both the printed and the full form resolve. Until the database has loaded,
  both answer an error. Summaries are cut at 500 characters, documentation at
  20,000.
- No tool here changes the execution environment, settings or secrets, runs
  Write, or deletes a project or file. The edits reach the project's file as the
  user's do: within a few seconds while the project is open (4–7 s in the
  packaged spec).

## Write stays the user's (`writeGuard.ts`)

The GUI's per-node Write is a code prefix (`util/ast/node.ts`:
`Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output "design" <| …`),
so code an agent supplies could switch the output context on by itself. One
check, `enablesOutput`, with one list, `OUTPUT_ENABLING_IDENTIFIERS`, refuses it
(`WRITE_REFUSED_ERROR`) everywhere an agent's code enters: a node statement
(`parseNodeStatement`, `add_nodes`), a node expression (`parseNodeExpression`,
`edit_node`), a function definition (`parseFunctionDefinition`, `add_function`),
an import line (`parseImportLines`, `add_nodes`) and an evaluated expression
(`evaluate_expression`, parsed with `Ast.parseBlock`).

- It walks the whole tree (`Ast.visitRecursive`, as `hasSyntaxError` does) and
  matches every `Ident` token named `with_enabled_context` or `with_enabled`:
  plain, qualified, as a method after a dot, as an argument, in a lambda, an
  operator section or a text interpolation, and in an import (also under an
  alias). Text and comments are not identifiers.
- The list is every public way to ENABLE a context in
  `distribution/lib/Standard/Base/0.0.0-dev/src/Runtime.enso`: the module
  function `with_enabled_context` and the method `Context.with_enabled`. Both
  call `Context_Helpers.with_context` in `src/Internal/Context_Helpers.enso`, a
  `private` module a project cannot import. `with_disabled_context` and
  `with_disabled` are harmless and allowed. A new enabling function in
  `Runtime.enso` must be added to the list.
- `edit_node` also refuses a node the user turned Write on for
  (`prefixes.enableRecording`, `writeOnNodeError`), at validation and again at
  its turn: `setNodeContent` replaces only the `innerExpr` inside the user's
  prefix, so the agent's expression would run with output. The user's switch is
  never changed by a tool. Its comment and visualization can still be set.
- This keeps outputs off; it is not a sandbox: Enso code can call Java, which
  can do anything the IDE's process can.

## Edit, structure and view tools

- `editTools.ts` (`add_nodes`, `edit_node`, `remove_nodes`, `set_node_comment`,
  `set_visualization`), `structureTools.ts` (`collapse_nodes`, `add_function`)
  and `viewTools.ts` (`select_nodes`, `open_method`) are pure functions over
  their deps, like the read tools. Each validates its arguments before anything
  changes; the edits then run through the editor's one `EditSession`.
- **Edits never move the view or the selection.** Only `select_nodes` and
  `open_method` do, and both work in Live. `select_nodes` sets the selection and
  then calls `panToSelected`, as the editor does after creating a node; `[]`
  clears it. `open_method` enters with `stackNavigator.enterNode` when
  `graph.nodeCanBeEntered`, or leaves with `exitNode` (the editor's watcher
  clears the selection), releases an open edit step (the user's context
  changed), waits for the next graph update (at most `OPEN_METHOD_WAIT_MS`, 5 s)
  and answers `{ method }`. `get_graph` lists the selected ids in `selection`.
- **`add_nodes` creates its nodes itself** (`nodeCreation.ts`,
  `createMcpNodes`), not through `useNodeCreation`, which renames a given
  binding (`c` becomes `c1`), reports ids only after `graph.doAfterUpdate`, and
  selects and pans. `createMcpNodes` places every node first (`placeNewNodes`:
  the first below `after_node`, else below the method's last node in code order,
  each next below the one before, all through `usePlacement().place`, so they
  overlap neither each other nor the nodes on screen; with no node at all, the
  middle of the view). Then, in **one `module.edit`**, it adds the missing
  import lines (`addImportLines`), builds each `Ast.Assignment.new` (a binding
  as given; a bare expression named as the Component Browser names one, with
  `inferPrefixFromAst` and `generateLocallyUniqueIdent`), sets each position in
  its metadata, runs `addDetectedImports` per node and inserts them with
  `insertNodeStatements`. An Err anywhere commits nothing. The new rects go into
  `graph.nodeRects` after the commit, as `useNodeCreation` does, so that the
  next placement avoids them before they render.
- Where the other edits go: `edit_node` → `graph.setNodeContent` (which returns
  the edit's `Result`); `remove_nodes` → `graph.deleteNodes` (the nodes using a
  removed one are disconnected, as when the user deletes); `set_node_comment` →
  the statement's `mutableDocumentationText()` in one `module.edit`, as
  `aiNode.ts` writes a prompt; `set_visualization` →
  `graph.setNodeVisualization` (one layout setter call); `collapse_nodes` → the
  editor's collapse with the same `CollapseDeps` as "Group components", without
  its rename; `add_function` → one `module.edit` of the top-level block.
- `GraphNodeComment.vue` reads the comment through `useYText`, so a comment
  written to the `Y.Text` from elsewhere (this tool, an undo) shows on a node
  that had none. Before, only a node already showing one updated.

## The edit session (`editSession.ts`)

One per mounted graph editor, built in `useProjectMcpTools`: `releaseStep()` on
`onDeactivated`, `dispose()` on scope dispose (a later edit answers
`PROJECT_CLOSED_ERROR`). It runs the edits one at a time and refuses them in
Live (`LIVE_EDIT_ERROR`, read at the call's turn and again after the version
save). Before a caller's first edit of a step it saves a version
(`Before changes by <caller>`; the edit is refused when that fails) and holds an
undo step, which the same caller's further edits join. Just before the edit is
applied it starts two watches, one for the node database's next update and one
for the engine's reports; after the edit it awaits the first, then the second
(see "When an edit has settled" below). A refused or failed edit cancels both.

**A hidden editor never edits.** Removing the handlers on `onDeactivated` stops
new calls, but not the ones already in the session: one queued behind a running
edit (which can take 20 s), or one awaiting the version save. So the session
checks `isActive` (true from setup and each `onActivated` until `onDeactivated`)
at a run's turn and again after the version save, beside the `disposed` checks.
An inactive session answers `NOT_ON_SCREEN_ERROR` ("The project is no longer on
screen."), takes no hold and does not call `edit`. A run already past both
checks, which is editing or waiting to settle, finishes normally; deactivation
then releases its step.

**An edit is never applied after its caller was told it timed out.** Main's
timer for a call starts when it sends it (60 s for an edit); time in the queue
and the version save count against it. So each tool passes `run` the call's
`deadline` (from the dispatcher, `$/mcp/CLAUDE.md`), and the session refuses
with `TIMED_OUT_BEFORE_RUN_ERROR` ("The call timed out before it ran. Nothing
was changed; try again.") when less than `EDIT_MIN_REMAINING_MS` (25 s: the 2 s
graph wait, a full 20 s settle, a margin) is left at the run's turn or after the
version save. The save is raced against that budget (`raceDeadline`, through the
injected `setTimeout`): if it has not returned in time the run is refused (the
save may still finish; that is harmless). The settle wait is capped at the time
left minus `EDIT_ANSWER_MARGIN_MS` (3 s). The clock is `now` (`Date.now`). A run
without a deadline (tests) has no limit.

**An edit lands in the method it was validated against.** `after_node` and node
ids are resolved when the call arrives, but the edit runs at its turn, after
`open_method` or the user may have changed the method or removed a node. Every
edit and structure tool records the method on screen (`methodOnScreen`) when it
validates and calls `checkAtTurn` first thing inside its edit, before any
change: a different method refuses with `METHOD_CHANGED_ERROR` ("The method on
screen changed before this edit ran. Nothing was changed; call get_graph and try
again."), a node id no longer in the method with the unknown-id error (otherwise
`deleteNodes` skipped it silently and `remove_nodes` still listed it as
removed). `add_function` checks the method only.

Constants:

- `EDIT_STEP_IDLE_MS` (10 s): a step ends after that long without an edit by its
  caller, measured from the end of a run.
- `EDIT_SETTLE_MS` (20 s): how long an edit waits for the engine to report on
  the expressions it affects (less when the deadline is nearer);
  `settled: false` after it.
- `EDIT_MIN_REMAINING_MS` (25 s) and `EDIT_ANSWER_MARGIN_MS` (3 s): see the
  deadline above.
- `GRAPH_UPDATE_WAIT_MS` (2 s, `editSession.ts`): a safety net. In the packaged
  app every edit tool's change (comment and visualization included) updated the
  node database within a few milliseconds, so no tool skips the wait. When it
  fires, the result may describe the graph from before the edit (`add_nodes`
  then says some new nodes are missing).

Where each dependency comes from (`useProjectMcpTools.ts`, all read at call time
from `useCurrentProject()`):

- `holdUndoStep` → `module.undoManager.holdStep()`, with `undoStackBoundary()`
  before the hold and after the release. Holds overlap (`undoHold.ts`) and a
  drag's own hold keeps the capture open, so without the boundaries a node drag
  started while the agent's step is held joins that step (the drag test in
  `mcpEdit.spec.ts` fails without them).
- `onForeignEdit` → `onUserModuleTransaction` (`projectEvents.ts`): the module
  doc's `beforeTransaction` (`module.onBeforeEdit`), subscribed again when the
  module's doc is replaced. It fires before the change is applied, and so before
  the undo manager records it (in `afterTransaction`): releasing there puts the
  user's change in a step of its own. The session ignores what fires while its
  own `edit` runs. `transaction.local` cannot be used: a module store edit
  arrives through `Y.applyUpdate`, which is never local. The filter is the undo
  manager's own (`isUserTransaction`):
  - **Ends the step**: every transaction the undo manager records. That is the
    `local:userAction*` origins (typing in a node or widget, the Component
    Browser, deleting, pasting, connecting, the code, documentation and comment
    editors, a node drag (its first frame; later frames find no step), a
    visualization toggle or resize, Tidy up, Align), origin `null`, and undo and
    redo (origin the `Y.UndoManager`).
  - **Does not**: updates from the ydoc server (origin its provider: another
    client, the engine, a file changed on disk), the IDE's derived writes
    (`local:autoLayout`, `local:derivedMetadata` (the node appearance cache),
    `local:autoImport`), and anything that is not a module transaction:
    selecting, panning, opening the Component Browser. `deselectAll` calls
    `undoStackBoundary()`, which splits the undo stack but leaves the session
    holding; the agent's next edit then starts a new undo item, still in the
    session's step.
  - The window between an async edit's `await` and its commit
    (`graph.deleteNodes` awaits the port updates) counts as the session's own.
- `saveVersion` → `localVersioning.saveIfEnabled(projectStore.assetId, …)`.
- `watchGraphUpdate` → `watchGraphUpdate(graph)` (`projectEvents.ts`): it queues
  a `graph.doAfterUpdate` callback when it is made, so an update that runs
  during the edit counts. **Why before the edit**: `graph.ts` runs the update
  (and then the queued callbacks) in a Vue effect, which a synchronous module
  change schedules for a microtask that runs before the code after
  `await edit()`. Queued only after the edit, the callback waited for the next
  update, which came about 0.8 s later or never, so `edit_node`,
  `set_node_comment`, `add_function` and `remove_nodes` each waited out the 2 s.
  `doAfterUpdate` cannot unqueue: a timed-out or cancelled watch's callback
  stays queued until the next update and does nothing then. (`open_method` still
  uses `afterGraphUpdate`: nothing it does is awaited before it queues.)
- `watchExecution` → `watchExecution(executionContext)` (`projectEvents.ts`).

## When an edit has settled

`settled: true` means the engine has reported results for the nodes the edit
changed, so the types and errors in the result are current. Each tool passes
`run` the expression ids its edit affects
(`affected: (value) => AffectedExpressions`, from the edit's value, since new
ids are known only when it returns), split by whether they existed before the
edit:

- `added`: `add_nodes`'s new nodes, `collapse_nodes`'s new call node;
- `changed`: `edit_node`'s node (none when the new text is the code the node
  already has: nothing changes and the engine reports nothing, so the call would
  otherwise wait the full 20 s), and `remove_nodes`' users of a removed node
  (from `db.nodeDependents`, the usages `deleteNodes` disconnects, read before
  the deletion);
- none for `add_function`, `set_node_comment` and `set_visualization`: they
  change nothing the engine computes, and settle at once (`settled: true` in
  their results too, so every edit result has the field).

The watch listens from the moment it is made (just before the edit) but counts
only what arrives after `editApplied()`: a report from before belongs to an
earlier run. The run is settled when:

- it affects nothing; or
- every `added` id's latest report since the edit is not `Pending` (a value, a
  dataflow error or a panic), and every `changed` id has had a `Pending` since
  the edit followed by a report that is not `Pending`; or
- an `executionFailed` arrives after the edit returned;
- otherwise `settled: false` at `EDIT_SETTLE_MS`.

**Why a `Pending` for a node that existed before.** `edit_node(X)` then at once
`edit_node(Y)` on X's user: Y is still being computed for X's change when the
second edit lands, and that run's value for Y can arrive after the second edit
was applied, describing the code before it. The engine reports a node it
computes again as `Pending` and then its result; the `Pending` after the edit
shows the engine has taken this edit up. In the packaged app it did so every
time: for an edited node (also with the same type and a `Value` payload,
`fold 0` to `fold 10`), for a node and its user edited back to back, and for the
user of a removed node (`base + 1` becoming `_ + 1`). A new node's id cannot
carry a stale report, so any non-`Pending` report after the edit counts; no
report ever came for any id before `editApplied()` (each edit applies within one
task, and the engine's messages are separate tasks). An edit to the text a node
already has changes nothing and the engine sends nothing at all, which is why
`edit_node` passes no id then.

A node's id is the external id of its root expression, and the engine's updates
are keyed by exactly that (`computedValueRegistry.processUpdates`); the packaged
spec's trace showed each affected id reported, the collapse's call node
included.

`executionFailed` and `executionComplete` both come only from the engine's
`ExecuteJob`, once per program run: `executionFailed` when the run itself fails
(an exception, a module that does not compile), never for a node's own error or
panic, which is an expression update. A run started before the edit (one an
evaluation triggered) can fail after it, so a failure counts only after the edit
returned; even then it may belong to that earlier run. That is the remaining
imprecision, and it only applies when the whole program fails.

**Two designs that were wrong; do not bring them back:**

- **Listening only after the graph update.** A small edit's execution ended
  0.2–0.5 s after the edit, often before the graph wait resolved, so nearly
  every edit waited the full 20 s and answered `settled: false`. Both watches
  start before the edit.
- **Settling on `executionComplete`.** One follows every evaluation (each
  `get_node` or `get_graph` preview), so a stray one arrives while the engine is
  still computing the edit. Settling on it gave `add_nodes` results with
  `type: null`. A variant that required an update batch after the edit first
  still failed: `collapse_nodes` settled on a mostly-`Pending` batch followed by
  a stray completion, 0.7 s before the call node's value came, and the next
  `open_method` on the node failed. `executionComplete` plays no part now.

`useProjectMcpTools(editor)` takes what only `GraphEditor.vue` has
(`McpEditorDeps`: the selection, `panToSelected`, the stack navigator, the
viewport, the collapse action). `GraphEditor.vue` calls it below those
definitions: a `const` used before its line is a run-time TDZ error, not a type
error.

`integration-test/project-view/mcpEdit.spec.ts` drives the tools in the real
editor. `window.__mcpCall(tool, args, caller?)` (`mock/registerMocks.ts`)
delivers a call as main would. The mock never evaluates by itself, so while an
edit tool's call runs, the spec has the mock report a value for every node of
the method (`mockExpressionValues`: `Pending`, then a `Value`, two
`expressionUpdates` notifications, as the engine sends) and an
`executionComplete` (`mockExecutionComplete`), both in `mock/lsHandler.ts`.
`_mockExpressionUpdate` cannot stand in: it writes to the registry directly,
which the watch does not see. Against the real engine,
`app/electron-client/tests/mcp.spec.ts` builds a project through every edit and
view tool in the packaged app, undoes one call with `Mod+Z`, and checks that
each code-running edit answers `settled: true` with current types and states, in
under 10 s (two `edit_node` calls back to back on a node and its user, the
second's type current in its own result; the same text again; a removed node's
user). It also checks that code wrapped in the Write prefix is refused by
`add_nodes`, `edit_node` and `evaluate_expression` and that the file it names is
never written.
