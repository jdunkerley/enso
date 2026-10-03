# dashboard/layouts/Settings/

The settings page (`SettingsPage.vue`, mounted by the `settings` route): a
sidebar of tabs, a search field, and the current tab, kept in the `SettingsTab`
query parameter (`?cloud-ide_SettingsTab="keyboard-shortcuts"`).

## Two frameworks, one model

The page is Vue. Its tabs are declared, not hand-built: tabs hold sections, and
sections hold entries (a form of text fields, or a component). The model, the
context entries receive, and the search over tabs, sections and entries are in
`$/configurations/settings.ts`, framework-free, so that one search spans every
tab.

- **Vue tabs** (`tabs.ts`): Account, Organization, Local, Members, Appearance,
  Keyboard shortcuts. `SettingsTab.vue` lays out their sections; a form entry is
  `SettingsFormEntry.vue`, a component entry reads the page's context with
  `useSettingsContext` (`$/providers/settingsContext`).
- **Organization and Members are the cloud's (#87).** The core declares the two
  tabs (name, icon, visibility, Members' `inviteUser` paywall feature) with no
  sections; `$/cloud/organization/` contributes them. A Vue tab with no sections
  is not listed, so a build without the cloud shows neither. While a tab's
  `feature` is under the paywall, the page shows the paywall screen the cloud
  contributes (`contributeSettingsPaywall`, from `$/cloud/billing/`) instead of
  the tab's sections.
- **The Account tab has one section of its own: the offline user.** In
  local-only mode (authentication disabled, `isAuthDisabled` in the context) it
  shows the stand-in user and why the cloud account's settings are missing
  (`OfflineUserSettingsSection.vue`); it is core, so a build without the cloud
  has it. Every other section comes from the cloud (`$/cloud/account/`,
  registered by `registerCloud`), through `$/providers/settingsContributions`;
  the settings route waits for them to load. They hide themselves in local-only
  mode and must never reach for Enso Cloud or Cognito there: the stand-in
  session's access token is empty, not a JWT.
- **React tabs** (`data.tsx`, `react: true`): billing, user groups, activity
  log, API keys and usage. `ReactSettingsTab.tsx` mounts them through
  `reactComponent`, with the React shell they still need (`Tab`, `Section`,
  `Entry`, `CustomEntry`, `Paywall`; they have only custom entries, so the React
  form entry went with #87). #87's follow-up and #88 port them; the React files
  go with the last.

## Keyboard shortcuts

The Keyboard shortcuts tab edits the window's dashboard bindings
(`$/providers/dashboardInputBindings`), which the React dashboard reads through
`InputBindingsProvider`. They are saved to `localStorage` under `inputBindings`,
in the format the React provider used. #170 unifies them with the graph editor's
bindings.

## Tests

`__tests__/`: the shell (`SettingsPage.test.ts`), the Account tab with the
cloud's sections (`accountTab.test.ts`), the Organization and Members tabs with
theirs (`organizationTabs.test.ts`), and the Keyboard shortcuts tab with its
capture modal. The Playwright specs are `integration-test/dashboard/`
`userSettings.spec.ts`, `organizationSettings.spec.ts` and
`localModeSettings.spec.ts` (local-only mode, which also shows how to start the
app with authentication disabled), and the settings check of
`accessibility.spec.ts`.
