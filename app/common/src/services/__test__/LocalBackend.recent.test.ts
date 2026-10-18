import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultGetText } from '../../text'
import { Rfc3339DateTime } from '../../utilities/data/dateTime'
import { FilterBy, type ListDirectoryRequestParams } from '../Backend'
import { HttpClient } from '../HttpClient'
import { LocalBackend, newDirectoryId, newProjectId } from '../LocalBackend'
import { ProjectManager } from '../ProjectManager/ProjectManager'
import { Path, UUID, type FileSystemEntry, type RecentProjectEntry } from '../ProjectManager/types'

const ID1 = UUID('11111111-1111-1111-1111-111111111111')
const ID2 = UUID('22222222-2222-2222-2222-222222222222')
const ID3 = UUID('33333333-3333-3333-3333-333333333333')

const ATTRIBUTES = {
  creationTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastAccessTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  lastModifiedTime: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
  byteSize: 0,
}

function recentEntry(path: string, projectId: UUID): RecentProjectEntry {
  return { path: Path(path), projectId, openedAt: Rfc3339DateTime('2026-10-11T00:00:00.000Z') }
}

function projectEntry(path: string, id: UUID, name: string, lastOpened?: string): FileSystemEntry {
  return {
    type: 'ProjectEntry',
    path: Path(path),
    metadata: {
      id,
      name,
      namespace: 'local',
      created: Rfc3339DateTime('2026-01-01T00:00:00.000Z'),
      ...(lastOpened != null ? { lastOpened: Rfc3339DateTime(lastOpened) } : {}),
    },
    attributes: ATTRIBUTES,
  }
}

function directoryEntry(path: string): FileSystemEntry {
  return { type: 'DirectoryEntry', path: Path(path), attributes: ATTRIBUTES }
}

const RECENT_QUERY: ListDirectoryRequestParams = {
  parentId: null,
  filterBy: FilterBy.recent,
  labels: null,
  sortExpression: null,
  sortDirection: null,
  recentProjects: true,
  from: null,
  pageSize: null,
}

