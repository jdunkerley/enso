/** @file Test the Settings and About buttons at the bottom of the left rail. */
import { expect, test } from 'integration-test/base'

import { railButton, TEXT } from '../actions'

test('the rail has Settings and About buttons', async ({ drivePage, page }) => {
  await drivePage
  await expect(page.getByTestId('drive-view')).toBeVisible()
  await expect(railButton(page, TEXT.settingsShortcut)).toBeVisible()
  await expect(railButton(page, TEXT.aboutThisAppShortcut)).toBeVisible()
})

test.describe('local mode', () => {
  test('no "Upgrade Plan" or "Logout", and no menu', async ({ drivePage, page }) => {
    // The app runs on an offline stand-in session, with no cloud account.
    await drivePage
    await expect(page.getByTestId('drive-view')).toBeVisible()
    await expect(page.getByTestId('user-menu')).toHaveCount(0)
    await expect(page.getByText('Upgrade Plan')).toHaveCount(0)
    await expect(page.getByText('Logout')).toHaveCount(0)
  })
})

test('About opens the About dialog', async ({ drivePage, page }) => {
  await drivePage
  await railButton(page, TEXT.aboutThisAppShortcut).click()
  await expect(page.getByRole('dialog', { name: TEXT.aboutThisAppShortcut })).toBeVisible()
})
