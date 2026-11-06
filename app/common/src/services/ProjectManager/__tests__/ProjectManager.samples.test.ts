/** @file The `ProjectManager` samples methods post to the shim's `samples/*` routes. */
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectManager } from '../ProjectManager'
import { Path } from '../types'

afterEach(() => vi.unstubAllGlobals())

function stubShim(result: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function expectPosted(fetchMock: ReturnType<typeof stubShim>, route: string, body: object) {
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/project-service/${route}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

it('samplesStatus posts to samples/status', async () => {
  const status = {
    directory: '/projects/Samples',
    samples: [
      {
        name: 'One',
        path: '/projects/Samples/One',
        state: 'updateAvailable',
        route: 'copy',
        copyName: 'One_edited_2026_11_06',
      },
    ],
  }
  const fetchMock = stubShim(status)
  expect(await new ProjectManager(Path('/root')).samplesStatus()).toEqual(status)
  expectPosted(fetchMock, 'samples/status', {})
})

it('updateSample posts the name to samples/update', async () => {
  const fetchMock = stubShim({ kept: ['One_edited_2026_11_06'] })
  expect(await new ProjectManager(Path('/root')).updateSample('One')).toEqual({
    kept: ['One_edited_2026_11_06'],
  })
  expectPosted(fetchMock, 'samples/update', { name: 'One' })
})

it('updateAllSamples posts to samples/update-all', async () => {
  const fetchMock = stubShim({ kept: [] })
  expect(await new ProjectManager(Path('/root')).updateAllSamples()).toEqual({ kept: [] })
  expectPosted(fetchMock, 'samples/update-all', {})
})
