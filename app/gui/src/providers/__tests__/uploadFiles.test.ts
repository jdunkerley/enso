/**
 * @file Uploading files into a drive directory (#192): on the local backend through its two
 * mutations, on the cloud through the uploads store, with name conflicts resolved first.
 */
import type { ResolvedDuplication } from '$/components/Drive/duplicateAssets'
import { uploadFiles, type UploadFilesContext } from '$/providers/upload'
import { QueryClient } from '@tanstack/query-core'
import {
  AssetType,
  BackendType,
  DirectoryId,
  type AnyAsset,
  type Backend,
  type UploadedAsset,
} from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'

const PARENT = DirectoryId('directory-parent')

function existing(title: string, type = AssetType.file) {
  return { id: `${type}-existing-${title}`, title, type, parentId: PARENT } as unknown as AnyAsset
}

function context(
  type: BackendType,
  siblings: readonly AnyAsset[],
  resolutions: ResolvedDuplication[] = [],
) {
  let nextId = 1
  const uploaded = (): UploadedAsset => ({ id: `file-${nextId++}`, jobId: null }) as never
  const backend = {
    type,
    listDirectory: vi.fn(() => Promise.resolve({ assets: siblings })),
    uploadFileStart: vi.fn(() => Promise.resolve({ uploadId: 'upload-1', sourcePath: 'path' })),
    uploadFileEnd: vi.fn(() => Promise.resolve(uploaded())),
  }
  const result = {
    queryClient: new QueryClient(),
    backend: backend as unknown as Backend,
    category: type === BackendType.local ? 'local' : 'cloud',
    uploadToCloud: vi.fn(() => Promise.resolve(uploaded())),
    resolveDuplications: vi.fn(() => Promise.resolve(resolutions)),
    onUploaded: vi.fn(),
  } satisfies UploadFilesContext
  return { ...result, backendMethods: backend }
}

const file = (name: string) => new File(['contents'], name)

describe('uploadFiles', () => {
  test('uploads to the local backend with its start and end mutations, and selects the files', async () => {
    const ctx = context(BackendType.local, [])
    await uploadFiles(ctx, [file('a.csv'), file('b.csv')], PARENT)
    expect(ctx.backendMethods.uploadFileStart).toHaveBeenCalledTimes(2)
    expect(ctx.backendMethods.uploadFileEnd).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: 'upload-1', parts: [], fileName: 'b.csv' }),
    )
    expect(ctx.uploadToCloud).not.toHaveBeenCalled()
    expect(ctx.resolveDuplications).not.toHaveBeenCalled()
    expect(ctx.onUploaded).toHaveBeenLastCalledWith([
      expect.objectContaining({ type: AssetType.file, parentId: PARENT }),
      expect.objectContaining({ type: AssetType.file, parentId: PARENT }),
    ])
  })

  test('uploads to the cloud through the uploads store, a project under its own name', async () => {
    const ctx = context(BackendType.remote, [])
    await uploadFiles(ctx, [file('Analysis.enso-project')], PARENT)
    expect(ctx.uploadToCloud).toHaveBeenCalledWith(
      expect.any(File),
      { fileId: null, fileName: 'Analysis.enso-project', parentDirectoryId: PARENT },
      'requestedByUser',
    )
    expect(ctx.onUploaded).toHaveBeenCalledWith([
      expect.objectContaining({ type: AssetType.project, title: 'Analysis' }),
    ])
  })

  test('asks about the names already taken: renames, replaces or skips each file', async () => {
    const taken = [existing('a.csv'), existing('b.csv'), existing('c.csv')]
    const ctx = context(BackendType.remote, taken, [
      { assetId: taken[0]!.id, conclusion: 'rename', newName: 'a (2).csv' },
      { assetId: taken[1]!.id, conclusion: 'replace' },
      { assetId: taken[2]!.id, conclusion: 'skip' },
    ])
    await uploadFiles(ctx, [file('a.csv'), file('b.csv'), file('c.csv'), file('d.csv')], PARENT)
    expect(ctx.resolveDuplications).toHaveBeenCalledWith({
      targetId: PARENT,
      conflictingIds: [taken[2]!.id, taken[1]!.id, taken[0]!.id],
    })
    const uploads = ctx.uploadToCloud.mock.calls.map(([, params]) => params)
    expect(uploads).toEqual(
      expect.arrayContaining([
        { fileId: null, fileName: 'd.csv', parentDirectoryId: PARENT },
        { fileId: taken[1]!.id, fileName: 'b.csv', parentDirectoryId: PARENT },
        { fileId: null, fileName: 'a (2).csv', parentDirectoryId: PARENT },
      ]),
    )
    expect(uploads).toHaveLength(3)
  })
})
