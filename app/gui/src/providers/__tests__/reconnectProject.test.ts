import type { ProjectId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  initializeProject: vi.fn(),
  closeProject: vi.fn(),
  toasts: [] as { content: unknown; options: Record<string, unknown> }[],
  dismissed: [] as unknown[],
  active: new Map<unknown, { content: unknown; options: Record<string, unknown> }>(),
}))
vi.mock('../openedProjects/projectStates', () => ({
  useProjectStates: () => mocks,
}))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => ({}) }))
vi.mock('../toasts', () => ({
  useToasts: () => ({
    show: (content: unknown, options: Record<string, unknown> = {}) => {
      mocks.toasts.push({ content, options })
      if (options.toastId != null) mocks.active.set(options.toastId, { content, options })
    },
    update: (id: unknown, { render, ...options }: Record<string, unknown>) => {
      mocks.toasts.push({ content: render, options })
      mocks.active.set(id, { content: render, options })
    },
    isActive: (id: unknown) => mocks.active.has(id),
    dismiss: (id: unknown) => {
      mocks.dismissed.push(id)
      mocks.active.delete(id)
    },
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
  const MINE = 'a\nB\nc\n'
  const snapshot = { path: 'Main.enso', text: MINE, ownTexts: new Set<string>(), asts: [] }

  /**
   * A module store whose session loaded `loaded`, and whose carry-over decision is `decision`. Its
   * text follows the edits made through it.
   */
  function fakeModule(
    loaded: string,
    decision: 'unchanged' | 'restore' | 'conflict' = 'conflict',
    ownSnapshot = snapshot,
  ) {
    const module = {
      source: { text: loaded },
      carryOverSnapshot: vi.fn(() => ({ ...ownSnapshot, text: module.source.text })),
      carryOverDecision: vi.fn(() => decision),
      applyCarryOver: vi.fn((_: unknown, { text }: { text: string | undefined }) => {
        if (text != null) module.source.text = text
        return 2
      }),
      replaceText: vi.fn((text: string) => {
        module.source.text = text
        return { ok: true }
      }),
    }
    return module
  }
  type FakeModule = ReturnType<typeof fakeModule>

  /** Open a project whose successive initializations get `modules`, the first one the old one. */
  async function opened(name: string, modules: (FakeModule | 'fail')[]) {
    const id = name as ProjectId
    const info = { mode: 'local', id, title: name }
    mocks.openProject.mockReset()
    mocks.initializeProject.mockReset()
    mocks.toasts.length = 0
    mocks.active.clear()
    mocks.openProject.mockImplementation(async () => ({
      ok: true,
      value: { status: 'opened', info, runningId: id, scope: effectScope() },
    }))
    mocks.initializeProject.mockImplementation(async (state: { scope: EffectScope }) => {
      const module = modules.shift()
      if (module === 'fail') return { ok: false, error: new Error('cannot open') }
      return {
        ok: true,
        value: { status: 'initialized', info, runningId: id, scope: state.scope, module },
      }
    })
    const store = createOpenedProjectsStore()
    store.openProject(info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    return { store, id }
  }

  async function reconnect(store: ReturnType<typeof createOpenedProjectsStore>, id: ProjectId) {
    const calls = mocks.initializeProject.mock.calls.length
    store.reconnectProject(id)
    await vi.waitFor(() => expect(mocks.initializeProject).toHaveBeenCalledTimes(calls + 1))
    await vi.waitFor(() => expect(store.get(id)?.nextTask).toBeUndefined())
  }

  function activeToast(prefix: string) {
    for (const [id, toast] of mocks.active) if (String(id).startsWith(prefix)) return toast
  }
  function restoredToast() {
    return activeToast('project-changes-restored')?.content as
      { props: { message: string; onUndo?: () => void } } | undefined
  }
  function fileChangedToast() {
    return activeToast('project-file-changed')?.content as
      { props: { replaces: boolean; onKeep: () => void; onRestore: () => void } } | undefined
  }

  test('edits that never reached the file are put back, and the user is told', async () => {
    const module = fakeModule('a\nb\nc\n', 'restore')
    const { store, id } = await opened('c1', [fakeModule(MINE), module])
    await reconnect(store, id)
    expect(module.applyCarryOver).toHaveBeenCalledWith(snapshot, { text: MINE })
    expect(module.source.text).toBe(MINE)
    expect(restoredToast()!.props.message).toBe('projectChangesRestored 2')
    expect(restoredToast()!.props.onUndo).toBeDefined()
  })

  test('when the new session has the text, only the metadata is merged, with no Undo', async () => {
    const module = fakeModule(MINE, 'unchanged')
    const { store, id } = await opened('c2', [fakeModule(MINE), module])
    await reconnect(store, id)
    expect(module.applyCarryOver).toHaveBeenCalledWith(snapshot, { text: undefined })
    expect(restoredToast()!.props.onUndo).toBeUndefined()
  })

  test('Undo takes back the restored text, keeping edits made since elsewhere', async () => {
    const module = fakeModule('a\nb\nc\n', 'restore')
    const { store, id } = await opened('c3', [fakeModule(MINE), module])
    await reconnect(store, id)
    module.source.text = 'a\nB\nc\nd\n'
    restoredToast()!.props.onUndo!()
    expect(module.replaceText).toHaveBeenCalledWith('a\nb\nc\nd\n')
    expect(module.source.text).toBe('a\nb\nc\nd\n')
  })

  test('Undo refuses, and says so, when the restored text was edited since', async () => {
    const module = fakeModule('a\nb\nc\n', 'restore')
    const { store, id } = await opened('c4', [fakeModule(MINE), module])
    await reconnect(store, id)
    module.source.text = 'a\nBB\nc\n'
    restoredToast()!.props.onUndo!()
    expect(module.replaceText).not.toHaveBeenCalled()
    expect(mocks.toasts.at(-1)!.content).toBe('projectRestoreUndoFailed')
  })

  test('a file changed by another route is kept until the user restores their version', async () => {
    const module = fakeModule('x\nb\nc\n')
    const { store, id } = await opened('c5', [fakeModule(MINE), module])
    await reconnect(store, id)
    expect(module.applyCarryOver).not.toHaveBeenCalled()
    expect(activeToast('project-file-changed')!.options.autoClose).toBe(false)
    expect(fileChangedToast()!.props.replaces).toBe(false)

    fileChangedToast()!.props.onRestore()

    expect(module.source.text).toBe(MINE)
    expect(fileChangedToast()).toBeUndefined()
    expect(restoredToast()!.props.message).toBe('projectChangesRestored 2')
  })

  test('keeping the file changes nothing', async () => {
    const module = fakeModule('x\nb\nc\n')
    const { store, id } = await opened('c6', [fakeModule(MINE), module])
    await reconnect(store, id)
    fileChangedToast()!.props.onKeep()
    expect(module.applyCarryOver).not.toHaveBeenCalled()
    expect(module.source.text).toBe('x\nb\nc\n')
    expect(fileChangedToast()).toBeUndefined()
  })

  test('edits made while the choice is open are kept when the user restores', async () => {
    const module = fakeModule('x\nb\nc\n')
    const { store, id } = await opened('c7', [fakeModule(MINE), module])
    await reconnect(store, id)
    module.source.text = 'x\nb\nc\nnew\n'
    fileChangedToast()!.props.onRestore()
    // My version (against the file it was offered over), and the line added since.
    expect(module.source.text).toBe('a\nB\nc\nnew\n')
  })

  test('edits made in the same places are not replaced without asking again', async () => {
    const module = fakeModule('x\nb\nc\n')
    const { store, id } = await opened('c8', [fakeModule(MINE), module])
    await reconnect(store, id)
    module.source.text = 'x\nbee\nc\n'

    fileChangedToast()!.props.onRestore()

    expect(module.applyCarryOver).not.toHaveBeenCalled()
    expect(module.source.text).toBe('x\nbee\nc\n')
    expect(fileChangedToast()!.props.replaces).toBe(true)

    fileChangedToast()!.props.onRestore()

    expect(module.source.text).toBe(MINE)
    expect(fileChangedToast()).toBeUndefined()
  })

  test('a choice still open when the session is replaced again is offered again', async () => {
    const second = fakeModule('x\nb\nc\n')
    const third = fakeModule('x\nb\nc\n', 'unchanged')
    const { store, id } = await opened('c9', [fakeModule(MINE), second, third])
    await reconnect(store, id)
    expect(fileChangedToast()).toBeDefined()

    await reconnect(store, id)

    expect(fileChangedToast()).toBeDefined()
    fileChangedToast()!.props.onRestore()
    expect(third.source.text).toBe(MINE)
    expect(second.applyCarryOver).not.toHaveBeenCalled()
  })

  test('a reopening that fails drops what was carried over', async () => {
    const after = fakeModule('a\nb\nc\n', 'restore')
    const view = { selection: ['n1'], dockOpen: true, componentBrowser: undefined }
    const { store, id } = await opened('c10', [fakeModule(MINE), 'fail', after])
    store.registerViewCarryOver(id, () => view as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.reconnectProject(id)
    await vi.waitFor(() => expect(store.get(id)?.error).toBeDefined())
    store.openProject(store.get(id)!.state.info as never)
    await vi.waitFor(() => expect(store.get(id)?.state.status).toBe('initialized'))
    await vi.waitFor(() => expect(store.get(id)?.nextTask).toBeUndefined())
    expect(after.applyCarryOver).not.toHaveBeenCalled()
    expect(store.takeViewCarryOver(id)).toBeUndefined()
    error.mockRestore()
  })

  test('the view’s state goes to the next view once', async () => {
    const view = { selection: ['n1'], dockOpen: true, componentBrowser: undefined }
    const { store, id } = await opened('c11', [fakeModule(MINE), fakeModule(MINE, 'unchanged')])
    store.registerViewCarryOver(id, () => view as never)
    await reconnect(store, id)
    expect(store.takeViewCarryOver(id)).toEqual(view)
    expect(store.takeViewCarryOver(id)).toBeUndefined()
  })
})
