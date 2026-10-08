<script setup lang="ts">
/**
 * @file A modal asking "Are you sure you want to …?" before a deletion.
 *
 * It is meant for the modal stack, and opens as it mounts:
 *
 * ```ts
 * await useModals().ask(ConfirmDeleteModal, { actionText: …, onConfirm: deleteIt })
 * ```
 *
 * It emits `close` once it has closed and its exit animation has ended, which takes it off the
 * stack.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const {
  alert,
  cannotUndo = false,
  actionText,
  actionButtonLabel = 'Delete',
  onConfirm,
  onCancel,
} = defineProps<{
  alert?: string | undefined
  cannotUndo?: boolean | undefined
  /** Must fit in the sentence "Are you sure you want to <action>?". */
  actionText: string
  /** The label shown on the colored confirmation button. "Delete" by default. */
  actionButtonLabel?: string | undefined
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="getText('areYouSure')"
    :confirm="actionButtonLabel"
    isDestructive
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    @closed="emit('close')"
  >
    <Text class="relative">{{ getText('confirmPrompt', actionText) }}</Text>
    <Alert v-if="alert != null" variant="outline" icon="warning">{{ alert }}</Alert>
    <Alert v-if="cannotUndo" variant="outline" icon="warning">
      {{ getText('thisOperationCannotBeUndone') }}
    </Alert>
  </AlertDialog>
</template>
