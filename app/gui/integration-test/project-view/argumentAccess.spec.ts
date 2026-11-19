import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Locator, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import * as actions from './actions'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

/** The module's code; the code editor is closed again afterwards. */
async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  const code = await page.evaluate(() => (window as any).__codeEditorApi.textContent())
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeHidden()
  return code
}

test.describe('The ＋ of hidden parameters', () => {
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          "from Standard.Base import Data\n\nmain =\n    data = Data.read\n    wrapped = Data.read Data.read_many\n    nested = Data.read (Data.read_many 'a.csv')\n",
        ),
    },
  })

  const READ = {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
  }
  const READ_MANY = { ...READ.methodPointer, name: 'read_many' }

  async function nodes(editorPage: EditorPageActions, page: Page) {
    await mockMethodCallInfo(
      page,
      { binding: 'data', expr: 'Data.read' },
      { ...READ, notAppliedArguments: [0, 1, 2] },
    )
    await mockMethodCallInfo(page, 'wrapped', { ...READ, notAppliedArguments: [1, 2] })
    await mockMethodCallInfo(
      page,
      { binding: 'wrapped', expr: 'Data.read_many' },
      { methodPointer: READ_MANY, notAppliedArguments: [0, 1, 2, 3] },
    )
    await mockMethodCallInfo(page, 'nested', { ...READ, notAppliedArguments: [1, 2] })
    await mockMethodCallInfo(
      page,
      { binding: 'nested', expr: "Data.read_many 'a.csv'" },
      { methodPointer: READ_MANY, notAppliedArguments: [1, 2, 3] },
    )
    const data = editorPage.locateNodes('data')
    const wrapped = editorPage.locateNodes('wrapped')
    const nested = editorPage.locateNodes('nested')
    await expect(data.locator('.WidgetTopLevelArgument')).toHaveCount(1)
    return { data, wrapped, nested }
  }

  test('a ＋ per call, shown only while the node is selected', async ({ page, editorPage }) => {
    const { data, wrapped } = await nodes(editorPage, page)
    await expect(page.getByRole('button', { name: 'Add argument' })).toHaveCount(0)
    await data.click({ position: { x: 8, y: 8 } })
    await expect(data).toBeSelected()
    await expect(actions.addArgumentButtons(data)).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Add argument' })).toHaveCount(1)
    // Inside the node, at its end.
    const nodeBox = (await data.locator('.content').boundingBox())!
    const buttonBox = (await actions.addArgumentButtons(data).boundingBox())!
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(nodeBox.x + nodeBox.width)
    expect(buttonBox.x + buttonBox.width).toBeGreaterThan(nodeBox.x + nodeBox.width - 20)
    await actions.clickAtBackground(page)
    await expect(page.getByRole('button', { name: 'Add argument' })).toHaveCount(0)
    // Two selected nodes: neither shows them.
    await data.click({ position: { x: 8, y: 8 } })
    await wrapped.click({ position: { x: 8, y: 8 }, modifiers: ['Shift'] })
    await expect(wrapped).toBeSelected()
    await expect(page.getByRole('button', { name: 'Add argument' })).toHaveCount(0)
  })

  test("a nested call's ＋ is inside its group, and its menu lists only its parameters", async ({
    page,
    editorPage,
  }) => {
    const { wrapped } = await nodes(editorPage, page)
    await wrapped.click({ position: { x: 8, y: 8 } })
    await expect(wrapped).toBeSelected()
    const buttons = actions.addArgumentButtons(wrapped)
    await expect(buttons).toHaveCount(2)
    const group = wrapped.locator('.nestedCall')
    await expect(group).toHaveCount(1)
    await expect(group).toContainText('read_many')
    await expect(group.getByRole('button', { name: 'Add argument' })).toHaveCount(1)
    // The outer call's ends the node.
    const outer = await actions.openAddArgumentMenu(page, wrapped, buttons.last())
    await expect(outer.locator('.parameterItem .name')).toHaveText(['format', 'on_problems'])
    await page.keyboard.press('Escape')
    await expect(outer).toBeHidden()
    const inner = await actions.openAddArgumentMenu(
      page,
      wrapped,
      group.getByRole('button', { name: 'Add argument' }),
    )
    await expect(inner.locator('.parameterItem .name')).toHaveText([
      'format',
      'return',
      'on_problems',
    ])
    await inner.getByRole('button', { name: /^on_problems/ }).click()
    await expect(inner).toBeHidden()
    expect(await moduleCode(page)).toContain('wrapped = Data.read (Data.read_many on_problems=')
  })

  test('each ＋ is centred on its row, and its plus in its circle', async ({
    page,
    editorPage,
  }) => {
    // `nested` has a text value chip ('a.csv'), taller than a bare token: the row is not a port high.
    const { nested } = await nodes(editorPage, page)
    await nested.click({ position: { x: 8, y: 8 } })
    await expect(nested).toBeSelected()
    const buttons = actions.addArgumentButtons(nested)
    await expect(buttons).toHaveCount(2)
    const middle = async (locator: Locator) => {
      const box = (await locator.boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const rows = [
      { button: buttons.last(), row: nested.locator('.content') },
      { button: buttons.first(), row: nested.locator('.nestedCall') },
    ]
    for (const { button, row } of rows) {
      const buttonMiddle = await middle(button)
      expect(Math.abs(buttonMiddle.y - (await middle(row)).y)).toBeLessThanOrEqual(1)
      // The plus is drawn, not a font glyph, so its middle is the circle's in any font.
      const plusMiddle = await middle(button.locator('svg'))
      expect(Math.abs(plusMiddle.x - buttonMiddle.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(plusMiddle.y - buttonMiddle.y)).toBeLessThanOrEqual(0.5)
    }
  })

  test('picking a parameter writes it as a named argument', async ({ page, editorPage }) => {
    const { data } = await nodes(editorPage, page)
    await actions.addArgument(page, data, 'format')
    expect(await moduleCode(page)).toContain('data = Data.read format=Auto_Detect')
    await actions.clickAtBackground(page)
    // `on_problems` is still hidden, so the ＋ stays, and the menu no longer lists `format`.
    const menu = await actions.openAddArgumentMenu(page, data)
    await expect(menu.getByRole('button', { name: /^on_problems/ })).toBeVisible()
    await expect(menu.getByRole('button', { name: /^format/ })).toHaveCount(0)
  })

  test('selecting a node does not show hidden arguments', async ({ page, editorPage }) => {
    const { data } = await nodes(editorPage, page)
    const args = data.locator('.WidgetTopLevelArgument')
    await data.click({ position: { x: 8, y: 8 } })
    await expect(data).toBeSelected()
    await expect(args).toHaveCount(1)
    // An argument the user set stays shown.
    await actions.addArgument(page, data, 'format')
    await expect(args).toHaveCount(2)
    await actions.clickAtBackground(page)
    await expect(args).toHaveCount(2)
  })

  test('every argument shows its name: a positional one in a nested call too', async ({
    page,
    editorPage,
  }) => {
    const { nested } = await nodes(editorPage, page)
    // In document order: `path`'s chip holds the nested call, whose set `paths` is positional.
    await expect(nested.locator('.WidgetArgumentName > .name')).toHaveText(['path', 'paths'])
    await expect(nested.locator('.WidgetArgumentName').nth(1)).toContainText('a.csv')
  })

  test('Escape, and a click on a node, close the menu', async ({ page, editorPage }) => {
    const { data, wrapped } = await nodes(editorPage, page)
    const menu = await actions.openAddArgumentMenu(page, data)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await actions.addArgumentButtons(data).click()
    await expect(menu).toBeVisible()
    await wrapped.click({ position: { x: 8, y: 8 } })
    await expect(menu).toBeHidden()
  })
})

/**
 * `arguments: { peek: selected }` in a method's doc front matter: the argument shows while its
 * node is the sole selection, and then the ＋ menu does not list it.
 */
test.describe('An argument displayed `selected`', () => {
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    first = Data.demo_selected\n    second = Data.demo_selected\n',
        ),
    },
  })

  const DEMO = {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'demo_selected',
    },
    notAppliedArguments: [0, 1, 2],
  }

  async function nodes(editorPage: EditorPageActions, page: Page) {
    const arg = (name: string) => ({
      name,
      reprType: 'Standard.Base.Any.Any',
      isSuspended: false,
      hasDefault: true,
      defaultValue: '0',
    })
    await editorPage.mockSuggestion({
      type: 'method',
      module: 'Standard.Base.Data',
      name: 'demo_selected',
      arguments: [arg('peek'), arg('skip'), arg('flag')],
      selfType: 'Standard.Base.Data',
      returnType: 'Standard.Base.Any.Any',
      isStatic: true,
      documentation: ' ---\narguments:\n  peek: selected\n---\nA method with a selected argument.',
      annotations: [],
    })
    await mockMethodCallInfo(page, 'first', DEMO)
    await mockMethodCallInfo(page, 'second', DEMO)
    return {
      first: editorPage.locateNodes('first'),
      second: editorPage.locateNodes('second'),
    }
  }

  test('shows only while its node is the sole selection, and is then not in the ＋ menu', async ({
    page,
    editorPage,
  }) => {
    const { first, second } = await nodes(editorPage, page)
    const args = first.locator('.WidgetTopLevelArgument')
    // Not selected: hidden.
    await expect(first).toBeVisible()
    await expect(args).toHaveCount(0)
    // Sole selection: shown, with its name, and not offered by the ＋.
    const menu = await actions.openAddArgumentMenu(page, first)
    await expect(args).toHaveCount(1)
    await expect(first.locator('.WidgetArgumentName > .name')).toHaveText(['peek'])
    await expect(menu.locator('.parameterItem .name')).toHaveText(['skip', 'flag'])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // Two nodes selected: hidden again.
    await second.click({ position: { x: 8, y: 8 }, modifiers: ['Shift'] })
    await expect(second).toBeSelected()
    await expect(first).toBeSelected()
    await expect(args).toHaveCount(0)
    await expect(second.locator('.WidgetTopLevelArgument')).toHaveCount(0)
    // Deselected: hidden.
    await actions.clickAtBackground(page)
    await expect(locate.selectedNodes(page)).toHaveCount(0)
    await expect(args).toHaveCount(0)
  })
})

