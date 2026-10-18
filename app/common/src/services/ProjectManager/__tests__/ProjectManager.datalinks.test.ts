/** @file The `ProjectManager` datalink methods post to the shim's `datalink/*` routes. */
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

afterEach(() => vi.unstubAllGlobals())

it.each([
  ['readDatalink', 'datalink/read', [], { a: 1 }],
  ['createDatalink', 'datalink/create', [{ a: 1 }], null],
  ['updateDatalink', 'datalink/update', [{ a: 1 }], null],
  ['deleteDatalink', 'datalink/delete', [], null],
] as const)('%s posts to %s', async (method, route, rest, result) => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result })),
  )
  vi.stubGlobal('fetch', fetchMock)
  const pm = new ProjectManager(Path('/root'))
  const returned = await (pm[method] as (...args: unknown[]) => Promise<unknown>)(
    Path('/root/a.datalink'),
    ...rest,
  )
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/project-service/${route}`, {
    method: 'POST',
    body: JSON.stringify({
      path: '/root/a.datalink',
      ...(rest.length ? { value: rest[0] } : {}),
    }),
  })
  if (method === 'readDatalink') expect(returned).toEqual(result)
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
            error: { code: 0, message: 'datalink/read failed: bad' },
          }),
        ),
    ),
  )
  await expect(
    new ProjectManager(Path('/root')).readDatalink(Path('/root/a.datalink')),
  ).rejects.toThrow('datalink/read failed: bad')
})
