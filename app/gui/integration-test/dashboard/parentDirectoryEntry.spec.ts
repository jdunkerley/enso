/**
 * @file The drive's parent-folder entry (#640): the `..` row first in a folder's listing below its
 * category's root. A double click or Enter opens the folder above; the arrow keys reach it without
 * selecting it; dropping rows on it moves them up; it is not shown at a category's root (Local's or
 * an added folder's), in Recent, or in search results; a rubber band still starts on the right row
 * when the list is scrolled.
 */
import { expect, test, type Locator } from 'integration-test/base'
import { posix } from 'node:path'
import { TEXT } from '../actions'

test.use({
  setupApi: {
    addDefaultProject: false,
    // Added before the app loads: a change made once it has loaded is not listed.
    local: (localApi) => {
      const outer = localApi.addRootDirectory('Outer')
      localApi.addRootDirectory('Inner', { parent: outer })
      localApi.addRootFile('File', { parent: outer })
      localApi.addRootFile('Loose')
    },
  },
})

/** The first row of the table's body. */
function firstBodyRow(table: Locator) {
  return table.locator('tbody tr').first()
}

test('is shown first inside a folder, not at the root; a double click goes up', async ({
  drivePage,
}) => {
  await drivePage.goToCategory
    .local()
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toHaveCount(0)
    })
    .driveTable.openDirectory('Outer')
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Inner/, /^File/])
    })
    .withAssetsTable(async (table) => {
      const entry = table.getByTestId('parent-directory-row')
      await expect(firstBodyRow(table)).toHaveAttribute('data-testid', 'parent-directory-row')
      await expect(entry).toContainText('..')
      await expect(entry).toHaveAccessibleName(new RegExp(TEXT.parentFolder))
      await expect(entry).not.toHaveAttribute('aria-selected')
      await expect(entry).toHaveAttribute('aria-rowindex', '2')
      await expect(table.getByTestId('asset-row').first()).toHaveAttribute('aria-rowindex', '3')
    })
    // It stays first whatever the sort.
    .driveTable.clickNameColumnHeading()
    .driveTable.clickNameColumnHeading()
    .withAssetsTable(async (table) => {
      await expect(firstBodyRow(table)).toHaveAttribute('data-testid', 'parent-directory-row')
    })
    // A click selects nothing; it has no context menu.
    .driveTable.clickRow('File')
    .withAssetsTable(async (table, _context, page) => {
      const entry = table.getByTestId('parent-directory-row')
      await entry.click({ position: { x: 150, y: 16 } })
      await expect(table.getByRole('row', { selected: true })).toHaveCount(0)
      await entry.click({ button: 'right', position: { x: 150, y: 16 } })
      await expect(page.getByTestId('context-menu')).toHaveCount(0)
    })
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Outer/, /^Loose/])
    })
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toHaveCount(0)
    })
})

test('the arrow keys reach it without selecting it, and Enter opens the parent', async ({
  drivePage,
}) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .driveTable.openDirectory('Inner')
    // An empty folder still says so, below the entry.
    .driveTable.expectPlaceholderRow()
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toBeVisible()
    })
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Inner/, /^File/])
    })
    .driveTable.clickRow('Inner')
    .withAssetsTable(async (table, _context, page) => {
      const entry = table.getByTestId('parent-directory-row')
      const rows = table.getByTestId('asset-row')
      await page.keyboard.press('ArrowUp')
      await expect(entry).toBeFocused()
      await expect(entry).toHaveAttribute('tabindex', '0')
      await expect(table.getByRole('row', { selected: true })).toHaveCount(0)
      // It is the first row: up goes no further.
      await page.keyboard.press('ArrowUp')
      await expect(entry).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(rows.nth(0)).toBeFocused()
      await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true')
      // Shift+ArrowUp does not extend the selection onto the entry.
      await page.keyboard.press('Shift+ArrowUp')
      await expect(rows.nth(0)).toBeFocused()
      await expect(table.getByRole('row', { selected: true })).toHaveCount(1)
      await page.keyboard.press('ArrowUp')
      await expect(entry).toBeFocused()
      await page.keyboard.press('Enter')
    })
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Outer/, /^Loose/])
    })
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toHaveCount(0)
    })
})

test('is not shown in search results', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toBeVisible()
    })
    .withSearchBar(async (searchBar) => {
      await searchBar.fill('File')
    })
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toHaveCount(0)
    })
    .withSearchBar(async (searchBar) => {
      await searchBar.fill('')
    })
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toBeVisible()
    })
})

test('is not shown in Recent', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .goToCategory.localRecent()
    .driveTable.withParentDirectoryRow(async (entry) => {
      await expect(entry).toHaveCount(0)
    })
})

test('dropping rows on it moves them to the parent folder', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .driveTable.dragRowToParentDirectoryRow('File')
    .do(async (page) => {
      await expect(page.getByTestId('drive-drag-announcement')).toHaveText(
        TEXT.dragAnnouncementDroppedIntoParent.replace(
          '$0',
          TEXT.dragAnnouncementOneAsset.replace('$0', 'File'),
        ),
      )
    })
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Inner/])
    })
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.withRows(async (rows) => {
      // The listing's order puts the moved file anywhere: check the set, not the order.
      await expect(rows).toHaveCount(3)
      await expect(rows.filter({ hasText: /^File/ })).toHaveCount(1)
    })
})

