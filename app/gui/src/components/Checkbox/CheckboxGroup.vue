<script setup lang="ts">
/**
 * @file A group of checkboxes bound to one form field holding the selected values: the Vue
 * counterpart of the React `Checkbox.Group`, styled by the same `CHECKBOX_GROUP_STYLES`. The
 * checkboxes are the default slot, each with its `value`. It is a `role="group"` labelled by its
 * field's label or, without one, by its content (the checkboxes' text), as in React. The `description` slot replaces the `description` text, for a description with
 * markup (React's `ReactNode` description).
 */
import { CHECKBOX_GROUP_STYLES } from '$/components/Checkbox/variants'
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import type { FIELD_STYLES } from '$/components/Form/variants'
import type { ExtractFunction } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'
import { provideCheckboxGroup } from './checkboxGroup'

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    defaultValue?: readonly string[] | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    isInvalid?: boolean | undefined
    isReadOnly?: boolean | undefined
    fullWidth?: boolean | undefined
    fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  {
    // `undefined`, not the `false` Vue casts an absent boolean prop to: "not set".
    isInvalid: undefined,
  },
)

const field = useField<readonly string[] | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
  isInvalid: () => props.isInvalid,
})

const selected = computed(() => field.value.value ?? [])

provideCheckboxGroup({
  name: props.name,
  selected,
  isDisabled: computed(() => props.isDisabled),
  isInvalid: field.isInvalid,
  isReadOnly: computed(() => props.isReadOnly),
  isRequired: computed(() => props.isRequired),
  toggle: (value, isSelected) => {
    const current = selected.value
    const next =
      isSelected ?
        current.includes(value) ?
          current
        : [...current, value]
      : current.filter((v) => v !== value)
    field.onChange(next)
    // React validates the group on every change.
    void field.form.trigger(field.name.value)
  },
  onBlur: field.onBlur,
})
</script>

<template>
  <div
    role="group"
    :class="CHECKBOX_GROUP_STYLES({ fullWidth, className: props.class })"
    :aria-labelledby="field.ids.labelId"
    :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
    :data-testid="testId"
    :data-invalid="field.isInvalid.value || undefined"
    :data-disabled="isDisabled || undefined"
  >
    <Field
      :name="name"
      :form="field.form"
      :label="label"
      :description="description"
      :contextualHelp="contextualHelp"
      :isRequired="isRequired"
      :fullWidth="fullWidth"
      :isInvalid="field.isInvalid.value"
      :variants="fieldVariants"
      :ids="field.ids"
      class="w-full"
    >
      <template v-if="$slots.description" #description><slot name="description" /></template>
      <slot />
    </Field>
  </div>
</template>
