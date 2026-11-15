<script setup lang="ts">
/**
 * @file The question asked before Enso edits Claude Desktop's configuration file. It is meant for
 * the modal stack (`useModals().ask`) and emits `close` once it has closed and its exit animation
 * has ended. Unlike `ConfirmDeleteModal` it is not styled as destructive: nothing is deleted.
 */
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { ref } from 'vue'

const { title, message, confirm, onConfirm, onCancel } = defineProps<{
  title: string
  message: string
  /** The confirm button's label. */
  confirm: string
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const open = ref(true)
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="title"
    :confirm="confirm"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    @closed="emit('close')"
  >
    <Text>{{ message }}</Text>
  </AlertDialog>
</template>
