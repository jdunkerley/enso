/**
 * @file The graph pane's loading spinner while a project opens.
 *
 * `WithCurrentProject`'s `loading` slot shows a `Loader` in place of the graph editor while the
 * project's opening or restoring process runs, and its `error` slot a "Failed to open project"
 * result if that fails. Opening a project from the Drive selects its tab straight away (see
 * `openProjectTab`), so the pane shows the spinner just as it does when the app restores the
 * project it had open. The mocked open request is held back, so that the opening lasts long enough
 * to look at.
 */
import type { Page } from 'integration-test/base'
import { expect, test } from 'integration-test/base'
import * as locate from './locate'

const OPEN_DELAY_MS = 4_000

/** Hold back every `project/open` request, then pass it on to the mock. */
async function delayProjectOpening(page: Page) {
  await page.route('/api/project-service/project/open', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS))
    await route.fallback()
  })
}

/** Check that the graph pane shows a visible, sized, animating spinner, and no graph yet. */
async function expectLoadingSpinner(page: Page) {
  const spinner = page.locator('.ProjectView').getByTestId('spinner')
  await expect(spinner).toBeVisible()
  const box = await spinner.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(16)
  expect(box?.height).toBeGreaterThanOrEqual(16)
  // The arc has moved on from the `initial` phase to a loading one, so it animates.
  await expect(spinner.locator('rect')).toHaveClass(/\bdasharray-75\b/)
  await expect(spinner.locator('rect')).toHaveClass(/animate-spin-ease/)
  await expect(locate.graphEditor(page)).toHaveCount(0)
}

/** Check that the spinner gives way to the graph once the project has opened. */
async function expectGraphAfterLoading(page: Page) {
  await expect(locate.graphEditor(page)).toBeVisible()
  await expect(page.locator('.ProjectView').getByTestId('spinner')).toHaveCount(0)
}

test('Opening a project from the Drive shows the spinner in the graph pane', async ({
  drivePage,
  page,
}) => {
  await delayProjectOpening(page)
  await drivePage.driveTable.openProject('Mock Project')
  // The tab is selected while the project is still opening, not once it has opened.
  await expect(page.getByRole('tab', { name: 'Mock Project' })).toHaveClass(/selected/)
  await expectLoadingSpinner(page)
  await expectGraphAfterLoading(page)
})

test('Going back to the tab of a project that is still opening shows the spinner', async ({
  drivePage,
  page,
}) => {
  await delayProjectOpening(page)
  await drivePage.driveTable.openProject('Mock Project')
  await expectLoadingSpinner(page)
  // Away to the Settings tab, which takes the project's place in the middle panel.
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await expect(page.locator('.ProjectView')).toBeHidden()
  const tab = page.getByTestId('project-view-tab-button')
  await expect(tab).toBeVisible()
  await tab.click()
  await expectLoadingSpinner(page)
  await expectGraphAfterLoading(page)
})

test('A project that fails to open shows the failure in the graph pane', async ({
  drivePage,
  page,
}) => {
  await page.route('/api/project-service/project/open', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS))
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, error: { code: 0, message: 'Mock failure' } }),
    })
  })
  await drivePage.driveTable.openProject('Mock Project')
  await expectLoadingSpinner(page)
  const pane = page.locator('.ProjectView')
  await expect(pane.getByText('Failed to open project')).toBeVisible()
  await expect(pane.getByTestId('spinner')).toHaveCount(0)
  await expect(locate.graphEditor(page)).toHaveCount(0)

  const tab = page.getByRole('tab', { name: 'Mock Project' })
  await tab.locator('.CloseButton').click()
  await expect(tab).toHaveCount(0)
  await expect(pane).toHaveCount(0)
})

test('Closing the tab of a project that is still opening leaves it closed', async ({
  drivePage,
  page,
}) => {
  await delayProjectOpening(page)
  await drivePage.driveTable.openProject('Mock Project')
  await expectLoadingSpinner(page)
  const tab = page.getByRole('tab', { name: 'Mock Project' })
  await tab.locator('.CloseButton').click()
  await expect(tab).toHaveCount(0)
  // Once the held-back open request has gone through, the tab still does not come back.
  await page.waitForTimeout(OPEN_DELAY_MS + 1_000)
  await expect(tab).toHaveCount(0)
  await expect(page.locator('.ProjectView')).toHaveCount(0)
})

test('Restoring the open project on reload shows the spinner', async ({ editorPage, page }) => {
  await editorPage
  await delayProjectOpening(page)
  await page.reload()
  await expectLoadingSpinner(page)
  await expectGraphAfterLoading(page)
})
