/** @file Constants for integration tests. */
import { TEXTS } from 'enso-common/src/text'

export const TEXT = TEXTS.english

/**
 * Where to leave the mouse after clicking the left rail, so that the pointer is off it: the rail
 * runs the window's full height, so the window's corner (0, 0) is on it. This is in the top bar,
 * between the rails, where nothing is under the pointer that matters.
 */
export const MOUSE_OFF_RAIL = { x: 700, y: 0 } as const
