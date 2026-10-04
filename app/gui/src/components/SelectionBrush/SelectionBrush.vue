<script lang="ts">
/**
 * @file A rubber-band selection rectangle drawn while the pointer drags over `target`: the Vue
 * counterpart of the React `#/components/SelectionBrush`, which the drive's table uses. It is not
 * the graph editor's `SelectionBrush.vue`, which draws in the graph's coordinates.
 *
 * A drag starts on a pointer press inside `target` (unless `preventDrag` says no) and counts once
 * the pointer has left a 24px dead zone. While it lasts, the pointer is captured by `target`, text
 * selection is off, and scrolling a container around `target` stretches the rectangle with it.
 * `onDrag` receives the rectangle (in page coordinates) on every frame the pointer moves;
 * `onDragEnd` the releasing event, and `onDragCancel` follows it when the pointer was cancelled.
 *
 * As in React, the rectangle drawn lags the pointer by one move event: each frame uses the
 * position the previous event recorded.
 */
import { portalTarget } from '$/components/portal'
import type { Coordinate2D, DetailedRectangle, Rectangle } from '$/utils/geometry'
import { getDetailedRectangle, getDetailedRectangleFromRectangle } from '$/utils/geometry'
import { findScrollContainers, type HTMLOrSVGElement } from '$/utils/scrollContainers'
import { useEventListener } from '@vueuse/core'
import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** Parameters for the `onDrag` callback. */
export interface OnDragParams {
  readonly diff: Coordinate2D
  readonly start: Coordinate2D
  readonly current: Coordinate2D
  readonly rectangle: DetailedRectangle
  readonly event: PointerEvent
}

/** How far the pointer must move before a press becomes a selection. */
const DEAD_ZONE_SIZE = 24

/** Whether `current` is still within `deadZoneSize` of `initial` on both axes. */
function isInDeadZone(initial: Coordinate2D, current: Coordinate2D, deadZoneSize: number) {
  const horizontalDistance = Math.abs(initial.left - current.left)
  const verticalDistance = Math.abs(initial.top - current.top)
  return horizontalDistance < deadZoneSize && verticalDistance < deadZoneSize
}

/** A direction a container scrolled in. */
type Direction =
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom'
  | 'left'
  | 'none'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'top'

/** The direction of a scroll, from the change in its offsets. */
function getDirectionFromScrollDiff(diffX: number, diffY: number): Direction {
  if (diffX > 0 && diffY === 0) return 'right'
  if (diffX < 0 && diffY === 0) return 'left'
  if (diffX === 0 && diffY > 0) return 'bottom'
  if (diffX === 0 && diffY < 0) return 'top'
  if (diffX > 0 && diffY > 0) return 'bottom-right'
  if (diffX < 0 && diffY > 0) return 'bottom-left'
  if (diffX < 0 && diffY < 0) return 'top-left'
  if (diffX > 0 && diffY < 0) return 'top-right'
  return 'none'
}

/** The rectangle stretched by a scroll in `direction`. */
function calculateRectangleFromScrollDirection(
  start: Rectangle,
  direction: Direction,
  diff: Coordinate2D,
): Rectangle {
  switch (direction) {
    case 'left':
      return { ...start, right: start.right - diff.left }
    case 'right':
      return { ...start, left: start.left + diff.left }
    case 'top':
      return { ...start, bottom: start.bottom - diff.top }
    case 'bottom':
      return { ...start, top: start.top - diff.top }
    case 'bottom-left':
      return { ...start, right: start.right + diff.left, top: start.top - diff.top }
    case 'bottom-right':
      return { ...start, left: start.left - diff.left, top: start.top - diff.top }
    case 'top-left':
      return { ...start, right: start.right + diff.left, bottom: start.bottom - diff.top }
    case 'top-right':
      return { ...start, bottom: start.bottom - diff.top, left: start.left - diff.left }
    case 'none':
    default:
      return start
  }
}

/** The drag's start moved to the matching corner of the stretched rectangle. */
function calculateNewStartPositionFromScrollDirection(
  start: Coordinate2D,
  current: Coordinate2D,
  rectangle: Rectangle,
) {
  const cursorPositionInRectangle = (() => {
    if (start.left < current.left && start.top < current.top) return 'bottom-right'
    if (start.left > current.left && start.top > current.top) return 'top-left'
    if (start.left < current.left && start.top > current.top) return 'bottom-left'
    if (start.left > current.left && start.top < current.top) return 'top-right'
    return 'none'
  })()

  switch (cursorPositionInRectangle) {
    case 'top-left':
      return { top: rectangle.top, left: rectangle.left }
    case 'bottom-right':
      return { top: rectangle.bottom, left: rectangle.right }
    case 'top-right':
      return { top: rectangle.top, left: rectangle.right }
    case 'bottom-left':
      return { top: rectangle.bottom, left: rectangle.left }
    case 'none':
    default:
      return start
  }
}

