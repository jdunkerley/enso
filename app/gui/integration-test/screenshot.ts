/**
 * @file Screenshot comparisons, which run on Linux only.
 *
 * Baselines exist only for Linux (`*-linux.png`), where CI runs the suite. Chromium rasterises text
 * with a different engine on each platform: on Windows about a fifth of the pixels of the code-font
 * samples differ from the Linux baseline, although the images have the same size and look the same
 * by eye. Committing `*-win32.png` baselines as well was rejected - nothing would keep them
 * current, since CI never compares them, and they would record one machine's rendering. Anywhere
 * else the comparison is skipped and recorded as an annotation, while the rest of the test (CSS,
 * layout, behaviour) still runs.
 */
import {
  expect,
  test,
  type Locator,
  type Page,
  type PageAssertionsToHaveScreenshotOptions,
} from './base'

/** Whether this platform has screenshot baselines. */
export const SCREENSHOT_BASELINES_AVAILABLE = process.platform === 'linux'

/**
 * `expect(page).toHaveScreenshot(name, options)` on Linux; elsewhere, an annotation saying that the
 * comparison was skipped.
 */
export async function expectScreenshot(
  page: Page | Locator,
  name: string,
  options?: PageAssertionsToHaveScreenshotOptions,
) {
  if (!SCREENSHOT_BASELINES_AVAILABLE) {
    test.info().annotations.push({
      type: 'screenshot skipped',
      description: `${name}: baselines are Linux-only; ${process.platform} renders text differently.`,
    })
    return
  }
  // Each has its own assertion; they share the screenshot options that matter here.
  if (isPage(page)) await expect(page).toHaveScreenshot(name, options)
  else await expect(page).toHaveScreenshot(name, options)
}

/** Whether `target` is a whole page, rather than a locator in one. */
function isPage(target: Page | Locator): target is Page {
  return 'mainFrame' in target
}
