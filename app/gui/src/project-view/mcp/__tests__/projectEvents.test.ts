import { ObservableV2 } from 'lib0/observable'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ref, watch } from 'vue'
import * as Y from 'yjs'
import {
  afterGraphUpdate,
  isUserTransaction,
  moduleChangedBy,
  onUserModuleTransaction,
  watchExecution,
  watchGraphUpdate,
  type ExpressionUpdateLike,
} from '../projectEvents'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('user actions, undo and redo are user transactions; the server and derived writes are not', () => {
  const doc = new Y.Doc()
  expect(isUserTransaction('local:userAction')).toBe(true)
  expect(isUserTransaction('local:userAction:CodeEditor')).toBe(true)
  expect(isUserTransaction('local:userAction:CommentEditor')).toBe(true)
  expect(isUserTransaction(null)).toBe(true)
  expect(isUserTransaction(new Y.UndoManager(doc.getMap('m')))).toBe(true)
  expect(isUserTransaction('local:autoLayout')).toBe(false)
  expect(isUserTransaction('local:derivedMetadata')).toBe(false)
  expect(isUserTransaction('local:autoImport')).toBe(false)
  expect(isUserTransaction('remote')).toBe(false)
  expect(isUserTransaction({ provider: true })).toBe(false)
})

function moduleOver(doc: Y.Doc) {
  return {
    ast: doc,
    onBeforeEdit: (f: (transaction: Y.Transaction) => void) => {
      doc.on('beforeTransaction', f)
      return { unregister: () => doc.off('beforeTransaction', f) }
    },
  }
}

const syncWatch = (source: () => unknown, callback: () => void) =>
  watch(source, callback, { flush: 'sync' })

test('the listener hears a user transaction before it is applied, and an undo', () => {
  const doc = new Y.Doc()
  const map = doc.getMap<number>('m')
  const undo = new Y.UndoManager(map, { trackedOrigins: new Set(['local:userAction']) })
  const seen: (number | undefined)[] = []
  const stop = onUserModuleTransaction(
    () => moduleOver(doc) as never,
    syncWatch,
    () => seen.push(map.get('x')),
  )
  doc.transact(() => map.set('x', 1), 'local:userAction')
  doc.transact(() => map.set('x', 2), 'local:derivedMetadata')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(new Y.Doc()), { provider: true })
  undo.undo()
  // The value before each heard transaction: the change was not applied yet.
  expect(seen).toEqual([undefined, 2])
  stop()
  doc.transact(() => map.set('x', 3), 'local:userAction')
  expect(seen).toHaveLength(2)
})

test('a new module doc is listened to instead of the old one', () => {
  const first = new Y.Doc()
  const second = new Y.Doc()
  const current = ref(moduleOver(first))
  const listener = vi.fn()
  const stop = onUserModuleTransaction(() => current.value as never, syncWatch, listener)
  // Not on the first subscribe.
  expect(listener).not.toHaveBeenCalled()
  current.value = moduleOver(second)
  // A new doc has a new undo stack: the listener is told, as for a foreign edit.
  expect(listener).toHaveBeenCalledTimes(1)
  first.transact(() => first.getMap('m').set('x', 1), 'local:userAction')
  expect(listener).toHaveBeenCalledTimes(1)
  second.transact(() => second.getMap('m').set('x', 1), 'local:userAction')
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
})

test('moduleChangedBy: a write or a deletion is a change; an empty transaction or none is not', () => {
  const doc = new Y.Doc()
  const map = doc.getMap<number>('m')
  const module = moduleOver(doc)
  expect(moduleChangedBy(module, () => map.set('x', 1))).toBe(true)
  expect(moduleChangedBy(module, () => map.delete('x'))).toBe(true)
  // What graph.ts does for a position equal to the stored one: a transaction that writes nothing.
  expect(moduleChangedBy(module, () => doc.transact(() => {}))).toBe(false)
  expect(moduleChangedBy(module, () => {})).toBe(false)
  // Several transactions: any change counts.
  expect(
    moduleChangedBy(module, () => {
      doc.transact(() => {})
      map.set('y', 2)
    }),
  ).toBe(true)
})

test('moduleChangedBy stops listening when f returns or throws', () => {
  const doc = new Y.Doc()
  const map = doc.getMap<number>('m')
  const heard = vi.fn()
  const unregister = vi.fn()
  const module = {
    onBeforeEdit: (f: (transaction: Y.Transaction) => void) => {
      const listener = (transaction: Y.Transaction) => {
        heard()
        f(transaction)
      }
      doc.on('beforeTransaction', listener)
      return {
        unregister: () => {
          unregister()
          doc.off('beforeTransaction', listener)
        },
      }
    },
  }
  moduleChangedBy(module, () => {})
  expect(() =>
    moduleChangedBy(module, () => {
      throw new Error('boom')
    }),
  ).toThrow('boom')
  expect(unregister).toHaveBeenCalledTimes(2)
  map.set('z', 3)
  expect(heard).not.toHaveBeenCalled()
})

