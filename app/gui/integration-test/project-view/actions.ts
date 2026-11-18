import { expect, type Locator, type Page } from 'integration-test/base'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'
import { graphNodeByBinding } from './locate'

// =============
// === Graph ===
// =============

/** Click at spot where no node is. */
export function clickAtBackground(page: Page, x = 300, y = 300) {
  return locate.graphEditor(page).click({ position: { x, y } })
}

// ======================
// === Visualizations ===
// ======================

/**
 *  Open Table visualization
 *
 * This action ensures the table visualization is opened somewhere in the graph; currently it opens
 * visualization for `aggregate` node.
 */
export async function openVisualization(page: Page, visName: string) {
  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await page.keyboard.press('Space')
  await locate.toggleVisualizationSelectorButton(page).click()
  await page
    .getByTestId('visualization-selector-entries')
    .getByRole('button', { name: visName })
    .click()
}

// ===============
// === Widgets ===
// ===============

/**
 * The node's ＋ buttons, one per call with hidden parameters, shown while the node is the only
 * selected one. A nested call's comes first (after its own arguments); the last is the outer
 * call's, at the node's end.
 */
export function addArgumentButtons(node: Locator) {
  return node.getByRole('button', { name: 'Add argument' })
}

/** The open menu of a ＋ button. */
export function addArgumentMenu(page: Page) {
  return page.getByRole('dialog', { name: 'Add argument' })
}

/**
 * Select the node (by its left edge, clear of its widgets) and open the menu of one of its ＋
 * buttons: by default the outer call's.
 */
export async function openAddArgumentMenu(
  page: Page,
  node: Locator,
  button: Locator = addArgumentButtons(node).last(),
) {
  await node.click({ position: { x: 8, y: 8 } })
  await expect(node).toBeSelected()
  await button.click()
  await expect(addArgumentMenu(page)).toBeVisible()
  return addArgumentMenu(page)
}

/** Add the hidden parameter `name` to the node through a ＋ menu (by default the outer call's). */
export async function addArgument(page: Page, node: Locator, name: string, button?: Locator) {
  const menu = await openAddArgumentMenu(page, node, button)
  await menu.getByRole('button', { name: new RegExp(`^${name}( |$)`) }).click()
  await expect(menu).toBeHidden()
}

/**
 * Show a node's hidden arguments: pick every parameter the outer call's ＋ menu offers. Selecting
 * a node does not show them (#836).
 */
export async function showHiddenArguments(page: Page, node: Locator) {
  const menu = await openAddArgumentMenu(page, node)
  const names = await menu.locator('.parameterItem .name').allTextContents()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  for (const name of names) await addArgument(page, node, name)
}

/**
 * Create a Node with Table Input Widget.
 *
 * This function relies on automatically assigned binding and assome no more table nodes exist.
 * content is added as an argument to `Table.input` expression.
 */
export async function createTableNode(page: Page, content?: string) {
  // Adding `Table.new` component will display the widget
  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowser(page)).toBeVisible()
  // The browser focuses its input as it opens (#139); this check only makes a regression fail
  // here, rather than as an empty filter with `Data.read` selected.
  await expect(locate.componentBrowserInput(page)).toBeFocused()
  await page.keyboard.type('Table.input')
  // Wait for CB entry to appear; this way we're sure about node name (binding).
  await expect(locate.componentBrowserSelectedEntry(page)).toHaveCount(1)
  await expect(locate.componentBrowserSelectedEntry(page)).toHaveText('Table.input')
  if (content) {
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type(content)
  }
  await page.keyboard.press('Enter')
  const node = locate.graphNodeByBinding(page, 'any1')
  await expect(node).toHaveCount(1)
  await expect(node).toBeVisible()
  await mockMethodCallInfo(
    page,
    { binding: 'any1', expr: 'Table.input' + (content ? ` ${content}` : '') },
    {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'input',
      },
      notAppliedArguments: content ? [] : [0],
    },
  )
  return node
}
