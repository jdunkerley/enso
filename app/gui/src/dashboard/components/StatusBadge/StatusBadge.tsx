/** @file A status badge to notify the user of the state of an item. */
import { STATUS_BADGE_STYLES } from '$/components/Badge/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { PropsWithChildren } from 'react'

/** Props for a {@link StatusBadge}. */
export interface StatusBadgeProps
  extends Readonly<PropsWithChildren>, VariantProps<typeof STATUS_BADGE_STYLES> {}

/** A status badge to notify the user of the state of an item. */
export function StatusBadge(props: StatusBadgeProps) {
  const { variants = STATUS_BADGE_STYLES, color, hidden, children } = props

  const styles = variants({ color, hidden })

  return (
    <div className={styles.base()}>
      {children}
      <div className={styles.badge()} />
    </div>
  )
}
