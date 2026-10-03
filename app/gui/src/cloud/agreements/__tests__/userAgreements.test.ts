/**
 * @file The user's agreement state behind the agreements gate (moved unchanged from
 * `$/composables/userAgreements` by #84): what counts as agreed, and what accepting records.
 */
import LocalStorage from '$/utils/LocalStorage'
import { createTestQueryClient } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'
import { useUserAgreements } from '../userAgreements'

const latest = { tos: 'tos-2', privacy: 'privacy-2' }
const fetchMock = vi.fn(async (url: URL | string) => {
  const path = new URL(url).pathname
  const hash =
    path === '/eula.json' ? latest.tos
    : path === '/privacy.json' ? latest.privacy
    : null
  return hash == null ?
      new Response(null, { status: 404 })
    : new Response(JSON.stringify({ hash }), { status: 200 })
})

const localStorage = LocalStorage.getInstance()
const scopes: ReturnType<typeof effectScope>[] = []

async function load() {
  const scope = effectScope()
  scopes.push(scope)
  const agreements = await scope.run(() => useUserAgreements(createTestQueryClient()))!
  await flushPromises()
  return agreements
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  localStorage.delete('termsOfService')
  localStorage.delete('privacyPolicy')
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
})

describe('useUserAgreements', () => {
  test('a user who never accepted has agreed to neither', async () => {
    const agreements = await load()
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([`${$config.HOST}/eula.json`, `${$config.HOST}/privacy.json`]),
    )
    expect(agreements.agreedToTos).toBe(false)
    expect(agreements.agreedToPrivacyPolicy).toBe(false)
  })

  test('accepting records the current versions, which then count as agreed', async () => {
    const agreements = await load()
    agreements.userAgreed()
    expect(localStorage.get('termsOfService')).toEqual({ versionHash: 'tos-2' })
    expect(localStorage.get('privacyPolicy')).toEqual({ versionHash: 'privacy-2' })
    expect(agreements.agreedToTos).toBe(true)
    expect(agreements.agreedToPrivacyPolicy).toBe(true)
  })

  test('a user who accepted the current versions has agreed to both', async () => {
    localStorage.set('termsOfService', { versionHash: 'tos-2' })
    localStorage.set('privacyPolicy', { versionHash: 'privacy-2' })
    const agreements = await load()
    expect(agreements.agreedToTos).toBe(true)
    expect(agreements.agreedToPrivacyPolicy).toBe(true)
  })

  test('a changed document must be accepted again', async () => {
    localStorage.set('termsOfService', { versionHash: 'tos-1' })
    localStorage.set('privacyPolicy', { versionHash: 'privacy-2' })
    const agreements = await load()
    await vi.waitFor(() => expect(agreements.agreedToTos).toBe(false))
    expect(agreements.agreedToPrivacyPolicy).toBe(true)
  })

  test('a failed fetch of a document never accepted fails the load', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 500 }))
    await expect(load()).rejects.toThrow()
  })
})
