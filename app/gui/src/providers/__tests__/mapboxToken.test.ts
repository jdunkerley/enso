/** @file The Mapbox token is the user's own, from Settings: stored locally, never fetched. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const KEY = 'enso-mapbox-settings'

async function load() {
  vi.resetModules()
  return await import('../mapboxToken')
}

describe('the Mapbox token', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  test('is absent until the user enters one, and nothing is fetched for it', async () => {
    const { useMapboxToken } = await load()
    expect(useMapboxToken().value).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('is saved trimmed, and survives a restart', async () => {
    const { setMapboxToken, useMapboxToken } = await load()
    const token = useMapboxToken()
    setMapboxToken('  pk.abc  ')
    expect(token.value).toBe('pk.abc')
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      state: { accessToken: 'pk.abc' },
      version: 1,
    })
    expect((await load()).useMapboxToken().value).toBe('pk.abc')
  })

  test('a blank value clears it', async () => {
    const { setMapboxToken, useMapboxToken } = await load()
    setMapboxToken('pk.abc')
    setMapboxToken('   ')
    expect(useMapboxToken().value).toBeNull()
  })

  test('a malformed saved value is ignored', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { accessToken: 42 }, version: 1 }))
    expect((await load()).useMapboxToken().value).toBeNull()
  })
})
