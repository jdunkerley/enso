/** @file The user's update preferences (Settings → Local). */
import { createPersistedStore } from '$/utils/persistedStore'
import { computed } from 'vue'
import { z } from 'zod'

interface UpdateSettings {
  readonly includePrereleases: boolean
}

const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { includePrereleases: false }
const UPDATE_SETTINGS_SCHEMA = z.object({
  includePrereleases: z.boolean().default(DEFAULT_UPDATE_SETTINGS.includePrereleases),
})

const updateSettingsStore = createPersistedStore<UpdateSettings>(
  () => ({ ...DEFAULT_UPDATE_SETTINGS }),
  {
    name: 'enso-update-settings',
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = UPDATE_SETTINGS_SCHEMA.safeParse(persistedState)
      return parsed.success ? { ...currentState, ...parsed.data } : currentState
    },
  },
)

/** Whether the updater offers prereleases (`rc`, `nightly`) as well as releases. */
export function useIncludePrereleases() {
  return computed(() => updateSettingsStore.state.value.includePrereleases)
}

/** Sets {@link useIncludePrereleases}. */
export function setIncludePrereleases(includePrereleases: boolean) {
  updateSettingsStore.setState({ includePrereleases })
}
