/** @file The sub-pages of the settings page, and their icons. */
import type { Icon } from '@/util/iconMetadata/iconName'

/** A sub-page of the settings page. */
enum SettingsTabType {
  account = 'account',
  local = 'local',
  appearance = 'appearance',
  keyboardShortcuts = 'keyboard-shortcuts',
}

export default SettingsTabType

/**
 * The icon of each settings tab. Shared by the settings sidebar and the keyboard bindings that
 * open each tab.
 */
export const SETTINGS_TAB_ICONS: Readonly<Record<SettingsTabType, Icon>> = {
  [SettingsTabType.account]: 'settings',
  [SettingsTabType.local]: 'system',
  [SettingsTabType.appearance]: 'paint_palette',
  [SettingsTabType.keyboardShortcuts]: 'keyboard_shortcuts',
}
