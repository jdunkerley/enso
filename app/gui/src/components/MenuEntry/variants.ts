/** @file Variants for a menu entry: shared by the React `#/components/MenuEntry` and `MenuEntry.vue`. */
import { tv } from '$/utils/style/tailwindVariants'

/** The styles of a menu entry's content. */
export const MENU_ENTRY_VARIANTS = tv({
  base: 'flex h-row grow place-content-between items-center rounded-inherit p-menu-entry text-left group-disabled:opacity-30 group-enabled:active',
  variants: {
    variant: {
      'context-menu': 'px-context-menu-entry-x',
    },
    hasHoverBackground: {
      true: 'group-enabled:hover:bg-hover-bg',
    },
  },
  defaultVariants: {
    hasHoverBackground: true,
  },
})
