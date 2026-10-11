<script setup lang="ts">
/**
 * @file The name cell of a datalink: its icon, and its name, which turns into a form while it is
 * renamed. A double click opens the asset panel's Properties tab. Its name, unlike the other
 * cells', has no `asset-row-name` test id (kept as it was).
 */
import Icon from '$/components/Icon/Icon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useRightPanelData } from '$/providers/rightPanel'
import { isDoubleClick } from '$/utils/event'
import type { DatalinkAsset } from 'enso-common/src/services/Backend'
import { useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: DatalinkAsset
  isEditable: boolean
}>()

const rightPanel = useRightPanelData()
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && event.key === 'Enter') event.stopPropagation()
}

function onClick(event: MouseEvent) {
  if (isDoubleClick(event)) {
    event.stopPropagation()
    rightPanel.setTemporaryTab('settings')
  }
}
</script>

<template>
  <div
    class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
    @click="onClick"
  >
    <Icon icon="connector" class="m-name-column-icon" />
    <EditableSpan
      :text="item.title"
      :editable="isEditingName"
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
      class="grow bg-transparent"
    />
  </div>
</template>