test('dropping a folder and a file together moves both up', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .driveTable.clickRow('Inner')
    .withAssetsTable(async (table, _context, page) => {
      const rows = table.getByTestId('asset-row')
      await rows
        .filter({ hasText: /^File/ })
        .click({ position: { x: 150, y: 16 }, modifiers: ['Shift'] })
      await expect(table.getByRole('row', { selected: true })).toHaveCount(2)
      await rows.filter({ hasText: /^Inner/ }).dragTo(table.getByTestId('parent-directory-row'), {
        sourcePosition: { x: 150, y: 16 },
        targetPosition: { x: 150, y: 16 },
      })
      await expect(page.getByTestId('drive-drag-announcement')).toHaveText(
        TEXT.dragAnnouncementDroppedIntoParent.replace(
          '$0',
          TEXT.dragAnnouncementAssets.replace('$0', '2'),
        ),
      )
    })
    .driveTable.expectPlaceholderRow()
    .driveTable.doubleClickParentDirectoryRow()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(4)
      await expect(rows.filter({ hasText: /^Inner/ })).toHaveCount(1)
      await expect(rows.filter({ hasText: /^File/ })).toHaveCount(1)
    })
})

test('Shift+click from the entry selects only the clicked row', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.openDirectory('Outer')
    .withAssetsTable(async (table) => {
      await table.getByTestId('parent-directory-row').click({ position: { x: 150, y: 16 } })
      await table
        .getByTestId('asset-row')
        .filter({ hasText: /^File/ })
        .click({ position: { x: 150, y: 16 }, modifiers: ['Shift'] })
      const selected = table.getByRole('row', { selected: true })
      await expect(selected).toHaveCount(1)
      await expect(selected).toContainText('File')
    })
})

test.describe('an added folder', () => {
  test.beforeEach(async ({ page, localApi }) => {
    const outer = posix.join(localApi.rootPath, 'Outer')
    await page.addInitScript((path) => {
      localStorage.setItem(
        'enso-local-saved-directories',
        JSON.stringify({ state: { localDirectories: [path] }, version: 1 }),
      )
    }, outer)
  })

  test('has no entry at its root, and one below it that leads back to the root', async ({
    drivePage,
    localApi,
  }) => {
    await drivePage
      .goToCategoryNamed('Outer', `local-${posix.join(localApi.rootPath, 'Outer')}`)
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveText([/^Inner/, /^File/])
      })
      .driveTable.withParentDirectoryRow(async (entry) => {
        await expect(entry).toHaveCount(0)
      })
      .driveTable.openDirectory('Inner')
      .driveTable.withParentDirectoryRow(async (entry) => {
        await expect(entry).toBeVisible()
      })
      .driveTable.doubleClickParentDirectoryRow()
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveText([/^Inner/, /^File/])
      })
      .driveTable.withParentDirectoryRow(async (entry) => {
        await expect(entry).toHaveCount(0)
      })
  })
})

test.describe('a long folder', () => {
  test.use({
    setupApi: {
      addDefaultProject: false,
      local: (localApi) => {
        const outer = localApi.addRootDirectory('Long')
        for (let i = 10; i < 50; i += 1) localApi.addRootFile(`Item ${i}`, { parent: outer })
      },
    },
  })

  test('scrolled, a rubber band starting on the first visible row selects it', async ({
    drivePage,
  }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.openDirectory('Long')
      .withAssetsTable(async (table, _context, page) => {
        const rows = table.getByTestId('asset-row')
        await expect(rows).toHaveCount(40)
        // Scroll by ten and a half rows: the entry and the first rows are above the heading.
        await table.evaluate((element) => {
          let scroller: HTMLElement | null = element.parentElement
          while (scroller != null && scroller.scrollHeight <= scroller.clientHeight) {
            scroller = scroller.parentElement
          }
          if (scroller != null) scroller.scrollTop = 36 * 10 + 18
        })
        const heading = await table.locator('thead').boundingBox()
        const box = await table.boundingBox()
        expect(heading).not.toBeNull()
        expect(box).not.toBeNull()
        const x = box!.x + box!.width - 150
        const y = heading!.y + heading!.height + 6
        // The row under the band's start.
        const startTitle = await page.evaluate(
          ([px, py]) =>
            document
              .elementFromPoint(px!, py!)
              ?.closest('[data-testid="asset-row"]')
              ?.querySelector('[data-testid="asset-row-name"]')?.textContent ?? null,
          [x, y],
        )
        expect(startTitle).toMatch(/^Item/)
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x - 40, y + 20, { steps: 8 })
        await page.mouse.up()
        const selected = table.getByRole('row', { selected: true })
        await expect(selected.filter({ hasText: startTitle! })).toHaveCount(1)
      })
  })
})
