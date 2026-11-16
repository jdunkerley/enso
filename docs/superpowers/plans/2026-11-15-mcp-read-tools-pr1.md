# MCP read tools (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** An external agent app can connect to the IDE over MCP, read guidance,
and inspect the open project (graph, nodes, component catalogue, evaluated
expressions). Nothing can be changed yet.

**Architecture:** A tool registry in the Electron main process holds every
tool's name, description and schema. A new MCP HTTP server serves the registry,
the guides and server instructions; it runs only while a setting is on. Project
tools are forwarded over IPC to the window, where a dispatcher hands them to
handlers that the open project registers.

**Tech Stack:** TypeScript, Electron main (`app/electron-client`), Vue 3
(`app/gui`), `@modelcontextprotocol/sdk` 1.30, Zod 3, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-chat-and-mcp-design.md`

## Global Constraints

- The existing AI agent (`app/electron-client/src/ai/`, `aiMcpServer.ts`, the
  GUI's AI mode) is not changed in this PR. New code lives beside it.
- The MCP server is off by default, binds `127.0.0.1` only, and refuses: a
  request with an `Origin` header (`403`), a wrong or missing bearer token
  (`401`), a `Host` that is not a loopback name with the server's port (`403`).
- Default port 39417. Token: keychain service `Enso`, account `mcp-token`. Use
  `new Entry('Enso', account, { linux: { store: 'secret-service' } })` through
  `lazyKeyringEntries`; never `Entry.withTarget`; never a top-level import of
  `@napi-rs/keyring`.
- The token never enters the renderer. Config snippets are written to the
  clipboard by main.
- No tool in this PR changes a project, the execution environment, settings or
  secrets.
- `evaluate_expression` uses the existing `queuedExecuteExpressionRaw` path (25
  s budget, interrupt on timeout, `translateEngineError` hints).
- Value previews: at most 2,000 characters per node in `get_graph`, 20,000 in
  `get_node`.
- Use `corepack pnpm`, never bare `pnpm`. Cast third-party APIs with `as T`,
  never `as unknown as T`, except where an existing file already does (copy the
  `StreamableHTTPServerTransport` construction from `aiMcpServer.ts` as is).
- User-facing strings go in `app/common/src/text/english.json`.
- Commit messages end with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Never `git stash`. Work only in this worktree.

## File structure

| File                                                            | Responsibility                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| `app/common/src/mcp.ts`                                         | Types shared by main and the window                             |
| `app/electron-client/src/mcp/toolRegistry.ts`                   | Tool definitions and dispatch                                   |
| `app/electron-client/src/mcp/projectTools.ts`                   | The five project tools' names, descriptions, schemas            |
| `app/electron-client/src/mcp/windowBridge.ts`                   | Forward a project tool call to the window and await the reply   |
| `app/electron-client/src/mcp/guides.ts`                         | Guide topics: list, read; the `get_guide` tool                  |
| `app/electron-client/src/mcp/guides/*.md`                       | `overview`, `language`, `data-pitfalls`, `instructions`         |
| `app/electron-client/src/mcp/mcpServer.ts`                      | The HTTP MCP server and its caller checks                       |
| `app/electron-client/src/mcp/mcpController.ts`                  | Settings file, token, start/stop, status, config snippets, IPC  |
| `app/gui/src/mcp/toolDispatcher.ts`                             | Window side: receive calls, route to registered handlers, reply |
| `app/gui/src/project-view/mcp/*.ts`                             | The project tool handlers and `useProjectMcpTools`              |
| `app/gui/src/dashboard/layouts/Settings/McpSettingsSection.vue` | Settings → AI → External agents                                 |

---

### Task 1: Shared types and IPC plumbing

**Files:**

- Create: `app/common/src/mcp.ts`
- Modify: `app/electron-client/src/ipc.ts` (add channels after the AI ones)
- Modify: `app/electron-client/src/preload.ts` (add `mcp` beside `secrets`)
- Modify: `app/gui/src/electronApi.ts` (add `McpApi`, `mcp?: McpApi` on
  `ElectronApi`)
- Modify: `app/gui/integration-test/mock/registerMocks.ts` (stub `mcp`)

**Interfaces:**

- Produces (`app/common/src/mcp.ts`):

```ts
/** Who called a tool: the in-app chat, or an external client by its MCP name. */
export type McpCaller =
  | { readonly kind: "chat" }
  | { readonly kind: "external"; readonly name: string };

export type McpToolResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/** Main → window. `args` has passed the tool's schema. */
export interface McpToolCallRequest {
  readonly requestId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly caller: McpCaller;
}

/** Window → main. */
export interface McpToolCallReply {
  readonly requestId: string;
  readonly result: McpToolResult;
}

export const MCP_DEFAULT_PORT = 39417;

export interface McpStatus {
  readonly enabled: boolean;
  readonly port: number;
  /** True while the server is listening. */
  readonly running: boolean;
  /** Why an enabled server is not running (port taken, no keychain). */
  readonly error: string | null;
}

