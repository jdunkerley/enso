<script setup lang="ts">
/**
 * @file A text input bound to a form field: a `BasicInput.vue` in a `Field.vue`, styled by
 * `INPUT_STYLES` and `FIELD_STYLES`.
 *
 * `name` picks the field of the enclosing `Form.vue` (or of `form`). The value, error, required
 * state and dirty/touched state come from the form. `type="number"` stores a number
 * and `type="date"` a `Date`, and the input is disabled while the form submits.
 *
 * The `<input>` carries the accessibility state: `aria-invalid`, `aria-describedby` (the
 * description and the error) and `aria-errormessage`. Attributes go on it too; `testId` goes on
 * the field, and the input is `data-testid="input"`.
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import type { FIELD_STYLES } from '$/components/Form/variants'
import type { INPUT_STYLES } from '$/components/Inputs/variants'
import type { ExtractFunction, VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed, ref } from 'vue'
import BasicInput from './BasicInput.vue'

type InputVariants = VariantProps<typeof INPUT_STYLES>

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    type?: string | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    placeholder?: string | undefined
    icon?: IconName | undefined
    defaultValue?: unknown
    isRequired?: boolean | undefined
    isDisabled?: boolean | undefined
    isInvalid?: boolean | undefined
    readOnly?: boolean | undefined
    hidden?: boolean | undefined
    autoFocus?: boolean | 'select' | undefined
    size?: InputVariants['size']
    rounded?: InputVariants['rounded']
    variant?: InputVariants['variant']
    variants?: ExtractFunction<typeof INPUT_STYLES> | undefined
    /** A `FIELD_STYLES` extension for the field. */
    fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
    fieldClass?: string | undefined
    /** Overrides the field's error message under the input; `null` shows none. */
    error?: string | null | undefined
    testId?: string | undefined
    /** Classes for the `<input>`. */
    class?: string | undefined
  }>(),
  {
    type: 'text',
    // `undefined`, not the `false` Vue casts an absent boolean prop to: "not set, use the form's".
    isRequired: undefined,
    isDisabled: undefined,
    isInvalid: undefined,
    readOnly: undefined,
    hidden: undefined,
    autoFocus: undefined,
    error: undefined,
  },
)

const basicInput = ref<InstanceType<typeof BasicInput>>()

const field = useField<unknown>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
  isInvalid: () => props.isInvalid,
  focus: () => basicInput.value?.focus(),
})

const disabled = computed(() => field.isDisabled.value || field.isSubmitting.value)

const inputValue = computed(() => {
  const value = field.value.value
  if (value instanceof Date) return value.toISOString().slice(0, 'yyyy-mm-dd'.length)
  return typeof value === 'number' || typeof value === 'string' ? value : ''
})

function setValue(value: string | number | null | undefined) {
  if (typeof value !== 'string') {
    field.onChange(value)
  } else if (props.type === 'number') {
    field.onChange(Number(value))
  } else if (props.type === 'date') {
    field.onChange(new Date(value))
  } else {
    field.onChange(value)
  }
}

const describedBy = computed(
  () =>
    [
      props.description != null ? field.ids.descriptionId : null,
      field.error.value != null ? field.ids.errorId : null,
    ]
      .filter((id) => id != null)
      .join(' ') || undefined,
)
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :isHidden="hidden"
    :fullWidth="true"
    :variants="fieldVariants"
    :ids="field.ids"
    :error="error"
    :testId="testId"
    :class="fieldClass"
  >
    <template v-if="$slots.contextualHelp" #contextualHelp><slot name="contextualHelp" /></template>
    <BasicInput
      ref="basicInput"
      v-bind="$attrs"
      :modelValue="inputValue"
      :type="type"
      :name="name"
      :placeholder="placeholder"
      :icon="icon"
      :size="size"
      :rounded="rounded"
      :variant="variant"
      :variants="variants"
      :isInvalid="field.isInvalid.value"
      :isDisabled="disabled"
      :readOnly="readOnly"
      :required="field.isRequired.value"
      :description="description"
      :descriptionId="field.ids.descriptionId"
      :autoFocus="autoFocus"
      :aria-describedby="describedBy"
      :aria-errormessage="field.error.value != null ? field.ids.errorId : undefined"
      :class="props.class"
      @update:modelValue="setValue"
      @blur="field.onBlur"
    >
      <template v-if="$slots.addonStart" #addonStart><slot name="addonStart" /></template>
      <template v-if="$slots.addonEnd" #addonEnd><slot name="addonEnd" /></template>
      <template v-if="$slots.icon" #icon><slot name="icon" /></template>
    </BasicInput>
  </Field>
</template>
