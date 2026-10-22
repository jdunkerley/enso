/** @file The version rules, ported from the Rust tests and pinned to today's behaviour. */
import { describe, expect, test } from 'vitest'
import {
  type Day,
  type Designation,
  deduceKind,
  deduceOrGenerate,
  generateVersion,
  incrementRc,
  isReleaseMode,
  kindMatches,
  latestReleaseFromConfig,
  nextNightlyIndex,
  parseLsRemoteTags,
  parseNightly,
  parseVersion,
  sameCore,
  version,
} from './version.ts'

const day = (text: string): Day => {
  const [year, month, d] = text.split('-').map(Number)
  return { year: year ?? 0, month: month ?? 0, day: d ?? 0 }
}

describe('generateVersion (promote.rs test_version_generation)', () => {
  const cases: [string, string[], Designation, string][] = [
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'stable', '2021.2.1'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'patch', '2021.1.3'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'rc', '2021.2.1-rc.1'],
    ['2021-02-22', ['2021.1.1', '2021.1.2'], 'nightly', '2021.2.1-nightly.2021.2.22'],
    [
      '2021-02-22',
      ['2021.1.1', '2021.1.2', '2021.2.1-nightly.2021.2.22'],
      'nightly',
      '2021.2.1-nightly.2021.2.22.1',
    ],
    [
      '2021-02-23',
      ['2021.1.1', '2021.1.2', '2021.2.1-nightly.2021.2.22'],
      'nightly',
      '2021.2.1-nightly.2021.2.23',
    ],
    // Origin's real tags on 2026-10-22: rc.1-rc.4 and no stable release.
    [
      '2026-10-22',
      ['2026.1.1-rc.1', '2026.1.1-rc.2', '2026.1.1-rc.3', '2026.1.1-rc.4'],
      'rc',
      '2026.1.1-rc.5',
    ],
    ['2026-10-22', ['2026.1.1-rc.4'], 'stable', '2026.1.1'],
    ['2026-10-22', ['2026.1.1-rc.4'], 'nightly', '2026.1.1-nightly.2026.10.22'],
    // Upstream's old dashed nightlies never parse as nightlies.
    ['2022-02-21', ['2022.1.1-nightly.2022-02-21'], 'nightly', '2022.1.1-nightly.2022.2.21'],
    // A new year resets the minor.
    ['2026-01-05', ['2025.3.4'], 'stable', '2026.1.1'],
  ]
  for (const [today, existing, designation, expected] of cases) {
    test(`${designation} on ${today} after [${existing.join(', ')}] is ${expected}`, () => {
      expect(generateVersion(designation, existing.map(version), day(today)).text).toBe(expected)
    })
  }
  test('patch without a stable release fails', () => {
    expect(() => generateVersion('patch', [version('2026.1.1-rc.4')], day('2026-10-22'))).toThrow(
      'No stable releases found.',
    )
  })
  test('an upstream-style rc1 (which sorts above rc.4) fails the rc designation', () => {
    const tags = ['2026.1.1-rc.4', '2026.1.1-rc1'].map(version)
    expect(() => generateVersion('rc', tags, day('2026-10-22'))).toThrow(
      'RC version has an unexpected prerelease: 2026.1.1-rc1.',
    )
  })
  test('a version from the future fails', () => {
    expect(() => generateVersion('stable', [version('2027.1.1')], day('2026-01-01'))).toThrow(
      'Found version from the future: 2027.1.1.',
    )
  })
})

describe('parseNightly (nightly.rs parsing_nightly_prerelease)', () => {
  test('a date', () => {
    expect(parseNightly(version('2020.1.1-nightly.2020.12.31'))).toEqual({
      date: { year: 2020, month: 12, day: 31 },
      index: null,
    })
  })
  test('a date and an index', () => {
    expect(parseNightly(version('2020.1.1-nightly.2020.12.31.1'))).toEqual({
      date: { year: 2020, month: 12, day: 31 },
      index: 1,
    })
  })
  for (const bad of [
    '2020.1.1-nightly.2020.12.31.1.1',
    '2020.1.1-nightly.12.31',
    '2020.1.1',
    '2020.1.1-rc.1',
    '2020.1.1-nightly.2020.2.30',
  ]) {
    test(`rejects ${bad}`, () => expect(() => parseNightly(version(bad))).toThrow())
  }
  test('next index (nightly.rs doc test)', () => {
    expect(nextNightlyIndex(null)).toBe(1)
    expect(nextNightlyIndex(1)).toBe(2)
  })
})

