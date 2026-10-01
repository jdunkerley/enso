/** @file Display the result of an operation. */
import type { SvgUseIcon, TestIdProps } from '#/components/types'
import {
  RESULT_STATUS_STYLES,
  RESULT_STYLES,
  type ResultStatus,
  type ResultStatusStyle,
} from '$/components/Result/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import * as objects from 'enso-common/src/utilities/data/object'
import type { JSX, PropsWithChildren, ReactElement } from 'react'
import { Icon } from './Icon'
import { Loader } from './Loader'
import { Text } from './Text'

const INFO_ICON = (
  // eslint-disable-next-line no-restricted-syntax
  <Text variant="custom" className="pb-0.5 text-xl leading-[0]" aria-hidden>
    i
  </Text>
)

const STATUS_ICONS = {
  loader: <Loader minHeight="h8" />,
  info: INFO_ICON,
  check: 'check',
  close: 'close',
} as const satisfies Record<ResultStatusStyle['icon'], ReactElement | SvgUseIcon>

const STATUS_ICON_MAP: Readonly<Record<Status, StatusIcon>> = objects.mapEntries(
  RESULT_STATUS_STYLES,
  (_status, { icon, ...colors }) => ({ icon: STATUS_ICONS[icon], ...colors }),
)

/** Possible statuses for a result. */
export type Status = ResultStatus

/** The corresponding icon and color for each status. */
interface StatusIcon {
  readonly icon: ReactElement | SvgUseIcon
  readonly colorClassName: string
  readonly bgClassName: string
}

/** Props for a {@link Result}. */
export interface ResultProps
  extends PropsWithChildren, VariantProps<typeof RESULT_STYLES>, TestIdProps {
  readonly className?: string
  readonly title?: JSX.Element | string
  readonly subtitle?: JSX.Element | string
  /**
   * The status of the result.
   * @default 'success'
   */
  readonly status?: ReactElement | Status
  readonly icon?: SvgUseIcon | false
}

/** Display the result of an operation. */
export function Result(props: ResultProps) {
  const { title, children, status = 'success', subtitle, className, icon, testId, centered } = props

  const statusIcon = typeof status === 'string' ? STATUS_ICON_MAP[status] : null
  const showIcon = icon !== false

  const classes = RESULT_STYLES({ centered })

  return (
    <section className={classes.base({ className })} data-testid={testId}>
      {showIcon ?
        <>
          {statusIcon != null ?
            <div className={classes.statusIcon({ className: statusIcon.bgClassName })}>
              {typeof statusIcon.icon === 'string' ?
                <Icon
                  icon={icon ?? statusIcon.icon}
                  className={classes.icon({ className: statusIcon.colorClassName })}
                />
              : statusIcon.icon}
            </div>
          : status}
        </>
      : null}

      {typeof title === 'string' ?
        <Text.Heading level={2} className={classes.title()} variant="subtitle">
          {title}
        </Text.Heading>
      : title}

      {typeof subtitle === 'string' ?
        <Text elementType="p" className={classes.subtitle()} balance variant="body">
          {subtitle}
        </Text>
      : subtitle}

      {children != null && <div className={classes.content()}>{children}</div>}
    </section>
  )
}
