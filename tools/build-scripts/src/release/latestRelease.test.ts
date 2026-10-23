/** @file Moving `latest-release` (the `config.rs` tests). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { latestReleaseFromConfig } from '../version/version.ts'
import { withLatestRelease } from './latestRelease.ts'

test('updating latest-release keeps the rest of the file', () => {
  const config =
    '# A comment.\n\nlatest-release: 2025.3.4\n\nrequired-versions:\n  node: =16.15.0\n'
  const updated = withLatestRelease(config, '2026.1.1')
  expect(updated).toBe(
    '# A comment.\n\nlatest-release: 2026.1.1\n\nrequired-versions:\n  node: =16.15.0\n',
  )
  // Re-applying the same version is a no-op, so a release that did not move the key leaves the
  // file (and therefore the pull request) empty.
  expect(withLatestRelease(updated, '2026.1.1')).toBe(updated)
})

test('updating latest-release requires the key', () => {
  expect(() => withLatestRelease('wasm-size-limit: 16.20 MiB\n', '2026.1.1')).toThrow(
    'The build configuration has no `latest-release` entry to update.',
  )
})

test('a CRLF file stays CRLF', () => {
  expect(withLatestRelease('a: 1\r\nlatest-release: 2025.3.4\r\n', '2026.1.1')).toBe(
    'a: 1\r\nlatest-release: 2026.1.1\r\n',
  )
})

test("the repository's build-config.yaml is updatable, and reads back", () => {
  const config = readFileSync(path.join(REPO_ROOT, 'build-config.yaml'), 'utf8')
  expect(latestReleaseFromConfig(config)).not.toBeNull()
  expect(latestReleaseFromConfig(withLatestRelease(config, '2026.1.1'))?.text).toBe('2026.1.1')
})
