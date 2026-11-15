# src/mcp/

The IDE's MCP server for external agent apps (Claude Code, Codex, GitHub
Copilot): with it turned on, an agent the user has pointed at it can read the
project open in the IDE. It is off by default. The tools are read-only: none
changes the project, the execution environment, settings or secrets.

## The parts

- `toolRegistry.ts` — `ToolRegistry`: every tool's name, title, description and
  zod argument schema. `call` validates the arguments strictly (unknown keys are
  refused) and never throws: an unknown tool, bad arguments or a throwing tool
  give `{ ok: false, error }`.
- `projectTools.ts` — the definitions of the five project tools (`get_graph`,
  `get_node`, `search_components`, `get_component_docs`, `evaluate_expression`).
  Each only forwards its arguments to the window.
- `windowBridge.ts` — `WindowBridge` forwards a call to the focused window (or
  the first one) over `Channel.mcpToolCall` and resolves with the reply
  (`Channel.mcpToolReply`, matched by `requestId`), or with an error when there
  is no window or 30 s pass (`WINDOW_TOOL_TIMEOUT_MS`).
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
`app/gui/src/mcp/toolDispatcher.ts`. With no project open the dispatcher answers
that no project is open. Add, rename or change a tool on both sides, and keep
its description and `guides/overview.md` in step with what the handler returns.
Only `get_guide` runs entirely in main.

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

Then any path but `/mcp` is `404`. Refusals are logged at the 1st, 10th, 100th,
… only, so a looping process cannot fill the log. The server binds `127.0.0.1`
only; do not bind another address or add a route before the checks.

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
  and New token is refused). The packaged-app spec (`tests/mcp.spec.ts`) uses
  all three, so tests never touch the real keychain item. Unit tests use a fake
  keyring only.
- A start that fails is reported in the status's `error` (port in use, no
  keychain), which the Settings section shows; it never stops the IDE starting.
  `init` does not wait for the server: start-up must not wait on the keychain.

## Output bounds

Main does not cap a tool's result; the window does. Every text that comes from
an evaluation is truncated there (`get_graph` previews 2,000 characters,
`get_node` 20,000, `evaluate_expression` 20,000 with a note saying how long it
was), and `get_graph` runs its value previews in batches: at most 8 at a time,
none started after 15 s, with the rest counted in `previews_skipped`. A preview
evaluation does not interrupt the execution context on timeout;
`evaluate_expression` does (25 s). The window bridge gives up after 30 s.
Details in `app/gui/src/project-view/mcp/CLAUDE.md`.

`evaluate_expression` runs in the Design environment, where the output context
is off, so an expression cannot write a file; `tests/mcp.spec.ts` checks that
against the packaged app.

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
  evaluates, checks that an evaluation cannot write a file, and that a request
  without the token is `401`.
