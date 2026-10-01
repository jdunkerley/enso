/** @file Alert component. */
import { forwardRef, type ForwardedRef, type HTMLAttributes, type PropsWithChildren } from 'react'

import { ALERT_STYLES } from '$/components/Alert/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { Icon } from '../Icon'
import type { IconProp } from '../types'

/** Props for an {@link Alert}. */
export interface AlertProps<IconType extends string = string>
  extends PropsWithChildren, VariantProps<typeof ALERT_STYLES>, HTMLAttributes<HTMLDivElement> {
  /** The icon to display in the Alert */
  readonly icon?: IconProp<IconType> | null | undefined
}

/** Alert component. */
export const Alert = forwardRef(function AlertImpl<IconType extends string = string>(
  props: AlertProps<IconType>,
  ref: ForwardedRef<HTMLDivElement>,
) {
  const {
    children,
    className,
    variant,
    size,
    rounded,
    fullWidth,
    icon,
    variants = ALERT_STYLES,
    tabIndex: rawTabIndex,
    role: rawRole,
    ...containerProps
  } = props

  const tabIndex = variant === 'error' ? -1 : rawTabIndex
  const role = variant === 'error' ? 'alert' : rawRole

  const classes = variants({
    variant,
    size,
    rounded,
    fullWidth,
  })

  return (
    <div
      className={classes.base({ className })}
      ref={ref}
      tabIndex={tabIndex}
      role={role}
      {...containerProps}
    >
      {icon != null && <Icon icon={icon} size="medium" className={classes.iconContainer()} />}

      <div className={classes.children()}>{children}</div>
    </div>
  )
})

export { ALERT_STYLES } from '$/components/Alert/variants'
