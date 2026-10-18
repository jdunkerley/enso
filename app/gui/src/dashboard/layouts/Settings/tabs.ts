/**
 * @file The settings tabs, in their sidebar groups, each rendered by `SettingsTab.vue`: Account,
 * Local, Appearance and Keyboard shortcuts. A tab may also show sections contributed through
 * `$/providers/settingsContributions`, after its own.
 */
// ESLint's TypeScript program does not resolve `.vue` modules (vue-tsc, which typechecks this file,
// does), so to ESLint the components imported here have an error type.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { defaultShortcuts } from '$/configurations/keyboardShortcuts'
import {
  settingsFormEntryData,
  type SettingsSectionData,
  type SettingsTabData,
  type SettingsTabSectionData,
} from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import { setDownloadDirectory, setLocalRootDirectory } from '$/providers/localDirectories'
import { mapboxSettingsStore, setMapboxToken } from '$/providers/mapboxToken'
import { Path } from 'enso-common/src/services/Backend'
import { z } from 'zod'
import CodeLigaturesSettingsSection from './CodeLigaturesSettingsSection.vue'
import HandwrittenCommentsSettingsSection from './HandwrittenCommentsSettingsSection.vue'
import KeyboardShortcutsSettingsSection from './KeyboardShortcutsSettingsSection.vue'
import LocalDirectoryButtons from './LocalDirectoryButtons.vue'
import LocalVersionsSettingsSection from './LocalVersionsSettingsSection.vue'
import NoResults from './NoResults.vue'
import OfflineUserSettingsSection from './OfflineUserSettingsSection.vue'

/** The section shown when nothing in a tab matches the search. */
export const SETTINGS_NO_RESULTS_SECTION_DATA: SettingsSectionData = {
  nameId: 'noResultsSettingsSection',
  heading: false,
  entries: [{ type: 'custom', component: NoResults }],
}

const ACCOUNT_TAB: SettingsTabData = {
  nameId: 'accountSettingsTab',
  settingsTab: SettingsTabType.account,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.account],
  // Its one section is the local user.
  sections: [
    {
      nameId: 'offlineUserSettingsSection',
      entries: [{ type: 'custom', component: OfflineUserSettingsSection }],
    },
  ],
}

const LOCAL_TAB: SettingsTabData = {
  nameId: 'localSettingsTab',
  settingsTab: SettingsTabType.local,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.local],
  visible: ({ localBackend }) => localBackend != null,
  sections: [
    {
      nameId: 'localSettingsSection',
      entries: [
        settingsFormEntryData({
          type: 'form',
          schema: z.object({ localRootDirectory: z.string() }),
          getValue: ({ localRootDirectory }) => ({
            localRootDirectory: String(localRootDirectory ?? ''),
          }),
          onSubmit: (_, { localRootDirectory }) => {
            setLocalRootDirectory(Path(localRootDirectory))
          },
          inputs: [{ nameId: 'localRootPathSettingsInput', name: 'localRootDirectory' }],
        }),
        {
          type: 'custom',
          aliasesId: 'localRootPathButtonSettingsCustomEntryAliases',
          component: LocalDirectoryButtons,
          props: { directory: 'localRoot' },
        },
        settingsFormEntryData({
          type: 'form',
          schema: z.object({ downloadDirectory: z.string() }),
          getValue: ({ downloadDirectory }) => ({
            downloadDirectory: String(downloadDirectory ?? ''),
          }),
          onSubmit: (_, { downloadDirectory }) => {
            setDownloadDirectory(Path(downloadDirectory))
          },
          inputs: [{ nameId: 'downloadDirectorySettingsInput', name: 'downloadDirectory' }],
        }),
        {
          type: 'custom',
          aliasesId: 'downloadDirectoryButtonSettingsCustomEntryAliases',
          component: LocalDirectoryButtons,
          props: { directory: 'download' },
        },
      ],
    },
    {
      nameId: 'localVersionsSettingsSection',
      entries: [
        {
          type: 'custom',
          aliasesId: 'localVersionsSettingsCustomEntryAliases',
          component: LocalVersionsSettingsSection,
        },
      ],
    },
    {
      nameId: 'mapsSettingsSection',
      entries: [
        settingsFormEntryData({
          type: 'form',
          schema: z.object({ mapboxToken: z.string() }),
          getValue: () => ({ mapboxToken: mapboxSettingsStore.state.value.accessToken ?? '' }),
          onSubmit: (_, { mapboxToken }) => {
            setMapboxToken(mapboxToken)
          },
          inputs: [
            {
              nameId: 'mapboxTokenSettingsInput',
              name: 'mapboxToken',
              autoComplete: 'off',
              // Masked, so that the token does not show on a shared screen.
              type: 'password',
              descriptionId: 'mapboxTokenSettingsInputDescription',
            },
          ],
        }),
      ],
    },
  ],
}

const APPEARANCE_TAB: SettingsTabData = {
  nameId: 'appearanceSettingsTab',
  settingsTab: SettingsTabType.appearance,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.appearance],
  sections: [
    {
      nameId: 'codeSettingsSection',
      entries: [
        {
          type: 'custom',
          aliasesId: 'codeLigaturesSettingsCustomEntryAliases',
          component: CodeLigaturesSettingsSection,
        },
        {
          type: 'custom',
          aliasesId: 'handwrittenCommentsSettingsCustomEntryAliases',
          component: HandwrittenCommentsSettingsSection,
        },
      ],
    },
  ],
}

const KEYBOARD_SHORTCUTS_TAB: SettingsTabData = {
  nameId: 'keyboardShortcutsSettingsTab',
  settingsTab: SettingsTabType.keyboardShortcuts,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.keyboardShortcuts],
  sections: [
    {
      nameId: 'keyboardShortcutsSettingsSection',
      columnClass: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
      entries: [
        {
          type: 'custom',
          aliasesId: 'keyboardShortcutsSettingsCustomEntryAliases',
          getExtraAliases: (getText) =>
            defaultShortcuts().flatMap((shortcut) =>
              shortcut.rebindable ? [getText(shortcut.nameTextId)] : [],
            ),
          component: KeyboardShortcutsSettingsSection,
        },
      ],
    },
  ],
}

/** The settings tabs, in their sidebar groups. */
export const SETTINGS_DATA: readonly SettingsTabSectionData<SettingsTabData>[] = [
  { nameId: 'generalSettingsTabSection', tabs: [ACCOUNT_TAB, LOCAL_TAB] },
  { nameId: 'lookAndFeelSettingsTabSection', tabs: [APPEARANCE_TAB, KEYBOARD_SHORTCUTS_TAB] },
]
