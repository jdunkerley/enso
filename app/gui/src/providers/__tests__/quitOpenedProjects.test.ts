import type { ProjectId } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  states: {
    openProject: vi.fn(),
    closeProject: vi.fn(),
    uploadHybridProject: vi.fn(),
  },
  versioning: {
    isVersioned: vi.fn((_id: string) => true),
    setQuitting: vi.fn(),
  },
  calls: [] as string[],
}))
vi.mock('../openedProjects/projectStates', () => ({ useProjectStates: () => mocks.states }))
vi.mock('../localVersioning', () => ({ useLocalVersioning: () => mocks.versioning }))
vi.mock('enso-common/src/utilities/detect', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isOnElectron: () => true,
}))

import { createOpenedProjectsStore } from '../openedProjects'
import { QUIT_CLOSE_TIMEOUT_MS } from '../openedProjects/quit'

let beforeUnload: ((event: Event) => void) | undefined
let windowClose: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mocks.calls.length = 0
  mocks.states.openProject.mockReset()
  mocks.states.uploadHybridProject.mockReset().mockResolvedValue(undefined)
  mocks.states.closeProject.mockReset().mockImplementation(async (state: { info: unknown }) => {
    mocks.calls.push('close')
    return { ok: true, value: { status: 'not-opened', info: state.info } }
  })
  mocks.versioning.isVersioned.mockReset().mockReturnValue(true)
  mocks.versioning.setQuitting.mockReset().mockImplementation((value: boolean) => {
    mocks.calls.push(`quitting ${value}`)
  })
  windowClose = vi.spyOn(window, 'close').mockImplementation(() => {})
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'beforeunload') beforeUnload = listener as (event: Event) => void
    else add(type, listener, options)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function storeWith(...infos: { mode: string; id: string; synced?: boolean }[]) {
  const store = createOpenedProjectsStore()
  for (const info of infos) {
    mocks.states.openProject.mockResolvedValueOnce({
      ok: true,
      value: { status: 'initialized', info, scope: effectScope() },
    })
    store.openProject({ title: info.id, ...info } as never)
    await vi.waitFor(() =>
      expect(store.get(info.id as ProjectId)?.state.status).toBe('initialized'),
    )
  }
  return store
}

function quit() {
  const event = new Event('beforeunload', { cancelable: true })
  beforeUnload!(event)
  return event
}

describe('quitting the app', () => {
  test('closes each versioned local project, without asking about a repository, then the window', async () => {
    const store = await storeWith({ mode: 'local', id: 'p1' })
    const event = quit()
    expect(event.defaultPrevented).toBe(true)
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    expect(store.closingOnAppExit.value).toBe(false)
    await vi.waitFor(() => expect(windowClose).toHaveBeenCalledTimes(1))
    expect(mocks.calls).toEqual(['quitting true', 'close'])
    expect(mocks.states.closeProject.mock.calls[0]![1]).toEqual({ offer: false })
    expect(store.savingVersionsOnAppExit.value).toBe(false)
    expect(store.get('p1' as ProjectId)?.state.status).toBe('not-opened')
    // The second `beforeunload`, from `window.close()`, lets the window go.
    expect(quit().defaultPrevented).toBe(false)
  })

  test('a local project without versions does not hold the quit', async () => {
    mocks.versioning.isVersioned.mockReturnValue(false)
    await storeWith({ mode: 'local', id: 'p1' })
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).not.toHaveBeenCalled()
    expect(mocks.versioning.setQuitting).not.toHaveBeenCalled()
  })

  test('a project that does not close holds the quit for the time limit, and only once', async () => {
    const store = await storeWith({ mode: 'local', id: 'p1' })
    vi.useFakeTimers()
    mocks.states.closeProject.mockImplementation(() => new Promise(() => {}))
    expect(quit().defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(QUIT_CLOSE_TIMEOUT_MS - 1)
    expect(windowClose).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(windowClose).toHaveBeenCalledTimes(1)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
  })

  test('a failed close does not hold the quit again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await storeWith({ mode: 'local', id: 'p1' })
    mocks.states.closeProject.mockResolvedValue({ ok: false, error: { message: 'no' } })
    expect(quit().defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(windowClose).toHaveBeenCalledTimes(1))
    expect(quit().defaultPrevented).toBe(false)
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
  })

  test('quitting again while the projects close neither closes nor uploads twice', async () => {
    await storeWith({ mode: 'local', id: 'p1' }, { mode: 'hybrid', id: 'h1', synced: false })
    let finishUpload!: () => void
    mocks.states.uploadHybridProject.mockReturnValue(
      new Promise<void>((resolve) => (finishUpload = resolve)),
    )
    expect(quit().defaultPrevented).toBe(true)
    expect(quit().defaultPrevented).toBe(true)
    finishUpload()
    await vi.waitFor(() => expect(windowClose).toHaveBeenCalledTimes(1))
    expect(mocks.states.closeProject).toHaveBeenCalledTimes(1)
    expect(mocks.states.uploadHybridProject).toHaveBeenCalledTimes(1)
  })

  test('syncing and saving at once wait for each other, and say both', async () => {
    const store = await storeWith(
      { mode: 'local', id: 'p1' },
      { mode: 'hybrid', id: 'h1', synced: false },
    )
    let finishUpload!: () => void
    mocks.states.uploadHybridProject.mockReturnValue(
      new Promise<void>((resolve) => (finishUpload = resolve)),
    )
    quit()
    expect(store.closingOnAppExit.value).toBe(true)
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    await vi.waitFor(() => expect(store.get('p1' as ProjectId)?.state.status).toBe('not-opened'))
    expect(windowClose).not.toHaveBeenCalled()
    expect(store.savingVersionsOnAppExit.value).toBe(true)
    finishUpload()
    await vi.waitFor(() => expect(windowClose).toHaveBeenCalledTimes(1))
    expect(store.closingOnAppExit.value).toBe(false)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
  })

  test('a hybrid project in error keeps the window open, and repository questions come back', async () => {
    const store = await storeWith(
      { mode: 'hybrid', id: 'h1', synced: false },
      { mode: 'local', id: 'p1' },
    )
    store.get('h1' as ProjectId)!.error = new Error('offline')
    expect(quit().defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(mocks.versioning.setQuitting).toHaveBeenLastCalledWith(false))
    expect(windowClose).not.toHaveBeenCalled()
    expect(store.closingOnAppExit.value).toBe(false)
    expect(store.savingVersionsOnAppExit.value).toBe(false)
  })

  test('an upload that throws does not leave the dialog up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = await storeWith({ mode: 'hybrid', id: 'h1', synced: false })
    mocks.states.uploadHybridProject.mockRejectedValue(new Error('offline'))
    expect(quit().defaultPrevented).toBe(true)
    expect(store.closingOnAppExit.value).toBe(true)
    await vi.waitFor(() => expect(store.closingOnAppExit.value).toBe(false))
    expect(windowClose).toHaveBeenCalledTimes(1)
  })
})
