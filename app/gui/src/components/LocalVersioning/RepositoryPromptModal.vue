<script setup lang="ts">
/**
 * @file The question asked before a local project's first version is kept: create a repository at
 * the local root ("create"), or use the existing repository the projects are in ("use"). Its three
 * answers are Create (or Use), Not now, and Don't ask again (for this folder).
 *
 * It is meant for the modal stack's `ask`: confirming resolves `'confirm'`, the other two
 * `'dismiss'`, and "Don't ask again" first calls `onDontAskAgain`. It emits `close` once it has
 * closed and its exit animation has ended, which takes it off the stack.
 */
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Button from '$/components/Button/Button.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { kind, folder, onDontAskAgain, onConfirm, onCancel } = defineProps<{
  kind: 'create' | 'use'
  folder: string
  onDontAskAgain: () => void
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)

function dontAskAgain(cancel: () => void) {
  onDontAskAgain()
  cancel()
}
</script>

<template>
  <AlertDialog
    v-model:open="open"
    :title="getText(kind === 'create' ? 'versioningCreateTitle' : 'versioningUseTitle')"
    :confirm="getText(kind === 'create' ? 'versioningCreate' : 'versioningUse')"
    :cancel="getText('versioningNotNow')"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    testId="repository-prompt"
    @closed="emit('close')"
  >
    <template #default="{ cancel }">
      <Text>
        {{
          getText(kind === 'create' ? 'versioningCreateMessage' : 'versioningUseMessage', folder)
        }}
      </Text>
      <Button
        variant="link"
        size="small"
        testId="repository-prompt-dont-ask-again"
        @press="dontAskAgain(cancel)"
      >
        {{
          getText(kind === 'create' ? 'versioningDontAskAgainForFolder' : 'versioningDontAskAgain')
        }}
      </Button>
    </template>
  </AlertDialog>
</template>
