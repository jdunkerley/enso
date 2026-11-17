import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import {
  clearMockWidgetConfigurations,
  restoreMockMainFile,
  restoreMockWidgetConfigurations,
  setMockMainFile,
} from 'integration-test/mock/lsHandler'
import * as actions from './actions'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

class DropDownLocator {
  readonly rootWidget: Locator
  readonly dropDown: Locator
  readonly dropDownAnyState: Locator
  readonly items: Locator
  readonly selectedItems: Locator

  constructor(ancestor: Locator, widget: string = 'WidgetSelection') {
    this.rootWidget = ancestor.locator(`.${widget}`).first()
    const page = ancestor.page()
    // There can be only one open dropdown at a time on a page. We have to filter out the ones that
    // still have leaving animation running.
    this.dropDown = page.locator('.DropdownWidget:not([data-transitioning])')
    this.dropDownAnyState = page.locator('.DropdownWidget')
    this.items = this.dropDown.locator('.item')
    this.selectedItems = this.dropDown.locator('.item.selected')
  }

  async expectVisibleWithOptions(options: string[]): Promise<void> {
    await this.expectVisible()
    const page = this.dropDown.page()
    await expect(this.items.first()).toBeVisible()
    for (const option of options) {
      await expect(
        this.items.filter({ has: page.getByText(option, { exact: true }) }),
      ).toBeVisible()
    }
    await expect(this.items).toHaveCount(options.length)
  }

  async expectVisible(): Promise<void> {
    await expect(this.dropDown).toHaveCount(1)
    await expect(this.dropDown).toBeVisible()
  }

  async expectNotVisible(): Promise<void> {
    await expect(this.dropDownAnyState).toBeHidden()
  }

  async clickOption(option: string): Promise<void> {
    const item = this.item(option)
    await item.click()
  }

  async clickWidget(): Promise<void> {
    await this.rootWidget.click()
  }

  selectedItem(text: string): Locator {
    const page = this.dropDown.page()
    return this.selectedItems.filter({ has: page.getByText(text) })
  }

  item(text: string): Locator {
    const page = this.dropDown.page()
    return this.items.filter({ has: page.getByText(text) })
  }
}

const CHOOSE_LOCAL_FILE = 'Choose file…'
// Only the system file dialog: the IDE is local-only, so there is no "Choose file in cloud…".
const CHOOSE_FILE_OPTIONS = [CHOOSE_LOCAL_FILE]

test('Widget in plain AST', async ({ editorPage, page }) => {
  await editorPage
  const numberNode = locate.graphNodeByBinding(page, 'five')
  const numberWidget = numberNode.locator('.WidgetNumber')
  await expect(numberWidget).toBeVisible()
  await expect(numberWidget).toHaveValue('5')

  const listNode = locate.graphNodeByBinding(page, 'list')
  const listWidget = listNode.locator('.WidgetVector')
  await expect(listWidget).toBeVisible()

  const textNode = locate.graphNodeByBinding(page, 'text')
  const textWidget = textNode.locator('.WidgetText')
  await expect(textWidget).toBeVisible()
  await expect(textWidget.getByTestId('widget-text-content')).toHaveText('test')
})

test('Text widget: Convert to multiline', async ({ editorPage, page }) => {
  await editorPage
  const textNode = locate.graphNodeByBinding(page, 'text')
  const textWidget = textNode.locator('.WidgetText')
  await expect(textWidget).toBeVisible()
  await expect(textWidget.getByTestId('widget-text-content')).toHaveText('test')
  await textWidget.click()
  await expect(textWidget.getByTestId('widget-text-content')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Alt+Enter')
  await page.keyboard.insertText('Next line')
  await page.keyboard.press('Enter')
  await expect(textWidget.getByTestId('widget-text-content')).not.toBeFocused()
  await expect(textWidget.getByTestId('widget-text-content').locator('.cm-line')).toHaveText([
    'test',
    'Next line',
  ])
})

/** The module's code; the code editor is closed again afterwards. */
async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  const code = await page.evaluate(() => (window as any).__codeEditorApi.textContent())
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeHidden()
  return code
}

test.describe('Multi-selection widget', () => {
  test.beforeEach(async ({ editorPage, page }) => {
    await editorPage

    await mockMethodCallInfo(page, 'selected', {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'select_columns',
      },
      notAppliedArguments: [1],
    })
  })

  async function openAndCheckDropdown(page: Page) {
    // Click the argument to open the dropdown.
    const node = locate.graphNodeByBinding(page, 'selected')
    const topLevelArgs = node.locator('.WidgetTopLevelArgument')
    await expect(topLevelArgs).toHaveCount(1)
    const columnsArg = topLevelArgs.filter({ has: page.getByText('columns') })

    // Get the dropdown and corresponding vector; they both have 0 items.
    const dropDown = new DropDownLocator(columnsArg, 'WidgetMultiSelection')
    await dropDown.clickWidget()
    await dropDown.expectVisibleWithOptions(['Column A', 'Column B'])
    const vector = node.locator('.WidgetVector')
    const vectorItems = vector.getByTestId('list-item-content').getByTestId('widget-text-content')
    await expect(vector).toBeVisible()
    await expect(dropDown.selectedItems).toHaveCount(0)
    await expect(vectorItems).toHaveCount(0)

    return { dropDown, vector, vectorItems }
  }

  test('Enabling and disabling items', async ({ page }) => {
    const { dropDown, vector, vectorItems } = await openAndCheckDropdown(page)

    // Enable an item.
    await dropDown.clickOption('Column A')
    await expect(dropDown.selectedItem('Column A')).toExist()
    await expect(vector).toBeVisible()
    await expect(vectorItems).toHaveCount(1)
    await expect(vectorItems.first()).toHaveText('Column A')
    await dropDown.expectVisible()

    // Enable another item.
    await dropDown.clickOption('Column B')
    await expect(vectorItems).toHaveCount(2)
    await expect(vectorItems.first()).toHaveText('Column A')
    await expect(vectorItems.nth(1)).toHaveText('Column B')
    await expect(dropDown.dropDown).toBeVisible()
    await expect(dropDown.items).toHaveCount(2)
    await expect(dropDown.selectedItems).toHaveCount(2)

    // Disable an item.
    await dropDown.clickOption('Column A')
    await expect(vectorItems).toHaveCount(1)
    await expect(vectorItems.first()).toHaveText('Column B')
    await expect(dropDown.dropDown).toBeVisible()
    await expect(dropDown.items).toHaveCount(2)
    await expect(dropDown.selectedItems).toHaveCount(1)

    // Disable the last item.
    await dropDown.clickOption('Column B')
    await expect(vectorItems).toHaveCount(0)
    await expect(dropDown.dropDown).toBeVisible()
    await expect(dropDown.items).toHaveCount(2)
    await expect(dropDown.selectedItems).toHaveCount(0)
  })

  test('Interactions: Clicking in dropdown after editing item', async ({ page }) => {
    const { dropDown, vectorItems } = await openAndCheckDropdown(page)

    // Enable an item.
    await dropDown.clickOption('Column A')
    await expect(vectorItems.first()).toHaveText('Column A')
    await dropDown.expectVisible()

    // Click to edit an item.
    await vectorItems.first().click()
    await expect(vectorItems.first()).toBeFocused()
    await expect(dropDown.dropDown).toBeVisible()

    // Enable another item.
    // In a bug caught while testing a PR, this step fails to add an item to the vector because the
    // `pointerdown` in the dropdown closes it before the click is handled.
    await dropDown.clickOption('Column B')
    await expect(vectorItems).toHaveCount(2)
    await expect(dropDown.dropDown).toBeVisible()
  })

  test('Add-item button', async ({ page }) => {
    const { dropDown, vector } = await openAndCheckDropdown(page)

    await dropDown.clickOption('Column A')
    await dropDown.expectVisible()
    await page.keyboard.press('Escape')
    await dropDown.expectNotVisible()

    await locate.addItemButton(vector).click()
    await expect(dropDown.items).toHaveCount(2)
    await expect(dropDown.selectedItems).toHaveCount(1)
  })

  test('Editing items', async ({ page }) => {
    const { dropDown, vectorItems } = await openAndCheckDropdown(page)

    await dropDown.clickOption('Column A')
    await dropDown.clickOption('Column B')
    await page.keyboard.press('Escape')
    await dropDown.expectNotVisible()

    // Clicking to edit an item opens the dropdown.
    await expect(vectorItems.first()).toHaveText('Column A')
    await vectorItems.first().click()
    await expect(vectorItems.first()).toBeFocused()
    await expect(dropDown.dropDown).toBeVisible()

    // Clicking to edit a different item doesn't close the dropdown.
    await expect(vectorItems.nth(1)).toHaveText('Column B')
    await vectorItems.nth(1).click()
    await expect(vectorItems.nth(1)).toBeFocused()
    await expect(dropDown.dropDown).toBeVisible()

    // Edit an item.
    await expect(dropDown.selectedItem('Column A')).toExist()
    await expect(dropDown.selectedItem('Column B')).toExist()
    await expect(vectorItems.first()).toHaveText('Column A')
    await vectorItems.first().fill('Something Else')
    await expect(dropDown.selectedItem('Column A')).toBeHidden()
    await expect(dropDown.selectedItem('Column B')).toExist()
  })
})

