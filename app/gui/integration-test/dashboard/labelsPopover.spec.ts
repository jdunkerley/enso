/** @file The drive's labels popover (#198, #207): where it opens from the context menu. */
import { expect, test } from 'integration-test/base'

import { COLORS } from 'enso-common/src/services/Backend'

const LABEL_NAME = 'a label'

test.use({
  setupApi: {
    cloud: (cloudApi) => {
      cloudApi.addLabel(LABEL_NAME, COLORS[0])
      cloudApi.addDirectory({ title: 'a folder' })
    },
  },
})

test('"Label" in the context menu opens the popover under the row', async ({ drivePage }) => {
  await drivePage.goToCategory
    .cloud()
    .driveTable.rightClickRow(0)
    .contextMenu.label()
    .do(async (page) => {
      const popover = page.getByRole('dialog').filter({ hasText: LABEL_NAME })
      await expect(popover).toBeVisible()
      const row = page.getByTestId('asset-row').first()
      const rowBox = (await row.boundingBox())!
      // Once its entry animation has settled.
      await expect
        .poll(async () => (await popover.boundingBox())?.y)
        .toBeGreaterThanOrEqual(rowBox.y + rowBox.height)
      const popoverBox = (await popover.boundingBox())!
      // Just under the row, at its start: not at the window's top-left corner.
      expect(popoverBox.y).toBeLessThan(rowBox.y + rowBox.height + 24)
      expect(Math.abs(popoverBox.x - rowBox.x)).toBeLessThan(24)
    })
    .press('Escape')
    .do(async (page) => {
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('asset-row').first()).toBeFocused()
    })
})
