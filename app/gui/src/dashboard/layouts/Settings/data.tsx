/**
 * @file The settings tabs that are still React, mounted inside the Vue settings page through
 * `ReactSettingsTab`.
 *
 * TODO: #87 and #88 port the organization tabs (organization, billing, members, user groups, activity
 * log, API keys, usage) to Vue, under `src/cloud/`; this file goes with the last of them.
 */
import { Button } from '#/components/Button'
import type { ToastAndLogCallback } from '#/hooks/toastAndLogHooks'
import { ApiKeySettingsSection } from '#/layouts/Settings/ApiKeysSettingsSection'
import { useMutationCallback } from '#/utilities/tanstackQuery'
import type { PaywallFeatureName } from '$/composables/paywall'
import type { SettingsBaseContext, SettingsSearchableTab } from '$/configurations/settings'
import SettingsTabType, { SETTINGS_TAB_ICONS } from '$/configurations/settingsTabs'
import type { GetText } from '$/providers/text'
import type { Backend } from 'enso-common/src/services/Backend'
import {
  EmailAddress,
  HttpsUrl,
  isUserOnPlanWithMultipleSeats,
  type OrganizationInfo,
} from 'enso-common/src/services/Backend'
import type { RemoteBackend } from 'enso-common/src/services/RemoteBackend'
import type { TextId } from 'enso-common/src/text'
import type { HTMLInputAutoCompleteAttribute, HTMLInputTypeAttribute, ReactNode } from 'react'
import * as z from 'zod'
import ActivityLogSettingsSection from './ActivityLogSettingsSection'
import MembersSettingsSection from './MembersSettingsSection'
import OrganizationProfilePictureInput from './OrganizationProfilePictureInput'
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
  [SettingsTabType.organization]: {
    nameId: 'organizationSettingsTab',
    settingsTab: SettingsTabType.organization,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.organization],
    organizationOnly: true,
    visible: ({ user }) => isUserOnPlanWithMultipleSeats(user),
    sections: [
      {
        nameId: 'organizationSettingsSection',
        entries: [
          settingsFormEntryData({
            type: 'form',
            schema: z.object({
              name: z.string().regex(/^.*\S.*$|^$/),
              email: z.string().email().or(z.literal('')),
              website: z.string(),
              address: z.string(),
            }),
            getValue: (context) => {
              const { name, email, website, address } = context.organization ?? {}
              return {
                name: name ?? '',
                email: String(email ?? ''),
                website: String(website ?? ''),
                address: address ?? '',
              }
            },
            onSubmit: async (context, { name, email, website, address }) => {
              await context.updateOrganization([
                {
                  name,
                  email: EmailAddress(email),
                  website: HttpsUrl(website),
                  address,
                },
              ])
            },
            inputs: [
              {
                nameId: 'organizationNameSettingsInput',
                name: 'name',
                editable: (context) => context.user.isOrganizationAdmin,
              },
              {
                nameId: 'organizationEmailSettingsInput',
                name: 'email',
                editable: (context) => context.user.isOrganizationAdmin,
              },
              {
                nameId: 'organizationWebsiteSettingsInput',
                name: 'website',
                editable: (context) => context.user.isOrganizationAdmin,
              },
              {
                nameId: 'organizationLocationSettingsInput',
                name: 'address',
                editable: (context) => context.user.isOrganizationAdmin,
              },
            ],
          }),
        ],
      },
      {
        nameId: 'organizationProfilePictureSettingsSection',
        column: 2,
        entries: [
          {
            type: 'custom',
            aliasesId: 'organizationProfilePictureSettingsCustomEntryAliases',
            render: (context) => <OrganizationProfilePictureInput backend={context.backend} />,
          },
        ],
      },
    ],
  },
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
  [SettingsTabType.members]: {
    nameId: 'membersSettingsTab',
    settingsTab: SettingsTabType.members,
    react: true,
    icon: SETTINGS_TAB_ICONS[SettingsTabType.members],
    organizationOnly: true,
    visible: ({ user }) => isUserOnPlanWithMultipleSeats(user) && user.isOrganizationAdmin,
    feature: 'inviteUser',
    sections: [
      {
        nameId: 'membersSettingsSection',
        columnClassName: 'h-full *:flex-1 *:min-h-0',
        entries: [{ type: 'custom', render: MembersSettingsSection }],
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
  readonly updateOrganization: (
    variables: Parameters<Backend['updateOrganization']>,
  ) => Promise<OrganizationInfo | null | undefined>
  readonly toastAndLog: ToastAndLogCallback
  readonly getText: GetText
}

/** Possible values for the `type` property of {@link SettingsInputData}. */
export type SettingsInputType = Extract<HTMLInputTypeAttribute, 'email' | 'password' | 'text'>

/** Either `T`, or a function that returns `T` given a `SettingsContext`. */
type ToValue<T> = T | ((context: SettingsContext) => T)

/** Metadata describing an input in a {@link SettingsFormEntryData}. */
export interface SettingsInputData<T> {
  readonly nameId: TextId & `${string}SettingsInput`
  readonly name: string & keyof T
  readonly autoComplete?: HTMLInputAutoCompleteAttribute
  /** Defaults to `false`. */
  readonly hidden?: ToValue<boolean>
  /** Defaults to `true`. */
  readonly editable?: ToValue<boolean>
  readonly descriptionId?: TextId
  readonly type?: SettingsInputType
}

/** Metadata describing a settings entry that is a form. */
export interface SettingsFormEntryData<T> {
  readonly type: 'form'
  readonly schema: z.ZodType<T> | ((context: SettingsContext) => z.ZodType<T>)
  readonly getValue: (context: SettingsContext) => NoInfer<T>
  readonly onSubmit: (context: SettingsContext, value: NoInfer<T>) => Promise<void> | void
  readonly inputs: readonly SettingsInputData<NoInfer<T>>[]
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** A type-safe function to define a {@link SettingsFormEntryData}. */
function settingsFormEntryData<T>(data: SettingsFormEntryData<T>) {
  return data
}

/** Metadata describing a settings entry that needs custom rendering. */
export interface SettingsCustomEntryData {
  readonly type: 'custom'
  readonly aliasesId?: TextId & `${string}SettingsCustomEntryAliases`
  readonly getExtraAliases?: (getText: GetText) => readonly string[]
  readonly render: (context: SettingsContext) => ReactNode
  readonly getVisible?: (context: SettingsContext) => boolean
}

/** A settings entry of an arbitrary type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SettingsEntryData = SettingsCustomEntryData | SettingsFormEntryData<any>

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
