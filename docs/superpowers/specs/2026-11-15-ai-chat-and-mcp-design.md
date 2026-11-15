# AI chat and MCP control: design

Date: 2026-11-15. Status: design agreed in conversation, awaiting review.

## Summary

The IDE's AI feature today is a prompt in the Component Browser that generates
one User Defined Component. This design replaces it with two things built on one
set of tools:

- **An MCP server** in the IDE, through which any agent the user already runs
  (Claude Code, Codex, GitHub Copilot, T3 Code) can read and build a project.
  This is how a user's existing subscription is used.
- **A chat panel** in the IDE, running on the user's own API key (Anthropic, or
  any OpenAI-compatible endpoint, local models included).

AI nodes, their placeholder, the stored prompt and the spawned `claude` child
are removed.

## Decisions

| Question                | Decision                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| AI nodes                | Removed. Chat replaces them. Agents build ordinary nodes.                                              |
| In-app chat credentials | API key. No subscription CLI is driven from inside the chat.                                           |
| Subscriptions           | Used through the user's own agent app, connected over MCP.                                             |
| Chat providers          | Anthropic and OpenAI-compatible, both in this design.                                                  |
| Reach of the tools      | The open project and the app (list, create, open, close projects; list Drive files).                   |
| Control of changes      | Agents act freely. One undo step per turn. A version is saved first. No per-edit approval.             |
| Write                   | Never available to an agent. The user clicks it.                                                       |
| External connection     | A setting, off by default: MCP over loopback HTTP, fixed port, token in the keychain.                  |
| Where tools run         | Registry in the Electron main process; project tools run in the window, through the graph store.       |
| Shape of edit tools     | Node-level tools that carry Enso code.                                                                 |
| In-app agent            | Our own loop in main over a provider interface. It calls the registry directly, not over HTTP.         |
| Guidance                | Served by the MCP server (instructions, a `get_guide` tool, resources), shared with the chat's prompt. |
| GitHub Copilot          | A named acceptance target, in VS Code agent mode and the Copilot CLI.                                  |

## Background

### What exists

- `app/electron-client/src/ai/`: `ClaudeAgentSession` and `ChildAgent` spawn one
  long-lived `claude -p` child in stream-json mode, prime it with standard
  library documentation, rotate it when its context grows, and parse its output.
  `aiMcpServer.ts` is a loopback HTTP MCP server with one tool,
  `evaluateExpression`, guarded by a bearer token and an `Origin` check (#616).
- `app/gui`: the Component Browser's AI mode, `ongoingAiPrompts.ts` (queue and
  placeholders), `AiPendingNode.vue`, `WidgetAiPrompt.vue`, `aiNode.ts` (inserts
  the generated function and its call, with the prompt as the node's `AI: …`
  documentation comment), `aiToolHandler.ts` (runs `evaluateExpression` in the
  window) and `composables/ai.ts`.

The agent returns one JSON shape and cannot change the graph itself. It is
Claude only and single shot.

### How T3 Code uses installed subscriptions

Researched from the `pingdotgg/t3code` source (MIT):

- Claude: `@anthropic-ai/claude-agent-sdk` spawns the user's installed `claude`
  binary and relies on its stored login. Codex: `codex app-server`, JSON-RPC
  over stdio, using `codex login`. Others: a generic Agent Client Protocol
  adapter.
- Its own tools reach the agents through an HTTP MCP server in its server
  process, with a bearer token per thread, injected through each agent's session
  configuration. This is the shape of our `aiMcpServer.ts`.
- The adapters are 9k to 14k lines each, built on Effect and its event-sourced
  model. They are a reference for protocol traps, not code to lift.

### Why the chat uses an API key

Anthropic's legal page says products built on Claude, the Agent SDK included,
should use API-key authentication and must not route requests through
subscription credentials; it allows an end user to sign in to the unmodified
Claude Code binary themselves. No page was found that permits SDK plus
subscription in a third-party app, and none for a third-party UI driving
`codex app-server`. The split in this design keeps each side on its documented
path: the in-app chat uses a key, and a subscription is used by the vendor's own
agent app, which connects to the IDE over MCP.

## Architecture

