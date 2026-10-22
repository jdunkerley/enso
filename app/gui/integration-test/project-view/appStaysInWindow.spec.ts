/**
 * @file The app never scrolls inside its window (#318). `#enso-app` clips its overflow, but code can
 * still scroll it, and CodeMirror scrolls every ancestor that overflows: anything reaching below the
 * window let the docked code editor shift the whole app up, hiding the top bar and leaving an empty
 * strip at the bottom.
 */
import { expect, test, type Page } from 'integration-test/base'
import * as locate from './locate'

async function appRootScroll(page: Page) {
  return page.evaluate(() => {
    const root = document.getElementById('enso-app')!
    return {
      scrollTop: root.scrollTop,
      overflow: root.scrollHeight - root.clientHeight,
    }
  })
}

test('paging down in the docked code editor does not scroll the app up', async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    // The fixture leaves the Drive panel open: its shadow was what reached below the window.
    await expect(page.getByTestId('drive-view')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+`')
    const dock = locate.bottomDock(page)
    await dock.locator('.cm-content').click()
    expect((await appRootScroll(page)).scrollTop).toBe(0)

    for (let i = 0; i < 6; i++) await page.keyboard.press('PageDown')

    await expect.poll(() => appRootScroll(page)).toEqual({ scrollTop: 0, overflow: 0 })
    await expect(page.locator('.TabBar')).toBeInViewport({ ratio: 1 })
  })
})
