/**
 * @file Tailwind variants of the switch, shared by the React
 * `Switch` and their Vue ports in this folder.
 */
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv } from '$/utils/style/tailwindVariants'

export const SWITCH_STYLES = tv({
  base: '',
  variants: {
    disabled: { true: 'cursor-not-allowed opacity-50' },
    halfway: {
      true: {
        background: 'bg-primary/50',
        thumb: 'translate-x-[50%]',
      },
    },
    size: {
      small: {
        background: 'h-4 w-7 p-0.5',
      },
    },
  },
  slots: {
    switch: 'group flex items-center gap-1',
    label: TEXT_STYLE({
      variant: 'body',
      color: 'primary',
      className: 'flex-1',
    }),
    background:
      'flex shrink-0 cursor-default items-center rounded-full bg-primary/30 bg-clip-padding shadow-inner outline-none ring-black transition duration-200 ease-in-out group-focus-visible:ring-2 group-pressed:bg-primary/60 group-selected:bg-primary group-selected:group-pressed:bg-primary/50',
    thumb:
      'aspect-square h-full flex-none translate-x-0 transform rounded-full bg-white transition duration-200 ease-in-out group-selected:translate-x-[100%]',
  },
  defaultVariants: {
    size: 'small',
    disabled: false,
  },
})
