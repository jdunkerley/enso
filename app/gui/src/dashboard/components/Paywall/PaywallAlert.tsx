/** @file A paywall alert. */
import { Alert, type AlertProps } from '#/components/Alert'
import { Icon } from '#/components/Icon'
import * as paywall from '#/components/Paywall'
import { Text } from '#/components/Text'
import type { PaywallFeatureName } from '$/composables/paywall'
import * as React from 'react'
import { twJoin } from 'tailwind-merge'

/** Props for {@link PaywallAlert}. */
export interface PaywallAlertProps<IconType extends string> extends Omit<AlertProps, 'children'> {
  readonly feature: PaywallFeatureName
  readonly label: string
  readonly showUpgradeButton?: boolean
  readonly upgradeButtonProps?: Omit<paywall.UpgradeButtonProps<IconType>, 'feature'>
}

/** A paywall alert. */
export function PaywallAlert<IconType extends string>(
  props: PaywallAlertProps<IconType>,
): React.JSX.Element {
  const {
    label,
    showUpgradeButton = true,
    feature,
    upgradeButtonProps,
    className,
    ...alertProps
  } = props

  return (
    <Alert
      variant="outline"
      size="small"
      rounded="xlarge"
      className={twJoin('border border-primary/20', className)}
      {...alertProps}
    >
      <div className="flex items-center gap-2">
        <Icon icon="lock" className="h-5 w-5 flex-none text-primary" />

        <Text>
          {label}{' '}
          {showUpgradeButton && (
            <paywall.UpgradeButton
              feature={feature}
              variant="link"
              size="small"
              {...upgradeButtonProps}
            />
          )}
        </Text>
      </div>
    </Alert>
  )
}