test('Editing list', async ({ editorPage, page }) => {
  await editorPage
  const node = locate.graphNodeByBinding(page, 'autoscoped')
  const vector = node.locator('.WidgetVector')
  const vectorItems = vector.locator('.item')
  const vectorElements = vector.getByTestId('list-item-content')
  await expect(vectorElements).toHaveText(['..Group_By'])
  await node.click()

  // Test add
  await locate.addItemButton(node).click()
  await locate.addItemButton(node).click()
  await expect(vectorElements).toHaveText(['..Group_By', '_', '_'])

  // Test drag: remove item
  const secondItem = vectorItems.nth(1).locator('[draggable]')
  await secondItem.dragTo(secondItem, {
    force: true,
    targetPosition: { x: 200, y: 0 },
  })
  await expect(vectorElements).toHaveText(['..Group_By', '_'])

  // Test drag: reorder items
  await vectorItems.nth(1).locator('[draggable]').hover()
  await page.mouse.down()
  // `dragenter` / `dragleave` events are not dispatched reliably without multiple mouse movements
  await vectorElements.first().hover({ position: { x: 10, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 15, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 20, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 30, y: 10 }, force: true })
  await locate.graphEditor(page).hover({ position: { x: 100, y: 300 } })
  await expect(vectorElements).toHaveText(['..Group_By'])
  await expect(vector.getByTestId('dragPlaceholder')).toHaveCount(0)
  await vectorElements.first().hover({ position: { x: 10, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 15, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 20, y: 10 }, force: true })
  await vectorElements.first().hover({ position: { x: 30, y: 10 }, force: true })
  await expect(vector.getByTestId('dragPlaceholder')).toHaveCount(1)
  await page.mouse.up()
  await expect(vectorElements).toHaveText(['_', '..Group_By'])

  // Test delete
  await locate.deleteItemButton(vectorItems.first()).click()
  await expect(vectorElements).toHaveText(['..Group_By'])

  // Test delete: last item
  await locate.deleteItemButton(vectorItems).click()
  await expect(vectorItems).toBeHidden()
  await expect(vector).toExist()
})

async function dataReadNodeWithMethodCallInfo(editorPage: EditorPageActions): Promise<Locator> {
  return await editorPage
    .mockMethodCallInfo('data', {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'read',
      },
      notAppliedArguments: [0, 1, 2],
    })
    .locateNodes('data')
}

