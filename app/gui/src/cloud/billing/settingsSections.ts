/**
 * @file The Usage settings tab's section: a month's scheduled executions. Loaded with the settings
 * page (`registerBillingSettings`). The tab itself (name, icon, visibility, its `scheduler` paywall
 * feature) is declared by the core, in `#/layouts/Settings/tabs.ts`.
 */
import type { SettingsSectionData } from '$/configurations/settings'
import UsageSettingsSection from './UsageSettingsSection.vue'

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
