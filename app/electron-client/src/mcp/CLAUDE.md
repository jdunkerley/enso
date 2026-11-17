# src/mcp/

The IDE's MCP server for external agent apps (Claude Code, Codex, GitHub
Copilot): with it turned on, an agent the user has pointed at it can read the
project open in the IDE and edit it, and open or create projects. It is off by
default. No tool changes the execution environment, settings or secrets.

## The parts

- `toolRegistry.ts` — `ToolRegistry`: every tool's name, title, description and
  zod argument schema. `call` validates the arguments strictly (unknown keys are
  refused) and never throws: an unknown tool, bad arguments or a throwing tool
  give `{ ok: false, error }`. Over HTTP the SDK validates first, against
  `z.object(inputSchema)`, and passes the tool the parsed data, so unknown keys
  are stripped before the registry sees them (`McpServer.validateToolInput` in
  `@modelcontextprotocol/sdk` 1.30; `mcpServer.test.ts` checks it). The
  registry's strict check binds callers that do not go through the SDK.
- `projectTools.ts` — the definitions of the project tools: the seven that read
  (`VIEW_TOOL_NAMES`, `list_visualizations` and `get_documentation` among them)
  and the twelve that edit or navigate (`EDIT_TOOL_NAMES`, `set_documentation`,
  `move_nodes` and `arrange_nodes` among them). Each only forwards its arguments
  to the window.
- `visualizationTool.ts` — `get_visualization`, a project tool whose `run` does
  part of its work in main (see "Looking at a visualization").
- `imageTool.ts` — `add_image`, another: main reads the file or captures the
  picture, and the window stores it (see "Documentation and images").
- `graphImageTool.ts` — `get_graph_image`, the third: the window frames the
  nodes and main captures them (see "Layout and a picture of the graph").
- `appTools.ts` — the seven app tools (`get_app_state`, `list_projects`,
  `list_files`, `create_project`, `open_project`, `switch_project`,
  `close_project`), forwarded the same way.
- `windowBridge.ts` — `WindowBridge` forwards a call to the focused window (or
  the first one) over `Channel.mcpToolCall` and resolves with the reply
  (`Channel.mcpToolReply`, matched by `requestId`), or with an error when there
  is no window or the call's timeout passes (`WINDOW_TOOL_TIMEOUT_MS` 30 s by
  default, `EDIT_TOOL_TIMEOUT_MS` 60 s, `OPEN_TOOL_TIMEOUT_MS` 120 s). The
  request carries that timeout (`McpToolCallRequest.timeoutMs`), so that the
  window never applies an edit after main has answered that it timed out.
- `guides.ts` and `guides/*.md` — the `get_guide` tool, the guides as MCP
  resources (`enso://guide/<topic>`) and the server `instructions`
  (`guides/instructions.md`). Built-in topics (`overview`, `language`,
  `data-pitfalls`) come from the Markdown here (bundled by esbuild's `.md` text
  loader); `stdlib` and `library/<Name>` are the bundled standard library's own
  `CLAUDE.md` files, read from `paths.stdlibRoot`. `guides/overview.md`
  describes the tools: keep it in step with them.
- `mcpServer.ts` — `McpHttpServer`, the HTTP server on `127.0.0.1:<port>/mcp`.
- `mcpController.ts` — `McpController`: the on/off setting and port, the token,
  start and stop, the status, and the setup text each client pastes.
