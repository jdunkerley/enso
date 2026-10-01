/** @file An option in a selector. */
import { Radio, type RadioProps } from '#/components/aria'
import { SELECTOR_OPTION_STYLES } from '$/components/Inputs/selectorVariants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { forwardRef, memo, type ForwardedRef } from 'react'

/** Props for a {@link SelectorOption}. */
export interface SelectorOptionProps
  extends RadioProps, VariantProps<typeof SELECTOR_OPTION_STYLES> {
  readonly label: string
  readonly isSelected: boolean
}

export const SelectorOption = memo(
  forwardRef(function SelectorOptionImpl(
    props: SelectorOptionProps,
    ref: ForwardedRef<HTMLLabelElement>,
  ) {
    const {
      label,
      isSelected,
      value,
      size,
      rounded,
      variant,
      className,
      variants = SELECTOR_OPTION_STYLES,
      ...radioProps
    } = props

    const styles = variants({ size, rounded, variant, isSelected })

    return (
      <div className={styles.base()}>
        <Radio
          ref={ref}
          {...radioProps}
          value={value}
          className={(renderProps) => {
            return styles.radio({
              className: typeof className === 'function' ? className(renderProps) : className,
              ...renderProps,
            })
          }}
        >
          {({ isHovered, isPressed }) => (
            <>
              <div className={styles.hover({ isHovered, isSelected, isPressed })} />
              <span className="isolate">{label}</span>
            </>
          )}
        </Radio>
      </div>
    )
  }),
)
