import type { EngineLogHelloData, EngineLogSource } from 'enso-common/src/services/engineLogs'
import { describe, expect, test } from 'vitest'
import {
  EngineLogModel,
  ERROR_LEVEL,
  filterRows,
  INFO_LEVEL,
  LIVE_ROW_CAP,
  overlapStart,
  rowsFromLines,
  WARN_LEVEL,
  type LogRow,
} from '../engineLogModel'

const entry = (level: string, message: string) =>
  `[${level}] [2026-10-20T10:00:00.000Z] [org.enso.Test] ${message}`

function feed(model = new EngineLogModel()) {
  let seq = 0
  return {
    model,
    hello: (overrides: Partial<EngineLogHelloData> = {}) =>
      model.onHello({
        channel: 'c1',
        oldestSeq: 1,
        nextSeq: 1,
        sessionId: null,
        logFile: null,
        ...overrides,
      }),
    waiting: () => model.onWaiting({ seq: ++seq }),
    session: (sessionId = 's1') =>
      model.onSession({ seq: ++seq, sessionId, logFile: `/logs/${sessionId}.log` }),
    line: (text: string, source: EngineLogSource = 'file') =>
      model.onLine({ seq: ++seq, source, sessionId: 's1', text }),
    skipTo: (next: number) => {
      seq = next - 1
    },
  }
}

const ALL_ORIGINS = { engine: true, library: true, user: true, sql: true, performance: true }

const texts = (rows: readonly LogRow[]) =>
  rows.map((row) => (row.kind === 'line' ? row.text : `--${row.divider}--`))

describe('EngineLogModel', () => {
  test('classifies entries by level, continuation lines by their entry, and stderr as ERROR', () => {
    const f = feed()
    f.hello()
    f.line('a line before any entry')
    f.line(entry('WARN', 'careful'))
    f.line('  at Foo.bar')
    f.line('Picked up JAVA_TOOL_OPTIONS', 'stderr')
    f.model.commit()
    expect(
      f.model.rows.map((row) => (row.kind === 'line' ? [row.level, row.entryStart] : null)),
    ).toEqual([
      [INFO_LEVEL, false],
      [WARN_LEVEL, true],
      [WARN_LEVEL, false],
      [ERROR_LEVEL, true],
    ])
  })

  test('ignores an event it already has', () => {
    const f = feed()
    f.hello()
    f.model.onLine({ seq: 1, source: 'file', sessionId: 's1', text: 'once' })
    f.model.onLine({ seq: 1, source: 'file', sessionId: 's1', text: 'once' })
    f.model.commit()
    expect(texts(f.model.rows)).toEqual(['once'])
  })

  test("marks a restart at the next engine's start, not at the first", () => {
    const f = feed()
    f.hello()
    f.waiting()
    f.session('s1')
    f.line('a')
    f.line('crash', 'stderr')
    f.waiting()
    f.line('new engine starting', 'stderr')
    f.session('s2')
    f.line('b')
    f.model.commit()
    expect(texts(f.model.rows)).toEqual(['a', 'crash', '--restarted--', 'new engine starting', 'b'])
    expect(f.model.sessionId).toBe('s2')
    expect(f.model.waiting).toBe(false)
  })

  test('the first session event adds no divider', () => {
    const f = feed()
    f.hello()
    f.session('s1')
    f.line('a')
    f.model.commit()
    expect(texts(f.model.rows)).toEqual(['a'])
    expect(f.model.logFile).toBe('/logs/s1.log')
  })

  test('a hello clears an earlier end', () => {
    const f = feed()
    f.hello()
    f.model.onEnd('not-open')
    expect(f.model.ended).toBe('not-open')
    f.hello()
    expect(f.model.ended).toBeUndefined()
  })

  test('counts ERROR entries, not stderr lines, as unseen until marked seen', () => {
    const f = feed()
    f.hello()
    f.line(entry('INFO', 'fine'))
    f.line(entry('ERROR', 'broken'))
    f.line('  at Foo.bar')
    f.line('boom', 'stderr')
    expect(f.model.unseenErrors).toBe(1)
    f.model.markSeen()
    expect(f.model.unseenErrors).toBe(0)
  })

  test('shows a skipped divider after a gap, or on another channel', () => {
    const f = feed()
    f.hello()
    f.line('1')
    f.line('2')
    f.hello({ oldestSeq: 10, nextSeq: 12 })
    f.skipTo(10)
    f.line('10')
    f.hello({ channel: 'c2' })
    f.skipTo(1)
    f.line('fresh')
    f.model.commit()
    expect(texts(f.model.rows)).toEqual(['1', '2', '--skipped--', '10', '--skipped--', 'fresh'])
  })

  test('resumes from the last sequence number of its channel', () => {
    const f = feed()
    expect(f.model.resumeFrom()).toBeUndefined()
    f.hello()
    f.line('1')
    f.line('2')
    expect(f.model.resumeFrom()).toEqual({ channel: 'c1', after: 2 })
    f.hello({ channel: 'c2' })
    expect(f.model.resumeFrom()).toBeUndefined()
  })

  test(`keeps the newest ${LIVE_ROW_CAP} rows`, () => {
    const f = feed()
    f.hello()
    for (let n = 1; n <= LIVE_ROW_CAP + 5; n++) f.line(`line ${n}`)
    f.model.commit()
    expect(f.model.rows).toHaveLength(LIVE_ROW_CAP)
    expect(texts(f.model.rows.slice(0, 1))).toEqual(['line 6'])
  })

  test('knows whether it holds the current session from its start', () => {
    const midway = feed()
    midway.hello({ sessionId: 's1' })
    midway.line('somewhere in the middle')
    midway.model.commit()
    expect(midway.model.sessionStartHeld).toBe(false)

    const fromStart = feed()
    fromStart.hello()
    fromStart.waiting()
    fromStart.session()
    fromStart.line('first')
    fromStart.model.commit()
    expect(fromStart.model.sessionStartHeld).toBe(true)
    for (let n = 0; n < LIVE_ROW_CAP; n++) fromStart.line(`more ${n}`)
    fromStart.model.commit()
    expect(fromStart.model.sessionStartHeld).toBe(false)
  })

  test('prepends the earlier lines of the session above its first live file line', () => {
    const f = feed()
    f.hello({ sessionId: 's1' })
    f.line('started', 'stderr')
    f.line('L3')
    f.line('L4')
    f.model.prependHistory(['L1', 'L2', 'L3', 'L4'])
    expect(texts(f.model.rows)).toEqual(['started', 'L1', 'L2', 'L3', 'L4'])
    expect(new Set(f.model.rows.map((row) => row.key)).size).toBe(5)
    expect(f.model.sessionStartHeld).toBe(true)
  })

  test('after its history has loaded, a drop at the cap leaves nothing older to load', () => {
    const f = feed()
    f.hello({ sessionId: 's1' })
    f.line('L3')
    f.model.prependHistory(['L1', 'L2', 'L3'])
    expect(f.model.sessionStartHeld).toBe(true)
    for (let n = 0; n < LIVE_ROW_CAP; n++) f.line(`more ${n}`)
    f.model.commit()
    expect(texts(f.model.rows)).not.toContain('L1')
    expect(f.model.sessionStartHeld).toBe(true)
    // A new session starts out of view again: its earlier lines can be loaded.
    f.hello({ channel: 'c2', sessionId: 's2' })
    expect(f.model.sessionStartHeld).toBe(false)
  })

  test('prepends history at the current session after a channel change', () => {
    const f = feed()
    f.hello({ sessionId: 's1' })
    f.line('old1')
    f.hello({ channel: 'c2', sessionId: 's2' })
    f.skipTo(1)
    f.line('new1')
    f.model.prependHistory(['n0', 'new1'])
    expect(texts(f.model.rows)).toEqual(['old1', '--skipped--', 'n0', 'new1'])
    expect(f.model.sessionStartHeld).toBe(true)
  })

  test('a gap that changes the session lets its earlier lines be loaded', () => {
    const f = feed()
    f.hello()
    f.waiting()
    f.session('s1')
    f.line('a')
    f.model.commit()
    expect(f.model.sessionStartHeld).toBe(true)
    f.hello({ oldestSeq: 50, nextSeq: 60, sessionId: 's2' })
    expect(f.model.sessionStartHeld).toBe(false)
  })

  test('prepends every line when none of the live ones is in the history', () => {
    const f = feed()
    f.hello({ sessionId: 's1' })
    f.line('live')
    f.model.prependHistory(['h1', 'h2'])
    expect(texts(f.model.rows)).toEqual(['h1', 'h2', 'live'])
  })

  test('caps prepended history to the room left, under a truncated divider', () => {
    const f = feed()
    f.hello({ sessionId: 's1' })
    for (let n = 0; n < LIVE_ROW_CAP - 2; n++) f.line(`live ${n}`)
    f.model.prependHistory(['h1', 'h2', 'h3', 'h4'])
    expect(texts(f.model.rows.slice(0, 4))).toEqual(['--truncated--', 'h3', 'h4', 'live 0'])
  })
})

