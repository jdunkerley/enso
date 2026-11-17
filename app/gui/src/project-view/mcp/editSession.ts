/* eslint-disable camelcase -- result field names are snake_case on the wire */
/**
 * @file The edit session: every MCP edit tool runs through it. It serialises the edits, saves a
 * version before an agent's first edit, keeps the agent's edits in one undo step, and waits for the
 * graph and the execution to settle after each edit.
 *
 * It also tracks which undo steps are the agents' own, so that `undo` and `redo` stay above the
 * user's last change, and offers {@link EditSession.runUnstepped}: the same queue, refusals and
 * waits without an undo step or a saved version (undo, redo and refresh use it).
 *
 * The rule for undo and redo: an agent must never cause a write of a node's output that the user
 * did not click for. Code that enables output is what writes, so:
 *
 * - **The invariant.** Every undo step above `ownFloor` was made by session runs, from a module with
 *   no code that enables output (`deps.enablesOutput()`, `writeRefusal` over the whole module),
 *   by edits that cannot add any (`writeGuard` refuses such code in everything an agent supplies).
 *   A changed edit run from, or leaving, a module with such code seals the step: it stays held (so
 *   that later edits join it and save no further version), agents cannot undo or redo while it is,
 *   and when it is released, for whatever reason, the floor is raised to the depth after it, so
 *   that step is never undone by an agent. The redo steps above `ownRedoFloor` are what the
 *   session's own `undo` put there.
 * - **The depth rule.** A held step is exactly one undo item: the session's edits merge into it.
 *   After every changed stepped edit the undo depth must be `stepBase + 1`; anything else means
 *   that something other than the session's edits changed the history while the edit ran (the
 *   foreign-edit listener ignores everything while `inEdit` is true): a user's Ctrl+Y or Ctrl+Z,
 *   or a boundary (a background click) splitting the step. The step is then sealed.
 * - **What resets it.** Every module transaction the session did not make, the user's Ctrl+Z
 *   included, clears both floors (`onForeignEdit`), except the untracked ones below.
 * - **Untracked changes.** An update from the server (the file changed on disk, another client) or
 *   a derived write (`local:autoLayout`, …) does not reset the floors and is not on the undo stack.
 *   It can make an agent's step change nothing, and `Y.UndoManager.undo()` then goes on into the
 *   step below; so the session's undo and redo cannot reach the steps below their floor
 *   (`undoAbove` / `redoAbove` in `undoHold.ts`). Such a change can also bring code that enables
 *   output into the module: `undo` and `redo` are refused while there is any, and one that leaves
 *   any behind is reversed at once (the pre-checks should make that unreachable).
 * - **Not covered.** A user edit that lands while an async edit is awaiting, with no boundary
 *   after it, merges into the session's step without changing the depth, so the depth rule cannot
 *   see it. Undoing it can only put back code that was in the module before the edit, and a module
 *   that had code enabling output before or after the edit seals the step. A user's Ctrl+Z that
 *   takes back the held step's own item before the edit's change also leaves the depth right; the
 *   edit's change then clears the redo stack, and the new item holds only that change. The check
 *   covers only the module in the editor (`Main.enso`): not other modules of the project, library
 *   functions that enable output themselves, or `foreign` code.
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
  "There is nothing of the agents' to undo. undo takes back only edits made by agents since the user last changed the project. To change anything else, edit or remove the nodes."
/**
 * The answer to `undo` when the agents' steps above the floor had all been reverted by something
 * else (the file changed on disk, a derived write): they were dropped and nothing changed.
 */
export const NOTHING_LEFT_TO_UNDO_ERROR =
  "Nothing was changed: the agents' edits left to undo had already been changed back by something else (for example the file changed on disk). There is nothing more to undo."
/** The answer to `redo` when no step taken back by `undo` can be re-applied. */
export const NOTHING_TO_REDO_ERROR =
  'There is nothing to redo. redo re-applies only what undo took back, and only until the next edit.'
/** The answer to `redo` when the steps `undo` took back could no longer be re-applied. */
export const NOTHING_LEFT_TO_REDO_ERROR =
  'Nothing was changed: what undo took back could no longer be re-applied, because something else has changed it since. There is nothing more to redo.'
/**
 * The answer to `undo` while the module has code that can enable output (what `writeRefusal`
 * refuses, the code the edit tools refuse to add) or cannot be read.
 */
export const UNDO_OUTPUT_ERROR =
  "The project's main module has code that can enable output (the same code the edit tools refuse to add), or cannot be read, and undoing could run such code and write. Ask the user to undo with Ctrl+Z."
/** The answer to `redo` in the same case. */
export const REDO_OUTPUT_ERROR =
  "The project's main module has code that can enable output (the same code the edit tools refuse to add), or cannot be read, and redoing could run such code and write. Ask the user to redo with Ctrl+Y."
/**
 * The answer to an `undo` or `redo` that left code enabling output behind and was put back. The
 * engine may have seen the state in between, so it does not say that nothing was changed.
 */
