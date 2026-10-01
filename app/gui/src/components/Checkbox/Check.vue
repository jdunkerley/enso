<script setup lang="ts">
/**
 * @file A check mark (or the indeterminate dash) in a box: the Vue counterpart of the React
 * `#/components/Check`, styled by the same `CHECK_CLASSES`. Decorative (`role="presentation"`).
 */
import { CHECK_CLASSES } from '$/components/Checkbox/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'

type CheckVariants = VariantProps<typeof CHECK_CLASSES>

const {
  isSelected = false,
  isIndeterminate = false,
  color,
  rounded,
  size,
  class: className,
} = defineProps<{
  isSelected?: boolean | undefined
  isIndeterminate?: boolean | undefined
  color?: CheckVariants['color']
  rounded?: CheckVariants['rounded']
  size?: CheckVariants['size']
  class?: string | undefined
}>()

const styles = computed(() => CHECK_CLASSES({ isSelected, className, color, rounded, size }))
const path = computed(() =>
  isIndeterminate ? 'M5 8H11'
  : isSelected ? 'M4 8.4L6.5 10.9L9.25 8.15L12 5.4'
  : '',
)
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    :class="styles.base()"
    role="presentation"
    pointer-events="none"
  >
    <path
      :class="styles.path()"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      stroke="currentColor"
      fill="none"
      :d="path"
    />
  </svg>
</template>
