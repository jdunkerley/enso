/**
 * @file Settings → Local → Engine: the "Pre-start the engine" switch, shown only when the project
 * service says projects get the JVM engine, and sent to it on load and on change. With
 * `PR_SCREENSHOT_DIR` set, each test also saves the settings panel for the PR.
 */
import { expect, test, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

const settingsPanel = (page: Page) => page.getByTestId('settings-panel')
const sectionHeadings = (page: Page) => settingsPanel(page).locator('main h2')

async function screenshot(page: Page, name: string) {
  const dir = process.env.PR_SCREENSHOT_DIR
  if (dir) await settingsPanel(page).screenshot({ path: `${dir}/${name}.png` })
}

test('with the native engine there is no Engine section', async ({ drivePage, page, localApi }) => {
  await drivePage
  await expect.poll(() => localApi.spareEngine.requests).toEqual([true])
  await BaseActions.press(page, 'Mod+,')
  await expect(sectionHeadings(page)).toHaveText([
    TEXT.localSettingsSection,
    TEXT.localVersionsSettingsSection,
    TEXT.engineLogsSettingsSection,
    TEXT.mapsSettingsSection,
  ])
  await screenshot(page, 'engine-section-native')
})

test.describe('with the JVM engine', () => {
  test.use({
    setupApi: {
      local: (api: MockLocalApi) => {
        api.spareEngine.engineMode = 'jvm'
      },
    },
  })

  test('the Engine section has the switch, on, and a change is sent', async ({
    drivePage,
    page,
    localApi,
  }) => {
    await drivePage
    await expect.poll(() => localApi.spareEngine.requests).toEqual([true])
    await BaseActions.press(page, 'Mod+,')
    await expect(sectionHeadings(page)).toHaveText([
      TEXT.localSettingsSection,
      TEXT.localVersionsSettingsSection,
      TEXT.engineSettingsSection,
      TEXT.engineLogsSettingsSection,
      TEXT.mapsSettingsSection,
    ])
    const toggle = settingsPanel(page).getByLabel(TEXT.preStartEngineSetting)
    await expect(toggle).toBeChecked()
    await screenshot(page, 'engine-section-jvm')
    // The input is visually hidden; its label is what a user presses.
    await settingsPanel(page).getByText(TEXT.preStartEngineSetting, { exact: true }).click()
    await expect.poll(() => localApi.spareEngine.requests).toEqual([true, false])
  })
})
