/**
 * @file The local Recent category: the local projects opened most recently, newest first, which
 * can be removed from the list, and which keep their entries when moved.
 */
import { Path, UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { expect, test } from 'integration-test/base'
import { uuidv4 } from 'lib0/random.js'
import { posix } from 'node:path'
import { TEXT } from '../actions'

/** The default project's folder (`integration-test/base.ts`, `mock/localApi.ts`). */
const MOCK_PROJECT_FOLDER = 'Mock_Project'

test('local Recent lists opened projects newest first, and removes one on request', async ({
  page,
  drivePage,
  localApi,
}) => {
  localApi.addProject({
    metadata: {
      id: UUID(uuidv4()),
      name: 'Second Project',
      namespace: 'local',
      created: toRfc3339(new Date()),
    },
  })

  await drivePage.goToCategory
    .localRecent()
    .do(async () => {
      await expect(page.getByText(TEXT.noRecentLocalProjects)).toBeVisible()
    })
    .goToCategory.local()
    .driveTable.openProject('Mock Project')
    .expectProjectEditorOpened('Mock Project')
    .goToPage.drive()
    .driveTable.openProject('Second Project')
    .expectProjectEditorOpened('Second Project')
    .goToPage.drive()
    .goToCategory.localRecent()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Second Project/, /^Mock Project/])
    })
    .driveTable.rightClickRow('Mock Project')
    .do(async () => {
      await page.getByRole('button', { name: TEXT.removeFromRecentShortcut }).click()
    })
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Second Project/])
    })
    .do(() => {
      expect(localApi.recentProjectPaths()).toEqual([
        posix.join(localApi.rootPath, 'Second_Project'),
      ])
    })
})

test('a project moved into a folder keeps its Recent entry', async ({ drivePage, localApi }) => {
  const folderPath = Path(posix.join(localApi.rootPath, 'Folder'))
  localApi.addDirectory({ path: folderPath })
  localApi.addRecentProject(Path(posix.join(localApi.rootPath, MOCK_PROJECT_FOLDER)))

  await drivePage.goToCategory
    .local()
    .driveTable.rightClickRow('Mock Project')
    .contextMenu.cut()
    .driveTable.rightClickRow('Folder')
    .contextMenu.paste()
    .do(async () => {
      await expect
        .poll(() => localApi.recentProjectPaths())
        .toEqual([posix.join(folderPath, MOCK_PROJECT_FOLDER)])
    })
    .goToCategory.localRecent()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^Mock Project/])
    })
    .driveTable.withPathColumnCell('Mock Project', async (cell) => {
      await expect(cell).toContainText('Folder')
    })
})
