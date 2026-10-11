/**
 * @file The root folder set in Settings → Local reaches the drive's Local category at once, without
 * a reload: by typing it, by browsing for it, and by resetting it (#182).
 */
import { Path } from 'enso-common/src/services/Backend'
import { expect, test, type Page } from 'integration-test/base'
import { TEXT } from '../actions'

/** The mocked root folder's only entry (`mock/localApi.ts`). */
const DEFAULT_ROOT_ENTRY = 'Mock Project'
const TYPED_ROOT = '/home/user/enso/other-projects'
const TYPED_ROOT_ENTRY = 'Folder In Typed Root'
/** The folder the mocked file browser picks (`mock/registerMocks.ts`). */
const BROWSED_ROOT = '/path/to/some/mock/file'
const BROWSED_ROOT_ENTRY = 'Folder In Browsed Root'

const driveRows = (page: Page) =>
  page.getByTestId('drive-view').getByRole('grid').getByTestId('asset-row')
const settingsPanel = (page: Page) => page.getByTestId('settings-panel')

test('the Local category follows the root folder set in Settings', async ({
  page,
  drivePage,
  localApi,
}) => {
  localApi.addDirectory({ path: Path(TYPED_ROOT) })
  localApi.addDirectory({ path: Path(`${TYPED_ROOT}/${TYPED_ROOT_ENTRY}`) })
  localApi.addDirectory({ path: Path(BROWSED_ROOT) })
  localApi.addDirectory({ path: Path(`${BROWSED_ROOT}/${BROWSED_ROOT_ENTRY}`) })

  await drivePage.goToCategory
    .local()
    .do(async () => {
      await expect(driveRows(page)).toHaveText([new RegExp(`^${DEFAULT_ROOT_ENTRY}`)])
    })
    .goToPage.settings()
    .goToSettingsTab.local()
    .do(async () => {
      // The settings open beside the drive, which stays on the Local category.
      const rootInput = settingsPanel(page).getByRole('textbox', {
        name: TEXT.localRootPathSettingsInput,
      })

      await rootInput.fill(TYPED_ROOT)
      await settingsPanel(page).getByRole('button', { name: TEXT.save, exact: true }).click()
      await expect(driveRows(page)).toHaveText([new RegExp(`^${TYPED_ROOT_ENTRY}`)])

      await settingsPanel(page)
        .getByRole('button', { name: TEXT.browseForNewLocalRootDirectory })
        .click()
      await expect(rootInput).toHaveValue(BROWSED_ROOT)
      await expect(driveRows(page)).toHaveText([new RegExp(`^${BROWSED_ROOT_ENTRY}`)])

      await settingsPanel(page).getByRole('button', { name: TEXT.resetLocalRootDirectory }).click()
      await expect(rootInput).toHaveValue(localApi.rootPath)
      await expect(driveRows(page)).toHaveText([new RegExp(`^${DEFAULT_ROOT_ENTRY}`)])
    })
})
