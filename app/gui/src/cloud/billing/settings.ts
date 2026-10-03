/**
 * @file The billing area's part of the settings page: the paywall screen shown in place of a tab
 * whose feature the user's plan lacks. Contributed by `registerCloud`, loaded with the settings page.
 */
import { contributeSettingsPaywall } from '$/providers/settingsContributions'

/** Supply the settings page's paywall screen. */
export function registerBillingSettings() {
  contributeSettingsPaywall(() =>
    import('./paywall/SettingsPaywall.vue').then((module) => module.default),
  )
}
