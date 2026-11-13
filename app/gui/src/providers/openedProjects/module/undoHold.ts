/** @file Keeping a run of edits in one undo step. */
import type * as Y from 'yjs'

/**
 * Make every change from now until the returned function is called one undo step, however long
 * the gaps between them: a resize drag writes on every frame, and a pause in it must not split
 * the undo. The step is separate from the changes before and after it.
 *
 * The returned function must be called, or every later change joins the step. Calling it again
 * does nothing.
 */
export function holdUndoStep(manager: Y.UndoManager): () => void {
  manager.stopCapturing()
  const timeout = manager.captureTimeout
  manager.captureTimeout = Number.POSITIVE_INFINITY
  let held = true
  return () => {
    if (!held) return
    held = false
    manager.captureTimeout = timeout
    manager.stopCapturing()
  }
}
