<script setup lang="ts">
/**
 * @file A settings entry that is a form. Save and Cancel appear once the form is edited (and only
 * when an input is editable); the form resets whenever the entry's value changes, for instance once
 * a saved change has been fetched back.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Reset from '$/components/Form/Reset.vue'
import Submit from '$/components/Form/Submit.vue'
import type { TSchema } from '$/components/Form/types'
import { useForm } from '$/components/Form/useForm'
import { settingsValue, type SettingsFormEntryData } from '$/configurations/settings'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { computed, watch } from 'vue'
import SettingsInput from './SettingsInput.vue'

const { data } = defineProps<{
  data: SettingsFormEntryData<any>
}>()

const context = useSettingsContext()
const { getText } = useText()

const value = computed(() => data.getValue(context.value))
const valueString = computed(() => JSON.stringify(value.value))

const form = useForm({
  // The entry's schema is a zod object, as every form's is; its static type is `ZodType<T>`.
  schema: (typeof data.schema === 'function' ? data.schema(context.value) : data.schema) as TSchema,
  defaultValues: () => value.value,
  onSubmit: (newValue) => data.onSubmit(context.value, newValue),
})

watch(valueString, () => form.reset())

const isVisible = computed(() => data.getVisible?.(context.value) ?? true)
const isEditable = computed(() =>
  data.inputs.some((input) => settingsValue(input.editable ?? true, context.value)),
)
</script>

<template>
  <Form v-if="isVisible" :form="form">
    <SettingsInput v-for="input in data.inputs" :key="input.name" :data="input" />
    <ButtonGroup v-if="isEditable && form.formState.isDirty">
      <Submit>{{ getText('save') }}</Submit>
      <Reset>{{ getText('cancel') }}</Reset>
    </ButtonGroup>
    <FormError />
  </Form>
</template>
