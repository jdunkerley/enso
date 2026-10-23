/** @file The release notes: the top changelog section, and the body around it. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT } from '../lib/repo.ts'
import { prettyName, releaseBody, topReleaseNotes } from './notes.ts'

const CHANGELOG = [
  '# Next Release',
  '',
  '#### Enso IDE',
  '',
  '- [Tidy up uses `Ctrl`+<kbd>L</kbd> & "quotes"][74]',
  '',
  '```',
  '# not a heading, inside a fence',
  '```',
  '',
  '[74]: https://github.com/jdunkerley/enso/pull/74',
  '',
  '# Enso 2026.1',
  '',
  '- older',
  '',
].join('\n')

describe('topReleaseNotes (Changelog::top_release_notes)', () => {
  test('the first section, trimmed, with a fenced `#` line kept as text', () => {
    expect(topReleaseNotes(CHANGELOG)).toBe(
      [
        '#### Enso IDE',
        '',
        '- [Tidy up uses `Ctrl`+<kbd>L</kbd> & "quotes"][74]',
        '',
        '```',
        '# not a heading, inside a fence',
        '```',
        '',
        '[74]: https://github.com/jdunkerley/enso/pull/74',
      ].join('\n'),
    )
  })
  test('the last section runs to the end of the file', () => {
    expect(topReleaseNotes('# Only\n\nbody\n')).toBe('body')
  })
  test('a file without a level-1 heading is an error', () => {
    expect(() => topReleaseNotes('## Two\n#### Four\n')).toThrow(
      'Failed to find a level one header.',
    )
  })
  test('CRLF line endings, as a Windows checkout has them', () => {
    expect(topReleaseNotes('# A\r\n\r\nx\r\n# B\r\ny\r\n')).toBe('x')
  })
  test("the repository's CHANGELOG.md has a top section", () => {
    const changelog = readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
    const notes = topReleaseNotes(changelog)
    expect(notes.startsWith('#### ')).toBe(true)
    expect(notes).not.toMatch(/^# /m)
  })
})

test('the release name', () => {
  expect(prettyName('2026.1.1-rc.5')).toBe('Enso 2026.1.1-rc.5')
})

test('the body lists every installer, then the notes verbatim (no HTML entities)', () => {
  expect(releaseBody('jdunkerley/enso', '2026.1.1-rc.5', CHANGELOG)).toBe(
    [
      '# Download',
      '',
      '## Enso IDE',
      '',
      'Enso IDE is the main product of the Enso project. The packages are stand-alone, they contain both GUI and the backend.',
      '',
      'Download links:',
      '- [Windows](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-win-x64-2026.1.1-rc.5.exe)',
      '- [Linux](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-linux-x86_64-2026.1.1-rc.5.AppImage)',
      '- [macOS (Apple silicon)](https://github.com/jdunkerley/enso/releases/download/2026.1.1-rc.5/enso-mac-arm64-2026.1.1-rc.5.dmg)',
      '',
      'This is the recommended download for most users.',
      '',
      '# Changelog',
      '',
      topReleaseNotes(CHANGELOG),
      '',
    ].join('\n'),
  )
})
