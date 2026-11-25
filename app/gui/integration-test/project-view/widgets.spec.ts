import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import {
  clearMockWidgetConfigurations,
  lastWidgetQueryArguments,
  restoreMockMainFile,
  restoreMockWidgetConfigurations,
  setMockMainFile,
  setMockResolverAnswer,
  typeDefaultQueryCount,
  widgetQueriesOf,
  widgetQueryCount,
  type MockWidgetQuery,
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
        },
      ],
    ])

    const formatArg = topLevelArgs.filter({ has: page.getByText('format') })
    const formatDropdown = new DropDownLocator(formatArg)
    await formatArg.click()
    await formatDropdown.expectVisibleWithOptions(['Csv', 'Excel'])
  })

  test('A widget whose query failed shows the error and stays editable', async ({
    page,
    localApi,
    editorPage,
  }) => {
    const node = await dataReadNodeWithMethodCallInfo(editorPage)
    await localApi.updateVisualization('.read', {
      arguments: [['format', { error: { step: 'annotation', message: 'No formats today' } }]],
    })
    // With an answer, an unset `format` is hidden (its placeholder shows only while the query is
    // pending): set it, so that its argument is drawn with the marker.
    await actions.showHiddenArguments(page, node)
    const formatArg = node
      .locator('.WidgetTopLevelArgument')
      .filter({ has: page.getByText('format') })
    const marker = formatArg.getByTestId('widget-query-error')
    await expect(marker).toBeVisible()
    await expect(marker).toHaveAttribute('aria-label', 'No widget: No formats today')
    await marker.hover()
    await expect(page.locator('.Tooltip').getByText('No widget: No formats today')).toBeVisible()
    // Still editable: the format's static tags give the fallback dropdown.
    const dropdown = new DropDownLocator(formatArg)
    await formatArg.click()
    await dropdown.expectVisible()
    await expect(dropdown.items.first()).toBeVisible()
  })

  /**
   * An `always` argument (`aggregate`'s `columns`, in the mock's front matter) is drawn before the
   * widget query is answered, and stays when the query fails: only its widget arrives late.
   */
  test('An always-displayed argument does not pop in', async ({ page, localApi, editorPage }) => {
    await editorPage.mockMethodCallInfo('aggregated', {
      methodPointer: {
        module: 'Standard.Table.Table',
        definedOnType: 'Standard.Table.Table.Table',
        name: 'aggregate',
      },
      notAppliedArguments: [1, 2, 3, 4],
    })
    const node = locate.graphNodeByBinding(page, 'aggregated')
    const args = node.locator('.WidgetTopLevelArgument')
    // The mock holds the answer back: the query is pending, and only `columns` is shown.
    await expect.poll(() => localApi.pendingVisualizationRequests('.aggregate')).toBeGreaterThan(0)
    await expect(args).toHaveCount(1)
    await expect(args.getByText('columns', { exact: true })).toBeVisible()
    // The query fails: the argument stays, with the error marker.
    await localApi.updateVisualization('.aggregate', {
      arguments: [['columns', { error: { step: 'annotation', message: 'No columns today' } }]],
    })
    await expect(args.getByTestId('widget-query-error')).toBeVisible()
    await expect(args).toHaveCount(1)
    await expect(args.getByText('columns', { exact: true })).toBeVisible()
  })

  test('An answer the IDE cannot read reaches the Logs panel', async ({
    page,
    localApi,
    editorPage,
  }) => {
    const calls = localApi.trackCalls()
    const node = await dataReadNodeWithMethodCallInfo(editorPage)
    await actions.showHiddenArguments(page, node)
    await localApi.updateVisualization('.read', { arguments: 'not a list' })
    await expect
      .poll(() => calls.engineLogAppends.map((entry) => entry.logger))
      .toContain('enso.gui.Widgets')
    // The node still shows its arguments, as without a widget.
    await expect(node.locator('.WidgetTopLevelArgument')).toHaveCount(3)
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
    // `aggregate`'s widgets are computed from its table: a resolver's answer, asked again for
    // every new table (a static answer would be asked once per method).
    const dependsOnTable = (args: [string, unknown][]) => ({
      arguments: args.map(([name, widget]) => [
        name,
        { widget, resolver: { dependencies: ['self'], searchable: false } },
      ]),
    })
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
    await localApi.updateVisualization(
      '.aggregate',
      dependsOnTable([
        [
          'columns',
          {
            type: 'Widget',
            constructor: 'Single_Choice',
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
                    },
                  ],
                ],
              },
            ],
          },
        ],
      ]),
    )
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
        },
      ],
    ])
    await firstItemDropdown.expectVisibleWithOptions(['column 1', 'column 2'])

    // Update parent configuration
    await localApi.updateVisualization(
      '.aggregate',
      dependsOnTable([
        [
          'columns',
          {
            type: 'Widget',
            constructor: 'Single_Choice',
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
                    },
                  ],
                ],
              },
            ],
          },
        ],
      ]),
    )
    await firstItemDropdown.expectVisibleWithOptions(['column 5', 'column 6'])
  })
})

