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

/** The part of an execution context {@link watchExecution} listens to. */
export interface ExecutionEvents {
  on(event: 'executionComplete' | 'executionFailed', listener: () => void): unknown
  off(event: 'executionComplete' | 'executionFailed', listener: () => void): unknown
}

/** A watch on the execution context, started before an edit is applied. */
export interface ExecutionWatch {
  /**
   * Resolves true once an execution has completed or failed since the watch started (at once if
   * one already has), false after `timeoutMs` (from this call). Removes the listeners either way.
   */
  settled(timeoutMs: number): Promise<boolean>
  /** Removes the listeners; a later or pending `settled` resolves false. Idempotent. */
  cancel(): void
}

/**
 * Starts listening to the context's `executionComplete` and `executionFailed` at once, so that an
 * execution which finishes before {@link ExecutionWatch.settled} is called is not missed: the
 * engine often finishes a small edit's execution before the node database has been updated.
 *
 * Any execution that ends after the watch starts counts, including one that was already running
 * when the edit was made, or the evaluation of a preview: the context reports no more than that an
 * execution ended (see "The edit session" in `CLAUDE.md`).
 */
export function watchExecution(context: ExecutionEvents): ExecutionWatch {
  let ended = false
  let done = false
  let finish: ((settled: boolean) => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const onEvent = () => {
    ended = true
    finish?.(true)
  }
  const stop = () => {
    done = true
    if (timer !== undefined) clearTimeout(timer)
    context.off('executionComplete', onEvent)
    context.off('executionFailed', onEvent)
  }
  context.on('executionComplete', onEvent)
  context.on('executionFailed', onEvent)
  return {
    settled(timeoutMs) {
      if (done) return Promise.resolve(false)
      if (ended) {
        stop()
        return Promise.resolve(true)
      }
      return new Promise((resolve) => {
        finish = (settled) => {
          finish = undefined
          stop()
          resolve(settled)
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
