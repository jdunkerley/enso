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
  // The open chevron is turned a quarter turn: `rotate(90deg)` computes to this matrix.
  await expect.poll(() => chevronTransform(items)).toBe('matrix(0, 1, -1, 0, 0, 0)')
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
  await entry(vis, 'items: [150 items]').getByRole('button', { name: 'Expand' }).click()
  const nodeCount = await locate.graphNode(page).count()
  await vis
    .locator('.TreeRow.entry .content')
    .filter({ hasText: /^visualizedExpr:/ })
    .dblclick()
  // A node would be created asynchronously, so a count taken right away proves nothing. A valid
  // entry afterwards shows the first double-click was handled: exactly one node, not two.
  await vis
    .locator('.TreeRow.entry .content')
    .filter({ hasText: /^3: 3$/ })
    .dblclick()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
})

test('Shift+double-click creates a node for each entry beside it that has an expression', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  const nodeCount = await locate.graphNode(page).count()
  // Of the four root entries, `visualizedExpr` has no expression: `items`, `nested` and `broken` do.
  await entry(vis, 'nested: {1 key}')
    .locator('.content')
    .dblclick({ modifiers: ['Shift'] })
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 3)
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

test('Retry on a failed page loads it when the next request succeeds', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'broken: {1 key}').getByRole('button', { name: 'Expand' }).click()
  await expect(vis).toContainText("couldn't load: boom")
  await vis.getByRole('button', { name: 'Retry' }).click()
  await expect(vis).toContainText('recovered: true')
  await expect(vis).not.toContainText("couldn't load")
  await expect(vis.getByRole('button', { name: 'Retry' })).toHaveCount(0)
})

test('Right-click on an entry opens only the tree menu, and leaves the selection alone', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  // With two nodes selected, a right-click that selected the visualized one alone would shrink it.
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'sum')).click({ modifiers: ['Shift'] })
  await expect(locate.selectedNodes(page)).toHaveCount(2)
  await entry(vis, 'nested: {1 key}').locator('.content').click({ button: 'right' })
  const menu = page.getByTestId('gridPopupMenu')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Get Value', { exact: true })).toBeVisible()
  await expect(menu.getByText('Get All Loaded Values Here')).toBeVisible()
  // Not the node's or the graph's own menu.
  await expect(page.getByTestId('contextMenu')).toHaveCount(0)
  await expect(locate.selectedNodes(page)).toHaveCount(2)
  const nodeCount = await locate.graphNode(page).count()
  await menu.getByText('Get All Loaded Values Here').click()
  // Of the four root entries, `visualizedExpr` has no expression: `items`, `nested` and `broken` do.
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 3)
  await expect(menu).toHaveCount(0)
})

test('Right-click on an entry with no expression opens no menu at all', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await vis
    .locator('.TreeRow.entry .content')
    .filter({ hasText: /^visualizedExpr:/ })
    .click({ button: 'right' })
  await expect(page.getByTestId('gridPopupMenu')).toHaveCount(0)
  await expect(page.getByTestId('contextMenu')).toHaveCount(0)
})
