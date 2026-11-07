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
 * two seconds open it. Like a row, it is reached with the arrow keys and can be the grid's tab stop.
 */
import { ASSET_ROWS } from '#/layouts/Drive/drag'
import { useTabStopContents } from '#/layouts/Drive/rovingTabStop'
import { Column, COLUMN_CSS_CLASS } from '#/pages/dashboard/components/column/columnUtils'
import Icon from '$/components/Icon/Icon.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import { useDragDelayAction } from '$/composables/dragDelay'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import { onMounted, onUpdated, ref, watch } from 'vue'

const props = defineProps<{
  columns: readonly Column[]
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

/** Accept dragged rows (none of them can be the parent folder) and files. */
function acceptDrag(event: DragEvent) {
  if (ASSET_ROWS.lookup(event) != null || event.dataTransfer?.types.includes('Files') === true) {
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
  if (
    event.relatedTarget instanceof Node &&
    event.currentTarget instanceof Node &&
    !event.currentTarget.contains(event.relatedTarget)
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
    @dragend="isDraggedOver = false"
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

<style src="./driveRowFocusRing.css" />
