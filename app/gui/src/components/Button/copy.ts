/**
 * @file Copying text to the clipboard from a button, as the React `useCopy` does: a "Copied to
 * clipboard" toast at the bottom right on success, an error toast on failure, and a state that
 * returns to `idle` after 2 s or once the toast is closed.
 */
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { onScopeDispose, ref } from 'vue'

/** The success toast's id, shared by every copy button as in React: one such toast at a time. */
const SUCCESS_TOAST_ID = 'copySuccess'

/** How long the success or error state stays. */
const RESET_DELAY = 2000

/** Options of {@link useCopy}. */
export interface UseCopyOptions {
  /**
   * The toast shown once the text is copied: `true` for "Copied to clipboard" (the default), a
   * string for another message, `false` for none.
   */
  readonly successToastMessage?: () => boolean | string | undefined
  readonly onCopy?: () => void
}

/** Copy text to the clipboard; `state` tells how the last copy went. */
export function useCopy(options: UseCopyOptions = {}) {
  const { getText } = useText()
  const toasts = useToasts()

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
    const message = options.successToastMessage?.() ?? true
    if (message === false) return
    toasts.show(message === true ? getText('copiedToClipboard') : message, {
      toastId: SUCCESS_TOAST_ID,
      type: 'success',
      closeOnClick: true,
      hideProgressBar: true,
      position: 'bottom-right',
    })
    // Closing the toast resets the state, as in React.
    stopWatchingToast?.()
    stopWatchingToast = toasts.onChange((change) => {
      if (change.id === SUCCESS_TOAST_ID && change.status === 'removed') reset()
    })
  }

  async function copy(text: string) {
    clearTimeout(resetTimer)
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      const message = `${getText('arbitraryErrorTitle')}: ${getMessageOrToString(error)}`
      toasts.show(message, { type: 'error' })
      console.error(message)
      state.value = 'error'
      return
    }
    state.value = 'success'
    options.onCopy?.()
    showSuccessToast()
    resetTimer = setTimeout(() => {
      toasts.dismiss(SUCCESS_TOAST_ID)
      reset()
    }, RESET_DELAY)
  }

  return { state, copy }
}
