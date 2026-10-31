/** @file The component browser offers the components of installed libraries that are not loaded. */
import { expect, test, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import * as locate from './locate'

async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  return page.evaluate(() => (window as any).__codeEditorApi.textContent())
}

test.afterEach(restoreMockMainFile)

test.use({
  setupApi: {
    local: () =>
      setMockMainFile(
        'from Standard.Base import all\n\n## A project that does not import Standard.AWS.\nmain =\n    a = 42\n',
      ),
  },
})

test('a method of a library the module does not import is found, and picking it adds the import', async ({
  editorPage,
  page,
}) => {
  // What the language server sends from Standard.AWS's catalogue before the library is loaded.
  await editorPage
    .mockSuggestion({
      type: 'type',
      module: 'Standard.AWS.S3.S3',
      name: 'S3',
      params: [],
      reexport: 'Standard.AWS.Main',
      fromCatalogue: true,
    })
    .mockSuggestion({
      type: 'method',
      module: 'Standard.AWS.S3.S3',
      name: 'list_objects',
      arguments: [],
      selfType: 'Standard.AWS.S3.S3.S3',
      returnType: 'Standard.Base.Data.Vector.Vector',
      isStatic: true,
      annotations: [],
      fromCatalogue: true,
    })
  const nodeCount = await locate.graphNode(page).count()
  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowserInput(page)).toBeFocused()
  await locate.componentBrowserInput(page).fill('list_objects')
  await expect(locate.componentBrowserEntry(page).first()).toContainText('S3.list_objects')

  await page.keyboard.press('Enter')
  await expect(locate.componentBrowser(page)).toBeHidden()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect(locate.graphNode(page).last().locator('.WidgetToken')).toHaveText([
    'S3',
    '.',
    'list_objects',
  ])
  expect(await moduleCode(page)).toContain('from Standard.AWS import S3')
})