test('Selection widgets in Data.read node', async ({ editorPage, page }) => {
  const node = await dataReadNodeWithMethodCallInfo(editorPage)
  // Check initially visible arguments
  const topLevelArgs = node.locator('.WidgetTopLevelArgument')
  await expect(topLevelArgs).toHaveCount(1)

  // Selecting the node does not show the rest; its ＋ does
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

test('Selection widget: the arrow keys move the highlight and Enter chooses', async ({
  editorPage,
  page,
}) => {
  const node = await dataReadNodeWithMethodCallInfo(editorPage)
  const topLevelArgs = node.locator('.WidgetTopLevelArgument')
  await actions.showHiddenArguments(page, node)
  await expect(topLevelArgs).toHaveCount(3)
  const onProblemsArg = topLevelArgs.filter({ has: page.getByText('on_problems') })
  await onProblemsArg.click()
  const dropDown = new DropDownLocator(onProblemsArg)
  await dropDown.expectVisibleWithOptions(['..Ignore', '..Report_Warning', '..Report_Error'])
  const highlighted = dropDown.dropDown.locator('.item.highlighted')
  await expect(highlighted).toHaveCount(0)
  // Nothing is chosen yet: Down starts at the top, and Up from the top wraps to the bottom.
  await page.keyboard.press('ArrowDown')
  await expect(highlighted).toHaveText('..Ignore')
  await page.keyboard.press('ArrowUp')
  await expect(highlighted).toHaveText('..Report_Error')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(highlighted).toHaveText('..Report_Warning')
  // The mouse moves the same highlight, and the keys go on from where it left it.
  await dropDown.item('..Ignore').hover()
  await expect(highlighted).toHaveText('..Ignore')
  await page.keyboard.press('ArrowDown')
  await expect(highlighted).toHaveText('..Report_Warning')
  await page.keyboard.press('Enter')
  await dropDown.expectNotVisible()
  await expect(onProblemsArg.locator('.WidgetToken')).toContainText(['..', 'Report_Warning'])
  expect(await moduleCode(page)).toMatch(/data = Data\.read .*on_problems=\.\.Report_Warning\n/)

  // With the dropdown filtered by typing, the keys move among the entries left.
  const pathArg = topLevelArgs.filter({ has: page.getByText('path') })
  const pathDropDown = new DropDownLocator(pathArg)
  const pathInput = pathArg.getByTestId('widget-text-content')
  await pathArg.click()
  await pathDropDown.clickOption('File 1')
  await expect(pathInput).toHaveText('File 1')
  await pathInput.click()
  await pathDropDown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
  await page.keyboard.insertText('File')
  await pathDropDown.expectVisibleWithOptions(['File 1', 'File 2'])
  await page.keyboard.press('ArrowUp')
  await expect(pathDropDown.dropDown.locator('.item.highlighted')).toHaveText('File 2')
  await page.keyboard.press('Enter')
  await expect(pathInput).toHaveText('File 2')
  await expect(pathDropDown.dropDown).toBeHidden()

  // Escape still closes the dropdown after the keys have moved the highlight.
  await onProblemsArg.click()
  await dropDown.expectVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await dropDown.expectNotVisible()
  await expect(onProblemsArg.locator('.WidgetToken')).toContainText(['..', 'Report_Warning'])
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
  // Its ＋ offers them
  const menu = await actions.openAddArgumentMenu(page, node)
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
      const groupBy = node.getByTestId('list-item-content').first()
      await expect(groupBy).toBeVisible()
      await expect(groupBy.locator('.WidgetArgumentName')).toContainText(['column'])
    })
  // The nested autoscoped constructor's widgets are asked for by method pointer, with the
  // constructor's type as the subject.
  expect(lastWidgetQueryArguments('.Group_By')).toEqual([
    "'Standard.Table.Aggregate_Column'",
    "'Standard.Table.Aggregate_Column.Aggregate_Column'",
    "'Group_By'",
    expect.any(String),
    expect.any(String),
    'True',
  ])
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

  test('an unset argument stays hidden when selected; its ＋ adds it with a checkbox', async ({
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

test.describe('Type defaults from the library', () => {
  const DATE_TYPE = 'Standard.Base.Data.Time.Date.Date'
  const TEXT_TYPE = 'Standard.Base.Data.Text.Text'
  const INTEGER_OR_NOTHING = 'Standard.Base.Data.Numbers.Integer | Standard.Base.Nothing.Nothing'
  test.afterEach(restoreMockMainFile)
  test.afterEach(restoreMockWidgetConfigurations)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    first = Data.days_since\n    second = Data.days_since\n    limited = Data.limit\n    nest = Data.outer (Data.weeks_since)\n    picked = Data.pick\n    chosen = Data.choose (..Between)\n',
        ),
    },
  })

  const dateParam = { name: 'date', reprType: DATE_TYPE, isSuspended: false, hasDefault: false }

  function staticMethod(
    name: string,
    param: { name: string; reprType: string; isSuspended: boolean; hasDefault: boolean },
    annotations: string[] = [],
  ) {
    return {
      type: 'method' as const,
      module: 'Standard.Base.Data',
      name,
      arguments: [param],
      selfType: 'Standard.Base.Data',
      returnType: 'Standard.Base.Data.Numbers.Integer',
      isStatic: true,
      annotations,
    }
  }

  function pointer(name: string) {
    return {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name,
      },
      notAppliedArguments: [0],
    }
  }

  test("a type's default widget is asked once", async ({ editorPage, page }) => {
    await editorPage.mockSuggestion(staticMethod('days_since', dateParam))
    await mockMethodCallInfo(page, 'first', pointer('days_since'))
    await mockMethodCallInfo(page, 'second', pointer('days_since'))
    await expect(locate.graphNodeByBinding(page, 'first').locator('.WidgetDate')).toHaveCount(1)
    await expect(locate.graphNodeByBinding(page, 'second').locator('.WidgetDate')).toHaveCount(1)
    expect(typeDefaultQueryCount(DATE_TYPE)).toBe(1)
  })

  test("optional arguments take their first member's widget", async ({ editorPage, page }) => {
    await editorPage.mockSuggestion(
      staticMethod('limit', {
        name: 'count',
        reprType: INTEGER_OR_NOTHING,
        isSuspended: false,
        hasDefault: false,
      }),
    )
    await mockMethodCallInfo(page, 'limited', pointer('limit'))
    await expect(locate.graphNodeByBinding(page, 'limited').locator('.WidgetNumber')).toHaveCount(1)
    // The union was reduced to its first member in the request.
    expect(typeDefaultQueryCount('Standard.Base.Data.Numbers.Integer')).toBe(1)
  })

  test("a nested call's date argument gets the picker", async ({ editorPage, page }) => {
    await editorPage
      .mockSuggestion(
        staticMethod('outer', {
          name: 'inner',
          reprType: 'Standard.Base.Any.Any',
          isSuspended: false,
          hasDefault: false,
        }),
      )
      .mockSuggestion(staticMethod('weeks_since', dateParam))
    await mockMethodCallInfo(page, 'nest', pointer('outer'))
    await mockMethodCallInfo(
      page,
      { binding: 'nest', expr: 'Data.weeks_since' },
      pointer('weeks_since'),
    )
    await expect(locate.graphNodeByBinding(page, 'nest').locator('.WidgetDate')).toHaveCount(1)
  })

  // The nested constructor's argument is in the choice's configuration (`parameters: []`) but has
  // no entry there: it takes the type default.
  test("a choice's constructor argument gets its type default", async ({
    editorPage,
    page,
    localApi,
  }) => {
    await editorPage
      .mockSuggestion(
        staticMethod(
          'choose',
          {
            name: 'condition',
            reprType: 'Standard.Base.Any.Any',
            isSuspended: false,
            hasDefault: false,
          },
          ['condition'],
        ),
      )
      .mockSuggestion(staticMethod('Between', dateParam))
    await localApi.updateVisualization('.choose', [
      [
        'condition',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: '..Between',
              label: 'Between',
              parameters: [],
            },
          ],
        },
      ],
    ])
    await mockMethodCallInfo(page, 'chosen', pointer('choose'))
    await mockMethodCallInfo(page, { binding: 'chosen', expr: '..Between' }, pointer('Between'))
    await expect(locate.graphNodeByBinding(page, 'chosen').locator('.WidgetDate')).toHaveCount(1)
  })

  test('an annotation still wins over the type default', async ({ editorPage, page, localApi }) => {
    await editorPage.mockSuggestion(
      staticMethod(
        'pick',
        { name: 'word', reprType: TEXT_TYPE, isSuspended: false, hasDefault: false },
        ['word'],
      ),
    )
    await localApi.updateVisualization('.pick', [
      [
        'word',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          values: [
            { type: 'Choice', constructor: 'Option', value: "'a'", label: 'A', parameters: [] },
            { type: 'Choice', constructor: 'Option', value: "'b'", label: 'B', parameters: [] },
          ],
        },
      ],
    ])
    await mockMethodCallInfo(page, 'picked', pointer('pick'))
    const node = locate.graphNodeByBinding(page, 'picked')
    await expect(node.locator('.WidgetSelection')).toHaveCount(1)
    await expect(node.locator('.WidgetText')).toHaveCount(0)
  })
})

