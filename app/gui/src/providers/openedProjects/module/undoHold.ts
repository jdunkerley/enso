/** @file Keeping a run of edits in one undo step, and undoing or redoing above a floor. */
import type * as Y from 'yjs'

/**
 * Undo the top step of `manager`'s undo stack without being able to reach its `floor` lowest
 * steps. Returns whether anything in the document changed.
 *
 * `Y.UndoManager.undo()` keeps popping steps while a popped step changes nothing (`popStackItem`
 * in yjs's `UndoManager.js`): a step whose changes something untracked has already reverted (an
 * update from the server, a derived write) is dropped, and the step below it is undone instead.
 * So a single `undo()` can go below any depth its caller checked. Here the steps below `floor`
 * are taken off the stack for the duration of the call and put back afterwards: the loop ends at
 * the floor, with nothing undone if every step above it was such a no-op.
 *
 * While they are off the stack, the manager's own events (`stack-item-popped`, `stack-item-added`
 * for the redo stack) see a shorter undo stack; a listener that reads `canUndo()` then must read it
 * again after this returns (the module store's status does).
 */
export function undoAbove(manager: Y.UndoManager, floor: number): boolean {
  return popAbove(manager, 'undoStack', floor, () => manager.undo())
}

/**
 * Redo the top step of `manager`'s redo stack without being able to reach its `floor` lowest
 * steps; see {@link undoAbove}. Returns whether anything in the document changed.
 */
export function redoAbove(manager: Y.UndoManager, floor: number): boolean {
  return popAbove(manager, 'redoStack', floor, () => manager.redo())
}

function popAbove(
  manager: Y.UndoManager,
  stack: 'undoStack' | 'redoStack',
  floor: number,
  pop: () => unknown,
): boolean {
  const kept = Math.max(0, floor)
  if (manager[stack].length <= kept) return false
  const below = manager[stack].splice(0, kept)
  try {
    return pop() != null
  } finally {
    // Read the stack again: it is the same array unless something cleared the manager meanwhile.
    manager[stack].unshift(...below)
  }
}

/** The holds open on each manager, and the timeout to restore when the last is released. */
const holds = new WeakMap<Y.UndoManager, { count: number; timeout: number }>()

/**
 * Make every change from now until the returned function is called one undo step, however long
 * the gaps between them: a drag writes on every frame, and a pause in it must not split the undo.
 * The step is separate from the changes before and after it.
 *
 * The hold only lifts the capture timeout: `stopCapturing()` called by anything else (the
 * deselect-all boundary, for one) still ends the step there, and the changes after it make the
 * next one.
 *
 * Holds on one manager may overlap (an arrow-key move during a resize drag): they make one step,
 * which ends when the last of them is released, in whatever order.
 *
 * The returned function must be called, or every later change joins the step. Calling it again
 * does nothing.
 */
export function holdUndoStep(manager: Y.UndoManager): () => void {
  const state = holds.get(manager) ?? { count: 0, timeout: manager.captureTimeout }
  if (state.count === 0) {
    manager.stopCapturing()
    holds.set(manager, state)
    manager.captureTimeout = Number.POSITIVE_INFINITY
  }
  state.count++
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--state.count > 0) return
    holds.delete(manager)
    manager.captureTimeout = state.timeout
    manager.stopCapturing()
  }
}
