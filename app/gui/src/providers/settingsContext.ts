/**
 * @file The settings page's context (`SettingsContext`: the user, their organization, the backends,
 * the local directories, …), provided by the settings page to the components of its entries.
 */
import type { SettingsContext } from '$/configurations/settings'
import { createContextStore } from '@/providers'
import type { Ref } from 'vue'

export const [provideSettingsContext, useSettingsContext] = createContextStore(
  'settingsContext',
  (context: Readonly<Ref<SettingsContext>>) => context,
)
