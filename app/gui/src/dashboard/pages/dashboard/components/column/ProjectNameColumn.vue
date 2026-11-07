<script setup lang="ts">
/**
 * @file The name cell of a project: its state button (`ProjectIcon.vue`) and its name, which turns
 * into a form while it is renamed, then an "Update available" pill on an edited bundled sample
 * whose bundle changed, a button that updates it after a confirmation (disabled while the project
 * is open). A double click opens the project, when the user may run it.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import {
  isOpenOrOpening,
  useConfirmedSampleUpdates,
  useSampleWithUpdate,
} from '#/layouts/Drive/samples'
import ProjectIcon from '#/pages/dashboard/components/ProjectIcon.vue'
import Badge from '$/components/Badge/Badge.vue'
import Button from '$/components/Button/Button.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useContainerData } from '$/providers/container'
import { useText } from '$/providers/text'
import { isDoubleClick } from '$/utils/event'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { ProjectAsset } from 'enso-common/src/services/Backend'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import { computed } from 'vue'
import { useNameCell } from './nameColumn'

const { item } = defineProps<{
  item: ProjectAsset
}>()

const container = useContainerData()
const driveView = useDriveView()
const backend = computed(() => driveView.location.backend)
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(() => item)
const { getText } = useText()
const sampleWithUpdate = useSampleWithUpdate(() => item)
const { confirmUpdateSample } = useConfirmedSampleUpdates()
const isOpen = computed(() => isOpenOrOpening(item))

function updateSample() {
  if (sampleWithUpdate.value == null || isOpen.value) return
  return confirmUpdateSample(sampleWithUpdate.value)
}

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && isOnMacOS() && event.key === 'Enter') event.stopPropagation()
}

function onClick(event: MouseEvent) {
  if (isEditingName.value) {
    // The project should not be opened while it is being renamed.
  } else if (isDoubleClick(event)) {
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
    <ProjectIcon :isDisabled="false" :backend="backend" :item="item" />
    <EditableSpan
      testId="asset-row-name"
      :text="item.title"
      :editable="isEditingName"
      :class="twMerge('grow bg-transparent', 'cursor-pointer', isEditingName && 'cursor-text')"
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
    />
    <Button
      v-if="sampleWithUpdate != null && !isEditingName"
      variant="custom"
      size="custom"
      rounded="full"
      class="flex-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      testId="sample-update-badge"
      :aria-label="getText('updateSampleLabel', sampleWithUpdate.name)"
      :isDisabled="isOpen"
      :tooltip="
        isOpen ? getText('updateSampleOpenTooltip') : getText('sampleUpdateAvailableDescription')
      "
      v-bind="STOP_PRESS_PROPAGATION"
      @press="updateSample"
    >
      <Badge
        variant="outline"
        color="accent"
        size="small"
        icon="refresh"
        class="transition-colors group-hover:bg-hover-bg"
      >
        {{ getText('sampleUpdateAvailable') }}
      </Badge>
    </Button>
  </div>
</template>
