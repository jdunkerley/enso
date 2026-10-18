<script setup lang="ts">
/**
 * @file The "Create Datalink" dialog: a name and the datalink editor.
 *
 * It is meant for the modal stack (`useModals().open`, as the Vue drive opens it), and opens as it
 * mounts; it emits `close` once it has closed and its exit animation has ended. An outside click
 * does not close it; Escape and Cancel do. The datalink starts as the schema's first
 * type with its defaults; `doCreate` gets the name and the datalink once the form is submitted with
 * a valid one.
 *
 * With `existing` it edits that datalink ("Edit Datalink", Save) and keeps the name, which is
 * read-only: renaming is the drive's name cell's (it keeps `.datalink` and checks uniqueness), and
 * a save that also moved the file could half-fail.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import { useText } from '$/providers/text'
import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }
import { validateDatalink } from '$/utils/datalinkValidator'
import { constantValueOfSchema } from '$/utils/jsonSchema'
import { ref } from 'vue'
import DatalinkFormInput from './DatalinkFormInput.vue'

const { doCreate, existing } = defineProps<{
  doCreate: (name: string, datalink: unknown) => Promise<void> | void
  /** The datalink to edit, if any. */
  existing?: { readonly name: string; readonly value: unknown } | undefined
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const DEFS: Record<string, object> = SCHEMA.$defs
const INITIAL_DATALINK_VALUE = constantValueOfSchema(DEFS, SCHEMA.$defs.DataLink, true)[0] ?? null

const { getText } = useText()
const open = ref(true)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="existing ? getText('editDatalink') : getText('createDatalink')"
    :isDismissable="false"
    @closed="emit('close')"
  >
    <Form
      method="dialog"
      :schema="
        (z) => z.object({ name: z.string().min(1), value: z.unknown().refine(validateDatalink) })
      "
      :defaultValues="{
        name: existing?.name ?? '',
        value: existing?.value ?? INITIAL_DATALINK_VALUE,
      }"
      @submit="({ name, value }) => doCreate(name, value)"
    >
      <Input
        name="name"
        :readOnly="existing != null"
        :autoFocus="existing == null"
        :label="getText('name')"
        :placeholder="getText('datalinkNamePlaceholder')"
      />

      <div class="relative w-full">
        <DatalinkFormInput name="value" :dropdownTitle="getText('type')" />
      </div>

      <ButtonGroup>
        <Submit>{{ existing ? getText('save') : getText('create') }}</Submit>
        <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
      </ButtonGroup>

      <FormError />
    </Form>
  </Dialog>
</template>
