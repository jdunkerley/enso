/**
 * @file The plan selector's styles: the grid of plan cards, and a card. Moved unchanged from the
 * React `PlanSelector` and `Card` (#88).
 */
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { tv } from '$/utils/style/tailwindVariants'

/** The scrolling grid of plan cards. */
export const PLAN_SELECTOR_STYLES = tv({
  base: DIALOG_BACKGROUND({
    className: 'w-full snap-x overflow-auto rounded-4xl scroll-hidden',
  }),
  variants: {
    showFreePlan: { true: { grid: '2xl:auto-cols-5' } },
  },
  slots: {
    grid: 'inline-grid min-w-full gap-6 p-6 grid-flow-col auto-cols-1fr justify-center md:auto-cols-2 lg:auto-cols-3 xl:auto-cols-4',
    card: 'min-w-72 snap-center',
  },
})

/** A plan's card. */
export const PLAN_CARD_STYLES = tv({
  base: 'flex flex-col border-0.5',
  variants: {
    elevated: {
      none: '',
      true: 'shadow-primary/15 shadow',
      small: 'shadow-primary/15 shadow-sm',
      medium: 'shadow-primary/15 shadow-md',
      large: 'shadow-primary/15 shadow-lg',
      xlarge: 'shadow-primary/15 shadow-xl',
      xxlarge: 'shadow-primary/15 shadow-2xl',
      xxxlarge: 'shadow-primary/15 shadow-3xl',
    },
    highlighted: {
      true: 'outline outline-1.5 -outline-offset-1 outline-primary',
      false: 'border-primary/30',
    },
    rounded: {
      none: '',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      xxxxlarge: 'rounded-4xl',
    },
    size: {
      medium: { base: 'p-[19.5px]', separator: '-mx-[19.5px]' },
    },
  },
  slots: {
    features: '',
    separator: 'w-auto',
  },
  defaultVariants: {
    elevated: 'none',
    rounded: 'xxxxlarge',
    size: 'medium',
  },
})
