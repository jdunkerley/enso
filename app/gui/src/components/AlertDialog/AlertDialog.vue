<script setup lang="ts">
/**
 * @file A dialog that asks the user to confirm or cancel an action, on Reka UI's `AlertDialog`:
 * the Vue counterpart of the React `#/components/AlertDialog`, and styled the same way (a small
 * `Dialog` with no close button).
 *
 * `role="alertdialog"`; it opens with focus on the confirm button, as React's `autoFocus` does, and
 * cannot be dismissed by an outside click or Escape: the user must choose. `onConfirm` and
 * `onCancel` may return a promise; the dialog shows the confirm button loading until it settles,
 * then closes. The answer is submitted through a form, as in React (#84): if the callback fails,
 * the dialog stays open and shows why under the buttons, as React's `Form.FormError` did (with the
 * same message and `form-submit-error` test id; a JavaScript error, not the backend's, reads
 * "something went wrong" and goes to Sentry); with
 * `canSubmitOffline` set to `false` (React's default; `true` here, as for the callers before #84)
 * it shows the offline notice instead of answering while offline. `cancel` set to `null` leaves
 * out the cancel button, as React's `cancel={null}` did.
 *
 * The message is `message`, or the default slot, which receives `{ confirm, cancel }`.
 *
 * `@closed` fires once it has closed and its exit animation has ended: a modal on the stack
 * (`$/providers/modals`) leaves it then, so that it does not vanish mid-animation.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import FormError from '$/components/Form/FormError.vue'
import { FORM_STYLES } from '$/components/Form/variants'
import { useForm } from '$/components/Form/useForm'
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
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger,
} from 'reka-ui'
import { keepFocusOnBackdropPress, useDialogFocus } from '$/components/Dialog/focusReturn'
import { computed, ref, useSlots } from 'vue'
import { z } from 'zod'

const {
  title,
  message,
  confirm: confirmLabel,
  cancel: cancelLabel,
  isDestructive = false,
  onConfirm,
  onCancel,
  canSubmitOffline = true,
  testId,
} = defineProps<{
  title: string
  message?: string | undefined
  /** The confirm button's label. Defaults to "Confirm". */
  confirm?: string | undefined
  /** The cancel button's label. Defaults to "Cancel"; `null` leaves the button out. */
  cancel?: string | null | undefined
  /** Styles the confirm button as a delete. */
  isDestructive?: boolean | undefined
  onConfirm?: (() => unknown) | undefined
  onCancel?: (() => unknown) | undefined
  /** Whether it may answer while offline. Defaults to `true`; React's form defaulted to `false`. */
  canSubmitOffline?: boolean | undefined
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

const form = useForm({
  schema: z.object({ response: z.enum(['cancel', 'confirm']) }),
  defaultValues: { response: 'confirm' as 'cancel' | 'confirm' },
  canSubmitOffline,
  onSubmit: ({ response }) => (response === 'confirm' ? onConfirm : onCancel)?.(),
  onSubmitSuccess: () => {
    open.value = false
  },
})

async function respond(response: 'cancel' | 'confirm') {
  if (pending.value != null) return
  pending.value = response
  try {
    form.setValue('response', response)
    await form.submit()
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
        @mousedown="keepFocusOnBackdropPress"
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
                <div :class="styles.content()">
                  <!-- React's form, with its layout: a column, items at the start, 1rem apart. The
                  message is laid out among them (`contents`), as React's was, which keeps every
                  line where React painted it. -->
                  <form :class="FORM_STYLES({ gap: 'medium' })" novalidate @submit.prevent>
                    <AlertDialogDescription asChild>
                      <div class="contents">
                        <slot :confirm="() => respond('confirm')" :cancel="() => respond('cancel')">
                          <Text v-if="message != null">{{ message }}</Text>
                        </slot>
                      </div>
                    </AlertDialogDescription>
                    <ButtonGroup align="end">
                      <Button
                        v-if="cancelLabel !== null"
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
                    <FormError :form="form" />
                  </form>
                </div>
              </div>
            </div>
          </AlertDialogContent>
        </div>
      </AlertDialogOverlay>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
