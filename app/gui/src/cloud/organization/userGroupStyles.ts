/** @file The classes of the user-group tables' header cells and rows, as React's `tv()`s had them. */
import { tv } from '$/utils/style/tailwindVariants'

/** A header cell of a user-group table. */
export const USER_GROUPS_COLUMN_CLASS = tv({
  base: 'w-full border-x-2 border-transparent bg-clip-padding px-cell-x text-left text-sm font-semibold last:border-r-0',
})

/** A cell of a row of the user groups. */
export const USER_GROUP_CELL_CLASS =
  'rounded-r-full border-x-2 border-transparent bg-clip-padding px-cell-x first:rounded-l-full last:border-r-0'
