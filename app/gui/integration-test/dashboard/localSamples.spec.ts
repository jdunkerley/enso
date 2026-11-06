/**
 * @file The bundled samples in the drive: the "Update available" pill on an edited sample whose
 * bundle changed (a button that updates it after a confirmation), Update Sample in a sample's
 * context menu, and Update All in the toolbar of the `Samples` folder. The shim's routes are
 * mocked (`mock/localSamples.ts`); the shim's own tests cover what they do.
 */
import { Path, UUID } from 'enso-common/src/services/Backend'
import { toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import { expect, test, type Page } from 'integration-test/base'
import type { MockLocalApi } from 'integration-test/mock/localApi'
import { uuidv4 } from 'lib0/random.js'
import { posix } from 'node:path'
import { getText, TEXT } from '../actions'
import { mockCopyName, type MockSample } from '../mock/localSamples'

/** `Sales_Overview` and `Orders` have updates; `Text_Cleaning` is edited; `My_Sample` is the user's. */
function samplesSetup(samples: MockSample[]) {
  return {
    setupApi: {
      local: (api: MockLocalApi) => {
        const directory = posix.join(api.rootPath, 'Samples')
        api.addDirectory({ path: Path(directory) })
        for (const name of [...samples.map((sample) => sample.name), 'My_Sample']) {
          api.addProject({
            path: Path(posix.join(directory, name)),
            metadata: {
              id: UUID(uuidv4()),
              name,
              namespace: 'local',
              created: toRfc3339(new Date()),
            },
          })
        }
        // Copies: the mock changes them, and the next test starts afresh.
        api.samples.samples.push(...samples.map((sample) => ({ ...sample })))
      },
    },
  }
}

const pill = (page: Page, row: string) =>
  page.getByTestId('asset-row').filter({ hasText: row }).getByTestId('sample-update-badge')
const dialog = (page: Page) => page.getByRole('alertdialog')
const updateAllButton = (page: Page) => page.getByTestId('update-all-samples')

test.describe('with updates', () => {
  test.use(
    samplesSetup([
      { name: 'Sales_Overview', state: 'updateAvailable' },
      { name: 'Orders', state: 'updateAvailable', route: 'version' },
      { name: 'Text_Cleaning', state: 'edited' },
    ]),
  )

  test('the pill updates its sample after a confirmation naming the kept copy', async ({
    page,
    drivePage,
    localApi,
  }) => {
    await drivePage.driveTable.doubleClickRow('Samples').do(async () => {
      await expect(pill(page, 'Sales_Overview')).toContainText(TEXT.sampleUpdateAvailable)
      await expect(pill(page, 'Sales_Overview')).toHaveAccessibleName(
        getText('updateSampleLabel', 'Sales_Overview'),
      )
      await expect(pill(page, 'Text_Cleaning')).toHaveCount(0)
      await expect(pill(page, 'My_Sample')).toHaveCount(0)

      // Cancelling changes nothing.
      await pill(page, 'Sales_Overview').click()
      await expect(dialog(page)).toContainText(
        getText('updateSampleRouteCopy', mockCopyName('Sales_Overview')),
      )
      await dialog(page).getByRole('button', { name: TEXT.cancel }).click()
      await expect(dialog(page)).toHaveCount(0)
      expect(localApi.samples.updates).toEqual([])

      await pill(page, 'Sales_Overview').click()
      await dialog(page).getByRole('button', { name: TEXT.updateSampleConfirm }).click()
      await expect(
        page.getByText(
          getText('updateSampleKept', 'Sales_Overview', mockCopyName('Sales_Overview')),
        ),
      ).toBeVisible()
      expect(localApi.samples.updates).toEqual(['Sales_Overview'])
      await expect(pill(page, 'Sales_Overview')).toHaveCount(0)
      // The press stayed with the pill: the row was neither selected nor opened.
      await expect(page.getByRole('row', { selected: true })).toHaveCount(0)
      await expect(page.getByTestId('drive-view')).toBeVisible()
    })
  })

  test('the pill works from the keyboard, and says a versioned sample stays in history', async ({
    page,
    drivePage,
    localApi,
  }) => {
    await drivePage.driveTable.doubleClickRow('Samples').do(async () => {
      await pill(page, 'Orders').focus()
      await page.keyboard.press('Enter')
      await expect(dialog(page)).toContainText(TEXT.updateSampleRouteVersion)
      await page.keyboard.press('Enter')
      await expect(page.getByText(getText('updateSampleVersioned', 'Orders'))).toBeVisible()
      expect(localApi.samples.updates).toEqual(['Orders'])
    })
  })

  test('Update Sample in the context menu, and only on bundled samples', async ({
    page,
    drivePage,
    localApi,
  }) => {
    await drivePage.driveTable
      .doubleClickRow('Samples')
      .driveTable.rightClickRow('My_Sample')
      .do(async () => {
        await expect(page.getByTestId('context-menu')).toBeVisible()
        await expect(page.getByRole('button', { name: TEXT.updateSampleShortcut })).toHaveCount(0)
        await page.keyboard.press('Escape')
      })
      .driveTable.rightClickRow('Text_Cleaning')
      .do(async () => {
        await page.getByRole('button', { name: TEXT.updateSampleShortcut }).click()
        await dialog(page).getByRole('button', { name: TEXT.updateSampleConfirm }).click()
        await expect(
          page.getByText(
            getText('updateSampleKept', 'Text_Cleaning', mockCopyName('Text_Cleaning')),
          ),
        ).toBeVisible()
        expect(localApi.samples.updates).toEqual(['Text_Cleaning'])
      })
  })

  test('Update All is shown only in Samples, and updates only the samples with updates', async ({
    page,
    drivePage,
    localApi,
  }) => {
    await expect(updateAllButton(page)).toHaveCount(0)
    await drivePage.driveTable.doubleClickRow('Samples').do(async () => {
      await expect(updateAllButton(page)).toBeEnabled()
      await updateAllButton(page).click()
      const items = dialog(page).getByTestId('update-sample-route')
      await expect(items).toHaveText([
        `Sales_Overview: ${getText('updateSampleRouteCopy', mockCopyName('Sales_Overview'))}`,
        `Orders: ${TEXT.updateSampleRouteVersion}`,
      ])
      await dialog(page).getByRole('button', { name: TEXT.updateSampleConfirm }).click()
      await expect(
        page.getByText(getText('updateAllSamplesDone', 'Sales_Overview, Orders')),
      ).toBeVisible()
      expect(localApi.samples.updates).toEqual([null])
      expect(localApi.samples.samples.map((sample) => [sample.name, sample.state])).toEqual([
        ['Sales_Overview', 'current'],
        ['Orders', 'current'],
        ['Text_Cleaning', 'edited'],
      ])
      // Nothing is left to update.
      await expect(updateAllButton(page)).toBeDisabled()
      await expect(pill(page, 'Sales_Overview')).toHaveCount(0)
    })
  })

  test('an open sample has its pill, Update Sample and Update All disabled, saying why', async ({
    page,
    drivePage,
  }) => {
    await drivePage.driveTable
      .doubleClickRow('Samples')
      .driveTable.openProject('Sales_Overview')
      .expectProjectEditorOpened('Sales_Overview')
      .goToPage.drive()
      .do(async () => {
        await expect(pill(page, 'Sales_Overview')).toBeDisabled()
        await pill(page, 'Sales_Overview').hover({ force: true })
        await expect(page.getByText(TEXT.updateSampleOpenTooltip)).toBeVisible()
        await expect(updateAllButton(page)).toBeDisabled()
        await expect(pill(page, 'Orders')).toBeEnabled()
      })
      .driveTable.rightClickRow('Sales_Overview')
      .do(async () => {
        await expect(page.getByRole('button', { name: TEXT.updateSampleShortcut })).toBeDisabled()
      })
  })

  test('other folders and projects have no sample entries', async ({ page, drivePage }) => {
    await drivePage.driveTable.rightClickRow('Mock Project').do(async () => {
      await expect(page.getByTestId('context-menu')).toBeVisible()
      await expect(page.getByRole('button', { name: TEXT.updateSampleShortcut })).toHaveCount(0)
    })
  })
})

test.describe('with no updates', () => {
  test.use(samplesSetup([{ name: 'Text_Cleaning', state: 'edited' }]))

  test('Update All is disabled, saying why', async ({ page, drivePage }) => {
    await drivePage.driveTable.doubleClickRow('Samples').do(async () => {
      await expect(updateAllButton(page)).toBeDisabled()
      await updateAllButton(page).hover({ force: true })
      await expect(page.getByText(TEXT.updateAllSamplesNoneTooltip)).toBeVisible()
    })
  })
})
