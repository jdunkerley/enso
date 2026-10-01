/**
 * @file
 *
 * A hook for copying text to the clipboard.
 */

import * as React from 'react'

import { toast } from '#/utilities/toast'
import * as reactQuery from '@tanstack/react-query'

import * as toastAndLogHooks from '#/hooks/toastAndLogHooks'

import { useText } from '$/providers/react'

/** Props for the useCopy hook. */
export interface UseCopyProps {
  readonly onCopy?: (() => void) | undefined
  readonly successToastMessage?: boolean | string
}

const DEFAULT_TIMEOUT = 2000

/** A hook for copying text to the clipboard. */
export function useCopy(props: UseCopyProps = {}) {
  const { onCopy, successToastMessage = true } = props

  const resetTimeoutIdRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const { getText } = useText()
  const toastAndLog = toastAndLogHooks.useToastAndLog()

  const copyQuery = reactQuery.useMutation({
    mutationFn: (text: string) => window.navigator.clipboard.writeText(text),
    onMutate: () => {
      // Clear the reset timeout.
      // This is necessary to prevent the button from resetting while the copy is in progress.
      // This can happen if the user clicks the button multiple times in quick succession.
      if (resetTimeoutIdRef.current != null) {
        clearTimeout(resetTimeoutIdRef.current)
        resetTimeoutIdRef.current = null
      }
    },
    onSuccess: () => {
      onCopy?.()

      const toastId = 'copySuccess'

      if (successToastMessage !== false) {
        toast.success(
          successToastMessage === true ? getText('copiedToClipboard') : successToastMessage,
          { toastId, closeOnClick: true, hideProgressBar: true, position: 'bottom-right' },
        )
        // If user closes the toast, reset the button state
        toast.onChange((change) => {
          if (change.id === toastId && change.status === 'removed') {
            copyQuery.reset()
          }
        })
      }

      // Reset the button to its original state after a timeout.
      resetTimeoutIdRef.current = setTimeout(() => {
        toast.dismiss(toastId)
        copyQuery.reset()
      }, DEFAULT_TIMEOUT)
    },
    onError: (error) => {
      toastAndLog('arbitraryErrorTitle', error)
    },
  })

  return copyQuery
}
