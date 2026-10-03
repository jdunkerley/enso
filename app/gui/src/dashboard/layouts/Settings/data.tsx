/**
 * @file The settings tabs that are still React, mounted inside the Vue settings page through
 * `ReactSettingsTab`.
 *
 * TODO: #87's follow-up ports user groups, activity log, API keys and usage, and #88 billing, to
 * Vue under `src/cloud/`; this file goes with the last of them. Organization and Members are Vue
 * since #87.
 */
import { Button } from '#/components/Button'
import type { ToastAndLogCallback } from '#/hooks/toastAndLogHooks'
import { ApiKeySettingsSection } from '#/layouts/Settings/ApiKeysSettingsSection'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import type { PaywallFeatureName } from '$/composables/paywall'
import type { SettingsBaseContext, SettingsSearchableTab } from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import type { GetText } from '$/providers/text'
import { isUserOnPlanWithMultipleSeats } from 'enso-common/src/services/Backend'
import type { RemoteBackend } from 'enso-common/src/services/RemoteBackend'
import type { TextId } from 'enso-common/src/text'
import type { ReactNode } from 'react'
import ActivityLogSettingsSection from './ActivityLogSettingsSection'
import UsageSettingsSection from './UsageSettingsSection'
import { UserGroupsSettingsSection } from './UserGroupsSettingsSection'

export const SETTINGS_NO_RESULTS_SECTION_DATA: SettingsSectionData = {
  nameId: 'noResultsSettingsSection',
  heading: false,
  entries: [
    {
      type: 'custom',
      render: (context) => (
        <div className="grid max-w-[512px] justify-center">{context.getText('noResultsFound')}</div>
      ),
    },
  ],
}

/** The React settings tabs. */
export const REACT_SETTINGS_TAB_DATA = {
  [SettingsTabType.billingAndPlans]: {
    nameId: 'billingAndPlansSettingsTab',
    settingsTab: SettingsTabType.billingAndPlans,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.billingAndPlans],
    organizationOnly: true,
    visible: ({ user, organization }) =>
      user.isOrganizationAdmin && organization?.subscription != null,
    sections: [
      {
        nameId: 'billingAndPlansSettingsSection',
        entries: [
          {
            type: 'custom',
            aliasesId: 'billingAndPlansSettingsCustomEntryAliases',
            render: (context) => {
              // This is a React component, so we can use hooks.
              // eslint-disable-next-line react-hooks/rules-of-hooks
              const openCustomerPortalSession = useMutationCallback({
                mutationKey: ['billing', 'customerPortalSession'],
                mutationFn: () =>
                  context.backend.createCustomerPortalSession().then(
                    (url) => {
                      if (url != null) {
                        window.open(url, '_blank')?.focus()
                      }
                    },
                    (error) => {
                      context.toastAndLog('arbitraryErrorTitle', error)
                      throw error
                    },
                  ),
              })

              return (
                <Button.Group className="grow-0">
                  <Button
                    size="small"
                    variant="outline"
                    className="self-start"
                    onPress={() => openCustomerPortalSession()}
                  >
                    {context.getText('openBillingPage')}
                  </Button>
                </Button.Group>
              )
            },
          },
        ],
      },
    ],
  },
  [SettingsTabType.userGroups]: {
    nameId: 'userGroupsSettingsTab',
    settingsTab: SettingsTabType.userGroups,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.userGroups],
    organizationOnly: true,
    visible: ({ user }) => isUserOnPlanWithMultipleSeats(user) && user.isOrganizationAdmin,
    feature: 'userGroups',
    sections: [
      {
        nameId: 'userGroupsSettingsSection',
        columnClassName: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
        entries: [{ type: 'custom', render: UserGroupsSettingsSection }],
      },
    ],
  },
  [SettingsTabType.activityLog]: {
    nameId: 'activityLogSettingsTab',
    settingsTab: SettingsTabType.activityLog,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.activityLog],
    organizationOnly: true,
    visible: ({ user }) => isUserOnPlanWithMultipleSeats(user),
    sections: [
      {
        nameId: 'activityLogSettingsSection',
        columnClassName: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
        entries: [
          {
            type: 'custom',
            render: (context) => <ActivityLogSettingsSection backend={context.backend} />,
          },
        ],
      },
    ],
  },
  [SettingsTabType.apiKeys]: {
    nameId: 'apiKeysSettingsTab',
    settingsTab: SettingsTabType.apiKeys,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.apiKeys],
    visible: ({ isCloudDataUnavailable }) => !isCloudDataUnavailable,
    sections: [
      {
        nameId: 'apiKeysSettingsSection',
        columnClassName: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
        entries: [
          {
            type: 'custom',
            aliasesId: 'apiKeysSettingsCustomEntryAliases',
            render: () => <ApiKeySettingsSection />,
          },
        ],
      },
    ],
  },
  [SettingsTabType.usage]: {
    nameId: 'usageSettingsTab',
    settingsTab: SettingsTabType.usage,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.usage],
    feature: 'scheduler',
    // Scheduled executions run in Enso Cloud: in local-only mode the tab could only offer a plan.
    visible: ({ isAuthDisabled }) => !isAuthDisabled,
    sections: [
      {
        nameId: 'usageSettingsSection',
        columnClassName: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
        entries: [
          {
            type: 'custom',
            aliasesId: 'usageSettingsCustomEntryAliases',
            render: (context) => <UsageSettingsSection backend={context.backend} />,
          },
        ],
      },
    ],
  },
} satisfies Partial<Record<SettingsTabType, SettingsTabData>>

/** Metadata describing inputs passed to every React settings entry. */
export interface SettingsContext extends SettingsBaseContext {
  readonly backend: RemoteBackend
  readonly toastAndLog: ToastAndLogCallback
  readonly getText: GetText
}

/** Metadata describing a settings entry that needs custom rendering. */
export interface SettingsCustomEntryData {
  readonly type: 'custom'
  readonly aliasesId?: TextId & `${string}SettingsCustomEntryAliases`
  readonly getExtraAliases?: (getText: GetText) => readonly string[]
  readonly render: (context: SettingsContext) => ReactNode
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** A settings entry. The React tabs left have only custom ones. */
export type SettingsEntryData = SettingsCustomEntryData

/** Metadata describing a settings section. */
export interface SettingsSectionData {
  readonly nameId: TextId & `${string}SettingsSection`
  /** The first column is column 1, not column 0. */
  readonly column?: number
  readonly heading?: false
  readonly columnClassName?: string
  readonly entries: readonly SettingsEntryData[]
}

/** Metadata describing a settings tab. */
export interface SettingsTabData extends SettingsSearchableTab<SettingsSectionData> {
  /** Rendered in React, by `ReactSettingsTab`. */
  readonly react: true
  /**
   * The feature behind which this settings tab is locked. If the user cannot access the feature,
   * a paywall is shown instead of the settings tab.
   */
  readonly feature?: PaywallFeatureName
}
