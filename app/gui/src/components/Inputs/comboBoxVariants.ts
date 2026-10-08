/**
 * @file Tailwind variants of the combo box.
 * See `variants.ts` for the `*_VUE_STATES` constants.
 */
import { makeRoundedStyles } from '$/utils/style/roundedStyles'
import { tv } from '$/utils/style/tailwindVariants'

/** Styles of the ComboBox. */
export const COMBO_BOX_STYLES = tv({
  base: 'w-full',
  variants: {
    rounded: makeRoundedStyles('inputContainer'),
    size: {
      custom: '',
      small: { inputContainer: 'px-[11px] pb-0.5 pt-1' },
      medium: { inputContainer: 'px-[11px] pb-[6.5px] pt-[8.5px]' },
    },
  },
  slots: {
    inputContainer: 'flex items-center gap-2 px-1.5 rounded-full border-0.5 border-primary/20',
    input: 'grow',
    resetButton: '',
    popover: 'py-2 w-[calc(var(--trigger-width)_+_48px)]',
    listBox: 'text-primary text-xs',
    listBoxItem: 'cursor-pointer rounded-full hover:bg-hover-bg px-2',
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xlarge',
  },
})
