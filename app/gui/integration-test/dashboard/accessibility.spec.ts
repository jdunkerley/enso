/**
 * @file Accessibility safety net for the React→Vue dashboard port (#81).
 *
 * - axe-core runs on the four main screens (login, drive, settings, asset panel) and fails on any
 *   violation not in the screen's baseline (see `integration-test/accessibility.ts`).
 * - The accessibility trees of key widgets are pinned with `toMatchAriaSnapshot`, so a port has to
 *   keep their roles, names and states — the contract screen readers and these tests rely on.
 *
 * When a port changes one of these trees on purpose, update the snapshot in the same PR and say
 * why in its description.
 */
import { expect, test } from 'integration-test/base'
import { expectNoNewAxeViolations } from '../accessibility'
import { TEXT } from '../actions'

test.describe('logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('login screen: no new axe violations', async ({ loginPage }) => {
    await loginPage.do(async (page) => {
      await expect(page.getByText(TEXT.loginToYourAccount)).toBeVisible()
      await expectNoNewAxeViolations(page, 'login')
    })
  })
})

test('drive: no new axe violations; drive table header tree', async ({ drivePage, cloudApi }) => {
  cloudApi.addDirectory({ title: 'Folder' })
  cloudApi.addProject({ title: 'Project' })
  cloudApi.addFile({ title: 'File' })
  await drivePage.goToCategory
    .cloud()
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
            - columnheader "Size Size":
              - button "Size"
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
  cloudApi,
}) => {
  cloudApi.addDirectory({ title: 'Folder' })
  cloudApi.addProject({ title: 'Project' })
  cloudApi.addFile({ title: 'File' })
  await drivePage.goToCategory
    .cloud()
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

test('drive table: dragging rows is announced', async ({ drivePage, cloudApi }) => {
  cloudApi.addDirectory({ title: 'Folder' })
  cloudApi.addFile({ title: 'File' })
  await drivePage.goToCategory
    .cloud()
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
    // A drop outside the table is named by its target's accessible name.
    .driveTable.clickRow('Folder')
    .driveTable.dragRowToCategory('Folder', 'Trash')
    .do(async (page) => {
      await expect(page.getByTestId('drive-drag-announcement')).toHaveText(
        TEXT.dragAnnouncementDroppedOn
          .replace('$0', TEXT.dragAnnouncementOneAsset.replace('$0', 'Folder'))
          .replace('$1', 'Trash'),
      )
    })
})

test('asset panel: no new axe violations', async ({ drivePage, cloudApi }) => {
  cloudApi.addProject({ title: 'Project', description: 'A description' })
  await drivePage.goToCategory
    .cloud()
    .driveTable.clickRow('Project')
    .togglePropertiesAssetPanel()
    .withRightPanel(async (panel) => {
      await expect(panel.getByTestId('asset-panel-owner')).toBeVisible()
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
        - img "user name"
        - text: user name Solo
        - button /^Settings/
        - button /^About Enso/
        - button "Upgrade Plan"
        - button "Logout"
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
      - heading "Access" [level=1]
      - button "Billing"
      - heading "Look and feel" [level=1]
      - button "Appearance"
      - button "Keyboard shortcuts"
      - heading "Security" [level=1]
      - button "API Keys"
      - heading "Usage" [level=1]
      - button "Usage"
    `)
  })
})
