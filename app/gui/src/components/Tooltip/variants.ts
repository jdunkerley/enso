/** @file Styles for a tooltip (`Tooltip.vue`). */
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv, type VariantProps } from '$/utils/style/tailwindVariants'

export const TOOLTIP_STYLES = tv({
  base: 'group flex justify-center items-center text-center min-w-10 [overflow-wrap:anywhere]',
  variants: {
    variant: {
      custom: '',
      primary: DIALOG_BACKGROUND({ variant: 'dark', className: 'text-invert' }),
      inverted: DIALOG_BACKGROUND({ variant: 'light', className: 'text-primary' }),
    },
    size: {
      custom: '',
      medium: TEXT_STYLE({ className: 'px-2 py-1', color: 'custom', balance: true }),
    },
    rounded: {
      custom: '',
      full: 'rounded-full',
      xxxlarge: 'rounded-3xl',
      xxlarge: 'rounded-2xl',
      xlarge: 'rounded-xl',
      large: 'rounded-lg',
      medium: 'rounded-md',
      small: 'rounded-sm',
      none: 'rounded-none',
    },
    maxWidth: {
      custom: '',
      xsmall: 'max-w-xs',
      small: 'max-w-sm',
      medium: 'max-w-md',
      large: 'max-w-lg',
      xlarge: 'max-w-xl',
    },
    isEntering: {
      true: 'animate-in fade-in placement-bottom:slide-in-from-top-0.5 placement-top:slide-in-from-bottom-0.5 placement-left:slide-in-from-right-0.5 placement-right:slide-in-from-left-0.5 ease-out duration-150',
    },
    isExiting: {
      true: 'animate-out fade-out placement-bottom:slide-out-to-top-0.5 placement-top:slide-out-to-bottom-0.5 placement-left:slide-out-to-right-0.5 placement-right:slide-out-to-left-0.5 ease-in duration-150',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'medium',
    maxWidth: 'xsmall',
    rounded: 'xxxlarge',
  },
})

/** The variant props of {@link TOOLTIP_STYLES}. */
export type TooltipVariants = VariantProps<typeof TOOLTIP_STYLES>

/**
 * The enter/exit motion of `Tooltip.vue` (a Reka `TooltipContent`), in place of
 * {@link TOOLTIP_STYLES}'s `isEntering`/`isExiting`. Those key the direction on `placement-*:`
 * (`[data-placement]`, see `STATE_VARIANTS` in `tailwind.config.ts`), which Reka does not set; it
 * reports the state as `data-state` and the side it used as `data-side` (decision 5 of
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 */
export const TOOLTIP_MOTION = [
  'data-[state$=open]:animate-in data-[state$=open]:fade-in data-[state$=open]:ease-out data-[state$=open]:duration-150',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:ease-in data-[state=closed]:duration-150',
  'data-[side=bottom]:slide-in-from-top-0.5 data-[side=top]:slide-in-from-bottom-0.5',
  'data-[side=left]:slide-in-from-right-0.5 data-[side=right]:slide-in-from-left-0.5',
].join(' ')
