/** @file Test the user menu. */
import { expect, test, type Page } from 'integration-test/base'

import { TEXT } from '../actions'

test('user menu', async ({ drivePage }) => {
  await drivePage.openUserMenu().do(async (thePage) => {
    await expect(thePage.getByLabel(TEXT.userMenuLabel).locator('visible=true')).toBeVisible()
  })
})

const userMenuEntries = (page: Page) =>
  page.getByTestId('user-menu').getByRole('button').allInnerTexts()

test.describe('local mode', () => {
  test('no "Upgrade Plan" or "Logout"', async ({ drivePage, page }) => {
    // The app runs on an offline stand-in session, with no cloud account.
    await drivePage
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
