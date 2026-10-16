import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  encodeControlMessage,
  moduleState,
  moduleStateCovers,
  parseControlMessage,
  stateVectorCovers,
  stateVectorEntries,
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
