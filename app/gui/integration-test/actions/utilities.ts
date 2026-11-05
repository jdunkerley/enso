/** @file Constants for integration tests. */
import { TEXTS } from 'enso-common/src/text'
import type { Page } from 'integration-test/base'

export const TEXT = TEXTS.english

/**
 * Leave the mouse where nothing is under it and it is off both rails: at the empty bottom of the
 * right rail, whose tabs are all at the top. The left rail runs the window's full height, so the
 * window's corner is on it, and so is a tab bar's start; the rail expands under a pointer that rests
 * on it for 550ms. Computed from the window, so it holds for any viewport.
 */
export async function parkMouse(page: Page) {
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  await page.mouse.move(width - 24, height - 100)
}
