/**
 * @file Tailwind variants of the checkbox, its check mark and the checkbox group, shared by the React
 * `Checkbox`, `Check` and `CheckboxGroup` and their Vue ports in this folder.
 */
import { tv } from '$/utils/style/tailwindVariants'

export const CHECK_CLASSES = tv({
  base: ['flex-none aspect-square', 'transition-[outline-offset,border-width] duration-200'],
  variants: {
    isSelected: {
      true: { base: 'border-transparent' },
      false: '',
    },
    // Defined in compoundVariants
    color: {
      custom: { base: '' },
      primary: { base: 'border-primary' },
      accent: { base: 'border-accent' },
      error: { base: 'border-danger' },
    },
    variant: {
      custom: { base: '' },
      outline: { base: 'border-[0.5px]' },
    },
    rounded: {
      custom: { base: '' },
      none: { base: 'rounded-none' },
      full: { base: 'rounded-full' },
      large: { base: 'rounded-lg' },
      medium: { base: 'rounded-md' },
      small: { base: 'rounded-sm' },
      xlarge: { base: 'rounded-xl' },
      xxlarge: { base: 'rounded-2xl' },
      xxxlarge: { base: 'rounded-3xl' },
    },
    size: {
      small: { base: 'w-3 h-3' },
      medium: { base: 'w-4 h-4' },
      large: { base: 'w-5 h-5' },
    },
  },
  slots: { path: '' },
  defaultVariants: {
    size: 'medium',
    rounded: 'medium',
    color: 'primary',
    isPressed: false,
    isSelected: false,
    isIndeterminate: false,
    variant: 'outline',
  },
  compoundVariants: [
    {
      isSelected: true,
      color: 'primary',
      class: { base: 'bg-primary text-white' },
    },
    {
      isSelected: true,
      color: 'accent',
      class: { base: 'bg-accent text-white' },
    },
    {
      isSelected: true,
      color: 'error',
      class: { base: 'bg-danger text-white' },
    },
  ],
})

export const CHECKBOX_STYLES = tv({
  base: 'group flex gap-2 items-center cursor-pointer select-none',
  variants: {
    isInvalid: {
      true: {
        base: 'text-danger',
        icon: 'border-danger focus-within:border-danger focus-within:outline-danger',
      },
    },
    isReadOnly: {
      true: { icon: 'bg-primary/50 border-primary/50' },
    },
    isDisabled: {
      true: { icon: 'bg-primary/30 border-primary/30 cursor-not-allowed' },
      false: '',
    },
    isSelected: {
      true: { icon: 'bg-primary text-white' },
      false: { icon: 'bg-transparent text-primary' },
    },
    size: { medium: { icon: 'w-4 h-4' } },
  },
  slots: {
    icon: [
      'border-[0.5px] rounded-md transition-[outline-offset,border-width] duration-200',
      'outline -outline-offset-2 outline-transparent group-focus-visible:outline-offset-0 group-focus-visible:outline-primary',
      'border-primary group-selected:border-transparent',
      'group-pressed:border',
      'shrink-0',
    ],
  },
  defaultVariants: {
    size: 'medium',
  },
  compoundVariants: [
    {
      isInvalid: true,
      isSelected: true,
      class: {
        icon: 'bg-danger border-danger focus-within:border-danger focus-within:outline-danger',
      },
    },
  ],
})

export const CHECKBOX_GROUP_STYLES = tv({
  base: 'flex flex-col gap-0.5 items-start',
  variants: { fullWidth: { true: 'w-full' } },
})

/**
 * The Vue checkbox's spelling of the react-aria-only modifiers in `CHECKBOX_STYLES`'s icon
 * (`group-selected:`, `group-pressed:`, `group-focus-visible:`), which key on attributes react-aria
 * sets on its `<label>`. The Vue `<label>` has the native input inside it instead (decision 5).
 */
export const CHECKBOX_VUE_STATES =
  'group-data-[selected=true]:border-transparent group-active:border group-has-[:focus-visible]:outline-offset-0 group-has-[:focus-visible]:outline-primary'
