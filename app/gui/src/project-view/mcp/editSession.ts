/**
 * @file The edit session: every MCP edit tool runs through it. It serialises the edits, saves a
 * version before an agent's first edit, keeps the agent's edits in one undo step, and waits for the
 * graph and the execution to settle after each edit.
 */
import type { McpCaller } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import type { AffectedExpressions, ExecutionWatch, GraphUpdateWatch } from './projectEvents'

/** How long a caller's undo step stays open without a further edit by that caller. */
export const EDIT_STEP_IDLE_MS = 10_000
/**
 * How long an edit waits for the node database to reflect it. A safety net: every edit tool's
 * change updated it at once in the packaged app; when it fires, the result may describe the graph
 * from before the edit.
 */
export const GRAPH_UPDATE_WAIT_MS = 2_000
/** How long an edit waits for the engine to report results for the expressions it affects. */
export const EDIT_SETTLE_MS = 20_000
/**
 * The least time before the call's deadline with which a run may start its edit: enough for the
 * graph wait and a full settle wait, with a margin. A run with less left at its turn, or after the
 * version save, is refused ({@link TIMED_OUT_BEFORE_RUN_ERROR}).
 */
export const EDIT_MIN_REMAINING_MS = 25_000
/** The settle wait ends at least this long before the deadline, so that the answer reaches main. */
export const EDIT_ANSWER_MARGIN_MS = 3_000
/** The answer to a run whose turn comes too close to its call's deadline. */
export const TIMED_OUT_BEFORE_RUN_ERROR =
  'The call timed out before it ran. Nothing was changed; try again.'
/** The answer to every edit tool while the project is in Live mode. */
export const LIVE_EDIT_ERROR =
  'The project is in Live mode. Edits by an agent are refused there. Ask the user to switch the project back to Design.'
/** The answer to an edit after the session was disposed. */
export const PROJECT_CLOSED_ERROR = 'The project is no longer open.'
/** The answer to an edit whose turn comes while the project's editor is not on screen. */
export const NOT_ON_SCREEN_ERROR = 'The project is no longer on screen.'

