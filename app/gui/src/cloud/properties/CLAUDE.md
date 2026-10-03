# src/cloud/properties/

The right panel's **Properties** tab (#183): the selected cloud asset's path,
owner, dates, size, creator, sharing and labels, and the configuration of a
secret or a datalink. Vue, ported from the React
`AssetPanel/components/AssetProperties` ("Rulings from #183" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).

- `rightPanel.ts` — `registerPropertiesTab`, called by `registerCloud`:
  contributes the tab (`settings`) to `$/providers/rightPanelContributions`,
  loaded when it first opens.
- `AssetProperties.vue` — placeholders (outside the cloud, nothing selected),
  then `AssetPropertiesContent.vue`, keyed by asset in its own error boundary.
- `PermissionDisplay.vue`, `AssetLabel.vue` — the drive table's permission pill
  and label, as the tab shows them (never pressable). The drive keeps the React
  ones.
- `UpsertSecretForm.vue` (from `../credentials/`, #82) edits a secret's value.
- `DatalinkConfiguration.vue` and `DatalinkFormInput.vue` — the datalink's form,
  around the **React** editor (`reactDatalinkInput.ts`, `JSONSchemaInput`), the
  one bridge into `#/` from `src/cloud/`. Porting `JSONSchemaInput` (and
  `FilePathInput`) is #92's, with the drive's datalink dialog; then this bridge
  and its `DASHBOARD_IMPORT_ALLOWLIST` entry go.
- `SpotlightOverlay.vue` — the dimming overlay that "Edit" on a secret or a
  datalink (the asset context menu sets `spotlightOn`) opens around its section.
  It follows the section every frame (React measured it only on resize).
- `queries.ts` — the datalink and labels queries, with React's keys and options.
- Tests: `__tests__/AssetProperties.test.ts`, with the React editor stubbed.
