/**
 * @file Accessibility safety net for the dashboard (#81).
 *
 * - axe-core runs on the main screens (drive, settings, asset panel) and fails on any
 *   violation not in the screen's baseline (see `integration-test/accessibility.ts`).
 * - The accessibility trees of key widgets are pinned with `toMatchAriaSnapshot`, so a port has to
 *   keep their roles, names and states — the contract screen readers and these tests rely on.
 *
 * When a port changes one of these trees on purpose, update the snapshot in the same PR and say
 * why in its description.
 */
import { Path } from 'enso-common/src/services/Backend'
import { expect, test } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { posix } from 'node:path'
import { expectNoNewAxeViolations } from '../accessibility'
import { TEXT } from '../actions'

/** The drive the first three drive tests look at. It is added before the app loads. */
function seedDrive(localApi: MockLocalApi) {
  localApi.addRootDirectory('Folder')
  localApi.addRootProject('Project')
  localApi.addRootFile('File')
}

/** The drag test needs no project. */
function seedDragDrive(localApi: MockLocalApi) {
  localApi.addRootDirectory('Folder')
  localApi.addRootFile('File')
}

test.describe('three rows', () => {
  test.use({ setupApi: { addDefaultProject: false, local: seedDrive } })

  test('drive: no new axe violations; drive table header tree', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveCount(3)
      })
      .withAssetsTable(async (table, _context, page) => {
        await expectNoNewAxeViolations(page, 'drive')
        await expect(table.getByRole('rowgroup').first()).toMatchAriaSnapshot(`
        - rowgroup:
          - row:
            - columnheader "Sort by name":
              - button "Sort by name":
                - text: Name
            - columnheader "Sort by modification date":
              - button "Hide column"
              - button "Modified"
            - columnheader "Sort by creation date":
              - button "Hide column"
              - button "Created at"
            - columnheader "Labels Labels":
              - button "Labels"
      `)
      })
      .driveTable.clickRow('Folder')
      .driveTable.withSelectedRows(async (rows) => {
        await expect(rows).toHaveCount(1)
        await expect(rows).toContainText('Folder')
      })
  })

  test('drive table: a grid with row positions, selection and one roving tab stop', async ({
    drivePage,
  }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.clickRow('Folder')
      .withAssetsTable(async (table, _context, page) => {
        await expect(table).toHaveAttribute('aria-multiselectable', 'true')
        await expect(table).toMatchAriaSnapshot(`
        - grid "${TEXT.assetsTableLabel}":
          - rowgroup:
            - row
          - rowgroup:
            - row /Folder/ [selected]
            - row /Project/
            - row /File/
      `)
        const rows = table.getByTestId('asset-row')
        await expect(rows).toHaveCount(3)
        for (const [index, row] of (await rows.all()).entries()) {
          await expect(row).toHaveAttribute('aria-rowindex', String(index + 2))
        }
        // The row focused last is the one tab stop; the controls in the other rows are out of the
        // Tab sequence too.
        await expect(table.locator('[tabindex="0"]')).toHaveCount(1)
        await expect(rows.nth(0)).toHaveAttribute('tabindex', '0')
        await expect(rows.nth(0)).toBeFocused()

        await page.keyboard.press('ArrowDown')
        await expect(rows.nth(1)).toBeFocused()
        await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
        await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'false')
        await expect(rows.nth(1)).toHaveAttribute('tabindex', '0')
        await expect(rows.nth(0)).toHaveAttribute('tabindex', '-1')
        await expect(rows.nth(0).getByTestId('directory-row-navigate-button')).toHaveAttribute(
          'tabindex',
          '-1',
        )

        // Escape clears the selection; the arrow keys go on from the focused row.
        await page.keyboard.press('Escape')
        await expect(table.getByRole('row', { selected: true })).toHaveCount(0)
        await page.keyboard.press('ArrowDown')
        await expect(rows.nth(2)).toBeFocused()
        await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true')

        // Back up to the directory: its own controls rejoin the Tab sequence with it.
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('ArrowUp')
        await expect(rows.nth(0)).toBeFocused()
        await expect(rows.nth(0).getByTestId('directory-row-navigate-button')).not.toHaveAttribute(
          'tabindex',
          '-1',
        )
        await expect(table.locator('[tabindex="0"]')).toHaveCount(1)
      })
  })
})

test.describe('a folder and a file', () => {
  test.use({ setupApi: { addDefaultProject: false, local: seedDragDrive } })

  test('drive table: dragging rows is announced', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.dragRowToRow('File', 'Folder')
      .do(async (page) => {
        await expect(page.getByTestId('drive-drag-announcement')).toHaveText(
          TEXT.dragAnnouncementDroppedInto
            .replace('$0', TEXT.dragAnnouncementOneAsset.replace('$0', 'File'))
            .replace('$1', 'Folder'),
        )
      })
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveText([/^Folder/])
      })
  })
})

test('asset panel: no new axe violations', async ({ drivePage, localApi }) => {
  localApi.addProjectSources(Path(posix.join(localApi.rootPath, 'Mock_Project')))
  await drivePage.goToCategory
    .local()
    .driveTable.clickRow('Mock Project')
    .toggleDocsAssetPanel()
    .withRightPanel(async (panel) => {
      await expect(panel.getByTestId('documentation-editor-content')).toBeVisible()
    })
    .do(async (page) => {
      await expectNoNewAxeViolations(page, 'asset-panel', {
        include: ['[data-testid="right-panel"]'],
      })
    })
})

test('user menu tree', async ({ drivePage }) => {
  await drivePage.openUserMenu().do(async (page) => {
    const menu = page.getByTestId('user-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toMatchAriaSnapshot(`
      - dialog "User Settings":
        - img "Offline user"
        - text: Offline user Working locally
        - button /^Settings/
        - button /^About Enso/
    `)
  })
})

test('settings: no new axe violations; settings sidebar tree', async ({ drivePage }) => {
  await drivePage.goToPage.settings().do(async (page) => {
    const sidebar = page.getByLabel(TEXT.settingsSidebarLabel)
    await expect(sidebar).toBeVisible()
    await expect(page.getByText(TEXT.settingsFor, { exact: false }).first()).toBeVisible()
    await expectNoNewAxeViolations(page, 'settings')
    await expect(sidebar).toMatchAriaSnapshot(`
      - heading "General" [level=1]
      - button "Account"
      - button "Local"
      - heading "Look and feel" [level=1]
      - button "Appearance"
      - button "Keyboard shortcuts"
    `)
  })
})
