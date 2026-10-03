/**
 * @file The "copy instead" question (`CopyInsteadModal.vue`, #192), on every path that asks it:
 * moving assets out of a team's folder (to another team, to the user's folder, to the local drive)
 * and restoring a team's assets from the trash into another category. Both answers are checked
 * against the requests the mocked cloud receives and the listings it then serves; cancelling does
 * nothing at all (#200).
 */
import { FilterBy, type DirectoryId } from 'enso-common/src/services/Backend'
import { expect, test, type Page } from 'integration-test/base'
import type { MockCloudApi } from 'integration-test/mock/cloudApi'
import { TEXT } from '../actions'

const TEAM_A = 'Team Alpha'
const TEAM_B = 'Team Beta'
const ASSET = 'Shared Folder'
const PROJECT = 'Shared Project'

/**
 * The cloud's requests that change something, seen by the browser: anything but a `GET`, except
 * the usage events (`POST /logs`) that production builds send, which change no asset.
 */
function recordWrites(page: Page) {
  const writes: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === 'https://mock' && request.method() !== 'GET' && url.pathname !== '/logs') {
      writes.push(`${request.method()} ${url.pathname}`)
    }
  })
  return writes
}

const dialog = (page: Page) => page.getByRole('alertdialog', { name: TEXT.actionUnavailable })

/**
 * Check the question's text, then answer it. (The row is clicked before it is dragged: a drag that
 * starts on an unselected row selects text instead, as in `copy.spec.ts`.)
 */
async function answer(page: Page, button: 'copy' | 'cancel', message: string, description: string) {
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText(message)
  await expect(dialog(page)).toContainText(description)
  await dialog(page)
    .getByRole('button', { name: button === 'copy' ? TEXT.copyInstead : TEXT.cancel, exact: true })
    .click()
  await expect(dialog(page)).toBeHidden()
}

const movingFromA = TEXT.copyInsteadOfMoving.replace('$0', TEAM_A)

/** Two teams, with a folder and a project in the first. */
function setupTeams(cloudApi: MockCloudApi) {
  const teamA = cloudApi.addTeam(TEAM_A)
  const teamB = cloudApi.addTeam(TEAM_B)
  const folder = cloudApi.addDirectory({ title: ASSET, parentId: teamA.homeDirectoryId })
  const project = cloudApi.addProject({ title: PROJECT, parentId: teamA.homeDirectoryId })
  return { teamA, teamB, folder, project }
}

/** The titles the mocked cloud lists in a directory (not deleted). */
function titlesIn(cloudApi: MockCloudApi, parentId: DirectoryId) {
  // The query's keys are the API's own, in snake case.
  // eslint-disable-next-line camelcase
  const query = { parent_id: parentId, filter_by: FilterBy.active }
  return cloudApi
    .listDirectory(query)
    .map((asset) => asset.title)
    .sort()
}

