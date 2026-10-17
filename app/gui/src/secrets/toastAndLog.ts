/** @file An error toast that is logged too, for the forms here. */
import { useToasts } from '$/providers/toasts'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'

/** Show the error's message as an error toast, and log it. */
export function toastAndLogError(error: unknown) {
  const message = getMessageOrToString(error)
  useToasts().show(message, { type: 'error' })
  console.error(message)
}
