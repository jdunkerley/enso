import * as path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { getEngineLogDirectory } from '../distributionManager.js'

const originalPlatform = process.platform

function stubPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  vi.unstubAllEnvs()
})

/** Clear every variable the log directory depends on, so the host's own settings cannot leak in. */
function clearEnv() {
  for (const name of [
    'ENSO_LOG_DIRECTORY',
    'ENSO_DATA_DIRECTORY',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'LOCALAPPDATA',
  ]) {
    vi.stubEnv(name, '')
  }
}

describe('getEngineLogDirectory', () => {
  test('ENSO_LOG_DIRECTORY wins everywhere', () => {
    clearEnv()
    vi.stubEnv('ENSO_LOG_DIRECTORY', '/logs')
    vi.stubEnv('ENSO_DATA_DIRECTORY', '/data')
    for (const platform of ['linux', 'win32', 'darwin'] as const) {
      stubPlatform(platform)
      expect(getEngineLogDirectory()).toBe('/logs')
    }
  })

  test.each(['linux', 'win32'] as const)(
    'ENSO_DATA_DIRECTORY sets the log directory on %s, as in the engine',
    (platform) => {
      clearEnv()
      stubPlatform(platform)
      vi.stubEnv('ENSO_DATA_DIRECTORY', '/data')
      vi.stubEnv('XDG_DATA_HOME', '/xdg-data')
      vi.stubEnv('LOCALAPPDATA', '/local-app-data')
      expect(getEngineLogDirectory()).toBe(path.join('/data', 'log'))
    },
  )

  test('XDG_CACHE_HOME still wins over ENSO_DATA_DIRECTORY on Linux, as in the engine', () => {
    clearEnv()
    stubPlatform('linux')
    vi.stubEnv('ENSO_DATA_DIRECTORY', '/data')
    vi.stubEnv('XDG_CACHE_HOME', '/xdg-cache')
    expect(getEngineLogDirectory()).toBe(path.join('/xdg-cache', 'enso'))
  })

  test('falls back to the platform data directory', () => {
    clearEnv()
    stubPlatform('linux')
    vi.stubEnv('XDG_DATA_HOME', '/xdg-data')
    expect(getEngineLogDirectory()).toBe(path.join('/xdg-data', 'enso', 'log'))
    stubPlatform('win32')
    vi.stubEnv('LOCALAPPDATA', '/local-app-data')
    expect(getEngineLogDirectory()).toBe(path.join('/local-app-data', 'enso', 'log'))
  })
})
