/**
 * @file The notification tray's notifications: the Vue counterpart of the React
 * `computedNotificationHooks` (#83).
 *
 * Notifications are computed from app state; today the only source is the user's uploads to the
 * cloud (`$/providers/upload`), summed into one "uploading N files" notification with a progress
 * bar. A notification can also show as a toast at the bottom right, updated in place as it
 * progresses. A finished one stays in the tray for a minute.
 */
import { useText } from '$/providers/text'
import { useToasts, type ToastContent } from '$/providers/toasts'
import { useUploadsToCloudStore } from '$/providers/upload'
import { computed, markRaw, onScopeDispose, shallowRef, watch, type Component } from 'vue'
import type { NotificationInfo } from './types'

const MB_BYTES = 1_000_000
const COMPUTED_NOTIFICATION_STORAGE_TIME_MS = 60_000

/** Whether a notification's work is done: it has no progress, or its progress is complete. */
function isFinished(notification: NotificationInfo) {
  // A notification without a progress value is instantaneous (or finished by the time it was
  // added); an `indeterminate` one is still ongoing.
  if (notification.progress == null) return true
  if (notification.progress === 'indeterminate') return false
  return notification.progress >= 1
}

/**
 * The notifications, newest first, and a way to remove one. `item` draws a notification in its
 * toast (`NotificationItem.vue`, passed in by the tray: ESLint's type service cannot resolve a
 * `.vue` import in this subtree's `.ts` files).
 */
export function useNotifications(item: Component) {
  /** A notification's toast: the tray's item, without its time or progress bar. */
  const toastContent = (notification: NotificationInfo): ToastContent => ({
    component: markRaw(item),
    props: { message: notification.message, icon: notification.icon, color: notification.color },
  })

  const { getText } = useText()
  const toasts = useToasts()
  const uploadsStore = useUploadsToCloudStore()

  const notificationMap = shallowRef<ReadonlyMap<unknown, NotificationInfo>>(new Map())
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onScopeDispose(() => {
    for (const timer of timers) clearTimeout(timer)
  })

  /** Remove a notification from the tray. */
  const removeNotification = (id: string) => {
    notificationMap.value = new Map([...notificationMap.value].filter(([, v]) => v.id !== id))
  }

  /** Add a notification, or update the one with this key (keeping its time), and its toast. */
  const upsertNotification = (key: unknown, newNotification: NotificationInfo) => {
    const existing = notificationMap.value.get(key)
    const notification: NotificationInfo = {
      ...newNotification,
      timestamp: existing?.timestamp ?? newNotification.timestamp ?? Number(new Date()),
    }
    notificationMap.value = new Map(notificationMap.value).set(key, notification)
    const finished = isFinished(notification)
    if (notification.showToast === true) {
      if (!existing) {
        toasts.show(toastContent(notification), {
          type: finished ? 'success' : undefined,
          ...(finished ? {} : { isLoading: true, autoClose: false, closeOnClick: false }),
          position: 'bottom-right',
          toastId: notification.id,
          closeButton: true,
          ...(notification.progress != null ? { progress: notification.progress } : {}),
        })
      } else {
        toasts.update(notification.id, {
          type: finished ? 'success' : 'default',
          isLoading: !finished,
          autoClose: null,
          render: toastContent(notification),
          progress: notification.progress ?? null,
        })
      }
    }
    if (finished) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        removeNotification(newNotification.id)
      }, COMPUTED_NOTIFICATION_STORAGE_TIME_MS)
      timers.add(timer)
    }
  }

  // The uploads the user asked for, summed into one notification, identified by its first upload.
  const uploadSummary = computed(() => {
    const entries = [...uploadsStore.uploads.entries()].filter(
      ([, data]) => data.kind === 'requestedByUser',
    )
    const first = entries[0]
    if (!first) return null
    const totalFiles = entries.length
    let sentFiles = 0
    let sentBytes = 0
    let totalBytes = 0
    for (const [, data] of entries) {
      if (data.sentBytes === data.totalBytes) sentFiles += 1
      sentBytes += data.sentBytes
      totalBytes += data.totalBytes
    }
    const sentMb = sentBytes / MB_BYTES
    const totalMb = totalBytes / MB_BYTES
    const message =
      sentFiles === totalFiles ?
        getText('uploadedXFilesNotification', totalFiles)
      : getText(
          'uploadingXFilesWithProgressNotification',
          sentFiles,
          totalFiles,
          sentMb < 1 ? sentMb.toFixed(2) : String(Math.ceil(sentMb)),
          totalMb < 1 ? totalMb.toFixed(2) : String(Math.ceil(totalMb)),
        )
    return {
      id: first[0],
      message,
      ...(sentFiles !== totalFiles ? { progress: sentBytes / totalBytes } : {}),
    }
  })

  watch(
    uploadSummary,
    (summary) => {
      if (summary == null) return
      // Each upload takes part in one notification only, so its first upload identifies it.
      // Upserted only when the message changes, as React did.
      if (notificationMap.value.get(summary.id)?.message === summary.message) return
      upsertNotification(summary.id, {
        id: summary.id,
        message: summary.message,
        icon: 'data_upload',
        ...(summary.progress != null ? { progress: summary.progress } : {}),
        showToast: true,
      })
    },
    { immediate: true },
  )

  const notifications = computed(() => [...notificationMap.value.values()].reverse())

  return { notifications, removeNotification }
}
