/** @file The standard-library API check, with the engine and git faked. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { type ApiCheckContext, failureLines, librariesWithApi, runApiCheck } from './apiCheck.ts'

/** A repository with the given libraries; those in `withApi` have a committed `docs/api`. */
function repository(libraries: string[], withApi: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'api-check-'))
  const stdlib = path.join(root, 'distribution', 'lib', 'Standard')
  for (const library of libraries) {
    mkdirSync(path.join(stdlib, library, '0.0.0-dev', 'src'), { recursive: true })
    if (withApi.includes(library)) {
      mkdirSync(path.join(stdlib, library, '0.0.0-dev', 'docs', 'api'), { recursive: true })
    }
  }
  writeFileSync(path.join(stdlib, 'CLAUDE.md'), 'notes')
  return { root, stdlib }
}

describe('librariesWithApi', () => {
  test('sorted, only those with docs/api, files skipped', () => {
    const { stdlib } = repository(['Table', 'Base', 'Searcher', 'Test'], ['Table', 'Base', 'Test'])
    expect(librariesWithApi(stdlib)).toEqual(['Base', 'Table', 'Test'])
  })
  test('a library without 0.0.0-dev is an error', () => {
    const { stdlib } = repository(['Base'], ['Base'])
    mkdirSync(path.join(stdlib, 'Broken'))
    expect(() => librariesWithApi(stdlib)).toThrow(/Directory .*Broken.0\.0\.0-dev does not exist/)
  })
})

test('the failure message names the library and the diff', () => {
  expect(
    failureLines(
      'Base',
      'DIFF',
      'distribution/lib/Standard/Base/0.0.0-dev/docs/api',
      'distribution/lib/Standard/Base/0.0.0-dev',
    ),
  ).toEqual([
    'API check failed for library Standard.Base',
    'Current API vs Old API: DIFF',
    'If you wish to overwrite the current API in the directory distribution/lib/Standard/Base/0.0.0-dev/docs/api, run the following command\n' +
      '                       sbt "runEngineDistribution --no-ir-caches --docs=api --in-project distribution/lib/Standard/Base/0.0.0-dev"\n' +
      '                       and commit the modified files',
  ])
})

describe('runApiCheck', () => {
  const setup = (diffs: Record<string, number>) => {
    const { root } = repository(['Base', 'Table', 'Image'], ['Base', 'Table', 'Image'])
    const calls: string[] = []
    const errors: string[] = []
    const context: ApiCheckContext = {
      repoRoot: root,
      enginePackage: { dir: path.join(root, 'pkg'), version: '2026.1.1-dev' },
      enso: 'enso',
      runEnso: (args) => {
        calls.push(`enso ${args.join(' ')}`)
        return 0
      },
      diff: (oldDir) => {
        const library = path.basename(path.dirname(path.dirname(path.dirname(oldDir))))
        calls.push(`diff ${library}`)
        return { status: diffs[library] ?? 0, stdout: `diff of ${library}`, stderr: '' }
      },
      log: () => {},
      error: (line) => errors.push(line),
    }
    return { root, calls, errors, context }
  }
  test('every library in order, generated into the engine package at its version', () => {
    const { root, calls, context } = setup({})
    expect(runApiCheck(context)).toBe(true)
    const built = (library: string) =>
      path.join(root, 'pkg', 'lib', 'Standard', library, '2026.1.1-dev')
    expect(calls).toEqual([
      `enso --docs api --in-project ${built('Base')}`,
      'diff Base',
      `enso --docs api --in-project ${built('Image')}`,
      'diff Image',
      `enso --docs api --in-project ${built('Table')}`,
      'diff Table',
    ])
  })
  test('stops at the first library whose API changed', () => {
    const { calls, errors, context } = setup({ Image: 1, Table: 1 })
    expect(runApiCheck(context)).toBe(false)
    expect(calls.at(-1)).toBe('diff Image')
    expect(errors[0]).toBe('API check failed for library Standard.Image')
    expect(errors[1]).toBe('Current API vs Old API: diff of Image')
    expect(errors.at(-1)).toBe('Error: API check failed for library Standard.Image')
  })
  test("a git failure is an error with git's stderr, not a changed API", () => {
    const { errors, context } = setup({})
    const failing = (status: number, stderr: string) => () =>
      runApiCheck({ ...context, diff: () => ({ status, stdout: '', stderr }) })
    expect(failing(128, 'fatal: not a git repository\n')).toThrow(
      /exited with 128: fatal: not a git repository$/,
    )
    expect(failing(-1, 'Error: spawnSync git ENOENT\n')).toThrow(
      /exited with -1: Error: spawnSync git ENOENT$/,
    )
    expect(errors).toEqual([])
  })
  test('a failing enso is an error', () => {
    const { context } = setup({})
    expect(() => runApiCheck({ ...context, runEnso: () => 3 })).toThrow('exited with 3')
  })
})
