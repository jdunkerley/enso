/** @file Which tab of the bottom dock shows: remembered across reloads, shared by every project tab. */
import { useLocalStorage } from '@vueuse/core'
import type { Ref } from 'vue'

/** The bottom dock's tabs. */
export type DockTab = 'code' | 'logs'

/** The tabs in display order. */
export const DOCK_TABS: readonly DockTab[] = ['code', 'logs']

/** Its own key: the dock's height stays under `code-editor-size`, in the shape it has always had. */
export const DOCK_TAB_STORAGE_KEY = 'bottom-dock-tab'

/** The selected tab, saved in local storage. */
export function useDockTab(): Ref<DockTab> {
  const tab = useLocalStorage<DockTab>(DOCK_TAB_STORAGE_KEY, 'code')
  if (tab.value !== 'code' && tab.value !== 'logs') tab.value = 'code'
  return tab
}

/** Open the dock on `target`; close it if `target` is already showing. */
export function toggleDockTab(show: Ref<boolean>, tab: Ref<DockTab>, target: DockTab): void {
  if (show.value && tab.value === target) {
    show.value = false
  } else {
    tab.value = target
    show.value = true
  }
}
