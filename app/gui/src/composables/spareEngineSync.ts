/**
 * @file Sends Settings → Local → Engine's "Pre-start the engine" to the project service
 * (`engine/setSpare`) once the local backend is there and whenever the setting changes; until the
 * first one the service starts no spare engine. The answer says whether projects get the JVM
 * engine, which shows the setting (`engineRunsOnJvm`). Nothing is sent without a local backend.
 */
import { useBackends } from '$/providers/backends'
import { engineRunsOnJvm, spareEngineSettingsStore } from '$/providers/spareEngineSettings'
import { watch } from 'vue'

type LocalBackend = NonNullable<ReturnType<typeof useBackends>['localBackend']>

interface Request {
  readonly backend: LocalBackend
  readonly preStart: boolean
}

/**
 * Keep the project service's spare engine in step with the setting. Requests go one at a time, so
 * the service ends on the last value; changes made while one is in flight are coalesced into the
 * latest, and only the answer to the latest request is kept.
 */
export function useSpareEngineSync() {
  const backends = useBackends()
  let latest: Request | null = null
  let draining = false

  async function drain() {
    draining = true
    try {
      while (latest != null) {
        const { backend, preStart } = latest
        latest = null
        let runsOnJvm = false
        try {
          const { engineMode } = await backend.setSpareEngine(preStart)
          runsOnJvm = engineMode === 'jvm'
        } catch (error) {
          // An old service or a failed request: no JVM engine is reported, so the section stays hidden.
          console.warn('Could not send the engine pre-start setting to the project service:', error)
        }
        // A newer request is waiting: its answer will replace this one.
        if (latest == null) engineRunsOnJvm.value = runsOnJvm
      }
    } finally {
      draining = false
    }
  }

  watch(
    [() => backends.localBackend, () => spareEngineSettingsStore.state.value.preStart] as const,
    ([backend, preStart]) => {
      if (backend == null) return
      latest = { backend, preStart }
      if (!draining) void drain()
    },
    { immediate: true },
  )
}
