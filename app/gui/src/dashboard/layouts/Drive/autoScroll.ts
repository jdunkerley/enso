/**
 * @file Scrolling a container while the pointer drags near its edges: the Vue port of React's
 * `autoScrollHooks`, with its constants. The drive's table uses it while a selection is drawn or
 * rows are dragged.
 */
import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

/** See {@link AutoScrollOptions.threshold}. */
const AUTOSCROLL_THRESHOLD_PX = 50
/** See {@link AutoScrollOptions.speed}. */
const AUTOSCROLL_SPEED = 100
/** See {@link AutoScrollOptions.falloff}. */
const AUTOSCROLL_FALLOFF = 10

/** The direction(s) in which autoscroll should happen. */
export type AutoScrollDirection = 'both' | 'horizontal' | 'none' | 'vertical'

/** Options for {@link useAutoScroll}. */
export interface AutoScrollOptions {
  readonly direction?: AutoScrollDirection
  /**
   * If the pointer is less than this distance from the top or bottom of the container, the
   * container scrolls towards that edge.
   */
  readonly threshold?: number
  /** An arbitrary constant that controls the speed of autoscroll. */
  readonly speed?: number
  /** The autoscroll speed is `speed / (distance + falloff)`. */
  readonly falloff?: number
}

/** Scroll a container when the pointer is near its edges. */
export function useAutoScroll(
  scrollContainer: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: AutoScrollOptions = {},
) {
  let isScrolling = false
  let animationFrameHandle = 0
  let pointerX = 0
  let pointerY = 0

  /** Record where the pointer is. */
  const onMouseEvent = (event: MouseEvent) => {
    pointerX = event.clientX
    pointerY = event.clientY
  }

  /** Scroll by one step, if the pointer is near an edge, and come back on the next frame. */
  const onAnimationFrame = () => {
    const container = toValue(scrollContainer)
    if (!isScrolling || container == null) return
    const {
      direction = 'vertical',
      threshold = AUTOSCROLL_THRESHOLD_PX,
      speed = AUTOSCROLL_SPEED,
      falloff = AUTOSCROLL_FALLOFF,
    } = options
    const rect = container.getBoundingClientRect()
    if (direction === 'vertical' || direction === 'both') {
      if (container.scrollTop > 0) {
        const distanceToTop = Math.max(0, pointerY - rect.top)
        if (distanceToTop < threshold) {
          container.scrollTop = container.scrollTop - Math.floor(speed / (distanceToTop + falloff))
        }
      }
      if (container.scrollTop + rect.height < container.scrollHeight) {
        const distanceToBottom = Math.max(0, rect.bottom - pointerY)
        if (distanceToBottom < threshold) {
          container.scrollTop =
            container.scrollTop + Math.floor(speed / (distanceToBottom + falloff))
        }
      }
    }
    if (direction === 'horizontal' || direction === 'both') {
      if (container.scrollLeft > 0) {
        // React measured this from the container's top, not its left; kept as it was.
        const distanceToLeft = Math.max(0, pointerX - rect.top)
        if (distanceToLeft < threshold) {
          container.scrollLeft =
            container.scrollLeft - Math.floor(speed / (distanceToLeft + falloff))
        }
      }
      if (container.scrollLeft + rect.width < container.scrollWidth) {
        const distanceToRight = Math.max(0, rect.right - pointerX)
        if (distanceToRight < threshold) {
          container.scrollLeft =
            container.scrollLeft + Math.floor(speed / (distanceToRight + falloff))
        }
      }
    }
    animationFrameHandle = requestAnimationFrame(onAnimationFrame)
  }

  /** Start scrolling while the pointer is near an edge. */
  const startAutoScroll = () => {
    if (!isScrolling) {
      isScrolling = true
      animationFrameHandle = requestAnimationFrame(onAnimationFrame)
    }
  }

  /** Stop scrolling. */
  const endAutoScroll = () => {
    isScrolling = false
    cancelAnimationFrame(animationFrameHandle)
  }

  onScopeDispose(endAutoScroll)

  return { startAutoScroll, endAutoScroll, onMouseEvent }
}
