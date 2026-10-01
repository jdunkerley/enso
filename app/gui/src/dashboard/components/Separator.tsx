/** @file A visual separator. */
import {
  Separator as AriaSeparator,
  type SeparatorProps as AriaSeparatorProps,
} from '#/components/aria'
import { tv, type VariantProps } from '$/utils/style/tailwindVariants'

// `orientation` is React Aria's prop (and also selects the variant); the variant props' copy of it
// is left out, as its type differs under `exactOptionalPropertyTypes` (TS2320 from TypeScript 6).
/** The props for {@link Separator} component. */
export interface SeparatorProps
  extends AriaSeparatorProps, Omit<VariantProps<typeof SEPARATOR_STYLES>, 'orientation'> {
  readonly className?: string | undefined
}

/** The styles for the {@link Separator} component. */
// eslint-disable-next-line react-refresh/only-export-components
export const SEPARATOR_STYLES = tv({
  base: 'rounded-full border-none',
  variants: {
    size: {
      thin: '',
      medium: '',
      thick: '',
    },
    orientation: {
      horizontal: 'w-full',
      vertical: 'h-full',
    },
    variant: {
      current: 'bg-current',
      primary: 'bg-primary/30',
      inverted: 'bg-white/30',
    },
  },
  defaultVariants: {
    // `size: 'thin'` causes the separator to disappear on Firefox.
    size: 'medium',
    orientation: 'horizontal',
    variant: 'primary',
  },
  compoundVariants: [
    {
      size: 'thin',
      orientation: 'horizontal',
      class: 'h-[0.5px]',
    },
    {
      size: 'thin',
      orientation: 'vertical',
      class: 'w-[0.5px]',
    },
    {
      size: 'medium',
      orientation: 'horizontal',
      class: 'h-[1px]',
    },
    {
      size: 'medium',
      orientation: 'vertical',
      class: 'w-[1px]',
    },
    {
      size: 'thick',
      orientation: 'horizontal',
      class: 'h-1',
    },
    {
      size: 'thick',
      orientation: 'vertical',
      class: 'w-1',
    },
  ],
})

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
