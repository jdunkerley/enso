/**
 * @file Resizing the drive table's columns: by dragging a heading's right edge, by keyboard on that
 * edge's separator, and back to the default by a double click; the widths survive a reload and are
 * the same in every category.
 */
import { expect, test, waitForAppLoaded, type Locator, type Page } from 'integration-test/base'
import { parkMouse, TEXT } from '../actions/utilities'

/** The default width of the Modified column (`COLUMN_WIDTH_LIMITS` in `columnUtils.ts`). */
const MODIFIED_DEFAULT_PX = 133
/** The narrowest the Modified column may be. */
const MODIFIED_MIN_PX = 128
/** The narrowest the Name column may be. */
const NAME_MIN_PX = 192

test.use({
  setupApi: {
    local: (api) => {
      api.addRootDirectory('a folder')
      api.addRootFile('a file.csv')
    },
  },
})

function locateHandle(page: Page, columnName: string) {
  return page
    .getByTestId('drive-view')
    .getByRole('separator', { name: TEXT.resizeColumnX.replace('$0', columnName) })
}

/** The heading cell a handle sits in. */
function headingOf(handle: Locator) {
  return handle.locator('xpath=..')
}

/** The rendered width of the column whose handle this is. */
async function columnWidth(handle: Locator) {
  const box = await headingOf(handle).boundingBox()
  expect(box).not.toBeNull()
  return Math.round(box!.width)
}

/** Expect the column to be drawn at this width, give or take a pixel of rounding. */
async function expectColumnWidth(handle: Locator, width: number) {
  await expect.poll(() => columnWidth(handle)).toBeGreaterThanOrEqual(width - 1)
  await expect.poll(() => columnWidth(handle)).toBeLessThanOrEqual(width + 1)
}

/** Drag a handle sideways by `dx` pixels with the mouse. */
async function dragHandle(page: Page, handle: Locator, dx: number) {
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y, { steps: 4 })
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

test('a column resizes by dragging the right edge of its heading, and keeps its width after a reload', async ({
  page,
  drivePage,
}) => {
  await drivePage.goToCategory.local()
  const modified = locateHandle(page, TEXT.modifiedColumnName)
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX)
  await expect(modified).toHaveAttribute('aria-orientation', 'vertical')
  await expect(modified).toHaveAttribute('aria-valuemin', String(MODIFIED_MIN_PX))

  await dragHandle(page, modified, 60)
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX + 60)
  await expect(modified).toHaveAttribute('aria-valuenow', String(MODIFIED_DEFAULT_PX + 60))

  await page.reload()
  await waitForAppLoaded(page)
  await expectColumnWidth(locateHandle(page, TEXT.modifiedColumnName), MODIFIED_DEFAULT_PX + 60)
})

test('a double click on the edge resets the column to its default width', async ({
  page,
  drivePage,
}) => {
  await drivePage.goToCategory.local()
  const modified = locateHandle(page, TEXT.modifiedColumnName)
  await dragHandle(page, modified, 80)
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX + 80)
  await modified.dblclick()
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX)
})

test('a column resizes with the arrow keys on its edge, and resets with Enter and Home', async ({
  page,
  drivePage,
}) => {
  await drivePage.goToCategory.local()
  const modified = locateHandle(page, TEXT.modifiedColumnName)
  await modified.focus()
  await page.keyboard.press('ArrowRight')
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX + 10)
  await page.keyboard.press('Shift+ArrowRight')
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX + 60)
  await page.keyboard.press('ArrowLeft')
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX + 50)
  await page.keyboard.press('Enter')
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Home')
  await expectColumnWidth(modified, MODIFIED_DEFAULT_PX)
  // The keys resized the column, and neither selected nor opened a row.
  await expect(modified).toBeFocused()
  await expect(page.getByRole('row', { selected: true })).toHaveCount(0)
})

test('a column stops at its narrowest width', async ({ page, drivePage }) => {
  await drivePage.goToCategory.local()
  const modified = locateHandle(page, TEXT.modifiedColumnName)
  await dragHandle(page, modified, -200)
  await expectColumnWidth(modified, MODIFIED_MIN_PX)
  // The heading's label still shows.
  await expect(headingOf(modified).getByText(TEXT.modifiedColumnName)).toBeVisible()
})

test('a drag that ends over a row does not select it', async ({ page, drivePage }) => {
  await drivePage.goToCategory.local()
  const modified = locateHandle(page, TEXT.modifiedColumnName)
  const box = await modified.boundingBox()
  const row = page.getByTestId('asset-row').filter({ hasText: 'a folder' })
  const rowBox = await row.boundingBox()
  expect(box).not.toBeNull()
  expect(rowBox).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 40, rowBox!.y + rowBox!.height / 2, { steps: 8 })
  await page.mouse.up()
  await parkMouse(page)
  await expect(page.getByRole('row', { selected: true })).toHaveCount(0)
  await expect(modified).toHaveAttribute('aria-valuenow', String(MODIFIED_DEFAULT_PX + 40))
})

test('the name column fills the space until it is resized, and fills again once reset', async ({
  page,
  drivePage,
}) => {
  await drivePage.goToCategory.local()
  const name = locateHandle(page, TEXT.nameColumnName)
  const filling = await columnWidth(name)
  expect(filling).toBeGreaterThan(NAME_MIN_PX + 100)
  await dragHandle(page, name, -100)
  await expectColumnWidth(name, filling - 100)
  await dragHandle(page, name, -10_000)
  await expectColumnWidth(name, NAME_MIN_PX)
  await name.dblclick()
  await expectColumnWidth(name, filling)
})

test('the widths are the same in every category', async ({ page, drivePage }) => {
  await drivePage.goToCategory.local()
  await dragHandle(page, locateHandle(page, TEXT.modifiedColumnName), 50)
  await drivePage.goToCategory.localRecent()
  await expectColumnWidth(locateHandle(page, TEXT.modifiedColumnName), MODIFIED_DEFAULT_PX + 50)
})