export const MCP_CLIENT_KINDS = [
  "claudeCode",
  "codex",
  "copilotVsCode",
  "copilotCli",
  "json",
] as const;
export type McpClientKind = (typeof MCP_CLIENT_KINDS)[number];
```

- Produces (`Channel`): `mcpToolCall = 'mcp-tool-call'` (main → window),
  `mcpToolReply = 'mcp-tool-reply'` (window → main), `mcpStatus = 'mcp-status'`
  (invoke), `mcpStatusChanged = 'mcp-status-changed'` (broadcast),
  `mcpSetEnabled = 'mcp-set-enabled'`, `mcpSetPort = 'mcp-set-port'`,
  `mcpReplaceToken = 'mcp-replace-token'`, `mcpCopyConfig = 'mcp-copy-config'`
  (all invoke).
- Produces (`McpApi` in `electronApi.ts`, implemented in `preload.ts`):

```ts
export interface McpApi {
  readonly onToolCall: (
    handler: (request: McpToolCallRequest) => void,
  ) => () => void;
  readonly replyToolCall: (reply: McpToolCallReply) => void;
  readonly status: () => Promise<McpStatus>;
  readonly onStatusChanged: (
    handler: (status: McpStatus) => void,
  ) => () => void;
  readonly setEnabled: (enabled: boolean) => Promise<McpStatus>;
  readonly setPort: (port: number) => Promise<McpStatus>;
  readonly replaceToken: () => Promise<McpStatus>;
  /** Main writes the client's config, token included, to the clipboard. */
  readonly copyConfig: (client: McpClientKind) => Promise<void>;
}
```

- [ ] **Step 1:** Create `app/common/src/mcp.ts` with the code above. Check how
      `app/common/src/ai.ts` is exported/imported (`enso-common/src/ai`) and
      follow it; no index change is needed if `ai.ts` needs none.
- [ ] **Step 2:** Add the eight `Channel` members to `ipc.ts`, each with a
      one-line doc comment giving its direction.
- [ ] **Step 3:** In `preload.ts`, add `const mcp: ElectronApi['mcp']` following
      the `ai.onToolCall` / `replyToolCall` pattern (lines 158–166) for the two
      event members and the `secrets` pattern (`ipcRenderer.invoke`) for the
      rest; add `mcp` to the exposed `api` object.
- [ ] **Step 4:** Add `McpApi` and `readonly mcp?: McpApi` to `electronApi.ts`.
- [ ] **Step 5:** In `registerMocks.ts`, add to the mocked `window.api`:

```ts
mcp: {
  onToolCall: () => () => {},
  replyToolCall: () => {},
  status: async () => (window as any).__mcpMockStatus ?? { enabled: false, port: 39417, running: false, error: null },
  onStatusChanged: () => () => {},
  setEnabled: async (enabled: boolean) => {
    const w = window as any
    w.__mcpMockStatus = { enabled, port: 39417, running: enabled, error: null }
    return w.__mcpMockStatus
  },
  setPort: async (port: number) => {
    const w = window as any
    w.__mcpMockStatus = { ...(w.__mcpMockStatus ?? { enabled: false, running: false, error: null }), port }
    return w.__mcpMockStatus
  },
  replaceToken: async () => (window as any).__mcpMockStatus ?? { enabled: false, port: 39417, running: false, error: null },
  copyConfig: async (client: string) => { (window as any).__mcpCopied = client },
},
```

      Match the file's existing style for typing inside `addInitScript`.

- [ ] **Step 6:** Run
      `corepack pnpm --filter enso run typecheck && corepack pnpm --filter enso-gui run typecheck`.
      Expected: both pass. (If workspace `dist/` is missing, run
      `corepack pnpm install` then `corepack pnpm -r compile` first.)
- [ ] **Step 7:** Commit: `MCP: shared types and IPC channels`.

---

### Task 2: Tool registry and window bridge

**Files:**

- Create: `app/electron-client/src/mcp/toolRegistry.ts`
- Create: `app/electron-client/src/mcp/projectTools.ts`
- Create: `app/electron-client/src/mcp/windowBridge.ts`
- Test: `app/electron-client/tests/headless/mcpToolRegistry.test.ts`
- Test: `app/electron-client/tests/headless/mcpWindowBridge.test.ts`

**Interfaces:**

- Consumes: `McpCaller`, `McpToolResult`, `McpToolCallRequest`,
  `McpToolCallReply` (Task 1); `Channel.mcpToolCall`, `Channel.mcpToolReply`.
- Produces:

```ts
// toolRegistry.ts
import type { ZodRawShape } from "zod";
export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ZodRawShape;
  /** Runs in main. `args` has passed `inputSchema`. */
  readonly run: (
    args: Record<string, unknown>,
    caller: McpCaller,
  ) => Promise<McpToolResult>;
}
export class ToolRegistry {
  register(tool: ToolDefinition): void; // throws on a duplicate name
  list(): readonly ToolDefinition[]; // registration order
  /** Validates `args` with z.object(inputSchema).strict(); unknown tool or invalid args → { ok: false }. Never throws: a throwing `run` becomes { ok: false, error }. */
  call(name: string, args: unknown, caller: McpCaller): Promise<McpToolResult>;
}

// windowBridge.ts
export const WINDOW_TOOL_TIMEOUT_MS = 30_000;
export interface WindowTarget {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}
export class WindowBridge {
  constructor(
    resolveWindow: () => WindowTarget | null,
    ipc: Pick<Electron.IpcMain, "on" | "removeListener">,
  );
  /** Sends Channel.mcpToolCall and resolves with the window's reply, or { ok: false } when there is no window, it is destroyed, or 30 s pass. */
  call(
    tool: string,
    args: Record<string, unknown>,
    caller: McpCaller,
  ): Promise<McpToolResult>;
  dispose(): void; // resolves pending calls with an error, removes the listener
}

