# src/secrets/

Secrets and service credentials. Vue. The secret dialogs are live for local
secrets: `UpsertSecretModal.vue` creates one from Settings → Secrets, the
datalink editor's picker (`$/datalinks/SecretPicker.vue`) and the graph editor's
`Enso_Secret` dropdown (`WidgetFileBrowser/localSecrets.ts`) and the Drive bar's
New secret button (`DriveBarToolbar.vue`, which shows `NewSecretToast.vue`: the
new `secret://` path with a Copy button), all through
`$/providers/localSecrets`. Still dormant: the service-credential forms
(`CreateCredentialModal.vue` and `serviceCredentials/`, which need OAuth, see
below) and `UpsertSecretPanel.vue` (the cloud file browser's "New Secret"
panel); no UI entry point opens them, and their unit tests are the guard against
rot.

- `UpsertSecretForm.vue` (#82) — creating or updating a secret; the project
  view's file browser (`UpsertSecretPanel.vue`) uses it.
- `UpsertSecretModal.vue` (#92) — the secret dialog around it, opened with
  `useModals().open`.
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

## Before enabling the credential forms

Three things are missing, and each would fail only at run time:

- **A real OAuth redirect source.** `getOauthRedirectUri`
  (`serviceCredentials/utilities.ts`) asserts with `invariant` that an API URL
  is defined, and every recipe passes it one. `ENSO_IDE_API_URL` is gone with
  Enso Cloud, so today it always throws. Enabling the credential forms needs a
  genuine redirect URI source (and a callback endpoint behind it) to replace it.
- **A submit path that is tested.** `CreateCredentialModal.test.ts` stubs
  `getOauthRedirectUri`, so the forms' submit path is never exercised against
  the real function.
- **A `catch` on the Google form.** `submit()` in `GoogleCredentialsForm.vue`
  does not catch a rejection from the recipe, so the invariant above would
  surface as an unhandled error rather than a toast. Add one, as the Strava,
  MS365, Salesforce and Snowflake forms have (`toastAndLogError`, see
  `toastAndLog.ts`), before enabling it.
