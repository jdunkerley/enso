/** @file The bottom dock's Logs tab: the open project's engine log, live (engine logs panel). */
import { expect, test, type Locator, type Page } from 'integration-test/base'
import * as fs from 'node:fs/promises'
import * as locate from './locate'

async function box(locator: Locator) {
  const rect = await locator.boundingBox()
  expect(rect).not.toBeNull()
  return { ...rect!, bottom: rect!.y + rect!.height, right: rect!.x + rect!.width }
}

/** Open the Logs tab's Sources popover, which holds the source tickboxes. */
async function openSources(page: Page) {
  await locate.bottomDock(page).getByTestId('engine-logs-sources-button').click()
  const sources = page.getByRole('dialog', { name: 'Sources' })
  await expect(sources).toBeVisible()
  return sources
}

const INFO = '[INFO] [2026-10-20T10:00:00.000Z] [org.enso.languageserver] Language server started'
// A library's ERROR: shown by default (Libraries is ticked), and counted by the badge.
const ERROR = '[ERROR] [2026-10-20T10:00:01.000Z] [Standard.Base.Data] Something failed'
const STDERR = 'Exception in thread "main" java.lang.IllegalStateException'
const LIBRARY = '[WARN] [2026-10-20T10:00:01.500Z] [Standard.Table.Table.Table] Slow query'
const USER = '[INFO] [2026-10-20T10:00:01.700Z] [User.local.Mock.Main.Report] Report written'
// Logged only while their settings are on (Settings → Local → Engine logs).
const SQL =
  '[INFO] [2026-10-20T10:00:01.800Z] [Standard.Database.Connection] jdbc:sqlite::memory: - query: SELECT 1'
const TIMING =
  '[DEBUG] [2026-10-20T10:00:01.900Z] [Standard.Base.Logging.Progress.JDBC_Connection.[SQLite] SELECT 1] ADVANCE JDBC_Connection.[SQLite] SELECT 1+1~12ms'

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
      api.addEngineLogLine(LIBRARY)
      api.addEngineLogLine(USER)
      api.addEngineLogLine(SQL)
      api.addEngineLogLine(TIMING)
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
    // The engine's lines, its stderr among them, show once Engine is ticked.
    await expect(log.getByText('Something failed')).toBeVisible()
    await expect(log.getByText('Language server started')).toBeHidden()
    await (await openSources(page)).getByRole('checkbox', { name: 'Engine' }).check()
    await expect(log.getByText('Language server started')).toBeVisible()
    await page.keyboard.press('Escape')
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

test('the Logs tab filters by source: engine, libraries, user log messages', async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const dock = locate.bottomDock(page)
    const log = dock.getByRole('log')
    const sourcesButton = dock.getByTestId('engine-logs-sources-button')
    await expect(sourcesButton).toHaveText('Sources: 2 of 3')
    const sources = await openSources(page)
    const engine = sources.getByRole('checkbox', { name: 'Engine' })
    const libraries = sources.getByRole('checkbox', { name: 'Libraries' })
    const user = sources.getByRole('checkbox', { name: 'User log messages' })
    // By default: the libraries and the user's messages, not the engine or its stderr.
    await expect(engine).not.toBeChecked()
    await expect(libraries).toBeChecked()
    await expect(user).toBeChecked()
    await expect(log.getByText('Slow query')).toBeVisible()
    await expect(log.getByText('Report written')).toBeVisible()
    await expect(log.getByText('Language server started')).toBeHidden()
    await expect(log.getByText(STDERR)).toBeHidden()

    await user.uncheck()
    await expect(log.getByText('Report written')).toBeHidden()
    await expect(log.getByText('Slow query')).toBeVisible()

    await engine.check()
    await libraries.uncheck()
    await expect(log.getByText('Language server started')).toBeVisible()
    await expect(log.getByText(STDERR)).toBeVisible()
    await expect(log.getByText('Slow query')).toBeHidden()
    await expect(log.getByText('Something failed')).toBeHidden()
    // Ticking leaves the popover open; its button sums the boxes up.
    await expect(sources).toBeVisible()
    await expect(sourcesButton).toHaveText('Sources: Engine')
  })
})