test.describe('Dynamic configuration updates', () => {
  test.beforeEach(clearMockWidgetConfigurations)
  test.afterEach(restoreMockWidgetConfigurations)

  /**
   * Check that dynamic dropdowns (with items provided by widget configuration) are not shown
   * until dynamic configuration arrives from the engine.
   * This test uses `format` argument of the `Data.read`, which has both static tags and a
   * dynamic configuration.
   * We check that no dropdown is shown until dynamic configuration arrives.
   */
  test('Dynamic dropdown', async ({ page, localApi, editorPage }) => {
    const node = await dataReadNodeWithMethodCallInfo(editorPage)
    const topLevelArgs = node.locator('.WidgetTopLevelArgument')
    await actions.showHiddenArguments(page, node)
    await expect(topLevelArgs).toHaveCount(3)

    // No dropdown is shown until dynamic configuration arrives.
    await expect(
      topLevelArgs.filter({ has: page.getByText('format') }).locator('.WidgetSelection'),
    ).not.toBeVisible()

    // Provide dynamic configuration for `format` arg.
    await localApi.updateVisualization('.read', [
      [
        'format',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          label: null,
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: '..Csv',
              label: 'Csv',
              parameters: [],
            },
            {
              type: 'Choice',
              constructor: 'Option',
              value: '..Excel',
              label: 'Excel',
              parameters: [],
            },
          ],
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])

    const formatArg = topLevelArgs.filter({ has: page.getByText('format') })
    const formatDropdown = new DropDownLocator(formatArg)
    await formatArg.click()
    await formatDropdown.expectVisibleWithOptions(['Csv', 'Excel'])
  })

  /**
   * Check that numeric widget is displayed even if dynamic configuration is not provided.
   * Unlike dynamic dropdowns, numeric widget can work normally without dynamic configuration.
   */
  test('Number widget', async ({ page, localApi, editorPage }) => {
    await editorPage
    const node = locate.graphNodeByBinding(page, 'selected')
    await locate.graphNodeIcon(node).click({ modifiers: ['ControlOrMeta'] })
    await expect(locate.componentBrowser(page)).toBeVisible()
    const content = locate.componentBrowserInput(page)
    await expect(content).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(` 1`)
    await expect(content).toHaveText(`select_columns 1`)
    await page.keyboard.press('Enter')
    await expect(locate.componentBrowser(page)).toBeHidden()
    await mockMethodCallInfo(page, 'selected', {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'select_columns',
      },
      notAppliedArguments: [2, 3, 4, 5],
    })
    const topLevelArgs = node.locator('.WidgetTopLevelArgument')
    await actions.showHiddenArguments(page, node)
    await expect(topLevelArgs).toHaveCount(5)
    await expect(node.locator('.WidgetNumber')).toBeVisible()
    await expect(node.locator('.WidgetNumber')).toHaveValue('1')
    // Input has no slider, because there is no limits information.
    await expect(node.locator('.AutoSizedInput')).not.toHaveClass(/slider/)

    // Provide limits from dynamic configuration.
    await localApi.updateVisualization('.select_columns', [
      [
        'columns',
        {
          type: 'Widget',
          constructor: 'Numeric_Input',
          maximum: 10,
          minimum: 0,
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    // Slider is now displayed.
    await expect(node.locator('.AutoSizedInput')).toHaveClass(/slider/)
  })

  /**
   * File browser widget is weird. We want to match it even when dynamic configuration is not yet provided,
   * but it also uses a dropdown widget internally. This is why we have a special test case for it.
   */
  test('File browser widget', async ({ page, localApi, editorPage }) => {
    const node = await dataReadNodeWithMethodCallInfo(editorPage)
    await actions.showHiddenArguments(page, node)
    await expect(node.locator('.WidgetTopLevelArgument')).toHaveCount(3)
    const pathArg = node.locator('.WidgetTopLevelArgument').filter({ has: page.getByText('path') })
    await pathArg.click()
    const pathDropdown = new DropDownLocator(pathArg)
    await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS])
    await expect(pathDropdown.items.filter({ hasText: 'in cloud' })).toHaveCount(0)
    // Provide dynamic configuration for `path` argument.
    // (we use Folder_Browser here, and check how dropdown items have changed)
    await localApi.updateVisualization('.read', [
      [
        'path',
        {
          type: 'Widget',
          constructor: 'Folder_Browse',
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    await pathDropdown.expectVisibleWithOptions(['Choose directory…'])
    await expect(pathDropdown.items.filter({ hasText: 'in cloud' })).toHaveCount(0)
  })

  /**
   * Some widgets inherit their configuration from a parent widget.
   * Inherited config has a priority even if newer configuration for the child expression arrives.
   * We are using `aggregated` node to test this.
   */
  test('Inherited configuration', async ({ page, localApi, editorPage }) => {
    await editorPage.mockMethodCallInfo('aggregated', {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'aggregate',
      },
      notAppliedArguments: [1, 2, 3, 4],
    })
    const node = locate.graphNodeByBinding(page, 'aggregated')
    await actions.showHiddenArguments(page, node)
    await expect(node.locator('.WidgetTopLevelArgument')).toHaveCount(4)
    // Top-level configuration, including configuration for child widgets.
    await localApi.updateVisualization('.aggregate', [
      [
        'columns',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          label: null,
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: 'Standard.Table.Aggregate_Column.Aggregate_Column.Group_By',
              label: 'Group By',
              parameters: [
                [
                  'column',
                  {
                    type: 'Widget',
                    constructor: 'Single_Choice',
                    label: null,
                    values: [
                      {
                        type: 'Choice',
                        constructor: 'Option',
                        value: '"column 1"',
                        label: 'column 1',
                        parameters: [],
                      },
                      {
                        type: 'Choice',
                        constructor: 'Option',
                        value: '"column 2"',
                        label: 'column 2',
                        parameters: [],
                      },
                    ],
                    display: { type: 'Display', constructor: 'Always' },
                  },
                ],
              ],
            },
          ],
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    const columnsArg = node
      .locator('.WidgetTopLevelArgument')
      .filter({ has: page.getByText('columns', { exact: true }) })
    await columnsArg.click()
    const columnsDropdown = new DropDownLocator(columnsArg)
    await columnsDropdown.expectVisibleWithOptions(['Group By'])
    await columnsDropdown.clickOption('Group By')
    await expect(columnsArg.locator('.WidgetToken')).toContainText([
      'Aggregate_Column',
      '.',
      'Group_By',
    ])
    await mockMethodCallInfo(
      page,
      {
        binding: 'aggregated',
        expr: 'Aggregate_Column.Group_By',
      },
      {
        methodPointer: {
          module: 'Standard.Table.Aggregate_Column',
          definedOnType: 'Standard.Table.Aggregate_Column.Aggregate_Column',
          name: 'Group_By',
        },
        notAppliedArguments: [0, 1],
      },
    )
    const firstItem = columnsArg.locator('.WidgetPort > .WidgetSelection').nth(0)
    const firstItemDropdown = new DropDownLocator(firstItem)
    await firstItemDropdown.clickWidget()
    await firstItemDropdown.expectVisibleWithOptions(['column 1', 'column 2'])

    // Provide dynamic configuration for `column` argument of `Aggregate_Column.Group_By`.
    // It shouldn’t affect the selectable variants of the dropdown, because parent
    // config has a priority.
    await localApi.updateVisualization('.Group_By', [
      [
        'column',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          label: null,
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: '"column 3"',
              label: 'column 3',
              parameters: [],
            },
            {
              type: 'Choice',
              constructor: 'Option',
              value: '"column 4"',
              label: 'column 4',
              parameters: [],
            },
          ],
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    await firstItemDropdown.expectVisibleWithOptions(['column 1', 'column 2'])

    // Update parent configuration
    await localApi.updateVisualization('.aggregate', [
      [
        'columns',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          label: null,
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: 'Standard.Table.Aggregate_Column.Aggregate_Column.Group_By',
              label: 'Group By',
              parameters: [
                [
                  'column',
                  {
                    type: 'Widget',
                    constructor: 'Single_Choice',
                    label: null,
                    values: [
                      {
                        type: 'Choice',
                        constructor: 'Option',
                        value: '"column 5"',
                        label: 'column 5',
                        parameters: [],
                      },
                      {
                        type: 'Choice',
                        constructor: 'Option',
                        value: '"column 6"',
                        label: 'column 6',
                        parameters: [],
                      },
                    ],
                    display: { type: 'Display', constructor: 'Always' },
                  },
                ],
              ],
            },
          ],
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    await firstItemDropdown.expectVisibleWithOptions(['column 5', 'column 6'])
  })
})

test('Selection widgets in Data.read node', async ({ editorPage, page }) => {
  const node = await dataReadNodeWithMethodCallInfo(editorPage)
  // Check initially visible arguments
  const topLevelArgs = node.locator('.WidgetTopLevelArgument')
  await expect(topLevelArgs).toHaveCount(1)

  // Selecting the node does not show the rest; the `…` menu does
  await actions.showHiddenArguments(page, node)
  await expect(topLevelArgs).toHaveCount(3)

  // Set value on `on_problems` (static drop-down)
  const onProblemsArg = topLevelArgs.filter({ has: page.getByText('on_problems') })
  await onProblemsArg.click()
  const onProblemsDropdown = new DropDownLocator(onProblemsArg)
  await onProblemsDropdown.expectVisibleWithOptions([
    '..Ignore',
    '..Report_Warning',
    '..Report_Error',
  ])
  await onProblemsDropdown.clickOption('Report_Error')
  await expect(onProblemsArg.locator('.WidgetToken')).toContainText(['..', 'Report_Error'])

  // Change value on `on_problems`
  await mockMethodCallInfo(page, 'data', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [0, 1],
  })
  await onProblemsArg.getByText('Report_Error').first().click()
  await onProblemsDropdown.expectVisibleWithOptions([
    '..Ignore',
    '..Report_Warning',
    '..Report_Error',
  ])
  await onProblemsDropdown.clickOption('Report_Warning')
  await expect(onProblemsArg.locator('.WidgetToken')).toContainText(['..', 'Report_Warning'])

  // Set value on `path` (dynamic config)
  const pathArg = topLevelArgs.filter({ has: page.getByText('path') })
  await pathArg.click()
  const pathDropdown = new DropDownLocator(pathArg)
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await pathDropdown.clickOption('File 2')
  await expect(pathArg.getByTestId('widget-text-content')).toHaveText('File 2')

  // Change value on `path` (dynamic config)
  await mockMethodCallInfo(page, 'data', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [1],
  })
  await page.getByText('path').click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await pathDropdown.clickOption('File 1')
  await expect(pathArg.getByTestId('widget-text-content')).toHaveText('File 1')
})

test('Selection widget with text widget as input', async ({ editorPage, page }) => {
  const node = await dataReadNodeWithMethodCallInfo(editorPage)
  const topLevelArgs = node.locator('.WidgetTopLevelArgument')
  const pathArg = topLevelArgs.filter({ has: page.getByText('path') })
  const pathDropdown = new DropDownLocator(pathArg)
  const pathArgInput = pathArg.getByTestId('widget-text-content')
  await pathArg.click()
  await pathDropdown.expectVisible()
  await pathDropdown.clickOption('File 2')
  await expect(pathArgInput).toHaveText('File 2')

  // Editing text input shows and filters drop down
  await pathArgInput.click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  // Using `type` instead of `inputText` here to catch keydown bugs like #13505.
  await page.keyboard.type('File 1')
  await pathDropdown.expectVisibleWithOptions(['File 1'])
  // Clearing input should show all options
  await pathArgInput.clear()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])

  // When a filter doesn't match any entries, the dropdown is hidden.
  await page.keyboard.insertText('No such entry')
  await pathDropdown.expectNotVisible()
  // If the text is changed so that the entries list is no longer empty, the dropdown returns.
  await pathArgInput.clear()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])

  // Esc should cancel editing and close drop down
  await page.keyboard.press('Escape')
  await expect(pathArgInput).not.toBeFocused()
  await expect(pathArgInput).toHaveText('File 2')
  await expect(pathDropdown.dropDown).toBeHidden()

  // Choosing entry should finish editing
  await pathArgInput.click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await page.keyboard.insertText('File')
  await pathDropdown.expectVisibleWithOptions(['File 1', 'File 2'])
  await pathDropdown.clickOption('File 1')
  await expect(pathArgInput).not.toBeFocused()
  await expect(pathArgInput).toHaveText('File 1')
  await expect(pathDropdown.dropDown).toBeHidden()

  // Clicking-off and pressing Enter should accept text as-is
  await pathArgInput.click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await page.keyboard.insertText('File')
  await page.keyboard.press('Enter')
  await expect(pathArgInput).not.toBeFocused()
  await expect(pathArgInput).toHaveText('File')
  await expect(pathDropdown.dropDown).toBeHidden()

  await pathArgInput.click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await page.keyboard.insertText('Foo')
  await expect(pathArgInput).toHaveText('Foo')
  await actions.clickAtBackground(page)
  await expect(pathArgInput).not.toBeFocused()
  await expect(pathArgInput).toHaveText('Foo')
  await expect(pathDropdown.dropDown).toBeHidden()
})

test('File Browser widget', async ({ editorPage, page }) => {
  await editorPage
  await mockMethodCallInfo(page, 'data', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [0, 1, 2],
  })
  // Wait for arguments to load.
  const node = locate.graphNodeByBinding(page, 'data')
  const topLevelArgs = node.locator('.WidgetTopLevelArgument')
  await expect(topLevelArgs).toHaveCount(1)
  const pathArg = topLevelArgs.filter({ has: page.getByText('path') })
  const pathDropdown = new DropDownLocator(pathArg)
  await pathArg.click()
  await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await expect(pathDropdown.items.filter({ hasText: 'in cloud' })).toHaveCount(0)
  await pathDropdown.clickOption(CHOOSE_LOCAL_FILE)
  await expect(pathArg.getByTestId('widget-text-content')).toHaveText('/path/to/some/mock/file')
})

