/**
 * @file The bundled samples in the drive: the "Update available" badge on an edited sample whose
 * bundle changed, Reset Sample on a sample and Reset All Samples on the `Samples` folder. The
 * shim's routes are mocked (`mock/localSamples.ts`); the shim's own tests cover what they do.
 */
import { Path, UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { expect, test } from 'integration-test/base'
import { uuidv4 } from 'lib0/random.js'
import { posix } from 'node:path'
import { TEXT } from '../actions'

const KEPT = 'Sales_Overview_edited_2026_11_06'

test.use({
  setupApi: {
    local: (api) => {
      const samples = posix.join(api.rootPath, 'Samples')
      api.addDirectory({ path: Path(samples) })
      for (const name of ['Sales_Overview', 'Text_Cleaning', 'My_Sample']) {
        api.addProject({
          path: Path(posix.join(samples, name)),
          metadata: {
            id: UUID(uuidv4()),
            name,
            namespace: 'local',
            created: toRfc3339(new Date()),
          },
        })
      }
      // `My_Sample` is the user's own, in `Samples` but not bundled.
      api.samples.samples.push(
        { name: 'Sales_Overview', state: 'updateAvailable' },
        { name: 'Text_Cleaning', state: 'edited' },
      )
      api.samples.kept = [KEPT]
    },
  },
})

test('an edited sample with an update has a badge, and Reset Sample resets it', async ({
  page,
  drivePage,
  localApi,
}) => {
  const badge = (row: string) =>
    page.getByTestId('asset-row').filter({ hasText: row }).getByTestId('sample-update-badge')
  await drivePage.driveTable
    .doubleClickRow('Samples')
    .do(async () => {
      await expect(badge('Sales_Overview')).toContainText(TEXT.sampleUpdateAvailable)
      await expect(badge('Text_Cleaning')).toHaveCount(0)
      await expect(badge('My_Sample')).toHaveCount(0)
    })
    .driveTable.rightClickRow('Sales_Overview')
    .do(async () => {
      await page.getByRole('button', { name: TEXT.resetSampleShortcut }).click()
      await expect(
        page.getByText(TEXT.resetSampleKept.replace('$0', 'Sales_Overview').replace('$1', KEPT)),
      ).toBeVisible()
      expect(localApi.samples.resets).toEqual(['Sales_Overview'])
      await expect(badge('Sales_Overview')).toHaveCount(0)
    })
})

test('only bundled samples have Reset Sample', async ({ page, drivePage }) => {
  await drivePage.driveTable
    .doubleClickRow('Samples')
    .driveTable.rightClickRow('Text_Cleaning')
    .do(async () => {
      await expect(page.getByRole('button', { name: TEXT.resetSampleShortcut })).toBeEnabled()
      await page.keyboard.press('Escape')
    })
    .driveTable.rightClickRow('My_Sample')
    .do(async () => {
      await expect(page.getByTestId('context-menu')).toBeVisible()
      await expect(page.getByRole('button', { name: TEXT.resetSampleShortcut })).toHaveCount(0)
    })
})

test('the Samples folder has Reset All Samples', async ({ page, drivePage, localApi }) => {
  localApi.samples.kept = []
  await drivePage.driveTable.rightClickRow('Samples').do(async () => {
    await expect(page.getByRole('button', { name: TEXT.resetSampleShortcut })).toHaveCount(0)
    await page.getByRole('button', { name: TEXT.resetAllSamplesShortcut }).click()
    await expect(page.getByText(TEXT.resetAllSamplesDone)).toBeVisible()
    expect(localApi.samples.resets).toEqual([null])
  })
})

test('other folders and projects have no sample entries', async ({ page, drivePage }) => {
  await drivePage.driveTable.rightClickRow('Mock Project').do(async () => {
    await expect(page.getByTestId('context-menu')).toBeVisible()
    await expect(page.getByRole('button', { name: TEXT.resetSampleShortcut })).toHaveCount(0)
    await expect(page.getByRole('button', { name: TEXT.resetAllSamplesShortcut })).toHaveCount(0)
  })
})
