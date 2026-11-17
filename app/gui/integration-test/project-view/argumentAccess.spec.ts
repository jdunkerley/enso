import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Page } from 'integration-test/base'
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

test.describe('The … menu of hidden parameters', () => {
  test.afterEach(restoreMockMainFile)
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import Data\n\nmain =\n    data = Data.read\n    wrapped = Data.read Data.read_many\n',
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
      {
        methodPointer: { ...READ.methodPointer, name: 'read_many' },
        notAppliedArguments: [0, 1, 2, 3],
      },
    )
    const data = editorPage.locateNodes('data')
    const wrapped = editorPage.locateNodes('wrapped')
    await expect(data.locator('.parameterMenuButton')).toHaveCount(1)
    await expect(wrapped.locator('.parameterMenuButton')).toHaveCount(2)
    return { data, wrapped }
  }

  test('picking a parameter writes it as a named argument', async ({ page, editorPage }) => {
    const { data } = await nodes(editorPage, page)
    await data.locator('.parameterMenuButton').click()
    await page
      .getByRole('dialog', { name: 'More parameters' })
      .getByRole('button', { name: /^format/ })
      .click()
    await expect(page.getByRole('dialog', { name: 'More parameters' })).toBeHidden()
    expect(await moduleCode(page)).toContain('data = Data.read format=Auto_Detect')
    await actions.clickAtBackground(page)
    // `on_problems` is still hidden, so the button stays, and the menu no longer lists `format`.
    await data.locator('.parameterMenuButton').click()
    const menu = page.getByRole('dialog', { name: 'More parameters' })
    await expect(menu.getByRole('button', { name: /^on_problems/ })).toBeVisible()
    await expect(menu.getByRole('button', { name: /^format/ })).toHaveCount(0)
  })

  test('Escape, and a click on a node, close the menu; one menu is open at a time', async ({
    page,
    editorPage,
  }) => {
    const { data, wrapped } = await nodes(editorPage, page)
    const menu = page.getByRole('dialog', { name: 'More parameters' })
    await data.locator('.parameterMenuButton').click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await actions.clickAtBackground(page)
    await data.locator('.parameterMenuButton').click()
    await expect(menu).toBeVisible()
    await wrapped.locator('.parameterMenuButton').first().click()
    await expect(menu).toHaveCount(1)
    await wrapped.click({ position: { x: 8, y: 8 } })
    await expect(menu).toBeHidden()
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
