<script setup lang="ts">
/**
 * @file The name cell of a secret: its icon, and its name, which turns into a form while it is
 * renamed. A double click opens the secret dialog to change its value (a credential cannot be
 * edited there, and says so).
 */
import { useEditSecret } from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import Icon from '$/components/Icon/Icon.vue'
import EditableSpan from '$/components/EditableSpan/EditableSpan.vue'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { isDoubleClick } from '$/utils/event'
import { isAssetCredential, type SecretAsset } from 'enso-common/src/services/Backend'
import { useNameCell } from './nameColumn'

const { item, isEditable } = defineProps<{
  item: SecretAsset
  isEditable: boolean
}>()

const { getText } = useText()
const toasts = useToasts()
const driveView = useDriveView()
const { isEditingName, setIsEditing, doRename, schema } = useNameCell(
  () => item,
  () => isEditable,
)
const editSecret = useEditSecret(() => driveView.location.backend)

function onKeyDown(event: KeyboardEvent) {
  if (isEditingName.value && event.key === 'Enter') event.stopPropagation()
}

function onClick(event: MouseEvent) {
  if (!isDoubleClick(event) || !isEditable) return
  if (isAssetCredential(item)) {
    toasts.show(getText('cannotEditCredentialError'), { type: 'warning' })
  } else {
    event.stopPropagation()
    editSecret(item)
  }
}
</script>

<template>
  <div
    class="flex h-table-row w-auto min-w-48 max-w-full items-center gap-name-column-icon whitespace-nowrap rounded-l-full px-name-column-x py-name-column-y rounded-rows-child"
    @keydown="onKeyDown"
    @click="onClick"
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
