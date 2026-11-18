# MCP activity icon

Status: design for review (#864). Decided in discussion #853 (2026-11-17):
follows the dropped chat panel (`2026-11-15-ai-chat-and-mcp-design.md`,
amendment of 2026-11-16, "Activity icon").

## Why

The MCP server is off by default and lives in Settings → AI. Once it is on,
nothing in the app says so, nor whether an agent is using it. The owner's
decision: **a top-bar icon, greyed when MCP is off. Clicking it opens a
view-only popover**: the connected app, its last few tool calls, an **Enable
MCP** button when MCP is off, and a link to Settings → AI. **No controls over
the agent** (no disconnect, no stop).

## What the user sees

### Where

The app's top bar is the 3rem strip of `AppContainer.vue` (`--top-bar-height`):
the tabs (`TabBar.vue`) run in `.bar`, between the left rail and the right
panel's rail, both of which run up through the strip. The icon goes at the
**right end of the strip, immediately left of the right rail**, on every page
(the Drive, a project, Settings, a session log): the server serves the whole
app, not one project.

It is **not** a child of `.bar`. With no tab open `middlePanelShown` is false,
`.tabPanel` shrinks to the right rail and `.bar` has no width, so a button in it
would vanish on the Drive at start-up, the most common place to turn MCP on. It
is its own element in `AppContainer.vue` (`McpActivityButton.vue`, in
`$/components/AppContainer/`), positioned absolutely at the strip's top right
(`right: 48px`, the rail), above the left panel (which expands over the strip
when the middle panel is hidden). `.bar`'s right padding grows by the button's
width, so the tabs scroll under nothing. It renders only when `window.api.mcp`
exists (the desktop app), as the Settings → AI tab does.

### The icon

A new symbol, `mcp_activity`, in `icons.svg` (owner's decision, 2026-11-18: not
the Settings → AI tab's `robot`). It is drawn to the icon rules of #95
(Style-Guide-Icons; `iconStyle.test.ts` must pass): an agent connected to the
IDE, e.g. a plug or a link node, legible at 16px. The before/after screenshots
show it at 1× and 2× in both themes. The state is shown by the glyph's tone and
a small badge drawn in CSS at its bottom right (6px, a 1px ring of the bar's
background), not by variants of the symbol:

| State         | When (from main's status and activity)                                                     | Glyph                  | Badge                                            |
| ------------- | ------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------ |
| **off**       | `enabled` false and no `error`                                                             | greyed (disabled tone) | none                                             |
| **error**     | `error` non-null, on or off (port taken, settings file unreadable (#868), token not saved) | normal                 | red `!` dot                                      |
| **on, idle**  | `running`, no client seen within the window (see "Connected")                              | normal                 | none                                             |
| **connected** | `running`, a client seen within the window                                                 | normal                 | green dot                                        |
| **active**    | `running`, a call in flight or finished less than 10 s ago                                 | normal                 | green dot, pulsing (steady under reduced motion) |

`enabled` but not yet `running` (starting) shows as **on, idle**. Error wins
over every other state. Hovering shows a tooltip with the state's sentence (the
same text as the button's accessible name, below).

### The popover

`Popover` (`$/components/Dialog/`), modal (the default: Escape or a press
outside closes it, focus returns to the icon), placed `bottom-end` under the
icon, about 320px wide. It shows; it does not control. The mockups below.

**Off**

```
┌────────────────────────────────────────────┐
│ AI agents (MCP)                    ○ Off   │
│                                            │
│ Agent apps such as Claude Code can work on │
│ your projects through MCP. It is off.      │
│                                            │
│ ⚠ A connected agent can read your project  │
│   and run Enso code as you. Turn this on   │
│   only for agents you trust.               │
│                                            │
│ [ Enable MCP ]                             │
│                                            │
│ Settings → AI ›                            │
└────────────────────────────────────────────┘
```

While `lockedByEnvironment` is true the button is disabled and the
`mcpLockedByEnvironment` note replaces the warning (main would refuse anyway).

**Error** (here, #868's unreadable settings file; the text is main's `error`)

```
┌────────────────────────────────────────────┐
│ AI agents (MCP)                  ● Problem │
│                                            │
│ The MCP settings file could not be read:   │
│ Unexpected token } in JSON at position 41  │
│ (C:\Users\…\enso\mcp-settings.json). The   │
│ file is left unchanged …                   │
│                                            │
│ Settings → AI ›                            │
└────────────────────────────────────────────┘
```

No Enable button in this state: the fix is in the file or in Settings (a port
change for "port in use"), and Settings already explains it.

**On, idle**

```
┌────────────────────────────────────────────┐
│ AI agents (MCP)                    ● On    │
│ http://127.0.0.1:39417/mcp                 │
│                                            │
│ No agent app has connected yet.            │
│ Copy a setup in Settings → AI to connect   │
│ one.                                       │
│                                            │
│ Settings → AI ›                            │
└────────────────────────────────────────────┘
```

After a client has been seen but not within the window, the second line reads
"Last seen: Claude Code, 2 h ago." instead, and the last calls stay listed.

**Connected**, or **active** (one call running)

```
┌────────────────────────────────────────────┐
│ AI agents (MCP)                    ● On    │
│ http://127.0.0.1:39417/mcp                 │
│                                            │
│ Claude Code 2.0.14          seen just now  │
│                                            │
│ Recent calls                               │
│  ◌ add_nodes                    running…   │
│  ✓ get_graph            1.2 s   12 s ago   │
│  ⊘ evaluate_expression  Refused 40 s ago   │
│  ✓ search_components    0.3 s   1 min ago  │
│  ✕ get_visualization    Error   3 min ago  │
│                                            │
│ Settings → AI ›                            │
└────────────────────────────────────────────┘
```

With two or more clients seen within the window, each gets a line (most recent
first, at most three; "and 2 more" after), and each call line starts with its
client's name. With one, the name is said once above the list.

## Data: main to the window

### What main records

A new `McpActivity` (`app/electron-client/src/mcp/mcpActivity.ts`), created once
in `initMcp` and passed to every `McpHttpServer` the controller creates (a
server is created per start, so the record cannot live in the server). It holds,
in memory only:

- **Clients**, keyed by the request's `User-Agent` product token (`callerName`,
  already computed per request): the display name, the version and when it was
  last seen. At most 8; the least recently seen is dropped.
- **Calls**: the last **5**, newest first, each
  `{ id, client, tool, startedAt, endedAt, outcome }`.

How it is fed, in `mcpServer.ts`:

- **Seen**: every request that passes the caller checks (any `/mcp` request: an
  `initialize`, `tools/list`, a resource read or a call) updates its client's
  `lastSeenAt`. Refused requests (no token, an `Origin`, a foreign `Host`) do
  not: they are not a connected app.
- **The name** comes from the `initialize` handshake, as the owner asked. The
  server is stateless (Note [The MCP Caller Name Comes From The User-Agent]):
  `clientInfo` exists only on the `initialize` request's own `McpServer`. After
  `transport.handleRequest` returns, `server.server.getClientVersion()` is
  non-null exactly when that request was an `initialize`; main then stores
  `clientInfo.title ?? clientInfo.name` and `version` under that request's
  `User-Agent` token. Later requests with the same token show that name; a
  client never seen initializing shows the token (`claude-code`, `node`). Two
  sessions of one app share a token and so show as one client: acceptable, the
  popover names apps, not sessions.
- **Calls**: the tool handler in `createMcpServer` records a call as `running`
  before `registry.call` and sets `endedAt` and the outcome when it returns.

A name is chosen by the client: it is a label, never a credential (as
`callerName` already says). Main trims it to 64 characters and strips control
characters; the window renders it as text, never as HTML.

### Outcome: ok, refused or error

`McpToolResult` today is `{ ok: true, … }` or `{ ok: false, error }`. Refused
and error are told apart by a new optional field on the failure,
`refused?: true`, set by the window where a handler applies one of the house
rules: Live mode (`LIVE_MODE_ERROR`, `LIVE_EDIT_ERROR`, `LIVE_REFRESH_ERROR`),
the Write rule (`UNDO_OUTPUT_ERROR`, `REDO_OUTPUT_ERROR`,
`WRITE_ON_REFRESH_ERROR`, the edit tools' write refusal), the undo floor
(`NOTHING_LEFT_TO_UNDO_ERROR` and the like), no project open
(`NO_PROJECT_ERROR`), versions off (`VERSIONS_NOT_KEPT_ERROR`) and `add_image`'s
path rule. Everything else that fails is **error**: bad arguments, an unknown
tool, a timeout, a throw, an engine error. The field does not change what the
agent receives (still `isError: true` and the same text).

### Privacy

A call line holds **only** the tool's name, the client, the times and the
outcome. Never the arguments, the result, the error text, node code, file paths
or file contents: those can hold the user's data, and the popover can be on
screen while sharing it. The log is never written to disk and never sent to the
engine log; it is gone when the app quits.

### IPC

The pattern of `mcpStatus` / `mcpStatusChanged` (`electron.ts`, `preload.ts`,
`McpApi` in `app/gui/src/electronApi.ts`):

- `Channel.mcpActivity` (invoke) answers the current `McpActivitySnapshot`.
- `Channel.mcpActivityChanged` (main → every window) carries a new snapshot on
  each change: a client seen for the first time or after the window lapsed, a
  call started, a call ended. A `lastSeenAt` that only moves is not broadcast
  more than once every 5 s, so a busy agent does not flood the window.
- `McpApi` gains `activity()` and `onActivityChanged(handler)`, and the
  Playwright mock (`integration-test/mock/registerMocks.ts`) gets both, seeded
  from `window.__mcpMockActivity`.

The types go in `app/common/src/mcp.ts`:

```ts
export type McpCallOutcome = "running" | "ok" | "refused" | "error";
export interface McpActivityCall {
  readonly id: number;
  readonly client: string;
  readonly tool: string;
  readonly startedAt: number; // epoch ms, main's clock
  readonly endedAt: number | null;
  readonly outcome: McpCallOutcome;
}
export interface McpActivityClient {
  readonly name: string;
  readonly version: string | null;
  readonly lastSeenAt: number;
}
export interface McpActivitySnapshot {
  readonly clients: readonly McpActivityClient[]; // most recently seen first
  readonly calls: readonly McpActivityCall[]; // newest first, at most 5
}
```

Times are main's `Date.now()`; the window compares them with its own clock (the
same machine) and re-renders on a timer while the popover is open or a
time-based state (active, connected) is due to lapse.

**A reload keeps it**: the record is in main, so a reloaded window asks
`activity()` and shows the same clients and calls. **A restart does not**, and
**the record is cleared when the server stops** (turned off, or restarted on a
new port or token): turning MCP back on starts with no history, and an "off"
popover has no stale list to explain.

### What "connected" means

The server is stateless HTTP: there is no connection to observe, and an idle
agent session sends nothing. So **connected means seen within the last 15
minutes**: any accepted request from that client. With none, the server is **on,
idle**. With several, each is listed; the icon is connected if any is, and
active if any call is running or ended under 10 s ago. A call still running when
its client lapses keeps the state active until it ends.

## Enable MCP

The button does exactly what the Settings switch does: `mcp.setEnabled(true)`
over the same IPC. Main saves the setting, starts the server and creates the
token on that first start (`McpController`, "Settings, token"), and broadcasts
the status, so the Settings section (if open) and the icon both update. The
popover shows the switch's standing warning (`mcpWarning`) above the button, as
Settings shows it above the switch; there is no extra confirm, as there is none
on the switch. While the call runs the button shows a spinner; when it resolves
the popover redraws in the state the status gives (on, idle; or error, whose
text then shows). A rejection (the locked case, a file that could not be
written) shows its message under the button. There is no Disable button: turning
off stays in Settings (view-only, and it keeps the popover from becoming a
second settings page).

**Settings → AI** is a `Link` that opens the Settings tab on the AI tab
(`openSettingsTab()` plus `cloud-ide_SettingsTab=ai`, the search parameter that
`SettingsPage.vue` reads) and closes the popover.

## Keyboard and accessibility

- The icon is a `button` in the tab order after the tabs, with
  `aria-haspopup="dialog"`, `aria-expanded`, and an accessible name that states
  the state: "AI agents: off", "AI agents: on, no app connected", "AI agents:
  Claude Code connected", "AI agents: Claude Code is working", "AI agents:
  problem". The badge and the greyed tone are `aria-hidden`; colour is never the
  only signal (the name and the popover's status word say it).
- Enter or Space opens; Escape closes and returns focus to the icon; Tab moves
  through the popover's Enable button and Settings link.
- The popover is a `dialog` labelled by its heading; the call list is a `list`,
  each item read as "get_graph, OK, 12 seconds ago" (the ✓ ⊘ ✕ glyphs are
  `aria-hidden`, the outcome word is visible text for refused and error, and
  visually hidden for ok and running).
- State changes are not announced (no live region): an agent can make dozens of
  calls a minute, and the screen reader user did not ask. The name updates, so
  focusing the icon reads the current state.
- The pulse uses `@media (prefers-reduced-motion: no-preference)`; otherwise the
  dot is steady.
- No keyboard shortcut and no command palette entry in this change.

## Strings

New `english.json` keys (`mcpActivity*`): the heading, the state words and
sentences, "No agent app has connected yet.", "Last seen: …", "Recent calls",
the outcome words, "Enable MCP", "Settings → AI", the relative times (through
the existing relative-time helper if there is one, `Intl.RelativeTimeFormat`
otherwise). `mcpWarning` and `mcpLockedByEnvironment` are reused.

## Tests

- **Main, unit** (`tests/headless/mcpActivity.test.ts`): the client cap and
  order; a name from `initialize` used for later calls with the same token, the
  token when none; trimming and control characters; the 5-call ring; running →
  ended with each outcome; cleared on stop; the `lastSeenAt` broadcast throttle;
  nothing but name, client, times and outcome in a snapshot (a test that feeds
  arguments and an error text with a marker string and checks the serialized
  snapshot does not contain it).
- **Main, server** (`mcpServer.test.ts`, the real SDK client): an `initialize`
  with `clientInfo { name: 'test-client', title: 'Test Client' }` then a
  `tools/call` records one client "Test Client" and one call; a refused request
  (no token) records nothing.
- **Window, refused flag**: the handlers' tests in `project-view/mcp/__tests__/`
  check `refused: true` on the rule refusals (Live, Write, undo floor, no
  project) and its absence on an ordinary failure.
- **Component**
  (`$/components/AppContainer/__tests__/McpActivityButton.test.ts`,
  `mountWithProviders`, fake timers): each state's accessible name and badge;
  the active state lapsing after 10 s and connected after 15 min; Enable calls
  `setEnabled(true)` once and shows a rejection; Enable absent in error and
  disabled when locked; Escape returns focus to the icon; no argument text
  rendered.
- **Playwright** (`integration-test/dashboard/mcpActivity.spec.ts`, the mock):
  the icon is visible with no tab open and with a project open; off → Enable →
  on, idle (the mock's `setEnabled`); a seeded snapshot with one client and five
  calls of each outcome renders the list; Settings → AI opens the AI tab;
  screenshots of the popover in each state on Linux (the baselines' platform).
- The packaged `tests/mcp.spec.ts` gets one check: after its SDK client's calls,
  `activity()` in the window names the client and lists the last call.

## Screenshots

The implementation PR attaches before and after images of the top bar (Drive
with no tab, and a project) and one image per popover state (off, error, on
idle, connected, active), through the orphan `pr-screenshots` branch, per the
standing rule. A UI feature: the owner tests an installer before it merges.

## Out of scope

Controls over the agent (disconnect, stop, revoke): Settings' New token is the
way to cut an app off. A full history, a per-call detail view, notifications,
and any record of what a call did.

## Decisions (owner, 2026-11-18)

1. **Connected** means a request in the last **15 minutes**; after that the
   popover says "Last seen …".
2. **Five calls**, cleared when the server stops (a window reload keeps them).
3. **Refused and error are told apart**, through the `refused` flag on the
   window's rule refusals.
4. **A new icon** (`mcp_activity`, see "The icon"), not the `robot` glyph; the
   state is still a CSS badge.
