/**
 * @file The engine log as the Logs tab shows it: rows built from the stream's events, with the
 * level rules, dividers, the live cap and history splicing. Framework-free; `engineLogStream.ts`
 * makes it reactive.
 */
import {
  PERFORMANCE_LOGGER,
  SQL_QUERY_LOGGER,
  type EngineLogEndReason,
  type EngineLogHelloData,
  type EngineLogLineData,
  type EngineLogSessionData,
  type EngineLogSource,
  type EngineLogWaitingData,
} from 'enso-common/src/services/engineLogs'
import { LOG_LEVELS, parseEntry } from './logEntry'

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
 * - `truncated` — older lines are not shown; the list offers to load them.
 * - `newer` — newer lines are not shown (a window paged back through a session); the list offers to
 *   load them.
 */
export type DividerKind = 'restarted' | 'skipped' | 'truncated' | 'newer'

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
  /** Who wrote the line: the engine, a library or the user's own code (see {@link logOrigin}). */
  readonly origin: LogOrigin
}

/** A marker between lines. */
export interface LogDivider {
  readonly kind: 'divider'
  readonly key: number
  readonly divider: DividerKind
  /**
   * For `truncated` and `newer`: the session whose lines it stands for, which its Load older / Load
   * newer lines button pages through; `null` when that session is not known, and nothing is offered.
   */
  readonly sessionId?: string | null
}

/** The lines above the live view that are not in it: which session they belong to. */
export interface OlderLines {
  /** `null` while that session is not known (it has no file yet, or it scrolled away unnamed). */
  readonly sessionId: string | null
}

/** A row of the Logs tab. */
export type LogRow = LogLine | LogDivider

/**
 * The level filter: ERROR only, WARN and above, or every level. The log file holds nothing below
 * INFO unless a logger was turned up for the engine (the performance timings are DEBUG), so the
 * most verbose choice shows those lines too.
 */
export type LevelFilter = 'error' | 'warn' | 'all'

const MAX_LEVEL: Readonly<Record<LevelFilter, number>> = {
  error: ERROR_LEVEL,
  warn: WARN_LEVEL,
  all: LOG_LEVELS.length - 1,
}

/**
 * Who wrote a line:
 * - `user` — the user's own log messages (`log_message`, which logs under `User.<type name>`);
 * - `sql` — the SQL queries of local database connections ({@link SQL_QUERY_LOGGER});
 * - `performance` — the timings of `Progress.run` ({@link PERFORMANCE_LOGGER} and its children);
 * - `library` — the rest of the libraries: the standard library, user projects' libraries, their Java;
 * - `engine` — the engine itself, and its stderr.
 *
 * SQL queries and timings are logged only when their setting is on (Settings → Local → Engine
 * logs); the panel shows their tickboxes only then.
 */
export type LogOrigin = 'engine' | 'library' | 'user' | 'sql' | 'performance'

/** Which origins the Logs tab shows. */
export type OriginFilter = Readonly<Record<LogOrigin, boolean>>

/** The origins shown at first: everything but the engine's internals. */
export const DEFAULT_ORIGINS: OriginFilter = {
  engine: false,
  library: true,
  user: true,
  sql: true,
  performance: true,
}

/** How the Sources button sums up which of the tickboxes `shown` are ticked. */
export type OriginSummary =
  | { readonly kind: 'all' | 'none' }
  | { readonly kind: 'one'; readonly origin: LogOrigin }
  | { readonly kind: 'some'; readonly ticked: number; readonly shown: number }

/**
 * Sum up the tickboxes `shown` (in their order): all, none, the one ticked, or how many of them.
 * Only the boxes shown count, so a hidden box's state never shows in the summary.
 */
export function originSummary(shown: readonly LogOrigin[], origins: OriginFilter): OriginSummary {
  const ticked = shown.filter((origin) => origins[origin])
  if (ticked.length === shown.length) return { kind: 'all' }
  if (ticked.length === 0) return { kind: 'none' }
  if (ticked.length === 1) return { kind: 'one', origin: ticked[0]! }
  return { kind: 'some', ticked: ticked.length, shown: shown.length }
}