/** A requestAnimationFrame slot that runs only the last callback scheduled for a frame. */
function rafThrottle() {
  let handle: number | null = null
  const callbacks = new Set<FrameRequestCallback>()
  return {
    schedule(callback: FrameRequestCallback) {
      if (handle != null) {
        cancelAnimationFrame(handle)
        handle = null
        callbacks.clear()
      }
      handle = requestAnimationFrame((time) => {
        const last = [...callbacks]
        for (const cb of last) cb(time)
        handle = null
        callbacks.clear()
      })
      callbacks.add(callback)
    },
    cancel() {
      if (handle != null) {
        cancelAnimationFrame(handle)
        handle = null
        callbacks.clear()
      }
    },
  }
}
</script>

<script setup lang="ts">
const props = defineProps<{
  target: MaybeRefOrGetter<HTMLElement | null | undefined>
  isDisabled?: boolean | undefined
  preventDrag?: ((event: PointerEvent) => boolean) | undefined
  onDragStart?: ((event: PointerEvent) => void) | undefined
  onDrag?: ((params: OnDragParams) => void) | undefined
  onDragEnd?: ((event: PointerEvent) => void) | undefined
  onDragCancel?: (() => void) | undefined
}>()

const isDragging = ref(false)
/** Whether the pointer has left the dead zone since the press. */
let hasPassedDeadZone = false
let startPosition: Coordinate2D | null = null
let previousPosition: Coordinate2D | null = null
let currentPosition: Coordinate2D = { left: 0, top: 0 }
let currentRectangle: DetailedRectangle | null = null
const scrollContainersLastScrollPosition = new Map<HTMLOrSVGElement, Coordinate2D>()

const box = ref<{ left: number; top: number; width: number; height: number } | null>(null)

const pointerFrame = rafThrottle()
const scrollFrame = rafThrottle()

function startDragging() {
  isDragging.value = true
  hasPassedDeadZone = true
  document.documentElement.style.userSelect = 'none'
}

function resetState() {
  isDragging.value = false
  pointerFrame.cancel()
  scrollFrame.cancel()
  hasPassedDeadZone = false
  startPosition = null
  currentPosition = { left: 0, top: 0 }
  previousPosition = null
  currentRectangle = null
  box.value = null
  document.documentElement.style.userSelect = ''
}

function updateBrush(rectangle: DetailedRectangle) {
  if (!isDragging.value) startDragging()
  box.value = {
    left: rectangle.left,
    top: rectangle.top,
    width: rectangle.width,
    height: rectangle.height,
  }
}

const targetElement = computed(() => toValue(props.target))

// While dragging, scrolling a container around the target stretches the rectangle with it.
watch(
  () => [isDragging.value, targetElement.value] as const,
  ([dragging, target], _old, onCleanup) => {
    if (!dragging) return
    const scrollContainers = findScrollContainers(target ?? null)
    const callback = (event: Event) => {
      const start = startPosition
      const current = currentPosition
      const rectangle = currentRectangle
      scrollFrame.schedule(() => {
        if (!(event.target instanceof HTMLElement) && !(event.target instanceof SVGElement)) return
        const scrolled = event.target
        if (!scrollContainers.includes(scrolled)) return
        // Without a start position or a current rectangle, the brush cannot be updated.
        if (rectangle == null || start == null) return
        const nextLeft = scrolled.scrollLeft
        const nextTop = scrolled.scrollTop
        const lastX = scrollContainersLastScrollPosition.get(scrolled)?.left ?? 0
        const lastY = scrollContainersLastScrollPosition.get(scrolled)?.top ?? 0
        const diffX = nextLeft - lastX
        const diffY = nextTop - lastY
        if (diffX === 0 && diffY === 0) return
        const direction = getDirectionFromScrollDiff(diffX, diffY)
        const nextRectangle = calculateRectangleFromScrollDirection(rectangle, direction, {
          left: diffX,
          top: diffY,
        })
        const detailedRectangle = getDetailedRectangleFromRectangle(nextRectangle)
        // The container scrolled, so the start of the drag moves to the matching corner.
        startPosition = calculateNewStartPositionFromScrollDirection(start, current, nextRectangle)
        currentRectangle = detailedRectangle
        updateBrush(detailedRectangle)
        scrollContainersLastScrollPosition.set(scrolled, { left: nextLeft, top: nextTop })
      })
    }
    for (const container of scrollContainers) {
      scrollContainersLastScrollPosition.set(container, {
        left: container.scrollLeft,
        top: container.scrollTop,
      })
      container.addEventListener('scroll', callback, { passive: true, capture: true })
    }
    onCleanup(() => {
      for (const container of scrollContainers) {
        container.removeEventListener('scroll', callback)
        scrollContainersLastScrollPosition.delete(container)
      }
    })
  },
)

