/**
 * @file The settings page in the IDE, which is always local-only: the app runs as the offline
 * stand-in user, and there is no remote configuration. The page opens and the Account tab shows the
 * offline user. The suite-wide `cloudRequests` fixture fails any test that asks Enso Cloud for
 * anything.
 */
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

const settingsPanel = (page: Page) => page.getByTestId('settings-panel')
const sidebarTab = (page: Page, name: string) =>
  settingsPanel(page).locator('aside').getByRole('button', { name, exact: true })
const sectionHeadings = (page: Page) => settingsPanel(page).locator('main h2')

test('settings open on the offline user', async ({ drivePage, page }) => {
  await drivePage

  await BaseActions.press(page, 'Mod+,')
  await expect(settingsPanel(page).locator('h1').first()).toContainText(TEXT.offlineUserName)

  // The personal tabs, and none of the cloud's.
  await expect(settingsPanel(page).locator('aside').getByRole('button')).toHaveText([
    TEXT.accountSettingsTab,
    TEXT.localSettingsTab,
    TEXT.appearanceSettingsTab,
    TEXT.keyboardShortcutsSettingsTab,
  ])

  // The Account tab: the offline user, and none of the cloud account's sections.
  const offlineUser = page.getByTestId('offline-user-settings')
  await expect(offlineUser).toBeVisible()
  await expect(offlineUser.getByTestId('offline-user-name')).toHaveText(TEXT.offlineUserName)
  await expect(offlineUser).toContainText(TEXT.offlineUserStatus)
  await expect(offlineUser).toContainText(TEXT.offlineUserDescription)
  await expect(sectionHeadings(page)).toHaveText([TEXT.offlineUserSettingsSection])
  await expect(settingsPanel(page).locator('form')).toHaveCount(0)
  await expect(settingsPanel(page).locator('input[type="file"]')).toHaveCount(0)
  await expect(settingsPanel(page).getByText(TEXT.dangerZone)).toHaveCount(0)

  // The other personal tabs work as ever.
  await sidebarTab(page, TEXT.localSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([
    TEXT.localSettingsSection,
    TEXT.localVersionsSettingsSection,
    TEXT.engineLogsSettingsSection,
    TEXT.mapsSettingsSection,
  ])
  await expect(
    settingsPanel(page).getByRole('textbox', { name: TEXT.localRootPathSettingsInput }),
  ).toBeVisible()
  await sidebarTab(page, TEXT.appearanceSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.codeSettingsSection])
  await sidebarTab(page, TEXT.keyboardShortcutsSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.keyboardShortcutsSettingsSection])
  await sidebarTab(page, TEXT.accountSettingsTab).click()
  await expect(page.getByTestId('offline-user-settings')).toBeVisible()
})

test('the user menu shows the offline user, and opens the same settings', async ({
  drivePage,
  page,
}) => {
  await drivePage

  await page.getByRole('button', { name: TEXT.userMenuLabel }).click()
  const menu = page.getByTestId('user-menu')
  await expect(menu).toContainText(TEXT.offlineUserName)
  await menu.getByRole('button', { name: TEXT.settingsShortcut }).click()
  await expect(page.getByTestId('offline-user-settings')).toBeVisible()
})
