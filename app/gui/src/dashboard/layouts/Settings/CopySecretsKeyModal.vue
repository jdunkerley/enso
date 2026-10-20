<script setup lang="ts">
/**
 * @file The question asked before "Copy secrets key": a plain confirm, not a destructive one, that
 * shows why the key matters (`secretsCopyKeyWarning`) before anything reaches the clipboard.
 *
 * It is meant for the modal stack (`useModals().ask`), and emits `close` once it has closed and its
 * exit animation has ended, which takes it off the stack.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { onConfirm, onCancel } = defineProps<{
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
    :title="getText('secretsCopyKey')"
    :confirm="getText('secretsCopyKey')"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    @closed="emit('close')"
  >
    <Text>{{ getText('confirmPrompt', getText('secretsCopyKeyActionText')) }}</Text>
    <Alert variant="outline" icon="warning">{{ getText('secretsCopyKeyWarning') }}</Alert>
  </AlertDialog>
</template>
