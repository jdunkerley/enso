<script setup lang="ts">
/**
 * @file A modal dialog on Reka UI's `Dialog`: the Vue counterpart of the React
 * `#/components/Dialog`, styled by the same `DIALOG_STYLES`, `DIALOG_OVERLAY_STYLES` and
 * `DIALOG_MODAL_STYLES`.
 *
 * Reka provides what react-aria did: `role="dialog"` labelled by the title, focus moved in on open
 * and trapped, focus returned to the trigger on close, Escape and outside-click dismissal, scroll
 * lock, and `aria-hidden` on everything else. Nested dialogs and popovers stack: Escape and outside
 * clicks reach the topmost one first, so React's `DialogStackProvider` has no Vue counterpart.
 *
 * - The trigger is the `trigger` slot, and replaces React's `Dialog.Trigger` wrapper. Without one,
 *   the dialog is controlled through `v-model:open`.
 * - The content is the default slot, which receives `{ close }`. `DialogClose.vue`, anywhere inside,
 *   closes it too.
 * - `@dismiss` fires when the user closes it (Escape, outside click, the close button, or
 *   `close`), like React's `onDismiss`. Setting `open` to `false` from outside does not fire it.
 * - Like React, keys other than Escape do not propagate out of the dialog, so global shortcuts do
 *   not fire while it is open.
 * - The `title` labels it. A dialog without one needs an `aria-label`; Reka also warns about it in
 *   development builds.
 *
 * The global modal stack (`setModal` and its Vue replacement) is #80's; this is the primitive it
 * will render.
 */
import ResetButtonGroup from '$/components/Button/ResetButtonGroup.vue'
import CloseButton from '$/components/Button/CloseButton.vue'
import {
  DIALOG_MODAL_STYLES,
  DIALOG_MOTION,
  DIALOG_OVERLAY_STYLES,
  DIALOG_STYLES,
  IGNORE_INTERACT_OUTSIDE_SELECTOR,
} from '$/components/Dialog/variants'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import SuspenseLoader from '$/components/ErrorBoundary/SuspenseLoader.vue'
import { portalTarget } from '$/components/portal'
import Heading from '$/components/Text/Heading.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { computed, ref } from 'vue'
import { provideDialogContext } from './dialogContext'

type DialogVariants = VariantProps<typeof DIALOG_STYLES>

const {
  title,
  type = 'modal',
  isDismissable = true,
  isKeyboardDismissDisabled = false,
  closeButton = 'normal',
  hideCloseButton = undefined,
  size,
  padding,
  rounded,
  fitContent = undefined,
  layout = undefined,
  role = 'dialog',
  testId,
  class: className,
} = defineProps<{
  title?: string | undefined
  type?: 'fullscreen' | 'modal' | undefined
  /** Whether an outside click closes it. Also blurs what is behind it when `false`. */
  isDismissable?: boolean | undefined
  isKeyboardDismissDisabled?: boolean | undefined
  closeButton?: DialogVariants['closeButton']
  hideCloseButton?: boolean | undefined
  /** Only applies to the `modal` type. */
  size?: DialogVariants['size']
  padding?: DialogVariants['padding']
  rounded?: DialogVariants['rounded']
  fitContent?: boolean | undefined
  layout?: boolean | undefined
  role?: 'alertdialog' | 'dialog' | undefined
  testId?: string | undefined
  class?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  /** The user closed the dialog. */
  dismiss: []
}>()

function close() {
  emit('dismiss')
  open.value = false
}

function onOpenChange(value: boolean) {
  if (!value) emit('dismiss')
}

provideDialogContext({ close })

const styles = computed(() =>
  DIALOG_STYLES({
    type,
    rounded,
    hideCloseButton,
    closeButton,
    size,
    padding: padding ?? (type === 'modal' ? 'medium' : 'xlarge'),
    fitContent,
    layout,
  }),
)

const scroller = ref<HTMLElement>()
const isScrolledToTop = ref(true)
function onScroll() {
  isScrolledToTop.value = (scroller.value?.scrollTop ?? 0) === 0
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

function onEscapeKeyDown(event: KeyboardEvent) {
  if (isKeyboardDismissDisabled) event.preventDefault()
}

function stopNonEscapeKeys(event: KeyboardEvent) {
  if (event.key !== 'Escape') event.stopPropagation()
}
</script>

<template>
  <DialogRoot v-model:open="open" @update:open="onOpenChange">
    <DialogTrigger v-if="$slots.trigger" asChild>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogPortal :to="portalTarget()">
      <!-- React's `ModalOverlay` > `Modal` > `Dialog` nesting. The content sits inside the overlay
      (Reka's "scrollable overlay" layout), so a click on either outer layer is outside it. -->
      <DialogOverlay
        :class="
          DIALOG_OVERLAY_STYLES({
            isEntering: open,
            isExiting: !open,
            blockInteractions: !isDismissable,
          })
        "
        @keydown="stopNonEscapeKeys"
      >
        <div :class="DIALOG_MODAL_STYLES({ type })" data-testid="modal-dialog">
          <DialogContent
            :class="`${styles.base({ className })} ${DIALOG_MOTION({ type })}`"
            :role="role"
            :data-testid="testId"
            :aria-describedby="undefined"
            @pointerDownOutside="onPointerDownOutside"
            @escapeKeyDown="onEscapeKeyDown"
          >
            <div class="w-full">
              <header :class="styles.header({ scrolledToTop: isScrolledToTop })">
                <CloseButton
                  v-if="closeButton !== 'none'"
                  :class="styles.closeButton()"
                  @press="close"
                />
                <DialogTitle v-if="title != null" asChild>
                  <Heading :level="2" :class="styles.heading()" weight="semibold">
                    {{ title }}
                  </Heading>
                </DialogTitle>
              </header>
            </div>

            <div ref="scroller" :class="styles.scroller()" @scroll.passive="onScroll">
              <div :class="styles.measurerWrapper()">
                <div :class="styles.content()">
                  <ErrorBoundary>
                    <SuspenseLoader
                      :loaderProps="{ minHeight: type === 'fullscreen' ? 'full' : 'h32' }"
                    >
                      <ResetButtonGroup>
                        <slot :close="close" />
                      </ResetButtonGroup>
                    </SuspenseLoader>
                  </ErrorBoundary>
                </div>
              </div>
            </div>
          </DialogContent>
        </div>
      </DialogOverlay>
    </DialogPortal>
  </DialogRoot>
</template>
