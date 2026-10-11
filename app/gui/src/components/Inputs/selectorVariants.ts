/**
 * @file Tailwind variants of the selector and the multi-selector.
 * See `variants.ts` for the `*_VUE_STATES` constants.
 */
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv } from '$/utils/style/tailwindVariants'

/** Styles of the Selector. */
export const SELECTOR_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    readOnly: { true: 'cursor-default' },
    size: {
      medium: { base: '' },
      small: { base: '' },
    },
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    variant: {
      outline: {
        base: 'border-[0.5px] border-primary/20',
      },
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxlarge',
    variant: 'outline',
  },
  slots: {
    radioGroup: 'grid',
  },
})
/** Styles of the SelectorOption. */
export const SELECTOR_OPTION_STYLES = tv({
  base: 'flex flex-1 w-full cursor-pointer',
  variants: {
    rounded: {
      // specified in compoundSlots
      none: '',
      small: '',
      medium: '',
      large: '',
      xlarge: '',
      xxlarge: '',
      xxxlarge: '',
      full: '',
    },
    size: {
      medium: { base: 'min-h-[31px]', radio: 'px-[9px] py-[3.5px]' },
      small: { base: 'min-h-6', radio: 'px-[7px] py-[1.5px]' },
    },
    isHovered: {
      true: '',
      false: '',
    },
    isSelected: {
      // specified in compoundVariants
      true: 'bg-primary',
      false: '',
    },
    isFocusVisible: {
      // specified in compoundVariants
      true: {
        radio:
          'outline outline-2 outline-transparent outline-offset-[-6px] focus-visible:outline-primary focus-visible:outline-offset-[2px] transition-[outline-offset] duration-200',
      },
      false: '',
    },

    isPressed: {
      // specified in compoundVariants
      true: '',
      false: '',
    },

    variant: {
      // specified in compoundVariants
      outline: '',
    },
  },
  slots: {
    radio: TEXT_STYLE({
      className:
        'relative flex flex-1 w-full items-center justify-center transition-colors duration-200',
      variant: 'body',
    }),
    hover:
      'absolute inset-x-0 inset-y-0 transition-[background-color,transform] duration-200 isolate',
  },
  compoundSlots: [
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'none',
      class: 'rounded-none',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'small',
      class: 'rounded-sm',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'medium',
      class: 'rounded-md',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'large',
      class: 'rounded-lg',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xlarge',
      class: 'rounded-xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xxlarge',
      class: 'rounded-2xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'xxxlarge',
      class: 'rounded-3xl',
    },
    {
      slots: ['radio', 'base', 'hover'],
      rounded: 'full',
      class: 'rounded-full',
    },
  ],
  compoundVariants: [
    {
      variant: 'outline',
      isSelected: true,
      class: { radio: TEXT_STYLE({ variant: 'body', color: 'invert' }) },
    },
    {
      variant: 'outline',
      isHovered: true,
      isSelected: false,
      class: { hover: 'bg-invert/50' },
    },
    {
      variant: 'outline',
      isPressed: true,
      class: { hover: 'bg-invert scale-x-[0.95] scale-y-[0.85]' },
    },
    {
      variant: 'outline',
      isSelected: false,
      class: { radio: TEXT_STYLE({ variant: 'body', color: 'primary' }) },
    },
    {
      size: 'small',
      class: { hover: 'inset-[2px]' },
    },
    {
      size: 'medium',
      class: { hover: 'inset-[3px]' },
    },
  ],
  defaultVariants: {
    size: 'medium',
    rounded: 'xxxlarge',
    variant: 'outline',
  },
})
/** Styles of the MultiSelector. */
export const MULTI_SELECTOR_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    readOnly: { true: 'cursor-default' },
    size: {
      medium: '',
    },
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    variant: {
      outline: 'border-[0.5px] border-primary/20',
      'separate-outline': { listBox: 'gap-2' },
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxlarge',
    variant: 'outline',
  },
  slots: {
    listBox: 'grid',
  },
})
/** Styles of the MultiSelectorOption. */
export const MULTI_SELECTOR_OPTION_STYLES = tv({
  base: TEXT_STYLE({
    className:
      'flex flex-1 items-center justify-center min-h-8 relative overflow-clip cursor-pointer transition-[background-color,color,outline-offset] duration-200',
    variant: 'body',
  }),
  variants: {
    rounded: {
      none: 'rounded-none',
      small: 'rounded-sm',
      medium: 'rounded-md',
      large: 'rounded-lg',
      xlarge: 'rounded-xl',
      xxlarge: 'rounded-2xl',
      xxxlarge: 'rounded-3xl',
      full: 'rounded-full',
    },
    size: {
      medium: { base: 'px-[11px] pb-1.5 pt-2' },
      small: { base: 'px-[11px] pb-0.5 pt-1' },
    },
    color: {
      primary:
        'selected:bg-primary selected:text-white hover:bg-primary/5 pressed:bg-primary/10 outline outline-2 outline-transparent outline-offset-[-2px] focus-visible:outline-primary focus-visible:outline-offset-0',
    },
    variant: {
      default: '',
      outline: 'border-[0.5px] border-primary/20',
    },
  },
  defaultVariants: {
    size: 'medium',
    rounded: 'xxxlarge',
    color: 'primary',
    variant: 'default',
  },
})
/**
 * The Vue `MultiSelector` option's spelling of `MULTI_SELECTOR_OPTION_STYLES`'s `selected:` and
 * `pressed:`, for a Reka `ListboxItem` (`aria-selected`, native `:active`).
 */
export const MULTI_SELECTOR_OPTION_VUE_STATES =
  'aria-selected:bg-primary aria-selected:text-white active:bg-primary/10'
