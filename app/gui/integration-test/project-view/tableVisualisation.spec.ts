// The table view format's field names are snake_case (`number_format`, …).
/* eslint-disable camelcase */

import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type BrowserContext, type Locator, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { matrixView } from 'integration-test/mock/tableView'
import * as actions from './actions'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'
import { graphNodeByBinding } from './locate'
import singleColumnDates from './table-vis-json/singleColumnDates.json' with { type: 'json' }
import singleColumnDatetimes from './table-vis-json/singleColumnDatetimes.json' with { type: 'json' }
import singleColumnTimes from './table-vis-json/singleColumnTimes.json' with { type: 'json' }

/** Prepare the graph for the tests. We add the table type to the `aggregated` node. */
async function initGraph(editorPage: EditorPageActions) {
  await editorPage.mockExpressionUpdate('aggregated', { type: ['Standard.Table.Table.Table'] })
}

/**
 Scenario: We open the default visualisation of the `aggregated` node. We expect it to be a table visualisation and to
    contain 10 rows and the values 0,0 to 3,0, which are just some sample values that should be visible in the table
    after opening it.
 */
test('Load Table Visualisation', async ({ editorPage, page }) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await expect(tableVisualization).toContainText('10 rows.')
  await expect(tableVisualization).toContainText('0,0')
  await expect(tableVisualization).toContainText('1,0')
  await expect(tableVisualization).toContainText('2,0')
  await expect(tableVisualization).toContainText('3,0')
})

const GET_ROWS = 'Standard.Visualization.Table.Visualization.get_rows_for_table'

/** Longer than the 5 s default `executeExpression` timeout that row pages once had. */
const PAST_OLD_ROW_TIMEOUT_MS = 6000

/**
 Scenario (#777): a table large enough to be paged from the engine is opened while the engine is busy,
    so its first rows come after more than 5 s. The table must show them when they come, not settle to
    AG Grid's "No Rows To Show" before.
 */
test('Paged table shows rows the engine sends late', async ({ editorPage, page, localApi }) => {
  // It waits past the old 5 s limit on a row request.
  test.slow()
  await initGraph(editorPage)
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 3,
      columns: [{ name: 'Name' }],
      index: { action: 'get_row {{#index}}' },
      data: null,
      version_hash: 'busy-engine',
      server: true,
      options: { status_bar: true },
    },
  )

  await graphNodeByBinding(page, 'aggregated').click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  // The engine is busy: the request for the rows waits past the 5 s it was once given.
  await expect.poll(() => localApi.pendingVisualizationRequests(GET_ROWS)).toBe(1)
  await page.waitForTimeout(PAST_OLD_ROW_TIMEOUT_MS)
  await expect(tableVisualization).not.toContainText('No Rows To Show')

  await localApi.updateVisualization(GET_ROWS, {
    row_count: 3,
    index: [0, 1, 2],
    data: [['alpha', 'beta', 'gamma']],
  })
  await expect(tableVisualization).toContainText('gamma', { timeout: 15000 })
  await expect(tableVisualization).not.toContainText('No Rows To Show')
})

test('Column size can be set and is retained', async ({ editorPage, page, localApi }) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await expect(tableVisualization).toContainText('10 rows.')

  const col = tableVisualization.getByRole('columnheader', { name: /^0/ })
  const colManualSize = await resizeCol(col)

  // A data update causes column autosizing to run
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    matrixView(
      Array.from({ length: 10 }, (_, i) => Array.from({ length: 5 }, (_, j) => `${i},${j}b`)),
    ),
  )
  await expect(tableVisualization).toContainText('0,0b')

  const colSizeAfterDataUpdate = await getElWidth(col)
  expect(colSizeAfterDataUpdate).toBe(colManualSize)
})

async function getElWidth(col: Locator): Promise<number> {
  await col.elementHandle().then((el) => el!.waitForElementState('stable'))
  const bbox = await col.boundingBox()
  expect(bbox).toBeDefined()
  return bbox!.width
}

async function resizeCol(col: Locator): Promise<number> {
  await expect(col).toExist()
  const widthBeforeResize = await getElWidth(col)
  const resizeHandle = col.locator('[data-ref="eResize"]')
  await resizeHandle.dragTo(resizeHandle, {
    sourcePosition: { x: 0, y: 0 },
    targetPosition: { x: 50, y: 0 },
    force: true,
  })
  const widthAfterResize = await getElWidth(col)
  expect(widthAfterResize).toBeGreaterThan(widthBeforeResize)
  return widthAfterResize
}

