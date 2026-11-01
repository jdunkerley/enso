/** @file The open-time harness's pure logic: log lines, phases, medians, warnings. */
import { describe, expect, test } from 'vitest'
import {
  credentialFreeEnv,
  median,
  notMeasured,
  openTimes,
  parseLsLogLine,
  regressionWarnings,
  renderMarkdown,
  type Mark,
  type OpenTimeReport,
  type RunResult,
} from '../../perf/openTimeReport'

describe('parseLsLogLine', () => {
  test('reads the time as local time, since the log has no offset', () => {
    const line =
      '[INFO] [2026-11-01T01:30:33.556] [org.enso.languageserver.boot.LanguageServerComponent] Started server at json:127.0.0.1:30616, <secure-json-not-configured>'
    expect(parseLsLogLine(line)).toEqual({
      time: new Date(2026, 10, 1, 1, 30, 33, 556).getTime(),
      logger: 'org.enso.languageserver.boot.LanguageServerComponent',
      message: 'Started server at json:127.0.0.1:30616, <secure-json-not-configured>',
    })
  })
  test('ignores lines that are not log records', () => {
    expect(parseLsLogLine('    at org.enso.Foo.bar(Foo.java:1)')).toBeNull()
  })
})

const t0 = new Date(2026, 10, 1, 1, 30, 18, 0).getTime()
const ls = (offset: number, message: string) => ({
  time: t0 + offset,
  logger: 'org.enso.languageserver.search.SuggestionsHandler',
  message,
})

describe('openTimes', () => {
  const marks: Mark[] = [
    { k: 'first:click', t: t0 },
    { k: 'engineStdout', t: t0 + 190 },
    { k: 'resp', t: t0 + 395, u: 'project/open' },
    { k: 'wsOpen', t: t0 + 420, u: 'ws://127.0.0.1:30617/project/other' },
    { k: 'wsOpen', t: t0 + 921, u: 'ws://127.0.0.1:30617/project/index?ls=x' },
    { k: 'first:firstNode', t: t0 + 1449 },
    { k: 'first:welcomeShown', t: t0 + 6811 },
    { k: 'second:click', t: t0 + 20_000 },
    { k: 'resp', t: t0 + 20_400, u: 'project/open' },
  ]
  const lines = [
    ls(225, 'Starting Language Server...'),
    ls(260, 'Started server at json:127.0.0.1:30616'),
    ls(4574, 'The first execution finished.'),
  ]

  test('measures every phase from the click', () => {
    expect(openTimes(marks, 'first', lines)).toEqual({
      engineUp: 190,
      lsReady: 260,
      openAnswered: 395,
      guiConnected: 921,
      firstNode: 1449,
      firstExecution: 4574,
      welcomeShown: 6811,
    })
  })
  test('takes the second open’s marks after its own click', () => {
    expect(openTimes(marks, 'second', undefined).openAnswered).toBe(400)
  })
  test('falls back to the log’s first line when the launcher printed nothing', () => {
    const quiet = marks.filter((m) => m.k !== 'engineStdout')
    expect(openTimes(quiet, 'first', lines).engineUp).toBe(225)
  })
})

describe('median', () => {
  test('of an odd count is the middle value', () => expect(median([5, 1, 3])).toBe(3))
  test('of an even count is the mean of the middle two', () =>
    expect(median([4, 1, 3, 2])).toBe(2.5))
  test('of nothing is undefined', () => expect(median([])).toBeUndefined())
})

function report(
  welcome: readonly (number | undefined)[],
  engine: 'native' | 'jvm' = 'native',
  template: 'core' | 'full' = 'core',
) {
  const runs: RunResult[] = welcome.map((welcomeShown, i) => ({
    engine,
    run: i + 1,
    first: welcomeShown == null ? {} : { welcomeShown },
    second: null,
    notMeasured: [],
    ...(welcomeShown == null ? { error: 'no welcome table' } : {}),
  }))
  return {
    version: 1,
    platform: 'linux',
    commit: null,
    template,
    runs,
  } satisfies OpenTimeReport
}

describe('regressionWarnings', () => {
  test('none within the limit and the tolerance', () => {
    expect(regressionWarnings(report([3000, 3100, 3200]), report([3000, 3000, 3000]))).toEqual([])
  })
  test('one over 4 s', () => {
    const warnings = regressionWarnings(report([4100, 4200, 4300]), undefined)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('4200 ms')
  })
  test('one more than 15% worse than develop', () => {
    const warnings = regressionWarnings(report([3500, 3500, 3500]), report([3000, 3000, 3000]))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('17%')
  })
  test('one when fewer than 3 first opens succeeded', () => {
    const warnings = regressionWarnings(report([3000, undefined, undefined]), undefined)
    expect(warnings).toEqual([expect.stringContaining('1 of 3')])
  })
  test('compares each engine with the same engine', () => {
    const both = {
      ...report([3000, 3000, 3000]),
      runs: [...report([3000, 3000, 3000]).runs, ...report([9000, 9000, 9000], 'jvm').runs],
    }
    expect(regressionWarnings(both, report([3000, 3000, 3000]))).toEqual([
      expect.stringContaining('jvm'),
    ])
  })
  test('compares only with a baseline of the same template', () => {
    // develop measured the full template (before #482); this run the core one.
    expect(
      regressionWarnings(report([3000, 3000, 3000]), report([2000, 2000, 2000], 'native', 'full')),
    ).toEqual([])
  })
  test('one when a launch did not measure an extra phase', () => {
    const missing = report([3000, 3000, 3000])
    const runs = missing.runs.map((r, i) =>
      i === 0 ? { ...r, notMeasured: ['dropdownItems' as const] } : r,
    )
    expect(regressionWarnings({ ...missing, runs }, undefined)).toEqual([
      expect.stringContaining('dropdownItems'),
    ])
  })
})

describe('notMeasured', () => {
  test('names the phases and extras an open lacks', () => {
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).toEqual(
      expect.arrayContaining(['engineUp', 'formatWidget', 'dropdownItems']),
    )
    expect(notMeasured({ welcomeShown: 1, cbEntries: 2 })).not.toContain('cbEntries')
  })
})

describe('renderMarkdown', () => {
  test('has a row per phase and the develop column when there is a baseline', () => {
    const text = renderMarkdown(report([3000, 3100, 3200]), report([2900, 2900, 2900]))
    expect(text).toContain('| **Welcome table visualisation shown** |')
    expect(text).toContain('3100')
    expect(text).toContain('2900')
  })
})

describe('credentialFreeEnv', () => {
  test('drops credentials and keeps the rest', () => {
    expect(
      credentialFreeEnv({
        ENSO_CLOUD_TOKEN: 'x',
        AWS_SECRET_ACCESS_KEY: 'x',
        SNOWFLAKE_PASSWORD: 'x',
        GITHUB_TOKEN: 'x',
        PATH: '/bin',
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
      }),
    ).toEqual({ PATH: '/bin', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' })
  })
})