test('afterGraphUpdate resolves on the update, or at the timeout without one', async () => {
  let callback: (() => void) | undefined
  const graph = { doAfterUpdate: (f: () => void) => (callback = f) }
  const updated = vi.fn()
  void afterGraphUpdate(graph, 1_000).then(updated)
  callback!()
  await vi.advanceTimersByTimeAsync(0)
  expect(updated).toHaveBeenCalled()

  const timedOut = vi.fn()
  void afterGraphUpdate({ doAfterUpdate: () => {} }, 1_000).then(timedOut)
  await vi.advanceTimersByTimeAsync(999)
  expect(timedOut).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(timedOut).toHaveBeenCalled()
})

class FakeContext extends ObservableV2<{
  executionComplete(): void
  executionFailed(message: string): void
  expressionUpdates(updates: readonly ExpressionUpdateLike[]): void
}> {
  /** The listeners on the events a watch follows; `executionComplete` is not one of them. */
  count() {
    return (
      (this._observers.get('executionComplete')?.size ?? 0) +
      (this._observers.get('executionFailed')?.size ?? 0) +
      (this._observers.get('expressionUpdates')?.size ?? 0)
    )
  }
  /** The engine reports these expressions, each with a payload of this type. */
  report(type: string, ...ids: string[]) {
    this.emit('expressionUpdates', [
      ids.map((expressionId) => ({ expressionId, payload: { type } })),
    ])
  }
}

test('after the timeout, the left-behind update callback does nothing', async () => {
  let callback: (() => void) | undefined
  void afterGraphUpdate({ doAfterUpdate: (f: () => void) => (callback = f) }, 1_000)
  await vi.advanceTimersByTimeAsync(1_000)
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  callback!()
  expect(clear).not.toHaveBeenCalled()
  clear.mockRestore()
})

/** Expects `promise` to resolve with `value` without any timer advancing. */
async function resolvesAtOnce<T>(promise: Promise<T>, value: T) {
  const done = vi.fn()
  void promise.then(done)
  await vi.advanceTimersByTimeAsync(0)
  expect(done).toHaveBeenCalledWith(value)
}

test('an executionComplete alone (from an earlier evaluation) does not settle a run with affected ids', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  context.emit('executionComplete', [])
  const settled = watch.settled({ added: ['a'] }, 1_000)
  context.emit('executionComplete', [])
  await vi.advanceTimersByTimeAsync(999)
  context.emit('executionComplete', [])
  await vi.advanceTimersByTimeAsync(1)
  expect(await settled).toBe(false)
  expect(context.count()).toBe(0)
})

test('values reported for every affected id settle the run without an executionComplete', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  expect(context.count()).toBe(2)
  watch.editApplied()
  const settled = watch.settled({ added: ['a', 'b'] }, 1_000)
  context.report('Value', 'a')
  await vi.advanceTimersByTimeAsync(0)
  context.report('DataflowError', 'b')
  expect(await settled).toBe(true)
  expect(context.count()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

test('an update for one of two affected ids does not settle; the second does', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ added: ['a', 'b'] }, 1_000).then(settled)
  context.report('Value', 'a', 'other')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Panic', 'b')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('a Pending payload does not count; a later value does', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ added: ['a'] }, 1_000).then(settled)
  context.report('Pending', 'a')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Value', 'a')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('a value reported and then Pending again does not count until the next value', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  context.report('Value', 'a')
  context.report('Pending', 'a')
  void watch.settled({ added: ['a'] }, 1_000).then(settled)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Value', 'a')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('a mostly-Pending batch and then an executionComplete do not settle (collapse_nodes in the packaged app)', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ added: ['call'] }, 1_000).then(settled)
  // The engine has started: the affected node and others pending, an unrelated value.
  context.report('Pending', 'call', 'x', 'y')
  context.report('Value', 'other')
  // A completion that follows an earlier evaluation.
  context.emit('executionComplete', [])
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  // The call node's value, 0.7 s later in the packaged app.
  context.report('Value', 'call')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('an executionFailed after the edit settles; one before it does not', async () => {
  const context = new FakeContext()
  const before = watchExecution(context)
  context.emit('executionFailed', ['earlier'])
  before.editApplied()
  const notYet = before.settled({ added: ['a'] }, 1_000)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await notYet).toBe(false)

  const watch = watchExecution(context)
  watch.editApplied()
  const settled = watch.settled({ changed: ['a'] }, 1_000)
  context.emit('executionFailed', ['boom'])
  expect(await settled).toBe(true)
  expect(context.count()).toBe(0)
})

