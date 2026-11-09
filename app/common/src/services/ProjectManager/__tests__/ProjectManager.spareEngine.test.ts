/** @file `ProjectManager.setSpareEngine` posts to the shim's `engine/setSpare`. */
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

afterEach(() => vi.unstubAllGlobals())

it('posts the setting and returns the engine mode', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: { engineMode: 'jvm' },
        }),
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
  const pm = new ProjectManager(Path('/root'))
  expect(await pm.setSpareEngine(false)).toEqual({ engineMode: 'jvm' })
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/project-service/engine/setSpare', {
    method: 'POST',
    body: JSON.stringify({ enabled: false }),
  })
})
