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

- **Vue tabs** (`tabs.ts`): every tab but Billing & Plans: Account,
  Organization, Local, Members, User groups, Appearance, Keyboard shortcuts,
  Activity log, API keys, Usage. `SettingsTab.vue` lays out their sections; a
  form entry is `SettingsFormEntry.vue`, a component entry reads the page's
  context with `useSettingsContext` (`$/providers/settingsContext`).
- **The cloud's tabs (#87, #191).** The core declares Organization, Members,
  User groups, Activity log, API keys and Usage (name, icon, visibility, the
  paywall features: Members' `inviteUser`, User groups' `userGroups`, Usage's
  `scheduler`) with no sections; the cloud contributes them
  (`$/cloud/organization/` the first four, `$/cloud/account/` API keys,
  `$/cloud/billing/` Usage). A Vue tab with no sections is not listed, so a
  build without the cloud shows none of them. While a tab's `feature` is under
  the paywall, the page shows the paywall screen the cloud contributes
  (`contributeSettingsPaywall`, from `$/cloud/billing/`) instead of the tab's
  sections.
- **The Account tab has one section of its own: the offline user.** In
  local-only mode (authentication disabled, `isAuthDisabled` in the context) it
  shows the stand-in user and why the cloud account's settings are missing
  (`OfflineUserSettingsSection.vue`); it is core, so a build without the cloud
  has it. Every other section comes from the cloud (`$/cloud/account/`,
  registered by `registerCloud`), through `$/providers/settingsContributions`;
  the settings route waits for them to load. They hide themselves in local-only
  mode and must never reach for Enso Cloud or Cognito there: the stand-in
  session's access token is empty, not a JWT.
- **One React tab** (`data.tsx`, `react: true`): Billing & Plans.
  `ReactSettingsTab.tsx` mounts it through `reactComponent`, with the React
  shell it still needs (`Tab`, `Section`, `Entry`, `CustomEntry`; it has no
  paywall feature, so the React settings `Paywall` went with #191). #88 ports
  it; the bridge, `data.tsx` and the shell go with it.

## Local directories

The Local tab writes the root and download directories through
`$/providers/localDirectories` (`setLocalRootDirectory`,
`setDownloadDirectory`): the one store that the drive's Local category
(`useLocalPaths`), the React drive and the local backend read, persisted under
`enso-local-directory`. A second store once persisted the same entry, so a
change reached the drive only after a reload (#182); do not add another. The
React drive must re-render on a change of the stored root (`useDirectoryIds`
subscribes to `localPathsStore` for that), or it keeps listing the old root
until something else re-renders it. Do not cache the category's directory id in
`useVueValue` state instead: that lags a render behind a change of category, and
the drive then snaps back to the previous category. Tests:
`__tests__/localTab.test.ts` and
`integration-test/dashboard/localDirectories.spec.ts`.

## Keyboard shortcuts

The Keyboard shortcuts tab edits the window's bindings
(`$/providers/inputBindings`): the dashboard's, which the React dashboard reads
through `InputBindingsProvider`, and the graph editor's (#170), listed by
category from the registry (`$/configurations/keyboardShortcuts`). A change
applies at once, in the open graph editor too. They are saved to `localStorage`
under `inputBindings`, in a versioned extension of the format the React provider
used, which older builds still read. The capture modal refuses a key that
another action has where both are active (the registry's scopes) and names it; a
conflict a reset brings back is shown in red.

## Tests

`__tests__/`: the shell (`SettingsPage.test.ts`), the Account tab with the
cloud's sections (`accountTab.test.ts`), the Organization and Members tabs with
theirs (`organizationTabs.test.ts`), User groups, Activity log, API keys and
Usage with theirs (`cloudTabs.test.ts`), and the Keyboard shortcuts tab with its
capture modal. The Playwright specs are `integration-test/dashboard/`
`userSettings.spec.ts`, `organizationSettings.spec.ts` and
`localModeSettings.spec.ts` (local-only mode, which also shows how to start the
app with authentication disabled), and the settings check of
`accessibility.spec.ts`.
