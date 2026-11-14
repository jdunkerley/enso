/** @file The view of a graph that has no saved view: where it is first shown, and keeping it there. */
import type { Rect } from '@/util/data/rect'
import { Vec2 } from '@/util/data/vec2'
import { watch, type WatchSource } from 'vue'

/** The space, in screen pixels, kept between a graph that does not fit and the viewport's edge. */
export const INITIAL_VIEW_MARGIN = 32

/** Whether `bounds` fit in a viewport of `viewportSize` at 100%, with the margin on every side. */
export function fitsAtFullSize(bounds: Rect, viewportSize: Vec2): boolean {
  return (
    bounds.width + 2 * INITIAL_VIEW_MARGIN <= viewportSize.x &&
    bounds.height + 2 * INITIAL_VIEW_MARGIN <= viewportSize.y
  )
}

/**
 * The viewport's left-top corner, in scene coordinates, that shows `bounds` at 100%. On each axis
 * the bounds are centred when they fit, and otherwise their start (left, top) is shown, one
 * margin in from the viewport's edge, so that they overflow to the right or the bottom.
 */
export function placeAtFullSize(bounds: Rect, viewportSize: Vec2): Vec2 {
  const axis = (start: number, size: number, viewport: number) =>
    size + 2 * INITIAL_VIEW_MARGIN <= viewport ?
      start + size / 2 - viewport / 2
    : start - INITIAL_VIEW_MARGIN
  return new Vec2(
    axis(bounds.left, bounds.width, viewportSize.x),
    axis(bounds.top, bounds.height, viewportSize.y),
  )
}

/** The navigator's target view, as {@link keepInitialView} compares it. */
export interface ViewTarget {
  pos: Vec2
  scale: number
}

/**
 * Show the initial view now, and again whenever `inputs` change, until the user first acts (a
 * key, a pointer press or a wheel anywhere in the window), something else moves the view, or
 * `signal` aborts. Returns a function that stops it.
 *
 * A graph is first shown as soon as its nodes have positions, but a node's size is measured from
 * its rendered widgets, which fill in afterwards (and again as the engine reports types), so a
 * view computed once is computed from placeholder sizes: the node then grows to the right of
 * where it was centred.
 */
export function keepInitialView({
  show,
  inputs,
  target,
  signal,
}: {
  show: () => void
  inputs: WatchSource
  target: () => ViewTarget
  signal: AbortSignal
}): () => void {
  show()
  let shown = target()
  const stopWatch = watch(inputs, () => {
    if (!sameView(target(), shown)) return stop()
    show()
    shown = target()
  })
  const events = ['keydown', 'pointerdown', 'wheel'] as const
  const options = { capture: true, passive: true }
  function stop() {
    stopWatch()
    for (const event of events) window.removeEventListener(event, stop, options)
    signal.removeEventListener('abort', stop)
  }
  for (const event of events) window.addEventListener(event, stop, options)
  signal.addEventListener('abort', stop)
  if (signal.aborted) stop()
  return stop
}

function sameView(a: ViewTarget, b: ViewTarget) {
  const EPSILON = 1e-6
  return (
    Math.abs(a.scale - b.scale) < EPSILON &&
    Math.abs(a.pos.x - b.pos.x) < EPSILON &&
    Math.abs(a.pos.y - b.pos.y) < EPSILON
  )
}
