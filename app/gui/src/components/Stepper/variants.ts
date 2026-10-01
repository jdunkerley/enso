/**
 * @file Tailwind variants of the stepper and its steps, shared by the React
 * `Stepper` and `Step` and their Vue ports in this folder.
 */
import { tv } from '$/utils/style/tailwindVariants'

export const STEPPER_STYLES = tv({
  base: 'flex flex-col items-center w-full gap-4',
  slots: {
    steps: 'flex items-center justify-between w-full',
    step: 'flex-1 last:flex-none',
    content: 'relative w-full',
  },
})

export const STEP_STYLES = tv({
  base: 'relative flex items-center gap-2 select-none',
  slots: {
    icon: 'w-6 h-6 border-0.5 flex-none border-current rounded-full flex items-center justify-center transition-colors duration-200',
    titleContainer: '-mt-1 flex flex-col items-start justify-start transition-colors duration-200',
    content: 'flex-1',
  },
  variants: {
    position: { first: 'rounded-l-full', last: 'rounded-r-full' },
    status: {
      completed: {
        base: 'text-primary',
        icon: 'bg-primary border-transparent text-invert',
        content: 'text-primary',
      },
      current: { base: 'text-primary', content: 'text-primary/30' },
      next: { base: 'text-primary/30', content: 'text-primary/30' },
    },
  },
})
