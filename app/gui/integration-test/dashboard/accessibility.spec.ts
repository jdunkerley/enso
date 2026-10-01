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
