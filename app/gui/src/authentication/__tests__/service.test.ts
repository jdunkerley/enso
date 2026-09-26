import { useAuthDisabled, type AmplifyConfig } from '$/authentication/service'
import type { RemoteConfig } from '$/providers/config'
import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'

function fakeAmplifyConfig(): AmplifyConfig {
  return {
    region: 'eu-west-1',
    endpoint: undefined,
    userPoolId: 'pool',
    userPoolWebClientId: 'client',
    urlOpener: null,
    saveAccessToken: null,
    domain: '',
    scope: [],
    redirectsSignIn: [],
    redirectsSignOut: [],
    responseType: 'code',
  }
}

/** The config query's state while its first fetch is in flight. */
function pendingConfig() {
  return reactive({
    remoteConfig: undefined as RemoteConfig | undefined,
    isError: false,
    isFetching: true,
  })
}

type ConfigState = ReturnType<typeof pendingConfig>

/**
 * What TanStack Query does to a query when it re-fetches: the fetch status becomes `fetching`, and
 * a query with no data also goes back to pending status, which clears its error.
 */
function startRefetch(config: ConfigState) {
  if (config.remoteConfig === undefined) config.isError = false
  config.isFetching = true
}

describe('useAuthDisabled', () => {
  it('is false until the remote configuration has settled', () => {
    const config = pendingConfig()
    const authDisabled = useAuthDisabled(config, ref(undefined))
    expect(authDisabled.value).toBe(false)
  })

  it('is true once the remote configuration fails to load', () => {
    const config = pendingConfig()
    const authDisabled = useAuthDisabled(config, ref(undefined))
    config.isFetching = false
    config.isError = true
    expect(authDisabled.value).toBe(true)
  })

  it('stays true while a failed remote configuration is re-fetched', () => {
    const config = pendingConfig()
    const authDisabled = useAuthDisabled(config, ref(undefined))
    config.isFetching = false
    config.isError = true
    expect(authDisabled.value).toBe(true)

    startRefetch(config)
    expect(config.isError).toBe(false)
    expect(authDisabled.value).toBe(true)

    config.isFetching = false
    config.isError = true
    expect(authDisabled.value).toBe(true)
  })

  it('stays true while a remote configuration without Cognito is re-fetched', () => {
    const config = pendingConfig()
    const authDisabled = useAuthDisabled(config, ref(undefined))
    config.remoteConfig = {}
    config.isFetching = false
    expect(authDisabled.value).toBe(true)

    startRefetch(config)
    expect(authDisabled.value).toBe(true)
  })

  it('stays false when the remote configuration provides Cognito, even while re-fetching', () => {
    const config = pendingConfig()
    const amplifyConfig = ref<AmplifyConfig | undefined>(undefined)
    const authDisabled = useAuthDisabled(config, amplifyConfig)
    config.remoteConfig = {
      ENSO_IDE_COGNITO_USER_POOL_ID: 'pool',
      ENSO_IDE_COGNITO_USER_POOL_WEB_CLIENT_ID: 'client',
    }
    amplifyConfig.value = fakeAmplifyConfig()
    config.isFetching = false
    expect(authDisabled.value).toBe(false)

    startRefetch(config)
    expect(authDisabled.value).toBe(false)
    config.isFetching = false
    expect(authDisabled.value).toBe(false)
  })
})
