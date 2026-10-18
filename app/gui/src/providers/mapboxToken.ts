/**
 * @file The user's Mapbox access token, which the map visualization (`GeoMapVisualization.vue`)
 * gives to Mapbox GL. The user enters it in Settings → Local → Maps (decision 8 of
 * `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`); it is kept in `localStorage` and
 * sent nowhere but Mapbox. There is no fetch and no refresh: it is the user's own token.
 */
import { createPersistedStore } from '$/utils/persistedStore'
import { computed } from 'vue'
import { z } from 'zod'

/** The Maps settings. */
export interface MapboxSettings {
  /** `null` while the user has entered none. */
  readonly accessToken: string | null
}

const MAPBOX_SETTINGS_SCHEMA = z.object({
  accessToken: z.string().min(1).nullable().default(null),
})

export const mapboxSettingsStore = createPersistedStore<MapboxSettings>(
  () => ({ accessToken: null }),
  {
    name: 'enso-mapbox-settings',
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = MAPBOX_SETTINGS_SCHEMA.safeParse(persistedState)
      return parsed.success ? { ...currentState, ...parsed.data } : currentState
    },
  },
)

/** The user's Mapbox access token, or `null`. Reactive. */
export function useMapboxToken() {
  return computed(() => mapboxSettingsStore.state.value.accessToken)
}

/** Save the token; a blank one clears it. */
export function setMapboxToken(token: string) {
  const trimmed = token.trim()
  mapboxSettingsStore.setState({ accessToken: trimmed === '' ? null : trimmed })
}