test('the Sources popover opens from the text filter, which keeps the focus', async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const dock = locate.bottomDock(page)
    const log = dock.getByRole('log')
    const filter = dock.getByRole('searchbox', { name: 'Filter logs' })
    const sources = page.getByRole('dialog', { name: 'Sources' })
    await filter.click()
    await expect(sources).toBeVisible()
    await expect(filter).toBeFocused()
    await page.keyboard.type('Slow')
    await expect(filter).toHaveValue('Slow')
    await expect(log.getByText('Slow query')).toBeVisible()
    await expect(log.getByText('Report written')).toBeHidden()
    await expect(sources).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sources).toBeHidden()
    await expect(filter).toBeFocused()
    // From its button, the keyboard reaches the tickboxes; Escape returns to the button.
    const sourcesButton = dock.getByTestId('engine-logs-sources-button')
    await sourcesButton.focus()
    await page.keyboard.press('Enter')
    await expect(sources).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(sources.getByRole('checkbox', { name: 'Engine' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect(sources.getByRole('checkbox', { name: 'Engine' })).toBeChecked()
    await expect(sources).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sources).toBeHidden()
    await expect(sourcesButton).toBeFocused()
    // A press outside closes it.
    await sourcesButton.click()
    await expect(sources).toBeVisible()
    await log.click()
    await expect(sources).toBeHidden()
  })
})

test.describe('with SQL queries and performance timings logged', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'enso-engine-log-settings',
        JSON.stringify({ state: { sqlQueries: true, performanceTimings: true }, version: 1 }),
      )
    })
  })

  test('opening a project asks its engine for both', async ({ drivePage, localApi }) => {
    const calls = localApi.trackCalls()
    await drivePage.driveTable.openProject('Mock Project').expectProjectEditorOpened('Mock Project')
    expect(calls.openProject.at(-1)).toMatchObject({
      engineLogging: { sqlQueries: true, performanceTimings: true },
    })
  })

  test('the Logs tab has SQL queries and Performance sources, ticked', async ({ editorPage }) => {
    await editorPage.do(async (page) => {
      await page.keyboard.press('ControlOrMeta+L')
      const dock = locate.bottomDock(page)
      const log = dock.getByRole('log')
      const sources = await openSources(page)
      const sql = sources.getByRole('checkbox', { name: 'SQL queries' })
      const performance = sources.getByRole('checkbox', { name: 'Performance' })
      await expect(sql).toBeChecked()
      await expect(performance).toBeChecked()
      await expect(log.getByText('query: SELECT 1')).toBeVisible()
      // DEBUG, shown at All levels.
      await expect(log.getByText('~12ms')).toBeVisible()

      // Not Libraries.
      await sources.getByRole('checkbox', { name: 'Libraries' }).uncheck()
      await expect(log.getByText('Slow query')).toBeHidden()
      await expect(log.getByText('query: SELECT 1')).toBeVisible()
      await sql.uncheck()
      await expect(log.getByText('query: SELECT 1')).toBeHidden()
      await expect(log.getByText('~12ms')).toBeVisible()
      await performance.uncheck()
      await expect(log.getByText('~12ms')).toBeHidden()
    })
  })
})

test('the SQL queries and Performance sources are not offered while their settings are off', async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const sources = await openSources(page)
    await expect(sources.getByRole('checkbox', { name: 'User log messages' })).toBeVisible()
    await expect(sources.getByRole('checkbox', { name: 'SQL queries' })).toHaveCount(0)
    await expect(sources.getByRole('checkbox', { name: 'Performance' })).toHaveCount(0)
  })
})

test("the Logs tab downloads the session's log file", async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const dock = locate.bottomDock(page)
    await expect(dock.getByRole('log').getByText('Something failed')).toBeVisible()
    // The browser build has no file manager to reveal the file in.
    await expect(dock.getByTestId('engine-logs-reveal')).toHaveCount(0)
    const downloading = page.waitForEvent('download')
    await dock.getByRole('button', { name: 'Download log file' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('mock-session.log')
    const content = await fs.readFile(await download.path(), 'utf8')
    expect(content).toContain('Something failed')
    expect(content).not.toContain(STDERR)
  })
})

