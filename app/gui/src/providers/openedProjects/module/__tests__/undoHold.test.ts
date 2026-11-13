import { holdUndoStep } from '$/providers/openedProjects/module/undoHold'
import { expect, test } from 'vitest'
import * as Y from 'yjs'

function setup() {
  const doc = new Y.Doc()
  const map = doc.getMap<number>('m')
  // A zero timeout makes every change its own step, as a pause longer than the default would.
  const manager = new Y.UndoManager([map], { captureTimeout: 0 })
  return { map, manager }
}

test('changes made while a step is held undo together, and apart from their neighbours', () => {
  const { map, manager } = setup()
  map.set('before', 1)
  const release = holdUndoStep(manager)
  map.set('drag1', 1)
  map.set('drag2', 1)
  release()
  map.set('after', 1)

  manager.undo()
  expect([...map.keys()].sort()).toEqual(['before', 'drag1', 'drag2'])
  manager.undo()
  expect([...map.keys()]).toEqual(['before'])
  manager.undo()
  expect([...map.keys()]).toEqual([])
})

test('overlapping holds are one step, ending with the last release, in either order', () => {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const { map, manager } = setup()
    const releases = [holdUndoStep(manager), holdUndoStep(manager)]
    map.set('a', 1)
    releases[order[0]!]!()
    map.set('b', 1)
    expect(manager.captureTimeout).toBe(Number.POSITIVE_INFINITY)
    releases[order[1]!]!()
    expect(manager.captureTimeout).toBe(0)
    map.set('after', 1)
    manager.undo()
    manager.undo()
    expect([...map.keys()]).toEqual([])
  }
})

test('releasing restores the timeout, and a second release does nothing', () => {
  const { manager } = setup()
  const release = holdUndoStep(manager)
  expect(manager.captureTimeout).toBe(Number.POSITIVE_INFINITY)
  release()
  expect(manager.captureTimeout).toBe(0)
  manager.captureTimeout = 500
  release()
  expect(manager.captureTimeout).toBe(500)
})