test.describe('Table expression', () => {
  function prepare(editorPage: EditorPageActions) {
    return editorPage
      .mockMethodCallInfo('table', {
        methodPointer: {
          module: 'Standard.Table.Table',
          definedOnType: 'Standard.Table.Table.Table',
          name: 'set',
        },
        notAppliedArguments: [],
      })
      .mockMethodCallInfo(
        { binding: 'table', expr: 'expr ""' },
        {
          methodPointer: {
            module: 'Standard.Table.Expression',
            definedOnType: 'Standard.Table.Expression',
            name: 'expr',
          },
          notAppliedArguments: [],
        },
      )
  }

  test('Language recognized', async ({ page, editorPage }) => {
    await prepare(editorPage)
    const tableNode = locate.graphNodeByBinding(page, 'table')
    const exprText = tableNode.locator('.WidgetText')
    await expect(exprText).toHaveAttribute('data-text-syntax', 'enso-table-expression')
  })

  test('Autocomplete: Builtins', async ({ editorPage }) => {
    await prepare(editorPage)
    const ac = await getTableNodeExprAutocomplete(editorPage)
    await expect(ac.option('false')).toBeVisible()
  })

  test('Autocomplete: Column methods', async ({ editorPage }) => {
    await prepare(editorPage)
    const ac = await getTableNodeExprAutocomplete(editorPage)
    await expect(ac.option('is_nan')).toBeVisible()
  })

  test('Autocomplete: Table columns', async ({ page, editorPage }) => {
    await prepare(editorPage)
    // Column data is requested asynchronously, and the menu options list is not reactive, so we
    // retry in case the menu is opened before the data has been received.
    await expect(async () => {
      await page.mouse.click(0, 0)
      const ac = await getTableNodeExprAutocomplete(editorPage)
      await expect(ac.option('Column A')).toBeVisible()
    }).toPass({ timeout: 5_000 })
  })

  async function getTableNodeExprAutocomplete(editorPage: EditorPageActions) {
    const node = editorPage.locateNodes('table')
    const exprText = node.locator('.WidgetText')
    await expect(exprText).toHaveAttribute('data-text-syntax', 'enso-table-expression')
    await exprText.click()
    await expect(exprText.getByTestId('widget-text-content')).toBeFocused()
    return await AutocompleteMenu.ForEditorInNode(node)
  }
})

class AutocompleteMenu {
  private constructor(private readonly root: Locator) {}

  static async ForEditorInNode(node: Locator): Promise<AutocompleteMenu> {
    const root = node.locator('.cm-tooltip-autocomplete')
    await expect(root).toBeVisible()
    return new AutocompleteMenu(root)
  }

  option(label: string) {
    return this.root.locator('.cm-completionLabel').filter({ hasText: label })
  }
}

