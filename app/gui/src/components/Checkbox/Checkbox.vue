<script setup lang="ts">
/**
 * @file A checkbox, styled by `CHECKBOX_STYLES` and `CHECK_CLASSES`. The label text is the default
 * slot.
 *
 * It works in one of three ways:
 * - inside a `CheckboxGroup.vue`, it toggles its `value` in the group's field;
 * - with a `name`, it is a boolean form field, in a `Field` (label, description, error);
 * - with neither, it is a plain `v-model:isSelected` checkbox.
 *
 * `testId` goes on the `<label>`; attributes go on the native `<input>`.
 */
import type { CHECKBOX_STYLES } from '$/components/Checkbox/variants'
import Field from '$/components/Form/Field.vue'
import type { AnyFormInstance } from '$/components/Form/types'
import { useField } from '$/components/Form/useField'
import type { FIELD_STYLES } from '$/components/Form/variants'
import type { ExtractFunction, VariantProps } from '$/utils/style/tailwindVariants'
import { computed, ref } from 'vue'
import CheckboxControl from './CheckboxControl.vue'
import { injectCheckboxGroup } from './checkboxGroup'

type CheckboxVariants = VariantProps<typeof CHECKBOX_STYLES>

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** The field, for a checkbox bound to a form on its own. */
    name?: string | undefined
    form?: AnyFormInstance | undefined
    /** The value it adds to its `CheckboxGroup`'s field. */
    value?: string | undefined
    defaultValue?: boolean | undefined
    label?: string | undefined
    description?: string | undefined
    contextualHelp?: string | undefined
    isDisabled?: boolean | undefined
    isIndeterminate?: boolean | undefined
    isReadOnly?: boolean | undefined
    isInvalid?: boolean | undefined
    isRequired?: boolean | undefined
    size?: CheckboxVariants['size']
    fieldVariants?: ExtractFunction<typeof FIELD_STYLES> | undefined
    testId?: string | undefined
    class?: string | undefined
  }>(),
  {
    // `undefined`, not the `false` Vue casts an absent boolean prop to: "not set".
    defaultValue: undefined,
    isDisabled: undefined,
    isIndeterminate: undefined,
    isReadOnly: undefined,
    isInvalid: undefined,
    isRequired: undefined,
  },
)

/** The standalone `v-model:isSelected`. */
const isSelectedModel = defineModel<boolean>('isSelected', { default: false })

const control = ref<InstanceType<typeof CheckboxControl>>()
const group = injectCheckboxGroup(true)

// Only a checkbox bound to a form on its own has a field; a group's checkboxes share the group's.
const field =
  group == null && props.name != null ?
    useField<boolean | undefined>({
      name: () => props.name ?? '',
      form: () => props.form,
      defaultValue: props.defaultValue,
      isDisabled: () => props.isDisabled,
      isRequired: () => props.isRequired,
      isInvalid: () => props.isInvalid,
      focus: () => control.value?.focus(),
    })
  : undefined

const selectedState = computed(() => {
  if (group != null) return props.value != null && group.selected.value.includes(props.value)
  if (field != null) return field.value.value === true
  return isSelectedModel.value
})
const invalidState = computed(
  () => props.isInvalid ?? group?.isInvalid.value ?? field?.isInvalid.value ?? false,
)
const disabledState = computed(
  () => (props.isDisabled ?? false) || (group?.isDisabled.value ?? false),
)
const readOnlyState = computed(
  () => (props.isReadOnly ?? false) || (group?.isReadOnly.value ?? false),
)
const requiredState = computed(() => group?.isRequired.value ?? field?.isRequired.value ?? false)
const errorId = computed(() =>
  field != null && field.error.value != null ? field.ids.errorId : undefined,
)

function onChange(selected: boolean) {
  if (group != null) {
    if (props.value != null) group.toggle(props.value, selected)
  } else if (field != null) {
    field.onChange(selected)
    // A checkbox is validated on every change.
    void field.form.trigger(field.name.value)
  } else {
    isSelectedModel.value = selected
  }
}

function onBlur() {
  if (group != null) group.onBlur()
  else field?.onBlur()
}
</script>

<template>
  <Field
    v-if="field != null"
    :name="field.name.value"
    :form="field.form"
    :label="label"
    :description="description"
    :contextualHelp="contextualHelp"
    :isInvalid="invalidState"
    :isRequired="requiredState"
    :variants="fieldVariants"
    :ids="field.ids"
  >
    <CheckboxControl
      ref="control"
      v-bind="$attrs"
      :isSelected="selectedState"
      :isIndeterminate="isIndeterminate"
      :isDisabled="disabledState"
      :isReadOnly="readOnlyState"
      :isInvalid="invalidState"
      :isRequired="requiredState"
      :name="field.name.value"
      :size="size"
      :testId="testId"
      :class="props.class"
      :aria-describedby="errorId"
      :aria-errormessage="errorId"
      @change="onChange"
      @blur="onBlur"
    >
      <slot />
    </CheckboxControl>
  </Field>
  <CheckboxControl
    v-else
    ref="control"
    v-bind="$attrs"
    :isSelected="selectedState"
    :isIndeterminate="isIndeterminate"
    :isDisabled="disabledState"
    :isReadOnly="readOnlyState"
    :isInvalid="invalidState"
    :isRequired="requiredState"
    :name="group?.name"
    :value="value"
    :size="size"
    :testId="testId"
    :class="props.class"
    @change="onChange"
    @blur="onBlur"
  >
    <slot />
  </CheckboxControl>
</template>
