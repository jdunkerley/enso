import LocalStorage from '$/utils/LocalStorage'
import * as analytics from '$/utils/analytics'
import { proxyRefs } from '$/utils/reactivity'
import type { Opt } from '@/util/data/opt'
import { createGlobalState } from '@vueuse/core'
import {
  BackendType,
  type ProjectId,
  type ProjectSessionId,
} from 'enso-common/src/services/Backend'
import { Err } from 'enso-common/src/utilities/data/result'
import { computed, onScopeDispose, reactive, readonly, ref, watchEffect } from 'vue'
import { useRoute, useRouter, type RouteLocation, type RouteLocationRaw } from 'vue-router'
import * as z from 'zod'
import { useBackends } from './backends'
import { useOpenedProjects } from './openedProjects'
import {
  PROJECT_ID_SCHEMA,
  PROJECT_SESSION_ID_SCHEMA,
  RUNNING_PROJECT_INFO_SCHEMA,
  type ProjectInfo,
  type RunningProjectInfo,
} from './openedProjects/projectInfo'

const PROJECT_TAB_SCHEMA = z.object({ type: z.literal('project'), id: PROJECT_ID_SCHEMA })
/**
 * A session log tab. `projectId` lets its session picker list the project's other sessions; tabs
 * saved before it existed have none, and show their own session alone.
 */
const PROJECT_LOG_TAB_SCHEMA = z.object({
  type: z.literal('projectLog'),
  id: PROJECT_SESSION_ID_SCHEMA,
  title: z.string(),
  projectId: PROJECT_ID_SCHEMA.optional(),
})
const SETTINGS_TAB_SCHEMA = z.object({ type: z.literal('settings') })
const TAB_SCHEMA = z.discriminatedUnion('type', [
  PROJECT_TAB_SCHEMA,
  SETTINGS_TAB_SCHEMA,
  PROJECT_LOG_TAB_SCHEMA,
])
const OPENED_TAB_SCHEMA = z.intersection(
  TAB_SCHEMA,
  z.object({ runningProject: z.optional(RUNNING_PROJECT_INFO_SCHEMA) }),
)
const DEFAULT_FOCUS: Panel = { type: 'drive' }
const PROJECT_LOG_PARAMS_SCHEMA = z.object({
  id: PROJECT_SESSION_ID_SCHEMA,
  title: z.string(),
  // An optional route parameter that is absent is `''`.
  projectId: z.preprocess(
    (value) => (value === '' ? undefined : value),
    PROJECT_ID_SCHEMA.optional(),
  ),
})

/** A structure identifying tab displayed in the TabView. */
export type Tab = z.infer<typeof TAB_SCHEMA>
/** A structure identifying a project tab displayed in the TabView. */
export type ProjectTab = z.infer<typeof PROJECT_TAB_SCHEMA>
/** A structure identifying a project log tab displayed in the TabView. */
export type ProjectLogTab = z.infer<typeof PROJECT_LOG_TAB_SCHEMA>
type OpenedTab = z.infer<typeof OPENED_TAB_SCHEMA>

/** A structure identifying one of the GUI panels. */
export type Panel = Tab | { type: 'drive' }

declare module '$/utils/LocalStorage' {
  interface LocalStorageData {
    readonly openedTabs: (Tab & { runningProject?: RunningProjectInfo | undefined })[]
    readonly rightPanelWidth: number
    readonly leftPanelWidth: number
    readonly leftPanelToggledOn: boolean
  }
}

LocalStorage.registerKey('openedTabs', { schema: z.array(OPENED_TAB_SCHEMA) })
LocalStorage.registerKey('rightPanelWidth', { schema: z.number() })
LocalStorage.registerKey('leftPanelWidth', { schema: z.number() })
LocalStorage.registerKey('leftPanelToggledOn', { schema: z.boolean(), default: true })

/** Get tab which should be displayed when navigated to this route. */
export function tabFromRoute(route: RouteLocation): Tab | null {
  switch (route.name) {
    case 'project': {
      const id = PROJECT_ID_SCHEMA.safeParse(route.params.id)
      if (!id.success) return null
      return { type: 'project' as const, id: id.data }
    }
    case 'projectLog': {
      const parsed = PROJECT_LOG_PARAMS_SCHEMA.safeParse(route.params)
      if (!parsed.success) return null
      const { id, title, projectId } = parsed.data
      return {
        type: 'projectLog' as const,
        id,
        title,
        ...(projectId != null && { projectId }),
      }
    }
    case 'settings':
      return { type: 'settings' as const }
    default:
      return null
  }
}

