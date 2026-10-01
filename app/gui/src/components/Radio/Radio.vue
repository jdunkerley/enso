<script setup lang="ts">
/**
 * @file A radio button in a `RadioGroup.vue`: the Vue counterpart of the React `Radio`, styled by
 * the same `RADIO_STYLES`. A native `<input type="radio">`, visually hidden inside a `<label>`,
 * as react-aria renders it. The hover, press and focus-visible states that react-aria computes are
 * tracked here the same way, so the classes match. The label is `label` or the default slot.
 */
import { RADIO_STYLES } from '$/components/Radio/variants'
import Text from '$/components/Text/Text.vue'
import { computed, ref } from 'vue'
import { injectRadioGroup } from './radioGroup'

defineOptions({ inheritAttrs: false })

const {
  value,
  label,
  isDisabled: isDisabledProp = false,
  testId,
  class: className,
} = defineProps<{
  value: string
  label?: string | undefined
  isDisabled?: boolean | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const group = injectRadioGroup()

const isHovered = ref(false)
const isPressed = ref(false)
const isFocused = ref(false)
const isFocusVisible = ref(false)

const isSelected = computed(() => group.value.value === value)
const isDisabled = computed(() => isDisabledProp || group.isDisabled.value)
const isInteractive = computed(() => !isDisabled.value && !group.isReadOnly.value)
const isSiblingPressed = computed(
  () => group.pressed.value != null && group.pressed.value !== value,
)

const classes = computed(() =>
  RADIO_STYLES({
    isSiblingPressed: isSiblingPressed.value,
    isFocused: isFocused.value,
    isFocusVisible: isFocusVisible.value,
    isHovered: isHovered.value,
    isSelected: isSelected.value,
    isInvalid: group.isInvalid.value,
    isDisabled: isDisabled.value,
    isPressed: isPressed.value,
    className,
  }),
)

function press(pressed: boolean) {
  if (pressed && !isInteractive.value) return
  isPressed.value = pressed
  group.pressed.value = pressed ? value : null
}

function onChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (group.isReadOnly.value) {
    target.checked = isSelected.value
    return
  }
  if (target.checked) group.select(value)
}

function onFocus(event: FocusEvent) {
  isFocused.value = true
  isFocusVisible.value = (event.target as HTMLElement).matches(':focus-visible')
}

function onBlur() {
  isFocused.value = false
  isFocusVisible.value = false
  group.onBlur()
}
</script>

<template>
  <label
    :class="classes.base()"
    :data-testid="testId"
    :data-selected="isSelected"
    @pointerenter="isHovered = isInteractive"
    @pointerleave="((isHovered = false), press(false))"
    @pointerdown="press(true)"
    @pointerup="press(false)"
  >
    <input
      v-bind="$attrs"
      type="radio"
      :class="classes.input()"
      :name="group.name"
      :value="value"
      :checked="isSelected"
      :disabled="isDisabled"
      :required="group.isRequired.value"
      :aria-invalid="group.isInvalid.value || undefined"
      @change="onChange"
      @focus="onFocus"
      @blur="onBlur"
    />
    <div :class="classes.radio()" />
    <Text :class="classes.label()" variant="body" truncate="1">
      <slot>{{ label }}</slot>
    </Text>
  </label>
</template>
