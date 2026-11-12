/**
 * @file The AOT cache's root and its gate, and the AppImage's stable engine copy.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  AfterFirstOpen,
  appImageEngine,
  isEngineCopyPath,
  isJvmAotEnabled,
  jvmAotRootDirectory,
  removeLeftoverJvmAotCache,
} from '../../src/jvmAotSettings'

describe('isJvmAotEnabled', () => {
  test('on unless ENSO_JVM_AOT is 0', () => {
    expect(isJvmAotEnabled({})).toBe(true)
    expect(isJvmAotEnabled({ ENSO_JVM_AOT: '1' })).toBe(true)
    expect(isJvmAotEnabled({ ENSO_JVM_AOT: '' })).toBe(true)
    expect(isJvmAotEnabled({ ENSO_JVM_AOT: '0' })).toBe(false)
  })
})

describe('jvmAotRootDirectory', () => {
  test('Windows: %LOCALAPPDATA%/Enso/jvm-aot, else under the home directory', () => {
    expect(jvmAotRootDirectory({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\L\\Enso\\jvm-aot',
    )
    expect(jvmAotRootDirectory({}, 'win32', 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\Enso\\jvm-aot',
    )
  })

  test('macOS: ~/Library/Caches/Enso/jvm-aot', () => {
    expect(jvmAotRootDirectory({}, 'darwin', '/Users/u')).toBe(
      '/Users/u/Library/Caches/Enso/jvm-aot',
    )
  })

  test('Linux: $XDG_CACHE_HOME/enso/jvm-aot, falling back to ~/.cache/enso/jvm-aot', () => {
    expect(jvmAotRootDirectory({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/u')).toBe(
      '/x/enso/jvm-aot',
    )
    expect(jvmAotRootDirectory({ XDG_CACHE_HOME: '' }, 'linux', '/home/u')).toBe(
      '/home/u/.cache/enso/jvm-aot',
    )
    expect(jvmAotRootDirectory({}, 'linux', '/home/u')).toBe('/home/u/.cache/enso/jvm-aot')
  })

  test('ENSO_JVM_AOT_DIR wins on every platform, unless it is empty', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: 'D' }, platform, '/h')).toBe('D')
      expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: '' }, platform, '/h')).not.toBe('')
    }
  })
})

describe('removeLeftoverJvmAotCache', () => {
  async function withUserData(run: (userData: string) => Promise<void>) {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aot-leftover-')))
    try {
      const userData = path.join(base, 'userData')
      await fs.mkdir(path.join(userData, 'jvm-aot', 'key'), { recursive: true })
      await fs.writeFile(path.join(userData, 'jvm-aot', 'key', 'enso.aot'), 'x')
      await fs.writeFile(path.join(userData, 'keep.txt'), 'x')
      await run(userData)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  }
  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    )

  test('removes <userData>/jvm-aot, and nothing else of userData', () =>
    withUserData(async (userData) => {
      expect(await removeLeftoverJvmAotCache({}, userData, 'linux', '/home/u')).toBe(true)
      expect(await exists(path.join(userData, 'jvm-aot'))).toBe(false)
      expect(await exists(path.join(userData, 'keep.txt'))).toBe(true)
      // Nothing left: nothing to do, no failure.
      expect(await removeLeftoverJvmAotCache({}, userData, 'linux', '/home/u')).toBe(false)
    }))

  test('keeps it when ENSO_JVM_AOT_DIR points at it', () =>
    withUserData(async (userData) => {
      const env = { ENSO_JVM_AOT_DIR: path.join(userData, 'jvm-aot') }
      expect(await removeLeftoverJvmAotCache(env, userData, 'linux', '/home/u')).toBe(false)
      expect(await exists(path.join(userData, 'jvm-aot', 'key', 'enso.aot'))).toBe(true)
    }))

  test('removes it when ENSO_JVM_AOT_DIR points elsewhere', () =>
    withUserData(async (userData) => {
      const env = { ENSO_JVM_AOT_DIR: path.join(userData, 'elsewhere') }
      expect(await removeLeftoverJvmAotCache(env, userData, 'linux', '/home/u')).toBe(true)
      expect(await exists(path.join(userData, 'jvm-aot'))).toBe(false)
    }))

  test('never throws', async () => {
    expect(await removeLeftoverJvmAotCache({}, '\0bad', 'linux', '/home/u')).toBe(false)
  })
})

describe('appImageEngine', () => {
  /** A packaged app's resources with a bundled engine, and its `userData`. */
  async function fakeApp(base: string) {
    const resourcesPath = path.join(base, 'mount', 'resources')
    const bin = path.join(resourcesPath, 'enso', 'dist', '1.0', 'bin')
    await fs.mkdir(bin, { recursive: true })
    await fs.mkdir(path.join(resourcesPath, 'enso', 'runtime', 'jdk'), { recursive: true })
    await fs.writeFile(path.join(resourcesPath, 'enso', '.enso.bundle'), '')
    await fs.writeFile(path.join(bin, 'enso'), 'launcher')
    return { resourcesPath, userData: path.join(base, 'userData'), version: '2026.2.0' }
  }

  async function withApp(
    run: (base: string, app: Awaited<ReturnType<typeof fakeApp>>) => Promise<void>,
  ) {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'appimage-engine-')))
    try {
      await run(base, await fakeApp(base))
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  }

  test('outside an AppImage, or with ENSO_ENGINE_PATH set, nothing changes', () =>
    withApp(async (base, app) => {
      expect(await appImageEngine({}, app)).toEqual({})
      expect(
        await appImageEngine({ APPIMAGE: '/a/Enso.AppImage', ENSO_ENGINE_PATH: '/e/enso' }, app),
      ).toEqual({})
      expect(await fs.readdir(base)).not.toContain('userData')
    }))

  test("an ENSO_ENGINE_PATH inherited from an earlier IDE (its own copy) is not the user's", () =>
    withApp(async (_base, app) => {
      // An in-app update's relaunch inherits the old process's environment: an earlier IDE that put
      // its copy there would make this version run the old version's engine.
      const old = path.join(app.userData, 'engine', '2026.1.0', 'dist', '1.0', 'bin', 'enso')
      expect(isEngineCopyPath(old, app.userData)).toBe(true)
      expect(isEngineCopyPath(path.join(app.userData, 'engine'), app.userData)).toBe(false)
      expect(isEngineCopyPath(path.join(app.userData, 'engines', 'enso'), app.userData)).toBe(false)
      expect(isEngineCopyPath('/opt/enso/bin/enso', app.userData)).toBe(false)
      const env = { APPIMAGE: '/a/Enso.AppImage', ENSO_ENGINE_PATH: old }
      const first = await appImageEngine(env, app)
      expect(first.enginePath).toBeUndefined()
      const copied = path.join(app.userData, 'engine', '2026.2.0', 'dist', '1.0', 'bin', 'enso')
      expect(await first.startCopy?.()).toBe(copied)
      expect(await appImageEngine(env, app)).toEqual({ enginePath: copied })
    }))

  test('the copy starts when asked, and the next launch uses it', () =>
    withApp(async (_base, app) => {
      const env = { APPIMAGE: '/a/Enso.AppImage' }
      const first = await appImageEngine(env, app)
      expect(first.enginePath).toBeUndefined()
      // Nothing is copied before the window is up and `startCopy` is called.
      await expect(fs.access(app.userData)).rejects.toThrow()
      const copied = path.join(app.userData, 'engine', '2026.2.0', 'dist', '1.0', 'bin', 'enso')
      expect(await first.startCopy?.()).toBe(copied)
      expect(await appImageEngine(env, app)).toEqual({ enginePath: copied })
    }))

  test('the environment is never written: the copy cannot leak into a relaunch', () =>
    withApp(async (_base, app) => {
      // An in-app update relaunches the new AppImage with this process's environment, so a copy's
      // path there would make the new version run the old version's engine.
      const env = Object.freeze({ APPIMAGE: '/a/Enso.AppImage' })
      await (await appImageEngine(env, app)).startCopy?.()
      expect((await appImageEngine(env, app)).enginePath).toBeDefined()
      expect(env).toEqual({ APPIMAGE: '/a/Enso.AppImage' })
    }))
})

