/** @file The right panel's Properties tab, contributed by `registerCloud` and loaded when it first opens. */
import { contributeRightPanelTab } from '$/providers/rightPanelContributions'

/** Give the right panel its Properties tab. */
export function registerPropertiesTab() {
  contributeRightPanelTab('settings', () => import('./AssetProperties.vue'))
}