test('no affected ids: settled true at once, with no timer armed', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  await resolvesAtOnce(watch.settled({}, 1_000), true)
  expect(vi.getTimerCount()).toBe(0)
  expect(context.count()).toBe(0)
})

test('updates received before the edit was applied never count, even for a new id', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  context.report('Value', 'new', 'old')
  context.report('Pending', 'old')
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ added: ['new'], changed: ['old'] }, 1_000).then(settled)
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Value', 'new', 'old')
  await vi.advanceTimersByTimeAsync(0)
  // `old` had its Pending before the edit: the value may be from the run before it.
  expect(settled).not.toHaveBeenCalled()
  context.report('Pending', 'old')
  context.report('Value', 'old')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
  expect(context.count()).toBe(0)
})

test('a node that existed before the edit needs a Pending after it, then a value', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ changed: ['y'] }, 1_000).then(settled)
  // The run started for an earlier edit reports its value for `y`: stale for this edit.
  context.report('Value', 'y')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  // The engine takes this edit up: `y` is computed again.
  context.report('Pending', 'y')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Panic', 'y')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('a Pending and a value in one batch after the edit settle an existing node', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  context.emit('expressionUpdates', [
    [
      { expressionId: 'y', payload: { type: 'Pending' } },
      { expressionId: 'y', payload: { type: 'Value' } },
    ],
  ])
  await resolvesAtOnce(watch.settled({ changed: ['y'] }, 1_000), true)
})

test('an existing node with no Pending after the edit is not settled: false at the timeout', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = watch.settled({ changed: ['y'] }, 1_000)
  context.report('Value', 'y')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await settled).toBe(false)
})

test('new and existing nodes together: each by its own rule', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = vi.fn()
  void watch.settled({ added: ['n'], changed: ['y'] }, 1_000).then(settled)
  context.report('Value', 'n', 'y')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).not.toHaveBeenCalled()
  context.report('Pending', 'y')
  context.report('Value', 'y')
  await vi.advanceTimersByTimeAsync(0)
  expect(settled).toHaveBeenCalledWith(true)
})

test('the timeout gives false and removes the listeners', async () => {
  const context = new FakeContext()
  const watch = watchExecution(context)
  watch.editApplied()
  const settled = watch.settled({ added: ['a'] }, 1_000)
  await vi.advanceTimersByTimeAsync(999)
  expect(context.count()).toBe(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(await settled).toBe(false)
  expect(context.count()).toBe(0)
  context.report('Value', 'a')
})

test('cancel removes the listeners, before or during settled, and is idempotent', async () => {
  const context = new FakeContext()
  const early = watchExecution(context)
  early.cancel()
  expect(context.count()).toBe(0)
  expect(await early.settled({ added: ['a'] }, 1_000)).toBe(false)
  early.cancel()

  const waiting = watchExecution(context)
  waiting.editApplied()
  const settled = waiting.settled({ added: ['a'] }, 1_000)
  waiting.cancel()
  expect(await settled).toBe(false)
  expect(context.count()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

/** `doAfterUpdate` as `graph.ts` has it: the next update runs the queued callbacks. */
function queueingGraph() {
  const callbacks: (() => void)[] = []
  return {
    doAfterUpdate: (f: () => void) => {
      callbacks.push(f)
    },
    update: () => {
      for (const callback of callbacks.splice(0)) callback()
    },
  }
}

test('a graph update before updated is called is not missed: updated resolves true at once', async () => {
  const graph = queueingGraph()
  const watch = watchGraphUpdate(graph)
  graph.update()
  const updated = vi.fn()
  void watch.updated(1_000).then(updated)
  await vi.advanceTimersByTimeAsync(0)
  expect(updated).toHaveBeenCalledWith(true)
  expect(vi.getTimerCount()).toBe(0)
})

test('a graph update after updated is called resolves it true', async () => {
  const graph = queueingGraph()
  const watch = watchGraphUpdate(graph)
  const updated = watch.updated(1_000)
  graph.update()
  expect(await updated).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

test('without a graph update, updated resolves false at the timeout; a later update does nothing', async () => {
  const graph = queueingGraph()
  const watch = watchGraphUpdate(graph)
  const updated = vi.fn()
  void watch.updated(1_000).then(updated)
  await vi.advanceTimersByTimeAsync(999)
  expect(updated).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(updated).toHaveBeenCalledWith(false)
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  graph.update()
  expect(clear).not.toHaveBeenCalled()
  clear.mockRestore()
})

test('a cancelled graph watch answers false, keeps no timer, and ignores a later update', async () => {
  const graph = queueingGraph()
  const early = watchGraphUpdate(graph)
  early.cancel()
  expect(await early.updated(1_000)).toBe(false)
  early.cancel()

  const waiting = watchGraphUpdate(graph)
  const updated = waiting.updated(1_000)
  waiting.cancel()
  expect(await updated).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  graph.update()
})
