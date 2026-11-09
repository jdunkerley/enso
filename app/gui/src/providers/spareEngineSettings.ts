/**
 * @file Settings → Local → Engine: "Pre-start the engine", on by default. The project service keeps
 * a warmed-up spare engine while no project is open (spec
 * `docs/superpowers/specs/2026-11-08-jvm-warm-engine-design.md`). `useSpareEngineSync` sends it
 * this value when the dashboard loads and whenever it changes, and keeps the answer: the section
 * shows only when projects get the JVM engine.
 */
import { createPersistedStore } from '$/utils/persistedStore'
import { computed, ref, type ComputedRef } from 'vue'
import { z } from 'zod'

/** The setting, as stored. */
export interface SpareEngineSettings {
  readonly preStart: boolean
}

const DEFAULT_SPARE_ENGINE_SETTINGS: SpareEngineSettings = { preStart: true }
const SPARE_ENGINE_SETTINGS_SCHEMA = z.object({
  preStart: z.boolean().default(DEFAULT_SPARE_ENGINE_SETTINGS.preStart),
})

/** Exported for tests. */
export const spareEngineSettingsStore = createPersistedStore<SpareEngineSettings>(
  () => ({ ...DEFAULT_SPARE_ENGINE_SETTINGS }),
  {
    name: 'enso-spare-engine-settings',
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = SPARE_ENGINE_SETTINGS_SCHEMA.safeParse(persistedState)
      return parsed.success ? { ...currentState, ...parsed.data } : currentState
    },
  },
)

/** Whether the engine is pre-started, reactively. */
export function usePreStartEngine(): ComputedRef<boolean> {
  return computed(() => spareEngineSettingsStore.state.value.preStart)
}

/** Change the setting; `useSpareEngineSync` sends it on. */
export function setPreStartEngine(preStart: boolean) {
  spareEngineSettingsStore.setState({ preStart })
}

/** Whether projects get the JVM engine: the project service's answer to `engine/setSpare`. */
export const engineRunsOnJvm = ref(false)
