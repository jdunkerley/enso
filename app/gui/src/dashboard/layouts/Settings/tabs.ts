/**
 * @file The settings tabs, in their sidebar groups. Every tab but Billing & Plans is Vue
 * (`SettingsTab.vue`); Billing & Plans is still React (`./data.tsx`, mounted by `ReactSettingsTab`)
 * until #88. The sections of the Account tab and of the cloud's tabs (Organization, Members, User
 * groups, Activity log, API keys, Usage) come from the cloud (`$/providers/settingsContributions`);
 * the cloud's tabs have none of their own, so a build without the cloud does not list them.
 */
// ESLint's TypeScript program does not resolve `.vue` modules (vue-tsc, which typechecks this file,
// does), so to ESLint the components imported here have an error type.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { actionToTextId, BINDINGS } from '$/configurations/inputBindings'
import {
  settingsFormEntryData,
  type SettingsSectionData,
  type SettingsTabData,
  type SettingsTabSectionData,
} from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import { setDownloadDirectory, setLocalRootDirectory } from '$/providers/localDirectories'
import { isUserOnPlanWithMultipleSeats, Path } from 'enso-common/src/services/Backend'
import { unsafeEntries } from 'enso-common/src/utilities/data/object'
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

const ORGANIZATION_TAB: SettingsTabData = {
  nameId: 'organizationSettingsTab',
  settingsTab: SettingsTabType.organization,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.organization],
  organizationOnly: true,
  visible: ({ user }) => isUserOnPlanWithMultipleSeats(user),
  // Contributed by `src/cloud/organization/`.
  sections: [],
}

const MEMBERS_TAB: SettingsTabData = {
  nameId: 'membersSettingsTab',
  settingsTab: SettingsTabType.members,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.members],
  organizationOnly: true,
  visible: ({ user }) => isUserOnPlanWithMultipleSeats(user) && user.isOrganizationAdmin,
  feature: 'inviteUser',
  // Contributed by `src/cloud/organization/`.
  sections: [],
}

const USER_GROUPS_TAB: SettingsTabData = {
  nameId: 'userGroupsSettingsTab',
  settingsTab: SettingsTabType.userGroups,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.userGroups],
  organizationOnly: true,
  visible: ({ user }) => isUserOnPlanWithMultipleSeats(user) && user.isOrganizationAdmin,
  feature: 'userGroups',
  // Contributed by `src/cloud/organization/`.
  sections: [],
}

const ACTIVITY_LOG_TAB: SettingsTabData = {
  nameId: 'activityLogSettingsTab',
  settingsTab: SettingsTabType.activityLog,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.activityLog],
  organizationOnly: true,
  visible: ({ user }) => isUserOnPlanWithMultipleSeats(user),
  // Contributed by `src/cloud/organization/`.
  sections: [],
}

const API_KEYS_TAB: SettingsTabData = {
  nameId: 'apiKeysSettingsTab',
  settingsTab: SettingsTabType.apiKeys,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.apiKeys],
  visible: ({ isCloudDataUnavailable }) => !isCloudDataUnavailable,
  // Contributed by `src/cloud/account/`.
  sections: [],
}

const USAGE_TAB: SettingsTabData = {
  nameId: 'usageSettingsTab',
  settingsTab: SettingsTabType.usage,
  icon: SETTINGS_TAB_ICONS[SettingsTabType.usage],
  feature: 'scheduler',
  // Scheduled executions run in Enso Cloud: in local-only mode the tab could only offer a plan.
  visible: ({ isAuthDisabled }) => !isAuthDisabled,
  // Contributed by `src/cloud/billing/`.
  sections: [],
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
            unsafeEntries(BINDINGS).flatMap(([action, info]) =>
              info.rebindable === false ? [] : [getText(actionToTextId(action))],
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
    tabs: [ACCOUNT_TAB, ORGANIZATION_TAB, LOCAL_TAB],
  },
  {
    nameId: 'accessSettingsTabSection',
    tabs: [REACT_SETTINGS_TAB_DATA[SettingsTabType.billingAndPlans], MEMBERS_TAB, USER_GROUPS_TAB],
  },
  { nameId: 'lookAndFeelSettingsTabSection', tabs: [APPEARANCE_TAB, KEYBOARD_SHORTCUTS_TAB] },
  {
    nameId: 'securitySettingsTabSection',
    tabs: [ACTIVITY_LOG_TAB, API_KEYS_TAB],
  },
  { nameId: 'usageSettingsTabSection', tabs: [USAGE_TAB] },
]
