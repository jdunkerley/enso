/** @file Styles for a separator, shared by the React `#/components/Separator` and its Vue port. */
import { tv } from '$/utils/style/tailwindVariants'

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
