/** @file Types related to the `NotificationTray`. */
import type { IconVariants } from '$/components/Icon/variants'
import type { Icon } from '@/util/iconMetadata/iconName'

/** Information required to display a notification. */
export interface NotificationInfo {
  readonly id: string
  readonly message: string
  readonly icon: Icon
  /** A number from 0 (not started) to 1 (finished). */
  readonly progress?: number | 'indeterminate' | undefined
  readonly color?: IconVariants['color'] | undefined
  readonly timestamp?: number | undefined
  readonly showToast?: boolean | undefined
}