test('Manage aggregates in `aggregate` node', async ({ editorPage, page }) => {
  await editorPage.mockMethodCallInfo('aggregated', {
    methodPointer: {
      module: 'Standard.Table.Table',
      definedOnType: 'Standard.Table.Table.Table',
      name: 'aggregate',
    },
    notAppliedArguments: [1, 2, 3],
  })

  // Hide drive panel to not obscure long node.
  await page.locator('.LeftPanel').getByRole('button', { name: 'Close Panel' }).click()

  await editorPage
    // Check initially visible arguments
    .expectNodeTopLevelArgumentCount('aggregated', 1)
    .selectSingleNode('aggregated')
    // Selecting the node does not show the hidden arguments
    .expectNodeTopLevelArgumentCount('aggregated', 1)

  const node = editorPage.locateNodes('aggregated')
  // The `…` menu offers them
  await node.locator('.parameterMenuButton').click()
  const menu = page.getByRole('dialog', { name: 'More parameters' })
  await expect(menu.getByRole('button', { name: /^group_by/ })).toBeVisible()
  await expect(menu.getByRole('button', { name: /^columns/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  // Add first aggregate
  const columnsArg = node
    .locator('.WidgetTopLevelArgument')
    .filter({ has: page.getByText('columns') })

  await locate.addItemButton(columnsArg).click()
  await editorPage.expectNodeTokens('aggregated', [
    'aggregate',
    'Aggregate_Column',
    '.',
    'Group_By',
  ])
  await editorPage.mockMethodCallInfo(
    { binding: 'aggregated', expr: 'Aggregate_Column.Group_By' },
    {
      methodPointer: {
        module: 'Standard.Table.Aggregate_Column',
        definedOnType: 'Standard.Table.Aggregate_Column.Aggregate_Column',
        name: 'Group_By',
      },
      notAppliedArguments: [0, 1],
    },
  )

  // Change aggregation type
  const columnsDropdown = new DropDownLocator(columnsArg)
  await columnsDropdown.clickWidget()
  await columnsDropdown.expectVisibleWithOptions(['Group_By', 'Count', 'Count_Distinct'])
  await columnsDropdown.clickOption('Count_Distinct')
  await expect(columnsArg.locator('.WidgetToken')).toContainText([
    'Aggregate_Column',
    '.',
    'Count_Distinct',
  ])
  await editorPage.mockMethodCallInfo(
    { binding: 'aggregated', expr: 'Aggregate_Column.Count_Distinct' },
    {
      methodPointer: {
        module: 'Standard.Table.Aggregate_Column',
        definedOnType: 'Standard.Table.Aggregate_Column.Aggregate_Column',
        name: 'Count_Distinct',
      },
      notAppliedArguments: [0, 1, 2],
    },
  )

  // Set column
  const firstItem = columnsArg
    .getByTestId('list-item-content')
    .locator('.WidgetPort > .WidgetSelection')
    .nth(0)
  const firstItemDropdown = new DropDownLocator(firstItem)
  await firstItemDropdown.clickWidget()
  await firstItemDropdown.expectVisibleWithOptions(['column 1', 'column 2'])
  await firstItemDropdown.clickOption('column 1')
  await expect(columnsArg.locator('.WidgetToken')).toContainText([
    'Aggregate_Column',
    '.',
    'Count_Distinct',
  ])
  await expect(columnsArg.getByTestId('widget-text-content').first()).toHaveText('column 1')

  // Add another aggregate
  await locate.addItemButton(columnsArg).click()
  await expect(columnsArg.locator('.WidgetToken')).toContainText([
    'Aggregate_Column',
    '.',
    'Count_Distinct',
    'Aggregate_Column',
    '.',
    'Group_By',
  ])
  await editorPage.mockMethodCallInfo(
    { binding: 'aggregated', expr: 'Aggregate_Column.Group_By' },
    {
      methodPointer: {
        module: 'Standard.Table.Aggregate_Column',
        definedOnType: 'Standard.Table.Aggregate_Column.Aggregate_Column',
        name: 'Group_By',
      },
      notAppliedArguments: [0, 1],
    },
  )

  // Set new aggregate's column
  const secondItem = columnsArg
    .getByTestId('list-item-content')
    .nth(1)
    .locator('.WidgetPort > .WidgetSelection')
  const secondItemDropdown = new DropDownLocator(secondItem)
  await secondItemDropdown.clickWidget()
  await secondItemDropdown.expectVisibleWithOptions(['column 1', 'column 2'])
  await secondItemDropdown.clickOption('column 2')
  await expect(secondItem.locator('.WidgetToken')).toContainText([
    'Aggregate_Column',
    '.',
    'Group_By',
  ])
  await expect(secondItem.getByTestId('widget-text-content').first()).toHaveText('column 2')

  // Switch aggregates
  //TODO[ao] I have no idea how to emulate drag. Simple dragTo does not work (some element seem to capture event).
  // When hovered, the handle becomes available after some time, but still mouse events don't have any effect.
  // I have no time now to investigate this.
  // Once fixed, add also removing element from vector here.

  // await columnsArg.locator('.item > .handle').nth(1).hover({ force: true })
  // await columnsArg.locator('.item > .handle').nth(1).hover()
  // await page.mouse.down()
  // await columnsArg.locator('.item > .handle').nth(0).hover({ force: true })
  // await columnsArg.locator('.item > .handle').nth(0).hover()
  // await page.mouse.up()
  // await expect(columnsArg.locator('.WidgetToken')).toContainText([
  //   'Aggregate_Column',
  //   '.',
  //   'Group_By',
  //   '"',
  //   'column 2',
  //   '"',
  //   'Aggregate_Column',
  //   '.',
  //   'Count_Distinct',
  //   '"',
  //   'column 1',
  //   '"',
  // ])
})

// Test that autoscoped constructors provide argument placeholders.
// This test can be removed when `aggregate` inserts autoscoped constructors by default,
// so this behavior will be tested in regular `aggregate` tests.
test('Autoscoped constructors', async ({ editorPage }) => {
  await editorPage
    .mockMethodCallInfo('autoscoped', {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'aggregate',
      },
      notAppliedArguments: [2, 3],
    })
    .mockMethodCallInfo(
      { binding: 'autoscoped', expr: '..Group_By' },
      {
        methodPointer: {
          module: 'Standard.Table.Aggregate_Column',
          definedOnType: 'Standard.Table.Aggregate_Column.Aggregate_Column',
          name: 'Group_By',
        },
        notAppliedArguments: [0, 1],
      },
    )
    .selectSingleNode('autoscoped')
    .withNode('autoscoped', async (node) => {
      const groupBy = node.getByTestId('list-item-content')
      await expect(groupBy).toBeVisible()
      await expect(groupBy.locator('.WidgetArgumentName')).toContainText(['column'])
    })
})

test('Table widget', async ({ editorPage, page }) => {
  await editorPage

  const node = await actions.createTableNode(page)
  const widget = node.locator('.WidgetTableEditor')
  await expect(widget).toBeVisible()
  await expect(widget.locator('.ag-header-cell-text')).toHaveText(['#'])
  await expect(widget.getByRole('button', { name: 'Add new column' })).toExist()
  await expect(widget.locator('.ag-cell')).toHaveText(['0', ''])

  // Create first column
  await widget.getByRole('button', { name: 'Add new column' }).click()
  await expect(widget.locator('.ag-header-cell-text')).toHaveText(['#', 'Column 1'])
  await expect(widget.locator('.ag-cell')).toHaveText(['0', '', ''])

  // Putting first value
  const firstValueCell = widget.locator('.ag-cell', { hasNotText: '0' }).first()
  await firstValueCell.click()
  await expect(firstValueCell).toBeFocused()
  await page.keyboard.type('Value')
  await page.keyboard.press('Enter')
  // There will be new blank row allowing adding new rows.
  await expect(widget.locator('.ag-cell')).toHaveText(['0', 'Value', '', '1', '', ''])

  // Renaming column
  await widget.locator('.ag-header-cell-text', { hasText: 'Column 1' }).first().click()
  const headerInput = widget.locator('.ag-text-field-input')
  await expect(headerInput).toBeFocused()
  await headerInput.fill('Header')
  await headerInput.press('Enter')
  await expect(widget.locator('.ag-header-cell-text')).toHaveText(['#', 'Header'])

  // Adding next column
  await widget.getByRole('button', { name: 'Add new column' }).click()
  await expect(widget.locator('.ag-header-cell-text')).toHaveText(['#', 'Header', 'Column 2'])
  await expect(widget.locator('.ag-cell')).toHaveText(['0', 'Value', '', '', '1', '', '', ''])

  // Switching edit between cells and headers - check we will never edit two things at once.
  await expect(widget.locator('.ag-text-field-input')).toHaveCount(0)
  await widget.locator('.ag-header-cell-text', { hasNotText: /#/ }).first().click()
  await expect(widget.locator('.ag-text-field-input')).toHaveCount(1)
  await widget.locator('.valueCell').first().dblclick()
  await expect(widget.locator('.ag-text-field-input')).toHaveCount(1)
  await widget.locator('.ag-header-cell-text', { hasNotText: /#/ }).first().click()
  await expect(widget.locator('.ag-text-field-input')).toHaveCount(1)
  // The header after click stops editing immediately. Tracked by #11150
  // await widget.locator('.ag-header-cell-text', { hasNotText: /#/ }).last().dblclick()
  // await expect(widget.locator('.ag-text-field-input')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(widget.locator('.ag-text-field-input')).toHaveCount(0)
})

test('Text widget can be refocused after focus is lost in an unexpected way (#12571)', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const textNode = locate.graphNodeByBinding(page, 'text')
  const textInput = textNode.getByTestId('widget-text-content')
  await textInput.click()
  await expect(textInput).toBeFocused()
  await page.evaluate(() => (document.activeElement! as HTMLElement).blur())
  await expect(textInput).not.toBeFocused()
  await textInput.click()
  await expect(textInput).toBeFocused()
})

test.describe('Date widget', () => {
  const DATE_TYPE = 'Standard.Base.Data.Time.Date.Date'
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    since = Data.days_since\n    date1 = Date.new 2020 1 15\n',
        ),
    },
  })

  /** A `Data.days_since` call whose only argument, `date`, is a `Date` with no `@` annotation. */
  async function dateNode(editorPage: EditorPageActions, page: Page) {
    await editorPage
      .mockSuggestion({
        type: 'type',
        module: 'Standard.Base.Data.Time.Date',
        name: 'Date',
        params: [],
        reexport: 'Standard.Base.Main',
      })
      .mockSuggestion({
        type: 'method',
        module: 'Standard.Base.Data',
        name: 'days_since',
        arguments: [
          {
            name: 'date',
            reprType: DATE_TYPE,
            isSuspended: false,
            hasDefault: false,
          },
        ],
        selfType: 'Standard.Base.Data',
        returnType: 'Standard.Base.Data.Numbers.Integer',
        isStatic: true,
        annotations: [],
      })
    await mockMethodCallInfo(page, 'since', {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'days_since',
      },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'since')
    const widget = node.locator('.WidgetDate')
    await expect(widget).toHaveCount(1)
    const menu = page.locator('.DateMenu')
    /** Opens the menu: the arrow under the argument appears on hover. */
    const open = async () => {
      await widget.hover()
      await expect(widget.locator('svg.arrow')).toBeVisible()
      // The corner, not the middle: the middle of a written `Date.new` is a number field.
      await widget.click({ position: { x: 4, y: 4 } })
      await expect(menu).toBeVisible()
    }
    return { node, widget, menu, open }
  }

  const days = '[data-reka-calendar-cell-trigger]:not([data-outside-view])'

  test('a Date-typed argument has the arrow, and a relative choice writes the code it names', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await expect(menu.locator('.item')).toHaveText([
      'Date.today',
      'Date.yesterday',
      'Date.tomorrow',
    ])
    await menu.getByRole('button', { name: 'Date.yesterday' }).click()
    await expect(menu).toBeHidden()
    await expect(widget).toContainText(/Date\W*yesterday/)
    const code = await moduleCode(page)
    expect(code).toContain('since = Data.days_since Date.yesterday')
    expect(code).toContain('from Standard.Base import Date')
  })

  test('a calendar choice writes Date.new, whose year, month and day are fields', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(3)
    expect(await moduleCode(page)).toMatch(/since = Data\.days_since \(Date\.new \d+ \d+ 15\)\n/)
    // Reopened, the calendar marks the chosen day, and the keyboard closes it.
    await open()
    await expect(menu.locator('[aria-selected="true"]')).toHaveText('15')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('editing a field of the written date edits the number and does not open the menu', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(3)
    const day = widget.locator('.WidgetNumber').nth(2)
    await day.click()
    await expect(day).toBeFocused()
    await expect(menu).toBeHidden()
    await day.fill('20')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(/since = Data\.days_since \(Date\.new \d+ \d+ 20\)\n/)
  })

  test('picking a specific date twice keeps the parentheses', async ({ editorPage, page }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(3)
    await open()
    await menu.locator(days).nth(15).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    const code = await moduleCode(page)
    expect(code).toMatch(/since = Data\.days_since \(Date\.new \d+ \d+ 16\)\n/)
    expect(code).not.toMatch(/since = Data\.days_since Date\.new/)
  })

  test('a day click selects and writes nothing; Cancel closes the menu', async ({
    editorPage,
    page,
  }) => {
    const { menu, open } = await dateNode(editorPage, page)
    await open()
    const day = menu.locator(days).nth(14)
    await day.click()
    await expect(day).toHaveAttribute('data-selected')
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: 'Cancel' }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain('since = Data.days_since\n')
  })

  test('Set on the day that is already chosen only closes the menu', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    // One undo step takes the date back out: the second click wrote nothing.
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(0)
  })

  test('an untyped Date.new argument is drawn as any other expression', async ({
    editorPage,
    page,
  }) => {
    const { widget } = await dateNode(editorPage, page)
    await expect(widget).toHaveCount(1)
    await expect(widget.locator('.WidgetDate')).toHaveCount(0)
  })

  /** The node `date1 = Date.new 2020 1 15`, which is only a date. */
  async function wholeDateNode(editorPage: EditorPageActions, page: Page) {
    await dateNode(editorPage, page)
    const node = locate.graphNodeByBinding(page, 'date1')
    const widget = node.locator('.WidgetDate')
    await expect(widget).toHaveCount(1)
    return { node, widget, menu: page.locator('.DateMenu') }
  }

  test('a whole Date.new node offers the menu once selected, and a pick replaces its code', async ({
    editorPage,
    page,
  }) => {
    const { node, widget, menu } = await wholeDateNode(editorPage, page)
    // The first click is the node's: it selects it.
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(node).toHaveClass(/selected/)
    await expect(menu).toBeHidden()
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: 'Date.yesterday' }).click()
    await expect(menu).toBeHidden()
    const code = await moduleCode(page)
    expect(code).toContain('date1 = Date.yesterday\n')
    expect(code).not.toContain('(Date.yesterday)')
  })

  test('a calendar pick on a whole node is written without parentheses', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu } = await wholeDateNode(editorPage, page)
    await widget.click({ position: { x: 4, y: 4 } })
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await menu.locator(days).nth(19).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(/date1 = Date\.new \d+ \d+ 20\n/)
  })

  test('the menu is as wide on a narrow node as on a wide one', async ({ editorPage, page }) => {
    const { menu, open } = await dateNode(editorPage, page)
    await open()
    const narrow = (await menu.boundingBox())!.width
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // The whole node `date1` is far wider than the unset argument of `since`.
    const wide = locate.graphNodeByBinding(page, 'date1').locator('.WidgetDate')
    await wide.click({ position: { x: 4, y: 4 } })
    await wide.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    expect(Math.abs((await menu.boundingBox())!.width - narrow)).toBeLessThanOrEqual(1)
  })

  test('a whole date node still selects and drags, and its first click does not open the menu', async ({
    editorPage,
    page,
  }) => {
    const { node, widget, menu } = await wholeDateNode(editorPage, page)
    await editorPage.clearSelection()
    await expect(node).not.toHaveClass(/selected/)
    const before = await node.boundingBox()
    const grab = await widget.boundingBox()
    const x = grab!.x + 4
    const y = grab!.y + grab!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y + 40, { steps: 6 })
    await page.mouse.up()
    const after = await node.boundingBox()
    expect(after!.x).toBeGreaterThan(before!.x + 30)
    expect(after!.y).toBeGreaterThan(before!.y + 20)
    await expect(menu).toBeHidden()
    // A drag leaves the node selected, and a modified click is the node's, not the menu's.
    await widget.click({ position: { x: 4, y: 4 }, modifiers: ['Shift'] })
    await expect(menu).toBeHidden()
  })

  test('one choice is one undo step, and the import is undone with it', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.getByRole('button', { name: 'Date.tomorrow' }).click()
    await expect(widget).toContainText(/Date\W*tomorrow/)
    expect(await moduleCode(page)).toContain('from Standard.Base import Date')
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(widget).not.toContainText(/tomorrow/)
    const code = await moduleCode(page)
    expect(code).not.toContain('import Date')
    expect(code).not.toContain('Date.tomorrow')
  })

  test('a parenthesised date is one undo step too', async ({ editorPage, page }) => {
    const { widget, menu, open } = await dateNode(editorPage, page)
    await open()
    await menu.locator(days).nth(14).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(3)
    // Edits within the undo manager's capture timeout (500 ms) merge into one step.
    await page.waitForTimeout(600)
    await open()
    await menu.locator(days).nth(15).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    await page.keyboard.press('ControlOrMeta+Z')
    expect(await moduleCode(page)).toMatch(/since = Data\.days_since \(Date\.new \d+ \d+ 15\)\n/)
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(0)
    expect(await moduleCode(page)).not.toContain('import Date')
  })
})

