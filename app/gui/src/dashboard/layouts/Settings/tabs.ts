/**
 * @file The settings tabs, in their sidebar groups. The personal tabs are Vue (`SettingsTab.vue`);
 * the organization tabs are still React (`./data.tsx`, mounted by `ReactSettingsTab`). The Account
 * tab's sections come from the cloud (`$/providers/settingsContributions`).
 */
// ESLint's TypeScript program does not resolve `.vue` modules (vue-tsc, which typechecks this file,
// does), so to ESLint the components imported here have an error type.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { setDownloadDirectory, setLocalRootDirectory } from '#/layouts/Drive/persistentState'
import { defaultShortcuts } from '$/configurations/keyboardShortcuts'
import {
  settingsFormEntryData,
  type SettingsSectionData,
  type SettingsTabData,
  type SettingsTabSectionData,
} from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import { Path } from 'enso-common/src/services/Backend'
import { z } from 'zod'
import CodeLigaturesSettingsSection from './CodeLigaturesSettingsSection.vue'
import { REACT_SETTINGS_TAB_DATA, type SettingsTabData as ReactSettingsTabData } from './data'
import HandwrittenCommentsSettingsSection from './HandwrittenCommentsSettingsSection.vue'
import KeyboardShortcutsSettingsSection from './KeyboardShortcutsSettingsSection.vue'
import LocalDirectoryButtons from './LocalDirectoryButtons.vue'
import NoResults from './NoResults.vue'
import OfflineUserSettingsSection from './OfflineUserSettingsSection.vue'

/** A settings tab, rendered in Vue or (with `react: true`) in React. */
export type AnySettingsTabData = ReactSettingsTabData | SettingsTabData

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
  // Every other section is contributed by `src/cloud/` (`registerCloud`), and hides itself in
  // local-only mode. The tab stays visible in degraded-auth mode, so that the Cognito-only sections
  // (password change, 2FA setup) remain reachable; the cloud-dependent sections hide themselves.
  sections: [
    {
      nameId: 'offlineUserSettingsSection',
      entries: [
        {
          // No aliases: a search for them would list the tab with nothing in it for a signed-in user.
          type: 'custom',
          getVisible: ({ isAuthDisabled }) => isAuthDisabled,
          component: OfflineUserSettingsSection,
        },
      ],
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
export const SETTINGS_DATA: readonly SettingsTabSectionData<AnySettingsTabData>[] = [
  {
    nameId: 'generalSettingsTabSection',
    tabs: [ACCOUNT_TAB, REACT_SETTINGS_TAB_DATA[SettingsTabType.organization], LOCAL_TAB],
  },
  {
    nameId: 'accessSettingsTabSection',
    tabs: [
      REACT_SETTINGS_TAB_DATA[SettingsTabType.billingAndPlans],
      REACT_SETTINGS_TAB_DATA[SettingsTabType.members],
      REACT_SETTINGS_TAB_DATA[SettingsTabType.userGroups],
    ],
  },
  { nameId: 'lookAndFeelSettingsTabSection', tabs: [APPEARANCE_TAB, KEYBOARD_SHORTCUTS_TAB] },
  {
    nameId: 'securitySettingsTabSection',
    tabs: [
      REACT_SETTINGS_TAB_DATA[SettingsTabType.activityLog],
      REACT_SETTINGS_TAB_DATA[SettingsTabType.apiKeys],
    ],
  },
  { nameId: 'usageSettingsTabSection', tabs: [REACT_SETTINGS_TAB_DATA[SettingsTabType.usage]] },
]
