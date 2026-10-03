# src/cloud/

Code that only makes sense against the Enso Cloud, kept in one top-level folder
so that a build without the cloud can leave it out (decision 6b of
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`). Import via
`$/cloud/…`.

- Top level: framework-free logic — organization-invite email parsing
  (`parseUserEmails.ts`), the Cognito password rule (`validation.ts`),
  permission classes (`permissionsClasses.ts`).
- `serviceCredentials/` — the framework-free recipes behind the dashboard's
  service-credential forms (the React forms are in
  `src/dashboard/data/serviceCredentials/`).
- `<area>/` — Vue ports of cloud-only dashboard features, one folder per area
  (`billing/`, `organization/`, `versions/`, `auth/`, `credentials/`, …; see
  decision 6b). `credentials/` holds `UpsertSecretForm.vue` (#82), used by the
  project view's file browser to create a secret. From the top bar (#83):
  `billing/` (the trial indicator, "Upgrade", the user menu's "Upgrade Plan"),
  `organization/` (the user menu's organization switcher) and `versionChecker/`
  (the "new version available" dialog, mounted by `App.vue`).

## Rules

- Cloud code may import the core (`$/`, `@/`); the core should not import cloud
  code. The decision record plans an ESLint rule and contribution registries to
  enforce that; until they exist, a core file that must reach a cloud component
  imports it directly and says so (`UpsertSecretPanel.vue`, `UserBar.vue`,
  `UserMenu.vue` and `App.vue` do).
- Nothing here imports `#/` (the React dashboard).
- Component tests sit in `<area>/__tests__/`, with `mountWithProviders`. A
  side-by-side check against a React original lives in `src/dashboard/` (it
  imports `#/`), e.g.
  `dashboard/modals/__tests__/upsertSecretFormParity.test.tsx`.
