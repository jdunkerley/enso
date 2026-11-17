/* eslint-disable camelcase -- result field names are snake_case on the wire */
/**
 * @file The edit session: every MCP edit tool runs through it. It serialises the edits, saves a
 * version before an agent's first edit, keeps the agent's edits in one undo step, and waits for the
 * graph and the execution to settle after each edit.
 *
 * It also tracks which undo steps are the agents' own, so that `undo` and `redo` never move through
 * the user's work, and offers {@link EditSession.runUnstepped}: the same queue, refusals and waits
 * without an undo step or a saved version (undo, redo and refresh use it).
 *
 * Why undo and redo are safe for Write: every step above `ownFloor` holds only transactions made
 * inside a session run, because any other transaction resets the floor. A session run never adds
 * the Write prefix (`writeGuard`), never edits or collapses a Write-on node, and the one edit that
 * removes one seals the history above itself (`EditRunOptions.sealsHistory`). So neither undoing
 * nor redoing such a step can make a node with Write on appear.
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
/** The answer to `undo` when no step of an agent's is on top of the undo stack. */
export const NOTHING_TO_UNDO_ERROR =
  'There is nothing of yours to undo. undo takes back only edits made by agents since the user last changed the project. To change anything else, edit or remove the nodes.'
/** The answer to `redo` when no step taken back by `undo` can be re-applied. */
export const NOTHING_TO_REDO_ERROR =
  'There is nothing to redo. redo re-applies only what undo took back, and only until the next edit.'

