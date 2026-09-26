import type { RemoteConfig } from '$/providers/config'
import { createQueryClient, type QueryClient } from '$/utils/queryClient'
import { focusManager, onlineManager, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from 'vue'

const CONFIG_QUERY_KEY = ['config', $config.API_URL ?? 'https://api.cloud.enso.org']
const PERSISTED_CONFIG: RemoteConfig = { ENSO_IDE_ENVIRONMENT: 'persisted' }
const NETWORK_CONFIG: RemoteConfig = { ENSO_IDE_ENVIRONMENT: 'network' }

/** Let a re-fetch start, if anything triggered one. */
async function settle() {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
}

/** An in-memory stand-in for the IndexedDB store the app persists its query cache to. */
function createMemoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: async (key: string) => items.get(key),
    setItem: async (key: string, value: string) => void items.set(key, value),
    removeItem: async (key: string) => void items.delete(key),
    clear: async () => items.clear(),
    entries: async () => [...items.entries()],
  }
}

type MemoryStorage = ReturnType<typeof createMemoryStorage>

/**
 * Persist a configuration the way a previous run of the app would have, dated a minute before this
 * app start.
 */
async function persistConfigFromPreviousRun(storage: MemoryStorage) {
  const previousRun = await createQueryClient({ persisterStorage: storage })
  await previousRun.fetchQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: () => Promise.resolve(PERSISTED_CONFIG),
  })
  await expect.poll(() => storage.items.size).toBe(1)
  const [[key, value]] = [...storage.items.entries()] as [[string, string]]
  const entry = JSON.parse(value)
  entry.state.dataUpdatedAt = Date.now() - 60_000
  storage.items.set(key, JSON.stringify(entry))
}

describe('remote configuration', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let app: App | undefined

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(NETWORK_CONFIG), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
  })

  /** Start the app's config store on `queryClient`. */
  async function startConfig(queryClient: QueryClient) {
    // `useConfig` is a global singleton that also records when the app started; load a fresh
    // module so each test is a fresh app start.
    vi.resetModules()
    const { useConfig } = await import('../config')
    let config: ReturnType<typeof useConfig> | undefined
    app = createApp({
      setup() {
        config = useConfig()
        return () => {}
      },
    })
    app.use(VueQueryPlugin, { queryClient })
    app.mount(document.createElement('div'))
    return config!
  }

  /** Start the config store on a query client with the app's own defaults, and let it load. */
  async function loadConfig() {
    const config = await startConfig(await createQueryClient())
    await expect.poll(() => config.remoteConfig).toEqual(NETWORK_CONFIG)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    return config
  }

  it('is not re-fetched when the window regains focus', async () => {
    await loadConfig()
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    window.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is not re-fetched when the network reconnects', async () => {
    await loadConfig()
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is not re-fetched on focus or reconnect after failing to load (local-only mode)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    const config = await startConfig(await createQueryClient())
    // Let the initial fetch exhaust its retries.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(config.isError).toBe(true)
    const initialFetches = fetchMock.mock.calls.length

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    window.dispatchEvent(new Event('visibilitychange'))
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(initialFetches)
    expect(config.isError).toBe(true)
  })

  it('replaces a configuration persisted by a previous run with one fetch on start', async () => {
    const storage = createMemoryStorage()
    await persistConfigFromPreviousRun(storage)

    const config = await startConfig(await createQueryClient({ persisterStorage: storage }))
    await expect.poll(() => config.remoteConfig).toEqual(NETWORK_CONFIG)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    focusManager.setFocused(false)
    focusManager.setFocused(true)
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(config.remoteConfig).toEqual(NETWORK_CONFIG)
  })
})
