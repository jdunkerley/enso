/** @file Test sorting of assets columns. */
import { expect, test } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'

import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'

const START_DATE_EPOCH_MS = 1.7e12
/** The number of milliseconds in a minute. */
const MIN_MS = 60_000

/** Add the drive's contents. It must happen before the app loads: a later change is not listed. */
function seed(localApi: MockLocalApi) {
  const date1 = toRfc3339(new Date(START_DATE_EPOCH_MS))
  const date2 = toRfc3339(new Date(START_DATE_EPOCH_MS + 1 * MIN_MS))
  const date3 = toRfc3339(new Date(START_DATE_EPOCH_MS + 2 * MIN_MS))
  const date4 = toRfc3339(new Date(START_DATE_EPOCH_MS + 3 * MIN_MS))
  const date4a = toRfc3339(new Date(START_DATE_EPOCH_MS + 3 * MIN_MS + 1))
  const date4b = toRfc3339(new Date(START_DATE_EPOCH_MS + 3 * MIN_MS + 2))
  const date5 = toRfc3339(new Date(START_DATE_EPOCH_MS + 4 * MIN_MS))
  const date5a = toRfc3339(new Date(START_DATE_EPOCH_MS + 4 * MIN_MS + 1))
  const date6 = toRfc3339(new Date(START_DATE_EPOCH_MS + 5 * MIN_MS))
  const date7 = toRfc3339(new Date(START_DATE_EPOCH_MS + 6 * MIN_MS))
  const date8 = toRfc3339(new Date(START_DATE_EPOCH_MS + 7 * MIN_MS))
  localApi.addRootDirectory('a directory 1', { attributes: { lastModifiedTime: date4 } })
  localApi.addRootDirectory('a directory 10', { attributes: { lastModifiedTime: date4a } })
  localApi.addRootDirectory('a directory 2', { attributes: { lastModifiedTime: date4b } })
  localApi.addRootDirectory('a directory 11', { attributes: { lastModifiedTime: date5a } })
  localApi.addRootDirectory('G directory', { attributes: { lastModifiedTime: date6 } })
  localApi.addRootProject('C project', { created: date7 })
  localApi.addRootFile('H file', { attributes: { lastModifiedTime: date2 } })
  localApi.addRootProject('b project', { created: date1 })
  localApi.addRootFile('d file', { attributes: { lastModifiedTime: date8 } })
  localApi.addRootFile('f file', { attributes: { lastModifiedTime: date3 } })
  localApi.addRootFile('e file', { attributes: { lastModifiedTime: date5 } })
  // By date:
  // b project
  // H file
  // f file
  // a directory 1
  // a directory 10
  // a directory 2
  // e file
  // a directory 11
  // g directory
  // c project
  // d file
}

test.use({ setupApi: { addDefaultProject: false, local: seed } })

test('sort', async ({ drivePage }) => {
  await drivePage.goToCategory
    .local()
    .driveTable.withRows(async (rows) => {
      // By default, assets should be grouped by type.
      // The app lists each group newest first (by modification date), whatever order the backend
      // returns them in.
      await expect(rows).toHaveText([
        /^G directory/,
        /^a directory 11/,
        /^a directory 2/,
        /^a directory 10/,
        /^a directory 1/,
        /^C project/,
        /^b project/,
        /^d file/,
        /^e file/,
        /^f file/,
        /^H file/,
      ])
    })
    // Sort by name ascending.
    .driveTable.clickNameColumnHeading()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^a directory 1/,
        /^a directory 2/,
        /^a directory 10/,
        /^a directory 11/,
        /^b project/,
        /^C project/,
        /^d file/,
        /^e file/,
        /^f file/,
        /^G directory/,
        /^H file/,
      ])
    })
    // Sort by name descending.
    .driveTable.clickNameColumnHeading()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^H file/,
        /^G directory/,
        /^f file/,
        /^e file/,
        /^d file/,
        /^C project/,
        /^b project/,
        /^a directory 11/,
        /^a directory 10/,
        /^a directory 2/,
        /^a directory 1/,
      ])
    })
    // Sorting should be unset.
    .driveTable.clickNameColumnHeading()
    .do(async (thePage) => {
      await thePage.mouse.move(0, 0)
    })
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^G directory/,
        /^a directory 11/,
        /^a directory 2/,
        /^a directory 10/,
        /^a directory 1/,
        /^C project/,
        /^b project/,
        /^d file/,
        /^e file/,
        /^f file/,
        /^H file/,
      ])
    })
    // Sort by date ascending.
    .driveTable.clickModifiedColumnHeading()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^b project/,
        /^H file/,
        /^f file/,
        /^a directory 1/,
        /^a directory 10/,
        /^a directory 2/,
        /^e file/,
        /^a directory 11/,
        /^G directory/,
        /^C project/,
        /^d file/,
      ])
    })
    // Sort by date descending.
    .driveTable.clickModifiedColumnHeading()
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^d file/,
        /^C project/,
        /^G directory/,
        /^a directory 11/,
        /^e file/,
        /^a directory 2/,
        /^a directory 10/,
        /^a directory 1/,
        /^f file/,
        /^H file/,
        /^b project/,
      ])
    })
    // Sorting should be unset.
    .driveTable.clickModifiedColumnHeading()
    .do(async (thePage) => {
      await thePage.mouse.move(0, 0)
    })
    .driveTable.withRows(async (rows) => {
      await expect(rows).toHaveText([
        /^G directory/,
        /^a directory 11/,
        /^a directory 2/,
        /^a directory 10/,
        /^a directory 1/,
        /^C project/,
        /^b project/,
        /^d file/,
        /^e file/,
        /^f file/,
        /^H file/,
      ])
    })
})
