/** @file The JVM-by-default gate: ratios of JVM to native per dispatch, their median, the outcome. */
import { describe, expect, test } from 'vitest'
import { dispatchRatio, gateOutcome, gateTable, gateValue } from '../../perf/gate'
import type { Engine, OpenTimeReport, OpenTimes, RunResult } from '../../perf/openTimeReport'

function run(engine: Engine, first: OpenTimes, n = 1): RunResult {
  return { engine, run: n, first, second: null, notMeasured: [] }
}

/** A report whose `engine` launches have the given `phase` times. */
function report(
  phase: 'welcomeShown' | 'libraryShown',
  engines: Partial<Record<Engine, readonly number[]>>,
  template: OpenTimeReport['template'] = 'core',
): OpenTimeReport {
  return {
    version: 1,
    platform: 'win32',
    commit: null,
    template,
    runs: Object.entries(engines).flatMap(([engine, times]) =>
      times.map((t, i) => run(engine as Engine, { [phase]: t }, i + 1)),
    ),
  }
}

describe('dispatchRatio', () => {
  test('is the median of the engine over the median of native, in one report', () => {
    const r = report('welcomeShown', {
      native: [4000, 5000, 4500],
      jvm: [6000, 9000, 7000],
      'jvm-first': [10_000, 12_000, 11_000],
    })
    expect(dispatchRatio(r, 'welcomeShown', 'jvm')).toBeCloseTo(7000 / 4500)
    expect(dispatchRatio(r, 'welcomeShown', 'jvm-first')).toBeCloseTo(11_000 / 4500)
  })
  test('reads libraryShown from the image template, where it marks the headline', () => {
    const r = report('welcomeShown', { native: [8000, 9000, 10_000], jvm: [6000, 6300, 6600] })
    expect(dispatchRatio(r, 'libraryShown', 'jvm')).toBeCloseTo(6300 / 9000)
  })
  test('prefers a libraryShown that the report has', () => {
    const r = report('libraryShown', { native: [2000, 2000, 2000], jvm: [3000, 3000, 3000] })
    expect(dispatchRatio(r, 'libraryShown', 'jvm')).toBe(1.5)
  })
  test('is undefined without launches of either engine', () => {
    expect(dispatchRatio(report('welcomeShown', { native: [4000] }), 'welcomeShown', 'jvm')).toBe(
      undefined,
    )
    expect(dispatchRatio(report('welcomeShown', { jvm: [4000] }), 'welcomeShown', 'jvm')).toBe(
      undefined,
    )
    expect(
      dispatchRatio(report('welcomeShown', { native: [4000], jvm: [] }), 'welcomeShown', 'jvm'),
    ).toBe(undefined)
  })
  test('ignores launches that missed the phase', () => {
    const r = report('welcomeShown', { native: [4000, 4000], jvm: [6000] })
    const withFailure = {
      ...r,
      runs: [...r.runs, run('jvm', {}, 2), run('native', {}, 3)],
    }
    expect(dispatchRatio(withFailure, 'welcomeShown', 'jvm')).toBe(1.5)
  })
})

describe('gateValue', () => {
  test('is the median of the per-dispatch ratios', () => {
    expect(gateValue([1.4, 1.7, 1.5])).toBe(1.5)
    expect(gateValue([1.2])).toBe(1.2)
    expect(gateValue([1.2, 1.4])).toBeCloseTo(1.3)
  })
  test('is NaN without ratios', () => {
    expect(gateValue([])).toBeNaN()
  })
})

describe('gateOutcome', () => {
  test('both at or under 1.5 pass', () => {
    expect(gateOutcome(1.5, 1.5)).toBe('pass')
    expect(gateOutcome(1.2, 1.49)).toBe('pass')
  })
  test('between 1.5 and 1.6 the owner decides', () => {
    expect(gateOutcome(1.55, 1.2)).toBe('owner decides')
    expect(gateOutcome(1.2, 1.55)).toBe('owner decides')
    expect(gateOutcome(1.6, 1.6)).toBe('owner decides')
  })
  test('either over 1.6 fails, whatever the other is', () => {
    expect(gateOutcome(1.61, 1.2)).toBe('fail')
    expect(gateOutcome(1.4, 1.65)).toBe('fail')
    expect(gateOutcome(1.65, 1.55)).toBe('fail')
  })
  test('a missing value (NaN) is no pass', () => {
    expect(gateOutcome(Number.NaN, 1.2)).toBe('fail')
  })
})

describe('gateTable', () => {
  test('a row per dispatch, then the gate value', () => {
    const table = gateTable([
      { name: '101', welcome: { jvm: 1.4, 'jvm-first': 2 }, library: { jvm: 0.9 } },
      { name: '102', welcome: { jvm: 1.7, 'jvm-first': 2.2 }, library: { jvm: 1 } },
      { name: '103', welcome: { jvm: 1.5, 'jvm-first': 2.1 }, library: { jvm: 0.8 } },
    ])
    expect(table).toContain('| 101 | 1.40 | 2.00 | 0.90 | – |')
    expect(table).toContain('| **Gate value** | **1.50** | **2.10** | **0.90** | **–** |')
  })
})