export const HISTORY_REVERSED_ERROR =
  'That would have put code that can enable output back into the project, so the step was put back at once. The engine may have seen the change in between: tell the user, so that they can check the project. Ask them to undo or redo with Ctrl+Z or Ctrl+Y.'
/** The answer when such a reversal did not change the project back, or failed. */
export const HISTORY_NOT_REVERSED_ERROR =
  'That put code that can enable output back into the project, and putting the step back failed. Tell the user at once, so that they can check the project before it runs.'

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
  /**
   * Undoes the top step of the module's undo stack, unable to reach the `floor` lowest steps (a
   * plain `Y.UndoManager.undo()` goes on below a step that changes nothing). Returns whether
   * anything changed.
   */
  readonly undo: (floor: number) => boolean
  /** Redoes the top step of the module's redo stack, unable to reach its `floor` lowest steps. */
  readonly redo: (floor: number) => boolean
  /**
   * Whether the module in the editor has code that enables output (`writeRefusal` of its root is
   * not undefined), or cannot be read. Read before and after every changed edit, and before and
   * after every `undo` and `redo`.
   */
  readonly enablesOutput: () => boolean
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
   * Whether the run waits for the node database to update after the action ({@link
   * GRAPH_UPDATE_WAIT_MS}). True by default; false for a run that changes no node (a refresh): no
   * update comes, so waiting would only cost the full wait.
   */
  readonly awaitsGraphUpdate?: boolean
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
type RunMode = { readonly stepped: boolean }

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
   * The undo depth at or below which a step is not the agents' to undo: undefined when the user
   * changed the project since the last agent edit (or there was none).
   */
  private ownFloor: number | undefined
  /**
   * The redo depth when the session's first `undo` since the last edit ran: the redo steps above it
   * are the ones that `undo` took back. Undefined when there are none to redo.
   */
  private ownRedoFloor: number | undefined
  /** The undo depth when the held step was started. */
  private stepBase = 0
  /**
   * Whether the held step is sealed: when it is released, `ownFloor` is raised to the depth after
   * it ({@link releaseStep}). Agents cannot undo or redo while it is held.
   */
  private sealPending = false

  /** Subscribes to foreign edits, which end the open step and the agents' own history. */
  constructor(private readonly deps: EditSessionDeps) {
    // The undo manager's own transactions reach this listener too; the session's `undo` and `redo`
    // run with `inEdit` true, so they do not reset the own history.
    this.unsubscribe = deps.onForeignEdit(() => {
      if (this.inEdit) return
      this.releaseStep()
      this.ownFloor = undefined
      this.ownRedoFloor = undefined
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
   * A changed edit made when the module had code that enables output, or that leaves some, or
   * after which the undo depth is not `stepBase + 1` (the depth rule), seals the agents' history:
   * the step stays held, and once it is released `undo` cannot take it back (file comment).
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
    return this.enqueue(caller, edit, options, { stepped: true })
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
   * Takes back the top undo step if it is the agents' own, unable to go below the floor. Refused,
   * at its turn and with nothing changed, while the module has code that enables output
   * ({@link UNDO_OUTPUT_ERROR}) and when there is no such step ({@link NOTHING_TO_UNDO_ERROR});
   * answers {@link NOTHING_LEFT_TO_UNDO_ERROR} when the steps above the floor had all been reverted
   * by something else, so that nothing changed. Answers what a further undo or redo could do. It
   * does not wait for the engine: the values may still be computing.
   */
  async undo(
    caller: McpCaller,
    options: { deadline?: number } = {},
  ): Promise<Result<HistoryState>> {
    const result = await this.runUnstepped(
      caller,
      () => {
        if (this.deps.enablesOutput()) return Err(UNDO_OUTPUT_ERROR)
        if (!this.canUndo()) return Err(NOTHING_TO_UNDO_ERROR)
        const redoBase = this.deps.historyDepth().redo
        const changed = this.deps.undo(this.ownFloor!)
        // The redo steps above this depth are the ones the session's undo took back.
        if (changed) this.ownRedoFloor ??= redoBase
        // Should be unreachable: every step above the floor was made from a module without such
        // code, by edits that cannot add any, and the module had none just now.
        if (this.deps.enablesOutput()) return this.reverse(changed, () => this.deps.redo(redoBase))
        return changed ? Ok(undefined) : Err(NOTHING_LEFT_TO_UNDO_ERROR)
      },
      options,
    )
    return this.withState(result)
  }

  /**
   * Re-applies the step the last {@link undo} took back, unable to reach redo steps that were not
   * the session's. Refused, at its turn and with nothing changed, while the module has code that
   * enables output ({@link REDO_OUTPUT_ERROR}) and once an edit by anyone has come since the undo
   * ({@link NOTHING_TO_REDO_ERROR}). Answers what a further undo or redo could do.
   */
  async redo(
    caller: McpCaller,
    options: { deadline?: number } = {},
  ): Promise<Result<HistoryState>> {
    const result = await this.runUnstepped(
      caller,
      () => {
        if (this.deps.enablesOutput()) return Err(REDO_OUTPUT_ERROR)
        if (!this.canRedo()) return Err(NOTHING_TO_REDO_ERROR)
        const undoBase = this.deps.historyDepth().undo
        const changed = this.deps.redo(this.ownRedoFloor!)
        // Should be unreachable, as for undo.
        if (this.deps.enablesOutput()) return this.reverse(changed, () => this.deps.undo(undoBase))
        return changed ? Ok(undefined) : Err(NOTHING_LEFT_TO_REDO_ERROR)
      },
      options,
    )
    return this.withState(result)
  }

  /**
   * After an `undo` or `redo` that left code enabling output in the module: puts the step back at
   * once, in the same synchronous run (`back`, bounded to the one step just added), then seals the
   * history so that the step is not tried again, also when putting it back throws.
   *
   * A last resort: the undo and the step put back are two transactions, and each reaches the
   * engine on its own, so the engine may have seen, and started running, the state between them.
   * This path must stay unreachable: the pre-check refuses a module with such code, and every step
   * above the floor was made from one without (the seal and the depth rule keep it so).
   */
  private reverse(changed: boolean, back: () => boolean): Result<never> {
    let failed = false
    try {
      if (changed) failed = !back()
    } catch (error) {
      console.error('Cannot put back the undo or redo step', error)
      failed = true
    } finally {
      this.seal()
    }
    return Err(
      failed || this.deps.enablesOutput() ? HISTORY_NOT_REVERSED_ERROR : HISTORY_REVERSED_ERROR,
    )
  }

  /**
   * Seals the agents' history at the current step: no agent's `undo` reaches it or what is below,
   * and nothing is left to redo. A held step stays held, marked sealed, and the floor is raised
   * when it is released ({@link releaseStep}); with none held, it is raised to the depth now.
   */
  private seal(): void {
    if (this.release != null) {
      this.sealPending = true
      return
    }
    this.ownFloor = this.deps.historyDepth().undo
    this.ownRedoFloor = undefined
  }

  private canUndo(): boolean {
    return (
      !this.sealPending && this.ownFloor != null && this.deps.historyDepth().undo > this.ownFloor
    )
  }

  private canRedo(): boolean {
    return (
      !this.sealPending &&
      this.ownRedoFloor != null &&
      this.deps.historyDepth().redo > this.ownRedoFloor
    )
  }

  /** The history state, read now (after the action), for a successful run. */
  private withState(result: Result<EditOutcome<undefined>>): Result<HistoryState> {
    if (!result.ok) return result
    return Ok({ can_undo: this.canUndo(), can_redo: this.canRedo() })
  }

  private enqueue<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
    options: EditRunOptions<T>,
    mode: RunMode,
  ): Promise<Result<EditOutcome<T>>> {
    // `execute` never rejects, so the queue cannot stall.
    const task = this.tail.then(() =>
      this.execute(
        caller,
        edit,
        options.affected ?? (() => ({})),
        options.unchanged ?? (() => false),
        options.deadline ?? Infinity,
        options.awaitsGraphUpdate ?? true,
        mode,
      ),
    )
    this.tail = task
    return task
  }

  /**
   * Releases the held undo step, if any, and forgets whose it was; a sealed step then raises the
   * floor to the undo depth after the release. The session stays usable.
   */
  releaseStep(): void {
    this.clearIdleTimer()
    const release = this.release
    this.release = undefined
    this.stepCaller = undefined
    try {
      release?.()
    } finally {
      if (this.sealPending) {
        this.sealPending = false
        this.seal()
      }
    }
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
    awaitsGraphUpdate: boolean,
    mode: RunMode,
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
      // Read at the run's turn, immediately before the edit: whether the module it changes has code
      // that enables output, which undoing this edit could bring back or run again.
      const enabledBefore = mode.stepped && this.deps.enablesOutput()
      this.inEdit = true
      try {
        result = await edit()
      } finally {
        this.inEdit = false
      }
      if (!result.ok) return result
      if (mode.stepped && !unchanged(result.value)) {
        this.ownFloor ??= this.stepBase
        this.ownRedoFloor = undefined
        // The depth rule: the held step is one undo item. Another depth means that something else
        // changed the history while the edit ran, unseen by the foreign-edit listener.
        const split = this.deps.historyDepth().undo !== this.stepBase + 1
        if (split || enabledBefore || this.deps.enablesOutput()) {
          // Sealed before any wait: a user edit during the waits releases the step, which applies
          // the seal, and then resets the floor.
          this.seal()
        }
      }
      // Nothing changed, so no graph update or execution will come: the watches are cancelled in
      // `finally`.
      if (unchanged(result.value)) return Ok({ value: result.value, settled: true })
      watch.editApplied()
      if (awaitsGraphUpdate) await graphWatch.updated(GRAPH_UPDATE_WAIT_MS)
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