/**
 * The first segment of the logger name `log_message` logs under (`User.<qualified type name>`,
 * `distribution/lib/Standard/Base/0.0.0-dev/src/Logging.enso`). The libraries log with
 * `log_internal`, under the type name alone.
 */
export const USER_LOGGER_ROOT = 'User'

/**
 * The logger names the engine itself logs under. A name is the engine's when it is one of these or
 * starts with one followed by a dot (whole segments: `akka` does not cover `akkadia`).
 *
 * - `org.enso`: the runtime, compiler, language server, logging, ydoc server and the rest, except
 *   the standard library's Java helpers ({@link STD_BITS_PACKAGE_ROOTS}).
 * - `enso`, `epb`, `arrow`, `enso-runtime-server`, `enso-debug-server`, `id-value-extractor` and
 *   `engine`: the Truffle languages and instruments, and the polyglot engine. Truffle prefixes a
 *   logger's name with its language or instrument id (`enso.org.enso.interpreter.runtime.EnsoContext`),
 *   and `JulHandler` (`lib/scala/logging-utils`) forwards the record under that name.
 * - The engine's own third-party stack: `akka`, `org.graalvm`, `com.oracle.truffle`, `io.helidon`,
 *   `org.eclipse.jetty`.
 */
export const ENGINE_LOGGER_ROOTS: readonly string[] = [
  'org.enso',
  'enso',
  'epb',
  'arrow',
  'enso-runtime-server',
  'enso-debug-server',
  'id-value-extractor',
  'engine',
  'akka',
  'org.graalvm',
  'com.oracle.truffle',
  'io.helidon',
  'org.eclipse.jetty',
]

/**
 * The package roots of the standard library's Java helpers, `std-bits/<lib>/src/main/java/org/enso/<root>`.
 * They sit under `org.enso`, but their logs are the libraries'. `nativeimage` is in `std-bits/table`
 * and `benchmarks` in `std-bits/benchmarks`; `Generic_JDBC` has no Java of its own (it builds on
 * `database`). A test fails when a root on disk is missing here.
 */
export const STD_BITS_PACKAGE_ROOTS: readonly string[] = [
  'org.enso.aws',
  'org.enso.base',
  'org.enso.benchmarks',
  'org.enso.database',
  'org.enso.database_test_suite',
  'org.enso.duckdb',
  'org.enso.google',
  'org.enso.image',
  'org.enso.microsoft',
  'org.enso.nativeimage',
  'org.enso.saas',
  'org.enso.snowflake',
  'org.enso.sqlite',
  'org.enso.table',
  'org.enso.tableau',
]

/** Whether `name` is `root` or lies under it, by whole dot-separated segments. */
function underRoot(name: string, root: string): boolean {
  return name === root || (name.startsWith(root) && name.charAt(root.length) === '.')
}

/**
 * Who wrote an entry, from its logger name: the user for a name under {@link USER_LOGGER_ROOT}; SQL
 * for {@link SQL_QUERY_LOGGER} itself (Enso modules under `Standard.Database.Connection` log under
 * their own type names, which are a library's); performance for a name under
 * {@link PERFORMANCE_LOGGER}; the engine for a name under {@link ENGINE_LOGGER_ROOTS} and not under
 * {@link STD_BITS_PACKAGE_ROOTS}; a library for anything else.
 *
 * The default is Library on purpose. The engine's names are few and known; the libraries' are open:
 * Enso modules (`Standard.*`, every user project and library), the std-bits helpers, and whatever
 * third-party Java they pull in (JDBC drivers, cloud SDKs, …), which any new library adds to. A name
 * nobody foresaw is far more likely to be a library's, and listing it with the libraries keeps a
 * user's own logs from hiding under Engine.
 */
