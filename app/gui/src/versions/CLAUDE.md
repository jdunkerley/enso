# src/versions/

The right panel's **Versions** tab (#89): an asset's versions in the Enso Cloud,
or a local project's git versions, with their tags and comments, and restore,
duplicate and compare; and its **Schedule** tab (#183): a project's scheduled
executions. Vue; core code (see
`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`), and its other
decisions are under "Rulings from #89" and "Rulings from #183" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
`src/registerCore.ts` registers the Versions tab, loaded when it first opens.

- `AssetVersions.vue` — the tab: placeholders (outside the cloud, nothing
  selected, an asset without versions), then `AssetVersionList.vue` in a
  `SuspenseLoader`, remounted per asset. In a project tab (the context has
  `openedProject` and no category) it lists the opened project's versions: the
  local backend's for a local project, the cloud's (by `id`) for a cloud or
  hybrid one, fetching the project's asset with `getAssetDetails` first.
- `AssetVersionList.vue` — the list, and the actions every version offers
  (restore, duplicate, comment edits with an optimistic update). Restoring a
  local project that is open (or opening) closes it first, since the shim
  refuses to restore a running project, then opens it again in the background; a
  failed close restores nothing, and a failed restore still reopens it. From the
  project's own tab the tab stays current, and the sequence survives the list
  unmounting with the graph.
- Local projects (`LocalBackend`, over the shim's `versioning/*` routes):
  `AssetVersions.vue` gates the tab on `localVersioningStatusQueryOptions`
  (folders and files, no git, no repository and a repository that is not enabled
  each get a placeholder); `AssetVersion.vue`'s `hasTags` hides tags, since a
  local version is a git commit and git tags are repository-wide ("Latest"
  stays); `AssetVersionList.vue`'s `restoreVersion` closes, restores and reopens
  an open project.
- `AssetVersion.vue` — one version. Its tags collapse into "N tags" when they
  would not fit; that is measured on hidden copies of the title and one tag.
- `VersionComment.vue`, `VersionCommentButton.vue`, `VersionTag.vue`,
  `AddVersionTag.vue` — the parts of a version.
- `VersionDialog.vue` — the full-screen comparison. It opens from its `trigger`
  slot ("See changes"), or on the modal stack with `open: true` ("Compare
  with").
- `AssetDiffView.vue` — the diff, on `@codemirror/merge`, styled after the
  Monaco diff editor it replaced. Loaded asynchronously, with the first
  comparison.
- `queries.ts` — query options built with the shared `backendQueryOptions`
  (#192), so the cache, its persistence and `INVALIDATION_MAP` apply, and the
  optimistic tag updates.
- `ProjectExecutionsCalendar.vue` — the Schedule tab: placeholders (outside the
  cloud, nothing selected, not a project), then
  `ProjectExecutionsCalendarContent.vue`, not keyed by project, so the chosen
  day stays when the selection changes. The tab is enabled only on plans with
  the scheduler; that check is `$/providers/rightPanel`'s.
- `ProjectExecutionsCalendarContent.vue` — Reka's `Calendar`, named and
  structured for assistive technology (an "application" named by the month, a
  grid of day buttons named by their date), with an empty header row, other
  months' days disabled and a loader over the whole tab while a month loads; the
  "New Schedule" dialog, and the chosen day's executions
  (`ProjectExecution.vue`, delete through the modal stack's `ask`).
- `NewProjectExecutionForm.vue` — the new-execution form; its schema,
  `usePreferredTimeZone`, `useGetOrdinal` and the executions query are in
  `schedule.ts`.

## Notes

- Tests: `__tests__/AssetVersions.test.ts`. jsdom lacks `IntersectionObserver`
  (floating-ui) and `Range.getClientRects` (CodeMirror); the test stubs both,
  and gives the version header a width so the tags do not collapse.
- `__tests__/ProjectExecutionsCalendar.test.ts` covers the Schedule tab. It
  registers the `preferredTimeZone` local-storage key, which `App.vue` registers
  in the app.
- The local Versions tab is covered by
  `integration-test/dashboard/localVersions.spec.ts`, against the mocked
  `versioning/*` routes (`integration-test/mock/versioning/historyRoutes.ts`).
- Follow-up (PR 6): the tab now serves the core (the local drive) too, so it
  should move out of `cloud/`.
