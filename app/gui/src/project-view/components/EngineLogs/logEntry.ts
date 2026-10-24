/**
 * @file One entry of an engine log file: the first line of each entry carries its level, time and
 * logger, `[LEVEL] [timestamp] [logger] message`; the lines after it (a stack trace, say) do not.
 */

/** The levels, most severe first: an entry's `level` is an index into this. */
export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const

/** The start of an entry. */
export interface LogEntry {
  readonly level: number
  readonly timestamp: Date
  /** The logger's name. */
  readonly module: string
  readonly event: string
}

const ENTRY_RE = new RegExp(`\\[(${LOG_LEVELS.join('|')})] \\[([^\\]]+)] \\[([^\\]]+)] (.*)`)

/** Parse a log line that starts an entry; `undefined` for any other line (a stack trace's, say). */
export function parseEntry(line: string): LogEntry | undefined {
  const matched = ENTRY_RE.exec(line)
  if (!matched) return undefined
  const [, levelName, timestamp, module, event] = matched
  if (levelName == null || timestamp == null || module == null || event == null) return undefined
  const level = LOG_LEVELS.findIndex((name) => name === levelName)
  if (level < 0) return undefined
  return { level, timestamp: new Date(timestamp), module, event }
}
