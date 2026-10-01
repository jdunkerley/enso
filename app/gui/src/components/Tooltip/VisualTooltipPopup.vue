<script setup lang="ts">
/**
 * @file The floating part of a visual tooltip, positioned against `target` with `@floating-ui`. It
 * is internal to `VisualTooltip.vue` and the components that attach a visual tooltip to their own
 * element (`Text.vue`, `Button.vue`); see `useVisualTooltip` for when it shows.
 */
import { portalTarget } from '$/components/portal'
import { TOOLTIP_STYLES, type TooltipVariants } from '$/components/Tooltip/variants'
import {
  autoUpdate,
  flip,
  offset as offsetMiddleware,
  shift,
  useFloating,
  type Placement,
} from '@floating-ui/vue'
import { computed, ref } from 'vue'

const {
  target,
  open,
  placement = 'bottom',
  offset = 6,
  crossOffset = 0,
  containerPadding = 0,
  variant,
  size,
  rounded,
  maxWidth,
  testId,
  class: className,
} = defineProps<{
  target: HTMLElement | undefined | null
  open: boolean
  placement?: Placement | undefined
  offset?: number | undefined
  crossOffset?: number | undefined
  containerPadding?: number | undefined
  variant?: TooltipVariants['variant']
  size?: TooltipVariants['size']
  rounded?: TooltipVariants['rounded']
  maxWidth?: TooltipVariants['maxWidth']
  testId?: string | undefined
  class?: string | undefined
}>()

const emit = defineEmits<{ pointerenter: []; pointerleave: [] }>()

const floating = ref<HTMLElement>()
const { floatingStyles } = useFloating(
  computed(() => target),
  floating,
  {
    placement: computed(() => placement),
    strategy: 'fixed',
    middleware: computed(() => [
      offsetMiddleware({ mainAxis: offset, crossAxis: crossOffset }),
      flip({ padding: containerPadding }),
      shift({ padding: containerPadding }),
    ]),
    whileElementsMounted: autoUpdate,
  },
)

const classes = computed(() => TOOLTIP_STYLES({ variant, size, rounded, maxWidth, className }))
</script>

<template>
  <Teleport v-if="open && target != null" :to="portalTarget()">
    <span
      ref="floating"
      :class="classes"
      :style="floatingStyles"
      aria-hidden="true"
      role="presentation"
      :data-testid="testId"
      data-ignore-click-outside
      @pointerenter="emit('pointerenter')"
      @pointerleave="emit('pointerleave')"
    >
      <slot />
    </span>
  </Teleport>
</template>
