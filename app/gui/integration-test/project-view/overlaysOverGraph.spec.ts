/**
 * @file Overlays (the user menu, the About dialog) opened over the graph editor own their keys and
 * the click that dismisses them: the graph must not act on either.
 */
import type { Locator, Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import { TEXT } from '../actions'
import * as locate from './locate'

/** Select a node, and leave the mouse over the graph (the graph's `Enter` needs a mouse position). */
async function selectNode(page: Page) {
  const node = locate.graphNodeByBinding(page, 'five')
  await locate.graphNodeIcon(node).click()
  await expect(node).toBeSelected()
  return node
}

async function openUserMenu(page: Page) {
  await page.getByLabel(TEXT.userMenuLabel).locator('visible=true').click()
  const menu = page.getByTestId('user-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toBeFocused()
  return menu
}

/** The graph is as it was: no component browser, the same nodes, `node` still the selection. */
async function expectGraphUntouched(page: Page, node: Locator, nodeCount: number) {
  await expect(locate.componentBrowser(page)).toHaveCount(0)
  await expect(locate.graphNode(page)).toHaveCount(nodeCount)
  await expect(node).toBeSelected()
  await expect(locate.selectedNodes(page)).toHaveCount(1)
}

test('Keys pressed in the user menu do not reach the graph', async ({ editorPage, page }) => {
  await editorPage
  const node = await selectNode(page)
  const nodeCount = await locate.graphNode(page).count()
  const menu = await openUserMenu(page)

  // Focus on the menu itself: none of the graph's shortcuts fires.
  for (const key of ['Enter', ' ', 'Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key)
    await expect(menu).toBeVisible()
  }
  await expectGraphUntouched(page, node, nodeCount)

  // Tab to Settings: Enter activates the entry, and only the entry.
  const settings = menu.getByRole('button', { name: TEXT.settingsShortcut })
  for (let i = 0; i < 6 && !(await settings.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab')
  await expect(settings).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await expect(locate.componentBrowser(page)).toHaveCount(0)
})

test('Escape closes the user menu, and only the menu', async ({ editorPage, page }) => {
  await editorPage
  const node = await selectNode(page)
  const nodeCount = await locate.graphNode(page).count()
  const menu = await openUserMenu(page)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expectGraphUntouched(page, node, nodeCount)
})

test('About opened with its shortcut from the graph closes on Escape', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const node = await selectNode(page)
  const nodeCount = await locate.graphNode(page).count()
  await page.keyboard.press('ControlOrMeta+/')
  const about = page.getByRole('dialog', { name: TEXT.aboutThisAppShortcut })
  await expect(about).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(locate.componentBrowser(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
  await expectGraphUntouched(page, node, nodeCount)
})
