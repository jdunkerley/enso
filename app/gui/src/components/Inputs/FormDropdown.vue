<script setup lang="ts" generic="T">
/**
 * @file A `Dropdown.vue` bound to a form field holding the selected item. Items are matched to the
 * value structurally. The default slot renders each item (`{ item }`).
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { valuesEqual } from '$/components/Form/values'
import type { FIELD_STYLES } from '$/components/Form/variants'
import type { DROPDOWN_STYLES } from '$/components/Inputs/dropdownVariants'
import type { ExtractFunction, VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'
import Dropdown from './Dropdown.vue'

type DropdownVariants = VariantProps<typeof DROPDOWN_STYLES>

const props = defineProps<{
  name: string
  form?: AnyFormInstance | undefined
  items: readonly T[]
  defaultValue?: T | undefined
  label?: string | undefined
  description?: string | undefined
  contextualHelp?: string | undefined
  isDisabled?: boolean | undefined
  isRequired?: boolean | undefined
  readOnly?: boolean | undefined
  rounded?: DropdownVariants['rounded']
  size?: DropdownVariants['size']
  fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

defineSlots<{ default: (props: { item: T }) => unknown }>()

const field = useField<T | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const selectedIndex = computed({
  get: () => {
    const index = props.items.findIndex((item) => valuesEqual(item, field.value.value))
    return index === -1 ? null : index
  },
  set: (index: number | null) => {
    if (index != null) field.onChange(props.items[index])
  },
})
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :variants="fieldVariants"
    :ids="field.ids"
    :testId="testId"
  >
    <Dropdown
      v-model:selectedIndex="selectedIndex"
      :items="items"
      :readOnly="readOnly || field.isDisabled.value"
      :rounded="rounded"
      :size="size"
      :ariaLabel="label"
      :class="props.class"
      @focusout="field.onBlur"
    >
      <template #default="{ item }"><slot :item="item" /></template>
    </Dropdown>
  </Field>
</template>
