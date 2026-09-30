<script setup lang="ts">
/**
 * @file One option of a `Selector.vue`: the Vue counterpart of the React `SelectorOption`, styled
 * by the same `SELECTOR_OPTION_STYLES`. A native radio, visually hidden inside a `<label>`, with the
 * hover, press and focus-visible states react-aria computes tracked here the same way.
 */
import { SELECTOR_OPTION_STYLES } from '$/components/Inputs/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed, ref } from 'vue'

type OptionVariants = VariantProps<typeof SELECTOR_OPTION_STYLES>

const {
  label,
  value,
  name,
  isSelected,
  isDisabled = false,
  size,
  rounded,
  variant,
} = defineProps<{
  label: string
  value: string
  name: string
  isSelected: boolean
  isDisabled?: boolean | undefined
  size?: OptionVariants['size']
  rounded?: OptionVariants['rounded']
  variant?: OptionVariants['variant']
}>()

const emit = defineEmits<{ select: []; blur: [] }>()

const isHovered = ref(false)
const isPressed = ref(false)
const isFocusVisible = ref(false)

const styles = computed(() => SELECTOR_OPTION_STYLES({ size, rounded, variant, isSelected }))

function onFocus(event: FocusEvent) {
  isFocusVisible.value = (event.target as HTMLElement).matches(':focus-visible')
}
</script>

<template>
  <div :class="styles.base()">
    <label
      :class="
        styles.radio({
          isHovered,
          isPressed,
          isFocusVisible,
          isSelected,
        })
      "
      :data-selected="isSelected"
      @pointerenter="isHovered = !isDisabled"
      @pointerleave="((isHovered = false), (isPressed = false))"
      @pointerdown="isPressed = !isDisabled"
      @pointerup="isPressed = false"
    >
      <input
        type="radio"
        class="sr-only"
        :name="name"
        :value="value"
        :checked="isSelected"
        :disabled="isDisabled"
        @change="emit('select')"
        @focus="onFocus"
        @blur="((isFocusVisible = false), emit('blur'))"
      />
      <div :class="styles.hover({ isHovered, isSelected, isPressed })" />
      <span class="isolate">{{ label }}</span>
    </label>
  </div>
</template>
