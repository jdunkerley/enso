/**
 * @file Labels on local projects: labelling one from the context menu, filtering by the label with
 * the search bar's chip, and removing it. Folders take no labels locally.
 */
import { COLORS, Path, UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'

const LABEL = 'important'
const LABELLED = 'Mock Project'
const OTHER = 'Other Project'
const FOLDER = 'A Folder'

test.use({
  setupApi: {
    local: (localApi) => {
      localApi.addLabel(LABEL, COLORS[0])
      localApi.addProject({
        metadata: {
          id: UUID('5b0e2a86-6c55-4d59-9a54-6f7d7f3c2b11'),
          name: OTHER,
          namespace: 'local',
          created: toRfc3339(new Date()),
        },
      })
      localApi.addDirectory({ path: Path(`${localApi.rootPath}/${FOLDER}`) })
    },
  },
})

const rows = (page: Page) =>
  page.getByTestId('drive-view').getByRole('grid').getByTestId('asset-row')
const row = (page: Page, name: string) => rows(page).filter({ hasText: name })
const labelPills = (page: Page, name: string) => row(page, name).getByTestId('asset-label')

test('label a local project, filter by the label, and remove it', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .do(async (page) => {
      await expect(rows(page)).toHaveCount(3)
      await expect(labelPills(page, LABELLED)).toHaveCount(0)
    })
    .driveTable.rightClickRow(LABELLED)
    .contextMenu.label()
    .do(async (page) => {
      const popover = page.getByRole('dialog').filter({ hasText: LABEL })
      await expect(popover).toBeVisible()
      await popover.getByRole('button', { name: LABEL, exact: true }).click()
      await expect(popover.getByRole('listitem')).toHaveText([LABEL])
    })
    .press('Escape')
    .do(async (page) => {
      // The table is hidden from the accessibility tree while the popover is open.
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(labelPills(page, LABELLED)).toHaveText([LABEL])
      await expect(labelPills(page, OTHER)).toHaveCount(0)
    })
    .do(async (page) => {
      await page.getByTestId('asset-search-bar').getByPlaceholder(/(?:)/).click()
      const chip = page
        .getByTestId('asset-search-bar')
        .getByTestId('asset-search-labels')
        .getByRole('button', { name: LABEL })
      await chip.click()
      await expect(rows(page)).toHaveText([new RegExp(`^${LABELLED}`)])
      await chip.click()
      await expect(rows(page)).toHaveCount(3)
    })
    .driveTable.clickAway()
    .do(async (page) => {
      // The pill's remove button sits beside it.
      await labelPills(page, LABELLED).locator('..').getByRole('button').last().click()
      await expect(labelPills(page, LABELLED)).toHaveCount(0)
    })
})

test('a local folder offers no "Label…"', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.rightClickRow(FOLDER)
    .do(async (page) => {
      // An entry's name is its label followed by its shortcut, if any.
      const entry = (name: string) =>
        page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${name}(?: |$)`) })
      await expect(entry(TEXT.renameShortcut)).toBeVisible()
      await expect(entry(TEXT.labelShortcut)).toHaveCount(0)
    })
})
