<script setup lang="ts">
/**
 * @file An overlay positioned against its trigger, on Reka UI's `Popover`: the Vue counterpart of
 * the React `#/components/Dialog/Popover`, styled by the same `POPOVER_STYLES`.
 *
 * - The trigger is the `trigger` slot (React's `Popover.Trigger` wrapper); without one it is
 *   controlled through `v-model:open`.
 * - `anchor` positions it against an element it does not render (React's `triggerRef`), or against
 *   a virtual element (`{ getBoundingClientRect }`): a popover opened from React code on the modal
 *   stack, anchored to the React button or row that opened it.
 * - The content is the default slot, which receives `{ close }`; `DialogClose.vue` closes it too.
 * - It is modal by default, like react-aria's popovers: focus is trapped and the rest of the page
 *   is inert until it closes. `isNonModal` makes it non-modal (focus may leave, the page stays
 *   interactive), as React's `isNonModal` does.
 * - A modal popover lays a transparent underlay over the page, as react-aria's does: a click
 *   outside lands on it, so it closes the popover and does nothing else. Reka's own inertness
 *   (`pointer-events: none` on `body`) is not enough: anything that sets `pointer-events` itself,
 *   the graph editor's viewport among them, still takes the click, and the graph stops it before
 *   it reaches the document, where Reka listens for outside clicks.
 * - It focuses itself as it opens, not its first control, as react-aria's dialogs do (Tab goes on
 *   from there); a keyboard user does not see a focus ring appear on the first entry.
 * - `@close` fires whenever it closes, like React's `onClose`; `@closed` once it has closed and its
 *   exit animation has ended (a popover on the modal stack emits its `close` then).
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
import {
  PopoverAnchor,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  type ReferenceElement,
} from 'reka-ui'
import { computed, useSlots } from 'vue'
import { provideDialogContext } from './dialogContext'
import { focusReturnTarget, returnFocus, type FocusReturnTarget } from './focusReturn'

type PopoverVariants = VariantProps<typeof POPOVER_STYLES>

defineOptions({ inheritAttrs: false })

const {
  placement = 'bottom',
  offset = 8,
  crossOffset = 0,
  isDismissable = true,
  isNonModal = false,
  size,
  rounded,
  variant,
  testId,
  class: className,
  anchor,
  opener,
  // React-aria's `containerPadding` default.
  containerPadding = 12,
} = defineProps<{
  placement?: Placement | undefined
  /** Distance from the trigger, in pixels. React-aria's default, 8. */
  offset?: number | undefined
  /**
   * Shift along the trigger's edge, in pixels, as react-aria's `crossOffset`: positive is to the
   * right (or down), whatever the alignment.
   */
  crossOffset?: number | undefined
  isDismissable?: boolean | undefined
  isNonModal?: boolean | undefined
  size?: PopoverVariants['size']
  rounded?: PopoverVariants['rounded']
  variant?: PopoverVariants['variant']
  testId?: string | undefined
  class?: string | undefined
  /** What it is positioned against, when not its `trigger` slot: React's `triggerRef`. */
  anchor?: ReferenceElement | undefined
  /** How close to the viewport's edges it may go, as react-aria's `containerPadding`. */
  containerPadding?: number | undefined
  /**
   * Where focus returns on closing, for a popover without a trigger, when known before it mounted
   * (`focusReturnTarget()`); otherwise the element focused as it opens.
   */
  opener?: FocusReturnTarget | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  close: []
  /** It closed, and its exit animation has ended. */
  closed: []
}>()

function close() {
  open.value = false
  emit('close')
}

function onOpenChange(value: boolean) {
  if (!value) emit('close')
}

provideDialogContext({ close })

const sideAlign = computed(() => placementToSideAlign(placement))
// Reka's `alignOffset` is `@floating-ui`'s `alignmentAxis`, which an `end` alignment inverts.
const alignOffset = computed(() => (sideAlign.value.align === 'end' ? -crossOffset : crossOffset))
const styles = computed(() => POPOVER_STYLES({ size, rounded, variant }))
/**
 * The content's classes. React's popover is positioned against the viewport, so its `w-full` is the
 * viewport's width, capped by the size's `max-w-*`; Reka's sits in a wrapper as wide as its content,
 * so `w-full` would shrink it to fit. `w-screen` gives it React's width.
 */
const contentClass = computed(() => {
  const base = styles.value.base({ className })
  return `${base.split(' ').includes('w-full') ? base.replace(/(^| )w-full( |$)/, '$1w-screen$2') : base} ${POPOVER_MOTION}`
})

const slots = useSlots()
/** Where focus returns, for a popover without a trigger (on the modal stack, with an `anchor`). */
let returnTarget: FocusReturnTarget | undefined

function onOpenAutoFocus(event: Event) {
  // Without a trigger, Reka would leave focus on the page's body on closing; return it to the
  // element focused as the popover opened, as react-aria's focus scope does.
  if (slots.trigger == null) returnTarget = opener ?? focusReturnTarget()
  event.preventDefault()
  // Dispatched on the focus scope, which wraps the dialog element (`tabindex="-1"`).
  const scope = event.target
  if (!(scope instanceof HTMLElement)) return
  const dialog = scope.matches('[role="dialog"]') ? scope : scope.querySelector('[role="dialog"]')
  if (dialog instanceof HTMLElement) dialog.focus({ preventScroll: true })
}

function onCloseAutoFocus(event: Event) {
  if (slots.trigger == null && returnTarget != null) returnFocus(event, returnTarget)
}

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
    <PopoverAnchor v-if="anchor != null" :reference="anchor" asChild />
    <PopoverPortal :to="portalTarget()">
      <div
        v-if="open && !isNonModal"
        class="pointer-events-auto fixed inset-0"
        data-testid="underlay"
      />
      <PopoverContent
        v-bind="$attrs"
        :side="sideAlign.side"
        :align="sideAlign.align"
        :sideOffset="offset"
        :collisionPadding="containerPadding"
        :alignOffset="alignOffset"
        :class="contentClass"
        :data-testid="testId"
        @pointerDownOutside="onPointerDownOutside"
        @openAutoFocus="onOpenAutoFocus"
        @closeAutoFocus="onCloseAutoFocus"
      >
        <!-- Reka unmounts the content once its exit animation has ended. -->
        <div :class="styles.dialog()" @vue:unmounted="emit('closed')">
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
