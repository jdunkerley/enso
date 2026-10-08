/** @file Styles for a scroller (`Scroller.vue`). */
import { tv } from '$/utils/style/tailwindVariants'

export const SCROLLER_STYLES = tv({
  base: 'relative w-auto min-w-0',
  variants: {
    scrollbar: {
      false: {
        content: 'no-scrollbar',
      },
    },
    background: {
      primary: {
        shadowStart: 'from-dashboard',
        shadowEnd: 'from-dashboard',
      },
      secondary: {
        shadowStart: 'from-background/80',
        shadowEnd: 'from-background/80',
      },
      white: {
        shadowStart: 'from-white',
        shadowEnd: 'from-white',
      },
    },
    orientation: {
      horizontal: {
        content: 'overflow-x-auto min-w-0 max-w-full',
        shadowStart: 'top-0 bottom-0 left-0 w-10 bg-gradient-to-r',
        shadowEnd: 'top-0 bottom-0 right-0 w-10 bg-gradient-to-l',
      },
      vertical: {
        content: 'overflow-y-auto min-h-0 max-h-full',
        shadowStart: '-top-[0.5px] left-0 right-0 min-h-1 h-[25%] max-h-10 bg-gradient-to-b',
        shadowEnd: '-bottom-[0.5px] left-0 right-0 min-h-1 h-[25%] max-h-10 bg-gradient-to-t',
      },
    },
    fullSize: { true: '' },
    snap: { true: { content: 'snap-proximity' } },
    startHidden: {
      true: { shadowStart: 'opacity-0' },
      false: { shadowStart: 'opacity-100' },
    },
    endHidden: {
      true: { shadowEnd: 'opacity-0' },
      false: { shadowEnd: 'opacity-100' },
    },
    showShadows: {
      true: '',
      false: { shadowStart: 'hidden', shadowEnd: 'hidden' },
    },
  },

  slots: {
    content: '',
    shadowStart: 'pointer-events-none absolute transition-opacity',
    shadowEnd: 'pointer-events-none absolute transition-opacity',
  },

  compoundVariants: [
    {
      orientation: 'horizontal',
      snap: true,
      class: { content: 'snap-x' },
    },
    {
      orientation: 'vertical',
      snap: true,
      class: { content: 'snap-y' },
    },
    {
      orientation: 'horizontal',
      fullSize: true,
      class: { content: 'min-w-full' },
    },
    {
      orientation: 'vertical',
      fullSize: true,
      class: { content: 'min-h-full' },
    },
  ],

  defaultVariants: {
    scrollbar: false,
    snap: false,
    orientation: 'horizontal',
    showShadows: true,
    startHidden: true,
    endHidden: true,
    background: 'primary',
    fullSize: false,
  },
})
