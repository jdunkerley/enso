/**
 * @file Styles for an icon (`$/components/Icon/Icon.vue`).
 */
import { tv, type VariantProps } from '$/utils/style/tailwindVariants'

export const ICON_STYLES = tv({
  base: 'flex-none aspect-square w-full h-full [&>svg]:stroke-current [&>svg]:w-full [&>svg]:h-full',
  variants: {
    color: {
      custom: '',
      primary: 'text-primary',
      danger: 'text-danger',
      success: 'text-accent-dark',
      accent: 'text-accent-dark',
      muted: 'text-primary/50',
      disabled: 'text-disabled',
      invert: 'text-invert',
      inherit: 'text-inherit',
      current: 'text-current',
    },
    size: {
      xsmall: 'h-2 w-2',
      small: 'h-3 w-3',
      medium: 'h-4 w-4',
      large: 'h-5 w-5',
      xlarge: 'h-6 w-6',
      xxlarge: 'h-7 w-7',
      xxxlarge: 'h-8 w-8',
      xxxxlarge: 'h-9 w-9',
      full: 'h-full w-full',
    },
  },
  defaultVariants: {
    color: 'current',
    size: 'medium',
  },
})

/** The variant props of {@link ICON_STYLES}. */
export type IconVariants = VariantProps<typeof ICON_STYLES>

export const ICON_COLORS = [
  'custom',
  'primary',
  'danger',
  'success',
  'accent',
  'muted',
  'disabled',
  'invert',
  'inherit',
  'current',
] as const satisfies readonly IconVariants['color'][]

export const ICON_DISPLAY_STYLES = tv({
  base: 'flex items-center gap-2 max-w-[14.5rem] min-w-4 px-[7px] border-0.5 border-transparent',
  slots: {
    visualTooltip: 'flex',
    icon: '-mb-0.5',
    // For some reason `min-w-0` is required for the ellipsis to appear.
    container: 'flex min-w-0',
    text: 'block truncate',
  },
  variants: {
    variant: {
      custom: '',
      link: 'inline-block px-0 py-0 rounded-sm text-primary/50 underline border-0',
      primary: 'bg-primary text-white',
      accent: 'bg-accent text-white',
      ghost: 'text-primary',
      submit: 'bg-invite text-white opacity-80',
      outline: 'border-0.5 rounded-full border-primary/20 text-primary px-1 mx-1',
    },
    align: {
      left: { container: 'mr-auto' },
      center: { container: 'mx-auto' },
      right: { container: 'ml-auto' },
    },
  },
  defaultVariants: {
    variant: 'custom',
    iconPosition: 'default',
    align: 'center',
  },
})
