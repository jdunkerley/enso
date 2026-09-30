/** @file Styles for a progress bar, shared by the React `#/components/ProgressBar` and its Vue port. */
import { tv } from '$/utils/style/tailwindVariants'

export const PROGRESS_BAR_STYLES = tv({
  base: 'min-h-2 rounded-full bg-primary/10',
  variants: {
    variant: {
      rounded: '',
      clipped: { progressBar: 'w-full' },
    },
  },
  slots: {
    progressBar:
      'h-full overflow-clip bg-accent rounded-full transition-[width,clip-path] duration-1000',
    indeterminateProgressBar: 'animate-horizontal-loader-1/6 h-full w-1/6 bg-white/30',
  },
  defaultVariants: {
    variant: 'rounded',
  },
})
