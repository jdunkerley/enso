/**
 * @file The AOT cache's root and its gate (it trains only when the JVM is the default engine), and
 * the AppImage's stable engine copy.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { appImageEngine, isJvmDefaultEngine, jvmAotRootDirectory } from '../../src/jvmAotSettings'

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

  test('outside an AppImage, or with ENSO_ENGINE_PATH set, nothing changes', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'appimage-engine-'))
    try {
      const app = await fakeApp(base)
      expect(await appImageEngine({}, app)).toEqual({})
      expect(
        await appImageEngine({ APPIMAGE: '/a/Enso.AppImage', ENSO_ENGINE_PATH: '/e/enso' }, app),
      ).toEqual({})
      expect(await fs.readdir(base)).not.toContain('userData')
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('the first launch copies in the background; the next one uses the copy', async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'appimage-engine-')))
    try {
      const app = await fakeApp(base)
      const env = { APPIMAGE: '/a/Enso.AppImage' }
      const first = await appImageEngine(env, app)
      expect(first.enginePath).toBeUndefined()
      const copied = path.join(app.userData, 'engine', '2026.2.0', 'dist', '1.0', 'bin', 'enso')
      expect(await first.copy).toBe(copied)
      expect(await appImageEngine(env, app)).toEqual({ enginePath: copied })
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})
