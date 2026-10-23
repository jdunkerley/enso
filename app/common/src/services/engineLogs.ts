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

/** Where a line came from: the session's log file, or the engine's stderr. */
export type EngineLogSource = 'file' | 'stderr'

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