test.describe('Kind picker', () => {
  const T = 'Standard.Base.Data'
  const INTEGER = `${T}.Numbers.Integer`
  const TEXT = `${T}.Text.Text`
  const NOTHING = 'Standard.Base.Nothing.Nothing'
  const REGEX = `${T}.Text.Regex.Regex`
  const SECRET = 'Standard.Base.Enso_Cloud.Enso_Secret.Enso_Secret'
  const FILE = 'Standard.Base.System.File.File'
  const LOCALE = `${T}.Locale.Locale`

  test.afterEach(restoreMockMainFile)
  test.afterEach(restoreMockWidgetConfigurations)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          [
            'from Standard.Base import Data',
            '',
            'main =',
            '    intn = Data.int_nothing',
            '    textn = Data.text_nothing',
            "    textint = Data.text_int 'a'",
            "    textre = Data.text_regex 'a.*c'",
            "    textsec = Data.text_secret 'pw'",
            '    loc = Data.locale_nothing',
            '    rd = Data.read',
            '    tfn = Data.text_file_nothing',
            '    annot = Data.annotated',
            "    vec = Data.vec_items ['a', 1]",
            '',
          ].join('\n'),
        ),
    },
  })

  function unionMethod(
    name: string,
    reprType: string,
    options: { annotations?: string[]; defaultValue?: string } = {},
  ) {
    return {
      type: 'method' as const,
      module: T,
      name,
      arguments: [
        {
          name: 'value',
          reprType,
          isSuspended: false,
          hasDefault: options.defaultValue != null,
          ...(options.defaultValue != null ? { defaultValue: options.defaultValue } : {}),
        },
      ],
      selfType: T,
      returnType: INTEGER,
      isStatic: true,
      annotations: options.annotations ?? [],
    }
  }

  /** The node bound to `binding`, calling `method` whose only argument is not applied (or is, if `applied`). */
  async function kindNode(
    editorPage: EditorPageActions,
    page: Page,
    binding: string,
    method: ReturnType<typeof unionMethod>,
    applied = false,
  ) {
    await editorPage.mockSuggestion(method)
    await mockMethodCallInfo(page, binding, {
      methodPointer: { module: T, definedOnType: T, name: method.name },
      notAppliedArguments: applied ? [] : [0],
    })
    const node = locate.graphNodeByBinding(page, binding)
    await expect(node.locator('.WidgetKindPicker').first()).toBeVisible()
    return node
  }

  async function select(page: Page, node: locate.Node) {
    await locate.graphNodeIcon(node).click()
    await expect(node).toBeSelected()
  }

  const changeKind = (node: Locator, name: string) =>
    node.getByRole('button', { name: `${name}, change kind` })
  const list = (page: Page) => new DropDownLocator(page.locator('body'))
  /** The argument's name, and the chip directly after it (in front of the value). */
  const argumentName = (node: Locator) => node.locator('.WidgetArgumentName > .name')
  const chipAfterName = (node: Locator) => node.locator('.WidgetArgumentName > .name + .KindChip')

  test('Integer | Nothing: unselected shows only the icon, which does not open anything', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'intn',
      unionMethod('int_nothing', `${INTEGER} | ${NOTHING}`),
    )
    await expect(node.locator('.kindIcon')).toBeVisible()
    await expect(argumentName(node)).toHaveText('value')
    await expect(chipAfterName(node)).toHaveCount(1)
    await expect(node.getByRole('button', { name: /change kind/ })).toHaveCount(0)
    await node.locator('.kindIcon').click({ force: true })
    await expect(node).toBeSelected()
    // Selected by that click: the icon is now a button, and no list opened by itself.
    await expect(changeKind(node, 'Integer')).toBeVisible()
    await expect(list(page).dropDownAnyState).toHaveCount(0)
  })

  test('Integer | Nothing: choosing Nothing writes Nothing, which is a button only while selected', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'intn',
      unionMethod('int_nothing', `${INTEGER} | ${NOTHING}`),
    )
    await select(page, node)
    await changeKind(node, 'Integer').click()
    await expect(changeKind(node, 'Integer')).toHaveAttribute('aria-expanded', 'true')
    const dropdown = list(page)
    await dropdown.expectVisibleWithOptions(['Integer', 'Nothing'])
    await expect(dropdown.items.first().locator('svg')).toHaveCount(1)
    await dropdown.clickOption('Nothing')
    await expect(changeKind(node, 'Nothing')).toBeVisible()
    await expect(node.locator('.kindIcon, .kindSymbol')).toHaveCount(0)
    // The name stays, and the Nothing button stands in for the value right after it.
    await expect(argumentName(node)).toHaveText('value')
    await expect(
      chipAfterName(node).getByRole('button', { name: 'Nothing, change kind' }),
    ).toBeVisible()
    await expect(node.locator('.WidgetArgumentName')).toHaveText(/^\s*value\s*Nothing\s*$/)
    expect(await moduleCode(page)).toContain('intn = Data.int_nothing Nothing\n')
    await actions.clickAtBackground(page)
    await expect(node).not.toBeSelected()
    await expect(argumentName(node)).toHaveText('value')
    await expect(node.getByRole('button', { name: /change kind/ })).toHaveCount(0)
    await expect(node.locator('.WidgetKindPicker')).toContainText('Nothing')
    await expect(node.locator('.kindIcon')).toHaveCount(0)
  })

  test('keyboard: Enter opens, ArrowDown and Enter pick Nothing, Escape closes', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'intn',
      unionMethod('int_nothing', `${INTEGER} | ${NOTHING}`),
    )
    await select(page, node)
    await changeKind(node, 'Integer').focus()
    await page.keyboard.press('Enter')
    const dropdown = list(page)
    await dropdown.expectVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await dropdown.expectNotVisible()
    await expect(changeKind(node, 'Nothing')).toBeFocused()
    expect(await moduleCode(page)).toContain('intn = Data.int_nothing Nothing\n')
    await changeKind(node, 'Nothing').press('Enter')
    await dropdown.expectVisible()
    await page.keyboard.press('Escape')
    await dropdown.expectNotVisible()
    await expect(changeKind(node, 'Nothing')).toBeFocused()
  })

  test('Text | Nothing with a default of Nothing: the added argument is an explicit Nothing, and Text and back write code', async ({
    editorPage,
    page,
  }) => {
    await editorPage.mockSuggestion(
      unionMethod('text_nothing', `${TEXT} | ${NOTHING}`, { defaultValue: 'Nothing' }),
    )
    await mockMethodCallInfo(page, 'textn', {
      methodPointer: { module: T, definedOnType: T, name: 'text_nothing' },
      notAppliedArguments: [0],
    })
    // An argument with a default is hidden until it is added through the ＋ menu.
    const node = locate.graphNodeByBinding(page, 'textn')
    await actions.addArgument(page, node, 'value')
    await expect(changeKind(node, 'Nothing')).toBeVisible()
    await expect(argumentName(node)).toHaveText('value')
    expect(await moduleCode(page)).toContain('textn = Data.text_nothing value=Nothing\n')
    await changeKind(node, 'Nothing').click()
    await list(page).clickOption('Text')
    await expect(changeKind(node, 'Text')).toBeVisible()
    expect(await moduleCode(page)).toContain("textn = Data.text_nothing value=''\n")
    await changeKind(node, 'Text').click()
    await list(page).clickOption('Nothing')
    await expect(changeKind(node, 'Nothing')).toBeVisible()
    expect(await moduleCode(page)).toContain('textn = Data.text_nothing value=Nothing\n')
  })

  const heightOf = async (locator: Locator) => (await locator.boundingBox())?.height ?? NaN

  test('the kind button is as high as a value chip, and selecting does not change the node height', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'textint',
      unionMethod('text_int', `${TEXT} | ${INTEGER}`),
      true,
    )
    const textChip = node.locator('.WidgetText').first()
    const unselectedNode = await heightOf(node)
    // The faint icon, unselected, is already a chip's height.
    expect(
      Math.abs((await heightOf(node.locator('.kindIcon'))) - (await heightOf(textChip))),
    ).toBeLessThan(1)
    await select(page, node)
    expect(Math.abs((await heightOf(node)) - unselectedNode)).toBeLessThan(1)
    // The icon form.
    const button = changeKind(node, 'Text')
    expect(Math.abs((await heightOf(button)) - (await heightOf(textChip)))).toBeLessThan(1)
    // The Nothing form, beside a number chip.
    const intNode = await kindNode(
      editorPage,
      page,
      'intn',
      unionMethod('int_nothing', `${INTEGER} | ${NOTHING}`),
    )
    const intUnselected = await heightOf(intNode)
    await select(page, intNode)
    const numberChip = intNode.locator('.NumericInputWidget').first()
    await expect(numberChip).toBeVisible()
    const numberHeight = await heightOf(numberChip)
    await changeKind(intNode, 'Integer').click()
    await list(page).clickOption('Nothing')
    const nothing = changeKind(intNode, 'Nothing')
    await expect(nothing).toBeVisible()
    expect(Math.abs((await heightOf(nothing)) - numberHeight)).toBeLessThan(1)
    expect(Math.abs((await heightOf(intNode)) - intUnselected)).toBeLessThan(1)
  })

  test('switching kind is one undo step', async ({ editorPage, page }) => {
    const node = await kindNode(
      editorPage,
      page,
      'textint',
      unionMethod('text_int', `${TEXT} | ${INTEGER}`),
      true,
    )
    await expect(node.locator('.kindIcon')).toHaveAttribute('title', 'Text')
    await select(page, node)
    await changeKind(node, 'Text').click()
    await list(page).clickOption('Integer')
    await expect(changeKind(node, 'Integer')).toBeVisible()
    expect(await moduleCode(page)).toContain('textint = Data.text_int 0\n')
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(changeKind(node, 'Text')).toBeVisible()
    expect(await moduleCode(page)).toContain("textint = Data.text_int 'a'\n")
  })

  test('Text | Regex: switching writes regex, whose pattern is edited in place', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'textre',
      unionMethod('text_regex', `${TEXT} | ${REGEX}`),
      true,
    )
    await expect(node.locator('.kindIcon')).toHaveAttribute('title', 'Text')
    await select(page, node)
    await changeKind(node, 'Text').click()
    await list(page).clickOption('Regex')
    await expect(changeKind(node, 'Regex')).toBeVisible()
    expect(await moduleCode(page)).toContain("textre = Data.text_regex (regex '.*')\n")
    await expect(argumentName(node)).toHaveText('value')
    await expect(chipAfterName(node)).toHaveCount(1)
    // The node still shows the code, not a stand-in for it.
    await expect(node).toContainText(/regex\W*\.\*/)
    const pattern = node.locator('.WidgetRegex').getByTestId('widget-text-content')
    await expect(pattern).toHaveText('.*')
    await pattern.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('a+')
    await page.keyboard.press('Enter')
    await expect(node).toContainText(/regex\W*a\+/)
    expect(await moduleCode(page)).toContain("textre = Data.text_regex (regex 'a+')\n")
  })

  test('Text | Enso_Secret: switching writes Enso_Secret.get with the secret browser beside the key', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'textsec',
      unionMethod('text_secret', `${TEXT} | ${SECRET}`),
      true,
    )
    await expect(node.locator('.kindIcon')).toHaveAttribute('title', 'Text')
    await select(page, node)
    await changeKind(node, 'Text').click()
    await list(page).clickOption('Enso_Secret')
    await expect(changeKind(node, 'Enso_Secret')).toBeVisible()
    const code = await moduleCode(page)
    expect(code).toContain("textsec = Data.text_secret (Enso_Secret.get '')\n")
    expect(code).toContain('Enso_Secret')
    await expect(node).toContainText(/Enso_Secret\W*get/)
    await expect(node.locator('.WidgetKindPicker .WidgetSelection')).toHaveCount(1)
  })

  test('Locale | Nothing is one dropdown with a Nothing entry and no chip', async ({
    editorPage,
    page,
  }) => {
    await editorPage.mockSuggestion(unionMethod('locale_nothing', `${LOCALE} | ${NOTHING}`))
    await mockMethodCallInfo(page, 'loc', {
      methodPointer: { module: T, definedOnType: T, name: 'locale_nothing' },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'loc')
    await expect(node.locator('.WidgetSelection')).toHaveCount(1)
    await expect(node.locator('.WidgetKindPicker')).toHaveCount(0)
    await expect(node.locator('.kindIcon')).toHaveCount(0)
    await select(page, node)
    await expect(node.getByRole('button', { name: /change kind/ })).toHaveCount(0)
    const dropdown = new DropDownLocator(node)
    await dropdown.clickWidget()
    await dropdown.expectVisibleWithOptions(['US', 'UK', 'Nothing'])
  })

  test("Data.read's path keeps its file browser and has no chip", async ({ page, editorPage }) => {
    await editorPage
    await mockMethodCallInfo(page, 'rd', {
      methodPointer: { module: T, definedOnType: T, name: 'read' },
      notAppliedArguments: [0, 1, 2],
    })
    const node = locate.graphNodeByBinding(page, 'rd')
    const pathArg = node.locator('.WidgetTopLevelArgument').filter({ has: page.getByText('path') })
    await expect(pathArg).toHaveCount(1)
    await expect(node.locator('.WidgetKindPicker')).toHaveCount(0)
    const pathDropdown = new DropDownLocator(pathArg)
    await pathArg.click()
    await pathDropdown.expectVisibleWithOptions([...CHOOSE_FILE_OPTIONS, 'File 1', 'File 2'])
    await expect(node.getByRole('button', { name: /change kind/ })).toHaveCount(0)
  })

  // What the engine answers for `Data.read`'s `path` (`@path (Text_Input)`, declared
  // `Text | URI | File`): an annotation's text input on a browsable type keeps the file browser, with
  // the text input under its dropdown (#926).
  test("Data.read's path with the engine's Text_Input keeps its file browser", async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    await localApi.updateVisualization('.read', {
      arguments: [['path', { widget: { type: 'Widget', constructor: 'Text_Input' } }]],
    })
    await mockMethodCallInfo(page, 'rd', {
      methodPointer: { module: T, definedOnType: T, name: 'read' },
      notAppliedArguments: [0, 1, 2],
    })
    const node = locate.graphNodeByBinding(page, 'rd')
    const pathArg = node.locator('.WidgetTopLevelArgument').filter({ has: page.getByText('path') })
    await expect(pathArg).toHaveCount(1)
    await expect(node.locator('.WidgetKindPicker')).toHaveCount(0)
    await expect(pathArg.locator('.WidgetText')).toHaveCount(1)
    const pathDropdown = new DropDownLocator(pathArg)
    await pathArg.click()
    await pathDropdown.expectVisibleWithOptions(CHOOSE_FILE_OPTIONS)
    await pathDropdown.clickOption(CHOOSE_LOCAL_FILE)
    await expect(pathArg.getByTestId('widget-text-content')).toHaveText('/path/to/some/mock/file')
  })

  test('Text | File | Nothing offers File and Nothing, with the file browser beside the icon', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'tfn',
      unionMethod('text_file_nothing', `${TEXT} | ${FILE} | ${NOTHING}`),
    )
    await expect(node.locator('.kindIcon')).toHaveAttribute('title', 'File')
    await expect(node.locator('.WidgetKindPicker .WidgetSelection')).toHaveCount(1)
    await select(page, node)
    await changeKind(node, 'File').click()
    await list(page).expectVisibleWithOptions(['File', 'Nothing'])
  })

  test('an annotation wins over the picker', async ({ editorPage, page, localApi }) => {
    await editorPage.mockSuggestion(
      unionMethod('annotated', `${INTEGER} | ${NOTHING}`, { annotations: ['value'] }),
    )
    await localApi.updateVisualization('.annotated', [
      [
        'value',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          values: [
            { type: 'Choice', constructor: 'Option', value: '1', label: 'One', parameters: [] },
            { type: 'Choice', constructor: 'Option', value: '2', label: 'Two', parameters: [] },
          ],
        },
      ],
    ])
    await mockMethodCallInfo(page, 'annot', {
      methodPointer: { module: T, definedOnType: T, name: 'annotated' },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'annot')
    await expect(node.locator('.WidgetSelection')).toHaveCount(1)
    await expect(node.locator('.WidgetKindPicker')).toHaveCount(0)
    await select(page, node)
    await expect(node.getByRole('button', { name: /change kind/ })).toHaveCount(0)
  })

  test('Vector (Text | Integer): every item has an icon and + adds an empty text', async ({
    editorPage,
    page,
  }) => {
    const node = await kindNode(
      editorPage,
      page,
      'vec',
      unionMethod('vec_items', `${T}.Vector.Vector (${TEXT} | ${INTEGER})`),
      true,
    )
    const vector = node.locator('.WidgetVector')
    await expect(vector.locator('.item')).toHaveCount(2)
    await expect(vector.locator('.kindIcon')).toHaveCount(2)
    await expect(vector.locator('.kindIcon').first()).toHaveAttribute('title', 'Text')
    await expect(vector.locator('.kindIcon').last()).toHaveAttribute('title', 'Integer')
    await node.click()
    await locate.addItemButton(node).click()
    await expect(vector.locator('.item')).toHaveCount(3)
    expect(await moduleCode(page)).toContain("vec = Data.vec_items ['a', 1, '']\n")
  })
})

