<script setup lang="ts">
/**
 * @file A row of the drive's table: the Vue port of React's `AssetRow`, with its `asset-row` test
 * id, `aria-selected` and `data-selected`.
 *
 * The row is the drag source of the selection and a drop target: dropped rows move into it (or its
 * parent, for a file), dropped files upload there, and assets held over a directory for two seconds
 * open it. A right click opens the asset's context menu, selecting the row first, unless the row is
 * part of a multiple selection, whose menu the table opens. A row the arrow keys moved to takes the
 * focus and is scrolled into view. A row being deleted, restored, renamed or moved (or cut) is
 * faded.
 */
import { ASSET_ROWS } from '#/layouts/Drive/drag'
import { useAssetItems } from '#/layouts/Drive/assetItems'
import { useDriveView } from '#/layouts/Drive/driveView'
import AssetColumnCell from '#/pages/dashboard/components/column/AssetColumnCell.vue'
import { COLUMN_CSS_CLASS, type Column } from '#/pages/dashboard/components/column/columnUtils'
import { directoryNavigationSource } from '#/pages/dashboard/components/column/nameColumn'
import { useDragDelayAction } from '$/composables/dragDelay'
import { isLocalCategory } from '$/providers/category'
import { useAuth } from '$/providers/auth'
import { useDriveLocation } from '$/providers/drive'
import { useDriveStore } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useOpenedProjects } from '$/providers/openedProjects'
import { isDoubleClick, isElementTextInput } from '$/utils/event'
import { twMerge } from '$/utils/style/tailwindMerge'
import Visibility from '$/utils/Visibility'
import {
  AssetType,
  IS_OPENING_OR_OPENED,
  type AnyAsset,
  type Label,
} from 'enso-common/src/services/Backend'
import {
  canPermissionModifyDirectoryContents,
  isTeamPath,
  tryFindSelfPermission,
} from 'enso-common/src/utilities/permissions'
import { computed, onMounted, onUpdated, ref, watch } from 'vue'

const props = defineProps<{
  item: AnyAsset
  columns: readonly Column[]
  labels: readonly Label[]
  isKeyboardSelected: boolean
  /** Whether a deletion of this asset is in flight. */
  isDeleting: boolean
  /** Whether a restoration of this asset from the trash is in flight. */
  isRestoring: boolean
  /** Whether a rename or move of this asset is in flight. */
  isUpdating: boolean
  grabKeyboardFocus: (item: AnyAsset) => void
  onRowClick: (item: AnyAsset, event: MouseEvent) => void
  select: (item: AnyAsset) => void
  onRowDragStart: (event: DragEvent, item: AnyAsset) => void
  onRowDragEnd: () => void
  onRowDrop: (event: DragEvent, item: AnyAsset) => void
  openContextMenu: (position: Pick<MouseEvent, 'pageX' | 'pageY'>) => void
}>()

const driveStore = useDriveStore()
const driveView = useDriveView()
const drive = useDriveLocation()
const assetItems = useAssetItems()
const auth = useAuth()
const modals = useModals()
const openedProjects = useOpenedProjects()

const category = computed(() => driveView.location.category)

const selection = computed(() => driveStore.visuallySelectedKeys ?? driveStore.selectedIds)
const isSelected = computed(() => selection.value.has(props.item.id))
const isMultiSelected = computed(() => selection.value.size > 1)
const isEditingName = computed(() => driveStore.assetToRename === props.item.id)
const isClosing = computed(
  () => props.item.type === AssetType.project && openedProjects.isProjectClosing(props.item.id),
)

const insertionVisibility = computed(() =>
  (
    driveStore.pasteData?.type === 'move' &&
    driveStore.pasteData.data.assets.some((asset) => asset.id === props.item.id)
  ) ?
    'opacity-50'
  : Visibility.visible,
)
const visibility = computed(() =>
  props.isDeleting || props.isRestoring || props.isUpdating ?
    'opacity-50'
  : insertionVisibility.value,
)

const root = ref<HTMLTableRowElement>()
const isDraggedOver = ref(false)

/**
 * Whether the row may be dragged: only while selected, and not while a text field in it has the
 * focus (a Firefox bug otherwise breaks selecting text there), as React's `useDraggable`.
 */
const isDraggable = ref(true)
function onFocusIn(event: FocusEvent) {
  if (isElementTextInput(event.target)) isDraggable.value = false
}
function onFocusOut() {
  isDraggable.value = true
}

function setSelected(newSelected: boolean) {
  const { selectedAssets } = driveStore.state
  driveStore.setSelectedAssets(
    newSelected ?
      [...selectedAssets, props.item]
    : selectedAssets.filter((otherAsset) => otherAsset.id !== props.item.id),
  )
}

// An asset being deleted or restored leaves the selection.
watch(
  () => isSelected.value && (props.isDeleting || props.isRestoring),
  (shouldDeselect) => {
    if (shouldDeselect) setSelected(false)
  },
  { immediate: true },
)

// A row the arrow keys moved to takes the keyboard focus.
watch(
  () => [props.isKeyboardSelected, props.item] as const,
  ([isKeyboardSelected]) => {
    if (isKeyboardSelected) {
      root.value?.focus()
      props.grabKeyboardFocus(props.item)
    }
  },
  { flush: 'post' },
)

