/** @file Styles for a column's resize handle (`ColumnResizeHandle.vue`). */
import { tv } from '$/utils/style/tailwindVariants'

/**
 * The handle is an 8px strip centred on the column's right edge (inside the last column, where the
 * table's container would clip it); its line shows on hover, and stronger while it has keyboard
 * focus or is dragged.
 */
export const COLUMN_RESIZE_HANDLE_STYLES = tv({
  slots: {
    base: 'group/resize absolute -right-1 top-0 [:last-child>&]:right-0 z-1 flex h-full w-2 cursor-col-resize touch-none justify-center outline-none',
    line: 'my-1.5 w-0.5 rounded-full transition-colors group-hover/resize:bg-primary/30 group-focus-visible/resize:w-[3px] group-focus-visible/resize:bg-primary group-data-[dragging]/resize:bg-primary/60',
  },
})
