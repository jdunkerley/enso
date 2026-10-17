<script setup lang="ts">
/**
 * @file The dialog creating or editing a cloud secret ("New Secret", "Edit Secret"), around
 * `UpsertSecretForm.vue`.
 *
 * It is meant for the modal stack (`useModals().open`), and opens as it mounts; it emits `close`
 * once it has closed and its exit animation has ended. An outside click does not close it; Escape
 * and Cancel do. `onCreate` gets the name and the value once the form is submitted.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import { useText } from '$/providers/text'
import type { SecretId } from 'enso-common/src/services/Backend'
import { ref } from 'vue'
import UpsertSecretForm from './UpsertSecretForm.vue'

const {
  secretId,
  name,
  canCancel = true,
  onCreate,
} = defineProps<{
  // `& string` names the runtime type for Vue's prop check, which cannot see through the brand.
  secretId?: (SecretId & string) | null | undefined
  /** The secret's current name, when editing one. */
  name?: string | null | undefined
  /** Whether to offer a Cancel button. Defaults to `true`. */
  canCancel?: boolean | undefined
  onCreate: (name: string, value: string) => unknown
}>()

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
    :title="secretId == null ? getText('newSecret') : getText('editSecret')"
    :isDismissable="false"
    @closed="emit('close')"
  >
    <UpsertSecretForm
      :secretId="secretId"
      :name="name"
      :cancel="canCancel ? 'close' : undefined"
      @create="(secretName, value) => onCreate(secretName, value)"
    />
  </Dialog>
</template>
