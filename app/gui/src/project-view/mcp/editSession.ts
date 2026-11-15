/**
 * @file The edit session: every MCP edit tool runs through it. It serialises the edits, saves a
 * version before an agent's first edit, keeps the agent's edits in one undo step, and waits for the
 * graph and the execution to settle after each edit.
 */
import type { McpCaller } from 'enso-common/src/mcp'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'

/** How long a caller's undo step stays open without a further edit by that caller. */
export const EDIT_STEP_IDLE_MS = 10_000
/** How long an edit waits for the execution to complete or fail. */
export const EDIT_SETTLE_MS = 20_000
/** The answer to every edit tool while the project is in Live mode. */
export const LIVE_EDIT_ERROR =
  'The project is in Live mode. Edits by an agent are refused there. Ask the user to switch the project back to Design.'
/** The answer to an edit after the session was disposed. */
export const PROJECT_CLOSED_ERROR = 'The project is no longer open.'

export interface EditSessionDeps {
  readonly isLive: () => boolean
  /** Starts holding one undo step; returns the release function (idempotent). */
  readonly holdUndoStep: () => () => void
  /** Calls `listener` before any module edit that the session did not make; returns unsubscribe. */
  readonly onForeignEdit: (listener: () => void) => () => void
  /** Rejects when the version cannot be saved. Resolves without doing anything when versions are off. */
  readonly saveVersion: (comment: string) => Promise<void>
  /** Resolves when the node database reflects the last edit. */
  readonly afterGraphUpdate: () => Promise<void>
  /** Resolves true when the next execution completes or fails, false after `timeoutMs`. */
  readonly executionSettled: (timeoutMs: number) => Promise<boolean>
  readonly setTimeout: (f: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
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
   * Runs one edit: queued behind earlier ones; refused in Live; joins or starts the caller's undo
   * step (saving a version before the first edit of a step); runs `edit` marked as the session's
   * own; waits for the graph update and for execution to settle.
   * `edit` returns Err to refuse without changing anything.
   *
   * `edit` should apply its module changes synchronously: a user edit that lands while an async
   * `edit` is awaiting is treated as the session's own. The step's idle period is measured from
   * the end of a run; no timer is pending while a run is in progress.
   */
  run<T>(
    caller: McpCaller,
    edit: () => Result<T> | Promise<Result<T>>,
  ): Promise<Result<EditOutcome<T>>> {
    // `execute` never rejects, so the queue cannot stall.
    const task = this.tail.then(() => this.execute(caller, edit))
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
  ): Promise<Result<EditOutcome<T>>> {
    try {
      if (this.disposed) return Err(PROJECT_CLOSED_ERROR)
      // The idle period is measured from the end of a run, so none is pending while one runs.
      this.clearIdleTimer()
      if (this.deps.isLive()) return Err(LIVE_EDIT_ERROR)
      const key = callerKey(caller)
      if (this.release == null || this.stepCaller !== key) {
        this.releaseStep()
        try {
          await this.deps.saveVersion(`Before changes by ${callerLabel(caller)}`)
        } catch (error) {
          return Err(errorText(error))
        }
        if (this.disposed) return Err(PROJECT_CLOSED_ERROR)
        this.release = this.deps.holdUndoStep()
        this.stepCaller = key
      }
      let result: Result<T>
      this.inEdit = true
      try {
        result = await edit()
      } finally {
        this.inEdit = false
      }
      if (!result.ok) return result
      await this.deps.afterGraphUpdate()
      const settled = await this.deps.executionSettled(EDIT_SETTLE_MS)
      return Ok({ value: result.value, settled })
    } catch (error) {
      return Err(errorText(error))
    } finally {
      try {
        this.armIdleTimer()
      } catch (error) {
        // A failing timer must not reject the queue's tail.
        console.error('Cannot arm the edit step idle timer', error)
      }
    }
  }
}
