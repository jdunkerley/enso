/**
 * @file Styles for the Vue `DropdownMenu` primitive (Reka UI `DropdownMenu`).
 *
 * These mirror `MENU_STYLES` and `MENU_ITEM_STYLES` of the React `#/components/Menu`, and reuse
 * the dashboard's existing `variants.ts` building blocks, so a ported menu looks the same. The
 * react-aria render props that drive the React styles (`isHovered`, `isFocusVisible`,
 * `isDisabled`) have no Vue counterpart; Reka exposes the same states as attributes instead, so
 * they are matched with Tailwind's built-in `data-[…]:` and `aria-*:` variants rather than the
 * `tailwindcss-react-aria-components` modifiers (which only match react-aria's own elements).
 * See `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`, decision 5.
 */
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv } from '$/utils/style/tailwindVariants'

export const MENU_STYLES = tv({
  base: [
    'z-50 flex min-w-[200px] max-w-[300px] flex-col overflow-x-hidden rounded-3xl p-1.5 shadow-xl',
    'duration-200 ease-out animate-in fade-in',
    // `placement-*:` in the React `POPOVER_STYLES`; Reka reports the side it actually used.
    'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
    'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
  ],
  variants: {
    variant: {
      light: DIALOG_BACKGROUND({ variant: 'light' }),
      dark: DIALOG_BACKGROUND({ variant: 'dark' }),
    },
  },
  defaultVariants: { variant: 'light' },
})

export const MENU_ITEM_STYLES = tv({
  base: [
    'group flex w-full cursor-default select-none gap-3 rounded-3xl px-[14px] py-1 text-left outline-none',
    'transition-colors duration-75',
    // `MENU_ITEM_STYLES({ isSelected: isHovered || isFocusVisible })` in React: Reka moves a
    // single "highlight" with both the pointer and the keyboard.
    'data-[highlighted]:bg-primary/5',
    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30',
  ],
  slots: {
    title: TEXT_STYLE({
      variant: 'body',
      color: 'primary',
      className: 'block w-full flex-1 truncate',
    }),
  },
})

export const MENU_SEPARATOR_STYLES = tv({
  base: 'mx-2 my-1.5 h-[0.5px] rounded-full bg-primary/10',
})