describe('AfterFirstOpen', () => {
  test('runs once the first open is answered, not while one is in flight', () => {
    vi.useFakeTimers()
    try {
      const gate = new AfterFirstOpen(60_000)
      const task = vi.fn()
      gate.schedule(task)
      gate.openStarted()
      gate.openStarted()
      gate.openAnswered()
      expect(task).not.toHaveBeenCalled()
      gate.openAnswered()
      expect(task).toHaveBeenCalledTimes(1)
      gate.openStarted()
      gate.openAnswered()
      vi.advanceTimersByTime(120_000)
      expect(task).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('without any open, runs after the delay; an open in flight then holds it until answered', () => {
    vi.useFakeTimers()
    try {
      const idle = new AfterFirstOpen(60_000)
      const task = vi.fn()
      idle.schedule(task)
      vi.advanceTimersByTime(59_999)
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(task).toHaveBeenCalledTimes(1)

      const busy = new AfterFirstOpen(60_000)
      const later = vi.fn()
      busy.schedule(later)
      busy.openStarted()
      vi.advanceTimersByTime(60_000)
      expect(later).not.toHaveBeenCalled()
      busy.openAnswered()
      expect(later).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test('an open answered before the task is scheduled lets it run at once', () => {
    const gate = new AfterFirstOpen(60_000)
    gate.openStarted()
    gate.openAnswered()
    const task = vi.fn()
    gate.schedule(task)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
