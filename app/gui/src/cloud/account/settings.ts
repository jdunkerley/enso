/**
 * @file The Account settings tab's sections, contributed by `registerCloud` and loaded with the
 * settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import { contributeSettingsSections } from '$/providers/settingsContributions'

/** Add the account's sections to the Account settings tab. */
export function registerAccountSettings() {
  contributeSettingsSections(SettingsTabType.account, () =>
    import('./settingsSections').then((module) => module.ACCOUNT_SETTINGS_SECTIONS),
  )
}
