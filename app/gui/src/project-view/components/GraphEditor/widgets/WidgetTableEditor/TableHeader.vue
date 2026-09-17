<script lang="ts">
import { AG_GRID_ENTERPRISE_AVAILABLE } from '@/components/shared/AgGridTableView/agGridLicense'
import GridPopupMenu from '@/components/shared/AgGridTableView/GridPopupMenu.vue'
import {
  resolveGridMenuItems,
  type GridMenuItem,
} from '@/components/shared/AgGridTableView/gridPopupMenuItems'
import SvgButton from '@/components/SvgButton.vue'
import type { IHeaderParams } from 'ag-grid-enterprise'
import { computed, ref, watch } from 'vue'

/**
 * Column-specific header parameters, set in particular column's definitions.
 */
export interface ColumnSpecificParams {
  columnParams:
    | {
        type: 'astColumn'
        /** Setter called when column name is changed by the user. */
        nameSetter: (newName: string) => void
      }
    | { type: 'newColumn'; enabled?: boolean; newColumnRequested: () => void }
    | { type: 'rowIndexColumn' }
}

/**
 * General header parameters, set in default column configuration.
 */
export interface HeaderParams {
  /** The id of column whose header is currently edited. */
  editedColId?: string | undefined
  /** Callback called when editing this column is requested. */
  onHeaderEditingStarted: (colId: string, revertChanges: () => void) => void
  /** Callback called when editing of this column should be finished. */
  onHeaderEditingStopped: (colId: string) => void
}
</script>

<script setup lang="ts">
const props = defineProps<IHeaderParams & HeaderParams & ColumnSpecificParams>()

const editing = computed(() => props.editedColId === props.column.getColId())
watch(editing, (newVal) => {
  if (!newVal) {
    acceptNewName()
  }
})

const inputElement = ref<HTMLInputElement>()

function emitEditStart() {
  props.onHeaderEditingStarted?.(props.column.getColId(), () => {
    if (inputElement.value) {
      inputElement.value.value = props.displayName
    }
  })
}

function emitEditEnd() {
  props.onHeaderEditingStopped?.(props.column.getColId())
}

watch(inputElement, (newVal) => {
  if (newVal != null) {
    // Whenever input field appears, put text, focus and select
    // We don't do that through props, because we don't want updates.
    newVal.value = props.displayName
    newVal.focus()
    newVal.select()
  }
})

function acceptNewName() {
  if (props.columnParams.type !== 'astColumn') {
    console.error("Tried to accept header new name where it's not editable!")
    return
  }
  if (inputElement.value == null) {
    console.error('Tried to accept header new name without input element!')
    return
  }
  if (inputElement.value.value !== props.displayName)
    props.columnParams.nameSetter(inputElement.value.value)
  if (editing.value) emitEditEnd()
}

function onMouseClick(event: MouseEvent) {
  if (!editing.value && props.columnParams.type === 'astColumn') {
    emitEditStart()
  } else {
    event.stopPropagation()
  }
}

const columnMenuState = ref<{
  point: { x: number; y: number }
  items: GridMenuItem[]
} | null>(null)

function closeColumnMenu() {
  columnMenuState.value = null
}

function onMouseRightClick(event: MouseEvent) {
  if (editing.value) return
  event.preventDefault()
  event.stopPropagation()
  if (AG_GRID_ENTERPRISE_AVAILABLE) {
    props.showColumnMenuAfterMouseClick(event)
    return
  }
  const colDef = props.column.getColDef()
  const rawMainMenuItems = colDef.mainMenuItems
  const rawItems =
    typeof rawMainMenuItems === 'function' ?
      rawMainMenuItems({
        api: props.api,
        context: props.context,
        column: props.column,
        defaultItems: [],
      })
    : (rawMainMenuItems ?? [])
  if (!rawItems.length) return
  columnMenuState.value = {
    point: { x: event.clientX, y: event.clientY },
    // `resolveGridMenuItems`'s parameter type narrows each item's `action` signature to the subset
    // of `IMenuActionParams` it actually invokes it with (`{ node, api }`) — see
    // `gridPopupMenuItems.ts`'s internal `RawMenuItem` type. A real AG Grid `MenuItemDef`'s `action`
    // is typed to expect the full `IMenuActionParams`, which `exactOptionalPropertyTypes` then flags
    // as a structural mismatch even though every actual action here only reads `node` and `api`
    // (see `commonContextMenuActions`). The cast documents that the narrower call is intentional and
    // safe for every item this codebase produces (same cast as `AgGridTableView.vue`'s
    // `resolveColumnOrGridContextMenuItems` caller, for the analogous `contextMenuItems` case).
    items: resolveGridMenuItems(rawItems as Parameters<typeof resolveGridMenuItems>[0], {
      api: props.api,
      column: props.column,
      node: null,
    }),
  }
}
</script>

<template>
  <SvgButton
    v-if="columnParams.type === 'newColumn'"
    class="addColumnButton"
    name="add"
    title="Add new column"
    :disabled="!(columnParams.enabled ?? true)"
    @activate="columnParams.newColumnRequested()"
  />
  <div
    v-else
    class="ag-cell-label-container"
    role="presentation"
    @pointerdown.stop
    @click="onMouseClick"
    @click.right="onMouseRightClick"
  >
    <div class="ag-header-cell-label" role="presentation">
      <input
        v-if="editing"
        ref="inputElement"
        class="ag-input-field-input ag-text-field-input"
        @keydown.arrow-left.stop
        @keydown.arrow-right.stop
        @keydown.arrow-up.stop
        @keydown.arrow-down.stop
        @keydown.tab.prevent="{
          // We prevent default, because switching edit on tab is handled by the widget edit
          // handlers
        }"
      />
      <span
        v-else
        class="ag-header-cell-text"
        :class="{ virtualColumn: columnParams.type !== 'astColumn' }"
        >{{ displayName }}</span
      >
    </div>
  </div>
  <GridPopupMenu
    v-if="columnMenuState"
    :items="columnMenuState.items"
    :point="columnMenuState.point"
    @close="closeColumnMenu"
  />
</template>

<style scoped>
.addColumnButton {
  margin-left: 10px;
}

.virtualColumn {
  color: rgba(0, 0, 0, 0.5);
}
</style>
