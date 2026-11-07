/**
 * @file A component's documentation page on the documentation site: F1 on the selected component,
 * and the button in the component help panel. Both open `<base>api/<apiPath>/` (#566's follow-up).
 */
import type { Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import * as locate from './locate'

/** `Data.read`'s page, under the documentation root the app is configured with. */
async function dataReadPage(page: Page) {
  const base = await page.evaluate(
    () => (window as unknown as { $config: { DOCS_URL: string } }).$config.DOCS_URL,
  )
  return `${base.replace(/\/+$/, '')}/api/Standard.Base/Data/read/`
}

/** Record the URLs the app opens, instead of opening a window. */
async function recordOpenedUrls(page: Page) {
  await page.evaluate(() => {
    const opened: string[] = []
    Object.assign(window, { openedUrls: opened })
    window.open = (url) => {
      opened.push(String(url))
      return null
    }
  })
}

/** The engine's answer for `data = Data.read`. */
const DATA_READ = {
  methodPointer: {
    module: 'Standard.Base.Data',
    definedOnType: 'Standard.Base.Data',
    name: 'read',
  },
  notAppliedArguments: [],
}

const openedUrls = (page: Page) =>
  page.evaluate(() => (window as unknown as { openedUrls: string[] }).openedUrls)

test('F1 opens the selected component’s page on the documentation site', async ({
  editorPage,
  page,
}) => {
  await editorPage.mockMethodCallInfo('data', DATA_READ)
  await recordOpenedUrls(page)
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'data')).click()
  await page.keyboard.press('F1')
  await expect.poll(() => openedUrls(page)).toEqual([await dataReadPage(page)])
})

test('F1 on the user’s own component opens nothing', async ({ editorPage, page }) => {
  await editorPage
  await recordOpenedUrls(page)
  // `final = Main.func1 prod`: defined in the project.
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'final')).click()
  await page.keyboard.press('F1')
  // The handler reports why there is no page; by then it has not opened anything.
  await expect(page.getByTestId('toast-host')).toContainText('Unable to show node documentation')
  expect(await openedUrls(page)).toEqual([])
})

test('the component help panel has a button to the page', async ({ editorPage, page }) => {
  await editorPage.mockMethodCallInfo('data', DATA_READ)
  await recordOpenedUrls(page)
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'data')).click()
  await page.getByRole('tab', { name: 'Component help' }).click()
  await page.getByRole('button', { name: 'Open in documentation site' }).click()
  await expect.poll(() => openedUrls(page)).toEqual([await dataReadPage(page)])
})
