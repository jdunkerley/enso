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
- `projectTools.ts` — the definitions of the project tools: the five that read
  (`VIEW_TOOL_NAMES`) and the nine that edit or navigate (`EDIT_TOOL_NAMES`).
  Each only forwards its arguments to the window.
- `appTools.ts` — the six app tools (`get_app_state`, `list_projects`,
  `list_files`, `create_project`, `open_project`, `close_project`), forwarded
  the same way.
- `windowBridge.ts` — `WindowBridge` forwards a call to the focused window (or
  the first one) over `Channel.mcpToolCall` and resolves with the reply
  (`Channel.mcpToolReply`, matched by `requestId`), or with an error when there
  is no window or the call's timeout passes (`WINDOW_TOOL_TIMEOUT_MS` 30 s by
  default, `EDIT_TOOL_TIMEOUT_MS` 60 s, `OPEN_TOOL_TIMEOUT_MS` 120 s).
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
- `clientConfigs.ts` — that setup text per client (`claude mcp add` command,
  Codex TOML, Copilot JSON for VS Code and the CLI, a generic `mcpServers`
  block), each checked against the vendor's documentation (dates in the code).

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
the handler returns. Only `get_guide` runs entirely in main.

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
`evaluate_expression` does (25 s). The window bridge gives up after 30 s.
Details in `app/gui/src/project-view/mcp/CLAUDE.md`.

`evaluate_expression` runs only in the Design environment: the window refuses it
while the project is in Live mode, because an evaluation runs in the execution
context's environment. In Design the output context is off, so an expression
cannot write to the path it names (`tests/mcp.spec.ts` checks this against the
packaged app). Writes that support a dry run still write their data to a
temporary file (`<name>_ensodryrun<digits>.<ext>` in the system temporary
directory) and return its path; the tool description and `guides/overview.md`
say so. This prevents accidental writes; it is not a sandbox.

## Not the AI mode's server

`src/ai/aiMcpServer.ts` is a different MCP server: the one the in-app AI mode's
own `claude` child uses, on a random port with a per-launch token in a config
file (see "AI tool bridge" in `../../CLAUDE.md`). It shares no code with this
one and stays as it is until the chat PR replaces the AI mode and removes it.

## Tests

- `tests/headless/mcpToolRegistry.test.ts`, `mcpWindowBridge.test.ts`,
  `mcpGuides.test.ts`, `mcpServer.test.ts` (a real SDK client against the
  server), `mcpController.test.ts` (fake keyring and server),
  `mcpClientConfigs.test.ts`.
- `tests/mcp.spec.ts` — the packaged app: an SDK client lists the six tools,
  reads the guide and the graph of a new project, searches components,
  evaluates, checks that an evaluation does not write the file it names (the
  answer names the dry-run file, which the test deletes), and that a request
  without the token is `401`. It cannot check the Live-mode refusal: nothing in
  the UI switches a project to Live (the project's `executionMode` setting is
  only read from its settings), so `app/gui/src/project-view/mcp/__tests__/`
  covers that.