test.describe('Time_Of_Day widget', () => {
  const TIME_TYPE = 'Standard.Base.Data.Time.Time_Of_Day.Time_Of_Day'
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    since = Data.seconds_since\n    time1 = Time_Of_Day.new 14 30\n    time2 = Time_Of_Day.now\n    time3 = Time_Of_Day.new 14 30 second=15\n    time4 = Time_Of_Day.new 14 30 15 500\n    time5 = Time_Of_Day.new 9\n',
        ),
    },
  })

  /** A `Data.seconds_since` call whose only argument, `time`, is a `Time_Of_Day` with no `@` annotation. */
  async function timeNode(editorPage: EditorPageActions, page: Page) {
    await editorPage
      .mockSuggestion({
        type: 'type',
        module: 'Standard.Base.Data.Time.Time_Of_Day',
        name: 'Time_Of_Day',
        params: [],
        reexport: 'Standard.Base.Main',
      })
      .mockSuggestion({
        type: 'method',
        module: 'Standard.Base.Data',
        name: 'seconds_since',
        arguments: [
          {
            name: 'time',
            reprType: TIME_TYPE,
            isSuspended: false,
            hasDefault: false,
          },
        ],
        selfType: 'Standard.Base.Data',
        returnType: 'Standard.Base.Data.Numbers.Integer',
        isStatic: true,
        annotations: [],
      })
    await mockMethodCallInfo(page, 'since', {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'seconds_since',
      },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'since')
    const widget = node.locator('.WidgetTimeOfDay')
    await expect(widget).toHaveCount(1)
    const menu = page.locator('.TimeOfDayMenu')
    /** Opens the menu: the arrow under the argument appears on hover. */
    const open = async () => {
      await widget.hover()
      await expect(widget.locator('svg.arrow')).toBeVisible()
      // The corner, not the middle: the middle of a written `Date.new` is a number field.
      await widget.click({ position: { x: 4, y: 4 } })
      await expect(menu).toBeVisible()
    }
    return { node, widget, menu, open }
  }

  test('a Time_Of_Day-typed argument has the arrow, and Time_Of_Day.now writes the code it names', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    await expect(menu.locator('.item')).toHaveText(['Time_Of_Day.now'])
    await menu.getByRole('button', { name: 'Time_Of_Day.now' }).click()
    await expect(menu).toBeHidden()
    await expect(widget).toContainText(/Time_Of_Day\W*now/)
    const code = await moduleCode(page)
    expect(code).toContain('since = Data.seconds_since Time_Of_Day.now')
    expect(code).toContain('from Standard.Base import Time_Of_Day')
  })

  test('typing a time into the field and pressing Enter writes Time_Of_Day.new', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await page.keyboard.type('1430')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 14 30\)\n/,
    )
    // Reopened, the field shows the written time; Escape closes without a change.
    await open()
    await expect(menu.getByRole('spinbutton').first()).toHaveText('14')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 14 30\)\n/,
    )
  })

  test('editing a field of the written time edits the number and does not open the menu', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    await page.keyboard.type('1430')
    await page.keyboard.press('Enter')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    const minute = widget.locator('.WidgetNumber').nth(1)
    await minute.click()
    await expect(minute).toBeFocused()
    await expect(menu).toBeHidden()
    await minute.fill('45')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 14 45\)\n/,
    )
  })

  test('a click on an hour and a minute picks a time, and Set writes it', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    const hour = menu.getByRole('listbox', { name: 'Hour' })
    const minute = menu.getByRole('listbox', { name: 'Minute' })
    await hour.getByRole('option', { name: '16' }).click()
    await minute.getByRole('option', { name: '45' }).click()
    // A pick writes nothing yet; the field shows it, and keeps the keyboard.
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('spinbutton')).toHaveText(['16', '45'])
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await expect(hour.getByRole('option', { selected: true })).toHaveText('16')
    await expect(minute.getByRole('option', { selected: true })).toHaveText('45')
    await menu.getByRole('button', { name: 'Set' }).click()
    await expect(menu).toBeHidden()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 16 45\)\n/,
    )
    // Reopened, the columns show the written time, scrolled into view.
    await open()
    await expect(hour.getByRole('option', { selected: true })).toHaveText('16')
    await expect(hour.getByRole('option', { selected: true })).toBeInViewport()
    await expect(minute.getByRole('option', { selected: true })).toBeInViewport()
  })

  test('Cancel closes the menu without writing', async ({ editorPage, page }) => {
    const { menu, open } = await timeNode(editorPage, page)
    await open()
    await menu.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '16' }).click()
    await menu.getByRole('button', { name: 'Cancel' }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain('since = Data.seconds_since\n')
  })

  test('a Time_Of_Day.new with only an hour opens the menu on that hour', async ({
    editorPage,
    page,
  }) => {
    await timeNode(editorPage, page)
    const widget = locate.graphNodeByBinding(page, 'time5').locator('.WidgetTimeOfDay')
    const menu = page.locator('.TimeOfDayMenu')
    await widget.click({ position: { x: 4, y: 4 } })
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('spinbutton')).toHaveText(['09', '00'])
    await menu.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '30' }).click()
    await menu.getByRole('button', { name: 'Set' }).click()
    expect(await moduleCode(page)).toContain('time5 = Time_Of_Day.new 9 30\n')
  })

  test('the menu is as wide on a narrow node as on a wide one', async ({ editorPage, page }) => {
    const { menu, open } = await timeNode(editorPage, page)
    await open()
    const narrow = (await menu.boundingBox())!.width
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // The whole node `time4` (four arguments) is far wider than the unset argument of `since`.
    const wide = locate.graphNodeByBinding(page, 'time4').locator('.WidgetTimeOfDay')
    await wide.click({ position: { x: 4, y: 4 } })
    await wide.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    expect(Math.abs((await menu.boundingBox())!.width - narrow)).toBeLessThanOrEqual(1)
  })

  test('the menu stays lined up under its argument as the node changes width', async ({
    editorPage,
    page,
  }) => {
    const { node, widget, menu, open } = await timeNode(editorPage, page)
    /** How far the menu's left edge is from the argument's. */
    const misalignment = async () =>
      Math.abs((await menu.boundingBox())!.x - (await widget.boundingBox())!.x)
    // The unset argument is at the right end of a narrow node: the menu is wider than what is left.
    await open()
    expect(await misalignment()).toBeLessThan(3)
    await page.keyboard.type('0915')
    await menu.getByRole('button', { name: 'Set' }).click()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    await open()
    expect(await misalignment()).toBeLessThan(3)
    // The node widens to the left of the argument while the menu is open: the menu follows.
    const before = (await widget.boundingBox())!.x
    await node
      .getByText('seconds_since')
      .evaluate((el) => ((el as HTMLElement).style.paddingLeft = '120px'))
    await expect.poll(async () => (await widget.boundingBox())!.x).toBeGreaterThan(before + 100)
    await expect.poll(misalignment).toBeLessThan(3)
  })

  test('typing a time and clicking outside the menu writes it', async ({ editorPage, page }) => {
    const { menu, open } = await timeNode(editorPage, page)
    await open()
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await page.keyboard.type('0915')
    await page.mouse.click(0, 0)
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 9 15\)\n/,
    )
  })

  test('clicking outside after no edit, or after Escape, writes nothing', async ({
    editorPage,
    page,
  }) => {
    const { menu, open } = await timeNode(editorPage, page)
    await open()
    await page.mouse.click(0, 0)
    await expect(menu).toBeHidden()
    await open()
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await page.keyboard.type('0915')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).not.toContain('Time_Of_Day.new 9 15')
  })

  test('a time picked twice keeps the parentheses', async ({ editorPage, page }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    await page.keyboard.type('1430')
    await page.keyboard.press('Enter')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    await open()
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await page.keyboard.type('0815')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    const code = await moduleCode(page)
    expect(code).toMatch(/since = Data\.seconds_since \(Time_Of_Day\.new 8 15\)\n/)
    expect(code).not.toMatch(/since = Data\.seconds_since Time_Of_Day\.new/)
  })

  test('Enter on Add seconds toggles the seconds and writes nothing', async ({
    editorPage,
    page,
  }) => {
    const { menu, open } = await timeNode(editorPage, page)
    await open()
    await expect(menu.getByRole('spinbutton').first()).toBeFocused()
    await page.keyboard.type('1430')
    await menu.getByRole('button', { name: 'Add seconds' }).focus()
    await page.keyboard.press('Enter')
    await expect(menu.getByRole('spinbutton')).toHaveCount(3)
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await moduleCode(page)).toContain('since = Data.seconds_since\n')
  })

  test('a whole node (now, or new with any arguments) offers the menu once selected', async ({
    editorPage,
    page,
  }) => {
    await timeNode(editorPage, page)
    const menu = page.locator('.TimeOfDayMenu')
    for (const binding of ['time1', 'time2']) {
      const node = locate.graphNodeByBinding(page, binding)
      const widget = node.locator('.WidgetTimeOfDay')
      await expect(widget).toHaveCount(1)
      // The first click is the node's: it selects it.
      await widget.click({ position: { x: 4, y: 4 } })
      await expect(node).toHaveClass(/selected/)
      await expect(menu).toBeHidden()
      await widget.click({ position: { x: 4, y: 4 } })
      await expect(menu).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }
    const node = locate.graphNodeByBinding(page, 'time2')
    await node.locator('.WidgetTimeOfDay').click({ position: { x: 4, y: 4 } })
    await page.locator('.TimeOfDayMenu').getByRole('button', { name: 'Time_Of_Day.now' }).click()
    expect(await moduleCode(page)).toMatch(/time2 = Time_Of_Day.now$/m)
  })

  test('editing a time with a named second keeps the second', async ({ editorPage, page }) => {
    await timeNode(editorPage, page)
    const node = locate.graphNodeByBinding(page, 'time3')
    const widget = node.locator('.WidgetTimeOfDay')
    const menu = page.locator('.TimeOfDayMenu')
    await widget.click({ position: { x: 4, y: 4 } })
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('spinbutton')).toHaveText(['14', '30', '15'])
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain('time3 = Time_Of_Day.new 15 30 15\n')
  })

  test('editing a time with milliseconds keeps them', async ({ editorPage, page }) => {
    await timeNode(editorPage, page)
    const node = locate.graphNodeByBinding(page, 'time4')
    const widget = node.locator('.WidgetTimeOfDay')
    const menu = page.locator('.TimeOfDayMenu')
    await widget.click({ position: { x: 4, y: 4 } })
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain('time4 = Time_Of_Day.new 15 30 15 500\n')
  })

  test('one choice is one undo step, and the import is undone with it', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await timeNode(editorPage, page)
    await open()
    await menu.getByRole('button', { name: 'Time_Of_Day.now' }).click()
    await expect(widget).toContainText(/Time_Of_Day\W*now/)
    expect(await moduleCode(page)).toContain('from Standard.Base import Time_Of_Day')
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(widget).not.toContainText(/now/)
    const code = await moduleCode(page)
    expect(code).not.toContain('import Time_Of_Day')
    expect(code).not.toContain('seconds_since Time_Of_Day.now')
  })

  test('a parenthesised time is one undo step too', async ({ editorPage, page }) => {
    const { widget, open } = await timeNode(editorPage, page)
    await open()
    await page.keyboard.type('1430')
    await page.keyboard.press('Enter')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(2)
    // Edits within the undo manager's capture timeout (500 ms) merge into one step.
    await page.waitForTimeout(600)
    await open()
    await page.keyboard.type('0815')
    await page.keyboard.press('Enter')
    await page.keyboard.press('ControlOrMeta+Z')
    expect(await moduleCode(page)).toMatch(
      /since = Data\.seconds_since \(Time_Of_Day\.new 14 30\)\n/,
    )
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(widget.locator('.WidgetNumber')).toHaveCount(0)
    expect(await moduleCode(page)).not.toContain('import Time_Of_Day')
  })
})

