<script setup lang="ts">
/**
 * @file The name cell of a directory: a button opening it, and its name, which turns into a form
 * while it is renamed. The button has the test id `directory-row-navigate-button` and shows a
 * spinner while the drive opens the directory.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import Button from '$/components/Button/Button.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useDriveLocation } from '$/providers/drive'
import { useText } from '$/providers/text'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { DirectoryAsset } from 'enso-common/src/services/Backend'
import { directoryNavigationSource, useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: DirectoryAsset
  isEditable: boolean
}>()

const { getText } = useText()
const drive = useDriveLocation()
const driveView = useDriveView()
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)

/** What opening this directory is, for the drive to show its spinner on this row's button. */
const navigationSource = directoryNavigationSource(item.id)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && event.key === 'Enter') event.stopPropagation()
}

function openDirectory() {
  driveView.navigate(navigationSource, () => {
    drive.currentDirectory = item.id
  })
}
</script>

<template>
  <div
    class="group flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
  >
    <Button
      icon="folder"
      variant="icon"
      :isLoading="driveView.isNavigatingFrom(navigationSource)"
      :aria-label="getText('open')"
      tooltipPlacement="left"
      testId="directory-row-navigate-button"
      class="mx-1 transition-transform duration-arrow"
      v-bind="STOP_PRESS_PROPAGATION"
      @press="openDirectory"
    />
    <EditableSpan
      testId="asset-row-name"
      :text="item.title"
      :editable="isEditingName"
      :class="
        twMerge('cursor-pointer bg-transparent', isEditingName ? 'cursor-text' : 'cursor-pointer')
      "
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
    />
  </div>
</template>
