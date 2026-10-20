/**
 * @file The engine log as the Logs tab shows it: rows built from the stream's events, with the
 * level rules, dividers, the live cap and history splicing. Framework-free; `engineLogStream.ts`
 * makes it reactive.
 */
import { LOG_LEVELS, parseEntry } from '$/components/ProjectLog/projectLogData'
import type {
  EngineLogEndReason,
  EngineLogHelloData,
  EngineLogLineData,
  EngineLogSessionData,
  EngineLogSource,
  EngineLogWaitingData,
} from 'enso-common/src/services/engineLogs'

/** The most rows the view keeps; older ones remain in the session's history. */
export const LIVE_ROW_CAP = 20_000
export const ERROR_LEVEL = LOG_LEVELS.indexOf('ERROR')
export const WARN_LEVEL = LOG_LEVELS.indexOf('WARN')
export const INFO_LEVEL = LOG_LEVELS.indexOf('INFO')

/** How many live file lines must match to place history above them. */
const OVERLAP_CHECK = 3

/**
 * - `restarted` — a new engine started.
 * - `skipped` — lines were lost while the stream was down.
 * - `truncated` — older lines are not shown.
 */
export type DividerKind = 'restarted' | 'skipped' | 'truncated'

/** One line of the log. */
export interface LogLine {
  readonly kind: 'line'
  readonly key: number
  readonly source: EngineLogSource
  readonly text: string
  /** An index into `LOG_LEVELS`. */
  readonly level: number
  /** Whether the line starts a log entry (rather than continuing one, as a stack trace does). */
  readonly entryStart: boolean
}

/** A marker between lines. */
export interface LogDivider {
  readonly kind: 'divider'
  readonly key: number
  readonly divider: DividerKind
}

/** A row of the Logs tab. */
export type LogRow = LogLine | LogDivider

/** The level filter: ERROR only, WARN and above, or INFO and above. */
export type LevelFilter = 'error' | 'warn' | 'info'

const MAX_LEVEL: Readonly<Record<LevelFilter, number>> = {
  error: ERROR_LEVEL,
  warn: WARN_LEVEL,
  info: INFO_LEVEL,
}

/**
 * Gives lines their level. An entry has its own; a line that starts no entry continues the
 * previous entry and takes its level (INFO before any); stderr is ERROR.
 */
export class LineClassifier {
  private level = INFO_LEVEL

  /** The level of `text`, and whether it starts an entry. */
  classify(text: string, source: EngineLogSource): { level: number; entryStart: boolean } {
    if (source === 'stderr') return { level: ERROR_LEVEL, entryStart: true }
    const entry = parseEntry(text)
    if (entry == null) return { level: this.level, entryStart: false }
    this.level = entry.level
    return { level: entry.level, entryStart: true }
  }

  /** Forget the current entry (a new session starts). */
  reset(): void {
    this.level = INFO_LEVEL
  }
}

/** The start of `head` in `lines`, searching from the end; `lines.length` when it is not there. */
export function overlapStart(lines: readonly string[], head: readonly string[]): number {
  for (let i = lines.length - head.length; i >= 0; i--) {
    if (head.every((text, j) => lines[i + j] === text)) return i
  }
  return lines.length
}

/** Rows for a session read whole (an earlier session): its newest {@link LIVE_ROW_CAP} lines. */
export function rowsFromLines(lines: readonly string[]): LogRow[] {
  const shown = lines.length > LIVE_ROW_CAP ? lines.slice(lines.length - LIVE_ROW_CAP) : lines
  const classifier = new LineClassifier()
  const rows: LogRow[] = []
  if (shown.length < lines.length) rows.push({ kind: 'divider', key: 0, divider: 'truncated' })
  for (const text of shown) {
    rows.push({
      kind: 'line',
      key: rows.length + 1,
      source: 'file',
      text,
      ...classifier.classify(text, 'file'),
    })
  }
  return rows
}

/** The rows a filter shows: every divider, and the lines at or above the level that contain the text. */
export function filterRows(
  rows: readonly LogRow[],
  filter: { readonly level: LevelFilter; readonly text: string },
): readonly LogRow[] {
  const needle = filter.text.trim().toLowerCase()
  const maxLevel = MAX_LEVEL[filter.level]
  if (needle === '' && filter.level === 'info') {
    return rows.filter((row) => row.kind === 'divider' || row.level <= maxLevel)
  }
  return rows.filter(
    (row) =>
      row.kind === 'divider' ||
      (row.level <= maxLevel && (needle === '' || row.text.toLowerCase().includes(needle))),
  )
}

/** The Logs tab's rows and state, built from the stream's events. */
export class EngineLogModel {
  /** The rows, oldest first. New rows reach it on {@link commit}. */
  readonly rows: LogRow[] = []
  waiting = false
  ended: EngineLogEndReason | undefined = undefined
  /** The current session, as `listProjectSessions` names it; `null` while it has no file. */
  sessionId: string | null = null
  logFile: string | null = null
  /** ERROR entries and stderr lines not yet seen. */
  unseenErrors = 0

  private pending: LogRow[] = []
  private channel: string | undefined
  private lastSeq: number | undefined
  private nextKey = 1
  private previousKey = 0
  private hadEngine = false
  private sessionBeganInView = false
  private sessionFirstKey: number | undefined
  private sessionRowsDropped = false
  private readonly classifier = new LineClassifier()

