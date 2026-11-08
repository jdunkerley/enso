/**
 * @file F1 opens the component help (the right panel's Help tab) on the selected component, and the
 * help panel's "View on docs site" link opens the component's page on the documentation site,
 * `<base>api/<apiPath>/`, for the components that have one.
 */
import type { Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import { mockUserDefinedFunctionInfo } from './expressionUpdates'
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

const helpTab = (page: Page) => page.getByRole('tab', { name: 'Component help' })
const docsSiteLink = (page: Page) =>
  locate.rightDock(page).getByRole('link', { name: 'View on docs site' })

test('F1 opens the component help on the selected component', async ({ editorPage, page }) => {
  await editorPage.mockMethodCallInfo('data', DATA_READ)
  await recordOpenedUrls(page)
  await expect(helpTab(page)).toHaveAttribute('aria-selected', 'false')
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'data')).click()
  await page.keyboard.press('F1')
  await expect(helpTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(locate.rightDock(page)).toContainText('Reads a file into Enso')
  // A second F1 keeps the panel open.
  await page.keyboard.press('F1')
  await expect(helpTab(page)).toHaveAttribute('aria-selected', 'true')
  expect(await openedUrls(page)).toEqual([])
})

test('F1 with nothing selected opens the component help', async ({ editorPage, page }) => {
  await editorPage
  await page.keyboard.press('F1')
  await expect(helpTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(locate.rightDock(page)).toContainText('Select a single component')
})

test('F1 on the user’s own component opens its help, with no link to the site', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await recordOpenedUrls(page)
  // `final = Main.func1 prod`: defined in the project, whose documentation the mock does not have.
  await mockUserDefinedFunctionInfo(page, 'final', 'func1')
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'final')).click()
  await page.keyboard.press('F1')
  await expect(helpTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(locate.rightDock(page)).toContainText('No documentation available')
  await expect(docsSiteLink(page)).toHaveCount(0)
  expect(await openedUrls(page)).toEqual([])
})

test('the component help links to the page on the site', async ({ editorPage, page }) => {
  await editorPage.mockMethodCallInfo('data', DATA_READ)
  await recordOpenedUrls(page)
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'data')).click()
  await page.keyboard.press('F1')
  await docsSiteLink(page).click()
  await expect.poll(() => openedUrls(page)).toEqual([await dataReadPage(page)])
})