- `claudeDesktop.ts` — setting up Claude Desktop: reads and edits its
  `claude_desktop_config.json` (folder from `claudeDesktopConfigDirectory`:
  `%APPDATA%\Claude`, or `~/Library/Application Support/Claude` on macOS; none
  elsewhere). It adds only `mcpServers.enso`, the `mcp-remote` bridge with the
  token in `env` (Claude Desktop on Windows mishandles arguments with spaces).
  It never writes a file it cannot parse or whose top level or `mcpServers` is
  not an object. A zero-byte or whitespace-only file counts as empty and a UTF-8
  BOM is ignored; comments or a trailing comma stay unreadable. It saves
  `claude_desktop_config.json.enso-backup` only on first set-up (the file has
  content and no `enso` entry), as the file's exact bytes, so the backup stays
  the user's file from before Enso touched it; replacing an entry never writes
  or changes a backup, so an older backup is overwritten only when the entry was
  removed and is set up again. It writes through a symbolic link to its target
  (`fs.realpath`), writes a temporary file beside the target with the target's
  permission bits, and renames, removing the temporary file if the rename fails.
  The controller (`claudeDesktopStatus`, `setUpClaudeDesktop`) runs these on its
  queue. Status checks the folder first and never creates a token: with none
  stored an `enso` entry is `outOfDate`. (An existing keychain token is migrated
  on a status read, see "Settings, token"; that creates nothing.) Only
  `setUpClaudeDesktop` (a click) creates the token. `replaceToken` and `setPort`
  read the status with the OLD address and token first and rewrite the entry
  afterwards only if it was `setUp` (Enso's own): a hand-edited entry is left
  alone and a missing one is never created; a rewrite failure is logged. Nothing
  is written on `setEnabled`. The token never reaches the renderer: the IPC
  calls return only a `ClaudeDesktopStatus` (the state and the configuration
  file's path, which Settings shows beside Copy JSON). Settings → AI offers the
  set-up only while the server is on
  (`app/gui/src/dashboard/layouts/Settings/CLAUDE.md`, "AI"). Tests inject a
  temporary folder; never point one at the real Claude folder.
- `clientConfigs.ts` — that setup text per client (`claude mcp add` command,
  Claude Desktop `mcp-remote` JSON, Codex TOML, Copilot JSON for VS Code and the
  CLI, a generic `mcpServers` block), each checked against the vendor's
  documentation (dates in the code). The Codex block sets
  `tool_timeout_sec = 120` (Codex's default is 60 s, which an edit or an open
  can take).

`electron.ts`'s `initMcp` wires them together at start-up and registers the IPC
the Settings → AI tab uses (`Channel.mcp*`); `index.ts` calls `shutdownMcp` on
`before-quit`. The shared types (`McpCaller`, `McpToolResult`, `McpStatus`,
`MCP_DEFAULT_PORT` 39417, `MCP_CLIENT_KINDS`) are in `app/common/src/mcp.ts`.

## A tool needs both halves

A project tool has its definition (name, description, schema) here in main and
its handler in the window: `app/gui/src/project-view/mcp/` (see its
`CLAUDE.md`), registered while the graph editor is mounted, and run by
`app/gui/src/mcp/toolDispatcher.ts`. The project whose tab is showing answers:
every open project registers its handlers, and the most recently registered or
activated set answers (a project activates its set when its tab shows and
removes it when hidden). With no project showing (the dashboard, or none open)
the dispatcher answers that no project is open. Add, rename or change a tool on
both sides, and keep its description and `guides/overview.md` in step with what
the handler returns. Only `get_guide` runs entirely in main;
`get_visualization`, `add_image` and `get_graph_image` do part of their work
there.

## Looking at a visualization

`list_visualizations { node_id }` is a plain forward to the window (30 s): it
answers `{ node_id, shown, visualization, available, size }`, the names of the
visualizations the node's type offers in the order of its toolbar's dropdown,
the name of the one on screen (null when none is) and its size, and changes
nothing, so it works in Live. `size` is
`{ width, height, default_width, default_height }`: the visualization as drawn
(or as it would be drawn, for a hidden one), in scene units, and whether each is
the default (the node's width or 200, and 150 high). Every `get_visualization`
result has it too.

`set_visualization { node_id, visible, width?, height? }` shows, hides or
resizes a visualization in one edit (`graph.setNodeVisualization`, once):
`width` and `height` are 100 to 2,000 scene units, or `null` for the default,
and one left out stays as it is. A larger visualization pushes the nodes around
it away and they return when it shrinks, as when the user resizes it. It answers
`{ node, size, settled: true }`, `size` read after the edit.

`get_visualization { node_id, format?, visualization? }` answers with what a
node's visualization shows. `visualization` (at most 100 characters) is a name
from `available`: a name the node does not offer is refused before anything
changes, and a name not on screen switches the node to it in one edit through
the edit session (visible and identifier together, as the toolbar writes them;
refused in Live, part of the caller's undo step), where it stays. The window
then waits for **that** visualization: one whose registry entry has the name and
is no longer loading, since the old view stays `ready` for a few frames after
the switch. Every result has `available` and `changed`, which means this call
changed the node's stored visualization choice (compared with the one on screen,
or, for a hidden node, the identifier saved in its metadata). An error that
comes after the call showed or switched the visualization says so, and a node
the user is editing is answered at once (its panel is unmounted).
`format: 'data'` forwards both arguments to the window handler
`get_visualization_data`, which answers
`{ node_id, visualization, shown, changed, truncated, available, size, data }`
with the data the view was given, at most 20,000 characters
(`VISUALIZATION_DATA_CHARS`). `format: 'image'` (the default) is two steps:

1. **The window readies it**: the window handler `prepare_visualization` shows a
   hidden visualization (through the edit session, as `set_visualization` does:
   refused in Live, part of the caller's undo step), waits at most 15 s
   (`VISUALIZATION_WAIT_MS`) for it to get its data, moves the view when the
   panel is not wholly in the viewport at 100% zoom, waits for the view to stop
   moving, then for the panel's DOM to be quiet (no mutation for 250 ms, at most
   3 s or the time left before the call's deadline: `PANEL_QUIET_MS`,
   `PANEL_QUIET_CAP_MS` in `app/gui/src/project-view/mcp/panelQuiet.ts`), then
   two still frames, and answers the panel's rectangle in CSS pixels, cut to the
   graph viewport.
2. **Main captures it**: `electron.ts` passes the tool a `Capture` that calls
   `webContents.capturePage` on that rectangle (scaled by the page's zoom
   factor). The tool captures until a capture's PNG bytes equal the one before,
   150 ms apart, at most 10 captures (`CAPTURE_INTERVAL_MS`,
   `CAPTURE_MAX_TRIES`), and keeps the last. **Why both**: with the GPU off (as
   the packaged tests run), status `ready` plus two animation frames gave a
   stale picture, the graph without the just-shown panel or a table without its
   cells, because the window's composited frame lags the page and AG Grid draws
   its cells after the data arrives. The tool then answers a PNG image item of
   at most 1,200 pixels on its longer side (`IMAGE_MAX_SIDE`; only the final
   capture is resized) and a text item
   `{ node_id, visualization, shown, changed, moved, available, size, width, height }`,
   `width` and `height` read from the PNG (`preparedSchema` accepts and passes
   on `changed`, `available` and `size`). The picture is of the visualization at
   its current size, so an agent makes it larger with `set_visualization` first
   to see more of a table or chart. A minimised or missing window, or an empty
   capture, gives "The Enso window could not be captured …".

**Only main produces images**: the window never sends one, only where to look.
`get_visualization_data` and `prepare_visualization` are window handlers, not
MCP tools: they are not in `projectTools.ts` and an agent cannot call them. The
capture is cut to the graph viewport, but a docked panel drawn over the graph
(the documentation or logs panel) is not detected, so it can appear in the
picture. The window's half, and the registry of mounted visualizations it reads,
are described in `app/gui/src/project-view/mcp/CLAUDE.md`.

The app tools run in the window too (`app/gui/src/mcp/appTools.ts`, registered
once by the app shell), so they answer on any page. Every path an agent passes
them must be the Drive's root folder, a local folder the user added to the
Drive, or inside one (`resolveAllowedPath`): anything else is refused with "That
folder is outside the Drive", before anything is listed or opened.
`create_project` and `open_project` answer once the opened project's own tools
answer, waited for by its project id (`whenProjectToolsActive`), so the agent's
next call reads that project and not another tab; main gives them 120 s, the
window 100 s. `switch_project { path }` brings the tab of a project that is
already open on screen and answers `{ name, path }` the same way, once its tools
answer (30 s in main). The path is compared exactly with the open projects'
paths as `get_app_state` lists them, never resolved against the disk, so it
opens and creates nothing: any other path is refused with the open projects
listed and a pointer to `open_project`. Leaving a tab ends the caller's undo
step in the project left, as the user's tab change does.

## Layout and a picture of the graph

`get_graph { layout: true }` adds each node's `position` (its stored top-left)
and `area` (`graph.visibleArea`: the room it takes on screen, its visualization
included; absent for a node not drawn yet), and the result's `view`
`{ x, y, width, height, scale }`: the part of the scene on screen and the zoom
it is drawn at. All in scene units (pixels at 100% zoom, x to the right, y
down), rounded. Without `layout` nothing changes.

`move_nodes { moves }` (1 to 200 of `{ node_id, x, y }`, each coordinate finite
and within ±1,000,000) and `arrange_nodes { action, node_ids? }` are edits,
forwarded with the 60 s timeout and run through the edit session (refused in
Live, part of the caller's undo step). `arrange_nodes` runs the user's own Tidy
up (`tidy`), Align (`align_left`, `_right`, `_center`, `_top`, `_bottom`) or
Spacing (`space`, `space_tight`, `space_wide`, `space_none`); Align and Spacing
need two or more `node_ids` (at most 500). Each makes one
`graph.setNodePositions` call, changes nothing the engine runs, and so answers
`settled: true` at once; a call that changes nothing (every node already there)
answers without waiting for a graph update. Neither moves the view or changes
the selection. They answer `{ moved: [{ id, position }] }` and
`{ action, arranged }` (the nodes this edit moved).

`get_graph_image { node_ids? }` (`graphImageTool.ts`) is two steps, as
`get_visualization`'s picture: the window handler `prepare_graph_image` (not an
MCP tool) frames every node of the method, or those of `node_ids` (1 to 500, in
main's schema and again in the window; an unknown id refuses), with a 40-unit
margin, in the part of the viewport no overlay covers (below the top bar, above
the closed dock's buttons, inside the scroll bars), at the largest zoom in
10%–100% at which they fit there, without animation; waits for the view to stop
and two still frames; and answers the client rectangle of the framed nodes with
their margin, cut to that clear part (below 10% not everything fits: the middle
is shown), the zoom and the number of nodes framed (those drawn). The picture is
the nodes, not the viewport: no top bar and no empty background around a small
graph. Main captures that rectangle with the same `stableCapture` and
`cappedPng` (at most 1,200 pixels on the longer side) and answers the PNG with
`{ scale, width, height, nodes }`. It edits nothing, so it works in Live; it
moves the view and does not move it back. A method with no nodes is an error.

## Documentation and images

`get_documentation` and `set_documentation` are plain forwards (30 s and 60 s)
to the window handlers in `app/gui/src/project-view/mcp/documentationTools.ts`.
The documentation is the Markdown the documentation panel shows for the function
on screen: the workflow's at the top level, a function of the project's after
`open_method`. `get_documentation` answers `{ method, text, truncated }` (at
most 50,000 characters) and works in Live. `set_documentation { text }` (at most
100,000 characters) **replaces all of it** in one module edit through the edit
session (refused in Live, part of the caller's undo step) and answers
`{ method, characters, settled: true }`; a text equal to the current one at the
edit's turn edits nothing and adds `unchanged: true`, and is still refused in
Live.

`add_image { path | node_id, name? }` (`imageTool.ts`) stores an image in the
project's `images` folder, for the documentation. It takes exactly one of `path`
and `node_id`:

- **`path`**: main reads the file with the user's rights, so it is checked first
  (Note [add_image Reads Only Images]). On Windows only a drive path (`C:\…` or
  `C:/…`), with no other `:`: network (`\\host\share`), device (`\\.\`, `\\?\`)
  and alternate-data-stream (`C:\notes.txt:x.png`) paths are refused before
  anything touches them; elsewhere any absolute path. The extension must be an
  accepted image kind (`.png`, `.apng`, `.jpg`, `.jpeg`, `.gif`, `.webp`,
  `.avif`, `.svg`: the documentation editor's list) **and** the leading bytes
  that same kind, so a text file named `.png`, or a PNG named `.jpg`, is refused
  and nothing is copied. A regular file (after links) of at most 10 MB
  (`IMAGE_MAX_BYTES`), checked from its size before it is read and again while
  reading. No error quotes the file's content. A `path` works in Live: storing a
  file is not an edit.
- **`node_id`**: a picture of the node's visualization, taken exactly as
  `get_visualization` takes one (`pictureVisualization`, the same Live rules,
  `shown` and `moved` in the result), stored as PNG. The picture and the store
  are two window calls, so `prepare_visualization`'s answer carries the id of
  the project that answered (`project_id`, which `get_visualization` does not
  pass on to the agent), main sends it to `store_image`, and a different project
  on screen by then refuses ("The project on screen changed …"). A `path` image
  has no first call, so no id is sent or checked.

`name` (at most 100 characters; letters, digits, spaces, `.`, `_`, `-`; no
folders, no device name) chooses the stored name; its extension is set to match
the image. By default the source file's name, or the node's. Main then sends the
bytes as base64 to the window handler `store_image`
(`app/gui/src/project-view/mcp/imageTools.ts`), which **is not an MCP tool**: it
is in no tool list, and an agent cannot call it. It checks the name and size
again and writes through the documentation editor's upload functions: the folder
is made if missing, `pickUniqueName` picks a name no file has (`chart_1.png`
when `chart.png` is taken; compared case-insensitively, so `Chart.png` never
replaces `chart.png` on Windows or macOS), and nothing is ever overwritten.
Stores run one at a time, so two cannot pick the same free name, and none
creates or writes anything with less than 5 s left before the call's 60 s
deadline (`STORE_DEADLINE_MARGIN_MS`). It answers `{ path, markdown, bytes }`:
the project-relative URL the editor writes (`/images/<name>`), the Markdown
`![<alt>](<path>)` to put into `set_documentation`'s text, and the size. Storing
an image is not on the undo stack; an image no longer used stays for the user to
delete (no tool deletes or renames one).

## Edits

The edit tools run through one edit session per open graph editor
(`app/gui/src/project-view/mcp/editSession.ts`; its `CLAUDE.md` has the
details). Its rules, which the tool descriptions and `guides/overview.md` state:

- **One writer at a time**: the session queues edits and runs one at a time,
  whoever calls.
- **Refused in Live** (`LIVE_EDIT_ERROR`: "The project is in Live mode. Edits by
  an agent are refused there. …"), read at the edit's turn and after the version
  save, and **refused when the project is not on screen** (its tab was hidden
  while the call waited).
- **Refused too late**: an edit with less than 25 s of its call's timeout left
  at its turn, or after the version save, is refused ("The call timed out before
  it ran. Nothing was changed; try again."), so it is never applied after main
  has answered that the call timed out.
- **Refused in another method**: an edit whose turn comes after the method on
  screen changed, or after one of its nodes was removed, changes nothing and
  says so.
- **One undo step per caller**: a caller's edits join one undo step until it has
  made no edit for 10 s, measured from the end of its last run, or until the
  user edits the project, the user leaves the project's tab, or the agent opens
  a method, which ends the step.
- **A version first**: before a step's first edit the session saves a version
  (`Before changes by <caller>`) when the project keeps versions; the edit is
  refused if that save fails.
- `add_nodes` creates all its nodes and import lines in one module edit, or none
  of them: a statement that does not parse, a name already used or an unknown
  `after_node` refuses the whole call.
- An edit never moves the view or changes the selection; only `select_nodes` and
  `open_method` do.

An edit answers once the engine has reported results for the nodes it changed
(`settled: true`, the types and errors in the result are current) or after 20 s
(`settled: false`); `app/gui/src/project-view/mcp/CLAUDE.md` ("When an edit has
settled") says exactly what counts and what does not.

Edits are saved with the project as they are made, as the user's are: in the
packaged spec the edit's text was in `src/Main.enso` on disk about 4–7 s after
the call answered, with the project still open. Every tool that takes code
refuses code that enables the output context by the routes that are known: the
two enabling functions (`with_enabled_context`, `with_enabled`), an
`@Builtin_Method` binding, reflection by `Meta.meta`, evaluating text with
`Debug.eval`, and looking a method up by a name in text (`Polyglot.get_member`,
`Polyglot.invoke`). `edit_node` and `collapse_nodes` refuse a node the user
turned Write on for. Three of those routes were found only by review after the
first version, and a fourth while fixing the third; each really wrote a file in
the packaged app. The guard is a list of names over the AST, so others may
exist, and it is **not a security boundary**: Java and other polyglot code
(`foreign python`, `foreign js`) are not covered at all and can write a file
directly, the user's own Write-enabled functions and nodes can be driven by an
agent's edits, and a real guarantee needs engine-side enforcement (an
execution-level lock on the output context), which is not built. The list, its
history and the routes review found (all now refused) are in
`app/gui/src/project-view/mcp/CLAUDE.md`, "Write stays the user's". The tool
descriptions (`WRITE_RULE` in `projectTools.ts`) and the guides tell the agent
the same, and name the two ways its edits can still cause a write.

## History, versions, problems and refresh

Five more project tools (definitions in `projectTools.ts`, handlers in
`app/gui/src/project-view/mcp/`: `historyTools.ts`, `versionTools.ts`,
`problemTools.ts`, `refreshTool.ts`):

- **`undo` / `redo`** go through the edit session without an undo step or a
  saved version. `undo` takes back the most recent step of edits made by any
  connected agent, and only those made since the user last changed the project
  (a user edit, their own Ctrl+Z included, ends the agents' history); it is
  refused when there are none. A step is usually every edit made without a 10 s
  pause, but one `undo` may take back only part of it. `redo` re-applies only
  what `undo` took back, until anyone edits. Neither waits for the engine: the
  answer has no `settled`. **The rule** (an agent never causes a write the user
  did not click for): both are refused while the project's main module has code
  that enables output, and an edit made while it has some (removing it included)
  cannot be undone by an agent. A change that does not go through the undo
  manager (the file changed on disk) cannot make one `undo` reach the user's
  steps: the session undoes above a floor. Not checked: the project's other
  modules, library functions that enable output themselves, `foreign` code. The
  details, the invariant and its limits are under "History" in
  `app/gui/src/project-view/mcp/CLAUDE.md`. Both are refused in Live.
- **`save_version`** saves a version as the user's Save a version does; it never
  turns versioning on (refused when it is off), changes no node, and works in
  Live.
- **`get_problems`** reads the errors, panics and warnings of the method on
  screen and the module's compile diagnostics. `origin: true` marks the node to
  fix first; the agent calls again while `pending` is not 0. Reads only; works
  in Live.
- **`refresh`** computes every node again in Design (`recompute('all')` with no
  environment argument), never turns Write on, and is refused in Live and when
  the code of the project's main module (`Main.enso`, the module the graph
  shows) enables output anywhere, because the refresh would run it and write
  again; the agent asks the user to refresh. Its description and the guide say
  what is not checked: other modules, library functions that enable output
  themselves, `foreign` code.

## The caller checks

Any local process can reach a loopback port, and a web page in the user's
browser can send it requests, so every request passes three checks before the
MCP transport sees it, in this order (`refusal`, Note [The MCP Server Checks Its
Caller]):

1. no `Origin` header — the agent apps send none, a browser sends one on every
   `POST`: `403` otherwise;
2. a `Host` that is a loopback name (`127.0.0.1`, `localhost`, `[::1]`) with
   this server's port — against DNS rebinding: `403` otherwise;
3. `Authorization: Bearer <token>`, compared in constant time: `401` otherwise.

Then a request target that does not parse is `400` and any path but `/mcp` is
`404`; everything after the checks runs inside one `try` (the request handler
runs as `void`, so a throw would be an unhandled rejection in main). Refusals
are logged at the 1st, 10th, 100th, … only, so a looping process cannot fill the
log. The server binds `127.0.0.1` only; do not bind another address or add a
route before the checks.

## Stateless, and the caller's name

Each request gets its own `McpServer` and transport (no sessions: an IDE restart
would invalidate every client's session id). So the `clientInfo` a client sent
on `initialize` is gone by its `tools/call`, and the caller's name passed to the
tools (`McpCaller`, `kind: 'external'`) comes from the request's `User-Agent`:
its first product token (`callerName`, at most 64 characters, `unknown` when
there is none). It is a label for display and logs, chosen by the client: never
authorise anything by it. The token is the only credential.

## Settings, token and environment overrides

- **The setting** is `<userData>/mcp-settings.json`, `{ enabled, port, token }`
  (default off, port 39417, no token), written atomically (a temporary file,
  then a rename) with mode `0o600`, so only the user can read it where the
  platform enforces modes (Windows does not; no ACL code). Unknown fields are
  ignored. A missing file (`ENOENT`) or malformed JSON means the defaults. Any
  other read failure (busy, no permission) is an error, not a reset: no
  migration, no new token, nothing written, and no server starts. The status
  error "The MCP settings file could not be read: …" is reported whether or not
  the server is switched on, so Settings shows it; it lasts until the app
  restarts. The temporary file is removed first and created fresh, and synced
  before the rename.
- **The token** is the settings file's `token` field. It used to be in the
  system keychain; the owner chose the file because the server is loopback only
  and the token already sits in plain text in each agent app's own configuration
  (Claude Desktop's `env`, the `claude mcp add` header), so the keychain added
  prompts and a failure mode, not secrecy. The `Origin` and `Host` checks ("The
  caller checks") are unchanged and still do the work against web pages. It is
  created on first use (turning the server on, or copying a setup); New token in
  Settings replaces it (written to the file), and a running server restarts with
  it. **Migration:** with no token in the file and no `ENSO_MCP_TOKEN`, the
  keychain (service `Enso`, account `mcp-token`, `MCP_TOKEN_ACCOUNT`, through
  `options.entry`) is read once per session; a token found there is copied into
  the file and used, so agent apps already configured keep working. A keychain
  that throws, is unavailable or is empty counts as holding nothing. The
  keychain is never written for the MCP token; the old entry is deleted once the
  file save succeeded (best effort, a failure is ignored; not deleted if the
  save failed), so a revoked token cannot come back; once the file has a token
  the keychain is not consulted. When the keychain read failed and a new token
  is created, one line is logged (never the token). A status read may migrate
  but never creates a token. The token never enters the renderer: the status is
  built from separate fields (`enabled`, `port`, ...), not the file's contents,
  and the only way out is `copyConfig`, which writes the setup text to the
  clipboard from main.
- **Environment overrides**, which win over the file: `ENSO_MCP_ENABLED=1` turns
  the server on (without changing the file), `ENSO_MCP_PORT=<port>` sets the
  port (1024 to 65535; another value is ignored), and `ENSO_MCP_TOKEN=<token>`
  is the token (it is never written to the file, the keychain is not read, and
  New token is refused). While `ENSO_MCP_ENABLED=1` or a valid `ENSO_MCP_PORT`
  is in effect, the status's `lockedByEnvironment` is true, `setEnabled` and
  `setPort` reject (`MCP_LOCKED_BY_ENVIRONMENT_ERROR`) and change nothing, and
  Settings shows both controls disabled. The packaged-app spec
  (`tests/mcp.spec.ts`) uses all three, so tests never touch the real keychain
  item or settings file. Unit tests use a fake keyring only.
- A start that fails is reported in the status's `error` (port in use, the token
  could not be saved), which the Settings section shows; it never stops the IDE
  starting, and an unavailable keychain no longer fails a start. `init` does not
  wait for the server.
- `setEnabled` and `setPort` update the in-memory setting only after the file is
  written; a failed write rejects and changes nothing. A throwing
  `onStatusChanged` is logged and ignored. After `shutdown()` nothing starts a
  server again: `setEnabled`, `setPort` and `replaceToken` resolve with the
  current status and change nothing.

## Output bounds

Main does not cap a tool's result; the window does. Every text that comes from
an evaluation is truncated there (`get_graph` previews 2,000 characters,
`get_node` 20,000, `evaluate_expression` 20,000 with a note saying how long it
was), and `get_graph` runs its value previews in batches: at most 8 at a time,
none started after 15 s or once 40,000 characters of previews are collected,
with the rest counted in `previews_skipped`; it also caps the `source` (50,000)
and each node's `code`, `comment` and panic `message` (2,000). A preview
evaluation does not interrupt the execution context on timeout;
`evaluate_expression` does (25 s). The window bridge gives up after 30 s for a
reading tool, 60 s for an edit (which waits up to 20 s for the execution) and
120 s for opening or creating a project. Details in
`app/gui/src/project-view/mcp/CLAUDE.md`.

`evaluate_expression` runs only in the Design environment: the window refuses it
while the project is in Live mode, because an evaluation runs in the execution
context's environment. In Design the output context is off, so a plain write
does not reach the path it names (`tests/mcp.spec.ts` checks this against the
packaged app), and code that enables the output context is refused by the same
guard as the edits. Writes that support a dry run still write their data to a
temporary file (`<name>_ensodryrun<digits>.<ext>` in the system temporary
directory) and return its path; the tool description and `guides/overview.md`
say so. This prevents accidental writes; it is not a security boundary (see
"Edits" above): an expression can still call a function of the user's project
that enables output.

## The only MCP server

The in-app AI prompt mode had an MCP server of its own (under `src/ai/`, for its
`claude` child process). It was removed with that mode; this server is the IDE's
only AI route.

## Tests

- `tests/headless/mcpToolRegistry.test.ts`, `mcpWindowBridge.test.ts`,
  `mcpGuides.test.ts`, `mcpServer.test.ts` (a real SDK client against the
  server), `mcpController.test.ts` (fake keyring and server),
  `mcpClientConfigs.test.ts`, `mcpClaudeDesktop.test.ts` (a temporary folder,
  never the real Claude folder), `mcpVisualizationTool.test.ts` (a fake bridge
  and capture), `mcpImageTool.test.ts` (a fake bridge, capture and file reader,
  both path rules by an injected platform), `mcpGraphImageTool.test.ts` (a fake
  bridge and capture).
- `tests/mcp.spec.ts` — the packaged app, three tests. The first: an SDK client
  lists the 33 tools, reads the guide and the graph of a new project, searches
  components, evaluates, checks that an evaluation does not write the file it
  names (the answer names the dry-run file, which the test deletes), and that a
  request without the token is `401`. The second builds a project from the
  dashboard against the real engine: `create_project`, `switch_project` (to the
  project on screen, and to a path no tab has, refused with the open project
  listed), `add_nodes` (with an import line, and with a node in error that
  `edit_node` fixes), `get_visualization` of the vector node's hidden
  visualization (a PNG of the size its text states, not one flat colour,
  attached as `visualization.png`; 3 s later a second picture, byte for byte the
  same, the stale-frame check; then its data; then `list_visualizations`, whose
  `available` holds the name the picture reported, and a picture of another name
  from it, `changed` and not the first picture's bytes, again the same 3 s
  later, attached as `other-visualization.png`; and before that, the same
  visualization set to 600 × 400 by `set_visualization`, whose `size` says so,
  then a picture wider and higher than the default one, attached as
  `viz-600x400.png`, then `null` for both and a picture of the first one's
  dimensions again), `add_image` of that node (`/images/numbers.png`, a PNG on
  disk of the stated size, attached as `add-image-node.png`), of a PNG file in a
  temporary folder (the same bytes in `images/chart.png`) and of a text file
  named `.png` (refused, nothing copied), `set_documentation` of text with both
  images' Markdown, read back by `get_documentation` and found in `Main.enso` on
  disk, then the same text again (`unchanged: true`), code in the Write prefix
  refused by `add_nodes`, `edit_node` and `evaluate_expression` with the file it
  names never written, `edit_node` back to back on a node and its user (the
  second result current) and to the same text, a `remove_nodes` of a node with a
  user, `set_node_comment`, `set_visualization`, `select_nodes`,
  `collapse_nodes`, `open_method` in and out, `add_function`,
  `get_graph { layout: true }` (a position and an area for every node),
  `move_nodes` (read back by `get_graph`), `arrange_nodes { action: "tidy" }`,
  `get_graph_image` (a PNG of the stated size, not one flat colour, framing
  every node, attached as `graph.png`), one `Mod+Z` in the window taking back a
  whole `add_nodes` call, `remove_nodes`, `list_files`, the path rule,
  `close_project` (the edits are in `Main.enso` on disk) and `open_project` (the
  documentation read again is the text set); it deletes the project it made. The
  third drives the five history tools against the real engine: `get_problems` on
  a dataflow error and the node using it (message present, `origin` true then
  false), on a compile error (its diagnostic's `line` is the 1-based line of
  `Main.enso`), `refresh` (answers `settled: true`, also inside a function with
  an argument), `undo` and `redo` of a step, `save_version` (refused: versions
  are off in a new project), and the Write rule, against a node that really
  writes: the user (the test, typing in the Component Browser) makes a node with
  `Standard.Base.Runtime.with_enabled_context Standard.Base.Runtime.Context.Output <| "w".write …`
  (the two-argument form; it appends to its file each time it runs), and the
  test checks that (a) it wrote once; (b) `refresh` is refused and the file's
  content and modification time are unchanged after 8 s; (c) after an agent's
  `add_nodes` elsewhere `undo` is refused (code that can enable output) and the
  edit stays; (d) after `remove_nodes` of the write node `undo` is refused, the
  node does not come back and the file is unchanged; (e) with the code gone an
  agent's node is undone and redone and `refresh` answers
  `refreshed: true, settled: true`, the file still unchanged. The control: the
  user makes the node again and the file changes, so the checks would have seen
  a write. The GUI's own Write prefix (`Context.Output __ <| __`,
  `util/ast/node.ts`) does not run on this engine, whose `with_enabled_context`
  takes two parameters ("Method `<|` of type Text could not be found"), so the
  test does not use it (a known defect,
  `app/gui/src/project-view/mcp/CLAUDE.md`). None of the three can check the
  Live-mode refusals: nothing in the UI switches a project to Live (the
  project's `executionMode` setting is only read from its settings), so
  `app/gui/src/project-view/mcp/__tests__/` covers them. The GUI side has its
  own Playwright specs: `app/gui/integration-test/project-view/mcpEdit.spec.ts`,
  `project-view/mcpDocumentation.spec.ts` and
  `integration-test/dashboard/mcpApp.spec.ts`.
