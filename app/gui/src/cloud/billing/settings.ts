/**
 * @file The billing area's part of the settings page: the paywall screen shown in place of a tab
 * whose feature the user's plan lacks, and the Usage tab's section. Contributed by `registerCloud`,
 * loaded with the settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import {
  contributeSettingsPaywall,
  contributeSettingsSections,
} from '$/providers/settingsContributions'

/** Supply the settings page's paywall screen, and fill the Usage tab. */
export function registerBillingSettings() {
  contributeSettingsPaywall(() =>
    import('./paywall/SettingsPaywall.vue').then((module) => module.default),
  )
  contributeSettingsSections(SettingsTabType.usage, () =>
    import('./settingsSections').then((module) => module.USAGE_SETTINGS_SECTIONS),
  )
}
