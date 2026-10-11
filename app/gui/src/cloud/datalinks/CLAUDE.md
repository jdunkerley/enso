# src/cloud/datalinks/

The **datalink editor** and the drive's "Create Datalink" dialog (#198). Vue;
the decisions behind it are under "Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.

- `JSONSchemaInput.vue` — an editor built from a JSON schema, recursively
  (`const`, `string` with the `enso-secret` and `enso-file` formats, `number`,
  `integer`, `boolean`, `object`, `$ref`, `anyOf`, `allOf`).
  `SchemaTextInput.vue` is its text and number fields; `variants.ts` their
  classes; `focusRing.ts` a keyboard-only focus ring (a text input matches
  `:focus-visible` on every focus, so it tracks the input modality instead).
- `FilePathInput.vue` — a cloud file path with the project view's
  `FileBrowserWidget.vue` under it, mounted directly.
- `DatalinkInput.vue` — `JSONSchemaInput` over `$/utils/datalinkSchema.json`,
  validated by `$/utils/datalinkValidator`'s compiled validators.
- `DatalinkFormInput.vue` — the editor as a form field; the Properties tab
  (`../properties/DatalinkConfiguration.vue`) uses it too.
- `UpsertDatalinkModal.vue` — the dialog, for the modal stack (`useModals()`
  from the Vue drive).
- Tests: `__tests__/`, with the file browser stubbed.