test.describe('Column pickers', () => {
  const ANY_TYPE = 'Standard.Base.Any.Any'
  test.afterEach(restoreMockMainFile)
  test.afterEach(restoreMockWidgetConfigurations)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          "from Standard.Base import Data\n\nmain =\n    summed = Data.aggregate_by (..Sum)\n    joined = Data.join_on\n    lone = Data.lone_column\n    filtered = Data.filter_by 'county' ..Contains\n    picked = Data.filter_by 'county'\n    conditioned = Data.join_with on=[(..Equals 'county')]\n    formatted = Data.read_with 'c.csv'\n",
        ),
    },
  })

  /* eslint-disable camelcase */
  const picker = (from: string | null) => ({
    type: 'Widget',
    constructor: 'Column_Name',
    kinds: [],
    from,
    expression: false,
    reference: false,
    extra: [],
    columns_first: false,
  })
  const columnsOf = (...names: string[]) => ({
    names,
    kinds: names.map(() => 'Textual'),
    type_names: names.map(() => 'Char'),
  })
  /* eslint-enable camelcase */

  function method(name: string, args: string[]) {
    return {
      type: 'method' as const,
      module: 'Standard.Base.Data',
      name,
      arguments: args.map((arg) => ({
        name: arg,
        reprType: ANY_TYPE,
        isSuspended: false,
        hasDefault: false,
      })),
      selfType: 'Standard.Base.Data',
      returnType: 'Standard.Base.Data.Numbers.Integer',
      isStatic: true,
      annotations: args,
    }
  }

  function pointer(name: string) {
    return {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name,
      },
      notAppliedArguments: [0],
    }
  }

  test('a nested column picker inside an aggregate choice expands', async ({
    editorPage,
    page,
    localApi,
  }) => {
    await editorPage
      .mockSuggestion(method('aggregate_by', ['aggregate']))
      .mockSuggestion(method('Sum', ['column']))
    await localApi.updateVisualization('.aggregate_by', {
      arguments: [
        [
          'aggregate',
          {
            widget: {
              type: 'Widget',
              constructor: 'Single_Choice',
              values: [
                {
                  type: 'Choice',
                  constructor: 'Option',
                  value: '..Sum',
                  label: 'Sum',
                  parameters: [['column', picker(null)]],
                },
              ],
            },
          },
        ],
      ],
      columns: { '': columnsOf('Column A', 'Column B') },
    })
    await mockMethodCallInfo(page, 'summed', pointer('aggregate_by'))
    await mockMethodCallInfo(page, { binding: 'summed', expr: '..Sum' }, pointer('Sum'))
    const node = locate.graphNodeByBinding(page, 'summed')
    // The outer selection is the aggregate choice; it holds the nested `column` selection,
    // which `DropDownLocator` reaches through its own `.first()`.
    const aggregateSelection = node.locator('.WidgetSelection').first()
    await expect(aggregateSelection.locator('.WidgetSelection')).toHaveCount(1)
    const dropDown = new DropDownLocator(aggregateSelection)
    await dropDown.clickWidget()
    await dropDown.expectVisibleWithOptions(['Column A', 'Column B'])
  })

  test("join's right columns appear once right is set", async ({ editorPage, page, localApi }) => {
    await editorPage.mockSuggestion(method('join_on', ['right_on']))
    const answer = (columns: Record<string, unknown>) => ({
      arguments: [['right_on', { widget: picker('right') }]],
      columns,
    })
    // `right` is not set: its picker has no source and is free text.
    await localApi.updateVisualization(
      '.join_on',
      answer({ '': columnsOf('Column A', 'Column B') }),
    )
    await mockMethodCallInfo(page, 'joined', pointer('join_on'))
    const node = locate.graphNodeByBinding(page, 'joined')
    await expect(node.locator('.WidgetSelection')).toHaveCount(0)
    await expect(node.locator('.WidgetText')).toHaveCount(1)
    // `right` is set: the right table's columns are offered.
    await localApi.updateVisualization(
      '.join_on',
      answer({
        '': columnsOf('Column A', 'Column B'),
        right: columnsOf('Right X', 'Right Y'),
      }),
    )
    const arg = node.locator('.WidgetTopLevelArgument').first()
    const dropDown = new DropDownLocator(arg)
    await dropDown.clickWidget()
    await dropDown.expectVisibleWithOptions(['Right X', 'Right Y'])
  })

  test('a column picker with no source is a text input', async ({ editorPage, page, localApi }) => {
    await editorPage.mockSuggestion(method('lone_column', ['column']))
    await localApi.updateVisualization('.lone_column', {
      arguments: [['column', { widget: picker(null) }]],
    })
    await mockMethodCallInfo(page, 'lone', pointer('lone_column'))
    const node = locate.graphNodeByBinding(page, 'lone')
    await expect(node.locator('.WidgetTopLevelArgument')).toHaveCount(1)
    await expect(node.locator('.WidgetText')).toHaveCount(1)
    await expect(node.locator('.WidgetSelection')).toHaveCount(0)
  })

  // As `Table.filter` answers (owner's #926 test): the conditions are grouped (`Text`), their
  // operand is a picker referencing the call's subject, and a condition's constructor has no
  // annotations of its own, so the operand's widget comes from the group's option alone.
  async function mockFilterBy(editorPage: EditorPageActions, localApi: MockLocalApi) {
    const operand = {
      ...picker(null),
      expression: true,
      reference: true,
      extra: [
        {
          type: 'Choice',
          constructor: 'Option',
          value: '""',
          label: '<Text Value>',
          parameters: [],
        },
      ],
    }
    const option = (value: string, parameters: unknown[] = []) => ({
      type: 'Choice',
      constructor: 'Option',
      value,
      label: value,
      parameters,
    })
    await editorPage
      .mockSuggestion(method('filter_by', ['column', 'filter']))
      .mockSuggestion({ ...method('Contains', ['substring', 'case_sensitivity']), annotations: [] })
    await localApi.updateVisualization('.filter_by', {
      arguments: [
        ['column', { widget: { ...picker(null), expression: true } }],
        [
          'filter',
          {
            widget: {
              type: 'Widget',
              constructor: 'Single_Choice',
              // All of `Table.filter`'s top-level entries: more than the list shows at once, so
              // it scrolls, and the last group is only partly visible.
              values: [
                option('..Equal', [['to', operand]]),
                option('..Not_Equal', [['to', operand]]),
                option('..Is_Nothing'),
                option('..Not_Nothing'),
                option('..Is_In'),
                {
                  type: 'Choice',
                  constructor: 'Option',
                  label: 'Comparisons',
                  value: [option('..Less', [['than', operand]])],
                  parameters: [],
                },
                {
                  type: 'Choice',
                  constructor: 'Option',
                  label: 'Text',
                  value: [
                    option('..Is_Empty'),
                    option('..Starts_With', [['prefix', operand]]),
                    option('..Contains', [['substring', operand]]),
                  ],
                  parameters: [],
                },
              ],
            },
          },
        ],
      ],
      columns: {
        '': {
          names: ['county', 'n'],
          kinds: ['Textual', 'Numeric'],
          // eslint-disable-next-line camelcase
          type_names: ['Char', 'Integer'],
        },
      },
    })
  }

  test('a grouped condition is picked from its submenu', async ({ editorPage, page, localApi }) => {
    await mockFilterBy(editorPage, localApi)
    await mockMethodCallInfo(page, 'picked', { ...pointer('filter_by'), notAppliedArguments: [1] })
    const node = locate.graphNodeByBinding(page, 'picked')
    const filterArg = node
      .locator('.WidgetArgumentName')
      .filter({ has: page.getByText('filter', { exact: true }) })
      .last()
    await expect(filterArg).toBeVisible()
    await filterArg.click()
    const dropDown = new DropDownLocator(filterArg)
    await dropDown.expectVisibleWithOptions([
      '..Equal',
      '..Not_Equal',
      '..Is_Nothing',
      '..Not_Nothing',
      '..Is_In',
      'Comparisons →',
      'Text →',
    ])
    // The click scrolls the partly hidden group into view; the submenu it opened stays open.
    await dropDown.clickOption('Text →')
    await expect(
      page.locator('.DropdownWidget .item').filter({ hasText: '..Contains' }),
    ).toBeVisible()
    await page.locator('.DropdownWidget .item').filter({ hasText: '..Contains' }).click()
    expect(await moduleCode(page)).toContain("picked = Data.filter_by 'county' ..Contains\n")
  })

  test("a grouped condition's operand lists the subject's columns", async ({
    editorPage,
    page,
    localApi,
  }) => {
    await mockFilterBy(editorPage, localApi)
    await mockMethodCallInfo(page, 'filtered', pointer('filter_by'))
    await mockMethodCallInfo(page, { binding: 'filtered', expr: '..Contains' }, pointer('Contains'))
    const node = locate.graphNodeByBinding(page, 'filtered')
    const substring = node
      .locator('.WidgetArgumentName')
      .filter({ has: page.getByText('substring', { exact: true }) })
      // The innermost: `filter`'s name chip holds the whole condition, `substring` included.
      .last()
    await expect(substring).toBeVisible()
    await substring.click()
    const dropDown = new DropDownLocator(substring)
    await dropDown.expectVisibleWithOptions(['<Text Value>', '<Expression>', 'county', 'n'])
  })

  // As `Table.join` answers (owner's #926 test): the conditions are a vector of choices whose
  // `right` is a text input until `right` is set, then a picker of the right table's columns. With
  // `right` unset the engine never runs `join`'s body, so it never resolves `..Equals` and sends no
  // call info for it: the condition's arguments come from the suggestion database alone.
  async function mockJoinWith(
    editorPage: EditorPageActions,
    page: Page,
    localApi: MockLocalApi,
    right: unknown,
  ) {
    const argument = (name: string) => ({
      name,
      reprType: ANY_TYPE,
      isSuspended: false,
      hasDefault: false,
    })
    await editorPage.mockSuggestion(method('join_with', ['right', 'on'])).mockSuggestion({
      type: 'constructor' as const,
      module: 'Standard.Base.Join_Condition',
      name: 'Equals',
      arguments: [argument('left'), argument('right')],
      returnType: 'Standard.Base.Join_Condition.Join_Condition',
      documentation: '',
      annotations: [],
    })
    await localApi.updateVisualization('.join_with', {
      arguments: [
        [
          'on',
          {
            widget: {
              type: 'Widget',
              constructor: 'Vector_Editor',
              // eslint-disable-next-line camelcase
              item_editor: {
                type: 'Widget',
                constructor: 'Single_Choice',
                values: [
                  {
                    type: 'Choice',
                    constructor: 'Option',
                    value: '..Equals',
                    label: 'Equals',
                    parameters: [
                      ['left', picker(null)],
                      ['right', right],
                    ],
                  },
                ],
              },
              // eslint-disable-next-line camelcase
              item_default: "(..Equals 'county')",
            },
          },
        ],
      ],
      columns: { '': columnsOf('county', 'n'), right: columnsOf('Right X', 'Right Y') },
    })
    await mockMethodCallInfo(page, 'conditioned', {
      ...pointer('join_with'),
      notAppliedArguments: [0],
    })
  }
  /**
   * The condition's argument `name`: the innermost argument chip with that name (the join's own
   * `right` comes first, and the `on` chip holds the whole condition).
   */
  function conditionArg(node: Locator, name: string) {
    return node
      .locator('.WidgetArgumentName')
      .filter({ has: node.page().getByText(name, { exact: true }) })
      .last()
  }

  test("a join condition's right is a text input while right is unset", async ({
    editorPage,
    page,
    localApi,
  }) => {
    await mockJoinWith(editorPage, page, localApi, { type: 'Widget', constructor: 'Text_Input' })
    const node = locate.graphNodeByBinding(page, 'conditioned')
    await expect(conditionArg(node, 'left')).toBeVisible()
    const right = conditionArg(node, 'right')
    await expect(right.locator('.WidgetText')).toHaveCount(1)
    await right.locator('.WidgetText').click()
    await page.keyboard.type('Right X')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => moduleCode(page))
      .toMatch(/conditioned = Data\.join_with on=\[\(\.\.Equals 'county' (right=)?'Right X'\)\]/)
  })

  test("a join condition's right lists the right table's columns once right is set", async ({
    editorPage,
    page,
    localApi,
  }) => {
    await mockJoinWith(editorPage, page, localApi, picker('right'))
    const node = locate.graphNodeByBinding(page, 'conditioned')
    const right = conditionArg(node, 'right')
    await expect(right).toBeVisible()
    await right.click()
    const dropDown = new DropDownLocator(right)
    await dropDown.expectVisibleWithOptions(['Right X', 'Right Y'])
  })

  // The owner's #933 sequence: `format` picked as `..Delimited` in a node the engine has already
  // computed. The constructor has no subject, so its query is sent with `subject_is_type`; the
  // engine keeps no value for an expression inside a node, so a query attached to the
  // constructor itself was answered only when the node ran again (the mock never runs it again).
  test("a picked constructor's own widgets come without the node running again", async ({
    editorPage,
    page,
    localApi,
  }) => {
    const option = (value: string) => ({
      type: 'Choice',
      constructor: 'Option',
      value,
      label: value,
      parameters: [],
    })
    await editorPage.mockSuggestion(method('read_with', ['path', 'format'])).mockSuggestion({
      type: 'constructor' as const,
      module: 'Standard.Base.Delimited_Format',
      name: 'Delimited',
      arguments: [{ name: 'delimiter', reprType: ANY_TYPE, isSuspended: false, hasDefault: false }],
      returnType: 'Standard.Base.Delimited_Format.Delimited_Format',
      documentation: '',
      annotations: ['delimiter'],
    })
    await localApi.updateVisualization('.read_with', {
      arguments: [
        ['path', { widget: null }],
        [
          'format',
          {
            widget: {
              type: 'Widget',
              constructor: 'Single_Choice',
              values: [option('..Auto_Detect'), option('..Delimited')],
            },
          },
        ],
      ],
    })
    await localApi.updateVisualization('.Delimited', {
      arguments: [
        [
          'delimiter',
          {
            widget: {
              type: 'Widget',
              constructor: 'Single_Choice',
              values: [option("','"), option("';'")],
            },
          },
        ],
      ],
    })
    await mockMethodCallInfo(page, 'formatted', {
      ...pointer('read_with'),
      notAppliedArguments: [1],
    })
    const node = locate.graphNodeByBinding(page, 'formatted')
    const format = conditionArg(node, 'format')
    await expect(format).toBeVisible()
    await format.click()
    const formats = new DropDownLocator(format)
    await formats.expectVisibleWithOptions(['..Auto_Detect', '..Delimited'])
    await formats.clickOption('..Delimited')
    await expect
      .poll(() => moduleCode(page))
      .toContain("formatted = Data.read_with 'c.csv' ..Delimited\n")
    // What the engine reports once the node has run with the new code.
    await mockMethodCallInfo(
      page,
      { binding: 'formatted', expr: '..Delimited' },
      {
        methodPointer: {
          module: 'Standard.Base.Delimited_Format',
          definedOnType: 'Standard.Base.Delimited_Format.Delimited_Format',
          name: 'Delimited',
        },
        notAppliedArguments: [0],
      },
    )
    const delimiter = conditionArg(node, 'delimiter')
    await expect(delimiter).toBeVisible()
    await delimiter.click()
    await new DropDownLocator(delimiter).expectVisibleWithOptions(["','", "';'"])
  })
})

