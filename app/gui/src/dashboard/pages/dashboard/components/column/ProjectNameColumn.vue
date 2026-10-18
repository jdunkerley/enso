<script setup lang="ts">
/**
 * @file The name cell of a project: its state button (`ProjectIcon.vue`) and its name, which turns
 * into a form while it is renamed. A double click opens the project, when the user may run it.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import ProjectIcon from '#/pages/dashboard/components/ProjectIcon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useContainerData } from '$/providers/container'
import { isDoubleClick } from '$/utils/event'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { ProjectAsset } from 'enso-common/src/services/Backend'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { computed } from 'vue'
import { useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: ProjectAsset
  isEditable: boolean
}>()

const container = useContainerData()
const driveView = useDriveView()
const backend = computed(() => driveView.location.backend)
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)

const canExecute = computed(() => isEditable)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && isOnMacOS() && event.key === 'Enter') event.stopPropagation()
}

function onClick(event: MouseEvent) {
  if (isEditingName.value) {
    // The project should not be opened while it is being renamed.
  } else if (isDoubleClick(event) && canExecute.value) {
    container.openProjectLocally(item, backend.value.type)
  }
}
</script>

<template>
  <div
    class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
    @click="onClick"
  >
    <ProjectIcon :isDisabled="!canExecute" :backend="backend" :item="item" />
    <EditableSpan
      testId="asset-row-name"
      :text="item.title"
      :editable="isEditingName"
      :class="
        twMerge(
          'grow bg-transparent',
          canExecute && 'cursor-pointer',
          isEditingName && 'cursor-text',
        )
      "
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
    />
  </div>
</template>
