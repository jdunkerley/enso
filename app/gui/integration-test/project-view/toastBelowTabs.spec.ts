/**
 * @file A toast at the top centre of the window lies below the top bar, so it never covers the
 * project tabs (#636). With `PR_SCREENSHOT_DIR` set, the window is also saved for the PR.
 */
import { expect, test } from 'integration-test/base'
import { restoreMockMainFile, setMockLibraryLoadFailures } from 'integration-test/mock/lsHandler'

test.afterEach(restoreMockMainFile)

test.use({
  viewport: { width: 1400, height: 800 },
  setupApi: {
    local: () =>
      setMockLibraryLoadFailures(
        [
          {
            library: 'Acme.Widgets',
            version: null,
            kind: 'DownloadFailed',
            message: 'Server responded with HTTP 502\n'.repeat(8),
          },
        ],
        {
          current: '2026.1.1-dev',
          target: '2026.1.1-dev',
          resolves: false,
          changes: [],
          stillMissing: ['Acme.Widgets'],
        },
      ),
  },
})

test('a lasting toast does not cover the tabs, which stay clickable', async ({
  page,
  editorPage,
}) => {
  await editorPage
  // A second tab, next to the project's.
  await page.keyboard.press('ControlOrMeta+,')
  const projectTab = page.getByRole('tab', { name: 'Mock Project' })
  const settingsTab = page.getByRole('tab', { name: 'Settings' })
  await expect(settingsTab).toHaveClass(/selected/)
  await projectTab.click()
  const toast = page.getByTestId('toast').first()
  await expect(toast).toBeVisible()
  // The toast slides in from above the window.
  await toast.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )
  const dir = process.env.PR_SCREENSHOT_DIR
  if (dir) await page.screenshot({ path: `${dir}/toast-and-tabs.png` })
  const tabs = await page.locator('.TabBar').boundingBox()
  const toastBox = await toast.boundingBox()
  expect(tabs).not.toBeNull()
  expect(toastBox).not.toBeNull()
  expect(toastBox!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height)
  // Both tabs can be clicked while the toast shows.
  await settingsTab.click()
  await expect(settingsTab).toHaveClass(/selected/)
  await projectTab.click()
  await expect(projectTab).toHaveClass(/selected/)
  await expect(toast).toBeVisible()
})
