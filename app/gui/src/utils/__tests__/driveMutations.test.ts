/**
 * @file The drive's batched mutations (#192): their keys and invalidations, how failures are
 * collected, and the move's injected duplicate resolver.
 */
import type { ResolvedDuplication } from '$/components/Drive/duplicateAssets'
import { executeMutation } from '$/utils/backendQuery'
import {
  copyAssetsMutationOptions,
  deleteAssetsMutationOptions,
  downloadAssetsMutationOptions,
  moveAssetsMutationOptions,
  restoreAssetsMutationOptions,
} from '$/utils/driveMutations'
import { newFolderTitle, newProjectName, renameAssetVariables } from '$/utils/driveQueries'
import { QueryClient } from '@tanstack/query-core'
import {
  AssetType,
  BackendType,
  DirectoryId,
  DuplicateAssetError,
  type AnyAsset,
  type AssetId,
  type Backend,
} from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'

const TARGET = DirectoryId('directory-target')
const ids = ['file-1', 'file-2', 'file-3'] as AssetId[]

function backendWith(methods: Partial<Backend>) {
  return { type: BackendType.remote, ...methods } as Backend
}

describe('the batched mutations', () => {
  test('keep their keys and invalidations', () => {
    const backend = backendWith({})
    expect(deleteAssetsMutationOptions(backend).mutationKey).toEqual([
      BackendType.remote,
      'deleteAssets',
    ])
    expect(deleteAssetsMutationOptions(backend).meta).toEqual({
      invalidates: [
        [BackendType.remote, 'listDirectory'],
        [BackendType.remote, 'getAssetDetails'],
        [BackendType.remote, 'listAssetVersions'],
      ],
      awaitInvalidates: true,
      refetchType: 'all',
    })
    expect(restoreAssetsMutationOptions(backend).mutationKey).toEqual([
      BackendType.remote,
      'restoreAssets',
    ])
    expect(copyAssetsMutationOptions(backend).mutationKey).toEqual([
      BackendType.remote,
      'copyAssets',
    ])
    expect(moveAssetsMutationOptions(backend, vi.fn()).mutationKey).toEqual([
      BackendType.remote,
      'moveAssets',
    ])
    expect(downloadAssetsMutationOptions(backend).meta?.invalidates).toEqual([
      [BackendType.remote, 'listDirectory'],
      [BackendType.local, 'listDirectory'],
    ])
  })

  test('try every asset, then fail with all the errors and their count', async () => {
    const deleteAsset = vi.fn<Backend['deleteAsset']>((id) =>
      id === 'file-2' ? Promise.reject(new Error('locked')) : Promise.resolve(),
    )
    const options = deleteAssetsMutationOptions(backendWith({ deleteAsset }))
    const error = await executeMutation(new QueryClient(), options, [ids, true]).catch(
      (caught: unknown) => caught,
    )
    expect(deleteAsset).toHaveBeenCalledTimes(3)
    expect(deleteAsset).toHaveBeenCalledWith('file-1', { force: true }, '(unknown)')
    expect(error).toMatchObject({ message: 'locked', failed: 1, total: 3 })
  })

  test('copy resolves with the copies', async () => {
    const copyAsset = vi.fn((id: AssetId) => Promise.resolve({ id: `copy-of-${id}` }))
    const options = copyAssetsMutationOptions(backendWith({ copyAsset } as Partial<Backend>))
    await expect(
      executeMutation(new QueryClient(), options, [ids.slice(0, 2), TARGET]),
    ).resolves.toEqual([{ id: 'copy-of-file-1' }, { id: 'copy-of-file-2' }])
  })

  test('downloads one asset after the other', async () => {
    const order: string[] = []
    const download = vi.fn(async (id: string) => {
      order.push(`start ${id}`)
      await Promise.resolve()
      order.push(`end ${id}`)
    })
    const options = downloadAssetsMutationOptions(backendWith({ download } as Partial<Backend>))
    await executeMutation(new QueryClient(), options, {
      ids: [
        { id: ids[0]!, title: 'a' },
        { id: ids[1]!, title: 'b' },
      ],
      targetDirectoryId: TARGET,
    })
    expect(order).toEqual(['start file-1', 'end file-1', 'start file-2', 'end file-2'])
  })
})

describe('moving assets', () => {
  test('asks the injected resolver about the names taken, and moves the renamed ones', async () => {
    const updateAsset = vi.fn<Backend['updateAsset']>((id, body) =>
      body.title == null && id !== 'file-1' ?
        Promise.reject(new DuplicateAssetError('taken'))
      : Promise.resolve(),
    )
    const resolutions: ResolvedDuplication[] = [
      { assetId: ids[1]!, conclusion: 'rename', newName: 'file-2 (2)' },
      { assetId: ids[2]!, conclusion: 'skip' },
    ]
    const resolveDuplications = vi.fn(() => Promise.resolve(resolutions))
    const options = moveAssetsMutationOptions(backendWith({ updateAsset }), resolveDuplications)
    await executeMutation(new QueryClient(), options, [ids, TARGET])
    expect(resolveDuplications).toHaveBeenCalledWith({
      targetId: TARGET,
      conflictingIds: ['file-2', 'file-3'],
    })
    expect(updateAsset).toHaveBeenCalledWith(
      'file-2',
      { parentDirectoryId: TARGET, description: null, title: 'file-2 (2)', metadataId: null },
      'file-2 (2)',
    )
    // The skipped asset is not moved again.
    expect(updateAsset.mock.calls.filter(([id]) => id === 'file-3')).toHaveLength(1)
  })

  test('does not ask when no name is taken', async () => {
    const resolveDuplications = vi.fn()
    const updateAsset = vi.fn<Backend['updateAsset']>(() => Promise.resolve())
    const options = moveAssetsMutationOptions(backendWith({ updateAsset }), resolveDuplications)
    await executeMutation(new QueryClient(), options, [ids, TARGET])
    expect(resolveDuplications).not.toHaveBeenCalled()
  })

  test('fails, with every other error, once the duplicates are resolved', async () => {
    const updateAsset = vi.fn<Backend['updateAsset']>(() => Promise.reject(new Error('offline')))
    const options = moveAssetsMutationOptions(backendWith({ updateAsset }), vi.fn())
    await expect(
      executeMutation(new QueryClient(), options, [ids.slice(0, 2), TARGET]),
    ).rejects.toMatchObject({ failed: 2, total: 2 })
  })
})

describe('the names of new assets', () => {
  const asset = (type: AssetType, title: string) => ({ type, title }) as AnyAsset

  test('a new folder is numbered one above the highest "New Folder N"', () => {
    expect(newFolderTitle([])).toBe('New Folder 1')
    expect(
      newFolderTitle([
        asset(AssetType.directory, 'New Folder 2'),
        asset(AssetType.directory, 'New Folder 7'),
        asset(AssetType.project, 'New Folder 9'),
      ]),
    ).toBe('New Folder 8')
  })

  test("a new project is numbered after its template's projects", () => {
    expect(newProjectName([asset(AssetType.project, 'New Project 3')], null)).toBe('New Project 4')
    expect(
      newProjectName(
        [asset(AssetType.project, 'Colorado COVID 1'), asset(AssetType.project, 'New Project 3')],
        'Colorado COVID',
      ),
    ).toBe('Colorado COVID 2')
  })

  test('renaming changes only the title', () => {
    expect(renameAssetVariables(ids[0]!, 'Renamed')).toEqual([
      'file-1',
      { title: 'Renamed', parentDirectoryId: null, description: null, metadataId: null },
      'file-1',
    ])
  })
})
