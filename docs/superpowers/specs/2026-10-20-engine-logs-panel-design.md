# Engine logs panel — design

Status: approved in conversation 2026-10-20; this document records it.

## Goal

A **Logs** tab in the project view's bottom dock, next to the code editor, that
follows the running engine's log live and can scroll back through the current
project's history, including earlier sessions.

## Current state

- The project-manager shim spawns the language server
  (`app/project-manager-shim/src/projectService/ensoRunner.ts`,
  `EnsoRunner.openProject`) with `stdio: ['pipe', 'inherit', 'inherit']`, so
  console output goes to the parent's terminal and nothing captures it.
  `WatchedChildProcess` respawns it after a crash; each spawn is a new log
  session.
- The engine logs through its own logging server. The file appender writes INFO
  and above to `<logDir>/<projectKey>/<baseName>.log`, rolling to
  `<baseName>.N.log.gz` (`getEngineLogDirectory()` in
  `app/project-manager-shim/src/distributionManager.ts`).
- The dashboard already has a session log viewer: shim commands
  `--list-project-sessions`, `--get-project-session-logs`,
  `--download-project-session-logs`
  (`app/project-manager-shim/src/handler/filesystem.ts`), and the GUI's
  `ProjectLog.vue`, `ProjectLogTable.vue`, `ProjectLogToolbar.vue` and
  `projectLogData.ts` (parsing into `{level, timestamp, module, event}`).
- `BottomPanel.vue` is a single-slot dock holding `CodeEditor`, toggled by
  `graph.toggleCodeEditor` (`` Mod+` ``). It persists its height only.

## Decisions

| Question    | Decision                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Purpose     | Live tail **and** history (archives of this session, earlier sessions)                                  |
| Layout      | Tabs in the existing bottom dock: **Code \| Logs**                                                      |
| Live source | Both: tail the session's `.log` file, and capture the engine's stderr                                   |
| Log level   | Filter only. The engine's level is unchanged (`--debug.verbose` as today)                               |
| Transport   | Server-sent events from the app's local server (shim), used by Electron and the browser dev build alike |

## Architecture

### Shim: `engineLogs` module

- **Tailer.** For an open project, find the current session's active `.log` file
  and read it from a byte offset as it grows (`fs.watch` plus a short poll as
  fallback, since `fs.watch` is unreliable on some filesystems). Split into
  lines on `\n`, keeping a partial trailing line until completed. When the
  engine rolls the file (the active file shrinks or is replaced), reopen from
  offset 0. When `WatchedChildProcess` respawns the engine, switch to the new
  session's file and emit a `session` event.
- **stderr capture.** Spawn the engine with stderr piped. Every chunk is written
  through to `process.stderr` (the terminal keeps what it has today) and split
  into lines tagged `source: 'stderr'`. stdout stays inherited.
- **Replay buffer.** Per project, a ring buffer of the most recent 5,000 lines
  (file and stderr interleaved in arrival order), each with a monotonically
  increasing sequence number.
- **Endpoint.** `GET /api/engine-logs/stream?project=<projectId>&after=<seq>`
  answers `text/event-stream`:
  - first the buffered lines with `seq > after` (all of them when `after` is
    absent), then live lines as they arrive;
  - events: `line` (`{seq, source: 'file' | 'stderr', sessionId, text}`),
    `session` (`{sessionId}`: the engine restarted), `waiting` (no session file
    yet), and a comment heartbeat every 15 s;
  - the stream ends when the project closes. It sits under `/api/`, so the
    same-origin and Host checks from #274 apply. Both hosts register it:
    Electron `Server.process` and the vite middleware.
- **History** reuses the existing session-log commands; no new history API.
- Tailing for a project starts when the project opens and stops when it closes,
  whether or not a window is listening, so the buffer covers start-up.

### GUI

- **Dock tabs.** `BottomPanel.vue` gains a tab strip (**Code**, **Logs**). The
  selected tab is persisted (local storage, alongside the height); height,
  resize and fullscreen apply to both. `` Mod+` `` toggles the dock as now; a
  new action `graph.toggleLogs` (default `` Mod+Shift+` ``, rebindable) opens
  the dock on Logs, or closes it if Logs is showing.
- **Logs tab** (`EngineLogPanel.vue`), reusing `projectLogData.ts` parsing and
  `ProjectLogTable.vue` presentation where they fit:
  - live lines append at the bottom; the view follows the tail unless the user
    has scrolled up, with a "Jump to latest" button while paused;
  - stderr lines are shown in the error style with a `stderr` marker;
  - a `session` event inserts a divider "Engine restarted (new session)";
  - toolbar: level filter (Error / Warn / Info and above), text filter, a
    session picker (this session, then earlier sessions of the project from
    `listProjectSessions`), and "Show in folder" for the log file;
  - scrolling to the top of the current session loads older lines from its
    rolled archives via the existing session-log query; choosing an earlier
    session shows it read-only (no live tail).
- **Badge.** While the Logs tab is not visible, the tab shows a count of ERROR
  lines and stderr lines since it was last viewed.
- **Client** (`useEngineLogStream`): an `EventSource` on the endpoint;
  reconnects with backoff, passing `after=<last seq>` so lines are neither
  duplicated nor lost while the buffer still holds them (if it doesn't, a "some
  lines were skipped; see history" divider is shown).

## Error handling

- No engine or no session file yet: the tab shows "Waiting for the engine…"
  (driven by `waiting`) and fills when the file appears.
- Engine crash or respawn: captured stderr shows in red, then the `session`
  divider, and the tab follows the new session; the old session stays in the
  picker.
- Dropped stream (sleep, server restart): reconnect with backoff from the last
  `seq`.
- Chatty logs: lines are batched to one update per animation frame, the table is
  virtualised, and the live list keeps the newest 20,000 lines (older ones
  remain available through history).
- Project close: the server ends the stream and stops tailing; the client does
  not reconnect for a closed project.
- Secrets: lines are shown exactly as the engine wrote them. The engine already
  keeps secret values out of its logs; the panel adds no new exposure. The
  stream is same-origin only (#274).

## Testing

- Shim unit tests (temp files): tailing appends and partial lines, roll-over,
  session switch on respawn, the replay buffer and `after`, stderr capture and
  pass-through, SSE framing and heartbeat, the #274 checks on the new route.
- GUI unit tests: dock tabs and persistence, the new action and shortcut, live
  append and the follow/pause behaviour, filters, the badge, loading history on
  scroll-up, reconnect with `after`.
- Playwright: the mock local API serves a scripted SSE stream; open the Logs
  tab, see lines arrive, filter by level.
- Linux verification of the GUI checks (prettier/organize-imports, Playwright
  screenshots) per CLAUDE.md.
- Before/after screenshots of the bottom dock on the PR.

## Out of scope

- Changing the engine's log level from the panel.
- Logs of anything other than the open project's engine (Electron main, the GUI
  console, other projects).
- Changes to the dashboard's existing session log viewer, beyond sharing code.

## Delivery

A feature: changelog entry under Enso IDE, and it waits for the user's test.
