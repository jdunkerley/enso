/** @file The sub-pages of the settings page, and their icons. */
import type { Icon } from '@/util/iconMetadata/iconName'

/** A sub-page of the settings page. */
enum SettingsTabType {
  account = 'account',
  organization = 'organization',
  local = 'local',
  // features = 'features',
  // notifications = 'notifications',
  billingAndPlans = 'billing-and-plans',
  members = 'members',
  userGroups = 'user-groups',
  appearance = 'appearance',
  keyboardShortcuts = 'keyboard-shortcuts',
  // dataCoPilot = 'data-co-pilot',
  // featurePreview = 'feature-preview',
  activityLog = 'activity-log',
  // compliance = 'compliance',
  // usageStatistics = 'usage-statistics',
  apiKeys = 'api-keys',
  usage = 'usage',
}

export default SettingsTabType

/**
 * The icon of each settings tab. Shared by the settings sidebar and the keyboard bindings that
 * open each tab.
 */
export const SETTINGS_TAB_ICONS: Readonly<Record<SettingsTabType, Icon>> = {
  [SettingsTabType.account]: 'settings',
  [SettingsTabType.organization]: 'people_settings',
  [SettingsTabType.local]: 'system',
  [SettingsTabType.billingAndPlans]: 'credit_card',
  [SettingsTabType.members]: 'people',
  [SettingsTabType.userGroups]: 'people_settings',
  [SettingsTabType.appearance]: 'paint_palette',
  [SettingsTabType.keyboardShortcuts]: 'keyboard_shortcuts',
  [SettingsTabType.activityLog]: 'log',
  [SettingsTabType.apiKeys]: 'key',
  [SettingsTabType.usage]: 'credit_card',
}
