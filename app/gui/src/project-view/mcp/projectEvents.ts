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
 * (`ast` is replaced with it), so a new doc is listened to as well, and `listener` is called
 * then too: the new doc has its own undo stack. Returns the unsubscribe function.
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
  // A new doc comes with a new undo stack, so whatever the listener knew of the old one is stale:
  // tell it, as for a foreign edit (not on the first subscribe).
  const stopWatching = watchSource(
    () => module().ast,
    () => {
      subscribe()
      listener()
    },
  )
  return () => {
    stopWatching()
    unregister()
  }
}

/**
 * Runs `f` and answers whether it changed the module's document: whether any transaction that
 * began on it while `f` ran inserted or deleted anything. A transaction that writes nothing (a
 * position set to the one stored is skipped by `graph.ts`) does not count, so no node-database
 * update will follow it. `f` must make its changes synchronously.
 */
export function moduleChangedBy(module: Pick<ModuleStore, 'onBeforeEdit'>, f: () => void): boolean {
  const transactions: Y.Transaction[] = []
  const { unregister } = module.onBeforeEdit((transaction) => transactions.push(transaction))
  try {
    f()
  } finally {
    unregister()
  }
  return transactions.some(
    (transaction) => transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0,
  )
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

/**
 * The expressions an edit makes the engine compute, by whether they existed before it: the rule for
 * when each has been reported differs (see {@link watchExecution}).
 */
export interface AffectedExpressions {
  /** Expressions the edit created (new nodes, the call node of a collapse). */
  readonly added?: readonly string[]
  /** Expressions that existed before the edit (an edited node, the users of a removed node). */
  readonly changed?: readonly string[]
}

/** A watch on the engine's reports, started before an edit is applied. */
export interface ExecutionWatch {
  /** The edit has returned: only the reports received from now on count. */
  editApplied(): void
  /**
   * Resolves true once the engine has reported results for the `affected` expressions since the
   * edit was applied (at once if it already has, or if there are none), false after `timeoutMs`
   * (from this call). Removes the listeners either way. See {@link watchExecution}.
   */
  settled(affected: AffectedExpressions, timeoutMs: number): Promise<boolean>
  /** Removes the listeners; a later or pending `settled` resolves false. Idempotent. */
  cancel(): void
}

/** What a watch knows of one expression from the reports received since the edit was applied. */
interface Reported {
  /** The latest payload type. */
  latest: string
  /** Whether a `Pending` came: the engine took the edit up for this expression. */
  pendingSeen: boolean
}

/**
 * Starts listening to the context's `expressionUpdates` and `executionFailed` at once, before the
 * edit, and records what arrives once {@link ExecutionWatch.editApplied} has been called, so that a
 * report which comes before {@link ExecutionWatch.settled} is called is not missed. Reports
 * received before the edit was applied never count: they belong to an earlier run.
 *
 * An edit has settled when:
 * - it affects no expression; or
 * - every expression it added has, as its latest report since the edit, a payload that is not
 *   `Pending` (the engine has computed it: a value, an error or a panic); and every expression that
 *   existed before it has had a `Pending` since the edit, followed by a payload that is not
 *   `Pending`. The `Pending` shows that the engine took this edit up: a run started for an earlier
 *   edit can report its value for the node after this edit was applied, and that value is stale;
 *   or
 * - an `executionFailed` came after the edit was applied (the whole execution failed).
 *
 * `executionComplete` plays no part: one follows each evaluation (a `get_graph` preview), so a
 * stray one arrives while the engine is still computing the edit (see `CLAUDE.md`).
 */
export function watchExecution(context: ExecutionEvents): ExecutionWatch {
  const reported = new Map<string, Reported>()
  let applied = false
  let failedAfterEdit = false
  let done = false
  let check: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const onUpdates = (updates: readonly ExpressionUpdateLike[]) => {
    if (!applied) return
    for (const { expressionId, payload } of updates) {
      const entry = reported.get(expressionId)
      const pending = payload.type === 'Pending'
      if (entry == null) reported.set(expressionId, { latest: payload.type, pendingSeen: pending })
      else {
        entry.latest = payload.type
        entry.pendingSeen ||= pending
      }
    }
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
    settled({ added = [], changed = [] }, timeoutMs) {
      if (done) return Promise.resolve(false)
      const computed = (id: string) => {
        const entry = reported.get(id)
        return entry != null && entry.latest !== 'Pending'
      }
      const settledNow = () =>
        (added.length === 0 && changed.length === 0) ||
        failedAfterEdit ||
        (added.every(computed) &&
          changed.every((id) => computed(id) && reported.get(id)!.pendingSeen))
      if (settledNow()) {
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
          if (settledNow()) finish?.(true)
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
