/** @file The IDE adds the imports that code needs (the unresolved-name detector). */
import { expect, test, type Page } from 'integration-test/base'
import {
  restoreMockMainFile,
  setMockMainFile,
  setMockPublicTypes,
  updateVisualizationData,
} from 'integration-test/mock/lsHandler'
import { mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

async function moduleCode(page: Page): Promise<string> {
  await page.keyboard.press('ControlOrMeta+`')
  await expect(page.locator('.CodeEditor')).toBeVisible()
  return page.evaluate(() => (window as any).__codeEditorApi.textContent())
}

test.afterEach(restoreMockMainFile)

test.describe('choosing a backend in the Database.connect dropdown', () => {
  test.use({
    setupApi: {
      local: () =>
        setMockMainFile(
          'from Standard.Base import all\nfrom Standard.Database import all\n\n## A project for the import detector.\nmain =\n    db = Database.connect\n',
        ),
    },
  })

  test('adds the import of the chosen backend', async ({ editorPage, page }) => {
    await editorPage
      .mockSuggestion({
        type: 'type',
        module: 'Standard.Postgres.Postgres',
        name: 'Postgres',
        params: [],
        reexport: 'Standard.Postgres.Main',
      })
      .mockSuggestion({
        type: 'method',
        module: 'Standard.Database.Connection.Database',
        name: 'connect',
        arguments: [
          {
            name: 'details',
            reprType: 'Standard.Database.Connection.Connection_Details.Connection_Details',
            isSuspended: false,
            hasDefault: false,
          },
        ],
        selfType: 'Standard.Database.Connection.Database',
        returnType: 'Standard.Database.Connection.Connection.Connection',
        isStatic: true,
        annotations: ['details'],
      })
    updateVisualizationData('.connect', [
      [
        'details',
        {
          type: 'Widget',
          constructor: 'Single_Choice',
          label: null,
          values: [
            {
              type: 'Choice',
              constructor: 'Option',
              value: "(Postgres.Server 'localhost' 5432)",
              label: 'Postgres',
              parameters: [],
            },
          ],
          display: { type: 'Display', constructor: 'Always' },
        },
      ],
    ])
    await mockMethodCallInfo(page, 'db', {
      methodPointer: {
        module: 'Standard.Database.Connection.Database',
        definedOnType: 'Standard.Database.Connection.Database',
        name: 'connect',
      },
      notAppliedArguments: [0],
    })
    const node = locate.graphNodeByBinding(page, 'db')
    const details = node
      .locator('.WidgetTopLevelArgument')
      .filter({ has: page.getByText('details') })
    await details.locator('.WidgetSelection').first().click()
    await page
      .locator('.DropdownWidget:not([data-transitioning]) .item')
      .filter({ hasText: 'Postgres' })
      .click()
    await expect(node).toContainText('Postgres.Server')
    expect(await moduleCode(page)).toContain('from Standard.Postgres import Postgres')
  })
})

test.describe('opening a project that uses SQLite without importing it', () => {
  test.use({
    setupApi: {
      local: () => {
        setMockMainFile(
          'from Standard.Base import all\nfrom Standard.Database import all\n\n## A project for the import detector.\nmain =\n    connection = Database.connect (SQLite.In_Memory)\n',
        )
        // The engine has not loaded `Standard.SQLite`: only its declaration knows `SQLite`.
        setMockPublicTypes([{ name: 'SQLite', library: 'Standard.SQLite' }])
      },
    },
  })

  test('adds the SQLite import and says so', async ({ editorPage, page }) => {
    await editorPage
    await expect(page.getByTestId('toast-host')).toContainText('from Standard.SQLite import SQLite')
    // The import is not part of the undo history: there is nothing to undo after opening ...
    const undoButton = page.getByTestId('action:graph.undo')
    await expect(undoButton).toBeDisabled()
    // ... and once the user does something, Ctrl+Z (shown to work) stops at that, keeping the import.
    const nodesCount = await locate.graphNode(page).count()
    await locate.addNewNodeButton(page).click()
    await expect(locate.componentBrowserInput(page)).toBeFocused()
    await page.keyboard.insertText('foo')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(locate.graphNode(page)).toHaveCount(nodesCount + 1)
    await expect(undoButton).toBeEnabled()
    await page.keyboard.press('ControlOrMeta+Z')
    await expect(locate.graphNode(page)).toHaveCount(nodesCount)
    await expect(undoButton).toBeDisabled()
    expect(await moduleCode(page)).toContain('from Standard.SQLite import SQLite')
  })
})

test('a project whose imports are complete opens without a notice', async ({
  editorPage,
  page,
}) => {
  await editorPage
  await expect(page.getByTestId('toast-host')).not.toContainText('Added an import')
  await expect(page.getByTestId('toast-host')).not.toContainText('Added imports')
})
