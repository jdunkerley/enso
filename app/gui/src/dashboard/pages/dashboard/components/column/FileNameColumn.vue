<script setup lang="ts">
/**
 * @file The name cell of a file: its type's icon, and its name, which turns into a form while it is
 * renamed. The Vue port of React's `FileNameColumn`.
 */
import Icon from '$/components/Icon/Icon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { fileIcon } from '$/utils/fileIcon'
import type { FileAsset } from 'enso-common/src/services/Backend'
import { useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: FileAsset
  isEditable: boolean
}>()

const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && event.key === 'Enter') event.stopPropagation()
}
</script>

<template>
  <div
    class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
  >
    <Icon :icon="fileIcon(item.title)" class="m-name-column-icon" />
    <EditableSpan
      testId="asset-row-name"
      :text="item.title"
      :editable="isEditingName"
      class="grow bg-transparent"
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
    />
  </div>
</template>