  /** Whether the rows hold the current session from its start, so that it has nothing older to load. */
  get sessionStartHeld(): boolean {
    return this.sessionBeganInView && !this.sessionRowsDropped
  }

  /** Where a dropped stream resumes; `undefined` before the first event of a channel. */
  resumeFrom(): { readonly channel: string; readonly after: number } | undefined {
    return this.channel == null || this.lastSeq == null ?
        undefined
      : { channel: this.channel, after: this.lastSeq }
  }

  /** A connection's first event. The project is open, so any earlier end no longer holds. */
  onHello(data: EngineLogHelloData): void {
    const sameChannel = this.channel === data.channel
    const hasRows = this.rows.length + this.pending.length > 0
    if (!sameChannel && this.channel != null && hasRows) {
      this.addDivider('skipped')
    } else if (sameChannel && this.lastSeq != null && data.oldestSeq > this.lastSeq + 1) {
      this.addDivider('skipped')
    }
    if (!sameChannel) {
      this.lastSeq = undefined
      this.sessionBeganInView = false
      this.sessionRowsDropped = false
      this.sessionFirstKey = undefined
    }
    this.channel = data.channel
    this.sessionId = data.sessionId
    this.logFile = data.logFile ?? this.logFile
    this.ended = undefined
  }

  /** A log line. */
  onLine(data: EngineLogLineData): void {
    if (!this.accept(data.seq)) return
    this.hadEngine = true
    const { level, entryStart } = this.classifier.classify(data.text, data.source)
    this.pending.push({
      kind: 'line',
      key: this.nextKey++,
      source: data.source,
      text: data.text,
      level,
      entryStart,
    })
    if (entryStart && level === ERROR_LEVEL) this.unseenErrors += 1
  }

  /** An engine started; a restart when one ran before. */
  onWaiting(data: EngineLogWaitingData): void {
    if (!this.accept(data.seq)) return
    if (this.hadEngine) this.addDivider('restarted')
    this.hadEngine = true
    this.waiting = true
    this.sessionId = null
    this.sessionBeganInView = true
    this.sessionRowsDropped = false
    this.sessionFirstKey = this.nextKey
    this.classifier.reset()
  }

  /** The session's log file was found. */
  onSession(data: EngineLogSessionData): void {
    if (!this.accept(data.seq)) return
    this.hadEngine = true
    this.waiting = false
    this.sessionId = data.sessionId
    this.logFile = data.logFile
  }

  /** The stream ended. */
  onEnd(reason: EngineLogEndReason): void {
    this.ended = reason
    this.waiting = false
  }

  /**
   * Move new rows into {@link rows}, keeping the newest {@link LIVE_ROW_CAP}.
   * @returns Whether anything changed.
   */
  commit(): boolean {
    if (this.pending.length === 0) return false
    for (const row of this.pending) this.rows.push(row)
    this.pending = []
    const excess = this.rows.length - LIVE_ROW_CAP
    if (excess > 0) {
      const dropped = this.rows.splice(0, excess)
      const first = this.sessionFirstKey
      if (first != null && dropped.some((row) => row.key >= first)) this.sessionRowsDropped = true
    }
    return true
  }

  /** The unseen errors have been seen. */
  markSeen(): void {
    this.unseenErrors = 0
  }

  /**
   * Put the current session's earlier lines above the rows. `lines` is the session's whole file
   * history, oldest first; the part before the first live file line goes in above that line (after
   * any start-up stderr), at most as many as fit under {@link LIVE_ROW_CAP}.
   */
  prependHistory(lines: readonly string[]): void {
    this.commit()
    const firstFileIndex = this.rows.findIndex(
      (row) => row.kind === 'line' && row.source === 'file',
    )
    const liveFile =
      firstFileIndex < 0 ?
        []
      : this.rows
          .slice(firstFileIndex)
          .flatMap((row) => (row.kind === 'line' && row.source === 'file' ? [row.text] : []))
          .slice(0, OVERLAP_CHECK)
    let older = lines.slice(0, liveFile.length === 0 ? lines.length : overlapStart(lines, liveFile))
    const room = Math.max(LIVE_ROW_CAP - this.rows.length, 0)
    const truncated = older.length > room
    if (truncated) older = older.slice(older.length - room)
    const classifier = new LineClassifier()
    const added: LogRow[] = older.map((text): LogRow => ({
      kind: 'line',
      key: 0,
      source: 'file',
      text,
      ...classifier.classify(text, 'file'),
    }))
    if (truncated) added.unshift({ kind: 'divider', key: 0, divider: 'truncated' })
    // Keys below every existing one, increasing downwards, so they stay unique.
    const keyed = added.map((row, index): LogRow => ({
      ...row,
      key: this.previousKey - added.length + index,
    }))
    this.previousKey -= added.length
    this.rows.splice(firstFileIndex < 0 ? this.rows.length : firstFileIndex, 0, ...keyed)
    this.sessionBeganInView = true
    this.sessionRowsDropped = false
    this.sessionFirstKey = keyed[0]?.key ?? this.sessionFirstKey ?? this.nextKey
  }

  private accept(seq: number): boolean {
    if (this.lastSeq != null && seq <= this.lastSeq) return false
    this.lastSeq = seq
    return true
  }

  private addDivider(divider: DividerKind): void {
    this.pending.push({ kind: 'divider', key: this.nextKey++, divider })
  }
}
