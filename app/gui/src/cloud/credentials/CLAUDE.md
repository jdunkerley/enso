# src/cloud/credentials/

Secrets and service credentials, which exist only in the Enso Cloud. Vue.

- `UpsertSecretForm.vue` (#82) — creating or updating a secret; the project
  view's file browser (`UpsertSecretPanel.vue`) and the Properties tab use it.
- `UpsertSecretModal.vue` (#92) — the drive's secret dialog around it.
- `CreateCredentialModal.vue` (#198) — the "New Credential" dialog: a list of
  the services (`credentialInfos.ts`, in React's order) and the chosen one's
  form: `SnowflakeCredentialsForm.vue`, `GoogleCredentialsForm.vue`,
  `StravaCredentialsForm.vue`, `MS365CredentialsForm.vue`,
  `SalesforceCredentialsForm.vue`, each ending with `CredentialsFormFooter.vue`.
  Each form calls its framework-free recipe in `../serviceCredentials/`; a new
  service needs a recipe, a form and an entry in `credentialInfos.ts`.
- `toastAndLog.ts` — React's `toastAndLog(null, error)`, for the forms that
  report a failure as a toast.
- The dialogs are meant for the modal stack: the React drive opens them with
  `setVueModal` or `useVueModalTrigger`.
- Tests: `__tests__/`.
