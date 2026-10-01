/**
 * @file Tailwind variants of the one-time-code input, shared by the React input and its Vue port.
 * See `variants.ts` for the `*_VUE_STATES` constants.
 */
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv } from '$/utils/style/tailwindVariants'

/** Styles of the OTPInput. */
export const OTP_INPUT_STYLES = tv({
  base: 'group flex overflow-hidden p-1 w-[calc(100%+8px)] -m-1 flex-1',
  slots: {
    slotsContainer: 'flex items-center justify-center flex-1 w-full gap-1',
  },
})
/** Styles of the OTPInput slot. */
export const OTP_SLOT_STYLES = tv({
  base: [
    'flex-1 h-10 min-w-8 flex items-center justify-center',
    'border border-primary rounded-xl',
    'outline outline-1 outline-transparent -outline-offset-2',
    'transition-[outline-offset] duration-200',
  ],
  variants: {
    isActive: { true: 'relative outline-offset-0 outline-2 outline-primary' },
    isInvalid: { true: { base: 'border-danger', char: 'text-danger' } },
  },
  slots: {
    char: TEXT_STYLE({ variant: 'body', weight: 'bold', color: 'current' }),
    fakeCaret:
      'absolute pointer-events-none inset-0 flex items-center justify-center animate-caret-blink before:w-px before:h-5 before:bg-primary',
  },
  compoundVariants: [{ isActive: true, isInvalid: true, class: { base: 'outline-danger' } }],
})
