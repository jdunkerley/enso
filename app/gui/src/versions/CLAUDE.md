# src/versions/

The right panel's **Versions** tab (#89): a local project's git versions, with
their comments, and restore, duplicate and compare. Vue; core code (see
`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`), and its other
decisions are under "Rulings from #89" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
`src/registerCore.ts` registers the tab, loaded when it first opens.

- `AssetVersions.vue` — the tab: placeholders (no local backend, nothing
  selected, an asset which is not a project, a project whose versions are not
  kept), then `AssetVersionList.vue` in a `SuspenseLoader`, remounted per asset.
  In a project tab (the context has `openedProject` and no category) it lists
  the opened project's versions, fetching the project's asset with the local
  backend's `getAssetDetails` first (the list needs its title and parent).
- `AssetVersionList.vue` — the list, and the actions every version offers
  (restore, duplicate, comment edits with an optimistic update). Restoring a
  project that is open (or opening) closes it first, since the shim refuses to
  restore a running project, then opens it again in the background; a failed
  close restores nothing, and a failed restore still reopens it. From the
  project's own tab the tab stays current, and the sequence survives the list
  unmounting with the graph.
- Versions come from `LocalBackend`, over the shim's `versioning/*` routes:
  `AssetVersions.vue` gates the tab on `localVersioningStatusQueryOptions`
  (folders and files, no git, no repository and a repository that is not enabled
  each get a placeholder). A version is a git commit, so it has no tags
  ("Latest" stays).
- `AssetVersion.vue` — one version. Its tags ("Latest") collapse into "N tags"
  when they would not fit; that is measured on hidden copies of the title and
  one tag.
- `VersionComment.vue`, `VersionCommentButton.vue`, `VersionTag.vue` — the parts
  of a version.
- `VersionDialog.vue` — the full-screen comparison. It opens from its `trigger`
  slot ("See changes"), or on the modal stack with `open: true` ("Compare
  with").
- `AssetDiffView.vue` — the diff, on `@codemirror/merge`, styled after the
  Monaco diff editor it replaced. Loaded asynchronously, with the first
  comparison.
- `queries.ts` — query options built with the shared `backendQueryOptions`
  (#192), so the cache, its persistence and `INVALIDATION_MAP` apply.

## Notes

- Tests: `__tests__/AssetVersions.test.ts`. jsdom lacks `IntersectionObserver`
  (floating-ui) and `Range.getClientRects` (CodeMirror); the test stubs both,
  and gives the version header a width so the tags do not collapse.
- The tab is covered end to end by
  `integration-test/dashboard/localVersions.spec.ts`, against the mocked
  `versioning/*` routes (`integration-test/mock/versioning/historyRoutes.ts`).
- Follow-up (PR 6): the tab now serves the core (the local drive) too, so it
  should move out of `cloud/`.
