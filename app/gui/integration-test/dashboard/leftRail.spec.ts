/** @file The left rail, which runs the window's full height, over the top bar. */
import { expect, test } from 'integration-test/base'
import { TEXT } from '../actions'
import { parkMouse } from '../actions/utilities'

test('the expanded rail paints above the tab bar, with the drive panel hidden', async ({
  drivePage,
  page,
}) => {
  await drivePage.driveTable
    .openProject('Mock Project')
    .expectProjectEditorOpened('Mock Project')
    .expectNodePositionsInitialized()
  await parkMouse(page)
  // Hide the drive panel: the rail then expands out over the tab bar.
  await page.getByTestId('action:panel.close').locator('visible=true').first().click()
  await expect(page.locator('.LeftPanel .sizeWrapper')).toHaveCount(0)
  await parkMouse(page)
  const rail = page.locator('.leftBar')
  const local = rail.getByRole('button', { name: TEXT.localCategory, exact: true })
  await rail.hover()
  await expect(rail).toHaveClass(/expanded/)
  // The first category is in the strip the tab bar occupies, and it is on top of it: clicking it
  // it is the element hit there, so the pointer stays on the rail and the rail does not collapse.
  await expect(local).toBeVisible()
  const box = await local.boundingBox()
  expect(box).not.toBeNull()
  const topmost = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('.leftBar') != null,
    // Its right end, which is over the tab bar (it starts at the collapsed rail's 48px).
    { x: box!.x + box!.width - 4, y: box!.y + box!.height / 2 },
  )
  expect(topmost).toBe(true)
  expect(box!.x + box!.width - 4).toBeGreaterThan(48)
  await page.screenshot({ path: process.env.SHOT_OUT ?? 'test-results/leftRail.png' })
})
