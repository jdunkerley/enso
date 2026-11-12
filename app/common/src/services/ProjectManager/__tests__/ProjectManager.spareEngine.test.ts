/** @file `ProjectManager.setSpareEngine` posts to the shim's `engine/setSpare`. */
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

afterEach(() => vi.unstubAllGlobals())

it('posts the setting', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: null,
        }),
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
  const pm = new ProjectManager(Path('/root'))
  await pm.setSpareEngine(false)
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/project-service/engine/setSpare', {
    method: 'POST',
    body: JSON.stringify({ enabled: false }),
  })
})
