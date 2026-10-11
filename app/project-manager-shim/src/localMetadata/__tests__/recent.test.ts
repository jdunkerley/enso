import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LocalMetadata, RECENT_FILE_NAME, RECENT_LIMIT } from '../index.js'
import { createProject } from './testUtils.js'

let root: string
let userData: string
let clock: number
let store: LocalMetadata

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-metadata-recent-'))
  userData = path.join(root, 'userData')
  clock = Date.parse('2026-10-11T00:00:00.000Z')
  store = new LocalMetadata({
    userDataDirectory: userData,
    logger: { warn: vi.fn() },
    // Each call advances by one second, so `openedAt` values are distinct and ordered.
    now: () => new Date((clock += 1000)),
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function ids(entries: readonly { readonly projectId: string }[]) {
  return entries.map((entry) => entry.projectId)
}

describe('recordRecent and listRecent', () => {
  test('newest first, with the project UUID and an RFC 3339 time', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    await store.recordRecent(a)
    await store.recordRecent(b)
    const entries = await store.listRecent()
    expect(ids(entries)).toEqual(['id-b', 'id-a'])
    expect(entries[0]).toEqual({
      path: b,
      projectId: 'id-b',
      openedAt: '2026-10-11T00:00:02.000Z',
    })
  })

  test('re-recording moves the entry to the top without duplicating it', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    await store.recordRecent(a)
    await store.recordRecent(b)
    await store.recordRecent(a)
    expect(ids(await store.listRecent())).toEqual(['id-a', 'id-b'])
  })

  test('de-duplicates by UUID even when the path changed', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    await store.recordRecent(a)
    const moved = path.join(root, 'A2')
    await fs.rename(a, moved)
    await store.recordRecent(moved)
    expect(await store.listRecent()).toEqual([expect.objectContaining({ path: moved })])
  })

  test(`keeps at most ${RECENT_LIMIT} entries`, async () => {
    for (let i = 0; i < RECENT_LIMIT + 3; i += 1) {
      await store.recordRecent(await createProject(path.join(root, `P${i}`), `id-${i}`))
    }
    const entries = await store.listRecent()
    expect(entries).toHaveLength(RECENT_LIMIT)
    expect(entries[0]?.projectId).toBe(`id-${RECENT_LIMIT + 2}`)
    expect(entries.at(-1)?.projectId).toBe('id-3')
  })

  test('rejects a path that is not a project', async () => {
    await fs.mkdir(path.join(root, 'plain'))
    await expect(store.recordRecent(path.join(root, 'plain'))).rejects.toThrow()
    expect(await store.listRecent()).toEqual([])
  })

  test('hides entries that fail the check, without pruning them', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    const c = await createProject(path.join(root, 'C'), 'id-c')
    await store.recordRecent(a)
    await store.recordRecent(b)
    await store.recordRecent(c)
    await fs.rm(a, { recursive: true })
    await createProject(b, 'id-b-replaced')

    expect(ids(await store.listRecent())).toEqual(['id-c'])
    const file = JSON.parse(await fs.readFile(path.join(userData, RECENT_FILE_NAME), 'utf8'))
    expect(file.entries).toHaveLength(3)
  })

  test('recording prunes entries that fail the check', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    await store.recordRecent(a)
    await fs.rm(a, { recursive: true })
    await store.recordRecent(b)
    const file = JSON.parse(await fs.readFile(path.join(userData, RECENT_FILE_NAME), 'utf8'))
    expect(file).toEqual({ version: 1, entries: [expect.objectContaining({ projectId: 'id-b' })] })
  })

  test('a recent.json from a newer version is moved aside', async () => {
    await fs.mkdir(userData, { recursive: true })
    await fs.writeFile(
      path.join(userData, RECENT_FILE_NAME),
      JSON.stringify({ version: 2, entries: [] }),
    )
    expect(await store.listRecent()).toEqual([])
    const names = await fs.readdir(userData)
    expect(names.some((name) => name.startsWith(`${RECENT_FILE_NAME}.newer-`))).toBe(true)
  })

  test('malformed entries are dropped', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    await fs.mkdir(userData, { recursive: true })
    await fs.writeFile(
      path.join(userData, RECENT_FILE_NAME),
      JSON.stringify({
        version: 1,
        entries: [{ path: a, projectId: 'id-a', openedAt: '2026-01-01T00:00:00.000Z' }, 42],
      }),
    )
    expect(ids(await store.listRecent())).toEqual(['id-a'])
  })
})

describe('forgetting and following projects', () => {
  test('forgetRecent removes the entry for a path', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    await store.recordRecent(a)
    await store.recordRecent(b)
    await store.forgetRecent(a)
    expect(ids(await store.listRecent())).toEqual(['id-b'])
  })

  test('pathMoved rewrites entries at or under the old path', async () => {
    const folder = path.join(root, 'folder')
    const a = await createProject(path.join(folder, 'A'), 'id-a')
    const other = await createProject(path.join(root, 'folder-other'), 'id-o')
    await store.recordRecent(a)
    await store.recordRecent(other)
    const newFolder = path.join(root, 'renamed')
    await fs.rename(folder, newFolder)
    await store.pathMoved(folder, newFolder)
    expect(await store.listRecent()).toEqual([
      expect.objectContaining({ projectId: 'id-o', path: other }),
      expect.objectContaining({ projectId: 'id-a', path: path.join(newFolder, 'A') }),
    ])
  })

  test('projectMoved rewrites the entry with that UUID', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    await store.recordRecent(a)
    const moved = path.join(root, 'Moved')
    await fs.rename(a, moved)
    await store.projectMoved('id-a', moved)
    expect(await store.listRecent()).toEqual([expect.objectContaining({ path: moved })])
  })

  test('pathDeleted forgets entries at or under the path', async () => {
    const folder = path.join(root, 'folder')
    const a = await createProject(path.join(folder, 'A'), 'id-a')
    const b = await createProject(path.join(root, 'B'), 'id-b')
    await store.recordRecent(a)
    await store.recordRecent(b)
    await store.pathDeleted(folder)
    expect(ids(await store.listRecent())).toEqual(['id-b'])
  })

  test('projectDeleted forgets the entry with that UUID', async () => {
    const a = await createProject(path.join(root, 'A'), 'id-a')
    await store.recordRecent(a)
    await store.projectDeleted('id-a')
    expect(await store.listRecent()).toEqual([])
  })

  test('moves and deletes on an empty store do not create recent.json', async () => {
    await store.pathMoved(path.join(root, 'x'), path.join(root, 'y'))
    await store.pathDeleted(path.join(root, 'x'))
    await expect(fs.access(path.join(userData, RECENT_FILE_NAME))).rejects.toThrow()
  })
})
