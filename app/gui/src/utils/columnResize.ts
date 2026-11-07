/** @file The width arithmetic of a resizable table column, independent of any table. */

/** The narrowest and widest a column may be, in pixels. */
export interface WidthLimits {
  readonly min: number
  readonly max: number
}

/** The step of an arrow key on a resize handle, in pixels. */
export const RESIZE_STEP_PX = 10
/** The step of Shift and an arrow key on a resize handle, in pixels. */
export const RESIZE_LARGE_STEP_PX = 50

/** A width brought inside its limits, in whole pixels. */
export function clampWidth(width: number, limits: WidthLimits): number {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)))
}

/**
 * What a key pressed on a column's resize handle does: the column's new width (Left and Right
 * arrows, by {@link RESIZE_STEP_PX}, or {@link RESIZE_LARGE_STEP_PX} with Shift), `'reset'` to its
 * default width (Enter and Home), or `null` for a key the handle leaves alone, which includes every
 * key pressed with Ctrl, Alt or Meta.
 */
export function widthForKey(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  width: number,
  limits: WidthLimits,
): number | 'reset' | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  const step = event.shiftKey ? RESIZE_LARGE_STEP_PX : RESIZE_STEP_PX
  switch (event.key) {
    case 'ArrowLeft':
      return clampWidth(width - step, limits)
    case 'ArrowRight':
      return clampWidth(width + step, limits)
    case 'Enter':
    case 'Home':
      return 'reset'
    default:
      return null
  }
}
