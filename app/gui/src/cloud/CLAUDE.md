# src/cloud/

Code that only makes sense against the Enso Cloud, kept in one folder so that a
community build without the cloud can leave it out (decision 6b of
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`). Import via
`$/cloud/…`.

## Layout

- Top level: framework-free helpers (`validation.ts` with the Cognito password
  rule, `parseUserEmails.ts`, `permissionsClasses.ts`, `serviceCredentials/`).
  The React dashboard imports these while it is ported.
- `<area>/`: a ported cloud-only feature, Vue. So far:
  - `credentials/` — `UpsertSecretForm.vue` (#82), used by the project view's
    file browser to create a secret.
  - From the top bar (#83): `billing/` (the trial indicator, "Upgrade", the user
    menu's "Upgrade Plan"), `organization/` (the user menu's organization
    switcher) and `versionChecker/` (the "new version available" dialog, mounted
    by `App.vue`).
  - `auth/` — the sign-in (with the one-time-code step), sign-up (with the email
    confirmation step), email confirmation, forgot-password, reset-password and
    account-restoration pages, their layout (`AuthenticationPage.vue`), the
    password schemas and their routes (`routes.ts`). The logic they call is
    shared: `$/providers/session`, `$/providers/auth`, `$/authentication/`. Also
    the Account settings tab's two-factor authentication section
    (`SetupTwoFaForm.vue`, `TwoFaSetup.vue`).
  - `account/` — the Account settings tab's sections (`settingsSections.ts`: the
    profile and password forms as data, the 2FA section, the account's deletion
    and the profile picture), contributed by `registerAccountSettings`
    (`settings.ts`).
- `index.ts`: `registerCloud(router)`, the one entry point.

## Rules

- **The core never imports an area, nor `$/cloud` itself.** `entrypoint.ts`
  calls `registerCloud` before the router starts, and that is the only way in.
  An ESLint rule enforces it (`CLOUD_AREAS` in `eslint.config.mjs`; add a new
  area there). The React dashboard is exempt until it is ported. The areas from
  #82 and #83 predate the registries and are imported directly, with a note
  (`UpsertSecretPanel.vue`, `UserBar.vue`, `UserMenu.vue`, `App.vue`), so they
  are not in `CLOUD_AREAS` yet.
- Nothing here imports `#/` (the React dashboard).
- **An area contributes through registries**, not by being imported. Routes are
  the first: `registerCloud` adds them with `router.addRoute`, under a named
  parent where they need one (`PROTECTED_LAYOUT_ROUTE`, `$/router/routeNames`).
  Settings sections are the second: `contributeSettingsSections(tab, loader)`
  (`$/providers/settingsContributions`) appends sections, declared with the
  model in `$/configurations/settings`, to a settings tab; the loader keeps them
  out of the initial chunk, and the settings route waits for them. Their
  components read the page's context with `useSettingsContext`. Further
  registries (user-menu entries, right-panel tabs, asset context-menu entries,
  the paywall check) appear with the first port that needs each.
- Areas may import the core freely (`$/components`, `$/providers`, …).
- Pages load on demand (`() => import(…)` in the routes), so that the cloud adds
  nothing to the initial chunk.

## Tests

Component tests live in `<area>/__tests__/` and mount with `mountWithProviders`
(`$/utils/testing/`), mocking the global stores they use (`useSession`,
`useAuth`, `useBackends`) and the pieces not under test (the info bar, the modal
host). A side-by-side check against a React original lives in `src/dashboard/`
(it imports `#/`), e.g.
`dashboard/modals/__tests__/upsertSecretFormParity.test.tsx`.
