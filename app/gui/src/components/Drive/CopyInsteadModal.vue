<script setup lang="ts">
/**
 * @file The question asked when assets cannot be moved or restored where they were dropped, but can
 * be copied there: from a team's folder to another team, to the user's own folder or to the local
 * drive (#14797), or restored from the trash into another team's folder. The Vue port of the React
 * prompt in `#/layouts/Drive/Categories/transferBetweenCategoriesHooks`, with the same title,
 * text, alert and buttons.
 *
 * It is meant for the modal stack (`askToCopyInstead`, `./copyInstead`). It emits `close` once it
 * has closed and its exit animation has ended, which takes it off the stack.
 */
import Alert from '$/components/Alert/Alert.vue'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { ref } from 'vue'

const { message, description, onConfirm, onCancel } = defineProps<{
  /** Why the operation is unavailable. */
  message: string
  /** What copying does instead, in the alert. */
  description: string
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
    :title="getText('actionUnavailable')"
    :confirm="getText('copyInstead')"
    :onConfirm="onConfirm"
    :onCancel="onCancel"
    @closed="emit('close')"
  >
    <Text>{{ message }}</Text>
    <Alert variant="outline" icon="copy">
      <Text>{{ description }}</Text>
    </Alert>
  </AlertDialog>
</template>