describe('kinds (version.rs doc tests and is_nightly_test)', () => {
  test('matches', () => {
    expect(kindMatches('nightly', version('2022.1.1-nightly.2022.1.1'))).toBe(true)
    expect(kindMatches('nightly', version('2022.1.1-nightly'))).toBe(true)
    expect(kindMatches('rc', version('2022.1.1-rc.1'))).toBe(true)
    expect(kindMatches('nightly', version('2022.1.1-rc.1'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1-rc.1'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1-nightly'))).toBe(false)
    expect(kindMatches('stable', version('2022.1.1'))).toBe(true)
  })
  test('deduce', () => {
    expect(deduceKind(version('2022.1.1-dev'))).toBe('dev')
    expect(deduceKind(version('2022.1.1-nightly.2022.1.1'))).toBe('nightly')
    expect(deduceKind(version('2022.1.1-nightly.2022-06-06.3'))).toBe('nightly')
    expect(deduceKind(version('2022.1.1-rc.1'))).toBe('rc')
    expect(deduceKind(version('2022.1.1'))).toBe('stable')
    expect(() => deduceKind(version('1.0.0-beta'))).toThrow('Failed to deduce build kind')
  })
  test('incrementRc and sameCore', () => {
    expect(incrementRc(version('0.2.3-rc.1')).text).toBe('0.2.3-rc.2')
    expect(sameCore(version('1.2.3'), version('1.2.3'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.3-beta'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.3+build'))).toBe(true)
    expect(sameCore(version('1.2.3'), version('1.2.4'))).toBe(false)
  })
  test('release mode', () => {
    expect(isReleaseMode(version('2026.1.1-dev'))).toBe(false)
    expect(isReleaseMode(version('2026.1.1-SNAPSHOT'))).toBe(false)
    expect(isReleaseMode(version('2026.1.1-nightly.2026.1.1'))).toBe(true)
    expect(isReleaseMode(version('2026.1.1-rc.1'))).toBe(true)
    expect(isReleaseMode(version('2026.1.1'))).toBe(true)
  })
})

describe('parseVersion: strict, as the Rust semver crate', () => {
  for (const bad of ['', 'foo', 'v2026.1.1', ' 2026.1.1', '2026.01.1', '2026.1', '=2026.1.1']) {
    test(`rejects ${JSON.stringify(bad)}`, () => expect(parseVersion(bad)).toBeNull())
  }
  test('keeps build metadata in the text', () => {
    expect(parseVersion('1.2.3+b.1')).toMatchObject({ text: '1.2.3+b.1', build: 'b.1', pre: '' })
  })
})

describe('deduceOrGenerate', () => {
  const releases = () => [version('2025.3.4')]
  const today = day('2026-10-22')
  test('a dev build follows latest-release: 2026.1.1-dev today', () => {
    const result = deduceOrGenerate({ env: {}, releases, today })
    expect(result.version.text).toBe('2026.1.1-dev')
    expect(result.releaseMode).toBe(false)
  })
  test('the same configuration in 2025 gives 2025.4.1-dev', () => {
    expect(deduceOrGenerate({ env: {}, releases, today: day('2025-06-01') }).version.text).toBe(
      '2025.4.1-dev',
    )
  })
  test('ENSO_VERSION wins, and its release mode follows from it', () => {
    const result = deduceOrGenerate({ env: { ENSO_VERSION: '2026.2.0' }, releases, today })
    expect(result).toMatchObject({ version: { text: '2026.2.0' }, releaseMode: true })
  })
  test('ENSO_EDITION equal to ENSO_VERSION is accepted', () => {
    const env = { ENSO_VERSION: '2026.2.0', ENSO_EDITION: '2026.2.0' }
    expect(deduceOrGenerate({ env, releases, today }).version.text).toBe('2026.2.0')
  })
  for (const edition of ['x', '']) {
    test(`ENSO_EDITION=${JSON.stringify(edition)} beside ENSO_VERSION fails`, () => {
      const env = { ENSO_VERSION: '2026.2.0', ENSO_EDITION: edition }
      expect(() => deduceOrGenerate({ env, releases, today })).toThrow(
        'Inconsistent ENSO_VERSION and ENSO_EDITION variable values.',
      )
    })
  }
  for (const ignored of ['', 'foo', 'v2026.1.1']) {
    test(`ENSO_VERSION=${JSON.stringify(ignored)} is ignored, silently`, () => {
      const env = { ENSO_VERSION: ignored, ENSO_EDITION: 'anything' }
      expect(deduceOrGenerate({ env, releases, today }).version.text).toBe('2026.1.1-dev')
    })
  }
  test('releases are not read when ENSO_VERSION applies', () => {
    const fail = () => {
      throw new Error('read')
    }
    const env = { ENSO_VERSION: '2026.2.0' }
    expect(deduceOrGenerate({ env, releases: fail, today }).version.text).toBe('2026.2.0')
  })
})

describe('latestReleaseFromConfig', () => {
  test('reads the key', () => {
    expect(
      latestReleaseFromConfig('wasm-size-limit: 16.20 MiB\nlatest-release: 2025.3.4\n')?.text,
    ).toBe('2025.3.4')
  })
  test('is null without the key, and fails on a value that is not a version', () => {
    expect(latestReleaseFromConfig('toolchain:\n  sbt: 1.10.6\n')).toBeNull()
    expect(() => latestReleaseFromConfig('latest-release: 2025.3\n')).toThrow('is not a version')
  })
})

describe('parseLsRemoteTags', () => {
  test('keeps strict SemVer tags, once each, and skips the rest', () => {
    const stdout = [
      'a1\trefs/tags/2026.1.1-rc.1',
      'a2\trefs/tags/2026.1.1-rc.1^{}',
      'a3\trefs/tags/enso-0.2.0',
      'a4\trefs/tags/2022.1.1-nightly.2022-02-21',
      'a5\tHEAD',
      '',
    ].join('\n')
    expect(parseLsRemoteTags(stdout).map((v) => v.text)).toEqual([
      '2026.1.1-rc.1',
      '2022.1.1-nightly.2022-02-21',
    ])
  })
  test('fails on a malformed line, and on an unknown ref', () => {
    expect(() => parseLsRemoteTags('a1 refs/tags/x extra\n')).toThrow('Unexpected')
    expect(() => parseLsRemoteTags('a1\trefs/notes/x\n')).toThrow('Unknown ref name')
  })
})
