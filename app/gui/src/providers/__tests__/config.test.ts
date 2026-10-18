/** @file The IDE is local-only: the remote configuration is empty, and nothing is fetched for it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('the configuration store', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockClear()
  })

  it('has an empty remote configuration, and fetches nothing for it', async () => {
    const { useConfig } = await import('../config')
    const config = useConfig()
    expect(config.remoteConfig).toEqual({})
    await expect(config.waitForRemoteConfig()).resolves.toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('needs no query client: it can be created outside a Vue app', async () => {
    const { useConfig } = await import('../config')
    expect(() => useConfig()).not.toThrow()
  })
})
