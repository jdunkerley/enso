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

/**
 * Scroll an entry into view and let the scroll event it causes arrive. The tree closes its menu on
 * scroll, and the event comes a frame after the scroll, so a right-click straight after
 * Playwright's own scroll into view would lose its menu.
 */
async function scrollIntoViewSettled(content: Locator) {
  await content.scrollIntoViewIfNeeded()
  await content.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
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

test('Right-click on an entry offers Get Value, which makes the double-click node', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'items: [150 items]').getByRole('button', { name: 'Expand' }).click()
  const nodeCount = await locate.graphNode(page).count()
  const content = vis.locator('.TreeRow.entry .content').filter({ hasText: /^3: 3$/ })
  await scrollIntoViewSettled(content)
  await content.click({ button: 'right' })
  await page.getByTestId('gridPopupMenu').getByText('Get Value', { exact: true }).click()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).__codeEditorApi.textContent()))
    .toContain("aggregated.get 'items' . at 3")
})

test('Get All Loaded Values Here makes a node for each entry beside the clicked one', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  const content = entry(vis, 'nested: {1 key}').locator('.content')
  await scrollIntoViewSettled(content)
  await content.click({ button: 'right' })
  await page
    .getByTestId('gridPopupMenu')
    .getByText('Get All Loaded Values Here', { exact: true })
    .click()
  // `visualizedExpr` has no expression; `items`, `nested` and `broken` each make a node.
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  for (const key of ['items', 'nested', 'broken']) {
    await expect
      .poll(() => page.evaluate(() => (window as any).__codeEditorApi.textContent()))
      .toContain(`aggregated.get '${key}'`)
  }
})

// === The keyboard ===

/** Focus the visualization itself, so that the next Tab goes to the tree's one tab stop. */
async function focusBeforeTree(vis: Locator) {
  await vis.evaluate((el) => (el as HTMLElement).focus())
}

const focusedRow = (vis: Locator) => vis.locator('.TreeRow:focus')

test('Tab enters the tree on its first entry, and the arrows move between entries', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  await focusBeforeTree(vis)
  await page.keyboard.press('Tab')
  const entries = vis.locator('.TreeRow.entry')
  await expect(entries.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(entries.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(entries.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(entries.nth(1)).toBeFocused()
  // The tree is one tab stop: Tab leaves it rather than stepping to the next entry.
  await page.keyboard.press('Tab')
  await expect(focusedRow(vis)).toHaveCount(0)
})

test('Right opens a branch and steps into it, and Enter makes a node for the entry', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  const items = entry(vis, 'items: [150 items]')
  await items.focus()
  await page.keyboard.press('ArrowRight')
  await expect(vis).toContainText('0: 0')
  await expect(items).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(entry(vis, '0: 0')).toBeFocused()
  const nodeCount = await locate.graphNode(page).count()
  await page.keyboard.press('Enter')
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  // Enter belongs to the tree: the graph's own Enter (the component browser) did not also act.
  await expect(page.locator('.ComponentBrowser')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).__codeEditorApi.textContent()))
    .toContain("aggregated.get 'items' . at 0")
})

test('Shift+F10 opens the entry menu, Escape closes it and returns the focus to the entry', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  const nested = entry(vis, 'nested: {1 key}')
  await nested.focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByTestId('gridPopupMenu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: /Get Value/ })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('button', { name: /Get All Loaded Values Here/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(nested).toBeFocused()
})

test('Enter on a menu item runs it, and the Enter goes no further', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const vis = await openTree(page)
  const nested = entry(vis, 'nested: {1 key}')
  await nested.focus()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByTestId('gridPopupMenu')
  await expect(menu).toBeVisible()
  const nodeCount = await locate.graphNode(page).count()
  await page.keyboard.press('Enter')
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect(menu).toHaveCount(0)
  // The graph clears the focus itself once it has made a node (`clearFocus` in `GraphEditor.vue`),
  // so there is no focus to check; the Enter must not also have opened the component browser.
  await expect(page.locator('.ComponentBrowser')).toHaveCount(0)
})

test('The menu key opens the entry menu and leaves it open', async ({ editorPage, page }) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'nested: {1 key}').focus()
  await page.keyboard.press('ContextMenu')
  const menu = page.getByTestId('gridPopupMenu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: /Get Value/ })).toBeFocused()
  // Windows fires the key's `contextmenu` on key up; give it, and anything else late, time.
  await page.waitForTimeout(500)
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('button', { name: /Get Value/ })).toBeFocused()
})

test('Show more from the keyboard keeps the focus in the tree', async ({ editorPage, page }) => {
  await editorPage
  const vis = await openTree(page)
  await entry(vis, 'items: [150 items]').getByRole('button', { name: 'Expand' }).click()
  await expect(vis).toContainText('0: 0')
  await scrollToBottom(vis)
  const more = vis.locator('.TreeRow.more')
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(vis).toContainText('100: 100')
  await expect(vis.locator('.TreeRow:focus')).toContainText('100: 100')
})