/** The dependencies of an {@link EditSession}. */
export interface EditSessionDeps {
  readonly isLive: () => boolean
  /** Whether the project's editor is on screen; a hidden project is never edited. */
  readonly isActive: () => boolean
  /** Starts holding one undo step; returns the release function (idempotent). */
  readonly holdUndoStep: () => () => void
  /** Calls `listener` before any module edit that the session did not make; returns unsubscribe. */
  readonly onForeignEdit: (listener: () => void) => () => void
  /** How many steps the module's undo stack and redo stack hold now. */
  readonly historyDepth: () => { undo: number; redo: number }
  /** Undoes the top step of the module's undo manager. */
  readonly undo: () => void
  /** Redoes the top step of the module's redo stack. */
  readonly redo: () => void
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

/** Options of {@link EditSession.run}; {@link EditSession.runUnstepped} takes the same. */
export interface EditRunOptions<T> {
  /**
   * The external ids of the expressions the edit makes the engine compute (`added`: new nodes, the
   * call node of a collapse; `changed`: an edited node, the users of a removed node), from the
   * edit's value. None by default: an edit that affects nothing the engine runs (a comment, a
   * visualization, a function definition on its own) settles at once.
   */
  readonly affected?: (value: T) => AffectedExpressions
  /**
   * Whether the edit, by its value, changed nothing (the text or the positions were already as
   * asked). Then no graph update and no execution follow, so the run answers at once with
   * `settled: true` instead of waiting out {@link GRAPH_UPDATE_WAIT_MS}. Everything before the edit
   * is as for any run: it is queued, refused in Live, saves a version and joins the caller's undo
   * step (the edit decides at its turn, after those checks). False by default.
   */
  readonly unchanged?: (value: T) => boolean
  /**
   * When the caller stops waiting (`Date.now()` milliseconds; the tool dispatcher's deadline). The
   * run is refused unless {@link EDIT_MIN_REMAINING_MS} are left at its turn and after the version
   * save, and its settle wait ends {@link EDIT_ANSWER_MARGIN_MS} before it. None: no limit.
   */
  readonly deadline?: number
  /**
   * Whether the edit, by its value, removed a node with Write on. Undoing it would bring that node
   * back and run it, so the step is closed at once and becomes the floor below which the agents'
   * undo does not go. Only `run` reads it.
   */
  readonly sealsHistory?: (value: T) => boolean
}

/** What a run answers: the edit's value, and whether the engine's results for it arrived in time. */
export interface EditOutcome<T> {
  readonly value: T
  readonly settled: boolean
}

/** Whether a further `undo` or `redo` by an agent would do something. */
export interface HistoryState {
  readonly can_undo: boolean
  readonly can_redo: boolean
}

/** How a run treats the undo history: with a step and a version (an edit), or without (the rest). */
type RunMode<T> =
  | { readonly stepped: true; readonly sealsHistory: (value: T) => boolean }
  | { readonly stepped: false }

function callerKey(caller: McpCaller): string {
  return caller.kind === 'chat' ? 'chat' : `external:${caller.name}`
}

/** How a caller is named in the versions and messages it causes: `the chat`, or the agent's name. */
export function callerLabel(caller: McpCaller): string {
  return caller.kind === 'chat' ? 'the chat' : caller.name
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs the edits of the agents, one at a time, each caller's in one undo step, and remembers which
 * undo steps are theirs (see the file comment for why undoing those is safe for Write).
 */
export class EditSession {
  private tail: Promise<unknown> = Promise.resolve()
  private release: (() => void) | undefined
  private stepCaller: string | undefined
  private idleTimer: unknown
  private inEdit = false
  private disposed = false
  private readonly unsubscribe: () => void
  /**
   * The undo depth at or below which a step is not an agent's: undefined when the user changed the
   * project since the last agent edit (or there was none).
   */
  private ownFloor: number | undefined
  /** How many steps taken back by `undo` can be re-applied by `redo`. */
  private ownRedo = 0
  /** The undo depth when the held step was started. */
  private stepBase = 0

  /** Subscribes to foreign edits, which end the open step and the agents' own history. */
  constructor(private readonly deps: EditSessionDeps) {
    // The undo manager's own transactions reach this listener too; the session's `undo` and `redo`
    // run with `inEdit` true, so they do not reset the own history.
    this.unsubscribe = deps.onForeignEdit(() => {
      if (this.inEdit) return
      this.releaseStep()
      this.ownFloor = undefined
      this.ownRedo = 0
    })
  }

  /**
   * Runs one edit: queued behind earlier ones; refused in Live, while the editor is not on screen
   * and when too little time is left before `options.deadline` (each checked at its turn and again
   * after the version save; a run past both finishes); joins or starts the caller's undo step
   * (saving a version before the first edit of a step, raced against the deadline); runs `edit`
   * marked as the session's own, watching the execution from just before it; waits for the graph
   * update and for execution to settle (at most until shortly before the deadline), unless
   * `options.unchanged` says the edit changed nothing. `edit` returns Err to refuse without
   * changing anything.
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
    return this.enqueue(caller, edit, options, {
      stepped: true,
      sealsHistory: options.sealsHistory ?? (() => false),
    })
  }

  /**
   * Runs `action` in the queue outside any undo step: the same refusals as {@link run} (disposed,
   * off screen, Live, too close to the deadline), then the held step is released, no version is
   * saved and no step is held; `action` runs marked as the session's own; then the same
   * graph-update and settle waits as `run`. It leaves the own history alone.
   */
  runUnstepped<T>(
    caller: McpCaller,
    action: () => Result<T> | Promise<Result<T>>,
    options: EditRunOptions<T> = {},
  ): Promise<Result<EditOutcome<T>>> {
    return this.enqueue(caller, action, options, { stepped: false })
  }

  /**
   * Takes back the top undo step if it is an agent's own: refused with
   * {@link NOTHING_TO_UNDO_ERROR} otherwise. Answers what a further undo or redo could do.
   */
  async undo(
    caller: McpCaller,
    options: { deadline?: number } = {},
  ): Promise<Result<EditOutcome<HistoryState>>> {
    const result = await this.runUnstepped(
      caller,
      () => {
        if (!this.canUndo()) return Err(NOTHING_TO_UNDO_ERROR)
        this.deps.undo()
        this.ownRedo++
        return Ok(undefined)
      },
      options,
    )
    return this.withState(result)
  }

  /**
   * Re-applies the step the last {@link undo} took back: refused with {@link NOTHING_TO_REDO_ERROR}
   * once an edit by anyone has come since. Answers what a further undo or redo could do.
   */
  async redo(
    caller: McpCaller,
    options: { deadline?: number } = {},
  ): Promise<Result<EditOutcome<HistoryState>>> {
    const result = await this.runUnstepped(
      caller,
      () => {
        if (!this.canRedo()) return Err(NOTHING_TO_REDO_ERROR)
        this.deps.redo()
        this.ownRedo--
        return Ok(undefined)
      },
      options,
    )
    return this.withState(result)
  }

  private canUndo(): boolean {
    return this.ownFloor != null && this.deps.historyDepth().undo > this.ownFloor
  }

  private canRedo(): boolean {
    return this.ownRedo > 0 && this.deps.historyDepth().redo > 0
  }

  /** Replaces a successful outcome's value with the history state, read now (after the action). */
  private withState(result: Result<EditOutcome<undefined>>): Result<EditOutcome<HistoryState>> {
    if (!result.ok) return result
    return Ok({
      value: { can_undo: this.canUndo(), can_redo: this.canRedo() },
      settled: result.value.settled,
    })
  }

  private enqueue<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
    options: EditRunOptions<T>,
    mode: RunMode<T>,
  ): Promise<Result<EditOutcome<T>>> {
    // `execute` never rejects, so the queue cannot stall.
    const task = this.tail.then(() =>
      this.execute(
        caller,
        edit,
        options.affected ?? (() => ({})),
        options.unchanged ?? (() => false),
        options.deadline ?? Infinity,
        mode,
      ),
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

  /**
   * The refusals shared by every run, checked at its turn and again after a version save: Live
   * mode, and too little time left before the call's deadline (main answers "timed out" at the
   * deadline: an edit applied after it would be one the caller was told failed, and may retry).
   */
  private refusal(remaining: () => number): Result<never> | undefined {
    if (this.deps.isLive()) return Err(LIVE_EDIT_ERROR)
    if (remaining() < EDIT_MIN_REMAINING_MS) return Err(TIMED_OUT_BEFORE_RUN_ERROR)
    return undefined
  }

  private async execute<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
    affected: (value: T) => AffectedExpressions,
    unchanged: (value: T) => boolean,
    deadline: number,
    mode: RunMode<T>,
  ): Promise<Result<EditOutcome<T>>> {
    let watch: ExecutionWatch | undefined
    let graphWatch: GraphUpdateWatch | undefined
    const remaining = () => deadline - this.deps.now()
    try {
      if (this.disposed) return Err(PROJECT_CLOSED_ERROR)
      if (!this.deps.isActive()) return Err(NOT_ON_SCREEN_ERROR)
      // The idle period is measured from the end of a run, so none is pending while one runs.
      this.clearIdleTimer()
      const refused = this.refusal(remaining)
      if (refused) return refused
      if (mode.stepped) {
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
          const refusedAfterSave = this.refusal(remaining)
          if (refusedAfterSave) return refusedAfterSave
          this.release = this.deps.holdUndoStep()
          this.stepCaller = key
          // Read after the hold, whose boundary closed anything before it.
          this.stepBase = this.deps.historyDepth().undo
        }
      } else {
        // The held step ends here; a later edit starts a step of its own.
        this.releaseStep()
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
      if (mode.stepped && !unchanged(result.value)) {
        this.ownFloor ??= this.stepBase
        this.ownRedo = 0
        if (mode.sealsHistory(result.value)) {
          // Closed before the depth is read, and before any wait: a user edit during the waits
          // resets the floor, which must not then be overwritten.
          this.releaseStep()
          this.ownFloor = this.deps.historyDepth().undo
        }
      }
      // Nothing changed, so no graph update or execution will come: the watches are cancelled in
      // `finally`.
      if (unchanged(result.value)) return Ok({ value: result.value, settled: true })
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
