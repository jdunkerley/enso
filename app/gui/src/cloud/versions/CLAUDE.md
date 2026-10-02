# src/cloud/versions/

The right panel's **Versions** tab (#89): an asset's versions in the Enso Cloud,
with their tags and comments, and restore, duplicate and compare. Vue, ported
from the React `AssetPanel/components/AssetVersions` (decision 6b of
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`; "Rulings from
#89" there).

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

## Notes

- `RightPanel.vue` imports `AssetVersions.vue` directly. Once the cloud registry
  (`src/cloud/index.ts`, #179) lands, the tab should be contributed from there,
  and `versions` added to `CLOUD_AREAS` in `eslint.config.mjs` (#183, which also
  ports the Schedule tab here).
- Tests: `__tests__/AssetVersions.test.ts`. jsdom lacks `IntersectionObserver`
  (floating-ui) and `Range.getClientRects` (CodeMirror); the test stubs both,
  and gives the version header a width so the tags do not collapse.
- The mocked cloud API (`integration-test/mock/cloudApi.ts`) has no versions
  endpoints, so no Playwright spec covers this tab.
