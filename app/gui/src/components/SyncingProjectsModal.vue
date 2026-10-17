<script setup lang="ts">
/**
 * @file The dialog shown while the hybrid projects upload as the desktop app exits. The user cannot
 * close it with the mouse; it goes when the upload ends.
 *
 * It is meant for the modal stack. It emits `close` once it has closed and its exit animation has
 * ended, which takes it off the stack.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="getText('syncingProjectsTitle')"
    :isDismissable="false"
    hideCloseButton
    @closed="emit('close')"
  >
    <Text>{{ getText('syncingProjectsMessage') }}</Text>
  </Dialog>
</template>