```
 external agent app ──HTTP + token──▶ MCP server ─┐
 (Claude Code, Codex, Copilot)                    │
                                                  ▼
 chat panel ◀──IPC stream──▶ chat agent ──▶ tool registry ──▶ project manager
 (right-panel tab)           (main)          (main)       └─▶ window (IPC) ──▶ graph store
                                │
                                ▼
                     provider adapter ──▶ Anthropic API / OpenAI-compatible API
```

### Tool registry (Electron main)

The only place a tool is defined: name, description, input schema (Zod),
handler. A handler is one of two kinds:

- **App tools** call the project manager shim in process.
- **Project tools** are forwarded over IPC to the window showing the project,
  run there against the graph store, and the reply is returned. This generalises
  the `evaluateExpression` bridge (`Channel.aiToolCall` and its reply) from one
  tool to a typed set.

Every call carries a caller: `chat`, or the external client's name from its MCP
`initialize`. The caller is used for the activity feed and for undo grouping.
Project edit tools run one at a time across all callers.

A project tool called with no window, or no open project, fails with a message
that names `open_project`.

### MCP server (Electron main)

`aiMcpServer.ts` extended:

- Serves every registry tool, the guidance resources, and server `instructions`.
- Starts only while the setting is on. The in-app chat does not use it.
- Port: fixed, default 39417, changeable in Settings. If it is taken, the server
  does not start and Settings says so.
- Token: random, created when the setting is first turned on, kept in the
  keychain (service `Enso`, account `mcp-token`, through the same lazily loaded
  `@napi-rs/keyring` entry as the secrets key). Settings can replace it.
- Checks before the MCP transport sees a request, as today: bearer token
  (`401`), no `Origin` header (`403`), and additionally a loopback `Host` (the
  content server's `acceptLocalRequest` rule).
- Transport: `StreamableHTTPServerTransport`, stateless, as today.

### Chat agent (Electron main)

One loop per conversation turn:

1. Build the request: system prompt (the overview guide), the conversation, the
   tool definitions from the registry.
2. Stream the provider's reply to the panel.
3. Run the tool calls through the registry, return every result in one message,
   repeat until the model stops calling tools, the user presses Stop, or 50
   steps have run.

The API key is read in main and never sent to the window.

Provider interface (sketch):

```ts
interface ChatProvider {
  listModels(): Promise<ModelInfo[]>;
  streamTurn(
    request: TurnRequest,
    signal: AbortSignal,
  ): AsyncIterable<TurnEvent>;
}
// TurnEvent: text delta | tool call | usage | stop (end, tool_use, refusal, max_tokens, error)
```

- **Anthropic adapter**: `@anthropic-ai/sdk`. Model `claude-opus-5-5` by
  default, adaptive thinking, streaming, prompt caching on the system prompt and
  tools, server-side compaction for long conversations, and the API's refusal
  fallback. Tool inputs are validated against the Zod schema before a handler
  runs. Thinking blocks and compaction blocks are stored and replayed unchanged.
- **OpenAI-compatible adapter**: chat completions with tools, against a base URL
  (`https://api.openai.com/v1` by default). No compaction: on a context-length
  error the turn ends and the panel says to start a new chat.

Each adapter keeps the conversation in its provider's own message format; a
conversation belongs to the provider it started with.

### Chat panel (GUI)

A right-panel tab, contributed through `contributeRightPanelTab` from
`registerCore.ts` (the tab type gains `chat`). The right panel belongs to
`AppContainer`, so the tab works on the dashboard and in a project. Code lives
in `app/gui/src/chat/`.

## Tools

Edit tools wait for execution to settle (capped at 20 s) and return the affected
nodes' types, errors and warnings. Value previews are capped at 2,000 characters
in `get_graph` and 20,000 in `get_node`.

### App tools

| Tool             | Does                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `get_app_state`  | The open project, the method on screen, the selection, Design or Live.       |
| `list_projects`  | Name, location, whether open.                                                |
| `create_project` | Creates a project, optionally from a template, and opens it.                 |
| `open_project`   | Opens a project in the window; returns once the graph is ready.              |
| `close_project`  | Closes the open project.                                                     |
| `list_files`     | Names and sizes in a Drive folder. Contents are read through Enso, not here. |

### Project tools: reading

| Tool                  | Does                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `get_graph`           | The method's nodes (id, name, code, type, value preview, error or warnings), its source, the module's imports. |
| `get_node`            | One node in full.                                                                                              |
| `search_components`   | Searches the component catalogue, optionally for a self type: names, signatures, one-line summaries.           |
| `get_component_docs`  | A component's full documentation.                                                                              |
| `evaluate_expression` | Runs an expression in a node's scope, in Design, and returns text (today's tool and its error hints, kept).    |

