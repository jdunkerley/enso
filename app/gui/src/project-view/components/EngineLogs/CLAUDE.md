# src/project-view/components/EngineLogs/

The Logs tab of the project view's bottom dock: the open project's engine log,
live, with its earlier lines and sessions. The design is in
`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`; the shim side
is described in `app/project-manager-shim/CLAUDE.md` ("Engine logs").

- `engineLogModel.ts` — framework-free rows built from the stream's events.
  - Level rules: stderr is ERROR; a line that starts no entry takes its entry's
    level.
  - Dividers: `restarted` at a new engine's `waiting` (not at `session`, which
    also fires for the first session), `skipped` after a gap or on a new
    channel, `truncated` above capped lines.
  - The 20,000-row cap, `prependHistory` (a session's history spliced above the
    first live file line), `filterRows` and `rowsFromLines`.
- `engineLogStream.ts` — `useEngineLogStream`:
  - one `EventSource` on `/api/engine-logs/stream`, connected only while the
    project tab is active (HTTP/1.1 allows six connections per origin);
  - reconnects with backoff and `channel` + `after`;
  - `end` with reason `closed` is terminal until the project or `active`
    changes; `not-open` retries with backoff (the project may still be opening);
  - events are batched into one update per animation frame.
- `engineLogHistory.ts` — `fetchSessionLines`: a whole session through the
  existing session-log query (no history API of its own).
- `EngineLogPanel.vue` — the tab's content:
  - level, text and session filters;
  - "Show in folder" (Electron only; it reveals the current session's file,
    whose folder holds every session);
  - the waiting and ended notices, and Jump to latest;
  - an earlier session read whole and read-only (`rowsFromLines`);
  - history requests pass `{ project, sessionId }` to `loadHistory`, which drops
    a result whose project or session has moved on.
- `EngineLogList.vue` + `engineLogView.ts` — a virtualised list (`role="log"`)
  with 18 px rows. It follows the newest row until the user scrolls up, keeps
  its place when rows are added above or dropped, and emits `reachedTop` (on a
  scroll, or a wheel at the top) to load history.

## The dock and the shortcut

- The Logs panel lives in the bottom dock beside the Code editor
  (`../BottomPanel.vue`). Both tabs stay mounted and are switched with `v-show`,
  so the code editor keeps its cursor and undo history and the log keeps its
  scroll position and filters; only closing the dock unmounts them.
- The code editor takes focus when the dock opens on Code (it mounts) and when
  the user picks the Code tab while Logs shows (`useCodeTabFocus` in
  `../BottomPanel/dockTab.ts`). Never on merely becoming visible: a kept-alive
  project tab re-activated or a resize would take the keyboard from the graph.
- The stream is owned by `GraphEditor.vue`, not the panel, so the Logs tab's
  error badge counts while the dock is closed. `markSeen()` runs while the dock
  is open on the Logs tab.
- `graph.toggleLogs` is `Mod+L`. The graph's key handler is a capture-phase
  window listener, so it runs before CodeMirror and works with the code editor
  focused (as `Mod+D` does). Our CodeMirror keymap (`util/codemirror/keymap.ts`)
  does not include CodeMirror's default keymap, so nothing binds `Mod-l`
  (`selectLine`) there and the shortcut cannot double-fire. If a binding for
  `Mod-l` is ever added to that keymap, CodeMirror must keep it inside the
  editor and the graph handler must be told to skip it, or both would run.
- The dock's tabs are `@/components/BottomPanel/` (`dockTab.ts`,
  `BottomPanelTabs.vue`); `GraphEditor.vue` creates the stream and passes it to
  `EngineLogPanel`.
- Playwright: `integration-test/project-view/engineLogs.spec.ts`, against the
  mock stream in `mock/localApi.ts`.
