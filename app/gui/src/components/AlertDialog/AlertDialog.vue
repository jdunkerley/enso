<script setup lang="ts">
/**
 * @file A dialog that asks the user to confirm or cancel an action, on Reka UI's `AlertDialog`:
 * the Vue counterpart of the React `#/components/AlertDialog`, and styled the same way (a small
 * `Dialog` with no close button).
 *
 * `role="alertdialog"`; it opens with focus on the confirm button, as React's `autoFocus` does, and
 * cannot be dismissed by an outside click or Escape: the user must choose. `onConfirm` and
 * `onCancel` may return a promise; the dialog shows the confirm button loading until it settles,
 * then closes. If it fails, the dialog stays open and shows the error below its buttons, as React's
 * `Form.FormError` did (with the same message and `form-submit-error` test id; a JavaScript error,
 * not the backend's, reads "something went wrong" and goes to Sentry). React routes this through
 * its `Form`; a yes/no answer needs no form.
 *
 * The message is `message`, or the default slot, which receives `{ confirm, cancel }`.
 *
 * `@closed` fires once it has closed and its exit animation has ended: a modal on the stack
 * (`$/providers/modals`) leaves it then, so that it does not vanish mid-animation.
 */
import Alert from '$/components/Alert/Alert.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import {
  DIALOG_MODAL_STYLES,
  DIALOG_MOTION,
  DIALOG_OVERLAY_STYLES,
  DIALOG_STYLES,
} from '$/components/Dialog/variants'
import { portalTarget } from '$/components/portal'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import * as sentry from '@sentry/vue'
import * as errorUtils from 'enso-common/src/utilities/errors'
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger,
} from 'reka-ui'
import { useDialogFocus } from '$/components/Dialog/focusReturn'
import { computed, ref, useSlots } from 'vue'

const {
  title,
  message,
  confirm: confirmLabel,
  cancel: cancelLabel,
  isDestructive = false,
  onConfirm,
  onCancel,
  testId,
} = defineProps<{
  title: string
  message?: string | undefined
  /** The confirm button's label. Defaults to "Confirm". */
  confirm?: string | undefined
  /** The cancel button's label. Defaults to "Cancel". */
  cancel?: string | undefined
  /** Styles the confirm button as a delete. */
  isDestructive?: boolean | undefined
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
  testId?: string | undefined
}>()

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  /** It closed, and its exit animation has ended. */
  closed: []
}>()

const { getText } = useText()

// Focus returns to the opener on closing, as in `Dialog.vue`; it opens on the confirm button.
const slots = useSlots()
const focus = useDialogFocus(open, () => slots.trigger != null)

const pending = ref<'cancel' | 'confirm'>()
/** The message of the last failed response, shown as React's `Form.FormError` showed it. */
const error = ref<string>()

async function respond(response: 'cancel' | 'confirm') {
  if (pending.value != null) return
  pending.value = response
  error.value = undefined
  try {
    await (response === 'confirm' ? onConfirm : onCancel)?.()
    open.value = false
  } catch (failure) {
    const isJSError = errorUtils.isJSError(failure)
    if (isJSError) sentry.captureException(failure)
    const fallback = getText('arbitraryFormErrorMessage')
    error.value = isJSError ? fallback : errorUtils.tryGetMessage(failure, fallback)
  } finally {
    pending.value = undefined
  }
}

/**
 * Focus the confirm button rather than Reka's default, the first focusable element. It is focused
 * as visibly focused, as React's `autoFocus` is: react-aria treats focus that no key or pointer
 * press led to as "virtual", and shows it, so the button shows its focused colour from the start.
 */
function focusConfirm(event: Event) {
  const container = event.target instanceof Element ? event.target : document
  const button = container.querySelector<HTMLElement>('[data-alert-dialog-confirm]')
  if (button != null) {
    event.preventDefault()
    button.focus({ focusVisible: true })
  }
}

const styles = computed(() =>
  DIALOG_STYLES({ type: 'modal', size: 'small', closeButton: 'none', padding: 'medium' }),
)
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogTrigger v-if="$slots.trigger" asChild>
      <slot name="trigger" />
    </AlertDialogTrigger>
    <AlertDialogPortal :to="portalTarget()">
      <AlertDialogOverlay
        :class="
          DIALOG_OVERLAY_STYLES({ isEntering: open, isExiting: !open, blockInteractions: true })
        "
      >
        <!-- Reka unmounts the overlay once its exit animation has ended. -->
        <div
          :class="DIALOG_MODAL_STYLES({ type: 'modal' })"
          data-testid="modal-dialog"
          @vue:unmounted="emit('closed')"
        >
          <AlertDialogContent
            :class="`${styles.base()} ${DIALOG_MOTION({ type: 'modal' })}`"
            :data-testid="testId"
            @escapeKeyDown.prevent
            @openAutoFocus="focusConfirm"
            @closeAutoFocus="focus.onCloseAutoFocus"
          >
            <div class="w-full">
              <header :class="styles.header({ scrolledToTop: true })">
                <AlertDialogTitle asChild>
                  <Heading :level="2" :class="styles.heading()" weight="semibold">
                    {{ title }}
                  </Heading>
                </AlertDialogTitle>
              </header>
            </div>
            <div :class="styles.scroller()">
              <div :class="styles.measurerWrapper()">
                <div :class="styles.content()" class="flex flex-col gap-4">
                  <!-- Laid out as React's form is: a column, items at the start, 1rem apart. -->
                  <AlertDialogDescription asChild>
                    <div class="flex flex-col items-start gap-4">
                      <slot :confirm="() => respond('confirm')" :cancel="() => respond('cancel')">
                        <Text v-if="message != null">{{ message }}</Text>
                      </slot>
                    </div>
                  </AlertDialogDescription>
                  <ButtonGroup align="end">
                    <Button
                      variant="ghost"
                      :isDisabled="pending != null"
                      :isLoading="false"
                      testId="alert-dialog-cancel"
                      @press="respond('cancel')"
                    >
                      {{ cancelLabel ?? getText('cancel') }}
                    </Button>
                    <Button
                      :variant="isDestructive ? 'delete' : 'primary'"
                      :isLoading="pending === 'confirm'"
                      testId="alert-dialog-confirm"
                      data-alert-dialog-confirm
                      @press="respond('confirm')"
                    >
                      {{ confirmLabel ?? getText('confirm') }}
                    </Button>
                  </ButtonGroup>
                  <Alert v-if="error != null" size="large" variant="error" rounded="xxlarge">
                    <Text
                      disableLineHeightCompensation
                      variant="body"
                      truncate="3"
                      color="primary"
                      testId="form-submit-error"
                    >
                      {{ error }}
                    </Text>
                  </Alert>
                </div>
              </div>
            </div>
          </AlertDialogContent>
        </div>
      </AlertDialogOverlay>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
