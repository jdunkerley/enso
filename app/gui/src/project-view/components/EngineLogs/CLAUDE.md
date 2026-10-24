# src/project-view/components/EngineLogs/

The engine log viewer: the Logs tab of the project view's bottom dock (the open
project's engine log, live, with its earlier lines and sessions), and the app's
session log tab, opened from Activity → Show Logs
(`$/components/SessionLogTab.vue`, route `projectLog/:id/:title/:projectId?`),
which shows one session read from its files without a live stream. It replaced
the dashboard's AG Grid session viewer (`components/ProjectLog*`), whose column
sorting and one-row multi-line entries were dropped on purpose. The design is in
`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`; the shim side
is described in `app/project-manager-shim/CLAUDE.md` ("Engine logs").

- `logEntry.ts` — `parseEntry` and `LOG_LEVELS`: the start of an entry,
  `[LEVEL] [time] [logger] message`.
- `engineLogModel.ts` — framework-free rows built from the stream's events.
  - Level rules: stderr is ERROR; a line that starts no entry takes its entry's
    level.
  - Origin (the source tickboxes, #285): `logOrigin` classifies an entry's
    logger name, by whole name segments, as `user` (under `User`: Enso's
    `log_message` logs under `User.<qualified type name>`; the libraries use
    `log_internal`, under the type name alone), `sql` (exactly
    `Standard.Database.Connection`, the local audited connections' queries),
    `performance` (`Standard.Base.Logging.Progress` and its children,
    `Progress.run`'s timings), `engine` (`ENGINE_LOGGER_ROOTS`: `org.enso`, the
    Truffle language and instrument ids that Truffle prefixes to its loggers'
    names, `akka`, `org.graalvm`, …) or `library` (everything else, on purpose).
    The std-bits package roots (`STD_BITS_PACKAGE_ROOTS`) are libraries though
    under `org.enso`; `__tests__/logOrigin.test.ts` reads
    `std-bits/*/src/main/java/org/enso/*` and fails when one is missing. stderr
    is the engine's; a continuation line takes its entry's origin.
  - Logger: each line carries its entry's logger (`null` for stderr). The logger
    filter (`RowFilter.logger`, `loggerMatches`) keeps the lines under a dotted
    prefix by whole segments (a prefix ending in `.` by text);
    `loggerSuggestions` offers the loggers seen and their prefixes.
  - The error badge (`unseenErrors`) counts ERROR entries of the log file,
    whatever their origin and the filters; stderr lines are not counted.
  - Dividers: `restarted` at a new engine's `waiting` (not at `session`, which
    also fires for the first session), `skipped` after a gap or on a new
    channel, `truncated` above capped or windowed lines and `newer` below a
    window paged back; the list gives those two a Load older / Load newer lines
    button.
  - The 20,000-row cap, `prependHistory` (a session's history spliced above the
    first live file line), `filterRows` and `rowsFromLines`.
- `engineLogStream.ts` — `useEngineLogStream`:
  - one `EventSource` on `/api/engine-logs/stream`, connected only while the
    project tab is active (HTTP/1.1 allows six connections per origin);
  - reconnects with backoff and `channel` + `after`;
  - `end` with reason `closed` is terminal until the project or `active`
    changes; `not-open` retries with backoff (the project may still be opening);
  - events are batched into one update per animation frame.
- `sessionLogWindow.ts` — `SessionLogWindow`: a bounded window onto a session. A
  session is pages (`listProjectSessionPages`: its archives, then `active`),
  each read whole by `getProjectSessionLogs`. The window reads from the newest
  page backwards and keeps at most 20,000 lines (`LIVE_ROW_CAP`, what the live
  view holds); older/newer move it by half a window and drop as many lines from
  the other end, so memory stays at one window plus one cached page however long
  the session. `firstLine` numbers its lines so row keys survive a move and the
  list keeps its place. `fetchNewestSessionLines` is the live view's history:
  the newest lines only, never the whole session.
- `EngineLogPanel.vue` — the tab's content:
  - level (Error, Warn and above, All levels: the file holds nothing below INFO
    unless a logger was turned up, and the timings are DEBUG), source (Engine,
    off by default; Libraries; User log messages; SQL queries and Performance,
    shown only while their setting in Settings → Local → Engine logs is on,
    checked whenever they appear — an origin without a box is not filtered out),
    text and session filters;
  - at the toolbar's right, icon buttons for the log file of the session shown
    (live or earlier): Download log file (`downloadProjectSessionLogs`, the
    whole session, archives included; a failure is shown as an alert) and reveal
    it, named as the OS names its file manager (Reveal in Explorer, Show in
    Finder, Show in folder) and shown only in Electron
    (`window.api.system.showItemInFolder`). The live session's file is the
    stream's `logFile`, an earlier one's is `ProjectSession.logFile` from the
    session listing. Each is disabled while its session has no id or file;
  - the waiting and ended notices, and Jump to latest;
  - an earlier session, read-only, through a `SessionLogWindow`; Load older
    lines on the live view's `truncated` divider pages back the same way through
    the live session's file ("Showing earlier lines… Back to live");
  - Reload (only off the live view, which is current anyway) reads the window's
    session again from its newest lines;
  - a logger filter (a search box with a `datalist` of the loggers seen);
  - without a `stream` (the session log tab): no live view; the picker lists the
    project's sessions (`projectId`), or the asked-for session alone for a tab
    saved before tabs had a project;
  - history requests pass `{ project, sessionId }` to `loadHistory`, which drops
    a result whose project or session has moved on.
- `EngineLogList.vue` + `engineLogView.ts` — a virtualised list (`role="log"`)
  with 18 px rows. It follows the newest row until the user scrolls up, keeps
  its place when rows are added above or dropped (anchored on a line, not a
  divider), emits `reachedTop` (on a scroll, or a wheel at the top) to load
  history, and `loadOlder`/`loadNewer` from its dividers' buttons.

## The dock and the shortcut

- The Logs panel lives in the bottom dock beside the Code editor
  (`../BottomPanel.vue`). Both tabs stay mounted and are switched with `v-show`,
  so the code editor keeps its cursor and undo history and the log keeps its
  scroll position and filters; only closing the dock unmounts them.
- The code editor takes focus when the dock opens on Code (it mounts) and when
  the user switches the open dock from Logs to Code, by the tab or by
  `` Mod+` `` (`useCodeTabFocus` in `../BottomPanel/dockTab.ts`, provided by
  `GraphEditor.vue`). Never on merely becoming visible: a kept-alive project tab
  re-activated or a resize would take the keyboard from the graph. The editor
  focuses on the `nextTick` after the request: a `post` watcher alone runs
  before `v-show` has shown the panel, and a hidden element cannot take focus.
- The stream is owned by `GraphEditor.vue`, not the panel, so the Logs tab's
  error badge counts while the dock is closed. `markSeen()` runs while the dock
  is open on the Logs tab.
- `graph.toggleLogs` is `Mod+L`: it opens the closed dock on Logs, switches the
  open dock to Logs, or closes the dock while Logs shows (`` Mod+` `` does the
  same for Code). While the dock is closed, the Logs button in the graph's
  gutter shows a dot for unseen errors, from the same count as the tab's badge.
  The dot is `aria-hidden`; the count is in the button's name. A collapsed
  button moves the keyboard to the tab it opened, and closing the dock while the
  keyboard is in it returns the keyboard to the matching collapsed button. The
  graph's key handler is a capture-phase window listener, so it runs before
  CodeMirror and works with the code editor focused (as `Mod+D` does). Our
  CodeMirror keymap (`util/codemirror/keymap.ts`) does not include CodeMirror's
  default keymap, so nothing binds `Mod-l` (`selectLine`) there and the shortcut
  cannot double-fire. If a binding for `Mod-l` is ever added to that keymap,
  CodeMirror must keep it inside the editor and the graph handler must be told
  to skip it, or both would run.
- The dock's tabs are `@/components/BottomPanel/` (`dockTab.ts`,
  `BottomPanelTabs.vue`); `GraphEditor.vue` creates the stream and passes it to
  `EngineLogPanel`.
- Playwright: `integration-test/project-view/engineLogs.spec.ts`, against the
  mock stream in `mock/localApi.ts`.
