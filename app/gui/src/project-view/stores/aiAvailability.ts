/** @file Reactive "can the local Claude agent serve turns?" state shared across the ProjectView UI. */

import { proxyRefs } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import type { AiAvailability } from 'enso-common/src/ai'
import { computed, ref } from 'vue'

const NO_DESKTOP_RUNTIME: AiAvailability = {
  status: 'unavailable',
  reason: 'AI component generation is only available in the Enso desktop app.',
}

function createAiAvailabilityStore() {
  const state = ref<AiAvailability>({ status: 'starting' })
  const loaded = ref(false)
  let pushed = false

  const electronApi = typeof window === 'undefined' ? undefined : window.api
  const promise =
    electronApi != null ? electronApi.ai.availability() : Promise.resolve(NO_DESKTOP_RUNTIME)

  electronApi?.ai.onAvailabilityChanged((next) => {
    pushed = true
    state.value = next
  })
  // A push that overtakes the initial query carries the newer state; don't let the snapshot
  // taken before it land on top.
  promise
    .then((initial) => {
      if (!pushed) state.value = initial
    })
    .finally(() => (loaded.value = true))

  return proxyRefs({
    availability: state,
    ready: computed(() => state.value.status === 'ready'),
    loaded,
    promise,
  })
}

/**
 * Availability of the local Claude agent, seeded from the Electron main process and kept in
 * sync as the agent primes, crashes, or rotates. `ready` is the flag the UI gates AI mode on;
 * the full {@link AiAvailability} explains a non-ready state to the user.
 */
export const useAiAvailability = createGlobalState(createAiAvailabilityStore)
