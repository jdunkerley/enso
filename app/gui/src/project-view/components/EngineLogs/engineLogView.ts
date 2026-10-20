/** @file Geometry of the Logs tab's virtualised list: fixed-height rows, rendered near the viewport only. */

/** The height of one row; rows are one line each. */
export const ROW_HEIGHT_PX = 18
/** Rows rendered beyond each edge of the viewport, so that a fast scroll does not show blanks. */
export const OVERSCAN_ROWS = 20

/** The rows to render, `start` inclusive and `end` exclusive. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  count: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS)
  const end = Math.min(
    count,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT_PX) + OVERSCAN_ROWS,
  )
  return { start, end }
}

/** Whether the list is scrolled to its end, give or take a row: it then follows new rows. */
export function isNearBottom(
  element: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= ROW_HEIGHT_PX
}
