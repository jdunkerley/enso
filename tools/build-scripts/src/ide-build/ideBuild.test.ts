/** @file The IDE packaging step's inputs: update mode, signing variables, backend check. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { version } from '../version/version.ts'
import {
  ideBuildVariables,
  latestBundledEngine,
  packagingSteps,
  retryDelays,
  targetOs,
  updateMode,
  withoutEmptyCscVariables,
} from './ideBuild.ts'

describe('updateMode (ported from the retired build CLI)', () => {
  test('a stable or rc version updates automatically, a dev version does not', () => {
    expect(updateMode(version('2026.2.0'), 'windows', false)).toBe('auto')
    expect(updateMode(version('2026.2.0-rc.1'), 'linux', false)).toBe('auto')
    expect(updateMode(version('2026.10.18-dev'), 'windows', false)).toBe('manual')
  })
  test('macOS updates automatically only when signed', () => {
    expect(updateMode(version('2026.2.0'), 'macos', false)).toBe('manual')
    expect(updateMode(version('2026.2.0'), 'macos', true)).toBe('auto')
  })
})

test('empty signing variables are removed, set ones kept, others untouched', () => {
  const env = { WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: 'x', APPLEID: '', PATH: '/bin', OTHER: '' }
  expect(withoutEmptyCscVariables(env)).toEqual({
    WIN_CSC_KEY_PASSWORD: 'x',
    PATH: '/bin',
    OTHER: '',
  })
})

describe('latestBundledEngine', () => {
  const backend = (names: string[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'backend-'))
    mkdirSync(path.join(dir, 'dist'))
    for (const name of names) mkdirSync(path.join(dir, 'dist', name))
    writeFileSync(path.join(dir, '.enso.bundle'), '')
    return dir
  }
  test('the greatest version-named directory', () => {
    expect(latestBundledEngine(backend(['2026.1.1-dev', '2025.3.4', 'notes']))).toBe('2026.1.1-dev')
  })
  test('none is an error', () => {
    const dir = backend(['notes'])
    expect(() => latestBundledEngine(dir)).toThrow(
      `Backend at ${dir} does not contain any Enso Engine packages.`,
    )
  })
})

test("the children's variables for a PR build", () => {
  const variables = ideBuildVariables(
    {
      version: version('2026.1.1-dev'),
      commitHash: 'abc',
      os: targetOs('linux'),
      sign: false,
      guiDir: '/r/dist/gui',
      ideDir: '/r/dist/ide',
      backendDir: '/r/dist/backend',
    },
    {},
  )
  expect(variables).toEqual({
    ENSO_IDE_VERSION: '2026.1.1-dev',
    ENSO_IDE_COMMIT_HASH: 'abc',
    ENSO_IDE_UPDATES: 'manual',
    ENSO_BUILD_GUI: '/r/dist/gui',
    ENSO_BUILD_IDE: '/r/dist/ide',
    ENSO_BUILD_BACKEND: '/r/dist/backend',
    ENSO_BUILD_SIGN: 'false',
  })
})

test('build:ide keeps empty signing variables, dist:ide drops them', () => {
  const [build, dist] = packagingSteps(
    { ENSO_BUILD_SIGN: 'false' },
    { WIN_CSC_LINK: '', PATH: 'p' },
  )
  expect(build).toEqual({
    args: ['run', 'build:ide'],
    env: { WIN_CSC_LINK: '', PATH: 'p', ENSO_BUILD_SIGN: 'false' },
  })
  expect(dist).toEqual({ args: ['run', 'dist:ide'], env: { PATH: 'p', ENSO_BUILD_SIGN: 'false' } })
})

test('install retries back off from half a second to at most ten', () => {
  expect(retryDelays(5)).toEqual([500, 750, 1125, 1687.5, 2531.25])
  expect(retryDelays(12).at(-1)).toBe(10_000)
})
