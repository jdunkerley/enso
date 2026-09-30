<script setup lang="ts">
/**
 * @file A radio group bound to a string form field: the Vue counterpart of the React `Radio.Group`,
 * styled by the same `RADIO_GROUP_STYLES`. The radios are the default slot. It is a
 * `role="radiogroup"` labelled by its field's label; the radios are native, so arrow keys move the
 * selection as the browser does.
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import type { FIELD_STYLES } from '$/components/Form/variants'
import { RADIO_GROUP_STYLES } from '$/components/Radio/variants'
import type { ExtractFunction } from '$/utils/style/tailwindVariants'
import { computed, ref } from 'vue'
import { provideRadioGroup } from './radioGroup'

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    defaultValue?: string | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    isInvalid?: boolean | undefined
    isReadOnly?: boolean | undefined
    // `undefined`, not the `false` Vue casts an absent boolean prop to, so the variant applies.
    fullWidth?: boolean | undefined
    fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { fullWidth: undefined },
)

const field = useField<string | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const invalid = computed(() => props.isInvalid || field.isInvalid.value)

provideRadioGroup({
  name: props.name,
  value: field.value,
  isDisabled: field.isDisabled,
  isInvalid: invalid,
  isReadOnly: computed(() => props.isReadOnly),
  isRequired: computed(() => props.isRequired),
  pressed: ref(null),
  select: (value) => field.onChange(value),
  onBlur: field.onBlur,
})
</script>

<template>
  <div
    role="radiogroup"
    :class="RADIO_GROUP_STYLES({ fullWidth, className: props.class })"
    :aria-labelledby="label != null ? field.ids.labelId : undefined"
    :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
    :aria-invalid="invalid || undefined"
    :aria-required="isRequired || undefined"
    :aria-disabled="field.isDisabled.value || undefined"
    :data-testid="testId"
  >
    <Field
      :name="name"
      :form="field.form"
      :label="label"
      :description="description"
      :contextualHelp="contextualHelp"
      :fullWidth="fullWidth"
      :isInvalid="invalid"
      :isRequired="isRequired"
      :variants="fieldVariants"
      :ids="field.ids"
    >
      <slot />
    </Field>
  </div>
</template>
