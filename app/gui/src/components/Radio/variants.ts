/**
 * @file Tailwind variants of the radio button and the radio group (`Radio.vue` and
 * `RadioGroup.vue`).
 */
import { tv } from '$/utils/style/tailwindVariants'

export const RADIO_STYLES = tv({
  base: 'flex items-center gap-2 cursor-pointer group w-full',
  variants: {
    isFocused: { true: 'outline-none' },
    isFocusVisible: { true: { radio: 'outline outline-2 outline-primary outline-offset-1' } },
    isSelected: {
      false: { radio: 'border-2 border-primary/30' },
      true: { radio: 'border-primary border-[5px]' },
    },
    isHovered: { true: { radio: 'border-primary/50' } },
    isInvalid: { true: { radio: 'border-danger' } },
    isDisabled: { true: { base: 'cursor-not-allowed', radio: 'border-gray-200' } },
    isPressed: { true: { radio: 'border-[3px] border-primary' } },
    isSiblingPressed: { true: '' },
  },
  slots: {
    radio:
      'w-4 h-4 rounded-full bg-frame aspect-square flex-none transition-[border-color,border-width,outline-offset] duration-50 ease-in-out',
    input: 'sr-only',
    label: 'flex-1 shrink-0',
  },
  compoundVariants: [
    { isPressed: true, isSelected: true, class: { radio: 'border-[5px]' } },
    { isPressed: true, isInvalid: true, class: { radio: 'border-red-800' } },
    { isSiblingPressed: true, isSelected: true, class: { radio: 'border-4' } },
  ],
})

export const RADIO_GROUP_STYLES = tv({
  base: 'flex flex-col gap-0.5 items-start',
  variants: { fullWidth: { true: 'w-full' } },
})