/** Get route to navigate to show given tab. Keeps the query from previous route. */
export function routeFromTab(tab: Opt<Tab>, from: RouteLocation): RouteLocationRaw {
  switch (tab?.type) {
    case 'project':
      return { name: 'project', params: { id: tab.id }, query: from.query }
    case 'projectLog': {
      const { id, title, projectId } = tab
      return {
        name: 'projectLog',
        params: { id, title, projectId: projectId ?? '' },
        query: from.query,
      }
    }
    case 'settings':
      return { name: 'settings', query: from.query }
    case undefined:
    case null:
      return { name: 'dashboard', query: from.query }
  }
}

/**
 * The session log tab to keep when Show Logs opens `tab`, given the tab saved for that session:
 * `tab` when none is saved, or when the saved one (from before tabs had a project) lacks the
 * project `tab` has; otherwise `null`, and the saved tab stays.
 */
export function sessionLogTabToSave(saved: Tab | undefined, tab: ProjectLogTab): Tab | null {
  if (saved == null) return tab
  const upgrade = saved.type === 'projectLog' && saved.projectId == null && tab.projectId != null
  return upgrade ? tab : null
}

/** A key string of panel. May be used as Set element or Map key. */
export function panelKey(panel: Opt<Panel>) {
  switch (panel?.type) {
    case 'project':
      return `project/${panel.id}`
    case 'projectLog':
      return `projectLog/${panel.id}`
    case 'settings':
    case 'drive':
      return panel.type
    default:
      return ''
  }
}

type PanelKey = ReturnType<typeof panelKey>

/**
 * Compare two panels.
 * `null` and `undefined` are considered equal.
 */
export function panelEquals(a: Opt<Panel>, b: Opt<Panel>) {
  return panelKey(a) === panelKey(b)
}

