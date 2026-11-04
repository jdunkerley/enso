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

function setup(mode: 'auto' | 'manual' = 'auto') {
  const autoUpdater = new FakeAutoUpdater()
  const statuses: UpdateStatus[] = []
  const deps: UpdaterDeps = {
    autoUpdater: autoUpdater as unknown as UpdaterDeps['autoUpdater'],
    mode,
    onStatus: (status) => statuses.push(status),
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

  test('installs silently and relaunches', () => {
    const { autoUpdater, updater } = setup()
    updater.quitAndInstall()
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  test('manual mode never touches electron-updater', async () => {
    const { autoUpdater, updater } = setup('manual')
    expect(await updater.check(true)).toEqual({ state: 'idle' })
    await updater.download()
    updater.quitAndInstall()
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

  test('a prerelease check that throws falls back to the stable release', async () => {
    const { autoUpdater, statuses, updater } = setup()
    const seen: boolean[] = []
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      seen.push(autoUpdater.allowPrerelease)
      if (autoUpdater.allowPrerelease) {
        const error = coded('ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'No published versions on GitHub')
        autoUpdater.emit('error', error)
        throw error
      }
      autoUpdater.emit('update-available', { version: '2026.1.1', releaseDate: '' })
      return null
    })
    expect(await updater.check(true)).toEqual({
      state: 'available',
      version: '2026.1.1',
      releaseDate: '',
    })
    expect(seen).toEqual([true, false])
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test('a throwing prerelease check and a stable release that is not there is none', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      const error =
        autoUpdater.allowPrerelease ?
          coded('ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'No published versions on GitHub')
        : coded('ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'Unable to find latest version: 404')
      autoUpdater.emit('error', error)
      throw error
    })
    expect(await updater.check(true)).toEqual({ state: 'none' })
  })

  test('both passes failing is an error, reporting the prerelease failure', async () => {
    const { autoUpdater, statuses, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      const error = new Error(autoUpdater.allowPrerelease ? 'offline' : 'still offline')
      autoUpdater.emit('error', error)
      throw error
    })
    expect(await updater.check(true)).toEqual({ state: 'error', message: 'offline', version: null })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(statuses.filter((s) => s.state === 'error')).toHaveLength(1)
  })

  test('no stable release (404) without prereleases is none, not an error', async () => {
    const { autoUpdater, statuses, updater } = setup()
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      const error = coded(
        'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
        'Unable to find latest version on GitHub: HttpError: 404 Not Found',
      )
      autoUpdater.emit('error', error)
      throw error
    })
    expect(await updater.check(false)).toEqual({ state: 'none' })
    expect(statuses.some((s) => s.state === 'error')).toBe(false)
  })

  test('a failed /releases/latest that is not a 404 stays an error', async () => {
    const { autoUpdater, updater } = setup()
    autoUpdater.checkForUpdates.mockRejectedValue(
      coded('ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'Unable to find latest version: ENOTFOUND'),
    )
    expect(await updater.check(false)).toMatchObject({ state: 'error' })
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
    expect(quitAndInstall()).toBeUndefined()
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
