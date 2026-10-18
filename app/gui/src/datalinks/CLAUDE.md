# src/datalinks/

The **datalink editor** and the drive's "Create Datalink" dialog (#198). Vue;
the decisions behind it are under "Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`. Dormant: no UI
entry point opens them; their unit tests are the guard against rot.

- `JSONSchemaInput.vue` — an editor built from a JSON schema, recursively
  (`const`, `string` (the `enso-secret` format is shown read-only: no local
  secrets), `number`, `integer`, `boolean`, `object`, `$ref`, `anyOf`, `allOf`).
  `SchemaTextInput.vue` is its text and number fields; `variants.ts` their
  classes; `focusRing.ts` a keyboard-only focus ring (a text input matches
  `:focus-visible` on every focus, so it tracks the input modality instead).
- `DatalinkInput.vue` — `JSONSchemaInput` over `$/utils/datalinkSchema.json`,
  validated by `$/utils/datalinkValidator`'s compiled validators. Its
  `UNAVAILABLE_SCHEMAS` (`EnsoSecret`, `EnsoFileDataLink`) are left out of the
  `anyOf` lists (`JSONSchemaInput`'s `unavailable` prop), so a secure value is
  plain text, with a note, and `Enso File` is not offered. A file that already
  holds a secret reference keeps it (read-only); an `Enso_File` file opens with
  its path as plain text. Schema and validator are unchanged.
- `DatalinkFormInput.vue` — the editor as a form field. The Properties tab is
  gone: the dialog is the only editor.
- `UpsertDatalinkModal.vue` — the dialog, for the modal stack (`useModals()`
  from the Vue drive). With the `existing` prop it is the edit mode ("Edit
  Datalink", Save): the name is read-only, since renaming is the drive's name
  cell's (it keeps `.datalink`).
- Tests: `__tests__/`.
