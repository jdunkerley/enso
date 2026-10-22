/** @file Publishing to GitHub Actions' files, and locally as `export` lines. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { envFileEntry, exportLine, publish } from './github.ts'

test('an env-file entry uses the delimiter form', () => {
  expect(envFileEntry('ENSO_VERSION', '2026.1.1-dev', 'D')).toBe(
    'ENSO_VERSION<<D\n2026.1.1-dev\nD\n',
  )
})

test('an export line quotes the value', () => {
  expect(exportLine('A', "it's")).toBe("export A='it'\\''s'")
})

test('in GitHub Actions, every value goes to GITHUB_OUTPUT and GITHUB_ENV', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'publish-'))
  const output = path.join(dir, 'output')
  const env = path.join(dir, 'env')
  writeFileSync(output, '')
  writeFileSync(env, '')
  const printed: string[] = []
  publish(
    { ENSO_VERSION: '2026.1.1-dev', ENSO_RELEASE_MODE: 'false' },
    { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output, GITHUB_ENV: env },
    (line) => printed.push(line),
  )
  expect(printed).toEqual(['ENSO_VERSION=2026.1.1-dev', 'ENSO_RELEASE_MODE=false'])
  for (const file of [output, env]) {
    expect(readFileSync(file, 'utf8')).toMatch(
      /^ENSO_VERSION<<(ghadelimiter_[0-9a-f-]+)\n2026\.1\.1-dev\n\1\nENSO_RELEASE_MODE<<(ghadelimiter_[0-9a-f-]+)\nfalse\n\2\n$/,
    )
  }
})

test('outside GitHub Actions, it prints export lines and writes nothing', () => {
  const printed: string[] = []
  publish({ ENSO_VERSION: '2026.1.1-dev' }, {}, (line) => printed.push(line))
  expect(printed).toEqual(["export ENSO_VERSION='2026.1.1-dev'"])
})