// projectTools.ts
export const PROJECT_TOOL_NAMES = [
  "get_graph",
  "get_node",
  "search_components",
  "get_component_docs",
  "evaluate_expression",
] as const;
export function projectTools(
  bridge: Pick<WindowBridge, "call">,
): ToolDefinition[];
```

Project tool schemas (Zod), all forwarded with
`bridge.call(name, args, caller)`:

| Tool                  | Input                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `get_graph`           | `{ previews: z.boolean().optional() }` (default true in the window)                                          |
| `get_node`            | `{ node_id: z.string() }`                                                                                    |
| `search_components`   | `{ query: z.string(), self_type: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }` |
| `get_component_docs`  | `{ name: z.string() }` (a qualified name from `search_components`)                                           |
| `evaluate_expression` | `{ expression: z.string(), node_id: z.string().optional() }`                                                 |

Descriptions must tell an agent when to use the tool and what comes back. Reuse
the wording of today's `evaluateExpression` description in `aiMcpServer.ts` for
`evaluate_expression` (Text-only result, `.to_text` / `.to_json`,
`catch_primitive`), and add: "Runs in the Design environment: it cannot write
files." State in `get_graph`'s description that `node_id` values are stable
across edits.

- [ ] **Step 1: Write failing registry tests** (`mcpToolRegistry.test.ts`):
  - `register` then `list` returns tools in order; a duplicate name throws.
  - `call` of an unknown tool → `{ ok: false, error: "Unknown tool 'x'" }`.
  - `call` with args failing the schema → `ok: false`, error names the field;
    `run` not called.
  - `call` with an extra key → `ok: false` (strict).
  - `call` passes parsed args and the caller to `run` and returns its result.
  - `run` throwing `new Error('boom')` → `{ ok: false, error: 'boom' }`.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso exec vitest run tests/headless/mcpToolRegistry.test.ts`.
      Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `toolRegistry.ts`. Format a Zod error as
      `issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Write failing bridge tests** (`mcpWindowBridge.test.ts`), with
      an `EventEmitter` as `ipc` and a fake window
      `{ isDestroyed: () => false,     send: vi.fn() }`:
  - `call` sends `Channel.mcpToolCall` with `{ requestId, tool, args, caller }`;
    emitting `Channel.mcpToolReply` with `(undefined, { requestId, result })`
    resolves the call with `result`.
  - A reply with another `requestId` is ignored.
  - No window (`resolveWindow` returns null) → `ok: false`, error contains "No
    Enso window".
  - Destroyed window → same.
  - `vi.useFakeTimers()`: no reply for 30 s → `ok: false`, error contains "timed
    out".
  - `dispose()` resolves a pending call with `ok: false`.
  - `projectTools(bridge)` returns the five names in order, and calling the
    `get_node` definition's `run({ node_id: 'a' }, caller)` calls
    `bridge.call('get_node', { node_id: 'a' }, caller)`.
- [ ] **Step 6:** Run; expected FAIL. Implement `windowBridge.ts` (model:
      `AiMcpServer.dispatchToRenderer` and `handleReply`, `aiMcpServer.ts`
      230–266) and `projectTools.ts`. Run; expected PASS.
- [ ] **Step 7:** Commit: `MCP: tool registry and window bridge`.

---

### Task 3: Guides

**Files:**

- Create: `app/electron-client/src/mcp/guides/overview.md`, `language.md`,
  `data-pitfalls.md`, `instructions.md`
- Create: `app/electron-client/src/mcp/guides.ts`
- Modify: `app/electron-client/esbuildConfig.ts` (load `.md` as text, if no
  loader exists) and add a `*.md` module declaration if TypeScript needs one
- Test: `app/electron-client/tests/headless/mcpGuides.test.ts`

**Interfaces:**

- Produces:

```ts
export interface GuideTopic {
  readonly topic: string;
  readonly title: string;
}
export class Guides {
  /** `stdlibRoot` is `paths.stdlibRoot(...)`; undefined when no engine is bundled. */
  constructor(stdlibRoot: string | undefined);
  /** Built-in topics, then `stdlib` (the top-level CLAUDE.md), then `library/<Name>` for each library with a `0.0.0-dev/CLAUDE.md`, sorted by name. */
  list(): Promise<readonly GuideTopic[]>;
  /** The topic's Markdown, or undefined for an unknown topic. */
  read(topic: string): Promise<string | undefined>;
  /** The server `instructions` paragraph. */
  readonly instructions: string;
}
export function guideTool(guides: Guides): ToolDefinition; // name 'get_guide', input { topic: z.string().optional() }
export function guideUri(topic: string): string; // `enso://guide/${topic}`
```

`get_guide` with no topic returns the `overview` guide followed by the list of
topics; with an unknown topic it returns `ok: false` listing the valid topics.

Guide content:

- `instructions.md`: one paragraph, under 120 words: Enso is a visual data
  language; a project is a graph of nodes, each an Enso expression bound to a
  name; these tools read the project open in the IDE; call `get_guide` before
  doing anything else; in this version the tools are read-only.
- `overview.md`: how to work: call `get_graph` first; node ids are stable; use
  `search_components` then `get_component_docs` before naming a method; use
  `evaluate_expression` to look at data and cap reads at the reader (move the
  "Cap verification reads at the lowest layer" and "`Data.fetch` returns
  `Response`" sections of `prompts.ts` here, reworded for a general agent, not
  as rules about a "final body"); the list of other topics.
- `language.md`: `ENSO_CHEAT_SHEET` from `prompts.ts` (lines 31–47), as
  Markdown. Copy, do not move: `prompts.ts` stays as is.
- `data-pitfalls.md`: `DATA_ANALYSIS_PITFALLS` (lines 49–55), as Markdown.

- [ ] **Step 1: Write failing tests** using a temp directory laid out as
      `<root>/CLAUDE.md`, `<root>/Base/0.0.0-dev/CLAUDE.md`,
      `<root>/Table/0.0.0-dev/CLAUDE.md`, `<root>/Empty/0.0.0-dev/` (no file):
  - `list()` is `overview`, `language`, `data-pitfalls`, `stdlib`,
    `library/Base`, `library/Table` (not `Empty`).
  - `read('library/Base')` is that file's text; `read('stdlib')` is the root
    file's.
  - `read('library/../../etc')` and `read('library/Nope')` are undefined (the
    library name must match `/^[A-Za-z0-9_]+$/`).
  - With `stdlibRoot` undefined, `list()` is the three built-in topics.
  - `read('overview')` contains `get_graph`; `instructions` contains
    `get_guide`.
  - `guideTool`: no topic → `ok` and the value contains the overview and
    `library/Base`; unknown topic → `ok: false` naming `overview`.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso exec vitest run tests/headless/mcpGuides.test.ts`;
      expected FAIL.
- [ ] **Step 3:** Write the four Markdown files and `guides.ts`. Import the
      Markdown as text (`import overview from './guides/overview.md'`); add
      `loader: { '.md': 'text' }` to the esbuild config beside the existing
      `'.node': 'copy'`, and make Vitest load it the same way (a small
      `transform` plugin in `vitest.config.ts`, or `?raw` imports if both
      bundlers accept them: pick whichever works in both and say which in the
      commit message).
- [ ] **Step 4:** Run the test; expected PASS. Run
      `corepack pnpm --filter enso run typecheck`; expected PASS.
- [ ] **Step 5:** Run
      `corepack pnpm exec prettier --check app/electron-client/src/mcp`.
- [ ] **Step 6:** Commit: `MCP: guides and the get_guide tool`.

---

### Task 4: The MCP server

**Files:**

- Create: `app/electron-client/src/mcp/mcpServer.ts`
- Test: `app/electron-client/tests/headless/mcpServer.test.ts`

**Interfaces:**

- Consumes: `ToolRegistry` (Task 2), `Guides`, `guideUri` (Task 3).
- Produces:

```ts
export interface McpServerOptions {
  readonly registry: ToolRegistry;
  readonly guides: Guides;
  readonly port: number;
  readonly token: string;
  readonly version: string;
}
/** Why a request is refused, or undefined. Checked before the MCP transport sees the request. */
export function refusal(
  headers: {
    origin?: string | undefined;
    authorization?: string | undefined;
    host?: string | undefined;
  },
  token: string,
  port: number,
): { status: 401 | 403; reason: string } | undefined;
export class McpHttpServer {
  constructor(options: McpServerOptions);
  /** Listens on 127.0.0.1:port. Rejects (e.g. EADDRINUSE) without leaving a listener. */
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly url: string; // http://127.0.0.1:<port>/mcp
}
```

