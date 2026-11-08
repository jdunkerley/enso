/**
 * @file A replaced ydoc server session (#604): the GUI makes its project stores again, keeping the
 * edits that never reached the file and the view's state.
 */
import { expect, test, type Page } from 'integration-test/base'
import { restoreMockMainFile, setMockMainFile } from 'integration-test/mock/lsHandler'
import { TEXT } from '../actions'
import { DELETE_KEY } from './keyboard'
import * as locate from './locate'

test.afterEach(restoreMockMainFile)

async function createNode(page: Page, expression: string) {
  const nodesCount = await locate.graphNode(page).count()
  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowserInput(page)).toBeFocused()
  await page.keyboard.insertText(expression)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(locate.graphNode(page)).toHaveCount(nodesCount + 1)
  await expect(page.locator('[data-transitioning]')).toHaveCount(0)
  return nodesCount + 1
}

function toasts(page: Page) {
  return page.getByTestId('toast-host')
}

/** Wait until the GUI has noticed the new session and made its stores again. */
async function expectReconnected(page: Page) {
  await expect(toasts(page).getByText(TEXT.projectConnectionRestarted)).toBeVisible()
  await expect(locate.graphNode(page).first()).toBeVisible()
}

function nodeWithText(page: Page, text: string) {
  return locate.graphNode(page).filter({ has: page.locator('.WidgetToken', { hasText: text }) })
}

test('edits that never reached the file come back after the session is replaced', async ({
  editorPage,
  page,
  localApi,
}) => {
  await editorPage
  const nodesCount = await createNode(page, 'foo')
  await page.keyboard.press('ControlOrMeta+`')
  await expect(locate.codeEditor(page)).toBeVisible()
  await nodeWithText(page, 'foo').locator('.grab-handle').click()
  await expect(locate.selectedNodes(page)).toHaveCount(1)

  localApi.replaceServerSession()

  await expectReconnected(page)
  await expect(toasts(page).getByText(/^Restored \d+ unsaved changes?\.$/)).toBeVisible()
  await expect(locate.graphNode(page)).toHaveCount(nodesCount)
  await expect(nodeWithText(page, 'foo')).toHaveCount(1)
  // The view's own state came back too.
  await expect(locate.selectedNodes(page)).toHaveCount(1)
  await expect(locate.selectedNodes(page).locator('.WidgetToken')).toHaveText(['foo'])
  await expect(locate.codeEditor(page)).toBeVisible()
})

test('an open component browser keeps its input', async ({ editorPage, page, localApi }) => {
  await editorPage
  await locate.addNewNodeButton(page).click()
  await expect(locate.componentBrowserInput(page)).toBeFocused()
  await page.keyboard.insertText('unfinished')

  localApi.replaceServerSession()

  await expectReconnected(page)
  await expect(locate.componentBrowser(page)).toBeVisible()
  await expect(locate.componentBrowserInput(page)).toHaveText('unfinished')
})

test('a file that changed underneath is kept, unless the user restores their version', async ({
  editorPage,
  page,
  localApi,
}) => {
  await editorPage
  await createNode(page, 'foo')
  setMockMainFile('from Standard.Base import all\n\nmain =\n    changed = 1\n')

  localApi.replaceServerSession()

  await expectReconnected(page)
  const prompt = page.getByTestId('file-changed-toast')
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText(TEXT.projectFileChangedOnReconnect.replace('$0', 'Main.enso'))
  await expect(locate.graphNodeByBinding(page, 'changed')).toHaveCount(1)
  await expect(nodeWithText(page, 'foo')).toHaveCount(0)

  await prompt.getByRole('button', { name: TEXT.projectFileRestoreMine }).click()

  await expect(prompt).toBeHidden()
  await expect(nodeWithText(page, 'foo')).toHaveCount(1)
  await expect(locate.graphNodeByBinding(page, 'changed')).toHaveCount(0)
  await expect(toasts(page).getByText(/^Restored \d+ unsaved changes?\.$/)).toBeVisible()
})

test('keeping the file leaves it as it is', async ({ editorPage, page, localApi }) => {
  await editorPage
  await createNode(page, 'foo')
  setMockMainFile('from Standard.Base import all\n\nmain =\n    changed = 1\n')

  localApi.replaceServerSession()

  await expectReconnected(page)
  const prompt = page.getByTestId('file-changed-toast')
  await prompt.getByRole('button', { name: TEXT.projectFileKeep }).click()
  await expect(prompt).toBeHidden()
  await expect(locate.graphNodeByBinding(page, 'changed')).toHaveCount(1)
  await expect(nodeWithText(page, 'foo')).toHaveCount(0)
})

test('the restore is an undo step of its own, and its toast can undo it', async ({
  editorPage,
  page,
  localApi,
}) => {
  await editorPage
  const nodesCount = await createNode(page, 'foo')
  localApi.replaceServerSession()
  await expectReconnected(page)
  const restored = page.getByTestId('changes-restored-toast')
  await expect(restored).toBeVisible()
  const deleted = locate.graphNodeByBinding(page, 'final')
  await deleted.locator('.grab-handle').click()
  await page.keyboard.press(DELETE_KEY)
  await expect(deleted).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+Z')

  await expect(deleted).toHaveCount(1)
  await expect(nodeWithText(page, 'foo')).toHaveCount(1)

  await restored.getByRole('button', { name: TEXT.projectRestoreUndo }).click()

  await expect(nodeWithText(page, 'foo')).toHaveCount(0)
  await expect(locate.graphNode(page)).toHaveCount(nodesCount - 1)
})

test('a choice still open when the session is replaced again is offered again', async ({
  editorPage,
  page,
  localApi,
}) => {
  await editorPage
  await createNode(page, 'foo')
  setMockMainFile('from Standard.Base import all\n\nmain =\n    changed = 1\n')
  localApi.replaceServerSession()
  await expectReconnected(page)
  const prompt = page.getByTestId('file-changed-toast')
  await expect(prompt).toBeVisible()

  localApi.replaceServerSession()

  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: TEXT.projectFileRestoreMine }).click()
  await expect(prompt).toBeHidden()
  await expect(nodeWithText(page, 'foo')).toHaveCount(1)
  await expect(locate.graphNodeByBinding(page, 'changed')).toHaveCount(0)
})
