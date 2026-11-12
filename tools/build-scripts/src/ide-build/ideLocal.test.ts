/** @file `ide-local`'s inputs: the bundle path, sbt's and the GUI's environments. */
import path from 'node:path'
import { expect, test } from 'vitest'
import { version } from '../version/version.ts'
import {
  ENGINE_BUNDLE_COMMAND,
  engineBuildEnv,
  engineBundleDir,
  guiBuildArgs,
  guiBuildEnv,
} from './ideLocal.ts'

test('the bundle is where EngineBundle.root puts it', () => {
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'linux', 'x64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-linux-amd64', 'enso'),
  )
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'win32', 'x64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-windows-amd64', 'enso'),
  )
  expect(engineBundleDir('/repo', '2026.1.1-dev', 'darwin', 'arm64')).toBe(
    path.join('/repo', 'built-distribution', 'engine-bundle-2026.1.1-dev-macos-aarch64', 'enso'),
  )
})

test('sbt builds the bundle incrementally', () => {
  expect(ENGINE_BUNDLE_COMMAND).toBe('buildEngineBundle')
})

test('sbt gets the version triple', () => {
  const versions = { version: version('2026.1.1-dev'), releaseMode: false }
  expect(engineBuildEnv({ PATH: '/bin' }, versions)).toEqual({
    PATH: '/bin',
    ENSO_VERSION: '2026.1.1-dev',
    ENSO_EDITION: '2026.1.1-dev',
    ENSO_RELEASE_MODE: 'false',
  })
  expect(engineBuildEnv({ ENSO_VERSION: 'stale' }, versions).ENSO_VERSION).toBe('2026.1.1-dev')
})

test('the GUI is built in the requested mode, with the version and commit', () => {
  expect(guiBuildArgs('production')).toEqual(['run', 'build:gui', '--mode=production'])
  expect(guiBuildEnv({ PATH: '/bin' }, '2026.1.1-dev', 'abc123')).toEqual({
    PATH: '/bin',
    ENSO_IDE_VERSION: '2026.1.1-dev',
    ENSO_IDE_COMMIT_HASH: 'abc123',
  })
})