Behaviour:

- `refusal`: `Origin` present → 403; `Host` not one of `127.0.0.1:<port>`,
  `localhost:<port>`, `[::1]:<port>` → 403; token mismatch (`timingSafeEqual`,
  as in `aiMcpServer.ts`) → 401. Log refusals at the 1st, 10th, 100th, … as
  `aiMcpServer.ts` does.
- Only `POST /mcp` (and the transport's `GET`/`DELETE` on `/mcp`) reach the
  transport; any other path → 404.
- Per request: a new
  `McpServer({ name: 'enso', version }, { capabilities: { tools: {}, resources: {} }, instructions: guides.instructions })`
  and a stateless `StreamableHTTPServerTransport`, as `aiMcpServer.ts` 268–301.
- Each registry tool is registered with
  `server.registerTool(name, { title, description, inputSchema }, handler)`. The
  handler calls
  `registry.call(name, args, { kind: 'external', name: clientName })` and maps
  `{ ok: true, value }` → `{ content: [{ type: 'text', text: value }] }`,
  `{ ok: false, error }` → the same with `isError: true`. `clientName` is
  `server.server.getClientVersion()?.name ?? 'unknown'`.
- Each guide topic is registered as a resource at `guideUri(topic)` with
  `mimeType: 'text/markdown'`. Check the installed SDK's `registerResource`
  signature in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`
  and use it as declared.

- [ ] **Step 1: Write failing tests.** Start a server on port 0 (allow `port: 0`
      in tests and read the bound port from the server for `url` and the `Host`
      check), with a registry holding one fake tool `echo`
      (`{ text: z.string() }` → `ok` with the text) and one failing tool, and a
      `Guides` over a temp directory. Connect with the SDK's `Client` and
      `StreamableHTTPClientTransport`
      (`requestInit: { headers: { Authorization:     'Bearer <token>' } }`):
  - `refusal` unit cases: origin → 403; bad host → 403; `localhost:<port>` and
    `[::1]:<port>` accepted; wrong token → 401; correct → undefined.
  - Raw `fetch` without a token → 401; with `Origin: https://evil.example` →
    403; `POST /other` → 404.
  - `client.getInstructions()` contains `get_guide`.
  - `client.listTools()` names are `['echo', 'fail']` with their descriptions.
  - `client.callTool({ name: 'echo', arguments: { text: 'hi' } })` → text `hi`,
    not an error; the registry's `run` saw caller
    `{ kind: 'external', name: <the client's name> }`.
  - The failing tool → `isError: true`.
  - `client.listResources()` includes `enso://guide/overview`;
    `client.readResource` of it returns the overview text.
  - Starting a second server on the same port rejects, and `stop()` on the first
    then lets a third start.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso exec vitest run tests/headless/mcpServer.test.ts`;
      expected FAIL.
- [ ] **Step 3:** Implement `mcpServer.ts`. No `electron` import: this file must
      run under plain Node in the test.
- [ ] **Step 4:** Run; expected PASS. Typecheck; expected PASS.
- [ ] **Step 5:** Commit: `MCP: HTTP server over the tool registry`.

---

### Task 5: Controller, settings, token and wiring

**Files:**

- Create: `app/electron-client/src/mcp/mcpController.ts`
- Create: `app/electron-client/src/mcp/clientConfigs.ts`
- Modify: `app/electron-client/src/electron.ts` (construct and start; register
  IPC beside the secrets handlers)
- Modify: `app/electron-client/src/index.ts` (`before-quit`: stop)
- Modify: `app/electron-client/src/projectService.ts` only if needed to share
  the keyring entry factory (export the `lazyKeyringEntries(...)` construction
  as `keyringEntries` rather than building a second one)
- Test: `app/electron-client/tests/headless/mcpController.test.ts`,
  `mcpClientConfigs.test.ts`

**Interfaces:**

- Consumes: `McpHttpServer`, `ToolRegistry`, `Guides`, `McpStatus`,
  `McpClientKind`, `MCP_DEFAULT_PORT`, `KeyringEntryLike`.
- Produces:

```ts
// clientConfigs.ts
/** The text to paste for a client: a shell command for claudeCode, TOML for codex, JSON for the rest. */
export function clientConfig(
  client: McpClientKind,
  url: string,
  token: string,
): string;

// mcpController.ts
export const MCP_TOKEN_ACCOUNT = "mcp-token";
export interface McpControllerOptions {
  readonly settingsPath: string; // <userData>/mcp-settings.json
  readonly entry: (account: string) => Promise<KeyringEntryLike>;
  readonly env: NodeJS.ProcessEnv; // ENSO_MCP_TOKEN, ENSO_MCP_PORT, ENSO_MCP_ENABLED
  readonly createServer: (
    port: number,
    token: string,
  ) => { start(): Promise<void>; stop(): Promise<void>; readonly url: string };
  readonly onStatusChanged: (status: McpStatus) => void;
}
export class McpController {
  constructor(options: McpControllerOptions);
  /** Reads the settings file and starts the server when enabled. Never throws. */
  init(): Promise<McpStatus>;
  status(): McpStatus;
  setEnabled(enabled: boolean): Promise<McpStatus>;
  setPort(port: number): Promise<McpStatus>; // integer 1024..65535, else rejects; restarts a running server
  replaceToken(): Promise<McpStatus>; // new token; restarts a running server
  /** The config text for a client. Creates the token if there is none. */
  config(client: McpClientKind): Promise<string>;
  shutdown(): Promise<void>;
}
```

Behaviour:

- Settings file: `{ "enabled": boolean, "port": number }`, written atomically
  (write `*.tmp`, rename). Missing or unreadable →
  `{ enabled: false, port: MCP_DEFAULT_PORT }`.
- Token source, in order: `env.ENSO_MCP_TOKEN` (non-empty), then the keychain
  item. Created (`randomBytes(32).toString('base64url')`) on the first enable or
  `config()` when neither exists. A keychain failure → `running: false`,
  `error: 'The system keychain is not available: <message>'`; `enabled` stays as
  the user set it.
- `env.ENSO_MCP_PORT` (valid integer) overrides the file's port;
  `env.ENSO_MCP_ENABLED === '1'` overrides `enabled` to true. Neither is written
  back to the file. (They exist for the packaged-app test and CI, where there is
  no keychain.)
- Start failure (port in use) → `running: false`,
  `error: 'Port <n> is in use by another program.'`
- `replaceToken` with `ENSO_MCP_TOKEN` set rejects: "The token is set by
  ENSO_MCP_TOKEN."
- Every change calls `onStatusChanged` once with the new status. Calls are
  serialised (one at a time), so `setEnabled(true)` and `setPort` cannot
  interleave.
- `clientConfig`:
  - `claudeCode`:
    `claude mcp add --transport http enso <url> --header "Authorization: Bearer <token>"`
  - `codex`: TOML `[mcp_servers.enso]` with `url = "<url>"` and
    `http_headers = { "Authorization" = "Bearer <token>" }`
  - `copilotVsCode`:
    `{"servers":{"enso":{"type":"http","url":"<url>","headers":{"Authorization":"Bearer <token>"}}}}`
    pretty-printed
  - `copilotCli` and `json`:
    `{"mcpServers":{"enso":{"type":"http","url":"<url>","headers":{"Authorization":"Bearer <token>"}}}}`
    pretty-printed

  These shapes are from the vendors' documentation as known at planning time and
  are a "To verify" item in the spec. The implementer checks each against the
  client's current documentation (Claude Code `claude mcp add --help`; Codex
  `config.toml` reference; VS Code `mcp.json`; Copilot CLI `mcp-config.json`)
  and corrects the shape and the test if it differs, recording the source URL in
  a comment above each case.

Wiring in `electron.ts` (beside the existing `initAiMcpServer` block, which
stays): build `registry` (`projectTools(bridge)` + `guideTool(guides)`),
`bridge = new WindowBridge(() => focused-or-first window's webContents, ipcMain)`,
`guides = new Guides(paths.stdlibRoot(electron, electronIsDev))`, and the
controller with
`createServer: (port, token) => new McpHttpServer({ registry, guides, port, token, version })`.
`onStatusChanged` sends `Channel.mcpStatusChanged` to every window. IPC:
`mcpStatus` → `controller.status()`, `mcpSetEnabled`, `mcpSetPort`,
`mcpReplaceToken`, `mcpCopyConfig` →
`clipboard.writeText(await controller.config(client))`. Validate IPC arguments
(`typeof enabled === 'boolean'`, the port range, `client` in
`MCP_CLIENT_KINDS`). `void controller.init()` after the handlers are registered:
start-up must not wait for it. In `index.ts`, a `before-quit` listener calls
`void shutdownMcp()`.

- [ ] **Step 1: Write failing tests** with a fake keyring (copy `FakeKeyring`
      from `tests/headless/secretsKey.test.ts` 19–38), a temp settings path and
      a fake server factory recording `start`/`stop`:
  - No file → `init()` is
    `{ enabled: false, port: 39417, running: false, error: null }`; no server
    created; no keychain access.
  - `setEnabled(true)` creates a token in the keychain, starts a server on
    39417, writes the file, status `running: true`, `onStatusChanged` called
    once.
  - A second `init()` on a new controller with the same file and keyring starts
    with the same token.
  - `setEnabled(false)` stops the server; the token stays.
  - `setPort(40000)` while running stops and restarts on 40000; `setPort(80)`
    and `setPort(1.5)` reject and change nothing.
  - Server `start` rejecting with `{ code: 'EADDRINUSE' }` → `running: false`,
    error mentions the port; `enabled` stays true.
  - Keyring `getPassword` throwing → error mentions the keychain.
  - `ENSO_MCP_TOKEN` set → used, keychain untouched, `replaceToken` rejects.
  - `ENSO_MCP_ENABLED=1` and `ENSO_MCP_PORT=41000` → running on 41000 with no
    file written.
  - `replaceToken()` changes the stored token and restarts a running server.
  - `config('json')` contains the URL and `Bearer <token>`.
  - `clientConfig` for each kind: contains the URL and the token; the three JSON
    kinds parse with `JSON.parse`.
- [ ] **Step 2:** Run both test files; expected FAIL.
- [ ] **Step 3:** Implement `clientConfigs.ts` and `mcpController.ts`; run;
      expected PASS.
- [ ] **Step 4:** Wire `electron.ts` and `index.ts`. Typecheck and lint
      (`corepack pnpm --filter enso run lint`); expected PASS.
- [ ] **Step 5:** Run the whole headless suite:
      `corepack pnpm --filter enso run test:unit`. Expected: PASS, including the
      untouched `aiMcpServer.test.ts`.
- [ ] **Step 6:** Commit: `MCP: controller, token and start-up wiring`.

---

### Task 6: Window dispatcher and the graph tools

**Files:**

- Create: `app/gui/src/mcp/toolDispatcher.ts`
- Create: `app/gui/src/project-view/mcp/graphTools.ts`
- Create: `app/gui/src/project-view/mcp/evaluate.ts`
- Create: `app/gui/src/project-view/mcp/useProjectMcpTools.ts`
- Create: `app/gui/src/project-view/mcp/CLAUDE.md`
- Modify: `app/gui/src/App.vue` (mount the dispatcher)
- Modify: `app/gui/src/project-view/components/GraphEditor.vue` (mount
  `useProjectMcpTools()` beside `useAiToolHandler`)
- Modify:
  `app/gui/src/project-view/components/ComponentBrowser/aiToolHandler.ts`
  (export `formatLsError` and `translateEngineError`; no behaviour change)
- Test: `app/gui/src/mcp/__tests__/toolDispatcher.test.ts`,
  `app/gui/src/project-view/mcp/__tests__/graphTools.test.ts`,
  `evaluate.test.ts`

**Interfaces:**

- Consumes: `McpApi`, `McpToolCallRequest`, `McpToolResult`, `McpCaller`.
- Produces:

```ts
// toolDispatcher.ts
export type McpToolHandler = (
  args: Readonly<Record<string, unknown>>,
  caller: McpCaller,
) => Promise<McpToolResult>;
/** Registers handlers by tool name; returns a function that removes exactly these. A later registration of a name replaces the earlier one. */
export function registerMcpToolHandlers(
  handlers: Readonly<Record<string, McpToolHandler>>,
): () => void;
/** Subscribes to `api.onToolCall`, runs the handler, replies. No handler → { ok: false, error: NO_PROJECT_ERROR }. A throwing handler → { ok: false }. Returns the unsubscribe function. */
export function startMcpToolDispatcher(
  api: Pick<McpApi, "onToolCall" | "replyToolCall">,
): () => void;
export const NO_PROJECT_ERROR =
  "No project is open in Enso. Ask the user to open one.";

// graphTools.ts — pure functions over injected dependencies
export interface GraphToolDeps {
  readonly db: GraphDb;
  readonly currentMethod: {
    ast: Result<Ast.FunctionDef>;
    pointer: Result<MethodPointer>;
  };
  readonly moduleRoot: () => Ast.Ast | undefined;
  readonly printType: (type: ProjectPath) => string; // projectNames.printProjectPath
  /** Evaluates to text in a node's scope; null when not ready. */
  readonly evaluate: (
    scope: ExternalId,
    expression: string,
    timeoutMs: number,
  ) => Promise<Result<string> | null>;
}
export interface NodeSummary {
  id: string;
  name: string | null;
  code: string;
  kind: "component" | "input" | "output";
  type: string | null;
  state: "value" | "error" | "panic" | "pending" | "unknown";
  message?: string;
  warnings?: number;
  comment?: string;
  preview?: string;
}
export function summarizeNode(
  deps: GraphToolDeps,
  id: NodeId,
  node: Node,
): NodeSummary; // no preview
export function getGraph(
  deps: GraphToolDeps,
  args: { previews?: boolean },
): Promise<McpToolResult>;
export function getNode(
  deps: GraphToolDeps,
  args: { node_id: string },
): Promise<McpToolResult>;
export const GRAPH_PREVIEW_CHARS = 2_000;
export const NODE_PREVIEW_CHARS = 20_000;

// evaluate.ts
export function evaluateExpression(
  deps: Pick<GraphToolDeps, "db" | "currentMethod"> & {
    evaluateRaw: (
      scope: ExternalId,
      expression: string,
    ) => Promise<Result<string> | null>;
  },
  args: { expression: string; node_id?: string },
): Promise<McpToolResult>;

// useProjectMcpTools.ts
/** Registers get_graph, get_node, evaluate_expression (and Task 7's two) for the open project; removes them on scope dispose. */
export function useProjectMcpTools(): void;
```

Behaviour:

- Tool results are JSON text (`JSON.stringify(value, null, 1)`).
- `get_graph` value:
  `{ method: string, source: string, imports: string[], nodes: NodeSummary[] }`.
  `method` is the pointer's name, `source` is `currentMethod.ast.value.code()`,
  `imports` as `composables/ai.ts` lines 47–53 collects them. Nodes in
  `db.nodeIdToNode` order. Either `currentMethod` result not ok → `ok: false`
  with its error.
- `summarizeNode`: `id` is the NodeId; `name` is `node.pattern?.code() ?? null`;
  `code` is `node.innerExpr.code()`; `comment` is `nodeDocumentationText(node)`
  when non-empty; from `db.getExpressionInfo(id)`: `type` =
  `printType(typeInfo.primaryType)`, and by `payload.type`: `Value` → `value` (+
  `warnings: payload.warnings.count` when > 0), `DataflowError` → `error`,
  `Panic` → `panic` with `message`, `Pending` → `pending`; no info → `unknown`.
- Previews (`previews !== false`): for each node with `state: 'value'` and a
  `name` that is a plain identifier,
  `evaluate(node.outerAst.externalId, '<name>.to_display_text', 5_000)`; on
  `ok`, `preview` = the text cut to 2,000 characters with `…` appended when cut.
  A failed or null evaluation leaves `preview` out. Run them through
  `Promise.all`; the project store's queue already limits concurrency.
- `get_node`: `node_id` not a node of the current method → `ok: false`, "No node
  with id … in the method on screen. Call get_graph for the current ids."
  Otherwise the summary plus `preview` from `'<name>.to_text'` (10 s, 20,000
  characters), and for `state: 'error'` an `error` field from evaluating
  `'<name>.catch_primitive (e -> e.to_display_text)'`.
- `evaluate_expression`: scope is the named node's `outerAst.externalId`, or the
  current method's `body.externalId` when `node_id` is absent (as
  `aiToolHandler.ts` anchors it). Calls `evaluateRaw`, which
  `useProjectMcpTools` builds from `projectStore.queuedExecuteExpressionRaw`
  with the 25,000 ms budget and the `interruptExecutionContext` timeout
  callback, exactly as `aiToolHandler.ts` lines 64–73. Errors go through
  `translateEngineError(formatLsError(...))`. null → "The project is still
  loading. Try again in a moment."
- `useProjectMcpTools` reads the stores the way `GraphEditor.vue` does (see
  lines 113–127) and never keeps a store past scope dispose.
- `App.vue`:
  `if (window.api?.mcp) onScopeDispose(startMcpToolDispatcher(window.api.mcp))`.

`app/gui/src/project-view/mcp/CLAUDE.md`: what the folder is (the window side of
the MCP tools; definitions and schemas are in
`app/electron-client/src/mcp/projectTools.ts`; a tool needs both halves), that
handlers are pure functions over `GraphToolDeps`, and the preview limits.

- [ ] **Step 1: Write failing dispatcher tests** with a fake `api` capturing the
      `onToolCall` handler:
  - A registered handler is called with args and caller; its result is sent with
    the request's `requestId`.
  - No handler → `NO_PROJECT_ERROR`.
  - A handler that throws → `ok: false` with the message.
  - The function returned by `registerMcpToolHandlers` removes only its own
    handlers (register A, register B for the same name, dispose A: B remains).
  - The unsubscribe function returned by `startMcpToolDispatcher` calls the
    api's disposer.
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso-gui exec vitest run src/mcp/__tests__/toolDispatcher.test.ts`;
      expected FAIL. Implement; expected PASS.
- [ ] **Step 3: Write failing graph tool tests** using `GraphDb.Mock()` and
      `graphDb.mockNode(binding, id, code)` (see
      `GraphEditor/__tests__/detaching.test.ts`), a `ComputedValueRegistry.Mock`
      populated for types/payloads the way `graphDatabase.test.ts` does, and a
      `vi.fn()` `evaluate`:
  - `summarizeNode` for a mocked `a = 1 + 2`: id, `name: 'a'`, `code: '1 + 2'`,
    `kind: 'component'`, `state: 'unknown'` with no info.
  - With a Panic payload → `state: 'panic'`, `message`.
  - `getGraph` with `previews: false` never calls `evaluate`.
  - `getGraph` default calls `evaluate` once per `value` node with
    `'<name>.to_display_text'` and the node's `outerAst.externalId`; a 3,000
    character result is cut to 2,000 plus `…`; an `Err` result leaves `preview`
    out.
  - `getGraph` with `currentMethod.ast` an `Err` → `ok: false`.
  - `getNode` with an unknown id → the "No node with id" error.
  - `evaluateExpression`: no `node_id` → scope is the method body's external id;
    an `Err('Cannot encode class X to byte array.')` → the Text hint; null →
    "still loading".
- [ ] **Step 4:** Run; expected FAIL. Implement `graphTools.ts`, `evaluate.ts`,
      `useProjectMcpTools.ts`; export the two helpers from `aiToolHandler.ts`.
      Run; expected PASS.
- [ ] **Step 5:** Mount in `App.vue` and `GraphEditor.vue`. Run
      `corepack pnpm --filter enso-gui run typecheck` and
      `corepack pnpm --filter enso-gui run lint`; expected PASS. If
      `tsconfig.node.json` reports `TS6307`, add only the named files (see
      `app/gui/CLAUDE.md`).
- [ ] **Step 6:** Commit: `MCP: window dispatcher and graph read tools`.

---

### Task 7: Catalogue tools

**Files:**

- Create: `app/gui/src/project-view/mcp/catalogueTools.ts`
- Modify: `app/gui/src/project-view/mcp/useProjectMcpTools.ts` (register them)
- Test: `app/gui/src/project-view/mcp/__tests__/catalogueTools.test.ts`

**Interfaces:**

- Consumes: `SuggestionDb`, `Filtering`, `makeComponentLists`, `entrySignature`,
  `McpToolResult`.
- Produces:

```ts
export interface CatalogueDeps {
  readonly db: SuggestionDb;
  readonly loaded: boolean;
  readonly projectNames: ProjectNameStore;
  readonly importedLibraries: ReadonlySet<QualifiedName>;
}
export function searchComponents(
  deps: CatalogueDeps,
  args: { query: string; self_type?: string; limit?: number },
): McpToolResult;
export function getComponentDocs(
  deps: CatalogueDeps,
  args: { name: string },
): McpToolResult;
export const DEFAULT_SEARCH_LIMIT = 20;
```

Behaviour:

- `loaded` false → `ok: false`, "The component catalogue is still loading. Try
  again in a moment."
- `search_components`: `new Filtering({ pattern: query, selfArg })`, then
  `makeComponentLists(db, filtering, importedLibraries)`; flatten the groups,
  keep the Component Browser's order, take `limit` (default 20). `selfArg` is
  `{ type: 'unknown' }` unless `self_type` resolves: look the type up as the
  Component Browser does for a source node's type (read how `ComponentBrowser`
  builds `SelfArg` from a `TypeInfo`, and build the same from the type entry
  found by its qualified name); an unresolvable `self_type` → `ok: false`,
  "Unknown type …".
- Each result:
  `{ name: <qualified name, printed with projectNames>, signature: entrySignature(entry, returnType).label, summary: entry.documentationSummary ?? '' }`.
  Value: `{ results: [...], total: <count before the limit> }`.
- `get_component_docs`: find the entry by the qualified `name` that
  `search_components` printed (`db.getEntryByProjectPath` on the parsed path;
  read `projectNames` for the parse function that inverts `printProjectPath`).
  Not found → `ok: false`, "No component named …. Use a name returned by
  search_components." Value:
  `{ name, signature, arguments: [{ name, type: reprType, default: defaultValue ?? null, optional: hasDefault, values: tagValues ?? undefined }], returns, documentation: entry.documentation }`.

- [ ] **Step 1: Write failing tests** over a `SuggestionDb` filled with
      `mockSuggestion` entries (see
      `ComponentBrowser/__tests__/component.test.ts` for the set-up):
  - `loaded: false` → the loading error, for both tools.
  - A query matching two methods returns both, best first, with `signature` and
    `summary`; `limit: 1` returns one and `total: 2`.
  - A private method is not returned.
  - `get_component_docs` with a name from a search result returns its arguments
    and documentation; an unknown name → the error.
  - `self_type` naming a known type returns that type's methods only; an unknown
    one → "Unknown type".
- [ ] **Step 2:** Run
      `corepack pnpm --filter enso-gui exec vitest run src/project-view/mcp/__tests__/catalogueTools.test.ts`;
      expected FAIL. Implement; expected PASS.
- [ ] **Step 3:** Register both in `useProjectMcpTools.ts` (deps from
      `useCurrentProject().suggestionDb`, and the module's imported libraries as
      `ComponentList.vue` reads them). Typecheck and lint; expected PASS.
- [ ] **Step 4:** Commit: `MCP: component catalogue tools`.

---

### Task 8: Settings → AI → External agents

**Files:**

- Create: `app/gui/src/dashboard/layouts/Settings/McpSettingsSection.vue`
- Modify: `app/gui/src/configurations/settingsTabs.ts` (`SettingsTabType.ai`,
  its icon: grep `iconName.ts` for an existing suitable icon; do not invent a
  name)
- Modify: `app/gui/src/dashboard/layouts/Settings/tabs.ts` (an `AI_TAB` with one
  section, added to the first group after `LOCAL_TAB`; the section's
  `visible: () => window.api?.mcp != null`, and the tab hidden when it has no
  visible section, following how the page treats empty tabs)
- Modify: `app/common/src/text/english.json`
- Modify: `app/gui/src/dashboard/layouts/Settings/CLAUDE.md`
- Test:
  `app/gui/src/dashboard/layouts/Settings/__tests__/McpSettingsSection.test.ts`
- Test: `app/gui/integration-test/dashboard/mcpSettings.spec.ts`

**Interfaces:**

- Consumes: `window.api.mcp` (`McpApi`), `McpStatus`, `MCP_CLIENT_KINDS`.

Behaviour (model: `SecretsSettingsSection.vue` for IPC mutations,
`EngineSettingsSection.vue` for the switch):

- A switch "Allow external agents to connect" bound to `status.enabled`, calling
  `setEnabled`.
- Under it, always visible, one sentence: "A connected agent can read your
  project and run Enso code as you. Turn this on only for agents you trust."
- When enabled: the address (`http://127.0.0.1:<port>/mcp`) as selectable text;
  a port field (number, 1024–65535) applied on submit with `setPort`; a "Copy
  setup for" row with a button per client (Claude Code, Codex, GitHub Copilot
  (VS Code), GitHub Copilot CLI, JSON) calling `copyConfig(kind)` and showing a
  "Copied" toast; a "New token" button calling `replaceToken` behind a confirm
  dialog ("Agents set up with the current token will stop working.").
