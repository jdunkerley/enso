import { expect, test } from 'vitest'
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
