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

/** The part of an execution context {@link executionSettled} listens to. */
export interface ExecutionEvents {
  on(event: 'executionComplete' | 'executionFailed', listener: () => void): unknown
  off(event: 'executionComplete' | 'executionFailed', listener: () => void): unknown
}

/**
 * Resolves true on the context's next `executionComplete` or `executionFailed`, false after
 * `timeoutMs`; both listeners are removed whichever comes first.
 */
export function executionSettled(context: ExecutionEvents, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (settled: boolean) => {
      clearTimeout(timer)
      context.off('executionComplete', settle)
      context.off('executionFailed', settle)
      resolve(settled)
    }
    const settle = () => finish(true)
    context.on('executionComplete', settle)
    context.on('executionFailed', settle)
    const timer = setTimeout(() => finish(false), timeoutMs)
  })
}