- `status.error` non-null → shown as an error line under the switch.
- The section subscribes to `onStatusChanged` and reads `status()` on mount.
- Strings: `aiSettingsTab`, `mcpSettingsSection` ("External agents"),
  `mcpSettingsCustomEntryAliases` ("mcp\nagent\nclaude\ncodex\ncopilot\ntoken"),
  and one key per label above, following the file's naming rules.

- [ ] **Step 1: Write the failing component test** with `mountWithProviders`
      (`$/utils/testing`) and a stubbed `window.api.mcp`:
  - Disabled status: the switch is off, the warning shows, no address.
  - Clicking the switch calls `setEnabled(true)`; with the resolved running
    status the address `http://127.0.0.1:39417/mcp` shows.
  - Clicking "Claude Code" calls `copyConfig('claudeCode')`.
  - A status with `error` shows it.
  - Submitting port `40000` calls `setPort(40000)`; `80` shows a validation
    message and does not call it.
- [ ] **Step 2:** Run it; expected FAIL. Implement the section, the tab and the
      strings; expected PASS.
- [ ] **Step 3: Write the Playwright spec** (`mcpSettings.spec.ts`, model: an
      existing spec under `integration-test/dashboard/` that opens Settings):
      open Settings → AI; expect the switch off; turn it on; expect the address;
      click "JSON" and expect `window.__mcpCopied === 'json'`. Take one
      screenshot of the section enabled, following the directory's screenshot
      convention.
