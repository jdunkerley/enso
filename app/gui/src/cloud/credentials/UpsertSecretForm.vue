<script setup lang="ts">
/**
 * @file The form creating or updating a cloud secret: the Vue counterpart of the React
 * `UpsertSecretForm` (`#/modals/UpsertSecretModal`), with the same fields, labels, buttons and
 * `data-testid="upsert-secret-modal"`.
 *
 * A new secret (no `secretId`) asks for a name and a value; an existing one only for a new value.
 * A successful submission emits `create` with the name and the value, and closes the enclosing
 * dialog, if any (`method="dialog"`).
 *
 * `cancel` adds a Cancel button: `'close'` closes the enclosing dialog, `'reset'` resets the
 * form, and `'emit'` emits `cancel` (React's `doCancel` callback).
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Reset from '$/components/Form/Reset.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import { useText } from '$/providers/text'
import type { SecretId } from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const { secretId, name, cancel } = defineProps<{
  secretId?: SecretId | null | undefined
  /** The secret's current name: the default for a new one, and what an existing one is called. */
  name?: string | null | undefined
  cancel?: 'close' | 'emit' | 'reset' | undefined
}>()

const emit = defineEmits<{
  create: [name: string, value: string]
  cancel: []
}>()

const { getText } = useText()

const isCreatingSecret = computed(() => secretId == null)
</script>

<template>
  <Form
    :schema="(z) => z.object({ title: z.string().min(1), value: z.string() })"
    :defaultValues="{ title: name ?? '', value: '' }"
    method="dialog"
    testId="upsert-secret-modal"
    class="w-full"
    @submit="({ title, value }) => emit('create', title, value)"
  >
    <Input
      v-if="isCreatingSecret"
      name="title"
      autoFocus
      autocomplete="off"
      :label="getText('name')"
      :placeholder="getText('secretNamePlaceholder')"
    />

    <Input
      name="value"
      type="password"
      autocomplete="off"
      :label="getText('value')"
      :placeholder="name == null ? getText('secretValuePlaceholder') : getText('secretValueHidden')"
    />

    <ButtonGroup class="mt-2">
      <Submit>{{ isCreatingSecret ? getText('create') : getText('update') }}</Submit>
      <Reset v-if="cancel === 'reset'">{{ getText('cancel') }}</Reset>
      <DialogClose v-else-if="cancel === 'close'">{{ getText('cancel') }}</DialogClose>
      <Button v-else-if="cancel === 'emit'" @press="emit('cancel')">
        {{ getText('cancel') }}
      </Button>
    </ButtonGroup>

    <FormError />
  </Form>
</template>
