/** @file The JSON visualization's lazy tree: expand, show more, double-click, a failed page. */
import { expect, test, type Locator, type Page } from 'integration-test/base'
import * as actions from './actions'
import * as locate from './locate'

/** Open the JSON visualization on the `aggregated` node (`actions.openVisualization` picks it). */
async function openTree(page: Page) {
  await actions.openVisualization(page, 'JSON')
  const vis = locate.jsonVisualization(page)
  await expect(vis).toExist()
  return vis
}

function entry(vis: Locator, text: string) {
  return vis.locator('.TreeRow.entry').filter({ hasText: text })
}

async function scrollToBottom(vis: Locator) {
  await vis.getByTestId('tree-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight))
}

/** The computed `transform` of a branch's chevron. */
function chevronTransform(row: Locator) {
  return row.locator('.arrow .chevron').evaluate((el) => getComputedStyle(el).transform)
}

test('Expanding a branch loads its first page, and Show more the next', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await expect(vis).toContainText('items: [150 items]')
  const items = entry(vis, 'items: [150 items]')
  // The chevron is drawn (the scoped styles reach the shadow DOM) and rotates when the branch opens.
  const chevron = items.locator('.arrow .chevron')
  await expect(chevron).toBeVisible()
  const box = await chevron.boundingBox()
  expect(box?.width).toBeGreaterThan(0)
  expect(box?.height).toBeGreaterThan(0)
  expect(await chevronTransform(items)).toBe('none')
  await items.getByRole('button', { name: 'Expand' }).click()
  await expect(vis).toContainText('0: 0')
  await expect(items.getByRole('button', { name: 'Collapse' })).toBeVisible()
  await expect.poll(() => chevronTransform(items)).not.toBe('none')
  await scrollToBottom(vis)
  const more = vis.getByRole('button', { name: 'Show 50 more (of 150)' })
  await expect(more).toBeVisible()
  await more.click()
  await scrollToBottom(vis)
  await expect(vis).toContainText('149: 149')
  await expect(vis.locator('.TreeRow.more')).toHaveCount(0)
})

test('Double-click on an entry creates a node for it', async ({ editorPage, page }) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'items: [150 items]').getByRole('button', { name: 'Expand' }).click()
  const nodeCount = await locate.graphNode(page).count()
  await vis
    .locator('.TreeRow.entry .content')
    .filter({ hasText: /^3: 3$/ })
    .dblclick()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).__codeEditorApi.textContent()))
    .toContain("aggregated.get 'items' . at 3")
})

test('An entry with no expression creates nothing', async ({ editorPage, page }) => {
  await editorPage
  const vis = await openTree(page)
  const nodeCount = await locate.graphNode(page).count()
  await vis
    .locator('.TreeRow.entry .content')
    .filter({ hasText: /^visualizedExpr:/ })
    .dblclick()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount)
})

test('A failed page shows its message and a retry, and the rest stays usable', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'broken: {1 key}').getByRole('button', { name: 'Expand' }).click()
  await expect(vis).toContainText("couldn't load: boom")
  await expect(vis.getByRole('button', { name: 'Retry' })).toBeVisible()
  await entry(vis, 'nested: {1 key}').getByRole('button', { name: 'Expand' }).click()
  await expect(vis).toContainText('deep: true')
})