describe('helpers', () => {
  test('overlapStart finds where the live lines begin in the history', () => {
    expect(overlapStart(['a', 'b', 'c', 'd'], ['c', 'd'])).toBe(2)
    expect(overlapStart(['x', 'c', 'x', 'c', 'd'], ['c', 'd'])).toBe(3)
    expect(overlapStart(['a', 'b'], ['z'])).toBe(2)
  })

  test('rowsFromLines keeps the newest lines under a truncated divider', () => {
    const lines = Array.from({ length: LIVE_ROW_CAP + 1 }, (_, n) => `l${n}`)
    const rows = rowsFromLines(lines)
    expect(rows).toHaveLength(LIVE_ROW_CAP + 1)
    expect(texts(rows.slice(0, 2))).toEqual(['--truncated--', 'l1'])
    expect(texts(rowsFromLines(['a']))).toEqual(['a'])
  })

  test('filterRows keeps dividers, and lines at or above the level that contain the text', () => {
    const rows = rowsFromLines([
      entry('INFO', 'started'),
      entry('WARN', 'slow query'),
      entry('ERROR', 'query failed'),
      '  at Query.run',
    ])
    const withDivider: LogRow[] = [{ kind: 'divider', key: 99, divider: 'restarted' }, ...rows]
    expect(
      texts(filterRows(withDivider, { level: 'error', text: '', origins: ALL_ORIGINS })),
    ).toEqual(['--restarted--', entry('ERROR', 'query failed'), '  at Query.run'])
    expect(
      texts(filterRows(withDivider, { level: 'warn', text: ' SLOW ', origins: ALL_ORIGINS })),
    ).toEqual(['--restarted--', entry('WARN', 'slow query')])
    expect(filterRows(withDivider, { level: 'all', text: '', origins: ALL_ORIGINS })).toHaveLength(
      5,
    )
  })
})
