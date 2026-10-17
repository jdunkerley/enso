<script setup lang="ts">
/**
 * @file The dialog shown while the hybrid projects upload, or the versioned local projects close,
 * as the desktop app exits. The user cannot
 * close it with the mouse; it goes when the upload ends.
 *
 * It is meant for the modal stack. It emits `close` once it has closed and its exit animation has
 * ended, which takes it off the stack.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { kind = 'sync' } = defineProps<{
  /** What the app is finishing as it exits: syncing hybrid projects, saving versions, or both. */
  kind?: 'sync' | 'versions' | 'both' | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const TEXTS = {
  sync: ['syncingProjectsTitle', 'syncingProjectsMessage'],
  versions: ['savingVersionsTitle', 'savingVersionsMessage'],
  both: ['syncingAndSavingTitle', 'syncingAndSavingMessage'],
} as const

const open = ref(true)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="getText(TEXTS[kind][0])"
    :isDismissable="false"
    hideCloseButton
    @closed="emit('close')"
  >
    <Text>{{ getText(TEXTS[kind][1]) }}</Text>
  </Dialog>
</template>
