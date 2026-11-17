/* eslint-disable camelcase -- result field names are snake_case on the wire */
/**
 * @file The edit session's own history over a real `Y.UndoManager`, as the module store builds it:
 * tracked user origins, the agents' edits as the same origin, and changes from the server or
 * derived writes as untracked origins. The two scenarios of the review: an agent's step that an
 * untracked change has reverted must not let one `undo` go on into the user's step below it.
 */
import { holdUndoStep, redoAbove, undoAbove } from '$/providers/openedProjects/module/undoHold'
import { Ok, type Result } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import * as Y from 'yjs'
import {
  EditSession,
  NOTHING_LEFT_TO_REDO_ERROR,
  NOTHING_LEFT_TO_UNDO_ERROR,
  NOTHING_TO_REDO_ERROR,
  NOTHING_TO_UNDO_ERROR,
} from '../editSession'

const agent = { kind: 'external', name: 'claude-code' } as const
/** The origin of the user's edits and of the agents' (`module.edit`'s default). */
const USER = 'local:userAction'
/** An untracked origin: an update from the ydoc server (the file changed on disk). */
const PROVIDER = 'provider'

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

function setup() {
  const doc = new Y.Doc()
  const nodes = doc.getMap<string | number>('nodes')
  const manager = new Y.UndoManager([nodes])
  manager.addTrackedOrigin(USER)
  const session = new EditSession({
    isLive: () => false,
    isActive: () => true,
    holdUndoStep: () => {
      manager.stopCapturing()
      const release = holdUndoStep(manager)
      return () => {
        release()
        manager.stopCapturing()
      }
    },
    // Every transaction the undo manager records, before it is applied (`onUserModuleTransaction`).
    onForeignEdit: (listener) => {
      const handler = (transaction: Y.Transaction) => {
        if (manager.trackedOrigins.has(transaction.origin)) listener()
      }
      doc.on('beforeTransaction', handler)
      return () => doc.off('beforeTransaction', handler)
    },
    historyDepth: () => ({ undo: manager.undoStack.length, redo: manager.redoStack.length }),
    undo: (floor) => undoAbove(manager, floor),
    redo: (floor) => redoAbove(manager, floor),
    enablesOutput: () => nodes.get('prefix') === 'on',
    saveVersion: async () => {},
    watchGraphUpdate: () => ({ updated: async () => true, cancel: () => {} }),
    watchExecution: () => ({ editApplied: () => {}, settled: async () => true, cancel: () => {} }),
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  /** The user changes the project: one step of its own. */
  const userEdit = (f: () => void) => {
    doc.transact(f, USER)
    manager.stopCapturing()
  }
  /** An agent's edit through the session, in its own step (the session releases it at once). */
  const agentEdit = async (f: () => void) => {
    const result = await session.run(agent, () => {
      doc.transact(f, USER)
      return Ok(undefined)
    })
    expect(result.ok).toBe(true)
    session.releaseStep()
  }
  /**
   * An agent's async edit through the session that leaves its step held: `f` runs while the edit
   * is in progress (`inEdit`), and may await and act for the user meanwhile.
   */
  const heldEdit = async (f: () => Promise<void>) => {
    const result = await session.run(agent, async () => {
      await f()
      return Ok(undefined)
    })
    expect(result.ok).toBe(true)
  }
  /** A change made as the agent's edit makes it (`module.edit`'s origin). */
  const agentChange = (f: () => void) => doc.transact(f, USER)
  /** A change the undo manager does not track. */
  const untracked = (f: () => void) => doc.transact(f, PROVIDER)
  return { doc, nodes, manager, session, userEdit, agentEdit, heldEdit, agentChange, untracked }
}

/** Lets the other side of an `await` run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

test('the depth rule: a held step of several async agent edits is exactly one undo item', async () => {
  const { nodes, manager, session, userEdit, heldEdit, agentChange } = setup()
  userEdit(() => nodes.set('U', 1))
  const base = manager.undoStack.length
  await heldEdit(async () => agentChange(() => nodes.set('A', 1)))
  await heldEdit(async () => {
    agentChange(() => nodes.set('B', 1))
    await tick()
    agentChange(() => nodes.set('C', 1))
  })
  await heldEdit(async () => {
    await tick()
    agentChange(() => nodes.delete('A'))
  })
  expect(manager.undoStack.length).toBe(base + 1)
  // Not sealed: one undo takes the whole step back, and stops at the user's.
  expect(await session.undo(agent)).toEqual(Ok({ can_undo: false, can_redo: true }))
  expect([...nodes.keys()]).toEqual(['U'])
})

test('the depth rule: a user redo during an async edit seals the step', async () => {
  const { nodes, manager, session, userEdit, heldEdit, agentChange } = setup()
  userEdit(() => nodes.set('W', 'write node'))
  // The user's own Ctrl+Z: their step is on the redo stack.
  manager.undo()
  await heldEdit(async () => {
    await tick()
    // The user's Ctrl+Y lands while the edit awaits: their step is back, above the floor.
    manager.redo()
    agentChange(() => nodes.set('A', 1))
  })
  session.releaseStep()
  expect(errorOf(await session.undo(agent))).toBe(NOTHING_TO_UNDO_ERROR)
  expect(nodes.get('W')).toBe('write node')
  expect(nodes.get('A')).toBe(1)
})

test('the depth rule: a boundary inside the step, then more changes, seals the step', async () => {
  const { doc, nodes, manager, session, heldEdit, agentChange } = setup()
  await heldEdit(async () => {
    agentChange(() => nodes.set('A', 1))
    await tick()
    // The user edits while the edit awaits, then clicks the background (deselectAll's boundary).
    doc.transact(() => nodes.set('U', 1), USER)
    manager.stopCapturing()
    agentChange(() => nodes.set('B', 1))
  })
  session.releaseStep()
  expect(errorOf(await session.undo(agent))).toBe(NOTHING_TO_UNDO_ERROR)
  expect(nodes.get('U')).toBe(1)
})

test('the depth rule: a user undo during an async edit seals the step', async () => {
  const { nodes, manager, session, agentEdit, heldEdit, agentChange } = setup()
  await agentEdit(() => nodes.set('A', 1))
  await heldEdit(async () => {
    await tick()
    // The user's Ctrl+Z lands while the edit awaits, before its change: it takes back the step
    // below, and the edit's change then makes a new item at the same depth.
    manager.undo()
    agentChange(() => nodes.set('B', 1))
  })
  session.releaseStep()
  expect(errorOf(await session.undo(agent))).toBe(NOTHING_TO_UNDO_ERROR)
  expect(errorOf(await session.redo(agent))).toBe(NOTHING_TO_REDO_ERROR)
  expect(nodes.has('A')).toBe(false)
  expect(nodes.get('B')).toBe(1)
})

test("reviewer's case 1: an agent's node removed by an untracked change; undo stops at the floor", async () => {
  const { nodes, manager, session, userEdit, agentEdit, untracked } = setup()
  userEdit(() => nodes.set('W', 'write node'))
  // The user removes their node that writes: undoing this step would bring it back.
  userEdit(() => nodes.delete('W'))
  const floor = manager.undoStack.length
  await agentEdit(() => nodes.set('A', 'agent node'))
  // The file changes on disk, and the agent's node is gone without the session seeing an edit.
  untracked(() => nodes.delete('A'))

  expect(errorOf(await session.undo(agent))).toBe(NOTHING_LEFT_TO_UNDO_ERROR)
  expect(nodes.has('W')).toBe(false)
  // The user's step is still there, for the user's Ctrl+Z.
  expect(manager.undoStack.length).toBe(floor)
  expect(errorOf(await session.undo(agent))).toBe(NOTHING_TO_UNDO_ERROR)
  expect(nodes.has('W')).toBe(false)
  expect(errorOf(await session.redo(agent))).toBe(NOTHING_TO_REDO_ERROR)
})

test("reviewer's case 1 with a plain undo() goes on into the user's step (why it is bounded)", () => {
  const { nodes, manager, userEdit, untracked, doc } = setup()
  userEdit(() => nodes.set('W', 'write node'))
  userEdit(() => nodes.delete('W'))
  doc.transact(() => nodes.set('A', 'agent node'), USER)
  manager.stopCapturing()
  untracked(() => nodes.delete('A'))
  manager.undo()
  expect(nodes.get('W')).toBe('write node')
})

test("reviewer's case 2: an agent's move overwritten by an untracked change; undo stops at the floor", async () => {
  const { nodes, manager, session, userEdit, agentEdit, untracked } = setup()
  userEdit(() => nodes.set('prefix', 'on'))
  // The user turns Write off.
  userEdit(() => nodes.set('prefix', 'off'))
  const floor = manager.undoStack.length
  await agentEdit(() => nodes.set('pos', 1))
  untracked(() => nodes.set('pos', 2))

  expect(errorOf(await session.undo(agent))).toBe(NOTHING_LEFT_TO_UNDO_ERROR)
  expect(nodes.get('prefix')).toBe('off')
  expect(nodes.get('pos')).toBe(2)
  expect(manager.undoStack.length).toBe(floor)
})

test('a reverted step on top of an own one: undo takes back the own one, not the user step', async () => {
  const { nodes, manager, session, userEdit, agentEdit, untracked } = setup()
  userEdit(() => nodes.set('W', 'write node'))
  userEdit(() => nodes.delete('W'))
  const floor = manager.undoStack.length
  await agentEdit(() => nodes.set('A', 1))
  await agentEdit(() => nodes.set('B', 1))
  untracked(() => nodes.delete('B'))

  const result = await session.undo(agent)
  expect(result).toEqual(Ok({ can_undo: false, can_redo: true }))
  expect(nodes.has('A')).toBe(false)
  expect(nodes.has('W')).toBe(false)
  expect(manager.undoStack.length).toBe(floor)
  // redo re-applies what undo took back, and no more.
  expect(await session.redo(agent)).toEqual(Ok({ can_undo: true, can_redo: false }))
  expect(nodes.get('A')).toBe(1)
  expect(nodes.has('W')).toBe(false)
})

test('a redo step reverted by an untracked change: redo stops at its floor', async () => {
  const { nodes, manager, session, agentEdit, untracked } = setup()
  await agentEdit(() => nodes.set('A', 1))
  expect((await session.undo(agent)).ok).toBe(true)
  expect(nodes.has('A')).toBe(false)
  // Something else sets the key the redo would restore: the redo step changes nothing now.
  untracked(() => nodes.set('A', 2))
  expect(errorOf(await session.redo(agent))).toBe(NOTHING_LEFT_TO_REDO_ERROR)
  expect(nodes.get('A')).toBe(2)
  expect(manager.redoStack.length).toBe(0)
})

test("the user Ctrl+Z ends the agents' history, and the session redo cannot reach its redo step", async () => {
  const { nodes, manager, session, userEdit, agentEdit } = setup()
  await agentEdit(() => nodes.set('A', 1))
  userEdit(() => nodes.set('U', 1))
  // The user's own undo: a foreign transaction.
  manager.undo()
  expect(nodes.has('U')).toBe(false)
  expect(manager.redoStack.length).toBe(1)
  expect(errorOf(await session.undo(agent))).toBe(NOTHING_TO_UNDO_ERROR)
  expect(errorOf(await session.redo(agent))).toBe(NOTHING_TO_REDO_ERROR)
  expect(nodes.has('U')).toBe(false)
})

test('undoAbove and redoAbove leave the steps below the floor in place, in order', () => {
  const { nodes, manager, userEdit } = setup()
  userEdit(() => nodes.set('a', 1))
  userEdit(() => nodes.set('b', 1))
  userEdit(() => nodes.set('c', 1))
  const [first, second] = manager.undoStack
  expect(undoAbove(manager, 2)).toBe(true)
  expect(manager.undoStack).toEqual([first, second])
  expect(undoAbove(manager, 2)).toBe(false)
  expect(nodes.has('b')).toBe(true)
  // Two steps on the redo stack now? Only one: the floor stopped the second undo.
  expect(manager.redoStack.length).toBe(1)
  expect(undoAbove(manager, 0)).toBe(true)
  const redoBottom = manager.redoStack[0]
  expect(redoAbove(manager, 1)).toBe(true)
  expect(nodes.has('b')).toBe(true)
  expect(manager.redoStack).toEqual([redoBottom])
  expect(redoAbove(manager, 1)).toBe(false)
  expect(nodes.has('c')).toBe(false)
  expect(manager.canUndo()).toBe(true)
  expect(manager.canRedo()).toBe(true)
})

test('a plain redo() goes on below a reverted step; redoAbove stops at its floor', () => {
  for (const bounded of [false, true]) {
    const { nodes, manager, userEdit, untracked } = setup()
    userEdit(() => nodes.set('u', 1))
    userEdit(() => nodes.set('a', 1))
    manager.undo()
    manager.undo()
    // The step that set `a` was undone first, so it is at the bottom of the redo stack and the one
    // that set `u` is on top.
    expect(manager.redoStack.length).toBe(2)
    // Something else sets `u`: redoing the top step changes nothing now.
    untracked(() => nodes.set('u', 2))
    if (bounded) {
      expect(redoAbove(manager, 1)).toBe(false)
      expect(nodes.has('a')).toBe(false)
      expect(manager.redoStack.length).toBe(1)
    } else {
      // One redo drops the top step and re-applies the one below it.
      expect(manager.redo()).not.toBeNull()
      expect(nodes.get('a')).toBe(1)
      expect(nodes.get('u')).toBe(2)
    }
  }
})
