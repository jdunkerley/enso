/** @file Pooling the reports of several rounds. */
import { describe, expect, test } from 'vitest'
import type { OpenTimeReport } from '../../perf/openTimeReport'
import { poolReports, pooledMarkdown } from '../../perf/poolReports'

const report = (headlines: number[], platform = 'win32'): OpenTimeReport => ({
  version: 1,
  platform,
  commit: null,
  template: 'core',
  runs: headlines.map((welcomeShown, i) => ({
    engine: 'jvm',
    run: i + 1,
    first: { welcomeShown },
    second: null,
    notMeasured: [],
  })),
})

describe('poolReports', () => {
  test('keeps every launch, numbered by round', () => {
    const pooled = poolReports([report([1, 2]), report([3])])
    expect(pooled.runs.map((r) => [r.run, r.first.welcomeShown])).toEqual([
      [101, 1],
      [102, 2],
      [201, 3],
    ])
  })

  test('refuses reports of different platforms or templates', () => {
    expect(() => poolReports([report([1]), report([2], 'linux')])).toThrow(/different/)
    expect(() => poolReports([])).toThrow(/no reports/)
  })

  test('renders the pooled launches', () => {
    expect(pooledMarkdown(poolReports([report([1000]), report([3000])]))).toContain('jvm')
  })
})
