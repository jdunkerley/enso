/**
 * @file A spinning arc that animates using the `dasharray-<percentage>` custom Tailwind
 * classes.
 */
import { ROTATING_ELEMENT_SIZE } from '$/components/Spinner/constants'
import {
  SPINNER_PHASE_CLASSES as SPINNER_CSS_CLASSES,
  type SpinnerPhase,
} from '$/components/Spinner/variants'
import * as React from 'react'
import { twJoin } from 'tailwind-merge'

export type { SpinnerPhase }

/** Props for a {@link Spinner}. */
export interface SpinnerProps {
  readonly size?: number
  readonly padding?: number
  readonly className?: string
  readonly phase: SpinnerPhase
  readonly thickness?: number
}

/** A spinning arc that animates using the `dasharray-<percentage>` custom Tailwind classes. */

export const Spinner = React.memo(function SpinnerImpl(props: SpinnerProps) {
  const { size, padding, className, phase, thickness = 3 } = props

  const cssClasses = twJoin('pointer-events-none', className)

  return (
    <svg
      width={size}
      height={size}
      className={cssClasses}
      style={{ padding }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-testid="spinner"
    >
      <rect
        x={thickness / 2}
        y={thickness / 2}
        width={ROTATING_ELEMENT_SIZE - thickness}
        height={ROTATING_ELEMENT_SIZE - thickness}
        rx={ROTATING_ELEMENT_SIZE / 2 - thickness / 2}
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={thickness}
        className={twJoin(
          'pointer-events-none origin-center !animate-spin-ease transition-stroke-dasharray',
          SPINNER_CSS_CLASSES[phase],
        )}
      />
    </svg>
  )
})