test.describe('Date_Time widget', () => {
  const DATE_TIME_TYPE = 'Standard.Base.Data.Time.Date_Time.Date_Time'
  const days = '[data-reka-calendar-cell-trigger]:not([data-outside-view])'
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    since = Data.hours_since\n    dt1 = Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc\n    dt2 = Date_Time.now\n    dt3 = Date_Time.new 2026 11 17 14\n',
        ),
    },
  })

  /** A `Data.hours_since` call whose only argument, `moment`, is a `Date_Time` with no `@` annotation. */
  async function dateTimeNode(editorPage: EditorPageActions, page: Page) {
    await editorPage
      .mockSuggestion({
        type: 'type',
        module: 'Standard.Base.Data.Time.Date_Time',
        name: 'Date_Time',
        params: [],
        reexport: 'Standard.Base.Main',
      })
      .mockSuggestion({
        type: 'method',
        module: 'Standard.Base.Data',
        name: 'hours_since',
        arguments: [
          {
            name: 'moment',
            reprType: DATE_TIME_TYPE,
            isSuspended: false,
            hasDefault: false,
          },
        ],
        selfType: 'Standard.Base.Data',
        returnType: 'Standard.Base.Data.Numbers.Integer',
        isStatic: true,
        annotations: [],
      })
    await mockMethodCallInfo(page, 'since', {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'hours_since',
      },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'since')
    const widget = node.locator('.WidgetDateTime')
    await expect(widget).toHaveCount(1)
    const menu = page.locator('.DateTimeMenu')
    /** Opens the menu: the arrow under the argument appears on hover. */
    const open = async () => {
      await widget.hover()
      await expect(widget.locator('svg.arrow')).toBeVisible()
      // The corner, not the middle: the middle of a written `Date_Time.new` is a number field.
      await widget.click({ position: { x: 4, y: 4 } })
      await expect(menu).toBeVisible()
    }
    return { node, widget, menu, open }
  }

  /** The module's code; the code editor is closed again afterwards. */
  async function moduleCode(page: Page): Promise<string> {
    await page.keyboard.press('ControlOrMeta+`')
    await expect(page.locator('.CodeEditor')).toBeVisible()
    const code = await page.evaluate(() => (window as any).__codeEditorApi.textContent())
    await page.keyboard.press('ControlOrMeta+`')
    await expect(page.locator('.CodeEditor')).toBeHidden()
    return code
  }

  test('a Date_Time argument: now writes the code it names, with the import', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateTimeNode(editorPage, page)
    await open()
    await expect(menu.locator('.item')).toHaveText(['Date_Time.now'])
    await expect(menu.getByRole('spinbutton')).toHaveCount(2)
    await menu.getByRole('button', { name: 'Date_Time.now' }).click()
    await expect(menu).toBeHidden()
    await expect(widget).toContainText(/Date_Time\W*now/)
    const code = await moduleCode(page)
    expect(code).toContain('since = Data.hours_since Date_Time.now')
    expect(code).toContain('from Standard.Base import Date_Time')
  })

  test('a day writes Date_Time.new, parenthesised, with five ports', async ({
    editorPage,
    page,
  }) => {
    const { widget, menu, open } = await dateTimeNode(editorPage, page)
    await open()
    await menu.locator(days).nth(19).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    await expect(widget.locator('.WidgetNumber')).toHaveCount(5)
    expect(await moduleCode(page)).toMatch(
      /since = Data\.hours_since \(Date_Time\.new \d+ \d+ 20 \d+ \d+\)\n/,
    )
  })

  test('a time typed and Enter writes it on today', async ({ editorPage, page }) => {
    const { menu, open } = await dateTimeNode(editorPage, page)
    await open()
    await menu.getByRole('spinbutton').first().focus()
    await page.keyboard.type('0930')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toMatch(
      /since = Data\.hours_since \(Date_Time\.new \d+ \d+ \d+ 9 30\)\n/,
    )
  })

  /** The whole node `dt1`, opened: one click selects it, the next opens the menu. */
  async function openWholeNode(page: Page) {
    const node = locate.graphNodeByBinding(page, 'dt1')
    const widget = node.locator('.WidgetDateTime')
    const menu = page.locator('.DateTimeMenu')
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(node).toHaveClass(/selected/)
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    return { node, widget, menu }
  }

  test('a day picked on a whole node keeps its second and zone', async ({ editorPage, page }) => {
    await dateTimeNode(editorPage, page)
    const { menu } = await openWholeNode(page)
    await menu.locator(days).nth(19).click()
    await menu.getByRole('button', { name: 'Set', exact: true }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain(
      'dt1 = Date_Time.new 2020 1 20 9 30 45 zone=Time_Zone.utc\n',
    )
  })

  test('a time edited on a whole node keeps its day, second and zone', async ({
    editorPage,
    page,
  }) => {
    await dateTimeNode(editorPage, page)
    const { menu } = await openWholeNode(page)
    await menu.getByRole('spinbutton').first().focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain(
      'dt1 = Date_Time.new 2020 1 15 10 30 45 zone=Time_Zone.utc\n',
    )
  })

  test('a Date_Time.new with only an hour opens on that hour; a column pick and Set write it', async ({
    editorPage,
    page,
  }) => {
    await dateTimeNode(editorPage, page)
    const node = locate.graphNodeByBinding(page, 'dt3')
    const widget = node.locator('.WidgetDateTime')
    const menu = page.locator('.DateTimeMenu')
    await widget.click({ position: { x: 4, y: 4 } })
    await widget.click({ position: { x: 4, y: 4 } })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('spinbutton')).toHaveText(['14', '00'])
    await menu.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '30' }).click()
    await expect(menu.getByRole('spinbutton')).toHaveText(['14', '30'])
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: 'Set' }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain('dt3 = Date_Time.new 2026 11 17 14 30\n')
  })

  test('Cancel after a column pick writes nothing', async ({ editorPage, page }) => {
    await dateTimeNode(editorPage, page)
    const { menu } = await openWholeNode(page)
    await menu.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '16' }).click()
    await menu.getByRole('button', { name: 'Cancel' }).click()
    await expect(menu).toBeHidden()
    expect(await moduleCode(page)).toContain(
      'dt1 = Date_Time.new 2020 1 15 9 30 second=45 zone=Time_Zone.utc\n',
    )
  })

  test('the menu has its own fixed width, on a narrow node as on a wide one, with the time beside the calendar', async ({
    editorPage,
    page,
  }) => {
    const { menu, open } = await dateTimeNode(editorPage, page)
    await open()
    const narrow = (await menu.boundingBox())!
    // The time panel is to the right of the calendar, and its columns end where the calendar does.
    const calendar = (await menu.locator('.calendarPanel').boundingBox())!
    const time = (await menu.locator('.timePanel').boundingBox())!
    expect(time.x).toBeGreaterThanOrEqual(calendar.x + calendar.width)
    expect(Math.abs(time.y + time.height - (calendar.y + calendar.height))).toBeLessThanOrEqual(1)
    // Wider than the date and time-of-day menus' 200 px: the date-time menu's own width, with room
    // for a third (seconds) column; `dt1` below opens with seconds.
    expect(narrow.width).toBeGreaterThan(300)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // The whole node `dt1` (seven arguments) is far wider than the unset argument of `since`.
    const { menu: wideMenu } = await openWholeNode(page)
    expect(Math.abs((await wideMenu.boundingBox())!.width - narrow.width)).toBeLessThanOrEqual(1)
  })

  test('Date_Time.now as a whole node has the picker', async ({ editorPage, page }) => {
    await dateTimeNode(editorPage, page)
    await expect(locate.graphNodeByBinding(page, 'dt2').locator('.WidgetDateTime')).toHaveCount(1)
  })
})

