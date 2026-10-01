import { useToasts, type ToastOptions, type ToastType } from '$/providers/toasts'
import type { ResultError } from 'enso-common/src/utilities/data/result'
import { onScopeDispose } from 'vue'

declare const toastIdBrand: unique symbol
type ToastId = string & { [toastIdBrand]: never }

function makeToastId(): ToastId {
  return `toast-${crypto.randomUUID()}` as ToastId
}

export interface UseToastOptions extends Omit<ToastOptions, 'toastId'> {
  outliveScope?: boolean
}

/**
 * Composable for new toast - a pop-up message displayed to the user.
 *
 * ```ts
 * // useToast.error is an equivalent of useToast(type: 'error').
 * // There's also useToast.info, useToast.warning and useToast.success.
 * const toastLspError = useToast.error()
 * // Every `useToast` allow displaying only one message at once, so
 * // here we create separate toast for every "topic".
 * const toastExecutionFailed = useToast.error()
 * const toastUserActionFailed = useToast.error()
 * // Toast are automatically closed after some time. Here we suppress this.
 * const toastStartup = useToast.info({ autoClose: false })
 * const toastConnectionLost = useToast.error({ autoClose: false })
 *
 * ```
 *
 * The toasts are shown by `$/components/Toast/ToastHost.vue`; see `$/providers/toasts` for the
 * options.
 */
export function useToast(options: UseToastOptions = {}) {
  const toasts = useToasts()
  const id = makeToastId()
  const { outliveScope, ...toastOptions } = options
  if (outliveScope !== true) {
    onScopeDispose(() => toasts.dismiss(id), true)
  }

  return {
    /** Show or update toast. */
    show(content: string) {
      if (toasts.isActive(id)) toasts.update(id, { ...toastOptions, render: content })
      else toasts.show(content, { ...toastOptions, toastId: id })
    },
    /** A helper for reporting {@link ResultError} to both toast and console. */
    reportError<E>(result: ResultError<E>, preamble?: string) {
      const msg = result.message(preamble)
      console.error(msg)
      this.show(msg)
    },
    /** Dismiss the displayed toast. */
    dismiss() {
      toasts.dismiss(id)
    },
  }
}

const useToastKind = (type: ToastType) => (options?: UseToastOptions) =>
  useToast({ ...options, type })

useToast.error = useToastKind('error')
useToast.info = useToastKind('info')
useToast.warning = useToastKind('warning')
useToast.success = useToastKind('success')
