/**
 * @file The settings page in the IDE, which is always local-only: the app runs as the offline
 * stand-in user, and there is no remote configuration. The page opens on the Local tab, and has no
 * Account tab. The suite-wide `cloudRequests` fixture fails any test that asks Enso Cloud for
 * anything.
 */
import { expect, test, type Page } from 'integration-test/base'
import { railButton, TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

const settingsPanel = (page: Page) => page.getByTestId('settings-panel')
const sidebarTab = (page: Page, name: string) =>
  settingsPanel(page).locator('aside').getByRole('button', { name, exact: true })
const sectionHeadings = (page: Page) => settingsPanel(page).locator('main h2')

test('settings open on the Local tab', async ({ drivePage, page }) => {
  await drivePage

  await BaseActions.press(page, 'Mod+,')
  await expect(settingsPanel(page)).toBeVisible()

  // The personal tabs, and none of the cloud's, and no Account.
  await expect(settingsPanel(page).locator('aside').getByRole('button')).toHaveText([
    TEXT.localSettingsTab,
    TEXT.appearanceSettingsTab,
    TEXT.keyboardShortcutsSettingsTab,
  ])
  await expect(sidebarTab(page, TEXT.localSettingsTab)).toHaveClass(/bg-white/)

  // The Local tab: the directories, and none of the cloud account's sections.
  await expect(sectionHeadings(page)).toHaveText([
    TEXT.localSettingsSection,
    TEXT.localVersionsSettingsSection,
    TEXT.engineSettingsSection,
    TEXT.engineLogsSettingsSection,
    TEXT.mapsSettingsSection,
  ])
  await expect(
    settingsPanel(page).getByRole('textbox', { name: TEXT.localRootPathSettingsInput }),
  ).toBeVisible()
  await expect(settingsPanel(page).locator('input[type="file"]')).toHaveCount(0)
  await expect(settingsPanel(page).getByText(TEXT.dangerZone)).toHaveCount(0)

  // The other tabs work as ever.
  await sidebarTab(page, TEXT.appearanceSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.codeSettingsSection])
  await sidebarTab(page, TEXT.keyboardShortcutsSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.keyboardShortcutsSettingsSection])
  await sidebarTab(page, TEXT.localSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveCount(4)
})

test('the rail has Settings and About buttons, and Settings opens the Local tab', async ({
  drivePage,
  page,
}) => {
  await drivePage

  // The buttons are the only controls of the footer: no avatar, notifications or offline notice.
  await expect(railButton(page, TEXT.aboutThisAppShortcut)).toBeVisible()
  await expect(page.getByText(TEXT.offlineUserName)).toHaveCount(0)
  await railButton(page, TEXT.settingsShortcut).click()
  await expect(settingsPanel(page)).toBeVisible()
  await expect(sidebarTab(page, TEXT.localSettingsTab)).toHaveClass(/bg-white/)
})
