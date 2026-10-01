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
  - `auth/` — the sign-in (with the one-time-code step), sign-up (with the email
    confirmation step), email confirmation, forgot-password, reset-password and
    account-restoration pages, their layout (`AuthenticationPage.vue`), the
    password schemas and their routes (`routes.ts`). The logic they call is
    shared: `$/providers/session`, `$/providers/auth`, `$/authentication/`.
- `index.ts`: `registerCloud(router)`, the one entry point.

## Rules

- **The core never imports an area, nor `$/cloud` itself.** `entrypoint.ts`
  calls `registerCloud` before the router starts, and that is the only way in.
  An ESLint rule enforces it (`CLOUD_AREAS` in `eslint.config.mjs`; add a new
  area there). The React dashboard is exempt until it is ported.
- **An area contributes through registries**, not by being imported. Routes are
  the first: `registerCloud` adds them with `router.addRoute`, under a named
  parent where they need one (`PROTECTED_LAYOUT_ROUTE`, `$/router/routeNames`).
  Further registries (settings tabs, user-menu entries, right-panel tabs, asset
  context-menu entries, the paywall check) appear with the first port that needs
  each.
- Areas may import the core freely (`$/components`, `$/providers`, …).
- Pages load on demand (`() => import(…)` in the routes), so that the cloud adds
  nothing to the initial chunk.

## Tests

Component tests live in `<area>/__tests__/` and mount with `mountWithProviders`
(`$/utils/testing/`), mocking the global stores they use (`useSession`,
`useAuth`, `useBackends`) and the React pieces still mounted through
`reactComponent` (the info bar).
