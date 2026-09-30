/**
 * @file
 *
 * Offline Notification Manager component.
 *
 * This component is responsible for displaying a toast notification when the user goes offline or online.
 */

import * as React from 'react'

import { toast } from '#/utilities/toast'

import * as offlineHooks from '#/hooks/offlineHooks'

import { useText } from '$/providers/react'

/** Props for {@link OfflineNotificationManager} */
export type OfflineNotificationManagerProps = Readonly<React.PropsWithChildren>

/** Context props for {@link OfflineNotificationManager} */
interface OfflineNotificationManagerContextProps {
  readonly isNested: boolean
  readonly toastId?: string
}

const OfflineNotificationManagerContext =
  React.createContext<OfflineNotificationManagerContextProps>({ isNested: false })

/** Offline Notification Manager component. */
export function OfflineNotificationManager(props: OfflineNotificationManagerProps) {
  const { children } = props
  const toastId = 'offline'
  const { getText } = useText()

  offlineHooks.useOfflineChange(
    (isOffline) => {
      toast.dismiss(toastId)

      if (isOffline) {
        toast.info(getText('offlineToastMessage'), {
          toastId,
          hideProgressBar: true,
        })
      } else {
        toast.info(getText('onlineToastMessage'), {
          toastId,
          hideProgressBar: true,
        })
      }
    },
    { triggerImmediate: false },
  )

  return (
    <OfflineNotificationManagerContext.Provider value={{ isNested: true, toastId }}>
      {children}
    </OfflineNotificationManagerContext.Provider>
  )
}
