import { describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { MutableModule } from '../ast/mutableModule'
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

describe('graph edits (MutableModule.edit and applyEdit)', () => {
  // A graph edit is made in a fresh doc (a random client ID per edit) and applied to the GUI's doc
  // by `applyEdit`, which is not a local transaction. The flush must still describe it, whoever
  // created the nodes it inserts or deletes.
  const syncedPair = (code: string) => {
    const serverDoc = new Y.Doc()
    new MutableModule(serverDoc).syncToCode(code)
    const guiDoc = new Y.Doc()
    Y.applyUpdate(guiDoc, Y.encodeStateAsUpdate(serverDoc))
    return { serverDoc, guiDoc, gui: new MutableModule(guiDoc) }
  }

  test('an edit that inserts is not covered until the server applies it', () => {
    const { serverDoc, guiDoc, gui } = syncedPair('a = 1\n')
    const since = Y.encodeStateVector(serverDoc)
    const edit = gui.edit()
    edit.syncToCode('a = 1\nb = 2\n')
    gui.applyEdit(edit)
    const state = moduleState(guiDoc)
    expect(moduleStateCovers(serverDoc, state)).toBe(false)
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(guiDoc, since))
    expect(moduleStateCovers(serverDoc, state)).toBe(true)
  })

  test('an edit that deletes a node another client created is not covered until applied', () => {
    const { serverDoc, guiDoc, gui } = syncedPair('a = 1\nb = 2\n')
    const since = Y.encodeStateVector(serverDoc)
    const edit = gui.edit()
    edit.syncToCode('a = 1\n')
    gui.applyEdit(edit)
    const state = moduleState(guiDoc)
    expect(moduleStateCovers(serverDoc, state)).toBe(false)
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(guiDoc, since))
    expect(moduleStateCovers(serverDoc, state)).toBe(true)
    expect(new MutableModule(serverDoc).root()?.code()).toBe('a = 1\n')
  })
})

describe('large delete sets', () => {
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
    // Building the 10 000 ranges above is slow on a loaded CI runner and is not what this measures,
    // so the test gets more than vitest's default 5 s; the 100 ms bound is the actual check.
  }, 30_000)
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
