# src/dashboard/components/labels/

The drive's **labels**, on both backends: the labels popover (#198) for
choosing, creating and deleting labels for the selected assets, and the label
pill. Vue; the decisions behind the popover are under "Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`. It moved here
from `src/cloud/labels/` when local projects gained labels (spec
`docs/superpowers/specs/2026-10-11-local-labels-and-recent-design.md`).

- `ManageLabelsModal.vue` — the popover, meant for the modal stack: the Vue
  drive opens it with `useModals()` (the row's context menu,
  `AssetContextMenu.vue`, and the labels column's edit button,
  `LabelsColumn.vue`), passing the element it is anchored to (`anchor`, through
  `Popover.vue`'s `PopoverAnchor`) and optionally where focus returns (`opener`:
  the context menu passes the row; by default focus returns to the element
  focused as it opened). Escape closes only the innermost popover and is stopped
  there, so that the dashboard's global Escape binding does not close every
  modal.
- `ManageLabelsForm.vue` — its content (loaded inside the popover's
  `SuspenseLoader`): the search, the label pills, the list, "Create Label" (a
  nested popover with `ColorPicker.vue`) and the delete confirmations
  (`ConfirmDeleteModal.vue` through `useModals().ask`).
- `NotFoundLabel.vue` — "Create <search>" when nothing matches.
- `DriveLabel.vue` — the pressable label pill: the labels column, the search
  bar's label chips and the `label:` suggestions.
- `labelChanges.ts` — which labels an asset gets when a state changes
  (framework-free, tested on its own).
- `labelSupport.ts` — `labellableItems`: the assets of a selection the backend
  can label.
- The labels query is `$/utils/labelsQuery.ts`' `labelsQueryOptions`, with the
  `listTags` key (outside the dashboard, since the cloud's Properties tab uses
  it too and nothing outside `src/dashboard/` imports `#/`); the mutations are
  `backendMutationOptions` (`@/composables/backend`).
- **Which assets can carry labels is the backend's call:**
  `Backend.supportsLabels(assetType)` (the cloud: every type; the local backend:
  projects only), and `supportsAnyLabels(backend)` for "any type". The gates
  that ask it: the labels column (`columnUtils.ts`' `getColumnList`, any type),
  its edit button (`LabelsColumn.vue`, the row's type), the context menu's
  "Label…" (`AssetContextMenu.vue`, the asset's type, not in Trash), and the
  search bar's label chips and the `listTags` queries (`AssetSearchBar.vue`,
  `AssetsTable.vue`, any type). The typed `label:` search term stays disabled on
  both backends. The Properties tab stays cloud-only.
- Locally, labels are stored by the project-manager shim (`localMetadata`, see
  `app/project-manager-shim/CLAUDE.md`): definitions in
  `<userData>/labels.json`, names in each project's `.enso/project.json`.
  Filtering by labels keeps the assets carrying **any** of them
  (`LocalBackend.listDirectory`, `doesAssetMatchQuery`); the cloud's rule is the
  server's and is not visible from this repository.
- Its behaviour was settled in #207 ("Rulings from #207"): the popover from the
  context menu opens under the row, "Next color" works, Enter in the search does
  nothing, the pills show the assets' labels, and each change builds on the
  labels the popover last wrote.
- Tests: `__tests__/`; the local flow end to end is
  `integration-test/dashboard/localLabels.spec.ts`.