test('Copy/paste from Table Visualization', async ({ page, editorPage }) => {
  const expectClipboard = expect.poll(() =>
    page.evaluate(() => window.navigator.clipboard.readText()),
  )
  await editorPage
  await actions.openVisualization(page, 'Table')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await tableVisualization.getByText('0,0').hover()
  await page.mouse.down()
  await tableVisualization.getByText('2,1').hover()
  await page.mouse.up()

  // Copy from table visualization
  await editorPage.press('Mod+C')
  await expectClipboard.toMatch(/^0,0\t0,1\r\n1,0\t1,1\r\n2,0\t2,1$/)

  // Paste to Node.
  await actions.clickAtBackground(page)
  const nodesCount = await locate.graphNode(page).count()
  await editorPage.press('Mod+V')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount + 1)
  // Node binding would be `node1` for pasted node.
  const nodeBinding = 'node1'
  await mockMethodCallInfo(page, nodeBinding, {
    methodPointer: {
      module: 'Standard.Table.Table',
      definedOnType: 'Standard.Table.Table.Table',
      name: 'input',
    },
    notAppliedArguments: [],
  })
  await expectTableInputContent(page, locate.graphNode(page).last())

  // Paste to Table Widget.
  const node = await actions.createTableNode(page)
  const widget = node.locator('.WidgetTableEditor')
  await expect(widget).toBeVisible()
  await widget.getByRole('button', { name: 'Add new column' }).click()
  await widget.locator('.valueCell').first().click()
  await editorPage.press('Mod+V')
  await expectTableInputContent(page, node)

  // Copy from table input widget
  await node.getByText('0,0').hover()
  await page.mouse.down()
  await node.getByText('2,1').hover()
  await page.mouse.up()
  await editorPage.press('Mod+C')
  await expectClipboard.toMatch(/^0,0\t0,1\r\n1,0\t1,1\r\n2,0\t2,1$/)

  // Copy from table input widget with headers
  await node.getByText('0,0').hover()
  await page.mouse.down()
  await node.getByText('2,1').hover()
  await page.mouse.up()
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await page.getByText('Copy with Headers').click()
  await expectClipboard.toMatch(/^Column 1\tColumn 2\r\n0,0\t0,1\r\n1,0\t1,1\r\n2,0\t2,1$/)
})

async function expectTableInputContent(page: Page, node: Locator) {
  const widget = node.locator('.WidgetTableEditor')
  await expect(widget).toBeVisible({ timeout: 5000 })
  await expect(widget.locator('.valueCell')).toHaveText([
    '0,0',
    '0,1',
    '1,0',
    '1,1',
    '2,0',
    '2,1',
    '',
    '',
  ])
}

test('Single Column Of Actions Table Visualisation Test', async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 3,
      columns: [
        {
          name: 'table',
          link: { action: 'read {{@table}}', label: 'table' },
        },
      ],
      data: [['Sheet1', 'Sheet2', 'Sheet3']],
    },
  )
  await expect(tableVisualization).toContainText('table')
  await expect(tableVisualization).toContainText('Sheet1')
  await expect(tableVisualization).toContainText('Sheet2')
  await expect(tableVisualization).toContainText('Sheet3')
  const sheet2 = tableVisualization.getByText('Sheet2')
  await sheet2.dblclick()
  const newNode = graphNodeByBinding(page, 'node1')
  await expect(newNode).toContainText('read')
  await expect(newNode).toContainText('Sheet2')
})

test('Error Visualisation Test', async ({ editorPage, page, localApi }) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    { kind: 'error', error: 'This is an error message.' },
  )
  await expect(tableVisualization).toContainText('This is an error message.')
})