export function logOrigin(loggerName: string): LogOrigin {
  if (underRoot(loggerName, USER_LOGGER_ROOT)) return 'user'
  if (loggerName === SQL_QUERY_LOGGER) return 'sql'
  if (underRoot(loggerName, PERFORMANCE_LOGGER)) return 'performance'
  if (STD_BITS_PACKAGE_ROOTS.some((root) => underRoot(loggerName, root))) return 'library'
  return ENGINE_LOGGER_ROOTS.some((root) => underRoot(loggerName, root)) ? 'engine' : 'library'
}

/** What {@link LineClassifier} says of a line. */
export interface LineClass {
  readonly level: number
  readonly entryStart: boolean
  readonly origin: LogOrigin
}

/**
 * Gives lines their level and origin. An entry has its own; a line that starts no entry continues
 * the previous entry and takes its level and origin (INFO and library before any); stderr is the
 * engine's, and ERROR.
 */
export class LineClassifier {
  private level = INFO_LEVEL
  private origin: LogOrigin = 'library'

  /** The level and origin of `text`, and whether it starts an entry. */
  classify(text: string, source: EngineLogSource): LineClass {
    if (source === 'stderr') {
      return { level: ERROR_LEVEL, entryStart: true, origin: 'engine' }
    }
    const entry = parseEntry(text)
    if (entry == null) {
      return { level: this.level, entryStart: false, origin: this.origin }
    }
    this.level = entry.level
    this.origin = logOrigin(entry.module)
    return { level: entry.level, entryStart: true, origin: this.origin }
  }

  /** Forget the current entry (a new session starts). */
  reset(): void {
    this.level = INFO_LEVEL
    this.origin = 'library'
  }
}

/** The start of `head` in `lines`, searching from the end; `lines.length` when it is not there. */
export function overlapStart(lines: readonly string[], head: readonly string[]): number {
  for (let i = lines.length - head.length; i >= 0; i--) {
    if (head.every((text, j) => lines[i + j] === text)) return i
  }
  return lines.length
}

/** Whether a window of a session's lines has lines before or after it, and its first key. */
export interface WindowEdges {
  readonly older: boolean
  readonly newer: boolean
  /**
   * The first line's key; the others follow it. A window passes its first line's number, so a line
   * keeps its key while the window moves and the list keeps its place.
   */
  readonly firstKey: number
  /** The session the lines are from, which the dividers' load buttons page through. */
  readonly sessionId: string
  /**
   * The start of the entry the first line continues, if known: continuation lines at the top take
   * its level and origin instead of an unknown library's.
   */
  readonly leadingEntry: string | null
}

/**
 * Rows for lines of a file read (an earlier session, or a window of one): at most its newest
 * {@link LIVE_ROW_CAP} lines, with a `truncated` divider above them when there are older lines and a
 * `newer` one below them when there are newer ones. Lines above the first entry in view continue an
 * entry out of view: they take `leadingEntry`'s level and origin when it is given, else they are an
 * unknown library's.
 */
export function rowsFromLines(
  lines: readonly string[],
  edges: Partial<WindowEdges> = {},
): LogRow[] {
  const shown = lines.length > LIVE_ROW_CAP ? lines.slice(lines.length - LIVE_ROW_CAP) : lines
  const firstKey = edges.firstKey ?? 1
  const classifier = new LineClassifier()
  if (edges.leadingEntry != null) classifier.classify(edges.leadingEntry, 'file')
  const rows: LogRow[] = []
  if (shown.length < lines.length || edges.older === true) {
    rows.push({
      kind: 'divider',
      key: Number.MIN_SAFE_INTEGER,
      divider: 'truncated',
      sessionId: edges.sessionId ?? null,
    })
  }
  for (const [index, text] of shown.entries()) {
    rows.push({
      kind: 'line',
      key: firstKey + index,
      source: 'file',
      text,
      ...classifier.classify(text, 'file'),
    })
  }
  if (edges.newer === true) {
    rows.push({
      kind: 'divider',
      key: Number.MAX_SAFE_INTEGER,
      divider: 'newer',
      sessionId: edges.sessionId ?? null,
    })
  }
  return rows
}

