<script setup lang="ts">
/**
 * @file A button that copies text to the clipboard, and briefly shows whether that worked: the
 * Vue counterpart of the React `Button/CopyButton`.
 *
 * Like the React one, it shows a "Copied to clipboard" toast at the bottom right on success (unless
 * `successToastMessage` is `false`), which closes with the success icon; a failure shows an error
 * toast and is logged.
 */
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { onScopeDispose, ref, useAttrs } from 'vue'
import Button from './Button.vue'

const {
  copyText,
  copyIcon = 'duplicate',
  successIcon = 'check',
  errorIcon = 'close',
  variant = 'icon',
  successToastMessage = true,
} = defineProps<{
  copyText: string
  /** `null` shows no icon (`false` in React). */
  copyIcon?: IconName | null | undefined
  successIcon?: IconName | undefined
  errorIcon?: IconName | undefined
  variant?: InstanceType<typeof Button>['$props']['variant']
  /**
   * The toast shown once the text is copied: `true` for "Copied to clipboard" (the default), a
   * string for another message, `false` for none.
   */
  successToastMessage?: boolean | string | undefined
}>()

const emit = defineEmits<{ copy: [] }>()

const { getText } = useText()
const toasts = useToasts()
const attrs = useAttrs()

/** The success toast's id, shared by every copy button as in React: one such toast at a time. */
const SUCCESS_TOAST_ID = 'copySuccess'

/** How long the success or error icon stays before the copy icon comes back. */
const RESET_DELAY = 2000

const state = ref<'error' | 'idle' | 'success'>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined
let stopWatchingToast: (() => void) | undefined
onScopeDispose(() => {
  clearTimeout(resetTimer)
  stopWatchingToast?.()
})

function reset() {
  stopWatchingToast?.()
  stopWatchingToast = undefined
  state.value = 'idle'
}

function showSuccessToast() {
  if (successToastMessage === false) return
  toasts.show(successToastMessage === true ? getText('copiedToClipboard') : successToastMessage, {
    toastId: SUCCESS_TOAST_ID,
    type: 'success',
    closeOnClick: true,
    hideProgressBar: true,
    position: 'bottom-right',
  })
  // Closing the toast resets the button, as in React.
  stopWatchingToast?.()
  stopWatchingToast = toasts.onChange((change) => {
    if (change.id === SUCCESS_TOAST_ID && change.status === 'removed') reset()
  })
}

async function copy() {
  clearTimeout(resetTimer)
  try {
    await navigator.clipboard.writeText(copyText)
  } catch (error) {
    const message = `${getText('arbitraryErrorTitle')}: ${getMessageOrToString(error)}`
    toasts.show(message, { type: 'error' })
    console.error(message)
    state.value = 'error'
    return
  }
  state.value = 'success'
  emit('copy')
  showSuccessToast()
  resetTimer = setTimeout(() => {
    toasts.dismiss(SUCCESS_TOAST_ID)
    reset()
  }, RESET_DELAY)
}
</script>

<template>
  <Button
    :variant="variant"
    :icon="
      copyIcon == null ? undefined
      : state === 'success' ? successIcon
      : state === 'error' ? errorIcon
      : copyIcon
    "
    :aria-label="attrs['aria-label'] ?? getText('copyShortcut')"
    :data-copy-state="state"
    @press="copy"
  >
    <template v-if="$slots.default" #default><slot /></template>
  </Button>
</template>
