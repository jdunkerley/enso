/** @file Progress bar. */
import {
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps,
} from '#/components/aria'
import { PROGRESS_BAR_STYLES } from '$/components/ProgressBar/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'

/** `1` as a percentage. */
const WHOLE_PERCENTAGE = 100

/** Props for a {@link ProgressBar}. */
export interface ProgressBarProps
  extends
    Omit<AriaProgressBarProps, 'className' | 'value'>,
    VariantProps<typeof PROGRESS_BAR_STYLES> {
  /** A number from 0 (not yet started, or just started) to 1 (about to complete, or completed). */
  readonly progress: number | 'indeterminate'
  readonly className?: string
  readonly progressBarClassName?: string
}

/** Progress bar. */
export function ProgressBar(props: ProgressBarProps) {
  const {
    progress,
    variants = PROGRESS_BAR_STYLES,
    className,
    progressBarClassName,
    variant,
    ...rest
  } = props
  const progressNumber = progress === 'indeterminate' ? 1 : progress

  const styles = variants({ variant })

  return (
    <AriaProgressBar
      isIndeterminate={progress === 'indeterminate'}
      value={progressNumber}
      maxValue={1}
      {...rest}
    >
      {/* When indeterminate, the percentage is `undefined`, so a fallback must be provided. */}
      {({ percentage = WHOLE_PERCENTAGE }) => (
        <div className={styles.base({ className })}>
          <div
            className={styles.progressBar({ className: progressBarClassName })}
            style={
              variant === 'clipped' ?
                { clipPath: `polygon(0 0, ${percentage}% 0, ${percentage}% 100%, 0 100%)` }
              : { width: percentage + '%' }
            }
          >
            {progress === 'indeterminate' && <div className={styles.indeterminateProgressBar()} />}
          </div>
        </div>
      )}
    </AriaProgressBar>
  )
}
