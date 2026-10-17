/**
 * @file The IDE is local-only (PR 1 of `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`):
 * it starts on the local drive, with no login, offers no cloud entry points, and asks Enso Cloud
 * for nothing. Every request to the cloud fails here, so one that is made also breaks the app.
 */
import { expect, test, type Page } from 'integration-test/base'
import { registerMocks } from 'integration-test/mock/registerMocks'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

/** The mocked Enso Cloud (`mock/cloudApi.ts`), the real one, and Cognito/Stripe. */
const CLOUD_URL =
  /^https:\/\/(mock\/|api\.cloud\.enso\.org\/|[^/]*(cognito|amazonaws|stripe)[^/]*\/)/

// A fresh install: no saved state.
test.use({ storageState: { cookies: [], origins: [] } })

/** Fail every Enso Cloud request, and record it. */
async function failCloudRequests(page: Page) {
  const requests: string[] = []
  await page.route(CLOUD_URL, async (route) => {
    requests.push(`${route.request().method()} ${route.request().url()}`)
    await route.abort('failed')
  })
  return requests
}

test('starts on the local drive with no login, and asks Enso Cloud for nothing', async ({
  page,
  localApi,
  appConfig,
}) => {
  // Only the local mock: the cloud mock is not registered, so nothing answers a cloud request.
  const _ = { localApi }
  await registerMocks(page, {}, { appConfig })
  const cloudRequests = await failCloudRequests(page)
  await page.goto('/')

  const drive = page.getByTestId('drive-view')
  await expect(drive).toBeVisible()
  await expect(drive).toHaveAttribute('data-category', 'local')
  await expect(page.getByPlaceholder(TEXT.emailPlaceholder)).toHaveCount(0)
  await expect(page.getByTestId('agreements-modal')).toHaveCount(0)

  const categories = page.locator('.LeftPanel .leftBar .categories')
  for (const name of ['Cloud', 'Trash']) {
    await expect(categories.getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(categories.getByRole('button', { name: 'Local', exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: TEXT.newSecret })).toHaveCount(0)
  await expect(page.getByRole('button', { name: TEXT.newCredential })).toHaveCount(0)

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

  expect(cloudRequests).toEqual([])
})
