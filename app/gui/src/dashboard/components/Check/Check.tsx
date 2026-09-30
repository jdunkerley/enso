/** @file A checkmark icon. */
import { CHECK_CLASSES } from '$/components/Checkbox/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'

/** Props for a {@link Check}. */
export interface CheckProps extends VariantProps<typeof CHECK_CLASSES> {
  readonly className?: string | undefined
  readonly isIndeterminate?: boolean | undefined
}

/**
 * A checkmark icon
 * Can be used to indicate that an item is selected. Has an indeterminate state.
 */
export function Check(props: CheckProps) {
  const {
    isSelected = false,
    isIndeterminate = false,
    variants = CHECK_CLASSES,
    className,
    color,
    rounded,
    size,
  } = props

  const styles = variants({ isSelected, className, color, rounded, size })

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      className={styles.base()}
      role="presentation"
      pointerEvents="none"
    >
      <path
        className={styles.path()}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        stroke="currentColor"
        fill="none"
        d={
          isIndeterminate ? 'M5 8H11'
          : isSelected ?
            'M4 8.4L6.5 10.9L9.25 8.15L12 5.4'
          : ''
        }
      />
    </svg>
  )
}
