<script setup lang="ts">
/**
 * @file The handle on the right edge of a table column's heading that resizes the column: dragged,
 * with the arrow keys, or reset to the column's default width.
 */
import { COLUMN_RESIZE_HANDLE_STYLES } from '$/components/ColumnResizeHandle/variants'
import { clampWidth, widthForKey, type WidthLimits } from '$/utils/columnResize'
import { useResizeObserver } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'

const { label, width, limits } = defineProps<{
  /** The handle's accessible name, naming its column. */
  label: string
  /** The column's width in pixels, or `null` when it takes whatever space is left. */
  width: number | null
  limits: WidthLimits
}>()

const emit = defineEmits<{
  /** The column's new width, inside its limits: on each move of a drag, and on each key. */
  resize: [width: number]
  /** A drag, or a key, has finished resizing the column: the time to save its width. */
  resizeEnd: []
  /** The column should go back to its default width. */
  reset: []
}>()

const styles = COLUMN_RESIZE_HANDLE_STYLES()
const handle = ref<HTMLElement>()
/** The width the column is drawn at: the heading cell this handle sits in. */
const renderedWidth = ref<number | null>(null)
useResizeObserver(
  () => handle.value?.parentElement,
  () => {
    const cell = handle.value?.parentElement
    if (cell != null) renderedWidth.value = Math.round(cell.getBoundingClientRect().width)
  },
)

const currentWidth = computed(() => width ?? renderedWidth.value ?? limits.min)

/** The pointer dragging the handle, and where the drag started. */
const drag = shallowRef<{
  readonly pointerId: number
  readonly startX: number
  readonly startWidth: number
} | null>(null)

/**
 * Turn text selection off and keep the resize cursor over the whole page while a drag lasts, or
 * restore them.
 */
function setDragStyles(isDragging: boolean) {
  const style = document.documentElement.style
  style.userSelect = isDragging ? 'none' : ''
  style.cursor = isDragging ? 'col-resize' : ''
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  // No text selection. The press still reaches the document, so that open popovers and menus close
  // as for a press anywhere else; the table's selection brush skips it (`preventSelection`).
  event.preventDefault()
  try {
    handle.value?.setPointerCapture(event.pointerId)
  } catch {
    // The pointer is already gone; the drag ends with its `pointerup`, or the next press.
  }
  drag.value = { pointerId: event.pointerId, startX: event.clientX, startWidth: currentWidth.value }
  setDragStyles(true)
}

function onPointerMove(event: PointerEvent) {
  const current = drag.value
  if (current == null || current.pointerId !== event.pointerId) return
  emit('resize', clampWidth(current.startWidth + event.clientX - current.startX, limits))
}

function endDrag() {
  if (drag.value == null) return
  drag.value = null
  setDragStyles(false)
  emit('resizeEnd')
}

function onKeyDown(event: KeyboardEvent) {
  const result = widthForKey(event, currentWidth.value, limits)
  if (result == null) return
  // The table's own keys (arrows move the selection, Enter opens it) must not act too.
  event.preventDefault()
  event.stopPropagation()
  if (result === 'reset') {
    emit('reset')
  } else {
    emit('resize', result)
    emit('resizeEnd')
  }
}

onBeforeUnmount(endDrag)
</script>

<template>
  <div
    ref="handle"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="currentWidth"
    :aria-valuemin="limits.min"
    :aria-valuemax="limits.max"
    tabindex="0"
    data-column-resize-handle
    :data-dragging="drag != null || undefined"
    :class="styles.base()"
    @pointerdown="onPointerDown"
    @mousedown.prevent
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
    @click.stop
    @dblclick.stop="emit('reset')"
    @keydown="onKeyDown"
  >
    <div :class="styles.line()" />
  </div>
</template>