export type ContainerData = ReturnType<typeof useContainerData>
function createContainerStore() {
  const router = useRouter()
  const route = useRoute()
  const openedProjects = useOpenedProjects()
  const localStorage = LocalStorage.getInstance()
  const modesForBackend = useModesForBackend()
  const tabs = reactive(new Map<PanelKey, Tab>())
  const visitingOrder = reactive(new Set<PanelKey>())
  const focusedPanel = ref<Panel>(DEFAULT_FOCUS)

  const currentTab = computed<Tab | null>({
    get: () => tabFromRoute(route),
    set: (tab) => {
      if (panelEquals(tab, currentTab.value)) return
      const key = panelKey(tab)
      visitingOrder.delete(key)
      visitingOrder.add(key)
      router.push(routeFromTab(tab, route))
    },
  })

  const tabList = computed(() => [...tabs.values()])

  const nextTab = computed(() => {
    const lastVisitedKey = [...visitingOrder.values()][visitingOrder.size - 1]
    const lastVisited = lastVisitedKey ? tabs.get(lastVisitedKey) : null
    if (lastVisited != null) return lastVisited
    else return tabList.value[tabList.value.length - 1] ?? null
  })

  const leftPanelWidth = localStorage.ref('leftPanelWidth')
  const leftPanelToggledOn = localStorage.ref('leftPanelToggledOn')
  const rightPanelWidth = localStorage.ref('rightPanelWidth')

  const middlePanelShown = computed(() => tabList.value.length > 0)
  const leftPanelShown = computed(() => leftPanelToggledOn.value || !middlePanelShown.value)

  function isTabOpened(tab: Tab) {
    return tabs.has(panelKey(tab))
  }

  function isCurrentTab(tab: Panel) {
    return panelEquals(tab, currentTab.value)
  }

  /**
   * Add project tab to list if not already opened, and open the project in backend.
   *
   * When the user asked for it (`userAction`), the tab becomes the current one straight away, so
   * the graph pane shows the project's loading spinner (or its failure) while the project opens,
   * just as it does for a project restored at startup. Otherwise the tab is only added: the
   * callers which pass `false` are already navigating to the project's route themselves.
   */
  function openProjectTab(info: ProjectInfo, userAction = true) {
    const tab: Tab = { type: 'project', id: info.id }
    openedProjects.openProject(info)
    if (!isTabOpened(tab)) {
      tabs.set(panelKey(tab), tab)
      analytics.workflowOpened()
    }
    if (userAction) currentTab.value = tab
  }

  /**
   * Add a session log tab to the list, and show it. A tab saved for the session before tabs had a
   * project gets it now, so its session picker lists the project's sessions.
   */
  function openProjectLogTab(id: ProjectSessionId, title: string, projectId?: ProjectId) {
    const tab: ProjectLogTab = {
      type: 'projectLog',
      id,
      title,
      ...(projectId != null && { projectId }),
    }
    const key = panelKey(tab)
    const saved = tabs.get(key)
    const toSave = sessionLogTabToSave(saved, tab)
    if (toSave != null) tabs.set(key, toSave)
    // Showing the same tab again changes no route; an upgraded one needs its project in the route.
    if (saved != null && toSave != null && isCurrentTab(tab)) {
      void router.replace(routeFromTab(toSave, route))
    } else {
      currentTab.value = toSave ?? saved ?? tab
    }
  }

  /** Checks if project with given backend type may be opened locally. */
  function canOpenProjectLocally(backend: BackendType) {
    return modesForBackend.value.locally[backend] != null
  }

  /** Open project locally, by asset data and backend type. */
  function openProjectLocally(
    info: Omit<ProjectInfo, 'mode'>,
    backend: BackendType,
    userAction = true,
  ) {
    const mode = modesForBackend.value.locally[backend]
    if (mode != null) {
      return openProjectTab({ ...info, mode }, userAction)
    }
  }

  /** Checks if project with given backend type may be opened natively. */
  function canOpenProjectNatively(backend: BackendType) {
    return modesForBackend.value.natively[backend] != null
  }

  /** Open project natively, by asset data and backend type. */
  function openProjectNatively(
    info: Omit<ProjectInfo, 'mode'>,
    backend: BackendType,
    userAction = true,
  ) {
    const mode = modesForBackend.value.natively[backend]
    if (mode != null) {
      return openProjectTab({ ...info, mode }, userAction)
    }
  }

  /** Add settings tab to list if missing, and open it. */
  function openSettingsTab(userAction = true) {
    const tab: Tab = { type: 'settings' }
    if (!isTabOpened(tab)) {
      tabs.set(panelKey(tab), tab)
    }
    if (userAction) {
      currentTab.value = tab
    }
  }

  /** Close given tab. The project will be closed in backend too. */
  function closeTab(tab: Tab) {
    const key = panelKey(tab)
    const removed = tabs.delete(key)
    if (!removed) return Err(`Tab to close not found: ${key}`)
    visitingOrder.delete(key)
    if (isCurrentTab(tab)) {
      currentTab.value = nextTab.value
    }
    if (tab.type === 'project') {
      analytics.workflowClosed()
      openedProjects.closeProject(tab.id)
    }
  }

  /** Close current tab. See {@link closeTab} */
  function closeCurrentTab() {
    if (currentTab.value != null) closeTab(currentTab.value)
  }

  /**
   * Set currently focused panel
   *
   * This is different from browser's focus. It decides what is displayed in the Right Panel,
   * and what shortcuts will be handled in case of conflict.
   */
  function setFocusedPanel(panel: Opt<Panel>) {
    const newPanel = panel ?? DEFAULT_FOCUS
    if (!panelEquals(newPanel, focusedPanel.value)) {
      focusedPanel.value = newPanel
    }
  }

  /**
   * Read and restore projects from local storage, and then keep the storage up-to-date about
   * currently opened projects.
   */
  function syncWithLocalStorage() {
    for (const tab of localStorage.get('openedTabs') ?? []) {
      if (tab.runningProject != null) openedProjects.restoreProject(tab.runningProject)
      // If there is no project info, we cannot open tab.
      else if (tab.type === 'project') continue
      tabs.set(panelKey(tab), tab)
    }

    return watchEffect(() => {
      const openedTabs: OpenedTab[] = []
      for (const [_, tab] of tabs) {
        let runningProject: RunningProjectInfo | undefined
        if (tab.type === 'project') {
          const project = openedProjects.get(tab.id)
          switch (project?.state.status) {
            case 'opened':
            case 'initialized':
            case 'to-restore':
              runningProject = project.state.info
              break
          }
        }
        openedTabs.push({ ...tab, runningProject })
      }
      localStorage.set('openedTabs', openedTabs)
    })
  }

  const stopSyncing = syncWithLocalStorage()
  onScopeDispose(stopSyncing)

  return proxyRefs({
    currentTab,
    nextTab,
    tabList,
    focusedPanel: readonly(focusedPanel),
    setFocusedPanel,
    leftPanelWidth,
    leftPanelToggledOn,
    rightPanelWidth,
    middlePanelShown,
    leftPanelShown,
    isTabOpened,
    isCurrentTab,
    openProjectTab,
    openProjectLogTab,
    canOpenProjectLocally,
    openProjectLocally,
    canOpenProjectNatively,
    openProjectNatively,
    openSettingsTab,
    closeTab,
    closeCurrentTab,
  })
}

/**
 * Return structure specifying a project opening mode for local/native runs, and if they are
 * available to the user.
 */
function useModesForBackend() {
  const backends = useBackends()
  return computed(() => {
    // Projects run only locally, and only when there is a local backend.
    const modes: Record<BackendType, 'local' | null> = {
      [BackendType.local]: backends.localBackend != null ? 'local' : null,
    }
    return { locally: modes, natively: modes }
  })
}

export const useContainerData = createGlobalState(createContainerStore)
