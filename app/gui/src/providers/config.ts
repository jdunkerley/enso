import { proxyRefs } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import { parseWebAppOptionsFromSearchParams } from 'enso-common/src/options'
import { computed } from 'vue'

/**
 * The keys the Enso Cloud's remote configuration used to carry. The IDE is local-only
 * (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`): nothing is fetched, and the
 * configuration is always empty. The type is kept for the four `*_OAUTH_CLIENT_ID` keys that the
 * dormant secrets screens still read (decision 5).
 */
export interface RemoteConfig {
  readonly ENSO_IDE_GOOGLE_OAUTH_CLIENT_ID?: string
  readonly ENSO_IDE_STRAVA_OAUTH_CLIENT_ID?: string
  readonly ENSO_IDE_MS365_OAUTH_CLIENT_ID?: string
  readonly ENSO_IDE_SALESFORCE_OAUTH_CLIENT_ID?: string
}

const EMPTY_REMOTE_CONFIG: RemoteConfig = Object.freeze({})

export type ConfigStore = ReturnType<typeof createConfigStore>

function createConfigStore() {
  return proxyRefs({
    params: computed(() =>
      parseWebAppOptionsFromSearchParams(new URLSearchParams(window.location.search)),
    ),
    remoteConfig: computed((): RemoteConfig => EMPTY_REMOTE_CONFIG),
    waitForRemoteConfig: () => Promise.resolve(EMPTY_REMOTE_CONFIG),
  })
}

export const useConfig = createGlobalState(createConfigStore)
