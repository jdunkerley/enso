/**
 * @file Keeping a button's press to itself, as react-aria's `usePress` did for every React button:
 * it stopped the click, and the Enter or Space that pressed it, from reaching the elements around
 * it. The drive's table relies on that: a press on a button in a row must not also select the row,
 * and Enter on a focused button must not also open the selected asset. The Vue `Button` lets the
 * events through, so the drive's buttons that sit in the table bind these handlers.
 */

/** Stop a press's click, and the key that pressed it, at the button. */
export const STOP_PRESS_PROPAGATION = {
  onClick: (event: MouseEvent) => {
    event.stopPropagation()
  },
  onKeydown: (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  },
} as const

/**
 * {@link STOP_PRESS_PROPAGATION}, and also the pointer press: for the drop zone's button, whose
 * surroundings clear the selection on a pointer press.
 */
export const STOP_PRESS_AND_POINTER_PROPAGATION = {
  ...STOP_PRESS_PROPAGATION,
  onPointerdown: (event: PointerEvent) => {
    event.stopPropagation()
  },
} as const
