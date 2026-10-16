import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  encodeControlMessage,
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

describe('control messages', () => {
  test('round-trip', () => {
    const flush = { type: 'flush', id: 'x', modules: { g: [[1, 2]] } } as const
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
  })
})
