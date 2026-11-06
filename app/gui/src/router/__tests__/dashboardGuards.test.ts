import * as container from '$/providers/container'
import {
  type AnyRealAsset,
  AssetType,
  type DirectoryId,
  type ListDirectoryRequestParams,
  Path,
} from 'enso-common/src/services/Backend'
import { beforeEach, expect, test } from 'vitest'
import {
  LOCAL_WELCOME_PROJECT_RELATIVE_PATH,
  WELCOME_PROJECT_OPENED_KEY,
  welcomeProjectPath,
} from '../dashboardGuards'

// keep import registerting local storage key
const _ = container
const LOCAL_ROOT_PATH = '/home/user/Documents/enso-projects'
const LOCAL_WELCOME_PROJECT = `/home/user/Documents/enso-projects/${LOCAL_WELCOME_PROJECT_RELATIVE_PATH}`
const SAMPLES_ID = 'directory-samples' as DirectoryId

interface AssetEntry {
  type: AssetType
  title: string
  id?: DirectoryId
}

/** The installed `Samples` folder, holding the given projects. */
const SAMPLES = { type: AssetType.directory, title: 'Samples', id: SAMPLES_ID }
const BUNDLED_SAMPLES = ['Getting_Started', 'Sales_Overview'].map((title) => ({
  type: AssetType.project,
  title,
}))

/** A local backend whose home holds `localHome`, and whose `Samples` holds `inSamples`. */
function mockBackends(localHome: AssetEntry[] = [], inSamples: AssetEntry[] = BUNDLED_SAMPLES) {
  return {
    localBackend: {
      rootPath: () => Path(LOCAL_ROOT_PATH),
      listDirectory: ({ parentId }: ListDirectoryRequestParams) =>
        Promise.resolve({
          assets: (parentId === SAMPLES_ID ? inSamples : localHome) as AnyRealAsset[],
          paginationToken: null,
        }),
    },
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

test('the welcome project is the bundled Getting_Started sample', () => {
  // The sample is `app/electron-client/samples/Getting_Started`, installed into `Samples`.
  expect(LOCAL_WELCOME_PROJECT_RELATIVE_PATH).toBe('Samples/Getting_Started')
})

test('a fresh install, holding only the installed Samples, opens the welcome project', async () => {
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES]))).toBe(LOCAL_WELCOME_PROJECT)
})

test('the welcome project opens on the first start only', async () => {
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES]))).toBe(LOCAL_WELCOME_PROJECT)
  expect(window.localStorage.getItem(WELCOME_PROJECT_OPENED_KEY)).not.toBeNull()
  // The second start: still nothing but Samples, but the welcome project was already opened.
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES]))).toBeUndefined()
})

test('a Samples folder without Getting_Started opens nothing', async () => {
  // Installed by an earlier build: samples are copied only when `Samples` is missing.
  const older = BUNDLED_SAMPLES.filter((sample) => sample.title !== 'Getting_Started')
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES], older))).toBeUndefined()
  expect(window.localStorage.getItem(WELCOME_PROJECT_OPENED_KEY)).toBeNull()
})

test('an empty home, or a file named Samples, opens nothing', async () => {
  expect(await welcomeProjectPath(undefined, mockBackends())).toBeUndefined()
  const file = [{ type: AssetType.file, title: 'Samples' }]
  expect(await welcomeProjectPath(undefined, mockBackends(file))).toBeUndefined()
})

test('a local home with more than Samples opens nothing', async () => {
  const home = [{ type: AssetType.project, title: 'Mine' }]
  expect(await welcomeProjectPath(undefined, mockBackends(home))).toBeUndefined()
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES, ...home]))).toBeUndefined()
})

test('a Drive that was browsed opens nothing', async () => {
  window.localStorage.setItem('enso-current-directory-id', 'directory-x')
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES]))).toBeUndefined()
})

test('--no-welcome-project opens nothing', async () => {
  expect(await welcomeProjectPath(undefined, mockBackends([SAMPLES]), false)).toBeUndefined()
  expect(window.localStorage.getItem(WELCOME_PROJECT_OPENED_KEY)).toBeNull()
})

test('a project named on the command line opens from the local root', async () => {
  expect(await welcomeProjectPath('Name', mockBackends())).toBe(`${LOCAL_ROOT_PATH}/Name`)
  expect(
    await welcomeProjectPath('file:///home/user/Name.enso-project', mockBackends()),
  ).toBeUndefined()
})
