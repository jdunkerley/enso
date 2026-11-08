/**
 * @file Markdown tables in the documentation editor and the component help: shown as tables, in
 * the editor's width, and the doc comments' indented result tables too.
 */
import { expect, test } from 'integration-test/base'
import { DELETE_KEY } from './keyboard'
import * as locate from './locate'

test('a table in the documentation shows as a table, scrolling inside the panel', async ({
  editorPage,
  page,
}) => {
  await editorPage.toggleDocsAssetPanel()
  const docs = page.getByTestId('documentation-editor-content')
  await expect(docs.locator('.cm-line')).toExist()
  await docs.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press(DELETE_KEY)
  const wide = Array.from({ length: 12 }, (_, i) => `column_number_${i}`)
  await docs.fill(
    [
      'Before',
      '',
      `| ${wide.join(' | ')} |`,
      `|${wide.map(() => '---').join('|')}|`,
      `| ${wide.map((_, i) => i).join(' | ')} |`,
      '',
      'After',
    ].join('\n'),
  )
  await locate.graphEditor(page).click({ position: { x: 300, y: 300 } })
  const table = locate.rightDock(page).locator('table')
  await expect(table).toBeVisible()
  await expect(table.locator('th')).toHaveCount(12)
  await expect(table.locator('th').first()).toHaveText('column_number_0')
  // Wider than the panel: the table scrolls, the panel keeps its width.
  const sizes = await table.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    content: el.closest('.cm-content')!.clientWidth,
  }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  expect(sizes.client).toBeLessThanOrEqual(sizes.content)
})

test('the component help shows a doc comment’s result tables as tables', async ({
  editorPage,
  page,
}) => {
  await editorPage.mockMethodCallInfo('aggregated', {
    methodPointer: {
      module: 'Standard.Table.Table',
      definedOnType: 'Standard.Table.Table.Table',
      name: 'aggregate',
    },
    notAppliedArguments: [],
  })
  await locate.graphNodeIcon(locate.graphNodeByBinding(page, 'aggregated')).click()
  await page.keyboard.press('F1')
  const tables = locate.rightDock(page).locator('table')
  await expect(tables).toHaveCount(2)
  await expect(tables.nth(1).locator('th')).toHaveText(['Name', 'Count'])
})

test('clicking inside a selection in a code block collapses it there', async ({
  editorPage,
  page,
}) => {
  await editorPage.toggleDocsAssetPanel()
  const docs = page.getByTestId('documentation-editor-content')
  await expect(docs.locator('.cm-line')).toExist()
  await docs.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press(DELETE_KEY)
  await docs.fill('Text\n\n```\nselected_word code line\n```\n\nAfter')
  // The code line: the block's second line, after the opening fence.
  const line = docs.locator('.cm-line.cm-codeBlock').nth(1)
  await expect(line).toHaveText('selected_word code line')
  await line.getByText('selected_word code line').dblclick({ position: { x: 20, y: 5 } })
  const selection = locate.rightDock(page).locator('.cm-selectionBackground')
  await expect(selection).toHaveCount(1)
  // A click inside the selection reaches the text, and puts the cursor there.
  const box = (await selection.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(selection).toHaveCount(0)
  await page.keyboard.type('X')
  // The X lands inside the word, which is not replaced.
  await expect(line).toHaveText(/^s[a-z_]*X[a-z_]* code line$/)
  expect((await line.textContent())!.replace('X', '')).toBe('selected_word code line')
})