test('Link template Test as number', async ({ editorPage, page, localApi }) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 3,
      columns: [
        {
          name: 'table',
          link: { action: 'read {{#table}}', label: 'table' },
        },
      ],
      data: [['1', '2', '3']],
    },
  )
  await expect(tableVisualization).toContainText('table')
  await expect(tableVisualization).toContainText('1')
  await expect(tableVisualization).toContainText('2')
  await expect(tableVisualization).toContainText('3')
  const value2 = tableVisualization.getByText('2')
  await value2.dblclick()
  const newNode = graphNodeByBinding(page, 'node1')
  await expect(newNode).toContainText('read')
  const numberWidget = newNode.locator('.WidgetNumber')
  await expect(numberWidget).toBeVisible()
  await expect(numberWidget).toHaveValue('2')
})

test('Link template Test as text', async ({ editorPage, page, localApi }) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 3,
      columns: [
        {
          name: 'table',
          link: { action: 'read {{@table}}', label: 'table' },
        },
      ],
      data: [['1', '2', '3']],
    },
  )
  await expect(tableVisualization).toContainText('table')
  await expect(tableVisualization).toContainText('1')
  await expect(tableVisualization).toContainText('2')
  await expect(tableVisualization).toContainText('3')
  const value2 = tableVisualization.getByText('2')
  await value2.dblclick()
  const newNode = graphNodeByBinding(page, 'node1')
  const textWidget = newNode.locator('.WidgetText')
  await expect(textWidget).toBeVisible()
  await expect(textWidget.getByTestId('widget-text-content')).toHaveText('2')
})

test('GenericGrid Table Visualisation Test - single column - no links', async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      columns: [{ name: 'table', number_format: false }],
      data: [['Sheet1', 'Sheet2', 'Sheet3']],
    },
  )
  await expect(tableVisualization).toContainText('table')
  await expect(tableVisualization).toContainText('Sheet1')
  await expect(tableVisualization).toContainText('Sheet2')
  await expect(tableVisualization).toContainText('Sheet3')
})

test('GenericGrid Table Visualisation Test - two column - link on second', async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage)

  const aggregatedNode = graphNodeByBinding(page, 'aggregated')
  await aggregatedNode.click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()

  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 3,
      columns: [
        { name: 'table', number_format: false },
        { name: 'number', link: { action: 'read {{#number}} {{@table}}' } },
      ],
      data: [
        ['SheetA', 'SheetB', 'SheetC'],
        ['1', '2', '3'],
      ],
    },
  )
  await expect(tableVisualization).toContainText('table')
  await expect(tableVisualization).toContainText('SheetA')
  await expect(tableVisualization).toContainText('SheetB')
  await expect(tableVisualization).toContainText('SheetC')
  await expect(tableVisualization).toContainText('number')
  await expect(tableVisualization).toContainText('1')
  await expect(tableVisualization).toContainText('2')
  await expect(tableVisualization).toContainText('3')
  const value2 = tableVisualization.getByText('2')
  await value2.dblclick()
  const newNode = graphNodeByBinding(page, 'node1')

  await expect(newNode).toContainText('read')

  const textWidget = newNode.locator('.WidgetText')
  await expect(textWidget).toBeVisible()
  await expect(textWidget.getByTestId('widget-text-content')).toHaveText('SheetB')

  const numberWidget = newNode.locator('.WidgetNumber')
  await expect(numberWidget).toBeVisible()
  await expect(numberWidget).toHaveValue('2')
})

