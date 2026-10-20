# src/datalinks/

The **datalink editor** and the drive's "Create Datalink" dialog (#198). Vue;
the decisions behind it are under "Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`. Dormant: no UI
entry point opens them; their unit tests are the guard against rot.

- `JSONSchemaInput.vue` — an editor built from a JSON schema, recursively
  (`const`, `string` (the `enso-secret` format is `SecretPicker.vue`), `number`,
  `integer`, `boolean`, `object`, `$ref`, `anyOf`, `allOf`).
  `SchemaTextInput.vue` is its text and number fields; `variants.ts` their
  classes; `focusRing.ts` a keyboard-only focus ring (a text input matches
  `:focus-visible` on every focus, so it tracks the input modality instead).
- `SecretPicker.vue` — the `enso-secret` field: a dropdown of the local secrets
  (`$/providers/localSecrets`) and **New secret…**, which creates through the
  local backend and selects it. It emits `secret://<name>` and never reads a
  value. With no local backend, or read-only, it is disabled and shows the
  current path only. A path that is not a local secret (an old `enso://` one) is
  kept and shown as it is.
- `DatalinkInput.vue` — `JSONSchemaInput` over `$/utils/datalinkSchema.json`,
  validated by `$/utils/datalinkValidator`'s compiled validators. Its
  `UNAVAILABLE_SCHEMAS` (`EnsoFileDataLink`) is left out of the `anyOf` lists
  (`JSONSchemaInput`'s `unavailable` prop), so `Enso File` is not offered; an
  `Enso_File` file opens with its path as plain text. Schema and validator are
  unchanged.
- `DatalinkFormInput.vue` — the editor as a form field. The Properties tab is
  gone: the dialog is the only editor.
- `UpsertDatalinkModal.vue` — the dialog, for the modal stack (`useModals()`
  from the Vue drive). With the `existing` prop it is the edit mode ("Edit
  Datalink", Save): the name is read-only, since renaming is the drive's name
  cell's (it keeps `.datalink`).
- Tests: `__tests__/`.