describe('LocalBackend: the local Recent list', () => {
  let projectManager: ProjectManager
  let recent: RecentProjectEntry[]
  let directories: Map<string, FileSystemEntry[]>

  beforeEach(() => {
    vi.stubGlobal('location', { href: 'http://localhost/' })
    recent = []
    directories = new Map()
    projectManager = new ProjectManager(Path('/root'))
    vi.spyOn(projectManager, 'listRecentProjects').mockImplementation(async () => recent)
    vi.spyOn(projectManager, 'recordRecentProject').mockResolvedValue()
    vi.spyOn(projectManager, 'forgetRecentProject').mockResolvedValue()
    vi.spyOn(projectManager, 'getProject').mockResolvedValue(undefined)
    vi.spyOn(projectManager, 'exists').mockImplementation(async (path) =>
      directories.has(path ?? ''),
    )
    vi.spyOn(projectManager, 'listDirectory').mockImplementation(async (parentPath) => {
      const entries = directories.get(parentPath ?? '/root')
      if (entries == null) throw new Error(`No directory '${parentPath}'`)
      return entries
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const makeBackend = () =>
    new LocalBackend(
      defaultGetText,
      projectManager,
      new HttpClient(),
      () => {},
      () => null,
      undefined,
    )

  it('lists recent projects newest first, with their real parent', async () => {
    recent = [recentEntry('/root/a/P2', ID2), recentEntry('/root/P1', ID1)]
    directories.set('/root/a', [projectEntry('/root/a/P2', ID2, 'P2')])
    directories.set('/root', [
      projectEntry('/root/P1', ID1, 'P1', '2026-10-01T00:00:00.000Z'),
      directoryEntry('/root/a'),
    ])
    const { assets, paginationToken } = await makeBackend().listDirectory(RECENT_QUERY)
    expect(assets.map((asset) => [asset.id, asset.parentId, asset.title])).toEqual([
      [newProjectId(Path('/root/a/P2')), newDirectoryId(Path('/root/a')), 'P2'],
      [newProjectId(Path('/root/P1')), newDirectoryId(Path('/root')), 'P1'],
    ])
    expect(assets[1]?.modifiedAt).toBe('2026-10-01T00:00:00.000Z')
    expect(paginationToken).toBeNull()
  })

  it('takes the Recent branch for `filterBy: recent` alone', async () => {
    recent = [recentEntry('/root/P1', ID1)]
    directories.set('/root', [projectEntry('/root/P1', ID1, 'P1')])
    const { assets } = await makeBackend().listDirectory({ ...RECENT_QUERY, recentProjects: false })
    expect(assets.map((asset) => asset.title)).toEqual(['P1'])
  })

  it('lists each parent directory once', async () => {
    recent = [recentEntry('/root/P1', ID1), recentEntry('/root/P2', ID2)]
    directories.set('/root', [
      projectEntry('/root/P1', ID1, 'P1'),
      projectEntry('/root/P2', ID2, 'P2'),
    ])
    const { assets } = await makeBackend().listDirectory(RECENT_QUERY)
    expect(assets.map((asset) => asset.title)).toEqual(['P1', 'P2'])
    expect(projectManager.listDirectory).toHaveBeenCalledTimes(1)
  })

  it('leaves out entries whose project or parent cannot be listed', async () => {
    recent = [
      recentEntry('/root/Gone', ID3),
      recentEntry('/elsewhere/P2', ID2),
      recentEntry('/root/P1', ID1),
    ]
    directories.set('/root', [projectEntry('/root/P1', ID1, 'P1')])
    const { assets } = await makeBackend().listDirectory(RECENT_QUERY)
    expect(assets.map((asset) => asset.title)).toEqual(['P1'])
  })

  it('sorts only when a sort is asked for', async () => {
    recent = [recentEntry('/root/A', ID1), recentEntry('/root/B', ID2)]
    directories.set('/root', [projectEntry('/root/A', ID1, 'A'), projectEntry('/root/B', ID2, 'B')])
    const { assets } = await makeBackend().listDirectory({
      ...RECENT_QUERY,
      sortExpression: 'title',
      sortDirection: 'descending',
    })
    expect(assets.map((asset) => asset.title)).toEqual(['B', 'A'])
  })

  it('still lists nothing for the other non-active filters', async () => {
    recent = [recentEntry('/root/P1', ID1)]
    const { assets } = await makeBackend().listDirectory({
      ...RECENT_QUERY,
      filterBy: FilterBy.trashed,
      recentProjects: false,
    })
    expect(assets).toEqual([])
    expect(projectManager.listRecentProjects).not.toHaveBeenCalled()
  })

  describe('recording opens', () => {
    const PROJECT_ID = newProjectId(Path('/root/P1'))

    it('records a successful local open', async () => {
      vi.spyOn(projectManager, 'openProject').mockResolvedValue(
        {} as Awaited<ReturnType<ProjectManager['openProject']>>,
      )
      await makeBackend().openProject(PROJECT_ID, null, 'P1')
      expect(projectManager.recordRecentProject).toHaveBeenCalledWith('/root/P1')
    })

    it('records nothing when the open fails', async () => {
      vi.spyOn(projectManager, 'openProject').mockRejectedValue(new Error('boom'))
      await expect(makeBackend().openProject(PROJECT_ID, null, 'P1')).rejects.toThrow('boom')
      expect(projectManager.recordRecentProject).not.toHaveBeenCalled()
    })

    it('records every successful open', async () => {
      vi.spyOn(projectManager, 'openProject').mockResolvedValue(
        {} as Awaited<ReturnType<ProjectManager['openProject']>>,
      )
      await makeBackend().openProject(
        PROJECT_ID,
        { executeAsync: false, cognitoCredentials: null, openHybridProjectParameters: null },
        'P1',
      )
      expect(projectManager.recordRecentProject).toHaveBeenCalledOnce()
    })

    it('a failed record does not fail the open', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(projectManager, 'openProject').mockResolvedValue(
        {} as Awaited<ReturnType<ProjectManager['openProject']>>,
      )
      vi.spyOn(projectManager, 'recordRecentProject').mockRejectedValue(new Error('disk full'))
      await expect(makeBackend().openProject(PROJECT_ID, null, 'P1')).resolves.toBeUndefined()
      expect(console.warn).toHaveBeenCalled()
    })
  })

  it('forgetRecentProject forgets the project at its path', async () => {
    await makeBackend().forgetRecentProject(newProjectId(Path('/root/P1')))
    expect(projectManager.forgetRecentProject).toHaveBeenCalledWith('/root/P1')
  })
})
