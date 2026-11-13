/**
 * @file A folder cannot be dropped into itself or into a folder inside it (#644). Holding a dragged
 * folder over itself opens it, and holding on over its subfolder opens that: the drag then carries
 * a folder that contains the shown one, and the `..` entry, the list's background and the rows
 * below must all refuse it.
 */
import { expect, test, type Locator, type Page } from 'integration-test/base'
import { TEXT } from '../actions'

test.use({
  setupApi: {
    addDefaultProject: false,
    // Added before the app loads: a change made once it has loaded is not listed.
    local: (localApi) => {
      const outer = localApi.addRootDirectory('Outer')
      const inner = localApi.addRootDirectory('Inner', { parent: outer })
      localApi.addRootFile('Deep', { parent: inner })
      localApi.addRootFile('Loose')
    },
  },
})

// Holding a drag over a folder takes two seconds to open it, twice over.
test.setTimeout(60_000)

/** Longer than the two seconds a drag is held over a folder to open it. */
const OPEN_TIMEOUT_MS = 6_000

/** The middle of a row's name cell, where a press starts a drag. */
async function rowPoint(row: Locator) {
  const box = await row.boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x + 150, y: box!.y + 16 }
}

/**
 * Pick up `Outer` from the root, hold it over itself until it opens, then over `Inner` until that
 * opens: the pointer is left pressed over the folder `Outer/Inner`, with `Outer` in the drag.
 */
async function dragOuterIntoInner(page: Page, table: Locator) {
  const rows = table.getByTestId('asset-row')
  const outerRow = rows.filter({ hasText: /^Outer/ })
  await outerRow.click()
  const start = await rowPoint(outerRow)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 6, start.y + 3, { steps: 3 })
  await page.mouse.move(start.x, start.y, { steps: 3 })
  await expect(rows.filter({ hasText: /^Inner/ })).toBeVisible({ timeout: OPEN_TIMEOUT_MS })
  const innerPoint = await rowPoint(rows.filter({ hasText: /^Inner/ }))
  await page.mouse.move(innerPoint.x, innerPoint.y, { steps: 5 })
  await expect(rows.filter({ hasText: /^Deep/ })).toBeVisible({ timeout: OPEN_TIMEOUT_MS })
}

test('the parent-folder entry takes no drop of a folder that contains the shown one', async ({
  drivePage,
  localApi,
}) => {
  const calls = localApi.trackCalls()
  await drivePage.goToCategory.local().withAssetsTable(async (table, _context, page) => {
    await dragOuterIntoInner(page, table)
    // The entry opens `Outer`, the folder being dragged.
    const entry = table.getByTestId('parent-directory-row')
    const point = await rowPoint(entry)
    await page.mouse.move(point.x, point.y, { steps: 5 })
    await expect(entry).not.toHaveClass(/selected/)
    await page.mouse.up()
    expect(calls.moveFile).toEqual([])
    // Nothing moved: still in `Inner`, which holds `Deep`.
    await expect(table.getByTestId('asset-row')).toHaveText([/^Deep/])
  })
})

test('the list background takes no drop of a folder that contains the shown one', async ({
  drivePage,
  localApi,
}) => {
  const calls = localApi.trackCalls()
  await drivePage.goToCategory
    .local()
    .withAssetsTable(async (table, _context, page) => {
      await dragOuterIntoInner(page, table)
      const dropzone = page.getByTestId('root-directory-dropzone')
      const box = await dropzone.boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + 40, { steps: 5 })
      await page.mouse.up()
      await expect(page.getByTestId('drive-drag-announcement')).toHaveText(
        TEXT.dragAnnouncementCancelled.replace(
          '$0',
          TEXT.dragAnnouncementOneAsset.replace('$0', 'Outer'),
        ),
      )
      expect(calls.moveFile).toEqual([])
      await expect(table.getByTestId('asset-row')).toHaveText([/^Deep/])
    })
    // Both folders are where they were.
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Outer/, /^Loose/])
    })
})

test('a folder dropped on its own row stays where it was', async ({ drivePage, localApi }) => {
  const calls = localApi.trackCalls()
  await drivePage.goToCategory
    .local()
    .driveTable.dragRowToRow('Outer', 'Outer')
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Outer/, /^Loose/])
    })
  expect(calls.moveFile).toEqual([])
})
