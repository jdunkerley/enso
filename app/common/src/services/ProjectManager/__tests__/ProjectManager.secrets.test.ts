/** @file The `ProjectManager` secrets methods post to the shim's `secrets/*` routes. */
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['listSecrets', 'secrets/list', [], {}, []],
  ['createSecret', 'secrets/create', ['token', 'v1'], { name: 'token', value: 'v1' }, null],
  ['updateSecret', 'secrets/update', ['token', 'v2'], { name: 'token', value: 'v2' }, null],
  ['deleteSecret', 'secrets/delete', ['token'], { name: 'token' }, null],
  ['secretsStatus', 'secrets/status', [], {}, { state: 'empty', keyFromEnvironment: false }],
] as const)('%s posts to %s', async (method, route, args, body, result) => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result })),
  )
  vi.stubGlobal('fetch', fetchMock)
  const pm = new ProjectManager(Path('/root'))
  const returned = await (pm[method] as (...args: unknown[]) => Promise<unknown>).apply(pm, [
    ...args,
  ])
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/project-service/${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  // Only the reads return what the shim answered; the writes return nothing.
  if (method === 'listSecrets' || method === 'secretsStatus') expect(returned).toEqual(result)
  else expect(returned).toBeUndefined()
})

it('a JSON-RPC error becomes a thrown Error with its message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 0,
            error: { code: 0, message: 'secrets/create failed: already exists' },
          }),
        ),
    ),
  )
  await expect(new ProjectManager(Path('/root')).createSecret('a', 'b')).rejects.toThrow(
    'secrets/create failed: already exists',
  )
})
