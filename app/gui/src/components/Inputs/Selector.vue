<script setup lang="ts" generic="T">
/**
 * @file A horizontal selector of one item, bound to a form field, styled by `SELECTOR_STYLES` and
 * `SELECTOR_OPTION_STYLES`. The options are native radios in a `role="radiogroup"`, so arrow keys
 * move the selection. The field holds the item itself; `toLabel` names each (default `String`).
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { valuesEqual } from '$/components/Form/values'
import type { FIELD_STYLES } from '$/components/Form/variants'
import { SELECTOR_STYLES } from '$/components/Inputs/selectorVariants'
import type { ExtractFunction, VariantProps } from '$/utils/style/tailwindVariants'
import { computed, useAttrs } from 'vue'
import SelectorOption from './SelectorOption.vue'

type SelectorVariants = VariantProps<typeof SELECTOR_STYLES>

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    items: readonly T[]
    /** The text of each item. */
    toLabel?: ((item: T) => string) | undefined
    columns?: number | undefined
    defaultValue?: T | undefined
    label?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    isInvalid?: boolean | undefined
    readOnly?: boolean | undefined
    size?: SelectorVariants['size']
    rounded?: SelectorVariants['rounded']
    variant?: SelectorVariants['variant']
    fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { toLabel: String, readOnly: undefined },
)

const labelOf = (item: T) => (props.toLabel ?? String)(item)

const field = useField<T | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const disabled = computed(() => field.isDisabled.value || field.isSubmitting.value)
const classes = computed(() =>
  SELECTOR_STYLES({
    size: props.size,
    rounded: props.rounded,
    readOnly: props.readOnly,
    disabled: disabled.value,
    variant: props.variant,
  }),
)

const attrs = useAttrs()
const ariaLabel = computed(() => (attrs['aria-label'] as string | undefined) ?? props.label ?? '')

function select(item: T) {
  if (props.readOnly === true) return
  field.onChange(item)
}
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :fullWidth="true"
    :variants="fieldVariants"
    :ids="field.ids"
    :testId="testId"
    :class="props.class"
  >
    <div :class="classes.base()">
      <div
        role="radiogroup"
        :class="classes.radioGroup()"
        :style="{ gridTemplateColumns: `repeat(${columns ?? items.length}, 1fr)` }"
        :aria-label="ariaLabel"
        :aria-invalid="isInvalid || field.isInvalid.value || undefined"
        :aria-required="field.isRequired.value || undefined"
        :aria-disabled="disabled || undefined"
        :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
      >
        <SelectorOption
          v-for="(item, i) in items"
          :key="i"
          :name="name"
          :value="String(i)"
          :label="labelOf(item)"
          :isSelected="valuesEqual(item, field.value.value)"
          :isDisabled="disabled"
          :size="size"
          :rounded="rounded"
          :variant="variant"
          @select="select(item)"
          @blur="field.onBlur"
        />
      </div>
    </div>
  </Field>
</template>
