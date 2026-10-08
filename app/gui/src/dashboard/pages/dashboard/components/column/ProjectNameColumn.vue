<script setup lang="ts">
/**
 * @file The name cell of a project: its state button (`ProjectIcon.vue`) and its name, which turns
 * into a form while it is renamed. A double click opens the project, when the user may run it and
 * nobody else is using it.
 */
import { useDriveView } from '#/layouts/Drive/driveView'
import ProjectIcon, { CLOSED_PROJECT_STATE } from '#/pages/dashboard/components/ProjectIcon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useAuth } from '$/providers/auth'
import { useContainerData } from '$/providers/container'
import { isDoubleClick } from '$/utils/event'
import { twMerge } from '$/utils/style/tailwindMerge'
import { BackendType, type ProjectAsset } from 'enso-common/src/services/Backend'
import { isOnMacOS } from 'enso-common/src/utilities/detect'
import {
  PERMISSION_ACTION_CAN_EXECUTE,
  tryFindSelfPermission,
} from 'enso-common/src/utilities/permissions'
import { computed } from 'vue'
import { useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: ProjectAsset
  isEditable: boolean
}>()

const auth = useAuth()
const container = useContainerData()
const driveView = useDriveView()
const backend = computed(() => driveView.location.backend)
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)

const user = computed(() => auth.session?.user)
const ownPermission = computed(() =>
  user.value != null ? tryFindSelfPermission(user.value, item.permissions) : null,
)
// A workaround for a temporary bad state in the backend, in which `projectState` is absent.
const projectState = computed(() => item.projectState ?? CLOSED_PROJECT_STATE)
const canExecute = computed(
  () =>
    isEditable &&
    (backend.value.type === BackendType.local ||
      (ownPermission.value != null &&
        PERMISSION_ACTION_CAN_EXECUTE[ownPermission.value.permission])),
)
const isOtherUserUsingProject = computed(
  () =>
    backend.value.type === BackendType.remote &&
    projectState.value.openedBy != null &&
    projectState.value.openedBy !== user.value?.email,
)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && isOnMacOS() && event.key === 'Enter') event.stopPropagation()
}

function onClick(event: MouseEvent) {
  if (isEditingName.value || isOtherUserUsingProject.value) {
    // The project should neither be edited nor opened in these cases.
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
          canExecute && !isOtherUserUsingProject && 'cursor-pointer',
          isEditingName && 'cursor-text',
        )
      "
      :schema="schema"
      :onSubmit="doRename"
      :onCancel="() => setIsEditing(false)"
    />
  </div>
</template>