test.describe('Pop out', () => {
  const DATE_TYPE = 'Standard.Base.Data.Time.Date.Date'
  const NEW_DATE = 'Date.new 2020 1 15'

  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          `from Standard.Base import Date\n\nmain =\n    date1 = Date.new 2020 1 1\n    days = date1.days_until (${NEW_DATE})\n`,
        ),
    },
  })

  /** `days = date1.days_until (Date.new 2020 1 15)`, where `end` is the argument that is popped out. */
  async function daysNode(editorPage: EditorPageActions, page: Page) {
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
        module: 'Standard.Base.Data.Time.Date',
        name: 'days_until',
        arguments: [
          { name: 'self', reprType: DATE_TYPE, isSuspended: false, hasDefault: false },
          { name: 'end', reprType: 'Standard.Base.Any.Any', isSuspended: false, hasDefault: false },
        ],
        selfType: DATE_TYPE,
        returnType: 'Standard.Base.Data.Numbers.Integer',
        isStatic: false,
        annotations: [],
      })
    await mockMethodCallInfo(page, 'days', {
      methodPointer: {
        module: 'Standard.Base.Data.Time.Date',
        definedOnType: DATE_TYPE,
        name: 'days_until',
      },
      notAppliedArguments: [],
    })
    const node = locate.graphNodeByBinding(page, 'days')
    const port = node.locator('[data-pop-out-name="end"]')
    await expect(port).toHaveCount(1)
    // The `Date.new` text, not a number field: the fields stop the drag from starting.
    const handle = port.getByText('Date', { exact: false }).first()
    return { node, port, handle }
  }

  async function startDrag(page: Page, handle: ReturnType<Page['locator']>) {
    const box = (await handle.boundingBox())!
    const x = box.x + 4
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 50, { steps: 5 })
    await page.mouse.move(x, y + 200, { steps: 5 })
    return { x, y }
  }

  test('dragging the value off the node makes a node of its own, in one undo step', async ({
    editorPage,
    page,
  }) => {
    const { node, handle } = await daysNode(editorPage, page)
    const before = await moduleCode(page)
    await startDrag(page, handle)
    await page.mouse.up()
    const popped = locate.graphNodeByBinding(page, 'end1')
    await expect(popped).toHaveCount(1)
    await expect(popped).toContainText('Date')
    const code = await moduleCode(page)
    expect(code).toContain(`end1 = ${NEW_DATE}`)
    expect(code).toContain('days = date1.days_until end1')
    // Bindings are sequential: the new node must be defined before its user.
    expect(code.indexOf('end1 =')).toBeGreaterThanOrEqual(0)
    expect(code.indexOf('end1 =')).toBeLessThan(code.indexOf('days ='))
    await expect(await locate.edgesFromNode(page, popped)).toHaveCount(1)
    await expect(node).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(locate.graphNodeByBinding(page, 'end1')).toHaveCount(0)
    expect(await moduleCode(page)).toBe(before)
  })

  test('Escape cancels the drag: no node, the code and the position are unchanged', async ({
    editorPage,
    page,
  }) => {
    const { node, handle } = await daysNode(editorPage, page)
    const before = await moduleCode(page)
    const boxBefore = (await node.boundingBox())!
    await startDrag(page, handle)
    await expect(page.getByTestId('popOutGhost')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('popOutGhost')).toHaveCount(0)
    await page.mouse.up()
    await expect(locate.graphNodeByBinding(page, 'end1')).toHaveCount(0)
    expect(await moduleCode(page)).toBe(before)
    expect(await node.boundingBox()).toEqual(boxBefore)
  })

  test('clicking an argument still selects the node', async ({ editorPage, page }) => {
    const { node, handle } = await daysNode(editorPage, page)
    await actions.clickAtBackground(page)
    await expect(locate.selectedNodes(page)).toHaveCount(0)
    await handle.click()
    await expect(node).toHaveClass(/selected/)
    await expect(locate.graphNodeByBinding(page, 'end1')).toHaveCount(0)
  })

  test('dragging the function name still moves the node', async ({ editorPage, page }) => {
    const { node } = await daysNode(editorPage, page)
    const before = (await node.boundingBox())!
    const name = node.getByText('days_until').first()
    const box = (await name.boundingBox())!
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 4, box.y + 100, { steps: 5 })
    await page.mouse.up()
    const after = (await node.boundingBox())!
    expect(after.y).toBeGreaterThan(before.y + 50)
    await expect(locate.graphNodeByBinding(page, 'end1')).toHaveCount(0)
  })
})

