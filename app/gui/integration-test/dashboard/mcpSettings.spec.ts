/**
 * @file Settings → AI → External agents, against the mocked `window.api.mcp`: the switch starts
 * off, turning it on shows the address, and a setup button asks Electron main to copy that client's
 * setup.
 */
import { expect, test } from 'integration-test/base'
import { TEXT } from '../actions'
import { expectScreenshot } from '../screenshot'

test('turning the server on shows its address, and a setup button copies that client', async ({
  page,
  drivePage,
}) => {
  await drivePage.goToPage.settings()
  await page.getByRole('button', { name: TEXT.aiSettingsTab }).getByText(TEXT.aiSettingsTab).click()
  const section = page.getByTestId('mcp-settings-section')
  await expect(section.getByLabel(TEXT.mcpEnabledSetting)).not.toBeChecked()
  await expect(section).toContainText(TEXT.mcpWarning)
  await expect(section).not.toContainText('http://127.0.0.1:39417/mcp')

  // The input is visually hidden; its label is what a user presses.
  await section.getByText(TEXT.mcpEnabledSetting, { exact: true }).click()
  await expect(section.getByLabel(TEXT.mcpEnabledSetting)).toBeChecked()
  await expect(section.getByTestId('mcp-address')).toHaveText('http://127.0.0.1:39417/mcp')
  await expectScreenshot(section, 'mcp-settings-enabled.png')

  await section.getByRole('button', { name: TEXT.mcpClientJson }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mcpCopied?: string }).__mcpCopied))
    .toBe('json')
})
