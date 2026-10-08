/** @file The user groups settings tab's "Add Users" popover (#191, #207): Escape. */
import { expect, test } from 'integration-test/base'

import { Plan } from 'enso-common/src/services/Backend'
import { TEXT } from '../actions'

test.use({
  setupApi: {
    cloud: (cloudApi) => {
      cloudApi.setPlan(Plan.team)
      cloudApi.addUserGroup('Analysts')
      cloudApi.addUser('member')
    },
  },
})

test('"Add Users": Escape closes the list, and a second one at once the popover', async ({
  drivePage,
}) => {
  await drivePage.goToCategory
    .cloud()
    .goToPage.settings()
    .goToSettingsTab.userGroups()
    .do(async (page) => {
      await page
        .getByRole('row')
        .filter({ hasText: 'Analysts' })
        .getByRole('button', { name: TEXT.manageUsers })
        .click()
      await page.getByRole('button', { name: TEXT.addUsers }).click()
      const popover = page.getByRole('dialog')
      const comboBox = popover.getByRole('combobox')
      await comboBox.click()
      await comboBox.press('ArrowDown')
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(comboBox).toHaveAttribute('aria-expanded', 'false')
      await expect(popover).toBeVisible()
      // Pressed while the list is still fading out.
      await page.keyboard.press('Escape')
      await expect(popover).toHaveCount(0)
      await expect(page.getByRole('button', { name: TEXT.addUsers })).toBeFocused()
    })
})
