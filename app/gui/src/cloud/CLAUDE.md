# src/cloud/

Code that only makes sense against the Enso Cloud, kept in one folder so that a
community build without the cloud can leave it out (decision 6b of
`docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`). Import via
`$/cloud/…`.

## Layout

- Top level: framework-free helpers (`validation.ts` with the Cognito password
  rule, `parseUserEmails.ts`, `permissionsClasses.ts`, `serviceCredentials/`,
  and `uploadToCloud.ts`, which packs local projects and uploads them to the
  cloud when assets move from a local category to a cloud one, #192). The React
  dashboard imports these while it is ported, and the core may import them.
- `<area>/`: a ported cloud-only feature, Vue. So far:
  - `credentials/` — `UpsertSecretForm.vue` (#82), used by the project view's
    file browser to create a secret, and the drive's secret dialog around it,
    `UpsertSecretModal.vue` (#92), which the React drive opens on the modal
    stack (`setVueModal`).
  - From the top bar (#83): `billing/` (the trial indicator, "Upgrade", the user
    menu's "Upgrade Plan"; since #192 also the plans' constants, `plans.ts`, and
    the subscription price query, `subscriptionPrice.ts`), `organization/` (the
    user menu's organization switcher) and `versionChecker/` (the "new version
    available" dialog, mounted by `App.vue`).
  - `organization/`, since #87: the Organization and Members settings tabs'
    sections (`settingsSections.ts`, contributed by
    `registerOrganizationSettings`), and since #191 the User groups tab's
    (`UserGroupsSettingsSection.vue`: the list, a group's members, and the "New
    User Group" and "Add Users" popovers) and the Activity log tab's
    (`ActivityLogSettingsSection.vue`, with `lambdaKinds.ts`); and the "Invite"
    dialog (`InviteUsersModal.vue`, with its form and success step), the one
    dialog every place that invites users shares: the Members tab, the user
    bar's `InviteUsersButton.vue`, and any app-level modal that needs it.
  - `billing/paywall/`, since #87: the Vue paywall pieces (`PaywallScreen`,
    `PaywallDialog`, `PaywallDialogButton`, `PaywallButton`, `PaywallAlert`,
    `PaywallLock`, `PaywallBulletPoints`, `PaywallUpgradeButton`), and the
    settings page's paywall screen, contributed by `registerBillingSettings`.
    The React originals left (`PaywallDialog`, `UpgradeButton`, `PaywallLock`,
    `PaywallBulletPoints`) stay for their React callers until #88.
  - `billing/`, since #191: the Usage settings tab's section
    (`UsageSettingsSection.vue`, with `executionUsage.ts`), contributed by
    `registerBillingSettings`.
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
    (`settings.ts`); since #191 also the API keys tab's
    (`ApiKeysSettingsSection.vue`, the "New API Key" popover and the dialog
    showing a new key's secret).
  - `versions/` — the right panel's Versions tab (#89) and Schedule tab
    (executions calendar, #183), contributed by `registerVersionsTabs`
    (`rightPanel.ts`).
  - `properties/` — the right panel's Properties tab (#183), with the secret and
    datalink configuration, contributed by `registerPropertiesTab`.
  - From the layouts (#84): `agreements/` (the Terms of Service and Privacy
    Policy gate: `AgreementsModal.vue` and the agreement state,
    `userAgreements.ts`, which the sign-up page uses too; contributed by
    `agreements.ts`), `organization/` (`SetupOrganizationModal.vue`,
    `AcceptInvitationModal.vue`), `billing/` (`TrialEndedModal.vue`,
    `PlanDowngradedModal.vue` and their `downgradeModalState.ts`) and
    `browserDisabled/` (the page shown when running projects in the browser is
    disabled, and its route).
  - `devtools/` (#172): the Enso devtools (the floating Enso button and its
    panel: plan override, version checker, feature flags, paywall toggles, local
    storage editor) and the list of active overrides, contributed with
    `contributeDevtools` in development builds only (`registerCloud` checks
    `process.env.NODE_ENV`, so a production build carries none of it).
- `index.ts`: `registerCloud(router)`, the one entry point.

## Rules

- **The core never imports an area, nor `$/cloud` itself.** `entrypoint.ts`
  calls `registerCloud` before the router starts, and that is the only way in.
  An ESLint rule enforces it (`CLOUD_AREAS` in `eslint.config.mjs`; add a new
  area there). The React dashboard (all of `src/dashboard/`) is exempt until it
  is ported. The areas from #82 and #83 predate the registries and are imported
  directly, with a note (`UpsertSecretPanel.vue`, `UserBar.vue`, `UserMenu.vue`,
  `App.vue`); `billing` and `organization` joined `CLOUD_AREAS` with #87, since
  their only direct importers are in the exempt dashboard.
- Nothing here imports `#/` (the React dashboard), with one exception until #92:
  `properties/reactDatalinkInput.ts` mounts the React datalink editor
  (`JSONSchemaInput`) through the bridge, and it is on
  `DASHBOARD_IMPORT_ALLOWLIST`.
- **An area contributes through registries**, not by being imported. Routes are
  the first: `registerCloud` adds them with `router.addRoute`, under a named
  parent where they need one (`PROTECTED_LAYOUT_ROUTE`, `$/router/routeNames`).
  Settings sections are the second: `contributeSettingsSections(tab, loader)`
  (`$/providers/settingsContributions`) appends sections, declared with the
  model in `$/configurations/settings`, to a settings tab; the loader keeps them
  out of the initial chunk, and the settings route waits for them. Their
  components read the page's context with `useSettingsContext`. A tab the core
  declares without sections of its own (Organization, Members) is listed only
  once something is contributed to it (Organization, Members, User groups,
  Activity log, API keys, Usage). `contributeSettingsPaywall(loader)` is the
  third: the screen shown in place of a tab locked behind a feature. Right-panel
  tabs are the fourth: `contributeRightPanelTab(tab, loader)`
  (`$/providers/rightPanelContributions`) gives the Properties (`settings`),
  Versions and Schedule (`executionsCalendar`) tabs their content; the tabs
  themselves (icon, title, enabling, the scheduler's paywall) stay in
  `$/providers/rightPanel`, which hides one that nothing contributed. The
  layouts' modals are the fifth (`$/providers/layoutContributions`, #84):
  `contributeAgreementsGate` gives `ProtectedLayout.vue` its agreements gate,
  and `contributeAppContainerModals` gives `AppContainerLayout.vue` its four
  modals. The layouts still decide when each shows; their data loaders await the
  loaders, so a modal never appears late. Without a contribution nothing shows,
  so a build without the cloud asks for no agreement. Further registries
  (user-menu entries, asset context-menu entries, the paywall check) appear with
  the first port that needs each.
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
