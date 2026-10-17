/** @file Test moving, cutting and duplicating. */
import { expect, test } from 'integration-test/base'

test('move', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    // Assets: [0: New Folder 1, 1: Mock Project]
    .createFolder()
    // Assets: [0: New Folder 2, 1: New Folder 1, 2: Mock Project]
    .createFolder()
    .driveTable.rightClickRow('New Folder 2')
    // Assets: [0: New Folder 2 <cut>, 1: New Folder 1, 2: Mock Project]
    .contextMenu.cut()
    .driveTable.rightClickRow('New Folder 1')
    // Assets: [0: New Folder 1, 1: Mock Project, 2: New Folder 2 <child { depth=1 }>]
    .contextMenu.paste()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 1/, /^Mock Project/])
    })
    .driveTable.openDirectory('New Folder 1')
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 2/])
    })
})

test.describe('move (drag)', () => {
  // Added before the app loads: a change made once it has loaded is not listed.
  test.use({
    setupApi: {
      local: (localApi) => {
        localApi.addRootDirectory('New Folder 1')
        localApi.addRootDirectory('New Folder 2')
      },
    },
  })
  test('move (drag)', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.dragRowToRow('New Folder 2', 'New Folder 1')
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveText([/^New Folder 1/, /^Mock Project/])
      })
      .driveTable.openDirectory('New Folder 1')
      .driveTable.withRows(async (rows) => {
        await expect(rows).toHaveText([/^New Folder 2/])
      })
  })
})

test('move (keyboard)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    // Assets: [0: New Folder 1, 1: Mock Project]
    .createFolder()
    // Assets: [0: New Folder 2, 1: New Folder 1, 2: Mock Project]
    .createFolder()
    .driveTable.clickRow('New Folder 2')
    // Assets: [0: New Folder 2 <cut>, 1: New Folder 1, 2: Mock Project]
    .press('Mod+X')
    .driveTable.clickRow('New Folder 1')
    // Assets: [0: New Folder 1, 1: Mock Project, 2: New Folder 2 <child { depth=1 }>]
    .press('Mod+V')
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 1/, /^Mock Project/])
    })
    .driveTable.openDirectory('New Folder 1')
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([/^New Folder 2/])
    })
})

test('cut (keyboard)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .createFolder()
    .driveTable.clickRow(0)
    .press('Mod+X')
    .driveTable.withRows(async (rows) => {
      // This action is not a builtin `expect` action, so it needs to be manually retried.
      await expect(async () => {
        expect(
          await rows.nth(0).evaluate((el) => Number(getComputedStyle(el).opacity)),
        ).toBeLessThan(1)
      }).toPass()
    })
})

test.describe('duplicate', () => {
  test.use({ setupApi: { local: (localApi) => localApi.addRootProject('New Project 1') } })
  test('duplicate', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.rightClickRow('New Project 1')
      .contextMenu.duplicate()
      .driveTable.withRows(async (rows) => {
        const project1 = rows.filter({ hasText: /New Project 1/, hasNotText: /\(copy\)/ })
        const project1Copy = rows.filter({ hasText: /New Project 1 \(copy\)/ })

        await expect(project1).toBeVisible()
        await expect(project1Copy).toBeVisible()
      })
  })
})

test.describe('duplicate (keyboard)', () => {
  test.use({ setupApi: { local: (localApi) => localApi.addRootProject('New Project 1') } })
  test('duplicate (keyboard)', async ({ drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.clickRow('New Project 1')
      .press('Mod+D')
      .driveTable.withRows(async (rows) => {
        const project1 = rows.filter({ hasText: /New Project 1/, hasNotText: /\(copy\)/ })
        const project1Copy = rows.filter({ hasText: /New Project 1 \(copy\)/ })

        await expect(project1).toBeVisible()
        await expect(project1Copy).toBeVisible()
      })
  })
})
