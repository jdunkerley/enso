import { COLORS } from 'enso-common/src/services/Backend'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import { LocalMetadata } from '../../localMetadata/index.js'
import { readPackageLabels } from '../../localMetadata/packageYaml.js'
import { handleProjectServiceRequest } from '../projectService.js'

let root: string
let server: http.Server
let baseUrl: string
let store: LocalMetadata | undefined

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-service-handler-'))
  store = new LocalMetadata({
    userDataDirectory: path.join(root, 'userData'),
    logger: { warn: vi.fn() },
  })
  server = http.createServer((request, response) => {
    void handleProjectServiceRequest(
      request,
      response,
      request.url ?? '',
      () => Promise.reject(new Error('The project service is not used by these routes.')),
      {},
      store,
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

describe('unknown routes', () => {
  test('answer with a JSON-RPC error instead of throwing', async () => {
    expect((await call('nope', {})).error).toBeDefined()
  })
})
