/** @file The JVM-by-default gate: ratios of JVM to native per dispatch, their median, the outcome. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  dispatchRatio,
  gateCell,
  gateDecision,
  gateOutcome,
  gateReport,
  gateTable,
  gateValue,
  launchCount,
  type DispatchRatios,
  type GateCell,
} from '../../perf/gate'
import type { Engine, OpenTimeReport, OpenTimes, RunResult } from '../../perf/openTimeReport'

function run(engine: Engine, first: OpenTimes, n = 1): RunResult {
  return { engine, run: n, first, second: null, notMeasured: [] }
}

const shimAot = { trainingMs: 1000, cacheBytes: 1, rejectedIn: [] as number[] }

/**
 * A report whose `engine` launches have the given `phase` times; `null` is a launch that never
 * reached the phase.
 */
function report(
  phase: 'welcomeShown' | 'libraryShown',
  engines: Partial<Record<Engine, readonly (number | null)[]>>,
  extra: Partial<OpenTimeReport> = {},
): OpenTimeReport {
  return {
    version: 1,
    platform: 'win32',
    commit: null,
    template: 'core',
    shimAot,
    runs: Object.entries(engines).flatMap(([engine, times]) =>
      times.map((t, i) => run(engine as Engine, t == null ? {} : { [phase]: t }, i + 1)),
    ),
    ...extra,
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
  test('reads libraryShown from the image project, where it marks the headline', () => {
    const r = report(
      'welcomeShown',
      { native: [8000, 9000, 10_000], jvm: [6000, 6300, 6600] },
      { project: 'image' },
    )
    expect(dispatchRatio(r, 'libraryShown', 'jvm')).toBeCloseTo(6300 / 9000)
  })
  test('does not take a welcome report for the library', () => {
    const r = report('welcomeShown', { native: [8000, 9000, 10_000], jvm: [6000, 6300, 6600] })
    expect(dispatchRatio(r, 'libraryShown', 'jvm')).toBeUndefined()
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
  })
})

describe('failed launches count against the JVM', () => {
  test('a JVM launch that never reached the phase ranks above every success', () => {
    const complete = report('welcomeShown', {
      native: [4000, 4000, 4000, 4000, 4000],
      jvm: [6000, 6000, 8000, 9000],
    })
    const withFailure = report('welcomeShown', {
      native: [4000, 4000, 4000, 4000, 4000],
      jvm: [6000, 6000, 8000, 9000, null],
    })
    // Dropping the failure would give the median of four (7000); keeping it, the third of five.
    expect(dispatchRatio(complete, 'welcomeShown', 'jvm')).toBeCloseTo(7000 / 4000)
    expect(dispatchRatio(withFailure, 'welcomeShown', 'jvm')).toBeCloseTo(8000 / 4000)
  })
  test('is infinite when the median launch failed', () => {
    const r = report('welcomeShown', {
      native: [4000, 4000, 4000],
      jvm: [6000, null, null],
    })
    expect(dispatchRatio(r, 'welcomeShown', 'jvm')).toBe(Number.POSITIVE_INFINITY)
  })
  test('a native launch that failed ranks below every success, which raises the ratio', () => {
    const r = report('welcomeShown', {
      native: [4000, 5000, null],
      jvm: [8000, 8000, 8000],
    })
    expect(dispatchRatio(r, 'welcomeShown', 'jvm')).toBeCloseTo(8000 / 4000)
  })
})

