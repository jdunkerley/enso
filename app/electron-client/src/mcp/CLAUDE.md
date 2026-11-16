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
  and the ten that edit or navigate (`EDIT_TOOL_NAMES`, `set_documentation`
  among them). Each only forwards its arguments to the window.
- `visualizationTool.ts` — `get_visualization`, a project tool whose `run` does
  part of its work in main (see "Looking at a visualization").
- `imageTool.ts` — `add_image`, the other one: main reads the file or captures
  the picture, and the window stores it (see "Documentation and images").
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
  stored an `enso` entry is `outOfDate`; a keychain read failure gives
  `unreadable`. Only `setUpClaudeDesktop` (a click) creates the token.
  `replaceToken` and `setPort` read the status with the OLD address and token
  first and rewrite the entry afterwards only if it was `setUp` (Enso's own): a
  hand-edited entry is left alone and a missing one is never created; a rewrite
  failure is logged. Nothing is written on `setEnabled`. The token never reaches
  the renderer: the IPC calls return only a `ClaudeDesktopStatus` (the state and
  the configuration file's path, which Settings shows beside Copy JSON).
  Settings → AI offers the set-up only while the server is on
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
the handler returns. Only `get_guide` runs entirely in main; `get_visualization`
and `add_image` do part of their work there.

## Looking at a visualization

`list_visualizations { node_id }` is a plain forward to the window (30 s): it
answers `{ node_id, shown, visualization, available }`, the names of the
visualizations the node's type offers in the order of its toolbar's dropdown and
the name of the one on screen (null when none is), and changes nothing, so it
works in Live.

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
`{ node_id, visualization, shown, changed, truncated, available, data }` with
the data the view was given, at most 20,000 characters
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
   `{ node_id, visualization, shown, changed, moved, available, width, height }`,
   the size read from the PNG (`preparedSchema` accepts and passes on `changed`
   and `available`). A minimised or missing window, or an empty capture, gives
   "The Enso window could not be captured …".

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
  `C:/…`): network (`\\host\share`) and device (`\\.\`, `\\?\`) paths are
  refused before anything touches them; elsewhere any absolute path. The
  extension must be an accepted image kind (`.png`, `.apng`, `.jpg`, `.jpeg`,
  `.gif`, `.webp`, `.avif`, `.svg`: the documentation editor's list) **and** the
  leading bytes that same kind, so a text file named `.png`, or a PNG named
  `.jpg`, is refused and nothing is copied. A regular file (after links) of at
  most 10 MB (`IMAGE_MAX_BYTES`), checked from its size before it is read and
  again while reading. No error quotes the file's content. A `path` works in
  Live: storing a file is not an edit.
- **`node_id`**: a picture of the node's visualization, taken exactly as
  `get_visualization` takes one (`pictureVisualization`, the same Live rules,
  `shown` and `moved` in the result), stored as PNG.

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

- **The setting** is `<userData>/mcp-settings.json`, `{ enabled, port }`
  (default off, port 39417), written atomically (a temporary file, then a
  rename). A missing or unreadable file means the defaults.
- **The token** is in the system keychain, service `Enso`, account `mcp-token`
  (`MCP_TOKEN_ACCOUNT`), through the same `@napi-rs/keyring` entries as the
  secrets key (`keyringEntries` in `projectService.ts`). It is created on first
  use (turning the server on, or copying a setup); New token in Settings
  replaces it, and a running server restarts with it. It never enters the
  renderer: the only way out is `copyConfig`, which writes the setup text to the
  clipboard from main.
- **Environment overrides**, which win over the file and keychain:
  `ENSO_MCP_ENABLED=1` turns the server on (without changing the file),
  `ENSO_MCP_PORT=<port>` sets the port (1024 to 65535; another value is
  ignored), and `ENSO_MCP_TOKEN=<token>` is the token (the keychain is not read,
  and New token is refused). While `ENSO_MCP_ENABLED=1` or a valid
  `ENSO_MCP_PORT` is in effect, the status's `lockedByEnvironment` is true,
  `setEnabled` and `setPort` reject (`MCP_LOCKED_BY_ENVIRONMENT_ERROR`) and
  change nothing, and Settings shows both controls disabled. The packaged-app
  spec (`tests/mcp.spec.ts`) uses all three, so tests never touch the real
  keychain item. Unit tests use a fake keyring only.
- A start that fails is reported in the status's `error` (port in use, no
  keychain), which the Settings section shows; it never stops the IDE starting.
  `init` does not wait for the server: start-up must not wait on the keychain.
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

## Not the AI mode's server

`src/ai/aiMcpServer.ts` is a different MCP server: the one the in-app AI mode's
own `claude` child uses, on a random port with a per-launch token in a config
file (see "AI tool bridge" in `../../CLAUDE.md`). It shares no code with this
one and stays as it is until the chat PR replaces the AI mode and removes it.

## Tests

- `tests/headless/mcpToolRegistry.test.ts`, `mcpWindowBridge.test.ts`,
  `mcpGuides.test.ts`, `mcpServer.test.ts` (a real SDK client against the
  server), `mcpController.test.ts` (fake keyring and server),
  `mcpClientConfigs.test.ts`, `mcpClaudeDesktop.test.ts` (a temporary folder,
  never the real Claude folder), `mcpVisualizationTool.test.ts` (a fake bridge
  and capture), `mcpImageTool.test.ts` (a fake bridge, capture and file reader,
  both path rules by an injected platform).
- `tests/mcp.spec.ts` — the packaged app, two tests. The first: an SDK client
  lists the 27 tools, reads the guide and the graph of a new project, searches
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
  later, attached as `other-visualization.png`), `add_image` of that node
  (`/images/numbers.png`, a PNG on disk of the stated size, attached as
  `add-image-node.png`), of a PNG file in a temporary folder (the same bytes in
  `images/chart.png`) and of a text file named `.png` (refused, nothing copied),
  `set_documentation` of text with both images' Markdown, read back by
  `get_documentation` and found in `Main.enso` on disk, then the same text again
  (`unchanged: true`), code in the Write prefix refused by `add_nodes`,
  `edit_node` and `evaluate_expression` with the file it names never written,
  `edit_node` back to back on a node and its user (the second result current)
  and to the same text, a `remove_nodes` of a node with a user,
  `set_node_comment`, `set_visualization`, `select_nodes`, `collapse_nodes`,
  `open_method` in and out, `add_function`, one `Mod+Z` in the window taking
  back a whole `add_nodes` call, `remove_nodes`, `list_files`, the path rule,
  `close_project` (the edits are in `Main.enso` on disk) and `open_project` (the
  documentation read again is the text set); it deletes the project it made.
  Neither can check the Live-mode refusals: nothing in the UI switches a project
  to Live (the project's `executionMode` setting is only read from its
  settings), so `app/gui/src/project-view/mcp/__tests__/` covers them. The GUI
  side has its own Playwright specs:
  `app/gui/integration-test/project-view/mcpEdit.spec.ts`,
  `project-view/mcpDocumentation.spec.ts` and
  `integration-test/dashboard/mcpApp.spec.ts`.
