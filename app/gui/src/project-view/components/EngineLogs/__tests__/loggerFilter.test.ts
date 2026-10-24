import { describe, expect, test } from 'vitest'
import {
  DEFAULT_ORIGINS,
  EngineLogModel,
  filterRows,
  loggerMatches,
  loggerSuggestions,
  rowsFromLines,
  type LogRow,
} from '../engineLogModel'

const entry = (logger: string, message: string) =>
  `[INFO] [2026-10-20T10:00:00.000Z] [${logger}] ${message}`

const TABLE = entry('Standard.Table.Table.Table', 'read rows')
const TRACE = '    at org.enso.table.Reader.read(Reader.java:12)'
const BASE = entry('Standard.Base.Data.Vector', 'sorted')
const BASELINE = entry('Standard.Baseline.Thing', 'not Base')
const USER = entry('User.local.Project.Main', 'mine')

const texts = (rows: readonly LogRow[]) =>
  rows.map((row) => (row.kind === 'line' ? row.text : `--${row.divider}--`))

describe('loggers', () => {
  test("each line has its entry's logger; a continuation line follows its entry", () => {
    const rows = rowsFromLines(['before any entry', TABLE, TRACE, BASE])
    expect(rows.map((row) => (row.kind === 'line' ? row.logger : null))).toEqual([
      null,
      'Standard.Table.Table.Table',
      'Standard.Table.Table.Table',
      'Standard.Base.Data.Vector',
    ])
  })

  test('live lines have loggers too; stderr has none', () => {
    const model = new EngineLogModel()
    model.onLine({ seq: 1, source: 'file', sessionId: 's', text: TABLE })
    model.onLine({ seq: 2, source: 'file', sessionId: 's', text: TRACE })
    model.onLine({ seq: 3, source: 'stderr', sessionId: 's', text: 'boom' })
    model.commit()
    expect(model.rows.map((row) => (row.kind === 'line' ? row.logger : null))).toEqual([
      'Standard.Table.Table.Table',
      'Standard.Table.Table.Table',
      null,
    ])
  })

  test('a prefix matches by whole segments; one ending in a dot matches by text', () => {
    expect(loggerMatches('Standard.Base.Data.Vector', 'Standard.Base')).toBe(true)
    expect(loggerMatches('Standard.Base', 'Standard.Base')).toBe(true)
    expect(loggerMatches('Standard.Baseline.Thing', 'Standard.Base')).toBe(false)
    expect(loggerMatches('Standard.Base.Data', 'Standard.Base.')).toBe(true)
    expect(loggerMatches('Standard.Baseline', 'Standard.Base.')).toBe(false)
    expect(loggerMatches('Standard.Table', 'Standard.Ta')).toBe(false)
  })
})

describe('the logger filter', () => {
  const rows = rowsFromLines([TABLE, TRACE, BASE, BASELINE, USER])
  const shown = (logger: string) =>
    texts(filterRows(rows, { level: 'all', text: '', origins: DEFAULT_ORIGINS, logger }))

  test('empty shows every logger', () => {
    expect(shown('')).toEqual([TABLE, TRACE, BASE, BASELINE, USER])
    expect(shown('   ')).toHaveLength(5)
  })

  test('keeps the entries under the prefix, with their continuation lines', () => {
    expect(shown('Standard.Table')).toEqual([TABLE, TRACE])
    expect(shown('Standard.Base')).toEqual([BASE])
    expect(shown('Standard')).toEqual([TABLE, TRACE, BASE, BASELINE])
    expect(shown('User')).toEqual([USER])
    expect(shown('nothing.here')).toEqual([])
  })

  test('combines with the sources and the text, and keeps dividers', () => {
    const withDivider = rowsFromLines([TABLE, BASE, USER], { older: true })
    const filter = { level: 'all' as const, text: '', origins: DEFAULT_ORIGINS }
    expect(texts(filterRows(withDivider, { ...filter, logger: 'Standard' }))).toEqual([
      '--truncated--',
      TABLE,
      BASE,
    ])
    expect(
      texts(
        filterRows(withDivider, {
          ...filter,
          logger: 'User',
          origins: { ...DEFAULT_ORIGINS, user: false },
        }),
      ),
    ).toEqual(['--truncated--'])
    expect(
      texts(filterRows(withDivider, { ...filter, logger: 'Standard', text: 'sorted' })),
    ).toEqual(['--truncated--', BASE])
  })

  test('stderr has no logger, so a prefix hides it', () => {
    const model = new EngineLogModel()
    model.onLine({ seq: 1, source: 'stderr', sessionId: 's', text: 'boom' })
    model.commit()
    const filter = {
      level: 'all' as const,
      text: '',
      origins: { ...DEFAULT_ORIGINS, engine: true },
    }
    expect(filterRows(model.rows, { ...filter, logger: 'org' })).toEqual([])
    expect(filterRows(model.rows, filter)).toHaveLength(1)
  })
})

describe('logger suggestions', () => {
  test('every logger seen and its dotted prefixes, sorted', () => {
    const rows = rowsFromLines([TABLE, TRACE, BASE, USER])
    expect(loggerSuggestions(rows)).toEqual([
      'Standard',
      'Standard.Base',
      'Standard.Base.Data',
      'Standard.Base.Data.Vector',
      'Standard.Table',
      'Standard.Table.Table',
      'Standard.Table.Table.Table',
      'User',
      'User.local',
      'User.local.Project',
      'User.local.Project.Main',
    ])
  })

  test('at most the limit, keeping the broadest', () => {
    const rows = rowsFromLines([TABLE, BASE, USER])
    expect(loggerSuggestions(rows, 3)).toEqual(['Standard', 'Standard.Base', 'User'])
  })
})

describe('rows of a window', () => {
  test('dividers mark older and newer lines; keys start at the first line', () => {
    const rows = rowsFromLines(['a', 'b'], { older: true, newer: true, firstKey: -40 })
    expect(texts(rows)).toEqual(['--truncated--', 'a', 'b', '--newer--'])
    expect(rows.filter((row) => row.kind === 'line').map((row) => row.key)).toEqual([-40, -39])
    expect(new Set(rows.map((row) => row.key)).size).toBe(4)
  })

  test('without edges, a whole file has neither divider', () => {
    expect(texts(rowsFromLines(['a', 'b']))).toEqual(['a', 'b'])
  })
})
