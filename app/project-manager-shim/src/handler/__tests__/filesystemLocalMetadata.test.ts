import { COLORS, LabelName } from 'enso-common/src/services/Backend'
import * as fs from 'node:fs/promises'
import type * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import { LocalMetadata } from '../../localMetadata/index.js'
import * as packageYaml from '../../localMetadata/packageYaml.js'
import { handleFilesystemCommand } from '../filesystem.js'

vi.mock('../../localMetadata/packageYaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../localMetadata/packageYaml.js')>()
  return { ...actual, readProjectLabels: vi.fn(actual.readProjectLabels) }
})

// The commands under test never read the request.
const REQUEST = {} as http.IncomingMessage

let root: string
let projects: string
let store: LocalMetadata

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'filesystem-local-metadata-'))
  projects = path.join(root, 'projects')
  await fs.mkdir(projects)
  store = new LocalMetadata({
    userDataDirectory: path.join(root, 'userData'),
    logger: { warn: vi.fn() },
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function run(args: string[], localMetadata?: LocalMetadata): Promise<unknown> {
  const response = await handleFilesystemCommand(args, REQUEST, localMetadata)
  if (typeof response !== 'string') throw new Error('Expected a JSON-RPC string response.')
  const json = JSON.parse(response) as { result?: unknown; error?: unknown }
  if (!('result' in json)) throw new Error(`Command failed: ${response}`)
  return json.result
}

interface Entry {
  readonly type: string
  readonly path: string
  readonly metadata?: { readonly labels?: readonly string[] }
}

async function list(localMetadata?: LocalMetadata, recursive = false) {
  const result = (await run(
    [recursive ? '--filesystem-list-recursive' : '--filesystem-list', projects],
    localMetadata,
  )) as { entries: Entry[] }
  return result.entries
}

describe('labels in the listing', () => {
  test('live names are listed, deleted ones dropped, and unknown ones added', async () => {
    await store.createLabel(LabelName('a'), COLORS[0])
    const gone = await store.createLabel(LabelName('gone'), COLORS[1])
    await store.deleteLabel(gone.id)
    const project = await createProject(path.join(projects, 'P'), 'id-1', {
      labels: ['a', 'gone', 'new'],
    })
    await createProject(path.join(projects, 'Q'), 'id-2')

    const entries = await list(store)
    expect(entries.find((entry) => entry.path === project)?.metadata?.labels).toEqual(['a', 'new'])
    expect(
      entries.find((entry) => entry.path === path.join(projects, 'Q'))?.metadata?.labels,
    ).toEqual([])
    expect((await store.listLabels()).map((label) => label.value)).toEqual(['a', 'new'])
  })

  test('recursive listings carry labels too', async () => {
    await fs.mkdir(path.join(projects, 'sub'))
    const project = await createProject(path.join(projects, 'sub', 'P'), 'id-1', {
      labels: ['x'],
    })
    const entries = await list(store, true)
    expect(entries.find((entry) => entry.path === project)?.metadata?.labels).toEqual(['x'])
  })

  test('malformed labels are ignored', async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1', {
      labels: ['ok', 3, null],
    })
    const entries = await list(store)
    expect(entries.find((entry) => entry.path === project)?.metadata?.labels).toEqual(['ok'])
  })

  test('when the migration fails, the labels left in project.json are still listed', async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1', { labels: ['old', 3] })
    const projectJsonPath = path.join(project, '.enso', 'project.json')
    const before = await fs.readFile(projectJsonPath, 'utf8')
    vi.mocked(packageYaml.readProjectLabels).mockRejectedValueOnce(new Error('cannot rewrite'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})

    const entries = await list(store)
    expect(entries.find((entry) => entry.path === project)?.metadata?.labels).toEqual(['old'])
    expect(await fs.readFile(projectJsonPath, 'utf8')).toBe(before)
  })

  test("when the migration fails, package.yaml's own labels win", async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1', { labels: ['old'] })
    await packageYaml.writePackageLabels(project, ['new'])
    vi.mocked(packageYaml.readProjectLabels).mockRejectedValueOnce(new Error('cannot rewrite'))
    vi.spyOn(console, 'error').mockImplementationOnce(() => {})

    const entries = await list(store)
    expect(entries.find((entry) => entry.path === project)?.metadata?.labels).toEqual(['new'])
  })

  test('without a store, no labels are listed', async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1', { labels: ['a'] })
    const entries = await list()
    expect(entries.find((entry) => entry.path === project)?.metadata).not.toHaveProperty('labels')
  })
})

describe('Recent follows filesystem moves and deletes', () => {
  test('moving a folder rewrites the entries of the projects inside it', async () => {
    const folder = path.join(projects, 'folder')
    await fs.mkdir(folder)
    const project = await createProject(path.join(folder, 'P'), 'id-1')
    await store.recordRecent(project)
    const renamed = path.join(projects, 'renamed')

    await run(['--filesystem-move-from', folder, '--filesystem-move-to', renamed], store)

    expect(await store.listRecent()).toEqual([
      expect.objectContaining({ projectId: 'id-1', path: path.join(renamed, 'P') }),
    ])
  })

  test('moving a project rewrites its entry', async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1')
    await store.recordRecent(project)
    const moved = path.join(projects, 'Moved')

    await run(['--filesystem-move-from', project, '--filesystem-move-to', moved], store)

    expect(await store.listRecent()).toEqual([expect.objectContaining({ path: moved })])
  })

  test('deleting a project forgets its entry', async () => {
    const project = await createProject(path.join(projects, 'P'), 'id-1')
    await store.recordRecent(project)

    await run(['--filesystem-delete', project], store)

    expect(await store.listRecent()).toEqual([])
    const file = JSON.parse(await fs.readFile(path.join(root, 'userData', 'recent.json'), 'utf8'))
    expect(file.entries).toEqual([])
  })
})
