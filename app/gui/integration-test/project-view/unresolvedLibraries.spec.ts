/**
 * @file A project whose libraries cannot be loaded: its toast names them, and offers to switch the
 * project to the installed edition when that would load them (#600). The Language Server's
 * `library/listLoadFailures`, `editions/checkSwitch` and `editions/setParentEdition` are mocked
 * (`mock/lsHandler.ts`).
 */
import { expect, test } from 'integration-test/base'
import {
  mockParentEditionsSet,
  restoreMockMainFile,
  setMockLibraryLoadFailures,
} from 'integration-test/mock/lsHandler'
import { posix } from 'node:path'

const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT_PATH = posix.join(ROOT, 'Mock_Project')
const TABLE_FAILED = {
  library: 'Standard.Table',
  version: '0.0.0-dev',
  kind: 'DownloadFailed' as const,
  message: 'Server responded with HTTP 502',
}

test.afterEach(restoreMockMainFile)

test.describe('when the installed edition has the libraries', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = ROOT
        api.versioning.enabled = true
        api.versioning.changed.add(MOCK_PROJECT_PATH)
        setMockLibraryLoadFailures([TABLE_FAILED], {
          current: '0.0.0-dev',
          target: '2026.1.1-dev',
          resolves: true,
          changes: [
            { library: 'Standard.Base', from: '0.0.0-dev', to: '2026.1.1-dev' },
            { library: 'Standard.Table', from: '0.0.0-dev', to: '2026.1.1-dev' },
          ],
          stillMissing: [],
        })
      },
    },
  })

  test('Switch and reopen saves a version, sets the edition and reopens', async ({
    page,
    editorPage,
    localApi,
  }) => {
    await editorPage
    const toast = page.getByTestId('unresolved-libraries-toast')
    await expect(toast).toContainText(
      "This project's libraries could not be loaded: Standard.Table 0.0.0-dev (download failed: Server responded with HTTP 502).",
    )
    await expect(toast).toContainText('Switch it to the installed edition 2026.1.1-dev?')
    await expect(toast).toContainText('Standard.Base 0.0.0-dev → 2026.1.1-dev')
    await toast.getByTestId('edition-switch-button').click()
    await expect.poll(() => mockParentEditionsSet).toEqual(['2026.1.1-dev'])
    expect(localApi.versioning.commits[0]).toEqual([
      MOCK_PROJECT_PATH,
      'Before switching edition to 2026.1.1-dev',
    ])
    // Reopened: the graph is back (the mock still reports the failure, so the toast is too).
    await expect(page.locator('.GraphNode').first()).toBeVisible()
  })
})

test.describe('when nothing resolves', () => {
  test.use({
    setupApi: {
      local: () =>
        setMockLibraryLoadFailures(
          [{ library: 'Acme.Widgets', version: null, kind: 'NotInEdition', message: '' }],
          {
            current: '2026.1.1-dev',
            target: '2026.1.1-dev',
            resolves: false,
            changes: [],
            stillMissing: ['Acme.Widgets'],
          },
        ),
    },
  })

  test('the toast lists what is missing and offers nothing', async ({ page, editorPage }) => {
    await editorPage
    const toast = page.getByTestId('unresolved-libraries-toast')
    await expect(toast).toContainText('Acme.Widgets (not defined in the edition)')
    await expect(toast).toContainText(
      'Install these libraries, or remove their imports: Acme.Widgets.',
    )
    await expect(toast.getByTestId('edition-switch-button')).toHaveCount(0)
    expect(mockParentEditionsSet).toEqual([])
  })
})
