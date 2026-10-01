<script setup lang="ts">
/**
 * @file A switch bound to a boolean form field: the Vue counterpart of the React
 * `#/components/Switch`, styled by the same `SWITCH_STYLES`. A native checkbox with
 * `role="switch"`, visually hidden inside a `<label>`, as react-aria renders it, so Space toggles
 * it. The label is `label` or the `label` slot, before or after the track (`labelPosition`).
 */
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import { SWITCH_STYLES, SWITCH_VUE_STATES } from '$/components/Switch/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed, ref } from 'vue'

type SwitchVariants = VariantProps<typeof SWITCH_STYLES>

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    name: string
    form?: AnyFormInstance | undefined
    defaultValue?: boolean | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    /** Overrides the field's error. */
    error?: string | null | undefined
    isDisabled?: boolean | undefined
    isRequired?: boolean | undefined
    /** Shows the thumb half-way, for a mixed state. */
    halfway?: boolean | undefined
    labelPosition?: 'after' | 'before' | undefined
    size?: SwitchVariants['size']
    testId?: string | undefined
    class?: string | undefined
  }>(),
  { defaultValue: undefined, error: undefined, labelPosition: 'after' },
)

const input = ref<HTMLInputElement>()

const field = useField<boolean | undefined>({
  name: () => props.name,
  form: () => props.form,
  defaultValue: props.defaultValue,
  isDisabled: () => props.isDisabled,
  isRequired: () => props.isRequired,
  focus: () => input.value?.focus(),
})

const isSelected = computed(() => field.value.value === true)
const styles = computed(() =>
  SWITCH_STYLES({ size: props.size, disabled: field.isDisabled.value, halfway: props.halfway }),
)
</script>

<template>
  <Field
    :name="name"
    :form="field.form"
    :class="styles.base({ className: props.class })"
    :fullWidth="true"
    :description="description"
    :contextualHelp="contextualHelp"
    :error="error"
    :isRequired="field.isRequired.value"
    :isInvalid="field.isInvalid.value"
    :ids="field.ids"
    :testId="testId"
  >
    <label :class="styles.switch()" :data-selected="isSelected">
      <input
        ref="input"
        v-bind="$attrs"
        type="checkbox"
        role="switch"
        class="sr-only"
        :name="name"
        :checked="isSelected"
        :disabled="field.isDisabled.value"
        :required="field.isRequired.value"
        :aria-invalid="field.isInvalid.value || undefined"
        :aria-describedby="field.error.value != null ? field.ids.errorId : undefined"
        @change="field.onChange(($event.target as HTMLInputElement).checked)"
        @blur="field.onBlur"
      />
      <div v-if="labelPosition === 'before'" :class="styles.label()">
        <slot name="label">{{ label }}</slot>
      </div>

      <div :class="`${styles.background()} ${SWITCH_VUE_STATES.background}`" role="presentation">
        <span :class="`${styles.thumb()} ${SWITCH_VUE_STATES.thumb}`" />
      </div>

      <div v-if="labelPosition === 'after'" :class="styles.label()">
        <slot name="label">{{ label }}</slot>
      </div>
    </label>
  </Field>
</template>
