/**
 * @file What the edit session waits for and listens to in the open project's stores: the user's
 * own edits of the module, the node database's next update, and the end of the next execution.
 */
import type { ModuleStore } from '$/providers/openedProjects/module'
import { isLocalUserActionOrigin } from 'ydoc-shared/yjsModel'
import * as Y from 'yjs'

/**
 * Whether a module transaction with this origin is one the module's undo manager records: a local
 * user action (the graph, the code editor, the documentation and comment editors; `null` is the
 * Yjs default, which the undo manager tracks too) or an undo or redo. Not an update from the
 * server (its origin is the doc's provider), nor the IDE's own derived writes
 * (`local:autoLayout`, `local:derivedMetadata`, `local:autoImport`), which no undo step records.
 *
 * `transaction.local` cannot tell these apart: a module store edit reaches the doc through
 * `Y.applyUpdate`, whose transaction is never local.
 */
export function isUserTransaction(origin: unknown): boolean {
  return (
    origin == null ||
    (typeof origin === 'string' && isLocalUserActionOrigin(origin)) ||
    origin instanceof Y.UndoManager
  )
}

/**
 * Calls `listener` before every module transaction {@link isUserTransaction} accepts, from the
 * module's `beforeTransaction` event: before the change is applied, and so before the undo manager
 * records it (it records in `afterTransaction`). `module()` is read when the module's doc changes
 * (`ast` is replaced with it), so a new doc is listened to as well. Returns the unsubscribe
 * function.
 */
export function onUserModuleTransaction(
  module: () => Pick<ModuleStore, 'onBeforeEdit' | 'ast'>,
  watchSource: (source: () => unknown, callback: () => void) => () => void,
  listener: () => void,
): () => void {
  let unregister = () => {}
  const subscribe = () => {
    unregister()
    unregister = module().onBeforeEdit((transaction) => {
      if (isUserTransaction(transaction.origin)) listener()
    }).unregister
  }
  subscribe()
  const stopWatching = watchSource(() => module().ast, subscribe)
  return () => {
    stopWatching()
    unregister()
  }
}

/**
 * Resolves once `doAfterUpdate` runs its callback, or after `timeoutMs`, whichever is first. The
 * store's list has no removal, so after the timeout the callback stays there until the next update,
 * and does nothing then.
 */
export function afterGraphUpdate(
  graph: { doAfterUpdate: (f: () => void) => void },
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      done = true
      resolve()
    }, timeoutMs)
    graph.doAfterUpdate(() => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    })
  })
}

/** A wait for the node database's next update, started before an edit is applied. */
export interface GraphUpdateWatch {
  /**
   * Resolves true once the node database has updated since the watch started (at once if it
   * already has), false after `timeoutMs` (from this call).
   */
  updated(timeoutMs: number): Promise<boolean>
  /** Ends the watch; a later or pending `updated` resolves false. Idempotent. */
  cancel(): void
}

/**
 * Queues a callback for the graph's next node-database update at once, so that an update which
 * runs before {@link GraphUpdateWatch.updated} is awaited is not missed: a module change made
 * synchronously by an edit queues Vue's update effect, which runs in a microtask before the code
 * after `await edit()`.
 *
 * `doAfterUpdate` has no way to unqueue a callback: after a timeout or `cancel`, it stays queued
 * until the next update, which drains the queue, and does nothing then.
 */
export function watchGraphUpdate(graph: {
  doAfterUpdate: (f: () => void) => void
}): GraphUpdateWatch {
  let seen = false
  let done = false
  let finish: ((updated: boolean) => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    done = true
    if (timer !== undefined) clearTimeout(timer)
  }
  graph.doAfterUpdate(() => {
    if (done) return
    seen = true
    finish?.(true)
  })
  return {
    updated(timeoutMs) {
      if (done) return Promise.resolve(false)
      if (seen) {
        stop()
        return Promise.resolve(true)
      }
      return new Promise((resolve) => {
        finish = (updated) => {
          finish = undefined
          stop()
          resolve(updated)
        }
        timer = setTimeout(() => finish?.(false), timeoutMs)
      })
    },
    cancel() {
      if (done) return
      stop()
      finish?.(false)
    },
  }
}

/** What a watch reads of one `expressionUpdates` entry. */
export interface ExpressionUpdateLike {
  readonly expressionId: string
  readonly payload: { readonly type: string }
}

/** The part of an execution context {@link watchExecution} listens to. */
export interface ExecutionEvents {
  on(event: 'executionFailed', listener: () => void): unknown
  on(
    event: 'expressionUpdates',
    listener: (updates: readonly ExpressionUpdateLike[]) => void,
  ): unknown
  off(event: 'executionFailed', listener: () => void): unknown
  off(
    event: 'expressionUpdates',
    listener: (updates: readonly ExpressionUpdateLike[]) => void,
  ): unknown
}

/** A watch on the engine's reports, started before an edit is applied. */
export interface ExecutionWatch {
  /** The edit has returned: from now on an `executionFailed` settles the watch. */
  editApplied(): void
  /**
   * Resolves true once the engine has reported results for the `affected` expressions since the
   * watch started (at once if it already has, or if there are none), false after `timeoutMs`
   * (from this call). Removes the listeners either way. See {@link watchExecution}.
   */
  settled(affected: readonly string[], timeoutMs: number): Promise<boolean>
  /** Removes the listeners; a later or pending `settled` resolves false. Idempotent. */
  cancel(): void
}

/**
 * Starts recording the context's `expressionUpdates` and `executionFailed` at once, so that a report
 * which comes before {@link ExecutionWatch.settled} is called is not missed.
 *
 * An edit has settled when:
 * - it affects no expression; or
 * - every affected expression's latest update since the watch started has a payload that is not
 *   `Pending` (the engine has computed it: a value, an error or a panic); or
 * - an `executionFailed` came after the edit was applied (the whole execution failed).
 *
 * `executionComplete` plays no part: one follows each evaluation (a `get_graph` preview), so a
 * stray one arrives while the engine is still computing the edit (see `CLAUDE.md`).
 */
export function watchExecution(context: ExecutionEvents): ExecutionWatch {
  const latest = new Map<string, string>()
  let applied = false
  let failedAfterEdit = false
  let done = false
  let check: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const onUpdates = (updates: readonly ExpressionUpdateLike[]) => {
    for (const update of updates) latest.set(update.expressionId, update.payload.type)
    check?.()
  }
  const onFailed = () => {
    if (applied) failedAfterEdit = true
    check?.()
  }
  const stop = () => {
    done = true
    check = undefined
    if (timer !== undefined) clearTimeout(timer)
    context.off('expressionUpdates', onUpdates)
    context.off('executionFailed', onFailed)
  }
  context.on('expressionUpdates', onUpdates)
  context.on('executionFailed', onFailed)
  let finish: ((settled: boolean) => void) | undefined
  return {
    editApplied() {
      applied = true
    },
    settled(affected, timeoutMs) {
      if (done) return Promise.resolve(false)
      const reported = () =>
        affected.length === 0 ||
        failedAfterEdit ||
        affected.every((id) => {
          const type = latest.get(id)
          return type != null && type !== 'Pending'
        })
      if (reported()) {
        stop()
        return Promise.resolve(true)
      }
      return new Promise((resolve) => {
        finish = (settled) => {
          finish = undefined
          stop()
          resolve(settled)
        }
        check = () => {
          if (reported()) finish?.(true)
        }
        timer = setTimeout(() => finish?.(false), timeoutMs)
      })
    },
    cancel() {
      if (done) return
      const pending = finish
      stop()
      pending?.(false)
    },
  }
}
