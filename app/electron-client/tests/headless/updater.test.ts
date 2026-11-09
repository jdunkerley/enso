/** @file The automatic-update state machine (`src/updater.ts`), against a fake `electron-updater`. */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { UpdateStatus } from 'enso-common/src/updater'
import { resolveUpdateMode, Updater, type UpdaterDeps } from '../../src/updater'

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = false
  logger: unknown = null
  checkForUpdates = vi.fn(async () => null)
  downloadUpdate = vi.fn(async () => [])
  quitAndInstall = vi.fn()
}

function setup(
  mode: 'auto' | 'manual' = 'auto',
  confirmNoStableRelease: (allowCached: boolean) => Promise<boolean> = async () => false,
  beforeInstall?: () => Promise<void>,
) {
  const autoUpdater = new FakeAutoUpdater()
  const statuses: UpdateStatus[] = []
  const deps: UpdaterDeps = {
    autoUpdater: autoUpdater as unknown as UpdaterDeps['autoUpdater'],
    mode,
    onStatus: (status) => statuses.push(status),
    confirmNoStableRelease,
    ...(beforeInstall != null ? { beforeInstall } : {}),
  }
  return { autoUpdater, statuses, updater: new Updater(deps) }
}

describe('Updater', () => {
  test('asks before downloading, and installs on quit', () => {
    const { autoUpdater } = setup()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  test('reports an available update, honouring the prerelease setting', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit('update-available', {
        version: '2026.2.0-rc.1',
        releaseDate: '2026-11-01',
      })
      return null
    })
    const status = await updater.check(true)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(status).toEqual({
      state: 'available',
      version: '2026.2.0-rc.1',
      releaseDate: '2026-11-01',
    })
  })

  test('reports no update', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit('update-not-available', { version: '2026.1.1' })
      return null
    })
    expect(await updater.check(false)).toEqual({ state: 'none' })
    expect(autoUpdater.allowPrerelease).toBe(false)
  })

  test('a failed check becomes an error status instead of throwing', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))
    expect(await updater.check(false)).toEqual({
      state: 'error',
      message: 'offline',
      version: null,
    })
  })

  test('downloads with progress, then is ready', async () => {
    const { autoUpdater, statuses, updater } = setup()
    autoUpdater.emit('update-available', {
      version: '2026.2.0',
      releaseDate: '',
    })
    autoUpdater.downloadUpdate.mockImplementation(async () => {
      autoUpdater.emit('download-progress', { percent: 42 })
      autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
      return []
    })
    await updater.download()
    expect(statuses).toContainEqual({
      state: 'downloading',
      version: '2026.2.0',
      percent: 0,
    })
    expect(statuses).toContainEqual({
      state: 'downloading',
      version: '2026.2.0',
      percent: 42,
    })
    expect(updater.status()).toEqual({ state: 'ready', version: '2026.2.0' })
  })

  test('a failed download keeps the version so the dialog can retry', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.emit('update-available', {
      version: '2026.2.0',
      releaseDate: '',
    })
    autoUpdater.downloadUpdate.mockRejectedValue(new Error('sha512 checksum mismatch'))
    await updater.download()
    expect(updater.status()).toEqual({
      state: 'error',
      message: 'sha512 checksum mismatch',
      version: '2026.2.0',
    })
  })

  test('does not re-check while downloading or once ready', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
    expect(await updater.check(false)).toEqual({
      state: 'ready',
      version: '2026.2.0',
    })
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  test('installs silently and relaunches', async () => {
    const { autoUpdater, updater } = setup()
    await updater.quitAndInstall()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  test('the install waits for beforeInstall (the spare engine stopping)', async () => {
    let release!: () => void
    const beforeInstall = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { autoUpdater, updater } = setup('auto', undefined, beforeInstall)
    const installing = updater.quitAndInstall()
    await vi.waitFor(() => expect(beforeInstall).toHaveBeenCalledOnce())
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    release()
    await installing
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  test('a failing beforeInstall does not stop the install', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { autoUpdater, updater } = setup('auto', undefined, async () => {
      throw new Error('no spare')
    })
    await updater.quitAndInstall()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('manual mode never touches electron-updater', async () => {
    const { autoUpdater, updater } = setup('manual')
    expect(await updater.check(true)).toEqual({ state: 'idle' })
    await updater.download()
    await updater.quitAndInstall()
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('resolveUpdateMode', () => {
  const packaged = {
    isPackaged: true,
    platform: 'win32' as const,
    appImage: undefined,
  }
  test.each([
    ['a packaged auto build', 'auto', packaged, 'auto'],
    ['a manual build', 'manual', packaged, 'manual'],
    ['an unpackaged run', 'auto', { ...packaged, isPackaged: false }, 'manual'],
    ['Linux outside an AppImage', 'auto', { ...packaged, platform: 'linux' as const }, 'manual'],
    [
      'an AppImage',
      'auto',
      { ...packaged, platform: 'linux' as const, appImage: '/a/Enso.AppImage' },
      'auto',
    ],
  ] as const)('%s', (_name, buildMode, environment, expected) => {
    expect(resolveUpdateMode(buildMode, environment)).toBe(expected)
  })
})

describe('Updater guards', () => {
  const available = { version: '2026.2.0', releaseDate: '' }

  test.each(['checking', 'downloading', 'ready', 'none', 'idle'])(
    'download() does nothing from %s',
    async (state) => {
      const { autoUpdater, updater } = setup()
      if (state === 'checking') {
        autoUpdater.checkForUpdates.mockImplementation(() => new Promise(() => {}))
        void updater.check(false)
      } else if (state === 'downloading') {
        autoUpdater.emit('update-available', available)
        autoUpdater.downloadUpdate.mockImplementation(() => new Promise(() => {}))
        void updater.download()
      } else if (state === 'ready') {
        autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
      } else if (state === 'none') {
        autoUpdater.emit('update-not-available', {})
      }
      autoUpdater.downloadUpdate.mockClear()
      const before = updater.status()
      await updater.download()
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(updater.status()).toEqual(before)
    },
  )

  test('download() does not start from an error without a version', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockRejectedValue(new Error('offline'))
    await updater.check(false)
    await updater.download()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  test('download() retries from an error with a version', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.emit('update-available', available)
    autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('boom'))
    await updater.download()
    await updater.download()
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  test('an error event once ready is ignored', () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
    autoUpdater.emit('error', new Error('late'))
    expect(updater.status()).toEqual({ state: 'ready', version: '2026.2.0' })
  })

  test.each(['checking', 'downloading', 'ready'])(
    'check() during %s changes nothing',
    async (state) => {
      const { autoUpdater, updater } = setup()
      if (state === 'checking') {
        autoUpdater.checkForUpdates.mockImplementation(() => new Promise(() => {}))
        void updater.check(false)
      } else if (state === 'downloading') {
        autoUpdater.emit('update-available', available)
        autoUpdater.downloadUpdate.mockImplementation(() => new Promise(() => {}))
        void updater.download()
      } else {
        autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
      }
      autoUpdater.checkForUpdates.mockClear()
      const before = updater.status()
      await updater.check(true)
      expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
      expect(autoUpdater.allowPrerelease).toBe(false)
      expect(updater.status()).toEqual(before)
    },
  )

  test('a check that fires no event settles to none', async () => {
    const { updater } = setup()
    expect(await updater.check(false)).toEqual({ state: 'none' })
  })

  test('an error that is both emitted and rejected is published once', async () => {
    const { autoUpdater, statuses, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      const error = new Error('offline')
      autoUpdater.emit('error', error)
      throw error
    })
    await updater.check(false)
    expect(statuses.filter((s) => s.state === 'error')).toHaveLength(1)
  })

  test('manual mode keeps its status after a check', async () => {
    const { updater } = setup('manual')
    await updater.check(false)
    expect(updater.status()).toEqual({ state: 'idle' })
  })
})

describe('Updater stable fallback', () => {
  /** Answers each check by the `allowPrerelease` it sees: a prerelease check finds nothing. */
  function answerChecks(
    autoUpdater: FakeAutoUpdater,
    stable: () => Promise<null>,
    seen: boolean[] = [],
  ) {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      seen.push(autoUpdater.allowPrerelease)
      if (autoUpdater.allowPrerelease) {
        autoUpdater.emit('update-not-available', { version: '2026.1.1-rc.1' })
        return null
      }
      return stable()
    })
    return seen
  }

  test('an rc install that finds no prerelease is offered the stable release', async () => {
    const { autoUpdater, statuses, updater } = setup()
    const seen = answerChecks(autoUpdater, async () => {
      autoUpdater.emit('update-available', { version: '2026.1.1', releaseDate: '2026-11-01' })
      return null
    })
    expect(await updater.check(true)).toEqual({
      state: 'available',
      version: '2026.1.1',
      releaseDate: '2026-11-01',
    })
    expect(seen).toEqual([true, false])
    expect(autoUpdater.allowPrerelease).toBe(true)
    // The first, empty check is not reported: the status goes straight from checking.
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'available'])
  })

  test('no stable release either is none', async () => {
    const { autoUpdater, statuses, updater } = setup()
    answerChecks(autoUpdater, async () => {
      autoUpdater.emit('update-not-available', { version: '2026.1.0' })
      return null
    })
    expect(await updater.check(true)).toEqual({ state: 'none' })
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'none'])
  })

  test('a failed stable check (no stable release yet) is none, not an error', async () => {
    const { autoUpdater, statuses, updater } = setup()
    answerChecks(autoUpdater, async () => {
      const error = new Error('HttpError: 404 Not Found')
      autoUpdater.emit('error', error)
      throw error
    })
    expect(await updater.check(true)).toEqual({ state: 'none' })
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test('a stable check that fires no event settles to none', async () => {
    const { autoUpdater, updater } = setup()
    answerChecks(autoUpdater, async () => null)
    expect(await updater.check(true)).toEqual({ state: 'none' })
  })

  test('a prerelease that is found needs no second check', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit('update-available', { version: '2026.2.0-rc.1', releaseDate: '' })
      return null
    })
    await updater.check(true)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  /** An `electron-updater` failure, with its error code. */
  function coded(code: string, message: string) {
    return Object.assign(new Error(message), { code })
  }

  // Messages as `electron-updater` 6.8.3 and `builder-util-runtime` 9.5.1 produce them against
  // github.com (recorded from a run against this fork, which has no stable release: its
  // `/releases/latest` redirects to `/releases`, which answers 406 to `Accept: application/json`).
  const LATEST_NOT_FOUND =
    'Unable to find latest version on GitHub (https://github.com/jdunkerley/enso/releases/latest), ' +
    'please ensure a production release exists: HttpError: '
  const NO_STABLE_406 = coded(
    'ERR_UPDATER_INVALID_RELEASE_FEED',
    `Cannot parse releases feed: Error: ${LATEST_NOT_FOUND}406 Not Acceptable\n` +
      '"method: GET url: https://github.com/jdunkerley/enso/releases\\n\\n          Data:\\n          \\n          "\n' +
      'Headers: {\n  "date": "Thu, 05 Nov 2026 00:09:45 GMT",\n  "content-type": "text/html; charset=utf-8"\n}',
  )
  const SERVER_ERROR = coded(
    'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    `${LATEST_NOT_FOUND}500 Internal Server Error\n"method: GET url: https://github.com/jdunkerley/enso/releases/latest"`,
  )
  const OFFLINE = coded(
    'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    'Unable to find latest version on GitHub (https://github.com/jdunkerley/enso/releases/latest), ' +
      'please ensure a production release exists: Error: getaddrinfo ENOTFOUND github.com',
  )
  const NO_PUBLISHED = coded('ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'No published versions on GitHub')
  const NO_ENTRY = coded('ERR_XML_MISSED_ELEMENT', 'No published versions on GitHub')
  const BROKEN_RC = coded(
    'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
    'Cannot find rc.yml in the latest release artifacts (https://github.com/jdunkerley/enso/releases/download/2026.2.0-rc.1/rc.yml): HttpError: 404 Not Found',
  )

  /** Throws `prerelease` from the prerelease pass and `stable` from the stable one (or finds 2026.1.1). */
  function failing(
    autoUpdater: FakeAutoUpdater,
    prerelease: Error | null,
    stable: Error | null,
    seen: boolean[] = [],
  ) {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      seen.push(autoUpdater.allowPrerelease)
      const error = autoUpdater.allowPrerelease ? prerelease : stable
      if (error != null) {
        autoUpdater.emit('error', error)
        throw error
      }
      autoUpdater.emit('update-available', { version: '2026.1.1', releaseDate: '' })
      return null
    })
    return seen
  }

  test.each([
    ['no published versions', NO_PUBLISHED],
    ['an empty feed', NO_ENTRY],
  ])('a prerelease check that throws (%s) falls back to the stable release', async (_n, error) => {
    const { autoUpdater, statuses, updater } = setup()
    const seen = failing(autoUpdater, error, null)
    expect(await updater.check(true)).toEqual({
      state: 'available',
      version: '2026.1.1',
      releaseDate: '',
    })
    expect(seen).toEqual([true, false])
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test('nothing published, and no stable release either (confirmed by the API), is none', async () => {
    const confirm = vi.fn(async () => true)
    const { autoUpdater, statuses, updater } = setup('auto', confirm)
    failing(autoUpdater, NO_PUBLISHED, NO_STABLE_406)
    expect(await updater.check(true)).toEqual({ state: 'none' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test('nothing published, and the stable check really fails, is the stable error', async () => {
    const { autoUpdater, updater } = setup('auto', async () => false)
    failing(autoUpdater, NO_PUBLISHED, SERVER_ERROR)
    expect(await updater.check(true)).toEqual({
      state: 'error',
      message: SERVER_ERROR.message,
      version: null,
    })
  })

  test('both passes failing is an error, reporting the prerelease failure', async () => {
    const { autoUpdater, statuses, updater } = setup()
    failing(autoUpdater, BROKEN_RC, OFFLINE)
    expect(await updater.check(true)).toEqual({
      state: 'error',
      message: BROKEN_RC.message,
      version: null,
    })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(statuses.filter((s) => s.state === 'error')).toHaveLength(1)
  })

  test('a real prerelease failure and no stable release is none, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { autoUpdater, updater } = setup('auto', async () => true)
      failing(autoUpdater, BROKEN_RC, NO_STABLE_406)
      expect(await updater.check(true)).toEqual({ state: 'none' })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('No stable release'),
        BROKEN_RC.message,
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('without prereleases, no stable release (406, confirmed by the API) is none', async () => {
    const confirm = vi.fn(async () => true)
    const { autoUpdater, statuses, updater } = setup('auto', confirm)
    failing(autoUpdater, null, NO_STABLE_406)
    expect(await updater.check(false)).toEqual({ state: 'none' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test.each([
    ['the API does not say 404', NO_STABLE_406, async () => false],
    ['a server error', SERVER_ERROR, async () => false],
    ['offline', OFFLINE, async () => false],
    [
      'the confirmation itself fails',
      NO_STABLE_406,
      async (): Promise<boolean> => {
        throw new Error('rate limited')
      },
    ],
  ])('without prereleases, %s stays an error', async (_n, error, confirm) => {
    const { autoUpdater, updater } = setup('auto', confirm)
    failing(autoUpdater, null, error)
    expect(await updater.check(false)).toEqual({
      state: 'error',
      message: error.message,
      version: null,
    })
  })

  test.each([
    ['a feed that was not found (406)', NO_STABLE_406, true],
    ['a server error', SERVER_ERROR, true],
    ['offline', OFFLINE, false],
    ['nothing published', NO_PUBLISHED, false],
  ])('%s: a remembered answer is allowed: %s', async (_n, error, allowCached) => {
    const confirm = vi.fn(async (_allowCached: boolean) => true)
    const { autoUpdater, updater } = setup('auto', confirm)
    failing(autoUpdater, null, error)
    await updater.check(false)
    expect(confirm).toHaveBeenCalledWith(allowCached)
  })

  test('an error with another code is never sent to the API', async () => {
    const confirm = vi.fn(async () => true)
    const { autoUpdater, updater } = setup('auto', confirm)
    failing(autoUpdater, null, BROKEN_RC)
    expect(await updater.check(false)).toMatchObject({ state: 'error' })
    expect(confirm).not.toHaveBeenCalled()
  })

  test('without prereleases there is only one check', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      autoUpdater.emit('update-not-available', { version: '2026.1.1' })
      return null
    })
    expect(await updater.check(false)).toEqual({ state: 'none' })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  test('check() during the stable check changes nothing', async () => {
    const { autoUpdater, updater } = setup()
    let finishStable: () => void = () => {}
    answerChecks(
      autoUpdater,
      () => new Promise<null>((resolve) => (finishStable = () => resolve(null))),
    )
    const first = updater.check(true)
    await vi.waitFor(() => expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2))
    expect(await updater.check(true)).toEqual({ state: 'checking' })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    finishStable()
    expect(await first).toEqual({ state: 'none' })
  })
})

describe('confirmNoStableRelease', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A fresh copy of the module, so that no earlier answer is cached. */
  async function load(response: () => Promise<Response>) {
    const fetchMock = vi.fn<typeof fetch>(response)
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { confirmNoStableRelease } = await import('../../src/updater')
    return { confirmNoStableRelease, fetchMock }
  }

  test('a 404 from the API means no stable release, and is remembered', async () => {
    const { confirmNoStableRelease, fetchMock } = await load(
      async () => new Response('{}', { status: 404 }),
    )
    expect(await confirmNoStableRelease(true)).toBe(true)
    expect(await confirmNoStableRelease(true)).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.github.com/repos/jdunkerley/enso/releases/latest',
    )
  })

  test('the remembered 404 is not used unless allowed, and a later answer replaces it', async () => {
    let status = 404
    const { confirmNoStableRelease, fetchMock } = await load(
      async () => new Response('{}', { status }),
    )
    expect(await confirmNoStableRelease(true)).toBe(true)
    expect(await confirmNoStableRelease(false)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    status = 200
    expect(await confirmNoStableRelease(false)).toBe(false)
    expect(await confirmNoStableRelease(true)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  test('the remembered 404 lasts under ten minutes', async () => {
    vi.useFakeTimers()
    try {
      const { confirmNoStableRelease, fetchMock } = await load(
        async () => new Response('{}', { status: 404 }),
      )
      await confirmNoStableRelease(true)
      vi.advanceTimersByTime(9 * 60 * 1000)
      await confirmNoStableRelease(true)
      expect(fetchMock).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(2 * 60 * 1000)
      await confirmNoStableRelease(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([200, 403, 406, 500])('a %s from the API does not', async (status) => {
    const { confirmNoStableRelease } = await load(async () => new Response('{}', { status }))
    expect(await confirmNoStableRelease()).toBe(false)
  })

  test('no answer at all rejects, and is not remembered', async () => {
    const { confirmNoStableRelease, fetchMock } = await load(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(confirmNoStableRelease()).rejects.toThrow('fetch failed')
    await expect(confirmNoStableRelease()).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

const { handleMock, sendMock, windows } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
  windows: [] as { isDestroyed: () => boolean; send: (...args: unknown[]) => void }[],
}))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  ipcMain: { handle: handleMock },
  webContents: { getAllWebContents: () => windows },
}))

describe('initUpdaterIpc', () => {
  beforeEach(() => {
    handleMock.mockClear()
    sendMock.mockClear()
    windows.splice(0, windows.length, { isDestroyed: () => false, send: sendMock })
    // An AppImage is what lets a packaged Linux run update itself, so `auto` holds on every host.
    vi.stubEnv('APPIMAGE', '/opt/Enso.AppImage')
  })
  afterEach(() => vi.unstubAllEnvs())

  /** The handler registered for `channel`, after `initUpdaterIpc`. */
  async function handlers(
    autoUpdater = new FakeAutoUpdater(),
    buildMode: 'auto' | 'manual' = 'auto',
  ) {
    const { initUpdaterIpc } = await import('../../src/updaterIpc')
    const { Channel } = await import('../../src/ipc')
    handleMock.mockClear()
    initUpdaterIpc(buildMode, autoUpdater as unknown as UpdaterDeps['autoUpdater'])
    const handler = (channel: string) =>
      handleMock.mock.calls.find(([name]) => name === channel)![1] as (
        ...args: unknown[]
      ) => unknown
    return {
      autoUpdater,
      Channel,
      mode: () => handler(Channel.updaterMode)({}),
      check: (arg: unknown) => handler(Channel.updaterCheck)({}, arg),
      download: () => handler(Channel.updaterDownload)({}),
      quitAndInstall: () => handler(Channel.updaterQuitAndInstall)({}),
    }
  }

  test('the mode reply is the resolved update mode', async () => {
    expect(await (await handlers(undefined, 'manual')).mode()).toBe('manual')
    expect(await (await handlers(undefined, 'auto')).mode()).toBe('auto')
  })

  test('check coerces its argument: only true allows prereleases', async () => {
    const { autoUpdater, check } = await handlers()
    // The first underlying check of each `check` call (a prerelease check is followed by a stable one).
    const seen: boolean[] = []
    let calls: boolean[] = []
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      calls.push(autoUpdater.allowPrerelease)
      autoUpdater.emit('update-not-available', { version: '2026.1.1' })
      return null
    })
    for (const arg of [true, false, undefined, null, 'true', 1, {}]) {
      calls = []
      await check(arg)
      seen.push(calls[0]!)
    }
    expect(seen).toEqual([true, false, false, false, false, false, false])
  })

  test('download and quit-and-install reach the updater; quit-and-install replies nothing', async () => {
    const { autoUpdater, download, quitAndInstall } = await handlers()
    expect(await quitAndInstall()).toBeUndefined()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledOnce()
    await download()
  })

  test('broadcast skips destroyed windows and survives a send that throws', async () => {
    const { autoUpdater, Channel } = await handlers()
    const closed = vi.fn(() => {
      throw new Error('Object has been destroyed')
    })
    const destroyed = vi.fn()
    windows.unshift(
      { isDestroyed: () => false, send: closed },
      { isDestroyed: () => true, send: destroyed },
    )
    expect(() => autoUpdater.emit('update-downloaded', { version: '2026.2.0' })).not.toThrow()
    expect(closed).toHaveBeenCalledOnce()
    expect(destroyed).not.toHaveBeenCalled()
    // The window after the failing one still gets the status.
    expect(sendMock).toHaveBeenCalledWith(Channel.updaterStatus, {
      state: 'ready',
      version: '2026.2.0',
    })
  })

  test('registers the four handlers and broadcasts status changes', async () => {
    const { initUpdaterIpc } = await import('../../src/updaterIpc')
    const { Channel } = await import('../../src/ipc')
    const autoUpdater = new FakeAutoUpdater()
    initUpdaterIpc('auto', autoUpdater as unknown as UpdaterDeps['autoUpdater'])
    const channels = handleMock.mock.calls.map(([channel]) => channel)
    expect(channels).toEqual([
      Channel.updaterMode,
      Channel.updaterCheck,
      Channel.updaterDownload,
      Channel.updaterQuitAndInstall,
    ])
    autoUpdater.emit('update-downloaded', { version: '2026.2.0' })
    expect(sendMock).toHaveBeenCalledWith(Channel.updaterStatus, {
      state: 'ready',
      version: '2026.2.0',
    })
  })
})
