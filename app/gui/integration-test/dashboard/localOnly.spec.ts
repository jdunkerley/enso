/**
 * @file The IDE is local-only (PR 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`):
 * it starts on the local drive, with no login, offers no cloud entry points, and asks Enso Cloud
 * for nothing. Every request to the cloud fails here, so one that is made also breaks the app.
 */
import { expect, test } from 'integration-test/base'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

test('starts on the local drive with no login, and asks Enso Cloud for nothing', async ({
  drivePage,
  page,
}) => {
  // The suite-wide `cloudRequests` fixture fails the test on any request to Enso Cloud.
  await drivePage

  const drive = page.getByTestId('drive-view')
  await expect(drive).toBeVisible()
  await expect(drive).toHaveAttribute('data-category', 'local')
  await expect(page.getByTestId('agreements-modal')).toHaveCount(0)

  const categories = page.locator('.LeftPanel .leftBar .categories')
  for (const name of ['Cloud', 'Trash']) {
    await expect(categories.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(categories.getByRole('button', { name: 'Local', exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'New Secret' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New Credential' })).toHaveCount(0)

  await expect(page.getByRole('tab', { name: TEXT.versions })).toBeVisible()
  for (const name of [TEXT.properties, TEXT.executionsCalendar, 'Description']) {
    await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0)
  }

  await page
    .getByTestId('asset-row-name')
    .filter({ hasText: 'Mock Project' })
    .click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await expect(menu).not.toContainText(TEXT.uploadToCloudShortcut)
  await page.keyboard.press('Escape')

  await BaseActions.press(page, 'Mod+,')
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await page
    .getByTestId('settings-panel')
    .locator('aside')
    .getByRole('button', { name: TEXT.localSettingsTab, exact: true })
    .click()
  await expect(page.getByTestId('settings-panel')).toContainText(TEXT.mapsSettingsSection)
})
