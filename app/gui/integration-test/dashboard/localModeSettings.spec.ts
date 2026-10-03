/**
 * @file The settings page in local-only mode: no Enso Cloud is configured (the remote configuration
 * carries no Cognito settings), so authentication is disabled and the app runs as the offline
 * stand-in user. The page opens, the Account tab shows the offline user, and nothing asks Enso
 * Cloud for anything.
 */
import { expect, test, type Page } from 'integration-test/base'
import { registerMocks } from 'integration-test/mock/registerMocks'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

/** The mocked Enso Cloud API (`mock/cloudApi.ts`). */
const CLOUD_API_URL = 'https://mock/'
/** The remote configuration, the one request local-only mode makes, to learn that it is local-only. */
const CONFIGURATION_URL = `${CLOUD_API_URL}utils/config`

// Local-only mode has no session to restore: start from nothing, as a fresh install would.
test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Open the app in local-only mode: a remote configuration with no Cognito settings. Returns every
 * request made to Enso Cloud or Cognito after the configuration, as it is made.
 */
async function openLocalOnly(page: Page, appConfig: Record<string, string | undefined>) {
  await registerMocks(page, {}, { appConfig })
  // Registered after the cloud mocks, so it takes precedence over their configuration.
  await page.route(CONFIGURATION_URL, (route) => route.fulfill({ json: {} }))
  const cloudRequests: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    const { hostname } = new URL(url)
    const isCloud =
      url.startsWith(CLOUD_API_URL) || /cognito|amazonaws/.test(hostname) || hostname === 'mock'
    if (isCloud && url !== CONFIGURATION_URL) {
      cloudRequests.push(`${request.method()} ${url}`)
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('drive-view')).toBeVisible()
  return cloudRequests
}

const settingsPanel = (page: Page) => page.getByTestId('settings-panel')
const sidebarTab = (page: Page, name: string) =>
  settingsPanel(page).locator('aside').getByRole('button', { name, exact: true })
const sectionHeadings = (page: Page) => settingsPanel(page).locator('main h2')

test('settings open on the offline user, and ask nothing of the cloud', async ({
  page,
  cloudApi,
  localApi,
  appConfig,
}) => {
  // Only make sure that the API mocks are registered, so that any cloud request is answered.
  const _ = { cloudApi, localApi }
  const cloudRequests = await openLocalOnly(page, appConfig)

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
  await expect(sectionHeadings(page)).toHaveText([TEXT.localSettingsSection])
  await expect(
    settingsPanel(page).getByRole('textbox', { name: TEXT.localRootPathSettingsInput }),
  ).toBeVisible()
  await sidebarTab(page, TEXT.appearanceSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.codeSettingsSection])
  await sidebarTab(page, TEXT.keyboardShortcutsSettingsTab).click()
  await expect(sectionHeadings(page)).toHaveText([TEXT.keyboardShortcutsSettingsSection])
  await sidebarTab(page, TEXT.accountSettingsTab).click()
  await expect(page.getByTestId('offline-user-settings')).toBeVisible()

  expect(cloudRequests).toEqual([])
})

test('the user menu shows the offline user, and opens the same settings', async ({
  page,
  cloudApi,
  localApi,
  appConfig,
}) => {
  const _ = { cloudApi, localApi }
  const cloudRequests = await openLocalOnly(page, appConfig)

  await page.getByRole('button', { name: TEXT.userMenuLabel }).click()
  const menu = page.getByTestId('user-menu')
  await expect(menu).toContainText(TEXT.offlineUserName)
  await menu.getByRole('button', { name: TEXT.settingsShortcut }).click()
  await expect(page.getByTestId('offline-user-settings')).toBeVisible()

  expect(cloudRequests).toEqual([])
})
