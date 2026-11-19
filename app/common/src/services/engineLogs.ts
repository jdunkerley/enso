/**
 * @file The wire format of the engine log stream, `GET /api/engine-logs/stream`, shared by the
 * project-manager shim, which serves it, and the GUI, which reads it. See
 * `docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`.
 *
 * The stream is server-sent events: `hello`, then the buffered events after `after`, then live
 * ones (`line`, `session`, `waiting`), a `: heartbeat` comment every
 * {@link ENGINE_LOG_HEARTBEAT_MS}, and `end` when the project closes.
 */

/** The stream's path on the app's local server. */
export const ENGINE_LOG_STREAM_PATH = '/api/engine-logs/stream'
/** How often the server writes a comment, so that idle connections stay open. */
export const ENGINE_LOG_HEARTBEAT_MS = 15_000
/** How many of the newest events the server keeps per project, to replay on (re)connection. */
export const ENGINE_LOG_REPLAY_CAPACITY = 5_000

/** Where a line came from: the session's log file, the engine's stderr, or the IDE itself. */
export type EngineLogSource = 'file' | 'stderr' | 'gui'

/** `line`: one line of the log, as the engine wrote it. */
export interface EngineLogLineData {
  readonly seq: number
  readonly source: EngineLogSource
  /** The session's id, as `listProjectSessions` reports it; `null` before its file exists. */
  readonly sessionId: string | null
  readonly text: string
}

/** `session`: the engine's session log file has been found (after a start or a restart). */
export interface EngineLogSessionData {
  readonly seq: number
  readonly sessionId: string
  readonly logFile: string
}

/** `waiting`: an engine has started and its session log file does not exist yet. */
export interface EngineLogWaitingData {
  readonly seq: number
}

/** `hello`: the first event of every connection. */
export interface EngineLogHelloData {
  /** Identifies this opening of the project; `after` applies only to the same channel. */
  readonly channel: string
  /** The oldest sequence number the server still holds: anything older was dropped. */
  readonly oldestSeq: number
  readonly nextSeq: number
  /** The current session, if its file has been found. */
  readonly sessionId: string | null
  readonly logFile: string | null
}

/**
 * Why the stream ended: the project closed, or it was not open. On `not-open` the client retries
 * with backoff while it is active (the project may still be opening); `closed` is terminal until
 * the project or the client's active state changes.
 */
export type EngineLogEndReason = 'closed' | 'not-open'

/** `end`: the last event of a stream. */
export interface EngineLogEndData {
  readonly reason: EngineLogEndReason
}

/** The stream's URL for a project (its id in the GUI); `resume` continues a dropped stream. */
export function engineLogStreamUrl(
  project: string,
  resume?: { readonly channel: string; readonly after: number },
): string {
  const params = new URLSearchParams({ project })
  if (resume != null) {
    params.set('channel', resume.channel)
    params.set('after', String(resume.after))
  }
  return `${ENGINE_LOG_STREAM_PATH}?${params.toString()}`
}

/** The logger every local SQL query is logged under, at INFO (`LocalAuditedConnection`). */
export const SQL_QUERY_LOGGER = 'Standard.Database.Connection'
/**
 * The logger of `Progress.run`'s timings (DEBUG, `ADVANCE <handle>+<count>~<ms>ms`), and the root
 * of each handle's own logger, `Standard.Base.Logging.Progress.<handle>`.
 */
export const PERFORMANCE_LOGGER = 'Standard.Base.Logging.Progress'

/**
 * Extra logging an engine is started with (Settings → Local → Engine logs). The engine's configs
 * keep both off; each option turns one logger up for the engines started while it is on.
 */
export interface EngineLoggingOptions {
  /** Log every SQL query a local connection runs. */
  readonly sqlQueries?: boolean
  /** Log how long each `Progress.run` took (database queries among them). */
  readonly performanceTimings?: boolean
}

/**
 * The engine arguments for `options`: a `--vm.D <logger>.Logger.level=<level>` per option that is
 * on. The runner sets each as a system property before logging is set up, and `LoggersLevels`
 * (`lib/scala/logging-config`) puts such an override before the config's own level for that logger
 * (and so its children).
 */
export function engineLoggingArgs(options: EngineLoggingOptions | undefined): string[] {
  const levels: [string, string][] = []
  if (options?.sqlQueries === true) levels.push([SQL_QUERY_LOGGER, 'info'])
  if (options?.performanceTimings === true) levels.push([PERFORMANCE_LOGGER, 'debug'])
  return levels.flatMap(([logger, level]) => ['--vm.D', `${logger}.Logger.level=${level}`])
}

/** `POST`: a line of the IDE's for the open project's Logs panel (live only, not in the file). */
export const ENGINE_LOG_APPEND_PATH = '/api/engine-logs/append'
/** The IDE's widget problems (Engine source). */
export const GUI_WIDGETS_LOGGER = 'enso.gui.Widgets'
/** The IDE's own timings (Performance source). */
export const GUI_PERFORMANCE_LOGGER = 'enso.gui.performance'

export type EngineLogAppendLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
const APPEND_LEVELS: readonly string[] = ['ERROR', 'WARN', 'INFO', 'DEBUG']

/** What a logger name may be: nothing that could close its bracket or end the line. */
const LOGGER_NAME = /^[\w.$-]+$/
/** The most lines one append adds; the rest are replaced by a marker line. */
export const MAX_APPENDED_LINES = 200

/** The body of {@link ENGINE_LOG_APPEND_PATH}. `project` is the GUI's project id. */
export interface EngineLogAppendBody {
  readonly project: string
  readonly level: EngineLogAppendLevel
  readonly logger: string
  readonly message: string
}

/** `json` as an append body, or `undefined` when it is not one. */
export function parseEngineLogAppendBody(json: unknown): EngineLogAppendBody | undefined {
  if (typeof json !== 'object' || json == null) return undefined
  const { project, level, logger, message } = json as Record<string, unknown>
  if (typeof project !== 'string' || typeof logger !== 'string' || typeof message !== 'string')
    return undefined
  if (!LOGGER_NAME.test(logger)) return undefined
  if (typeof level !== 'string' || !APPEND_LEVELS.includes(level)) return undefined
  return { project, level: level as EngineLogAppendLevel, logger, message }
}

/**
 * The lines an append adds: the first starts an entry, `[LEVEL] [time] [logger] text`, as the
 * engine's file lines do (`logEntry.ts`); the rest continue it, indented so that no message can
 * forge an entry of its own. Control characters other than tab are dropped, and at most
 * {@link MAX_APPENDED_LINES} lines are kept (then a marker says how many were not).
 */
export function formatAppendedLines(body: EngineLogAppendBody, now: Date): string[] {
  // eslint-disable-next-line no-control-regex
  const clean = body.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const [first = '', ...rest] = clean.split(/\r\n|\n|\r/)
  const kept = rest.slice(0, MAX_APPENDED_LINES - 1)
  const dropped = rest.length - kept.length
  return [
    `[${body.level}] [${now.toISOString()}] [${body.logger}] ${first}`,
    ...kept.map((line) => `    ${line}`),
    ...(dropped > 0 ? [`    … (${dropped} more lines)`] : []),
  ]
}
