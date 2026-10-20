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
