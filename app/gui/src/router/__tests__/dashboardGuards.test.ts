import * as container from '$/providers/container'
import { type AnyRealAsset, AssetType, Path } from 'enso-common/src/services/Backend'
import { expect, test } from 'vitest'
import { LOCAL_WELCOME_PROJECT_RELATIVE_PATH, welcomeProjectPath } from '../dashboardGuards'

// keep import registerting local storage key
const _ = container
const LOCAL_ROOT_PATH = '/home/user/Documents/enso-projects'
const LOCAL_WELCOME_PROJECT = `/home/user/Documents/enso-projects/${LOCAL_WELCOME_PROJECT_RELATIVE_PATH}`

interface AssetEntry {
  type: AssetType
  title: string
}

function mockBackends(localHome: AssetEntry[] = []) {
  return {
    localBackend: {
      rootPath: () => Path(LOCAL_ROOT_PATH),
      listDirectory: () =>
        Promise.resolve({ assets: localHome as AnyRealAsset[], paginationToken: null }),
    },
  }
}

test('a fresh install opens the local welcome project', async () => {
  expect(await welcomeProjectPath(undefined, mockBackends())).toBe(LOCAL_WELCOME_PROJECT)
})

test('a local home with more than Samples opens nothing', async () => {
  const home = [{ type: AssetType.project, title: 'Mine' }]
  expect(await welcomeProjectPath(undefined, mockBackends(home))).toBeUndefined()
})

test('a project named on the command line opens from the local root', async () => {
  expect(await welcomeProjectPath('Name', mockBackends())).toBe(`${LOCAL_ROOT_PATH}/Name`)
  expect(
    await welcomeProjectPath('file:///home/user/Name.enso-project', mockBackends()),
  ).toBeUndefined()
})
