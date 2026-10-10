/** @file A toast telling the user that the app has gone offline, or come back online. */
import { useIsOnline } from '$/providers/online'
import { useText } from '$/providers/text'
import { useToasts, type ToastId } from '$/providers/toasts'
import { watch } from 'vue'

/**
 * Show a toast whenever the app goes offline or comes back online, replacing the previous one.
 * Nothing is shown for the state the app starts in.
 */
export function useOfflineNotification() {
  const isOnline = useIsOnline()
  const { getText } = useText()
  const toasts = useToasts()

  // Each toast gets a new id: a dismissed toast keeps its id until its exit animation ends, and
  // the store would not show another toast with that id meanwhile.
  let shown: ToastId | undefined
  watch(isOnline, (online) => {
    if (shown != null) toasts.dismiss(shown)
    shown = toasts.show(getText(online ? 'onlineToastMessage' : 'offlineToastMessage'), {
      type: 'info',
      hideProgressBar: true,
    })
  })
}
