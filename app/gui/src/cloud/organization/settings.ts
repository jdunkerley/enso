/**
 * @file The organization's settings tabs (Organization, Members, User groups and Activity log),
 * contributed by `registerCloud` and loaded with the settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import { contributeSettingsSections } from '$/providers/settingsContributions'

/** Fill the Organization, Members, User groups and Activity log settings tabs. */
export function registerOrganizationSettings() {
  const sections = () => import('./settingsSections')
  contributeSettingsSections(SettingsTabType.organization, () =>
    sections().then((module) => module.ORGANIZATION_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.members, () =>
    sections().then((module) => module.MEMBERS_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.userGroups, () =>
    sections().then((module) => module.USER_GROUPS_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.activityLog, () =>
    sections().then((module) => module.ACTIVITY_LOG_SETTINGS_SECTIONS),
  )
}
