# src/components/AssetPanel/

Right-panel tabs that are not cloud-only, ported from the React
`#/layouts/AssetPanel/components/` (#89). `RightPanel.vue` mounts them; it is
shared code, so they live here rather than in `src/dashboard/`. Cloud-only tabs
go to `src/cloud/<area>/` (the Versions tab is `src/cloud/versions/`).

- `ProjectSessions.vue` — the Activity tab: the sessions of
  `rightPanel.sessionsProject` (the project selected in the drive, or the one
  opened in a project tab, #176/#177), from that project's backend. The list
  (`ProjectSessionList.vue`) waits for its query in `setup`, inside a
  `SuspenseLoader`, and is remounted per project.
- Tests: `__tests__/ProjectSessions.test.ts` (the port of the React
  `ProjectSessions.test.tsx`); the Playwright side is
  `integration-test/project-view/projectSessions.spec.ts`.
