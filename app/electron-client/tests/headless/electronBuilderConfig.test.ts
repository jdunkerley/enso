/** @file The electron-builder configuration: installer targets, the update feed and blockmaps. */
import * as electronBuilder from 'electron-builder'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

type ConfigModule = typeof import('../../electron-builder-config')
let configModule: ConfigModule

beforeAll(async () => {
  // `args` is parsed from `ENSO_BUILD_*` when the module loads, and these three are required.
  Reflect.set(process.env, 'ENSO_BUILD_IDE', 'dist/ide')
  Reflect.set(process.env, 'ENSO_BUILD_GUI', 'dist/gui')
  Reflect.set(process.env, 'ENSO_BUILD_BACKEND', 'dist/backend')
  configModule = await import('../../electron-builder-config')
})

const savedEnv = { ...process.env }
afterEach(() => {
  for (const key of ['ENSO_BUILD_UPDATE_INFO', 'CSC_LINK', 'ENSO_BUILD_WIN_PUBLISHER_NAME']) {
    if (savedEnv[key] == null) Reflect.deleteProperty(process.env, key)
    else Reflect.set(process.env, key, savedEnv[key])
  }
})

function configFor(platform: electronBuilder.Platform, sign = true) {
  return configModule.createElectronBuilderConfig({
    ...configModule.args,
    platform,
    sign,
  })
}

describe('Windows', () => {
  test('builds a per-user, one-click NSIS installer with the migration script', () => {
    const config = configFor(electronBuilder.Platform.WINDOWS)
    expect(config.win?.target).toBe('nsis')
    expect(config.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      include: 'build/installer.nsh',
    })
  })

  test('writes blockmaps only for release builds', () => {
    expect(configFor(electronBuilder.Platform.WINDOWS).nsis?.differentialPackage).toBe(false)
    Reflect.set(process.env, 'ENSO_BUILD_UPDATE_INFO', 'true')
    expect(configFor(electronBuilder.Platform.WINDOWS).nsis?.differentialPackage).toBe(true)
  })

  test('verifies the update publisher only when one is configured', () => {
    expect(configFor(electronBuilder.Platform.WINDOWS).win?.signtoolOptions?.publisherName).toBe(
      undefined,
    )
    Reflect.set(process.env, 'ENSO_BUILD_WIN_PUBLISHER_NAME', 'Example Ltd')
    expect(configFor(electronBuilder.Platform.WINDOWS).win?.signtoolOptions?.publisherName).toBe(
      'Example Ltd',
    )
  })
})

describe('macOS', () => {
  test('builds the update zip only when signed', () => {
    expect(configFor(electronBuilder.Platform.MAC).mac?.target).toBe('dmg')
    Reflect.set(process.env, 'CSC_LINK', 'certificate')
    expect(configFor(electronBuilder.Platform.MAC).mac?.target).toEqual(['dmg', 'zip'])
    expect(configFor(electronBuilder.Platform.MAC, false).mac?.target).toBe('dmg')
  })
})

test('the update feed is the fork’s GitHub Releases', () => {
  expect(configFor(electronBuilder.Platform.LINUX).publish).toEqual({
    provider: 'github',
    owner: 'jdunkerley',
    repo: 'enso',
  })
})

test('carries no metadata for the removed Rust installer', () => {
  const config = configFor(electronBuilder.Platform.WINDOWS)
  expect(config.extraMetadata).toEqual({ version: expect.any(String) })
  expect(config).not.toHaveProperty('msi')
})
