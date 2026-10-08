<script setup lang="ts">
/**
 * @file A centred loading spinner that fills its container. Anything in the default slot is shown
 * under the spinner.
 */
import {
  LOADER_SIZES,
  LOADER_STYLES,
  type LoaderSize,
  type SpinnerPhase,
} from '$/components/Spinner/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'
import StatelessSpinner from './StatelessSpinner.vue'

type LoaderVariants = VariantProps<typeof LOADER_STYLES>

const {
  size = 'medium',
  state = 'loading-fast',
  minHeight = 'full',
  height = 'full',
  color = 'primary',
  class: className,
} = defineProps<{
  size?: LoaderSize | number | undefined
  state?: SpinnerPhase | undefined
  minHeight?: LoaderVariants['minHeight']
  height?: LoaderVariants['height']
  color?: LoaderVariants['color']
  class?: string | undefined
}>()

const pixelSize = computed(() => (typeof size === 'number' ? size : LOADER_SIZES[size]))
</script>

<template>
  <div :class="LOADER_STYLES({ minHeight, height, color, className })">
    <div class="flex flex-col items-center gap-2">
      <StatelessSpinner :size="pixelSize" :phase="state" class="text-current" />
      <slot />
    </div>
  </div>
</template>
