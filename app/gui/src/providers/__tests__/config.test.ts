import { withSetup } from '@/util/testing'
import { focusManager, onlineManager, useQueryClient } from '@tanstack/vue-query'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Let a re-fetch start, if anything triggered one. */
async function settle() {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('remote configuration', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // `useConfig` is a global singleton; load a fresh module so each test gets its own query.
    vi.resetModules()
    fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
  })

  async function loadConfig() {
    const { useConfig } = await import('../config')
    const config = withSetup(() => useConfig())
    await expect.poll(() => config.remoteConfig).toEqual({})
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

  it('is still fetched on start when a copy was restored from the persisted cache', async () => {
    const { useConfig } = await import('../config')
    const config = withSetup(() => {
      useQueryClient().setQueryData(['config', $config.API_URL ?? 'https://api.cloud.enso.org'], {
        ENSO_IDE_ENVIRONMENT: 'restored',
      })
      return useConfig()
    })
    await expect.poll(() => config.remoteConfig).toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is not re-fetched when the network reconnects', async () => {
    await loadConfig()
    onlineManager.setOnline(false)
    onlineManager.setOnline(true)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
