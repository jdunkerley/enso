/** @file Data.read adds the import of the library that reads the file (#489). */
import { expect, test, type Page } from 'integration-test/base'
import {
  restoreMockMainFile,
  restoreMockWidgetConfigurations,
  setMockMainFile,
  setMockPublicTypes,
  updateVisualizationData,
} from 'integration-test/mock/lsHandler'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

const MAIN =
  'from Standard.Base import all\n\n## A project for the format imports.\nmain =\n    data = Data.read\n'
const SQLITE_IMPORT = 'from Standard.SQLite import SQLite_Format'
const DB_FILE = '/home/user/enso/data/Sales.db'
const UNKNOWN_FILE = '/home/user/enso/data/notes.xyz'

// What `File_Format.default_widget` sends for these formats since #489.
const FORMAT_CONFIG = [
  [
    'format',
    {
      type: 'Widget',
      constructor: 'Single_Choice',
      label: null,
      values: [
        {
          label: 'Auto Detect',
          value: 'Standard.Base.System.File_Format.Auto_Detect',
          parameters: [],
          icon: '',
        },
        {
          label: 'SQLite',
          value: '..SQLite',
          parameters: [],
          icon: '',
          requires: 'Standard.SQLite.SQLite_Format.SQLite_Format',
          patterns: ['*.sqlite', '*.db'],
        },
      ],
      display: { type: 'Display', constructor: 'When_Modified' },
    },
  ],
]

/** The module's code, with the code editor open. */
async function moduleCode(page: Page): Promise<string> {
  const editor = page.locator('.CodeEditor')
  if (!(await editor.isVisible())) await page.keyboard.press('ControlOrMeta+`')
  await expect(editor).toBeVisible()
  return page.evaluate(() => (window as any).__codeEditorApi.textContent())
}

async function dataReadNode(page: Page) {
  updateVisualizationData('.read', FORMAT_CONFIG)
  await mockMethodCallInfo(page, 'data', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [0, 1, 2],
  })
  return locate.graphNodeByBinding(page, 'data')
}

async function chooseFile(page: Page, file: string) {
  await page.evaluate((file) => {
    Object.assign(window.api!.fileBrowser, {
      openFileBrowser: async () => [file],
    })
  }, file)
  const node = await dataReadNode(page)
  const pathArg = node.locator('.WidgetTopLevelArgument').filter({ hasText: 'path' })
  await pathArg.click()
  await page.getByText('Choose file…').click()
  await expect(pathArg.getByTestId('widget-text-content')).toHaveText(file)
}

/** Drop a file on the graph as Electron does: the file's real path comes from `getFilePath`. */
async function dropFile(page: Page, path: string) {
  await page.evaluate((path) => {
    Object.assign(window.api!, { system: { getFilePath: () => path } })
    const target = document.querySelector('.GraphEditor')!
    const box = target.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['content'], path.split('/').pop()!))
    target.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer,
        bubbles: true,
        cancelable: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height - 150,
      }),
    )
  }, path)
}

test.use({
  setupApi: {
    local: () => {
      setMockMainFile(MAIN)
      // `Standard.SQLite` is not loaded: only its declaration knows `SQLite_Format`.
      setMockPublicTypes([{ name: 'SQLite_Format', library: 'Standard.SQLite' }])
    },
  },
})
test.afterEach(restoreMockMainFile)
test.afterEach(restoreMockWidgetConfigurations)

test('choosing SQLite in the format dropdown adds its import; one undo removes both', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const node = await dataReadNode(page)
  await node.click()
  const formatArg = node
    .locator('.WidgetTopLevelArgument')
    .filter({ has: page.getByText('format') })
  await formatArg.click()
  await page
    .locator('.DropdownWidget:not([data-transitioning]) .item')
    .filter({ hasText: 'SQLite' })
    .click()
  await expect(node).toContainText('SQLite')
  await expect.poll(() => moduleCode(page)).toContain(SQLITE_IMPORT)
  // The code keeps the short form: no qualified name is inserted.
  expect(await moduleCode(page)).toContain('..SQLite')
  expect(await moduleCode(page)).not.toContain('SQLite_Format.SQLite')

  await page.getByTestId('action:graph.undo').click()
  await expect.poll(() => moduleCode(page)).not.toContain(SQLITE_IMPORT)
  expect(await moduleCode(page)).not.toContain('..SQLite')
})

test('choosing a .db file with format on Auto_Detect adds the SQLite import; one undo removes both', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await chooseFile(page, DB_FILE)
  await expect.poll(() => moduleCode(page)).toContain(SQLITE_IMPORT)

  await page.getByTestId('action:graph.undo').click()
  await expect.poll(() => moduleCode(page)).not.toContain(SQLITE_IMPORT)
  expect(await moduleCode(page)).not.toContain('Sales.db')
})

test('a file no format claims adds no import', async ({ editorPage, page }) => {
  await editorPage
  await chooseFile(page, UNKNOWN_FILE)
  await expect.poll(() => moduleCode(page)).toContain('notes.xyz')
  expect(await moduleCode(page)).not.toContain('Standard.SQLite')
})

test('dropping a .db file on the graph adds the SQLite import; one undo removes both', async ({
  editorPage,
  page,
}) => {
  await editorPage
  // The format options are asked for through an existing node.
  await dataReadNode(page)
  await dropFile(page, DB_FILE)
  await expect.poll(() => moduleCode(page)).toContain(`Data.read '${DB_FILE}'`)
  expect(await moduleCode(page)).toContain(SQLITE_IMPORT)

  await page.getByTestId('action:graph.undo').click()
  await expect.poll(() => moduleCode(page)).not.toContain(SQLITE_IMPORT)
  expect(await moduleCode(page)).not.toContain('Sales.db')
})

test('dropping a file no format claims adds the node without an import', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await dataReadNode(page)
  await dropFile(page, UNKNOWN_FILE)
  await expect.poll(() => moduleCode(page)).toContain(`Data.read '${UNKNOWN_FILE}'`)
  expect(await moduleCode(page)).not.toContain('Standard.SQLite')
})
