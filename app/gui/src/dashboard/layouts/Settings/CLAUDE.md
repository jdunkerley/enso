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

- **The tabs** (`tabs.ts`), all Vue since #88: Local, AI, Appearance and
  Keyboard shortcuts. The page opens on Local (`DEFAULT_TAB`), or on the first
  tab shown when there is no local backend. There is no Account tab: the local
  user has no account settings (it showed only the stand-in name and a note), so
  it went with the settings cog (the left rail's Settings button opens the
  page). The cloud's tabs (Organization, Billing & Plans, Members, User groups,
  Activity log, API keys, Usage) were deleted with the cloud UI, and so were
  their `SettingsTabType` values. `SettingsTab.vue` lays out a tab's sections; a
  form entry is `SettingsFormEntry.vue`, a component entry reads the page's
  context with `useSettingsContext` (`$/providers/settingsContext`). A tab with
  no sections is not listed.
- **Further sections could come through `$/providers/settingsContributions`**
  (see "Contribution registries" in `app/gui/CLAUDE.md`), which nothing uses
  now; the settings route waits for them to load. There is no sign-in (the
  context's `user` is always the local user). Nothing may reach for Enso Cloud:
  the session has no tokens.

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

## Engine

The Local tab's Engine section (`EngineSettingsSection.vue`) has one switch,
"Pre-start the engine" (on by default; its description gives the spare's cost as
about 0.8 GB of memory while no project is open, the settled working set
measured in #659), kept in `spareEngineSettingsStore`
(`$/providers/spareEngineSettings`, `localStorage` key
`enso-spare-engine-settings`). `useSpareEngineSync` (wired in `App.vue`) sends
it to the project service (`engine/setSpare`) on load and on every change. The
section is always shown (it was hidden under the native engine, which has no
spare, until that engine was removed). Tests: `__tests__/localTab.test.ts` and
`integration-test/dashboard/spareEngineSettings.spec.ts`.

## AI

The AI tab (`AI_TAB`, after Local) has one section, External agents
(`McpSettingsSection.vue`), for the MCP server that Electron main runs so
external agent apps (Claude Code, Codex, GitHub Copilot) can read the open
project. The section, and so the tab, is shown only when `window.api.mcp` exists
(the desktop app). It reads `status()` on mount and follows `onStatusChanged`. A
switch turns the server on (off by default) under a standing warning that a
connected agent can read the project and run Enso code as you. While it is on:
the address (`http://127.0.0.1:<port>/mcp`), a port field (1024 to 65535,
`setPort` on submit), a button per client that has main copy that client's setup
text to the clipboard (`copyConfig`), and a New token button behind a confirm
dialog (`replaceToken`). The token never reaches the renderer: no call returns
it. An `error` in the status (port taken, no keychain) shows under the switch.
While `lockedByEnvironment` is true (`ENSO_MCP_ENABLED` or `ENSO_MCP_PORT` in
effect), the switch, the port field and its Save are disabled, with a note
(`mcpLockedByEnvironment`); main refuses both changes then anyway. A change that
resolves with a status other than the one asked for, or fails, re-keys the forms
so they show the server's state. A failed `setPort` shows in the port form only,
not as a toast. Under the copy buttons a Claude Desktop block shows the
`ClaudeDesktopStatus` read with `claudeDesktopStatus()` on mount and after each
server status change: not installed (one line), not set up (a Set up button),
set up, out of date (an Update button), or unreadable (the reason, and a pointer
to Copy JSON). In every state with a `configFile` (the file's full path, from
main; null on a platform without Claude Desktop) the block also has the manual
route: the path, what to do with the JSON, and a Copy JSON button
(`copyConfig('claudeDesktop')`). The "Copy setup for" row therefore has no
Claude Desktop button. The button asks first
(`McpClaudeDesktopConfirmModal.vue`: a non-destructive `AlertDialog` titled like
the button; `ConfirmDeleteModal` is styled as destructive), then
`setUpClaudeDesktop()` has main edit Claude Desktop's configuration file. The
block then shows the state main returns; only `setUp` also gets the "Done" toast
(any other state means nothing was written, and the block says why). The block
always says Claude Desktop needs Node.js and that its Add custom connector
screen cannot work. Tests: `__tests__/McpSettingsSection.test.ts` and
`integration-test/dashboard/mcpSettings.spec.ts`.

## Engine logs

The Local tab's Engine logs section (`EngineLogsSettingsSection.vue`) holds two
switches, both off: Log SQL queries and Log performance timings. They live in
`$/providers/engineLogSettings` (`localStorage` key `enso-engine-log-settings`)
and are read when a project opens (`projectStates.openProject` passes them as
the open's `engineLogging`), so they apply from the next engine started, as the
section says. The Logs panel shows the SQL queries and Performance sources only
while their switch is on. Test: `__tests__/localTab.test.ts`.

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
Playwright specs are `integration-test/dashboard/` `localModeSettings.spec.ts`,
`localDirectories.spec.ts`, `localVersioningSettings.spec.ts` and
`spareEngineSettings.spec.ts`, and the settings check of
`accessibility.spec.ts`.