useEventListener(
  targetElement,
  'pointerdown',
  (event: PointerEvent) => {
    if (props.isDisabled === true) return
    resetState()
    if (props.preventDrag?.(event) === true) return
    startPosition = { left: event.pageX, top: event.pageY }
    previousPosition = startPosition
    currentPosition = startPosition
    currentRectangle = getDetailedRectangle(startPosition, currentPosition)
    props.onDragStart?.(event)
  },
  { capture: true, passive: true },
)

useEventListener(
  document,
  'pointermove',
  (event: PointerEvent) => {
    if (props.isDisabled === true) return
    const start = startPosition
    const current = currentPosition
    const rectangle = currentRectangle
    const previous = previousPosition ?? start
    // Pointer events take precedence over scroll events.
    scrollFrame.cancel()
    pointerFrame.schedule(() => {
      if (start == null || rectangle == null || previous == null) return
      currentPosition = { left: event.pageX, top: event.pageY }
      // The dead zone is passed only once.
      if (!hasPassedDeadZone) hasPassedDeadZone = !isInDeadZone(start, current, DEAD_ZONE_SIZE)
      if (hasPassedDeadZone) {
        const diff: Coordinate2D = {
          left: current.left - previous.left,
          top: current.top - previous.top,
        }
        const detailedRectangle = getDetailedRectangle(start, current)
        // Capture the pointer, so that the whole selection stays with the target and nothing
        // else gets hover events while dragging.
        targetElement.value?.setPointerCapture(event.pointerId)
        currentRectangle = detailedRectangle
        previousPosition = { left: current.left, top: current.top }
        updateBrush(detailedRectangle)
        props.onDrag?.({ diff, start, current, rectangle: detailedRectangle, event })
      }
    })
  },
  { capture: true, passive: true },
)

useEventListener(
  document,
  'pointerup',
  (event: PointerEvent) => {
    if (props.isDisabled === true) return
    const wasDragging = isDragging.value
    resetState()
    releaseCapture(event.pointerId)
    if (wasDragging) props.onDragEnd?.(event)
  },
  { capture: true, passive: true },
)

useEventListener(
  document,
  'pointercancel',
  (event: PointerEvent) => {
    if (props.isDisabled === true) return
    const wasDragging = isDragging.value
    resetState()
    releaseCapture(event.pointerId)
    if (wasDragging) {
      props.onDragEnd?.(event)
      props.onDragCancel?.()
    }
  },
  { capture: true, passive: true },
)

/** Release the pointer capture, if the target holds it. */
function releaseCapture(pointerId: number) {
  const target = targetElement.value
  if (target?.hasPointerCapture(pointerId) === true) target.releasePointerCapture(pointerId)
}

onScopeDispose(() => {
  pointerFrame.cancel()
  scrollFrame.cancel()
  if (isDragging.value) document.documentElement.style.userSelect = ''
})

const brushStyle = computed(() => {
  const value = box.value
  return {
    ...(value == null ?
      {}
    : {
        left: `${value.left}px`,
        top: `${value.top}px`,
        width: `${value.width}px`,
        height: `${value.height}px`,
      }),
    opacity: isDragging.value ? 1 : 0,
  }
})
</script>

<template>
  <Teleport :to="portalTarget()">
    <div
      data-testid="selection-brush"
      :data-is-dragging="isDragging"
      class="pointer-events-none absolute before:absolute before:-inset-1 before:rounded-xl before:border-2 before:border-primary/5 before:bg-primary/5"
      :style="brushStyle"
    />
  </Teleport>
</template>
