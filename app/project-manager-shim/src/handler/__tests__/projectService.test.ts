import { COLORS } from 'enso-common/src/services/Backend'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProject, readProjectJson } from '../../localMetadata/__tests__/testUtils.js'
import { LocalMetadata } from '../../localMetadata/index.js'
import { readPackageLabels } from '../../localMetadata/packageYaml.js'
import { withTempRepo } from '../../localVersioning/__tests__/testRepo.js'
import { LocalVersioning } from '../../localVersioning/index.js'
import type { Runner } from '../../projectService/ensoRunner.js'
import { ProjectService } from '../../projectService/index.js'
import { handleProjectServiceRequest } from '../projectService.js'

let root: string
let server: http.Server
let baseUrl: string
let store: LocalMetadata | undefined
let versioning: LocalVersioning | undefined
let running = false
/** The only part of the runner these routes use. */
const runner: Partial<Runner> = { isProjectRunning: () => Promise.resolve(running) }
const projectService = new ProjectService(runner as Runner, [])

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-handler-'))
  store = new LocalMetadata({
    userDataDirectory: path.join(root, 'userData'),
    logger: { warn: vi.fn() },
  })
  running = false
  versioning = new LocalVersioning()
  server = http.createServer((request, response) => {
    void handleProjectServiceRequest(
      request,
      response,
      request.url ?? '',
      () => Promise.resolve(projectService),
      {},
      store,
      versioning,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function call(name: string, body: object): Promise<{ result?: unknown; error?: unknown }> {
  const response = await fetch(`${baseUrl}/api/project-service/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { result?: unknown; error?: unknown }
}

describe('label routes', () => {
  test('create, list and delete', async () => {
    const created = await call('labels/create', { value: 'Finance', color: COLORS[1] })
    expect(created.result).toMatchObject({ value: 'Finance', color: COLORS[1] })
    const id = (created.result as { id: string }).id

    expect((await call('labels/list', {})).result).toEqual([created.result])
    expect((await call('labels/delete', { id })).result).toBeNull()
    expect((await call('labels/list', {})).result).toEqual([])
  })

  test('a duplicate create is a JSON-RPC error', async () => {
    await call('labels/create', { value: 'a', color: COLORS[0] })
    const duplicate = await call('labels/create', { value: 'a', color: COLORS[0] })
    expect(duplicate).not.toHaveProperty('result')
    expect(duplicate.error).toMatchObject({ message: expect.stringContaining('labels/create') })
  })

  test('a malformed body is a JSON-RPC error', async () => {
    expect((await call('labels/create', { value: 3 })).error).toBeDefined()
    expect((await call('project/set-labels', { path: 'x', labels: 'a' })).error).toBeDefined()
  })

  test('project/set-labels writes the project', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1')
    expect((await call('project/set-labels', { path: project, labels: ['a'] })).result).toBeNull()
    expect(await readPackageLabels(project)).toEqual(['a'])
  })
})

describe('recent routes', () => {
  test('record, list and forget', async () => {
    const project = await createProject(path.join(root, 'P'), 'id-1')
    expect((await call('recent/record', { path: project })).result).toBeNull()
    expect((await call('recent/list', {})).result).toEqual([
      expect.objectContaining({ path: project, projectId: 'id-1' }),
    ])
    expect((await call('recent/forget', { path: project })).result).toBeNull()
    expect((await call('recent/list', {})).result).toEqual([])
  })

  test('recording a non-project is a JSON-RPC error', async () => {
    expect((await call('recent/record', { path: path.join(root, 'nothing') })).error).toBeDefined()
  })

  test('an empty request body is accepted for the list routes', async () => {
    const response = await fetch(`${baseUrl}/api/project-service/recent/list`, { method: 'POST' })
    expect(await response.json()).toMatchObject({ result: [] })
  })
})

describe('without a store', () => {
  test('the routes answer with a JSON-RPC error', async () => {
    store = undefined
    expect((await call('labels/list', {})).error).toBeDefined()
  })
})

describe('versioning routes', () => {
  async function withProject(body: (repo: string, project: string) => Promise<void>) {
    await withTempRepo(
      async (repo) => {
        await body(repo, await createProject(path.join(repo, 'P'), 'id-1'))
      },
      { init: true },
    )
  }

  test('status round trip', async () => {
    await withProject(async (repo, project) => {
      const { result } = await call('versioning/status', { path: project })
      expect(result).toMatchObject({ git: true, changed: true, lastVersion: null, blocked: null })
      expect(path.resolve((result as { repoRoot: string }).repoRoot)).toBe(path.resolve(repo))
    })
  })

  test('a missing path is a JSON-RPC error', async () => {
    const { error } = await call('versioning/status', {})
    expect(error).toMatchObject({ message: expect.stringContaining("'path' must be a string.") })
    expect((await call('versioning/commit', { path: 'x' })).error).toMatchObject({
      message: expect.stringContaining("'message' must be a string."),
    })
  })

  test('commit, log, file-at and set-comment', async () => {
    await withProject(async (_repo, project) => {
      const { result: committed } = await call('versioning/commit', {
        path: project,
        message: 'first',
      })
      const id = (committed as { id: string }).id
      expect(id).toMatch(/^[0-9a-f]{40}$/)
      const { result: log } = await call('versioning/log', { path: project })
      expect(log).toMatchObject({ versions: [{ id, comment: 'first', isLatest: true }] })
      const { result: content } = await call('versioning/file-at', {
        path: project,
        id,
        relativePath: 'package.yaml',
      })
      expect(content).toContain('namespace: local')
      const commented = await call('versioning/set-comment', { path: project, id, comment: 'x' })
      expect(commented.result).toBeNull()
      expect((await call('versioning/log', { path: project })).result).toMatchObject({
        versions: [{ comment: 'x' }],
      })
    })
  })

  test('init starts a repository', async () => {
    await withTempRepo(async (dir) => {
      const { result } = await call('versioning/init', { rootPath: dir })
      expect(path.resolve((result as { repoRoot: string }).repoRoot)).toBe(path.resolve(dir))
    })
  })

  test('restore is refused while the project is running', async () => {
    await withProject(async (_repo, project) => {
      const { result } = await call('versioning/commit', { path: project, message: 'first' })
      const id = (result as { id: string }).id
      await fs.writeFile(path.join(project, 'package.yaml'), 'name: P\nnamespace: other\n')
      running = true
      const refused = await call('versioning/restore', { path: project, id })
      expect(refused).not.toHaveProperty('result')
      expect(refused.error).toMatchObject({ message: expect.stringContaining('running') })
      expect(await fs.readFile(path.join(project, 'package.yaml'), 'utf8')).toContain('other')

      running = false
      expect((await call('versioning/restore', { path: project, id })).result).toHaveProperty('id')
      expect(await fs.readFile(path.join(project, 'package.yaml'), 'utf8')).toContain('local')
    })
  })

  test('duplicate-at makes a new project from an old version', async () => {
    await withProject(async (repo, project) => {
      const { result } = await call('versioning/commit', { path: project, message: 'first' })
      const id = (result as { id: string }).id
      await fs.writeFile(path.join(project, 'package.yaml'), 'name: P\nnamespace: other\n')
      const parent = path.join(repo, 'copies')
      await fs.mkdir(parent)
      const { result: copy } = await call('versioning/duplicate-at', {
        path: project,
        id,
        title: 'P',
        parentPath: parent,
      })
      expect(copy).toMatchObject({ projectName: 'P', projectNormalizedName: 'P' })
      const { projectPath, projectId } = copy as { projectPath: string; projectId: string }
      expect(path.resolve(projectPath)).toBe(path.resolve(parent, 'P'))
      expect(projectId).not.toBe('id-1')
      expect(await fs.readFile(path.join(projectPath, 'package.yaml'), 'utf8')).toContain('local')
      expect((await readProjectJson(projectPath)).id).toBe(projectId)
      // A second copy with the same title gets a free name.
      const { result: second } = await call('versioning/duplicate-at', {
        path: project,
        id,
        title: 'P',
        parentPath: parent,
      })
      expect(second).toMatchObject({ projectName: 'P_1' })
    })
  })
})

describe('versioning routes without a store', () => {
  test('answer with a JSON-RPC error', async () => {
    versioning = undefined
    const { error } = await call('versioning/status', { path: 'x' })
    expect(error).toMatchObject({
      message: expect.stringContaining('Local versioning is not available in this host.'),
    })
  })
})

describe('unknown routes', () => {
  test('answer with a JSON-RPC error instead of throwing', async () => {
    expect((await call('nope', {})).error).toBeDefined()
  })
})
