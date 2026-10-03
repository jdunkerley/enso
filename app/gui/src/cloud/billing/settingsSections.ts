/**
 * @file The Billing & Plans and Usage settings tabs' sections: the button that opens the billing
 * page, and a month's scheduled executions. Loaded with the settings page
 * (`registerBillingSettings`). The tabs themselves (name, icon, visibility, Usage's `scheduler`
 * paywall feature) are declared by the core, in `#/layouts/Settings/tabs.ts`.
 */
import type { SettingsSectionData } from '$/configurations/settings'
import BillingSettingsSection from './BillingSettingsSection.vue'
import UsageSettingsSection from './UsageSettingsSection.vue'

export const BILLING_AND_PLANS_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'billingAndPlansSettingsSection',
    entries: [
      {
        type: 'custom',
        aliasesId: 'billingAndPlansSettingsCustomEntryAliases',
        component: BillingSettingsSection,
      },
    ],
  },
]

export const USAGE_SETTINGS_SECTIONS: readonly SettingsSectionData[] = [
  {
    nameId: 'usageSettingsSection',
    columnClass: 'h-full *:flex-1 *:min-h-0 max-w-[unset]',
    entries: [
      {
        type: 'custom',
        aliasesId: 'usageSettingsCustomEntryAliases',
        component: UsageSettingsSection,
      },
    ],
  },
]