- [ ] **Step 4:** Run
      `corepack pnpm --filter enso-gui run test:integration -- dashboard/mcpSettings.spec.ts`
      (on Windows the functional assertions run; the screenshot baseline is made
      on Linux: see Task 9). Expected: PASS.
- [ ] **Step 5:** Typecheck, lint, `prettier --check` on the changed files;
      expected PASS.
- [ ] **Step 6:** Commit: `MCP: Settings → AI → External agents`.

---

### Task 9: Packaged-app test, documentation, changelog, PR

**Files:**

- Create: `app/electron-client/tests/mcp.spec.ts`
- Modify: `app/electron-client/tests/electronTest.ts` only if a fixture option
  for extra environment variables does not exist
- Create: `app/electron-client/src/mcp/CLAUDE.md`
- Modify: `app/electron-client/CLAUDE.md` (a short "MCP server for external
  agents" section pointing at `src/mcp/CLAUDE.md`), `app/gui/CLAUDE.md` (one
  paragraph on `src/mcp/` and `project-view/mcp/`)
- Modify: `CHANGELOG.md` (`#### Enso IDE`:
  `- [External agent apps can connect to the IDE over MCP and read the open project][NNN]`
  with the link definition; `NNN` is the PR number)

**Steps:**

- [ ] **Step 1: Write `tests/mcp.spec.ts`**: launch with `ENSO_MCP_ENABLED=1`,
      `ENSO_MCP_PORT=<a free port>`, `ENSO_MCP_TOKEN=test-token`; create and
      open a new project (`createNewProject`); connect an SDK `Client` over
      `StreamableHTTPClientTransport` with the bearer header; then:
  - `listTools` includes the six tool names.
  - `callTool('get_guide', {})` contains "get_graph".
  - `callTool('get_graph', {})` parses as JSON with a non-empty `nodes` and a
    `source` containing `main`.
  - `callTool('search_components', { query: 'read' })` has at least one result
    whose `name` ends in `read`.
  - `callTool('evaluate_expression', { expression: '(1 + 2).to_text' })` is `3`.
  - **The Write rule:**
    `callTool('evaluate_expression', { expression: '("x".write "<temp file path>").to_text' })`,
    then assert the file does not exist. If the engine reports an error instead,
    that is fine: the assertion is on the file.
  - A raw `fetch` without the token is `401`.
