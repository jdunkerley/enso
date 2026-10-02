/** @file Test the user menu. */
import { expect, test, type Page } from 'integration-test/base'

import { TEXT } from '../actions'

test('user menu', async ({ drivePage }) => {
  await drivePage.openUserMenu().do(async (thePage) => {
    await expect(thePage.getByLabel(TEXT.userMenuLabel).locator('visible=true')).toBeVisible()
  })
})

test.describe(() => {
  test.use({ featureFlags: { enableLocalBackend: false } })
  test('download app', async ({ drivePage }) => {
    await drivePage.openUserMenu().userMenu.downloadApp(async (download) => {
      await download.cancel()
      expect(download.url()).toMatch(/^https:[/][/]objects.githubusercontent.com/)
    })
  })
})

const userMenuEntries = (page: Page) =>
  page.getByTestId('user-menu').getByRole('button').allInnerTexts()

test('signed in to the cloud: "Upgrade Plan" and "Logout"', async ({ drivePage, page }) => {
  await drivePage.openUserMenu()
  const entries = (await userMenuEntries(page)).join('\n')
  expect(entries).toContain(TEXT.upgradePlanShortcut)
  expect(entries).toContain(TEXT.signOutShortcut)
})

test.describe('local mode', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test('no "Upgrade Plan" or "Logout"', async ({ loginPage, page }) => {
    // Without Cognito in the remote configuration, authentication is disabled: the app runs on an
    // offline stand-in session, with no cloud account.
    await page.route('**/utils/config', (route) =>
      route.fulfill({ json: { ENSO_IDE_API_URL: 'https://mock/' } }),
    )
    await loginPage
    await page.reload()
    await expect(page.getByTestId('drive-view')).toBeVisible()
    await page.getByLabel(TEXT.userMenuLabel).locator('visible=true').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    const entries = (await userMenuEntries(page)).join('\n')
    expect(entries).toContain(TEXT.settingsShortcut)
    expect(entries).toContain(TEXT.aboutThisAppShortcut)
    expect(entries).not.toContain(TEXT.upgradePlanShortcut)
    expect(entries).not.toContain(TEXT.signOutShortcut)
  })
})
