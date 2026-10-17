# src/datalinks/

The **datalink editor** and the drive's "Create Datalink" dialog (#198). Vue;
the decisions behind it are under "Rulings from #198" in
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`. Dormant: no UI
entry point opens them; their unit tests are the guard against rot.

- `JSONSchemaInput.vue` — an editor built from a JSON schema, recursively
  (`const`, `string` with the `enso-secret` and `enso-file` formats, `number`,
  `integer`, `boolean`, `object`, `$ref`, `anyOf`, `allOf`).
  `SchemaTextInput.vue` is its text and number fields; `variants.ts` their
  classes; `focusRing.ts` a keyboard-only focus ring (a text input matches
  `:focus-visible` on every focus, so it tracks the input modality instead).
- `FilePathInput.vue` — a file path, typed or chosen with the system file dialog
  ("Browse…", desktop app only).
- `DatalinkInput.vue` — `JSONSchemaInput` over `$/utils/datalinkSchema.json`,
  validated by `$/utils/datalinkValidator`'s compiled validators.
- `DatalinkFormInput.vue` — the editor as a form field. Unused since the cloud's
  Properties tab was removed; kept for PR 2b's local datalinks.
- `UpsertDatalinkModal.vue` — the dialog, for the modal stack (`useModals()`
  from the Vue drive).
- Tests: `__tests__/`.