test.describe('the "copy instead" question', () => {
  let teams: ReturnType<typeof setupTeams>
  test.use({
    setupApi: {
      cloud: (cloudApi) => {
        teams = setupTeams(cloudApi)
      },
    },
  })

  for (const answerWith of ['copy', 'cancel'] as const) {
    test(`moving from a team to another team: ${answerWith}`, async ({
      page,
      drivePage,
      cloudApi,
    }) => {
      const writes = recordWrites(page)
      const calls = cloudApi.trackCalls()
      await drivePage
        .goToCategoryNamed(TEAM_A, `team-${teams.teamA.id}`)
        .driveTable.clickRow(ASSET)
        .driveTable.dragRowToCategory(ASSET, TEAM_B)
        .do(async () => {
          await answer(page, answerWith, movingFromA, TEXT.youCanCopyInstead)
        })
        .do(async () => {
          if (answerWith === 'copy') {
            await expect
              .poll(() => calls.copyAsset)
              .toEqual([{ assetId: teams.folder.id, parentId: teams.teamB.homeDirectoryId }])
            expect(titlesIn(cloudApi, teams.teamB.homeDirectoryId)).toEqual([`${ASSET} (copy)`])
          } else {
            // Give a stray request time to be sent.
            await page.waitForTimeout(500)
            expect(writes).toEqual([])
            expect(calls.copyAsset).toEqual([])
            expect(calls.updateAsset).toEqual([])
            expect(titlesIn(cloudApi, teams.teamB.homeDirectoryId)).toEqual([])
          }
          expect(calls.updateAsset).toEqual([])
          expect(titlesIn(cloudApi, teams.teamA.homeDirectoryId)).toEqual([ASSET, PROJECT].sort())
        })
        .goToCategoryNamed(TEAM_B, `team-${teams.teamB.id}`)
        .driveTable.withRows(async (rows, nonAssetRows) => {
          if (answerWith === 'copy') {
            await expect(rows).toHaveText([new RegExp(`^${ASSET} \\(copy\\)`)])
          } else {
            await expect(rows).toHaveCount(0)
            await expect(nonAssetRows).toHaveCount(1)
          }
        })
    })

    test(`moving from a team to the user's folder: ${answerWith}`, async ({
      page,
      drivePage,
      cloudApi,
    }) => {
      const writes = recordWrites(page)
      const calls = cloudApi.trackCalls()
      await drivePage
        .goToCategoryNamed(TEAM_A, `team-${teams.teamA.id}`)
        .driveTable.clickRow(ASSET)
        .driveTable.dragRowToCategory(ASSET, 'Cloud')
        .do(async () => {
          await answer(page, answerWith, movingFromA, TEXT.youCanCopyInstead)
          if (answerWith === 'copy') {
            await expect
              .poll(() => calls.copyAsset)
              .toEqual([{ assetId: teams.folder.id, parentId: cloudApi.rootDirectoryId }])
          } else {
            await page.waitForTimeout(500)
            expect(writes).toEqual([])
            expect(calls.copyAsset).toEqual([])
          }
          expect(calls.updateAsset).toEqual([])
          expect(titlesIn(cloudApi, teams.teamA.homeDirectoryId)).toEqual([ASSET, PROJECT].sort())
        })
        .goToCategory.cloud()
        .driveTable.withRows(async (rows) => {
          if (answerWith === 'copy') {
            await expect(rows).toHaveText([new RegExp(`^${ASSET} \\(copy\\)`)])
          } else {
            await expect(rows).toHaveCount(0)
          }
        })
    })

    test(`moving a team's project to the local drive (#14797): ${answerWith}`, async ({
      page,
      drivePage,
      cloudApi,
    }) => {
      const writes = recordWrites(page)
      const calls = cloudApi.trackCalls()
      const downloads: string[] = []
      page.on('download', (download) => downloads.push(download.suggestedFilename()))
      await drivePage
        .goToCategoryNamed(TEAM_A, `team-${teams.teamA.id}`)
        .driveTable.clickRow(PROJECT)
        .driveTable.dragRowToCategory(PROJECT, 'Local')
        .do(async () => {
          await answer(page, answerWith, movingFromA, TEXT.youCanCopyInstead)
          if (answerWith === 'copy') {
            // The project is downloaded from its presigned URL, and the toast reports it.
            await expect
              .poll(() => calls.getProjectDetails)
              .toEqual([{ projectId: teams.project.id, presigned: true }])
            await expect.poll(() => downloads.length).toBe(1)
            await expect.poll(() => calls.s3Get.length).toBe(1)
            await expect(page.getByText(TEXT.downloadProjectToLocalSuccess)).toBeVisible()
          } else {
            await page.waitForTimeout(500)
            expect(calls.getProjectDetails).toEqual([])
            expect(downloads).toEqual([])
            expect(calls.s3Get).toEqual([])
          }
          // Downloading changes nothing in the cloud.
          expect(writes).toEqual([])
          expect(calls.copyAsset).toEqual([])
          expect(calls.updateAsset).toEqual([])
          expect(titlesIn(cloudApi, teams.teamA.homeDirectoryId)).toEqual([ASSET, PROJECT].sort())
        })
    })

    test(`restoring a team's asset from the trash into the user's folder: ${answerWith}`, async ({
      page,
      drivePage,
      cloudApi,
    }) => {
      cloudApi.deleteAsset(teams.folder.id)
      const writes = recordWrites(page)
      const calls = cloudApi.trackCalls()
      await drivePage.goToCategory
        .trash()
        .driveTable.clickRow(ASSET)
        .driveTable.dragRowToCategory(ASSET, 'Cloud')
        .do(async () => {
          await answer(
            page,
            answerWith,
            TEXT.copyInsteadOfRestoring.replace('$0', TEAM_A).replace('$1', 'Cloud'),
            TEXT.copyInsteadOfRestoringDescription.replace('$1', 'Cloud'),
          )
          if (answerWith === 'copy') {
            await expect
              .poll(() => calls.copyAsset)
              .toEqual([{ assetId: teams.folder.id, parentId: cloudApi.rootDirectoryId }])
          } else {
            await page.waitForTimeout(500)
            expect(writes).toEqual([])
            expect(calls.copyAsset).toEqual([])
          }
          // It is never restored: it stays in the trash.
          expect(calls.undoDeleteAsset).toEqual([])
        })
        .driveTable.withRows(async (rows) => {
          await expect(rows).toHaveText([new RegExp(`^${ASSET}`)])
        })
    })
  }
})
