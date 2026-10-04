/**
 * @file The billing area's part of the settings page: the paywall screen shown in place of a tab
 * whose feature the user's plan lacks, and the Billing & Plans and Usage tabs' sections. Contributed
 * by `registerCloud`, loaded with the settings page.
 */
import SettingsTabType from '$/configurations/settingsTabs'
import {
  contributeSettingsPaywall,
  contributeSettingsSections,
} from '$/providers/settingsContributions'

/** Supply the settings page's paywall screen, and fill the Billing & Plans and Usage tabs. */
export function registerBillingSettings() {
  contributeSettingsPaywall(() =>
    import('./paywall/SettingsPaywall.vue').then((module) => module.default),
  )
  contributeSettingsSections(SettingsTabType.billingAndPlans, () =>
    import('./settingsSections').then((module) => module.BILLING_AND_PLANS_SETTINGS_SECTIONS),
  )
  contributeSettingsSections(SettingsTabType.usage, () =>
    import('./settingsSections').then((module) => module.USAGE_SETTINGS_SECTIONS),
  )
}
