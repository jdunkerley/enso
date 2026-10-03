/**
 * @file The sections of the Account settings tab: the user's profile, the password change, two-factor
 * authentication, the account's deletion and the profile picture. Loaded with the settings page
 * (`registerAccountSettings`).
 */
import { passwordWithPatternSchema } from '$/cloud/auth/schemas'
import SetupTwoFaForm from '$/cloud/auth/SetupTwoFaForm.vue'
import { PASSWORD_REGEX } from '$/cloud/validation'
import {
  settingsFormEntryData,
  type SettingsBaseContext,
  type SettingsSectionData,
} from '$/configurations/settings'
import { getLocalTimeZone, now } from '@internationalized/date'
import {
  getTimeZoneFromDescription,
  getTimeZoneOffsetStringWithGMT,
  IanaTimeZone,
  tryGetDescriptionForTimeZone,
  tryGetTimeZoneFromDescription,
  WHITELISTED_TIME_ZONE_DESCRIPTIONS,
} from 'enso-common/src/utilities/data/dateTime'
import { z } from 'zod'
import DeleteUserAccountSettingsSection from './DeleteUserAccountSettingsSection.vue'
import ProfilePictureInput from './ProfilePictureInput.vue'

/**
 * Whether the user signed in with a password, rather than through GitHub or Google: only they can
 * change it, and set up two-factor authentication. Never in local-only mode, which has no account
 * and no token.
 */
function hasPassword({ accessToken, isAuthDisabled }: SettingsBaseContext) {
  if (isAuthDisabled) return false
  const payload = accessToken.split('.')[1]
  if (payload == null) return false
  try {
    // The shape of the JWT payload is statically known. It is base64url, which `atob` reads once
    // its two URL-safe characters are put back.
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const username: string | null = JSON.parse(json).username
    return username != null ? !/^Github_|^Google_/.test(username) : false
  } catch {
    // Not a JWT: the sections that need one cannot work.
    return false
  }
}

/** The GMT offset of a time zone, now; the local one when the description names none. */
function timeZoneOffset(description: string | undefined) {
  const timeZone = description != null ? tryGetTimeZoneFromDescription(description) : null
  return getTimeZoneOffsetStringWithGMT(now(timeZone ?? getLocalTimeZone()))
}

export const ACCOUNT_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'userAccountSettingsSection',
    entries: [
      settingsFormEntryData({
        type: 'form',
        schema: z.object({
          name: z.string().min(1),
          email: z.string().email().or(z.literal('')),
          timeZone: z.string().optional(),
        }),
        getValue: (context) => ({
          name: context.user.name,
          email: context.user.email,
          timeZone: tryGetDescriptionForTimeZone(
            context.preferredTimeZone,
            IanaTimeZone(getLocalTimeZone()),
          ),
        }),
        getVisible: ({ isCloudDataUnavailable }) => !isCloudDataUnavailable,
        onSubmit: async (context, { name, timeZone }) => {
          const newTimeZone = timeZone != null ? tryGetTimeZoneFromDescription(timeZone) : null
          if (newTimeZone != null) {
            context.setPreferredTimeZone(newTimeZone)
          }
          if (name !== context.user.name) {
            await context.updateUser({ username: name })
          }
        },
        inputs: [
          { nameId: 'userNameSettingsInput', name: 'name' },
          { nameId: 'userEmailSettingsInput', name: 'email', editable: false },
          {
            nameId: 'userTimeZoneSettingsInput',
            descriptionId: 'userTimeZoneSettingsInputDescription',
            name: 'timeZone',
            type: 'comboBox',
            comboBox: {
              items: WHITELISTED_TIME_ZONE_DESCRIPTIONS,
              addonStartText: timeZoneOffset,
              optionText: (description) =>
                `${getTimeZoneOffsetStringWithGMT(now(getTimeZoneFromDescription(description)))} ${description}`,
            },
          },
        ],
      }),
    ],
  },
  {
    nameId: 'changePasswordSettingsSection',
    entries: [
      settingsFormEntryData({
        type: 'form',
        schema: ({ getText }) =>
          z
            .object({
              username: z.string().email(getText('invalidEmailValidationError')),
              // The current password is not validated.
              currentPassword: z.string(),
              newPassword: passwordWithPatternSchema(getText),
              confirmNewPassword: z.string(),
            })
            .superRefine((object, context) => {
              if (
                PASSWORD_REGEX.test(object.newPassword) &&
                object.newPassword !== object.confirmNewPassword
              ) {
                context.addIssue({
                  path: ['confirmNewPassword'],
                  code: 'custom',
                  message: getText('passwordMismatchError'),
                })
              }
            }),
        getValue: ({ user }) => ({
          username: user.email,
          currentPassword: '',
          newPassword: '',
          confirmNewPassword: '',
        }),
        onSubmit: async ({ changePassword }, { currentPassword, newPassword }) => {
          await changePassword(currentPassword, newPassword)
        },
        inputs: [
          {
            nameId: 'userNameSettingsInput',
            name: 'username',
            autoComplete: 'username',
            editable: false,
            hidden: true,
          },
          {
            nameId: 'userCurrentPasswordSettingsInput',
            name: 'currentPassword',
            autoComplete: 'current-password',
            type: 'password',
          },
          {
            nameId: 'userNewPasswordSettingsInput',
            name: 'newPassword',
            autoComplete: 'new-password',
            descriptionId: 'passwordValidationMessage',
            type: 'password',
          },
          {
            nameId: 'userConfirmNewPasswordSettingsInput',
            name: 'confirmNewPassword',
            autoComplete: 'new-password',
            type: 'password',
          },
        ],
        getVisible: hasPassword,
      }),
    ],
  },
  {
    nameId: 'setup2FASettingsSection',
    entries: [{ type: 'custom', component: SetupTwoFaForm, getVisible: hasPassword }],
  },
  {
    nameId: 'deleteUserAccountSettingsSection',
    heading: false,
    entries: [
      {
        type: 'custom',
        aliasesId: 'deleteUserAccountSettingsCustomEntryAliases',
        getVisible: ({ isCloudDataUnavailable }) => !isCloudDataUnavailable,
        component: DeleteUserAccountSettingsSection,
      },
    ],
  },
  {
    nameId: 'profilePictureSettingsSection',
    column: 2,
    entries: [
      {
        type: 'custom',
        aliasesId: 'profilePictureSettingsCustomEntryAliases',
        getVisible: ({ isCloudDataUnavailable }) => !isCloudDataUnavailable,
        component: ProfilePictureInput,
      },
    ],
  },
]