/**
 * `data = Data.<method> 'data.csv' (..Delimited ',')`: `format`'s declared type gives no
 * `Delimited` constructor (`Any`, as `Data.read`'s untyped `format` is, or `File_Format`, which
 * the mock's `Data.read` declares); the engine resolves the call to `Delimited_Format.Delimited`.
 */
for (const { method, formatType } of [
  { method: 'load', formatType: 'Standard.Base.Any.Any' },
  { method: 'read', formatType: undefined },
]) {
  test.describe(`Pop out of an auto-scoped value in Data.${method}'s format`, () => {
    const FORMAT_MODULE = 'Standard.Table.Delimited.Delimited_Format'
    const FORMAT_TYPE = `${FORMAT_MODULE}.Delimited_Format`
    const VALUE = "..Delimited ','"

    test.afterEach(restoreMockMainFile)
    test.use({
      setupApi: {
        local: () =>
          setMockMainFile(
            `from Standard.Base import Data\n\nmain =\n    data = Data.${method} 'data.csv' (${VALUE})\n`,
          ),
      },
    })

    async function dataNode(editorPage: EditorPageActions, page: Page) {
      if (formatType != null) {
        const arg = (name: string) => ({
          name,
          reprType: formatType,
          isSuspended: false,
          hasDefault: false,
        })
        await editorPage.mockSuggestion({
          type: 'method',
          module: 'Standard.Base.Data',
          name: method,
          arguments: [arg('path'), arg('format')],
          selfType: 'Standard.Base.Data',
          returnType: 'Standard.Base.Any.Any',
          isStatic: true,
          annotations: [],
        })
      }
      await editorPage
        .mockSuggestion({
          type: 'type',
          module: FORMAT_MODULE,
          name: 'Delimited_Format',
          params: [],
          reexport: 'Standard.Table',
        })
        .mockSuggestion({
          type: 'constructor',
          module: FORMAT_MODULE,
          name: 'Delimited',
          arguments: [
            {
              name: 'delimiter',
              reprType: 'Standard.Base.Data.Text.Text',
              isSuspended: false,
              hasDefault: false,
            },
          ],
          returnType: FORMAT_TYPE,
          annotations: [],
        })
      await mockMethodCallInfo(page, 'data', {
        methodPointer: {
          module: 'Standard.Base.Data',
          definedOnType: 'Standard.Base.Data',
          name: method,
        },
        notAppliedArguments: method === 'read' ? [2] : [],
      })
      const delimited = {
        methodPointer: { module: FORMAT_MODULE, definedOnType: FORMAT_TYPE, name: 'Delimited' },
      }
      await mockMethodCallInfo(
        page,
        { binding: 'data', expr: VALUE },
        { ...delimited, notAppliedArguments: [] },
      )
      await mockMethodCallInfo(
        page,
        { binding: 'data', expr: '..Delimited' },
        { ...delimited, notAppliedArguments: [0] },
      )
      const node = locate.graphNodeByBinding(page, 'data')
      const port = node.locator('[data-pop-out-name="format"]')
      await expect(port).toHaveCount(1)
      const handle = port.getByText('Delimited', { exact: false }).first()
      return { node, handle }
    }

    test('the resolved constructor qualifies it, and its type is imported', async ({
      editorPage,
      page,
    }) => {
      const { handle } = await dataNode(editorPage, page)
      const box = (await handle.boundingBox())!
      const x = box.x + 4
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + 50, { steps: 5 })
      await page.mouse.move(x, y + 200, { steps: 5 })
      await page.mouse.up()
      const popped = locate.graphNodeByBinding(page, 'format1')
      await expect(popped).toHaveCount(1)
      await expect(await locate.edgesFromNode(page, popped)).toHaveCount(1)
      const code = await moduleCode(page)
      expect(code).toContain("format1 = Delimited_Format.Delimited ','")
      expect(code).toContain(`data = Data.${method} 'data.csv' format1`)
      expect(code).toContain('from Standard.Table import Delimited_Format')
    })
  })
}

