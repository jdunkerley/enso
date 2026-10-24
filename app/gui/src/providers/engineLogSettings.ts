/**
 * @file Extra engine logging (Settings → Local → Engine logs): SQL queries and performance timings,
 * both off by default. They are passed to an engine when a project opens
 * (`engineLoggingArgs`, `enso-common/src/services/engineLogs`), so a change applies from the next
 * time a project's engine starts. The Logs panel shows a source tickbox for each while it is on.
 */
import { createPersistedStore } from '$/utils/persistedStore'
import type { EngineLoggingOptions } from 'enso-common/src/services/engineLogs'
import { computed, type ComputedRef } from 'vue'
import { z } from 'zod'

/** The two settings, as stored. */
export interface EngineLogSettings {
  readonly sqlQueries: boolean
  readonly performanceTimings: boolean
}

const DEFAULT_ENGINE_LOG_SETTINGS: EngineLogSettings = {
  sqlQueries: false,
  performanceTimings: false,
}
const ENGINE_LOG_SETTINGS_SCHEMA = z.object({
  sqlQueries: z.boolean().default(DEFAULT_ENGINE_LOG_SETTINGS.sqlQueries),
  performanceTimings: z.boolean().default(DEFAULT_ENGINE_LOG_SETTINGS.performanceTimings),
})

/** Exported for tests. */
export const engineLogSettingsStore = createPersistedStore<EngineLogSettings>(
  () => ({ ...DEFAULT_ENGINE_LOG_SETTINGS }),
  {
    name: 'enso-engine-log-settings',
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = ENGINE_LOG_SETTINGS_SCHEMA.safeParse(persistedState)
      return parsed.success ? { ...currentState, ...parsed.data } : currentState
    },
  },
)

/** The current settings, reactively. */
export function useEngineLogSettings(): ComputedRef<EngineLogSettings> {
  return computed(() => engineLogSettingsStore.state.value)
}

/** Change one or both settings. */
export function setEngineLogSettings(settings: Partial<EngineLogSettings>) {
  engineLogSettingsStore.setState(settings)
}

/** The options an engine started now is given. */
export function engineLoggingOptions(): EngineLoggingOptions {
  const { sqlQueries, performanceTimings } = engineLogSettingsStore.getState()
  return { sqlQueries, performanceTimings }
}
