# src/cloud/properties/

The right panel's **Properties** tab (#183): the selected cloud asset's path,
owner, dates, size, creator, sharing and labels, and the configuration of a
secret or a datalink. Vue; the decisions behind it are under "Rulings from #183"
in `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.

- `rightPanel.ts` — `registerPropertiesTab`, called by `registerCloud`:
  contributes the tab (`settings`) to `$/providers/rightPanelContributions`,
  loaded when it first opens.
- `AssetProperties.vue` — placeholders (outside the cloud, nothing selected),
  then `AssetPropertiesContent.vue`, keyed by asset in its own error boundary.
- `PermissionDisplay.vue`, `AssetLabel.vue` — the drive table's permission pill
  and label, as the tab shows them (never pressable). The drive's table uses
  `PermissionDisplay.vue` too; its pressable labels are its own `DriveLabel.vue`
  (#91, `#/components/labels/`).
- `UpsertSecretForm.vue` (from `../credentials/`, #82) edits a secret's value.
- `DatalinkConfiguration.vue` — the datalink's form, around the datalink editor
  (`../datalinks/DatalinkFormInput.vue`, shared with the drive's datalink
  dialog, #198).
- `SpotlightOverlay.vue` — the dimming overlay that "Edit" on a secret or a
  datalink (the asset context menu sets `spotlightOn`) opens around its section.
  It follows the section every frame, not only on resize, because the section
  moves as the right panel slides in.
- `queries.ts` — the datalink query, with the key and options
  `backendQueryOptions` gives it, so the cache, its persistence and
  `INVALIDATION_MAP` apply. The labels query, which the drive's labels popover
  shares, is `$/utils/labelsQuery.ts`.
- Tests: `__tests__/AssetProperties.test.ts`, with the datalink editor stubbed.
