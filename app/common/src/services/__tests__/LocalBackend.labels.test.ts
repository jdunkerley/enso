/** @file The local backend's labels: its tag methods over the project manager, and the listing. */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultGetText } from '../../text.js'
import { toRfc3339 } from '../../utilities/data/dateTime.js'
import * as backend from '../Backend.js'
import { LocalBackend, newDirectoryId, newFileId, newProjectId } from '../LocalBackend.js'
import type { ProjectManager } from '../ProjectManager/ProjectManager.js'
import { Path, UUID, type FileSystemEntry } from '../ProjectManager/types.js'

const ROOT = Path('/home/user/enso-projects')
const NOW = toRfc3339(new Date(0))
const ATTRIBUTES = {
  creationTime: NOW,
  lastAccessTime: NOW,
  lastModifiedTime: NOW,
  byteSize: 0,
}

const label = (value: string): backend.Label => ({
  id: backend.TagId(`tag-${value}`),
  value: backend.LabelName(value),
  color: backend.COLORS[0],
})

function project(name: string, labels?: readonly string[]): FileSystemEntry {
  return {
    type: 'ProjectEntry',
    path: Path(`${ROOT}/${name}`),
    metadata: {
      name,
      namespace: 'local',
      id: UUID(`00000000-0000-0000-0000-${name.padStart(12, '0')}`),
      created: NOW,
      ...(labels != null ? { labels: labels.map(backend.LabelName) } : {}),
    },
    attributes: ATTRIBUTES,
  }
}

const directory: FileSystemEntry = {
  type: 'DirectoryEntry',
  path: Path(`${ROOT}/folder`),
  attributes: ATTRIBUTES,
}
const file: FileSystemEntry = {
  type: 'FileEntry',
  path: Path(`${ROOT}/data.csv`),
  attributes: ATTRIBUTES,
}

const projectManager = {
  rootDirectory: ROOT,
  listLabels: vi.fn<ProjectManager['listLabels']>(),
  createLabel: vi.fn<ProjectManager['createLabel']>(),
  deleteLabel: vi.fn<ProjectManager['deleteLabel']>(),
  setProjectLabels: vi.fn<ProjectManager['setProjectLabels']>(),
  listDirectory: vi.fn<(path: Path | null) => Promise<readonly FileSystemEntry[]>>(),
  getProject: vi.fn(async () => null),
}

let localBackend: LocalBackend

beforeEach(() => {
  vi.stubGlobal('location', { href: 'http://localhost/' })
  for (const value of Object.values(projectManager)) {
    if (typeof value === 'function') value.mockReset()
  }
  projectManager.getProject.mockResolvedValue(null)
  localBackend = new LocalBackend(
    defaultGetText,
    // The tests stub only the methods the label code calls.
    projectManager as unknown as ProjectManager,
    undefined,
    () => {},
    () => ROOT,
    undefined,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('supportsLabels', () => {
  test('the local backend labels projects only', () => {
    expect(localBackend.supportsLabels(backend.AssetType.project)).toBe(true)
    for (const type of [
      backend.AssetType.directory,
      backend.AssetType.file,
      backend.AssetType.datalink,
      backend.AssetType.secret,
    ]) {
      expect(localBackend.supportsLabels(type)).toBe(false)
    }
    expect(backend.supportsAnyLabels(localBackend)).toBe(true)
  })

  test('a backend that labels nothing supports no labels', () => {
    expect(backend.supportsAnyLabels({ supportsLabels: () => false })).toBe(false)
  })
})

describe('the tag methods', () => {
  test('listTags lists the local labels', async () => {
    const labels = [label('a'), label('b')]
    projectManager.listLabels.mockResolvedValue(labels)
    await expect(localBackend.listTags()).resolves.toEqual(labels)
  })

  test('createTag creates a local label', async () => {
    const created = label('new')
    projectManager.createLabel.mockResolvedValue(created)
    await expect(
      localBackend.createTag({ value: created.value, color: created.color }),
    ).resolves.toEqual(created)
    expect(projectManager.createLabel).toHaveBeenCalledWith({
      value: created.value,
      color: created.color,
    })
  })

  test('deleteTag deletes the local label by id', async () => {
    projectManager.deleteLabel.mockResolvedValue()
    await localBackend.deleteTag(backend.TagId('tag-a'), backend.LabelName('a'))
    expect(projectManager.deleteLabel).toHaveBeenCalledWith({ id: 'tag-a' })
  })

  test("associateTag sets a project's labels by its path", async () => {
    projectManager.setProjectLabels.mockResolvedValue()
    const path = Path(`${ROOT}/A`)
    await localBackend.associateTag(newProjectId(path), [backend.LabelName('x')], 'A')
    expect(projectManager.setProjectLabels).toHaveBeenCalledWith({
      projectPath: path,
      labels: ['x'],
    })
  })

  test('associateTag refuses folders and files', async () => {
    for (const id of [newDirectoryId(Path(`${ROOT}/D`)), newFileId(Path(`${ROOT}/f.txt`))]) {
      await expect(localBackend.associateTag(id, [backend.LabelName('x')], 'x')).rejects.toThrow(
        'Labels are not supported for local files and folders yet',
      )
    }
    expect(projectManager.setProjectLabels).not.toHaveBeenCalled()
  })
})

describe('listDirectory', () => {
  const list = (labels: readonly string[] | null) =>
    localBackend.listDirectory({
      parentId: newDirectoryId(ROOT),
      filterBy: null,
      labels: labels?.map(backend.LabelName) ?? null,
      sortExpression: null,
      sortDirection: null,
      recentProjects: false,
      from: null,
      pageSize: null,
    })

  test("puts each project's labels on its asset", async () => {
    projectManager.listDirectory.mockResolvedValue([
      project('A', ['a']),
      project('B'),
      directory,
      file,
    ])
    const { assets } = await list(null)
    const byTitle = new Map(assets.map((asset) => [asset.title, asset]))
    expect(byTitle.get('A')?.labels).toEqual(['a'])
    expect(byTitle.get('B')?.labels).toEqual([])
    expect(byTitle.get('folder')?.labels).toBeUndefined()
    expect(byTitle.get('data.csv')?.labels).toBeUndefined()
  })

  test('keeps the assets carrying all of the requested labels', async () => {
    projectManager.listDirectory.mockResolvedValue([
      project('A', ['a']),
      project('B', ['a', 'b', 'c']),
      project('C', ['b', 'a']),
      project('D'),
      directory,
      file,
    ])
    const { assets } = await list(['a', 'b'])
    expect(assets.map((asset) => asset.title).sort()).toEqual(['B', 'C'])
  })

  test('no requested labels filter nothing', async () => {
    projectManager.listDirectory.mockResolvedValue([project('A', ['a']), project('B'), directory])
    expect((await list([])).assets).toHaveLength(3)
    expect((await list(null)).assets).toHaveLength(3)
  })
})
