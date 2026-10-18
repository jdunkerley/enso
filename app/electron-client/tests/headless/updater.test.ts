/** @file The automatic-update state machine (`src/updater.ts`), against a fake `electron-updater`. */
import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'

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

const { handleMock, sendMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { isPackaged: true },
  ipcMain: { handle: handleMock },
  webContents: {
    getAllWebContents: () => [{ isDestroyed: () => false, send: sendMock }],
  },
}))

describe('initUpdaterIpc', () => {
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