### Project tools: editing

| Tool                | Does                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| `add_nodes`         | Adds statements after a given node, with the imports they need; existing layout. |
| `edit_node`         | Replaces a node's expression.                                                    |
| `remove_nodes`      | Deletes nodes.                                                                   |
| `collapse_nodes`    | Groups nodes into a named component, as the GUI's collapse does.                 |
| `add_function`      | Adds a component written from scratch.                                           |
| `set_node_comment`  | Sets a node's comment.                                                           |
| `set_visualization` | Shows or hides a node's visualization.                                           |
| `select_nodes`      | Selects nodes and pans to them.                                                  |
| `open_method`       | Enters a component, or returns to its caller.                                    |

Node ids are the nodes' external ids, so they survive edits and reconnects.
Edits go through the graph store's own setters (`setNodesVisualization`, the
layout setters, `releasePushedBy` on removal), under the rules in
`project-view/CLAUDE.md` ("Nodes make room").

Not tools, in this design: Write and the execution environment, deleting
projects or files, secrets, settings.

## Guidance

- **Server `instructions`**: a short paragraph: what Enso is, and to call
  `get_guide` before building.
- **`get_guide(topic)`** and the same documents as MCP resources
  (`enso://guide/<topic>`). Both, because several clients, Copilot among them,
  do not reliably show resources to the model.
- **Topics**: `overview` (how to work with these tools: read, build in small
  steps, check each result), `language` (the cheat sheet), `data-pitfalls`, and
  one per standard library.
- The cheat sheet and pitfalls move from `prompts.ts` into Markdown files
  shipped with the app. Library topics are read from the `CLAUDE.md` bundled
  with each library (`paths.stdlibRoot()`), so they follow the engine.
- The chat's system prompt is the `overview` guide.

## Rules for changes

- **Design only.** `evaluate_expression` runs in the Design environment. No tool
  sets the environment or triggers Write.
- **Live mode.** While the user has the project in Live mode, edit tools are
  refused with a message that says so; read tools work.
- **Undo.** A chat turn holds one undo step (`module.undoManager.holdStep`),
  released on every way a turn can end. For an external caller, consecutive edit
  calls share a step until the user edits or 10 s pass without a call.
- **Versions.** Before the first edit of a turn (or of an external caller's
  step), `saveIfEnabled` saves a version where the project keeps versions. If
  the save fails, the edit is refused.
- **View.** The agent's edits do not move the user's viewport; only
  `select_nodes` and `open_method` do.

## Settings → AI

- Provider, key (set or clear; never read back; optional for OpenAI-compatible),
  base URL, model (fetched list, free text as fallback).
- Keys in the keychain: accounts `ai-key-anthropic` and `ai-key-openai`.
- External agents: on/off, port, token (copy, replace), and copy buttons for
  Claude Code, Codex, GitHub Copilot (VS Code `mcp.json` and the CLI) and a
  generic JSON block.
- One sentence of warning beside the switch: a connected agent can run code as
  you.

## Chat panel behaviour

- **Nothing set up**: two cards, "Use an API key" and "Connect your own agent",
  each opening its part of Settings. Both can be on.
- **Chat**: messages; the reply streamed as formatted text; one line per tool
  call, expandable to its code and result, with node names that select the node.
- **Controls**: Stop, New chat, recent chats, the conversation's token count.
- **External agents**: a live feed of a connected agent's tool calls, in the
  same form.
- Each user message carries a snapshot of the app state (project, method,
  selection), added to that message so the cached prefix is unchanged.
- **Conversations** are JSON files under the app's user data (`chats/`), not in
  the project folder, so transcripts never enter a project's git history.

### Errors

