/** @file Keeping a run of edits in one undo step. */
import type * as Y from 'yjs'

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
