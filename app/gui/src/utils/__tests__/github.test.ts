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

/** A release with the given tag, as GitHub lists them. */
function tagged(tag: string, extra: object = {}) {
  /* eslint-disable camelcase */
  return {
    ...RELEASE,
    tag_name: tag,
    assets: ['exe', 'dmg', 'AppImage'].map((ext) => ({
      browser_download_url: `https://example.com/${tag}.${ext}`,
    })),
    ...extra,
  }
  /* eslint-enable camelcase */
}

test('with prereleases: the newest by version, not by listing order, over all releases', async () => {
  // GitHub lists by creation date: the rc of the next release is older than the patch here.
  fetchMock.mockResolvedValue(
    Response.json([
      tagged('2026.1.1-rc.2'),
      tagged('2026.1.1-rc.10'),
      tagged('2026.1.0'),
      tagged('not-a-version'),
    ]),
  )
  expect((await getLatestRelease(true))?.tag_name).toBe('2026.1.1-rc.10')
  expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/repos\/jdunkerley\/enso\/releases\?/)
  expect(await getDownloadUrl(true)).toMatch(/^https:\/\/example\.com\/2026\.1\.1-rc\.10\./)
})

test('with prereleases: a release is newer than its own rcs, and drafts are ignored', async () => {
  fetchMock.mockResolvedValue(
    Response.json([
      tagged('2026.1.1-rc.3'),
      tagged('2026.1.1'),
      tagged('2099.1.1', { draft: true }),
    ]),
  )
  expect((await getLatestRelease(true))?.tag_name).toBe('2026.1.1')
})

test('with prereleases: nightlies are not offered, as in auto mode', async () => {
  fetchMock.mockResolvedValue(
    Response.json([tagged('2026.3.0-nightly.2026.11.1'), tagged('2026.1.1-rc.2')]),
  )
  expect((await getLatestRelease(true))?.tag_name).toBe('2026.1.1-rc.2')
})

test('with prereleases: no release (404) or none that is a version is null', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ message: 'Not Found' }, { status: 404 }))
  expect(await getLatestRelease(true)).toBeNull()
  localStorage.clear()
  fetchMock.mockResolvedValueOnce(Response.json([tagged('nightly')]))
  expect(await getLatestRelease(true)).toBeNull()
})

test('with prereleases: a body that is not a list of releases is a quiet error', async () => {
  fetchMock.mockResolvedValue(Response.json({ foo: 1 }))
  await expect(getLatestRelease(true)).rejects.toBeInstanceOf(ReleaseCheckError)
})

test('the stable and the prerelease answers are cached apart', async () => {
  fetchMock.mockImplementation(async (url) =>
    Response.json(String(url).includes('/latest') ? tagged('2026.1.0') : [tagged('2026.2.0-rc.1')]),
  )
  expect((await getLatestRelease(false))?.tag_name).toBe('2026.1.0')
  expect((await getLatestRelease(true))?.tag_name).toBe('2026.2.0-rc.1')
  expect((await getLatestRelease(false))?.tag_name).toBe('2026.1.0')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