describe('launchCount and gateCell', () => {
  test('count the launches that reached the phase, out of those made', () => {
    const r = report('welcomeShown', {
      native: [4000, 4000, 4000, 4000, 4000],
      jvm: [6000, null, 6000, null, 6000],
    })
    expect(launchCount(r, 'jvm', 'welcomeShown')).toEqual({ ok: 3, total: 5 })
    expect(gateCell(r, 'welcomeShown', 'jvm').native).toEqual({ ok: 5, total: 5 })
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
  test('is decided on the value as printed, to two decimals', () => {
    expect(gateOutcome(1.6004, 1.2)).toBe('owner decides')
    expect(gateOutcome(1.5004, 1.2)).toBe('pass')
    expect(gateOutcome(1.606, 1.2)).toBe('fail')
  })
  test('decides on exactly the printed value, at half-cent doubles', () => {
    // 1.605 prints as "1.60" (not over the limit), 1.505 as "1.50" (a pass); Math.round says 1.61 and 1.51.
    expect(
      gateTable([dispatch('1', 1.605, 1), dispatch('2', 1.605, 1), dispatch('3', 1.605, 1)]),
    ).toContain('**1.60**')
    expect(gateOutcome(1.605, 1.2)).toBe('owner decides')
    expect(gateOutcome(1.2, 1.605)).toBe('owner decides')
    expect(gateOutcome(1.505, 1.2)).toBe('pass')
    expect(gateOutcome(1.595, 1.2)).toBe('owner decides')
  })
  test('a missing value (NaN) is no pass, an infinite one fails', () => {
    expect(gateOutcome(Number.NaN, 1.2)).toBe('fail')
    expect(gateOutcome(Number.POSITIVE_INFINITY, 1.2)).toBe('fail')
  })
})

const cell = (ratio: number, ok = 5, nativeOk = 5): GateCell => ({
  ratio,
  engine: { ok, total: 5 },
  native: { ok: nativeOk, total: 5 },
})

const dispatch = (name: string, welcome: number, library: number, ok = 5): DispatchRatios => ({
  name,
  welcome: { jvm: cell(welcome, ok) },
  library: { jvm: cell(library, ok) },
})

describe('gateTable', () => {
  test('a row per dispatch with its launch counts, then the gate value', () => {
    const table = gateTable([
      dispatch('101', 1.4, 0.9),
      dispatch('102', 1.7, 1),
      dispatch('103', 1.5, 0.8),
    ])
    expect(table).toContain('| 101 | 1.40 (5/5 launches, native 5/5) |')
    expect(table).toContain('**1.50**')
    expect(table).toContain('**0.90**')
  })
  test('marks a cell with too few launches as incomplete', () => {
    const table = gateTable([dispatch('101', 1.4, 0.9, 2)])
    expect(table).toContain('1.40 (2/5 launches, native 5/5; incomplete)')
  })
  test('without a decision the last row is plain and says it is not a gate value', () => {
    const table = gateTable([dispatch('1', 1.88, 1), dispatch('2', 1.9, 1)])
    expect(table).not.toContain('Gate value')
    expect(table).not.toContain('**')
    expect(table).toContain('(not a gate value)')
  })
  test('the gate value is the median of the latest three complete dispatches', () => {
    const table = gateTable([
      dispatch('1', 9, 9),
      dispatch('2', 1.4, 1),
      dispatch('3', 1.5, 1),
      dispatch('4', 1.3, 1),
    ])
    expect(table).toContain('**1.40**')
    expect(table).not.toContain('(not a gate value)')
  })
  test('marks which dispatches decide the gate and why the others are set aside', () => {
    const rows = gateTable([
      dispatch('1', 9, 9),
      dispatch('2', 1.4, 1, 2),
      dispatch('3', 1.4, 1),
      dispatch('4', 1.5, 1),
      dispatch('5', 1.3, 1),
    ]).split(String.fromCharCode(10))
    const row = (name: string) => rows.find((r) => r.startsWith(`| ${name} |`))
    expect(row('1')).toContain('| set aside: older than the latest 3 complete dispatches |')
    expect(row('2')).toContain('| set aside: incomplete')
    for (const name of ['3', '4', '5']) expect(row(name)?.endsWith('| used |')).toBe(true)
  })
  test('without enough complete dispatches none is used, and the table says so', () => {
    const rows = gateTable([dispatch('1', 1.4, 1), dispatch('2', 1.4, 1, 2)]).split(
      String.fromCharCode(10),
    )
    expect(rows.find((r) => r.startsWith('| 1 |'))).toContain('not used: fewer than 3 complete')
    expect(rows.find((r) => r.startsWith('| 2 |'))).toContain('set aside: incomplete')
  })
  test('says when a dispatch has no report, and prints an infinite ratio as such', () => {
    const table = gateTable([
      { name: '1', welcome: {}, library: {} },
      { name: '2', welcome: { jvm: cell(Number.POSITIVE_INFINITY, 3) }, library: {} },
    ])
    expect(table).toContain('– (no report)')
    expect(table).toContain('inf (the median launch failed)')
  })
})

describe('gateDecision', () => {
  const three = [dispatch('1', 1.4, 1.2), dispatch('2', 1.5, 1.3), dispatch('3', 1.45, 1.1)]
  test('three complete dispatches give the outcome', () => {
    expect(gateDecision(three)).toBe('pass')
    expect(gateDecision([dispatch('1', 2, 1), dispatch('2', 2.1, 1), dispatch('3', 1.9, 1)])).toBe(
      'fail',
    )
  })
  test('with four dispatches, one incomplete is set aside and the latest three complete decide', () => {
    const four = [
      dispatch('1', 2, 1),
      dispatch('2', 1.4, 1.2, 2),
      ...three.slice(0, 2),
      dispatch('5', 1.45, 1.1),
    ]
    expect(gateDecision(four)).toBe('pass')
    // the oldest complete one (2.0) is not among the latest three
    expect(gateDecision([dispatch('0', 2, 1), ...three])).toBe('pass')
  })
  test('older complete outliers do not decide: only the latest three do', () => {
    // Over all six dispatches the median would be (1.5 + 9) / 2 = 5.25, a fail.
    const old = [dispatch('a', 9, 9), dispatch('b', 9, 9), dispatch('c', 9, 9)]
    expect(gateDecision([...old, ...three])).toBe('pass')
  })
  test('older incomplete dispatches do not decide either, whatever their ratios', () => {
    // Their ratios are over the fail limit; counted, the median would be (1.5 + 2) / 2.
    const old = [dispatch('a', 2, 2, 2), dispatch('b', 2, 2, 2), dispatch('c', 2, 2, 2)]
    expect(gateDecision([...old, ...three])).toBe('pass')
  })
  test('four dispatches with only two complete are insufficient', () => {
    expect(
      gateDecision([dispatch('1', 1.4, 1, 2), dispatch('2', 1.4, 1, 2), ...three.slice(0, 2)]),
    ).toBe('insufficient data')
  })
  test('fewer than three dispatches are insufficient data, whatever the ratios', () => {
    expect(gateDecision(three.slice(0, 2))).toBe('insufficient data')
    expect(gateDecision([])).toBe('insufficient data')
  })
  test('a cell with fewer than 3 successful launches makes it insufficient', () => {
    expect(gateDecision([...three.slice(0, 2), dispatch('3', 1.4, 1.2, 2)])).toBe(
      'insufficient data',
    )
  })
  test('so does a native cell with fewer than 3', () => {
    const weakNative: DispatchRatios = {
      name: '3',
      welcome: { jvm: cell(1.4, 5, 2) },
      library: { jvm: cell(1.2) },
    }
    expect(gateDecision([...three.slice(0, 2), weakNative])).toBe('insufficient data')
  })
  test('so does a dispatch with no report for one template', () => {
    const missing: DispatchRatios = { name: '3', welcome: three[2]!.welcome, library: {} }
    expect(gateDecision([...three.slice(0, 2), missing])).toBe('insufficient data')
  })
})

describe('gateReport', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-test-'))
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

  function write(dispatchName: string, platform: string, template: string, r: OpenTimeReport) {
    const dir = path.join(scratch, dispatchName, platform, template)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'open-time.json'), JSON.stringify(r))
  }

  const good = (phase: 'welcomeShown', project?: string) =>
    report(
      phase,
      { native: [4000, 4000, 4000], jvm: [5000, 5000, 5000], 'jvm-first': [9000, 9000, 9000] },
      project ? { project } : {},
    )

  test('refuses a dispatch whose jvm runs have no shimAot (made before PR K)', () => {
    const old = { ...good('welcomeShown') } as { shimAot?: unknown }
    delete old.shimAot
    write('old', 'windows', 'welcome', old as OpenTimeReport)
    expect(() => gateReport([path.join(scratch, 'old')])).toThrow(/no shimAot.*before PR K/)
  })

  test('with three complete Windows dispatches it prints the outcome; Linux is informational', () => {
    for (const d of ['d1', 'd2', 'd3']) {
      for (const platform of ['windows', 'linux']) {
        write(d, platform, 'welcome', good('welcomeShown'))
        write(d, platform, 'image', good('welcomeShown', 'image'))
      }
    }
    const text = gateReport(['d1', 'd2', 'd3'].map((d) => path.join(scratch, d)))
    expect(text).toContain('Outcome (Windows, `jvm`): **pass**')
    expect(text).toContain('### linux (informational, not gated)')
    expect(text).not.toMatch(/linux: (pass|fail|owner decides)/)
  })

  test('with two dispatches it says insufficient data and prints no outcome', () => {
    const text = gateReport(['d1', 'd2'].map((d) => path.join(scratch, d)))
    expect(text).toContain('**insufficient data**')
    expect(text).not.toMatch(/\*\*(pass|fail|owner decides)\*\*/)
  })

  test('a welcome report filed under image gives no library ratio', () => {
    write('d3', 'windows', 'image', good('welcomeShown'))
    const text = gateReport(['d1', 'd2', 'd3'].map((d) => path.join(scratch, d)))
    expect(text).toContain('**insufficient data**')
  })
})