export interface EditSessionDeps {
  readonly isLive: () => boolean
  /** Whether the project's editor is on screen; a hidden project is never edited. */
  readonly isActive: () => boolean
  /** Starts holding one undo step; returns the release function (idempotent). */
  readonly holdUndoStep: () => () => void
  /** Calls `listener` before any module edit that the session did not make; returns unsubscribe. */
  readonly onForeignEdit: (listener: () => void) => () => void
  /** Rejects when the version cannot be saved. Resolves without doing anything when versions are off. */
  readonly saveVersion: (comment: string) => Promise<void>
  /**
   * Starts waiting for the node database's next update, before the edit is applied, so that an
   * update that runs during the edit is not missed. The session awaits or cancels every watch.
   */
  readonly watchGraphUpdate: () => GraphUpdateWatch
  /**
   * Starts watching the execution context, before the edit is applied, so that an execution that
   * ends before the graph update is not missed. The session settles or cancels every watch.
   */
  readonly watchExecution: () => ExecutionWatch
  /** The clock the deadlines are measured on: `Date.now`. */
  readonly now: () => number
  readonly setTimeout: (f: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

export interface EditRunOptions<T> {
  /**
   * The external ids of the expressions the edit makes the engine compute (`added`: new nodes, the
   * call node of a collapse; `changed`: an edited node, the users of a removed node), from the
   * edit's value. None by default: an edit that affects nothing the engine runs (a comment, a
   * visualization, a function definition on its own) settles at once.
   */
  readonly affected?: (value: T) => AffectedExpressions
  /**
   * When the caller stops waiting (`Date.now()` milliseconds; the tool dispatcher's deadline). The
   * run is refused unless {@link EDIT_MIN_REMAINING_MS} are left at its turn and after the version
   * save, and its settle wait ends {@link EDIT_ANSWER_MARGIN_MS} before it. None: no limit.
   */
  readonly deadline?: number
}

export interface EditOutcome<T> {
  readonly value: T
  readonly settled: boolean
}

function callerKey(caller: McpCaller): string {
  return caller.kind === 'chat' ? 'chat' : `external:${caller.name}`
}

function callerLabel(caller: McpCaller): string {
  return caller.kind === 'chat' ? 'the chat' : caller.name
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Runs the edits of the agents, one at a time, each caller's in one undo step. */
export class EditSession {
  private tail: Promise<unknown> = Promise.resolve()
  private release: (() => void) | undefined
  private stepCaller: string | undefined
  private idleTimer: unknown
  private inEdit = false
  private disposed = false
  private readonly unsubscribe: () => void

  /** Subscribes to foreign edits, which end the open step. */
  constructor(private readonly deps: EditSessionDeps) {
    this.unsubscribe = deps.onForeignEdit(() => {
      if (!this.inEdit) this.releaseStep()
    })
  }

  /**
   * Runs one edit: queued behind earlier ones; refused in Live, while the editor is not on screen
   * and when too little time is left before `options.deadline` (each checked at its turn and again
   * after the version save; a run past both finishes); joins or starts the caller's undo step
   * (saving a version before the first edit of a step, raced against the deadline); runs `edit`
   * marked as the session's own, watching the execution from just before it; waits for the graph
   * update and for execution to settle (at most until shortly before the deadline).
   * `edit` returns Err to refuse without changing anything.
   *
   * `edit` should apply its module changes synchronously: a user edit that lands while an async
   * `edit` is awaiting is treated as the session's own. The step's idle period is measured from
   * the end of a run; no timer is pending while a run is in progress.
   */
  run<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
    options: EditRunOptions<T> = {},
  ): Promise<Result<EditOutcome<T>>> {
    // `execute` never rejects, so the queue cannot stall.
    const task = this.tail.then(() =>
      this.execute(caller, edit, options.affected ?? (() => ({})), options.deadline ?? Infinity),
    )
    this.tail = task
    return task
  }

  /** Releases the held undo step, if any, and forgets whose it was. The session stays usable. */
  releaseStep(): void {
    this.clearIdleTimer()
    const release = this.release
    this.release = undefined
    this.stepCaller = undefined
    release?.()
  }

  /** Releases any held step and stops listening. Safe to call twice. */
  dispose(): void {
    this.disposed = true
    this.releaseStep()
    this.unsubscribe()
  }

  /**
   * Resolves true when `work` resolves within `ms`, false when `ms` pass first (`work` then goes on
   * by itself); rejects when `work` rejects first. No timer for an infinite `ms`.
   */
  private raceDeadline(work: Promise<void>, ms: number): Promise<boolean> {
    if (!Number.isFinite(ms)) return work.then(() => true)
    return new Promise<boolean>((resolve, reject) => {
      const timer = this.deps.setTimeout(() => resolve(false), Math.max(0, ms))
      work.then(
        () => {
          this.deps.clearTimeout(timer)
          resolve(true)
        },
        (error: unknown) => {
          this.deps.clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  private clearIdleTimer() {
    if (this.idleTimer !== undefined) {
      this.deps.clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  private armIdleTimer() {
    this.clearIdleTimer()
    if (this.release == null) return
    this.idleTimer = this.deps.setTimeout(() => {
      this.idleTimer = undefined
      this.releaseStep()
    }, EDIT_STEP_IDLE_MS)
  }

  private async execute<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
    affected: (value: T) => AffectedExpressions,
    deadline: number,
  ): Promise<Result<EditOutcome<T>>> {
    let watch: ExecutionWatch | undefined
    let graphWatch: GraphUpdateWatch | undefined
    const remaining = () => deadline - this.deps.now()
    try {
      if (this.disposed) return Err(PROJECT_CLOSED_ERROR)
      if (!this.deps.isActive()) return Err(NOT_ON_SCREEN_ERROR)
      // The idle period is measured from the end of a run, so none is pending while one runs.
      this.clearIdleTimer()
      if (this.deps.isLive()) return Err(LIVE_EDIT_ERROR)
      // Main answers "timed out" at the deadline: an edit applied after it would be one the caller
      // was told failed, and may retry.
      if (remaining() < EDIT_MIN_REMAINING_MS) return Err(TIMED_OUT_BEFORE_RUN_ERROR)
      const key = callerKey(caller)
      if (this.release == null || this.stepCaller !== key) {
        this.releaseStep()
        try {
          const saved = await this.raceDeadline(
            this.deps.saveVersion(`Before changes by ${callerLabel(caller)}`),
            remaining() - EDIT_MIN_REMAINING_MS,
          )
          // The save may still finish later; that is harmless.
          if (!saved) return Err(TIMED_OUT_BEFORE_RUN_ERROR)
        } catch (error) {
          return Err(errorText(error))
        }
        if (this.disposed) return Err(PROJECT_CLOSED_ERROR)
        // The tab may have been switched, or the project put in Live, while the version was saving.
        if (!this.deps.isActive()) return Err(NOT_ON_SCREEN_ERROR)
        if (this.deps.isLive()) return Err(LIVE_EDIT_ERROR)
        if (remaining() < EDIT_MIN_REMAINING_MS) return Err(TIMED_OUT_BEFORE_RUN_ERROR)
        this.release = this.deps.holdUndoStep()
        this.stepCaller = key
      }
      let result: Result<T>
      // Both watches start before the edit: the node database may update during it, and the
      // engine may report the edit's results before the graph update is awaited.
      graphWatch = this.deps.watchGraphUpdate()
      watch = this.deps.watchExecution()
      this.inEdit = true
      try {
        result = await edit()
      } finally {
        this.inEdit = false
      }
      if (!result.ok) return result
      watch.editApplied()
      await graphWatch.updated(GRAPH_UPDATE_WAIT_MS)
      const settleMs = Math.max(0, Math.min(EDIT_SETTLE_MS, remaining() - EDIT_ANSWER_MARGIN_MS))
      const settled = await watch.settled(affected(result.value), settleMs)
      return Ok({ value: result.value, settled })
    } catch (error) {
      return Err(errorText(error))
    } finally {
      // A refused, failed or thrown edit leaves no listener behind; after `settled`, a no-op.
      graphWatch?.cancel()
      watch?.cancel()
      try {
        this.armIdleTimer()
      } catch (error) {
        // A failing timer must not reject the queue's tail.
        console.error('Cannot arm the edit step idle timer', error)
      }
    }
  }
}
