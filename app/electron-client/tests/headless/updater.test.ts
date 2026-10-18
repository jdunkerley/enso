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
