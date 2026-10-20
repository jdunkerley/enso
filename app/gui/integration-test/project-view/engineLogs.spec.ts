/** @file The bottom dock's Logs tab: the open project's engine log, live (engine logs panel). */
import { expect, test } from 'integration-test/base'
import * as locate from './locate'

const INFO = '[INFO] [2026-10-20T10:00:00.000Z] [org.enso.languageserver] Language server started'
const ERROR = '[ERROR] [2026-10-20T10:00:01.000Z] [org.enso.interpreter] Something failed'
const STDERR = 'Exception in thread "main" java.lang.IllegalStateException'

test.use({
  setupApi: {
    local: (api) => {
      api.addEngineLogEvent('waiting')
      api.addEngineLogEvent('session', {
        sessionId: 'mock-session',
        logFile: '/logs/enso-language-server-2026-10-20-10-00-00.log',
      })
      api.addEngineLogLine(INFO)
      api.addEngineLogLine(ERROR)
      api.addEngineLogLine(STDERR, 'stderr')
    },
  },
})

test('the Logs tab follows the engine log and filters by level', async ({
  editorPage,
  localApi,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const dock = locate.bottomDock(page)
    await expect(dock.getByRole('tab', { name: /Logs/ })).toHaveAttribute('aria-selected', 'true')
    const log = dock.getByRole('log')
    await expect(log.getByText('Language server started')).toBeVisible()
    await expect(log.getByText('Something failed')).toBeVisible()
    await expect(log.getByText(STDERR)).toBeVisible()

    // A line written later arrives without reopening anything.
    localApi.addEngineLogLine(
      '[INFO] [2026-10-20T10:00:02.000Z] [org.enso.languageserver] A later line',
    )
    await expect(log.getByText('A later line')).toBeVisible()

    await dock.getByRole('combobox', { name: 'Level' }).selectOption('error')
    await expect(log.getByText('Something failed')).toBeVisible()
    await expect(log.getByText(STDERR)).toBeVisible()
    await expect(log.getByText('Language server started')).toBeHidden()

    // The shortcut closes the dock again while Logs shows.
    await page.keyboard.press('ControlOrMeta+L')
    await expect(dock).toBeHidden()
  })
})

test('the Logs tab counts unseen errors while the Code tab shows', async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+`')
    const dock = locate.bottomDock(page)
    await expect(dock.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    const logsTab = dock.getByRole('tab', { name: /Logs/ })
    // The ERROR entry and the stderr line.
    await expect(logsTab.getByTestId('logs-badge')).toHaveText('2')
    await logsTab.click()
    await expect(logsTab.getByTestId('logs-badge')).toBeHidden()
  })
})

test('the code editor still works after the Logs tab has shown', async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+`')
    const dock = locate.bottomDock(page)
    const codeEditor = locate.codeEditor(page)
    await expect(codeEditor).toBeVisible()

    // Both tabs stay mounted: Logs hides the code editor rather than unmounting it.
    await dock.getByRole('tab', { name: /Logs/ }).click()
    await expect(dock.getByRole('log').getByText('Something failed')).toBeVisible()
    await expect(codeEditor).toBeHidden()

    await dock.getByRole('tab', { name: 'Code' }).click()
    await expect(codeEditor).toBeVisible()
    await expect(codeEditor.locator('.cm-line', { hasText: 'The main method' })).toBeVisible()
    await codeEditor.locator('.cm-content').click()
    await page.evaluate(() => {
      const api = (window as any).__codeEditorApi
      api.placeCursor(api.indexOf('The main method') + 8)
    })
    await page.keyboard.type(' TEST')
    await expect(codeEditor.locator('.cm-content')).toContainText('The main TEST method')
  })
})
