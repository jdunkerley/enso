/**
 * @file The graph pane's loading spinner while a project opens.
 *
 * `WithCurrentProject`'s `loading` slot shows a `Loader` in place of the graph editor while the
 * project's opening or restoring process runs. The pane shows it whenever the project's tab is the
 * current one before the project is ready: when the user selects the tab of a project that is still
 * opening (a fresh open selects the tab only once the project has opened, see `openProjectTab`),
 * and when the app restores the project it had open. The mocked open request is held back, so
 * that the opening lasts long enough to look at.
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

test('Selecting the tab of a project that is still opening shows the spinner', async ({
  drivePage,
  page,
}) => {
  await delayProjectOpening(page)
  await drivePage.driveTable.openProject('Mock Project')
  const tab = page.getByTestId('project-view-tab-button')
  await expect(tab).toBeVisible()
  await tab.click()
  await expectLoadingSpinner(page)
  await expectGraphAfterLoading(page)
})

test('Restoring the open project on reload shows the spinner', async ({ editorPage, page }) => {
  await editorPage
  await delayProjectOpening(page)
  await page.reload()
  await expectLoadingSpinner(page)
  await expectGraphAfterLoading(page)
})
