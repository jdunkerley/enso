/**
 * @file Settings → Local → Engine: the "Pre-start the engine" switch, sent to the project service
 * on load and on change. With `PR_SCREENSHOT_DIR` set, the test also saves the settings panel for
 * the PR.
 */
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'
import BaseActions from '../actions/BaseActions'

const settingsPanel = (page: Page) => page.getByTestId('settings-panel')
const sectionHeadings = (page: Page) => settingsPanel(page).locator('main h2')

async function screenshot(page: Page, name: string) {
  const dir = process.env.PR_SCREENSHOT_DIR
  if (dir) await settingsPanel(page).screenshot({ path: `${dir}/${name}.png` })
}

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
  await screenshot(page, 'engine-section')
  // The input is visually hidden; its label is what a user presses.
  await settingsPanel(page).getByText(TEXT.preStartEngineSetting, { exact: true }).click()
  await expect.poll(() => localApi.spareEngine.requests).toEqual([true, false])
})
