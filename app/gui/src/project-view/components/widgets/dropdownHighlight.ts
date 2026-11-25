/**
 * @file The keyboard highlight of a dropdown's list (`DropdownWidget`): where a key moves it, and
 * how far to scroll the list to show it. Framework-free.
 */

/** A move of the highlight: one entry up or down, or to the first or the last entry. */
export type HighlightMove = 'up' | 'down' | 'first' | 'last'

/**
 * The index the highlight moves to among `count` entries, or `undefined` when there are none.
 *
 * `current` is the highlighted index, or `undefined` before anything is highlighted; then the move
 * starts from `start` (the entry chosen now), as if it were highlighted, the way the kind picker's
 * list opens on the chosen kind. With neither, Down goes to the first entry and Up to the last.
 * Up and Down wrap around at the ends, as they do in the kind picker.
 */
export function movedHighlight(
  current: number | undefined,
  move: HighlightMove,
  count: number,
  start?: number,
): number | undefined {
  if (count <= 0) return undefined
  if (move === 'first') return 0
  if (move === 'last') return count - 1
  const from = current ?? start
  if (from == null || from < 0 || from >= count) return move === 'down' ? 0 : count - 1
  const step = move === 'down' ? 1 : -1
  return (from + step + count) % count
}

/** An item's vertical extent and the visible part of the list it scrolls in, in the list's own coordinates. */
export interface ScrollGeometry {
  /** The item's top and bottom, measured from the top of the list's content. */
  itemTop: number
  itemBottom: number
  /** The list's current `scrollTop` and visible height (`clientHeight`). */
  scrollTop: number
  viewHeight: number
  /** Space kept between the item and the list's edge (the list's padding). */
  margin: number
}

/** The `scrollTop` that shows the item, moving the list as little as possible (none if it is in sight). */
export function scrollTopToShow({
  itemTop,
  itemBottom,
  scrollTop,
  viewHeight,
  margin,
}: ScrollGeometry): number {
  if (itemTop - margin < scrollTop) return Math.max(itemTop - margin, 0)
  if (itemBottom + margin > scrollTop + viewHeight) return itemBottom + margin - viewHeight
  return scrollTop
}
