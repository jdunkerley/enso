/**
 * @file The sections of the Account and API keys settings tabs, contributed by `registerCloud` and
 * loaded with the settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import { contributeSettingsSections } from '$/providers/settingsContributions'

/** Add the account's sections to the Account settings tab, and fill the API keys tab. */
export function registerAccountSettings() {
  const sections = () => import('./settingsSections')
  contributeSettingsSections(SettingsTabType.account, () =>
    sections().then((module) => module.ACCOUNT_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.apiKeys, () =>
    sections().then((module) => module.API_KEYS_SETTINGS_SECTIONS),
  )
}
