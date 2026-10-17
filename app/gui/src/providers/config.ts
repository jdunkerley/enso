import { proxyRefs } from '$/utils/reactivity'
import { createGlobalState } from '@vueuse/core'
import { parseWebAppOptionsFromSearchParams } from 'enso-common/src/options'
import { computed } from 'vue'

/**
 * The keys the Enso Cloud's remote configuration used to carry. The IDE is local-only
 * (`docs/superpowers/specs/2026-10-17-local-only-ide-design.md`): nothing is fetched, and the
 * configuration is always empty. The type stays while the dormant secrets forms read it (decision
 * 5); PR 4 removes it with the cloud variables.
 */
export interface RemoteConfig {
  readonly ENSO_IDE_ENVIRONMENT?: string
  readonly ENSO_IDE_API_URL?: string
  readonly ENSO_IDE_AUTH_ENDPOINT?: string
  readonly ENSO_IDE_STRIPE_KEY?: string
  readonly ENSO_IDE_COGNITO_USER_POOL_ID?: string
  readonly ENSO_IDE_COGNITO_USER_POOL_WEB_CLIENT_ID?: string
  readonly ENSO_IDE_COGNITO_DOMAIN?: string
  readonly ENSO_IDE_COGNITO_REGION?: string
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
