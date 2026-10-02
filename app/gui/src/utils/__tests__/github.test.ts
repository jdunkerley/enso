/**
 * @file The latest-release check (#180): this fork's releases, quiet when there is none or the
 * request fails.
 */
import {
  getDownloadUrl,
  getLatestRelease,
  ReleaseCheckError,
  RELEASES_REPOSITORY,
} from '$/utils/github'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const RELEASE = {
  // GitHub's field names.
  /* eslint-disable camelcase */
  tag_name: '2099.1.1',
  published_at: '2099-01-01T00:00:00Z',
  html_url: `https://github.com/${RELEASES_REPOSITORY}/releases/tag/2099.1.1`,
  assets: [
    { browser_download_url: 'https://example.com/enso.exe' },
    { browser_download_url: 'https://example.com/enso.dmg' },
    { browser_download_url: 'https://example.com/enso.AppImage' },
  ],
  /* eslint-enable camelcase */
}

const fetchMock = vi.fn<typeof fetch>()
const loud = {
  error: vi.spyOn(console, 'error'),
  warn: vi.spyOn(console, 'warn'),
  log: vi.spyOn(console, 'log'),
  info: vi.spyOn(console, 'info'),
}

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  for (const spy of Object.values(loud)) spy.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  // Nothing above `console.debug`, whatever happened.
  for (const spy of Object.values(loud)) expect(spy).not.toHaveBeenCalled()
})

test("the fork's releases, not upstream's", () => {
  expect(RELEASES_REPOSITORY).toBe('jdunkerley/enso')
})

test('a release: returned, and cached', async () => {
  fetchMock.mockResolvedValue(Response.json(RELEASE))
  expect(await getLatestRelease()).toEqual(RELEASE)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://api.github.com/repos/jdunkerley/enso/releases/latest',
  )
  expect(await getLatestRelease()).toEqual(RELEASE)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(await getDownloadUrl()).toMatch(/^https:\/\/example\.com\/enso\./)
})

test('no release yet (404): null, cached, and no download URL', async () => {
  fetchMock.mockResolvedValue(Response.json({ message: 'Not Found' }, { status: 404 }))
  expect(await getLatestRelease()).toBeNull()
  expect(await getLatestRelease()).toBeNull()
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(await getDownloadUrl()).toBeNull()
})

test.each([
  ['offline', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['rate-limited (403)', () => Promise.resolve(Response.json({}, { status: 403 }))],
  ['rate-limited (429)', () => Promise.resolve(Response.json({}, { status: 429 }))],
  ['a body that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ['JSON that is not a release', () => Promise.resolve(Response.json({ foo: 1 }))],
])('a failed check (%s): a quiet error, not cached', async (_name, respond) => {
  fetchMock.mockImplementation(respond)
  await expect(getLatestRelease()).rejects.toBeInstanceOf(ReleaseCheckError)
  await expect(getLatestRelease()).rejects.toBeInstanceOf(ReleaseCheckError)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(await getDownloadUrl()).toBeNull()
})
