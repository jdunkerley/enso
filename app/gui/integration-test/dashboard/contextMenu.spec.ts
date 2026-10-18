/** @file Test the drive view. */
import { expect, test, type Page } from 'integration-test/base'

/** Find the context menu. */
function locateContextMenu(page: Page) {
  // This has no identifying features.
  return page.getByTestId('context-menu')
}

test.use({ setupApi: { addDefaultProject: false } })

test('drive view', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.expectPlaceholderRow()
    .withDriveView(async (view) => {
      await view.click({ button: 'right' })
    })
    .do(async (page) => {
      await expect(locateContextMenu(page)).toHaveCount(1)
    })
    .press('Escape')
    .do(async (thePage) => {
      await expect(locateContextMenu(thePage)).toHaveCount(0)
    })
})
