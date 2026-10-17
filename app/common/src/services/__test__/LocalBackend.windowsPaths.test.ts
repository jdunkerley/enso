/**
 * @file On Windows the project manager hands back paths with forward slashes, so a folder is found
 * by its details only when its id is spelt that way too. A folder chosen in the system file
 * dialog comes with backslashes, and has to be normalised before it is used as an id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Rfc3339DateTime } from '../../utilities/data/dateTime'
import { normalizeSlashes } from '../../utilities/file'
import { Path as BackendPath, DirectoryDoesNotExistError } from '../Backend'
import { newDirectoryId } from '../LocalBackend'
import { makeLocalBackend } from './localBackendTestUtils'

const ATTRIBUTES = {
  creationTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastAccessTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastModifiedTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  byteSize: 0,
}

/** The folder as Electron's directory dialog returns it on Windows. */
const DIALOG_PATH = 'C:\\Users\\me\\Empty folder'

describe('the details of a folder on Windows', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function backendListing(parent: string) {
    const { projectManager, localBackend } = makeLocalBackend()
    // The shim builds each entry's path with `path.join`, so on Windows with backslashes.
    vi.spyOn(projectManager as never, 'runStandaloneCommandJson').mockImplementation(((
      _body: unknown,
      command: string,
      target: string,
    ) => {
      if (command === 'filesystem-list' && target === parent) {
        return Promise.resolve({
          entries: [{ type: 'DirectoryEntry', path: DIALOG_PATH, attributes: ATTRIBUTES }],
        })
      }
      return Promise.resolve({ entries: [] })
    }) as never)
    return localBackend
  }

  it('are not found under the path the file dialog returns', async () => {
    const localBackend = backendListing('C:\\Users\\me')
    const path = BackendPath(DIALOG_PATH)
    await expect(localBackend.getAssetDetails(newDirectoryId(path), path)).rejects.toBeInstanceOf(
      DirectoryDoesNotExistError,
    )
  })

  it('are found under the normalised path', async () => {
    const localBackend = backendListing('C:/Users/me')
    const path = normalizeSlashes(DIALOG_PATH)
    const details = await localBackend.getAssetDetails(newDirectoryId(path), path)
    expect(details?.id).toBe(newDirectoryId(path))
    expect(details?.title).toBe('Empty folder')
  })
})
