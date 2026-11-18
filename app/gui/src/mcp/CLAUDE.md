# src/mcp/

The window side of the IDE's MCP server: the dispatcher every tool call goes
through, and the app tools. The project tools (those that read and edit one
project) are in `src/project-view/mcp/` (see its `CLAUDE.md`); the tool
definitions are in `app/electron-client/src/mcp/` (`projectTools.ts`,
`appTools.ts`, and `visualizationTool.ts`, `imageTool.ts` and
`graphImageTool.ts` for the three tools that take a picture in main: their
window handlers, such as `prepare_graph_image`, are registered as project tools
but are not MCP tools). A tool needs both halves; keep each description in step
with what its handler returns and refuses.

- `toolDispatcher.ts` — started by `App.vue`. **Two kinds of registration**:
  - Project tools: `registerMcpToolHandlers`, one set per open project's graph
    editor. The most recently registered or activated set answers, and the
    editor removes its set on deactivation, so the project on screen answers and
    a hidden one never does. No set → `NO_PROJECT_ERROR`.
  - App tools: `registerMcpAppToolHandlers`, once, by the app shell
    (`AppContainer.vue` through `useAppMcpTools`). Kept in a separate map,
    consulted only when no project set has the tool. Their names are not project
    tool names, so they cannot answer in a project's stead, and they do not
    count as a project being shown.
  - Each project registration carries its project's id (a getter;
    `useProjectMcpTools` passes `currentProject.id`). `activeProjectToolsId()`
    is the id whose handlers answer. `whenProjectToolsActive(id, timeoutMs)`
    resolves `true` once that project's handlers answer (at once if they do),
    never on another project's activation, and `false` at the timeout, leaving
    no wait behind. `open_project` and `create_project` wait on it with the
    opened project's id: from then on the agent's next `get_graph` reads that
    project, not another tab that happened to activate meanwhile.
  - **A call carries its timeout.** Main sends `timeoutMs` with each call
    (`McpToolCallRequest`: 30 s to read, 60 s to edit, 120 s to open); the
    dispatcher passes each handler a `deadline`, `now()` at receipt plus
    `timeoutMs` (the clock is injectable). After it, main has told the caller
    the call timed out, so an edit must not be applied then: the edit session
    refuses a run with too little time left (see
    `src/project-view/mcp/CLAUDE.md`). Handlers that do not edit ignore it.
- `appTools.ts` — the assembler: it narrows the arguments of `get_app_state`,
  `list_projects`, `list_files`, `create_project`, `open_project`,
  `switch_project` and `close_project` (`appToolHandlers`) and re-exports the
  group modules' API. The tools are pure functions over `AppToolDeps`, tested
  with fakes, one module per group: `appStateTools.ts` (`get_app_state`),
  `appDriveTools.ts` (`list_projects`, `list_files`) and `appProjectTools.ts`
  (`create_project`, `open_project`, `switch_project`, `close_project`).
  `appToolSupport.ts` has the types (`AppToolDeps`, …), constants and helpers
  they share, and `appPaths.ts` the path checks (`resolveAllowedPath`). Names
  are cut at `NAME_CHARS` (300), lists at `MAX_ENTRIES` (500, with
  `truncated: true`).
- `switch_project` takes no path through `resolveAllowedPath`: it compares the
  agent's path exactly with the open projects' paths from `state()` (as
  `get_app_state` lists them) and refuses any other, listing the open ones, so
  it never touches the disk and opens nothing. The project already on screen
  answers at once; another is shown by `showProject` (`useAppMcpTools.ts`),
  which brings its tab up (rejecting when it has none) and waits, as opening
  does, for that project's tools to answer (`whenProjectToolsActive`, at most
  `SWITCH_WAIT_MS`, 20 s, inside main's 30 s). The editor of the project left
  removes its tools on deactivation, which also ends the agent's open undo step
  there.
- **Paths are the security boundary.** An external agent can list folders and
  open projects with these tools, so every path goes through
  `resolveAllowedPath` against the Drive's root and the saved local folders
  first, and the resolved path (not the agent's spelling) is what gets listed,
  created in or opened. It resolves `.` and `..`, unifies separators, and
  requires the root or a prefix ending at a separator. Windows or POSIX is
  decided by the root's own form (drive letter or UNC), never by the platform:
  this runs in the renderer. On Windows only ASCII letters compare
  case-insensitively (a fuller folding equates names NTFS keeps apart), and
  device paths, `:` in a segment and segments ending in a dot or space are
  refused. Symbolic links are out of scope.
- `open_project` refuses a path equal to a root, or whose parent is not itself
  in the Drive, without listing anything: only folders inside the Drive are ever
  listed.
- `useAppMcpTools.ts` — builds `AppToolDeps` at each call from the local backend
  (`listDirectoryEntries`, which keeps file sizes; the `createProject`
  mutation), the tabs (`useContainerData`) and `useOpenedProjects`. Opening
  waits at most `OPEN_WAIT_MS` (100 s, inside main's 120 s) and fails early with
  the project's open error. `close_project` closes the tab with `offer: false`
  (no repository question, so no dialog waits on the user) and waits up to
  `CLOSE_WAIT_MS` (20 s) for the close, which saves the "Saved on close" version
  when versioning is on.

`integration-test/dashboard/mcpApp.spec.ts` drives the app tools in the real app
through `window.__mcpCall` (`integration-test/mock/registerMocks.ts`).
