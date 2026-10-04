/**
 * @file Running an action when a drag hovers over a drop target for a while: the Vue port of
 * React's `useDragDelayAction` (#91). The drive's directory rows and breadcrumbs open when assets
 * are held over them for two seconds.
 */
import { onScopeDispose } from 'vue'

/** The default delay, in milliseconds, before the drag action triggers. */
const DEFAULT_DELAY_MS = 2000

/** Handlers to put on a native drop target. */
export interface DragDelayHandlers {
  readonly onDragEnter: (event: DragEvent) => void
  readonly onDragLeave: (event: DragEvent) => void
  readonly onDrop: (event: DragEvent) => void
}

/** Call `callback` once a drag has stayed over the target for `delayMs`. */
export function useDragDelayAction(
  callback: (() => void) | undefined,
  delayMs = DEFAULT_DELAY_MS,
): DragDelayHandlers {
  let handle: ReturnType<typeof setTimeout> | null = null

  function cancel() {
    if (handle != null) clearTimeout(handle)
    handle = null
  }

  onScopeDispose(cancel)

  /** Whether the event only moved between the target's own descendants. */
  function isInside(event: DragEvent) {
    return (
      event.currentTarget instanceof HTMLElement &&
      event.relatedTarget instanceof HTMLElement &&
      event.currentTarget.contains(event.relatedTarget)
    )
  }

  function onDragLeave(event: DragEvent) {
    if (isInside(event)) return
    cancel()
  }

  return {
    onDragEnter: (event) => {
      if (isInside(event)) return
      cancel()
      handle = setTimeout(() => callback?.(), delayMs)
    },
    onDragLeave,
    onDrop: onDragLeave,
  }
}
