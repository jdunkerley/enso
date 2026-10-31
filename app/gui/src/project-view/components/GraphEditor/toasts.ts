import type { ModuleStore } from '$/providers/openedProjects/module'
import { requiredImportToAst } from '$/providers/openedProjects/module/imports'
import type { ProjectStore } from '$/providers/openedProjects/project'
import type { ProjectNameStore } from '$/providers/openedProjects/projectNames'
import type { ToValue } from '$/utils/reactivity'
import { useToast } from '@/util/toast'
import { onScopeDispose, toValue, watch } from 'vue'

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

/**
 * A composable which sets up several toasts for project management, and creates one for message
 * about user's action error.
 */
export function useGraphEditorToasts(projectStore: ProjectStore) {
  const toastStartup = useToast.info({ autoClose: false })
  const toastConnectionLost = useToast.error({ autoClose: false })
  const toastLspError = useToast.error()
  const toastExecutionFailed = useToast.error()
  const toastUserActionFailed = useToast.error()

  toastStartup.show('Initializing the project. This can take up to one minute.')
  projectStore.firstExecution.then(toastStartup.dismiss)

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
  projectStore.executionContext.on('executionFailed', (e) =>
    toastExecutionFailed.show(`Execution Failed: ${JSON.stringify(e)}`),
  )

  return { userActionFailed: toastUserActionFailed }
}
