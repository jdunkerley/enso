<script setup lang="ts" generic="T">
/**
 * @file A horizontal selector of several items, bound to a form field holding the selected items:
 * the Vue counterpart of the React `MultiSelector`, styled by the same `MULTI_SELECTOR_STYLES` and
 * `MULTI_SELECTOR_OPTION_STYLES`. A Reka `Listbox` (`role="listbox"`, `aria-multiselectable`):
 * arrow keys move between options, Space and Enter toggle one. `toLabel` names each item (React's
 * `children`, default `String`).
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { valuesEqual } from '$/components/Form/values'
import {
  MULTI_SELECTOR_OPTION_STYLES,
  MULTI_SELECTOR_OPTION_VUE_STATES,
  MULTI_SELECTOR_STYLES,
} from '$/components/Inputs/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui'
import { computed, useAttrs } from 'vue'

type MultiSelectorVariants = VariantProps<typeof MULTI_SELECTOR_STYLES>

const OPTION_VARIANTS = {
  outline: 'default',
  'separate-outline': 'outline',
} as const

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    items: readonly T[]
    /** The text of each item. React's `children`. */
    toLabel?: ((item: T) => string) | undefined
    columns?: number | undefined
    defaultValue?: readonly T[] | undefined
    label?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    readOnly?: boolean | undefined
    size?: MultiSelectorVariants['size']
    rounded?: MultiSelectorVariants['rounded']
    variant?: MultiSelectorVariants['variant']
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { toLabel: String, readOnly: undefined },
)

const attrs = useAttrs()

const labelOf = (item: T) => (props.toLabel ?? String)(item)

const field = useField<readonly T[] | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
})

const disabled = computed(() => field.isDisabled.value || field.isSubmitting.value)
const classes = computed(() =>
  MULTI_SELECTOR_STYLES({
    size: props.size,
    rounded: props.rounded,
    readOnly: props.readOnly,
    disabled: disabled.value,
    variant: props.variant,
  }),
)
const optionVariant = computed(() => OPTION_VARIANTS[props.variant ?? 'outline'])

/** Reka works in indices, so that items need not be strings. */
const selectedIndices = computed({
  get: () =>
    (field.value.value ?? [])
      .map((value) => props.items.findIndex((item) => valuesEqual(item, value)))
      .filter((i) => i >= 0),
  set: (indices: number[]) => {
    if (props.readOnly === true) return
    field.onChange(props.items.filter((_, i) => indices.includes(i)))
  },
})
const ariaLabel = computed(() => (attrs['aria-label'] as string | undefined) ?? props.label ?? '')
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :label="label"
    :contextualHelp="contextualHelp"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :fullWidth="true"
    :ids="field.ids"
    :testId="testId"
    :class="props.class"
  >
    <div :class="classes.base()">
      <ListboxRoot
        v-model="selectedIndices"
        multiple
        selectionBehavior="toggle"
        orientation="horizontal"
        :disabled="disabled"
      >
        <ListboxContent
          :class="classes.listBox()"
          :style="{ gridTemplateColumns: `repeat(${columns ?? items.length}, 1fr)` }"
          :aria-label="ariaLabel"
          :aria-invalid="field.isInvalid.value || undefined"
          :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
          @focusout="field.onBlur"
        >
          <ListboxItem
            v-for="(item, i) in items"
            :key="i"
            :value="i"
            :class="`${MULTI_SELECTOR_OPTION_STYLES({ variant: optionVariant })} ${MULTI_SELECTOR_OPTION_VUE_STATES}`"
          >
            {{ labelOf(item) }}
          </ListboxItem>
        </ListboxContent>
      </ListboxRoot>
    </div>
  </Field>
</template>
