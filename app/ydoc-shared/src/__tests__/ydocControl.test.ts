import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  encodeControlMessage,
  moduleState,
  moduleStateCovers,
  parseControlMessage,
  stateVectorCovers,
  stateVectorEntries,
  trackLocalDeletions,
} from '../ydocControl'

describe('state vectors', () => {
  test('a doc covers its own state vector, and not one with a later edit', () => {
    const a = new Y.Doc()
    a.getMap('m').set('k', 1)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(true)
    a.getMap('m').set('k', 2)
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(false)
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(true)
  })

  test('an empty state vector is always covered', () => {
    expect(stateVectorCovers(new Y.Doc(), [])).toBe(true)
  })
})

describe('module states', () => {
  test('a deletion advances no clock, but is not covered until it arrives', () => {
    const a = new Y.Doc()
    a.getMap('m').set('k', 1)
    a.getMap('m').set('j', 1)
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(moduleStateCovers(b, moduleState(a))).toBe(true)
    const before = Y.encodeStateVector(b)
    a.getMap('m').delete('k')
    // The state vector alone cannot tell.
    expect(stateVectorCovers(b, stateVectorEntries(a))).toBe(true)
    expect(moduleStateCovers(b, moduleState(a))).toBe(false)
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, before))
    expect(moduleStateCovers(b, moduleState(a))).toBe(true)
  })

  test('the delete set travels as JSON', () => {
    const a = new Y.Doc()
    a.getArray('a').insert(0, [1, 2, 3, 4])
    a.getArray('a').delete(1, 2)
    expect(JSON.parse(JSON.stringify(moduleState(a)))).toEqual({
      stateVector: [[a.clientID, 4]],
      deleteSet: { [a.clientID]: [[1, 2]] },
    })
  })

  test('an empty doc state is always covered', () => {
    expect(moduleStateCovers(new Y.Doc(), { stateVector: [], deleteSet: {} })).toBe(true)
  })
})

describe('only this client’s own edits are sent', () => {
  // Every other client's edits reached this one through the ydoc server, which therefore has them.
  test('the state vector names only this client', () => {
    const other = new Y.Doc()
    other.getMap('m').set('o', 1)
    const a = new Y.Doc()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other))
    a.getMap('m').set('k', 1)
    expect(moduleState(a).stateVector).toEqual([[a.clientID, 1]])
  })

  test('an own edit the server lacks is still not covered', () => {
    const other = new Y.Doc()
    other.getMap('m').set('o', 1)
    const a = new Y.Doc()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other))
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(other))
    const deletions = trackLocalDeletions(a)
    a.getMap('m').set('k', 1)
    expect(moduleStateCovers(server, moduleState(a, deletions.entries()))).toBe(false)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(a))
    expect(moduleStateCovers(server, moduleState(a, deletions.entries()))).toBe(true)
  })

  test('deleting another client’s item counts: the delete set is keyed by the item’s creator', () => {
    const other = new Y.Doc()
    other.getMap('m').set('o', 1)
    other.getMap('m').set('p', 1)
    const a = new Y.Doc()
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other))
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(other))
    const deletions = trackLocalDeletions(a)
    const before = Y.encodeStateVector(server)
    a.getMap('m').delete('o')
    const state = moduleState(a, deletions.entries())
    // A deletion advances no clock, and is recorded under the deleted item's client.
    expect(state.stateVector).toEqual([])
    expect(Object.keys(state.deleteSet)).toEqual([String(other.clientID)])
    expect(moduleStateCovers(server, state)).toBe(false)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(a, before))
    expect(moduleStateCovers(server, state)).toBe(true)
  })

  test('deletions that arrive from elsewhere are not this client’s', () => {
    const other = new Y.Doc()
    other.getMap('m').set('o', 1)
    const a = new Y.Doc()
    const deletions = trackLocalDeletions(a)
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other))
    other.getMap('m').delete('o')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(other))
    expect(deletions.entries()).toEqual({})
    deletions.stop()
  })

  test('covering many deletion ranges is fast', () => {
    const a = new Y.Doc()
    const array = a.getArray<number>('a')
    array.insert(
      0,
      Array.from({ length: 20_000 }, (_, i) => i),
    )
    // Every other element: 10 000 separate ranges.
    a.transact(() => {
      for (let i = 10_000; i > 0; i--) array.delete(i * 2 - 1, 1)
    })
    const state = moduleState(a)
    expect(state.deleteSet[String(a.clientID)]).toHaveLength(10_000)
    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(a))
    const start = performance.now()
    expect(moduleStateCovers(server, state)).toBe(true)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe('control messages', () => {
  test('round-trip', () => {
    const flush = {
      type: 'flush',
      id: 'x',
      modules: { g: { stateVector: [[1, 2]], deleteSet: { 1: [[0, 1]] } } },
    } as const
    expect(parseControlMessage(encodeControlMessage(flush))).toEqual(flush)
    const failed = { type: 'flushed', id: 'x', ok: false, error: 'changed on disk' } as const
    expect(parseControlMessage(encodeControlMessage(failed))).toEqual(failed)
  })

  test('anything else is null', () => {
    expect(parseControlMessage('not json')).toBeNull()
    expect(parseControlMessage(JSON.stringify({ type: 'flush', id: 3 }))).toBeNull()
    expect(parseControlMessage(JSON.stringify({ type: 'other', id: 'x' }))).toBeNull()
    expect(
      parseControlMessage(JSON.stringify({ type: 'flush', id: 'x', modules: { g: 'no' } })),
    ).toBeNull()
    expect(
      parseControlMessage(
        JSON.stringify({ type: 'flush', id: 'x', modules: { g: { stateVector: [[1, 2]] } } }),
      ),
    ).toBeNull()
    expect(
      parseControlMessage(
        JSON.stringify({
          type: 'flush',
          id: 'x',
          modules: { g: { stateVector: [], deleteSet: { 1: 'no' } } },
        }),
      ),
    ).toBeNull()
  })
})
