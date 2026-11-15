# project-view/mcp/

The window side of the MCP tools that read the open project. External agent apps
call the IDE's MCP server in Electron main; main forwards a project tool call to
the window over IPC, `$/mcp/toolDispatcher.ts` (mounted by `App.vue`) routes it
to the handler registered for the tool, and replies.

**A tool needs both halves.** Its name, description and argument schema are in
`app/electron-client/src/mcp/projectTools.ts`; its handler is here. Add or
rename one on both sides, and keep the description in step with what the handler
returns (`app/electron-client/src/mcp/guides/overview.md` describes the tools
too).

- `useProjectMcpTools.ts` registers the handlers while the graph editor is
  mounted (`GraphEditor.vue`) and removes them on scope dispose, so with no
  project open the dispatcher answers `NO_PROJECT_ERROR`. It narrows the
  arguments, which arrive as `unknown` (main has validated them already), and
  builds the dependencies from the current project's stores **at call time**: a
  handler never keeps a store or a snapshot of the graph between calls.
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
  when non-zero). The clock is `GraphToolDeps.now`, injected in tests.
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
- No tool here changes the project, the execution environment, settings or
  secrets.
