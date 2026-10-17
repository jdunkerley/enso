import type { ProjectId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  closeProject: vi.fn(async (state: { info: unknown }) => ({
    ok: true,
    value: { status: 'not-opened', info: state.info },
  })),
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({
  useLocalVersioning: () => ({ isVersioned: () => false, setQuitting: vi.fn() }),
}))

import { createOpenedProjectsStore } from '../openedProjects'

async function openedStore(id: ProjectId) {
  const info = { mode: 'local', id, title: id }
  mocks.openProject.mockImplementation(async () => ({
    ok: true,
    value: { status: 'initialized', info, scope: effectScope() },
  }))
  const store = createOpenedProjectsStore()
  store.openProject(info as never)
  await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
  return store
}

describe('closing local projects', () => {
  test('closeAllProjects closes without offering a repository', async () => {
    const store = await openedStore('p1' as ProjectId)
    store.closeAllProjects()
    await vi.waitFor(() => expect(mocks.closeProject).toHaveBeenCalledTimes(1))
    expect(mocks.closeProject.mock.calls[0]![1]).toEqual({ offer: false })
  })

  test('closeProject offers', async () => {
    mocks.closeProject.mockClear()
    const store = await openedStore('p2' as ProjectId)
    store.closeProject('p2' as ProjectId)
    await vi.waitFor(() => expect(mocks.closeProject).toHaveBeenCalledTimes(1))
    expect(mocks.closeProject.mock.calls[0]![1]).toEqual({ offer: true })
  })
})