/** What the Logs tab filters on. */
export interface RowFilter {
  readonly level: LevelFilter
  readonly text: string
  readonly origins: OriginFilter
}

/**
 * The rows a filter shows: every divider, and the lines of a shown origin, at or above the level,
 * that contain the text.
 */
export function filterRows(rows: readonly LogRow[], filter: RowFilter): readonly LogRow[] {
  const needle = filter.text.trim().toLowerCase()
  const maxLevel = MAX_LEVEL[filter.level]
  const origins = filter.origins
  if (needle === '' && Object.values(origins).every((shown) => shown)) {
    return rows.filter((row) => row.kind === 'divider' || row.level <= maxLevel)
  }
  return rows.filter(
    (row) =>
      row.kind === 'divider' ||
      (row.level <= maxLevel &&
        origins[row.origin] &&
        (needle === '' || row.text.toLowerCase().includes(needle))),
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
  /** ERROR entries of the log file not yet seen, whatever their origin; stderr is not counted. */
  unseenErrors = 0
  /**
   * Lines above the rows that are not in them (history that did not fit, or rows dropped at the
   * cap); `null` when the rows begin where the log does. State, not a row: the cap trims rows, and
   * must not trim away the offer to load them. The view shows it as a `truncated` divider.
   */
  olderLines: OlderLines | null = null

  private pending: LogRow[] = []
  private channel: string | undefined
  private lastSeq: number | undefined
  private nextKey = 1
  private previousKey = 0
  private hadEngine = false
  private sessionBeganInView = false
  private sessionFirstKey: number | undefined
  /** The key of the first live row of the current session; history goes in at or after it. */
  private sessionAnchorKey = 0
  /** Whether the current session's history has been spliced in (it is never spliced twice). */
  private historySpliced = false
  /** Whether that history reached back to the session's first line. */
  private historyFromStart = false
  private sessionRowsDropped = false
  /** Whether {@link olderLines} is the current session's (and follows its id). */
  private olderLinesCurrent = false
  private readonly classifier = new LineClassifier()

  /**
   * Whether the current session's first line has been in the rows: they held it from its start, or
   * its spliced history reached back to it. (A later drop at the cap may have removed it again;
   * {@link olderLines} then offers it.)
   */
  get sessionStartHeld(): boolean {
    return (
      (this.historySpliced && this.historyFromStart) ||
      (this.sessionBeganInView && !this.sessionRowsDropped)
    )
  }

  /** Whether reaching the top of the live view should splice in the session's history. */
  get canLoadHistory(): boolean {
    return !this.historySpliced && !this.sessionStartHeld
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
      // The lost lines may have held a restart: a different session starts out of view.
      if (data.sessionId !== this.sessionId) this.startSessionOutOfView()
    }
    if (!sameChannel) {
      this.lastSeq = undefined
      this.startSessionOutOfView()
    }
    this.channel = data.channel
    this.sessionId = data.sessionId
    this.bindOlderLines()
    this.logFile = data.logFile ?? this.logFile
    this.ended = undefined
  }

  /** A log line. */
  onLine(data: EngineLogLineData): void {
    if (!this.accept(data.seq)) return
    this.hadEngine = true
    const { level, entryStart, origin } = this.classifier.classify(data.text, data.source)
    this.pending.push({
      kind: 'line',
      key: this.nextKey++,
      source: data.source,
      text: data.text,
      level,
      entryStart,
      origin,
    })
    if (data.source === 'file' && entryStart && level === ERROR_LEVEL) this.unseenErrors += 1
  }

  /** An engine started; a restart when one ran before. */
  onWaiting(data: EngineLogWaitingData): void {
    if (!this.accept(data.seq)) return
    if (this.hadEngine) this.addDivider('restarted')
    this.hadEngine = true
    this.waiting = true
    // Older lines above the view stay the previous session's.
    this.olderLinesCurrent = false
    this.sessionId = null
    this.sessionBeganInView = true
    this.sessionRowsDropped = false
    this.sessionFirstKey = this.nextKey
    this.sessionAnchorKey = this.nextKey
    this.historySpliced = false
    this.historyFromStart = false
    this.classifier.reset()
  }

  /** The session's log file was found. */
  onSession(data: EngineLogSessionData): void {
    if (!this.accept(data.seq)) return
    this.hadEngine = true
    this.waiting = false
    this.sessionId = data.sessionId
    this.logFile = data.logFile
    this.bindOlderLines()
  }

  /** The stream ended. */
  onEnd(reason: EngineLogEndReason): void {
    this.ended = reason
    this.waiting = false
  }

  /**
   * Move new rows into {@link rows}, keeping the newest {@link LIVE_ROW_CAP}. Rows dropped at the cap
   * become {@link olderLines}: the current session's when any of its rows went (its spliced
   * history has negative keys), else lines of an earlier session, offered only if already named.
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
      const currentDropped =
        first != null &&
        dropped.some((row) => row.key >= first || (this.historySpliced && row.key < 0))
      if (currentDropped) {
        this.sessionRowsDropped = true
        this.setOlderLinesOfCurrent()
      } else if (this.olderLines == null) {
        this.olderLines = { sessionId: null }
      }
    }
    return true
  }

  /** The unseen errors have been seen. */
  markSeen(): void {
    this.unseenErrors = 0
  }

  /**
   * Put the current session's earlier lines above the rows. `lines` are the newest lines of its
   * file, oldest first, and `hasOlder` whether the file has lines before them; the part before the
   * first live file line goes in above that line (after any start-up stderr), at most as many as
   * fit under {@link LIVE_ROW_CAP}. Lines left out (older in the file, or cut for room) become
   * {@link olderLines}; only history that reached the session's first line holds its start.
   */
  prependHistory(lines: readonly string[], hasOlder = false): void {
    this.commit()
    if (this.historySpliced) return
    const firstFileIndex = this.rows.findIndex(
      (row) => row.kind === 'line' && row.source === 'file' && row.key >= this.sessionAnchorKey,
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
    // Keys below every existing one, increasing downwards, so they stay unique.
    const keyed = added.map((row, index): LogRow => ({
      ...row,
      key: this.previousKey - added.length + index,
    }))
    this.previousKey -= added.length
    this.rows.splice(firstFileIndex < 0 ? this.rows.length : firstFileIndex, 0, ...keyed)
    this.historySpliced = true
    this.historyFromStart = !hasOlder && !truncated
    if (this.historyFromStart) {
      this.sessionBeganInView = true
      this.sessionRowsDropped = false
    } else {
      this.setOlderLinesOfCurrent()
    }
    this.sessionFirstKey = keyed[0]?.key ?? this.sessionFirstKey ?? this.nextKey
  }

  /** The current session has lines above the rows. */
  private setOlderLinesOfCurrent(): void {
    this.olderLines = { sessionId: this.sessionId }
    this.olderLinesCurrent = true
  }

  /** The current session's older lines take its id once it has one. */
  private bindOlderLines(): void {
    if (this.olderLinesCurrent && this.olderLines?.sessionId !== this.sessionId) {
      this.olderLines = { sessionId: this.sessionId }
    }
  }

  /** The rows from here on belong to a session whose start is not in view. */
  private startSessionOutOfView(): void {
    // Older lines above the view stay the previous session's.
    this.olderLinesCurrent = false
    this.sessionBeganInView = false
    this.sessionRowsDropped = false
    this.sessionFirstKey = this.nextKey
    this.sessionAnchorKey = this.nextKey
    this.historySpliced = false
    this.historyFromStart = false
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
