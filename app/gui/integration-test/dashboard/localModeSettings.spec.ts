/**
 * @file The settings page in the IDE, which is always local-only: the app runs as the offline
 * stand-in user, and there is no remote configuration. The page opens on the Local tab, and has no
 * Account tab. The suite-wide `cloudRequests` fixture fails any test that asks Enso Cloud for
 * anything.
 */
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'
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

test('the settings cog opens a menu with Settings and About', async ({ drivePage, page }) => {
  await drivePage

  // The cog is the only control of the settings button: no avatar, notifications or offline notice.
  await page.getByRole('button', { name: TEXT.userMenuLabel }).click()
  const menu = page.getByTestId('user-menu')
  await expect(menu).not.toContainText(TEXT.offlineUserName)
  await menu.getByRole('button', { name: TEXT.settingsShortcut }).click()
  await expect(settingsPanel(page)).toBeVisible()
  await expect(sidebarTab(page, TEXT.localSettingsTab)).toHaveClass(/bg-white/)
})
