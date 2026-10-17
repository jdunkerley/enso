/**
 * @file The right panel's Versions tab for local projects: the list, See changes, restore,
 * duplicate and comments, in the drive and in the graph editor. The shim's `versioning/*` routes
 * are mocked (`mock/localVersioning.ts`, `mock/versioning/historyRoutes.ts`).
 */
import { Path, type VersionEntry } from 'enso-common/src/services/ProjectManager/types'
import { CLOUD_ONLY, expect, test, type Page } from 'integration-test/base'
import * as locate from 'integration-test/project-view/locate'
import { posix } from 'node:path'

const ROOT = '/home/user/enso/enso-projects'
const MOCK_PROJECT_PATH = posix.join(ROOT, 'Mock_Project')

function entry(n: number, comment: string, isLatest = false): VersionEntry {
  return {
    id: n.toString(16).padStart(40, '0'),
    date: `2026-10-1${n}T10:00:00Z`,
    author: { name: 'Ada', email: 'ada@example.com' },
    comment,
    isLatest,
  }
}

const VERSIONS = [
  entry(3, 'Joined the sales table', true),
  entry(2, 'Saved on close'),
  entry(1, 'Saved'),
]

/** The right panel's Versions tab. */
async function openVersions(page: Page) {
  await page.getByRole('tab', { name: 'Versions' }).click()
  return page.getByTestId('right-panel').locator('visible=true')
}

/** The actions menu of the version at `index` (0 is the newest). */
async function openVersionMenu(page: Page, index: number) {
  const panel = page.getByTestId('right-panel').locator('visible=true')
  await panel.locator('button[aria-haspopup="menu"]').nth(index).click()
  return page.getByRole('menu')
}

test.describe('with versions kept', () => {
  test.use({
    setupApi: {
      local: (api) => {
        api.versioning.git = true
        api.versioning.repoRoot = ROOT
        api.versioning.enabled = true
        api.versioning.versions.set(MOCK_PROJECT_PATH, [...VERSIONS])
      },
    },
  })

  test('lists the versions, newest first, with their comments, and no tags', async ({
    page,
    drivePage,
  }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    const panel = await openVersions(page)
    await expect(panel.getByText(/^(Joined the sales table|Saved on close|Saved)$/)).toHaveText([
      'Joined the sales table',
      'Saved on close',
      'Saved',
    ])
    await expect(panel.getByText('Version 3').first()).toBeVisible()
    await expect(panel.getByText('Latest', { exact: true }).first()).toBeVisible()
    await expect(panel.getByLabel('Add tag')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /tag/i })).toHaveCount(0)
  })

  test('See changes shows the Main.enso diff with the previous version', async ({
    page,
    drivePage,
  }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    const panel = await openVersions(page)
    await panel.getByRole('button', { name: 'See changes' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Compare Version 3 with Version 2')
    await expect(dialog).toContainText('Joined the sales table')
    await expect(dialog).toContainText('Saved on close')
  })

  test('Compare with... compares two chosen versions', async ({ page, drivePage }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 1)
    await menu.getByRole('menuitem', { name: 'Compare with...' }).click()
    await page.getByRole('menuitem', { name: 'Version 1' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Compare Version 2 with Version 1')
    await expect(dialog).toContainText('Saved on close')
  })

  test('restores an older version of a closed project', async ({ page, drivePage, localApi }) => {
    const calls = localApi.trackCalls()
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 2)
    await menu.getByRole('menuitem', { name: /^Restore/ }).click()
    await expect
      .poll(() => localApi.versioning.restores)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[2]!.id]])
    expect(calls.closeProject).toHaveLength(0)
    expect(calls.openProject).toHaveLength(0)
  })

  test('the latest version cannot be restored', async ({ page, drivePage }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 0)
    await expect(menu.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /^Restore/ })).toHaveCount(0)
  })

  test('restoring an open project closes it, restores, and opens it again', async ({
    page,
    drivePage,
    localApi,
  }) => {
    const calls = localApi.trackCalls()
    await drivePage.goToCategory
      .local()
      .driveTable.openProject('Mock Project')
      .expectProjectEditorOpened('Mock Project')
      .goToPage.drive()
      .driveTable.clickRow('Mock Project')
    expect(calls.openProject).toHaveLength(1)
    await openVersions(page)
    const menu = await openVersionMenu(page, 2)
    await menu.getByRole('menuitem', { name: /^Restore/ }).click()
    await expect
      .poll(() => localApi.versioning.restores)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[2]!.id]])
    expect(calls.closeProject).toHaveLength(1)
    await expect.poll(() => calls.openProject.length).toBe(2)
  })

  test('in the graph editor, lists the opened project’s versions', async ({ page, drivePage }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.openProject('Mock Project')
      .expectProjectEditorOpened('Mock Project')
    const panel = await openVersions(page)
    await expect(panel.getByText(/^(Joined the sales table|Saved on close|Saved)$/)).toHaveText([
      'Joined the sales table',
      'Saved on close',
      'Saved',
    ])
    await expect(panel).not.toContainText('Select a single asset')
  })

  test('restoring from the graph editor opens the project again, in front', async ({
    page,
    drivePage,
    localApi,
  }) => {
    const calls = localApi.trackCalls()
    await drivePage.goToCategory
      .local()
      .driveTable.openProject('Mock Project')
      .expectProjectEditorOpened('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 2)
    await menu.getByRole('menuitem', { name: /^Restore/ }).click()
    await expect
      .poll(() => localApi.versioning.restores)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[2]!.id]])
    expect(calls.closeProject).toHaveLength(1)
    await expect.poll(() => calls.openProject.length).toBe(2)
    await expect(page.getByRole('tab', { name: 'Mock Project' })).toHaveClass(/selected/)
    await expect(locate.graphEditor(page)).toBeVisible()
  })

  test('duplicates a version into the same folder', async ({ page, drivePage, localApi }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 1)
    await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
    await expect
      .poll(() => localApi.versioning.duplicates)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[1]!.id, 'Mock Project']])
    await expect(page.getByTestId('drive-view').getByText('Mock Project (copy)')).toBeVisible()
  })

  test('duplicates a version and opens the copy', async ({ page, drivePage, localApi }) => {
    const calls = localApi.trackCalls()
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    await openVersions(page)
    const menu = await openVersionMenu(page, 1)
    await menu.getByRole('menuitem', { name: 'Duplicate and open' }).click()
    await expect
      .poll(() => localApi.versioning.duplicates)
      .toEqual([[MOCK_PROJECT_PATH, VERSIONS[1]!.id, 'Mock Project']])
    await expect.poll(() => calls.openProject.length).toBe(1)
    await expect(page.getByRole('tab', { name: 'Mock Project (copy)' })).toBeVisible()
  })

  test('a comment is edited', async ({ page, drivePage, localApi }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    const panel = await openVersions(page)
    await panel.getByRole('button', { name: 'Edit comment' }).last().click()
    const comment = panel.locator('textarea')
    await comment.fill('The first draft')
    await comment.press('Enter')
    await expect(panel.getByText('The first draft')).toBeVisible()
    await expect
      .poll(() => localApi.versioning.versions.get(MOCK_PROJECT_PATH)?.at(-1)?.comment)
      .toBe('The first draft')
  })

  test('a comment is cleared by saving it empty', async ({ page, drivePage, localApi }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    const panel = await openVersions(page)
    await panel.getByRole('button', { name: 'Edit comment' }).last().click()
    const comment = panel.locator('textarea')
    await comment.fill('')
    await comment.press('Enter')
    await expect(panel.getByText('Saved', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Add comment' })).toHaveCount(1)
    await expect
      .poll(() => localApi.versioning.versions.get(MOCK_PROJECT_PATH)?.at(-1)?.comment)
      .toBe('')
  })
})

