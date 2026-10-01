/* eslint-disable react-refresh/only-export-components --
 * These files export a compound component built with `Object.assign(Component, { Sub })`.
 * eslint-plugin-react-refresh 0.5 cannot see through `Object.assign`, so it treats the file as
 * exporting a non-component and flags every local component in it. There is no `extraHOCs`
 * equivalent for this pattern. */
/**
 * @file
 * A dialog is an overlay shown above other content in an application.
 * Can be used to display alerts, confirmations, or other content.
 */
import * as aria from '#/components/aria'
import { DialogTrigger } from '#/components/Dialog/DialogTrigger'
import { ErrorBoundary } from '#/components/ErrorBoundary'
import { usePortalContext } from '#/components/Portal'
import * as suspense from '#/components/Suspense'
import { useEventCallback } from '#/hooks/eventCallbackHooks'
import { POPOVER_STYLES } from '$/components/Dialog/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import * as React from 'react'
import { ResetButtonGroupContext } from '../Button'
import type { Placement } from '../types'
import { Close } from './Close'
import { DialogProvider } from './DialogProvider'
import { DialogStackRegistrar } from './DialogStackProvider'
import { useInteractOutside } from './utilities'

/** Props for a {@link Popover}. */
export interface PopoverProps
  extends Omit<aria.PopoverProps, 'children' | 'placement'>, VariantProps<typeof POPOVER_STYLES> {
  readonly children:
    | React.ReactNode
    | ((opts: aria.PopoverRenderProps & { readonly close: () => void }) => React.ReactNode)
  readonly isDismissable?: boolean
  readonly placement?: Placement | undefined
  readonly onClose?: (() => void) | undefined
}

const SUSPENSE_LOADER_PROPS = { minHeight: 'h32' } as const

/**
 * A popover is an overlay element positioned relative to a trigger.
 * It can be used to display additional content or actions.
 */
export const Popover = Object.assign(
  React.forwardRef(function PopoverImpl(props: PopoverProps, ref: React.ForwardedRef<HTMLElement>) {
    const {
      children,
      className,
      size,
      rounded,
      variant,
      placement,
      isDismissable = true,
      onClose,
      ...ariaPopoverProps
    } = props

    const root = usePortalContext()
    const popoverStyle = { zIndex: '' }

    return (
      <aria.Popover
        ref={ref}
        className={(values) =>
          POPOVER_STYLES({
            isEntering: values.isEntering,
            isExiting: values.isExiting,
            size,
            rounded,
            variant,
          }).base({
            className: typeof className === 'function' ? className(values) : className,
          })
        }
        UNSTABLE_portalContainer={root}
        style={popoverStyle}
        shouldCloseOnInteractOutside={() => false}
        {...(placement != null ? { placement } : {})}
        {...ariaPopoverProps}
      >
        {(opts) => (
          <PopoverContent
            size={size}
            rounded={rounded}
            opts={opts}
            isDismissable={isDismissable}
            variant={variant}
            onClose={onClose}
          >
            {children}
          </PopoverContent>
        )}
      </aria.Popover>
    )
  }),
  {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Trigger: DialogTrigger,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Close,
  },
)

/**
 * Props for a {@link PopoverContent}.
 */
interface PopoverContentProps {
  readonly children: PopoverProps['children']
  readonly size: PopoverProps['size']
  readonly rounded: PopoverProps['rounded']
  readonly opts: aria.PopoverRenderProps
  readonly isDismissable: boolean
  readonly variant: PopoverProps['variant']
  readonly onClose?: (() => void) | undefined
}

/**
 * The content of a popover.
 */
function PopoverContent(props: PopoverContentProps) {
  const { children, size, rounded, opts, isDismissable, variant, onClose } = props

  const dialogRef = React.useRef<HTMLDivElement>(null)
  const dialogId = aria.useId()

  const contextState = React.useContext(aria.OverlayTriggerStateContext)
  const dialogContext = React.useContext(aria.DialogContext)

  // This is safe, because the labelledBy provided by DialogTrigger is always
  // passed to the DialogContext, and we check for undefined below.
  // eslint-disable-next-line no-restricted-syntax
  const labelledBy = (dialogContext as aria.DialogProps | undefined)?.['aria-labelledby']

  const close = useEventCallback(() => {
    contextState?.close()
    onClose?.()
  })

  useInteractOutside({
    ref: dialogRef,
    id: dialogId,
    onInteractOutside: (e) => {
      // Do not close dialog if another dialog was clicked.
      // This can happen in e.g. a `ComboBox` nested in a `Popover`.
      if (
        e.target instanceof HTMLElement &&
        e.target.dataset.testid !== 'underlay' &&
        document.getElementById('enso-portal-root')?.contains(e.target) === true
      ) {
        return
      }
      if (isDismissable) {
        close()
      }
    },
  })

  return (
    <ResetButtonGroupContext>
      <DialogStackRegistrar id={dialogId} type="popover" />
      <div
        id={dialogId}
        ref={dialogRef}
        role="dialog"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={POPOVER_STYLES({
          ...opts,
          size,
          rounded,
          variant,
        }).dialog()}
      >
        <DialogProvider dialogId={dialogId} close={close}>
          <ErrorBoundary>
            <suspense.Suspense loaderProps={SUSPENSE_LOADER_PROPS}>
              {typeof children === 'function' ? children({ ...opts, close }) : children}
            </suspense.Suspense>
          </ErrorBoundary>
        </DialogProvider>
      </div>
    </ResetButtonGroupContext>
  )
}

export { POPOVER_STYLES } from '$/components/Dialog/variants'
