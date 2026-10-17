# dashboard/layouts/Settings/

The settings page (`SettingsPage.vue`, mounted by the `settings` route): a
sidebar of tabs, a search field, and the current tab, kept in the `SettingsTab`
query parameter (`?cloud-ide_SettingsTab="keyboard-shortcuts"`).

## One model

The page is Vue. Its tabs are declared, not hand-built: tabs hold sections, and
sections hold entries (a form of text fields, or a component). The model, the
context entries receive, and the search over tabs, sections and entries are in
`$/configurations/settings.ts`, framework-free, so that one search spans every
tab.

- **The tabs** (`tabs.ts`), all Vue since #88: Account, Local, Appearance,
  Keyboard shortcuts, and the Organization, Billing & Plans, Members, User
  groups, Activity log, API keys and Usage tabs that PR 3 of the local-only
  programme removes. `SettingsTab.vue` lays out their sections; a form entry is
  `SettingsFormEntry.vue`, a component entry reads the page's context with
  `useSettingsContext` (`$/providers/settingsContext`).
- **Tabs without sections.** The core declares Organization, Billing & Plans,
  Members, User groups, Activity log, API keys and Usage (name, icon,
  visibility) with no sections of its own, and nothing contributes any now (the
  cloud sources are gone, and so is the paywall). A Vue tab with no sections is
  not listed, so none of them shows.
- **The Account tab has one section of its own: the offline user.** In
  local-only mode (authentication disabled, `isAuthDisabled` in the context) it
  shows the stand-in user and why the cloud account's settings are missing
  (`OfflineUserSettingsSection.vue`); it is core, so a build without the cloud
  has it. Other sections would come through `$/providers/settingsContributions`
  (see "Contribution registries" in `app/gui/CLAUDE.md`); the settings route
  waits for them to load. Nothing may reach for Enso Cloud or Cognito: the
  stand-in session's access token is empty, not a JWT.

## Local directories

The Local tab writes the root and download directories through
`$/providers/localDirectories` (`setLocalRootDirectory`,
`setDownloadDirectory`): the one store that the drive's Local category
(`useLocalPaths`), the drive and the local backend read, persisted under
`enso-local-directory`. A second store once persisted the same entry, so a
change reached the drive only after a reload (#182); do not add another. The
drive must follow a change of the stored root reactively (the Vue drive reads
the category's directory through the categories store, #91), or it keeps listing
the old root. Tests: `__tests__/localTab.test.ts` and
`integration-test/dashboard/localDirectories.spec.ts`.

## Maps

The Maps section of the Local tab holds the user's own Mapbox access token. The
build supplies none and nothing fetches one. The value lives in
`mapboxSettingsStore` (`$/providers/mapboxToken`, `localStorage` key
`enso-mapbox-settings`), declared here as a form like the other Local entries;
`useMapboxToken()` reads it for the map visualization, `setMapboxToken` writes
it (trimmed, blank clears). It is sent nowhere except Mapbox. Test:
`__tests__/localTab.test.ts`.

## Keyboard shortcuts

The Keyboard shortcuts tab edits the window's bindings
(`$/providers/inputBindings`): the dashboard's, which Vue reads through
`$/providers/dashboardInputBindings`, and the graph editor's (#170), listed by
category from the registry (`$/configurations/keyboardShortcuts`). A change
applies at once, in the open graph editor too. They are saved to `localStorage`
under `inputBindings`, in a versioned format (version 2 extends version 1, see
`$/providers/inputBindings`), which older builds still read. The capture modal
refuses a key that another action has where both are active (the registry's
scopes) and names it; a conflict a reset brings back is shown in red.

## Tests

`__tests__/`: the shell (`SettingsPage.test.ts`), the Local tab
(`localTab.test.ts`) and the Keyboard shortcuts tab with its capture modal. The
Playwright specs are `integration-test/dashboard/` `userSettings.spec.ts`,
`organizationSettings.spec.ts` and `localModeSettings.spec.ts` (local-only mode,
which also shows how to start the app with authentication disabled), and the
settings check of `accessibility.spec.ts`.
