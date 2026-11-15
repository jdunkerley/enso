import { ObservableV2 } from 'lib0/observable'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ref, watch } from 'vue'
import * as Y from 'yjs'
import {
  afterGraphUpdate,
  executionSettled,
  isUserTransaction,
  onUserModuleTransaction,
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
  current.value = moduleOver(second)
  first.transact(() => first.getMap('m').set('x', 1), 'local:userAction')
  expect(listener).not.toHaveBeenCalled()
  second.transact(() => second.getMap('m').set('x', 1), 'local:userAction')
  expect(listener).toHaveBeenCalledTimes(1)
  stop()
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
}> {
  count() {
    return (
      (this._observers.get('executionComplete')?.size ?? 0) +
      (this._observers.get('executionFailed')?.size ?? 0)
    )
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

test('executionSettled resolves true on completion or failure and removes both listeners', async () => {
  const context = new FakeContext()
  const complete = executionSettled(context, 1_000)
  expect(context.count()).toBe(2)
  context.emit('executionComplete', [])
  expect(await complete).toBe(true)
  expect(context.count()).toBe(0)

  const failed = executionSettled(context, 1_000)
  context.emit('executionFailed', ['boom'])
  expect(await failed).toBe(true)
  expect(context.count()).toBe(0)
})

test('executionSettled resolves false at the timeout and removes both listeners', async () => {
  const context = new FakeContext()
  const settled = executionSettled(context, 1_000)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(await settled).toBe(false)
  expect(context.count()).toBe(0)
  context.emit('executionComplete', [])
})