test.describe('placeholders', () => {
  test.describe('with a folder', () => {
    test.use({
      setupApi: { local: (api) => void api.addDirectory({ path: Path(`${ROOT}/Data`) }) },
    })

    test('a folder: only projects have versions', async ({ page, drivePage }) => {
      await drivePage.goToCategory.local().driveTable.clickRow('Data')
      const panel = await openVersions(page)
      await expect(panel).toContainText('In the local drive, only projects have versions.')
    })
  })

  test.describe('with a file', () => {
    test.use({
      setupApi: { local: (api) => void api.addFile({ path: Path(`${ROOT}/notes.txt`) }) },
    })

    test('a file: only projects have versions', async ({ page, drivePage }) => {
      await drivePage.goToCategory.local().driveTable.clickRow('notes.txt')
      const panel = await openVersions(page)
      await expect(panel).toContainText('In the local drive, only projects have versions.')
    })
  })

  test.describe('with git and no repository', () => {
    test.use({ setupApi: { local: (api) => void (api.versioning.git = true) } })

    test('says the project is in no repository', async ({ page, drivePage }) => {
      await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
      const panel = await openVersions(page)
      await expect(panel).toContainText(
        'This project is not in a git repository, so it has no versions.',
      )
    })
  })

  test.describe('with a repository that is not enabled', () => {
    test.use({
      setupApi: {
        local: (api) => {
          api.versioning.git = true
          api.versioning.repoRoot = ROOT
        },
      },
    })

    test('says versions are not kept', async ({ page, drivePage }) => {
      await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
      const panel = await openVersions(page)
      await expect(panel).toContainText("Versions are not kept in this project's git repository.")
    })
  })

  test('without git, says to install it', async ({ page, drivePage }) => {
    await drivePage.goToCategory.local().driveTable.clickRow('Mock Project')
    const panel = await openVersions(page)
    await expect(panel).toContainText('Install git to keep versions of local projects.')
  })
})

test('the cloud Versions tab still works: a directory has no versions', async ({
  page,
  drivePage,
  cloudApi,
}) => {
  test.skip(true, CLOUD_ONLY)
  cloudApi.addDirectory({ title: 'Cloud folder' })
  await drivePage.goToCategory.cloud().driveTable.clickRow('Cloud folder')
  const panel = await openVersions(page)
  await expect(panel).not.toContainText('In the local drive')
  await expect(panel).toContainText(
    'Versions are available for projects, files and datalinks only.',
  )
})
