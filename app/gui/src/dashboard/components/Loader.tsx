/** @file A full-screen loading spinner. */
import { StatelessSpinner, type SpinnerState } from '#/components/StatelessSpinner'
import {
  LOADER_SIZES as SIZE_MAP,
  LOADER_STYLES as STYLES,
  type LoaderSize,
} from '$/components/Spinner/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { memo } from 'react'

/** The possible sizes for a {@link Loader}. */
export type Size = LoaderSize

/** Props for a {@link Loader}. */
export interface LoaderProps extends VariantProps<typeof STYLES> {
  readonly children?: React.ReactNode
  readonly className?: string
  readonly size?: Size | number
  readonly state?: SpinnerState
}

/** A full-screen loading spinner. */

export const Loader = memo(function LoaderImpl(props: LoaderProps) {
  const {
    children,
    className,
    size: sizeRaw = 'medium',
    state = 'loading-fast',
    minHeight = 'full',
    color = 'primary',
    height = 'full',
  } = props

  const size = typeof sizeRaw === 'number' ? sizeRaw : SIZE_MAP[sizeRaw]

  return (
    <div className={STYLES({ minHeight, className, color, height })}>
      <div className="flex flex-col items-center gap-2">
        <StatelessSpinner size={size} phase={state} className="text-current" />
        {children}
      </div>
    </div>
  )
})
