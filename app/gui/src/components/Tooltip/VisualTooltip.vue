<script setup lang="ts">
/**
 * @file Wraps content in a visual tooltip: the Vue counterpart of the React `VisualTooltip`.
 *
 * The tooltip is the `tooltip` prop or the `tooltip` slot; with neither (or `tooltip === false`)
 * the content renders unwrapped. See `useVisualTooltip` for how it differs from an accessible
 * `Tooltip.vue`.
 */
import type { Placement } from '$/components/placement'
import { computed, ref, useSlots } from 'vue'
import { useVisualTooltip, type VisualTooltipDisplay } from './useVisualTooltip'
import VisualTooltipPopup from './VisualTooltipPopup.vue'

const {
  // `undefined`, not the `false` Vue casts an absent `string | false` prop to.
  tooltip = undefined,
  tooltipPlacement,
  display = 'always',
  testId,
  class: className,
} = defineProps<{
  tooltip?: string | false | undefined
  tooltipPlacement?: Placement | undefined
  display?: VisualTooltipDisplay | undefined
  /** The test id of the tooltip popup. */
  testId?: string | undefined
  class?: string | undefined
}>()

const slots = useSlots()
const hasTooltip = computed(() => tooltip !== false && (tooltip != null || slots.tooltip != null))
const target = ref<HTMLElement>()
const { isOpen, onTooltipEnter, onTooltipLeave } = useVisualTooltip(target, {
  display: () => display,
  isDisabled: () => !hasTooltip.value,
})
</script>

<template>
  <div v-if="hasTooltip" ref="target" :class="className">
    <slot />
    <VisualTooltipPopup
      :target="target"
      :open="isOpen"
      :placement="tooltipPlacement"
      :testId="testId"
      @pointerenter="onTooltipEnter"
      @pointerleave="onTooltipLeave"
    >
      <slot name="tooltip">{{ tooltip }}</slot>
    </VisualTooltipPopup>
  </div>
  <slot v-else />
</template>
