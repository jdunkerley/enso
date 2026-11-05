import type { ProjectId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  initializeProject: vi.fn(),
  closeProject: vi.fn(),
  toasts: [] as { content: unknown; options: Record<string, unknown> }[],
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => ({}) }))
vi.mock('../toasts', () => ({
  useToasts: () => ({
    show: (content: unknown, options: Record<string, unknown> = {}) =>
      mocks.toasts.push({ content, options }),
  }),
}))
vi.mock('../text', () => ({
  useText: () => ({ getText: (key: string, ...args: unknown[]) => [key, ...args].join(' ') }),
}))

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

  test('a replacement seen while the project is still opening is carried out once it opens', async () => {
    // The store registers its observer inside `initializeProject`, which then still waits for the
    // module store; a session replaced in that window (an engine starting under the Node host
    // churns sessions) must not be dropped, or the project ends up initialized without a session.
    const id = 'p2' as ProjectId
    const info = { mode: 'local', id, title: 'p2' }
    mocks.openProject.mockReset()
    mocks.initializeProject.mockReset()
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    let finishFirst: (() => void) | undefined
    mocks.initializeProject.mockImplementationOnce(
      (state: { scope: EffectScope }) =>
        new Promise((resolve) => {
          finishFirst = () =>
            resolve({
              ok: true,
              value: { status: 'initialized', info, runningId: id, scope: state.scope },
            })
        }),
    )
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => ({
      ok: true,
      value: { status: 'initialized', info, runningId: id, scope: state.scope },
    }))
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(finishFirst).toBeDefined())

    store.reconnectProject(id)
    expect(mocks.initializeProject).toHaveBeenCalledTimes(1)
    finishFirst!()

    await vi.waitFor(() => expect(mocks.initializeProject).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.initializeProject).toHaveBeenCalledTimes(2)
    expect(mocks.openProject).toHaveBeenCalledTimes(1)
  })

  test('tells the user the connection was restarted and recent changes may be lost', async () => {
    const id = 'p3' as ProjectId
    const info = { mode: 'local', id, title: 'p3' }
    mocks.openProject.mockReset()
    mocks.initializeProject.mockReset()
    mocks.toasts.length = 0
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => ({
      ok: true,
      value: { status: 'initialized', info, runningId: id, scope: state.scope },
    }))
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    expect(mocks.toasts).toEqual([])

    store.reconnectProject(id)

    expect(mocks.toasts).toHaveLength(1)
    expect(mocks.toasts[0]!.content).toContain('projectConnectionRestarted')
    expect(mocks.toasts[0]!.options.type).toBe('warning')
  })
})
