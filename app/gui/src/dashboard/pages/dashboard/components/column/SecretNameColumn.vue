<script setup lang="ts">
/**
 * @file The name cell of a secret: its icon, and its name, which turns into a form while it is
 * renamed.
 */
import Icon from '$/components/Icon/Icon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import type { SecretAsset } from 'enso-common/src/services/Backend'
import { useNameCell } from './nameColumn'

const { item } = defineProps<{
  item: SecretAsset
}>()

const { isEditingName, setIsEditing, doRename, schema } = useNameCell(() => item)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && event.key === 'Enter') event.stopPropagation()
}
</script>

<template>
  <div
    class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
  >
    <Icon icon="key" class="m-name-column-icon size-4" />
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
