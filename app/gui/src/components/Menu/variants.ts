/**
 * @file Styles for the Vue `DropdownMenu` primitive (Reka UI `DropdownMenu`).
 *
 * They reuse the dashboard's `variants.ts` building blocks. Reka exposes the hovered, focused and
 * disabled states as attributes, so they are matched with Tailwind's built-in `data-[…]:` and
 * `aria-*:` variants.
 * See `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`, decision 5.
 */
import { DIALOG_BACKGROUND } from '$/components/Dialog/variants'
import { SEPARATOR_STYLES } from '$/components/Separator/variants'
import { TEXT_STYLE } from '$/components/Text/variants'
import { tv } from '$/utils/style/tailwindVariants'

/** How close to the viewport's edges a menu may go, in pixels. */
export const MENU_CONTAINER_PADDING = 12

export const MENU_STYLES = tv({
  base: [
    'z-50 flex min-w-[200px] max-w-[300px] flex-col overflow-x-hidden rounded-3xl p-1.5 shadow-xl',
    'duration-200 ease-out animate-in fade-in',
    // Slides in from the trigger's side; Reka reports the side it actually used.
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
    // Reka moves a single "highlight" with both the pointer and the keyboard.
    'data-[highlighted]:bg-primary/5',
    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30',
  ],
  slots: {
    row: 'flex w-full gap-2',
    icon: 'mt-[3.5px] h-4 w-4 flex-none text-primary',
    title: TEXT_STYLE({
      variant: 'body',
      color: 'primary',
      className: 'block w-full flex-1 truncate',
    }),
    // An item with a description: title above a caption.
    titleWithDescription: '-mt-[1px] flex w-full min-w-0 flex-1 flex-col',
    description: TEXT_STYLE({
      variant: 'caption',
      color: 'primary',
      disableLineHeightCompensation: true,
      className: '-mt-[4px] block w-full truncate',
    }),
    shortcut: TEXT_STYLE({
      variant: 'body',
      color: 'primary',
      nowrap: true,
      textSelection: 'none',
      transform: 'uppercase',
      className: 'mt-[1px] self-center truncate',
    }),
    submenuIndicator: 'h-4 w-4 flex-none self-center text-primary',
  },
})

export const MENU_SECTION_STYLES = tv({
  base: 'flex flex-col',
  slots: {
    header: TEXT_STYLE({
      variant: 'body-sm',
      weight: 'bold',
      color: 'muted',
      textSelection: 'none',
      className: 'block px-3.5 py-0.5',
    }),
  },
})

/** A thin `Separator`, inset. Render it with `size: 'thin'`. */
export const MENU_SEPARATOR_STYLES = tv({
  extend: SEPARATOR_STYLES,
  base: 'my-1.5 mx-2',
})
