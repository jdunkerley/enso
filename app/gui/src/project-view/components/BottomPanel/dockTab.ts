/** @file Which tab of the bottom dock shows: remembered across reloads, shared by every project tab. */
import { createContextStore } from '@/providers'
import { useLocalStorage } from '@vueuse/core'
import { readonly, ref, type Ref } from 'vue'

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

/** What {@link toggleDockTab} did. */
export type DockToggleResult = 'opened' | 'switched' | 'closed'

/**
 * A tab's shortcut (`Mod+\`` for Code, `Mod+L` for Logs): open the closed dock on `target`, switch
 * the open dock to `target`, or close the dock if `target` already shows.
 */
export function toggleDockTab(
  show: Ref<boolean>,
  tab: Ref<DockTab>,
  target: DockTab,
): DockToggleResult {
  if (show.value && tab.value === target) {
    show.value = false
    return 'closed'
  }
  const result = show.value ? 'switched' : 'opened'
  tab.value = target
  show.value = true
  return result
}

/**
 * The handlers of the tabs' shortcuts, `graph.toggleCodeEditor` and `graph.toggleLogs` (see
 * {@link toggleDockTab}). Switching the open dock from Logs to Code also asks the code editor to take
 * focus, as a click on the Code tab does; opening the dock on Code mounts the editor, which takes
 * focus by itself.
 */
export function dockTabActions(
  show: Ref<boolean>,
  tab: Ref<DockTab>,
  codeTabFocus: { request: () => void },
) {
  return {
    'graph.toggleCodeEditor': {
      action: () => {
        if (toggleDockTab(show, tab, 'code') === 'switched') codeTabFocus.request()
      },
      toggled: () => show.value && tab.value === 'code',
    },
    'graph.toggleLogs': {
      action: () => void toggleDockTab(show, tab, 'logs'),
      toggled: () => show.value && tab.value === 'logs',
    },
  }
}

/**
 * Asks the Code tab's content (the code editor) to take keyboard focus. It is requested when the
 * user switches the open dock from Logs to Code (a click on the tab, or the Code shortcut); nothing
 * else does, so re-activating a kept-alive project tab or resizing the dock never takes focus from
 * the graph. `GraphEditor.vue` provides it (its shortcut handler requests it); a dock with no
 * provider above it provides its own.
 */
function codeTabFocus() {
  const requests = ref(0)
  return {
    /** Counts the requests: watch it (`flush: 'post'`, once the Code tab is shown) to take focus. */
    requests: readonly(requests),
    request: () => void (requests.value += 1),
  }
}

export const [provideCodeTabFocus, useCodeTabFocus] = createContextStore(
  'Code tab focus',
  codeTabFocus,
)
