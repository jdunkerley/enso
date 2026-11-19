import { GUI_WIDGETS_LOGGER, formatAppendedLines } from 'enso-common/src/services/engineLogs'
import { describe, expect, test } from 'vitest'
import { LOG_LEVELS, parseEntry } from '../logEntry'

test('parses the start of an entry', () => {
  const LOG =
    '[INFO] [2026-04-14T09:28:02.655] [org.enso.languageserver.boot.LanguageServerComponent] Starting Language Server...'
  expect(parseEntry(LOG)).toEqual({
    level: LOG_LEVELS.indexOf('INFO'),
    timestamp: new Date('2026-04-14T09:28:02.655'),
    module: 'org.enso.languageserver.boot.LanguageServerComponent',
    event: 'Starting Language Server...',
  })
})

test('a line that starts no entry is not one', () => {
  expect(parseEntry('    at org.enso.Foo.bar(Foo.java:12)')).toBeUndefined()
  expect(parseEntry('[NOTICE] [2026-04-14T09:28:02.655] [x] y')).toBeUndefined()
})

test('every level parses, by its index', () => {
  for (const [index, level] of LOG_LEVELS.entries()) {
    expect(parseEntry(`[${level}] [2026-04-14T09:28:02.655] [a.b] c`)?.level).toBe(index)
  }
})

describe('an appended GUI entry', () => {
  const body = { project: 'p', level: 'WARN', logger: GUI_WIDGETS_LOGGER, message: 'a' } as const
  const now = new Date('2026-11-18T10:00:00.000Z')

  test('parses as a WARN entry of the widgets logger', () => {
    const entry = parseEntry(formatAppendedLines(body, now)[0] ?? '')
    expect(entry?.level).toBe(LOG_LEVELS.indexOf('WARN'))
    expect(entry?.module).toBe('enso.gui.Widgets')
  })

  test('a forged entry in the message is only a continuation line', () => {
    const lines = formatAppendedLines({ ...body, message: 'a\n[ERROR] [t] [forged] x' }, now)
    expect(lines).toHaveLength(2)
    expect(parseEntry(lines[1] ?? '')).toBeUndefined()
  })
})