test.describe('Resolvers', () => {
  const TEXT_TYPE = 'Standard.Base.Data.Text.Text'
  test.afterEach(restoreMockMainFile)
  test.afterEach(restoreMockWidgetConfigurations)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          "from Standard.Base import Data\n\nmain =\n    joined = Data.join_like 'r1' 'a' 'k1'\n    first = Data.static_like 'a'\n    second = Data.static_like 'b'\n    listed = Data.tables_like 'q'\n    unjoined = Data.join_like on='a'\n",
        ),
    },
  })

  function method(name: string, args: string[]) {
    return {
      type: 'method' as const,
      module: 'Standard.Base.Data',
      name,
      arguments: args.map((arg) => ({
        name: arg,
        reprType: TEXT_TYPE,
        isSuspended: false,
        hasDefault: false,
      })),
      selfType: 'Standard.Base.Data',
      returnType: 'Standard.Base.Data.Numbers.Integer',
      isStatic: true,
      annotations: args,
    }
  }

  function pointer(name: string) {
    return {
      methodPointer: { module: 'Standard.Base.Data', definedOnType: 'Standard.Base.Data', name },
      notAppliedArguments: [],
    }
  }

  const choice = (...labels: string[]) => ({
    type: 'Widget',
    constructor: 'Single_Choice',
    values: labels.map((label) => ({
      type: 'Choice',
      constructor: 'Option',
      value: `'${label}'`,
      label,
      parameters: [],
    })),
  })
  const onResolver = { dependencies: ['self', 'right'], searchable: false }

  /**
   * `join_like`'s answer: `on` lists the columns of the `right` the query sent (its id, and the
   * revision of its code and value: an edit may keep the id).
   */
  function joinAnswer() {
    const rightIds: string[] = []
    return (query: MockWidgetQuery) => {
      const id = `${query.uuids['right'] ?? ''}@${query.revision}`
      if (!rightIds.includes(id)) rightIds.push(id)
      return {
        arguments: [
          ['right', { widget: choice('r1', 'r2') }],
          ['on', { widget: choice(`col_${rightIds.indexOf(id) + 1}`), resolver: onResolver }],
          ['join_kind', { widget: choice('k1', 'k2') }],
        ],
      }
    }
  }

  function argument(node: Locator, name: string) {
    return node
      .locator('.WidgetTopLevelArgument')
      .filter({ has: node.page().getByText(name, { exact: true }) })
  }

  async function joinNode(editorPage: EditorPageActions, page: Page) {
    await editorPage.mockSuggestion(method('join_like', ['right', 'on', 'join_kind']))
    await mockMethodCallInfo(page, 'joined', pointer('join_like'))
    return locate.graphNodeByBinding(page, 'joined')
  }

  test("join's `on` updates when `right` changes", async ({ editorPage, page }) => {
    setMockResolverAnswer('.join_like', joinAnswer())
    const node = await joinNode(editorPage, page)
    const on = new DropDownLocator(argument(node, 'on'))
    await on.clickWidget()
    await on.expectVisibleWithOptions(['col_1'])
    await page.keyboard.press('Escape')
    const right = new DropDownLocator(argument(node, 'right'))
    await right.clickWidget()
    await right.clickOption('r2')
    await expect.poll(() => widgetQueryCount('.join_like')).toBe(2)
    // The re-query sends only the dependency's id.
    expect(Object.keys(widgetQueriesOf('.join_like')[1]!.uuids)).toEqual(['right'])
    await on.clickWidget()
    await on.expectVisibleWithOptions(['col_2'])
  })

  test('an argument nothing depends on does not re-query', async ({ editorPage, page }) => {
    setMockResolverAnswer('.join_like', joinAnswer())
    const node = await joinNode(editorPage, page)
    await expect(argument(node, 'on').locator('.WidgetSelection')).toHaveCount(1)
    expect(widgetQueryCount('.join_like')).toBe(1)
    const kind = new DropDownLocator(argument(node, 'join_kind'))
    await kind.clickWidget()
    await kind.clickOption('k2')
    expect(await moduleCode(page)).toContain("Data.join_like 'r1' 'a' 'k2'")
    await expect(argument(node, 'on').locator('.WidgetSelection')).toHaveCount(1)
    expect(widgetQueryCount('.join_like')).toBe(1)
  })

  test('a method whose widgets are static is asked once, for all its nodes', async ({
    editorPage,
    page,
  }) => {
    setMockResolverAnswer('.static_like', () => ({
      arguments: [['arg', { widget: choice('a', 'b') }]],
    }))
    await editorPage.mockSuggestion(method('static_like', ['arg']))
    await mockMethodCallInfo(page, 'first', pointer('static_like'))
    const first = locate.graphNodeByBinding(page, 'first')
    await expect(first.locator('.WidgetSelection')).toHaveCount(1)
    await mockMethodCallInfo(page, 'second', pointer('static_like'))
    const second = locate.graphNodeByBinding(page, 'second')
    await expect(second.locator('.WidgetSelection')).toHaveCount(1)
    expect(widgetQueryCount('.static_like')).toBe(1)
  })

  test('an input with an error falls back to the type default, with a note', async ({
    editorPage,
    page,
  }) => {
    setMockResolverAnswer('.join_like', () => ({
      arguments: [
        ['right', { widget: choice('r1', 'r2') }],
        [
          'on',
          {
            widget: null,
            resolver: onResolver,
            unavailable: { dependency: 'right', message: 'No such table' },
          },
        ],
        ['join_kind', { widget: choice('k1', 'k2') }],
      ],
    }))
    const node = await joinNode(editorPage, page)
    const on = argument(node, 'on')
    const note = on.getByTestId('widget-query-note-unavailable')
    await expect(note).toBeVisible()
    await expect(note).toHaveAttribute('aria-label', 'Choices unavailable: right has an error.')
    // The fallback is Text's own widget, still editable.
    await expect(on.locator('.WidgetText')).toHaveCount(1)
    await expect(on.locator('.WidgetSelection')).toHaveCount(0)
  })

  // An unset `right` is a `Missing_Argument` to the engine, which answers `unavailable` as for a
  // real error; the GUI shows no marker for an argument the call does not set (#933).
  test('an unset dependency gets no note', async ({ editorPage, page }) => {
    setMockResolverAnswer('.join_like', () => ({
      arguments: [
        ['right', { widget: choice('r1', 'r2') }],
        [
          'on',
          {
            widget: null,
            resolver: onResolver,
            unavailable: { dependency: 'right', message: 'Provide a value for right.' },
          },
        ],
        ['join_kind', { widget: choice('k1', 'k2') }],
      ],
    }))
    await editorPage.mockSuggestion(method('join_like', ['right', 'on', 'join_kind']))
    await mockMethodCallInfo(page, 'unjoined', {
      ...pointer('join_like'),
      notAppliedArguments: [0, 2],
    })
    const node = locate.graphNodeByBinding(page, 'unjoined')
    const on = argument(node, 'on')
    await expect(on.locator('.WidgetText')).toHaveCount(1)
    await expect(node.getByTestId('widget-query-note-unavailable')).toHaveCount(0)
  })

  test('a slow resolver shows a loading marker, then its widget', async ({ editorPage, page }) => {
    setMockResolverAnswer('.join_like', joinAnswer(), 3500)
    const node = await joinNode(editorPage, page)
    const loading = argument(node, 'on').getByTestId('widget-query-note-loading')
    await expect(loading).toBeVisible({ timeout: 3000 })
    await expect(loading).toHaveAttribute('aria-label', 'Loading choices…')
    await expect(loading).toBeHidden({ timeout: 5000 })
    await expect(argument(node, 'on').locator('.WidgetSelection')).toHaveCount(1)
  })

  test('a table-name dropdown searches as you type', async ({ editorPage, page }) => {
    // Without a search, the engine sends only the first names; a search finds the others.
    setMockResolverAnswer('.tables_like', (query) => ({
      arguments: [
        [
          'query',
          {
            widget:
              query.search ?
                choice(
                  ...['sales_2024', 'sales_2025', 'costs'].filter((name) =>
                    name.includes(query.search),
                  ),
                )
              : choice('costs', 'sales_2024'),
            resolver: { dependencies: ['self'], searchable: true },
          },
        ],
      ],
    }))
    await editorPage.mockSuggestion(method('tables_like', ['query']))
    await mockMethodCallInfo(page, 'listed', pointer('tables_like'))
    const node = locate.graphNodeByBinding(page, 'listed')
    const query = argument(node, 'query')
    const dropdown = new DropDownLocator(query)
    const input = query.getByTestId('widget-text-content')
    await input.click()
    await dropdown.expectVisibleWithOptions(['costs', 'sales_2024'])
    await page.keyboard.type('sal')
    await dropdown.expectVisibleWithOptions(['sales_2024', 'sales_2025'])
    // One search query, with the text as typed once the typing paused.
    expect(
      widgetQueriesOf('.tables_like')
        .map((sent) => sent.search)
        .filter((search) => search !== ''),
    ).toEqual(['sal'])
  })
})
