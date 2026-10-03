/**
 * @file The sections of the organization's settings tabs: the organization's details and its
 * profile picture (Organization), its members with their invitations (Members), its user groups
 * (User groups) and its audit log (Activity log). Loaded with the settings page
 * (`registerOrganizationSettings`). The tabs themselves (names, icons, visibility, the paywall
 * features of Members and User groups) are declared by the core, in `#/layouts/Settings/tabs.ts`.
 */
import { settingsFormEntryData, type SettingsSectionData } from '$/configurations/settings'
import { EmailAddress, HttpsUrl } from 'enso-common/src/services/Backend'
import { z } from 'zod'
import ActivityLogSettingsSection from './ActivityLogSettingsSection.vue'
import MembersSettingsSection from './MembersSettingsSection.vue'
import OrganizationProfilePictureInput from './OrganizationProfilePictureInput.vue'
import UserGroupsSettingsSection from './UserGroupsSettingsSection.vue'

export const ORGANIZATION_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
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
          await context.updateOrganization({
            name,
            email: EmailAddress(email),
            website: HttpsUrl(website),
            address,
          })
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
        component: OrganizationProfilePictureInput,
      },
    ],
  },
]

export const MEMBERS_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'membersSettingsSection',
    columnClass: 'h-full *:flex-1 *:min-h-0',
    entries: [{ type: 'custom', component: MembersSettingsSection }],
  },
]

export const USER_GROUPS_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'userGroupsSettingsSection',
    columnClass: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
    entries: [{ type: 'custom', component: UserGroupsSettingsSection }],
  },
]

export const ACTIVITY_LOG_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'activityLogSettingsSection',
    columnClass: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
    entries: [{ type: 'custom', component: ActivityLogSettingsSection }],
  },
]