| Case                          | Behaviour                                                         |
| ----------------------------- | ----------------------------------------------------------------- |
| Missing or rejected key       | Message with a link to Settings.                                  |
| Rate limit, network failure   | Message with Retry.                                               |
| Refusal                       | Shown as such. Claude: the API's fallback is on.                  |
| Output cut off (`max_tokens`) | Shown; the partial reply is kept.                                 |
| Tool failure                  | Returned to the model as an error result; shown on the tool line. |
| Project closes mid-turn       | The turn ends with a message; the undo step is released.          |
| Step limit reached            | The turn ends with a message offering to continue.                |

## Security

- The MCP server is off by default, loopback only, and needs the token.
- **An agent can run code.** Adding nodes and imports lets an agent call Java
  through Enso, so a connected agent, or a model following injected
  instructions, can do what the user can. The Design rule prevents accidental
  writes; it is not a sandbox. Turning the setting on, or entering an API key,
  is the trust decision, and Settings says so.
- **Injected instructions** in data the agent reads are mitigated by: no Write,
  no delete, no secrets or settings tools, one undo step per turn, and the saved
  version. A network read that leaks data remains possible and is accepted.
- The API keys and the MCP token stay in main and the keychain.

## Removal

- Electron: `claudeAgent.ts`, `claudeAgentChild.ts`, the prompt builders in
  `prompts.ts`, their IPC channels and tests, `ENSO_AI_*` variables,
  `aiMetrics`.
- GUI: the Component Browser's AI mode, `ongoingAiPrompts.ts`,
  `AiPendingNode.vue`, `WidgetAiPrompt.vue`, `aiNode.ts`, `composables/ai.ts`,
  their specs, and `repointPushedBy` if nothing else uses it.
- Existing projects: a generated component stays an ordinary component. Its
  `AI: <prompt>` documentation shows as a normal comment. No migration.
- `electron-client/CLAUDE.md`'s "Local Claude agent" section is rewritten for
  the new parts.

## Testing

- **Unit (Vitest)**: the registry; each window-side tool handler against a mock
  project; the MCP server's token, `Origin`, `Host`, listing and guides; each
  adapter against recorded streams; the loop against a scripted provider (tool
  rounds, Stop, step limit, each error). No real key in CI.
- **GUI Playwright**: the panel's states with a fake provider behind the mocked
  `window.api`; screenshots on the PR.
- **Packaged app (Playwright)**: a real MCP client (`@modelcontextprotocol/sdk`)
  connects, creates a project, adds nodes, reads them back and undoes them in
  one step. It also asserts that an evaluated expression that writes a file
  writes nothing, and that edits are refused in Live mode.
- **Manual acceptance**: Claude Code, Codex, GitHub Copilot in VS Code and the
  CLI, the chat with an Anthropic key, the chat with a local model.
- **Effectiveness suite**: `aiChallenges.spec.ts` ported to drive the chat,
  still gated on `ENSO_TEST_AI_CHALLENGES_DIR`.

## Order of work

One PR each. Each leaves the IDE working.

1. Tool registry, read tools, guidance, the MCP setting. An external agent can
   inspect a project.
2. Edit tools, undo grouping, the Live-mode rule, the activity feed. An external
   agent can build.
3. App tools.
4. Chat panel, Settings → AI, the Anthropic adapter; AI nodes and the old agent
   removed in the same PR.
5. OpenAI-compatible adapter.
6. Effectiveness suite ported.

PRs 1 to 5 each take a `CHANGELOG.md` entry; 6 takes the label.

## Out of scope

- Driving a subscription CLI from inside the chat.
- Tools that delete projects or files, or touch settings or secrets.
- Working with no window open.
- A stdio bridge for MCP clients without HTTP support.
- Attachments in chat.
- More than one window: tools act on the window that has the project open.

## To verify during planning

- That `executeExpression` cannot run with output on when the context is in
  Design, and what it does when the context is in Live.
- Whether a secret's value can be read as text by an expression.
- That GitHub Copilot's CLI and VS Code both send a custom `Authorization`
  header to an HTTP MCP server, and the exact config shape of each.
- The current `@anthropic-ai/sdk` version and the beta flags for compaction and
  refusal fallback at the time of PR 4.