/*
   These tests pair with the Enso tests found at test/Visualization_Tests/src/Table_Visualisation_Integration_Spec.enso
   Those tests check the json produced by prepare_visualization matches a baseline
   These tests check that json data then renders correctly in an AG Grid in the GUI
   If you change the json API you can regen the reference json by commenting in the line of code in
   check_equal in Table_Visualisation_Integration_Spec.enso and running those tests
   Then run the js prettier
   Remember to comment the write back out
*/
test.describe('Table_Visualisation_Integration_Spec and clipboard', () => {
  test('Datetime test - sorting and copying', async ({ editorPage, localApi, page, context }) => {
    await loadData(editorPage, localApi, singleColumnDatetimes)
    await expectCellDataToBe(page, 'Value', [
      '2025-01-02 12:13:14.123[UTC]',
      '2025-01-01 12:13:14.123[UTC]',
      '2025-01-03 12:13:14.123[UTC]',
    ])
    const value = getHeaderLocator(page, { colHeaderName: 'Value' })
    await value.click() // Sort ascending
    await expectCellDataToBe(page, 'Value', [
      '2025-01-01 12:13:14.123[UTC]',
      '2025-01-02 12:13:14.123[UTC]',
      '2025-01-03 12:13:14.123[UTC]',
    ])
    await value.click() // Sort descending
    await expectCellDataToBe(page, 'Value', [
      '2025-01-03 12:13:14.123[UTC]',
      '2025-01-02 12:13:14.123[UTC]',
      '2025-01-01 12:13:14.123[UTC]',
    ])
    await value.click() // remove sort
    await expectCellDataToBe(page, 'Value', [
      '2025-01-02 12:13:14.123[UTC]',
      '2025-01-01 12:13:14.123[UTC]',
      '2025-01-03 12:13:14.123[UTC]',
    ])
    await expectCopyingColumnClipboardToBe(
      editorPage,
      context,
      'Value',
      0,
      1,
      '2025-01-02 12:13:14.123[UTC]\r\n2025-01-01 12:13:14.123[UTC]',
    )
  })

  test('Date test - sorting and copying', async ({ editorPage, localApi, page, context }) => {
    await loadData(editorPage, localApi, singleColumnDates)
    await expectCellDataToBe(page, 'Value', ['2025-01-02', '2025-01-01', '2025-01-03'])
    const value = getHeaderLocator(page, { colHeaderName: 'Value' })
    await value.click({ position: { x: 10, y: 10 } }) // Sort ascending
    await expectCellDataToBe(page, 'Value', ['2025-01-01', '2025-01-02', '2025-01-03'])
    await value.click({ position: { x: 10, y: 10 } }) // Sort descending
    await expectCellDataToBe(page, 'Value', ['2025-01-03', '2025-01-02', '2025-01-01'])
    await value.click({ position: { x: 10, y: 10 } }) // remove sort
    await expectCellDataToBe(page, 'Value', ['2025-01-02', '2025-01-01', '2025-01-03'])
    await expectCopyingColumnClipboardToBe(
      editorPage,
      context,
      'Value',
      0,
      1,
      '2025-01-02\r\n2025-01-01',
    )
  })

  test('Time test - sorting and copying', async ({ editorPage, localApi, page, context }) => {
    await loadData(editorPage, localApi, singleColumnTimes)
    await expectCellDataToBe(page, 'Value', [
      '12:14:14.123004',
      '12:13:14.123004',
      '12:15:14.123004',
    ])
    const value = getHeaderLocator(page, { colHeaderName: 'Value' })
    await value.click({ position: { x: 10, y: 10 } }) // Sort ascending
    await expectCellDataToBe(page, 'Value', [
      '12:13:14.123004',
      '12:14:14.123004',
      '12:15:14.123004',
    ])
    await value.click({ position: { x: 10, y: 10 } }) // Sort descending
    await expectCellDataToBe(page, 'Value', [
      '12:15:14.123004',
      '12:14:14.123004',
      '12:13:14.123004',
    ])
    await value.click({ position: { x: 10, y: 10 } }) // remove sort
    await expectCellDataToBe(page, 'Value', [
      '12:14:14.123004',
      '12:13:14.123004',
      '12:15:14.123004',
    ])
    await expectCopyingColumnClipboardToBe(
      editorPage,
      context,
      'Value',
      0,
      1,
      '12:14:14.123004\r\n12:13:14.123004',
    )
  })

  async function expectCopyingColumnClipboardToBe(
    editorPage: EditorPageActions,
    context: BrowserContext,
    columnName: string,
    startRow: number,
    endRow: number,
    expectedClipboardText: string,
  ) {
    await editorPage.do(async (page) => {
      await getCellLocator(page, columnName, startRow).click()
      await editorPage.down('Shift')
      await getCellLocator(page, columnName, endRow).click()
      await editorPage.up('Shift')
      await editorPage.press('Mod+C')
      const expectClipboard = expect.poll(() =>
        page.evaluate(() => window.navigator.clipboard.readText()),
      )
      await expectClipboard.toBe(expectedClipboardText)
    })
  }
})

async function loadData(editorPage: EditorPageActions, localApi: MockLocalApi, data: any) {
  await initGraph(editorPage)
  await editorPage
    .selectSingleNode('aggregated')
    .press('Space')
    .do((page) => expect(locate.tableVisualization(page)).toExist())
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    data,
  )
}

