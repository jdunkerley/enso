<script setup lang="ts">
/**
 * @file A spinning arc that animates using the `dasharray-<percentage>` custom Tailwind classes: the
 * Vue counterpart of the React `#/components/Spinner`.
 *
 * The project-view's `shared/LoadingSpinner.vue` draws the same arc with its own CSS, because it is
 * also mounted inside visualizations' custom elements, where Tailwind does not reach. This one is
 * the dashboard's, styled by the shared {@link SPINNER_PHASE_CLASSES}.
 */
import { ROTATING_ELEMENT_SIZE } from '$/components/Spinner/constants'
import { SPINNER_PHASE_CLASSES, type SpinnerPhase } from '$/components/Spinner/variants'
import { twJoin } from '$/utils/style/tailwindMerge'

const {
  size,
  padding,
  phase,
  thickness = 3,
  class: className,
} = defineProps<{
  size?: number | undefined
  padding?: number | undefined
  phase: SpinnerPhase
  thickness?: number | undefined
  class?: string | undefined
}>()
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :class="twJoin('pointer-events-none', className)"
    :style="padding != null ? { padding: `${padding}px` } : undefined"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    data-testid="spinner"
  >
    <rect
      :x="thickness / 2"
      :y="thickness / 2"
      :width="ROTATING_ELEMENT_SIZE - thickness"
      :height="ROTATING_ELEMENT_SIZE - thickness"
      :rx="ROTATING_ELEMENT_SIZE / 2 - thickness / 2"
      stroke="currentColor"
      stroke-linecap="round"
      :stroke-width="thickness"
      :class="
        twJoin(
          'pointer-events-none origin-center !animate-spin-ease transition-stroke-dasharray',
          SPINNER_PHASE_CLASSES[phase],
        )
      "
    />
  </svg>
</template>
