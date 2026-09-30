/** @file A text display with an icon. */
import { Icon } from '#/components/Icon'
import { Text, type TextProps } from '#/components/Text'
import type { IconProp } from '#/components/types'
import { VisualTooltip, type TooltipElementType } from '#/components/VisualTooltip'
import { ICON_DISPLAY_STYLES } from '$/components/Icon/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'

/** Props for an {@link IconDisplay}. */
export interface IconDisplayProps<IconType extends string>
  extends
    Omit<TextProps, 'children' | 'variant' | 'variants'>,
    VariantProps<typeof ICON_DISPLAY_STYLES> {
  readonly icon: IconProp<IconType>
  readonly children: TooltipElementType
}

/** A text display with an icon. */
export function IconDisplay<IconType extends string>(props: IconDisplayProps<IconType>) {
  const {
    icon,
    children,
    variant,
    variants = ICON_DISPLAY_STYLES,
    tooltip,
    className,
    ...textProps
  } = props

  const styles = variants({ variant, align: props.align })

  return (
    <div className={styles.base({ className })}>
      <VisualTooltip className={styles.visualTooltip()} tooltip={tooltip} tooltipPlacement="left">
        <Icon color={textProps.color} className={styles.icon()} size="medium" icon={icon} />
      </VisualTooltip>
      <div className={styles.container()}>
        <Text className={styles.text()} truncate="1" {...textProps} tooltip={children}>
          {children}
        </Text>
      </div>
    </div>
  )
}
