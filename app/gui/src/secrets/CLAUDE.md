# src/secrets/

Secrets and service credentials. Vue. Dormant until there are local secrets
(decision 5 of the local-only programme): no UI entry point opens them; their
unit tests are the guard against rot. `UpsertSecretPanel.vue` (the file
browser's "New Secret" panel) and `serviceCredentials/` (the recipes) live here
too.

- `UpsertSecretForm.vue` (#82) — creating or updating a secret; the project
  view's file browser (`UpsertSecretPanel.vue`) uses it.
- `UpsertSecretModal.vue` (#92) — the drive's secret dialog around it.
- `CreateCredentialModal.vue` (#198) — the "New Credential" dialog: a list of
  the services (`credentialInfos.ts`, in display order) and the chosen one's
  form: `SnowflakeCredentialsForm.vue`, `GoogleCredentialsForm.vue`,
  `StravaCredentialsForm.vue`, `MS365CredentialsForm.vue`,
  `SalesforceCredentialsForm.vue`, each ending with `CredentialsFormFooter.vue`.
  Each form calls its framework-free recipe in `./serviceCredentials/`; a new
  service needs a recipe, a form and an entry in `credentialInfos.ts`.
- `toastAndLog.ts` — `toastAndLogError(error)`: shows the error's message as an
  error toast and logs it, for the forms that report a failure as a toast.
- The dialogs are meant for the modal stack: the Vue drive opens them with
  `useModals().open`.
- Tests: `__tests__/`.

## Before enabling these screens

Three things are missing, and each would fail only at run time:

- **A real OAuth redirect source.** `getOauthRedirectUri`
  (`serviceCredentials/utilities.ts`) asserts with `invariant` that an API URL
  is defined, and every recipe passes it one. `ENSO_IDE_API_URL` is gone with
  Enso Cloud, so today it always throws. Enabling the credential forms needs a
  genuine redirect URI source (and a callback endpoint behind it) to replace it.
- **A submit path that is tested.** `CreateCredentialModal.test.ts` stubs
  `getOauthRedirectUri`, so the forms' submit path is never exercised against
  the real function.
- **A `catch` on the Google and Strava forms.** Their `submit()` functions
  (`GoogleCredentialsForm.vue`, `StravaCredentialsForm.vue`) do not catch a
  rejection from the recipe, so the invariant above would surface as an
  unhandled error rather than a toast. Add one (see `toastAndLog.ts`) before
  enabling them.
