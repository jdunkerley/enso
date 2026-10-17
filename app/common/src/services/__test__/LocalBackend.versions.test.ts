/** @file `LocalBackend`'s version methods (the right panel's Versions tab) over the shim. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailAddress, S3ObjectVersionId, type AnyAsset } from '../Backend'
import { newDirectoryId, newProjectId } from '../LocalBackend'
import { Path, UUID, type VersionEntry } from '../ProjectManager/types'
import { makeLocalBackend } from './localBackendTestUtils'

const PROJECT = Path('/root/P')
const ID = 'a'.repeat(40)
const ENTRY: VersionEntry = {
  id: ID,
  date: '2026-10-16T10:00:00+01:00',
  author: { name: 'Ada', email: 'ada@example.com' },
  comment: 'Saved',
  isLatest: true,
}
const DUPLICATE = {
  projectId: UUID('11111111-1111-1111-1111-111111111111'),
  projectName: 'P (2)',
  projectPath: Path('/root/P_1'),
  projectNormalizedName: 'P_1',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LocalBackend versions', () => {
  it('lists a project’s versions as S3 object versions, without tags', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'listVersions').mockResolvedValue({ versions: [ENTRY] })
    expect(await localBackend.listAssetVersions(newProjectId(PROJECT))).toEqual({
      versions: [
        {
          versionId: S3ObjectVersionId(ID),
          lastModified: '2026-10-16T10:00:00+01:00',
          isLatest: true,
          key: ID,
          user: { name: 'Ada', email: EmailAddress('ada@example.com') },
          comment: 'Saved',
        },
      ],
    })
    expect(projectManager.listVersions).toHaveBeenCalledWith(PROJECT)
  })

  it('a folder has no versions', async () => {
    const { localBackend } = makeLocalBackend()
    expect(await localBackend.listAssetVersions(newDirectoryId(Path('/root/d')))).toEqual({
      versions: [],
    })
  })

  it('reads a file at a version; without one, from the disk as before', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'versionFileContent').mockResolvedValue('main = 1')
    const getFileContent = vi
      .spyOn(projectManager, 'getFileContent')
      .mockResolvedValue(new Response('main = 2'))
    const id = newProjectId(PROJECT)
    expect(await localBackend.getMainFileContent(id, S3ObjectVersionId(ID))).toBe('main = 1')
    expect(projectManager.versionFileContent).toHaveBeenCalledWith(PROJECT, ID, 'src/Main.enso')
    expect(await localBackend.getMainFileContent(id)).toBe('main = 2')
    expect(getFileContent).toHaveBeenCalledWith(PROJECT, 'src/Main.enso')
  })

  it('restores a version', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'restoreVersion').mockResolvedValue({ id: 'b'.repeat(40) })
    await localBackend.restoreAsset(newProjectId(PROJECT), S3ObjectVersionId(ID))
    expect(projectManager.restoreVersion).toHaveBeenCalledWith(PROJECT, ID)
  })

  it('copyAsset with a version duplicates it into the same folder, under the project’s title', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'duplicateVersion').mockResolvedValue(DUPLICATE)
    const asset = (id: string, title: string) => ({ id, title }) as unknown as AnyAsset
    vi.spyOn(localBackend, 'getAssetDetails').mockImplementation(async (assetId) =>
      assetId === newProjectId(PROJECT) ?
        (asset(assetId, 'P') as never)
      : (asset(assetId, 'P (2)') as never),
    )
    const { asset: copy } = await localBackend.copyAsset(
      newProjectId(PROJECT),
      newDirectoryId(Path('/root')),
      S3ObjectVersionId(ID),
    )
    expect(projectManager.duplicateVersion).toHaveBeenCalledWith(PROJECT, ID, 'P', '/root')
    expect(copy.id).toBe(newProjectId(DUPLICATE.projectPath))
  })

  it('duplicateProject with a version calls duplicate-at', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'duplicateVersion').mockResolvedValue(DUPLICATE)
    const created = await localBackend.duplicateProject(
      newProjectId(PROJECT),
      S3ObjectVersionId(ID),
      'Copy',
    )
    expect(projectManager.duplicateVersion).toHaveBeenCalledWith(PROJECT, ID, 'Copy', '/root')
    expect(created.projectId).toBe(newProjectId(DUPLICATE.projectPath))
  })

  it('a version comment goes to set-comment; null clears it; nothing is moved', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const setComment = vi.spyOn(projectManager, 'setVersionComment').mockResolvedValue()
    const move = vi.spyOn(projectManager, 'moveFile')
    const id = newProjectId(PROJECT)
    await localBackend.updateAsset(id, { versionId: S3ObjectVersionId(ID), comment: 'Mine' }, 'P')
    await localBackend.updateAsset(id, { versionId: S3ObjectVersionId(ID), comment: null }, 'P')
    expect(setComment.mock.calls).toEqual([
      [PROJECT, ID, 'Mine'],
      [PROJECT, ID, ''],
    ])
    expect(move).not.toHaveBeenCalled()
  })

  it('local versions have no tags', async () => {
    const { localBackend } = makeLocalBackend()
    await expect(
      localBackend.updateAsset(
        newProjectId(PROJECT),
        { versionId: S3ObjectVersionId(ID), tag: 'release' },
        'P',
      ),
    ).rejects.toThrow('Local versions have no tags.')
  })
})
