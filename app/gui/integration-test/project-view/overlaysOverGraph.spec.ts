/**
 * @file Overlays (the About dialog, Settings) opened over the graph editor own their keys and
 * the click that dismisses them: the graph must not act on either.
 */
import type { Locator, Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import { railButton, TEXT } from '../actions'
import * as locate from './locate'

/** Select a node, and leave the mouse over the graph (the graph's `Enter` needs a mouse position). */
async function selectNode(page: Page) {
  const node = locate.graphNodeByBinding(page, 'five')
  await locate.graphNodeIcon(node).click()
  await expect(node).toBeSelected()
  return node
}

/** The graph is as it was: no component browser, the same nodes, `node` still the selection. */
async function expectGraphUntouched(page: Page, node: Locator, nodeCount: number) {
  await expect(locate.componentBrowser(page)).toHaveCount(0)
  await expect(locate.graphNode(page)).toHaveCount(nodeCount)
  await expect(node).toBeSelected()
  await expect(locate.selectedNodes(page)).toHaveCount(1)
}

test('Settings, opened from the rail with the keyboard, does not reach the graph', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await selectNode(page)
  const settings = railButton(page, TEXT.settingsShortcut)
  await settings.focus()
  await expect(settings).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await expect(locate.componentBrowser(page)).toHaveCount(0)
})

test('About, opened from the rail, closes on Escape, and only it', async ({ editorPage, page }) => {
  await editorPage
  const node = await selectNode(page)
  const nodeCount = await locate.graphNode(page).count()
  await railButton(page, TEXT.aboutThisAppShortcut).click()
  const about = page.getByRole('dialog', { name: TEXT.aboutThisAppShortcut })
  await expect(about).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(about).toHaveCount(0)
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
