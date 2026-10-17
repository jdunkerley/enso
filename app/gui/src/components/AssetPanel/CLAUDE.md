# src/components/AssetPanel/

Right-panel tabs (#89). `RightPanel.vue` mounts them; it is shared code, so they
live here rather than in `src/dashboard/`. A tab reaches the panel through
`$/providers/rightPanelContributions`, never by import (#183). Versions and
Schedule are in `src/versions/`, registered by `src/registerCore.ts`.

- `ProjectSessions.vue` — the Activity tab: the sessions of
  `rightPanel.sessionsProject` (the project selected in the drive, or the one
  opened in a project tab, #176/#177), from that project's backend. The list
  (`ProjectSessionList.vue`) waits for its query in `setup`, inside a
  `SuspenseLoader`, and is remounted per project.
- Tests: `__tests__/ProjectSessions.test.ts`; the Playwright side is
  `integration-test/project-view/projectSessions.spec.ts`.