type ColumnLocatorOptions = {
  colId?: string
  colHeaderName?: string
}

/**
 * Returns a locator for the header cell
 */
function getHeaderLocator(page: Page, options: ColumnLocatorOptions) {
  if (options.colHeaderName) {
    return page.getByRole('columnheader', { name: options.colHeaderName })
  }
  return page.getByRole('columnheader').and(page.locator(`[col-id="${options.colId}"]`))
}

/**
 * Returns a locator for the cell based off colId and rowIndex
 */
function getCellLocator(page: Page, colId: string, rowIndex: number) {
  const locatorString = `[row-index="${rowIndex}"] [col-id="${colId}"]`
  return page.locator(locatorString)
}

// Helper function to check cell values in a column
async function expectCellDataToBe(page: Page, colId: string, expectedValues: string[]) {
  for (let i = 0; i < expectedValues.length; i++) {
    await expect(getCellLocator(page, colId, i)).toHaveText(expectedValues[i]!)
  }
}

/** The toolbar button that turns the grid's sort and filter state into components. */
const CREATE_COMPONENTS =
  "Create new component(s) with the current grid's state applied to the workflow"

/** A table view of two columns, as `prepare_visualization` sends it for a table. */
const SORTABLE_TABLE = {
  kind: 'grid',
  row_count: 3,
  columns: [
    { name: 'a', value_type: { constructor: 'Integer', display_text: 'Integer (64 bits)' } },
    { name: 'b', value_type: { constructor: 'Char', display_text: 'Char' } },
  ],
  index: { action: 'get_row {{#index}}', label: 'row' },
  data: [
    [3, 1, 2],
    ['c', 'a', 'b'],
  ],
  actions: [
    { id: 'sort', label: 'Sort', icon: 'sort', kind: 'chain', template: 'sort {{columns*}}' },
  ],
}

/** Scenario: the grid is sorted by a header click, and the toolbar button makes a `sort` node of it. */
test('Sorting a table and creating components makes a sort node', async ({
  editorPage,
  page,
  localApi,
}) => {
  await initGraph(editorPage)
  await graphNodeByBinding(page, 'aggregated').click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    SORTABLE_TABLE,
  )
  await expect(tableVisualization).toContainText('c')
  await tableVisualization.locator('.ag-header-cell-text', { hasText: /^a$/ }).click()
  const nodeCount = await locate.graphNode(page).count()
  await page.getByRole('button', { name: CREATE_COMPONENTS }).click()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect(locate.graphNode(page).last()).toContainText(/sort.*Name.*Ascending/)
})

/** The right-click menu actions an in-memory table sends (`Viz_Helpers.enso`, `table_actions`). */
const MENU_ACTIONS = [
  {
    id: 'open_row',
    label: 'Get Row',
    icon: 'select_row',
    kind: 'chain',
    template: 'get_row {{#index}}',
  },
  {
    id: 'open_column',
    label: 'Get Column',
    icon: 'select_column',
    kind: 'chain',
    template: 'at {{@column}}',
  },
  {
    id: 'open_cell',
    label: 'Get Value',
    icon: 'select_cell',
    kind: 'chain',
    template: 'get_value {{@column}} {{#index}}',
  },
]

/** The code editor's text. The editor is opened to read it and closed again: it covers the grid. */
async function codeText(page: Page) {
  const editor = page.locator('.CodeEditor')
  await page.keyboard.press('ControlOrMeta+`')
  await expect(editor).toBeVisible()
  const text: string = await page.evaluate(() => (window as any).__codeEditorApi.textContent())
  await page.keyboard.press('ControlOrMeta+`')
  await expect(editor).toBeHidden()
  return text
}

/** Open the table visualization of `aggregated` showing `message`, sorted by column `a`. */
async function openSortedTable(
  editorPage: EditorPageActions,
  page: Page,
  localApi: MockLocalApi,
  message: object,
) {
  await initGraph(editorPage)
  await graphNodeByBinding(page, 'aggregated').click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    message,
  )
  await expect(tableVisualization).toContainText('c')
  await tableVisualization.locator('.ag-header-cell-text', { hasText: /^a$/ }).click()
  // After the sort the first displayed row is the data's row 1 (`a` = 1, `b` = 'a').
  await expect(getCellLocator(page, 'a', 0)).toHaveText('1')
  return tableVisualization
}

