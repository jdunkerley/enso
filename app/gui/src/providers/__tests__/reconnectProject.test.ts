import type { ProjectId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  initializeProject: vi.fn(),
  closeProject: vi.fn(),
  toasts: [] as { content: unknown; options: Record<string, unknown> }[],
  dismissed: [] as unknown[],
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => ({}) }))
vi.mock('../toasts', () => ({
  useToasts: () => ({
    show: (content: unknown, options: Record<string, unknown> = {}) =>
      mocks.toasts.push({ content, options }),
    dismiss: (id: unknown) => mocks.dismissed.push(id),
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

  test('a reconnect seen during an opening that throws is not carried into the next opening', async () => {
    const id = 'p4' as ProjectId
    const info = { mode: 'local', id, title: 'p4' }
    mocks.openProject.mockReset()
    mocks.initializeProject.mockReset()
    mocks.toasts.length = 0
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    let failFirst: (() => void) | undefined
    mocks.initializeProject.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failFirst = () => reject(new Error('unexpected'))
        }),
    )
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => ({
      ok: true,
      value: { status: 'initialized', info, runningId: id, scope: state.scope },
    }))
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(failFirst).toBeDefined())
    store.reconnectProject(id)
    failFirst!()
    await vi.waitFor(() => expect(store.get(id)?.error).toBeDefined())

    store.openProject(info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.initializeProject).toHaveBeenCalledTimes(2)
    expect(mocks.toasts).toEqual([])
    error.mockRestore()
  })

  test('the restarted-connection notice closes by itself', async () => {
    const id = 'p5' as ProjectId
    const info = { mode: 'local', id, title: 'p5' }
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
    store.reconnectProject(id)
    const autoClose = mocks.toasts[0]!.options.autoClose
    expect(autoClose).toEqual(expect.any(Number))
    expect(autoClose as number).toBeGreaterThanOrEqual(10_000)
    expect(autoClose as number).toBeLessThanOrEqual(20_000)
  })
})

describe('carrying a project over a session replacement (#604)', () => {
  const snapshot = { path: 'Main.enso', text: 'mine', ownTexts: new Set<string>(), asts: [] }

  /** A module store whose new session loaded a text that leads to `decision`. */
  function moduleWith(decision: 'unchanged' | 'restore' | 'conflict', changes = 2) {
    return {
      carryOverSnapshot: vi.fn(() => snapshot),
      carryOverDecision: vi.fn(() => decision),
      applyCarryOver: vi.fn(() => changes),
    }
  }

  async function reconnected(
    name: string,
    newModule: ReturnType<typeof moduleWith>,
    view?: Record<string, unknown>,
  ) {
    const id = name as ProjectId
    const info = { mode: 'local', id, title: name }
    const oldModule = moduleWith('unchanged')
    const modules = [oldModule, newModule]
    mocks.openProject.mockReset()
    mocks.initializeProject.mockReset()
    mocks.toasts.length = 0
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => ({
      ok: true,
      value: {
        status: 'initialized',
        info,
        runningId: id,
        scope: state.scope,
        module: modules.shift(),
      },
    }))
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    if (view != null) store.registerViewCarryOver(id, () => view as never)
    store.reconnectProject(id)
    await vi.waitFor(() => expect(mocks.initializeProject).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    expect(oldModule.carryOverSnapshot).toHaveBeenCalledTimes(1)
    return { store, id }
  }

  test('edits that never reached the file are put back, text and all, and the user is told', async () => {
    const module = moduleWith('restore', 3)
    await reconnected('c1', module)
    expect(module.carryOverDecision).toHaveBeenCalledWith(snapshot)
    expect(module.applyCarryOver).toHaveBeenCalledWith(snapshot, { withText: true })
    expect(mocks.toasts.map((toast) => toast.content)).toEqual([
      'projectConnectionRestarted',
      'projectChangesRestored 3',
    ])
  })

  test('when the new session has the text, only the metadata is merged', async () => {
    const module = moduleWith('unchanged', 1)
    await reconnected('c2', module)
    expect(module.applyCarryOver).toHaveBeenCalledWith(snapshot, { withText: false })
    expect(mocks.toasts.at(-1)!.content).toBe('projectChangeRestored')
  })

  test('nothing to put back shows no second notice', async () => {
    const module = moduleWith('unchanged', 0)
    await reconnected('c3', module)
    expect(mocks.toasts).toHaveLength(1)
  })

  test('a file changed by another route is kept, and the user may restore their version', async () => {
    const module = moduleWith('conflict')
    await reconnected('c4', module)
    expect(module.applyCarryOver).not.toHaveBeenCalled()
    const prompt = mocks.toasts.at(-1)!
    expect(prompt.options.autoClose).toBe(false)
    const { props } = prompt.content as { props: { onKeep: () => void; onRestore: () => void } }

    props.onRestore()

    expect(module.applyCarryOver).toHaveBeenCalledWith(snapshot, { withText: true })
    expect(mocks.dismissed).toContain(prompt.options.toastId)
    expect(mocks.toasts.at(-1)!.content).toBe('projectChangesRestored 2')
  })

  test('keeping the file changes nothing', async () => {
    const module = moduleWith('conflict')
    await reconnected('c5', module)
    const prompt = mocks.toasts.at(-1)!
    const { props } = prompt.content as { props: { onKeep: () => void } }
    props.onKeep()
    expect(module.applyCarryOver).not.toHaveBeenCalled()
    expect(mocks.dismissed).toContain(prompt.options.toastId)
  })

  test('the view’s state goes to the next view once', async () => {
    const view = { selection: ['n1'], dockOpen: true, componentBrowser: undefined }
    const { store, id } = await reconnected('c6', moduleWith('unchanged', 0), view)
    expect(store.takeViewCarryOver(id)).toEqual(view)
    expect(store.takeViewCarryOver(id)).toBeUndefined()
  })
})
