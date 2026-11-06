/**
 * @file The AOT cache's root and its gate (it trains only when the JVM is the default engine), and
 * the AppImage's stable engine copy.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  AfterFirstOpen,
  appImageEngine,
  isJvmDefaultEngine,
  jvmAotRootDirectory,
} from '../../src/jvmAotSettings'

describe('isJvmDefaultEngine', () => {
  test('native by default: nothing is trained before the switch', () => {
    expect(isJvmDefaultEngine(undefined, {})).toBe(false)
    expect(isJvmDefaultEngine({}, { ENSO_ENGINE_MODE: 'bogus' })).toBe(false)
  })
  test('ENSO_ENGINE_MODE and --engine-mode turn it on; the option wins', () => {
    expect(isJvmDefaultEngine(undefined, { ENSO_ENGINE_MODE: 'jvm' })).toBe(true)
    expect(isJvmDefaultEngine({ option: 'jvm' }, {})).toBe(true)
    expect(isJvmDefaultEngine({ option: 'native' }, { ENSO_ENGINE_MODE: 'jvm' })).toBe(false)
  })
})

describe('jvmAotRootDirectory', () => {
  test('<userData>/jvm-aot, unless ENSO_JVM_AOT_DIR is set and not empty', () => {
    expect(jvmAotRootDirectory({}, 'U')).toBe(path.join('U', 'jvm-aot'))
    expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: '' }, 'U')).toBe(path.join('U', 'jvm-aot'))
    expect(jvmAotRootDirectory({ ENSO_JVM_AOT_DIR: 'D' }, 'U')).toBe('D')
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

  const jvm = { option: 'jvm' as const }

  test('outside an AppImage, or with ENSO_ENGINE_PATH set, nothing changes', () =>
    withApp(async (base, app) => {
      expect(await appImageEngine({}, app, jvm)).toEqual({})
      expect(
        await appImageEngine(
          { APPIMAGE: '/a/Enso.AppImage', ENSO_ENGINE_PATH: '/e/enso' },
          app,
          jvm,
        ),
      ).toEqual({})
      expect(await fs.readdir(base)).not.toContain('userData')
    }))

  test('while the default engine is native, nothing is copied (no disk used)', () =>
    withApp(async (base, app) => {
      const env = { APPIMAGE: '/a/Enso.AppImage' }
      expect(await appImageEngine(env, app, undefined)).toEqual({})
      expect(
        await appImageEngine({ ...env, ENSO_ENGINE_MODE: 'jvm' }, app, { option: 'native' }),
      ).toEqual({})
      expect(await fs.readdir(base)).not.toContain('userData')
    }))

  test('JVM by --engine-mode or ENSO_ENGINE_MODE: the copy starts when asked, and the next launch uses it', () =>
    withApp(async (_base, app) => {
      for (const [env, engine] of [
        [{ APPIMAGE: '/a/Enso.AppImage' }, jvm],
        [{ APPIMAGE: '/a/Enso.AppImage', ENSO_ENGINE_MODE: 'jvm' }, undefined],
      ] as const) {
        await fs.rm(app.userData, { recursive: true, force: true })
        const first = await appImageEngine(env, app, engine)
        expect(first.enginePath).toBeUndefined()
        // Nothing is copied before the window is up and `startCopy` is called.
        await expect(fs.access(app.userData)).rejects.toThrow()
        const copied = path.join(app.userData, 'engine', '2026.2.0', 'dist', '1.0', 'bin', 'enso')
        expect(await first.startCopy?.()).toBe(copied)
        expect(await appImageEngine(env, app, engine)).toEqual({ enginePath: copied })
      }
    }))

  test('the environment is never written: the copy cannot leak into a relaunch', () =>
    withApp(async (_base, app) => {
      // An in-app update relaunches the new AppImage with this process's environment, so a copy's
      // path there would make the new version run the old version's engine.
      const env = Object.freeze({ APPIMAGE: '/a/Enso.AppImage' })
      await (await appImageEngine(env, app, jvm)).startCopy?.()
      expect((await appImageEngine(env, app, jvm)).enginePath).toBeDefined()
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