/** Choose `item` from the grid's right-click menu on `cell`, and wait for the node it makes. */
async function chooseFromMenu(page: Page, cell: Locator, item: string) {
  const nodeCount = await locate.graphNode(page).count()
  await cell.click({ button: 'right' })
  await page.getByTestId('gridPopupMenu').getByText(item, { exact: true }).click()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
}

/**
 Scenario: a table sorted by `a` is right-clicked on its first displayed row. The menu's Get Row, Get
    Column and Get Value name the clicked row by its place in the table (`1`), not by its place on
    screen (`0`, which is `a` = 3).
 */
test('Right-click on a sorted table row gets that row, not the displayed position', async ({
  editorPage,
  page,
  localApi,
}) => {
  await openSortedTable(editorPage, page, localApi, { ...SORTABLE_TABLE, actions: MENU_ACTIONS })
  const cell = getCellLocator(page, 'b', 0)
  await expect(cell).toHaveText('a')
  await chooseFromMenu(page, cell, 'Get Row')
  await expect.poll(() => codeText(page)).toMatch(/aggregated\.get_row 1$/m)
  await chooseFromMenu(page, cell, 'Get Column')
  await expect.poll(() => codeText(page)).toMatch(/aggregated\.at 'b'$/m)
  await chooseFromMenu(page, cell, 'Get Value')
  await expect.poll(() => codeText(page)).toMatch(/aggregated\.get_value 'b' 1$/m)
  // The unsorted position was never used.
  expect(await codeText(page)).not.toMatch(/get_row 0|get_value 'b' 0/)
})

/** Scenario: the row-number column is not a column of the table, so its menu offers only the row. */
test('Right-click on the row-number column offers only Get Row', async ({
  editorPage,
  page,
  localApi,
}) => {
  await openSortedTable(editorPage, page, localApi, { ...SORTABLE_TABLE, actions: MENU_ACTIONS })
  const cell = getCellLocator(page, '#', 0)
  await cell.click({ button: 'right' })
  const menu = page.getByTestId('gridPopupMenu')
  await expect(menu.getByText('Get Row', { exact: true })).toBeVisible()
  await expect(menu.getByText('Get Column', { exact: true })).toHaveCount(0)
  await expect(menu.getByText('Get Value', { exact: true })).toHaveCount(0)
  const nodeCount = await locate.graphNode(page).count()
  await menu.getByText('Get Row', { exact: true }).click()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect.poll(() => codeText(page)).toMatch(/aggregated\.get_row 1$/m)
})

/** Scenario: a value that sends no row action, only a link, gets that link in the menu. */
test('Right-click on a link offers the link', async ({ editorPage, page, localApi }) => {
  await initGraph(editorPage)
  await graphNodeByBinding(page, 'aggregated').click()
  await editorPage.press('Space')
  const tableVisualization = locate.tableVisualization(page)
  await expect(tableVisualization).toExist()
  await localApi.updateVisualization(
    'Standard.Visualization.Table.Visualization.prepare_visualization',
    {
      kind: 'grid',
      row_count: 1,
      columns: [{ name: 'Table', link: { action: 'query {{@Table}}', label: 'table' } }],
      data: [['pinned']],
    },
  )
  await chooseFromMenu(page, tableVisualization.getByText('pinned'), 'Open This Table')
  await expect.poll(() => codeText(page)).toMatch(/aggregated\.query 'pinned'$/m)
})

/**
 Scenario (#814): the cell menu closes on Escape and when the grid scrolls, but not because of the scroll the
    right-click itself may cause on a cell that is partly out of view (AG Grid scrolls it into view). The
    grid scrolls inside a shadow root, so it is AG Grid's `bodyScroll` that closes the menu.
 */
