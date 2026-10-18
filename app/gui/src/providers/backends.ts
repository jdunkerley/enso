import { download } from '$/utils/download'
import { proxyRefs, type ToValue } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import { BackendType, Path } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { ProjectManager } from 'enso-common/src/services/ProjectManager/ProjectManager'
import invariant from 'tiny-invariant'
import { computed, inject, ref, toValue, watch, watchEffect } from 'vue'
import { localPathsStore } from './localDirectories'
import { useText, type GetText } from './text'

export type BackendsStore = ReturnType<typeof useBackends>
function initializeBackends(rootDirPath: ToValue<string | undefined>, getText: GetText) {
  const createProjectManager = (rootPath: string | undefined) => {
    if (!rootPath) return
    const rootDirectory = Path(rootPath)
    return new ProjectManager(rootDirectory)
  }
  const projectManager = ref<ProjectManager>()
  watchEffect(() => {
    const pm = createProjectManager(toValue(rootDirPath))
    projectManager.value = pm
  })
  const localBackend = computed(() =>
    projectManager.value ?
      new LocalBackend(
        getText,
        projectManager.value,
        undefined,
        download,
        () => localPathsStore.getState().localRootDirectory,
        window.api?.system?.getFilePath,
      )
    : null,
  )
  watch(
    () => getText,
    (getText) => {
      localBackend.value?.setGetText(getText)
    },
  )

  const backendForType = (_projectType: BackendType) => {
    invariant(
      localBackend.value,
      'Attempted to get a local backend for local project, but no local backend was provided.',
    )
    return localBackend.value
  }

  return proxyRefs({
    localBackend,
    backendForType,
  })
}

export const useBackends = createGlobalState(() =>
  initializeBackends(inject('rootDirPath'), useText().getText),
)