/** As React's ref callback did on every render: keep the keyboard-selected row focused and shown. */
function focusIfKeyboardSelected() {
  const element = root.value
  if (props.isKeyboardSelected && element != null && !element.contains(document.activeElement)) {
    element.scrollIntoView({ block: 'nearest' })
    element.focus()
  }
}
onMounted(focusIfKeyboardSelected)
onUpdated(focusIfKeyboardSelected)

function openDirectory() {
  driveView.navigate(directoryNavigationSource(props.item.id), () => {
    drive.currentDirectory = props.item.id as never
  })
}

const dragDelay = useDragDelayAction(
  props.item.type === AssetType.directory ? openDirectory : undefined,
)

function onDragOverRow(event: DragEvent) {
  const item = props.item
  const directoryId = item.type === AssetType.directory ? item.id : item.parentId
  const payload = ASSET_ROWS.lookup(event)
  const isPayloadMatch =
    payload != null && payload.items.every((innerItem) => innerItem.key !== directoryId)
  const canPaste = (() => {
    if (!isPayloadMatch) return false
    if (isLocalCategory(category.value)) return true
    return payload.items.every(({ asset }) => {
      const payloadParentId = assetItems.getAsset(asset.id)?.parentId
      const parent = payloadParentId == null ? null : assetItems.getAsset(payloadParentId)
      // Assume the parent is the root directory.
      if (!parent) return true
      if (isTeamPath(parent.ensoPath)) return true
      // Assume a user path; check the permissions.
      const user = auth.session?.user
      const permission = user != null ? tryFindSelfPermission(user, item.permissions) : null
      return permission != null && canPermissionModifyDirectoryContents(permission.permission)
    })
  })()

  if ((isPayloadMatch && canPaste) || event.dataTransfer?.types.includes('Files') === true) {
    event.preventDefault()
    if (item.type === AssetType.directory && category.value.type !== 'trash') {
      isDraggedOver.value = true
    }
  }
}

function onDoubleClick() {
  if (props.item.type === AssetType.directory) openDirectory()
}

function onClick(event: MouseEvent) {
  modals.closeAll()
  props.onRowClick(props.item, event)
  if (props.item.type === AssetType.directory && isDoubleClick(event) && !isEditingName.value) {
    // On the next tick, or the default click handler overrides it.
    window.setTimeout(() => setSelected(false))
  }
}

function onContextMenu(event: MouseEvent) {
  // The table opens the menu of a multiple selection this row is part of.
  if (isSelected.value && isMultiSelected.value) return
  event.preventDefault()
  event.stopPropagation()
  if (!isSelected.value) props.select(props.item)
  driveStore.update({
    contextMenuData: {
      triggerRef: { current: root.value ?? null },
      initialContextMenuPosition: { pageX: event.pageX, pageY: event.pageY },
    },
  })
  props.openContextMenu(event)
}

function onDragStart(event: DragEvent) {
  const item = props.item
  if (isEditingName.value) event.preventDefault()
  if (
    item.type === AssetType.project &&
    (IS_OPENING_OR_OPENED[item.projectState.type] || isClosing.value)
  ) {
    event.preventDefault()
  }
  props.onRowDragStart(event, item)
}

function onDragEnter(event: DragEvent) {
  // Needed because `dragover` does not fire on entering.
  onDragOverRow(event)
  dragDelay.onDragEnter(event)
}

function onDragOver(event: DragEvent) {
  if (category.value.type === 'trash' && event.dataTransfer != null) {
    event.dataTransfer.dropEffect = 'none'
  }
  onDragOverRow(event)
}

function onDragEnd() {
  isDraggedOver.value = false
  props.onRowDragEnd()
}

function onDragLeave(event: DragEvent) {
  if (
    event.relatedTarget instanceof Node &&
    event.currentTarget instanceof Node &&
    !event.currentTarget.contains(event.relatedTarget)
  ) {
    isDraggedOver.value = false
    driveStore.setDragTargetAssetId(null)
  }
  dragDelay.onDragLeave(event)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  isDraggedOver.value = false
  dragDelay.onDrop(event)
  props.onRowDrop(event, props.item)
}
</script>

<template>
  <tr
    ref="root"
    data-testid="asset-row"
    tabindex="0"
    :data-selected="isSelected"
    :aria-selected="isSelected"
    :data-id="item.id"
    :class="
      twMerge(
        'h-table-row rounded-full transition-all ease-in-out rounded-rows-child',
        visibility,
        (isDraggedOver || isSelected) && 'selected',
      )
    "
    :draggable="isSelected ? isDraggable : false"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @dblclick="onDoubleClick"
    @click="onClick"
    @contextmenu="onContextMenu"
    @dragstart="onDragStart"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragend="onDragEnd"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <td v-for="column in columns" :key="column" :class="COLUMN_CSS_CLASS[column]">
      <AssetColumnCell
        :column="column"
        :item="item"
        :labels="labels"
        :isEditable="category.type !== 'trash'"
      />
    </td>
  </tr>
</template>