/**
 * `data = Data.read 'data.csv' (..Delimited ',' row_limit=(..First 10))`: the popped-out `..First`
 * is an argument of `..Delimited`. Its type, `Rows_To_Read`, is not exported from
 * `Standard.Table`'s `Main` and shares its name with the module defining it, which
 * `from Standard.Table import all` does not import either (#883).
 */
test.describe('Pop out of an auto-scoped value nested in ..Delimited', () => {
  const FORMAT_MODULE = 'Standard.Table.Delimited.Delimited_Format'
  const FORMAT_TYPE = `${FORMAT_MODULE}.Delimited_Format`
  const ROWS_MODULE = 'Standard.Table.Rows_To_Read'
  const ROWS_TYPE = `${ROWS_MODULE}.Rows_To_Read`
  const FIRST = '..First 10'
  const VALUE = `..Delimited ',' row_limit=(${FIRST})`

  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          `from Standard.Base import Data\nfrom Standard.Table import all\n\nmain =\n    data = Data.read 'data.csv' (${VALUE})\n`,
        ),
    },
  })

  test('the nested constructor is qualified, and its type is imported from its module', async ({
    editorPage,
    page,
  }) => {
    const arg = (name: string, reprType: string) => ({
      name,
      reprType,
      isSuspended: false,
      hasDefault: false,
    })
    await editorPage
      .mockSuggestion({
        type: 'type',
        module: FORMAT_MODULE,
        name: 'Delimited_Format',
        params: [],
        reexport: 'Standard.Table',
      })
      .mockSuggestion({
        type: 'constructor',
        module: FORMAT_MODULE,
        name: 'Delimited',
        arguments: [arg('delimiter', 'Standard.Base.Data.Text.Text'), arg('row_limit', ROWS_TYPE)],
        returnType: FORMAT_TYPE,
        annotations: [],
      })
      .mockSuggestion({ type: 'module', module: ROWS_MODULE })
      .mockSuggestion({ type: 'type', module: ROWS_MODULE, name: 'Rows_To_Read', params: [] })
      .mockSuggestion({
        type: 'constructor',
        module: ROWS_MODULE,
        name: 'First',
        arguments: [arg('rows', 'Standard.Base.Data.Numbers.Integer')],
        returnType: ROWS_TYPE,
        annotations: [],
      })
    await mockMethodCallInfo(page, 'data', {
      methodPointer: {
        module: 'Standard.Base.Data',
        definedOnType: 'Standard.Base.Data',
        name: 'read',
      },
      notAppliedArguments: [2],
    })
    const delimited = {
      methodPointer: { module: FORMAT_MODULE, definedOnType: FORMAT_TYPE, name: 'Delimited' },
    }
    await mockMethodCallInfo(
      page,
      { binding: 'data', expr: VALUE },
      { ...delimited, notAppliedArguments: [] },
    )
    await mockMethodCallInfo(
      page,
      { binding: 'data', expr: '..Delimited' },
      { ...delimited, notAppliedArguments: [0, 1] },
    )
    const first = {
      methodPointer: { module: ROWS_MODULE, definedOnType: ROWS_TYPE, name: 'First' },
    }
    await mockMethodCallInfo(
      page,
      { binding: 'data', expr: FIRST },
      { ...first, notAppliedArguments: [] },
    )
    await mockMethodCallInfo(
      page,
      { binding: 'data', expr: '..First' },
      { ...first, notAppliedArguments: [0] },
    )
    const node = locate.graphNodeByBinding(page, 'data')
    const port = node.locator('[data-pop-out-name="row_limit"]')
    await expect(port).toHaveCount(1)
    const handle = port.getByText('First', { exact: false }).first()
    const box = (await handle.boundingBox())!
    const x = box.x + 4
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 50, { steps: 5 })
    await page.mouse.move(x, y + 200, { steps: 5 })
    await page.mouse.up()
    const popped = locate.graphNodeByBinding(page, 'row_limit1')
    await expect(popped).toHaveCount(1)
    await expect(await locate.edgesFromNode(page, popped)).toHaveCount(1)
    const code = await moduleCode(page)
    expect(code).toContain('row_limit1 = Rows_To_Read.First 10')
    expect(code).toContain("..Delimited ',' row_limit=row_limit1")
    expect(code).toContain('from Standard.Table.Rows_To_Read import Rows_To_Read')
  })
})
