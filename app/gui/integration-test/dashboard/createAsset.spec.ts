/** @file Test creating assets. */
import { expect, test } from 'integration-test/base'

/** The name of the uploaded file. */
const FILE_NAME = 'foo.txt'
/** The contents of the uploaded file. */
const FILE_CONTENTS = 'hello world'

test('create folder (local)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .createFolder()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(0)).toBeVisible()
      await expect(rows.nth(0)).toHaveText(/^New Folder 1/)
    })
})

test('create project (local)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .newEmptyProject()
    .waitForEditorToLoad()
    .goToPage.drive()
    .driveTable.withRows((rows) => expect(rows).toHaveCount(2))
})

test('upload file (local)', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .uploadFile(FILE_NAME, FILE_CONTENTS)
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveCount(2)
      await expect(rows.nth(1)).toBeVisible()
      await expect(rows.nth(1)).toHaveText(new RegExp('^' + FILE_NAME))
    })
})
