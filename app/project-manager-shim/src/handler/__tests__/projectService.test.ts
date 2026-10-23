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
import { LocalSecrets } from '../../localSecrets/index.js'
import { createVersioning, withTempRepo } from '../../localVersioning/__tests__/testRepo.js'
import type { LocalVersioning } from '../../localVersioning/index.js'
import type { Runner } from '../../projectService/ensoRunner.js'
import { ProjectService } from '../../projectService/index.js'
import { handleProjectServiceRequest } from '../projectService.js'

let root: string
let server: http.Server
let baseUrl: string
let store: LocalMetadata | undefined
let versioning: LocalVersioning | undefined
let secrets: LocalSecrets | undefined
let keyFromEnvironment = false
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
  keyFromEnvironment = false
  secrets = new LocalSecrets({
    filePath: path.join(root, 'secrets.json'),
    getKey: () => Buffer.alloc(32, 7),
  })
  versioning = createVersioning(path.join(root, 'userData'))
  server = http.createServer((request, response) => {
    void handleProjectServiceRequest(
      request,
      response,
      request.url ?? '',
      () => Promise.resolve(projectService),
      {},
      store,
      versioning,
      secrets,
      keyFromEnvironment,
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
        await versioning!.enable(repo)
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

  test.each(['', ' \n '])('commit with the message %j is "Saved"', async (message) => {
    await withProject(async (_repo, project) => {
      const { result } = await call('versioning/commit', { path: project, message })
      expect((result as { id: string }).id).toMatch(/^[0-9a-f]{40}$/)
      expect((await call('versioning/log', { path: project })).result).toMatchObject({
        versions: [{ comment: 'Saved' }],
      })
    })
  })

  test('enable and disable switch consent for a repository', async () => {
    await withTempRepo(
      async (repo) => {
        const project = await createProject(path.join(repo, 'P'), 'id-1')
        const status = async () =>
          ((await call('versioning/status', { path: project })).result as { enabled: boolean })
            .enabled
        expect(await status()).toBe(false)
        expect((await call('versioning/enable', { repoRoot: repo })).result).toBeNull()
        expect(await status()).toBe(true)
        expect((await call('versioning/disable', { repoRoot: repo })).result).toBeNull()
        expect(await status()).toBe(false)
        expect((await call('versioning/status', { path: project })).result).toMatchObject({
          optedOut: true,
        })
      },
      { init: true },
    )
  })

  test('enable-if-inside enables a repository at the root, and needs both paths', async () => {
    await withTempRepo(
      async (repo) => {
        const project = await createProject(path.join(repo, 'P'), 'id-1')
        expect(
          (await call('versioning/enable-if-inside', { repoRoot: repo, rootPath: repo })).result,
        ).toEqual({ enabled: true })
        expect((await call('versioning/status', { path: project })).result).toMatchObject({
          enabled: true,
          optedOut: false,
        })
      },
      { init: true },
    )
    expect((await call('versioning/enable-if-inside', { repoRoot: 'x' })).error).toMatchObject({
      message: expect.stringContaining("'rootPath' must be a string."),
    })
  })

  test('enable and disable need a repoRoot, and enable needs a repository', async () => {
    expect((await call('versioning/enable', {})).error).toMatchObject({
      message: expect.stringContaining("'repoRoot' must be a string."),
    })
    expect((await call('versioning/disable', {})).error).toMatchObject({
      message: expect.stringContaining("'repoRoot' must be a string."),
    })
    await withTempRepo(async (dir) => {
      expect((await call('versioning/enable', { repoRoot: dir })).error).toMatchObject({
        message: expect.stringContaining('not the root of a git repository'),
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

describe('datalink routes', () => {
  const VALUE = {
    type: 'HTTP',
    libraryName: 'Standard.Base',
    uri: 'https://x',
    method: 'GET',
  }

  test('create, read, update and delete', async () => {
    const file = path.join(root, 'Web.datalink')
    expect((await call('datalink/create', { path: file, value: VALUE })).result).toBeNull()
    expect((await call('datalink/read', { path: file })).result).toEqual(VALUE)
    const changed = { ...VALUE, uri: 'https://y' }
    expect((await call('datalink/update', { path: file, value: changed })).result).toBeNull()
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(changed)
    expect((await call('datalink/delete', { path: file })).result).toBeNull()
    await expect(fs.stat(file)).rejects.toThrow()
  })

  test('invalid JSON is reported as an error naming the file', async () => {
    const file = path.join(root, 'Broken.datalink')
    await fs.writeFile(file, '{ not json')
    const read = await call('datalink/read', { path: file })
    expect(read).not.toHaveProperty('result')
    expect(read.error).toMatchObject({
      message: expect.stringMatching(
        /^datalink\/read failed: 'Broken\.datalink' is not valid JSON/,
      ),
    })
  })

  test('a malformed body or an existing file is an error', async () => {
    const file = path.join(root, 'Web.datalink')
    expect((await call('datalink/create', { path: file })).error).toBeDefined()
    expect((await call('datalink/read', { path: 3 })).error).toBeDefined()
    await call('datalink/create', { path: file, value: VALUE })
    const again = await call('datalink/create', { path: file, value: VALUE })
    expect(again.error).toMatchObject({
      message: expect.stringContaining('already exists'),
    })
  })
})

describe('datalink route paths', () => {
  test('a .. path or a path not ending in .datalink is refused', async () => {
    const value = { type: 'HTTP' }
    const dotDot = `${root}${path.sep}sub${path.sep}..${path.sep}Web.datalink`
    for (const bad of [dotDot, path.join(root, 'Web.json'), 'Web.datalink']) {
      for (const name of ['create', 'update']) {
        expect((await call(`datalink/${name}`, { path: bad, value })).error).toBeDefined()
      }
      for (const name of ['read', 'delete']) {
        expect((await call(`datalink/${name}`, { path: bad })).error).toBeDefined()
      }
    }
    expect(await fs.readdir(root)).not.toContain('Web.datalink')
  })
})

describe('datalink routes with forward-slash paths', () => {
  // `ProjectManager.listDirectory` gives every Windows path forward slashes (`C:/Users/x.datalink`);
  // on POSIX hosts this is the unchanged path.
  test('create, read and update accept the GUI path form', async () => {
    const file = path.join(root, 'Slash.datalink').replace(/\\/g, '/')
    const created = await call('datalink/create', { path: file, value: { type: 'S3' } })
    expect(created.error).toBeUndefined()
    expect((await call('datalink/read', { path: file })).result).toEqual({ type: 'S3' })
    const updated = await call('datalink/update', { path: file, value: { type: 'HTTP' } })
    expect(updated.error).toBeUndefined()
    expect((await call('datalink/read', { path: file })).result).toEqual({ type: 'HTTP' })
  })
})

describe('project/open', () => {
  test('a stray `cloud` parameter is ignored', async () => {
    const open = vi.spyOn(projectService, 'openProject').mockResolvedValue({} as never)
    await call('project/open', {
      projectId: 'id-1',
      projectsDirectory: root,
      cloud: { cloudProjectId: 'x', cloudApiUrl: 'https://example.com' },
    })
    expect(open).toHaveBeenCalledExactlyOnceWith('id-1', root, undefined)
  })

  test("passes the engine's logging options on", async () => {
    const open = vi.spyOn(projectService, 'openProject').mockResolvedValue({} as never)
    const engineLogging = { sqlQueries: true, performanceTimings: true }
    await call('project/open', { projectId: 'id-1', projectsDirectory: root, engineLogging })
    expect(open).toHaveBeenCalledExactlyOnceWith('id-1', root, engineLogging)
  })
})

describe('secrets routes', () => {
  const VALUE = 'hunter2-very-secret'

  test('create, list, update and delete; no response carries the value', async () => {
    const responses = [
      await call('secrets/create', { name: 'token', value: VALUE }),
      await call('secrets/list', {}),
      await call('secrets/update', { name: 'token', value: `${VALUE}-2` }),
      await call('secrets/status', {}),
      await call('secrets/list', {}),
    ]
    expect(responses[0]!.result).toBeNull()
    expect(responses[1]!.result).toEqual([expect.objectContaining({ name: 'token' })])
    expect(responses[2]!.result).toBeNull()
    expect(responses[3]!.result).toMatchObject({ state: 'ready', keyFromEnvironment: false })
    expect(JSON.stringify(responses)).not.toContain('hunter2')
    expect((await call('secrets/delete', { name: 'token' })).result).toBeNull()
    expect((await call('secrets/list', {})).result).toEqual([])
  })

  test('status reports where the key comes from', async () => {
    keyFromEnvironment = true
    expect((await call('secrets/status', {})).result).toEqual({
      state: 'empty',
      keyFromEnvironment: true,
    })
  })

  test('an unreadable keychain is reported as unavailable, with nothing else', async () => {
    secrets = new LocalSecrets({
      filePath: path.join(root, 'secrets.json'),
      getKey: () => null,
      isKeyUnavailable: () => true,
    })
    expect((await call('secrets/status', {})).result).toEqual({
      state: 'unavailable',
      keyFromEnvironment: false,
    })
  })

  test('store failures are JSON-RPC errors with the message', async () => {
    await call('secrets/create', { name: 'a', value: 'x' })
    const duplicate = await call('secrets/create', { name: 'a', value: 'y' })
    expect(duplicate.error).toMatchObject({ message: expect.stringContaining('secrets/create') })
    const badName = await call('secrets/create', { name: 'a/b', value: 'y' })
    expect(badName.error).toBeDefined()
    expect((await call('secrets/create', { name: 'a' })).error).toBeDefined()
  })

  test.each(['secrets/create', 'secrets/update'])(
    '%s with a body that is not JSON: a fixed message, and the body is never logged',
    async (name) => {
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        // V8 quotes text near the fault in some messages, e.g. `Unexpected token 'h', "hunter2-..."`.
        const response = await fetch(`${baseUrl}/api/project-service/${name}`, {
          method: 'POST',
          body: `{"name": "token", "value": ${VALUE}}`,
        })
        const json = (await response.json()) as { error?: { message?: unknown } }
        expect(json.error?.message).toBe(`${name} failed: The request body is not valid JSON.`)
        expect(JSON.stringify(json)).not.toContain('hunter2')
        expect(errorLog).toHaveBeenCalled()
        const logged = errorLog.mock.calls
          .flat()
          .map((arg) =>
            arg instanceof Error ? `${arg.message} ${arg.stack} ${String(arg.cause)}` : String(arg),
          )
          .join(' ')
        expect(logged).not.toContain('hunter2')
      } finally {
        errorLog.mockRestore()
      }
    },
  )

  test('without a store the routes answer with an error', async () => {
    secrets = undefined
    expect((await call('secrets/list', {})).error).toMatchObject({
      message: expect.stringContaining('Local secrets are not available in this host.'),
    })
  })
})
