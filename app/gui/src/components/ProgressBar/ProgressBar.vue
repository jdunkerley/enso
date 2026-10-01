<script setup lang="ts">
/**
 * @file A progress bar (`role="progressbar"`) on Reka UI's `Progress`: the Vue counterpart of the
 * React `#/components/ProgressBar`.
 */
import { PROGRESS_BAR_STYLES } from '$/components/ProgressBar/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { ProgressIndicator, ProgressRoot } from 'reka-ui'
import { computed } from 'vue'

type ProgressBarVariants = VariantProps<typeof PROGRESS_BAR_STYLES>

const {
  progress,
  variant,
  class: className,
  progressBarClass,
} = defineProps<{
  /** From 0 (not started) to 1 (complete), or `'indeterminate'`. */
  progress: number | 'indeterminate'
  variant?: ProgressBarVariants['variant']
  class?: string | undefined
  progressBarClass?: string | undefined
}>()

const WHOLE_PERCENTAGE = 100

const isIndeterminate = computed(() => progress === 'indeterminate')
const percentage = computed(() =>
  progress === 'indeterminate' ? WHOLE_PERCENTAGE : progress * WHOLE_PERCENTAGE,
)
const styles = computed(() => PROGRESS_BAR_STYLES({ variant }))
</script>

<template>
  <ProgressRoot
    :modelValue="isIndeterminate ? null : percentage"
    :max="WHOLE_PERCENTAGE"
    :class="styles.base({ className })"
  >
    <ProgressIndicator
      :class="styles.progressBar({ className: progressBarClass })"
      :style="
        variant === 'clipped' ?
          { clipPath: `polygon(0 0, ${percentage}% 0, ${percentage}% 100%, 0 100%)` }
        : { width: `${percentage}%` }
      "
    >
      <div v-if="isIndeterminate" :class="styles.indeterminateProgressBar()" />
    </ProgressIndicator>
  </ProgressRoot>
</template>
