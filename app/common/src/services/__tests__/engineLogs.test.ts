import { describe, expect, test } from 'vitest'
import {
  ENGINE_LOG_STREAM_PATH,
  engineLoggingArgs,
  engineLogStreamUrl,
  formatAppendedLines,
  GUI_WIDGETS_LOGGER,
  MAX_APPENDED_LINES,
  parseEngineLogAppendBody,
} from '../engineLogs'

describe('engineLogStreamUrl', () => {
  test('names the project', () => {
    const url = new URL(engineLogStreamUrl('project-%2Fp%2FMy Project'), 'http://localhost')
    expect(url.pathname).toBe(ENGINE_LOG_STREAM_PATH)
    expect(url.searchParams.get('project')).toBe('project-%2Fp%2FMy Project')
    expect(url.searchParams.has('after')).toBe(false)
  })

  test('resumes after a sequence number of a channel', () => {
    const url = new URL(engineLogStreamUrl('project-x', { channel: 'c1', after: 41 }), 'http://h')
    expect(url.searchParams.get('channel')).toBe('c1')
    expect(url.searchParams.get('after')).toBe('41')
  })
})

describe('engineLoggingArgs', () => {
  test('passes nothing when no option is on', () => {
    expect(engineLoggingArgs(undefined)).toEqual([])
    expect(engineLoggingArgs({ sqlQueries: false, performanceTimings: false })).toEqual([])
  })

  test('turns the SQL query logger up to info', () => {
    expect(engineLoggingArgs({ sqlQueries: true })).toEqual([
      '--vm.D',
      'Standard.Database.Connection.Logger.level=info',
    ])
  })

  test('turns only the progress logger up to debug', () => {
    expect(engineLoggingArgs({ performanceTimings: true })).toEqual([
      '--vm.D',
      'Standard.Base.Logging.Progress.Logger.level=debug',
    ])
  })

  test('passes both when both are on', () => {
    expect(engineLoggingArgs({ sqlQueries: true, performanceTimings: true })).toHaveLength(4)
  })
})

describe('appended GUI lines', () => {
  test('format as an entry the Logs panel parses, continuation lines indented', () => {
    const lines = formatAppendedLines(
      { project: 'p', level: 'WARN', logger: GUI_WIDGETS_LOGGER, message: 'first\n  second' },
      new Date('2026-11-18T10:00:00.000Z'),
    )
    expect(lines).toEqual([
      '[WARN] [2026-11-18T10:00:00.000Z] [enso.gui.Widgets] first',
      '      second',
    ])
  })

  test('accept only a complete body with a known level', () => {
    const body = { project: 'p', level: 'DEBUG', logger: 'l', message: 'm' }
    expect(parseEngineLogAppendBody(body)).toEqual(body)
    expect(parseEngineLogAppendBody({ ...body, level: 'TRACE' })).toBeUndefined()
    expect(parseEngineLogAppendBody({ ...body, message: 3 })).toBeUndefined()
    expect(parseEngineLogAppendBody(null)).toBeUndefined()
  })
})

describe('appended GUI lines are hardened', () => {
  const body = { project: 'p', level: 'WARN', logger: 'enso.gui.Widgets', message: 'm' } as const
  const now = new Date('2026-11-18T10:00:00.000Z')

  test('a logger that could break the entry format is refused', () => {
    expect(parseEngineLogAppendBody({ ...body, logger: 'a] [b' })).toBeUndefined()
    expect(parseEngineLogAppendBody({ ...body, logger: 'x\ny' })).toBeUndefined()
    expect(parseEngineLogAppendBody({ ...body, logger: '' })).toBeUndefined()
    expect(parseEngineLogAppendBody({ ...body, logger: 'Standard.Base$Inner-1' })).toBeDefined()
  })

  test('continuation lines are indented, and every line break splits', () => {
    const lines = formatAppendedLines(
      { ...body, message: 'a\r\n[ERROR] [t] [forged] x\r[INFO] [t] [f] y\nz' },
      now,
    )
    expect(lines.slice(1)).toEqual(['    [ERROR] [t] [forged] x', '    [INFO] [t] [f] y', '    z'])
  })

  test('control characters other than tab are stripped', () => {
    const lines = formatAppendedLines({ ...body, message: 'a\u001b[31m\u0000b\tc' }, now)
    expect(lines[0]).toMatch(/a\[31mb\tc$/)
  })

  test('the lines of one append are capped, with a marker', () => {
    const message = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n')
    const lines = formatAppendedLines({ ...body, message }, now)
    expect(lines).toHaveLength(MAX_APPENDED_LINES + 1)
    expect(lines.at(-1)).toBe(`    … (${500 - MAX_APPENDED_LINES} more lines)`)
  })
})
