<script setup lang="ts">
/**
 * @file An accessible tooltip on Reka UI's `Tooltip`: the Vue counterpart of the React
 * `TooltipTrigger` + `Tooltip` pair.
 *
 * The default slot is the trigger, which must be a single focusable element (usually a
 * `Button`). The text is the `tooltip` prop or the `tooltip` slot. It opens on hover after
 * `delay` and on keyboard focus, closes on Escape, and describes the trigger through
 * `aria-describedby` with `role="tooltip"`.
 *
 * This is the dashboard's tooltip. The project-view's `TooltipTrigger`/`TooltipDisplayer` registry
 * is a different design (a single floating element, a 1.5 s delay, graph-editor styling, and it
 * must work inside visualizations' custom elements), and stays as it is; see the rulings in
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 */
import { placementToSideAlign, type Placement } from '$/components/placement'
import { portalTarget } from '$/components/portal'
import { TOOLTIP_MOTION, TOOLTIP_STYLES, type TooltipVariants } from '$/components/Tooltip/variants'
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import { computed, useSlots } from 'vue'

const {
  tooltip,
  placement = 'top',
  delay = 1500,
  closeDelay = 500,
  isDisabled = false,
  variant,
  size,
  rounded,
  maxWidth,
  testId,
  class: className,
} = defineProps<{
  tooltip?: string | undefined
  placement?: Placement | undefined
  /** Milliseconds of hover before the tooltip opens. React-aria's default, 1500. */
  delay?: number | undefined
  /** Milliseconds within which moving to another tooltip's trigger skips its delay. */
  closeDelay?: number | undefined
  isDisabled?: boolean | undefined
  variant?: TooltipVariants['variant']
  size?: TooltipVariants['size']
  rounded?: TooltipVariants['rounded']
  maxWidth?: TooltipVariants['maxWidth']
  testId?: string | undefined
  class?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const slots = useSlots()
const hasTooltip = computed(() => tooltip != null || slots.tooltip != null)
const sideAlign = computed(() => placementToSideAlign(placement))
const classes = computed(
  () => `${TOOLTIP_STYLES({ variant, size, rounded, maxWidth, className })} ${TOOLTIP_MOTION}`,
)

/** React-aria's `offset` and `containerPadding` for the dashboard's tooltips. */
const OFFSET = 9
const CONTAINER_PADDING = 6
</script>

<template>
  <TooltipProvider v-if="hasTooltip" :delayDuration="delay" :skipDelayDuration="closeDelay">
    <!-- Disabled rather than unwrapped, so that toggling it does not remount the trigger (and drop
    its focus), e.g. a `Button` that disables itself while its action runs. -->
    <TooltipRoot v-model:open="open" :disabled="isDisabled">
      <TooltipTrigger asChild>
        <slot />
      </TooltipTrigger>
      <TooltipPortal :to="portalTarget()">
        <TooltipContent
          :side="sideAlign.side"
          :align="sideAlign.align"
          :sideOffset="OFFSET"
          :collisionPadding="CONTAINER_PADDING"
          :class="classes"
          :data-testid="testId"
          data-ignore-click-outside
        >
          <slot name="tooltip">{{ tooltip }}</slot>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
  <slot v-else />
</template>
