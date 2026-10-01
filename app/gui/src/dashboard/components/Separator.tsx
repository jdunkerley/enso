/** @file A visual separator. */
import {
  Separator as AriaSeparator,
  type SeparatorProps as AriaSeparatorProps,
} from '#/components/aria'
import { SEPARATOR_STYLES } from '$/components/Separator/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'

// `orientation` is React Aria's prop (and also selects the variant); the variant props' copy of it
// is left out, as its type differs under `exactOptionalPropertyTypes` (TS2320 from TypeScript 6).
/** The props for {@link Separator} component. */
export interface SeparatorProps
  extends AriaSeparatorProps, Omit<VariantProps<typeof SEPARATOR_STYLES>, 'orientation'> {
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