- [ ] **Step 2:** Build the packaged app if `dist/ide` is missing or stale
      (`corepack pnpm --filter build-scripts run ide-local`; see
      `tools/build-scripts/CLAUDE.md`; about 30 minutes) and run
      `corepack pnpm -r --filter enso ide-integration-test tests/mcp.spec.ts`.
      Run it three times; record the three results. Expected: 3 passes. If the
      Write assertion fails (the file exists), stop and report: that is a
      design-level finding, not something to patch around.
- [ ] **Step 3:** Write `src/mcp/CLAUDE.md`: the parts and their files; a tool
      needs a definition here and a handler in the window; the caller checks and
      why; the settings file, the token's keychain account, the three
      environment overrides; that the old `src/ai/` server is separate until the
      chat PR removes it. Update the two parent `CLAUDE.md` files.
- [ ] **Step 4:** Linux pass in WSL (see the root `CLAUDE.md`, "Verify on
      Linux"): unit tests of both packages, and the GUI Playwright spec with its
      screenshot baseline created there.
- [ ] **Step 5:** Full local gate on Windows: `corepack pnpm run ci:typecheck`,
      `corepack pnpm run ci:lint`, `corepack pnpm run ci:unit-test`,
      `corepack pnpm exec prettier --check .` on changed files. Expected: PASS.
- [ ] **Step 6:** Push, open the PR (title "MCP: external agents can connect and
      read the open project"), add the changelog entry with the PR's number,
      attach the Settings screenshot through the `pr-screenshots` branch, and
      list in the PR body what was verified and what was not (manual acceptance
      with Claude Code, Codex and Copilot is the owner's).
- [ ] **Step 7:** Commit and push the changelog: `MCP: changelog`.

## What this plan does not verify

- Real Claude Code, Codex and GitHub Copilot sessions against the server: manual
  acceptance by the owner, with the copied configs.
- The exact config shape each client wants today (Task 5 checks the
  documentation; only a real session proves it).
- macOS.
