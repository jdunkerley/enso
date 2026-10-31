/** @file The component browser offers the components of installed libraries that are not loaded. */
import type EditorPageActions from 'integration-test/actions/EditorPageActions'
import { expect, test, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import * as locate from './locate'

async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  return page.evaluate(() => (window as any).__codeEditorApi.textContent())
}

async function search(page: Page, text: string) {
  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowserInput(page)).toBeFocused()
  await locate.componentBrowserInput(page).fill(text)
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

/**
 * The entries Standard.AWS's catalogue gives before the library is loaded, and a `list_objects` of
 * Standard.Base, which the module imports. Both match a search for `list_objects` equally.
 */
function mockEntries(editorPage: EditorPageActions) {
  return editorPage
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
    .mockSuggestion({
      type: 'type',
      module: 'Standard.Base.Data.Files',
      name: 'Files',
      params: [],
      reexport: 'Standard.Base.Main',
    })
    .mockSuggestion({
      type: 'method',
      module: 'Standard.Base.Data.Files',
      name: 'list_objects',
      arguments: [],
      selfType: 'Standard.Base.Data.Files.Files',
      returnType: 'Standard.Base.Data.Vector.Vector',
      isStatic: true,
      annotations: [],
    })
}

test('a method of a library the module does not import is found, and picking it adds the import', async ({
  editorPage,
  page,
}) => {
  await mockEntries(editorPage)
  const nodeCount = await locate.graphNode(page).count()
  await search(page, 'list_objects')
  await expect(locate.componentBrowserEntry(page)).toHaveCount(2)
  await locate.componentBrowserEntry(page).filter({ hasText: 'S3.list_objects' }).click()
  await expect(locate.componentBrowser(page)).toBeHidden()
  await expect(locate.graphNode(page)).toHaveCount(nodeCount + 1)
  await expect(locate.graphNode(page).last().locator('.WidgetToken')).toHaveText([
    'S3',
    '.',
    'list_objects',
  ])
  expect(await moduleCode(page)).toContain('from Standard.AWS import S3')
})

test('on an equal match, a library the module imports is listed first, and importing the other changes the order', async ({
  editorPage,
  page,
}) => {
  await mockEntries(editorPage)
  // By module order Standard.AWS comes first; Standard.Base is imported, Standard.AWS is not.
  await search(page, 'list_objects')
  await expect(locate.componentBrowserEntry(page)).toHaveText([
    /Files\.list_objects/,
    /S3\.list_objects/,
  ])
  // Pick the AWS entry: it adds the import.
  await locate.componentBrowserEntry(page).filter({ hasText: 'S3.list_objects' }).click()
  await expect(locate.componentBrowser(page)).toBeHidden()
  expect(await moduleCode(page)).toContain('from Standard.AWS import S3')
  await page.keyboard.press('ControlOrMeta+`')
  // Both libraries are imported now, so the module order decides again.
  await search(page, 'list_objects')
  await expect(locate.componentBrowserEntry(page)).toHaveText([
    /S3\.list_objects/,
    /Files\.list_objects/,
  ])
})
