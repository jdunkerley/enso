/** @file Local datalinks: listing, create/update/read/delete, rename and download by file path. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Rfc3339DateTime } from '../../utilities/data/dateTime'
import { AssetType, extractTypeAndPath } from '../Backend'
import { newDatalinkId, newDirectoryId, newFileId } from '../LocalBackend'
import { Path } from '../ProjectManager/types'
import { makeLocalBackend } from './localBackendTestUtils'

const ATTRIBUTES = {
  creationTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastAccessTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastModifiedTime: Rfc3339DateTime('2026-01-02T00:00:00.000Z'),
  byteSize: 12,
}
const LINK = Path('/root/Sales.datalink')
const VALUE = { type: 'S3', libraryName: 'Standard.AWS', uri: 's3://b/k' }
const LIST_QUERY = {
  filterBy: null,
  labels: null,
  recentProjects: false,
  from: null,
  pageSize: null,
  sortDirection: null,
  sortExpression: null,
} as const

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('local datalinks', () => {
  it('a datalink id round-trips its path', () => {
    expect(extractTypeAndPath(newDatalinkId(LINK))).toEqual({
      type: AssetType.datalink,
      path: LINK,
    })
  })

  it('lists a DatalinkEntry as a datalink asset titled without its extension', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'listDirectory').mockResolvedValue([
      { type: 'DatalinkEntry', path: LINK, attributes: ATTRIBUTES },
    ])
    const { assets } = await localBackend.listDirectory({
      ...LIST_QUERY,
      parentId: newDirectoryId(Path('/root')),
    })
    expect(assets).toEqual([
      expect.objectContaining({
        type: AssetType.datalink,
        id: newDatalinkId(LINK),
        title: 'Sales',
        modifiedAt: ATTRIBUTES.lastModifiedTime,
        parentId: newDirectoryId(Path('/root')),
      }),
    ])
  })

  it('creates <name>.datalink in the parent folder', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const create = vi.spyOn(projectManager, 'createDatalink').mockResolvedValue()
    const info = await localBackend.createDatalink({
      name: 'Sales',
      value: VALUE,
      parentDirectoryId: newDirectoryId(Path('/root')),
      datalinkId: null,
    })
    expect(create).toHaveBeenCalledExactlyOnceWith(LINK, VALUE)
    expect(info).toEqual({ id: newDatalinkId(LINK) })
  })

  it('with a datalinkId, rewrites that file in place', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const update = vi.spyOn(projectManager, 'updateDatalink').mockResolvedValue()
    const create = vi.spyOn(projectManager, 'createDatalink')
    const id = newDatalinkId(LINK)
    expect(
      await localBackend.createDatalink({
        name: 'Sales',
        value: VALUE,
        parentDirectoryId: null,
        datalinkId: id,
      }),
    ).toEqual({ id })
    expect(update).toHaveBeenCalledExactlyOnceWith(LINK, VALUE)
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses a name with a path separator', async () => {
    const { localBackend } = makeLocalBackend()
    await expect(
      localBackend.createDatalink({
        name: 'a/b',
        value: VALUE,
        parentDirectoryId: null,
        datalinkId: null,
      }),
    ).rejects.toThrow("A datalink's name cannot contain '/' or '\\'.")
  })

  it('reads and deletes by path, through deleteDatalink and deleteAsset alike', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'readDatalink').mockResolvedValue(VALUE)
    const remove = vi.spyOn(projectManager, 'deleteDatalink').mockResolvedValue()
    expect(await localBackend.getDatalink(newDatalinkId(LINK), 'Sales')).toEqual(VALUE)
    await localBackend.deleteDatalink(newDatalinkId(LINK), 'Sales')
    await localBackend.deleteAsset(newDatalinkId(LINK), { force: true }, 'Sales')
    expect(remove.mock.calls).toEqual([[LINK], [LINK]])
  })

  it('renaming keeps the extension', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const move = vi.spyOn(projectManager, 'moveFile').mockResolvedValue()
    await localBackend.updateAsset(newDatalinkId(LINK), {
      title: 'Revenue',
      parentDirectoryId: null,
      description: null,
      metadataId: null,
    })
    expect(move).toHaveBeenCalledExactlyOnceWith(LINK, Path('/root/Revenue.datalink'))
  })

  it('renaming to a name already ending in .datalink does not double the extension', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const move = vi.spyOn(projectManager, 'moveFile').mockResolvedValue()
    await localBackend.updateAsset(newDatalinkId(LINK), {
      title: 'Revenue.datalink',
      parentDirectoryId: null,
      description: null,
      metadataId: null,
    })
    expect(move).toHaveBeenCalledExactlyOnceWith(LINK, Path('/root/Revenue.datalink'))
  })

  it.each(['a/b', 'a\\b'])('refuses to rename a datalink to %j', async (title) => {
    const { projectManager, localBackend } = makeLocalBackend()
    const move = vi.spyOn(projectManager, 'moveFile').mockResolvedValue()
    await expect(
      localBackend.updateAsset(newDatalinkId(LINK), {
        title,
        parentDirectoryId: null,
        description: null,
        metadataId: null,
      }),
    ).rejects.toThrow("A datalink's name cannot contain '/' or '\\'.")
    expect(move).not.toHaveBeenCalled()
  })

  it('creating with a name already ending in .datalink does not double the extension', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const create = vi.spyOn(projectManager, 'createDatalink').mockResolvedValue()
    await localBackend.createDatalink({
      name: 'Sales.datalink',
      value: VALUE,
      parentDirectoryId: newDirectoryId(Path('/root')),
      datalinkId: null,
    })
    expect(create).toHaveBeenCalledExactlyOnceWith(LINK, VALUE)
  })

  it('downloads the file itself, by its file id', async () => {
    const downloader = vi.fn()
    const { localBackend } = makeLocalBackend({ downloader })
    const details = vi.spyOn(localBackend, 'getFileDetails').mockResolvedValue({
      file: { fileId: newFileId(LINK), fileName: 'Sales.datalink', path: '' },
      metadata: { size: 12 },
      url: 'files/x/download',
    } as never)
    await localBackend.download(newDatalinkId(LINK), 'Sales', null)
    expect(details).toHaveBeenCalledExactlyOnceWith(newFileId(LINK), 'Sales', true)
    expect(downloader).toHaveBeenCalledExactlyOnceWith({
      url: 'files/x/download',
      name: 'Sales.datalink',
      electronOptions: { path: null, showFileDialog: true },
    })
  })
})
