/**
 * @file The right panel's Versions and Schedule tabs, contributed by `registerCloud` and loaded
 * when each first opens.
 */
import { contributeRightPanelTab } from '$/providers/rightPanelContributions'

/** Give the right panel its Versions and Schedule (executions calendar) tabs. */
export function registerVersionsTabs() {
  contributeRightPanelTab('versions', () => import('./AssetVersions.vue'))
  contributeRightPanelTab('executionsCalendar', () => import('./ProjectExecutionsCalendar.vue'))
}
