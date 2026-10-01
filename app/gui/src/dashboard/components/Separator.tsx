/** @file A visual separator. */
import {
  Separator as AriaSeparator,
  type SeparatorProps as AriaSeparatorProps,
} from '#/components/aria'
import { SEPARATOR_STYLES } from '$/components/Separator/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'

/** The props for {@link Separator} component. */
export interface SeparatorProps extends AriaSeparatorProps, VariantProps<typeof SEPARATOR_STYLES> {
  readonly className?: string | undefined
}

/** A visual separator. */
export function Separator(props: SeparatorProps) {
  const {
    orientation = 'horizontal',
    variant,
    variants = SEPARATOR_STYLES,
    className,
    size,
    ...rest
  } = props

  const styles = variants({ orientation, variant, size, className })

  return <AriaSeparator orientation={orientation} className={styles} {...rest} />
}

export { SEPARATOR_STYLES } from '$/components/Separator/variants'
