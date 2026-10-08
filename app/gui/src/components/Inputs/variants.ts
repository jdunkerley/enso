/**
 * @file Tailwind variants of the text input. The other inputs' variants are in the `*Variants.ts`
 * files beside it, one per family, so that each is bundled with the code that uses it.
 *
 * A few of those classes use state variants (`STATE_VARIANTS` in `tailwind.config.ts`) keyed on
 * attributes that Reka's elements do not always set: `selected:` is `[data-selected]`, `pressed:`
 * is `[data-pressed]`, `outside-visible-range:` is `[data-outside-visible-range]`, and `disabled:`
 * is `:disabled`, which non-native elements never match. The components add the equivalents keyed
 * on Reka's `data-*`/ARIA attributes from the `*_VUE_STATES` constants beside them, per decision 5
 * of `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 */
import { TEXT_STYLE } from '$/components/Text/variants'
import { makeRoundedStyles } from '$/utils/style/roundedStyles'
import { tv } from '$/utils/style/tailwindVariants'

export const INPUT_STYLES = tv({
  base: 'block w-full bg-transparent transition-[border-color,outline] duration-200',
  variants: {
    // All variants SHOULD use objects, otherwise extending from them with e.g. `{ base: '' }`
    // results in `readOnly: { true: 'cursor-default [object Object]' }` for example.
    disabled: {
      true: { base: 'cursor-default opacity-50', textArea: 'cursor-default' },
      false: { base: 'cursor-text', textArea: 'cursor-text' },
    },
    invalid: {
      // Specified in compoundVariants. Real classes depend on Variants
      true: '',
    },
    readOnly: {
      true: 'cursor-default',
      false: 'cursor-text',
    },
    size: {
      custom: '',
      small: { base: 'px-[11px] pb-0.5 pt-1', icon: 'size-3' },
      medium: { base: 'px-[11px] pb-[6.5px] pt-[8.5px]', icon: 'size-4' },
    },
    rounded: makeRoundedStyles('base'),
    variant: {
      custom: '',
      outline: {
        base: 'border-[0.5px] border-primary/20 outline-offset-2 focus-within:border-primary/50 focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-primary',
        textArea: 'border-transparent focus-within:border-transparent',
      },
    },
  },
  slots: {
    icon: 'flex-none',
    addonStart: 'mt-[-1px] flex flex-none items-center gap-1',
    addonEnd: 'mt-[-1px] flex flex-none items-center gap-1',
    content: 'flex items-center gap-2',
    inputContainer: TEXT_STYLE({
      className: 'relative flex max-h-32 min-h-6 w-full items-center overflow-clip',
      variant: 'body',
    }),
    selectorContainer: 'flex',
    description: 'pointer-events-none block select-none opacity-80',
    textArea: 'block h-auto max-h-full w-full resize-none bg-transparent',
    resizableSpan: TEXT_STYLE({
      className:
        'pointer-events-none invisible absolute block max-h-32 min-h-10 overflow-y-auto break-all',
      variant: 'body',
    }),
  },
  compoundVariants: [
    {
      invalid: true,
      variant: 'outline',
      class: 'border-danger focus-within:border-danger focus-within:outline-danger',
    },
    {
      readOnly: true,
      class: 'focus-within:outline-transparent',
    },
  ],
  defaultVariants: {
    size: 'medium',
    rounded: 'xlarge',
    variant: 'outline',
  },
})
