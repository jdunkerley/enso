<script setup lang="ts">
/**
 * @file The parent-folder entry of the drive's table (#640, `#/layouts/Drive/parentEntry.ts`): the
 * `..` row shown first inside a folder below its category's root, with the test id
 * `parent-directory-row`. A double click opens the folder above (Enter does too, through the
 * table's keyboard handling), and while that is pending its icon is a spinner.
 *
 * It is not an asset: it is never selected (and so has no `aria-selected`), has no context menu,
 * cannot be dragged, and its other cells are empty. It is a drop target like a directory's row:
 * dropped rows move into the parent folder, dropped files upload there, and assets held over it for
 * two seconds open it. The entry stays mounted when that opens a folder that has an entry of its
 * own, so a drag still held over it climbs on, one level every two seconds, until the category's
 * root, where the entry is gone. Its highlight clears when the drag ends anywhere (Escape, a drop
 * elsewhere, leaving the window). Like a row, it is reached with the arrow keys and can be the
 * grid's tab stop.
 */
import { ASSET_ROWS, canDropRowsInto } from '#/layouts/Drive/drag'
import { useTabStopContents } from '#/layouts/Drive/rovingTabStop'
import { Column, COLUMN_CSS_CLASS } from '#/pages/dashboard/components/column/columnUtils'
import Icon from '$/components/Icon/Icon.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import { useDragDelayAction } from '$/composables/dragDelay'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { useEventListener } from '@vueuse/core'
import type { DirectoryId } from 'enso-common/src/services/Backend'
import { onMounted, onUpdated, ref, watch } from 'vue'

const props = defineProps<{
  columns: readonly Column[]
  /** The folder the entry opens; it changes when the drive moves to another folder. */
  targetId: DirectoryId
  /** Whether the arrow keys moved to the entry, so that it takes the focus. */
  isKeyboardSelected: boolean
  /** Whether the entry is the grid's one tab stop. */
  isTabStop: boolean
  /** Whether opening the parent folder from the entry is pending. */
  isOpening: boolean
  /** Focus has entered the entry. */
  onEntryFocus: () => void
  /** A click on the entry. */
  onEntryClick: (event: MouseEvent) => void
  /** Open the parent folder. */
  open: () => void
  /** Assets or files were dropped on the entry. */
  onEntryDrop: (event: DragEvent) => void
}>()

const { getText } = useText()
const modals = useModals()

const root = ref<HTMLTableRowElement>()
useTabStopContents(root, () => props.isTabStop)
const isDraggedOver = ref(false)

// The arrow keys moved to the entry: it takes the keyboard focus.
watch(
  () => props.isKeyboardSelected,
  (isKeyboardSelected) => {
    if (isKeyboardSelected) root.value?.focus()
  },
  { flush: 'post' },
)

/** On mount and on every update: keep the entry focused and shown while the keyboard is on it. */
function focusIfKeyboardSelected() {
  const element = root.value
  if (props.isKeyboardSelected && element != null && !element.contains(document.activeElement)) {
    element.scrollIntoView({ block: 'nearest' })
    element.focus()
  }
}
onMounted(focusIfKeyboardSelected)
onUpdated(focusIfKeyboardSelected)

const dragDelay = useDragDelayAction(() => props.open())

/** Forget a drag over the entry: no highlight, no pending open. */
function endDrag() {
  isDraggedOver.value = false
  dragDelay.cancel()
}

// Holding a drag over the entry opened the folder above, and the entry (still under the pointer)
// now opens the next one up: start the delay again, so that holding on keeps climbing.
watch(
  () => props.targetId,
  () => {
    if (isDraggedOver.value) dragDelay.restart()
  },
)

// `dragend` fires only on the drag's source, and `dragleave` may not come at all (a drag cancelled
// with Escape over the entry): any drag ending anywhere ends this one.
useEventListener(document, 'dragend', endDrag, { capture: true })
useEventListener(document, 'drop', endDrag, { capture: true })

/**
 * Accept dragged rows and files. Rows are refused when the folder above is one of them or inside
 * one (the drag may have opened the dragged folder and gone on into it).
 */
function acceptDrag(event: DragEvent) {
  const payload = ASSET_ROWS.lookup(event)
  if (
    (payload != null && canDropRowsInto(payload, props.targetId)) ||
    event.dataTransfer?.types.includes('Files') === true
  ) {
    event.preventDefault()
    isDraggedOver.value = true
  }
}

function onDragEnter(event: DragEvent) {
  // Needed because `dragover` does not fire on entering.
  acceptDrag(event)
  dragDelay.onDragEnter(event)
}

function onDragLeave(event: DragEvent) {
  // No `relatedTarget`: the drag left the window.
  if (
    !(event.relatedTarget instanceof Node) ||
    (event.currentTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
  ) {
    isDraggedOver.value = false
  }
  dragDelay.onDragLeave(event)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  isDraggedOver.value = false
  dragDelay.onDrop(event)
  props.onEntryDrop(event)
}

function onClick(event: MouseEvent) {
  modals.closeAll()
  props.onEntryClick(event)
}

/** The entry has no context menu, and the table's must not open either. */
function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}
</script>

<template>
  <tr
    ref="root"
    data-testid="parent-directory-row"
    :tabindex="isTabStop ? 0 : -1"
    aria-rowindex="2"
    :class="
      twMerge(
        'DriveRow h-table-row rounded-full transition-all ease-in-out rounded-rows-child',
        isDraggedOver && 'selected',
      )
    "
    :draggable="false"
    @focusin="onEntryFocus()"
    @dblclick="open()"
    @click="onClick"
    @contextmenu="onContextMenu"
    @dragenter="onDragEnter"
    @dragover="acceptDrag"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <td v-for="column in columns" :key="column" :class="COLUMN_CSS_CLASS[column]">
      <div
        v-if="column === Column.name"
        class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
        :title="getText('parentFolder')"
      >
        <StatelessSpinner
          v-if="isOpening"
          :size="16"
          phase="loading-medium"
          class="m-name-column-icon"
        />
        <Icon v-else icon="navigate_up" class="m-name-column-icon" />
        <span aria-hidden="true" data-testid="parent-directory-row-name">
          {{ getText('parentFolderEntryName') }}
        </span>
        <span class="sr-only">{{ getText('parentFolder') }}</span>
      </div>
    </td>
  </tr>
</template>

<style scoped src="./driveRowFocusRing.css" />
