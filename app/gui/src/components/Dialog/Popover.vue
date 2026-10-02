<script setup lang="ts">
/**
 * @file An overlay positioned against its trigger, on Reka UI's `Popover`: the Vue counterpart of
 * the React `#/components/Dialog/Popover`, styled by the same `POPOVER_STYLES`.
 *
 * - The trigger is the `trigger` slot (React's `Popover.Trigger` wrapper); without one it is
 *   controlled through `v-model:open`.
 * - The content is the default slot, which receives `{ close }`; `DialogClose.vue` closes it too.
 * - It is modal by default, like react-aria's popovers: focus is trapped and the rest of the page
 *   is inert until it closes. `isNonModal` makes it non-modal (focus may leave, the page stays
 *   interactive), as React's `isNonModal` does.
 * - `@close` fires whenever it closes, like React's `onClose`.
 * - Attributes (`aria-label`, …) go on the `role="dialog"` element.
 */
import ResetButtonGroup from '$/components/Button/ResetButtonGroup.vue'
import {
  IGNORE_INTERACT_OUTSIDE_SELECTOR,
  POPOVER_MOTION,
  POPOVER_STYLES,
} from '$/components/Dialog/variants'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import { placementToSideAlign, type Placement } from '$/components/placement'
import { portalTarget } from '$/components/portal'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed } from 'vue'
import { provideDialogContext } from './dialogContext'

type PopoverVariants = VariantProps<typeof POPOVER_STYLES>

defineOptions({ inheritAttrs: false })

const {
  placement = 'bottom',
  offset = 8,
  isDismissable = true,
  isNonModal = false,
  size,
  rounded,
  variant,
  testId,
  class: className,
} = defineProps<{
  placement?: Placement | undefined
  /** Distance from the trigger, in pixels. React-aria's default, 8. */
  offset?: number | undefined
  isDismissable?: boolean | undefined
  isNonModal?: boolean | undefined
  size?: PopoverVariants['size']
  rounded?: PopoverVariants['rounded']
  variant?: PopoverVariants['variant']
  testId?: string | undefined
  class?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{ close: [] }>()

function close() {
  open.value = false
  emit('close')
}

function onOpenChange(value: boolean) {
  if (!value) emit('close')
}

provideDialogContext({ close })

const sideAlign = computed(() => placementToSideAlign(placement))
const styles = computed(() => POPOVER_STYLES({ size, rounded, variant }))

function onPointerDownOutside(event: CustomEvent<{ originalEvent: PointerEvent }>) {
  const target = event.detail.originalEvent.target
  if (
    !isDismissable ||
    (target instanceof Element && target.closest(IGNORE_INTERACT_OUTSIDE_SELECTOR) != null)
  ) {
    event.preventDefault()
  }
}
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="!isNonModal" @update:open="onOpenChange">
    <PopoverTrigger v-if="$slots.trigger" asChild>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal :to="portalTarget()">
      <!-- 12px from the window's edges, react-aria's `containerPadding`. -->
      <PopoverContent
        v-bind="$attrs"
        :side="sideAlign.side"
        :align="sideAlign.align"
        :sideOffset="offset"
        :collisionPadding="12"
        :class="`${styles.base({ className })} ${POPOVER_MOTION}`"
        :data-testid="testId"
        @pointerDownOutside="onPointerDownOutside"
      >
        <div :class="styles.dialog()">
          <ErrorBoundary>
            <SuspenseLoader :loaderProps="{ minHeight: 'h32' }">
              <ResetButtonGroup>
                <slot :close="close" />
              </ResetButtonGroup>
            </SuspenseLoader>
          </ErrorBoundary>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
