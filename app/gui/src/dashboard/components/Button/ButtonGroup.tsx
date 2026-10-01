/** @file A group of buttons. */
import { forwardRef, Fragment, type PropsWithChildren, type ReactElement } from 'react'
import flattenChildren from 'react-keyed-flatten-children'

import { BUTTON_GROUP_STYLES as STYLES } from '$/components/Button/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import invariant from 'tiny-invariant'
import type { TestIdProps } from '../types'
import {
  ButtonGroupProvider,
  JoinedButtonPrivateContextProvider,
  ResetButtonGroupContext,
} from './shared'
import type { ButtonGroupSharedButtonProps, PrivateJoinedButtonPosition } from './types'

/** Props for a {@link ButtonGroup}. */
export interface ButtonGroupProps
  extends React.PropsWithChildren, VariantProps<typeof STYLES>, TestIdProps {
  readonly className?: string | undefined
  readonly buttonVariants?: ButtonGroupSharedButtonProps
}

/** A group of buttons. */
export const ButtonGroup = forwardRef(function ButtonGroupImpl(
  props: ButtonGroupProps,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const {
    children,
    className,
    gap,
    wrap,
    direction,
    width,
    align,
    variants = STYLES,
    verticalAlign,
    buttonVariants = {},
    testId,
    ...passthrough
  } = props

  const isJoin = gap === 'joined'

  if (IS_DEV_MODE) {
    const isColumnAndJoined = direction === 'column' && isJoin
    invariant(
      !isColumnAndJoined,
      'ButtonGroup: Joined mode is only supported for row direction, please implement column joined mode',
    )
  }

  return (
    <div
      ref={ref}
      className={variants({ gap, wrap, direction, align, verticalAlign, width, className })}
      data-testid={testId}
      {...passthrough}
    >
      <ResetButtonGroupContext>
        <ButtonGroupProvider {...buttonVariants}>
          {isJoin ?
            <JoinedButtons>{children}</JoinedButtons>
          : children}
        </ButtonGroupProvider>
      </ResetButtonGroupContext>
    </div>
  )
})

/**
 * A wrapper for a button group that joins the buttons together.
 * Adds custom styles to the buttons.
 */
function JoinedButtons(props: PropsWithChildren) {
  const { children } = props

  // `flattenChildren` is typed as returning `ReactChild` — element, string or number — but
  // everything passed here is an element, and the mapping below reads `.key`.
  // eslint-disable-next-line no-restricted-syntax
  return (flattenChildren(children) as ReactElement[]).map(
    (child: ReactElement, index: number, array: ReactElement[]) => {
      if (array.length === 1) {
        return <Fragment key={child.key}>{child}</Fragment>
      }

      let position: PrivateJoinedButtonPosition = 'middle'

      if (index === 0) {
        position = 'first'
      }

      if (index === array.length - 1) {
        position = 'last'
      }

      return (
        <JoinedButtonPrivateContextProvider key={child.key} isJoined position={position}>
          {child}
        </JoinedButtonPrivateContextProvider>
      )
    },
  )
}

/**
 * A button group that joins the buttons together.
 */
export function ButtonGroupJoin(props: ButtonGroupProps) {
  return <ButtonGroup {...props} direction="row" gap="joined" />
}
