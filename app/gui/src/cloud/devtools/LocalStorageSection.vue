<script setup lang="ts">
/**
 * @file The devtools' local storage section (#172): every registered `LocalStorage` key, with a
 * dialog editing its value as JSON (checked against the key's schema) and a button deleting it;
 * and, for the whole store, copying it to the clipboard, pasting it back, and deleting everything.
 * The Vue counterpart of the last section of React's `EnsoDevtools`.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import CopyButton from '$/components/Button/CopyButton.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Icon from '$/components/Icon/Icon.vue'
import Input from '$/components/Inputs/Input.vue'
import Text from '$/components/Text/Text.vue'
import Tooltip from '$/components/Tooltip/Tooltip.vue'
import VisualTooltip from '$/components/Tooltip/VisualTooltip.vue'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import LocalStorage, { type LocalStorageKey } from '$/utils/LocalStorage'
import { safeJsonParse } from '$/utils/safeJsonParse'
import { computed } from 'vue'
import { z } from 'zod'

const { getText } = useText()
const toasts = useToasts()
const storage = LocalStorage.getInstance()

/**
 * The values read so far: `values` is shallow-reactive, so a shallow copy follows every change
 * without traversing the values themselves (as React's `useLocalStorageValues` did).
 */
const values = computed<Partial<Record<LocalStorageKey, unknown>>>(() => ({
  ...storage['values'],
}))

const entries = LocalStorage.getAllRegisteredKeys().map((key) => ({
  key,
  title: key.replace(/[A-Z]/g, (m) => ' ' + m.toLowerCase()).replace(/^./, (m) => m.toUpperCase()),
  isUserSpecific: LocalStorage.getKeyMetadata(key).isUserSpecific === true,
}))

/** The edit dialog's schema: JSON text, parsed, which must match the key's own schema. */
function entrySchema(key: LocalStorageKey) {
  const schema: z.ZodType = LocalStorage.getKeyMetadata(key).schema
  return z.object({
    value: z
      .any()
      .transform((value: unknown) =>
        typeof value === 'string' ? safeJsonParse(value, null) : value,
      )
      .refine(
        (value) => schema.safeParse(value).success,
        'Invalid JSON or value does not match schema',
      ),
  })
}

function setEntry(key: LocalStorageKey, value: unknown) {
  // The schema checked the value.
  storage.setFromUntrustedSource(key, value)
}

async function pasteState() {
  const text = await window.navigator.clipboard.readText()
  storage.setManyFromUntrustedSource(safeJsonParse(text, null))
  toasts.show('State pasted', { type: 'success' })
}
</script>

<template>
  <div class="mb-2 flex w-full items-center justify-between gap-3">
    <Text variant="subtitle">{{ getText('localStorage') }}</Text>

    <Tooltip tooltip="Copy everything to clipboard">
      <CopyButton class="ml-auto" :copyText="JSON.stringify(values, null, 2)" />
    </Tooltip>

    <Tooltip tooltip="Paste state from clipboard">
      <Button variant="icon" size="small" icon="paste" @press="pasteState" />
    </Tooltip>

    <Button
      :aria-label="getText('deleteAll')"
      size="small"
      variant="icon"
      icon="trash"
      @press="storage.clearAll()"
    />
  </div>

  <div class="flex flex-col gap-1.5">
    <div
      v-for="entry in entries"
      :key="entry.key"
      class="flex w-full items-center justify-between gap-1"
      :data-testid="`devtools-local-storage-${entry.key}`"
    >
      <div class="flex items-center gap-1">
        <Text variant="body">{{ entry.title }}</Text>
        <VisualTooltip v-if="entry.isUserSpecific" tooltip="User specific storage item">
          <Icon icon="default_user" size="small" color="primary" />
        </VisualTooltip>
      </div>

      <ButtonGroup
        align="end"
        :buttonVariants="{ size: 'small', variant: 'icon', extraClickZone: 'small' }"
      >
        <Dialog :title="`Edit ${entry.title}`">
          <template #trigger>
            <Button aria-label="Edit" icon="edit" />
          </template>
          <Form
            method="dialog"
            :schema="entrySchema(entry.key)"
            :defaultValues="{ value: JSON.stringify(values[entry.key], null, 2) }"
            @submit="({ value }) => setEntry(entry.key, value)"
          >
            <Input name="value" label="Enter valid JSON">
              <template #addonStart><Icon icon="braces" /></template>
            </Input>
            <Submit />
            <FormError />
          </Form>
        </Dialog>

        <Button
          :isDisabled="values[entry.key] == null"
          :aria-label="getText('delete')"
          icon="close"
          @press="storage.delete(entry.key)"
        />
      </ButtonGroup>
    </div>
  </div>
</template>
