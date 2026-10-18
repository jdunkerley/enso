/** @file Test copying, moving, cutting and pasting. */
import { expect, test } from 'integration-test/base'

import { UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { uuidv4 } from 'lib0/random.js'

test('delete (local)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .createFolder()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(2)
    })
    .driveTable.rightClickRow(0)
    .contextMenu.delete()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(1)
    })
})

test.describe(() => {
  // Added before the app loads: the drive opens on Local, so a project added once it has loaded
  // would not be listed until the category is fetched again. A minute newer than "Mock Project",
  // so that it is the first row.
  test.use({
    setupApi: {
      local: (localApi) => {
        const later = toRfc3339(new Date(Date.now() + 60_000))
        localApi.addProject({
          metadata: {
            name: 'Another project',
            namespace: 'local',
            id: UUID(uuidv4()),
            created: later,
          },
          attributes: { creationTime: later, lastModifiedTime: later },
        })
      },
    },
  })

  test('cannot delete opened project (local)', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveCount(2)
      })
      .driveTable.openProject(0)
      .expectProjectEditorOpened('Another project')
      .goToPage.drive()
      .driveTable.clickRow(0)
      .press('Delete')
      .expectNoModal()
      // Additional test to cover https://github.com/enso-org/enso/issues/14253
      .driveTable.clickRow(1)
      .driveTable.clickRow(0)
      .press('Delete')
      .expectNoModal()
  })
})
