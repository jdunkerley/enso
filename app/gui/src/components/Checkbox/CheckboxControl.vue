<script setup lang="ts">
/**
 * @file The box, check mark and text of a checkbox: a native `<input type="checkbox">`, visually
 * hidden inside a `<label>`, as react-aria renders it, so that it keeps the native keyboard
 * (Space) and form semantics. `Checkbox.vue` binds it to a form or a group; use that instead.
 */
import { CHECKBOX_STYLES, CHECKBOX_VUE_STATES } from '$/components/Checkbox/variants'
import Text from '$/components/Text/Text.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed, ref, useId, useSlots } from 'vue'
import Check from './Check.vue'

type CheckboxVariants = VariantProps<typeof CHECKBOX_STYLES>

defineOptions({ inheritAttrs: false })

const {
  isSelected,
  isIndeterminate = false,
  isDisabled = false,
  isReadOnly = false,
  isInvalid = false,
  isRequired = false,
  name,
  value,
  size,
  testId,
  class: className,
} = defineProps<{
  isSelected: boolean
  isIndeterminate?: boolean | undefined
  isDisabled?: boolean | undefined
  isReadOnly?: boolean | undefined
  isInvalid?: boolean | undefined
  isRequired?: boolean | undefined
  name?: string | undefined
  value?: string | undefined
  size?: CheckboxVariants['size']
  testId?: string | undefined
  class?: string | undefined
}>()

const emit = defineEmits<{ change: [selected: boolean]; blur: [] }>()

const input = ref<HTMLInputElement>()
const slots = useSlots()
/**
 * The input is named by its own text, as react-aria names it. A checkbox in a labelled
 * `CheckboxGroup` sits inside its field's `<label>` too, which would otherwise name the group's
 * first checkbox by the whole group's text.
 */
const textId = useId()

const classes = computed(() =>
  CHECKBOX_STYLES({ isReadOnly, isInvalid, isDisabled, size, isSelected }),
)

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (isReadOnly || isDisabled) {
    target.checked = isSelected
    return
  }
  emit('change', target.checked)
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <label
    :class="classes.base({ className, isSelected })"
    :data-selected="isSelected || undefined"
    :data-disabled="isDisabled || undefined"
    :data-invalid="isInvalid || undefined"
    :data-testid="testId"
  >
    <input
      ref="input"
      v-bind="$attrs"
      type="checkbox"
      class="sr-only"
      :checked="isSelected"
      :indeterminate="isIndeterminate"
      :disabled="isDisabled"
      :required="isRequired"
      :aria-readonly="isReadOnly || undefined"
      :aria-invalid="isInvalid || undefined"
      :aria-labelledby="slots.default != null ? textId : undefined"
      :name="name"
      :value="value"
      @change="onChange"
      @blur="emit('blur')"
    />
    <Check
      :color="isInvalid ? 'error' : 'primary'"
      :isSelected="isSelected"
      :isIndeterminate="isIndeterminate"
      :class="`${classes.icon({ isSelected })} ${CHECKBOX_VUE_STATES}`"
    />
    <Text :id="textId" variant="body" color="current"><slot /></Text>
  </label>
</template>
