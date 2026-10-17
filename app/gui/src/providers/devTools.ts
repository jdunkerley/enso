/** @file A store with the developer overrides that outlived the Enso devtools panel. */
import { createGlobalState } from '@vueuse/core'
import { reactive } from 'vue'

/** A store keeping the developer overrides. */
export type EnsoDevtoolsStore = ReturnType<typeof createDevtoolsStore>

/** Create an {@link EnsoDevtoolsStore}. */
export function createDevtoolsStore() {
  return reactive({ showVersionChecker: false as boolean | null })
}

export const useDevtoolsStore = createGlobalState(createDevtoolsStore)