test.describe('Cell menu dismissal', () => {
  const GRID_ROWS = 60
  const GRID_COLUMNS = 24

  // A 60 x 24 grid is slow to render and to hit-test cell by cell: with the default 25 s a test
  // took 20-27 s on a loaded machine and timed out some runs, in the dismissal check and not for it.
  test.beforeEach(() => {
    test.slow()
  })

  async function openWideTable(editorPage: EditorPageActions, page: Page, localApi: MockLocalApi) {
    await initGraph(editorPage)
    await graphNodeByBinding(page, 'aggregated').click()
    await editorPage.press('Space')
    const tableVisualization = locate.tableVisualization(page)
    await expect(tableVisualization).toExist()
    await localApi.updateVisualization(
      'Standard.Visualization.Table.Visualization.prepare_visualization',
      matrixView(
        Array.from({ length: GRID_ROWS }, (_, i) =>
          Array.from({ length: GRID_COLUMNS }, (_, j) => `r${i}c${j}`),
        ),
      ),
    )
    await expect(tableVisualization).toContainText('r0c0')
    return tableVisualization
  }

  /**
   * The cell cut off at the `edge` of what can be clicked, with the most of it showing, and a point
   * on its visible part. What is visible is found by hit-testing, not by geometry: the node clips
   * the table and AG Grid's scrollbars overlay its rows.
   */
  async function cellCutOffAt(table: Locator, edge: 'right' | 'bottom') {
    const cells = await table.locator('.ag-cell').all()
    let best: { x: number; y: number; area: number } | undefined
    for (const cell of cells) {
      const found = await cell.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const root = el.getRootNode() as Document | ShadowRoot
        const hits: { x: number; y: number }[] = []
        for (let x = Math.max(box.left, 0) + 1; x < box.right; x += 3) {
          for (let y = Math.max(box.top, 0) + 1; y < box.bottom; y += 3) {
            if (root.elementFromPoint(x, y)?.closest('.ag-cell') === el) hits.push({ x, y })
          }
        }
        if (!hits.length) return undefined
        const xs = hits.map((p) => p.x)
        const ys = hits.map((p) => p.y)
        const centre = {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        }
        const nearest = hits.reduce((a, b) =>
          Math.hypot(a.x - centre.x, a.y - centre.y) <= Math.hypot(b.x - centre.x, b.y - centre.y) ?
            a
          : b,
        )
        return { box, maxX: Math.max(...xs), maxY: Math.max(...ys), hits: hits.length, ...nearest }
      })
      if (found == null) continue
      const cut = edge === 'right' ? found.box.right - found.maxX : found.box.bottom - found.maxY
      // Partly visible: some pixels in, and some pixels out.
      if (cut <= 4) continue
      if (best == null || found.hits > best.area)
        best = { x: found.x, y: found.y, area: found.hits }
    }
    expect(best, `a cell cut off at the ${edge} edge`).toBeDefined()
    return best!
  }

  const bodyScroll = (table: Locator) =>
    table.locator('.ag-grid-viewport').evaluate((el) => ({
      top: el.scrollTop,
      left: el.scrollLeft,
    }))

  for (const edge of ['right', 'bottom'] as const) {
    test(`Menu on a cell cut off at the ${edge} edge stays open, then closes on scroll`, async ({
      editorPage,
      page,
      localApi,
    }) => {
      const table = await openWideTable(editorPage, page, localApi)
      if (edge === 'bottom') {
        // Row height does not divide the viewport's, so scroll to leave a click-sized strip of the next row.
        await table.locator('.ag-grid-viewport').evaluate((el) => (el.scrollTop = 10))
        await page.waitForTimeout(300)
      }
      const target = await cellCutOffAt(table, edge)
      const menu = page.getByTestId('gridPopupMenu')

      await page.mouse.click(target.x, target.y, { button: 'right' })
      await expect(menu).toBeVisible()
      // Anything AG Grid does because of the click (focus, ensure visible) has happened by now.
      await page.waitForTimeout(500)
      await expect(menu).toBeVisible()

      // Scrolling the grid closes it.
      const before = await bodyScroll(table)
      await table.locator('.ag-grid-viewport').hover()
      await page.mouse.wheel(edge === 'right' ? 200 : 0, edge === 'bottom' ? 200 : 0)
      await expect.poll(() => bodyScroll(table)).not.toEqual(before)
      await expect(menu).toBeHidden()
    })
  }

  test('Menu closes on Escape', async ({ editorPage, page, localApi }) => {
    const table = await openWideTable(editorPage, page, localApi)
    const menu = page.getByTestId('gridPopupMenu')
    await table.getByText('r1c1', { exact: true }).click({ button: 'right' })
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })
})