test('the Logs tab counts unseen errors while the Code tab shows', async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+`')
    const dock = locate.bottomDock(page)
    await expect(dock.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    const logsTab = dock.getByRole('tab', { name: /Logs/ })
    // The ERROR entry; the stderr line is not counted.
    await expect(logsTab.getByTestId('logs-badge')).toHaveText('1')
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
    // Picking the tab hands the keyboard to the code editor.
    await expect(codeEditor.locator('.cm-content')).toBeFocused()
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

test('while the dock is closed, a Code and a Logs button open it on their tab', async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    const buttons = page.getByTestId('bottomDockButtons')
    const dock = locate.bottomDock(page)
    const codeButton = buttons.getByTestId('action:graph.toggleCodeEditor')
    const logsButton = buttons.getByTestId('action:graph.toggleLogs')
    await expect(codeButton).toHaveAccessibleName(/^Code Editor \(.+`\)$/)
    // The ERROR entry has not been seen (stderr is not counted).
    await expect(buttons.getByTestId('logs-error-dot')).toBeVisible()
    // The dot is decorative; the count is in the button's name.
    await expect(logsButton).toHaveAccessibleName(/^Engine Logs, 1 new error \(.+L\)$/)
    // Side by side in a row, Code first.
    const codeBox = await box(codeButton)
    const logsBox = await box(logsButton)
    expect(logsBox.y).toBe(codeBox.y)
    expect(logsBox.x).toBeGreaterThanOrEqual(codeBox.right)

    await logsButton.click()
    await expect(dock.getByRole('tab', { name: /Logs/ })).toHaveAttribute('aria-selected', 'true')
    await expect(buttons).toBeHidden()
    // The keyboard goes to the tab the button opened...
    await expect(dock.getByRole('tab', { name: /Logs/ })).toBeFocused()

    await dock.getByTestId('action:panel.close').click()
    await expect(dock).toBeHidden()
    // ...and back to the button when the dock closes.
    await expect(logsButton).toBeFocused()
    // Seen while the Logs tab showed.
    await expect(buttons.getByTestId('logs-error-dot')).toBeHidden()

    await codeButton.click()
    await expect(dock.getByRole('tab', { name: 'Code' })).toHaveAttribute('aria-selected', 'true')
    await expect(locate.codeEditor(page)).toBeVisible()
  })
})

test('each tab’s shortcut opens the dock there, switches to it, or closes the dock', async ({
  editorPage,
}) => {
  await editorPage.do(async (page) => {
    const dock = locate.bottomDock(page)
    const codeEditor = locate.codeEditor(page)
    const selected = (name: string | RegExp) =>
      expect(dock.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ControlOrMeta+L')
    await selected(/Logs/)
    await expect(dock.getByRole('log').getByText('Something failed')).toBeVisible()

    // Switching to Code gives the code editor the keyboard, as a click on its tab does.
    await page.keyboard.press('ControlOrMeta+`')
    await selected('Code')
    await expect(codeEditor.locator('.cm-content')).toBeFocused()

    await page.keyboard.press('ControlOrMeta+L')
    await selected(/Logs/)
    await page.keyboard.press('ControlOrMeta+L')
    await expect(dock).toBeHidden()

    // The Code shortcut opens on Code, though Logs showed last.
    await page.keyboard.press('ControlOrMeta+`')
    await selected('Code')
    // Opening on Code mounts the editor, which takes the keyboard.
    await expect(codeEditor.locator('.cm-content')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+`')
    await expect(dock).toBeHidden()
    // The keyboard was in the code editor: it goes to the Code button, not the page.
    await expect(
      page.getByTestId('bottomDockButtons').getByTestId('action:graph.toggleCodeEditor'),
    ).toBeFocused()
  })
})

test('the dock header’s fullscreen and close buttons', async ({ editorPage }) => {
  await editorPage.do(async (page) => {
    await page.keyboard.press('ControlOrMeta+L')
    const dock = locate.bottomDock(page)
    await expect(dock).toBeVisible()
    const heightBefore = (await dock.boundingBox())!.height
    const viewportHeight = page.viewportSize()!.height
    const tabs = page.getByRole('tablist', { name: 'Bottom panel' })
    // Docked, nothing sits below the dock: it ends at the bottom of the graph editor and window.
    expect((await box(dock)).bottom).toBe((await box(locate.graphEditor(page))).bottom)
    expect((await box(dock)).bottom).toBe(viewportHeight)

    await locate.enterFullscreenButton(dock).click()
    await expect(locate.exitFullscreenButton(page)).toBeVisible()
    // The whole dock, header and all, fills the editor area.
    await expect
      .poll(async () => (await page.getByRole('log').boundingBox())?.height ?? 0)
      .toBeGreaterThan(heightBefore)
    await expect(page.getByRole('log').getByText('Something failed')).toBeVisible()
    // ...below the app's top bar, which stays in view: the header is not underneath it.
    const appBar = await box(page.locator('.TabBar'))
    await expect.poll(async () => (await box(tabs)).y).toBe((await box(locate.graphEditor(page))).y)
    expect((await box(tabs)).y).toBeGreaterThanOrEqual(appBar.bottom)
    expect((await box(locate.exitFullscreenButton(page))).y).toBeGreaterThanOrEqual(appBar.bottom)
    await expect(page.locator('.TabBar')).toBeVisible()
    // ...and down to the bottom of the window.
    expect((await box(page.getByRole('log'))).bottom).toBeLessThanOrEqual(viewportHeight)
    expect((await box(page.locator('.dockLayout'))).bottom).toBe(viewportHeight)

    await locate.exitFullscreenButton(page).click()
    await expect(locate.enterFullscreenButton(dock)).toBeVisible()

    await dock.getByTestId('action:panel.close').click()
    await expect(dock).toBeHidden()
    await expect(page.getByTestId('bottomDockButtons')).toBeVisible()
  })
})
