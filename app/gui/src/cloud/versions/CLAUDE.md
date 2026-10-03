# src/cloud/versions/

The right panel's **Versions** tab (#89): an asset's versions in the Enso Cloud,
with their tags and comments, and restore, duplicate and compare; and its
**Schedule** tab (#183): a project's scheduled executions. Vue, ported from the
React `AssetPanel/components/` (decision 6b of
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`; "Rulings from
#89" and "Rulings from #183" there). `rightPanel.ts` contributes both tabs
(`registerVersionsTabs`, called by `registerCloud`), each loaded when it first
opens.

- `AssetVersions.vue` — the tab: placeholders (outside the cloud, nothing
  selected, an asset without versions), then `AssetVersionList.vue` in a
  `SuspenseLoader`, remounted per asset.
- `AssetVersionList.vue` — the list, and the actions every version offers
  (restore, duplicate, comment edits with an optimistic update).
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
- `queries.ts` — query options with React's keys and options, and the optimistic
  tag updates.
- `ProjectExecutionsCalendar.vue` — the Schedule tab: placeholders (outside the
  cloud, nothing selected, not a project), then
  `ProjectExecutionsCalendarContent.vue`, not keyed by project (React's was not:
  the chosen day stays). The tab is enabled only on plans with the scheduler;
  that check is `$/providers/rightPanel`'s.
- `ProjectExecutionsCalendarContent.vue` — Reka's `Calendar`, named and laid out
  as react-aria's was (empty header row, other months' days disabled, a loader
  over the whole tab while a month loads), the "New Schedule" dialog, and the
  chosen day's executions (`ProjectExecution.vue`, delete through the modal
  stack's `ask`).
- `NewProjectExecutionForm.vue` — the new-execution form; its schema,
  `usePreferredTimeZone`, `useGetOrdinal` and the executions query are in
  `schedule.ts`.

## Notes

- Tests: `__tests__/AssetVersions.test.ts`. jsdom lacks `IntersectionObserver`
  (floating-ui) and `Range.getClientRects` (CodeMirror); the test stubs both,
  and gives the version header a width so the tags do not collapse.
- `__tests__/ProjectExecutionsCalendar.test.ts` covers the Schedule tab. It
  registers the `preferredTimeZone` local-storage key, which the React `App.tsx`
  registers in the app.
- The mocked cloud API (`integration-test/mock/cloudApi.ts`) has no versions or
  executions endpoints, so no Playwright spec covers these tabs.
