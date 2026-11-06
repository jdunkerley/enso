import type { ModuleStore } from '$/providers/openedProjects/module'
import { requiredImportToAst } from '$/providers/openedProjects/module/imports'
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { ToValue } from '$/utils/reactivity'
import { useToast } from '@/util/toast'
import { onActivated, onDeactivated, onScopeDispose, toValue, watch } from 'vue'

/**
 * One notice listing the imports a project needed when it opened: code from before a type moved
 * to a library of its own, or written in another editor.
 */
export function useImportsAddedOnOpenToast(
  module: ToValue<Pick<ModuleStore, 'importsAddedOnOpen'>>,
  projectNames: ProjectNameStore,
) {
  const toast = useToast.info()
  watch(
    () => toValue(module).importsAddedOnOpen,
    (added) => {
      if (added.length === 0) return
      const lines = added.map((imp) => requiredImportToAst(imp, projectNames).code())
      toast.show(
        `Added ${added.length === 1 ? 'an import' : 'imports'} this project needed: ${lines.join('; ')}`,
      )
      toValue(module).importsAddedOnOpen = []
    },
    { immediate: true },
  )
}

/* Note [The Start-up Toast Belongs To Its Project]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * "Initializing the project" stays until the project's first execution ends. Toasts are app-wide,
 * but each opened project's view is kept alive in its own tab (`MiddlePanel.vue`), so the toast is
 * shown only while its view is the active one: hidden on `onDeactivated`, shown again on
 * `onActivated` if the project is still starting. A first execution can also fail, for example
 * when the project's edition or libraries cannot be resolved: the Language Server then reports
 * error diagnostics (`Package containing the module Standard.Base.Main could not be loaded: …`)
 * followed by `executionFailed` with an unhelpful message (`NoSuchElementException`), and never
 * `executionComplete`. That replaces the start-up toast with one that stays, naming the first
 * error diagnostic (or else the failure's message), instead of leaving the start-up toast forever
 * (#600). A start-up failure in a tab that is not active is shown when the tab is, and hidden with
 * it until the user closes it; a later `executionComplete` (the project fixed) dismisses it.
 */
/**
 * A composable which sets up several toasts for project management, and creates one for message
 * about user's action error.
 */
export function useGraphEditorToasts(
  projectStore: Pick<ProjectStore, 'firstExecution' | 'lsRpcConnection' | 'executionContext'>,
) {
  const toastStartup = useToast.info({ autoClose: false })
  const toastStartupFailed = useToast.error({ autoClose: false })
  const toastConnectionLost = useToast.error({ autoClose: false })
  const toastLspError = useToast.error()
  const toastExecutionFailed = useToast.error()
  const toastUserActionFailed = useToast.error()

  // Note [The Start-up Toast Belongs To Its Project].
  const STARTUP_MESSAGE = 'Initializing the project. This can take up to one minute.'
  let startup: 'running' | 'done' | { failed: string; shown: boolean } = 'running'
  let active = true
  let firstError: string | undefined
  const showStartup = () => {
    if (!active) return
    if (startup === 'running') toastStartup.show(STARTUP_MESSAGE)
    else if (typeof startup === 'object' && !startup.shown) {
      startup.shown = true
      toastStartupFailed.show(`The project could not be started: ${startup.failed}`)
    }
  }
  showStartup()
  onActivated(() => {
    active = true
    showStartup()
  })
  onDeactivated(() => {
    active = false
    toastStartup.dismiss()
    // Shown again with the tab, unless the user has closed it.
    if (typeof startup === 'object' && toastStartupFailed.isActive()) {
      startup.shown = false
      toastStartupFailed.dismiss()
    }
  })
  projectStore.firstExecution.then(() => {
    if (startup !== 'running') return
    startup = 'done'
    toastStartup.dismiss()
  })
  projectStore.executionContext.on('executionStatus', (diagnostics) => {
    if (startup === 'running') firstError ??= diagnostics.find((d) => d.kind === 'Error')?.message
  })

  const offTransportClosed = projectStore.lsRpcConnection.on('transport/closed', () =>
    toastConnectionLost.show('Lost connection to Language Server.'),
  )
  const offTransportConnected = projectStore.lsRpcConnection.on('transport/connected', () =>
    toastConnectionLost.dismiss(),
  )
  onScopeDispose(() => {
    offTransportClosed()
    offTransportConnected()
  })

  projectStore.lsRpcConnection.client.onError((e) =>
    toastLspError.show(`Language server error: ${e}`),
  )
  projectStore.executionContext.on('executionComplete', () => {
    toastExecutionFailed.dismiss()
    // Started after all (the user fixed the edition, say).
    if (typeof startup === 'object') {
      startup = 'done'
      toastStartupFailed.dismiss()
    }
  })
  projectStore.executionContext.on('executionFailed', (e) => {
    if (startup === 'running') {
      startup = { failed: firstError ?? e, shown: false }
      toastStartup.dismiss()
      showStartup()
      return
    }
    toastExecutionFailed.show(`Execution Failed: ${JSON.stringify(e)}`)
  })

  return { userActionFailed: toastUserActionFailed }
}