test.describe('Boolean widget', () => {
  const BOOLEAN_TYPE = 'Standard.Base.Data.Boolean.Boolean'
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    kept = Data.keep_rows True\n    unset = Data.keep_rows\n    computed = Data.keep_rows (1 > 2)\n    flag = True\n    both = flag && True\n',
        ),
    },
  })

  /** `Data.keep_rows` takes one Boolean argument, `keep`, defaulting to `False`. */
  async function booleanNode(
    editorPage: EditorPageActions,
    page: Page,
    binding: 'kept' | 'unset' | 'computed',
  ) {
    await editorPage.mockSuggestion({
      type: 'method',
      module: 'Standard.Base.Data',
      name: 'keep_rows',
      arguments: [
        {
          name: 'keep',
          reprType: BOOLEAN_TYPE,
          isSuspended: false,
          hasDefault: true,
          defaultValue: 'False',
          tagValues: ['True', 'False'],
        },
      ],
      selfType: 'Standard.Base.Data',
      returnType: 'Standard.Base.Data.Numbers.Integer',
      isStatic: true,
      annotations: [],
    })
    await mockMethodCallInfo(page, binding, {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'keep_rows',
      },
      notAppliedArguments: binding === 'unset' ? [0] : [],
    })
    const node = locate.graphNodeByBinding(page, binding)
    const widget = node.locator('.WidgetBoolean')
    return { node, widget, checkbox: widget.locator('.Checkbox') }
  }

  test('a set argument shows the checkbox and its code, and the checkbox flips it both ways', async ({
    editorPage,
    page,
  }) => {
    const { widget, checkbox } = await booleanNode(editorPage, page, 'kept')
    await expect(widget).toHaveCount(1)
    await expect(widget).toContainText('True')
    await checkbox.click()
    await expect(widget).toContainText('False')
    expect(await moduleCode(page)).toContain('kept = Data.keep_rows False\n')
    await checkbox.click()
    await expect(widget).toContainText('True')
    expect(await moduleCode(page)).toContain('kept = Data.keep_rows True\n')
    // The checkbox does not open the list.
    await expect(page.locator('.DropdownWidget')).toBeHidden()
  })

  test('the arrow lists True and False only, and a pick writes it', async ({
    editorPage,
    page,
  }) => {
    const { node } = await booleanNode(editorPage, page, 'kept')
    const dropDown = new DropDownLocator(node)
    const selection = node.locator('.WidgetSelection').first()
    await selection.hover()
    await expect(selection.locator('svg.arrow')).toBeVisible()
    // The corner: the argument name and checkbox fill the rest of the widget, and the checkbox
    // does not open the list.
    await selection.click({ position: { x: 4, y: 4 } })
    await dropDown.expectVisibleWithOptions(['True', 'False'])
    await dropDown.clickOption('False')
    await dropDown.expectNotVisible()
    expect(await moduleCode(page)).toContain('kept = Data.keep_rows False\n')
  })

  test('an unset argument stays hidden when selected; the `…` menu adds it with a checkbox', async ({
    editorPage,
    page,
  }) => {
    const { node, widget, checkbox } = await booleanNode(editorPage, page, 'unset')
    await node.click({ position: { x: 8, y: 8 } })
    await expect(widget).toHaveCount(0)
    await actions.showHiddenArguments(page, node)
    await expect(widget).toHaveCount(1)
    await expect(widget).toContainText('False')
    await checkbox.click()
    await expect(widget).toContainText('True')
    expect(await moduleCode(page)).toMatch(/unset = Data\.keep_rows (keep=)?True\n/)
  })

  test('an expression value has no checkbox, and keeps the arrow', async ({ editorPage, page }) => {
    const { node } = await booleanNode(editorPage, page, 'computed')
    await expect(node.locator('.WidgetBoolean')).toHaveCount(0)
    await expect(node.locator('.WidgetSelection')).toHaveCount(1)
    const selection = node.locator('.WidgetSelection').first()
    await selection.hover()
    await expect(selection.locator('svg.arrow')).toBeVisible()
  })

  test('an infix operand keeps its checkbox and has no arrow', async ({ editorPage, page }) => {
    await editorPage
    const node = locate.graphNodeByBinding(page, 'both')
    await expect(node.locator('.WidgetBoolean')).not.toHaveCount(0)
    await expect(node.locator('.WidgetSelection')).toHaveCount(0)
  })

  test('a whole True node has the checkbox and no arrow', async ({ editorPage, page }) => {
    await editorPage
    const node = locate.graphNodeByBinding(page, 'flag')
    const widget = node.locator('.WidgetBoolean')
    await expect(widget).toHaveCount(1)
    await expect(node.locator('.WidgetSelection')).toHaveCount(0)
    await widget.locator('.Checkbox').click()
    expect(await moduleCode(page)).toContain('flag = False\n')
  })
})
