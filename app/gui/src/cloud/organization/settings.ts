/**
 * @file The organization's settings tabs (Organization and Members), contributed by `registerCloud`
 * and loaded with the settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import { contributeSettingsSections } from '$/providers/settingsContributions'

/** Fill the Organization and Members settings tabs. */
export function registerOrganizationSettings() {
  const sections = () => import('./settingsSections')
  contributeSettingsSections(SettingsTabType.organization, () =>
    sections().then((module) => module.ORGANIZATION_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.members, () =>
    sections().then((module) => module.MEMBERS_SETTINGS_SECTIONS),
  )
}
