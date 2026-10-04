<script setup lang="ts">
/**
 * @file A datalink's configuration in the Properties tab: the datalink editor in a form, with
 * "Update" and "Reset" once it is changed (and the user may edit the datalink). The Vue port of the
 * datalink section's form in the React `AssetProperties`.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Reset from '$/components/Form/Reset.vue'
import Submit from '$/components/Form/Submit.vue'
import { useText } from '$/providers/text'
import { validateDatalink } from '$/utils/datalinkValidator'
import DatalinkFormInput from '../datalinks/DatalinkFormInput.vue'

const { datalink, canEdit, onSubmit } = defineProps<{
  datalink: unknown
  /** Whether the user may change the datalink. Otherwise the editor is read-only. */
  canEdit: boolean
  onSubmit: (datalink: unknown) => Promise<void>
}>()

const { getText } = useText()
</script>

<template>
  <Form
    v-slot="{ form }"
    :schema="(z) => z.object({ datalink: z.custom((x) => validateDatalink(x)) })"
    :defaultValues="{ datalink }"
    class="w-full bg-white"
    @submit="(values) => onSubmit(values.datalink)"
  >
    <DatalinkFormInput name="datalink" :readOnly="!canEdit" :dropdownTitle="getText('type')" />

    <ButtonGroup v-if="canEdit && form.formState.isDirty">
      <Submit>{{ getText('update') }}</Submit>
      <Reset />
    </ButtonGroup>
    <FormError />
  </Form>
</template>
