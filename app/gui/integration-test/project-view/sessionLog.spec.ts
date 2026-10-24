/**
 * @file The session log tab (Activity → Show Logs): a session of a project read from its log file,
 * in the engine log viewer the project view's Logs tab uses.
 */
import { expect, test, type Page } from 'integration-test/base'

const entry = (level: string, logger: string, message: string) =>
  `[${level}] [2026-10-19T09:00:00.000Z] [${logger}] ${message}`

const OLDER = [
  entry('INFO', 'org.enso.languageserver', 'Language server started'),
  entry('INFO', 'Standard.Table.Table.Table', 'Read 1,204 rows'),
]
const NEWER = [
  entry('WARN', 'Standard.Table.Table.Table', '3 rows had invalid dates'),
  entry('INFO', 'User.local.Mock.Main.Report', 'Report written'),
  entry('ERROR', 'Standard.Base.Data.Vector', 'Index out of bounds'),
]

const sessionTab = (page: Page) => page.getByTestId('session-log-tab')

async function showLogs(page: Page, newest = true) {
  await page.getByRole('tab', { name: 'Activity' }).click()
  const buttons = page.getByTestId('right-panel').getByRole('button', { name: 'Show Logs' })
  await (newest ? buttons.first() : buttons.last()).click()
  await expect(sessionTab(page)).toBeVisible()
}

test.describe('a session with two files', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.addProjectSession('2026-10-18T09:00:00.000Z', [['from the first session']])
        api.addProjectSession('2026-10-19T09:00:00.000Z', [OLDER, NEWER])
      },
    },
  })

  test('Show Logs opens the session in the viewer, with its filters', async ({ editorPage }) => {
    await editorPage.do(async (page) => {
      await showLogs(page)
      const tab = sessionTab(page)
      const log = tab.getByRole('log')
      await expect(log.getByText('Report written')).toBeVisible()
      await expect(log.getByText('Read 1,204 rows')).toBeVisible()
      // The engine's own lines are hidden at first, as in the Logs tab.
      await expect(log.getByText('Language server started')).toBeHidden()
      // The project's other session is offered; there is no live one.
      const picker = tab.getByRole('combobox', { name: 'Session' })
      await expect(picker.locator('option')).toHaveCount(2)
      await expect(picker.locator('option', { hasText: 'This session' })).toHaveCount(0)
      await expect(tab.getByRole('button', { name: 'Reload' })).toBeVisible()
      await expect(tab.getByRole('button', { name: 'Download log file' })).toBeEnabled()

      // The logger filter, with the loggers seen as suggestions.
      const logger = tab.getByRole('combobox', { name: 'Logger' })
      const listId = await logger.getAttribute('list')
      await expect(
        tab.locator(`datalist[id="${listId}"] option[value="Standard.Table"]`),
      ).toHaveCount(1)
      await logger.fill('Standard.Table')
      await expect(log.getByText('Read 1,204 rows')).toBeVisible()
      await expect(log.getByText('3 rows had invalid dates')).toBeVisible()
      await expect(log.getByText('Report written')).toBeHidden()
      await expect(log.getByText('Index out of bounds')).toBeHidden()
      await logger.fill('')

      // The source tickboxes, in their popover, as in the Logs tab.
      const sourcesButton = tab.getByTestId('engine-logs-sources-button')
      await expect(sourcesButton).toHaveText('Sources: 2 of 3')
      await sourcesButton.click()
      const sources = page.getByRole('dialog', { name: 'Sources' })
      await sources.getByRole('checkbox', { name: 'Engine' }).check()
      await expect(log.getByText('Language server started')).toBeVisible()
      await expect(sourcesButton).toHaveText('Sources: All')
      await page.keyboard.press('Escape')
      await expect(sources).toBeHidden()
      await expect(sourcesButton).toBeFocused()

      await picker.selectOption({ index: 1 })
      await expect(log.getByText('from the first session')).toBeVisible()
      await expect(log.getByText('Report written')).toBeHidden()
    })
  })
})

test.describe('a long session', () => {
  const ARCHIVE = Array.from({ length: 15_000 }, (_, n) =>
    entry('INFO', 'Standard.Table.Table.Table', `archived line ${n}`),
  )
  const ACTIVE = Array.from({ length: 15_000 }, (_, n) =>
    entry('INFO', 'Standard.Table.Table.Table', `active line ${n}`),
  )
  test.use({
    setupApi: {
      local: (api) => void api.addProjectSession('2026-10-19T09:00:00.000Z', [ARCHIVE, ACTIVE]),
    },
  })

  test('Load older lines pages back to the start of the session', async ({ editorPage }) => {
    await editorPage.do(async (page) => {
      await showLogs(page)
      const log = sessionTab(page).getByRole('log')
      await expect(log.getByText('active line 14999')).toBeVisible()
      await log.evaluate((element) => (element.scrollTop = 0))
      // Only the newest 20,000 lines are read at first.
      await expect(log.getByText(/ archived line 10000$/)).toBeVisible()
      await log.getByRole('button', { name: 'Load older lines' }).click()
      await expect(log.getByText(/ archived line 9999$/)).toBeVisible()
      await log.evaluate((element) => (element.scrollTop = 0))
      await expect(log.getByText(/ archived line 0$/)).toBeVisible()
      await expect(log.getByRole('button', { name: 'Load older lines' })).toHaveCount(0)
    })
  })
})

test.describe('a session log tab saved by the old viewer', () => {
  const SESSION = 'localprojectsession-mock/enso-language-server-mock-0'
  test.use({
    setupApi: {
      local: (api) => {
        api.addProjectSession('2026-10-19T09:00:00.000Z', [NEWER])
        api.addProjectSession('2026-10-20T09:00:00.000Z', [['a later session']])
      },
    },
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((session) => {
      localStorage.setItem(
        'Enso::openedTabs',
        JSON.stringify([{ type: 'projectLog', id: session, title: 'Mock Project' }]),
      )
    }, SESSION)
  })

  test('reopens in the new viewer', async ({ drivePage, page }) => {
    await drivePage
    await page.getByText('Session Log for Mock Project').click()
    const tab = sessionTab(page)
    await expect(tab.getByRole('log').getByText('Report written')).toBeVisible()
    // Saved without its project: its own session alone.
    await expect(tab.getByRole('combobox', { name: 'Session' }).locator('option')).toHaveCount(1)
  })
})

test.describe('a saved session log tab without its project', () => {
  const SESSION = 'localprojectsession-mock/enso-language-server-mock-0'
  test.use({
    setupApi: {
      local: (api) => {
        api.addProjectSession('2026-10-19T09:00:00.000Z', [NEWER])
        api.addProjectSession('2026-10-20T09:00:00.000Z', [['a later session']])
      },
    },
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((session) => {
      localStorage.setItem(
        'Enso::openedTabs',
        // Not the project's name, which the editor fixture looks its tab up by.
        JSON.stringify([{ type: 'projectLog', id: session, title: 'Saved' }]),
      )
    }, SESSION)
  })

  test('gets its project when Show Logs opens its session again', async ({ editorPage }) => {
    await editorPage.do(async (page) => {
      // The oldest session is the one the saved tab shows.
      await showLogs(page, false)
      const tab = sessionTab(page)
      await expect(tab.getByRole('log').getByText('Report written')).toBeVisible()
      await expect(tab.getByRole('combobox', { name: 'Session' }).locator('option')).toHaveCount(2)
    })
  })
})
