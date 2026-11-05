import type { ProjectId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  initializeProject: vi.fn(),
  closeProject: vi.fn(),
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => ({}) }))

import { createOpenedProjectsStore } from '../openedProjects'

describe('reconnecting an opened project', () => {
  test('makes its stores again in a new scope, without opening it in the backend again', async () => {
    // The ydoc server that served the project's stores was replaced (the ydoc host restarted):
    // the stores' Language Server session and execution context are gone, so they are made again
    // against the running engine (#593).
    const id = 'p1' as ProjectId
    const info = { mode: 'local', id, title: 'p1' }
    const scopes: EffectScope[] = []
    const initialized = (scope: EffectScope) => {
      scopes.push(scope)
      return { ok: true, value: { status: 'initialized', info, runningId: id, scope } }
    }
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) =>
      initialized(state.scope),
    )
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    expect(mocks.openProject).toHaveBeenCalledTimes(1)
    expect(mocks.initializeProject).toHaveBeenCalledTimes(1)
    const first = scopes[0]!

    store.reconnectProject(id)

    await vi.waitFor(() => expect(mocks.initializeProject).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    expect(mocks.openProject).toHaveBeenCalledTimes(1)
    expect(first.active).toBe(false)
    const second = scopes[1]!
    expect(second).not.toBe(first)
    expect(second.active).toBe(true)
  })

  test('does nothing for a project that is not initialized', () => {
    const store = createOpenedProjectsStore()
    mocks.initializeProject.mockClear()
    store.reconnectProject('unknown' as ProjectId)
    expect(mocks.initializeProject).not.toHaveBeenCalled()
  })
})
