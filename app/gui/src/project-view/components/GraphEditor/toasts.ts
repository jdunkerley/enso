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
 * error diagnostic of the latest status (or else the failure's message), instead of leaving the
 * start-up toast forever (#600). The project store records it from the execution context's
 * creation (`startupFailure`, `project/startupFailure.ts`), so a failure before this view mounts
 * is not missed. A start-up failure in a tab that is not active is shown when the tab is, and is
 * hidden with it (a queued one too) until the user closes it; a later `executionComplete` (the
 * project fixed) dismisses it. Unmounting the view dismisses both (`useToast`'s scope).
 *
 * A library the runtime could not load is reported by name whether the first execution fails or
 * completes with nothing computed (the issue's stale edition): `useUnresolvedLibrariesToast`
 * (Note [The Edition Switch]) shows it, and while it has a library to name, the generic start-up
 * failure is not shown.
 */
/**
 * A composable which sets up several toasts for project management, and creates one for message
 * about user's action error.
 */
export function useGraphEditorToasts(
  projectStore: Pick<
    ProjectStore,
    'firstExecution' | 'startupFailure' | 'lsRpcConnection' | 'executionContext'
  > &
    Partial<Pick<ProjectStore, 'libraryLoadFailures'>>,
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
  // The libraries' own toast names the cause (Note [The Edition Switch]).
  const librariesNamed = () =>
    projectStore.libraryLoadFailures?.some((failure) => failure.library != null) ?? false
  const showStartup = () => {
    if (!active) return
    if (startup === 'running') toastStartup.show(STARTUP_MESSAGE)
    else if (typeof startup === 'object' && !startup.shown && !librariesNamed()) {
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
    if (typeof startup === 'object' && toastStartupFailed.isPending()) {
      startup.shown = false
      toastStartupFailed.dismiss()
    }
  })
  watch(librariesNamed, (named) => {
    if (!named || typeof startup !== 'object' || !toastStartupFailed.isPending()) return
    startup.shown = false
    toastStartupFailed.dismiss()
  })
  projectStore.firstExecution.then(() => {
    if (startup !== 'running') return
    startup = 'done'
    toastStartup.dismiss()
  })
  watch(
    () => projectStore.startupFailure,
    (failed) => {
      if (failed != null) {
        if (startup === 'done' || (typeof startup === 'object' && startup.failed === failed)) return
        startup = { failed, shown: false }
        toastStartup.dismiss()
        toastStartupFailed.dismiss()
        showStartup()
      } else if (typeof startup === 'object') {
        // Started after all (the user fixed the edition, say).
        startup = 'done'
        toastStartupFailed.dismiss()
      }
    },
    { immediate: true, flush: 'sync' },
  )

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
  projectStore.executionContext.on('executionComplete', () => toastExecutionFailed.dismiss())
  projectStore.executionContext.on('executionFailed', (e) => {
    // Before the project has started, the start-up failure toast says it.
    if (startup !== 'done') return
    toastExecutionFailed.show(`Execution Failed: ${JSON.stringify(e)}`)
  })

  return { userActionFailed: toastUserActionFailed }
}
