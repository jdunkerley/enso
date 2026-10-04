<script setup lang="ts">
/**
 * @file The end of a credential form: "Create" (or "Update"), an optional Cancel, and the form's
 * error. The Vue port of the React `CredentialsFormFooter`.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import FormError from '$/components/Form/FormError.vue'
import Reset from '$/components/Form/Reset.vue'
import Submit from '$/components/Form/Submit.vue'
import { useText } from '$/providers/text'

const { isCreating, canCancel, canReset } = defineProps<{
  isCreating: boolean
  /** Whether Cancel closes the enclosing dialog. */
  canCancel: boolean
  /** Whether Cancel resets the form. */
  canReset: boolean
}>()

const { getText } = useText()
</script>

<template>
  <ButtonGroup class="mt-2">
    <Submit>{{ isCreating ? getText('create') : getText('update') }}</Submit>
    <DialogClose v-if="canCancel" variant="outline">{{ getText('cancel') }}</DialogClose>
    <Reset v-if="canReset">{{ getText('cancel') }}</Reset>
  </ButtonGroup>

  <FormError />
</template>
