<script setup lang="ts">
/**
 * @file A visual separator (`role="separator"`) on Reka UI's `Separator`: the Vue counterpart of
 * the React `#/components/Separator`.
 */
import { SEPARATOR_STYLES } from '$/components/Separator/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { Separator } from 'reka-ui'

type SeparatorVariants = VariantProps<typeof SEPARATOR_STYLES>

const {
  orientation = 'horizontal',
  size,
  variant,
  class: className,
} = defineProps<{
  orientation?: 'horizontal' | 'vertical' | undefined
  size?: SeparatorVariants['size']
  variant?: SeparatorVariants['variant']
  class?: string | undefined
}>()
</script>

<template>
  <Separator
    :orientation="orientation"
    :class="SEPARATOR_STYLES({ orientation, size, variant, className })"
  />
</template>
