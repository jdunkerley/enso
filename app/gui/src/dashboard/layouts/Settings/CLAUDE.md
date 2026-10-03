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

- **Vue tabs** (`tabs.ts`): Account, Local, Appearance, Keyboard shortcuts.
  `SettingsTab.vue` lays out their sections; a form entry is
  `SettingsFormEntry.vue`, a component entry reads the page's context with
  `useSettingsContext` (`$/providers/settingsContext`).
- **The Account tab has no sections of its own.** The cloud contributes them
  (`$/cloud/account/`, registered by `registerCloud`), through
  `$/providers/settingsContributions`; the settings route waits for them to
  load.
- **React tabs** (`data.tsx`, `react: true`): organization, billing, members,
  user groups, activity log, API keys and usage. `ReactSettingsTab.tsx` mounts
  them through `reactComponent`, with the React shell they still need (`Tab`,
  `Section`, `Entry`, `FormEntry`, `CustomEntry`, `Input`, `AriaInput`,
  `Paywall`). #87 and #88 port them; the React files go with the last.

## Keyboard shortcuts

The Keyboard shortcuts tab edits the window's dashboard bindings
(`$/providers/dashboardInputBindings`), which the React dashboard reads through
`InputBindingsProvider`. They are saved to `localStorage` under `inputBindings`,
in the format the React provider used. #170 unifies them with the graph editor's
bindings.

## Tests

`__tests__/`: the shell (`SettingsPage.test.ts`), the Account tab with the
cloud's sections (`accountTab.test.ts`), and the Keyboard shortcuts tab with its
capture modal. The Playwright specs are `integration-test/dashboard/`
`userSettings.spec.ts` and `organizationSettings.spec.ts`, and the settings
check of `accessibility.spec.ts`.
