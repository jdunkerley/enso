/**
 * @file The notification tray's notifications (#83).
 *
 * Notifications are computed from app state; the cloud uploads that were the only source are gone,
 * so the tray is always empty for now.
 */
import { computed, shallowRef, type Component } from 'vue'
import type { NotificationInfo } from './types'

/**
 * The notifications, newest first, and a way to remove one. `item` is the tray's item component,
 * which a source of notifications draws in its toasts (`NotificationItem.vue`, passed in by the
 * tray: ESLint's type service cannot resolve a `.vue` import in this subtree's `.ts` files).
 * @param _item - The tray's item component. Unused while there are no notifications to draw.
 */
export function useNotifications(_item: Component) {
  const notificationMap = shallowRef<ReadonlyMap<unknown, NotificationInfo>>(new Map())

  /** Remove a notification from the tray. */
  const removeNotification = (id: string) => {
    notificationMap.value = new Map([...notificationMap.value].filter(([, v]) => v.id !== id))
  }

  return {
    notifications: computed(() => [...notificationMap.value.values()].reverse()),
    removeNotification,
  }
}
