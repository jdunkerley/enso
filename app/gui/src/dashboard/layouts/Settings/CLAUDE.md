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

- **The tabs** (`tabs.ts`), all Vue since #88: Account, Local, Appearance and
  Keyboard shortcuts. The cloud's tabs (Organization, Billing & Plans, Members,
  User groups, Activity log, API keys, Usage) were deleted with the cloud UI,
  and so were their `SettingsTabType` values. `SettingsTab.vue` lays out a tab's
  sections; a form entry is `SettingsFormEntry.vue`, a component entry reads the
  page's context with `useSettingsContext` (`$/providers/settingsContext`). A
  tab with no sections is not listed.
- **The Account tab has one section of its own: the local user.** There is no
  sign-in (the context's `user` is always the local user), so it shows the local
  user and why there are no account settings (`OfflineUserSettingsSection.vue`).
  Other sections could come through `$/providers/settingsContributions` (see
  "Contribution registries" in `app/gui/CLAUDE.md`), which nothing uses now; the
  settings route waits for them to load. Nothing may reach for Enso Cloud: the
  session has no tokens.

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
`organizationSettings.spec.ts` and `localModeSettings.spec.ts`, and the settings
check of `accessibility.spec.ts`.
