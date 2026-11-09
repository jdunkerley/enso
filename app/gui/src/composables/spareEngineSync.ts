/**
 * @file Sends Settings → Local → Engine's "Pre-start the engine" to the project service
 * (`engine/setSpare`) once the local backend is there and whenever the setting changes; until the
 * first one the service starts no spare engine. The answer says whether projects get the JVM
 * engine, which shows the setting (`engineRunsOnJvm`). Nothing is sent without a local backend.
 */
import { useBackends } from '$/providers/backends'
import { engineRunsOnJvm, spareEngineSettingsStore } from '$/providers/spareEngineSettings'
import { watch } from 'vue'

/** Keep the project service's spare engine in step with the setting. */
export function useSpareEngineSync() {
  const backends = useBackends()
  watch(
    [() => backends.localBackend, () => spareEngineSettingsStore.state.value.preStart] as const,
    async ([backend, preStart]) => {
      if (backend == null) return
      try {
        const { engineMode } = await backend.setSpareEngine(preStart)
        engineRunsOnJvm.value = engineMode === 'jvm'
      } catch (error) {
        // An old service or a failed request: no JVM engine is reported, so the section stays hidden.
        engineRunsOnJvm.value = false
        console.warn('Could not send the engine pre-start setting to the project service:', error)
      }
    },
    { immediate: true },
  )
}
